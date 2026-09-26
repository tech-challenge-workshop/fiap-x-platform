# Platform Gate Hardening Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/platform-gate-hardening/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — confirm before Execute. Same layers as `upload-download/tasks.md` (S6).
>
> Candidate lessons L-007..L-019 apply as guidance:
> - named, self-tested steps;
> - `main` runs only through the step list;
> - near-miss bad inputs;
> - literal negatives;
> - a restart that recreates (L-015);
> - every check the matrix assigns to the gate appears as a gate command (L-016);
> - scenario harnesses are versioned and run by the gate (L-018);
> - re-assert the link to the specific record (L-019).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Gate scripts (new or changed) | integration + self-test | Every check has one bad input, one near-miss input and one good input, each with its exact message; the script is spawned with a forced failure and must exit non-zero; the real run passes on the stack; a literal negative turns the gate red | `scripts/*.mjs` | Script plus its `--self-test` |
| Storage bootstrap | integration | Every scenario in design.md, run by the scenario runner against the stack's storage | `storage/bootstrap.sh` | `node scripts/check-storage-bootstrap.mjs` |
| Smoke steps | integration + self-test | Each new or changed step is required by the self-test, which gives it a bad and a near-miss input; the real run is green | `scripts/smoke-local-integration.mjs` | Smoke plus `--self-test` |
| Fixture | integration | Its properties are documented, and the smoke's processing-failure steps prove them on the stack | `fixtures/` | Smoke |
| Generated database script | integration | `--check` passes on the committed file and fails when one line is removed | `db/create-database.sql` | `node scripts/generate-db-script.mjs --check` |
| Documentation | none | Links resolve; every smoke step is named in the README (enforced by the smoke's self-test) | `README.md` | docs-links check |

## Gate Check Commands

> Generated from codebase — confirm before Execute. On this machine, run with `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002`. The sibling repositories must be on `main`, where spec B is merged.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Script-only changes whose checks need no stack | `node --check scripts/<changed>.mjs` and every script's `--self-test` |
| Full | Changes whose checks need the stack | `docker compose config -q`, `docker compose up --build -d --wait`, the changed script's real run, and every `--self-test` |
| Build | Last task of each phase | See the build gate steps below |

The build gate runs these steps in order:

1. `node clean-appledouble.mjs` (workspace root).
2. `docker compose config -q`.
3. `node scripts/check-worker-sizing.mjs` and its `--self-test`.
4. `node scripts/check-no-storage-writes.mjs` and its `--self-test`.
5. `node scripts/generate-db-script.mjs --check` and its `--self-test`.
6. `docker compose up --build -d --wait`.
7. `node scripts/check-storage-bootstrap.mjs` and its `--self-test`.
8. `node scripts/smoke-local-integration.mjs` and its `--self-test`.
9. `node scripts/check-identity.mjs` and its `--self-test`.
10. `docker compose up -d --wait --force-recreate identity storage-init api`.
11. The smoke and `check-identity.mjs` again.
12. `docker compose down -v`.
13. The `docs-links` job's script from `.github/workflows/ci.yml`, which must report `0 unresolved link(s)`.

Commands from scripts a task has not yet created are skipped until that task lands.

---

## Execution Plan

### Phase 1: Storage and database

```
T1 -> T2
T1 -> T3
T4
T5
```

### Phase 2: The smoke is exact and fails loudly

```
T6 -> T7
T8 -> T9
T10
```

### Phase 3: Identity, spec B, processing failure, gate

```
T11
T12
T13
T11 -> T14
T12 -> T14
T13 -> T14
```

---

## Task Breakdown

### Phase 1: Storage and database

### T1: Run the bootstrap's scenarios in the gate

**What**: Add `scripts/check-storage-bootstrap.mjs`. It runs the real `storage/bootstrap.sh` through `storage-init` against scratch buckets `fiapx-scenario-<name>`, covering these scenarios:

- `fresh`
- `rerun`
- `upgrade`
- `foreign`
- `abort-disabled`
- `abort-2-days`
- `abort-narrowed`
- `policy`

Every scenario deletes its bucket before and after. `--self-test` gives each assertion a bad, a near-miss and a good observation, and spawns the script with a forced failure.

**Where**: `scripts/check-storage-bootstrap.mjs`
**Depends on**: None
**Reuses**: The smoke's `dockerCompose()`; the self-test shape of `check-worker-sizing.mjs`
**Requirement**: GATE-01, GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] All 8 scenarios pass on the stack, and no `fiapx-scenario-*` bucket remains
- [x] Literal negatives in a scratch copy of the bootstrap each fail the named scenario:
  - loosening the foreign-rule check fails `foreign`;
  - `DaysAfterInitiation` 2 fails `fresh`;
  - removing the policy check fails `policy`
