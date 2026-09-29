# Local Kubernetes (S9a) Specification

## Problem Statement

The whole FIAP X topology runs only under Docker Compose, where the Worker scales by a hand-set `WORKER_REPLICAS` (S8). The hackathon asks for a scalable architecture (RT-2) and CI/CD (RT-5), and AD-005/AD-007 promise the topology as versioned Kubernetes manifests with the Worker autoscaled by queue depth. Nothing of that exists yet: there are no manifests, no autoscaler, and no service image is published anywhere a cluster could pull it from. The slice's "pronto quando" is the video scene: `kubectl get hpa` showing the Worker's replicas rising under load and returning to the minimum afterwards.

## Goals

- [ ] One documented command provisions a local kind cluster and brings all eleven workloads of the Compose topology to Ready, and the existing smoke passes against it.
- [ ] The Worker scales out on queue depth through KEDA (a real HPA) and scales back in to 1 when the queues drain, with no job lost.
- [ ] Every credential reaches a pod only through a Kubernetes `Secret` generated at provisioning time; no versioned manifest carries one.
- [ ] Each service's CI publishes its image to GHCR on `main`, and the cluster runs those published images (the CD half of RT-5).
- [ ] The platform CI proves the manifests offline on every PR and provisions a real kind cluster that must pass the smoke.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Managed cloud (EKS, GKE, AKS), Terraform | S9b, optional and outside the delivery (AD-005) |
| Helm charts or third-party charts for the dependencies | The dependencies reuse the exact images and config files Compose already runs; a chart adds a second source of truth |
| Ingress controller, TLS, DNS names | Host access keeps the Compose ports through kind port mappings; the smoke and README already use them |
| High availability of Postgres, RabbitMQ, RustFS, Keycloak | Single replica each, as in Compose; this is a local topology |
| Autoscaling of API, Catalog or Notification | Only the Worker has a queue-depth scaling profile (AD-001, AD-006) |
| Scale to zero | Decided: minimum 1 replica (no cold start on the first video) |
| Building the service images locally and loading them into kind | Decided: the cluster pulls the GHCR images; Compose stays the inner dev loop (AD-005) |
| GitOps controllers (Argo CD, Flux), NetworkPolicies, PodSecurity admission tuning | Beyond what RT-2/RT-5 ask; nothing in the delivery depends on them |
| Per-message consumer log lines (V66) | Separate follow-up in the service repos |
| Replacing Docker Compose | Compose remains the dev loop and the platform's `integration` job |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Cluster tool | kind, one cluster named `fiapx`, kube context `kind-fiapx` | Standard local cluster in Docker; the same kind runs in GitHub Actions; host port mappings keep presigned URLs and the OIDC issuer stable | y |
| Image source | `ghcr.io/tech-challenge-workshop/<repo>`, published by each service's CI on `main` as `:<sha>` and `:main` | Closes the CD half of RT-5 with evidence; one image per commit | y |
| Platform CI | Offline manifest checks in `topology` + a new `kubernetes` job that runs kind, the up command and the smoke | Proves the cluster on every PR, not only by hand | y |
| Worker minimum replicas | 1 | No cold start on the first video; the video shows 1 → N → 1 | y |
| Kube context safety | Every `kubectl` call made by the platform's scripts names `--context kind-fiapx`; the scripts never read or switch the current context | This machine's current context is a real EKS cluster from another project; one missed flag would apply the topology there | y |
| Namespace | All workloads in namespace `fiapx`; KEDA in its own `keda` namespace | One place to inspect; KEDA's upstream manifest owns its namespace | n |
| Host ports | The same host ports Compose publishes (3000 API, 3001 Catalog, 3003 Notification, 8080 Keycloak, 9000 storage, 8025 Mailpit, 15672/15692 RabbitMQ, 9090 Prometheus, 3005 Grafana), via kind port mappings | The smoke, load test, `get-token` and README work unchanged; the OIDC issuer (`http://localhost:8080/realms/fiapx`) and presigned URLs keep their hosts | n |
| Coexistence with Compose | The cluster and the Compose stack cannot run at the same time (same host ports); the up command fails fast naming the busy port | Two parallel host-port schemes would split every script and doc | n |
| Worker sizing in the cluster | CPU request = limit = 1 per replica, `FFMPEG_THREADS=1`, maximum 5 replicas | AD-006 ties threads to the CPU limit; 5 × 1 CPU leaves room for the rest of the topology on a 10-CPU Docker host | n |
| Scaling signal | KEDA RabbitMQ scaler over the management API (`protocol: http`, counts ready + unacknowledged), `mode: QueueLength`: `processing` target 2 per replica (its prefetch 1 + one waiting), `video-validation` target 20 per replica (its prefetch); polling 5 s; HPA scale-down stabilization 60 s | The AMQP protocol counts only ready messages, which hides what the Worker's prefetch holds; each target matches the queue's per-replica prefetch so a replica is added exactly when one more could take work (design research, KEDA 2.21 docs) | n |
| Credentials | Generated by the up command at provisioning time (random per cluster), except values fixed by versioned fixtures (demo realm users, the Postgres init roles) which are test identities of a throwaway local cluster | The requirement is "no secret in any repository or image"; demo logins are fixtures, not secrets, and already live in the repo for Compose | n |
| Postgres init roles | The cluster reuses `db/init/01-schemas.sql` unchanged, so the `catalog`/`notification` role passwords stay the fixture values; the services read them from a `Secret` | Changing the init script would diverge from Compose and the `create-database.sql` gate | n |
| Stateful data | Postgres and RustFS on PersistentVolumeClaims of kind's default storage class; RabbitMQ and Keycloak ephemeral, exactly as in Compose | Mirrors Compose behavior; `down` deletes the cluster and its data | n |
| GHCR package visibility | The four packages are public (repos are public); if GitHub creates them private, a one-time visibility change in the org UI is recorded as a manual step, and until then the `kubernetes` CI job pulls with an `imagePullSecret` built from `GITHUB_TOKEN` | Could not verify: the local `gh` token lacks `read:packages`. Flagged as uncertain | n |
| KEDA installation | Pinned upstream release manifest applied by the up command (no Helm) | One version, one file, no new tool dependency | n |
| Required checks | The `kubernetes` job becomes a required check of `fiap-x-platform` only after its first green run on `main`, and only with an explicit go-ahead (ruleset change is remote) | Blast-radius rule: ruleset changes need confirmation (same as V51/D) | n |
| Merge order | Service repos (image publishing) merge first; the platform PR merges after the four `:main` images exist on GHCR | The `kubernetes` job pulls `:main`; without published images it cannot pass (same shape as AD-015/AD-016) | n |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Provision the topology on a local cluster ⭐ MVP

