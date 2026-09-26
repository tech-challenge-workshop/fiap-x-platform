# Gate Guards Design

**Spec**: `.specs/features/gate-guards/spec.md`
**Context**: `.specs/features/gate-guards/context.md`
**Status**: Draft

---

## Architecture Overview

Every change tightens an existing guard. None changes how the system runs, and no new CI job is added.

| Area | File | Change |
| --- | --- | --- |
| CI guard | `scripts/check-ci-governance.mjs` | The workflow check stops scanning `if:` lines and parses the `integration` job into steps: its name, its `if:`, its `run:` and whether that `run:` spans several lines. It then applies a per-step allow-list. It also checks the `docs-links` job |
| Link check | `scripts/check-docs-links.mjs` (new) | The Python block moves out of `ci.yml` into a Node script with `--self-test`. The `docs-links` job runs it |
| Ruleset tools | `ci/required-checks.json`, `check-ci-governance.mjs --live`, `apply-required-checks.mjs` | Contexts become `{context, integration_id}`. New self-test cases. CI's `topology` job runs the apply self-test |
| Bootstrap scenarios | `scripts/check-storage-bootstrap.mjs` | Adds `expire-disabled` and `expire-narrowed` |
| Identity check | `scripts/check-identity.mjs` | A `redact()` step runs over every message that quotes an output |
| Smoke | `scripts/smoke-local-integration.mjs` | The id comes from the result. A new step, `processing failure reason`, reads the request through the API |
| Docs | `README.md`, `ci-governance/{spec,context}.md` | V44 start-order note; V52 wording |

---

## Code Reuse Analysis

| Component | Location | How to Use |
| --- | --- | --- |
| `integrationBlock()` | `check-ci-governance.mjs:80` | Still isolates the job. A new `parseSteps(block)` splits it on `- name:` / `- uses:` entries |
| `GOOD` / `replaceOnce()` self-test fixtures | `check-ci-governance.mjs:278-351` | New near-misses: M10, M11, M14, `shell:`, and the three `docs-links` breakages |
| Scenario table | `check-storage-bootstrap.mjs` | Two new rows, built like `abort-disabled` and `abort-narrowed` but on `expire-zips` |
| `withRequiredChecks()` | `apply-required-checks.mjs:45` | Maps `{context, integration_id}`. New shrinking-list case |
| `readAs(user, step, id)` | smoke | The new `processing failure reason` step |
| `observedFor()` | smoke | Unchanged. The id it compares now comes from the rows |

---

## Components

### Workflow check (GRD-01, GRD-02)

`parseSteps(block)` returns `{ index, name, if, run, multiline, uses }` for each step. It reads the job's own `if:`, `continue-on-error:` and `shell:` separately. The rules:

1. **No job-level `if:`, no `shell:`, no `continue-on-error`.** A violation fails with `the integration job must not set <key>`.
2. **Only three steps may carry an `if:`:**
   - the two log steps (`Collect container logs`, `Upload container logs`) may carry exactly `failure()`;
   - the teardown (`Tear the stack down`) may carry exactly `always()`;
   - any other `if:` fails with `step "<name>" must not be conditioned on "<expr>"`.
3. **Stack steps are one-line commands.** Each `STACK_COMMANDS` entry must be exactly one step whose `run:` equals the command and is not multi-line. A violation fails with `stack command "<cmd>" must be a one-line run step of its own`. The order check is kept.
4. **The `docs-links` job is guarded.** It has no `if:` and no `continue-on-error`, and it has a step whose `run:` is `node scripts/check-docs-links.mjs`.

The step names in rule 2 are the ones `ci.yml` uses today; the implementer confirms them. Renaming such a step requires updating the check, which is intended.

### `scripts/check-docs-links.mjs` (GRD-02)

- Same logic as today's Python block: `README.md` and `docs/**/*.md`, markdown links, external and anchor targets skipped. It prints each unresolved link and `N unresolved link(s)`, then exits 1 if N > 0.
- It reads `DOCS_ROOT` (default: the repository root), so the self-test can point it at a temporary tree.
- `--self-test` covers three cases:
  - a tree with `[x](nope.md)` → the exact message and exit 1;
  - a tree whose links resolve → exit 0;
  - a spawned run on a broken tree → non-zero exit.