- [x] The self-test's spawned run exits non-zero with the message on stderr
- [x] Full gate passes

**Tests**: integration + self-test
**Gate**: full
**Status**: ✅ Complete
**Evidence**:
- **Real run.** `node scripts/check-storage-bootstrap.mjs` on the stack (RustFS 1.0.0, `STORAGE_HOST_PORT=39000`): `8 bootstrap scenarios passed; no fiapx-scenario-* bucket left`, in about 57 s. `list-buckets` afterwards: `fiapx` only.
- **Expectation.** The owned rules are literals in the runner, compared as ID-sorted canonical JSON, so a rule changed in the bootstrap fails instead of moving the expectation. `foreign` requires `(IDs: operator-rule)` on stderr; `policy` requires `bucket fiapx-scenario-policy has a bucket policy`, so a refusal for another reason does not pass.
- **Literal negatives.** `BOOTSTRAP_UNDER_TEST=<scratch copy>` mounts the copy over `/bootstrap.sh`; the tree was not touched:
  - `if [[ "$owned" != "$total" ]]` → `if false`: `scenario foreign failed: bootstrap exited 0, expected 1`; the other 7 passed.
  - `DaysAfterInitiation` 1 → 2 in both `desired` and `abort_correct()`: `scenario fresh failed: expected exactly the 3 owned lifecycle rules …`, and so did every other repair scenario; `foreign` and `policy` passed.
  - The policy block (lines 23-29) removed: `scenario policy failed: bootstrap exited 0, expected 1`; the other 7 passed.
- **Self-test.** `8 required scenarios present, 29 bad inputs rejected with the expected message, 15 good inputs accepted, 2 cleanup orders held, spawned failure exited non-zero`. The spawn uses a `COMPOSE_FILE` with no `storage-init` service, so it needs Docker's CLI but no stack; every scenario then fails with `no such service: storage-init`. Added to CI's `topology` job.

---

### T2: Refuse extra actions on owned rules

**What**: `correct()` and `abort_correct()` also require the other lifecycle actions to be absent (design.md). Add the scenario `abort-extra-expiration`, and `expire-extra-abort` for the check added to `correct()`.

**Where**: `storage/bootstrap.sh`
**Depends on**: T1
**Reuses**: The JMESPath checks already in the script
**Requirement**: GATE-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `abort-extra-expiration` passes: the rule is rewritten to exactly the owned one
- [x] Removing the new `==null` checks fails that scenario
- [x] Every T1 scenario still passes
- [x] Full gate passes

**Tests**: integration
**Gate**: full
**Status**: ✅ Complete
**Evidence**:
- **Red first.** With the two scenarios added and the bootstrap unchanged, the real run failed both: the abort rule kept `"Expiration":{"Days":30}`, and `expire-zips` kept its `AbortIncompleteMultipartUpload`. The other 8 passed.
- **Fix.** `correct()` adds `` AbortIncompleteMultipartUpload==`null` && Transitions==`null` && NoncurrentVersionExpiration==`null` ``; `abort_correct()` adds `` Expiration==`null` `` and the same two. JMESPath literals, since the `aws-cli` image has no `jq`.
- **Green.** `10 bootstrap scenarios passed; no fiapx-scenario-* bucket left`. On `up`, the live `fiapx` bucket printed the three `already configured` lines, so the fix does not rewrite a correct bucket.
- **Literal negative.** A scratch copy without the new `==null` checks: `abort-extra-expiration` and `expire-extra-abort` failed, the other 8 passed.
- **Deviation.** `expire-extra-abort` is not in the design's list. It covers the `correct()` half of this change, which no listed scenario reaches; design.md's table now lists it.
- **Self-test.** `10 required scenarios present, 33 bad inputs rejected with the expected message, 17 good inputs accepted, 2 cleanup orders held, spawned failure exited non-zero`.

---

### T3: The smoke reads the live lifecycle rules

