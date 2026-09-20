# CI Pipeline Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/ci-pipeline/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: none in this repository - it has no `package.json`, no test runner and no source. Strong defaults applied, adapted to a repository whose only artefacts are configuration and documentation.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| GitHub Actions workflow | none | Build gate only. A workflow has no unit-testable surface; its behaviour is verified by observing a real check run, which T6 does explicitly. | `.github/workflows/*.yml` | build gate only |
| Compose topology | integration | The topology renders, and the full stack reaches a completed processing request through the smoke script. | `compose.yaml` | `docker compose config -q` then `docker compose up --build` + `node scripts/smoke-local-integration.mjs` |
| Integration script | none | Syntax-checked only. The script has no dependencies and its behaviour is exercised by running it against the live stack in T4. | `scripts/*.mjs` | `node --check scripts/smoke-local-integration.mjs` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After editing the workflow file | `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"` |
| Full | After a topology or script change | `docker compose config -q && node --check scripts/smoke-local-integration.mjs` |
| Build | After phase completion | `docker compose config -q && node --check scripts/smoke-local-integration.mjs && docker compose up --build -d && node scripts/smoke-local-integration.mjs; docker compose down -v` |

**Note**: the Build gate starts the real stack and therefore requires the four service repositories checked out as siblings of this one.

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Topology gate

```
T1 → T2 → T3
```

### Phase 2: Integration and reporting

```
T4 → T5
```

### Phase 3: Verification on the platform

```
T6
```

---

## Task Breakdown

### T1: Create the workflow with the topology job

**What**: Add `ci.yml` with a `topology` job that checks out only this repository, renders `compose.yaml` with `docker compose config`, and asserts every service declares a build context or an image.
**Where**: `.github/workflows/ci.yml`
**Depends on**: None
**Reuses**: `compose.yaml`
**Requirement**: CI-01, CI-02, CI-04, CI-05, CI-06, CI-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Triggers are `pull_request` targeting `main` and `push` to `main`
- [ ] The job is named `topology`, matching the required status check contract in the design
- [ ] `docker compose config` runs and a non-zero exit fails the job
- [ ] Every service in the rendered output is asserted to declare `build` or `image`, naming any offender
- [ ] The job checks out no other repository and references no secret
- [ ] Quick gate passes: the workflow file parses as YAML

**Tests**: none
**Gate**: quick

---

### T2: Add the smoke script syntax check

**What**: Add a step that sets up Node 22 and runs `node --check` against the smoke script.
**Where**: `.github/workflows/ci.yml` (modify)
**Depends on**: T1
**Reuses**: `scripts/smoke-local-integration.mjs`
**Requirement**: CI-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `actions/setup-node` pins Node 22
- [ ] `node --check scripts/smoke-local-integration.mjs` runs and a non-zero exit fails the job
- [ ] Full gate passes: `docker compose config -q && node --check scripts/smoke-local-integration.mjs`

**Tests**: none
**Gate**: full

---

### T3: Add concurrency control and job timeout

**What**: Add a per-ref concurrency group that cancels superseded runs, and a 10-minute timeout on the `topology` job.
**Where**: `.github/workflows/ci.yml` (modify)
**Depends on**: T2
**Reuses**: None
**Requirement**: CI-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `concurrency` groups by workflow and ref with `cancel-in-progress: true`
- [ ] The `topology` job declares `timeout-minutes: 10`
- [ ] Quick gate passes: the workflow file parses as YAML

**Tests**: none
**Gate**: quick

---

### T4: Add the guarded cross-repository integration job