**User Story**: As a team member preparing the demo, I want one command that creates a local Kubernetes cluster and runs the whole FIAP X topology on it, so that the system runs as versioned manifests and not only under Compose.

**Why P1**: Without a running cluster there is no autoscaling to show and no manifest to prove; everything else in the slice stands on it.

**Acceptance Criteria**:

1. WHEN the documented up command runs on a machine with Docker, kind and kubectl THEN it SHALL create a kind cluster named `fiapx` (or reuse it if it exists) and apply the topology to namespace `fiapx`  <!-- event-driven -->
2. WHEN the up command finishes with exit 0 THEN every Deployment and StatefulSet in namespace `fiapx` SHALL report all replicas Ready and the storage bootstrap Job SHALL report Complete  <!-- event-driven -->
3. IF any workload is not Ready within 600 seconds THEN the up command SHALL exit non-zero and name each workload that is not Ready  <!-- unwanted-behavior -->
4. The platform's scripts SHALL pass `--context kind-fiapx` on every `kubectl` invocation and SHALL NOT read, use or change the current kube context  <!-- ubiquitous -->
5. IF Docker, kind or kubectl is not available THEN the up command SHALL exit non-zero naming the missing tool before creating anything  <!-- unwanted-behavior -->
6. IF a host port the cluster publishes is already bound THEN the up command SHALL exit non-zero naming the port before creating the cluster  <!-- unwanted-behavior -->
7. WHEN the up command runs a second time against an existing, healthy cluster THEN it SHALL exit 0 and leave every workload Ready with the same number of replicas  <!-- event-driven -->
8. WHEN the documented down command runs THEN it SHALL delete only the kind cluster named `fiapx`  <!-- event-driven -->
9. Each of the four service Deployments SHALL declare a readiness probe on `GET /health` and a liveness probe on `GET /health/live` on the service's port  <!-- ubiquitous -->
10. WHEN the cluster is up THEN the smoke (`scripts/smoke-local-integration.mjs`) run with the cluster target SHALL pass, with its database observations made through `kubectl --context kind-fiapx exec` into Postgres and its bucket observations through a one-shot `kubectl --context kind-fiapx run` aws-cli pod reading the storage Secret, instead of `docker compose exec`/`run`  <!-- event-driven -->
11. WHEN a token is requested from the host with `scripts/get-token.mjs` THEN the API in the cluster SHALL accept it (issuer `http://localhost:8080/realms/fiapx`)  <!-- event-driven -->
12. WHEN the API in the cluster issues a presigned upload or download URL THEN the URL SHALL be usable from the host on `localhost:9000`  <!-- event-driven -->

