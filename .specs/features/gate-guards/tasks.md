# Gate Guards Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/gate-guards/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines and spec. Confirm before Execute. The layers are the same as in `platform-gate-hardening` and `ci-governance`. Candidate lessons L-020..L-025 apply:
> - the same variations for every owned rule;
> - redact secrets in messages;
> - read ids from results;
> - allow-list which step carries an expression;
> - guard the neutering of promoted checks;
> - test lists that shrink.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Gate scripts | self-test + integration | Every new rule gets a bad, a near-miss and a good input, each with the exact message. The script is spawned with a forced failure. The real run passes | `scripts/*.mjs` | script + `--self-test` |
| Smoke steps | integration + self-test | The new step is required; bad and near-miss inputs; the real run is green | `scripts/smoke-local-integration.mjs` | smoke + `--self-test` |
| Workflow | integration | The PR's CI is green with the new `docs-links` script | `.github/workflows/ci.yml` | CI |
| Rulesets | integration | `--live` passes after the go-ahead apply | `ci/required-checks.json` | `--live` |

## Gate Check Commands

> On this machine: `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002`. Run `node clean-appledouble.mjs` from the **workspace root** before any build.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Script-only changes | `node --check scripts/<changed>.mjs && node scripts/<changed>.mjs --self-test` |
| Full | Stack-dependent changes | `docker compose up --build -d --wait`, then the changed script's real run and every `--self-test` |
| Build | Last task of a phase | The 13-step build gate in `platform-gate-hardening/tasks.md`, plus `node scripts/check-ci-governance.mjs`, its `--self-test`, `--live`, and `node scripts/check-docs-links.mjs` |

---

## Execution Plan

### Phase 1: Guards without the stack

```
T1 -> T2
T3
T4
```

### Phase 2: Stack-dependent guards and the rollout

```
T5
T6
T7
```

---

## Task Breakdown

### T1: Allow-list the integration job step by step

**What**: Parse the `integration` job into steps and enforce design.md's rules 1–3: no job-level `if:`, `shell:` or `continue-on-error`; only three named steps may carry `if:`; each stack command is its own one-line step. Self-test near-misses cover M10, M11, M14 and `shell:`.
**Where**: `scripts/check-ci-governance.mjs`
**Depends on**: None
**Reuses**: `integrationBlock`, `GOOD`, `replaceOnce`
**Requirement**: GRD-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Each of M10, M11, M14 and a `shell:` override fails the self-test with its exact message. The real `ci.yml` passes
- [x] Reverting to the old line scan makes the new self-test cases fail
- [x] Quick gate passes

**Tests**: self-test
**Gate**: quick

**Status**: ✅ Complete (2026-09-26). Self-test 10 → 21 bad workflows rejected, 2 good accepted; the real `ci.yml` passes unchanged (its stack steps were already one-line). Red-first: the 11 new cases and the three reworded ones failed against the old line scan. Literal negatives on scratch copies of `ci.yml` (M10, M11, M14, a job `defaults.run.shell`) each exit 1 with the exact message. Beyond the design: a step that runs a stack command may not be conditioned even under an allow-listed name, `continue-on-error` is refused on steps as well as the job, and a workflow-level default shell is refused. The old `line N:` messages are replaced by the design's messages.


---

### T2: Script and guard the link check

**What**: Add `scripts/check-docs-links.mjs` with a `--self-test`. The `docs-links` job runs it in place of the inline Python. Add design.md's rule 4 to the workflow check, with near-misses: `continue-on-error: true`, an `if:`, and the inline Python kept.
**Where**: `scripts/check-docs-links.mjs` (+ `ci.yml`, `check-ci-governance.mjs`)
**Depends on**: T1
**Reuses**: The existing Python logic
**Requirement**: GRD-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The script exits 0 on the real tree
- [x] Its self-test passes: broken tree → exit 1 with the exact message; good tree → exit 0; the spawned broken run exits non-zero
- [x] Restoring `continue-on-error` on `docs-links` fails the workflow check (M8), and so does making the script exit 0 on missing links (M9)
- [x] `yaml.safe_load` passes
- [x] Quick gate passes

**Tests**: self-test
**Gate**: quick

