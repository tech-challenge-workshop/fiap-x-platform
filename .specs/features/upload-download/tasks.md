# Upload and Download Tasks — platform

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/upload-download/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Same layers as `auth-owner-scope/tasks.md` (S5). Candidate lessons applied: L-007..L-017 — named, self-tested steps; main runs only through the step list; near-miss bad inputs; literal negatives; **every check the matrix assigns to the gate appears as a command in the gate** (L-016).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Compose topology | integration | API receives the storage variables; public endpoint follows `STORAGE_HOST_PORT`; API waits on the bootstrap | `compose.yaml` | Build gate |
| Storage bootstrap | integration | Three owned rules, idempotent, foreign rules refused, a two-rule bucket upgraded | `storage/bootstrap.sh` | Build gate + negatives |
| Smoke assertions | integration | Each new step required by the self-test with a bad and a near-miss input; real run green; literal negatives | `scripts/smoke-local-integration.mjs` | Build gate + `--self-test` |
| Generated database script | none | Regenerated and matching the migrations | `db/create-database.sql` | Build gate |
| Documentation | none | Links resolve | `README.md` | docs-links check |

## Gate Check Commands

> Generated from codebase - confirm before Execute. On this machine run with `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002` (S5 T10/T11). The seed step leaves the gate in T4.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Script or document only | `node --check scripts/<changed>.mjs`, both `--self-test`s |
| Full | Compose / bootstrap changes | `docker compose config -q` then `docker compose up --build -d --wait` |
| Build | After a phase | `node clean-appledouble.mjs` (workspace root), `docker compose config -q`, `node scripts/check-worker-sizing.mjs`, `node scripts/check-worker-sizing.mjs --self-test`, `docker compose up --build -d --wait`, `node scripts/smoke-local-integration.mjs`, `node scripts/smoke-local-integration.mjs --self-test`, `docker compose up -d --wait --force-recreate identity storage-init` (L-015: a restart that recreates), the smoke again, `docker compose down -v` |

---

## Execution Plan

### Phase 1: Storage for the API

```
T1
T2
T3
```

### Phase 2: The smoke proves the real flow

```
T4 -> T5
T5 -> T6
T6 -> T7
T7 -> T8
```

---

## Task Breakdown

### Phase 1: Storage for the API

### T1: Give the API storage credentials and a public endpoint

**What**: The `api` service gets `STORAGE_ENDPOINT`, `STORAGE_PUBLIC_ENDPOINT=http://localhost:${STORAGE_HOST_PORT:-9000}`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, and `depends_on: storage-init: service_completed_successfully`.
**Where**: `compose.yaml`
**Depends on**: None
**Reuses**: The Worker's storage block
**Requirement**: UPL-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `docker compose config` renders the public endpoint with the default port unset and with `STORAGE_HOST_PORT=39000`
- [ ] With the API from `feat/upload-download`: a part URL from `POST /uploads` targets `localhost:39000` and accepts a `PUT` from the host
- [ ] Full gate passes

**Tests**: integration
**Gate**: full

---

### T2: Own a third lifecycle rule that aborts abandoned uploads

**What**: `abort-incomplete-uploads` (`AbortIncompleteMultipartUpload` after 1 day, `Filter.Prefix: ""`) joins the bootstrap's owned rules; desired config and read-back carry three rules.
**Where**: `storage/bootstrap.sh`
**Depends on**: None
**Reuses**: The ID-based ownership from AD-014's fix
**Requirement**: UPL-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Fresh bucket → three rules read back; re-run → all three `already configured`; a two-rule bucket (the S5 state) → upgraded to three
- [ ] A foreign rule still → exit 1 naming it, configuration intact; the abort rule disabled or at 2 days → rewritten
- [ ] Full gate passes

**Tests**: integration
**Gate**: full

---

### T3: Regenerate the database script with the idempotency key

**What**: `scripts/generate-db-script.mjs` against `processing-catalog`'s `feat/upload-download` migrations.
**Where**: `db/create-database.sql`
**Depends on**: None (needs `processing-catalog` T1 committed)
**Reuses**: The generator's `query()` count guard
**Requirement**: UPL-18

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] The script adds `idempotency_key` and `uq_processing_request_owner_idempotency`
- [ ] Applied to an empty database, the columns and indexes equal the migrations'
- [ ] Build gate passes (after Phase 2's T4 makes the smoke use the upload flow; until then recorded as Partial, as S5's T3 was)

