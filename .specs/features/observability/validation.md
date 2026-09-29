# Observability Validation

**Date**: 2026-09-29
**Spec**: `.specs/features/observability/spec.md`
**Diff range**: `origin/main..HEAD` = 21 commits, `fb795b8..9a32486`. That is the 15 commits of round 1 plus the six fix commits `56f153e` (F2), `5d34343` (F4), `ff43ece` (F5), `b2ecc3c` (F1), `06506a0` (F3) and `9a32486` (F6).
**Verifier**: independent sub-agent (author ≠ verifier), round 2 of 3 (the last round)

Verdict: PASS ✅. All four round-1 gaps are closed.

- The `topology` job's three observability steps are now guarded. M7c, M7d and M12 are killed by `check-ci-governance.mjs`.
- Dashboard template variables are checked. M9 is killed, in the string form and in the `{ query }` form.
- The README's correlation trace and scaling demo now say only what the stack shows. The Verifier re-ran the trace commands read-only against the stack.
- The P2 Independent Test and Success Criterion 2 were reworded. The change is recorded and justified in `tasks.md` (Post-verification fixes, F3), and AC P2-3 is unchanged.

The sensor ran 18 mutants. 17 are killed. One new compose port-mapping mutant (M22) cannot be killed offline. It is killed by construction in the CI `integration` job, which was not run here. It becomes an open item (see Validar depois).

---

## Round 1 → Round 2

| Round-1 finding | Fix commit | Round-2 evidence | Status |
| --------------- | ---------- | ---------------- | ------ |
| Fix 1 (Major): the README said one correlation id follows a video through all four services' logs | `b2ecc3c` | `README.md:265-279` now claims only these: the API echoes the id, the API and Catalog request lines carry it, `catalog.processing_request.correlation_id` stores it, and the three outbox events carry it. It says plainly that "The Worker and the Notification Service write no log line per message". The Verifier ran the README's exact commands with T12's `t12-trace-1790651303`. `docker compose logs api catalog \| grep` found 2 lines: the Catalog `POST /processing-requests` and the API `POST /uploads/.../complete`, which carries `"correlationId":"t12-trace-1790651303"`. The `processing_request` query returned 1 row, `aef57137-…` `COMPLETED`. The outbox query returned 3 rows (887 `video-validation` `VideoValidationRequested`, 888 `processing` `ProcessingQueued`, 889 `notification.terminal` `terminal.event`). `logs worker notification \| grep` found 0 lines, which is consistent with the new text. Per-message consumer logging is the recorded out-of-repo follow-up V66 | ✅ Closed |
| Fix 2 (Major): the `topology` observability steps were unguarded (M7c, M7d, M12 survived) | `56f153e` | `scripts/check-ci-governance.mjs:310-329` `topologyProblems` requires each of the 3 commands as a one-line `run:` of its own step. The job may set no `if:`, `shell:` or `continue-on-error`, and no step may be conditioned. Wired in at `:282`. Self-test cases are at `:820-839` (9 new, 39 bad workflows in all). Re-run in scratch worktrees, M7c, M7d and M12 are each killed by the default mode. The new mutants M13-M16b below also die | ✅ Closed |
| Fix 3 (Minor): the scaling demo claimed a depth rise on a 6-video run and an unmeasured "~2×" | `06506a0` | `README.md:310-319` explains why 6 videos drain between scrapes. It documents the 200-video burst (`for run in 1 2 3 4; do node scripts/load-test.mjs --videos 50 & done; wait`) and says a per-replica gain is not measured. Every number in it matches T12's record (`tasks.md` T12: peak 22, +200 split 66/67/67, 40 videos 5 s vs 3 s, "well under a second"). spec.md's P2 Independent Test and SC-2 were reworded the same way. `tasks.md` Post-verification fixes, row F3, marks it as a **Spec change**, gives the reason (the 8 s fixture), and states that AC P2-3 is unchanged | ✅ Closed |
| Fix 4 (Minor): template variables escaped the metric and PII checks (M9) | `5d34343` | `scripts/check-observability.mjs:243-253` `variableNames` handles `label_values` (last argument is a label), `query_result` and bare expressions. `:372-378` applies `namesProblems` to each query variable's `query`, whether a string or `{ query }`, and to its `definition`. The self-test at `:704-716` has 3 corruptions and 1 good variable. M9 and M9b are killed, and M17, M18 and M19 against the new code are killed | ✅ Closed |
| Observation 3: Catalog host port was fixed | `ff43ece` | `compose.yaml:88` `"${CATALOG_HOST_PORT:-3001}:3001"`. It renders `3001` by default and when the variable is empty, and `33001` with `CATALOG_HOST_PORT=33001`. `check-observability.mjs:487,492,854` and `smoke-local-integration.mjs:42` read the variable. Live self-test cases are at `:807-809`. The unmodified `CATALOG_HOST_PORT=33001 node scripts/check-observability.mjs --live` exits 0. Without the variable it exits 1 on exactly the two catalog lines, because the foreign process holds 3001 | ✅ Closed |
| Observations 4 and 7: traceability rows and the STATE handoff were stale | `9a32486` | spec.md rows OBS-61..74 are updated, and `.specs/STATE.md` Handoff describes S8 at Validate round 2 | ✅ Closed |
| Observations 1 and 2: `generate-db-script --check` in CI and OBS-72's first CI run | n/a (merge order, AD-016) | Unchanged, as expected. Still pending on the PR | ⏳ Carried |
| Observations 5 and 6: `/tmp` symlink path comparison, and a default-mode run on import | not addressed | Unchanged. Non-blocking | ⏳ Carried |

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1-T10 | ✅ Done | One Conventional Commit each. |
| T11 | ✅ Done locally, ⏳ CI proof pending | `generate-db-script.mjs --check` exits 0 here, with both siblings on `feat/observability` and clean. CI checks the Catalog out at `main`, so this PR merges last (AD-016). |
| T12 | ✅ Evidence complete / ⚠️ PR description pending | Its three open items were answered by F1, F3 and F5. The "Test count" box is carried into this report. |
| F1-F6 | ✅ Done | One commit each, recorded in `tasks.md` under "Post-verification fixes". |

