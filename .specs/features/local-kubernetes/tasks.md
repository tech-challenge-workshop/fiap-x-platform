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

- [ ] Full gate exits 0; Build gate exits 0 (phase end)

**Tests**: none
**Gate**: Build

**Commit**: `feat(platform): add the mailpit deployment`

---

### T15: Catalog manifest

**What**: `k8s/catalog.yaml`: Deployment `catalog` (image `processing-catalog`, env as Compose with `DATABASE_PASSWORD` from `fiapx-postgres/CATALOG_DB_PASSWORD` and `RABBITMQ_URL` from `fiapx-rabbitmq/URL`, readiness `/health`, liveness `/health/live` on 3001, `imagePullPolicy: Always`), Service `catalog` (ClusterIP 3001) + NodePort (30001→3001).
**Where**: `k8s/catalog.yaml`
**Depends on**: T14
**Reuses**: compose catalog service; S8 health contract
**Requirement**: K8S-02, K8S-09, K8S-13, K8S-31

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Full gate exits 0 (probe, secret and image rules now apply to a real object)

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the catalog deployment`

---

### T16: Notification manifest

**What**: `k8s/notification.yaml`: Deployment `notification` (env as Compose; DB password and broker URL from Secrets; `SMTP_HOST=mailpit`; probes on 3003), Service `notification` (ClusterIP 3003) + NodePort (30003→3003).
**Where**: `k8s/notification.yaml`
**Depends on**: T15
**Reuses**: compose notification service
**Requirement**: K8S-02, K8S-09, K8S-13, K8S-31

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Full gate exits 0

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the notification deployment`

---

### T17: API manifest

**What**: `k8s/api.yaml`: Deployment `api` (env as Compose: `OIDC_ISSUER=http://localhost:8080/realms/fiapx`, `OIDC_JWKS_URL=http://identity:8080/…/certs`, `CATALOG_BASE_URL=http://catalog:3001`, `STORAGE_ENDPOINT=http://storage:9000`, `STORAGE_PUBLIC_ENDPOINT` from ConfigMap `fiapx-host`, storage keys from `fiapx-storage`; initContainer `wait-for-bucket` (aws-cli `head-bucket` loop); probes on 3000), Service `api` (ClusterIP 3000) + NodePort (30000→3000).
**Where**: `k8s/api.yaml`
**Depends on**: T16
**Reuses**: compose api service
**Requirement**: K8S-02, K8S-09, K8S-11, K8S-12, K8S-13, K8S-31

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Full gate exits 0

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the api deployment`

---

### T18: Worker manifest

**What**: `k8s/worker.yaml`: Deployment `worker` **without `spec.replicas`**, label `app=worker`, container port 3002, `FFMPEG_THREADS=1`, `resources: requests/limits cpu "1"`, memory 512Mi/1Gi, broker URL and storage keys from Secrets, initContainer `wait-for-bucket`, probes on 3002, `terminationGracePeriodSeconds: 30`, `imagePullPolicy: Always`. No Service beyond a headless one if needed (Prometheus discovers pods).
**Where**: `k8s/worker.yaml`
**Depends on**: T17
**Reuses**: compose worker service; AD-006 sizing
**Requirement**: K8S-02, K8S-09, K8S-13, K8S-23, K8S-31

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Full gate exits 0 (sizing and no-replicas rules apply)

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the worker deployment`

---

### T19: Worker autoscaling