**Independent Test**: On a machine without the Compose stack running, run the up command, then `kubectl --context kind-fiapx -n fiapx get pods` shows every pod Ready and the smoke with the cluster target exits 0.

---

### P1: Keep credentials in cluster secrets ⭐ MVP

**User Story**: As the team, I want every credential to reach the pods only through Kubernetes secrets created at provisioning time, so that no repository or image carries one (AD-005).

**Why P1**: It is one of the three seed criteria of S9a and a stated rule of AD-005 that Compose only approximates.

**Acceptance Criteria**:

1. The versioned manifests SHALL pass every credential (database passwords, storage access and secret keys, the Keycloak bootstrap admin password, RabbitMQ credentials used by KEDA) to containers only through `secretKeyRef` or `secretRef`  <!-- ubiquitous -->
2. The versioned manifests SHALL NOT contain any `Secret` object with `data` or `stringData`  <!-- ubiquitous -->
3. WHEN the up command provisions a new cluster THEN it SHALL create the Secrets with values generated for that cluster, except the fixture values listed in the Assumptions table  <!-- event-driven -->
4. IF a versioned manifest sets a literal `value` for an environment variable whose name contains `PASSWORD`, `SECRET`, `ACCESS_KEY` or `TOKEN` THEN the offline manifest check SHALL exit non-zero naming the manifest and the variable  <!-- unwanted-behavior -->
5. IF a versioned manifest contains a `Secret` with `data` or `stringData` THEN the offline manifest check SHALL exit non-zero naming the manifest  <!-- unwanted-behavior -->

**Independent Test**: `grep` the rendered manifests for credential values finds none; the offline check rejects a planted literal password; `kubectl --context kind-fiapx -n fiapx get secrets` lists the generated secrets after the up command.

---

### P1: Autoscale the Worker on queue depth ⭐ MVP

**User Story**: As the presenter, I want the Worker to add replicas when videos pile up in the queues and remove them when the queues drain, so that `kubectl get hpa` shows scalability live (RT-2, RF-1).

**Why P1**: It is the slice's "pronto quando" and the scene that proves scalability in the video.

**Acceptance Criteria**:

1. The Worker SHALL be scaled by a KEDA `ScaledObject` with `minReplicaCount` 1 and `maxReplicaCount` 5, triggered by the RabbitMQ queue length (ready + unacknowledged) of `processing` with a target of 2 messages per replica and of `video-validation` with a target of 20 messages per replica  <!-- ubiquitous -->
2. WHEN the up command finishes THEN `kubectl --context kind-fiapx -n fiapx get hpa` SHALL list the HPA that KEDA created for the Worker  <!-- event-driven -->
3. WHEN `processing` holds more than 2 messages per current replica, or `video-validation` more than 20, THEN the Worker Deployment SHALL scale out, up to 5 replicas  <!-- event-driven -->
4. WHEN both Worker queues have been empty for the cooldown period THEN the Worker Deployment SHALL scale back to 1 replica within 300 seconds  <!-- event-driven -->
5. IF a Worker pod is terminated during scale-in while a job is in flight THEN that job SHALL be redelivered and reach `COMPLETED` on another replica, not `FAILED`  <!-- unwanted-behavior -->
6. The Worker container SHALL declare CPU request and limit equal to `FFMPEG_THREADS` (AD-006), and the offline manifest check SHALL exit non-zero if they differ  <!-- ubiquitous -->
7. KEDA SHALL authenticate to RabbitMQ through a `TriggerAuthentication` that reads a Secret; the `ScaledObject` SHALL NOT carry a connection string with credentials  <!-- ubiquitous -->

