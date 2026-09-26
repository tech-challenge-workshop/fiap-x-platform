## Validation: ci-governance — PASS with open items

# ci-governance Validation

**Date**: 2026-09-26
**Spec**: `.specs/features/ci-governance/spec.md`
**Diff range**: `76bdd6c..ecb2745` (branch `fix/ci-governance`, PR tech-challenge-workshop/fiap-x-platform#11)
**Verifier**: independent sub-agent (author ≠ verifier). Final round: leftovers are recorded as open items ("Validar depois").

Round result: every acceptance criterion holds on the delivered artifacts, and the live rulesets were confirmed. The workflow guard (`check-ci-governance.mjs`) is weaker than its README claims: 7 of 20 mutants survived. Two of the survivors re-open a skip path (O-1). None of them is present in the delivered `ci.yml`.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 | ✅ Done | Guard + self-test; `if: failure()` is allowed on any line (O-1) |
| T2 | ✅ Done | CI run 36275785436 (`c6c5e47`): `integration` ran all 8 stack steps and passed |
| T3 | ✅ Done | `--live` exit 0, run by the Verifier |
| T4 | ✅ Done | Rulesets applied. The `**Status**:` line at tasks.md:196 still reads "Complete except `--apply`", which is stale (O-6) |

---

## Spec-Anchored Acceptance Criteria

| Criterion | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| CIG-01 AC1: checkout without a token | Four services checked out with no token | `ci.yml:67-82`: no `token:` key and no `SERVICES_READ_TOKEN`. Guard at `check-ci-governance.mjs:147-151`. The log shows `token: ***`: `actions/checkout` passes the job's default `GITHUB_TOKEN`, but no secret or PAT is used | ✅ PASS (⚠️ spec-precision: "without a token" really means "without a PAT"; O-5) |
| CIG-02 AC2: the steps run in order | up, bootstrap, drift, smoke, identity, recreate, smoke, identity | `ci.yml:86-109`. Guard `STACK_COMMANDS` at `check-ci-governance.mjs:53-62`, exact sequence compared at :155-162. The CI log of run 36275785436 shows steps 8-15 all `success`: `10 bootstrap scenarios passed`, `db/create-database.sql is exactly what the migrations generate`, smoke output, `6 identity checks passed` twice, and identity/storage-init/api `Recreated` | ✅ PASS |
| CIG-02 AC3: any failing step fails the job | Job red | Default shell `bash -e {0}` (seen in the log). No `continue-on-error` (guard at :142-144). A shell-level mask inside a `run: \|` block is not detected (M14, O-2) | ✅ PASS |
| CIG-01 AC4: no pass-without-stack path | No such path | The delivered `ci.yml` has none. The only `if:` lines are `failure()` on log collection and upload (:111, :115) and `always()` on teardown (:121). Its guard lets `if: failure()` through on any stack step or on the job itself (M10, M11) | ✅ PASS today; ❌ guard gap (O-1) |
| CIG-02 AC5: logs uploaded on failure | Artifact on failure | `ci.yml:110-119` (`if: failure()`); teardown `down -v` `if: always()` at :120-123. On the green run the collect/upload steps were `skipped` and teardown was `success` | ✅ PASS (failure path not exercised in CI; see Edge cases) |
| CIG-04 AC1: services require quality + image | 4 rulesets | Verifier `gh api` GET of ids 23709829/16/09/23: contexts `[quality, image]`, `active`, `bypass_actors: []` | ✅ PASS |
| CIG-04 AC2: platform requires topology, docs-links, integration | 1 ruleset | id 23709782: `[topology, docs-links, integration]` | ✅ PASS |
| CIG-03 AC3: versioned in the platform | File | `ci/required-checks.json`. The self-test pins it to `DECIDED_CHECKS` (`check-ci-governance.mjs:388-456`). Mutant M19 was killed | ✅ PASS |
| CIG-03 AC4: the check fails on drift, naming the repo and the difference | `<repo>: missing [..], unexpected [..]` | `check-ci-governance.mjs:217-222`. Self-test at :399-400 and :439-443. Verifier ran `--live`: exit 0, `the 5 "protect main" rulesets require exactly the checks in ci/required-checks.json` | ✅ PASS |
| CIG-03 AC5: `--self-test` rejects missing, extra and wrong target, accepts exact, calls no GitHub | As stated | :398-431. Rulesets are injected. The only spawned `gh` is `gh auth status` with an empty `GH_CONFIG_DIR` and the token vars removed (:557-567), so there is no network or API call | ✅ PASS |

Other rules intact: the Verifier diffed the full live JSON against `scratchpad/ruleset-before-*.json`, ignoring timestamps, links, `node_id` and the checks list. **All 5 are identical.** `strict_required_status_checks_policy: false` and `do_not_enforce_on_create: false` are kept.

**Status**: ✅ All ACs covered; 1 spec-precision gap (the token wording).

---

## Discrimination Sensor

Run in a scratch `git worktree` at `ecb2745`, removed afterwards. Each mutant was run through three gates: the workflow check, `check-ci-governance --self-test` and `apply-required-checks --self-test`. `--dry-run` was mutated and exercised only through the self-test's injected fake PUT, never against GitHub.

| # | File | Mutation | Killed? |
| --- | --- | --- | --- |
| M1 | ci.yml | `if: steps.access…` on `up --build` | ✅ Killed (workflow check) |
| M2 | ci.yml | `continue-on-error: true` on `integration` | ✅ Killed |
| M3 | ci.yml | drop the second smoke | ✅ Killed |
| M13 | ci.yml | `smoke … \|\| true` | ✅ Killed (command no longer matches) |
| M10 | ci.yml | `if: failure()` on the second-smoke step | ❌ Survived |
| M11 | ci.yml | job-level `if: failure()` on `integration` | ❌ Survived |
| M14 | ci.yml | first smoke as `run: \|` with `set +e` / smoke / `exit 0` | ❌ Survived |
| M8 | ci.yml | `continue-on-error: true` on `docs-links` | ❌ Survived (no automated guard) |
| M9 | ci.yml | docs-links `raise SystemExit(0)` | ❌ Survived (no automated guard) |
| M4 | check-ci-governance.mjs:219 | `--live` ignores extra checks | ✅ Killed (self-test) |
| M5 | :207 | `--live` accepts any enforcement | ✅ Killed |
| M5b | :207 | `--live` accepts `evaluate` | ✅ Killed |
| M16 | :218 | `--live` ignores missing checks | ✅ Killed |
| M15 | :212 | `--live` accepts a non-empty `exclude` | ❌ Survived |
| M19 | required-checks.json | drop `docs-links` | ✅ Killed (file pinned) |
| M6 | apply:51 | transform drops `required_linear_history` | ✅ Killed (apply self-test) |
| M6b | apply:53 | transform drops the other checks-rule params | ✅ Killed |
| M7 | apply:93 | `--dry-run` also PUTs (injected fake) | ✅ Killed |
| M18 | apply:89 | always PUT, even when unchanged | ✅ Killed |
| M17 | apply:53 | transform appends missing checks, keeping stale extras, instead of replacing | ❌ Survived |

**Sensor depth**: expanded (20 mutations).
**Result**: 13/20 killed. All 9 suggested mutants were run: 7 were killed (M1, M2, M3, M4, M5, M6, M7) and 2 survived (M8, M9).

Live corroboration for the docs-links mutants: CI run 36275358055 (`7e30f5a`) had `docs-links` = **failure** with `4 unresolved link(s)`. The blocking job does fail in real CI. Only regression protection is missing.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ |
| Surgical changes | ✅ Only ci.yml, 2 scripts, 1 json, README, specs |
| No scope creep | ✅ The `continue-on-error` rule and the pinned file are justified extras |
| Matches patterns | ✅ Same self-test shape as check-identity / check-worker-sizing |
| Spec-anchored outcome check | ✅ Exact messages asserted |
| Every test maps to a requirement | ✅ |
| Documented guidelines followed | ⚠️ `apply-required-checks.mjs --self-test` is not in CI's `topology` job (only in the local build gate, README step 14), so a regression there is not caught on a PR (L-018) |

---

## Edge Cases

- [x] Service `main` broken → `integration` red, blocking platform PRs (intended; services are checked out at their default branch).
- [x] Service PR where `quality` fails. `image` has `needs: quality` in all four service workflows, which the Verifier read through `gh api`, and no `if:`. `image` is then **skipped**, and GitHub counts a skipped job as **success** for a required check. But `quality` is itself required and red, so the merge stays blocked. **Safe today.** It stops being safe if `quality` is ever dropped from the rulesets, or if `image` gains a condition.
- [x] Check names match what reports. No job has a `name:` override. The PR #11 rollup reports exactly `topology`, `docs-links` and `integration`, and each service's jobs are `quality` and `image`. There is no `integration_id` pinning on the contexts, so any status or app posting that context name would satisfy it (low; O-7).
- [ ] Skipped required check = success. This is exactly why O-1 matters. A job-level `if: failure()` (M11) makes `integration` skip on every green `topology`, and the ruleset accepts the skip.
- [ ] The log-upload path was never exercised on a real red `integration` run. The steps are correct by inspection only.

---

## Gate Check

- **Commands** (run by the Verifier on the real tree at `ecb2745`):
  - `check-ci-governance.mjs`: exit 0.
  - `check-ci-governance.mjs --self-test`: exit 0 (10+2 workflow cases, 8+3 ruleset cases, spawned cases).
  - `check-ci-governance.mjs --live`: exit 0.
  - `apply-required-checks.mjs --self-test`: exit 0.
- **CI**:
  - Run 36275785436 (`c6c5e47`): topology, docs-links and integration all success. Integration ran the 8 stack steps; its log is saved at `scratchpad/verify/int-c6c5e47.log`.
  - Run 36276227331 (`ecb2745`, docs-only change on top): see the addendum at the end.
- **apply `--dry-run` / idempotence**: the dry-run branch never reaches `put` (killed M7). Unchanged rulesets are skipped (killed M18), so a re-run is a no-op. The PUT sends only the writable fields.

---

## Fix Plans (open items for "Validar depois")

### O-1 (Major): The workflow guard accepts `failure()` as a gate anywhere in `integration`
- **Where**: `scripts/check-ci-governance.mjs:133-141`.
- **Failure scenario**: someone adds `if: failure()` at the job level (M11). `integration` is then skipped whenever `topology` passes. GitHub reports a skipped required check as success, so platform PRs merge with no stack run: V11 again, and the guard stays green. M10 (`if: failure()` on a stack step) silently drops that step.
- **Fix task**: allow `failure()` only on the two log steps and `always()` only on teardown. Reject any job-level `if:`. Require every stack-command step to have no `if:`. Add M10 and M11 as self-test near-misses.

### O-2 (Minor): Shell-level masking is invisible to the text parser
- **Where**: `check-ci-governance.mjs:104-122`.
- **Failure scenario**: a `run: |` block with `set +e` / smoke / `exit 0` (M14) passes the guard, and a failing smoke yields a green job.
- **Fix task**: require each stack command to be a one-line `run:` equal to the command, and reject `shell:` overrides in the job.

### O-3 (Minor): `docs-links` has no regression guard
- **Where**: `ci.yml:125-151`.
- **Failure scenario**: restoring `continue-on-error: true` (M8) or `SystemExit(0)` (M9) passes every gate, and the required check degrades back to "it ran".
- **Fix task**: extend the workflow check to the `docs-links` job (no `continue-on-error`; script ends in a non-zero exit on `missing`). Or move the script to `scripts/check-docs-links.mjs|py` with a `--self-test`.

### O-4 (Minor): the `--live` exclude rule is untested
- **Where**: `check-ci-governance.mjs:212`.
- **Failure scenario**: the mutant removing `exclude.length !== 0` survives (M15). That is harmless today, but the "default branch alone" rule is untested.
- **Fix task**: add an `exclude: ['refs/heads/main']` near-miss to `liveSelfTest`.

### O-5 (Cosmetic / spec-precision): "without a token"
- **Where**: `ci.yml:67-82`.
- **Detail**: `actions/checkout` still sends the job's default `GITHUB_TOKEN`. Reword spec, README and context to "without a PAT/secret", or accept it as is.

### O-6 (Cosmetic): Stale status lines
- **Where**:
  - tasks.md:196, the T4 `**Status**` line, still says `--apply` is pending.
  - spec.md:96-99 still says `Implementing`; it should become `Verified`, per the traceability update below.

### O-7 (Low): apply transform and CI coverage
- `withRequiredChecks` is only tested with a list that grows. An append-instead-of-replace transform survives (M17). The runtime `--live` would still catch leftover checks. **Fix**: add a self-test case whose read list has an extra check (`['quality','lint']` → `[quality, image]`).
- `apply-required-checks.mjs --self-test` is not run in CI's `topology` job. **Fix**: add it there.
- Contexts carry no `integration_id` (see Edge Cases). **Fix** (optional): pin them to the GitHub Actions app id.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| CIG-01 | Implementing | ✅ Verified (guard gap O-1 open) |
| CIG-02 | Implementing | ✅ Verified |
| CIG-03 | Implementing | ✅ Verified |
| CIG-04 | Implementing | ✅ Verified |

---

## Summary

**Overall**: ⚠️ Ready, with open items.
**Spec-anchored check**: 10/10 ACs matched the spec outcome; 1 spec-precision gap (the token wording).
**Sensor**: 13/20 killed. Survivors: M8, M9, M10, M11, M14, M15, M17.
**Gate**: 4/4 local commands passed; CI green on `c6c5e47`.

**What works**:
- The `integration` job really runs the stack in CI.
- The rulesets are applied, and they are exact and otherwise untouched.
- `--live` is correct and discriminating.
- The apply script preserves rules, its dry run writes nothing, and it is idempotent.
- `docs-links` truly blocks: it was red on `7e30f5a`.

**Issues found**: O-1 through O-7 above.
**Next steps**: record O-1 through O-7 in "Validar depois". O-1 first.

---

## Lessons signal

- **A "skip path" guard must treat `failure()` as a gate, not as benign.** In GitHub Actions, a job-level `if:` that evaluates false produces a *skipped* job, and a skipped required check counts as success. Allow-listing an expression is not enough. Allow-list *which step* may carry it.
- **Text-level workflow guards should pin step shape, not only command order.** A command inside a multi-line `run: |` block can be masked by the shell (`set +e`, `exit 0`).
- **When a check is promoted to "required", its neutering (`continue-on-error`, exit 0) needs the same regression guard as the job it was modelled on.** Otherwise the promotion is not durable.
- **Replacement transforms need a shrinking-list test case, not only a growing one.** An append implementation passes every growing-list case.
- **Positive evidence:** red-first stubs, exact-message assertions, and a before/after full-JSON diff of the live settings made CIG-03 and CIG-04 fully verifiable read-only. Keep this pattern for any settings-as-code change.
