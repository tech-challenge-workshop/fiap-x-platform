# Local Docker Integration Service-Specification Specification

## Problem Statement

The root workspace coordinates the four independent repositories; it is not a fifth runtime repository. The previous plan incorrectly placed implementation design and tasks in the root. The next planning step must instead create one implementation specification inside each service repository, with clear ownership for the local Docker environment and a single end-to-end flow.

## Goals

- [ ] Create one approved local-integration specification in each of the four service repositories.
- [ ] Give each service a bounded responsibility for running the system locally in Docker and proving one e2e flow.
- [ ] Carry forward the minor verification improvements from the first vertical slice into the owning service specification.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Runtime source code, Dockerfiles, Compose files, RabbitMQ configuration, or test scripts in the root workspace | The root coordinates agents and specifications only. Implementation belongs to a service repository. |
| A fifth infrastructure/contracts repository | The approved solution has four runtime repositories only. |
| AWS, Terraform, RDS, S3, Cognito, SES, FFprobe, FFmpeg, or ZIP extraction | The immediate target is reproducible local integration. |
| A shared contracts package, schema registry, or message versioning mechanism | This MVP keeps documented JSON and local DTOs in each service. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- |
| Home for local integration assets | `fiap-x-api` owns `compose.yaml`, the local smoke script, and developer instructions. | It is the HTTP entrypoint and supplies the command a developer starts with; the root remains orchestration-only. | y |
| Spec feature name | Every repository uses `.specs/features/local-docker-integration/`. | A common feature name makes cross-repo discovery and agent orchestration deterministic without sharing code. | y |
| Local completion behavior | Worker simulates `ProcessingCompleted` with a deterministic local ZIP key after validation succeeds. | It exercises the complete transport/lifecycle path without pretending S3 or media processing exists. | y |
| Observability | Catalog and Notification expose read-only endpoints only when `LOCAL_INTEGRATION=true`. | The e2e smoke test needs deterministic cross-container evidence without adding production endpoints. | y |

**Open questions:** none. All coordination defaults are approved.

---

## User Stories

### P1: Delegate an integrated local flow to the four services ⭐ MVP

**User Story**: As the project maintainer, I want each service to have its own local-integration specification so that agents can implement the Docker e2e path without treating the root folder as another application.

**Why P1**: Correct repository ownership is required before implementation can be safely delegated.

**Acceptance Criteria**:

1. WHEN the root coordination feature is approved, THEN the system SHALL create `fiap-x-api/.specs/features/local-docker-integration/spec.md` assigning API the HTTP entrypoint, HTTP Catalog adapter, Compose developer entrypoint, and root-level smoke command within that repository. <!-- event-driven -->
2. WHEN the root coordination feature is approved, THEN the system SHALL create `processing-catalog/.specs/features/local-docker-integration/spec.md` assigning Catalog request ownership, `RECEIVED → QUEUED → COMPLETED` transitions, local RabbitMQ event publication/consumption, and local request-state observation. <!-- event-driven -->
3. WHEN the root coordination feature is approved, THEN the system SHALL create `processing-worker/.specs/features/local-docker-integration/spec.md` assigning Worker validation consumption, `VideoAccepted`, simulated `ProcessingCompleted`, manual acknowledgement, and duplicate/publish-failure behavior. <!-- event-driven -->
4. WHEN the root coordination feature is approved, THEN the system SHALL create `notification-service/.specs/features/local-docker-integration/spec.md` assigning terminal-event consumption, typed invalid-event classification, idempotent delivery recording, and local delivery observation. <!-- event-driven -->
5. The root coordination feature SHALL not create runtime implementation artifacts outside the four service repositories. <!-- ubiquitous -->

**Independent Test**: Confirm the four local specs exist, each names only its service-owned responsibilities, and the root contains only coordination artifacts.

### P1: Define one cross-repository Docker e2e contract

**User Story**: As a developer, I want the four local specs to describe one compatible flow so that Docker can prove the system works together.

**Why P1**: Independently correct service plans are insufficient if their messages, ownership, or terminal state disagree.

**Acceptance Criteria**:

1. WHEN a valid request reaches API, THEN the four service specifications SHALL agree that API calls Catalog through HTTP and returns `201 Created` with the Catalog-generated request ID and `RECEIVED` status. <!-- event-driven -->
2. WHEN Catalog creates the request, THEN the four service specifications SHALL agree on a `VideoValidationRequested` JSON payload containing `eventId`, `processingRequestId`, `ownerUserId`, `sourceStorageKey`, and `occurredAt`. <!-- event-driven -->
3. WHEN Worker accepts validation, THEN the four service specifications SHALL agree that `VideoAccepted` has a new UUID v4 event ID and the same request ID; Catalog transitions to `QUEUED` and emits `ProcessingQueued`. <!-- event-driven -->
4. WHEN Worker receives `ProcessingQueued`, THEN the four service specifications SHALL agree that it emits `ProcessingCompleted`; Catalog transitions to `COMPLETED` and emits a terminal event; Notification records exactly one `COMPLETED` delivery. <!-- event-driven -->
5. WHEN the local environment is started, THEN the four service specifications SHALL agree on Docker Compose, RabbitMQ, distinct service ports, health/readiness checks, and a smoke test that posts through API then verifies Catalog and Notification observations. <!-- event-driven -->
6. IF a message is duplicate, malformed, requests an unsupported transition, or cannot publish its follow-up event, THEN the owning service specification SHALL define no-success-side-effect behavior and the e2e test responsibility. <!-- unwanted-behavior -->

**Independent Test**: Compare the four specs field-by-field, then run the eventual Compose smoke test: API POST → Catalog `COMPLETED` → one Notification delivery record.

### P2: Carry forward first-slice quality improvements

**User Story**: As a maintainer, I want verifier findings assigned to the right service specification so that integration does not preserve known weak assertions or warning-prone code.

**Why P2**: These small improvements are directly adjacent to the local integration behavior.

**Acceptance Criteria**:

1. WHEN the API local spec is created, THEN it SHALL require concrete e2e adapter typing plus numeric assertions for Catalog `502` and unexpected `500` mappings. <!-- event-driven -->
2. WHEN the Catalog local spec is created, THEN it SHALL require zero lint warnings and direct coverage that an unsupported transition retains the previous state. <!-- event-driven -->
3. WHEN the Worker local spec is created, THEN it SHALL require UUID v4 assertions and e2e coverage for publisher failure without successful acknowledgement. <!-- event-driven -->
4. WHEN the Notification local spec is created, THEN it SHALL require typed domain errors that distinguish invalid terminal input from technical failure. <!-- event-driven -->
5. The four local specifications SHALL preserve the existing AppleDouble (`._*`) exclusions from lint and Jest without changing runtime behavior. <!-- ubiquitous -->
6. WHEN a local-integration task is completed, THEN its owning repository SHALL commit its implementation, tests, and status update together in one Conventional Commit. <!-- event-driven -->

**Independent Test**: Validate each service task plan against its first-slice verifier report and run all service quality gates with zero lint warnings.

## Edge Cases

- IF RabbitMQ is unavailable, THEN the owning local spec SHALL require dependent services to report unready and the smoke test to fail rather than pass by timeout.
- IF a local observation route is used without `LOCAL_INTEGRATION=true`, THEN its owning specification SHALL require the route not to be exposed.
- WHEN Compose restarts, THEN the e2e flow SHALL create a new request and shall not rely on previous in-memory state.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ORC-01 | P1: Delegate flow | Service Specs | Pending |
| ORC-02 | P1: Delegate flow | Service Specs | Pending |
| ORC-03 | P1: Delegate flow | Service Specs | Pending |
| ORC-04 | P1: Delegate flow | Service Specs | Pending |
| ORC-05 | P1: Delegate flow | Service Specs | Pending |
| ORC-06 | P1: Cross-repository contract | Service Specs | Pending |
| ORC-07 | P1: Cross-repository contract | Service Specs | Pending |
| ORC-08 | P1: Cross-repository contract | Service Specs | Pending |
| ORC-09 | P1: Cross-repository contract | Service Specs | Pending |
| ORC-10 | P1: Cross-repository contract | Service Specs | Pending |
| ORC-11 | P1: Cross-repository contract | Service Specs | Pending |
| ORC-12 | P2: Quality improvements | Service Specs | Pending |
| ORC-13 | P2: Quality improvements | Service Specs | Pending |
| ORC-14 | P2: Quality improvements | Service Specs | Pending |
| ORC-15 | P2: Quality improvements | Service Specs | Pending |
| ORC-16 | P2: Quality improvements | Service Specs | Pending |
| ORC-17 | P2: Quality improvements | Service Specs | Pending |

**Coverage:** 17 total, 0 mapped to service tasks pending local specifications.

## Success Criteria

- [ ] Four service-local specs pass `validate_spec.py` and jointly cover ORC-01 through ORC-17.
- [ ] The four specs agree on the HTTP, JSON-event, state-transition, Docker readiness, and smoke-test contracts.
- [ ] No runtime artifact is planned for or added to the root workspace.