**What**: Add the smoke step `bucket lifecycle`. It reads `fiapx`'s lifecycle configuration through `storage-init` and requires exactly the three owned rules, compared by ID-sorted JSON.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T1
**Reuses**: `dockerCompose()`, `listArchives` pattern
**Requirement**: GATE-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The self-test requires the step. It rejects these, each with the exact message: two rules, a fourth rule, the abort rule at 2 days, and an extra `Expiration` (near-miss). It accepts the exact set
- [ ] The real run is green
- [ ] Full gate passes

**Tests**: integration + self-test
**Gate**: full

---

### T4: The database script cannot drift

**What**: Add `generate-db-script.mjs --check`, which compares in memory and exits 1 naming the file and the first differing line, plus a `--self-test`. Then regenerate `db/create-database.sql`, which adds `uq_processing_request_owner_source`.

**Where**: `scripts/generate-db-script.mjs` (+ regenerated `db/create-database.sql`)
**Depends on**: None
**Reuses**: The existing generation path and its query-count guard
**Requirement**: GATE-04, GATE-05, GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `--check` passes on the regenerated file
- [ ] Deleting one line from the file fails `--check`, naming the file
- [ ] The script contains `uq_processing_request_owner_source`
- [ ] Applied to an empty `postgres:17-alpine`, the script yields the same columns and indexes as the migrated stack
- [ ] The self-test spawns `--check` against a tampered copy and requires a non-zero exit
- [ ] Full gate passes

**Tests**: integration + self-test
**Gate**: full

---

### T5: The storage-write check reads every script

**What**: Walk `scripts/` recursively; reading zero files exits 1. The self-test runs the real reader on a temporary directory with `nested/writes.mjs`, and spawns the script with `SCRIPTS_DIR` pointing there.

**Where**: `scripts/check-no-storage-writes.mjs`
**Depends on**: None
**Reuses**: Its existing pattern list and self-test
**Requirement**: GATE-06, GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The nested writing script fails the check, naming `nested/writes.mjs`; without it, the check passes
- [ ] An empty directory exits 1 with `no script was read under scripts/`
- [ ] A reader that returns no files fails the self-test (literal negative)
- [ ] The spawned run exits non-zero
- [ ] Build gate passes

**Tests**: integration + self-test
**Gate**: build

---

### Phase 2: The smoke is exact and fails loudly

### T6: Observations carry the id they were taken for

**What**: These helpers return `{ id, … }`, and each check requires the observed id before judging the value:

- `countDeliveries`
- `listArchives`
- `waitForNotificationDelivery`
- `waitForTerminalStatus`

Add a new step `archive object`, which requires the keys under `zips/<id>/` to be exactly `[zipStorageKey]`.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None (Phase 1 complete)
**Reuses**: `observed()`, the existing checks
**Requirement**: GATE-08, GATE-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The self-test rejects each observation taken for another id, with the exact "observed for X, expected Y" message
- [ ] `archive object` rejects no keys, two keys, and one key under another name (near-miss); it accepts exactly the key
- [ ] The real run is green
- [ ] Full gate passes

**Tests**: integration + self-test
**Gate**: full

---

### T7: Exact download path and delivery sentence

**What**: `download issued` requires the decoded URL path to equal `/fiapx/<zipStorageKey>` of the same request. The sentence check gains four near-misses in the self-test.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T6
**Reuses**: `assertDownloadIssued`, `assertDeliverySentence`
**Requirement**: GATE-07, GATE-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The self-test rejects a URL for another request's archive, and a URL for the right key under another bucket (near-miss)
- [ ] The self-test rejects the sentence's prefix, its truncation without the final period, the sentence plus a space, and an uppercase first word
- [ ] A literal negative passes: a scratch API image that serves the owner's first archive for every download fails `download issued` on its second run
- [ ] Full gate passes

**Tests**: integration + self-test
**Gate**: full

---

### T8: `main()` runs every step

**What**: `main()` becomes the one line `runSteps(SMOKE_STEPS, {}, executorFor(process.env))`. `SMOKE_DRY_RUN=1` prints each step name without observing. The self-test spawns the dry run and requires the printed names to equal `REQUIRED_STEPS`, in order.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None (Phase 1 complete)
**Reuses**: `runSteps`
**Requirement**: GATE-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Each of these fails the self-test: `SMOKE_STEPS.slice(0, 6)` in `main()`, a filter that drops one step, and two steps reordered
- [ ] The real run is green
- [ ] Quick gate passes

