# Auth and Owner Scope Tasks — platform

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/auth-owner-scope/design.md`
**Status**: Complete (Verifier pending)

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
T11 -> T4
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
- [x] `identity` healthy before `api` starts; the log shows `Realm 'fiapx' imported`
- [x] A token requested from the host has `iss = http://localhost:8080/realms/fiapx` and `aud` containing `fiapx-api`; one requested from inside the network has the same `iss`
- [x] `alice`'s `sub` is identical across two `docker compose up` runs with a re-created `identity` container
- [x] `registrationAllowed` is false in the realm and the client has no standard flow
- [x] Full gate passes (the API's own gate needs `fiap-x-api` T5 merged into its branch; before then, verify with the API service's healthcheck only)

**Tests**: integration
**Gate**: full
**Status**: ✅ Complete
**Evidence**: Keycloak started at 04:01:26, `identity` was healthy at 04:01:27.93 and `api` started at 04:01:28.05. Tokens for `alice` from the host and from a curl container on `fiap-x-platform_default` both carry `iss` `http://localhost:8080/realms/fiapx`, `aud` `fiapx-api`, RS256 and a 300 s lifetime. `alice`'s `sub` stayed `0f1c3a52-…-a11ce0000001` across a `--force-recreate` and a plain restart (and so did `bob`'s). The admin API reads `registrationAllowed` false and `standardFlowEnabled` false. The API (`fiap-x-api` `684aeae`) answered 200 to `GET /processing-requests` with the token and 401 without it or with a tampered signature. It also accepted a token after `identity` was re-created with a new signing key.
**Found during Execute**: a plain restart kept the embedded H2 database in the container layer, logged `Realm 'fiapx' already exists. Import skipped`, and so kept a hand change, against the spec's restart edge case. A `tmpfs` on `/opt/keycloak/data/h2` fixes it: after a `registrationAllowed` flip through the admin API and a restart, the realm was re-imported and read false again. A broken realm file makes Keycloak exit 1 (`Failed to run import`), so `identity` never turns healthy and `api` never starts.

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
- [x] `alice` and `bob` → a JWT on stdout, exit 0, nothing else on stdout
- [x] `mallory` / wrong password → exit 1 naming the user and Keycloak's `error_description`
- [x] `identity` stopped → exit 1 naming the `identity` service
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete
**Evidence**: `alice` and `bob` exit 0 with stdout matching exactly one `header.payload.signature` line and empty stderr, and their `sub`s are the pinned ids. `mallory`, and `alice --password nope`, exit 1 with empty stdout and `get-token: the identity service (compose service "identity", http://localhost:8080) rejected user "<user>" with 400: Invalid user credentials`. With `identity` stopped, exit 1 with `... is unreachable (ECONNREFUSED) - start the stack with \`docker compose up -d --wait\``. An HTML answer exits 1 with `answered 405 with a body that is not JSON`, and no arguments exits 2 with the usage. Importing the module prints nothing and exports only `getToken(user, password = demo password)`, which throws the same messages. Quick gate: `node --check`, smoke self-test (9 / 28 / 20) and sizing self-test (12 / 7) pass.

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
- [x] The script contains `idx_processing_request_owner_created` and no longer creates `idx_processing_request_owner`
- [x] Applied to an empty database, it yields the same indexes as running the migrations
- [x] Build gate passes