**What**: `k8s/worker-scaling.yaml`: `TriggerAuthentication` `rabbitmq-management` (`secretTargetRef` `host` ← `fiapx-keda-rabbitmq/host`) and `ScaledObject` `worker` (min 1, max 5, `pollingInterval: 5`, HPA `scaleDown.stabilizationWindowSeconds: 60`, two `rabbitmq` triggers `protocol: http`, `mode: QueueLength`: `processing` `"2"`, `video-validation` `"20"`).
**Where**: `k8s/worker-scaling.yaml`
**Depends on**: T18
**Reuses**: KEDA 2.21 rabbitmq scaler docs (design research)
**Requirement**: K8S-18, K8S-21, K8S-24

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Full gate exits 0 (kubeconform validates the KEDA CRDs from the CRDs catalog; ScaledObject rule applies)

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): autoscale the worker on queue depth with keda`

---

### T20: Required-workload rule

**What**: `check-kubernetes.mjs` gains a completeness rule: the render must contain the 11 workloads (Deployments `api`, `catalog`, `notification`, `worker`, `rabbitmq`, `identity`, `mailpit`, `prometheus`, `grafana`; StatefulSets `postgres`, `storage`), Job `storage-init`, `ScaledObject` `worker` and `TriggerAuthentication` `rabbitmq-management`; `prometheus`/`grafana` listed as pending until T22/T23 by a single constant updated there. Self-test plants a missing workload.
**Where**: `scripts/check-kubernetes.mjs`
**Depends on**: T19
**Reuses**: T6 rules
**Requirement**: K8S-02, K8S-33

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Deleting any service manifest from `resources` fails the default mode (self-test case)
- [ ] Build gate exits 0 (phase end)
- [ ] Test count: T6 count + ≥ 2

**Tests**: self-test
**Gate**: Build

**Commit**: `feat(platform): require every workload in the kubernetes render`

---

### T21: Prometheus config for the cluster

**What**: `prometheus/prometheus.k8s.yml`: same jobs, interval and timeout as `prometheus.yml`; `worker` job via `kubernetes_sd_configs` role `pod` in namespace `fiapx`, relabel keep `app=worker` and container port 3002, `instance` = pod name; `rabbitmq` target `rabbitmq:15692`.
**Where**: `prometheus/prometheus.k8s.yml`
**Depends on**: T20
**Reuses**: `prometheus/prometheus.yml`
**Requirement**: K8S-25, K8S-26

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] `promtool check config` (via `prom/prometheus:v3.15.0` container) reports valid
- [ ] `node scripts/check-observability.mjs` still exits 0 (Compose config untouched)
- [ ] Full gate exits 0

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the prometheus config for the cluster`

---

### T22: Prometheus manifest

**What**: `k8s/prometheus.yaml`: ServiceAccount + Role (`get/list/watch pods` in `fiapx`) + RoleBinding, Deployment (image `prom/prometheus:v3.15.0`, config from the T21 ConfigMap), Service `prometheus` (ClusterIP 9090) + NodePort (30090→9090); required-workload constant updated.
**Where**: `k8s/prometheus.yaml`
**Depends on**: T21
**Reuses**: compose prometheus service
**Requirement**: K8S-25, K8S-26

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Full gate exits 0

**Tests**: none
**Gate**: Full

**Commit**: `feat(platform): add the prometheus deployment`

---

### T23: Grafana manifest

**What**: `k8s/grafana.yaml`: Deployment (image `grafana/grafana:13.2.2`, admin from `fiapx-grafana-admin`, provisioning + dashboard ConfigMaps at the Compose paths, readiness `GET /api/health`), Service `grafana` (ClusterIP 3000) + NodePort (30005→3000); required-workload constant complete.
**Where**: `k8s/grafana.yaml`
**Depends on**: T22
**Reuses**: `grafana/**`
**Requirement**: K8S-27

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Build gate exits 0 (phase end)

**Tests**: none
**Gate**: Build

**Commit**: `feat(platform): add the grafana deployment`

---

### T24: Up command - preflight, cluster, secrets

**What**: `scripts/k8s-up.mjs` part 1: tool preflight (`docker`, `kind`, `kubectl`, Docker daemon); host-port preflight (TCP bind probe) unless the `fiapx` cluster exists with the same map (`fiapx-host` ConfigMap); kind config rendering from the T8 template; `kind create cluster --name fiapx --config <tmp> --wait 120s` or reuse; exists-but-unhealthy → exit with the down hint; namespace + `fiapx-host` ConfigMap; Secrets create-if-absent with alphanumeric random values and the `definitions.json` rewrite; optional `ghcr-pull` from `GHCR_TOKEN`. All kubectl through `kube.mjs`. `--self-test` covers rendering, secret shapes (alphanumeric, lengths, fixtures), definitions rewrite, preflight messages, reuse decision.
**Where**: `scripts/k8s-up.mjs`
**Depends on**: T23
**Reuses**: `scripts/kube.mjs`, `rabbitmq/definitions.json`
**Requirement**: K8S-01, K8S-05, K8S-06, K8S-07, K8S-15

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Self-test covers each preflight failure (missing tool, busy port, different port map, unhealthy cluster) with its message
- [ ] Gate: `node scripts/k8s-up.mjs --self-test` + Full gate exit 0 (the static raw-kubectl rule passes)
- [ ] Test count: ≥ 12 self-test assertions

**Tests**: self-test
**Gate**: Full

**Commit**: `feat(platform): add the kubernetes up command preflight and secrets`

---

### T25: Up command - KEDA, apply, wait

