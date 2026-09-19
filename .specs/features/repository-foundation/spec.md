# FIAP X Repository Foundation Specification

## Problem Statement

FIAP X has an approved service architecture but no independently versioned service repositories. The team needs four local Git repositories with an intentional, documented initial state so each can be connected to its own remote and pushed without reorganizing the project later.

## Goals

- [ ] Create one local Git repository for each approved deployable service.
- [ ] Make each repository self-describing, ready for its first remote push, and free of application implementation that belongs to a later feature.

## Out of Scope

| Feature | Reason |
| --- | --- |
| NestJS application scaffolding | Service implementation is a separate feature. |
| AWS, Kubernetes, Terraform, or CI/CD configuration | The request is limited to repository foundations. |
| RabbitMQ, S3, Cognito, SES, or PostgreSQL integration | Those integrations require service code and environment decisions. |
| Creating GitHub repositories or pushing commits | Remote actions require an explicit go-ahead and repository URLs. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Repository names | `fiap-x-api`, `processing-catalog`, `processing-worker`, and `notification-service` | Names directly reflect the four approved deployable units and are suitable Git remote slugs. | Yes, derived from `docs/foudation.md` |
| Initial branch | `main` | It is the conventional default for a newly created remote repository. | Yes, implementation default |
| Initial content | README, Node-oriented `.gitignore`, and a service-boundary document | These files make an empty repository understandable and prevent common local artifacts from entering the first push. | Yes, implementation default |
| Application code and package manifests | Absent | Adding a framework scaffold would pre-decide runtime dependencies outside this repository-foundation scope. | Yes, scope boundary |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Independent service repositories

**User Story**: As a FIAP X team member, I want one Git repository for each deployable service so that each service can be versioned and published independently.

**Why P1**: The hackathon requires versioned source code, and the approved architecture defines four deployment units.

**Acceptance Criteria**:

1. WHEN the repository foundation is created THEN the workspace SHALL contain exactly the directories `fiap-x-api`, `processing-catalog`, `processing-worker`, and `notification-service` as Git repositories with `main` as their current branch.
2. WHEN the initial state of any service repository is inspected THEN the repository SHALL contain one initial commit with a Conventional Commit message beginning with `chore(`.
3. IF a repository foundation is connected to a remote after this work THEN the repository SHALL be pushable without requiring an additional local commit.

**Independent Test**: Run Git branch, log, and working-tree checks in every service directory.

### P1: Service boundary clarity

**User Story**: As a contributor, I want each repository to explain its ownership and exclusions so that future implementation respects the approved microservice boundaries.

**Why P1**: The architecture depends on strict ownership of HTTP, lifecycle state, media processing, and notifications.

**Acceptance Criteria**:

1. WHEN a contributor opens any repository README THEN the repository SHALL identify its service responsibility and link to its local service-boundary document.
2. WHEN a contributor reads a service-boundary document THEN the document SHALL state the owning service, its responsibilities, primary technology context, integrations, and explicit exclusions from the approved foundation.
3. The repository foundation SHALL include a `.gitignore` that excludes Node dependency folders, build output, coverage output, local environment files, and operating-system metadata.

**Independent Test**: Inspect each README, boundary document, and `.gitignore` for the required material.

### P1: Architecture-aligned repository mapping

**User Story**: As an architect, I want the four repositories mapped to the approved FIAP X design so that no service boundary is lost during setup.

**Why P1**: The submitted foundation separates HTTP access, request lifecycle, CPU-bound processing, and email delivery.

**Acceptance Criteria**:

1. WHEN the repository set is documented THEN the documentation SHALL map `fiap-x-api` to HTTP edge and owner authorization, `processing-catalog` to request lifecycle and transactional outbox, `processing-worker` to FFprobe/FFmpeg and S3 media work, and `notification-service` to terminal-event email delivery.
2. WHEN the repositories are initialized THEN the documentation SHALL state that services communicate through versioned RabbitMQ contracts and do not share database tables.
3. IF a future contributor needs implementation details beyond a repository foundation THEN the documentation SHALL direct them to `docs/foudation.md` and the two source PDFs rather than presenting initial files as a complete product implementation.

**Independent Test**: Compare the repository documentation against the approved foundation mapping.

## Edge Cases

- IF a directory with a target repository name already exists THEN the foundation process SHALL stop before overwriting or initializing that directory.
- IF Git author identity is unavailable locally THEN the foundation process SHALL stop before creating commits and report the missing configuration.
- IF a Git command fails for one repository THEN the foundation process SHALL leave the remaining repositories uninitialized and report the failing repository.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| REPO-01 | P1: Independent service repositories | Validate | Verified |
| REPO-02 | P1: Service boundary clarity | Validate | Verified |
| REPO-03 | P1: Architecture-aligned repository mapping | Validate | Verified |
| REPO-04 | Edge case: protect existing directories | Validate | Verified |
| REPO-05 | Edge case: require Git identity | Validate | Verified |

**Coverage:** 5 total, 5 mapped to tasks, 0 unmapped.

## Success Criteria

- [x] Four clean local Git repositories exist and each has one initial commit on `main`.
- [x] Each repository states its responsibility, integrations, and exclusions.
- [x] No remote has been created or pushed.
