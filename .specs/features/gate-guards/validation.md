## Validation: gate-guards — PASS with open items

# gate-guards Validation

**Date**: 2026-09-26
**Spec**: `.specs/features/gate-guards/spec.md` (GRD-01..07)
**Diff range**: `d5b259b..d39fe25` (branch `fix/gate-guards`, PR tech-challenge-workshop/fiap-x-platform#12). No commit landed during verification; the head stayed `d39fe25`.
**Verifier**: independent sub-agent (author ≠ verifier). This is the single, final round, so leftovers are recorded as open items ("Validar depois").

Round result: every surviving mutant from specs C and D (M8, M9, M10, M11, M14, M15, M17, K6, K7) is now killed by a gate command. All five live rulesets are pinned to 15368, and their other rules are unchanged. Every acceptance criterion holds for idiomatic YAML. However, the workflow guard is still a text parser. It can be bypassed by YAML spellings it does not read (a quoted `"if":` key, or `if :`), and it does not guard the `topology` job that `integration` needs. That means the P1 goal ("no change to ci.yml can let integration be skipped while the guard stays green") is not fully met (O-1, O-2).

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 | ✅ Done | Per-step allow-list; M10, M11 and M14 are killed. Quoted-key bypass open (O-1) |
| T2 | ✅ Done | `scripts/check-docs-links.mjs` + guard; M8 and M9 are killed. `DOCS_ROOT` env override open (O-3) |
| T3 | ✅ Done | Pairs, `exclude`, shrinking list; `topology` runs the apply self-test (unguarded, O-4) |
| T4 | ✅ Done | `redact()` covers every quoted-output path; live negative passed |
| T5 | ✅ Done | K6 and K7 are killed on the stack. `expire-sources` has no variation scenario (O-5) |
| T6 | ✅ Done | Ids read from the rows; the new API step is green on the stack |
| T7 | ✅ Done | PR CI green and `CLEAN` at `d39fe25`; `--live` exit 0 (re-run by the Verifier) |

---

## Spec-Anchored Acceptance Criteria

| Criterion | Spec-defined outcome | Evidence (`file:line` + assertion) | Result |
| --- | --- | --- | --- |
| GRD-01 AC1: job-level `if:` | Check fails naming it | `scripts/check-ci-governance.mjs:212` `Object.hasOwn(keys,'if')`; self-test `:729` expects `['the integration job must not set if']`; M11 on a real `ci.yml` copy exits 1 with that message | ✅ PASS (⚠️ `"if":` / `if :` bypass, O-1) |
| GRD-01 AC2: only the 2 log steps carry `failure()`, only teardown carries `always()` | Fail naming the step | `:182-186` allow-list, `:223-231`; self-test `:726-728` (M10), `:741-749` (renamed stack step, always() on logs, failure() on teardown) | ✅ PASS |
| GRD-01 AC3: each stack command is a one-line step of its own | Fail naming the command | `:235-242`; self-test `:730-733` (M14), `:737-740` (`\|\| true`) | ✅ PASS |
| GRD-01 AC4: `shell:` in the job | Fail | `:213`, `:217-219`; self-test `:734-736` (step, job defaults, workflow defaults) | ✅ PASS (⚠️ quoted `"shell":` bypass, O-1) |
| GRD-01 AC5: self-test rejects M10, M11 and M14 with exact messages | Exact messages | `:726-733`, compared with `JSON.stringify` equality at `:781` | ✅ PASS |
| GRD-02 AC1: `scripts/check-docs-links.mjs` exits 1 on an unresolved link | exit 1 | `check-docs-links.mjs:71`; parity with the old Python confirmed (same regex, skip set and fragment handling). Real tree: `0 unresolved link(s)` | ✅ PASS |
| GRD-02 AC2: self-test broken → reject, good → accept, spawned broken → exit 1 | exact | `check-docs-links.mjs:94-127` (exact report and `status !== 1`) | ✅ PASS |
| GRD-02 AC3: `docs-links` with `continue-on-error`, `if:`, or no script → fail | fail | `check-ci-governance.mjs:268-285`; self-test `:751-759`; ci.yml:130-141 runs the script unconditionally | ✅ PASS (⚠️ `DOCS_ROOT` env and quoted keys, O-1/O-3) |
| GRD-03 AC1: every context carries 15368 | 15368 | `ci/required-checks.json`; self-test `:636-645` compares it to `DECIDED_CHECKS` | ✅ PASS |
| GRD-03 AC2: `--live` fails on a missing or other `integration_id` | fail naming it | `:303`, `:327-358`; self-test `:556-561` (`quality@-`, `image@15369`) | ✅ PASS |
| GRD-03 AC3: non-empty `exclude` rejected | exact | `:346`; self-test `:565-567` | ✅ PASS |
| GRD-03 AC4: shrinking list comes out exactly versioned | exact | `apply-required-checks.mjs:56-66`; self-test (M17 killed, below) | ✅ PASS |
| GRD-03 AC5: `topology` runs the apply self-test | step present | `ci.yml:60-61` | ✅ PASS (unguarded, O-4) |
| GRD-03 AC6: apply pins 5 rulesets, then `--live` passes | live | Verifier: `--live` exit 0 (`the 5 "protect main" rulesets require exactly the checks…`). A GET of all 5 rulesets shows every context `integration_id: 15368`, `enforcement: active`, include `~DEFAULT_BRANCH`, exclude `[]`, 0 bypass actors. The full JSON minus timestamps, links and the checks list is identical to `ruleset-e-before-*.json` for all 5. `--dry-run`: "already requires exactly" ×5 (idempotence edge case) | ✅ PASS |
| GRD-04 AC1/AC2: `expire-disabled`, `expire-narrowed` rewrite to owned | exit 0, owned rules | `check-storage-bootstrap.mjs:154-155`; real run: `12 bootstrap scenarios passed; no fiapx-scenario-* bucket left` | ✅ PASS |
| GRD-04 AC3: dropping `Status` / `Filter.Prefix` from `correct()` fails a scenario | fail | K6 → `scenario expire-disabled failed`; K7 → `scenario expire-narrowed failed` (Verifier, on the stack) | ✅ PASS |
| GRD-05 AC1: `<jwt: N chars>` in place of any JWT; token absent | redacted | `check-identity.mjs:47-52` `redact`; `:102`, `:127`, `:178`, `:216`, `:377`; self-test `:283-292` and the no-token loop `:329-332`. Live: a scratch get-token failing with the real token on stderr gives `stderr: refresh failed for <jwt: 1034 chars>`, and the token appears 0 times in stdout or stderr | ✅ PASS |
| GRD-06 AC2: ids come from the result rows | rows | `smoke-local-integration.mjs` `deliveriesOf` (psql `id\|count` rows), `listingOf`/`archiveIdOf` (key segment), `observedRowsFor` | ✅ PASS |
| GRD-06 AC3: rows for another request → fail naming both | both ids | self-test rows for `rejectedId` under `failedId` → `failedDeliveries observed for <rejected>, expected <failed>`. Live: the count query without its WHERE gives `deliveries observed for c8e21dda…, expected 06389214…`, exit 1 | ✅ PASS |
| GRD-06 AC4: API read as alice, exact `failureReason` | exact sentence | `assertFailureReasonRead` (200, body id, `!==` sentence); self-test covers FORMATO sentence, truncated, 404, other body. Live: `alice reading e763f9f6… through the API got 200 with failureReason Nao foi possivel processar o video. Tente enviar novamente.` | ✅ PASS |
| GRD-06 AC5: start order documented as read from `depends_on` | wording | `README.md:69`; `check-identity.mjs:14-17` | ✅ PASS |
| GRD-07 AC1: no PAT or secret; checkout uses the default `GITHUB_TOKEN` | wording | `README.md:241`; `ci-governance/spec.md:7,31,53`; `ci-governance/context.md:9,17` | ✅ PASS (⚠️ residue, O-6) |

**Edge cases**: no row → `0 deliveries for <id>: expected exactly 1 record` and `No archive under zips/<queried>/`, with no id match claimed (✅). Apply run twice → the second run changes nothing (self-test, and the live `--dry-run` above) (✅).

---

## Gate Check

| Command | Result |
| --- | --- |
| `check-ci-governance.mjs` | exit 0 |
| `check-ci-governance.mjs --self-test` | 28 bad / 2 good workflows; 12 bad / 3 good ruleset sets; 6 malformed files; exit 0 |
| `check-ci-governance.mjs --live` | exit 0 |
| `check-docs-links.mjs` / `--self-test` | `0 unresolved link(s)` / pass |
| `apply-required-checks.mjs --self-test` / `--dry-run` | pass / "already requires exactly" ×5 |
| `check-identity --self-test`, `check-storage-bootstrap --self-test`, smoke `--self-test`, `check-worker-sizing`, `check-no-storage-writes`, `generate-db-script` self-tests | all exit 0 (23/6, 38/19, 176/59 bad/good) |
| `docker compose up --build -d --wait` (55432/39000/33002) | exit 0 |
| `check-storage-bootstrap.mjs` (real) | `12 bootstrap scenarios passed` |
| `smoke-local-integration.mjs` (real) | exit 0, including `processing failure reason` |
| `check-identity.mjs` (real) | `6 identity checks passed` |
| `docker compose down -v` | exit 0; `fortal-*` untouched |
| PR #12 CI at `d39fe25` | topology, docs-links, integration all SUCCESS; `mergeStateStatus: CLEAN` |

**Test integrity**: no self-test case label was removed from any of the five changed scripts (label diff against `d5b259b` is empty). The reworded expectations are:
- `line N:` → the design's step and job messages;
- `quality` → `quality@15368`;
- `Delivery for X … found 0` → `0 deliveries for X`, as the spec's edge case requires.

Each is equally or more specific. No assertion was weakened.

---

## Discrimination Sensor

Scratch `git worktree` at `d39fe25` (removed afterwards). The stack mutants ran through `BOOTSTRAP_UNDER_TEST` and `COMPOSE_PROJECT_NAME` on scratch copies. Real tree `git status --porcelain` was empty before and after.

| # | Mutation | Gate | Result |
| --- | --- | --- | --- |
| M8 | `continue-on-error: true` on docs-links | `check-ci-governance` | ✅ Killed: `the docs-links job must not set continue-on-error` |
| M9a | docs-links back to inline Python `SystemExit(0)` | `check-ci-governance` | ✅ Killed: `must run "node scripts/check-docs-links.mjs"…` |
| M9b | link script never sets exit 1 | `check-docs-links --self-test` | ✅ Killed |
| M10 | `if: failure()` on the second smoke | `check-ci-governance` | ✅ Killed |
| M11 | job-level `if: failure()` | `check-ci-governance` | ✅ Killed |
| M14 | `run: \|` set +e / smoke / exit 0 | `check-ci-governance` | ✅ Killed |
| M15 | `--live` drops `exclude.length !== 0` | `check-ci-governance --self-test` | ✅ Killed |
| M17 | apply appends instead of replacing | `apply-required-checks --self-test` | ✅ Killed |
| K6 | `correct()` drops `Status=='Enabled'` | real bootstrap scenarios | ✅ Killed: `expire-disabled failed` |
| K7 | `correct()` drops `Filter.Prefix` | real bootstrap scenarios | ✅ Killed: `expire-narrowed failed` |
| N1 | allow-list ignores step names | `check-ci-governance --self-test` | ✅ Killed |
| N1b | allow-list drops the runs-stack clause | `--self-test` | ✅ Killed |
| N2 | stderr path not redacted | `check-identity --self-test` | ✅ Killed |
| N3 | count id read from the argument | smoke `--self-test` | ✅ Killed |
| N3b | archive id read from the argument | smoke `--self-test` | ✅ Killed |
| N4 | apply drops `integration_id` | `apply-required-checks --self-test` | ✅ Killed |
| N5a | `--live` ignores the live `integration_id` | `check-ci-governance --self-test` | ✅ Killed |
| N5b | `checkLabel` ignores `integration_id` | `--self-test` | ✅ Killed |
| N6 | docs-links run-step requirement removed | `--self-test` | ✅ Killed |
| N7 | `failureReason` compared by prefix | smoke `--self-test` | ✅ Killed |
| N8 | `redact()` returns its input | `check-identity --self-test` | ✅ Killed |
| N9 | `topology` stops running the apply self-test | `check-ci-governance` | ❌ Survived (O-4) |
| N10 | `topology` stops running the link self-test | `check-ci-governance` | ❌ Survived (O-4) |
| K8 | bootstrap "already configured" test drops `correct expire-sources` (`storage/bootstrap.sh:81`) | real bootstrap scenarios | ❌ Survived (O-5) |
| P1 | `"if": failure()` on the job (PyYAML reads key `if`) | `check-ci-governance` | ❌ Survived (O-1) |
| P2/P9 | `"if": failure()` on the second smoke / the stack start | `check-ci-governance` | ❌ Survived (O-1) |
| P3 | `if : failure()` on the job | `check-ci-governance` | ❌ Survived (O-1) |
| P4/P7/Q1 | quoted `"continue-on-error"` (integration, docs-links) / `"shell"` | `check-ci-governance` | ❌ Survived (O-1) |
| P5 | `if: false` on `topology` (integration skipped through `needs`) | `check-ci-governance` | ❌ Survived (O-2) |
| P6 | `integration` needs an extra job with `if: false` | `check-ci-governance` | ❌ Survived (O-2) |
| Q2 | `env: DOCS_ROOT: /nonexistent` on the link step | `check-ci-governance` | ❌ Survived (O-3) |
| P8 | job `env: BOOTSTRAP_UNDER_TEST` | `check-ci-governance` | ❌ Survived (O-3) |

**Live literal negatives (stack)**: count query without its WHERE → exit 1 naming both ids. Token on get-token's stderr → redacted, 0 occurrences.

**Result**: 21/35 killed. All 9 targeted survivors from specs C and D and all 5 requested new mutants are killed. Survivors (14): N9, N10, K8, P1, P2, P3, P4, P5, P6, P7, P8, P9, Q1, Q2. The YAML-level probes were confirmed with PyYAML; GitHub's parser was not exercised (no actionlint, and no pushes allowed).

---

## Code Quality / Deviations

| Deviation | Judgement |
| --- | --- |
| A step running a stack command may not be conditioned, even under an allow-listed name (`:227-228`) | Sound. It closes rename-to-log-step; N1b shows it is tested |
| `continue-on-error` refused on steps, not only the job; workflow-level default shell refused | Sound, and tested (`:750`, `:736`). Slightly over-strict (`continue-on-error: false` also fails), which is acceptable |
| `topology` runs the new link self-test; `docs-links` gains `setup-node` 22 | Sound, and needed for M9 to be killed in CI. Unguarded (O-4) |
| `ids` (every row) instead of the design's single `id` (SPEC_DEVIATION) | Accepted. It is strictly stronger: a broken filter that returns many rows is judged on all of them, which the live negative showed |
| The API step also compares the body's `processingRequestId` | Sound; the "other request's body" case tests it |
| `redact()` also wraps the compose and inspect errors and `main()`'s output | Sound; it covers the stderr and fatal paths |
| README table and scenario count updates | In scope (docs follow the code) |

---

## Fix Plans (open items for "Validar depois")

### O-1 (Major): The workflow guard reads keys by regex, so a quoted or spaced key escapes it
- **Where**: `scripts/check-ci-governance.mjs:120` (`KEY = /^([A-Za-z_][\w-]*):/`), `:139`, `:160`, `:213-219`, `:274-276`.
- **Failure scenario**: `"if": failure()` at job level on `integration` (a YAML mapping key `if`, as PyYAML confirms). `integration` is skipped on every green `topology`, the skipped required check counts as success, and `check-ci-governance` prints "…with no skip path…". This is M11/V50 again. The same holds for `if : failure()`, `"if":` on any stack step, and quoted `"continue-on-error"` / `"shell"` on either job.
- **Fix task**: parse `ci.yml` with a real YAML parser. `topology` already relies on `python3 yaml`; a small vendored or pinned parser also works. Alternatively, reject any line in the `jobs:` block whose key is quoted, or has whitespace before `:`, or uses `?` complex-key syntax. Add P1, P3 and P4 as self-test near-misses.

### O-2 (Major): `integration` can be skipped through its `needs`
- **Where**: `workflowProblems` (`:202-263`) never looks at `needs` (`ci.yml:65`) or at the `topology` job.
- **Failure scenario**: `if: github.event_name == 'push'` (or `if: false`) on `topology` skips it on PRs. `integration` then skips because its need was skipped. Both required checks report success, the PR merges with no stack run, and the guard stays green. Another route: add a job that is always skipped to `integration.needs`.
- **Fix task**: require `integration.needs` to be exactly `topology`, and apply rule 1 (no job `if:`, no `continue-on-error`) to `topology` as well. Add both as near-misses.

### O-3 (Minor): Environment overrides can make a gate vacuous
- **Where**: `check-docs-links.mjs:21` (`DOCS_ROOT`); `check-storage-bootstrap` `BOOTSTRAP_UNDER_TEST`; `check-identity` `GET_TOKEN_UNDER_TEST`. None of the guards look at `env:`.
- **Failure scenario**: `env: DOCS_ROOT: /nonexistent` on the docs-links step makes it print `0 unresolved link(s)` and exit 0 on any tree. The guard stays green.
- **Fix task**: reject `env:` on the docs-links job and on the integration job and steps, or at least the test-hook names. Alternatively, make the scripts refuse their test hooks when `CI=true`.

### O-4 (Minor): The self-test steps in `topology` are not guarded
- **Where**: `ci.yml:36-61`.
- **Failure scenario**: deleting the `apply-required-checks --self-test` or `check-docs-links --self-test` step (N9, N10) passes every gate. M9b and M17 are then no longer killed in CI, and GRD-03 AC5 silently regresses.
- **Fix task**: have the workflow check require that `topology` runs each `--self-test` as an unconditioned one-line step.

### O-5 (Minor): `expire-sources` has no variation scenario
- **Where**: `storage/bootstrap.sh:81`; the scenario table in `check-storage-bootstrap.mjs:129-156` varies only `expire-zips` and the abort rule.
- **Failure scenario**: K8 drops `correct expire-sources sources/` from the "already configured" test. All 12 scenarios still pass, so a disabled `expire-sources` would be reported as configured and sources would never expire. Spec P4 names only `expire-zips`, but its goal says "every owned rule". This is lesson L-020 applied to one rule of two.
- **Fix task**: add `sources-disabled` and `sources-narrowed` scenarios.

### O-6 (Cosmetic): Residual wording and stale status
- `.specs/features/ci-governance/spec.md:98` still reads "P1: Anonymous checkout" and "open: V50…", which V50 now closes.
- The guard's message (`check-ci-governance.mjs:247`) still says "checked out without a token".
- The success line (`:297`) claims "no skip path", which O-1 and O-2 contradict.
- In the gate-guards spec traceability, `design.md` and `tasks.md` still say "Implementing" or "Draft".

---

## Requirement Traceability Update

| ID | Before | After |
| --- | --- | --- |
| GRD-01 | Implementing | ✅ Verified (open: O-1, O-2 guard bypasses) |
| GRD-02 | Implementing | ✅ Verified (open: O-3 `DOCS_ROOT`) |
| GRD-03 | Implementing | ✅ Verified (open: O-4 unguarded self-test step) |
| GRD-04 | Implementing | ✅ Verified (open: O-5 for expire-sources) |
| GRD-05 | Implementing | ✅ Verified |
| GRD-06 | Implementing | ✅ Verified |
| GRD-07 | Implementing | ✅ Verified (O-6 cosmetic) |

---

## Summary

**Overall**: ⚠️ Ready, with open items.
**Spec-anchored check**: 22/22 AC rows match the spec outcome for idiomatic YAML. 0 spec-precision gaps.
**Sensor**: 21/35 killed. All targeted survivors (M8, M9, M10, M11, M14, M15, M17, K6, K7) and all 5 requested new mutants are killed. 14 new survivors, grouped as O-1..O-5.
**Gate**: every local command passed; the stack runs passed; PR CI green and `CLEAN` at `d39fe25`; `--live` passed.
**Report path**: this file (scratchpad). The real tree is unchanged, and lessons were not written into the repo.

---

## Lessons signal

- **A text-level YAML guard must reject the spellings it cannot read.** Allow-listing `if:` by regex leaves `"if":` and `if :` open, and each is the same key to YAML. Either parse with a YAML parser, or fail closed on any quoted, spaced or complex key. Grounded in `check-ci-governance.mjs:120` (P1, P3, P4).
- **A skip-path guard must cover the job's whole `needs` chain, not only the job.** A skipped dependency skips the dependent, and both count as success. Grounded in `ci.yml:65` (P5, P6).
- **Test hooks read from env are a mask path in CI.** Guard `env:`, or make the hooks refuse to run under `CI`. Grounded in `check-docs-links.mjs:21` (Q2).
- **When CI's own steps are what kill a mutant, the step list is itself a guarded artifact.** Grounded in `ci.yml:58-61` (N9, N10).
- **L-020 again: vary every owned rule, not the one the last Verifier named.** Grounded in `storage/bootstrap.sh:81` (K8).
- **Positive evidence**: exact-message self-tests, and red-first scratch negatives on the live stack killed every requested mutant. So did the before/after full-JSON comparison of the rulesets. Keep this pattern.
