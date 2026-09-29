# Observability Tasks — FIAP X Platform

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/observability/design.md`
**Status**: Draft

> **Merge order (critical)**: this PR merges **last** among the five S8 PRs. Its `integration` job checks out the four service repos at their `main` — the Catalog's `AddCorrelationId` migration and the services' `/metrics` endpoints must already be there, or the DB-script gate and the live observability checks fail. Merge `fiap-x-api`, `processing-catalog`, `processing-worker`, `notification-service` first (any order among themselves).

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: no jest in this repo — quality is enforced by `.github/workflows/ci.yml` (`topology` job runs every `scripts/check-*.mjs --self-test` + compose render; `integration` job runs the stack + smoke; `docs-links` checks README/docs links); the `--self-test` convention on every script.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Gate/check scripts | self-test (script) | Every assertion helper and failure path exercised without a live stack | `scripts/check-observability.mjs`, `scripts/load-test.mjs` | `node scripts/<script>.mjs --self-test` |
| Compose / monitoring config | render + self-test | Compose renders; scrape targets reference existing services; dashboard JSON parses; provisioning references resolve | `compose.yaml`, `prometheus/prometheus.yml`, `grafana/**` | `docker compose config -q` + `node scripts/check-observability.mjs --self-test` |
| Live behavior (targets up, dashboard populated, load completes) | live verification | `up --wait` healthy; all targets up; N/6 videos terminal; queue depth visible during run | the running stack | manual/CI live run (T12) |
| Docs (README section) | docs-links | Every relative link resolves | `README.md` | `node scripts/check-docs-links.mjs` |

## Gate Check Commands

> Generated from the CI workflow and script conventions - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After a single script task | `node scripts/<touched-script>.mjs --self-test` |
| Full | After config/script changes | `node scripts/check-observability.mjs --self-test && node scripts/load-test.mjs --self-test && node scripts/check-docs-links.mjs && node scripts/check-ci-governance.mjs --self-test` |
| Build | After phase completion | Full gate + `docker compose -f compose.yaml config -q` |

---

## Execution Plan

Pure dependency chains: each task depends only on the previous one.

### Phase 1: Monitoring configuration

```
T1 -> T2 -> T3 -> T4 -> T5
```

### Phase 2: Compose + scripts

```
T5 -> T6 -> T7 -> T8
```

### Phase 3: CI, docs, decisions, DB script

```
T8 -> T9 -> T10 -> T11 -> T12
```

### Phase 4: Live verification

```
T12
```

---

## Task Breakdown

### T1: RabbitMQ Prometheus plugin

**What**: `rabbitmq/enabled_plugins` (`[rabbitmq_management,rabbitmq_prometheus].`) mounted to `/etc/rabbitmq/enabled_plugins`; `rabbitmq/rabbitmq.conf` gains the explicit `prometheus.tcp.port = 15692`.
**Where**: `rabbitmq/rabbitmq.conf`
**Depends on**: None
**Reuses**: existing rabbitmq config mounts
**Requirement**: OBS-63

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] The stack's rabbitmq container serves `http://localhost:15692/metrics` after `docker compose up -d rabbitmq` and the management UI still works (both plugins enabled — the mounted file overrides the image default)
- [x] Gate check passes: `docker compose config -q` + full self-test gate
- [x] Test count: asserted live in T12 (config layer - matrix)

**Tests**: none
**Gate**: build

**Commit**: `feat(platform): expose rabbitmq metrics via the prometheus plugin`

**Status**: ✅ Complete (2026-09-28). Verified on a throwaway broker (same image and mounts, other host ports, removed after; the shared local stack was not touched): `rabbitmq_queue_messages{vhost="/",queue=...}` served for `video-validation`, `processing` and `notification.terminal`, management API 200, `rabbitmq-plugins list -E` shows both plugins. Beyond the design: `prometheus.return_per_object_metrics = true`, because the plugin aggregates all queues into one unlabelled series by default and OBS-63 AC3 needs the per-queue depth; compose also publishes 15692 on the host. The image default already lists both plugins; the mounted file makes the set repo-owned. Gate: `compose config -q` 0, docs-links 0, ci-governance self-test 0 (`check-observability`/`load-test` land in T6/T7).

---

### T2: Prometheus configuration

**What**: `prometheus/prometheus.yml`: scrape interval 15 s / timeout 10 s; static targets `api:3000`, `catalog:3001`, `notification:3003`, `rabbitmq:15692`; **`dns_sd_configs` (type A, port 3002) for `worker`** so every replica is scraped.
**Where**: `prometheus/prometheus.yml`
**Depends on**: T1
**Reuses**: compose DNS names
**Requirement**: OBS-61, OBS-64

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] `docker compose config -q` renders with the config mounted read-only
- [x] Structural assertions (T7 self-test): every expected target host present; worker uses `dns_sd_configs`; interval bounds sane
- [x] Gate check passes: full self-test gate
- [x] Test count: asserted in T7 self-test

**Tests**: self-test
**Gate**: build

**Commit**: `feat(platform): add the prometheus scrape configuration`

**Status**: ✅ Complete (2026-09-28). `promtool check config` (prom/prometheus:v3.15.0) reports the file valid. Five jobs: `api`, `catalog`, `notification`, `rabbitmq` static; `worker` by `dns_sd_configs` type A port 3002 with a 15 s refresh so a scaled-up replica is picked up within one interval. The read-only mount renders with the `prometheus` service in T5; the structural assertions run in the T7 self-test.

---

### T3: Grafana provisioning

**What**: `grafana/provisioning/datasources/prometheus.yml` (type prometheus, `http://prometheus:9090`, isDefault, uid `prometheus`) and `grafana/provisioning/dashboards/dashboards.yml` (file provider → `/etc/grafana/provisioning/dashboards`, path `/var/lib/grafana/dashboards`).
**Where**: `grafana/provisioning/datasources/prometheus.yml`
**Depends on**: T2
**Reuses**: grafana provisioning-as-code conventions
**Requirement**: OBS-62

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Structural assertions (T7 self-test): datasource + provider files parse and reference resolvable paths
- [x] Gate check passes: full self-test gate
- [x] Test count: asserted in T7 self-test

**Tests**: self-test
**Gate**: build

**Commit**: `feat(platform): add the grafana provisioning configuration`

**Status**: ✅ Complete (2026-09-28). A throwaway `grafana/grafana:13.2.2` with both directories mounted read-only answered `/api/health` ok and `/api/datasources/uid/prometheus` with the provisioned, read-only datasource (default, `http://prometheus:9090`). Found on the way: Grafana refuses to start when an AppleDouble `._*.yml` sidecar sits in a provisioning directory (`yaml: control characters are not allowed`); the build gate's existing first step, `node clean-appledouble.mjs`, removes them (CI's Linux checkout never has them).

---

### T4: Overview dashboard JSON

**What**: `grafana/dashboards/overview.json` (uid `fiapx-overview`, datasource the provisioned uid) with the foundation minimum set: uploads/downloads outcomes; queue depth (`rabbitmq_queue_messages`) for `video-validation`/`processing`/`notification.terminal`; outbox gauges; processing rate + p95 duration; email outcomes; jobs inflight; ~~`fiapx_node_*` row~~ scrape-targets row on `up` (SPEC_DEVIATION: no service exports Node default metrics).
**Where**: `grafana/dashboards/overview.json`
**Depends on**: T3
**Reuses**: metric names from the four service specs
**Requirement**: OBS-62

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] T7 self-test: JSON parses; every panel references the provisioned datasource; every PromQL expression references only metric families the services expose
- [x] Gate check passes: full self-test gate
- [x] Test count: asserted in T7 self-test

**Tests**: self-test
**Gate**: build

**Commit**: `feat(platform): add the overview dashboard`

**Status**: ✅ Complete (2026-09-28). 4 rows, 16 panels, every target on datasource uid `prometheus`. All 18 expressions (with `$__rate_interval` as `1m`) were accepted by a throwaway `prom/prometheus:v3.15.0` query API; a throwaway Grafana provisioned the dashboard (`provisioned: true`, uid `fiapx-overview`). Metric names come from each service's `src/observability/metrics.ts` on `feat/observability` and, for Notification, its design (`fiapx_email_delivery_total{outcome}`, `fiapx_email_send_duration_seconds`). SPEC_DEVIATION: the `fiapx_node_*` row became a scrape-targets row on `up` (recorded in design.md). No expression selects or groups by an owner, email or request-id label.

---

### T5: Compose wiring + worker replicas

**What**: `compose.yaml`: `prometheus` service (pinned image, config ro-mounted, `:9090`, healthcheck `/-/healthy`) and `grafana` service (pinned image, env admin/admin, `:3005`, healthcheck `/api/health`) — with **no business service gaining `depends_on` either**; worker service gains `deploy.replicas: ${WORKER_REPLICAS:-1}` and its host port becomes the range `${WORKER_HOST_PORT:-3010-3019}` (SPEC_DEVIATION: a fixed host port admits one replica).
**Where**: `compose.yaml`
**Depends on**: T4
**Reuses**: existing service conventions (healthchecks, pins)
**Requirement**: OBS-61, OBS-64, OBS-65, OBS-66, OBS-67

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] `docker compose config` renders; `WORKER_REPLICAS=3 docker compose config` shows 3 replicas; `--wait` brings prometheus+grafana healthy
- [x] T7 self-test: no business service depends on prometheus/grafana
- [x] Gate check passes: full self-test gate + render
- [x] Test count: asserted in T7 self-test

**Tests**: self-test
**Gate**: build

**Commit**: `feat(platform): add prometheus and grafana to the compose stack`

**Status**: ✅ Complete (2026-09-28). Rendered replicas: 1 by default, 3 with `WORKER_REPLICAS=3`; `WORKER_HOST_PORT=33002` renders the single port. `docker compose -p obs-t5 up -d --wait prometheus grafana` (a throwaway project with only the two services, torn down after) brought both healthy with no business service running, Grafana served `fiapx-overview` as provisioned, and Prometheus listed the absent targets as down rather than blocking (OBS-64). Images pinned: `prom/prometheus:v3.15.0`, `grafana/grafana:13.2.2`; Grafana listens on 3005 inside and out (`GF_SERVER_HTTP_PORT`). SPEC_DEVIATION: the worker host port range (design.md, Worker replicas). Phase 1 build gate: `compose config -q` 0, `check-worker-sizing` and its self-test 0, `check-ci-governance` and its self-test 0, docs-links 0 (the two new scripts arrive in T6/T7).

---

### T6: load-test.mjs

**What**: `scripts/load-test.mjs`: `--videos N` (integer 1..50, default 6), `--timeout-seconds` (per video, default 120), `--base-url`/`--token-cmd` overrides; one token via `get-token.mjs`; N concurrent full pipelines (start → PUT presigned parts of `fixtures/sample-8s.mp4` → confirm with unique idempotency key → poll to terminal); per-video latency table + status counts; non-zero exit naming stuck/failed videos; `--self-test` with an injected fetch driver proving parallelism, aggregation, and the stuck-video exit.
**Where**: `scripts/load-test.mjs`
**Depends on**: T5
**Reuses**: `get-token.mjs`, fixture, status names from the smoke
**Requirement**: OBS-68, OBS-70, OBS-71

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] `--self-test` exits 0 and covers: N=1..50 validation, concurrent starts (all N in flight before any completes), one stuck video → non-zero exit naming it
- [x] Gate check passes: `node scripts/load-test.mjs --self-test`
- [x] Test count: 12 self-test assertions pass (no silent deletions)

**Tests**: self-test
**Gate**: quick

**Commit**: `feat(platform): add the concurrent load test script`

**Status**: ✅ Complete (2026-09-28). Self-test: 20 assertions (planned 12): defaults; N=1 and N=50 accepted; N=0, 51, 2.5, `six`, -1 rejected with the exact message; timeout 0 rejected; 5 uploads all in flight before the first status read (a barrier holds each start until all have started); one Idempotency-Key per video; each part PUT with its slice; one token on every API call; mixed-run counts `COMPLETED 2/3, FAILED 1/3` with the FAILED video named; a stuck video named `still PROCESSING after 120 s`; a clean run passes; a spawned run against a dead API exits 1 naming each video; a spawned `--videos 51` exits 2. Six mutants on scratch copies (sequential driver, no timeout, FAILED accepted, exit 0 on failure, max 49, one shared key) were each killed. Interpretation: the verdict requires COMPLETED, not just a terminal status, because OBS-69 asks for "all N videos completing" and a FAILED run of the valid fixture is a defect; the report still counts every status. Polling reads the request through the API with the run's one token.

---

### T7: check-observability.mjs

**What**: `scripts/check-observability.mjs`: `--self-test` validates the structural invariants (prometheus targets + dns_sd for worker + interval bounds; dashboard JSON parses with datasource references and only-known-metric PromQL; provisioning paths resolve; compose declares prometheus/grafana with healthchecks and no reverse `depends_on`; load-test self-test composition) — failing on any corruption; `--live` additionally curls every service `/metrics` for a `fiapx_` line and `/health/live` for 200.
**Where**: `scripts/check-observability.mjs`
**Depends on**: T6
**Reuses**: `check-*` script conventions
**Requirement**: OBS-74 (+ structural backing for OBS-61..67)

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] `--self-test` exits 0 and each structural invariant has a failing-mutation probe (corrupt the dashboard JSON / drop a target / add a reverse depends_on → non-zero)
- [x] Gate check passes: `node scripts/check-observability.mjs --self-test`
- [x] Test count: 10 self-test scenarios pass (no silent deletions)

**Tests**: self-test
**Gate**: quick

**Commit**: `feat(platform): add the observability wiring check script`

**Status**: ✅ Complete (2026-09-28). Three modes. Default: the structural invariants over the repository and `docker compose config --format json` rendered with `WORKER_REPLICAS` unset (exit 0 on the committed tree, also with `WORKER_REPLICAS=3` exported). `--self-test` (no Docker): 36 corruptions each rejected with the exact message (planned 10) — 7 Prometheus (dropped target, static worker, SRV lookup, interval 1m, timeout 15s, credentials, unsupported YAML), 2 provisioning, 8 dashboard (corrupt JSON, panel and query datasource, near-miss metric, `fiapx_node_*`, owner label, request-id selector, uid), 4 broker (either plugin dropped, per-object off, port moved), 9 compose (reverse `depends_on` on prometheus and on grafana, prometheus waiting on the stack, missing health check, writable config, unmounted dashboards, missing service, unmounted `enabled_plugins`, default replicas 2), 6 live (no `fiapx_` line, a replica not live, aggregated queue metrics, a worker target down, fewer worker targets than replicas, dashboard not provisioned); the committed tree and a healthy live stack accepted; `load-test.mjs --self-test` composed; a spawned run on a corrupted copy exits 1 with the exact stderr. Ten mutants of the checker on scratch copies were each killed. `--live` probes each service's `/metrics` (`fiapx_` line) and `/health/live` (every worker replica by its published host port), the broker's per-queue depth, every Prometheus target up with one worker target per replica, and the provisioned dashboard; run against a stack that is not up it reports each missing piece and exits 1. The YAML files are read by a small strict parser (block maps, block and flow sequences) that throws on any other construct.

---

### T8: CI wiring

**What**: `.github/workflows/ci.yml`: `topology` job += `node scripts/check-observability.mjs --self-test` (and keeps every existing check); `integration` job += after the second smoke: `node scripts/load-test.mjs --videos 3` (default replica count).
**Where**: `.github/workflows/ci.yml`
**Depends on**: T7
**Reuses**: existing job structure; `check-ci-governance.mjs` keeps guarding the job shape
**Requirement**: OBS-72, OBS-74

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] `check-ci-governance.mjs --self-test` still passes (its guard on `integration` shape is intact)
- [x] Gate check passes: full self-test gate
- [x] Test count: asserted via the governance self-test

**Tests**: self-test
**Gate**: full

**Commit**: `ci(platform): gate the observability wiring and the small live load`

**Status**: ✅ Complete (2026-09-28). `topology` gains three steps: `check-observability.mjs` (the real tree and rendered compose), its `--self-test`, and `load-test.mjs --self-test` (OBS-72 asks for the load test's self-test in CI; it runs in `topology` with the other self-tests, as design.md notes). `integration` gains, after the second smoke and identity check, `load-test.mjs --videos 3` and `check-observability.mjs --live`. Beyond the task: both live commands join `check-ci-governance.mjs`'s guarded stack commands (now 10, in order), so a `|| true`, a condition or a removal fails the governance check as it would for the smoke; its self-test gains two cases (load test masked with `|| true`; live check dropped) and the extra-smoke case now names position 11. Governance self-test: 30 bad workflows rejected (was 28), 2 good accepted; the real `ci.yml` passes. Phase 2 build gate: `check-observability` self-test and default 0, `load-test` self-test 0, docs-links 0, governance and its self-test 0, `compose config -q` 0, and every other topology check still 0.

---

### T9: README observability section

**What**: Document: Prometheus `:9090`, Grafana `:3005` (admin/admin), RabbitMQ metrics `:15692` / management `:15672`, `WORKER_REPLICAS`, the exact load-test commands, and the dashboard walkthrough (what each row proves).
**Where**: `README.md`
**Depends on**: T8
**Reuses**: existing README structure
**Requirement**: OBS-73

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] `node scripts/check-docs-links.mjs` passes
- [ ] Gate check passes: full self-test gate
- [ ] Test count: docs layer (matrix) — links checked

**Tests**: none
**Gate**: full

**Commit**: `docs(platform): document the observability stack and load test`

---

### T10: Record AD-016 and AD-017

**What**: Append the two decisions to `.specs/STATE.md`: AD-016 (correlationId contract: originated at the API edge, persisted by the Catalog, propagated by the Worker, consumed by Notification; optional everywhere; strict-parse on read; ≤128 chars on write) and AD-017 (observability conventions: nestjs-pino + prom-client, `fiapx_` prefix, bounded labels, `/health` + `/health/live`, unauthenticated `/metrics`, RabbitMQ metrics via the built-in plugin, worker scrape via dns_sd, load evidence via `load-test.mjs`).
**Where**: `.specs/STATE.md`
**Depends on**: T9
**Reuses**: existing AD entry format
**Requirement**: OBS-62 (AD-015 follow-on convention)

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Both entries follow the AD format (Decision/Reason/Trade-off/Scope/Date/Status: active)
- [ ] Gate check passes: `node scripts/check-docs-links.mjs`
- [ ] Test count: docs layer (matrix)

**Tests**: none
**Gate**: quick

**Commit**: `docs(platform): record the correlation contract and observability decisions`

---

### T11: Regenerate the database creation script

**What**: Run `node scripts/generate-db-script.mjs` and commit the regenerated `db/create-database.sql` (now including the Catalog's `AddCorrelationId` migration). **Inter-repo dependency**: the regeneration must reflect the migration on Catalog's `main` — run this after the four service PRs merge (locally: point the sibling `../processing-catalog` checkout at the S8 branch to prepare, re-run after merge).
**Where**: `db/create-database.sql`
**Depends on**: T10
**Reuses**: `generate-db-script.mjs` (`--check` gate in CI)
**Requirement**: ENT-2 continuity (OBS-16 consequence)

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] `node scripts/generate-db-script.mjs --check` exits 0 **after** the Catalog S8 PR is on `main` (re-run post-merge; the integration job proves it)
- [ ] Gate check passes: full gate + `--check`
- [ ] Test count: gate layer (matrix)

**Tests**: none
**Gate**: build

**Commit**: `feat(platform): regenerate the database creation script for the correlation column`

---

### T12: Live verification ("pronto quando")

**What**: Against a clean local stack: `docker compose up --build -d --wait` → all scrape targets up at `:9090/api/v1/targets` → Grafana at `:3005` shows the populated overview dashboard → `WORKER_REPLICAS=3 docker compose up -d worker` → `node scripts/load-test.mjs --videos 6` completes 6/6 terminal → during the run the dashboard shows `processing` queue depth >0 and `fiapx_processing_total` accumulating ~2× the single-replica rate. Record the outcome in the PR description.
**Where**: `scripts/load-test.mjs`
**Depends on**: T11
**Reuses**: everything above
**Requirement**: OBS-61..72 (outcome evidence)

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Every step above observed and captured (target list, dashboard screenshot/excerpt, load-test summary)
- [ ] Gate check passes: the load test exits 0 with 6/6 terminal
- [ ] Test count: live evidence recorded in the feature validation phase

**Tests**: self-test
**Gate**: full

**Commit**: `chore(platform): record the live observability verification run`

---

## Phase Execution Map

```
Phase 1:  T1 -> T2 -> T3 -> T4 -> T5
Phase 2:  T5 -> T6 -> T7 -> T8
Phase 3:  T8 -> T9 -> T10 -> T11 -> T12
Phase 4:  T12
```

Execution is strictly sequential — one task at a time, gate before commit, one Conventional Commit per task.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 | rabbitmq plugin config | ✅ Granular (conf + its plugin file are one unit) |
| T2 | 1 config file | ✅ Granular |
| T3 | provisioning pair | ⚠️ Cohesive (datasource + provider ship together) |
| T4 | 1 dashboard JSON | ✅ Granular |
| T5 | compose.yaml wiring | ✅ Granular (one file, one concern: monitoring topology) |
| T6 | 1 script | ✅ Granular |
| T7 | 1 script | ✅ Granular |
| T8 | 1 workflow file | ✅ Granular |
| T9 | README section | ✅ Granular |
| T10 | STATE.md entries | ✅ Granular |
| T11 | regenerated artifact | ✅ Granular |
| T12 | live verification | ✅ Granular (verification slice) |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | none | none | ✅ Match |
| T2 | T1 | T1 -> T2 | ✅ Match |
| T3 | T2 | T2 -> T3 | ✅ Match |
| T4 | T3 | T3 -> T4 | ✅ Match |
| T5 | T4 | T4 -> T5 | ✅ Match |
| T6 | T5 | T5 -> T6 | ✅ Match |
| T7 | T6 | T6 -> T7 | ✅ Match |
| T8 | T7 | T7 -> T8 | ✅ Match |
| T9 | T8 | T8 -> T9 | ✅ Match |
| T10 | T9 | T9 -> T10 | ✅ Match |
| T11 | T10 | T10 -> T11 | ✅ Match |
| T12 | T11 | T11 -> T12 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | monitoring config | render + live | build gate + T12 live | ✅ OK |
| T2 | monitoring config | render + self-test | build gate + T7 self-test | ✅ OK |
| T3 | monitoring config | self-test | self-test | ✅ OK |
| T4 | dashboard JSON | self-test | self-test | ✅ OK |
| T5 | compose config | render + self-test | self-test | ✅ OK |
| T6 | script | self-test | self-test | ✅ OK |
| T7 | script | self-test | self-test | ✅ OK |
| T8 | workflow | self-test (governance) | self-test | ✅ OK |
| T9 | docs | docs-links | none (gate runs docs-links) | ✅ OK |
| T10 | docs | docs-links | none (gate runs docs-links) | ✅ OK |
| T11 | generated artifact | gate (--check) | none (gate is --check) | ✅ OK |
| T12 | live verification | live | self-test + live | ✅ OK |