**Independent Test**: With the cluster up, run a burst with the load test; `kubectl get hpa -w` shows the Worker's replicas above 1 during the burst, every video reaches `COMPLETED`, and the replicas return to 1 within 300 s of the queues emptying.

---

### P2: Observe the cluster with the S8 stack

**User Story**: As the presenter, I want Prometheus and Grafana running in the cluster with the S8 dashboard, so that the video shows queue depth and replica count next to `kubectl get hpa`.

**Why P2**: The scaling is provable from `kubectl` alone; the dashboard makes it legible.

**Acceptance Criteria**:

1. WHEN the cluster is up THEN Prometheus in the cluster SHALL scrape every Worker pod individually, discovering new replicas without a manifest change  <!-- event-driven -->
2. WHEN the cluster is up THEN Prometheus SHALL scrape the API, Catalog, Notification and RabbitMQ (port 15692) targets, all reporting `up == 1`  <!-- event-driven -->
3. WHEN the cluster is up THEN Grafana SHALL serve the dashboard `fiapx-overview` provisioned from the same `grafana/dashboards/overview.json` Compose uses  <!-- event-driven -->

**Independent Test**: After a burst, Prometheus's targets page lists one worker target per replica, and the Grafana dashboard shows the queue depth rising and draining.

---

### P2: Publish service images to GHCR (CD)

**User Story**: As the team, I want each service's CI to publish its image to GHCR on every merge to `main`, so that the cluster deploys exactly what CI built and tested.

**Why P2**: It closes the CD half of RT-5; the cluster could not pull images without it.

**Acceptance Criteria**:

1. WHEN a commit lands on `main` of `fiap-x-api`, `processing-catalog`, `processing-worker` or `notification-service` and the `quality` job passes THEN the `image` job SHALL push `ghcr.io/tech-challenge-workshop/<repo>:<commit-sha>` and `:main`  <!-- event-driven -->
2. WHEN the `image` job runs for a pull request THEN it SHALL build the image and SHALL NOT push it  <!-- event-driven -->
3. The `image` job SHALL authenticate to GHCR with the workflow's `GITHUB_TOKEN` and `packages: write` permission, and SHALL NOT use a personal token  <!-- ubiquitous -->
4. The cluster's manifests SHALL reference the four service images on `ghcr.io/tech-challenge-workshop/`, never a locally built tag  <!-- ubiquitous -->

**Independent Test**: After a merge to a service's `main`, `docker pull ghcr.io/tech-challenge-workshop/<repo>:<sha>` succeeds; a PR run shows the build step and no push.

---

### P2: Prove the cluster in the platform CI

**User Story**: As the team, I want the platform CI to prove the manifests on every PR, so that a broken manifest cannot merge.

**Why P2**: Without a gate the manifests drift from Compose and from the services the way V10/V37 showed for the database script.

**Acceptance Criteria**:

1. WHEN the `topology` job runs THEN it SHALL render the manifests with `kubectl kustomize`, validate them against the Kubernetes schemas, and run the offline manifest check (credentials, Worker sizing, probes, image registry, context flag)  <!-- event-driven -->
2. WHEN the offline manifest check runs with `--self-test` THEN it SHALL reject one planted corruption per rule and exit non-zero on each  <!-- event-driven -->
3. WHEN a pull request to `fiap-x-platform` runs CI THEN a `kubernetes` job SHALL create a kind cluster, run the up command and run the smoke with the cluster target, and fail if either exits non-zero  <!-- event-driven -->
4. IF a step of the `kubernetes` job is conditioned, marked `continue-on-error`, or masked with `|| true` THEN `check-ci-governance` SHALL exit non-zero  <!-- unwanted-behavior -->