**Tests**: self-test
**Gate**: quick

---

### T9: The smoke exits non-zero on failure

**What**: The smoke's self-test spawns it with `API_URL=http://127.0.0.1:9 HEALTH_TIMEOUT_MS=1`, and requires a non-zero exit and the health message on stderr.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T8
**Reuses**: T8's spawn helper
**Requirement**: GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Replacing `process.exitCode = 1` with `0` in `main()`'s catch fails the self-test
- [ ] Quick gate passes

**Tests**: self-test
**Gate**: quick

---

### T10: The Worker sizing check exits non-zero on failure

**What**: `SIZING_CONFIG_JSON` injects the rendered configuration. The self-test spawns the script with mismatched values and requires a non-zero exit and the message.

**Where**: `scripts/check-worker-sizing.mjs`
**Depends on**: None (Phase 1 complete)
**Reuses**: Its existing comparisons
**Requirement**: GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Exiting 0 on a mismatch fails the self-test
- [ ] The real run still reads `docker compose config` when the variable is unset
- [ ] Build gate passes

**Tests**: integration + self-test
**Gate**: build

---

### Phase 3: Identity, spec B, processing failure, gate

### T11: Check the identity's properties

**What**: Add `scripts/check-identity.mjs` with the six checks in design.md: pinned `sub`, in-network `iss`, registration disabled, `tmpfs`, API after identity, and the `get-token` CLI. Its `--self-test` gives each check bad, near-miss and good inputs, and spawns the script with `IDENTITY_URL=http://127.0.0.1:9`.

**Where**: `scripts/check-identity.mjs`
**Depends on**: None (Phase 2 complete)
**Reuses**: `getToken`, `IDENTITY_URL`, the realm file's pinned ids
**Requirement**: GATE-13, GATE-14, GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The real run passes on the stack
- [ ] Each literal negative, on scratch copies, fails its named check:
  - `KC_HOSTNAME` dropped;
  - `registrationAllowed: true`;
  - `tmpfs` dropped;
  - `api`'s `depends_on: identity` dropped;
  - `get-token` printing `token: <jwt>`
- [ ] The spawned run exits non-zero naming `identity`
- [ ] Full gate passes

**Tests**: integration + self-test
**Gate**: full

---

### T12: Spec B on the real stack

**What**: Add two smoke steps:

- `invalid parts rejected`: 20 MiB declared, 1 byte then 4 MiB; confirmation → exact `400`, retry → `404 Upload not found`.
- `second key replays`: the fixture's completed upload confirmed with a fresh key → `200`, same id, `alice`'s total unchanged.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None (Phase 2 complete)
**Reuses**: `uploadThroughApi`, `putPart`, `confirm`, `totalAs`, `assertReplayed`
**Requirement**: GATE-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The self-test requires both steps and rejects these: a `502`, a `400` with another message (near-miss), a retry `400`, a replay `201`, another id, and a grown total
- [ ] The real run is green
- [ ] Full gate passes

**Tests**: integration + self-test
**Gate**: full

---

### T13: Prove a processing failure end to end

**What**: Commit `fixtures/corrupted-8s.mp4` (`sample-8s.mp4` with its `mdat` payload zeroed; SHA-256 `24123d94…9454`) and document it in `fixtures/README.md`. Add three smoke steps:

- `processing failure`: `FAILED` with `PROCESSAMENTO_FALHOU`.
- `processing failure archive`: no key.
- `processing failure delivery`: one record with the exact sentence `Nao foi possivel processar o video. Tente enviar novamente.`

**Where**: `scripts/smoke-local-integration.mjs` (+ `fixtures/corrupted-8s.mp4`, `fixtures/README.md`)
**Depends on**: None (Phase 2 complete)
**Reuses**: `uploadAndConfirm`, T6's id-carrying observations, `assertDeliverySentence` generalised by code
**Requirement**: GATE-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The committed fixture's SHA-256 matches, and the README's command reproduces it
- [ ] The self-test rejects `COMPLETED`, `FAILED (FORMATO_INVALIDO)` (the edge case), an archive key, two deliveries, and the `FORMATO_INVALIDO` sentence
- [ ] The real run is green
- [ ] Literal negative: with the valid fixture in its place, `processing failure` fails naming `COMPLETED`
- [ ] Full gate passes