**Status**: ✅ Complete (2026-09-26). `check-docs-links.mjs` self-test: 4 checks (broken tree exact report, good tree exact report, spawned broken exit 1, spawned good exit 0), all seen red against a stub first. Its output is byte-identical to the old inline Python on the real tree (`0 unresolved link(s)`) and on the broken fixture. Workflow self-test 21 → 28 bad workflows rejected (M8, M9 as the inline Python kept, a job `if:`, a step `if:`, `|| true`, `shell:`, no job), all seen red first; the real `ci.yml` was rejected until rewired. Literal negatives: M8 on a scratch `ci.yml`, the previous `ci.yml` with the inline Python, and a scratch script exiting 0 on missing links (its self-test fails) each exit 1. `yaml.safe_load` passes. Beyond the task's files: `topology` runs the new `--self-test` (so M9 is killed by a CI gate), `docs-links` gains `setup-node` 22, and the README's guard description and build-gate step 13 describe the new checks.


---

### T3: Pin the required checks to the Actions app and complete their tests

**What**:
- The contexts become `{context, integration_id: 15368}`.
- `--live` compares the pairs and rejects a non-empty `exclude`.
- `withRequiredChecks` writes the pairs, with a shrinking-list case.
- `topology` runs the apply self-test.

**Where**: `ci/required-checks.json` (+ `check-ci-governance.mjs`, `apply-required-checks.mjs`, `ci.yml`)
**Depends on**: None (runs after T1 and T2 in the same phase)
**Reuses**: `rulesetProblems`, `withRequiredChecks`
**Requirement**: GRD-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Self-tests reject a missing `integration_id`, a wrong one, and a non-empty `exclude` (M15). The shrinking-list case produces exactly the versioned list (M17)
- [x] Red-first: `--live` fails today, naming every context without `@15368`
- [x] `--dry-run` shows each context gaining `integration_id` 15368. Record its output. **Do not run `--apply`**
- [x] Quick gate passes

**Tests**: self-test + integration
**Gate**: quick

**Status**: ✅ Complete (2026-09-26). `check-ci-governance` live self-test 8 → 12 bad rulesets rejected (a context without `integration_id`, all of them as today, another app's id, M15's non-empty `exclude`), plus 6 malformed checks files refused; `apply-required-checks` self-test gains the shrinking list from `[quality, lint]` and `[quality@15368, lint@15368]`, 3 → 5 change sets, and a second apply that changes nothing. All seen red first. Mutants on scratch copies: dropping `exclude.length !== 0` (M15) and appending instead of replacing (M17) each fail their self-test. `topology` runs `apply-required-checks.mjs --self-test`. `--apply` was not run, so `--live` stays red until T7's go-ahead.

Red-first `--live` (exit 1):

```
check-ci-governance: tech-challenge-workshop/fiap-x-api: missing [quality@15368, image@15368], unexpected [quality@-, image@-]
check-ci-governance: tech-challenge-workshop/processing-catalog: missing [quality@15368, image@15368], unexpected [quality@-, image@-]
check-ci-governance: tech-challenge-workshop/processing-worker: missing [quality@15368, image@15368], unexpected [quality@-, image@-]
check-ci-governance: tech-challenge-workshop/notification-service: missing [quality@15368, image@15368], unexpected [quality@-, image@-]
check-ci-governance: tech-challenge-workshop/fiap-x-platform: missing [topology@15368, docs-links@15368, integration@15368], unexpected [topology@-, docs-links@-, integration@-]
```

`--dry-run` (exit 0, nothing written):

```
tech-challenge-workshop/fiap-x-api: ruleset "protect main" (23709829) would add [quality@15368, image@15368], remove [quality@-, image@-]; it would then require [quality@15368, image@15368]
tech-challenge-workshop/processing-catalog: ruleset "protect main" (23709816) would add [quality@15368, image@15368], remove [quality@-, image@-]; it would then require [quality@15368, image@15368]
tech-challenge-workshop/processing-worker: ruleset "protect main" (23709809) would add [quality@15368, image@15368], remove [quality@-, image@-]; it would then require [quality@15368, image@15368]
tech-challenge-workshop/notification-service: ruleset "protect main" (23709823) would add [quality@15368, image@15368], remove [quality@-, image@-]; it would then require [quality@15368, image@15368]
tech-challenge-workshop/fiap-x-platform: ruleset "protect main" (23709782) would add [topology@15368, docs-links@15368, integration@15368], remove [topology@-, docs-links@-, integration@-]; it would then require [topology@15368, docs-links@15368, integration@15368]
dry run: nothing was changed
```


