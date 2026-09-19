# First Service Specifications

## Problem Statement

FIAP X now has four independently deployed NestJS services, but their first implementation increments must be planned as one thin vertical slice. Without a root specification, the individual repository specifications could duplicate responsibilities or leave the asynchronous flow disconnected.

## Goals

- [ ] Define the first repository-level specification for each of the four FIAP X services.
- [ ] Make the first implementation slice traceable from request creation through terminal notification.
- [ ] Keep the MVP limited to documented JSON messages, local DTOs, and AWS integration from the first slice.

## Out of Scope

| Feature | Reason |
| --- | --- |
| A contracts repository or shared npm package | The MVP uses documented, stable JSON payloads and local DTOs. |
| Event-schema registry or event versioning mechanism | The MVP has one stable message shape for each event. |
| Full upload, FFprobe/FFmpeg, S3 ZIP, Cognito, SES, Terraform, or EKS implementation | These belong to subsequent vertical slices. |
| New runtime services | The approved C4 architecture remains API, Catalog, Worker, and Notification Service. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- |
| Integration approach | One thin vertical slice across the four repositories | It exposes integration failures earlier than completing one service at a time. | Yes |
| Message format | Stable JSON documented in `docs/foudation.md`; each repository owns local DTOs | This is sufficient for one MVP implementation without a shared contracts package. | Yes |
| Runtime environment | AWS is used from the first integrated slice | This follows the stated project direction. | Yes |
| First Worker behavior | Controlled validation/processing outcome, not FFprobe or FFmpeg | It proves the messaging and state path before CPU-bound media work. | Yes |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: First Catalog specification

**User Story**: As a FIAP X developer, I want the Catalog's first specification to define request creation, the initial state, and the first published JSON message so that the lifecycle has one durable owner.

**Why P1**: The Catalog owns the Processing Request state machine and starts the asynchronous workflow.

**Acceptance Criteria**:

1. WHEN the Catalog first specification is created THEN it SHALL define creation of a `ProcessingRequest` in `RECEIVED` state.
2. WHEN the Catalog first specification is created THEN it SHALL define the documented JSON fields of `VideoValidationRequested` as `eventId`, `processingRequestId`, `ownerUserId`, `sourceStorageKey`, and `occurredAt`.
3. IF a repeated `eventId` is received by the Catalog THEN its first specification SHALL require no additional state transition or external effect.

**Independent Test**: Review the Catalog spec and verify its requirements cover creation, message publication, and duplicate handling.

### P1: First API specification

**User Story**: As a FIAP X developer, I want the API's first specification to define one internal request-creation boundary so that the Catalog can receive an owner-scoped request without implementing real upload yet.

**Why P1**: The API is the HTTP edge but must not own lifecycle transitions.

**Acceptance Criteria**:

1. WHEN the API first specification is created THEN it SHALL define an authenticated owner identifier as the input required to create a request.
2. WHEN the API first specification is created THEN it SHALL require the API to delegate request creation to the Catalog without changing Processing Request status itself.
3. IF the Catalog rejects request creation THEN the API first specification SHALL require no processing message to be published by the API.

**Independent Test**: Review the API spec and verify it keeps lifecycle ownership in the Catalog.

### P1: First Worker specification

**User Story**: As a FIAP X developer, I want the Worker's first specification to consume the validation request and publish one controlled outcome so that the end-to-end asynchronous path is testable before media tooling is added.

**Why P1**: It validates RabbitMQ delivery and the Catalog's transition path with minimal infrastructure.

**Acceptance Criteria**:

1. WHEN the Worker receives a valid `VideoValidationRequested` JSON message THEN its first specification SHALL require publication of `VideoAccepted` with the same `processingRequestId`.
2. IF the Worker receives a message missing `processingRequestId` THEN its first specification SHALL require rejection without publishing `VideoAccepted`.
3. The Worker first specification SHALL state that FFprobe, FFmpeg, S3 reads, and ZIP creation are excluded from this slice.

**Independent Test**: Review the Worker spec and verify success, invalid-message, and explicit media-processing exclusion are defined.

### P1: First Notification specification

**User Story**: As a FIAP X developer, I want the Notification Service's first specification to consume a terminal event and record one controlled delivery so that the final step of the slice is observable before SES is integrated.

**Why P1**: The service owns notification delivery but cannot change processing state.

**Acceptance Criteria**:

1. WHEN the Notification Service receives a terminal `COMPLETED` or `FAILED` event THEN its first specification SHALL require one local delivery record for its `eventId`.
2. IF the Notification Service receives the same terminal `eventId` again THEN its first specification SHALL require no second delivery record.
3. The Notification Service first specification SHALL state that Amazon SES delivery is excluded from this slice.

**Independent Test**: Review the Notification spec and verify terminal-event handling, deduplication, and SES exclusion are defined.

## Edge Cases

- IF a repository-level specification names a responsibility owned by another service THEN it SHALL be corrected before implementation begins.
- IF a JSON event field differs from `docs/foudation.md` THEN the repository-level specification SHALL use the documented field name or explicitly update the root documentation first.
- IF the first vertical slice cannot reach a terminal event with controlled Worker behavior THEN no repository-level specification SHALL claim the slice is ready for media processing.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| FSS-01 | P1: First Catalog specification | Specify | Specified |
| FSS-02 | P1: First API specification | Specify | Specified |
| FSS-03 | P1: First Worker specification | Specify | Specified |
| FSS-04 | P1: First Notification specification | Specify | Specified |
| FSS-05 | Edge cases | Specify | Specified |

**Coverage:** 5 total, 5 mapped to future repository specifications, 0 unmapped.

## Success Criteria

- [x] Each repository has a first `.specs/features/initial-vertical-slice/spec.md` derived from this root specification.
- [x] The four repository specifications preserve their approved service boundaries.
- [ ] The first implementation slice has one controlled path from API request creation to a recorded terminal notification.