**What**: `scripts/k8s-up.mjs` part 2: download KEDA `v2.21.0` release YAML, verify the pinned sha256, `apply --server-side`, wait for `keda-operator` and `keda-operator-metrics-apiserver`; apply the rendered kustomization; wait (600 s budget) for every Deployment/StatefulSet rollout and `job/storage-init` complete; on timeout print each not-Ready workload with its pod waiting reason and exit 1; on success print endpoints and how to read the Grafana admin secret.
**Where**: `scripts/k8s-up.mjs`
**Depends on**: T24
**Reuses**: T24 helpers
**Requirement**: K8S-01, K8S-02, K8S-03, K8S-19

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Self-test: checksum mismatch exits 1 naming both hashes; a fake `get pods` with `ImagePullBackOff`/`CrashLoopBackOff` produces the named report; timeout path exits 1
- [ ] Gate: Quick + Full exit 0
- [ ] Test count: T24 count + ≥ 5

**Tests**: self-test
**Gate**: Full

**Commit**: `feat(platform): install keda and wait for the topology in the up command`

---

### T26: Down command

**What**: `scripts/k8s-down.mjs`: `kind delete cluster --name fiapx`; exit 0 when absent; never touches kube contexts. `--self-test` asserts the exact command and the absent-cluster path.
**Where**: `scripts/k8s-down.mjs`
**Depends on**: T25
**Reuses**: `scripts/kube.mjs` constants
**Requirement**: K8S-08

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Gate: `node scripts/k8s-down.mjs --self-test` exits 0
- [ ] Test count: ≥ 3

**Tests**: self-test
**Gate**: Quick

**Commit**: `feat(platform): add the kubernetes down command`

---

### T27: Smoke cluster target

**What**: `smoke-local-integration.mjs` moves its four `dockerCompose` call sites behind `observe.psql`/`observe.s3api`; `SMOKE_TARGET=compose` (default, byte-identical commands) | `kind` (`kube.mjs` `exec -i statefulset/postgres -- psql …`; `run smoke-s3-<rand> --rm -i --restart=Never --image=amazon/aws-cli:2.37.4 --overrides=<env from fiapx-storage>` `-- s3api …`); unknown target exits non-zero. Self-test gains cases for both adapters' argument building.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T26
**Reuses**: existing smoke self-test harness; `scripts/kube.mjs`
**Requirement**: K8S-10

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Compose-target argument lists unchanged (self-test compares them)
- [ ] Gate: `node scripts/smoke-local-integration.mjs --self-test` + Full gate exit 0
- [ ] Test count: previous smoke self-test count + ≥ 4

**Tests**: self-test
**Gate**: Full

**Commit**: `feat(platform): let the smoke observe a kind cluster`

---

### T28: Live cluster check

**What**: `check-kubernetes.mjs --live`: every workload Ready, `job/storage-init` complete, `get hpa` lists the KEDA HPA for `worker`, Prometheus targets all `up==1` with one `worker` target per worker pod, Grafana `/api/dashboards/uid/fiapx-overview` 200 (admin from the Secret). `--self-test` feeds canned responses for each failure.
**Where**: `scripts/check-kubernetes.mjs`
**Depends on**: T27
**Reuses**: `check-observability.mjs --live` logic
**Requirement**: K8S-19, K8S-25, K8S-26, K8S-27

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Self-test: missing HPA, a down target, fewer worker targets than pods, dashboard 404 - each exits 1 with its message
- [ ] Build gate exits 0 (phase end)
- [ ] Test count: T20 count + ≥ 4

**Tests**: self-test
**Gate**: Build

**Commit**: `feat(platform): add the live kubernetes check`

---

### T29: Topology job steps

**What**: `.github/workflows/ci.yml` `topology` job: install pinned kubeconform v0.8.0 (sha256-checked), run `node scripts/kube.mjs --self-test`, `node scripts/check-kubernetes.mjs`, `--self-test`, `node scripts/k8s-up.mjs --self-test`, `node scripts/k8s-down.mjs --self-test`, and the kustomize | kubeconform pipeline.
**Where**: `.github/workflows/ci.yml`
**Depends on**: T28
**Reuses**: existing topology steps
**Requirement**: K8S-32

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] `node scripts/check-ci-governance.mjs` exits 0 (topology still unconditioned)
- [ ] Gate: Build gate exits 0

**Tests**: none
**Gate**: Build

**Commit**: `ci(platform): prove the kubernetes manifests in the topology job`

---

### T30: Kubernetes CI job