**Tests**: none
**Gate**: build

---

### Phase 2: The smoke proves the real flow

### T4: Remove the seed and upload through the API

**What**: Delete `scripts/seed-source-video.mjs` and its gate step; add `uploadThroughApi` and `confirm`; the smoke uploads the fixture and the non-video as `alice` through the API; new steps `old create gone` and `upload confirmed`.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None
**Reuses**: `getToken`, `SMOKE_STEPS`, `runSteps`
**Requirement**: UPL-17, UPL-18

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] No script writes videos to storage outside the API (the seed is gone; a check asserts no `aws s3 cp`/`put-object` to `sources/` remains in `scripts/`)
- [ ] Every S4/S5 step still passes with both requests created through uploads
- [ ] Self-test requires both new steps and rejects a bad and a near-miss input each
- [ ] T3's build box ticked once this gate is green
- [ ] Build gate passes

**Tests**: integration
**Gate**: build

---

### T5: Prove confirmation is idempotent

**What**: Steps `confirmation replay` (same key → 200, same id, `alice`'s total unchanged) and `key reuse conflict` (the key on a second upload → 409).
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T4
**Reuses**: The upload helper
**Requirement**: UPL-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Self-test rejects a replay returning 201, another id, or a grown total; and a conflict returning 200 or 201
- [ ] Quick gate passes

**Tests**: integration
**Gate**: quick

---

### T6: Prove the download through its URL

**What**: Step `download issued`: poll `GET …/download` (409 is "not yet"), fetch the URL from the host, count entries (8) with the EOCD reader; the archive check reads through this URL instead of `aws s3 cp`.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T5
**Reuses**: `countZipEntries`, the archive assertions
**Requirement**: UPL-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Self-test rejects a body without `url`, an `expiresAt` in the past, a URL answering 403, and an archive with 7 entries
- [ ] Quick gate passes

**Tests**: integration
**Gate**: quick

---

### T7: Prove another user cannot download

**What**: Step `cross-owner download 404`: `bob` requesting `alice`'s download gets the constant 404, identical to a random id.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T6
**Reuses**: The S5 cross-owner step's comparison
**Requirement**: UPL-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Self-test rejects a 200, a 409 and a 404 whose body differs by one character
- [ ] Quick gate passes

**Tests**: integration
**Gate**: quick

---

### T8: Prove it on the real stack and document it

**What**: Build gate with the three service branches; literal negatives on scratch API images; README (upload flow, TTLs, the abort rule, the seed's removal).
**Where**: `README.md`
**Depends on**: T7
**Reuses**: S5 T9's negative procedure
**Requirement**: UPL-15, UPL-16, UPL-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Build gate green, including the force-recreate step
- [ ] Negatives: replay creating a second request fails `confirmation replay`; a URL signed for the internal host fails `upload confirmed`; `bob` receiving a URL fails `cross-owner download 404`
- [ ] README updated; links resolve

**Tests**: none
**Gate**: build

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3) then Phase 2 (T4 T5 T6 T7 T8)
```

8 tasks: **Phase 1** (3) and **Phase 2** (5). Cross-repository order: `processing-catalog`, `fiap-x-api`, then this repository.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: API storage wiring | 1 service block | ✅ Granular |
| T2: Third lifecycle rule | 1 script | ✅ Granular |
| T3: Database script | 1 generated file | ✅ Granular |
| T4: Seed removal + upload helper + 2 steps | 1 script (+1 deletion) | ⚠️ OK - cohesive; the smoke cannot run without replacing the seed |
| T5: Idempotency steps | 2 steps | ✅ Granular |
| T6: Download step | 1 step | ✅ Granular |
| T7: Cross-owner download | 1 step | ✅ Granular |
| T8: Proof + README | 1 document + verification | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | None | — | ✅ Match |
| T3 | None | — | ✅ Match |
| T4 | None | — | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |

No task depends on a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Compose topology | integration | integration | ✅ OK |
| T2 | Storage bootstrap | integration | integration | ✅ OK |
| T3 | Generated database script | none | none | ✅ OK |
| T4 | Smoke assertions | integration | integration | ✅ OK |
| T5 | Smoke assertions | integration | integration | ✅ OK |
| T6 | Smoke assertions | integration | integration | ✅ OK |
| T7 | Smoke assertions | integration | integration | ✅ OK |
| T8 | Documentation (+ verification) | none | none | ✅ OK |