**Tests**: integration + self-test
**Gate**: full

---

### T14: Recreate what matters and document the gate

**What**:

- The build gate's recreate step becomes `--force-recreate identity storage-init api`, followed by the smoke and `check-identity.mjs`.
- `README.md` describes every gate command, the three new scripts, every smoke step and the new fixture.
- The smoke's self-test requires every step name to appear in `README.md`.
- Update the Build row of this file's gate table.

**Where**: `README.md` (+ the smoke's self-test and this `tasks.md`)
**Depends on**: T11, T12, T13
**Reuses**: The docs-links job
**Requirement**: GATE-13, GATE-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Removing a step's name from the README fails the self-test
- [ ] The full build gate is green, with `check-identity.mjs` passing before and after the recreate
- [ ] The docs-links check reports 0 unresolved links

**Tests**: self-test
**Gate**: build

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3 T4 T5) then Phase 2 (T6 T7 T8 T9 T10) then Phase 3 (T11 T12 T13 T14)
```

14 tasks: **Phase 1** (5), **Phase 2** (5), **Phase 3** (4). This repository only.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Scenario runner | 1 new script | ✅ Granular |
| T2: Exact owned rules | 2 functions in 1 script | ✅ Granular |
| T3: Lifecycle step | 1 step | ✅ Granular |
| T4: Drift check + regeneration | 1 mode + its generated output | ⚠️ OK - cohesive; the check cannot pass without the regeneration |
| T5: Recursive storage-write check | 1 script | ✅ Granular |
| T6: Id-carrying observations | 4 helpers + 1 step in 1 file | ⚠️ OK - cohesive; one invariant applied to every observation |
| T7: Exact path and sentence | 2 checks | ✅ Granular |
| T8: Dry-run executor | 1 function | ✅ Granular |
| T9: Smoke exit code | 1 self-test case | ✅ Granular |
| T10: Sizing exit code | 1 script | ✅ Granular |
| T11: Identity check | 1 new script | ✅ Granular |
| T12: Spec B steps | 2 steps | ✅ Granular |
| T13: Fixture + failure steps | 1 fixture + 3 steps | ⚠️ OK - cohesive; the fixture exists only for these steps |
| T14: Gate + README | 1 document + 1 self-test check (+ the gate row in this file) | ⚠️ OK - cohesive; documents the gate it closes |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T1 | T1 → T3 | ✅ Match |
| T4 | None | — | ✅ Match |
| T5 | None | — | ✅ Match |
| T6 | None (Phase 1 complete) | — | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | None (Phase 1 complete) | — | ✅ Match |
| T9 | T8 | T8 → T9 | ✅ Match |
| T10 | None (Phase 1 complete) | — | ✅ Match |
| T11 | None (Phase 2 complete) | — | ✅ Match |
| T12 | None (Phase 2 complete) | — | ✅ Match |
| T13 | None (Phase 2 complete) | — | ✅ Match |
| T14 | T11, T12, T13 | T11 → T14, T12 → T14, T13 → T14 | ✅ Match |

No task depends on a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Gate script | integration + self-test | integration + self-test | ✅ OK |
| T2 | Storage bootstrap | integration | integration | ✅ OK |
| T3 | Smoke step | integration + self-test | integration + self-test | ✅ OK |
| T4 | Gate script + generated database script | integration + self-test | integration + self-test | ✅ OK |
| T5 | Gate script | integration + self-test | integration + self-test | ✅ OK |
| T6 | Smoke steps | integration + self-test | integration + self-test | ✅ OK |
| T7 | Smoke steps | integration + self-test | integration + self-test | ✅ OK |
| T8 | Smoke (`main`) | self-test | self-test | ✅ OK |
| T9 | Smoke (exit code) | self-test | self-test | ✅ OK |
| T10 | Gate script | integration + self-test | integration + self-test | ✅ OK |
| T11 | Gate script | integration + self-test | integration + self-test | ✅ OK |
| T12 | Smoke steps | integration + self-test | integration + self-test | ✅ OK |
| T13 | Fixture + smoke steps | integration + self-test | integration + self-test | ✅ OK |
| T14 | Documentation + smoke self-test | none + self-test | self-test | ✅ OK |