**What**: New job `kubernetes` (`needs: [topology]`, no `if:`): checkout, setup-node, install pinned kind v0.33.0 (sha256-checked), `node scripts/k8s-up.mjs`, `SMOKE_TARGET=kind node scripts/smoke-local-integration.mjs`, `node scripts/check-kubernetes.mjs --live`; on failure dump `kubectl --context kind-fiapx -n fiapx get pods,events` and pod logs; teardown `node scripts/k8s-down.mjs` under `always()`.
**Where**: `.github/workflows/ci.yml`
**Depends on**: T29
**Reuses**: `integration` job shape (log dumps, teardown)
**Requirement**: K8S-34

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Workflow parses; Build gate exits 0 (governance not yet guarding the job - T31)

**Tests**: none
**Gate**: Build

**Commit**: `ci(platform): run the topology on a kind cluster`

---

### T31: Guard the kubernetes job

**What**: `check-ci-governance.mjs`: the three `kubernetes` job commands join the protected list (one-line steps, no `if:`/`continue-on-error`/`shell:`/`|| true`); the job has no `if:` and `needs` exactly `[topology]`; self-test gains a case per rule.
**Where**: `scripts/check-ci-governance.mjs`
**Depends on**: T30
**Reuses**: `STACK_COMMANDS` guard, the topology guard from S8
**Requirement**: K8S-35

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Self-test: removing each command, masking with `|| true`, `if:` on the job, `needs` changed - each rejected
- [ ] Gate: Build gate exits 0
- [ ] Test count: previous governance self-test count + ≥ 5

**Tests**: self-test
**Gate**: Build

**Commit**: `ci(platform): guard the kubernetes job's commands`

---

### T32: README Kubernetes section

**What**: README section "Local Kubernetes (kind)": prerequisites with minimum versions (Docker, kind 0.33, kubectl 1.36), up/down/smoke/live-check commands, host ports + overrides, exclusivity with Compose, the context-pinning warning, how to read generated admin passwords, the scaling scene (burst command, `kubectl --context kind-fiapx -n fiapx get hpa -w`, expected 1 → N → 1), GHCR images and the merge order.
**Where**: `README.md`
**Depends on**: T31
**Reuses**: README observability/replicas sections
**Requirement**: K8S-36, K8S-37

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] `node scripts/check-docs-links.mjs` exits 0

**Tests**: none
**Gate**: Build

**Commit**: `docs(platform): document the local kubernetes cluster`

---

### T33: Record AD-018

**What**: `.specs/STATE.md` gains AD-018 (cluster conventions: `--context kind-fiapx` only through `scripts/kube.mjs`; multi-arch GHCR images on `main`, cluster runs `:main`; per-cluster generated Secrets, never versioned; Compose stays the dev loop and `integration` gate; merge order services → platform) in the existing AD format; Handoff updated.
**Where**: `.specs/STATE.md`
**Depends on**: T32
**Reuses**: AD-016/AD-017 format
**Requirement**: K8S-04, K8S-13, K8S-28

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Build gate exits 0 (phase end)

**Tests**: none
**Gate**: Build

**Commit**: `docs(specs): record ad-018 for the local kubernetes cluster`

---

### T34: Live verification ("pronto quando")

**What**: After the four service PRs are merged (go-ahead) and `:main` images exist: `node scripts/k8s-up.mjs` from clean (Compose down); record time to Ready; `SMOKE_TARGET=kind` smoke; `check-kubernetes --live`; token from host accepted; presigned download from host; re-run up (idempotent, replicas unchanged while scaled); scaling scene: burst (four concurrent `load-test --videos 50`) with `get hpa -w` evidence 1 → N (≤5) → 1 within 300 s of the queues emptying, all COMPLETED; kill a Worker pod mid-job and see the job complete elsewhere; wrong-context safety (current context left untouched: compare `kubectl config current-context` before/after); `k8s-down`. Evidence recorded here and in spec traceability.
**Where**: `.specs/features/local-kubernetes/tasks.md`
**Depends on**: T33
**Reuses**: `scripts/load-test.mjs`, smoke, `check-kubernetes --live`
**Requirement**: K8S-01..03, K8S-07, K8S-10..12, K8S-19..22, K8S-25..27

**Tools**: Skill: `tlc-spec-driven`; MCP: NONE

**Done when**:

- [ ] Every listed AC has recorded evidence (command + key numbers)
- [ ] The current kube context is identical before and after the run
- [ ] Test count in the feature validation phase

**Tests**: none
**Gate**: Build

**Commit**: `chore(platform): record the live kubernetes verification run`

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