---

## Spec-Anchored Acceptance Criteria

> There are 14 ACs (P1 ×7, P2 ×6, P3 ×1), traced to OBS-61..74. This repo has no unit-test runner. The assertions are the self-test cases of `scripts/check-observability.mjs`, `scripts/load-test.mjs` and `scripts/check-ci-governance.mjs`, plus their default (repository) modes and the live evidence. Live evidence is either this Verifier's read-only probes of the running stack at 1 worker replica on HEAD `9a32486`, or the T12 record.

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| P1-1 (OBS-61) WHEN `up --build -d --wait` THEN `prometheus` is healthy, scraping all four `/metrics` endpoints and the broker plugin every 15 s, and `grafana` is healthy on host 3005 | 15 s interval; targets api, catalog, worker, notification and rabbitmq:15692; both containers healthy; Grafana on 3005 | `prometheus/prometheus.yml:9-41`. `scripts/check-observability.mjs:282` `seconds(scrape_interval) !== 15`; `:291` `!statics.includes(target)`; worker `dns_sd_configs`. Self-test corruptions reject each variant with an exact message. `compose.yaml:188-230` health checks. Live (Verifier): all 11 services `running healthy`. `/api/v1/targets?state=active` shows `api:3000`, `catalog:3001`, `notification:3003`, `rabbitmq:15692` and `worker 172.18.0.8:3002`, all `up`, `15s`/`10s`. `:3005/api/health` returns 200 | ✅ PASS |
| P1-2 (OBS-62) WHEN Grafana starts THEN the Prometheus datasource and the overview dashboard are provisioned from versioned files, with no manual step | datasource uid `prometheus`, default; dashboard `fiapx-overview` provisioned | `grafana/provisioning/datasources/prometheus.yml:8-15`, `grafana/provisioning/dashboards/dashboards.yml:6-14`. `check-observability.mjs:313` datasource type, url and `isDefault`; `:335-381` dashboard rules including template variables; `:61` `fiapx-overview`. Live (Verifier): `/api/dashboards/uid/fiapx-overview` returns `meta.provisioned: true`, `provisionedExternalId: overview.json`, 20 panels, `templating.list: []` | ✅ PASS |
| P1-3 (OBS-63) WHEN RabbitMQ starts THEN the plugin serves queue metrics on 15692 with per-queue depth for `video-validation`, `processing` and `notification.terminal` | `rabbitmq_queue_messages{queue=...}` for the three queues | `rabbitmq/enabled_plugins:1`, `rabbitmq/rabbitmq.conf:13-14`. `check-observability.mjs:401-402` `return_per_object_metrics`, with a self-test case at `:722-723`. Live (Verifier): `:15692/metrics` has `rabbitmq_queue_messages{vhost="/",queue="video-validation"}`, `…"processing"` and `…"notification.terminal"` | ✅ PASS |
| P1-4 (OBS-64) WHEN a service is not up THEN Prometheus still starts and retries | Prometheus depends on nothing, and no business service depends on monitoring | `check-observability.mjs:427-428` (Prometheus `depends_on` empty) and `:441` (no business service depends on prometheus or grafana). Self-test at `:728-733`. Live (T5 record): Prometheus and Grafana came up healthy alone, with every business target `down` | ✅ PASS (live-recorded) |
| P1-5 (OBS-65) IF Grafana or Prometheus is removed THEN `up -d` recreates the same provisioned state | State comes only from repo files | `compose.yaml:205-230`: Grafana has no data volume. `dashboards.yml:10-11` sets `disableDeletion` and `allowUiUpdates: false`. `check-observability.mjs:407` requires read-only binds; self-test at `:736`. Live (T12): provisioned from `down -v`. The Verifier may not recreate containers on the shared stack | ✅ PASS (structural checks + fresh-boot evidence) |
| P1-6 (OBS-66) config is mounted read-only, and targets need no credentials | `:ro` bind mounts; no auth keys on scrape jobs | `check-observability.mjs:407` `read_only === true`. `:302` rejects `basic_auth`, `authorization`, `bearer_token(_file)` and `oauth2`; self-test at `:671-672`. Live (Verifier): every `/metrics` answered 200 without a token (`--live` exit 0) | ✅ PASS |
| P1-7 (OBS-74) WHEN `topology` runs THEN `check-observability --self-test` runs and fails on malformed Prometheus config, unparsable dashboard JSON or dangling provisioning references | The step is present and cannot be masked; each corruption fails | `.github/workflows/ci.yml:62-67` runs the default mode, `--self-test` and `load-test --self-test`. **Guarded now**: `scripts/check-ci-governance.mjs:310-329` + `:282`; the self-test at `:820-839` covers removal, `\|\| true`, `set +e`, a step `if:`, a job `if:`, `continue-on-error` and `shell:`. `check-observability.mjs:673-674` unsupported YAML, `:683-684` corrupt JSON, the provisioning-reference cases, and a spawned corrupted copy exiting non-zero (`:820-833`). 40 corruptions are rejected. M7c, M7d and M12 are killed | ✅ PASS |
| P2-1 (OBS-67) WHEN `WORKER_REPLICAS=N` THEN N healthy workers compete on the same queues | `deploy.replicas` = N; the default is 1 | `compose.yaml:124`. `check-observability.mjs:449` requires a default of 1 (self-test at `:745`); live check: worker targets equal replicas. Live (T12): 3 healthy replicas, 3 worker targets up, work split 66/67/67 | ✅ PASS |
| P2-2 (OBS-68) WHEN `load-test --videos N` THEN it authenticates once, drives N concurrent pipelines, prints per-video latency and status counts, and exits non-zero if any video does not reach a terminal state | one token; N videos in flight together; one latency line per video; the counts; a non-zero exit | `scripts/load-test.mjs:187` a single `tokenFrom`; `:142` `Promise.all`; `:339` `summary.countLine === 'COMPLETED 2/3, FAILED 1/3'`; `:211` `process.exit(1)`. Self-test: 20 assertions. Live (T12): 6/6, 40/40 and 200/200 COMPLETED | ✅ PASS (see spec-precision flag 1) |
| P2-3 (OBS-69) WHEN the load test runs THEN the dashboard shows queue depth rising and the processing rate following, with all N completing | per the reworded Independent Test: a 200-video burst at 3 replicas; `processing` depth > 0, then back to 0; `fiapx_processing_total` +200 across the replicas; no ~2× claim | Live-only (T12 record): `rabbitmq_queue_messages{queue="processing"}` went `0 … 22, 22, 22, 0`; `sum(fiapx_processing_total{outcome="completed"})` went 93 → 293; the split was 66/67/67; 200/200 COMPLETED. `README.md:310-319` documents the same burst. Not re-run: the shared stack must not be scaled | ✅ PASS (live-recorded; the round-1 precision gap is resolved by the reworded Independent Test) |
| P2-4 (OBS-70) IF a pipeline misses its timeout THEN the script exits non-zero and names the video | exit ≠ 0; the video named | `load-test.mjs:349` `failures` is exactly `['video #3 (req-3): still PROCESSING after …']`. A spawned run against a dead API exits 1 | ✅ PASS |
| P2-5 (OBS-71) WHEN `--self-test` THEN the helpers run against a fixture with no stack and exit 0 | exit 0 with no stack | Verifier run: exit 0, `load-test self-test passed: 20 assertions`. The `topology` step is now guarded (`check-ci-governance.mjs:98`, `LOAD_SELF_TEST`) | ✅ PASS |
| P2-6 (OBS-72) WHEN `integration` runs THEN it runs the self-test plus a small live load (N ≤ 3), and a non-zero exit fails the job | steps present; cannot be masked | `ci.yml:121-126` runs `load-test --videos 3` (`:123`) and `check-observability --live`. They are held in `STACK_COMMANDS` (M7a and M7b were killed in round 1). The self-test runs in `topology` and is now guarded. The first CI run is pending the merge order | ✅ PASS (wiring); ⏳ first CI run |
| P3-1 (OBS-73) The README documents the Prometheus and Grafana ports, the broker metrics and management ports, `WORKER_REPLICAS`, the load-test commands and how to open the dashboard | all six items, accurately | `README.md:250-254` ports table (9090, 3005 `admin/admin`, 15692, 15672, and the service `/metrics` including `CATALOG_HOST_PORT`); `:251` `http://localhost:3005/d/fiapx-overview`; `:299`, `:315-316` `WORKER_REPLICAS=3` and the burst; `:223` `CATALOG_HOST_PORT`. Accuracy: the correlation trace (`:265-279`) was re-run live and matches, and the burst numbers match T12. `check-docs-links` finds 0 unresolved | ✅ PASS |

