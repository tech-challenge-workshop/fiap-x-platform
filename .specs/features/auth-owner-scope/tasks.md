# Auth and Owner Scope Tasks — platform

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/auth-owner-scope/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `.specs/features/real-media-processing/tasks.md` and `replace-object-storage/tasks.md` (prior matrices for this repository) and lessons L-007 to L-014 (candidates, applied as guidance: every smoke assertion is a named step with a self-tested pure check; negative runs are verified, not assumed). This repository has no test runner; its tests are the topology, the scripts' self-tests and the smoke on the real stack.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Compose topology + realm | integration | The provider healthy before the API; the realm imported; token claims (`iss`, `aud`) as specified; `sub` stable across two `up`s | `compose.yaml`, `identity/` | Build gate |
| Scripts | integration | `get-token.mjs` success and each failure path on a running stack | `scripts/*.mjs` | Build gate |
| Smoke assertions | integration | Each new step present in `SMOKE_STEPS`, each check rejecting its bad input in `--self-test`, and the real run green; one literal negative run per new assertion | `scripts/smoke-local-integration.mjs` | Build gate + `--self-test` |
| Generated database script | none | Regenerated output committed; build gate only | `db/create-database.sql` | Build gate |
| Documentation | none | Links resolve | `README.md` | docs-links check |

## Gate Check Commands

> Generated from codebase - confirm before Execute. The stack builds `../fiap-x-api` and `../processing-catalog` from their current checkouts (`feat/auth-owner-scope`).

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Script or document only | `node --check scripts/<changed>.mjs`, `node scripts/smoke-local-integration.mjs --self-test`, `node scripts/check-worker-sizing.mjs --self-test` |
| Full | Compose / realm changes | `docker compose config -q` then `docker compose up --build -d --wait` |
| Build | After a phase | `node clean-appledouble.mjs` (workspace root), `docker compose config -q`, `node scripts/check-worker-sizing.mjs`, `node scripts/check-worker-sizing.mjs --self-test`, `docker compose up --build -d --wait`, `node scripts/seed-source-video.mjs`, `node scripts/smoke-local-integration.mjs`, `node scripts/smoke-local-integration.mjs --self-test`, a second `docker compose up -d --wait` without `-v`, `docker compose down -v` |

---

## Execution Plan

### Phase 1: Identity in the topology

```
T10 -> T1
T1 -> T2
T3
```

### Phase 2: The smoke proves authentication and owner scope

```
T4 -> T5
T5 -> T6
T6 -> T7
T7 -> T8
T8 -> T9
```

---

## Task Breakdown

### Phase 1: Identity in the topology

### T10: Make the PostgreSQL host port configurable

**What**: Map PostgreSQL as `${POSTGRES_HOST_PORT:-5432}:5432`, so a developer with another PostgreSQL on 5432 can run the stack without stopping it.
**Where**: `compose.yaml`
**Depends on**: None
**Reuses**: The `${WORKER_CPUS:-2}` substitution pattern
**Requirement**: AUTH-14 (the topology must start to prove anything)

**Why**: Added by the orchestrator on 2026-09-26 at the user's choice. Another project's container (`fortal-postgres`) holds host port 5432 on the development machine, and the stack's `postgres` could not bind. The container port and every in-network address are unchanged; only the host mapping moves, and only when the variable is set.

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Unset, `docker compose config` still renders `5432:5432`
- [x] With `POSTGRES_HOST_PORT=55432`, the stack comes up healthy while another process holds 5432, and the services still reach `postgres:5432` inside the network
- [x] The README says how to use it (and that the database e2e suites then need `DATABASE_PORT` set to the same value)
- [x] Full gate passes

