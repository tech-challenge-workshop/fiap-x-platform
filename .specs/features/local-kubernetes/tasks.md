# Local Kubernetes (S9a) Tasks — FIAP X Platform

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/local-kubernetes/design.md`
**Status**: Draft

> **Merge order (critical)**: the four **service PRs merge first** (T1–T4, branch `feat/publish-images` in `fiap-x-api`, `processing-catalog`, `processing-worker`, `notification-service`, any order among themselves). Their first run on `main` publishes the multi-arch `:main` images to GHCR. The **`fiap-x-platform` PR merges last**: its `kubernetes` CI job and the live verification (T34) pull those `:main` images, so they cannot pass before the service PRs are on `main`.
>
> **Remote step inside Execute**: T34 needs the published images. Phases 2–7 run locally; before Phase 8 the orchestrator stops and asks for the go-ahead to push and merge the four service PRs (blast-radius rule). After the first publish, check that an anonymous `docker pull ghcr.io/tech-challenge-workshop/<repo>:main` works; if GitHub created the packages private, the org owner sets them public (manual step recorded in T34), or the cluster uses the `ghcr-pull` fallback (`GHCR_TOKEN`).
>
> **Safety**: this machine's current kube context is a real EKS cluster. No task may run `kubectl` without `--context kind-fiapx`, and no task may run `kubectl config use-context`.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: no unit-test runner in this repo; quality is enforced by `.github/workflows/ci.yml` (`topology` runs every `scripts/*.mjs --self-test` and the structural checks; `integration` runs the Compose stack + smoke; `docs-links`) and by the `--self-test` convention on every script (planted corruptions, each must exit non-zero). Service repos: `.github/workflows/ci.yml` only (no workflow linter configured).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Scripts (`kube`, `k8s-up`, `k8s-down`, `check-kubernetes`, smoke adapter) | self-test (script) | Every rule/branch and every listed failure path exercised without a live cluster; one planted corruption per rule | `scripts/*.mjs` | `node scripts/<script>.mjs --self-test` |
| Kubernetes manifests | render + schema + offline rules | Renders with kustomize; kubeconform strict (core + KEDA CRDs); every `check-kubernetes` rule passes | `k8s/*.yaml`, `prometheus/prometheus.k8s.yml` | `node scripts/check-kubernetes.mjs` + kubeconform pipeline |
| Live cluster behavior (readiness, smoke, HPA 1→N→1, scale-in redelivery, idempotent re-run) | live verification | Every P1/P2 AC observed on a real kind cluster with evidence recorded | the running `kind-fiapx` cluster | T34 live run; CI `kubernetes` job |
| CI workflows (platform + services) | governance self-test / YAML parse | Platform: `check-ci-governance` guards the new job; services: workflow parses and the PR run shows build without push | `.github/workflows/ci.yml` | `node scripts/check-ci-governance.mjs --self-test`; `python3 -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" .github/workflows/ci.yml` |
| Docs / decision log | docs-links | Every relative link resolves | `README.md`, `.specs/STATE.md` | `node scripts/check-docs-links.mjs` |

## Gate Check Commands

> Generated from the CI workflow and script conventions - confirm before Execute. `KUBECONFORM` below is `kubeconform -strict -summary -schema-location default -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'`.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Service | Service-repo workflow tasks (T1–T4) | `python3 -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" .github/workflows/ci.yml` in that repo |
| Quick | After a single script task | `node scripts/<touched-script>.mjs --self-test` |
| Full | After manifest or script changes | `node scripts/kube.mjs --self-test && node scripts/check-kubernetes.mjs --self-test && node scripts/check-kubernetes.mjs && kubectl kustomize --load-restrictor LoadRestrictionsNone k8s \| $KUBECONFORM` (+ `node scripts/k8s-up.mjs --self-test` once T24 exists) |
| Build | After phase completion | Full gate + `node scripts/check-ci-governance.mjs && node scripts/check-ci-governance.mjs --self-test && node scripts/check-docs-links.mjs && node scripts/check-observability.mjs && docker compose -f compose.yaml config -q` |

---

## Execution Plan

Pure dependency chains: each task depends only on the previous one.

### Phase 1: Publish multi-arch service images (service repos)

```
T1 -> T2 -> T3 -> T4
```

### Phase 2: Script foundation and kustomization

```
T4 -> T5 -> T6 -> T7 -> T8
```

### Phase 3: Dependency manifests

```
T8 -> T9 -> T10 -> T11 -> T12 -> T13 -> T14
```

### Phase 4: Service manifests and Worker scaling

```
T14 -> T15 -> T16 -> T17 -> T18 -> T19 -> T20
```

### Phase 5: Observability in the cluster

```
T20 -> T21 -> T22 -> T23
```

### Phase 6: Up, down, smoke target, live check

```
T23 -> T24 -> T25 -> T26 -> T27 -> T28
```

### Phase 7: CI, docs, decision

```
T28 -> T29 -> T30 -> T31 -> T32 -> T33
```

### Phase 8: Live verification ("pronto quando")

```
T33 -> T34
```

---

## Task Breakdown

### T1: Publish the API image to GHCR

**What**: `image` job builds `linux/amd64,linux/arm64` with QEMU + buildx, logs in to `ghcr.io` with `GITHUB_TOKEN` and pushes `ghcr.io/tech-challenge-workshop/fiap-x-api:<sha>` and `:main` only on `push` to `main`; PRs build without pushing; job-level `permissions: contents: read, packages: write`; `timeout-minutes: 30`; job name stays `image`.
**Where**: `../fiap-x-api/.github/workflows/ci.yml` (branch `feat/publish-images`)
**Depends on**: None
**Reuses**: the existing `image` job; `docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action`, `docker/build-push-action`
**Requirement**: K8S-28, K8S-29, K8S-30

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Workflow parses (Service gate)
- [x] `push` expression is exactly `github.event_name == 'push' && github.ref == 'refs/heads/main'`; login step runs only under the same condition
- [x] No personal token referenced; tags use `github.sha` and `main`; `org.opencontainers.image.source` label set
- [x] Test count: n/a (workflow; the PR's own CI run proves build-without-push after push, recorded in T34)

**Tests**: none
**Gate**: Service

**Commit**: `ci(api): publish multi-arch images to ghcr on main`

**Status**: ✅ Complete (2026-09-29). Commit `f8d345b` on `fiap-x-api` `feat/publish-images`: the `image` job builds `linux/amd64,linux/arm64` (QEMU + buildx: `docker/setup-qemu-action@v4`, `docker/setup-buildx-action@v4`, `docker/login-action@v4`, `docker/build-push-action@v7`, the latest majors on 2026-09-29) and pushes `:${{ github.sha }}` and `:main` only when `github.event_name == 'push' && github.ref == 'refs/heads/main'`; the GHCR login step carries the same `if:`; job-level `permissions: contents: read, packages: write`; `timeout-minutes: 30`; `needs: quality` and the job name `image` kept; `org.opencontainers.image.source` label set; the only secret referenced is `GITHUB_TOKEN`. Service gate (`yaml.safe_load`) 0; a PyYAML structural check confirmed the push expression, login condition, tags, label and platforms. Only the `image` job changed. The PR run that proves build-without-push is recorded in T34 (not pushed: remote step).

---

### T2: Publish the Catalog image to GHCR

**What**: Same change as T1 for `processing-catalog` (`ghcr.io/tech-challenge-workshop/processing-catalog`).
**Where**: `../processing-catalog/.github/workflows/ci.yml` (branch `feat/publish-images`)
**Depends on**: T1
**Reuses**: T1's job shape
**Requirement**: K8S-28, K8S-29, K8S-30

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Same checks as T1, with this repo's image name
- [x] The existing Postgres service container / `quality` job untouched

**Tests**: none
**Gate**: Service

**Commit**: `ci(catalog): publish multi-arch images to ghcr on main`

**Status**: ✅ Complete (2026-09-29). Commit `fb67325` on `processing-catalog` `feat/publish-images`: same job as T1 with this repo's image; the `quality` job and its Postgres service container are untouched (diff is confined to the `image` job). Service gate 0.

---

### T3: Publish the Worker image to GHCR

**What**: Same change as T1 for `processing-worker` (`ghcr.io/tech-challenge-workshop/processing-worker`); the arm64 stage installs `ffmpeg` under QEMU.
**Where**: `../processing-worker/.github/workflows/ci.yml` (branch `feat/publish-images`)
**Depends on**: T2
**Reuses**: T1's job shape
**Requirement**: K8S-28, K8S-29, K8S-30

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Same checks as T1, with this repo's image name

**Tests**: none
**Gate**: Service

**Commit**: `ci(worker): publish multi-arch images to ghcr on main`

**Status**: ✅ Complete (2026-09-29). Commit `8e7d047` on `processing-worker` `feat/publish-images`: same job as T1 with this repo's image; a comment notes the arm64 stage's `apk add ffmpeg` runs under QEMU, which the 30-minute timeout allows for. Service gate 0.

---

### T4: Publish the Notification image to GHCR

**What**: Same change as T1 for `notification-service` (`ghcr.io/tech-challenge-workshop/notification-service`).
**Where**: `../notification-service/.github/workflows/ci.yml` (branch `feat/publish-images`)
**Depends on**: T3
**Reuses**: T1's job shape
**Requirement**: K8S-28, K8S-29, K8S-30

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Same checks as T1, with this repo's image name

**Tests**: none
**Gate**: Service

**Commit**: `ci(notification): publish multi-arch images to ghcr on main`

**Status**: ✅ Complete (2026-09-29). Commit `a019564` on `notification-service` `feat/publish-images`: same job as T1 with this repo's image. Service gate 0. Completion of T1-T4 is recorded in the platform repository with T5's commit, since the tasks file lives here.

---

### T5: Context-pinned kubectl helper

**What**: `scripts/kube.mjs` exporting `kubectl(args, opts)` (spawns `kubectl --context kind-fiapx …`, throws if `args` contain `--context`/`--kubeconfig` or the subcommand is `config`), `KIND_CLUSTER = 'fiapx'`, `KUBE_CONTEXT = 'kind-fiapx'`, `NAMESPACE = 'fiapx'`; `--self-test` asserts the argument building without spawning (injected spawner).
**Where**: `scripts/kube.mjs`
**Depends on**: T4
**Reuses**: `node:child_process` usage of the other scripts
**Requirement**: K8S-04

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Every built command starts with `kubectl --context kind-fiapx`
- [x] Self-test rejects: `--context` override, `--kubeconfig`, `config use-context`, `config current-context` (4 planted cases, each throws with its message)
- [x] Gate: `node scripts/kube.mjs --self-test` exits 0
- [x] Test count: ≥ 6 self-test assertions

**Tests**: self-test
**Gate**: Quick

**Commit**: `feat(platform): add a kubectl helper pinned to the kind-fiapx context`

**Status**: ✅ Complete (2026-09-29). Self-test: 50 assertions (planned ≥ 6): the three constants; 5 accepted calls each spawn exactly `kubectl --context kind-fiapx <args>` (get, kustomize, server-side apply, create configmap, exec with `--`) plus options pass-through; 13 refused calls each throw their exact message and spawn nothing: `--context` and `--context=`, `--kubeconfig` and `--kubeconfig=`, `--cluster`, `--server`, `-s`, `--user`, `config use-context`, `config current-context`, a leading flag before the subcommand, empty and non-string arguments. Beyond the task: `--cluster`/`--server`/`-s`/`--user` are refused too (each would redirect a call pinned to the context), and the subcommand must come first so `config` cannot hide behind a flag; arguments after `--` (the container command) are not checked. Five mutants on scratch copies (no `config` refusal, context not prepended, `-s` allowed, `--` split ignored, exact-flag match dropped) were each killed. Gate: `node scripts/kube.mjs --self-test` 0.

---

### T6: Offline manifest check

**What**: `scripts/check-kubernetes.mjs` default mode renders `k8s/` (`kubectl kustomize --load-restrictor LoadRestrictionsNone`, a local render - no cluster access) and applies per-object rules: no `Secret` with `data`/`stringData`; no literal env `value` for names matching `/PASSWORD|SECRET|ACCESS_KEY|TOKEN/`; service Deployments `api|catalog|notification|worker` present in the render have readiness `GET /health` and liveness `GET /health/live` on their container port; Worker CPU request = limit = `FFMPEG_THREADS`; Worker has no `spec.replicas`; a `ScaledObject` `worker` has min 1 / max 5, `processing` value `2`, `video-validation` value `20`, `protocol: http`, `authenticationRef` set; service images start with `ghcr.io/tech-challenge-workshop/`; static scan: no `scripts/*.mjs` other than `kube.mjs` spawns `kubectl` directly. `--self-test` plants one corruption per rule. An empty render (no manifests yet) passes.
**Where**: `scripts/check-kubernetes.mjs`
**Depends on**: T5
**Reuses**: `scripts/check-observability.mjs` structure (default/`--self-test`), `scripts/check-worker-sizing.mjs` rule
**Requirement**: K8S-16, K8S-17, K8S-23, K8S-33 (rules also back K8S-09, K8S-18, K8S-24, K8S-31)

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Each rule has a planted corruption that exits non-zero naming the object/variable (≥ 10 corruptions)
- [x] Gate: `node scripts/check-kubernetes.mjs --self-test` and default mode exit 0
- [x] Test count: ≥ 10 self-test cases

**Tests**: self-test
**Gate**: Quick

**Commit**: `feat(platform): add the offline kubernetes manifest check`

**Status**: ✅ Complete (2026-09-29). Self-test: 35 planted corruptions rejected with the exact message (planned ≥ 10): Secret with `data`, with `stringData`; literal credential env in a regular container, an init container, a second key name and a Job (`PASSWORD`, `SECRET_ACCESS_KEY`, `ACCESS_KEY`, `TOKEN`); readiness path `/healthz`, readiness on the wrong named port, liveness on `/health`, no liveness; locally built image, near-miss registry `…-fork`, another repo `…-v2`; worker `replicas`, request ≠ limit, threads ≠ CPU, threads 0, no request; ScaledObject max 10, min 0, other target, `processing` "3", `video-validation` "2", missing queue, `amqp`, `MessageRate`, no `authenticationRef`, a `host` in the trigger; an unreadable render (anchor); and 7 raw-kubectl plants in scanned sources (bare binary, `execSync` command line, `sh -c` string, absolute path, near-miss context `kind-fiapx2`, a spawn after a commented line). 9 good inputs accepted (good render, empty render, namespace-only render, a Secret without data, `1000m` = `"1"`, `kube.mjs` exempt, a printed hint carrying `--context kind-fiapx`, a helper call, a `//` comment naming a command). 7 exact parser readings (literal/strip block scalars, wrapped plain scalar, quoted key and number, block scalar in a sequence, double-quoted escapes and folding); the committed scripts pass the scan; the script spawned on a render whose worker sets `replicas` exits 1 with that message alone, and on the good render exits 0. Default mode with no `k8s/` yet: 0 objects, exit 0. Fifteen mutants on scratch copies (one per rule branch) were each killed. Interpretations: objects are named `Kind/name` (kustomize drops file names; each object lives in one manifest); the credential pattern is case-insensitive; the ScaledObject rule also requires `scaleTargetRef.name: worker` and no `host`/`hostFromEnv` in trigger metadata (K8S-18, K8S-24); the static scan skips `//` comment lines, so a message string that begins with `kubectl ` and lacks `--context kind-fiapx` counts as a raw spawn - scripts phrase messages accordingly. The render is read with a strict parser written for kustomize output (`check-observability`'s parser rejects block scalars and `---`). Gate: `node scripts/check-kubernetes.mjs --self-test` 0, default mode 0.

---

### T7: Kustomization skeleton

**What**: `k8s/kustomization.yaml` with `namespace: fiapx`, `resources: [namespace.yaml]` (namespace object in `k8s/namespace.yaml`), `images:` mapping the four service names to `ghcr.io/tech-challenge-workshop/<name>` tag `main`, and `configMapGenerator` entries for the shared files (`rabbitmq/rabbitmq.conf`, `rabbitmq/enabled_plugins`, `identity/fiapx-realm.json`, `db/init/01-schemas.sql`, `storage/bootstrap.sh`, `grafana/provisioning/**`, `grafana/dashboards/overview.json`, `prometheus/prometheus.k8s.yml` added in T21).
**Where**: `k8s/kustomization.yaml`
**Depends on**: T6
**Reuses**: the Compose config files (single source)
**Requirement**: K8S-01, K8S-31

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Renders with the load restrictor off; ConfigMaps carry the same bytes as the source files (spot-check `diff`)
- [x] Gate: Full gate exits 0
- [x] Test count: self-tests unchanged (config layer)

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the fiapx kustomization`

**Status**: ✅ Complete (2026-09-29). `k8s/kustomization.yaml` (`namespace: fiapx`, `resources: [namespace.yaml]`, the four `images:` mappings to `ghcr.io/tech-challenge-workshop/<name>:main`) and `k8s/namespace.yaml`. Seven generated ConfigMaps, each key the source file's name: `fiapx-rabbitmq-config` (`rabbitmq.conf`, `enabled_plugins`), `fiapx-identity-realm`, `fiapx-postgres-init`, `fiapx-storage-bootstrap`, and Grafana's provisioning split per subdirectory - `fiapx-grafana-datasources` (`prometheus.yml`), `fiapx-grafana-dashboard-provider` (`dashboards.yml`) - plus `fiapx-grafana-dashboards` (`overview.json`), since a ConfigMap holds no directories. Names keep kustomize's content hash suffix: manifests reference the base name and kustomize rewrites it, so a changed config rolls its pods. `prometheus/prometheus.k8s.yml` is left out until T21 creates it (T21 adds a `fiapx-prometheus-config` entry). Spot-check: all 8 rendered keys carry byte-identical content to their source files (compared through `parseYamlStream`). Found on the way: importing `check-kubernetes.mjs` ran its default check; fixed in its own commit `e4d8a79` (entry point guarded). Full gate 0: kube self-test, check-kubernetes self-test (35/9/7), default mode (8 objects), kubeconform `Valid: 8, Invalid: 0`.

---

### T8: kind cluster config template

**What**: `k8s/kind-config.template.yaml`: one control-plane node, image `kindest/node:v1.36.4@sha256:099e049362a1526b2db71494e1947aae99bd16290d7c895f2b7ea312e3cbfaed`, `extraPortMappings` hostPort → nodePort per the design table, with `${CATALOG_HOST_PORT}` and `${STORAGE_HOST_PORT}` placeholders. Not part of the kustomization.
**Where**: `k8s/kind-config.template.yaml`
**Depends on**: T7
**Reuses**: Compose host-port env names
**Requirement**: K8S-01, K8S-11, K8S-12

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Every host port of the design table is mapped once; nodePorts inside 30000-32767
- [x] Gate: Full gate exits 0 (rendering is asserted in T24's self-test)

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the kind cluster config template`

**Status**: ✅ Complete (2026-09-29). `k8s/kind-config.template.yaml`: `kind: Cluster` (`kind.x-k8s.io/v1alpha4`), `name: fiapx`, one control-plane node on `kindest/node:v1.36.4@sha256:099e0493…faed`, 10 `extraPortMappings` (TCP, all interfaces as Compose publishes): 3000→30000, `${CATALOG_HOST_PORT}`→30001, 3003→30003, 8080→30080, `${STORAGE_HOST_PORT}`→30900, 8025→30825, 15672→31672, 15692→31692, 9090→30090, 3005→30005. Each placeholder appears exactly once (comments carry none), so T24 can substitute with a plain `replaceAll`. Verified by parsing the template with the defaults substituted: every design-table host port mapped once, host and node ports unique, every nodePort inside 30000-32767. Not in the kustomization. Full gate 0 (kubeconform `Valid: 8`); Phase 2 Build gate 0 (ci-governance and its self-test, docs-links, check-observability, `docker compose config -q`).

---

### T9: Postgres manifest

**What**: `k8s/postgres.yaml`: Service `postgres` (ClusterIP 5432) + StatefulSet (image `postgres:17-alpine`, `POSTGRES_DB=fiapx`, `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD` from `fiapx-postgres`, init ConfigMap at `/docker-entrypoint-initdb.d`, PVC 1Gi, readiness `pg_isready -U postgres -d fiapx`, small requests).
**Where**: `k8s/postgres.yaml`
**Depends on**: T8
**Reuses**: `compose.yaml` postgres service, `db/init/01-schemas.sql`
**Requirement**: K8S-02, K8S-13

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Added to `resources`; Full gate exits 0 (kubeconform strict + offline rules)

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the postgres statefulset`

**Status**: ✅ Complete (2026-09-29). `k8s/postgres.yaml`, added to `resources`: Service `postgres` (ClusterIP, 5432 → named port `postgres`) and StatefulSet `postgres` (`serviceName: postgres`, 1 replica, label `app=postgres`), image `postgres:17-alpine`, `POSTGRES_DB=fiapx`, `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD` from `secretKeyRef` `fiapx-postgres/POSTGRES_PASSWORD`; ConfigMap `fiapx-postgres-init` (kustomize rewrites it to the hashed name) read-only at `/docker-entrypoint-initdb.d`; `volumeClaimTemplates` `data` 1Gi `ReadWriteOnce` (default class) at `/var/lib/postgresql/data`; readiness `exec pg_isready -U postgres -d fiapx` (5 s period, 3 s timeout, 10 failures, the Compose healthcheck); requests 100m / 128Mi, memory limit 512Mi. Beyond the task: `PGDATA=/var/lib/postgresql/data/pgdata`, so initdb works on a volume whose mount point is not empty. Full gate 0: check-kubernetes default mode 10 objects, kubeconform `Valid: 10, Invalid: 0`.

---

### T10: RabbitMQ manifest

**What**: `k8s/rabbitmq.yaml`: Deployment (image `rabbitmq:4-management-alpine`, conf + `enabled_plugins` from ConfigMaps via `subPath`, `definitions.json` from Secret `fiapx-rabbitmq`, readiness `rabbitmq-diagnostics -q ping`), Service `rabbitmq` (ClusterIP 5672, 15672, 15692) and Service `rabbitmq-host` (NodePort 31672→15672, 31692→15692).
**Where**: `k8s/rabbitmq.yaml`
**Depends on**: T9
**Reuses**: `rabbitmq/*`, compose rabbitmq service
**Requirement**: K8S-02, K8S-13

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Full gate exits 0

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the rabbitmq deployment`

**Status**: ✅ Complete (2026-09-29). `k8s/rabbitmq.yaml`, added to `resources`: Deployment `rabbitmq` (1 replica, `strategy: Recreate` so two brokers never overlap), image `rabbitmq:4-management-alpine`, named ports `amqp` 5672, `management` 15672, `prometheus` 15692; `subPath` mounts from ConfigMap `fiapx-rabbitmq-config`: `rabbitmq.conf` at `/etc/rabbitmq/conf.d/10-fiapx.conf` and `enabled_plugins` at `/etc/rabbitmq/enabled_plugins` (the Compose paths); `definitions.json` by `subPath` from Secret `fiapx-rabbitmq` key `definitions.json` at `/etc/rabbitmq/definitions.json`, the path `rabbitmq.conf`'s `load_definitions` names; `emptyDir` at `/var/lib/rabbitmq` (no persisted broker state, as in Compose); readiness `exec rabbitmq-diagnostics -q ping` (5 s period, 10 failures; timeout 10 s rather than Compose's 3 s, since each call starts an Erlang VM); requests 200m / 256Mi, memory limit 1Gi. Services: `rabbitmq` ClusterIP (5672, 15672, 15692) and `rabbitmq-host` NodePort (15672→31672, 15692→31692, matching `kind-config.template.yaml`). Compose's `user: "0:0"` is not carried over: the image already starts as root and its entrypoint drops to the `rabbitmq` user after fixing `/var/lib/rabbitmq` ownership. No credential in env: the broker's only user comes from the definitions Secret. Full gate 0: default mode 13 objects, kubeconform `Valid: 13, Invalid: 0`.

---

### T11: Storage manifest

**What**: `k8s/storage.yaml`: StatefulSet (image `rustfs/rustfs:1.0.0`, `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY` from `fiapx-storage`, PVC 2Gi, readiness `GET /health` 9000), Service `storage` (ClusterIP 9000) and NodePort Service (30900→9000).
**Where**: `k8s/storage.yaml`
**Depends on**: T10
**Reuses**: compose storage service
**Requirement**: K8S-02, K8S-12, K8S-13

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Full gate exits 0

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the storage statefulset`

**Status**: ✅ Complete (2026-09-29). `k8s/storage.yaml`, added to `resources`: StatefulSet `storage` (`serviceName: storage`, 1 replica, label `app=storage`), image `rustfs/rustfs:1.0.0` with its default entrypoint (`RUSTFS_VOLUMES=/data`, as Compose runs it), `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY` from `secretKeyRef` `fiapx-storage` keys `ACCESS_KEY`/`SECRET_KEY`; named port `s3` 9000; readiness `GET /health` on `s3` (5 s period, 3 s timeout, 10 failures, the Compose healthcheck); `volumeClaimTemplates` `data` 2Gi `ReadWriteOnce` at `/data`; requests 100m / 128Mi, memory limit 1Gi. Services: `storage` ClusterIP 9000 and `storage-host` NodePort 9000→30900 (the `${STORAGE_HOST_PORT}` mapping of `kind-config.template.yaml`). Beyond the task: pod `securityContext.fsGroup: 10001`, since the image runs as `rustfs` (uid 10001, checked with `docker run … id`); kind's local-path claims are created world-writable, so this only matters on a provisioner that honours `fsGroup`. Full gate 0: default mode 16 objects, kubeconform `Valid: 16, Invalid: 0`.

---

### T12: Storage bootstrap Job

**What**: `k8s/storage-init-job.yaml`: Job `storage-init` (image `amazon/aws-cli:2.37.4`, runs the `bootstrap.sh` ConfigMap, `AWS_*` from `fiapx-storage`, `AWS_ENDPOINT_URL=http://storage:9000`, `STORAGE_BUCKET=fiapx`, `backoffLimit: 6` so it retries until storage is up).
**Where**: `k8s/storage-init-job.yaml`
**Depends on**: T11
**Reuses**: `storage/bootstrap.sh`
**Requirement**: K8S-02

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Full gate exits 0

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the storage bootstrap job`

**Status**: ✅ Complete (2026-09-29). `k8s/storage-init-job.yaml`, added to `resources`: Job `storage-init` (`backoffLimit: 6`, `restartPolicy: Never`, label `app=storage-init`), image `amazon/aws-cli:2.37.4`, command `/bin/bash /bootstrap/bootstrap.sh` (the Compose entrypoint, with ConfigMap `fiapx-storage-bootstrap` mounted read-only at `/bootstrap`); `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` from `secretKeyRef` `fiapx-storage` `ACCESS_KEY`/`SECRET_KEY`; `AWS_DEFAULT_REGION=us-east-1`, `AWS_ENDPOINT_URL=http://storage:9000`, `STORAGE_BUCKET=fiapx`; requests 50m / 128Mi, memory limit 256Mi. It does not wait for storage: an attempt against a storage that is not serving fails and the Job retries with back-off. Note for T25: a Job's pod template is immutable, and the ConfigMap's hash suffix is part of it, so a changed `bootstrap.sh` makes a re-apply against an existing cluster fail on this Job; the up command must delete a finished `storage-init` whose template differs (or always delete it before applying). Full gate 0: default mode 17 objects, kubeconform `Valid: 17, Invalid: 0`.

---

### T13: Identity manifest

**What**: `k8s/identity.yaml`: Deployment (image `quay.io/keycloak/keycloak:26.7.4`, `start-dev --import-realm`, admin from `fiapx-identity-admin`, `KC_HEALTH_ENABLED=true`, `KC_HOSTNAME=http://localhost:8080`, realm ConfigMap at `/opt/keycloak/data/import/`, `emptyDir.medium: Memory` at `/opt/keycloak/data/h2`, readiness `GET /health/ready` on 9000), Service `identity` (ClusterIP 8080) + NodePort (30080→8080).
**Where**: `k8s/identity.yaml`
**Depends on**: T12
**Reuses**: compose identity service, `identity/fiapx-realm.json`
**Requirement**: K8S-02, K8S-11, K8S-13

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Full gate exits 0

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the identity deployment`

**Status**: ✅ Complete (2026-09-29). `k8s/identity.yaml`, added to `resources`: Deployment `identity` (1 replica, label `app=identity`), image `quay.io/keycloak/keycloak:26.7.4`, args `start-dev --import-realm`; `KC_BOOTSTRAP_ADMIN_USERNAME`/`KC_BOOTSTRAP_ADMIN_PASSWORD` from `secretKeyRef` `fiapx-identity-admin` (same key names); `KC_HEALTH_ENABLED=true`, `KC_HOSTNAME=http://localhost:8080`; named ports `http` 8080 and `management` 9000; readiness `GET /health/ready` on `management` (the image has no curl; an `httpGet` probe needs none), 10 s initial delay as Compose's `start_period`, 5 s period, 24 failures; H2 on `emptyDir.medium: Memory` at `/opt/keycloak/data/h2`; requests 250m / 512Mi, memory limit 1Gi. Services: `identity` ClusterIP 8080 and `identity-host` NodePort 8080→30080; 9000 is not exposed. SPEC_DEVIATION (marked in the manifest): the realm ConfigMap `fiapx-identity-realm` is mounted by `subPath` as `/opt/keycloak/data/import/fiapx-realm.json` rather than as the whole import directory, because a ConfigMap directory mount also carries the kubelet's `..data` links and the import reads the directory; the single file is what Compose mounts. Full gate 0: default mode 20 objects, kubeconform `Valid: 20, Invalid: 0`.

---

### T14: Mailpit manifest

**What**: `k8s/mailpit.yaml`: Deployment (image `axllent/mailpit:v1.31.2`, readiness `/mailpit readyz`), Service `mailpit` (ClusterIP 1025, 8025) + NodePort (30825→8025).
**Where**: `k8s/mailpit.yaml`
**Depends on**: T13
**Reuses**: compose mailpit service
**Requirement**: K8S-02

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Full gate exits 0; Build gate exits 0 (phase end)

**Tests**: none
**Gate**: Build

**Commit**: `feat(platform): add the mailpit deployment`

**Status**: ✅ Complete (2026-09-29). `k8s/mailpit.yaml`, added to `resources`: Deployment `mailpit` (1 replica, label `app=mailpit`), image `axllent/mailpit:v1.31.2`, named ports `smtp` 1025 and `http` 8025; readiness `exec /mailpit readyz` (absolute path, as Compose; 5 s period, 3 s timeout, 10 failures); requests 50m / 32Mi, memory limit 128Mi. Services: `mailpit` ClusterIP (1025, 8025) and `mailpit-host` NodePort 8025→30825; SMTP stays internal, as in Compose. Full gate 0: default mode 23 objects, kubeconform `Valid: 23, Invalid: 0`. Phase 3 Build gate 0: ci-governance and its self-test, docs-links, check-observability, `docker compose config -q`.

---

### T15: Catalog manifest

**What**: `k8s/catalog.yaml`: Deployment `catalog` (image `processing-catalog`, env as Compose with `DATABASE_PASSWORD` from `fiapx-postgres/CATALOG_DB_PASSWORD` and `RABBITMQ_URL` from `fiapx-rabbitmq/URL`, readiness `/health`, liveness `/health/live` on 3001, `imagePullPolicy: Always`), Service `catalog` (ClusterIP 3001) + NodePort (30001→3001).
**Where**: `k8s/catalog.yaml`
**Depends on**: T14
**Reuses**: compose catalog service; S8 health contract
**Requirement**: K8S-02, K8S-09, K8S-13, K8S-31

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Full gate exits 0 (probe, secret and image rules now apply to a real object)

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the catalog deployment`

**Status**: ✅ Complete (2026-09-29). `k8s/catalog.yaml`, added to `resources`: Deployment `catalog` (1 replica, label `app=catalog`), image `processing-catalog` (rendered `ghcr.io/tech-challenge-workshop/processing-catalog:main`), `imagePullPolicy: Always`; env as Compose (`PORT=3001`, `LOCAL_INTEGRATION=true`, `DATABASE_HOST=postgres`, `DATABASE_PORT=5432`, `DATABASE_NAME=fiapx`, `DATABASE_SCHEMA=catalog`, `DATABASE_USER=catalog`), with `DATABASE_PASSWORD` from `secretKeyRef` `fiapx-postgres/CATALOG_DB_PASSWORD` and `RABBITMQ_URL` from `fiapx-rabbitmq/URL`; named port `http` 3001; readiness `GET /health` (5 s period, 3 s timeout, 3 failures), liveness `GET /health/live` (10 s delay, 10 s period, 6 failures); requests 100m / 128Mi, memory limit 512Mi. Services: `catalog` ClusterIP 3001 and `catalog-host` NodePort 3001→30001 (the `${CATALOG_HOST_PORT}` mapping). No init container: the service retries the database and broker, and readiness gates it. Full gate 0: probe, credential and image rules now apply to a real object; default mode 26 objects, kubeconform `Valid: 26, Invalid: 0`.

---

### T16: Notification manifest

**What**: `k8s/notification.yaml`: Deployment `notification` (env as Compose; DB password and broker URL from Secrets; `SMTP_HOST=mailpit`; probes on 3003), Service `notification` (ClusterIP 3003) + NodePort (30003→3003).
**Where**: `k8s/notification.yaml`
**Depends on**: T15
**Reuses**: compose notification service
**Requirement**: K8S-02, K8S-09, K8S-13, K8S-31

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Full gate exits 0

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the notification deployment`

**Status**: ✅ Complete (2026-09-29). `k8s/notification.yaml`, added to `resources`: Deployment `notification` (1 replica, label `app=notification`), image `notification-service` (rendered `ghcr.io/tech-challenge-workshop/notification-service:main`), `imagePullPolicy: Always`; env as Compose (`PORT=3003`, `LOCAL_INTEGRATION=true`, `DATABASE_*` with schema and user `notification`, `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_FROM=fiapx@local`), with `DATABASE_PASSWORD` from `secretKeyRef` `fiapx-postgres/NOTIFICATION_DB_PASSWORD` and `RABBITMQ_URL` from `fiapx-rabbitmq/URL`; named port `http` 3003; probes as T15 (readiness `GET /health`, liveness `GET /health/live`); requests 100m / 128Mi, memory limit 512Mi. Services: `notification` ClusterIP 3003 and `notification-host` NodePort 3003→30003. Full gate 0: default mode 29 objects, kubeconform `Valid: 29, Invalid: 0`.

---

### T17: API manifest

**What**: `k8s/api.yaml`: Deployment `api` (env as Compose: `OIDC_ISSUER=http://localhost:8080/realms/fiapx`, `OIDC_JWKS_URL=http://identity:8080/…/certs`, `CATALOG_BASE_URL=http://catalog:3001`, `STORAGE_ENDPOINT=http://storage:9000`, `STORAGE_PUBLIC_ENDPOINT` from ConfigMap `fiapx-host`, storage keys from `fiapx-storage`; initContainer `wait-for-bucket` (aws-cli `head-bucket` loop); probes on 3000), Service `api` (ClusterIP 3000) + NodePort (30000→3000).
**Where**: `k8s/api.yaml`
**Depends on**: T16
**Reuses**: compose api service
**Requirement**: K8S-02, K8S-09, K8S-11, K8S-12, K8S-13, K8S-31

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Full gate exits 0

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the api deployment`

**Status**: ✅ Complete (2026-09-29). `k8s/api.yaml`, added to `resources`: Deployment `api` (1 replica, label `app=api`), image `fiap-x-api` (rendered `ghcr.io/tech-challenge-workshop/fiap-x-api:main`), `imagePullPolicy: Always`; env as Compose (`PORT=3000`, `CATALOG_BASE_URL=http://catalog:3001`, `OIDC_ISSUER=http://localhost:8080/realms/fiapx`, `OIDC_AUDIENCE=fiapx-api`, `OIDC_JWKS_URL=http://identity:8080/realms/fiapx/protocol/openid-connect/certs`, `STORAGE_ENDPOINT=http://storage:9000`, `STORAGE_BUCKET=fiapx`), with `STORAGE_PUBLIC_ENDPOINT` from `configMapKeyRef` `fiapx-host/STORAGE_PUBLIC_ENDPOINT` (written by the up command, not in the kustomization) and `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` from `secretKeyRef` `fiapx-storage` `ACCESS_KEY`/`SECRET_KEY`; init container `wait-for-bucket` (`amazon/aws-cli:2.37.4`, `/bin/bash -c` loop on `aws s3api head-bucket --bucket fiapx` every 2 s, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` from `fiapx-storage`, `AWS_DEFAULT_REGION=us-east-1`, `AWS_ENDPOINT_URL=http://storage:9000`; requests 50m / 128Mi, memory limit 256Mi); named port `http` 3000; probes as T15; requests 100m / 128Mi, memory limit 512Mi. Services: `api` ClusterIP 3000 and `api-host` NodePort 3000→30000. The API speaks no AMQP, so it has no broker URL (as in Compose). Full gate 0: default mode 32 objects, kubeconform `Valid: 32, Invalid: 0`.

---

### T18: Worker manifest

**What**: `k8s/worker.yaml`: Deployment `worker` **without `spec.replicas`**, label `app=worker`, container port 3002, `FFMPEG_THREADS=1`, `resources: requests/limits cpu "1"`, memory 512Mi/1Gi, broker URL and storage keys from Secrets, initContainer `wait-for-bucket`, probes on 3002, `terminationGracePeriodSeconds: 30`, `imagePullPolicy: Always`. No Service beyond a headless one if needed (Prometheus discovers pods).
**Where**: `k8s/worker.yaml`
**Depends on**: T17
**Reuses**: compose worker service; AD-006 sizing
**Requirement**: K8S-02, K8S-09, K8S-13, K8S-23, K8S-31

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Full gate exits 0 (sizing and no-replicas rules apply)

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the worker deployment`

**Status**: ✅ Complete (2026-09-29). `k8s/worker.yaml`, added to `resources`: Deployment `worker` with no `spec.replicas` (the KEDA HPA owns the count; the Deployment starts at 1), label `app=worker` on the Deployment and the pod template, image `processing-worker` (rendered `ghcr.io/tech-challenge-workshop/processing-worker:main`), `imagePullPolicy: Always`, `terminationGracePeriodSeconds: 30`; env `PORT=3002`, `FFMPEG_THREADS="1"`, `STORAGE_ENDPOINT=http://storage:9000`, `STORAGE_BUCKET=fiapx`, `RABBITMQ_URL` from `fiapx-rabbitmq/URL`, `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` from `fiapx-storage`; resources `cpu: "1"` request and limit, memory 512Mi / 1Gi (AD-006); named port `http` 3002; probes as T15; init container `wait-for-bucket` as T17. No Service: nothing calls the Worker, and Prometheus discovers its pods by label (T21). Full gate 0: default mode 33 objects, kubeconform `Valid: 33, Invalid: 0`. The sizing and no-replicas rules now bind a real object: the rendered manifest with `FFMPEG_THREADS` "2" and with `replicas: 1` each made the default mode exit 1 with its message (scratch renders through `K8S_RENDER`).

---

### T19: Worker autoscaling

**What**: `k8s/worker-scaling.yaml`: `TriggerAuthentication` `rabbitmq-management` (`secretTargetRef` `host` ← `fiapx-keda-rabbitmq/host`) and `ScaledObject` `worker` (min 1, max 5, `pollingInterval: 5`, HPA `scaleDown.stabilizationWindowSeconds: 60`, two `rabbitmq` triggers `protocol: http`, `mode: QueueLength`: `processing` `"2"`, `video-validation` `"20"`).
**Where**: `k8s/worker-scaling.yaml`
**Depends on**: T18
**Reuses**: KEDA 2.21 rabbitmq scaler docs (design research)
**Requirement**: K8S-18, K8S-21, K8S-24

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Full gate exits 0 (kubeconform validates the KEDA CRDs from the CRDs catalog; ScaledObject rule applies)

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): autoscale the worker on queue depth with keda`

**Status**: ✅ Complete (2026-09-29). `k8s/worker-scaling.yaml`, added to `resources`: `TriggerAuthentication` `rabbitmq-management` (`keda.sh/v1alpha1`, `secretTargetRef` parameter `host` ← Secret `fiapx-keda-rabbitmq` key `host`) and `ScaledObject` `worker` (`scaleTargetRef.name: worker`, `minReplicaCount: 1`, `maxReplicaCount: 5`, `pollingInterval: 5`, `advanced.horizontalPodAutoscalerConfig.behavior.scaleDown.stabilizationWindowSeconds: 60`), two `rabbitmq` triggers with `protocol: http`, `mode: QueueLength`: `processing` value `"2"` and `video-validation` value `"20"`, each `authenticationRef.name: rabbitmq-management` and no `host` in metadata. Full gate 0: default mode 35 objects, kubeconform `Valid: 35, Invalid: 0` with both KEDA objects validated against the CRDs-catalog schemas (`-verbose`: "ScaledObject worker is valid", "TriggerAuthentication rabbitmq-management is valid"). The rules bind the real objects: the rendered manifest with `processing` value "3" made the default mode exit 1 with its message, and a misspelt `spec.pollingIntervall` was rejected by kubeconform strict (`additional properties 'pollingIntervall' not allowed`).

---

### T20: Required-workload rule

**What**: `check-kubernetes.mjs` gains a completeness rule: the render must contain the 11 workloads (Deployments `api`, `catalog`, `notification`, `worker`, `rabbitmq`, `identity`, `mailpit`, `prometheus`, `grafana`; StatefulSets `postgres`, `storage`), Job `storage-init`, `ScaledObject` `worker` and `TriggerAuthentication` `rabbitmq-management`; `prometheus`/`grafana` listed as pending until T22/T23 by a single constant updated there. Self-test plants a missing workload.
**Where**: `scripts/check-kubernetes.mjs`
**Depends on**: T19
**Reuses**: T6 rules
**Requirement**: K8S-02, K8S-33

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Deleting any service manifest from `resources` fails the default mode (self-test case)
- [x] Build gate exits 0 (phase end)
- [x] Test count: T6 count + ≥ 2

**Tests**: self-test
**Gate**: Build

**Commit**: `feat(platform): require every workload in the kubernetes render`

**Status**: ✅ Complete (2026-09-29). `scripts/check-kubernetes.mjs` gains the workloads rule: `REQUIRED` lists the 14 objects as `Kind/name` (Deployments `api`, `catalog`, `notification`, `worker`, `rabbitmq`, `identity`, `mailpit`, `prometheus`, `grafana`; StatefulSets `postgres`, `storage`; `Job/storage-init`; `ScaledObject/worker`; `TriggerAuthentication/rabbitmq-management`) and the single constant `PENDING` (`Deployment/prometheus`, `Deployment/grafana`) excludes the manifests not landed yet: T22 and T23 each remove their entry. `missingWorkloads()` names every required object the render lacks (kind and name both match: a Deployment `postgres` does not stand in for the StatefulSet). Default mode always applies it, so an empty or partial render now fails; the per-object self-test cases keep their partial renders and leave it off. Self-test: 50 corruptions rejected (T6: 35; planned T6 + ≥ 2) and 12 good inputs accepted (T6: 9): the complete render passes; each of the 12 required non-pending objects dropped alone fails with exactly its message; two dropped together fail with both; postgres as a Deployment and a ScaledObject named `workers` each fail as missing; each pending workload absent is accepted; the spawned script on a render without the catalog Deployment exits non-zero with that message alone (the spawned replicas and good cases now use the complete render, assertions unchanged). On the real tree, dropping `catalog.yaml`, `worker-scaling.yaml` or `storage-init-job.yaml` from `resources` made default mode exit 1 naming the lost objects (restored). Four mutants on scratch copies (pending ignored, kind ignored, default mode without the rule, `storage-init` not required) were each killed. Build gate 0: default mode 35 objects with every required workload, kubeconform `Valid: 35, Invalid: 0`; ci-governance and its self-test, docs-links, check-observability, `docker compose config -q`.

---

### T21: Prometheus config for the cluster

**What**: `prometheus/prometheus.k8s.yml`: same jobs, interval and timeout as `prometheus.yml`; `worker` job via `kubernetes_sd_configs` role `pod` in namespace `fiapx`, relabel keep `app=worker` and container port 3002, `instance` = pod name; `rabbitmq` target `rabbitmq:15692`.
**Where**: `prometheus/prometheus.k8s.yml`
**Depends on**: T20
**Reuses**: `prometheus/prometheus.yml`
**Requirement**: K8S-25, K8S-26

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] `promtool check config` (via `prom/prometheus:v3.15.0` container) reports valid
- [x] `node scripts/check-observability.mjs` still exits 0 (Compose config untouched)
- [x] Full gate exits 0

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the prometheus config for the cluster`

**Status**: ✅ Complete (2026-09-29). `prometheus/prometheus.k8s.yml`: the global block (`scrape_interval: 15s`, `scrape_timeout: 10s`) and the five jobs in the same order as `prometheus/prometheus.yml` (checked equal with PyYAML); `api:3000`, `catalog:3001`, `notification:3003` and `rabbitmq:15692` are static targets on the Services of namespace `fiapx`. The `worker` job uses `kubernetes_sd_configs` role `pod` restricted to namespace `fiapx`, with relabel `keep` on `__meta_kubernetes_pod_label_app=worker` and `__meta_kubernetes_pod_container_port_number=3002`, and `instance` ← `__meta_kubernetes_pod_name`. Beyond the task: a third `keep` on `__meta_kubernetes_pod_phase=Running`, so a replica still in its `wait-for-bucket` init container is not listed as a down target (T28 counts worker targets against worker pods). `k8s/kustomization.yaml` gains the `fiapx-prometheus-config` generator entry (key `prometheus.k8s.yml`, rendered bytes identical to the file). `promtool check config` in `prom/prometheus:v3.15.0`: SUCCESS. `node scripts/check-observability.mjs` 0 (Compose config untouched). Full gate 0: default mode 36 objects, kubeconform `Valid: 36, Invalid: 0`.

---

### T22: Prometheus manifest

**What**: `k8s/prometheus.yaml`: ServiceAccount + Role (`get/list/watch pods` in `fiapx`) + RoleBinding, Deployment (image `prom/prometheus:v3.15.0`, config from the T21 ConfigMap), Service `prometheus` (ClusterIP 9090) + NodePort (30090→9090); required-workload constant updated.
**Where**: `k8s/prometheus.yaml`
**Depends on**: T21
**Reuses**: compose prometheus service
**Requirement**: K8S-25, K8S-26

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Full gate exits 0

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the prometheus deployment`

**Status**: ✅ Complete (2026-09-29). `k8s/prometheus.yaml`, added to `resources`: ServiceAccount `prometheus`; Role `prometheus-pod-discovery` (`get`, `list`, `watch` on `pods`, core group, namespaced to `fiapx`) and RoleBinding of the same name to the ServiceAccount; Deployment `prometheus` (1 replica, label `app=prometheus`, `serviceAccountName: prometheus`), image `prom/prometheus:v3.15.0` with its default command, ConfigMap `fiapx-prometheus-config` key `prometheus.k8s.yml` mounted by `subPath` read-only at `/etc/prometheus/prometheus.yml` (the Compose path; the hash suffix rolls the pod on a config change); named port `http` 9090; readiness `GET /-/ready` (5 s period, 3 s timeout, 10 failures); requests 100m / 256Mi, memory limit 1Gi; no volume, as in Compose. Services: `prometheus` ClusterIP 9090 (the name Grafana's datasource `http://prometheus:9090` resolves) and `prometheus-host` NodePort 9090→30090. `PENDING` in `check-kubernetes.mjs` now holds only `Deployment/grafana`, so the self-test's prometheus case moved from "pending, accepted when absent" to "required, rejected when absent": 51 corruptions rejected, 11 good inputs accepted (62 cases, as before). Full gate 0: default mode 42 objects, kubeconform `Valid: 42, Invalid: 0`.

---

### T23: Grafana manifest

**What**: `k8s/grafana.yaml`: Deployment (image `grafana/grafana:13.2.2`, admin from `fiapx-grafana-admin`, provisioning + dashboard ConfigMaps at the Compose paths, readiness `GET /api/health`), Service `grafana` (ClusterIP 3000) + NodePort (30005→3000); required-workload constant complete.
**Where**: `k8s/grafana.yaml`
**Depends on**: T22
**Reuses**: `grafana/**`
**Requirement**: K8S-27

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Build gate exits 0 (phase end)

**Tests**: none
**Gate**: Build

**Commit**: `feat(platform): add the grafana deployment`

**Status**: ✅ Complete (2026-09-29). `k8s/grafana.yaml`, added to `resources`: Deployment `grafana` (1 replica, label `app=grafana`), image `grafana/grafana:13.2.2`; `GF_SECURITY_ADMIN_USER`/`GF_SECURITY_ADMIN_PASSWORD` from `secretKeyRef` `fiapx-grafana-admin` (same key names); named port `http` 3000 (Grafana's default; Compose's `GF_SERVER_HTTP_PORT=3005` is not carried over, the host still sees 3005 through the kind mapping); readiness `GET /api/health` (5 s period, 3 s timeout, 10 failures); requests 100m / 128Mi, memory limit 512Mi; no volume for Grafana's own state, as in Compose. The three generated ConfigMaps are mounted by `subPath` read-only at the Compose paths: `fiapx-grafana-datasources` → `/etc/grafana/provisioning/datasources/prometheus.yml`, `fiapx-grafana-dashboard-provider` → `/etc/grafana/provisioning/dashboards/dashboards.yml`, `fiapx-grafana-dashboards` → `/var/lib/grafana/dashboards/overview.json` (a directory mount would carry the kubelet's `..data` links into the dashboard provider's walk, the reason T13 mounts the realm by `subPath`). The datasource URL `http://prometheus:9090` resolves to T22's Service in the same namespace. Services: `grafana` ClusterIP 3000 and `grafana-host` NodePort 3000→30005. `PENDING` is now empty: every required workload is rendered, and the self-test's grafana case moved from accepted to rejected (52 corruptions rejected, 10 good inputs accepted, 62 cases as before). Full gate 0: default mode 45 objects with every required workload, kubeconform `Valid: 45, Invalid: 0`. Phase 5 Build gate 0: ci-governance and its self-test, docs-links, check-observability, `docker compose config -q`.

---

### T24: Up command - preflight, cluster, secrets

**What**: `scripts/k8s-up.mjs` part 1: tool preflight (`docker`, `kind`, `kubectl`, Docker daemon); host-port preflight (TCP bind probe) unless the `fiapx` cluster exists with the same map (`fiapx-host` ConfigMap); kind config rendering from the T8 template; `kind create cluster --name fiapx --config <tmp> --wait 120s` or reuse; exists-but-unhealthy → exit with the down hint; namespace + `fiapx-host` ConfigMap; Secrets create-if-absent with alphanumeric random values and the `definitions.json` rewrite; optional `ghcr-pull` from `GHCR_TOKEN`. All kubectl through `kube.mjs`. `--self-test` covers rendering, secret shapes (alphanumeric, lengths, fixtures), definitions rewrite, preflight messages, reuse decision.
**Where**: `scripts/k8s-up.mjs`
**Depends on**: T23
**Reuses**: `scripts/kube.mjs`, `rabbitmq/definitions.json`
**Requirement**: K8S-01, K8S-05, K8S-06, K8S-07, K8S-15

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Self-test covers each preflight failure (missing tool, busy port, different port map, unhealthy cluster) with its message
- [x] Gate: `node scripts/k8s-up.mjs --self-test` + Full gate exit 0 (the static raw-kubectl rule passes)
- [x] Test count: ≥ 12 self-test assertions

**Tests**: self-test
**Gate**: Full

**Commit**: `feat(platform): add the kubernetes up command preflight and secrets`

**Status**: ✅ Complete (2026-09-29). `scripts/k8s-up.mjs` part 1, every effect injected (`realDeps`: kubectl and kind through `scripts/kube.mjs`, `docker`, a TCP bind probe, a random generator): `hostPorts` validates `CATALOG_HOST_PORT`/`STORAGE_HOST_PORT` (defaults 3001/9000); `renderKindConfig` fills the template with `replaceAll` and refuses a placeholder left over; `preflightTools` runs `kind version`, `kubectl version --client` and `docker info` and names every missing tool or an unreachable daemon in one message before anything is created; `clusterState` reads `kind get clusters`, node readiness and ConfigMap `fiapx-host`; `clusterDecision` reuses a healthy `fiapx` with the same host-port map and otherwise stops with `run node scripts/k8s-down.mjs first` (unhealthy node, API server not answering, no recorded map, a different map); only a new cluster probes its ten host ports (bind on `0.0.0.0` and `127.0.0.1`), naming every busy one and the override variable that moves it, then runs `kind create cluster --config <tmp> --wait 120s`. Then namespace `fiapx` (from `k8s/namespace.yaml`), ConfigMap `fiapx-host` (`CATALOG_HOST_PORT`, `STORAGE_HOST_PORT`, `STORAGE_PUBLIC_ENDPOINT=http://localhost:<storage port>`), and the six Secrets created only if absent with `kubectl create -f -` (never `apply`, which would keep the values in the last-applied annotation): `fiapx-postgres` (`POSTGRES_PASSWORD` random 32, `CATALOG_DB_PASSWORD=catalog`, `NOTIFICATION_DB_PASSWORD=notification`), `fiapx-storage` (`ACCESS_KEY` 20, `SECRET_KEY` 40), `fiapx-rabbitmq` (`USERNAME` `fiapx`+8, `PASSWORD` 32, `URL`, `definitions.json` = the repository file with `users`/`permissions` replaced by the generated user), `fiapx-keda-rabbitmq` (`host=http://u:p@rabbitmq.fiapx.svc:15672/`), `fiapx-identity-admin` (`admin` + 24), `fiapx-grafana-admin` (`admin` + 24), all generated values alphanumeric. A run stopped between the two RabbitMQ Secrets reuses the present one's user. With `GHCR_TOKEN` (and optional `GHCR_USERNAME`), Secret `ghcr-pull` (`kubernetes.io/dockerconfigjson`) and the namespace's `default` ServiceAccount pulling with it. Self-test: 66 assertions (planned ≥ 12): rendering with defaults and overrides (only the two placeholders change, the cluster name is `fiapx`), invalid port values, an unfilled placeholder; five preflight failures (kind, kubectl, docker missing, daemon down, two missing together), each creating and applying nothing; a busy port and two busy ports (no cluster created, all ten probed); four reuse refusals (node not Ready, API down, no recorded map, a different map), each touching nothing; a fresh run (create arguments, the config file equals the render, namespace, `fiapx-host`, every Secret's keys, fixtures, lengths, alphabet, URL, KEDA host, definitions rewrite with nothing else changed, a second cluster gets other values); an idempotent re-run (reuse, no port probe, no Secret created or changed); both partial RabbitMQ cases; `ghcr-pull`. The real bind probe detected a listener on a test port and passed a free one. Three mutants on scratch copies (create-if-absent skip removed, reuse never chosen, host-map comparison dropped) were each killed. Found on the way, fixed in its own commit `3ee9f9c`: `kind create cluster` always sets `current-context` in the kubeconfig it writes (kind v0.33 `merge.go`), so the design's plain create would have switched this machine away from its EKS context; `scripts/kube.mjs` now pins every kind create/delete to `--name fiapx --kubeconfig ~/.kube/kind-fiapx.config` and runs kubectl with `KUBECONFIG` set to that file alone (SPEC_DEVIATION marked there). Manual `kubectl --context kind-fiapx …` commands therefore need `KUBECONFIG=~/.kube/kind-fiapx.config` (T32 documents it). Full gate 0, including the static raw-kubectl scan over the new script.

---

### T25: Up command - KEDA, apply, wait

**What**: `scripts/k8s-up.mjs` part 2: download KEDA `v2.21.0` release YAML, verify the pinned sha256, `apply --server-side`, wait for `keda-operator` and `keda-operator-metrics-apiserver`; apply the rendered kustomization; wait (600 s budget) for every Deployment/StatefulSet rollout and `job/storage-init` complete; on timeout print each not-Ready workload with its pod waiting reason and exit 1; on success print endpoints and how to read the Grafana admin secret.
**Where**: `scripts/k8s-up.mjs`
**Depends on**: T24
**Reuses**: T24 helpers
**Requirement**: K8S-01, K8S-02, K8S-03, K8S-19

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Self-test: checksum mismatch exits 1 naming both hashes; a fake `get pods` with `ImagePullBackOff`/`CrashLoopBackOff` produces the named report; timeout path exits 1
- [x] Gate: Quick + Full exit 0
- [x] Test count: T24 count + ≥ 5

**Tests**: self-test
**Gate**: Full

**Commit**: `feat(platform): install keda and wait for the topology in the up command`

**Status**: ✅ Complete (2026-09-29). `scripts/k8s-up.mjs` part 2; `up()` runs provision → `installKeda` → `applyTopology` → `waitForTopology` → endpoints. KEDA: `KEDA.url` = the v2.21.0 release manifest, `KEDA.sha256` = `b43c89ffeef81722d7e2dd2c079d74789767a0f89cae1336cff784994814f6d7` (the real file, downloaded once with curl, 782 690 bytes); a download failure or checksum mismatch stops before anything is applied, the mismatch naming the expected and actual hashes; `apply --server-side --force-conflicts -f -` with the downloaded bytes; `wait --for=condition=Available --timeout=180s -n keda` on `keda-operator`, `keda-metrics-apiserver` and `keda-admission` (the release names the metrics server `keda-metrics-apiserver`, not the design's `keda-operator-metrics-apiserver`; the admission webhook is waited for too, since it validates the ScaledObject the apply sends). Apply: a **finished** Job `storage-init` (Complete or Failed) is always deleted first (`delete job --wait=true`), because its pod template is immutable and carries the bootstrap ConfigMap's hash suffix, and the bootstrap is idempotent; a running one is left alone; then the `kubectl kustomize --load-restrictor LoadRestrictionsNone k8s` output goes to `apply -f -`. Wait: every 5 s, `get deployments,statefulsets,jobs` and `get hpa` in `fiapx`; ready means each Deployment/StatefulSet has `observedGeneration` ≥ `generation` and all desired replicas updated and Ready, Job `storage-init` Complete, and HPA `keda-hpa-worker` present (K8S-19). After 600 s, or at once when `storage-init` has Failed, it reads the pods and exits 1 listing each pending workload with its pods' reasons: waiting reason per container (image named for pull errors, message for `CreateContainerConfigError`), non-`Completed` terminations with exit code, a running container not ready, a `wait-` init container still waiting, or `Pending (Unschedulable)`. On success it prints the host endpoints (with the moved catalog/storage ports), the commands that read the generated Grafana, Keycloak and RabbitMQ credentials, and the `get hpa -w` watch command, all as `KUBECONFIG=~/.kube/kind-fiapx.config kubectl --context kind-fiapx …`. Self-test: 99 assertions (T24: 66; planned T24 + ≥ 5): the pin; checksum mismatch naming both hashes with nothing applied; download failure; the server-side apply of the exact bytes and the KEDA wait; apply with no, completed, failed and running bootstrap Job (delete only for finished ones); ready at once and after three polls (10 s slept); a 600 s timeout (121 polls) naming `ImagePullBackOff` with the image, `CrashLoopBackOff` and `CreateContainerConfigError` with its message; a running-but-not-ready pod and a missing HPA; a failed bootstrap Job stopping at once and naming the API still waiting for the bucket; generation lag, partial update, a scaled-out Worker, no Job, unschedulable; the whole command's step order and printed hints. Six mutants on scratch copies (checksum check off, finished Job never deleted, a failed Job ignored until timeout, waiting reasons dropped, updated-replica check dropped, HPA not required) were each killed. Full gate 0.

---

### T26: Down command

**What**: `scripts/k8s-down.mjs`: `kind delete cluster --name fiapx`; exit 0 when absent; never touches kube contexts. `--self-test` asserts the exact command and the absent-cluster path.
**Where**: `scripts/k8s-down.mjs`
**Depends on**: T25
**Reuses**: `scripts/kube.mjs` constants
**Requirement**: K8S-08

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Gate: `node scripts/k8s-down.mjs --self-test` exits 0
- [x] Test count: ≥ 3

**Tests**: self-test
**Gate**: Quick

**Commit**: `feat(platform): add the kubernetes down command`

**Status**: ✅ Complete (2026-09-29). `scripts/k8s-down.mjs`: `down(spawner)` runs `kind get clusters` and, only when a line is exactly `fiapx`, `kind delete cluster --name fiapx --kubeconfig ~/.kube/kind-fiapx.config` (the argument list comes from `kind()` in `scripts/kube.mjs`, which refuses any other `--name`/`--kubeconfig`); exit 0 with "does not exist; nothing to delete" when absent, exit 1 naming kind when it is not on PATH, exit 1 with kind's message when the delete fails. No kubectl call and no kubeconfig access of its own: kind removes the cluster's entries from its private kubeconfig only. Self-test: 9 assertions (planned ≥ 3) against a fake kind spawner, driven through the real `kind()` helper: the exact two commands for an existing cluster; a cluster named `fiapx-old` and an empty list, each deleting nothing and exiting 0; kind missing; a failed delete. Two mutants on scratch copies (substring match on the cluster name, delete failure ignored) were each killed. Run for real on this machine (kind not installed): exit 1 with the kind-missing message, nothing touched. Quick gate `node scripts/k8s-down.mjs --self-test` 0; Full gate 0 (the static scan covers the new script).

---

### T27: Smoke cluster target

**What**: `smoke-local-integration.mjs` moves its four `dockerCompose` call sites behind `observe.psql`/`observe.s3api`; `SMOKE_TARGET=compose` (default, byte-identical commands) | `kind` (`kube.mjs` `exec -i statefulset/postgres -- psql …`; `run smoke-s3-<rand> --rm -i --restart=Never --image=amazon/aws-cli:2.37.4 --overrides=<env from fiapx-storage>` `-- s3api …`); unknown target exits non-zero. Self-test gains cases for both adapters' argument building.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T26
**Reuses**: existing smoke self-test harness; `scripts/kube.mjs`
**Requirement**: K8S-10

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Compose-target argument lists unchanged (self-test compares them)
- [x] Gate: `node scripts/smoke-local-integration.mjs --self-test` + Full gate exit 0
- [x] Test count: previous smoke self-test count + ≥ 4

**Tests**: self-test
**Gate**: Full

**Commit**: `feat(platform): let the smoke observe a kind cluster`

**Status**: ✅ Complete (2026-09-29). `scripts/smoke-local-integration.mjs`: the observations now go through `observerFor(target)` with two calls, `psql(args, sql)` and `s3api(args)`, and `observationCommand(target, kind, args, podName)` builds each command line. The smoke had three `dockerCompose` call sites, not the design's four: `countDeliveries` (psql), `listArchives` and `readBucketLifecycle` (s3api); all three moved. `SMOKE_TARGET=compose` (default) produces the pre-adapter lists byte for byte through `dockerCompose`. `SMOKE_TARGET=kind` goes through `kubectl()` from `scripts/kube.mjs` (so `--context kind-fiapx` and the cluster's own kubeconfig): psql as `exec -i -n fiapx statefulset/postgres -- psql …` with the SQL on stdin; s3api as `run smoke-s3-<8 hex> -n fiapx --rm -i --quiet --restart=Never --image=amazon/aws-cli:2.37.4 --override-type=strategic --overrides=<json> -- s3api …`, the overrides adding `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` from `secretKeyRef` `fiapx-storage` and literal `AWS_DEFAULT_REGION=us-east-1`, `AWS_ENDPOINT_URL=http://storage:9000` to the generated container. `--quiet` keeps kubectl's `pod "…" deleted` line out of the aws-cli output the smoke parses (kubectl `run.go`: `deleteOpts.Quiet = o.Quiet`); `--override-type=strategic` merges the env into the container by name, keeping the stdin and args kubectl generates (the default JSON merge would replace the container list). An unknown target is refused before any step runs. Self-test: 9 adapter cases added (planned ≥ 4) on top of the unchanged 32 steps / 189 rejections / 63 acceptances: compose output passes through; the three compose command lines equal the pre-adapter literals; kind psql exact with stdin; kind s3api exact; its overrides exact; both kind lines accepted by `kubectlArgs` and pinned to `--context kind-fiapx`; a fresh pod name per call; an unknown target refused; the spawned run with `SMOKE_TARGET=k8s` exits 1 with that message alone. Four mutants on scratch copies (`--quiet` dropped, unknown target accepted, compose `-T` dropped, the secret key swapped) were each killed. Full gate 0.

---

### T28: Live cluster check

**What**: `check-kubernetes.mjs --live`: every workload Ready, `job/storage-init` complete, `get hpa` lists the KEDA HPA for `worker`, Prometheus targets all `up==1` with one `worker` target per worker pod, Grafana `/api/dashboards/uid/fiapx-overview` 200 (admin from the Secret). `--self-test` feeds canned responses for each failure.
**Where**: `scripts/check-kubernetes.mjs`
**Depends on**: T27
**Reuses**: `check-observability.mjs --live` logic
**Requirement**: K8S-19, K8S-25, K8S-26, K8S-27

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Self-test: missing HPA, a down target, fewer worker targets than pods, dashboard 404 - each exits 1 with its message
- [x] Build gate exits 0 (phase end)
- [x] Test count: T20 count + ≥ 4

**Tests**: self-test
**Gate**: Build

**Commit**: `feat(platform): add the live kubernetes check`

**Status**: ✅ Complete (2026-09-29). `scripts/check-kubernetes.mjs --live`: `liveProblems({ kube, http, now, sleep, waitMs, host })`, with `kube` = `kubectl()` from `scripts/kube.mjs` (every read `-n fiapx`, JSON output) and HTTP on the host ports. Workloads: every required Deployment/StatefulSet/Job exists ("… is not in the cluster") and each is ready by the up command's own rule (`pendingWorkloads` imported from `k8s-up.mjs`: updated and Ready replicas, `storage-init` Complete). HPA: one whose `scaleTargetRef` is Deployment `worker` (KEDA's `keda-hpa-worker`). Prometheus (`:9090/api/v1/targets?state=active`): each of `api`, `catalog`, `worker`, `notification`, `rabbitmq` has a target, every target `up`, and the worker targets' `instance` labels equal the names of the running worker pods (`get pods -l app=worker`), retried every 5 s for up to 90 s so a first scrape can land. Grafana (`:3005/api/dashboards/uid/fiapx-overview`): 200 with `meta.provisioned: true`, asked with Basic auth built from Secret `fiapx-grafana-admin` (`GF_SECURITY_ADMIN_USER`/`GF_SECURITY_ADMIN_PASSWORD`). Any failure prints each problem and exits 1. `selfTest` is now async. Self-test: 11 live cases (planned T20 count + ≥ 4) on canned answers: a healthy cluster (also: every cluster read is namespaced to `fiapx` and names no context; Grafana is asked with the Secret's admin); missing HPA (an HPA for another Deployment); a target down; fewer worker targets than pods; a worker target that is not a running pod; no catalog target; dashboard 404; dashboard not provisioned; a workload not Ready; a workload missing plus the Job not complete; a target still `unknown` retried until the wait ends (20 s). Offline cases unchanged (52 rejected, 10 accepted, 7 parser readings). Six line-targeted mutants on scratch copies (HPA check off, worker count only compared one way, dashboard status ignored, Grafana password not from the Secret, only `down` counted as unhealthy, missing workloads ignored) were each killed; an unmutated copy passed. Not run against a cluster (T34). Phase 6 Build gate 0: Full gate (kube, check-kubernetes and k8s-up self-tests, default mode 45 objects, kubeconform `Valid: 45`), ci-governance and its self-test, docs-links, check-observability, `docker compose config -q`; `node scripts/k8s-down.mjs --self-test` and `node scripts/smoke-local-integration.mjs --self-test` 0.

---

### T29: Topology job steps

**What**: `.github/workflows/ci.yml` `topology` job: install pinned kubeconform v0.8.0 (sha256-checked), run `node scripts/kube.mjs --self-test`, `node scripts/check-kubernetes.mjs`, `--self-test`, `node scripts/k8s-up.mjs --self-test`, `node scripts/k8s-down.mjs --self-test`, and the kustomize | kubeconform pipeline.
**Where**: `.github/workflows/ci.yml`
**Depends on**: T28
**Reuses**: existing topology steps
**Requirement**: K8S-32

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] `node scripts/check-ci-governance.mjs` exits 0 (topology still unconditioned)
- [x] Gate: Build gate exits 0

**Tests**: none
**Gate**: Build

**Commit**: `ci(platform): prove the kubernetes manifests in the topology job`

**Status**: ✅ Complete (2026-09-29). `topology` gains nine unconditioned steps after the load-test self-test: install kubeconform v0.8.0 from the release tarball `kubeconform-linux-amd64.tar.gz`, checked with `sha256sum -c` against `9bc2bffbf71f261128533edaf912153948b7ff238f9a531ae6d34466ec287883` (computed from the downloaded file and equal to the release's `CHECKSUMS` line), extracted into `$RUNNER_TEMP/bin` and added to `GITHUB_PATH`; then one one-line step each for `node scripts/kube.mjs --self-test`, `node scripts/check-kubernetes.mjs`, `node scripts/check-kubernetes.mjs --self-test`, `node scripts/k8s-up.mjs --self-test`, `node scripts/k8s-down.mjs --self-test`; then the render and the schema check as two steps, `kubectl kustomize --load-restrictor LoadRestrictionsNone k8s > rendered-k8s.yaml` and `kubeconform -strict -summary -schema-location default -schema-location '<datreeio CRDs-catalog>' rendered-k8s.yaml`. SPEC_DEVIATION (design: a `kustomize | kubeconform` pipe): the default `run` shell is `bash -e` without `pipefail` and the governance guard forbids `shell:` in `topology`, so a failed render piped into kubeconform would validate empty input and pass; the file between two steps fails on either. kubectl is the runner image's (ubuntu-24.04 lists Kubectl 1.37.0, Kustomize 5.8.1; `kustomize --load-restrictor` is a local render that needs no kubeconfig, checked here with `~/.kube/kind-fiapx.config` absent). Each new step's command ran locally under `bash -e`: exit 0, kubeconform `Valid: 45, Invalid: 0` (local kubeconform 0.7.0; CI runs the pinned 0.8.0). Build gate 0, including `check-ci-governance` (topology still unconditioned) and a PyYAML parse of the workflow.

---

### T30: Kubernetes CI job

**What**: New job `kubernetes` (`needs: [topology]`, no `if:`): checkout, setup-node, install pinned kind v0.33.0 (sha256-checked), `node scripts/k8s-up.mjs`, `SMOKE_TARGET=kind node scripts/smoke-local-integration.mjs`, `node scripts/check-kubernetes.mjs --live`; on failure dump `kubectl --context kind-fiapx -n fiapx get pods,events` and pod logs; teardown `node scripts/k8s-down.mjs` under `always()`.
**Where**: `.github/workflows/ci.yml`
**Depends on**: T29
**Reuses**: `integration` job shape (log dumps, teardown)
**Requirement**: K8S-34

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Workflow parses; Build gate exits 0 (governance not yet guarding the job - T31)

**Tests**: none
**Gate**: Build

**Commit**: `ci(platform): run the topology on a kind cluster`

**Status**: ✅ Complete (2026-09-29). New job `kubernetes` in `.github/workflows/ci.yml`: `needs: [topology]`, no `if:`, `timeout-minutes: 45`, job `permissions: contents: read, packages: read`. Steps: checkout; setup-node 22; install kind v0.33.0 from the release binary `kind-linux-amd64`, checked with `sha256sum -c` against `aee6151561422756b764a4ae28e7f44cda5af5a9eead3cc9985112b1de8d8e0d` (computed from the downloaded file and equal to the release's `.sha256sum`), into `$RUNNER_TEMP/bin` prepended through `GITHUB_PATH` (so it wins over the runner image's own kind); then three unconditioned one-line steps, `node scripts/k8s-up.mjs` (env `GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `GHCR_USERNAME: ${{ github.actor }}`, so the `ghcr-pull` Secret is created and a private package still pulls), `SMOKE_TARGET=kind node scripts/smoke-local-integration.mjs`, `node scripts/check-kubernetes.mjs --live`. On `failure()`: "Collect cluster state and pod logs" writes `get pods,jobs,hpa,scaledobjects -o wide`, events, and each pod's `describe` and `logs --all-containers --prefix` to `cluster-logs.txt` (`set +e` so one missing resource does not stop the dump), every call written as `KUBECONFIG=$HOME/.kube/kind-fiapx.config kubectl --context kind-fiapx -n fiapx …`; "Upload cluster logs" uploads it. Teardown "Delete the kind cluster" runs `node scripts/k8s-down.mjs` under `always()`, the `integration` job's shape. kubectl is the runner image's (1.37.0). The job runs only on GitHub (T34 records its first run; it cannot pass before the four `:main` images exist). The log script passed `bash -n`; the workflow parses (PyYAML); Build gate 0.

---

### T31: Guard the kubernetes job

**What**: `check-ci-governance.mjs`: the three `kubernetes` job commands join the protected list (one-line steps, no `if:`/`continue-on-error`/`shell:`/`|| true`); the job has no `if:` and `needs` exactly `[topology]`; self-test gains a case per rule.
**Where**: `scripts/check-ci-governance.mjs`
**Depends on**: T30
**Reuses**: `STACK_COMMANDS` guard, the topology guard from S8
**Requirement**: K8S-35

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Self-test: removing each command, masking with `|| true`, `if:` on the job, `needs` changed - each rejected
- [x] Gate: Build gate exits 0
- [x] Test count: previous governance self-test count + ≥ 5

**Tests**: self-test
**Gate**: Build

**Commit**: `ci(platform): guard the kubernetes job's commands`

**Status**: ✅ Complete (2026-09-29). `scripts/check-ci-governance.mjs` rule 6, `kubernetesProblems`: the `kubernetes` job must exist; sets no `if:`, `shell:` or `continue-on-error` (job or any step); sets `needs: [topology]` exactly (`[topology]` or the scalar `topology`; anything else, a second job, or no `needs` is named with its value); only "Collect cluster state and pod logs" and "Upload cluster logs" may carry `failure()` and "Delete the kind cluster" `always()`, and no step running a cluster command may be conditioned; `node scripts/k8s-up.mjs`, `SMOKE_TARGET=kind node scripts/smoke-local-integration.mjs` and `node scripts/check-kubernetes.mjs --live` each run as the whole one-line `run:` of their own step. As design.md's CI section says, the topology guard now also protects T29's seven new commands (the kube, check-kubernetes, k8s-up and k8s-down proofs, the kustomize render, the kubeconform validation). The kustomize command string is built from `KUBECTL_BIN` (imported from `scripts/kube.mjs`) and the fixture's kind download path is not spawn-shaped, because the static kubectl and kind scans of `check-kubernetes` (found by the gate) refuse a raw tool string in any script but `kube.mjs`. Self-test: 56 bad workflows rejected (was 39; +17), 3 good accepted (was 2): the up command removed, the cluster smoke masked by `|| true`, the smoke without `SMOKE_TARGET=kind`, the live check under `set +e` in a `run: |`, `if:` on the job, `needs` changed to `[integration]`, `needs` with a second job, no `needs`, the up step gated on the event, the smoke renamed to an allow-listed log step, `failure()` on the teardown, `continue-on-error` on a step, `shell:` on a step, no `kubernetes` job; the offline Kubernetes check and the render removed from topology, kubeconform masked by `|| true`; accepted: `needs: topology` as a scalar. Ten mutants on scratch copies (each job rule removed, needs parsed as its first entry only, any condition accepted on allow-listed names, a command accepted inside a larger run, the rule not wired in, the new topology commands dropped, the smoke command without `SMOKE_TARGET`) were each killed. `node scripts/check-ci-governance.mjs` passes on the real workflow; `apply-required-checks --self-test` (which imports this script) 0. Build gate 0.

---

### T32: README Kubernetes section

**What**: README section "Local Kubernetes (kind)": prerequisites with minimum versions (Docker, kind 0.33, kubectl 1.36), up/down/smoke/live-check commands, host ports + overrides, exclusivity with Compose, the context-pinning warning, how to read generated admin passwords, the scaling scene (burst command, `kubectl --context kind-fiapx -n fiapx get hpa -w`, expected 1 → N → 1), GHCR images and the merge order.
**Where**: `README.md`
**Depends on**: T31
**Reuses**: README observability/replicas sections
**Requirement**: K8S-36, K8S-37

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] `node scripts/check-docs-links.mjs` exits 0

**Tests**: none
**Gate**: Build

**Commit**: `docs(platform): document the local kubernetes cluster`

**Status**: ✅ Complete (2026-09-29). README section "Local Kubernetes (kind)" under "Running locally", before "CI and the required checks": prerequisites (Docker running, kind 0.33+, kubectl 1.36+, all checked by the preflight); the up, smoke (`SMOKE_TARGET=kind`), live-check and down commands and what each does (KEDA v2.21.0 checksum, create-if-absent Secrets, 600 s wait naming each not-Ready workload, idempotent re-run, refusal of an unhealthy or re-mapped cluster, down deletes only `fiapx`); why the cluster lives in `~/.kube/kind-fiapx.config` (kind always sets current-context in the file it writes; `~/.kube/config` is never touched) and that every manual kubectl, including `get hpa -w` and the password reads, is written `KUBECONFIG=~/.kube/kind-fiapx.config kubectl --context kind-fiapx -n fiapx …`; the ten host ports, `CATALOG_HOST_PORT`/`STORAGE_HOST_PORT` (fixed at creation), no Worker host port, and exclusivity with Compose (`docker compose down` first; the up command names each busy port); how to read the generated Grafana, Keycloak and RabbitMQ credentials; GHCR `:main` multi-arch images, the merge order (service PRs first, this repository last) and the `GHCR_TOKEN` → `ghcr-pull` fallback; the scaling scene (1 CPU per replica, targets 2 and 20, 1..5, `keda-hpa-worker`, five free CPUs for five replicas; `get hpa -w` and four concurrent `node scripts/load-test.mjs --videos 50`; expected 1 → N (≤ 5) → 1 within 300 s of the queues emptying, each run `COMPLETED 50/50`). The CI section lists the `kubernetes` job's guard and the topology guard's new commands, and says the job becomes a required check only after its first green run on `main`; the Layout table gains `k8s/` and the new scripts. `node scripts/check-docs-links.mjs` 0 (`0 unresolved link(s)`); the smoke self-test (which reads the README) 0; Build gate 0.

---

### T33: Record AD-018

**What**: `.specs/STATE.md` gains AD-018 (cluster conventions: `--context kind-fiapx` only through `scripts/kube.mjs`; multi-arch GHCR images on `main`, cluster runs `:main`; per-cluster generated Secrets, never versioned; Compose stays the dev loop and `integration` gate; merge order services → platform) in the existing AD format; Handoff updated.
**Where**: `.specs/STATE.md`
**Depends on**: T32
**Reuses**: AD-016/AD-017 format
**Requirement**: K8S-04, K8S-13, K8S-28

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Build gate exits 0 (phase end)

**Tests**: none
**Gate**: Build

**Commit**: `docs(specs): record ad-018 for the local kubernetes cluster`

**Status**: ✅ Complete (2026-09-29). `.specs/STATE.md` AD-018 in the AD-015..017 format (Decision, Reason, Trade-off, Scope, Merge order, Date, Status): the kind cluster `fiapx` from one kustomization, alongside Compose; the separate kubeconfig `~/.kube/kind-fiapx.config` (kind always sets current-context in the file it writes) and `--context kind-fiapx` only through `scripts/kube.mjs` (`kubectl()` and `kind()`), enforced by the kubectl and kind scans of `check-kubernetes`; multi-arch GHCR `:<sha>`/`:main` published with `GITHUB_TOKEN`, the cluster running `:main`; per-cluster generated Secrets, created only when absent, never versioned, fixtures staying fixtures; KEDA 1..5 with targets 2 and 20; Compose as the dev loop and `integration` gate beside `topology`'s offline proof and the `kubernetes` job; merge order services → platform. Handoff replaced (section-scoped) with the Phase 8 next step and its go-ahead. Phase 7 Build gate 0: kube, check-kubernetes (default and self-test), k8s-up and k8s-down self-tests, kustomize render + kubeconform `Valid: 45, Invalid: 0`, ci-governance and its self-test, docs-links, check-observability, `docker compose config -q`, workflow YAML parse.

---

### T34: Live verification ("pronto quando")

**What**: After the four service PRs are merged (go-ahead) and `:main` images exist: `node scripts/k8s-up.mjs` from clean (Compose down); record time to Ready; `SMOKE_TARGET=kind` smoke; `check-kubernetes --live`; token from host accepted; presigned download from host; re-run up (idempotent, replicas unchanged while scaled); scaling scene: burst (four concurrent `load-test --videos 50`) with `get hpa -w` evidence 1 → N (≤5) → 1 within 300 s of the queues emptying, all COMPLETED; kill a Worker pod mid-job and see the job complete elsewhere; wrong-context safety (current context left untouched: compare `kubectl config current-context` before/after); `k8s-down`. Evidence recorded here and in spec traceability.
**Where**: `.specs/features/local-kubernetes/tasks.md`
**Depends on**: T33
**Reuses**: `scripts/load-test.mjs`, smoke, `check-kubernetes --live`
**Requirement**: K8S-01..03, K8S-07, K8S-10..12, K8S-19..22, K8S-25..27

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [x] Every listed AC has recorded evidence (command + key numbers)
- [x] The current kube context is identical before and after the run
- [x] Test count in the feature validation phase

**Tests**: none
**Gate**: Build

**Commit**: `chore(platform): record the live kubernetes verification run`

**Status**: ✅ Complete (2026-09-29). Live run on kind v0.33.0, Docker Desktop arm64 (10 CPUs, 14.6 GB), images `ghcr.io/tech-challenge-workshop/<repo>:main` (multi-arch, private packages, pulled through `ghcr-pull`). Host ports 3001 and 9000 were held by foreign processes, so every command ran with `CATALOG_HOST_PORT=33001 STORAGE_HOST_PORT=39000` (the documented overrides); the up command ran with `GHCR_TOKEN=$(gh auth token) GHCR_USERNAME=GabrielStima`. Every manual kubectl was `KUBECONFIG=~/.kube/kind-fiapx.config kubectl --context kind-fiapx -n fiapx …`. No platform fix was needed: every step passed on the committed code.

Evidence:

- **Context safety (K8S-04)**: before and after the whole run, `kubectl config current-context` = `arn:aws:eks:us-east-1:541036791805:cluster/tech-challenge-eks-cluster` and `shasum ~/.kube/config` = `228cf9a7933d4c7f5d9df58c08c8754853054072`, identical (also re-checked mid-create). The cluster lived only in `~/.kube/kind-fiapx.config`.
- **Up from clean (K8S-01, K8S-02, K8S-15)**: `node scripts/k8s-up.mjs` exit 0 in **421 s** wall (create, Secrets `fiapx-postgres, fiapx-storage, fiapx-rabbitmq, fiapx-keda-rabbitmq, fiapx-identity-admin, fiapx-grafana-admin, ghcr-pull` generated, KEDA v2.21.0, apply, wait); 9 Deployments 1/1, StatefulSets `postgres` and `storage` 1/1, Job `storage-init` Complete (4m19s, mostly first image pulls), HPA `keda-hpa-worker` 1..5, ScaledObject `worker` READY True. K8S-03's timeout path was not triggered live (self-test only).
- **Preflights (K8S-05, K8S-06)**: without the overrides, `k8s-up` exit 1 `host port 3001, 9000 are already in use …`; with `PATH=/usr/bin:/bin`, exit 1 `preflight failed, nothing was created: kind not found … kubectl not found … docker not found`; `kind get clusters` empty after both.
- **Smoke (K8S-10)**: `SMOKE_TARGET=kind node scripts/smoke-local-integration.mjs` exit 0, 30 observations (uploads on `localhost:39000`, COMPLETED with 8 frames, FORMATO_INVALIDO and PROCESSAMENTO_FALHOU, notifications and Mailpit, ownership 404s, bucket lifecycle rules, anonymous 403).
- **Live check (K8S-19, K8S-25..27)**: `node scripts/check-kubernetes.mjs --live` exit 0: `every workload is Ready, storage-init is Complete, an HPA scales the worker, every Prometheus target is up with one worker target per worker pod, Grafana serves the fiapx-overview dashboard`. `GET /api/dashboards/uid/fiapx-overview` as admin 200.
- **Host token (K8S-11)**: `node scripts/get-token.mjs alice` → `iss http://localhost:8080/realms/fiapx`; `GET /processing-requests` with it 200, without it 401.
- **Presigned URLs from the host (K8S-12)**: the smoke uploaded through part URLs on `http://localhost:39000` and its download URL `served 70557 bytes to the host` (the storage host port, moved by `STORAGE_HOST_PORT`; `localhost:9000` by default).
- **Probes (K8S-09)**: live Deployments api/catalog/notification/worker: readiness `GET /health`, liveness `GET /health/live` on port `http` = 3000/3001/3003/3002.
- **Secrets (K8S-13, K8S-14)**: the render (`kubectl kustomize`, 45 objects) holds 0 `Secret` objects; its 8 `data:` blocks are all ConfigMaps; 0 env entries named `*PASSWORD*|*SECRET*|*ACCESS_KEY*|*TOKEN*` with a literal `value`.
- **Idempotent re-run (K8S-07)**: `k8s-up` on the healthy cluster exit 0 in 15 s (`reusing the kind cluster fiapx`, `Secrets created: none (all present)`), every Deployment/StatefulSet `ready/spec` identical before and after. Again during a burst with the Worker at **5/5**: exit 0 in 16 s, Worker still 5/5, one ReplicaSet, generation unchanged (no rollout).
- **Scaling scene (K8S-18, K8S-20, K8S-21, K8S-25)**: four concurrent `node scripts/load-test.mjs --videos 50 --timeout-seconds 1500`, sampled every 5 s (HPA, Deployment, pods, queue depth, Prometheus worker targets). Burst A: `processing=160` at 13:20:47 → HPA desired 5, `deploy 5/5` at 13:20:58; queues empty 13:21:03; Prometheus worker targets `5/5` with 5 pods; Worker 5 → 3 (13:21:50) → 1 (13:22:06), i.e. **63 s** after the queues emptied, the last Terminating pod gone at 94 s. Burst B: `processing=180` → 5/5 at 13:24:00, queues empty 13:24:00, back to 1 at 13:24:52 (**52 s**). Every run `COMPLETED 50/50`: three bursts of 4 × 50 (A, B, and a third during the kill tests) and four single runs of 50 plus one of 20, 0 FAILED. Never above 5 replicas.
- **Scale-in redelivery (K8S-22)**: a 590 s 720p video (made with the Worker's ffmpeg, 9.3 MB, ~12 s of processing on 1 CPU) was uploaded; 3 s into `PROCESSING` its pod `worker-…-nklbl` was deleted with `--grace-period=1` (SIGTERM, SIGKILL after 1 s). RabbitMQ `processing`: before `deliver 826 ack 825 redeliver 0` (1 unacked), after `deliver 827 redeliver 1`; the new pod `worker-…-5bsnw` consumed it and the request `624d379e-…` reached **COMPLETED** 20 s after the kill (not FAILED). With the default 30 s grace (plain `kubectl delete pod`), the in-flight job finished on the terminating pod and was acked, also COMPLETED.
- **Down (K8S-08)**: `node scripts/k8s-down.mjs` exit 0 `deleted the kind cluster fiapx`; `kind get clusters` → `No kind clusters found.`; no `fiapx` container left; a second run exit 0 `does not exist; nothing to delete`.
- **Build gate after the run**: `kube.mjs`, `check-kubernetes.mjs`, `k8s-up.mjs`, `k8s-down.mjs` self-tests 0; `check-kubernetes.mjs` 0 (45 objects); render + kubeconform `Valid: 45, Invalid: 0`; `check-ci-governance` and its self-test 0 (56 bad / 3 good workflows); `check-docs-links` 0 (`0 unresolved link(s)`); `check-observability` 0; smoke self-test 0 (32 steps, 189 bad / 63 good inputs); load-test self-test 0 (20 assertions); `docker compose config -q` 0.

Observed for the service (not fixed here): the Worker does not act on SIGTERM. `src/main.ts` never calls `app.enableShutdownHooks()` and the image runs `node dist/main` as PID 1, so `ShutdownSignal` (`onModuleDestroy`) never fires, the "left for redelivery" path never runs, and a terminating pod keeps consuming until SIGKILL at the 30 s grace (scaled-in pods stayed Terminating ~26-30 s). Correctness holds through broker redelivery (proven above), but scale-in is slower than it needs to be. Not proven here: the PR runs of the four `image` jobs (K8S-29) and the platform `kubernetes` CI job (K8S-34), which need the push.

---

## Post-verification fixes

The Verifier (`validation.md`) returned FAIL with two surviving mutants. Both are fixed; no cluster was touched (offline gate and scratch-worktree mutants only).

### Fix 1: close the raw kubectl spawn hole (K8S-04, M17, blocking)

**Root cause**: `scripts/kube.mjs` exported `KUBECTL_BIN = 'kubectl'`, and `rawKubectlProblems` only matched a quoted `kubectl` literal, so `spawnSync(KUBECTL_BIN, args)` in the smoke's kind adapter ran against the current (EKS) context and passed every check.
**Change**: the binary names are private constants in `kube.mjs`; other scripts use `kubectlHint()` (always `KUBECONFIG=~/.kube/kind-fiapx.config kubectl --context kind-fiapx -n fiapx …`), `KUBECTL_NOT_FOUND` and `KUSTOMIZE_RENDER_STEP` (`k8s-up.mjs`, `check-ci-governance.mjs`). `kube.mjs --self-test` fails when any export holds a bare or path-to `kubectl`/`kind` and pins the export list. `check-kubernetes` refuses the identifiers `KUBECTL`, `KUBECTL_BIN` (kubectl rule) and `KIND`, `KIND_BIN` (kind rule) in any non-comment line outside `kube.mjs`: spawned, interpolated or imported. The smoke's `kubectlObservation` already called `kubectl()`; unchanged.
**Self-test**: kubectl scan +7 cases (`spawnSync(KUBECTL_BIN, …)`, ``execSync(`${KUBECTL_BIN} get pods …`)``, the import, a local `KUBECTL`, kube.mjs exempt, near-misses `KUBECTL_NOT_FOUND`/`KUBECTL_CALLS`/`kubectlHint`); kind scan +4 (`KIND_BIN` spawned, imported, `${KIND}` interpolated; `KIND_CLUSTER` near-miss); kube self-test: hints and 3 refused hints, no export holds a binary name.
**Sensor** (scratch worktree `/private/tmp/s9a-fix-m17`, removed; real tree unchanged): M17 (smoke imports `KUBECTL_BIN` and spawns it) → `check-kubernetes` exit 1 `scripts/smoke-local-integration.mjs:8: spawns kubectl directly …`, and the smoke self-test exits 1 (`does not provide an export named 'KUBECTL_BIN'`); a local constant → exit 1 at `:212`; an interpolated `execSync` → exit 1 at `:213`; `kube.mjs` re-exporting the name → kube self-test exit 1 `exports holding a binary name: got ["KUBECTL_BIN"]`. **Killed.**
**Commit**: aa132a3 `fix(platform): close the raw kubectl spawn hole in the context guard`

### Fix 2: credentials inside URL values (K8S-13, M26, minor)

**Root cause**: the K8S-16 rule keys on the variable's name only.
**Change**: `manifestProblems` also rejects a literal env `value` that is a URL whose userinfo carries a password (`scheme://user:pass@host`), naming the object, container and variable.
**Self-test**: `RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672` rejected with `Deployment/worker: container worker sets RABBITMQ_URL to a literal URL with a password in it; credentials come from a Secret (secretKeyRef)`; `http://storage:9000` and `smtp://fiapx@mailpit:1025` (a user, no password) accepted.
**Sensor**: M26 (`k8s/worker.yaml` `RABBITMQ_URL` as that literal) → `check-kubernetes` exit 1 with the message above. **Killed.**
**Commit**: 033f479 `feat(platform): reject credentials embedded in manifest urls`

### Docs

`spec.md` traceability: K8S-28..30 Verified with the run ids (PR runs skipped the GHCR login; `main` runs published; the API's attempt 2 is V68), K8S-04 and K8S-13 cite the fixes. `.specs/STATE.md` Handoff: images published, packages private until delivery (V69); next is the platform PR and the first `kubernetes` CI run.

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → [go-ahead: merge service PRs] → Phase 8

Phase 1:  T1 → T2 → T3 → T4                 (service repos, branch feat/publish-images)
Phase 2:  T5 → T6 → T7 → T8
Phase 3:  T9 → T10 → T11 → T12 → T13 → T14
Phase 4:  T15 → T16 → T17 → T18 → T19 → T20
Phase 5:  T21 → T22 → T23
Phase 6:  T24 → T25 → T26 → T27 → T28
Phase 7:  T29 → T30 → T31 → T32 → T33
Phase 8:  T34
```

Execution is strictly sequential.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1–T4 | 1 workflow job per repo | ✅ Granular |
| T5, T6, T26 | 1 script each | ✅ Granular |
| T7, T8 | 1 config file each (T7 + its `namespace.yaml` companion) | ✅ Granular (cohesive) |
| T9–T19, T21–T23 | 1 manifest file each (workload + its Services) | ✅ Granular (cohesive) |
| T20, T28 | 1 rule set added to one script | ✅ Granular |
| T24, T25 | 1 script split at the preflight/secrets vs KEDA/apply/wait seam | ✅ Granular |
| T27 | 1 adapter in one script | ✅ Granular |
| T29–T31 | 1 CI change each | ✅ Granular |
| T32, T33 | 1 doc each | ✅ Granular |
| T34 | live verification record | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | start of Phase 1 | ✅ Match |
| T2–T4 | previous task | chain | ✅ Match |
| T5 | T4 | Phase 1 → Phase 2 | ✅ Match |
| T6–T8 | previous task | chain | ✅ Match |
| T9 | T8 | Phase 2 → Phase 3 | ✅ Match |
| T10–T14 | previous task | chain | ✅ Match |
| T15 | T14 | Phase 3 → Phase 4 | ✅ Match |
| T16–T20 | previous task | chain | ✅ Match |
| T21 | T20 | Phase 4 → Phase 5 | ✅ Match |
| T22–T23 | previous task | chain | ✅ Match |
| T24 | T23 | Phase 5 → Phase 6 | ✅ Match |
| T25–T28 | previous task | chain | ✅ Match |
| T29 | T28 | Phase 6 → Phase 7 | ✅ Match |
| T30–T33 | previous task | chain | ✅ Match |
| T34 | T33 | Phase 7 → Phase 8 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1–T4 | Service CI workflow | YAML parse (no test runner) | none / Service gate | ✅ OK |
| T5, T6, T20, T24–T28 | Scripts | self-test | self-test | ✅ OK |
| T7–T19, T21–T23 | Manifests / config | render + schema + offline rules (gate) | none / Full or Build gate | ✅ OK |
| T29, T30 | Platform CI workflow | governance check (gate) | none / Build gate | ✅ OK |
| T31 | Governance script | self-test | self-test | ✅ OK |
| T32, T33 | Docs | docs-links (gate) | none / Build gate | ✅ OK |
| T34 | Live behavior | live verification | none (live evidence) | ✅ OK |