**Status**: ✅ All 14 ACs covered with evidence that matches the spec outcome. One spec-precision flag remains, judged as outcome met.

**Payload/conjunction rule**: the self-tests compare the full problem list with `JSON.stringify(got) !== JSON.stringify(expected)`, so an extra or missing problem fails. The new governance cases compare exact message lists too. The M13 and M14 kills below show this: they fail on an exact expected rejection, not on "some error".

**Spec-precision flags:**

1. ⚠️ **P2-2 "terminal state"** vs the implementation's "COMPLETED". FAILED is terminal, but the script exits 1 on it. This is a documented interpretation (T6) and is consistent with P2-3's "all N videos completing". Judged outcome met; carried over from round 1.
2. The round-1 flag on P2-3 is resolved. The Independent Test now names the load size (four concurrent `--videos 50` at 3 replicas) and the observable outcome, and the ~2× claim is restated as unmeasured.

---

## Discrimination Sensor

**Isolation.** Each mutation ran in a fresh `git worktree add --detach /private/tmp/platform-v2-<id> HEAD`. The worktrees are under `/private/tmp`, not `/tmp`, to avoid the symlink false positive noted in round 1. `mutate.py` asserted that each pattern matched exactly once. Each worktree was removed with `--force`, then pruned.

**Baseline.** The real tree's `git status --porcelain` baseline is ` M .specs/LESSONS.md`, ` M .specs/lessons.json` and `?? .specs/features/observability/validation.md`. It was identical after every mutant (`porcelain=same` ×19 runs). At the end, `git worktree list` shows only the real tree.

