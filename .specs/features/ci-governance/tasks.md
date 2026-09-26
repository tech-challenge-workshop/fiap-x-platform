# CI Governance Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/ci-governance/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — confirm before Execute. Same pattern as `platform-gate-hardening/tasks.md`. Candidate lessons L-016 (every matrix check is a gate command) and L-018 (versioned harnesses run by the gate) apply.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Gate script | self-test + integration | Every check gets a bad, a near-miss and a good input, with exact messages; the script is spawned with a forced failure; the real run passes | `scripts/check-ci-governance.mjs` | the script, its `--self-test` and `--live` |
| Workflow | integration | The `integration` job runs green on the PR that delivers it, and its log shows the stack steps | `.github/workflows/ci.yml` | CI |
| Rulesets | integration | After applying, `--live` passes for all five repositories | `ci/required-checks.json` | `node scripts/check-ci-governance.mjs --live` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Script changes | `node --check scripts/<changed>.mjs && node scripts/<changed>.mjs --self-test` |
| Build | Last task | `node scripts/check-ci-governance.mjs && node scripts/check-ci-governance.mjs --self-test && node scripts/check-ci-governance.mjs --live`, every other script's `--self-test`, and the docs-links script from `ci.yml` |

---

## Execution Plan

### Phase 1: The integration job

```
T1 -> T2
```

### Phase 2: Required checks

```
T3 -> T4
```

---

## Task Breakdown

### T1: Guard the workflow against a skip path

**What**: Add the workflow check to `scripts/check-ci-governance.mjs`, with its `--self-test`. The check runs in CI's `topology` job. The real run must fail on today's `ci.yml`: this is the red-first step.
**Where**: `scripts/check-ci-governance.mjs`
**Depends on**: None
**Reuses**: The self-test shape of `check-identity.mjs`
**Requirement**: CIG-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The self-test rejects each of these, with its exact message: a `steps.access` gate, a token reference, a missing smoke, and a reordered recreate (the near-miss). It accepts a correct block. A spawned gated copy exits non-zero
- [x] The real run fails on the current `ci.yml`, naming the `steps.access` condition
- [x] The `topology` job runs `--self-test`. The real check joins it in T2
- [x] Quick gate passes (self-test)

**Tests**: self-test
**Gate**: quick
**Status**: ✅ Complete
**Evidence**:
- **Red first.** The self-test was written against a stub that reported no problem: all 10 bad workflows were accepted and the spawned gated copy exited 0 with nothing on stderr (12 failures).
- **Self-test.** `10 bad workflows rejected with the expected message, 2 good workflows accepted, spawned gated copy exited non-zero`. Bad: a `steps.access` gate, a token reference, the first smoke missing, the recreate before the first identity check (near-miss), `failure() && steps.access…` (near-miss), `continue-on-error`, no `integration` job, a recreate without `storage-init` (near-miss), an extra smoke, no stack command at all. The spawned run must print exactly the gate's line on stderr; a spawned correct copy must exit 0.
- **Real run on the old `ci.yml`.** Exit 1: ten `if:` lines named, the first `line 72: the integration job is conditioned on "steps.access.outputs.available == 'true'"; only failure() or always() may gate its steps`; five `SERVICES_READ_TOKEN` lines; and `integration stack step 2 must be "node scripts/check-storage-bootstrap.mjs", but it is "node scripts/smoke-local-integration.mjs"`.
- **Literal negatives** (scratch copies): no `if:` rule → 4 self-test failures; no token rule → 1; no order comparison → 5.
- **Beyond the task.** `continue-on-error` inside the job is also rejected: it is a pass-without-the-stack path (CIG-01 AC4).

---

### T2: Run the stack in the integration job, every time

**What**: Rewrite the `integration` job as design.md describes:

- anonymous checkouts;
- no `access` step;
- the eight stack commands in order;
- logs uploaded on failure, and `down -v` always;
- `timeout-minutes: 45`.