### Required checks with `integration_id` (GRD-03)

- **`ci/required-checks.json`:** each value becomes `[{ "context": "quality", "integration_id": 15368 }, …]`. `readRequiredChecks` still accepts only this shape and validates it.
- **`rulesetProblems`:** compares the `context` and `integration_id` pairs. A mismatch fails with `<repo>: missing [quality@15368], unexpected [quality@-]`. It also rejects a non-empty `exclude`, which covers M15 as a near-miss.
- **`withRequiredChecks`:** writes the pairs. A new self-test case starts from live `[quality, lint]` and must produce exactly `[quality@15368, image@15368]` (covers M17).
- **CI:** `topology` gains `node scripts/apply-required-checks.mjs --self-test`.
- **Applying the change:** `--dry-run` must show each context gaining `integration_id` 15368. Only after the user's go-ahead does `--apply` run, followed by `--live`.

### Bootstrap scenarios (GRD-04)

| Scenario | Pre-state | Expectation |
| --- | --- | --- |
| `expire-disabled` | The three owned rules, with `expire-zips` `Status: Disabled` | exit 0; exactly the owned rules |
| `expire-narrowed` | The three owned rules, with `expire-zips` `Filter.Prefix: zips/x/` | exit 0; exactly the owned rules |

### `check-identity` redaction (GRD-05)

- `redact(text)` replaces every `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` with `<jwt: N chars>`.
- Every message that quotes stdout or stderr is passed through it.
- The self-test includes a bad input `token: <real-shaped jwt>` and requires the message to contain `<jwt:` and not the token.

### Smoke observations (GRD-06)

- **`countDeliveries`:** runs `SELECT processing_request_id, count(*) … WHERE processing_request_id = :'id' GROUP BY 1`. It returns `{ id: row?.id, count: row?.count ?? 0, queried: id }`.
  - The check requires `id` to equal the id under test when `count > 0`.
  - With no row it reports `0 deliveries for <queried>`.
- **`listArchives`:** derives the id from each key's `zips/<id>/` segment. The check requires every key's id to equal the id under test.
- **New step `processing failure reason`:** runs after `processing failure delivery`.
  - It calls `readAs('alice', …, failedId)` and requires `200` with `failureReason` equal to the exact sentence.
  - Self-test near-misses: the `FORMATO_INVALIDO` sentence, and a truncated sentence.
- **Start order (V44):** documented in the README beside `check-identity`: "proven by reading `depends_on` … `service_healthy` from the rendered compose, not by observing start times".

### Wording (GRD-07)

`ci-governance/spec.md`, `ci-governance/context.md` and the README section "CI and the required checks" say: "no personal access token or secret; `actions/checkout` uses the job's default `GITHUB_TOKEN`".

---

## Error Handling Strategy

| Scenario | Handling |
| --- | --- |
| A step renamed in `ci.yml` | The allow-list no longer matches, so the workflow check fails and names the step. The rename must update the check in the same change |
| The Actions app id changes | `--live` fails naming `@15368` versus the new id. Update the file, then apply |

---

## Risks & Concerns

| Concern | Location | Impact | Mitigation |
| --- | --- | --- | --- |
| Text parsing of YAML steps | `check-ci-governance.mjs` | A reformatted workflow could break parsing | The self-test runs on a fixture shaped like the real file, and the real run in `topology` exercises the real file |
| Pinning `integration_id` to a wrong id | Rulesets | Every PR blocked | The id was read from real check runs; `--dry-run` runs first, and `--live` runs right after `--apply` |
| A new smoke step lengthens `integration` | CI | About 1 s | Negligible |

---

## Tech Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Link check language | Node, like every other gate script | One toolchain; testable with the same spawn pattern |
| Per-step allow-list | By step name plus expression | The name carries the intent; an expression alone was V50's hole |
