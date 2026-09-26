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

- [ ] Each of M10, M11, M14 and a `shell:` override fails the self-test with its exact message. The real `ci.yml` passes
- [ ] Reverting to the old line scan makes the new self-test cases fail
- [ ] Quick gate passes

**Tests**: self-test
**Gate**: quick

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

- [ ] The script exits 0 on the real tree
- [ ] Its self-test passes: broken tree → exit 1 with the exact message; good tree → exit 0; the spawned broken run exits non-zero
- [ ] Restoring `continue-on-error` on `docs-links` fails the workflow check (M8), and so does making the script exit 0 on missing links (M9)
- [ ] `yaml.safe_load` passes
- [ ] Quick gate passes

**Tests**: self-test
**Gate**: quick

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

- [ ] Self-tests reject a missing `integration_id`, a wrong one, and a non-empty `exclude` (M15). The shrinking-list case produces exactly the versioned list (M17)
- [ ] Red-first: `--live` fails today, naming every context without `@15368`
- [ ] `--dry-run` shows each context gaining `integration_id` 15368. Record its output. **Do not run `--apply`**
- [ ] Quick gate passes

**Tests**: self-test + integration
**Gate**: quick

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

- [ ] Self-test: `token: <jwt>` fails with a message containing `<jwt:` and not the token (near-miss: a JWT inside stderr)
- [ ] Removing `redact()` makes that case fail
- [ ] README, spec and context are updated, and docs-links reports 0 unresolved links
- [ ] Quick gate passes

**Tests**: self-test
**Gate**: quick

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

- [ ] Both scenarios pass on the stack. No scratch bucket is left
- [ ] Removing `Status=='Enabled'` from `correct()` in a scratch bootstrap fails `expire-disabled`, and removing `Filter.Prefix` fails `expire-narrowed` (K6 and K7)
- [ ] Full gate passes

**Tests**: integration + self-test
**Gate**: full

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

- [ ] The self-test requires the new step. It rejects the `FORMATO_INVALIDO` sentence and a truncated sentence, and rows for another id (naming both ids)
- [ ] A literal negative passes: a scratch smoke whose count query filters on the wrong column fails on the stack
- [ ] The real smoke is green
- [ ] Full gate passes

**Tests**: integration + self-test
**Gate**: full

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

- [ ] Build gate green
- [ ] PR CI green (`topology`, `docs-links`, `integration`)
- [ ] With the go-ahead: `--apply`, then `--live` passes, and the other rules are byte-identical to a before snapshot

**Tests**: integration
**Gate**: build

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
