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

- [x] `node scripts/check-docs-links.mjs` passes
- [x] Gate check passes: full self-test gate
- [x] Test count: docs layer (matrix) — links checked

**Tests**: none
**Gate**: full

**Commit**: `docs(platform): document the observability stack and load test`

**Status**: ✅ Complete (2026-09-28). New `Observability` and `Worker replicas and the load test` sections: the ports table (Prometheus 9090, Grafana 3005 `admin`/`admin` with the `fiapx-overview` URL, broker metrics 15692, management 15672, each service's `/metrics`), scrape discovery, the `/metrics`/`/health`/`/health/live`/log conventions, `X-Correlation-Id` with a follow-one-video example, the dashboard's four rows and what each proves, the AppleDouble rule before `docker compose up` (the workspace root's `clean-appledouble.mjs`; this repo has no copy), `check-observability.mjs` in its three modes, `WORKER_REPLICAS` and the exact load-test commands. Also brought up to date: the `WORKER_HOST_PORT` default is the `3010-3019` range with `docker compose port --index N worker 3002`; the unauthenticated API routes; CI now runs build-gate steps 6 to 12 and governance guards ten stack commands; the build gate gains step 12 (load of 3 + `--live`) and step 16 (observability check, both self-tests); the layout lists `prometheus/`, `grafana/`, `rabbitmq/`. `/health` is documented per service as the code has it: readiness with 503 in the Catalog, Worker and Notification, always 200 in the API, which has no dependency it must reach to serve (API design, Tech Decisions). Gate: docs-links 0 (0 unresolved), `check-observability`/`load-test`/governance/smoke self-tests 0.

---

### T10: Record AD-016 and AD-017

**What**: Append the two decisions to `.specs/STATE.md`: AD-016 (correlationId contract: originated at the API edge, persisted by the Catalog, propagated by the Worker, consumed by Notification; optional everywhere; strict-parse on read; ≤128 chars on write) and AD-017 (observability conventions: nestjs-pino + prom-client, `fiapx_` prefix, bounded labels, `/health` + `/health/live`, unauthenticated `/metrics`, RabbitMQ metrics via the built-in plugin, worker scrape via dns_sd, load evidence via `load-test.mjs`).
**Where**: `.specs/STATE.md`
**Depends on**: T9
**Reuses**: existing AD entry format
**Requirement**: OBS-62 (AD-015 follow-on convention)

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Both entries follow the AD format (Decision/Reason/Trade-off/Scope/Date/Status: active)
- [x] Gate check passes: `node scripts/check-docs-links.mjs`
- [x] Test count: docs layer (matrix)

**Tests**: none
**Gate**: quick

**Commit**: `docs(platform): record the correlation contract and observability decisions`

**Status**: ✅ Complete (2026-09-28). AD-016 and AD-017 appended before the Handoff section in the existing format; AD-016 also carries a `Merge order` line, as AD-015 does. Checked against the code on each service's `feat/observability`, not only the designs: the parse rule (`/^[\x20-\x7E]{1,128}$/` after trimming) in the API and Catalog `correlation-context.ts`; the API client sending header and body field; the Catalog's `varchar(128) NULL` migration and its 400 on an invalid id; the Worker's `withMessageCorrelation` (strict parse, fresh UUID, never fails the message); the four `logger.config.ts` (root `mixin` with `service`/`correlationId`, `timestamp`, bare and nested redact paths, probe paths out of the access log); `/health` 503 in the Catalog, Worker and Notification controllers and always 200 in the API's. Gate: docs-links 0.

---

### T11: Regenerate the database creation script

**What**: Run `node scripts/generate-db-script.mjs` and commit the regenerated `db/create-database.sql` (now including the Catalog's `AddCorrelationId` migration). **Inter-repo dependency**: the regeneration must reflect the migration on Catalog's `main` — run this after the four service PRs merge (locally: point the sibling `../processing-catalog` checkout at the S8 branch to prepare, re-run after merge).
**Where**: `db/create-database.sql`
**Depends on**: T10
**Reuses**: `generate-db-script.mjs` (`--check` gate in CI)
**Requirement**: ENT-2 continuity (OBS-16 consequence)

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] `node scripts/generate-db-script.mjs --check` exits 0 **after** the Catalog S8 PR is on `main` (re-run post-merge; the integration job proves it) — open until the merge: passes locally against the sibling `processing-catalog` on `feat/observability`
- [x] Gate check passes: full gate + `--check`
- [x] Test count: gate layer (matrix)

**Tests**: none
**Gate**: build

**Commit**: `feat(platform): regenerate the database creation script for the correlation column`

**Status**: ✅ Complete locally (2026-09-28); the CI proof waits on the merge order. The generator reads each service's migrations from the sibling working tree (`../processing-catalog`, `../notification-service`), not from a branch, so it was run with both siblings on `feat/observability` and clean. Against `main` only the Catalog's migrations differ (`1789959000000-AddCorrelationId.ts`); Notification's are unchanged. Before regenerating, `--check` exited 1 at line 144 expecting `-- from 1789959000000-AddCorrelationId.ts`; the regenerated script adds exactly that block (`ALTER TABLE processing_request ADD COLUMN IF NOT EXISTS correlation_id varchar(128) NULL`) before the Notification section, and `--check` then exits 0. CI's `integration` job checks the Catalog out at `main`, so its `--check` fails until the Catalog PR merges; this PR merges last (AD-016, same constraint as AD-015). Phase 3 build gate: `generate-db-script` `--check` and `--self-test` 0, `check-observability` default and `--self-test` 0, `load-test --self-test` 0, docs-links and its self-test 0, governance and its self-test 0, worker sizing 0, no-storage-writes 0, `docker compose -f compose.yaml config -q` 0.

---

### T12: Live verification ("pronto quando")

**What**: Against a clean local stack: `docker compose up --build -d --wait` → all scrape targets up at `:9090/api/v1/targets` → Grafana at `:3005` shows the populated overview dashboard → `WORKER_REPLICAS=3 docker compose up -d worker` → `node scripts/load-test.mjs --videos 6` completes 6/6 terminal → during the run the dashboard shows `processing` queue depth >0 and `fiapx_processing_total` accumulating ~2× the single-replica rate. Record the outcome in the PR description.
**Where**: `scripts/load-test.mjs`
**Depends on**: T11
**Reuses**: everything above
**Requirement**: OBS-61..72 (outcome evidence)

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Every step above observed and captured (target list, dashboard excerpt, load-test summary), except "~2× the single-replica rate" (see Status)
- [x] Gate check passes: the load test exits 0 with 6/6 terminal
- [ ] Test count: live evidence recorded in the feature validation phase (the evidence is below; the Verifier carries it into `validation.md`)

**Tests**: self-test
**Gate**: full

**Commit**: `chore(platform): record the live observability verification run`

**Status**: ⚠️ Partial (2026-09-29). Every step ran and passed. Two things are open: the ~2× rate cannot be shown with the 8 s fixture, and the log-grep correlation trace does not reach the Worker or the Notification Service. The outcome still has to go in the PR description.

Environment. The four siblings were clean on `feat/observability`. `node clean-appledouble.mjs` ran first, then `docker compose down -v`. Host ports 5432 and 9000 belong to unrelated containers, so `POSTGRES_HOST_PORT=55433 STORAGE_HOST_PORT=39000`. Host port 3001 is held by an unrelated local `node` process, and compose hard-codes `3001:3001` for `catalog`. So the run used an uncommitted override (`services.catalog.ports: !override ["33001:3001"]`, through `COMPOSE_FILE`) and `CATALOG_URL=http://localhost:33001` for the smoke. For the same reason, `check-observability --live` unmodified exits 1 with exactly two problems, `catalog /metrics answered 404` and `catalog /health/live answered 404`, which is the foreign process answering. The run's live verdict comes from the script's own exported `liveProblems`, with an HTTP driver that only rewrites `localhost:3001/` to `localhost:33001/`. Nothing else changed.

| Step | Evidence |
| --- | --- |
| `docker compose up --build -d --wait` | exit 0 in 35 s; 11 services running and healthy (`prometheus`, `grafana` included) |
| Smoke | `node scripts/smoke-local-integration.mjs` exit 0 (11 s) |
| `check-observability` | default exit 0; `--live` (port rewrite above) no problems at 1 replica, at 3, and again at 1 |
| Targets, 1 replica | `api:3000`, `catalog:3001`, `notification:3003`, `rabbitmq:15692`, `worker 172.18.0.8:3002`: all `up` |
| `WORKER_REPLICAS=3 docker compose up -d --wait worker` | exit 0 in 10 s; replicas on host 3011/3012/3013, all healthy; Prometheus worker targets `172.18.0.8`, `.13`, `.14:3002` all `up`; `count by (job)(up==1)` through Grafana's datasource proxy: `worker: 3` |
| `node scripts/load-test.mjs --videos 6` (3 replicas) | `COMPLETED 6/6` in 4 s wall, latencies 2.1-3.2 s; `fiapx_processing_total{outcome="completed"}` delta per replica 3 + 1 + 2 = 6 |
| Heavier runs | 1 replica `--videos 40`: 40/40 in 5 s (avg 3.7 s, max 4.6 s). 3 replicas `--videos 40`: 40/40 in 3 s (avg 3.0 s, max 3.6 s), delta 14 + 13 + 13 = 40. 3 replicas, four concurrent `--videos 50`: 200/200 COMPLETED (max latency 11.3 s), split 66 / 67 / 67 across the replicas |
| Queue depth from 15692 | Prometheus `rabbitmq_queue_messages{queue="processing"}` at 5 s steps over the 200-video burst: `0 … 0, 22, 22, 22, 0 …` (the same broker snapshot at 3 scrapes, then drained); `video-validation` `0, 2, 2, 2, 0`. Direct 0.5 s samples of `:15692` peaked at 3 (1 replica, 40 videos), 13 (3 replicas, 40) and 22 (burst) |
| `fiapx_processing_total` across replicas | `sum(fiapx_processing_total{outcome="completed"})` 93 → 293 over the burst (+200); 93 = 1 smoke + 6 + 40 + 6 + 40 |
| Grafana | `/api/health` 200; `/api/dashboards/uid/fiapx-overview` 200, `meta.provisioned: true`, title `FIAP X Overview`. Its PromQL run against Prometheus over the load window: 17 of 18 return series; the empty one is the 5xx rate, and no 5xx happened |
| Correlation id | Confirmation with `X-Correlation-Id: t12-trace-1790651303` answered 201, echoing the header, and the request (`aef57137-…`) reached `COMPLETED`. `catalog.processing_request.correlation_id` holds it. All three Catalog outbox events carry `"correlationId": "t12-trace-1790651303"`: `VideoValidationRequested` (to the Worker), `ProcessingQueued` (to the Worker) and `terminal.event` (to the Notification Service). `docker compose logs api catalog worker notification \| grep` finds 2 lines, the API access line (`service: fiap-x-api`, `correlationId` set, no `authorization` header) and the Catalog's `POST /processing-requests` access line |
| Scale back | `docker compose up -d --wait worker` with `WORKER_REPLICAS` unset: exit 0 in 16 s. One replica remains (worker-1, host 3011). Live check passes. Prometheus drops the two removed targets within one refresh; for a few seconds `up{job="worker"}` still counts 3 while the staleness catches up. `--videos 3` then completed 3/3 |
| Full gate | `check-observability --self-test` (36 corruptions), `load-test --self-test` (20 assertions), docs-links 0, `check-ci-governance --self-test`: all exit 0 |

Open items (Validar depois):

1. **Log trace stops at the Catalog.** The README's Observability section says `docker compose logs api catalog worker notification | grep <id>` follows one video through all four services. Live, it finds only the two HTTP access lines. The id does travel on the wire, as the outbox rows show. But across ~300 videos, the Worker wrote no line while handling a job (only startup lines), the Notification Service wrote none per delivery, and the Catalog's consumers wrote none (only HTTP access lines). OBS-31 and OBS-46 require the id on *every* line a handler writes, and that holds vacuously, because there are no such lines. Either the consumers log one info line per handled message (a Worker, Notification and Catalog change, out of scope here), or the README claim narrows to "the API and Catalog logs, plus the id on every event". This run did not change code in any service.
2. **~2× the single-replica rate is not observable with this fixture.** The 8 s fixture processes in well under a second, so a run is bound by upload and polling, not by the Worker. 40 videos took 5 s on 1 replica and 3 s on 3, and a 6-video run finishes before the broker's 5 s stats refresh or Prometheus's 15 s scrape. The depth rise and drain in Prometheus needed the 200-video burst. The load spreads evenly across the replicas, but the throughput gain is not measurable at this size.
3. **Catalog host port 3001 is fixed.** Unlike 5432, 9000 and the Worker range, `catalog`'s host port cannot be moved by a variable, and `check-observability --live` and the smoke's default assume 3001. On a machine where 3001 is taken, the live check fails on the catalog lines only. A `CATALOG_HOST_PORT` in the "Host ports already in use" pattern would close it.

---

## Post-verification fixes

The Verifier's round 1 (`validation.md`, FAIL) found four gaps and seven observations. Each fix below is one commit.

| Fix | Finding | Change | Evidence |
| --- | ------- | ------- | -------- |
| F2 | Major: the `topology` job's observability steps could be removed or masked (M7c, M7d, M12 survived) | `check-ci-governance.mjs` requires `node scripts/check-observability.mjs`, its `--self-test` and `node scripts/load-test.mjs --self-test` as one-line steps of the `topology` job, which sets no `if:`, `shell:` or `continue-on-error` and conditions no step. The good fixture no longer gates a topology step | Governance self-test 30 → 39 bad workflows rejected; M7c, M7d, M12 re-run in a scratch worktree, each killed by `check-ci-governance.mjs` |
| F4 | Minor: dashboard template variables escaped the metric and personal-data checks (M9 survived) | `dashboardProblems` applies the metric-existence and label rules to each query variable's `query` (string or `{ query }`) and `definition`; `label_values`' last argument is read as a label | `check-observability --self-test` 36 → 39 corruptions rejected (plus one good variable accepted); M9 re-run in a scratch worktree, as a string query and as `{ query }` + `definition`, each killed by the default mode |
| F5 | Observation: catalog host port 3001 was fixed, and `--live` hard-coded it (T12 open item 3) | `compose.yaml` publishes `${CATALOG_HOST_PORT:-3001}:3001`; `check-observability --live` and the smoke's default `CATALOG_URL` read `CATALOG_HOST_PORT`; README "Host ports already in use" lists it | Default render still `3001:3001`, `CATALOG_HOST_PORT=33001` renders `33001`. Unmodified `CATALOG_HOST_PORT=33001 node scripts/check-observability.mjs --live` exits 0 against the running stack (read-only). Two new live self-test cases: a moved port is probed there, and a moved Catalog probed on 3001 fails naming it (40 rejections) |

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