**Independent Test**: A PR that breaks a probe path fails `topology`; a PR that breaks a Deployment's env fails `kubernetes` at the smoke.

---

### P3: Document the scaling demo

**User Story**: As the presenter, I want a README section with the exact commands of the scaling scene, so that the video can be recorded without improvising.

**Why P3**: Everything it documents is already delivered by P1–P2.

**Acceptance Criteria**:

1. The README SHALL document the up, down and smoke-with-cluster-target commands, the prerequisite tools with their minimum versions, the host ports, and that the cluster and Compose cannot run at the same time  <!-- ubiquitous -->
2. The README SHALL document the scaling scene: the burst command, `kubectl --context kind-fiapx -n fiapx get hpa -w`, and the expected 1 → N → 1 replica sequence  <!-- ubiquitous -->

---

## Edge Cases

- IF the current kube context is not `kind-fiapx` (for example an EKS context) THEN the scripts SHALL still act only on `kind-fiapx` and SHALL NOT touch the current context (covered by P1 AC 4).
- IF the `fiapx` kind cluster exists but is stopped or unhealthy THEN the up command SHALL exit non-zero with a message to run the down command first.
- IF GHCR is unreachable or an image tag is missing THEN the up command SHALL exit non-zero naming the pod stuck in `ImagePullBackOff`/`ErrImagePull` (covered by P1 AC 3).
- IF the storage bootstrap Job fails THEN the up command SHALL exit non-zero naming the Job, and the API and Worker SHALL NOT be reported Ready by the up command.
- WHEN the Worker is at 5 replicas and the queues keep growing THEN it SHALL stay at 5 replicas and the queued videos SHALL still complete.
- IF the RabbitMQ credentials in the KEDA `TriggerAuthentication` Secret are wrong THEN the Worker SHALL stay at its current replica count and `kubectl describe scaledobject` SHALL show the authentication error (no crash of the Worker).

---

## Implicit-Requirement Dimensions (sweep)