**Checks run per mutant.** All ran with `COMPOSE_FILE` and the port variables unset: `check-observability.mjs` (default mode), its `--self-test`, `load-test.mjs --self-test`, `check-ci-governance.mjs` and its `--self-test`, and `docker compose -f compose.yaml config -q`. M0 and M21 also ran the live check read-only: `env.sh`, then `CATALOG_HOST_PORT=33001 node scripts/check-observability.mjs --live`.

**Control.** M0, the unmutated control, passed all 7 checks.

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| M7c (re-run) | `.github/workflows/ci.yml:64-65` | `check-observability --self-test` step removed from `topology` | ✅ Killed. Governance default mode: `the topology job must run "node scripts/check-observability.mjs --self-test" as a one-line step of its own` |
| M7d (re-run) | `.github/workflows/ci.yml:65` | `... --self-test \|\| true` | ✅ Killed. Same message |
| M12 (re-run) | `.github/workflows/ci.yml:62-63` | default-mode step removed from `topology` | ✅ Killed. `...must run "node scripts/check-observability.mjs" as a one-line step of its own` |
| M9 (re-run) | `grafana/dashboards/overview.json:17-19` | query variable `label_values(fiapx_uploads_total, owner_email)`, as a string query plus a definition | ✅ Killed. Default mode: `overview.json variable "v": label owner_email may carry personal data or an unbounded id`. Self-test: "repository as committed" |
| M9b (new) | `grafana/dashboards/overview.json:17-19` | the same variable in Grafana's `{ query, refId }` object form, with no `definition` | ✅ Killed. Same message |
| M13 (new, guard) | `scripts/check-ci-governance.mjs:282` | `...topologyProblems(text)` dropped from `workflowProblems` | ✅ Killed. Governance self-test: `M12: ... accepted, expected rejection`, and the same for the M7c and load-test cases |
| M14 (new, guard) | `scripts/check-ci-governance.mjs:326` | one-line exact match weakened to `step.run?.includes(command)` | ✅ Killed. Governance self-test: `M7d: ... masked by \|\| true (near-miss): accepted` and `M12: ... accepted`. A first variant without `?.` crashed on a `uses:` step, so it was discarded as a non-behavioral kill and re-run |
| M15 (new, workflow) | `.github/workflows/ci.yml:16` | `continue-on-error: true` on the `topology` job | ✅ Killed. `the topology job must not set continue-on-error` |
| M16 (new, workflow) | `.github/workflows/ci.yml:67` | load-test self-test as `run: \|` with `set +e` | ✅ Killed. `...must run "node scripts/load-test.mjs --self-test" as a one-line step of its own` |
| M16b (new, workflow) | `.github/workflows/ci.yml:66` | load-test step gated with `if: ${{ false }}` | ✅ Killed. `topology step "Prove the load test names a video that does not complete" must not be conditioned on "false"` |
| M17 (new, template) | `scripts/check-observability.mjs:373` | `variable.type !== 'query'` flipped to `===` | ✅ Killed. Self-test: all 3 variable corruptions `got []` |
| M18 (new, template) | `scripts/check-observability.mjs:375` | `definition` no longer inspected | ✅ Killed. Self-test: `a template variable whose definition selects by request id: got []` |
| M19 (new, template) | `scripts/check-observability.mjs:249` | `label_values`' label argument not added to the labels | ✅ Killed. Self-test: `M9: a template variable listing owner emails: got []` |
| M20 (new, port) | `scripts/check-observability.mjs:492` | `['catalog', catalogPort]` changed to `['catalog', 3001]` | ✅ Killed. Self-test: `live: the catalog on a moved host port: got ["live: catalog /metrics answered 0 without a fiapx_ line"], expected []` |
| M21 (new, port) | `scripts/check-observability.mjs:854` | `--live` ignores the env var (`catalogPort: 3001`) | ✅ Killed, live only. Every offline check exits 0. The read-only `CATALOG_HOST_PORT=33001 ... --live` exits 1 with `catalog /metrics answered 404` and `catalog /health/live answered 404`, because a foreign process holds 3001 |
| M22 (new, port) | `compose.yaml:88` | container side `...:3001` changed to `...:3002` (the Catalog listens on 3001) | ⚠️ **Not killed offline**: all 6 offline checks exit 0, because no offline check compares the published container port with the service's `PORT`. It would be killed by construction in CI `integration`: `smoke-local-integration.mjs:42,904` fetches `localhost:3001/processing-requests/…` and `--live` probes `localhost:3001`, both with the default port. That was not executed, because the shared stack must not be recreated. The mapping was fixed `3001:3001` before this feature and was equally unchecked offline, so this is not a regression. It is recorded as an open item |

