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
| Object storage | RustFS | S3 API |
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

### Logging in as a demo user

Every API route except `/health` needs a bearer token. The `identity` service (Keycloak, on `localhost:8080`) imports the `fiapx` realm from [`identity/fiapx-realm.json`](identity/fiapx-realm.json) on every start, so nothing changed by hand in its console survives a restart. The realm has two demo users and no self-registration:

| User | Password |
| --- | --- |
| `alice` | `alice-dev-password` |
| `bob` | `bob-dev-password` |

Their ids are pinned in the realm file, so each user's `sub`, which the API records as a request's owner, stays the same across restarts. Get a token with one command; it prints only the access token:

```sh
TOKEN=$(node scripts/get-token.mjs alice)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/processing-requests
```

`--password <p>` overrides the demo password, and `IDENTITY_URL` overrides `http://localhost:8080`. A rejected user or password exits 1 naming the user and Keycloak's reason; an unreachable `identity` exits 1 naming the service. A token lasts 5 minutes.

The script uses the OAuth password grant through the public client `fiapx-cli`. OAuth 2.1 discourages that grant. It is acceptable here only because the client and these passwords exist solely in the local development realm; the client has no browser flow and no secret, and nothing here reaches a deployed environment.

### What the smoke proves

Each run creates two new requests as `alice` and one as `bob`. It proves two processing outcomes, so neither can pass on a status alone, and it proves that authentication and owner scope hold:

- **An archive with the right frame count.** The fixture video must reach `COMPLETED`. The smoke then downloads the archive at the `zipStorageKey` the Catalog reports and counts its entries: 8 seconds at 1 frame per second gives 8. It fails naming which of three things it found: an archive that is absent, one that is unreadable, or one that is empty. A wrong count names both numbers.
- **A rejection with the safe reason.** An object that is not a video must reach `FAILED` with `FORMATO_INVALIDO`. It must leave no archive, and the Notification Service must record exactly one delivery carrying the user-facing sentence.
- **A private bucket.** An anonymous request for the seeded object and for the bucket listing must be refused with 403.
- **Anonymous creation refused.** A `POST /processing-requests` without a token must answer 401.
- **Disjoint lists.** `alice`'s list must hold her requests and not `bob`'s; `bob`'s must hold his and none of hers, from this run or an earlier one.
- **A cross-owner read looks like a missing one.** `bob` reading `alice`'s request must get 404 with exactly the body a random id gets.
- **No internal fields.** No item in `alice`'s list may carry `sourceStorageKey`, `zipStorageKey`, `failureCode` or `ownerUserId`, and her rejected request must carry exactly the user-facing sentence.
- **No leftovers.** The smoke's own temporary directory must be gone after cleanup.

The smoke logs in through `getToken` from `scripts/get-token.mjs`. It keeps one token per user, and when the API answers 401 it fetches a fresh token once and retries, so a token that expires during a long run does not fail it. A second 401 fails naming the step. It still reads `zipStorageKey` from the Catalog's local observation endpoint, because the API never exposes it.

The smoke is one ordered list of steps. Each step observes the stack, then checks what it observed. `node scripts/smoke-local-integration.mjs --self-test` needs no stack. It requires fourteen assertion steps to be in that list: anonymous access, anonymous refused, the video completed, the archive key scoped to this request, the rejection, the archive count, no archive for the rejection, the delivery sentence, a single delivery, bob's request created, disjoint lists, the cross-owner 404, no internal fields, and no leftovers. It runs each step's own check against one bad observation and requires the exact failure message, then against good observations and requires a pass. It also calls each assertion helper directly with bad and good inputs. So a step that is removed, or a check that stops checking, fails the self-test. It also drives the token refresh with an injected token source: a 401 then a 200 must pass with a fresh token, and two 401s must fail. It does not reach the stack: whether an HTTP call or a `docker compose` command observes the right thing is proved only by the real run. CI's `topology` job and the build gate run it.

Both processing assertions were verified by making them fail: a Worker that stores no archive, and a Worker that validates nothing, each turn the smoke red. The owner-scope assertions were verified the same way, against scratch copies of the API: one that also returns `bob`'s requests to `alice` fails `lists disjoint`, one that answers 403 to a cross-owner read fails `cross-owner read 404`, and one that lets a request without a token in fails `anonymous refused`. The smoke seeds its own source objects, so it needs nothing but a running stack.

### Object storage