Also add the real workflow check to `topology`.

**Where**: `.github/workflows/ci.yml`
**Depends on**: T1
**Reuses**: The build gate's steps 6–12
**Requirement**: CIG-01, CIG-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `node scripts/check-ci-governance.mjs` passes on the new workflow
- [x] The workflow parses (Python `yaml.safe_load`)
- [x] The job's commands run locally, in order, against a fresh stack, with the port overrides this machine needs: the equivalent of the build gate. Record the result
- [x] Removing one stack command makes the workflow check fail
- [ ] CI evidence comes when the PR is opened: `integration` must run the stack and go green. Record it in the Status note after the push. This is not a local gate item

**Tests**: integration
**Gate**: build (workflow check + local stack run)
**Status**: ✅ Complete locally; CI evidence pending the PR
**Evidence**:
- **Change.** The `access` step, every `steps.access` condition and every `token:` are gone. The four services are checked out anonymously at their default branch, with the same `path:` as before. The eight stack commands run in order in `working-directory: fiap-x-platform`; logs are collected and uploaded `if: failure()`, and `docker compose down -v` runs `if: always()`. `timeout-minutes: 45`. `topology` now also runs the real check.
- **Real check.** `integration job runs the 8 stack commands in order, with no skip path and no token`, exit 0. `yaml.safe_load` parses the file.
- **Negatives** (scratch copies of the new `ci.yml`, via `CI_WORKFLOW_PATH`): without the bootstrap step → `integration stack step 2 must be "node scripts/check-storage-bootstrap.mjs", but it is "node scripts/generate-db-script.mjs --check"`, exit 1; without the recreate → `integration stack step 6 must be "docker compose up -d --wait --force-recreate identity storage-init api", but it is "node scripts/smoke-local-integration.mjs"`, exit 1.
- **Local stack run** (siblings on `main`, clean: api `323fc3a`, catalog `2eaab23`, worker `ddfef84`, notification `f82bf09`; `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002`; `clean-appledouble.mjs` on the workspace root first): 1 `up --build -d --wait` rc 0 (49 s); 2 `10 bootstrap scenarios passed; no fiapx-scenario-* bucket left` (118 s); 3 `db/create-database.sql is exactly what the migrations generate`; 4 smoke rc 0 (10 s); 5 `6 identity checks passed`; 6 `--force-recreate identity storage-init api` rc 0 (39 s); 7 smoke rc 0 (10 s); 8 `6 identity checks passed`; then `down -v` rc 0.
- **Gotcha.** `clean-appledouble.mjs` cleans its working directory by default; run from `fiap-x-platform` it left `._*` files in the siblings and BuildKit failed on `._ci.yml`. Pass the workspace root. CI is unaffected.
- **Beyond the design.** The job gains `actions/setup-node@v4` (Node 22), as in `topology`, so the scripts run on the same Node as elsewhere rather than the runner's default.

---

### T3: Version the required checks and compare them with the live rulesets

**What**: Add `ci/required-checks.json` and the `--live` mode of `check-ci-governance.mjs`, with `--self-test` cases for the live comparison.
**Where**: `ci/required-checks.json` (+ `scripts/check-ci-governance.mjs`)
**Depends on**: None (Phase 1 complete)
**Reuses**: `gh api`
**Requirement**: CIG-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The self-test rejects a missing check, an extra check and a wrong target, and accepts an exact match. None of these call GitHub
- [x] `--live` currently fails, naming the missing `image`, `docs-links` and `integration`. This is the red-first step
- [x] `--live` fails with a clear message when `gh` is not authenticated
- [x] Quick gate passes

