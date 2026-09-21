# Durable Persistence Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/durable-persistence/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: none in this repository - it has no `package.json`, no test runner and no source. The `ci-pipeline` matrix for this repository applies, extended for the generator script.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Compose topology | integration | The stack starts, both owning services reach their own schema, and the smoke test still passes | `compose.yaml` | `docker compose up --build -d --wait` then `node scripts/smoke-local-integration.mjs` |
| Bootstrap SQL | integration | Schemas and roles exist; each role is denied the other's schema | `db/init/*.sql` | exercised by the topology run |
| Generator script | none | Syntax-checked only; its output is verified by applying it to an empty database | `scripts/*.mjs` | `node --check scripts/generate-db-script.mjs` |
| Generated script | integration | Applied to an empty database, it creates every schema and table | `db/create-database.sql` | exercised by the topology run |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After editing compose or a script | `docker compose config -q && node --check scripts/generate-db-script.mjs` |
| Full | After a topology change | Quick, then `docker compose up --build -d --wait` and `docker compose down -v` |
| Build | After phase completion | Full, then `node scripts/smoke-local-integration.mjs` against the running stack |

**Note**: the full and build gates start the real stack, so the four service repositories must be checked out as siblings.

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: A database in the topology

```
T1 → T2 → T3
```

### Phase 2: The deliverable

```
T4 → T5
```

---

## Task Breakdown

### T1: Add the PostgreSQL service

**What**: Add a PostgreSQL service with a health check and a named volume, and make the two owning services wait for it.
**Where**: `compose.yaml`
**Depends on**: None
**Reuses**: The health-check and `depends_on: condition: service_healthy` conventions already in the file
**Requirement**: DP-01, DP-02, DP-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The service declares a health check using `pg_isready`
- [ ] The Catalog and the Notification Service declare `depends_on` with the healthy condition
- [ ] Data lives in a named volume, so `down -v` starts the next run empty
- [ ] No credential is hardcoded outside the compose environment block
- [ ] Quick gate passes: `docker compose config -q`

**Tests**: none
**Gate**: quick

---

### T2: Bootstrap a schema and a role per owning service

**What**: Add the initialisation SQL creating two schemas and two least-privilege roles, and mount it into the image's entry-point directory.
**Where**: `db/init/01-schemas.sql`
**Depends on**: T1
**Reuses**: The PostgreSQL image's initialisation convention
**Requirement**: DP-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Each owning service has its own schema and its own role
- [ ] Each role is granted its own schema and **denied** the other's, asserted by a query that must fail
- [ ] The file states that it runs only on an empty data volume
- [ ] Full gate passes

**Tests**: integration
**Gate**: full

---

### T3: Document the empty-volume condition

**What**: State in the README that the bootstrap runs only on a fresh volume, and give the one-line recovery.
**Where**: `README.md`
**Depends on**: T2
**Reuses**: The existing Running locally section
**Requirement**: DP-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The README names the symptom a developer with a stale volume will see
- [ ] It gives `docker compose down -v` as the fix
- [ ] Build gate passes: the stack starts and the smoke test still succeeds

**Tests**: integration
**Gate**: build

---

### T4: Generate the creation script from the migrations

**What**: Add the script that reads each service's migrations and writes the consolidated creation script.
**Where**: `scripts/generate-db-script.mjs`
**Depends on**: T3
**Reuses**: The sibling checkout layout the CI integration job already establishes
**Requirement**: DP-05, DP-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The script reads the migrations rather than any hand-written SQL
- [ ] A missing sibling repository fails the script naming the path, so a stale deliverable is never silently reproduced
- [ ] Changing a migration and regenerating produces a different file
- [ ] Quick gate passes

**Tests**: none
**Gate**: quick

---

### T5: Verify the deliverable creates the database

**What**: Apply the generated script to an empty database and confirm it produces the whole schema.
**Where**: `db/create-database.sql`
**Depends on**: T4
**Reuses**: The topology from T1
**Requirement**: DP-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Applied to an empty database, the script creates every schema and table the system needs
- [ ] The result matches what the migrations produce, compared table by table rather than by eye
- [ ] The smoke test passes against a stack whose database was created this way
- [ ] Build gate passes

**Tests**: integration
**Gate**: build

**Commit**: `feat(platform): add the database and its creation deliverable`

---

## Phase Execution Map

```
Phase 1 → Phase 2

Phase 1:  T1 ------→ T2 ------→ T3
Phase 2:  T4 ------→ T5

Phase boundaries (the last task of a phase gates the first task of the next):
          T3 ------→ T4
```

Total: 5 tasks. This packs into a single batch, below the ~7-task worker budget, so Execute runs inline with no sub-agents dispatched.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: PostgreSQL service | 1 file | ✅ Granular |
| T2: Schema and role bootstrap | 1 file | ✅ Granular |
| T3: README note | 1 file | ✅ Granular |
| T4: Generator script | 1 file | ✅ Granular |
| T5: Verify the deliverable | 1 artefact | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | no inbound arrow | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 (phase boundary) | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |

No task depends on a task in a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Compose topology | none (declaration only until it runs) | none | ✅ OK |
| T2 | Bootstrap SQL | integration | integration | ✅ OK |
| T3 | Documentation | integration (the gate runs the stack) | integration | ✅ OK |
| T4 | Generator script | none | none | ✅ OK |
| T5 | Generated script | integration | integration | ✅ OK |

T1 and T4 are the only `Tests: none`. T1 adds a service declaration whose behaviour is exercised the moment T2 runs the stack; T4 produces a script whose output is verified by T5 applying it to an empty database. Neither defers verification - both are verified one task later, by the task that can actually run them.

---

## Cross-repository ordering

This slice provides the database the Catalog and the Notification Service need, so **T1 and T2 must land before either service's persistence work can be run locally**. The generator in T4 reads their migrations, so it runs last of the three repositories.