**Sensor depth**: expanded. 18 behavior-level mutations plus 1 control. They cover the re-runs of all 4 round-1 survivors, 5 against the new governance guard, 4 against the template-variable check and 3 against the `CATALOG_HOST_PORT` wiring.
**Result**: 17/18 killed. M22 is not killed offline and is covered by the integration layer (open item). Every round-1 survivor is killed. PASS ✅

---

## Interactive UAT Results

Not performed. This is infrastructure, so automated checks plus live probes are enough (validate.md §7).

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ Each fix is confined to its finding: +76/-6 governance, +59/-8 dashboard check, +29/-15 port wiring, and docs. |
| No abstractions for single-use code | ✅ `namesProblems` is shared by panels and variables; `topologyProblems` mirrors `docsLinksProblems`. |
| Surgical changes | ✅ The compose change is one line. The smoke change is one line and follows the existing `STORAGE_HOST_PORT` pattern. |
| Matches existing patterns/style | ✅ Exact-message self-test cases, near-miss cases, and the "Host ports already in use" pattern. |
| Spec-anchored outcome check | ✅ 14/14, with 1 flag judged as outcome met |
| Per-layer Coverage Expectation | ✅ Every new guard has self-test cases that the sensor proved discriminating (M13, M14, M17-M20). |
| Every test maps to a spec requirement | ✅ The new cases map to OBS-74, OBS-71 and OBS-62 (the PII rule in design.md) or to F5. |
| Documented guidelines followed | ✅ `.github/workflows/ci.yml` topology steps, all re-run green |