**Tests**: self-test + integration
**Gate**: quick
**Status**: ✅ Complete
**Evidence**:
- **Red first.** The live cases were written against stubs that reported no problem and a `--live` that exited 0: 11 self-test failures (8 bad rulesets accepted, the drifted repository not named, the versioned file not read, the unauthenticated `--live` exiting 0).
- **Self-test.** `8 bad rulesets rejected with the expected message, 3 good ruleset sets accepted, one drifted repository named alone, the versioned file matches the spec, spawned --live without gh authentication exited 1`, beside the 10 + 2 workflow cases. Bad: a missing check, an extra check, `refs/heads/main` instead of `~DEFAULT_BRANCH` (near-miss), target `tag` (near-miss), enforcement `evaluate`, the name `protect-main` (near-miss), two rulesets named `protect main`, no `required_status_checks` rule. Good: an exact match, the same checks in another order beside an unrelated ruleset, and five-repository input where all match. The rulesets are injected; nothing calls GitHub. The unauthenticated case spawns `--live` with an empty `GH_CONFIG_DIR` and no token variables, and requires exit 1 with `gh is not authenticated; --live reads the rulesets`.
- **Red-first `--live`** (read-only `gh api` GETs), exit 1:
  ```
  check-ci-governance: tech-challenge-workshop/fiap-x-api: missing [image], unexpected []
  check-ci-governance: tech-challenge-workshop/processing-catalog: missing [image], unexpected []
  check-ci-governance: tech-challenge-workshop/processing-worker: missing [image], unexpected []
  check-ci-governance: tech-challenge-workshop/notification-service: missing [image], unexpected []
  check-ci-governance: tech-challenge-workshop/fiap-x-platform: missing [docs-links, integration], unexpected []
  ```
- **Literal negatives** (scratch copies): no target rule → 1 self-test failure; no enforcement rule → 1; `unexpected` always empty → 2; no authentication check → 1.
- **Beyond the task.** The target must be `~DEFAULT_BRANCH` alone, on `branch`, with no exclusion; a duplicate `protect main` is rejected; the self-test also pins `ci/required-checks.json` to the spec's lists, so the file cannot be weakened without a red self-test. The script's modes now run only when it is executed, so `apply-required-checks.mjs` can import the ruleset helpers.
- **Note for CI.** The `topology` job's `--self-test` now spawns `gh auth status`; `gh` is preinstalled on `ubuntu-latest`.

---

### T4: Apply the required checks and document the governance

**What**:

- Add `scripts/apply-required-checks.mjs` with `--dry-run` and `--apply`.
- Update the README: the new script, the versioned checks, and that `integration` now always runs the stack.
- Apply the checks: `--apply` runs only after the user's explicit go-ahead for the GitHub change.

**Where**: `scripts/apply-required-checks.mjs` (+ `README.md`)
**Depends on**: T3
**Reuses**: The live ruleset `GET`
**Requirement**: CIG-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `--dry-run` prints, for each repository, the checks it would add and changes nothing
- [ ] **With the user's go-ahead:** `--apply` updates all five rulesets, and every other rule (deletion, non_fast_forward, linear history, pull_request) is unchanged. Compare the full JSON before and after
- [ ] `--live` then passes
- [ ] README updated, with 0 unresolved links
- [ ] Build gate passes

**Tests**: integration
**Gate**: build

---

## Phase Execution Map

```
Phase 1 (T1 T2) then Phase 2 (T3 T4)
```

4 tasks, this repository only. The GitHub settings change (T4's `--apply`) waits for an explicit go-ahead.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | 1 check mode + self-test | ✅ Granular |
| T2 | 1 workflow job | ✅ Granular |
| T3 | 1 file + 1 check mode | ⚠️ OK - cohesive; the mode reads the file |
| T4 | 1 script + README + the settings change | ⚠️ OK - cohesive; the script exists to make that change |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | None (Phase 1 complete) | — | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Gate script | self-test + integration | self-test (the integration half is T2's real run) | ✅ OK |
| T2 | Workflow | integration | integration | ✅ OK |
| T3 | Gate script + required checks | self-test + integration | self-test + integration | ✅ OK |
| T4 | Rulesets (+ script, docs) | integration | integration | ✅ OK |
