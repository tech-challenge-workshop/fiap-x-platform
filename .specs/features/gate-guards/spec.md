# Gate Guards Specification

## Problem Statement

The Verifiers of specs C and D left gaps in the platform's own guards:

- **CI guard (V50).** `check-ci-governance.mjs` accepts `if: failure()` anywhere in the `integration` job. A job-level `if: failure()` would skip `integration` on every green `topology`. GitHub counts a skipped required check as success, so platform PRs could merge again without the stack running, and the guard would stay green.
- **Smaller holes in the same guards (V51):**
  - shell masking inside a multi-line `run:`;
  - no guard keeps `docs-links` blocking;
  - some test cases are missing;
  - the required checks are not pinned to the GitHub Actions app.
- **Bootstrap scenarios (V42).** They exercise only the abort rule's variations, so a disabled or narrowed expiry rule passes as "already configured".
- **`check-identity` (V43).** It can print a live token when its own check fails.
- **Smoke observations (V44).** Some echo the id they were queried with instead of reading it from the result.

## Goals

- [ ] No change to `ci.yml` can let `integration` pass or be skipped without running the stack while the guard stays green
- [ ] Each bootstrap predicate, for every owned rule, is killed by a scenario
- [ ] No gate script prints a credential, and every smoke observation proves which record it read

## Out of Scope

| Feature | Reason |
| --- | --- |
| Observing the real identity-before-API start order | Decided: reading `depends_on` is accepted and documented |
| Service code (V45–V49, V40, V41) | Specs F and G |
| New CI jobs | This feature hardens the existing guards; it adds no job |

---

## Assumptions & Open Questions

Decisions of 2026-09-26 are in `context.md` beside this spec.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Which `if:` expressions `integration` may carry | Exactly three steps may be conditioned: the two log steps (`failure()`) and the teardown (`always()`). Nothing else may be, including the job itself | Allow-listing the step as well as the expression is what closes V50 | y |
| Stack-step shape | Each of the eight stack commands is its own step, whose `run:` is exactly the command on one line. The job sets no `shell:` override | A one-line command cannot be wrapped in `set +e` / `exit 0` | y |
| `docs-links` | The link check moves to `scripts/check-docs-links.mjs`, with a `--self-test`. The workflow check requires the `docs-links` job to run that script, with no `continue-on-error` and no condition | A script with its own self-test is guarded the same way as the others | y |
| `integration_id` | Every required context in `ci/required-checks.json` carries `integration_id: 15368`. `--live` compares context and app. `apply` writes both | Decided | y |
| Token redaction | A JWT in a failure message is replaced by `<jwt: N chars>` | The failure's shape stays visible, and its value never does | y |
| `failureReason` through the API | A smoke step reads the processing-failed request through `GET /processing-requests/:id` as `alice`, and requires the exact sentence | It is the path a user sees; the delivery record is an internal view | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: The CI guard has no loophole ⭐ MVP

**User Story**: As the project owner, I want the CI guard to reject every way of skipping or masking the stack run, so that a green `integration` always means the stack ran.

**Why P1**: V50 would silently undo V11.

**Acceptance Criteria**:

1. IF the `integration` job has a job-level `if:` THEN the workflow check SHALL fail naming it.
2. IF any step other than the two log steps carries `failure()`, or any step other than the teardown carries `always()`, THEN the workflow check SHALL fail naming the step.
3. IF a stack command is not a step whose `run:` is exactly that command on one line THEN the workflow check SHALL fail naming the command.
4. IF the `integration` job sets `shell:` THEN the workflow check SHALL fail.
5. WHEN `--self-test` runs THEN it SHALL reject each of the Verifier's surviving mutants M10, M11 and M14, each with its exact message.

**Independent Test**: A copy of `ci.yml` with a job-level `if: failure()` fails the check. So does a copy where the smoke step is `set +e; node scripts/smoke-local-integration.mjs; exit 0`.

---

### P2: `docs-links` stays blocking ⭐ MVP

**User Story**: As a reviewer, I want the docs-links check guarded like every other gate, so that it cannot drift back to informational.

**Why P2**: V51 (M8, M9).

**Acceptance Criteria**:

1. The link check SHALL live in `scripts/check-docs-links.mjs` and exit 1 on any unresolved relative link in `README.md` or `docs/`.
2. WHEN its `--self-test` runs THEN it SHALL reject a README with a broken link, accept one whose links resolve, and spawn itself on a broken tree requiring exit 1.
3. IF the `docs-links` job sets `continue-on-error`, carries an `if:`, or does not run the script THEN the workflow check SHALL fail.

