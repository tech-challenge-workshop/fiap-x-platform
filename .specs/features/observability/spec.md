# Observability — FIAP X Platform Specification

Part of S8 (observability and autoscale), split across 5 sibling specs (`fiap-x-api` OBS-01..15, `processing-catalog` OBS-16..30, `processing-worker` OBS-31..45, `notification-service` OBS-46..60, `fiap-x-platform` OBS-61..75). This repo's job: wire the observability stack (Prometheus, Grafana, the RabbitMQ metrics plugin), parameterize Worker replicas, provide the repeatable load evidence, and gate it all in CI.

## Problem Statement

The stack runs with zero observability: no Prometheus, no Grafana, no metrics anywhere, and no way to demonstrate the load behavior the hackathon asks to prove (RT-2 — arquitetura escalável; RF-1 — mais de um vídeo ao mesmo tempo). The foundation doc already promises Prometheus + Grafana as the monitoring choice and a `/metrics` endpoint per service. The four service repos deliver their pieces under this feature; this repo turns them into a working, scrapeable, demonstrable stack.

## Goals

- [ ] `docker compose up` brings up Prometheus (scraping every service's `/metrics` and the RabbitMQ plugin) and Grafana (auto-provisioned datasource + dashboard) alongside the existing 10 services.
- [ ] `WORKER_REPLICAS` scales the Worker in Compose, and the versioned `scripts/load-test.mjs` demonstrates queue depth rising and processing throughput following — the S8 "pronto quando".
- [ ] CI keeps it honest: a self-tested check script asserts every service exposes `/metrics` and split health, and the integration job runs a small live load.

## Out of Scope

| Feature | Reason |
| --- | --- |
| KEDA / HPA / Kubernetes manifests | S9a; S8 proves the behavior at Compose level and exposes the metrics KEDA will consume |
| Managed cloud monitoring | S9b / out of the delivery line (AD-005 local-first) |
| Alerting rules and notification channels | "Alertas em produção" out of S8 scope |
| Long-term metrics storage / retention beyond local volumes | Local demonstration stack |
| Tracing (OpenTelemetry) | Optional per S8 scope |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| RabbitMQ metrics source | The broker's built-in `prometheus` plugin on port 15692, enabled in `rabbitmq/rabbitmq.conf` | Zero extra images; official; covers queue depth/age natively | n (user skipped; default chosen — review at confirm) |
| Prometheus/Grafana images | `prom/prometheus` and `grafana/grafana` pinned by digest-or-minor-version, config mounted from this repo | Same convention as the other pinned services |
| Host ports | Prometheus `9090`, Grafana `3005` (3000 is taken by the API mapping) | Avoid collisions with the existing port map |
| Grafana provisioning | Datasource + dashboard loaded from versioned `grafana/provisioning/` directories; no UI-click dependency | Everything-as-code is the project's established pattern |
| Dashboard content | One overview dashboard with the foundation's minimum set: uploads/downloads outcomes, queue depth + outbox gauges, processing rate/duration, email outcomes | Directly answers the "pronto quando" |
| Worker replicas | `deploy.replicas: ${WORKER_REPLICAS:-1}`; the load test documents running with `WORKER_REPLICAS=3` | Default keeps today behavior; RF-1 evidence uses the override (user skipped; default chosen — review at confirm) |
| Load evidence | Versioned `scripts/load-test.mjs` with `--self-test`, N concurrent full pipelines (login → presigned upload → confirm → poll to terminal); CI runs a small N (≤3) against the integration stack | Repeatable "pronto quando" gate (user skipped; default chosen — review at confirm) |
| Grafana auth | `admin/admin` env-configured, local only, documented | Hackathon-local stack |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: The stack scrapes and dashboards itself ⭐ MVP

**User Story**: As an operator, I want `docker compose up` to bring up Prometheus scraping every service and the RabbitMQ plugin, with Grafana showing the foundation's minimum metric set on an auto-provisioned dashboard, so that observability works with zero manual UI steps.

**Why P1**: It is the observable backbone of S8 and the harness for every other story.

**Acceptance Criteria**:

1. WHEN the stack is provisioned with `docker compose up --build -d --wait` THEN a `prometheus` service SHALL be healthy scraping, every 15 s, all four services' `/metrics` endpoints and the RabbitMQ plugin endpoint, and a `grafana` service SHALL be healthy on host port 3005. <!-- event-driven -->
2. WHEN Grafana starts THEN it SHALL have the Prometheus datasource and the overview dashboard provisioned from versioned files, with no manual configuration step. <!-- event-driven -->
3. WHEN the RabbitMQ container starts THEN the `prometheus` plugin SHALL serve queue metrics on port 15692, including per-queue depth for `video-validation`, `processing`, and `notification.terminal`. <!-- event-driven -->
4. WHEN a service is not yet up THEN Prometheus SHALL still start and retry the scrape (the stack must not deadlock on monitoring). <!-- event-driven -->
5. IF the Grafana or Prometheus container is removed THEN `docker compose up -d` SHALL recreate it with the same provisioned state from the repo files. <!-- unwanted-behavior -->
6. The Prometheus and Grafana services SHALL mount their configuration read-only from this repository and SHALL NOT require credentials to read the scrape targets. <!-- ubiquitous -->
7. WHEN the `topology` CI job runs THEN `scripts/check-observability.mjs --self-test` SHALL run and SHALL fail on malformed Prometheus config, unparsable dashboard JSON, or dangling provisioning references. <!-- event-driven -->

**Independent Test**: After `up --build -d --wait`, `curl :9090/api/v1/targets` shows all targets up, and opening Grafana at :3005 shows the overview dashboard populated with live series from every service; the topology job fails if a dashboard panel is corrupted in the repo.

---

### P2: Worker replicas and repeatable load evidence

**User Story**: As an operator, I want to raise Worker replicas with one variable and run a versioned load test that drives N concurrent videos end-to-end, so that the dashboard shows queue depth rising and throughput following — the RF-1/RT-2 demonstration, repeatable any time and in CI.

**Why P1**: This is the S8 "pronto quando" and the video's scaling evidence.

**Acceptance Criteria**:

1. WHEN `WORKER_REPLICAS=N` is set THEN Compose SHALL run N Worker containers competing on the same queues, each healthy. <!-- event-driven -->
2. WHEN `node scripts/load-test.mjs --videos N` runs against a healthy stack THEN it SHALL authenticate once, drive N concurrent full pipelines (upload → confirm → poll to terminal), and SHALL print per-video latency and final status counts with a non-zero exit if any video does not reach a terminal state. <!-- event-driven -->
3. WHEN the load test runs THEN the Grafana dashboard SHALL show queue depth rising during the run and the processing rate following it, with all N videos completing. <!-- event-driven -->
4. IF any pipeline fails to reach a terminal state within the timeout THEN the script SHALL exit non-zero and SHALL identify the failing video. <!-- unwanted-behavior -->
5. WHEN `--self-test` is passed THEN the script SHALL run its assertion helpers against a fixture without a live stack and SHALL exit zero, proving the harness itself. <!-- event-driven -->
6. WHEN the integration CI job runs THEN it SHALL execute the self-test plus a small live load (N≤3) against the stack and SHALL fail the job on a non-zero exit. <!-- event-driven -->

**Independent Test**: `WORKER_REPLICAS=3 docker compose up -d worker && node scripts/load-test.mjs --videos 6` completes with 6/6 terminal; Prometheus shows `processing` queue depth >0 during the run and `fiapx_processing_total` accumulating ~2× the single-replica rate.

---

### P3: Documented operator walkthrough

**User Story**: As an evaluator running the project locally, I want the README to document the observability ports, how to open the dashboard, and the exact load-test commands so that the S8 evidence is reproducible without tribal knowledge.

**Why P3**: Not required for the system to work, but the hackathon evaluation is done by third parties reading this repository.

**Acceptance Criteria**:

1. The platform README SHALL document: the Prometheus and Grafana host ports, the RabbitMQ metrics and management ports, the `WORKER_REPLICAS` variable, and the exact commands to run the load test and to open the overview dashboard. <!-- ubiquitous -->

**Independent Test**: A reader following only the README reaches a populated Grafana dashboard and a completed load-test run on a clean checkout.

---

## Edge Cases

- IF a service's `/metrics` is slow THEN Prometheus marks the target down without affecting the service (scrape timeout 10 s, documented).
- IF the load test runs against a stale inbox (Mailpit already holding messages) THEN its assertions filter by its own request ids, never by mailbox emptiness (same lesson as the S7 smoke).
- IF `WORKER_REPLICAS` is unset THEN the default stays 1 — today's behavior unchanged.
- WHEN Grafana provisions THEN dashboard JSON validity is checked by a `--self-test`-able script so a malformed panel fails in CI, not on stage.

---

## Implicit-Requirement Dimensions Sweep

| Dimension | Resolution |
| --- | --- |
| Input validation & bounds | OBS-68: `--videos N` validates N (integer ≥1, ≤ 50) |
| Failure / partial-failure | OBS-70: non-terminal pipeline → non-zero exit naming the video; OBS-71: self-testable harness |
| Idempotency / retry / duplicate | N/A — the load test creates fresh uploads; dedup guarantees come from S6 |
| Auth boundaries | Grafana/Prometheus local-only with default creds documented; scrape targets unauthenticated |
| Concurrency / ordering | N pipelines run concurrently; polling respects per-video timeouts |
| Data lifecycle / expiry | N/A — load-test artifacts are prints, nothing persisted |
| Observability | this feature |
| External-dependency failure | Monitoring containers must not gate the business stack's health (story P1 AC4) |
| State-transition integrity | N/A — no lifecycle changes |

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| OBS-61 | P1: Stack (Prometheus scrape set) | Execute | Verified live (T2, T5; T12: every target up) |
| OBS-62 | P1: Stack (Grafana provisioning) | Execute | Verified live (T3, T4; T12: `fiapx-overview` provisioned, 17/18 queries with series) |
| OBS-63 | P1: Stack (RabbitMQ plugin) | Execute | Verified live (T1; T12: per-queue depth scraped, `processing` 0 → 22 → 0) |
| OBS-64 | P1: Stack (resilient startup) | Execute | Verified live (T2, T5; T12: clean `up --wait` healthy) |
| OBS-65 | P1: Stack (recreate from repo) | Execute | Verified live (T5; T12: from `down -v`, no UI step) |
| OBS-66 | P1: Stack (config from repo, no creds on targets) | Execute | Verified live (T5; T12) |
| OBS-67 | P2: Replicas (N workers) | Execute | Verified live (T5; T12: 3 healthy replicas, 3 worker targets, scale back to 1) |
| OBS-68 | P2: Load test (N pipelines) | Execute | Verified live (T6; T12: 6/6, 40/40, 200/200 COMPLETED) |
| OBS-69 | P2: Load test (dashboard evidence) | Execute | Partial (T12: depth and per-replica processing series recorded; ~2× rate not measurable with the 8 s fixture) |
| OBS-70 | P2: Load test (failure exit) | Execute | Implementing (T6) |
| OBS-71 | P2: Load test (self-test) | Execute | Implementing (T6) |
| OBS-72 | P2: CI (self-test + small live load) | Execute | Implementing (T8; first live run on the PR) |
| OBS-73 | P3: Documented operator walkthrough | Execute | Followed end to end in T12; the log-grep correlation trace reaches the API and Catalog only (open item in T12) |
| OBS-74 | P1: Stack (observability check script) | Execute | Verified live (T7, T8; T12 `--live` at 1 and 3 replicas) |

**ID format:** `OBS-[NUMBER]` — `fiap-x-api` owns OBS-01..15; `processing-catalog` OBS-16..30; `processing-worker` OBS-31..45; `notification-service` OBS-46..60; this repo owns OBS-61..75.

**Coverage:** 14 total, 0 mapped to tasks, 14 unmapped (mapping happens in Tasks).

---

## Success Criteria

- [x] `docker compose up --build -d --wait` yields healthy `prometheus` and `grafana` containers, and Grafana's overview dashboard shows live series from all four services within 60 s.
- [x] `WORKER_REPLICAS=3 docker compose up -d worker` yields 3 healthy workers, and `node scripts/load-test.mjs --videos 6` completes 6/6 terminal with the dashboard showing the queue-depth/processing-rate correlation. (T12: 6/6; the depth and rate series move together on a 200-video burst, since a 6-video run drains between scrapes)
- [ ] CI's `topology` job runs the new check script self-test; the `integration` job runs the load-test self-test plus a small live load.
