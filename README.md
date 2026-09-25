# FIAP X — platform

Entry point for the FIAP X video-processing system. This repository holds what belongs to the system as a whole rather than to any single service: the architecture documentation, the cross-repository decision log, the local runtime topology, and the deployment manifests.

It is **not a fifth service**. It has no business behaviour, no release cadence, and nothing here is deployed on its own.

## The system

FIAP X receives an authenticated video, extracts one frame per second, and delivers a ZIP package to the request owner. Processing is asynchronous, so many videos are handled in parallel and no request is lost during traffic spikes.

| Repository | Responsibility |
| --- | --- |
| [`fiap-x-api`](../fiap-x-api) | HTTP edge: JWT validation, presigned upload/download URLs, idempotent upload confirmation, owner-scoped status |
| [`processing-catalog`](../processing-catalog) | Owns the `ProcessingRequest` lifecycle, its state machine, and reliable event publication through a transactional outbox |
| [`processing-worker`](../processing-worker) | FFprobe validation, FFmpeg frame extraction, ZIP packaging, and object storage |
| [`notification-service`](../notification-service) | Sends one completion or failure email per terminal event, idempotently |

The four services communicate exclusively over versioned AMQP contracts and one HTTP call from the API to the Catalog. They share no database tables and no code.

## Platform

Every dependency runs locally as a container and is reached through a standard protocol, so no provider-specific SDK or claim reaches the application layer.

| Capability | Component | Protocol |
| --- | --- | --- |
| Identity | Keycloak | OIDC/JWKS |
| Object storage | MinIO | S3 API |
| Database | PostgreSQL | SQL |
| Messaging | RabbitMQ | AMQP |
| Email | Mailpit | SMTP |
| Observability | Prometheus + Grafana | `/metrics` |
| Runtime | Kubernetes (kind/k3d) | versioned manifests |

## Running locally

```sh
docker compose up --build -d --wait
node scripts/smoke-local-integration.mjs
```

Compose builds each service from its sibling repository, so all five repositories must be checked out under the same parent directory.

### What the smoke proves

Each run creates two new requests and proves two outcomes, so neither can pass on a status alone:

- **An archive with the right frame count.** The fixture video must reach `COMPLETED`. The smoke then downloads the archive at the `zipStorageKey` the Catalog reports and counts its entries: 8 seconds at 1 frame per second gives 8. It fails naming which of three things it found: an archive that is absent, one that is unreadable, or one that is empty. A wrong count names both numbers.
- **A rejection with the safe reason.** An object that is not a video must reach `FAILED` with `FORMATO_INVALIDO`. It must leave no archive, and the Notification Service must record exactly one delivery carrying the user-facing sentence.
- **A private bucket.** An anonymous request for the seeded object and for the bucket listing must be refused with 403.
- **No leftovers.** The smoke's own temporary directory must be gone after cleanup.

`node scripts/smoke-local-integration.mjs --self-test` needs no stack: it feeds every assertion above a bad input and requires the specific failure, so an assertion that stops checking fails CI's `topology` job.

Both assertions were verified by making them fail: a Worker that stores no archive, and a Worker that validates nothing, each turn the smoke red. The smoke seeds its own source objects, so it needs nothing but a running stack.

### Object storage

MinIO serves the S3 API on `localhost:9000`, with its console on `localhost:9001`. One private bucket, `fiapx`, holds two prefixes:

| Prefix | Holds |
| --- | --- |
| `sources/` | Source videos the Worker reads |
| `zips/<processingRequestId>/<attemptId>/frames.zip` | The archive of extracted frames the Worker writes |

Objects under both prefixes expire **7 days** after creation. That is a product rule from [`docs/foudation.md`](docs/foudation.md), not a housekeeping choice, and the bucket's own lifecycle rules enforce it. No job deletes anything.

`minio/bootstrap.sh` runs in the one-shot `minio-init` service **on every start**, and the Worker does not start until it has succeeded. That is the opposite of the database bootstrap below, which runs only on an empty volume. So every step is idempotent: it creates the bucket only if it is missing, asserts that the bucket is private without ever setting a policy, and adds each retention rule only when its prefix has none. A volume left over from an earlier run is therefore brought up to date instead of failing.

### Seeding a source video

```sh
node scripts/seed-source-video.mjs
```

This uploads the committed fixture [`fixtures/sample-8s.mp4`](fixtures/README.md) to `sources/sample-8s.mp4`. It also writes a small non-video to `sources/not-a-video.mp4`, and prints both keys. The keys are fixed, so running it again leaves the same two objects.

The script is a **stand-in for the upload path**. S6 replaces it with presigned uploads through the API and deletes it, so do not extend it as a feature.

### The database bootstrap runs only once

`db/init/01-schemas.sql` creates a schema and a least-privilege role for the Catalog and for the Notification Service. PostgreSQL executes it **only when it initialises an empty data directory**, and never again.

So if you have a `postgres-data` volume from before this file existed, the schemas are missing and those two services fail to start with `permission denied for schema` or a missing relation. The fix is to discard the volume:

```sh
docker compose down -v
docker compose up --build
```

This costs you the local data, which is the intent — the volume holds nothing worth keeping between runs.

Each service evolves its own tables through its own migrations. This file only creates the empty schemas and denies each role access to the other's, which is the boundary `docs/foudation.md` requires.

### Worker sizing

`WORKER_CPUS` sets both the Worker's CPU limit (`cpus`) and its FFmpeg thread count (`FFMPEG_THREADS`). It defaults to 2; set it in `.env` or the shell to change both. FFmpeg reads the host's core count rather than the container's limit, so the two must agree (AD-006). `node scripts/check-worker-sizing.mjs` reads the rendered `docker compose config` and fails, naming both values, when they do not. It also fails when `WORKER_CPUS` exceeds the Docker engine's CPU count, because Docker refuses to start a container with a larger limit. It runs in the build gate and in CI.

This declared value is the contract S9a carries into the Worker's Kubernetes `limits`.

## Layout

| Path | Contents |
| --- | --- |
| `docs/foudation.md` | The architecture foundation: scope, services, canonical flow, state machine, contracts, concurrency model |
| `docs/` | Challenge brief and modelling references |
| `.specs/STATE.md` | Cross-repository decision log (AD-001 onward) |
| `.specs/features/` | Cross-repository feature specifications |
| `compose.yaml` | Local runtime topology |
| `scripts/` | Local integration smoke test, source seeding, Worker sizing check |
| `fixtures/` | The committed source video and its provenance |
| `minio/` | The object storage bootstrap |

## Decisions

Architectural decisions that span more than one repository live in [`.specs/STATE.md`](.specs/STATE.md). Service-local decisions stay in each service's own `.specs/`.

Currently active: four service repositories plus this one (AD-001, AD-007), a local-first platform with protocol-level ports (AD-005), a NestJS Worker with a bounded concurrency envelope (AD-006), and no cache tier in the MVP (AD-008).

## Note on the modelling board

`docs/FIAP X.pdf` — the ubiquitous language, event storming, bounded contexts, and C4 diagrams — is being redrawn to match the local-first platform decision and is not yet in this repository. `docs/foudation.md` carries the same decisions in text form in the meantime.