| Dimension | Resolution |
| --------- | ---------- |
| Input validation & bounds | Tool/port/context preflight (P1 AC 4–6); replica bounds 1–5 (Autoscale AC 1) |
| Failure / partial-failure states | Readiness timeout names the workload (P1 AC 3); bootstrap Job failure; image pull failure (Edge Cases) |
| Idempotency / retry / duplicate handling | Re-running up is a no-op (P1 AC 7); scale-in redelivers in-flight jobs (Autoscale AC 5) |
| Auth boundaries & rate limits | Secrets only (Secrets story); GHCR via `GITHUB_TOKEN` (Publish AC 3); KEDA `TriggerAuthentication` (Autoscale AC 7); rate limits N/A because nothing new is exposed beyond the Compose surface |
| Concurrency / ordering | Startup ordering without `depends_on`: bootstrap Job must complete (P1 AC 2, Edge Cases); competing Worker replicas already safe (S4 dedup, S8) |
| Data lifecycle / expiry | PVCs live as long as the cluster; `down` deletes the cluster and its data (Assumptions) |
| Observability | Prometheus/Grafana in cluster (P2 Observe); probes on the S8 health contract (P1 AC 9) |
| External-dependency failure | GHCR unreachable (Edge Cases); RabbitMQ auth failure for KEDA (Edge Cases) |
| State-transition integrity | Scale-out/scale-in transitions bounded and reversible (Autoscale AC 3–5) |

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| K8S-01 | P1: Provision - cluster created/reused, topology applied | Tasks | In Tasks |
| K8S-02 | P1: Provision - all workloads Ready, bootstrap Complete | Tasks | In Tasks |
| K8S-03 | P1: Provision - 600 s readiness timeout names workloads | Tasks | In Tasks |
| K8S-04 | P1: Provision - `--context kind-fiapx` on every kubectl call | Execute | In progress (T5 helper; T6 static scan; T24-T28 callers) |
| K8S-05 | P1: Provision - missing tool preflight | Tasks | In Tasks |
| K8S-06 | P1: Provision - busy host port preflight | Tasks | In Tasks |
| K8S-07 | P1: Provision - idempotent re-run | Tasks | In Tasks |
| K8S-08 | P1: Provision - down deletes only `fiapx` | Tasks | In Tasks |
| K8S-09 | P1: Provision - readiness/liveness probes | Tasks | In Tasks |
| K8S-10 | P1: Provision - smoke passes with cluster target | Tasks | In Tasks |
| K8S-11 | P1: Provision - host token accepted (issuer) | Tasks | In Tasks |
| K8S-12 | P1: Provision - presigned URL usable from host | Tasks | In Tasks |
| K8S-13 | P1: Secrets - credentials only via secret refs | Tasks | In Tasks |
| K8S-14 | P1: Secrets - no Secret with data in the repo | Tasks | In Tasks |
| K8S-15 | P1: Secrets - generated at provisioning | Tasks | In Tasks |
| K8S-16 | P1: Secrets - check rejects literal credential env | Execute | Implemented (T6 offline rule + self-test) |
| K8S-17 | P1: Secrets - check rejects committed Secret data | Execute | Implemented (T6 offline rule + self-test) |
| K8S-18 | P1: Autoscale - ScaledObject 1–5, processing target 2, validation target 20 | Tasks | In Tasks |
| K8S-19 | P1: Autoscale - HPA listed | Tasks | In Tasks |
| K8S-20 | P1: Autoscale - scale out under load | Tasks | In Tasks |
| K8S-21 | P1: Autoscale - scale back to 1 within 300 s | Tasks | In Tasks |
| K8S-22 | P1: Autoscale - in-flight job survives scale-in | Tasks | In Tasks |
| K8S-23 | P1: Autoscale - CPU request = limit = FFMPEG_THREADS | Execute | In progress (T6 rule; T18 manifest) |
| K8S-24 | P1: Autoscale - TriggerAuthentication from Secret | Tasks | In Tasks |
| K8S-25 | P2: Observe - every Worker pod scraped | Tasks | In Tasks |
| K8S-26 | P2: Observe - other targets up | Tasks | In Tasks |
| K8S-27 | P2: Observe - dashboard from the same JSON | Tasks | In Tasks |
| K8S-28 | P2: Publish - push `:sha` and `:main` on main | Execute | Implemented on `feat/publish-images` in the four service repos (T1-T4); unmerged, first publish proven in T34 |
| K8S-29 | P2: Publish - PRs build without pushing | Execute | Implemented (T1-T4); the PR run proving build without push is recorded in T34 |
| K8S-30 | P2: Publish - `GITHUB_TOKEN` + `packages: write` | Execute | Implemented (T1-T4: `GITHUB_TOKEN`, job-level `packages: write`) |
| K8S-31 | P2: Publish - manifests reference GHCR images | Tasks | In Tasks |
| K8S-32 | P2: CI - topology renders, validates, checks | Tasks | In Tasks |
| K8S-33 | P2: CI - offline check self-test | Execute | In progress (T6 self-test; T20 required workloads) |
| K8S-34 | P2: CI - `kubernetes` job kind + up + smoke | Tasks | In Tasks |
| K8S-35 | P2: CI - governance guards the `kubernetes` job | Tasks | In Tasks |
| K8S-36 | P3: Docs - commands, tools, ports, exclusivity | Tasks | In Tasks |
| K8S-37 | P3: Docs - the scaling scene | Tasks | In Tasks |

**ID format:** `K8S-NN`. K8S-28..30 are implemented in the four service repos' CI workflows; every other requirement lives in `fiap-x-platform`.

**Coverage:** 37 total, 37 mapped to tasks (T1–T34 in `tasks.md`), 0 unmapped.

---

## Success Criteria

- [ ] On a clean machine with Docker, kind and kubectl, the up command brings the eleven workloads to Ready in under 10 minutes and the smoke with the cluster target exits 0.
- [ ] During a load-test burst, `kubectl get hpa` shows the Worker above 1 replica, every video reaches `COMPLETED`, and the Worker is back to 1 replica within 300 s of the queues emptying.
- [ ] No versioned file in the five repositories contains a credential value for the cluster, and the offline check proves it on every PR.
- [ ] The platform CI's `kubernetes` job is green on a PR, pulling the four service images from GHCR.