---

### T4: Redact tokens and document the start order

**What**:
- `redact()` in `check-identity.mjs`, applied to every message that quotes an output, with a self-test case.
- The V44 start-order note in the README.
- The V52 wording in the ci-governance spec and context, and in the README.

**Where**: `scripts/check-identity.mjs` (+ `README.md`, `.specs/features/ci-governance/{spec,context}.md`)
**Depends on**: None
**Reuses**: `assertGetTokenCli`
**Requirement**: GRD-05, GRD-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Self-test: `token: <jwt>` fails with a message containing `<jwt:` and not the token (near-miss: a JWT inside stderr)
- [x] Removing `redact()` makes that case fail
- [x] README, spec and context are updated, and docs-links reports 0 unresolved links
- [x] Quick gate passes

**Tests**: self-test
**Gate**: quick

**Status**: ✅ Complete (2026-09-26). `check-identity` self-test 20 → 23 bad inputs rejected: `token: <real-shaped jwt>` (646 chars), a JWT inside a failed run's stderr, and a JWT printed while identity is unreachable; the two existing cases that quoted a token now expect `<jwt: 49 chars>`. Every rejection must also not contain either token. All seen red first; a scratch copy with `redact()` as the identity fails the same 5 cases. Literal negative: `GET_TOKEN_UNDER_TEST` on a scratch `get-token` printing `token: <jwt>` fails `get-token cli` with `printed "token: <jwt: 472 chars>\n"`, and the token appears 0 times in stdout or stderr. `redact()` also wraps the `docker compose` and `docker inspect` failure messages and every failure line `main()` prints. The README carries the V44 start-order note (and the script's header), a line on redaction, and the V52 wording; `ci-governance/spec.md` (three places, including "anonymously") and `context.md` (two) carry it too. docs-links: `0 unresolved link(s)`.


---

### T5: Scenario-test the expiry rules

**What**: Add the `expire-disabled` and `expire-narrowed` scenarios.
**Where**: `scripts/check-storage-bootstrap.mjs`
**Depends on**: None (Phase 1 complete)
**Reuses**: The `abort-disabled` and `abort-narrowed` scenario builders
**Requirement**: GRD-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Both scenarios pass on the stack. No scratch bucket is left
- [x] Removing `Status=='Enabled'` from `correct()` in a scratch bootstrap fails `expire-disabled`, and removing `Filter.Prefix` fails `expire-narrowed` (K6 and K7)
- [x] Full gate passes

**Tests**: integration + self-test
**Gate**: full

**Status**: ✅ Complete (2026-09-26). `check-storage-bootstrap` self-test 10 → 12 required scenarios, 33 → 38 bad inputs rejected (an expire rule disabled, one narrowed to `zips/x/` as the near-miss, each scenario left as it was, and `expire-disabled` failing its repair), 17 → 19 good inputs accepted. Red-first: a scratch runner without the two scenarios fails the self-test on the required list and on every new scenario case. The real run: `12 bootstrap scenarios passed; no fiapx-scenario-* bucket left`. Literal negatives through `BOOTSTRAP_UNDER_TEST` on scratch copies of the bootstrap: without `Status=='Enabled'` in `correct()`, exit 1 with only `expire-disabled` failing (`expected exactly the 3 owned lifecycle rules …, found …"Status":"Disabled"…`), K6 killed; without `Filter.Prefix=='$prefix'`, exit 1 with only `expire-narrowed` failing (`…"Prefix":"zips/x/"…`), K7 killed. Every other `--self-test` passes. Beyond the task's file: the README's scenario table gains the two rows and says twelve scenarios.

---

### T6: Observations prove their record; `failureReason` through the API