RustFS serves the S3 API on `localhost:9000`, or on `STORAGE_HOST_PORT` when it is set (development credentials `fiapx-dev` / `fiapx-dev-secret`). The topology's own scripts talk to it with plain `aws-cli`, never a vendor CLI, so the server can be swapped behind the protocol ([AD-014](.specs/STATE.md)). One private bucket, `fiapx`, holds two prefixes:

| Prefix | Holds |
| --- | --- |
| `sources/` | Source videos the Worker reads |
| `zips/<processingRequestId>/<attemptId>/frames.zip` | The archive of extracted frames the Worker writes |

Objects under both prefixes expire **7 days** after creation. That is a product rule from [`docs/foudation.md`](docs/foudation.md), not a housekeeping choice, and the bucket's own lifecycle rules enforce it. No job deletes anything.

`storage/bootstrap.sh` runs in the one-shot `storage-init` service (`amazon/aws-cli`) **on every start**, and the Worker does not start until it has succeeded. That is the opposite of the database bootstrap below, which runs only on an empty volume. So every step is idempotent: it creates the bucket only if it is missing, fails if the bucket has any bucket policy (the only way the S3 API grants anonymous access) without ever setting one, and writes the two retention rules only when one is missing — refusing, rather than overwriting, any lifecycle rule it does not own. A volume left over from an earlier run is therefore brought up to date instead of failing.

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

### Host ports already in use

Three host ports can be moved when another program on the machine already holds them. Set the variable in `.env` or the shell:

| Variable | Default | Service |
| --- | --- | --- |
| `POSTGRES_HOST_PORT` | 5432 | `postgres` |
| `STORAGE_HOST_PORT` | 9000 | `storage` (the S3 API) |
| `WORKER_HOST_PORT` | 3002 | `worker` |

```sh
export POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002
docker compose up --build -d --wait
node scripts/seed-source-video.mjs
node scripts/smoke-local-integration.mjs
```

Only the host side moves. The services still reach `postgres:5432`, `storage:9000` and `worker:3002` inside the network, so nothing else changes. The smoke reads `STORAGE_HOST_PORT` to reach the bucket from the host, so the same exports run the whole gate. A service's database e2e suite that connects from the host, such as `processing-catalog`'s, needs `DATABASE_PORT` set to the value of `POSTGRES_HOST_PORT`.

### Worker sizing

`WORKER_CPUS` sets both the Worker's CPU limit (`cpus`) and its FFmpeg thread count (`FFMPEG_THREADS`). It defaults to 2; set it in `.env` or the shell to change both. FFmpeg reads the host's core count rather than the container's limit, so the two must agree (AD-006). `node scripts/check-worker-sizing.mjs` reads the rendered `docker compose config` and fails, naming both values, when they do not. It also fails when `WORKER_CPUS` exceeds the Docker engine's CPU count, because Docker refuses to start a container with a larger limit. It runs in the build gate and in CI.

`node scripts/check-worker-sizing.mjs --self-test` needs no Docker. It feeds the two comparisons a thread count that differs from the limit, a non-integer or non-positive thread count, and a limit above the engine's count, including one CPU more than the engine has. Each must fail with its exact message. A matching pair, and a limit equal to or below the engine's count, must pass. It does not test reading `docker compose config` or `docker info`; the check itself does that. The build gate and CI run it too.

This declared value is the contract S9a carries into the Worker's Kubernetes `limits`.

## Layout

| Path | Contents |
| --- | --- |
| `docs/foudation.md` | The architecture foundation: scope, services, canonical flow, state machine, contracts, concurrency model |
| `docs/` | Challenge brief and modelling references |
| `.specs/STATE.md` | Cross-repository decision log (AD-001 onward) |
| `.specs/features/` | Cross-repository feature specifications |
| `compose.yaml` | Local runtime topology |
| `identity/` | The `fiapx` realm the identity service imports: demo users and the development client |
| `scripts/` | Local integration smoke test, demo-user token helper, source seeding, Worker sizing check |
| `fixtures/` | The committed source video and its provenance |
| `storage/` | The object storage bootstrap |

## Decisions

Architectural decisions that span more than one repository live in [`.specs/STATE.md`](.specs/STATE.md). Service-local decisions stay in each service's own `.specs/`.

Currently active: four service repositories plus this one (AD-001, AD-007), a local-first platform with protocol-level ports (AD-005), a NestJS Worker with a bounded concurrency envelope (AD-006), and no cache tier in the MVP (AD-008).

## Note on the modelling board

`docs/FIAP X.pdf` — the ubiquitous language, event storming, bounded contexts, and C4 diagrams — is being redrawn to match the local-first platform decision and is not yet in this repository. `docs/foudation.md` carries the same decisions in text form in the meantime.