**Tests**: none
**Gate**: build
**Status**: ✅ Complete. The build gate went fully green with T4 (see T4's evidence), the real smoke included.
**Evidence**: generated from `processing-catalog` `bd9154c`. The script replays the migrations in order, so it still has the first migration's `CREATE INDEX … idx_processing_request_owner`, followed now by `DROP INDEX IF EXISTS idx_processing_request_owner`. That reads "no longer creates" as net effect. The script applied with `ON_ERROR_STOP=1` to an empty `postgres:17-alpine` with no published port (container removed). Its 7 indexes (name and definition) and its tables are identical to the stack's migrations-run database (ledger: all three Catalog migrations plus the Notification one). `idx_processing_request_owner_created` is present and `idx_processing_request_owner` absent. Build gate (with `POSTGRES_HOST_PORT=55432` and the T10 port override): config, sizing and its self-test, `up --build --wait`, seed, smoke `--self-test` (9 / 28 / 20), the second `up` (`alice`'s `sub` unchanged) and `down -v` all pass. The real smoke stops at `Create request failed: 401`: its creation is still anonymous against the now-authenticated API, which T4 changes.
**Found during Execute**: `scripts/generate-db-script.mjs` silently dropped the new migration's `DROP INDEX`, because Prettier wrapped that call with a trailing comma and the pattern did not allow one. As generated, the old index would have survived, which failed both criteria above. The pattern now accepts the comma. The generator also fails when `up()` makes more `query()` calls than it could read. A copy with the old pattern exits 1 with `1789955000000-IndexProcessingRequestOwnerCreatedAt.ts: up() makes 2 query() calls but only 1 could be read`.

---

### Phase 2: The smoke proves authentication and owner scope

### T11: Make the storage and worker host ports configurable

**What**: Map `storage` as `${STORAGE_HOST_PORT:-9000}:9000` and `worker` as `${WORKER_HOST_PORT:-3002}:3002`, following T10, and make every script that reaches them from the host honour the same variables.
**Where**: `compose.yaml`
**Depends on**: None
**Reuses**: T10's substitution and README note
**Requirement**: AUTH-17 (the smoke must run on the stack to prove anything)

**Why**: Added by the orchestrator after the Phase 1 batch found another project holding host ports 9000 (`fortal-minio`) and 3002 on the development machine, and ran its gates through an uncommitted override file. The user chose configurable host ports for 5432 (T10); the same reasoning applies. In-network addresses are unchanged.

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Unset, `docker compose config` renders `9000:9000` and `3002:3002` as before
- [x] With `STORAGE_HOST_PORT` and `WORKER_HOST_PORT` set, the stack comes up healthy while other processes hold 9000 and 3002, with no override file
- [x] The smoke (and any script reaching storage or the worker from the host) derives its default URL from the same variables, so one set of exports runs the whole gate
- [x] The README lists all three host-port variables together
- [x] Full gate passes

**Tests**: integration
**Gate**: full
**Status**: ✅ Complete
**Evidence**: unset, `docker compose config` renders `published: "9000"` and `"3002"`; with the variables set, `"39000"` and `"33002"` (and `"55432"`). With `fortal-minio` on 127.0.0.1:9000 and a listener on *:3002, `docker compose config -q` and `up --build -d --wait` with only `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002` exported brought every service to healthy, `storage` on `39000->9000` and `worker` on `33002->3002`, with no override file. The smoke is the only script reaching either from the host (the seed and the archive checks go through `storage-init` in the network; nothing calls the worker from the host). Its `STORAGE_URL` now defaults to `http://localhost:${STORAGE_HOST_PORT ?? 9000}`: with `STORAGE_HOST_PORT=39000` the `anonymous access` step passed (403 on the object and the listing), and with `STORAGE_HOST_PORT=1` the same step failed with `fetch failed`. The run then stopped at `Create request failed: 401`, which T4 fixes. Quick checks: `node --check`, smoke self-test (9 / 28 / 20), sizing self-test (12 / 7) and the sizing check pass.

---

### T4: Create as `alice` and prove anonymous creation is refused

**What**: The smoke obtains `alice`'s token through `getToken`, sends it on creation without `ownerUserId`, and adds the step `anonymous refused` (`POST` without a token → 401).
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T11
**Reuses**: `SMOKE_STEPS`, `runSteps`, `getToken` from T2
**Requirement**: AUTH-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Every S4 step still passes with creation authenticated
- [x] The self-test requires `anonymous refused` and rejects a 201 and a 500 with their exact messages
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete
**Evidence**: creation now sends `alice`'s token from `getToken('alice')` and a body of `{sourceStorageKey}` only. The step `anonymous refused` posts the same body without a token and `assertAnonymousCreateRefused` requires 401: a 2xx fails `Anonymous creation accepted: POST <api>/processing-requests without a token returned 201; the API must refuse it with 401`, any other status `Anonymous POST <api>/processing-requests without a token returned 500, expected 401`. Self-test: 10 required steps, 32 bad inputs (201, 500, the near-miss 403, and the step given 201), 22 good inputs (401, and the step given good observations). A scratch copy whose step check does nothing fails the self-test naming the step. Build gate run in full (only the three host-port exports, no override): config, sizing and its self-test, `up --build --wait`, seed, the real smoke green with every S4 step plus `API refused an anonymous POST /processing-requests (401)` and both requests `created ... as alice`, the self-test, a second `up -d --wait` with `alice`'s `sub` `0f1c3a52-7a2e-4d8b-9c61-a11ce0000001` before and after, and `down -v`. That also closes T3's build gate.

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
- [x] The self-test requires both steps and rejects a list containing the other user's id, naming it
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete
**Evidence**: `bob request created` creates the non-video as `bob`; `assertCreated` requires 201 with a `processingRequestId` and rejects 401, the near-miss 200 and a 201 without an id with their exact messages. `lists disjoint` reads both lists page by page (the API caps `pageSize` at 100) and `assertListsDisjoint` fails `Owner scope leak: alice's list contains bob's request <id>` or `Owner scope leak: bob's list contains alice's request <id>`, for this run's ids and for an older `alice` id only her list shows. It also requires each list to hold its owner's own requests (`alice's list is missing her own request <id>`, `bob's list is missing his own request <id>`), so an API that returns empty lists cannot pass. Self-test: 12 required steps, 42 bad inputs, 26 good inputs. Scratch copies whose step check skips `assertCreated`, or whose leak check for `alice` is disabled, fail the self-test. On the real stack the smoke is green and prints `alice lists 2 requests and bob 1; neither list holds the other's`. Quick gate (`node --check`, both self-tests) passes.

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
- [x] The self-test rejects a 200 and a 404 whose body differs from the random-id body
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete
**Evidence**: `cross-owner read 404` reads `alice`'s video request and a fresh `randomUUID()` as `bob`, keeping each status and raw body text. `assertCrossOwnerNotFound` compares the bodies byte for byte. Its self-test rejects a 200 (`Owner scope leak: bob's GET <api>/processing-requests/<id> returned 200; alice's request must be invisible to bob`), a 403 (`... returned 403, expected 404 as for a random id`), a 404 with another message, a 404 whose body differs by one trailing space (L-012), and a random-id baseline that is not 404. Self-test: 13 required steps, 48 bad inputs, 28 good inputs. Scratch copies with the body comparison or the 404 status check disabled fail the self-test. On the real stack the smoke is green and prints `bob reading alice's request <id> got 404 with the same body as a random id`. Quick gate passes.

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
- [x] The self-test rejects each forbidden field and a near-miss `failureReason` (lesson L-012)
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete
**Evidence**: `no internal fields` checks the list `lists disjoint` already read, so it adds no request. `assertNoInternalFields` fails `alice's list exposes <field> on request <id>` for any of the four fields, present even as `null`. It then requires her rejected request with exactly `O arquivo enviado nao e um video MP4 ou MOV valido.`. The self-test names the four fields literally, so a field dropped from `INTERNAL_FIELDS` fails it. It rejects each field, `ownerUserId: null`, the sentence without its final period (L-012), a missing `failureReason`, and a list without the rejected request. Self-test: 14 required steps, 57 bad inputs, 30 good inputs. Scratch copies without `failureCode` in the list, or accepting any non-empty reason, fail the self-test. On the real stack the smoke is green and prints `alice's list carries no internal field, and <id> carries the safe failureReason`. Quick gate passes.

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
- [x] The self-test drives the refresh path with an injected token source: a first 401 followed by a 200 passes; two 401s fail naming the step
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete
**Evidence**: every authenticated call (alice's two creations, bob's creation, both lists, both reads) goes through `withFreshToken` and a `createTokenSource(fetchToken = getToken)` that caches one token per user. On a 401 it refetches once and retries. A second 401 fails `Step "<step>": <user>'s request was refused with 401 twice, the second time with a freshly issued token`. The self-test injects a source that numbers its tokens. A 401 then a 200 must return the 200 after calls with `alice-token-1` then `alice-token-2`, and two 401s must fail naming `lists disjoint`. Self-test: 14 required steps, 58 bad inputs, 31 good inputs. Scratch copies that retry with the cached token, or never retry, fail it. On the real stack, a scratch copy whose source first hands each user a token with a tampered signature (the API answers it 401) refetched for `alice` and for `bob` and ran green. The unmodified smoke is green too. Found during Execute: right after `identity` was re-created, the API still accepted a token issued before (it keeps the previous signing key cached), so a restart does not reliably yield a 401 to test with; the tampered token does. Quick gate passes.

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
- [x] Build gate green, including the second `up` (and `alice`'s `sub` unchanged across it)
- [x] Negatives on a scratch copy of the API: returning `bob`'s requests to `alice` fails `lists disjoint`; answering 403 for a cross-owner read fails `cross-owner read 404`; accepting a missing token fails `anonymous refused`
- [x] README describes `get-token.mjs`, `alice`/`bob`, the development-only password grant, and what the smoke now proves; links resolve
- [x] Build gate passes

**Tests**: none
**Gate**: build
**Status**: ✅ Complete
**Evidence**: Build gate from a clean `down -v`, with only `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002` exported and no override file. Config, sizing (`cpus 2 matches FFMPEG_THREADS 2`) and its self-test (12 / 7), `up --build --wait` and seed pass. The real smoke is green on every S4 step and every new one: `API refused an anonymous POST /processing-requests (401)`, `alice lists 2 requests and bob 1; neither list holds the other's`, `bob reading alice's request <id> got 404 with the same body as a random id`, `alice's list carries no internal field, and <id> carries the safe failureReason`. The smoke self-test passes with 14 required steps, 58 bad inputs and 31 good inputs. `alice`'s `sub` read `0f1c3a52-7a2e-4d8b-9c61-a11ce0000001` before and after the second `up -d --wait`, and `down -v` passed. Literal negatives: three scratch copies of `fiap-x-api` `636f33a`, each built as its own image and swapped in for `api` through a scratchpad override (`image:` plus `build: !reset null`). Each smoke exited 1. (1) `alice`'s list also returns `bob`'s requests: `Owner scope leak: alice's list contains bob's request 6bc6d1e2-6cf5-4268-ac55-e3c7c1658f25`. (2) A cross-owner read answers 403 when the id exists in the Catalog: `bob's GET http://localhost:3000/processing-requests/f516f780-aae8-4f87-89c8-7c8fe238a4a3 returned 403, expected 404 as for a random id`. (3) The guard lets a request without a token in: `Anonymous creation accepted: POST http://localhost:3000/processing-requests without a token returned 201; the API must refuse it with 401`. The real `api` image was restored after the negatives and the three images removed. The API tree was never modified. The README gains "Logging in as a demo user" (`get-token.mjs`, `alice`/`bob`, `--password`, `IDENTITY_URL`, the development-only password grant), the four owner-scope bullets, the token refresh, the fourteen required steps, the three negatives and the `identity/` layout row. Every relative link resolves.

---

## Phase Execution Map

```
Phase 1 (T10 T1 T2 T3) then Phase 2 (T11 T4 T5 T6 T7 T8 T9)
```

11 tasks pack into two batches: **Phase 1** (4) and **Phase 2** (7). T10 and T11 were added during Execute (host port conflicts). Cross-repository order for S5: `processing-catalog`, then `fiap-x-api`, then this repository — Phase 1 needs the API's guard for its full gate and the Catalog's migration for T3; Phase 2 needs both services complete.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T10: Configurable PostgreSQL host port | 1 port mapping | ✅ Granular |
| T1: Identity service + realm + API wiring | 1 service, its realm file, 3 env vars | ⚠️ OK - cohesive; the realm is unverifiable without the service |
| T2: Token helper | 1 script | ✅ Granular |
| T3: Database script | 1 generated file | ✅ Granular |
| T11: Configurable storage/worker host ports | 2 port mappings + script defaults | ✅ Granular |
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
| T11 | None | — | ✅ Match |
| T4 | T11 | T11 → T4 | ✅ Match |
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
| T11 | Compose topology + scripts | integration | integration | ✅ OK |
| T4 | Smoke assertions | integration | integration | ✅ OK |
| T5 | Smoke assertions | integration | integration | ✅ OK |
| T6 | Smoke assertions | integration | integration | ✅ OK |
| T7 | Smoke assertions | integration | integration | ✅ OK |
| T8 | Smoke assertions | integration | integration | ✅ OK |
| T9 | Documentation (+ verification) | none | none | ✅ OK |
