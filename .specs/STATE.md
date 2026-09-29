# STATE

## Decisions

### AD-001
- **Decision**: FIAP X will use four independently versioned repositories: `fiap-x-api`, `processing-catalog`, `processing-worker`, and `notification-service`.
- **Reason**: The approved architecture assigns each unit a distinct responsibility and scaling profile.
- **Trade-off**: Cross-service contracts and release coordination require explicit documentation.
- **Scope**: All FIAP X services and their deployment boundaries.
- **Date**: 2026-08-25
- **Status**: active

### AD-002
- **Decision**: The initial system architecture will use NestJS/TypeScript, PostgreSQL/RDS, RabbitMQ, S3, Cognito, SES, EKS, and Terraform.
- **Reason**: This stack and its ownership boundaries are already defined in the FIAP X foundation.
- **Trade-off**: The solution is coupled to AWS managed services and Kubernetes operations.
- **Scope**: All future FIAP X implementation features.
- **Date**: 2026-08-25
- **Status**: superseded by AD-005

### AD-003
- **Decision**: Local cross-service integration will run from a root Docker Compose topology with RabbitMQ. Services retain local DTOs and communicate through documented JSON; no shared contracts package is introduced.
- **Reason**: The approved next slice must prove the real HTTP and AMQP path before AWS infrastructure exists.
- **Trade-off**: Compose adds local container configuration and local-only observability endpoints, which must not be enabled outside the integration profile.
- **Scope**: The local Docker integration feature and subsequent local system tests.
- **Date**: 2026-08-27
- **Status**: superseded by AD-004

### AD-004
- **Decision**: The root workspace coordinates cross-repository specifications and agents only. Local integration runtime assets will be owned by `fiap-x-api` as the developer entrypoint, while each service owns its implementation specification and source changes.
- **Reason**: The solution remains four repositories; adding runtime artifacts to root would create an implicit fifth project and blur ownership.
- **Trade-off**: API holds developer-environment assets despite not owning Catalog/Worker/Notification business behavior; service-local specs must keep that boundary explicit.
- **Scope**: Local Docker integration and all future cross-repository orchestration.
- **Date**: 2026-08-28
- **Status**: superseded by AD-007

### AD-005
- **Decision**: FIAP X runs entirely on local, self-hosted infrastructure: NestJS/TypeScript, PostgreSQL, RabbitMQ, MinIO for S3-compatible object storage, Keycloak as the OIDC identity provider, Mailpit over SMTP, Prometheus/Grafana for observability, and Kubernetes (kind/k3d) from versioned manifests. Every dependency is reached through a port that speaks a standard protocol (OIDC/JWKS, S3 API, SMTP, AMQP), and no provider-specific SDK or claim reaches the application layer.
- **Reason**: The hackathon requirements never asked for a managed cloud - the recommended stack is Docker/Kubernetes, RabbitMQ, PostgreSQL, Prometheus/Grafana and GitHub Actions, all of which run locally. AWS was our own addition in AD-002, and the team has no account available. A local topology satisfies every functional and technical requirement with no waiting.
- **Trade-off**: The team operates its own dependencies instead of consuming managed services, and the cloud-deployment story becomes documented evolution rather than delivered work. In exchange, no slice is blocked and the protocol-level ports keep a later migration to a managed provider at the cost of adapters and environment variables.
- **Scope**: All FIAP X services, specifications, and deployment artifacts. Supersedes AD-002.
- **Date**: 2026-09-19
- **Status**: active (the object storage server was amended by AD-014: RustFS replaces MinIO behind the same S3 port)

### AD-006
- **Decision**: The Processing Worker stays on NestJS and runs FFmpeg in a child process. Concurrency comes from a configured `prefetchCount` per queue, an explicit `ffmpeg -threads` value matched to the pod's CPU limit, and horizontal replicas scaled by queue depth. `worker_threads` is not used.
- **Reason**: The CPU-bound work happens inside FFmpeg, an operating-system process with its own threads, so the Node event loop is never on the critical path. Both scaling axes the team wants - several videos per pod and several pods - are already available without changing language. FFmpeg reads the host core count rather than the cgroup limit, which makes the explicit thread count necessary regardless of runtime.
- **Trade-off**: A Go or other multithreaded runtime would yield a smaller image and faster scale-out, which remains open for discussion; rewriting now would spend the scarcest resource on the axis that changes throughput the least, since FFmpeg bounds it either way.
- **Scope**: `processing-worker` implementation and its deployment sizing.
- **Date**: 2026-09-19
- **Status**: active

