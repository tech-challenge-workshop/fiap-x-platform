# Platform Durable Persistence Specification

## Problem Statement

The local topology has no database. The Catalog and the Notification Service are each about to need one, and the challenge asks for a database creation script as a deliverable — which, by AD-007, belongs to this repository rather than to any single service.

A script maintained by hand beside migrations drifts from them. Whatever ships must be produced from the migrations that actually run.

## Goals

- [ ] Give the local topology a PostgreSQL service the two owning services can reach.
- [ ] Ship a creation script generated from the migrations, not written beside them.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| The schemas themselves and their migrations | Each service owns its own tables; this repository owns the topology and the deliverable. |
| Managed database hosting | AD-005 fixes PostgreSQL in a container. |
| Backups, replication and tuning | Not asked for, and not demonstrable in the delivery. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| One PostgreSQL service, one schema per owning service | A single container | The foundation forbids shared tables, not a shared server. Two containers would double the local footprint to enforce a boundary a schema already enforces. | y |
| Where the creation script is generated | Here, from each service's migrations | AD-007 assigns the deliverable to this repository, and generating it keeps it from drifting. | y |
| Readiness | Compose waits on the database health check before starting the services that need it | Those services already declare `depends_on` with a condition; a database is no different. | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: A database in the local topology ⭐ MVP

**User Story**: As a developer, I want `docker compose up` to give me a working database, so that the services that need one start without any manual step.

**Why P1**: Nothing in S3 can be run locally without it.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN the topology starts THEN it SHALL include a PostgreSQL service with a health check. <!-- event-driven -->
2. WHILE the database is not healthy, the services that depend on it SHALL NOT be started. <!-- state-driven -->
3. WHEN the topology starts THEN each owning service SHALL reach its own schema and SHALL NOT be granted the other's. <!-- event-driven -->
4. WHEN the stack is torn down with its volumes THEN the database SHALL start empty on the next run. <!-- event-driven -->

**Independent Test**: Start the topology, confirm both services become healthy, tear it down with volumes and start again.

---

### P2: The creation script as a deliverable

**User Story**: As an evaluator, I want one script that creates the whole database, because the challenge lists it among the deliverables.

**Why P2**: The stack runs without it; the submission does not.

**Acceptance Criteria**:

1. WHEN the script is produced THEN it SHALL be generated from the services' migrations. <!-- event-driven -->
2. WHEN the script is applied to an empty database THEN it SHALL create every schema and table the system needs. <!-- event-driven -->
3. IF a migration changes THEN regenerating SHALL produce a different script, so a stale one is visible in review. <!-- unwanted-behavior -->

---

## Edge Cases

- IF the database volume survives from an earlier run with an older schema THEN starting the stack SHALL apply the pending migrations rather than failing.
- WHEN the smoke test runs THEN it SHALL still pass, since the flow it drives is unchanged by where the state is kept.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| DP-01 | P1: Database in the topology | Design | Pending |
| DP-02 | P1: Database in the topology | Design | Pending |
| DP-03 | P1: Database in the topology | Design | Pending |
| DP-04 | P1: Database in the topology | Design | Pending |
| DP-05 | P2: Creation script | - | Pending |
| DP-06 | P2: Creation script | - | Pending |
| DP-07 | P2: Creation script | - | Pending |

**ID format:** `DP-[NUMBER]`

**Coverage:** 7 total, 0 mapped to tasks, 7 unmapped (mapping happens in Tasks).

---

## Success Criteria

- [ ] `docker compose up` brings up a database and both owning services reach it.
- [ ] The smoke test still passes with state kept in PostgreSQL.
- [ ] The generated script creates the whole database from empty.