**What**:
- `countDeliveries` and `listArchives` take their id from the result.
- New smoke step `processing failure reason`.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None (Phase 1 complete)
**Reuses**: `observedFor`, `readAs`
**Requirement**: GRD-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The self-test requires the new step. It rejects the `FORMATO_INVALIDO` sentence and a truncated sentence, and rows for another id (naming both ids)
- [x] A literal negative passes: a scratch smoke whose count query filters on the wrong column fails on the stack
- [x] The real smoke is green
- [x] Full gate passes

**Tests**: integration + self-test
**Gate**: full

**Status**: ✅ Complete (2026-09-26). Smoke self-test 29 → 30 required steps, 168 → 176 bad inputs rejected, 58 → 59 good inputs accepted. `countDeliveries` runs `SELECT processing_request_id, count(*) … GROUP BY 1` and `listArchives` reads each key's `zips/<id>/` segment; both return `{ ids, …, queried }`, parsed by `deliveriesOf`/`listingOf` so the self-test feeds them psql and aws-cli text. `observedRowsFor` requires every id from the result to be the id under test (naming both), and falls back to `queried` only for an empty result. No row means count 0, which fails with `0 deliveries for <id>: expected exactly 1 record`; an empty listing reports `No archive under zips/<id>/`. New step `processing failure reason` (after `processing failure delivery`, in `REQUIRED_STEPS` and the README's table) reads the request as `alice` and requires 200, the body's own `processingRequestId`, and exactly `Nao foi possivel processar o video. Tente enviar novamente.`; the self-test rejects the `FORMATO_INVALIDO` sentence, the sentence without its final period, a 404, and another request's body. New row cases: a delivery row and an archive key for another id with the right query, a right row plus a foreign one, and an empty result queried for another id. Mutants on scratch copies, each killed by the self-test: `observedRowsFor` comparing `queried` instead of the rows (7 cases fail), `failureReason` compared by prefix (the truncated case fails), the body's id not compared (the other-request case fails); the step absent from README fails the documentation check. Real smoke green (`alice reading <id> through the API got 200 with failureReason Nao foi possivel processar o video. Tente enviar novamente.`). Literal negatives on the stack: the count query filtering on `event_id` exits 1 with `0 deliveries for <rejectedId>: expected exactly 1 record`; filtering on the request's `owner_user_id` exits 1 with `deliveries observed for <failedId of the previous run>, expected <rejectedId>`. Every `--self-test` passes. Deviation: `ids` (every row) in place of design.md's single `id` (SPEC_DEVIATION in the script). Beyond the task's file: the README's smoke description says thirty steps and how the two observations read their id.

---

### T7: Prove it end to end and roll out the pinning

**What**:
- Run the full build gate.
- Push the branch and open the PR, then wait for a green CI with the new `docs-links` script.
- **With the user's go-ahead**, run `apply-required-checks.mjs --apply`, then `--live`.
- Record the evidence.

**Where**: `.specs/features/gate-guards/tasks.md`
**Depends on**: None (Phase 1 complete; runs last)
**Reuses**: The spec D rollout
**Requirement**: GRD-01..07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Build gate green
- [ ] PR CI green (`topology`, `docs-links`, `integration`)
- [ ] With the go-ahead: `--apply`, then `--live` passes, and the other rules are byte-identical to a before snapshot

**Tests**: integration
**Gate**: build

**Status**: ⚠️ Partial (2026-09-26). Build gate green at `470a1e2`; the branch is not pushed, no PR is open, and `--apply` has not run. Siblings `fiap-x-api`, `processing-catalog`, `processing-worker` and `notification-service` on `main`, clean. Ports `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002`; started from `docker compose down -v`.