### AD-007
- **Decision**: A fifth repository, `fiap-x-platform`, owns everything that belongs to the system rather than to a single service: the architecture foundation and reference documents, the cross-repository decision log and specifications, the Docker Compose topology, the local integration smoke script, the Kubernetes manifests for the whole topology, and the database creation script. The four service repositories keep their own Dockerfile, their own `.specs/features/`, and their own source.
- **Reason**: The foundation document and the decision log were unversioned on the working volume, which put the least reproducible artefacts of the project at risk and made them impossible to submit, since the deliverables are handed in as GitHub links. AD-001 separates the four *services* by responsibility and scaling profile; a documentation and deployment repository is not a service and does not contradict it. The manifests describe one topology - namespaces, dependencies, and the Worker's queue-depth autoscaling thresholds - so splitting them across four repositories would leave nobody able to stand the system up.
- **Trade-off**: A deployment now touches two repositories, and `fiap-x-api` loses the developer-environment assets AD-004 had assigned to it. In exchange the project gains a front door, the cross-cutting documents gain history, and the topology gains a single owner. The implicit fifth project AD-004 tried to avoid already existed on disk; this makes it explicit and versioned.
- **Scope**: All cross-repository documentation, specifications, and deployment artefacts. Supersedes AD-004.
- **Date**: 2026-09-19
- **Status**: active

### AD-008
- **Decision**: The MVP introduces no cache tier. Deduplication and idempotency are served by PostgreSQL and by deterministic object keys, not by Redis.
- **Reason**: A deduplication record must commit in the same transaction as the state transition it guards; an external cache cannot join that transaction, which opens the window where an event is marked processed but its transition is rolled back. In the Worker, idempotency comes from the deterministic object key `processingRequestId/attemptId`, so a redelivery overwrites the same object and republishes the same result - idempotency by construction rather than by bookkeeping. No cache pressure has been measured anywhere. The challenge brief recommends Redis but explicitly allows the group's own preference.
- **Trade-off**: The recommended stack is not adopted in full, which must be explained rather than assumed. If owner-scoped status listing becomes hot, or if presigned URL issuance needs rate limiting, a cache earns its place and this decision is revisited with a measurement behind it.
- **Scope**: `processing-catalog` persistence, `processing-worker` deduplication, and API read paths.
- **Date**: 2026-09-19
- **Status**: active