One behavior change is intended and documented. The governance good fixture no longer allows a gated topology step, and the real `ci.yml` has none (`56f153e`).

---

## Edge Cases

- [x] Slow `/metrics`: the target is marked down with `scrape_timeout 10s` (`prometheus.yml:10`, `README.md:250`). Live: `scrapeTimeout 10s`.
- [x] Stale Mailpit inbox: the load test never reads Mailpit and polls only its own request ids (`load-test.mjs:119-128`).
- [x] `WORKER_REPLICAS` unset: 1 replica (`compose.yaml:124`, check `:449`).
- [x] Malformed dashboard JSON fails in CI (`check-observability.mjs:683-684`), and the CI step is now guarded (M7c killed).
- [x] Correlation-id trace: the README now matches the stack (re-run live, see Round 1 → Round 2).
- [x] Catalog host port: it moves with `CATALOG_HOST_PORT`, and `--live` follows it (M20, M21 killed).

---

## Gate Check

Every step of the CI `topology` job, plus `generate-db-script --check` and `docker compose -f compose.yaml config -q`, was run by the Verifier on HEAD `9a32486` with `COMPOSE_FILE` unset. Every exit code was 0:

| Command | Exit | Output |
| ------- | ---- | ------ |
| `docker compose config > rendered-compose.yml` | 0 | |
| The Python "build or image" assertion | 0 | 12 services validated |
| `check-worker-sizing` | 0 | |
| `check-worker-sizing --self-test` | 0 | |
| `check-no-storage-writes` | 0 | |
| `check-no-storage-writes --self-test` | 0 | |
| `node --check scripts/smoke-local-integration.mjs` | 0 | |
| `smoke-local-integration --self-test` | 0 | |
| `check-storage-bootstrap --self-test` | 0 | |
| `check-identity --self-test` | 0 | |
| `generate-db-script --self-test` | 0 | |
| `check-ci-governance` | 0 | "topology runs the 3 observability checks unconditionally" |
| `check-ci-governance --self-test` | 0 | 39 bad workflows rejected, 2 good accepted |
| `check-docs-links --self-test` | 0 | |
| `apply-required-checks --self-test` | 0 | |
| `check-observability` | 0 | |
| `check-observability --self-test` | 0 | 40 corruptions rejected; committed tree and healthy live stack accepted; spawned failure non-zero |
| `load-test --self-test` | 0 | 20 assertions |
| `check-docs-links` | 0 | 0 unresolved |
| `generate-db-script --check` | 0 | |
| `docker compose -f compose.yaml config -q` | 0 | |