**Tests**: integration
**Gate**: full
**Status**: ✅ Complete
**Evidence**: unset renders `published: "5432"`, set renders `"55432"`. With `fortal-postgres` on 5432, `up --build -d --wait` brought every service but `api` to healthy (`api` needs T1's `OIDC_*`), and the Catalog and Notification migrations ran over `postgres:5432`. On this machine the gate also remapped the host ports 9000 and 3002 through an uncommitted override, because another project holds them.

---

### T1: Run Keycloak with the versioned realm and wire the API to it

**What**: The `identity` service (`quay.io/keycloak/keycloak:26.7.4`, `start-dev --import-realm`, `KC_HOSTNAME=http://localhost:8080`, `bash`/`/dev/tcp` readiness probe on 9000), the realm file with `alice` and `bob` (pinned `id`s, profile fields, non-temporary passwords) and client `fiapx-cli` (public, password grant only, `fiapx-api` audience mapper), and the API's `OIDC_*` variables plus `depends_on: identity: service_healthy`.
**Where**: `compose.yaml`, `identity/fiapx-realm.json`
**Depends on**: T10
**Reuses**: The spike's realm (`scratchpad/fiapx-realm.spike.json`), the service conventions in `compose.yaml`
**Requirement**: AUTH-14, AUTH-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `identity` healthy before `api` starts; the log shows `Realm 'fiapx' imported`
- [ ] A token requested from the host has `iss = http://localhost:8080/realms/fiapx` and `aud` containing `fiapx-api`; one requested from inside the network has the same `iss`
- [ ] `alice`'s `sub` is identical across two `docker compose up` runs with a re-created `identity` container
- [ ] `registrationAllowed` is false in the realm and the client has no standard flow
- [ ] Full gate passes (the API's own gate needs `fiap-x-api` T5 merged into its branch; before then, verify with the API service's healthcheck only)

**Tests**: integration
**Gate**: full

---

### T2: Get a demo user's token with one command

**What**: `scripts/get-token.mjs <user> [--password <p>]` printing only the access token, and exporting `getToken(user, password)` for the smoke.
**Where**: `scripts/get-token.mjs`
**Depends on**: T1
**Reuses**: The dependency-free script conventions
**Requirement**: AUTH-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `alice` and `bob` → a JWT on stdout, exit 0, nothing else on stdout
- [ ] `mallory` / wrong password → exit 1 naming the user and Keycloak's `error_description`
- [ ] `identity` stopped → exit 1 naming the `identity` service
- [ ] Quick gate passes

**Tests**: integration
**Gate**: quick

---

### T3: Regenerate the database script with the Catalog's new index

**What**: Run `scripts/generate-db-script.mjs` against `processing-catalog`'s `feat/auth-owner-scope` migrations and commit `db/create-database.sql`.
**Where**: `db/create-database.sql`
**Depends on**: None (needs `processing-catalog` T3 committed)
**Reuses**: `scripts/generate-db-script.mjs`
**Requirement**: AUTH-10 (deliverable script)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] The script contains `idx_processing_request_owner_created` and no longer creates `idx_processing_request_owner`
- [ ] Applied to an empty database, it yields the same indexes as running the migrations
- [ ] Build gate passes

**Tests**: none
**Gate**: build

---

### Phase 2: The smoke proves authentication and owner scope

### T4: Create as `alice` and prove anonymous creation is refused

**What**: The smoke obtains `alice`'s token through `getToken`, sends it on creation without `ownerUserId`, and adds the step `anonymous refused` (`POST` without a token → 401).
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None
**Reuses**: `SMOKE_STEPS`, `runSteps`, `getToken` from T2
**Requirement**: AUTH-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Every S4 step still passes with creation authenticated
- [ ] The self-test requires `anonymous refused` and rejects a 201 and a 500 with their exact messages
- [ ] Quick gate passes

**Tests**: integration
**Gate**: quick

---

### T5: Create a request as `bob` and prove the lists are disjoint

**What**: Step `bob request created` and step `lists disjoint` (`alice`'s list lacks `bob`'s id; `bob`'s lacks every `alice` id).
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T4
**Reuses**: The step pattern
**Requirement**: AUTH-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] The self-test requires both steps and rejects a list containing the other user's id, naming it
- [ ] Quick gate passes

**Tests**: integration
**Gate**: quick

---

### T6: Prove a cross-owner read is indistinguishable from a missing one

**What**: Step `cross-owner read 404`: `bob` reading `alice`'s id and a random UUID get 404 with identical bodies.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T5
**Reuses**: The step pattern
**Requirement**: AUTH-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] The self-test rejects a 200 and a 404 whose body differs from the random-id body
- [ ] Quick gate passes