### AD-009
- **Decision**: `processing-catalog` and `notification-service` persist through TypeORM against PostgreSQL, with schema changes applied only as versioned migrations that each service runs at boot. Each service owns its own schema (`catalog`, `notification`) inside one database, under its own least-privilege role. `synchronize` is never enabled anywhere.
- **Reason**: Both services already express their state as entities, and the challenge asks for a database creation script as a deliverable - which is generated from the migrations rather than maintained beside them, so it cannot drift. Schema-per-service inside one database keeps the ownership boundary of AD-001 (no service reads another's tables) without asking a local-first stack to run two database servers. `synchronize` would let a code change rewrite a production schema with no review and no rollback.
- **Trade-off**: One database is one blast radius, and a single PostgreSQL is a shared failure domain that four independent services would not have. The schemas and the separate roles keep the boundary enforceable, so splitting them later is an infrastructure change rather than a code change.
- **Scope**: `processing-catalog` and `notification-service` persistence; `fiap-x-platform` bootstrap and generated script.
- **Date**: 2026-09-20
- **Status**: active

### AD-010
- **Decision**: In `processing-catalog`, nothing publishes to the broker except the outbox relay. A state transition, its deduplication record, and the events it emits commit in one transaction as outbox rows; a polling relay publishes them and marks them sent only **after** the broker confirms.
- **Reason**: Publishing inside a use case makes the commit and the publication two separate failures: a crash between them either loses an event that the state says happened, or announces one that was rolled back. Recording the intent in the same transaction removes the window. Marking rows sent before the confirm would reintroduce the loss the slice exists to remove, so the order is fixed.
- **Trade-off**: Delivery becomes at-least-once - a crash between confirm and mark republishes a row - and an event is delayed by up to one poll interval. Every consumer already deduplicates by `eventId`, so a repeat is absorbed; losing an event is the worse failure, and the delay is bounded and observable through the relay's pending count and oldest-pending age.
- **Scope**: `processing-catalog` application and messaging layers.
- **Date**: 2026-09-20
- **Status**: active

### AD-011
- **Decision**: RabbitMQ topology that more than one service declares is configured by broker policy in `fiap-x-platform`, not by queue arguments in a service. Services may declare queues and bindings; they may not set arguments that change a shared queue's behaviour.
- **Reason**: Five queues are declared by both `processing-catalog` and `processing-worker`. RabbitMQ rejects a second declaration whose arguments differ from the first, and the rejection closes the declaring channel. Adding `x-dead-letter-exchange` on one side did exactly that: the Worker's channel closed with `PRECONDITION_FAILED`, `VideoAccepted` was never published, and every request stalled at `RECEIVED` while both services reported healthy. A policy is applied by the broker to queues that match a pattern, so no declarer can contradict another.
- **Trade-off**: Dead-lettering is no longer visible in the code of the service that depends on it, and the policy must be applied wherever the broker runs - it now travels with the platform's definitions file rather than with a service image. In exchange, a topology change can no longer take a healthy-looking service silently off the bus.
- **Scope**: `fiap-x-platform` broker definitions; queue declaration in all services.
- **Date**: 2026-09-20
- **Status**: active

### AD-012
- **Decision**: The broker's definitions own every queue that carries traffic and its `<queue>.dlq`, declared before any service connects, with the `/` vhost defaulting to **quorum** queues. The `dead-letter` policy matches the queues by the names the services actually use (`video-validation`, `processing`, `notification.terminal` and the five lifecycle queues) and sets `delivery-limit: 5`. Services classify their own failures: a message that is wrong (a domain rule it breaks, a body that is not JSON) is rejected without requeue and dead-lettered; anything else is requeued after a pause.
- **Reason**: The S1–S3 verification found the policy matched event names no queue uses, so every rejection on a real queue was discarded, and that a publish to a queue its consumer had not yet declared was confirmed and dropped. A quorum queue's delivery limit is the only broker-side bound on a message that kills its consumer. Tested on RabbitMQ 4: a plain `durable: true` redeclaration of a quorum queue is accepted, `nack` without requeue reaches the DLQ, and a crash loop is dead-lettered at the limit — but **an explicit requeue does not count toward the limit**, which is why the services must classify and pause rather than rely on it.
- **Trade-off**: A transient failure is retried indefinitely, one attempt per pause, so a bug misclassified as transient loops slowly instead of reaching the DLQ; the log names the event on every retry. Quorum queues cost more disk and memory than classic ones, irrelevant at this volume. The topology is rebuilt from the file on every broker start, so a queue created by hand does not survive a restart.
- **Scope**: `fiap-x-platform` broker definitions; consumer error handling in all services (`processing-catalog` implements it; the Worker and Notification still requeue without a pause).
- **Date**: 2026-09-24
- **Status**: active

### AD-013
- **Decision**: In `processing-catalog`, a lifecycle event is applied under a row lock (`SELECT … FOR UPDATE` inside the unit of work), and the state machine tolerates the order in which `ProcessingStarted` and `ProcessingCompleted` arrive: completion is accepted from `QUEUED`, a start that finds the request already `PROCESSING` or terminal changes nothing, and a completion that restates the stored archive key changes nothing and publishes nothing. Each of these no-ops still records the event as processed.
- **Reason**: The two events travel on different queues, so the Catalog can handle them in either order or at once. With the old strict machine a completion handled first was dead-lettered and the request stayed in `PROCESSING` forever; with the old read-outside-the-transaction pattern, a start committing after a completion moved a finished request back to `PROCESSING` with its terminal event already recorded. The race test fails 3 of 3 runs without the lock and passes with it.
- **Trade-off**: `PROCESSING` can be skipped when the completion wins the race, so the state is no longer proof that a start was observed — the Worker still publishes it first, and a completion is taken as proof that processing began. This supersedes the S2 rule that a completion from `QUEUED` means a lost `ProcessingStarted`. Two events for the same request now serialize on the lock, which costs nothing at one row per request.
- **Scope**: `processing-catalog` domain and application layers.
- **Date**: 2026-09-24
- **Status**: active

### AD-014
- **Decision**: Local object storage is RustFS (`rustfs/rustfs:1.0.0`) in a vendor-neutral `storage` service, and every script in this repository that touches storage (bootstrap, seed, smoke) uses `amazon/aws-cli` through a `storage-init` service. MinIO and `mc` are removed. Privacy is asserted as "no bucket policy" plus the smoke's anonymous-GET-is-403 check; retention as exactly two 7-day prefix rules read back through JMESPath.
- **Reason**: On 2026-09-26 MinIO's public images stopped being pullable anonymously from every registry (`quay.io/minio/*` 401, Docker Hub `minio/minio` 404, Bitnami's mirror gone), checked against a control image on each registry. The stack only started where the images were cached, and `processing-worker`'s CI failed at `docker run`. A spike showed RustFS covers every S4 guarantee through the S3 API: bucket create/head, two 7-day lifecycle rules read back verbatim, `NoSuchBucketPolicy` and anonymous 403 on a new bucket, 200 under a public policy and 403 again once it is deleted, head-object size and 404; multi-arch images and an HTTP `/health`.
- **Trade-off**: RustFS is younger than MinIO (1.0.0 released 2026-09-16), so behaviour outside what the smoke asserts is less proven. In exchange, no script depends on a storage vendor's CLI any more: replacing the server again is an image and credentials change, which is what AD-005 intended and what this incident showed was not yet true.
- **Scope**: `fiap-x-platform` topology and scripts; the object storage used by `processing-worker`'s CI.
- **Date**: 2026-09-26
- **Status**: active