- **Live (read-only)**: `source env.sh && CATALOG_HOST_PORT=33001 node scripts/check-observability.mjs --live` exits 0. As a discrimination check, the same command without `CATALOG_HOST_PORT` exits 1 with exactly the two catalog lines.
- **Test count before the fixes (round 1)**: governance 30 bad workflows; check-observability 36 corruptions; load-test 20 assertions.
- **Test count after the fixes**: governance 39 (+9); check-observability 40 (+3 template cases, +1 live moved-port case, +1 good variable and +1 good live case accepted); load-test 20. Nothing was removed or weakened.
- **Skipped**: none. **Failures**: none.

---

## Fix Plans

None are blocking. This is the final round, so the leftovers are open items.

### Validar depois (open items)

1. **M22: the Catalog's published container port is not checked offline.** Offline, nothing requires the container side of `catalog`'s `ports` to equal its `PORT` (3001). CI's `integration` job catches it (smoke + `--live`). A small fix is possible: add a rule to `check-observability.mjs`'s compose section requiring `services.catalog.ports[].target === 3001`, plus one self-test corruption. Priority: Minor.
2. **An empty `CATALOG_HOST_PORT=` is read two ways.** Compose's `:-` renders 3001, but `--live` and the smoke use `??`, so they build `http://localhost:/…`. The smoke's `STORAGE_HOST_PORT` has the same pre-existing pattern. Priority: Cosmetic.
3. **First CI run of OBS-72, and `generate-db-script --check` on `main`.** Both wait on the merge order (AD-016). This PR merges last.
4. **V66: the full correlation trace needs one log line per handled message** in `processing-worker`, `notification-service` and the `processing-catalog` consumers. This is an out-of-repo follow-up, and the README no longer claims it.
5. Round-1 observations 5 and 6 are carried: the `/tmp` symlink path comparison, and the default mode running when the module is imported.
6. The T12 outcome still has to go into the PR description.

---

## Requirement Traceability Update

| Requirement | Previous Status (spec.md) | New Status |
| ----------- | ------------------------- | ---------- |
| OBS-61, 62, 63, 66, 67, 68 | Verified live | ✅ Verified (re-probed live on HEAD) |
| OBS-64, 65 | Verified live | ✅ Verified (structural checks + recorded live) |
| OBS-69 | Verified live on the burst; awaiting re-verification | ✅ Verified (T12 burst; reworded Independent Test and SC-2 justified in tasks.md F3) |
| OBS-70, 71 | Verified | ✅ Verified |
| OBS-72 | Verified wiring; first CI run pending | ✅ Verified wiring; ⏳ first CI run on the PR |
| OBS-73 | Awaiting re-verification | ✅ Verified (README claims re-run live) |
| OBS-74 | Awaiting re-verification | ✅ Verified (M7c, M7d, M12, M9 killed; `--live` exit 0) |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 14/14 ACs match the spec outcome; 1 spec-precision flag (P2-2 COMPLETED vs terminal) judged as outcome met
**Sensor**: 17/18 killed. All four round-1 survivors are killed. M22 is not killable offline and is covered by the CI integration layer (open item 1).
**Gate**: 21/21 offline commands exit 0; live `--live` exit 0

**What works**: Prometheus scrapes all five jobs every 15 s. Grafana provisions `fiapx-overview` from read-only files. The broker serves per-queue depth. `WORKER_REPLICAS` defaults to 1 and scales. The load test's verdict and exit are discriminated. Every CI step an AC names, in both `topology` and `integration`, is now guarded against removal and masking. Template variables obey the metric and PII rules. The Catalog host port moves with one variable, and the gate follows it. The README's trace and scaling claims match the stack and the T12 record.

**Next steps**: open the PR once the service PRs are merged (AD-016), put the T12 outcome in its description, and schedule the open items.
