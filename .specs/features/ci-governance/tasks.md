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

- [ ] `node scripts/check-ci-governance.mjs` passes on the new workflow
- [ ] The workflow parses (Python `yaml.safe_load`)
- [ ] The job's commands run locally, in order, against a fresh stack, with the port overrides this machine needs: the equivalent of the build gate. Record the result
- [ ] Removing one stack command makes the workflow check fail
- [ ] CI evidence comes when the PR is opened: `integration` must run the stack and go green. Record it in the Status note after the push. This is not a local gate item

**Tests**: integration
**Gate**: build (workflow check + local stack run)

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

- [ ] The self-test rejects a missing check, an extra check and a wrong target, and accepts an exact match. None of these call GitHub
- [ ] `--live` currently fails, naming the missing `image`, `docs-links` and `integration`. This is the red-first step
- [ ] `--live` fails with a clear message when `gh` is not authenticated
- [ ] Quick gate passes

**Tests**: self-test + integration
**Gate**: quick

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