**Tests**: integration
**Gate**: quick

---

### T7: Prove the user contract exposes nothing internal

**What**: Step `no internal fields`: no item in `alice`'s list carries `sourceStorageKey`, `zipStorageKey`, `failureCode` or `ownerUserId`, and her rejected request carries exactly the safe `failureReason`.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T6
**Reuses**: The rejected-request id the S4 steps already observe
**Requirement**: AUTH-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] The self-test rejects each forbidden field and a near-miss `failureReason` (lesson L-012)
- [ ] Quick gate passes

**Tests**: integration
**Gate**: quick

---

### T8: Refresh a token that expires during the run

**What**: Authenticated calls refetch the user's token once on a 401 before failing, naming the step.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T7
**Reuses**: `getToken`
**Requirement**: AUTH-17 (edge case)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] The self-test drives the refresh path with an injected token source: a first 401 followed by a 200 passes; two 401s fail naming the step
- [ ] Quick gate passes

**Tests**: integration
**Gate**: quick

---

### T9: Prove it all on the real stack and document it

**What**: Run the Build gate with both service branches; run the literal negatives; document login, the demo users, the password-grant caveat and the new smoke steps in the README.
**Where**: `README.md`
**Depends on**: T8
**Reuses**: The README's storage and smoke sections
**Requirement**: AUTH-14, AUTH-16, AUTH-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Build gate green, including the second `up` (and `alice`'s `sub` unchanged across it)
- [ ] Negatives on a scratch copy of the API: returning `bob`'s requests to `alice` fails `lists disjoint`; answering 403 for a cross-owner read fails `cross-owner read 404`; accepting a missing token fails `anonymous refused`
- [ ] README describes `get-token.mjs`, `alice`/`bob`, the development-only password grant, and what the smoke now proves; links resolve
- [ ] Build gate passes

**Tests**: none
**Gate**: build

---

## Phase Execution Map

```
Phase 1 (T10 T1 T2 T3) then Phase 2 (T4 T5 T6 T7 T8 T9)
```

10 tasks pack into two batches: **Phase 1** (4) and **Phase 2** (6). T10 was added during Execute (host port conflict). Cross-repository order for S5: `processing-catalog`, then `fiap-x-api`, then this repository — Phase 1 needs the API's guard for its full gate and the Catalog's migration for T3; Phase 2 needs both services complete.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T10: Configurable PostgreSQL host port | 1 port mapping | ✅ Granular |
| T1: Identity service + realm + API wiring | 1 service, its realm file, 3 env vars | ⚠️ OK - cohesive; the realm is unverifiable without the service |
| T2: Token helper | 1 script | ✅ Granular |
| T3: Database script | 1 generated file | ✅ Granular |
| T4: Authenticated creation + anonymous step | 1 step + token use | ✅ Granular |
| T5: Bob + disjoint lists | 2 steps sharing one observation | ⚠️ OK - cohesive |
| T6: Cross-owner 404 | 1 step | ✅ Granular |
| T7: No internal fields | 1 step | ✅ Granular |
| T8: Token refresh | 1 function | ✅ Granular |
| T9: End-to-end proof + README | 1 document + verification | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T10 | None | — | ✅ Match |
| T1 | T10 | T10 → T1 | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | None | — | ✅ Match |
| T4 | None | — | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T8 | T8 → T9 | ✅ Match |

No task depends on a later phase. T4 uses `getToken` from T2, which phase ordering guarantees.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T10 | Compose topology | integration | integration | ✅ OK |
| T1 | Compose topology + realm | integration | integration | ✅ OK |
| T2 | Scripts | integration | integration | ✅ OK |
| T3 | Generated database script | none | none | ✅ OK |
| T4 | Smoke assertions | integration | integration | ✅ OK |
| T5 | Smoke assertions | integration | integration | ✅ OK |
| T6 | Smoke assertions | integration | integration | ✅ OK |
| T7 | Smoke assertions | integration | integration | ✅ OK |
| T8 | Smoke assertions | integration | integration | ✅ OK |
| T9 | Documentation (+ verification) | none | none | ✅ OK |