**Independent Test**: Restoring `continue-on-error: true` on `docs-links` fails the workflow check.

---

### P3: Required checks are pinned and fully tested

**User Story**: As the project owner, I want each required check tied to the app that posts it, and every mode of the ruleset tools covered by a test.

**Why P3**: V51 (M15, M17, CI coverage, `integration_id`).

**Acceptance Criteria**:

1. Every context in `ci/required-checks.json` SHALL carry `integration_id: 15368`.
2. IF a live ruleset's context lacks that `integration_id`, or has another one, THEN `--live` SHALL fail naming it.
3. WHEN the `--live` self-test runs THEN it SHALL reject a ruleset whose conditions have a non-empty `exclude`.
4. WHEN the apply self-test runs THEN it SHALL show that a live list with an extra check comes out exactly as the versioned list, with the extra check removed.
5. CI's `topology` job SHALL run `apply-required-checks.mjs --self-test`.
6. WHEN the user gives the go-ahead THEN `apply` SHALL pin the five rulesets, and `--live` SHALL then pass.

**Independent Test**: `--dry-run` shows each context gaining `integration_id` 15368. After `--apply`, `--live` passes.

---

### P4: Every owned bootstrap rule is scenario-tested

**User Story**: As the operator, I want every owned lifecycle rule tested against being disabled or narrowed, so that a regression in `correct()` cannot leave archives unexpired.

**Why P4**: V42 (K6, K7).

**Acceptance Criteria**:

1. WHEN `expire-disabled` runs, with `expire-zips` set to `Disabled`, THEN the bootstrap SHALL rewrite it to the owned rule.
2. WHEN `expire-narrowed` runs, with `expire-zips`'s prefix changed to `zips/x/`, THEN the bootstrap SHALL rewrite it to the owned rule.
3. IF `correct()` stops checking `Status` or `Filter.Prefix` THEN one of these scenarios SHALL fail.

**Independent Test**: Removing `Status=='Enabled'` from `correct()` fails `expire-disabled`.

---

### P5: No credential in a failure, and every observation proves its record

**User Story**: As a reviewer, I want the gate scripts never to print a token, and every smoke observation tied to the record it read.

**Why P5**: V43, V44.

**Acceptance Criteria**:

1. IF `check-identity`'s `get-token cli` check fails THEN its message SHALL show `<jwt: N chars>` in place of any JWT, and SHALL NOT contain the token.
2. WHEN deliveries are counted or archives listed THEN the observation's id SHALL come from the query's result rows, not from the argument.
3. IF the result rows belong to another request THEN the check SHALL fail naming both ids.
4. WHEN the processing failure is observed THEN a smoke step SHALL read the request through `GET /processing-requests/:id` as `alice`, and SHALL require `failureReason` to equal `Nao foi possivel processar o video. Tente enviar novamente.`
5. The README and `check-identity`'s documentation SHALL state that the start order is proven by reading `depends_on`, not by observing it.

**Independent Test**: A scratch `get-token` that prints `token: <jwt>` fails the check, and the message contains no JWT.

---

### P6: Wording

**User Story**: As a reader, I want the CI docs to say precisely what "without a token" means.

**Why P6**: V52.

**Acceptance Criteria**:

1. The ci-governance spec, the context and the README SHALL say that checkout uses no personal access token or secret, while `actions/checkout` still uses the job's default `GITHUB_TOKEN`.

---

## Edge Cases

- WHEN no row matches THEN the observation SHALL be an empty result, and the check SHALL report "0 deliveries for X" or "no archive under zips/X/" without claiming an id match.
- WHEN `apply` runs twice THEN the second run SHALL change nothing.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| GRD-01 | P1: No skip or mask path in `integration` (V50, V51) | Execute | Implementing |

| GRD-02 | P2: `docs-links` scripted and guarded (V51) | Execute | Implementing |

| GRD-03 | P3: `integration_id` pinned; ruleset tools fully tested (V51) | Tasks | In Tasks |
| GRD-04 | P4: Expiry-rule scenarios (V42) | Tasks | In Tasks |
| GRD-05 | P5: No token in failures (V43) | Tasks | In Tasks |
| GRD-06 | P5: Observations prove their record; `failureReason` via the API (V44) | Tasks | In Tasks |
| GRD-07 | P6: Wording (V52) | Tasks | In Tasks |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 7 total, 7 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] The Verifier's surviving mutants M8, M9, M10, M11, M14, M15, M17, K6 and K7 are all killed by gate commands
- [ ] `--live` passes with every context pinned to 15368

---

## Dependencies

Spec D merged (`182e842`).
