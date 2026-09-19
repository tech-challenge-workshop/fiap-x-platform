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
- **Status**: active

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

## Handoff

- **Feature**: Platform repository extraction (AD-007)
- **Phase / Task**: Complete - documents, compose, and smoke script relocated to `fiap-x-platform`
- **In-progress** (file:line): none
- **Next step**: Open the S1 (CI) and S2 (full lifecycle) specifications. Attach remote URLs and push only with explicit user authorization.
- **Blockers**: `docs/FIAP X.pdf` (modelling board) is being redrawn to match AD-005 and is absent from `docs/`.
- **Uncommitted files**: none
- **Branch**: `main` in `fiap-x-platform`; `docs/local-first-platform` in the four service repositories