**What**: Add an `integration` job that checks out all five repositories as siblings inside the workspace, starts the stack, runs the smoke script, uploads container logs on failure, and always tears down - skipping entirely when the cross-repository token is absent.
**Where**: `.github/workflows/ci.yml` (modify)
**Depends on**: T3
**Reuses**: `compose.yaml`, `scripts/smoke-local-integration.mjs`, the Compose health checks
**Requirement**: CI-08, CI-09, CI-10, CI-11, CI-12, CI-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] This repository is checked out into its own subdirectory and the four services beside it, so `build: ../fiap-x-api` resolves unchanged
- [ ] `compose.yaml` is not modified to make CI work
- [ ] The job declares `needs: topology`
- [ ] The smoke script runs against the live stack and a non-zero exit fails the check run
- [ ] Teardown runs under `if: always()`
- [ ] Container logs are uploaded as an artifact when the stack fails to become healthy
- [ ] When the token is absent the job is skipped and the pull request check remains green
- [ ] The job declares `timeout-minutes: 20`
- [ ] Build gate passes locally with the four siblings checked out

**Tests**: integration
**Gate**: build

---

### T5: Add the informational documentation link check

**What**: Add a `docs-links` job that reports relative links in `README.md` and `docs/` that do not resolve, without failing the run.
**Where**: `.github/workflows/ci.yml` (modify)
**Depends on**: T4
**Reuses**: None
**Requirement**: CI-14, CI-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Unresolved relative links are listed in the job output
- [ ] The job cannot fail the check run
- [ ] The known-absent `docs/FIAP X.pdf` appears as a report line, not as a failure
- [ ] Quick gate passes: the workflow file parses as YAML

**Tests**: none
**Gate**: quick

---

### T6: Verify the workflow on a real pull request

**What**: Open a pull request, confirm the check behaves correctly by injecting and reverting a deliberate topology error, then record the exact check name for branch protection.
**Where**: `.specs/features/ci-pipeline/design.md` (record the observed check name)
**Depends on**: T5
**Reuses**: The branch protection rule already configured on `main`
**Requirement**: CI-04, CI-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A pull request to `main` shows the `topology` check running
- [ ] A deliberately malformed `compose.yaml` turns the check red at the config step
- [ ] Reverting that error turns the check green
- [ ] The `integration` job either passes or reports as skipped, and in neither case blocks the pull request
- [ ] The exact `topology` check name is recorded in the design so it can be selected as a required status check
- [ ] No unrelated change remains in the branch

**Tests**: none
**Gate**: build

**Commit**: `ci: add topology and integration gates`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 ------→ T2 ------→ T3
Phase 2:  T4 ------→ T5
Phase 3:  T6

Phase boundaries (the last task of a phase gates the first task of the next):
          T3 ------→ T4
          T5 ------→ T6
```

Total: 6 tasks. This packs into a single batch (below the ~7-task worker budget), so Execute runs inline with no sub-agents dispatched.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Workflow with topology job | 1 file, 1 job | ✅ Granular |
| T2: Script syntax check | 1 step pair | ✅ Granular |
| T3: Concurrency and timeout | 2 cohesive settings, 1 file | ✅ Granular |
| T4: Integration job | 1 job | ✅ Granular |
| T5: Documentation link check | 1 job | ✅ Granular |
| T6: Verify on a pull request | 1 observable outcome | ✅ Granular |

T4 is the largest task here and was considered for a split. It stays whole because its parts - sibling checkout, stack start, smoke run, teardown - are one dependency chain that cannot be verified in isolation: a checkout without a stack proves nothing, and a stack without teardown must never be committed.

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | no inbound arrow | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 (phase boundary) | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 (phase boundary) | ✅ Match |

No task depends on a task in a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | GitHub Actions workflow | none | none | ✅ OK |
| T2 | GitHub Actions workflow | none | none | ✅ OK |
| T3 | GitHub Actions workflow | none | none | ✅ OK |
| T4 | GitHub Actions workflow + Compose topology | integration (highest of the two) | integration | ✅ OK |
| T5 | GitHub Actions workflow | none | none | ✅ OK |
| T6 | GitHub Actions workflow | none | none | ✅ OK |

T4 takes the highest required type of the layers it touches: it modifies the workflow (`none`) but exercises the Compose topology (`integration`), so it carries the integration verification rather than deferring it. T6 verifies the workflow itself against a real check run.