| Step | Result |
| --- | --- |
| 1. `clean-appledouble.mjs` (workspace root) | exit 0 |
| 2. `docker compose config -q` | exit 0 |
| 3. `check-worker-sizing` + `--self-test` | `worker cpus 2 matches FFMPEG_THREADS 2, within the engine's 10 CPUs`; self-test 12 bad, 7 good, spawned failure non-zero |
| 4. `check-no-storage-writes` + `--self-test` | `9 scripts under scripts/ checked; none writes into the bucket outside the API`; self-test 12 bad, 7 good, spawned failure non-zero |
| 5. `generate-db-script --check` + `--self-test` | `db/create-database.sql is exactly what the migrations generate`; self-test 4 bad, 1 good, `--check` non-zero with a line removed |
| 6. `docker compose up --build -d --wait` | exit 0 |
| 7. `check-storage-bootstrap` + `--self-test` | `12 bootstrap scenarios passed; no fiapx-scenario-* bucket left`; self-test 12 scenarios, 38 bad, 19 good, 2 cleanup orders, spawned failure non-zero |
| 8. Smoke + `--self-test` | exit 0, all 30 steps, `processing failure reason` included; self-test 30 steps, 176 bad, 59 good, dry run in order, README names every step |
| 9. `check-identity` + `--self-test` | `check-identity: 6 identity checks passed`; self-test 6 checks, 23 bad, 6 good, spawned failure non-zero |
| 10. `up -d --wait --force-recreate identity storage-init api` | exit 0 |
| 11. Smoke and `check-identity` again | smoke exit 0 (30 steps); `6 identity checks passed` |
| 12. `docker compose down -v` | exit 0 |
| 13. `node scripts/check-docs-links.mjs` (the `docs-links` job's script) | `0 unresolved link(s)` |
| `check-ci-governance` | `integration job runs the 8 stack commands in order, with no skip path and no token; docs-links runs node scripts/check-docs-links.mjs unconditionally` |
| `check-ci-governance --self-test` | 28 bad workflows, 2 good; 12 bad rulesets, 3 good sets, 6 malformed checks files refused; spawned `--live` without `gh` auth exited 1 |
| `check-docs-links --self-test` | broken tree 3 unresolved and exit 1, good tree 0 and exit 0, both spawned runs as expected |
| `apply-required-checks --self-test` | passed: 5 change sets, the shrinking list replaced by exactly the versioned pairs (2 cases), a second apply changes nothing |
| `check-ci-governance --live` | exit 1, as expected until the go-ahead `--apply` (not a gate failure) |

`--live` (exit 1):

```
check-ci-governance: tech-challenge-workshop/fiap-x-api: missing [quality@15368, image@15368], unexpected [quality@-, image@-]
check-ci-governance: tech-challenge-workshop/processing-catalog: missing [quality@15368, image@15368], unexpected [quality@-, image@-]
check-ci-governance: tech-challenge-workshop/processing-worker: missing [quality@15368, image@15368], unexpected [quality@-, image@-]
check-ci-governance: tech-challenge-workshop/notification-service: missing [quality@15368, image@15368], unexpected [quality@-, image@-]
check-ci-governance: tech-challenge-workshop/fiap-x-platform: missing [topology@15368, docs-links@15368, integration@15368], unexpected [topology@-, docs-links@-, integration@-]
```

Still to do: push and open the PR, then wait for a green CI. After that, and only with the user's go-ahead, run `--apply` and then `--live`.

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3 T4) then Phase 2 (T5 T6 T7)
```

7 tasks, in this repository only. T7's push and PR happen in the PR step the user already approves by approving these tasks. The ruleset change waits for an explicit go-ahead.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | 1 check | ✅ Granular |
| T2 | 1 new script + its wiring | ⚠️ OK - cohesive |
| T3 | 1 data shape across its reader, writer and file | ⚠️ OK - cohesive |
| T4 | 1 function + doc wording | ⚠️ OK - cohesive (small) |
| T5 | 2 scenarios | ✅ Granular |
| T6 | 2 observations + 1 step | ✅ Granular |
| T7 | Rollout | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | None | — | ✅ Match |
| T4 | None | — | ✅ Match |
| T5 | None (Phase 1 complete) | — | ✅ Match |
| T6 | None (Phase 1 complete) | — | ✅ Match |
| T7 | None (Phase 1 complete; runs last) | — | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Gate script | self-test + integration | self-test (the integration half is the real run in `topology`) | ✅ OK |
| T2 | Gate script + workflow | self-test + integration | self-test (the integration half is the PR CI in T7) | ✅ OK |
| T3 | Gate scripts + required checks | self-test + integration | self-test + integration | ✅ OK |
| T4 | Gate script | self-test + integration | self-test | ✅ OK |
| T5 | Gate script | self-test + integration | integration + self-test | ✅ OK |
| T6 | Smoke steps | integration + self-test | integration + self-test | ✅ OK |
| T7 | Workflow + rulesets | integration | integration | ✅ OK |