### AD-015
- **Decision**: The owner's email address is resolved exactly once, at `fiap-x-api`, by reading the standard OIDC `email` claim already present on the verified access token — never by querying Keycloak's Admin API and never through a second contact registry. It is stored on `processing-catalog`'s `ProcessingRequest` and added only to the terminal event; `VideoValidationRequested`, `ProcessingQueued`, and `ProcessingStarted` never carry it, so the Worker's PII surface stays at zero.
- **Reason**: Keycloak's Admin REST API is vendor-specific, not a standard protocol — adopting it to resolve `sub` to an address would cost AD-005's portability argument more than reading a claim the token already carries, and would give `notification-service` a new runtime dependency (an admin credential, a new failure mode) for a service whose whole point is to stay decoupled. A service-local contact registry was rejected too: it duplicates a fact Keycloak already owns and still needs the same Admin API (or a manual seed) to populate.
- **Trade-off**: Touches `fiap-x-api` (`TokenVerifier`, the guard, upload confirmation) and `processing-catalog` (a new required column, one field added to one event) in addition to `notification-service`. In exchange, no service outside `fiap-x-api` ever queries an identity provider for anything beyond validating a token, and the Worker never sees an email address at all.
- **Scope**: `fiap-x-api` auth and upload confirmation; `processing-catalog` domain, persistence, and the terminal event contract; `notification-service`'s consumption of that contract; `fiap-x-platform`'s Mailpit service and smoke.
- **Merge order**: CI's `integration` job checks out `fiap-x-api`, `processing-catalog`, `notification-service`, and `processing-worker` at their own `main`. This repo's branch for this feature must merge to `main` LAST among the four: merging it first turns `main` red twice over — `scripts/generate-db-script.mjs --check` fails (the regenerated `db/create-database.sql` reflects migrations absent from the other three repos' `main`), and the two Mailpit smoke steps find no email (the sending code isn't on `notification-service`'s `main` yet).
- **Date**: 2026-09-27
- **Status**: active

### AD-016
- **Decision**: One correlation id follows a video from its upload to its email. `fiap-x-api` assigns it at the edge: the caller's `X-Correlation-Id` when it is 1 to 128 printable ASCII characters after trimming, a fresh UUID otherwise, echoed on the response. The API passes it to `processing-catalog` on creation (header and body field); the Catalog validates it (an invalid one answers 400, like `ownerEmail`) and stores it in a nullable `correlation_id varchar(128)` column on `processing_request`. Every event gains an optional `correlationId` field: the Catalog sets it from the stored value, the Worker copies the id it consumed onto each outcome it publishes, and Notification reads it. The field is omitted when there is no id, never sent as `null`. A consumer parses it strictly — only a string that passes the same rule is kept, anything else, a number or an object included, is replaced by a fresh UUID for that message's logs and never coerced — and an absent or invalid id never fails, requeues or dead-letters a message.
- **Reason**: S8 needs one id to follow a request across four services and the outbox delay between them. An id held only in memory would stop at the API boundary; storing it with the request lets the Catalog put it on events it publishes minutes later or after a restart. Optional everywhere keeps the rows created before the column and the outbox rows written before the field flowing, the same convention as the optional fields of AD-015.
- **Trade-off**: One more column, one more field on every contract, and the same parse rule copied into each of the four repositories (there is no shared package). A message that arrived without an id starts a new chain in the Worker and in Notification, so its logs cannot be joined to the upload that caused it; only requests created after this change are traceable end to end. The API trusts a caller-supplied id, so two callers can reuse one id: it is a search key for logs, never an identity or an authorization input.
- **Scope**: `fiap-x-api` edge middleware and Catalog client; `processing-catalog` creation contract, persistence (migration `AddCorrelationId`) and every published event; `processing-worker` consumers and outcome events; `notification-service` terminal-event consumer; `fiap-x-platform`'s regenerated `db/create-database.sql`.
- **Merge order**: as for AD-015, this repository's `feat/observability` merges to `main` last among the five: its regenerated `db/create-database.sql` holds the Catalog's `AddCorrelationId` migration, so `scripts/generate-db-script.mjs --check` in CI's `integration` job fails until that migration is on `processing-catalog`'s `main`.
- **Date**: 2026-09-28
- **Status**: active

### AD-017
- **Decision**: Every service observes itself the same way. **Logs**: nestjs-pino, one JSON object per line carrying `service`, `timestamp` and, inside a request or a message, `correlationId` (read from one AsyncLocalStorage context by the root `mixin`, so it is on every line, not only on request lines). Authorization and cookie headers, email addresses (`email`, `ownerEmail`, and Notification's recipient fields) and storage keys are removed by the logger's `redact` paths, at the root and nested, so no call site has to remember them. **Metrics**: prom-client on a registry of the app's own, never the global one; every metric is named `fiapx_*`; labels take bounded values only (an outcome, a queue, a method, a status, a route template or `unmatched`), never a raw path, a user, an email address or a request or correlation id. **Endpoints**: `/metrics`, `/health` (readiness: 503 naming the dependency that is down, in every service that has one to reach; the API has none and answers 200 while it serves) and `/health/live` (liveness: 200 while the process serves), all unauthenticated and none of them written to the access log. **Platform**: RabbitMQ's metrics come from its built-in `rabbitmq_prometheus` plugin with per-queue series; Prometheus finds the Worker by a DNS lookup so every `WORKER_REPLICAS` replica is scraped; the datasource, the dashboard and the scrape configuration are versioned files mounted read-only, with nothing set up by hand in a UI; no business service depends on Prometheus or Grafana; load evidence comes from the versioned `scripts/load-test.mjs`.
- **Reason**: The four services are separate repositories with no shared code, so the conventions live here or drift. The same field names let one query read all four services' logs; a dedicated registry keeps e2e suites from leaking counters into each other; bounded labels keep Prometheus's series count flat however many users and requests there are, and keep personal data out of a store that has no retention or access control of its own. Readiness that fails with HTTP status (not a body flag) is what compose's `--wait` and a Kubernetes probe can act on, while liveness stays green through a broker outage so the container is not restarted for something a restart cannot fix. A plugin and a DNS lookup add no image and follow replicas without configuration; files instead of UI state mean a recreated Grafana comes back identical.
- **Trade-off**: Redaction is by key name, so a value logged under a new key is not caught; each service tests its redaction through its own logger configuration. Unauthenticated `/metrics` is acceptable only because the metrics carry no personal data and the stack is local; a deployed environment must keep the port off the public network. Per-queue broker metrics multiply the broker's series by the number of queues, which is small here. The platform PR depends on the four service PRs, so it merges last (AD-016).
- **Scope**: logging, metrics and health in `fiap-x-api`, `processing-catalog`, `processing-worker` and `notification-service`; `fiap-x-platform`'s `prometheus/`, `grafana/`, `rabbitmq/` plugin configuration, compose services and `scripts/check-observability.mjs` and `scripts/load-test.mjs`.
- **Date**: 2026-09-28
- **Status**: active

## Handoff

- **Feature**: S8 observability (`.specs/features/observability/`)
- **Phase / Task**: Validate, round 2 of 3 - Verifier round 1 FAILED; its fixes F1-F6 are committed (`tasks.md`, Post-verification fixes)
- **Completed**: T1-T12, F1-F6 (T11's CI proof and the PR description wait on the merge order)
- **In-progress** (file:line): none
- **Next step**: Run the Verifier's round 2 on `feat/observability`: re-run the sensor (M7c, M7d, M12, M9 and the rest) and the gate, then record the verdict in `validation.md`.
- **Blockers**: CI's `integration` job stays red on `generate-db-script --check` until the four service PRs merge; this PR merges last (AD-016). Per-message consumer logging (the full correlation trace) is a follow-up in the service repositories.
- **Uncommitted files**: `.specs/features/observability/validation.md`, `.specs/LESSONS.md`, `.specs/lessons.json` (the Verifier's)
- **Branch**: `feat/observability` in `fiap-x-platform` and in the four service repositories
