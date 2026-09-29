# Local Kubernetes (S9a) Validation

**Date**: 2026-09-29
**Spec**: `.specs/features/local-kubernetes/spec.md` (K8S-01..37)
**Diff range**: `fiap-x-platform` `origin/main..HEAD` = 39 commits, `80851aa..f923d82` on `feat/local-kubernetes` (local, unpushed), 30 files, +6283/-24. Round-2 fix commits: `aa132a3` (binary names private to `kube.mjs`, identifier scan), `033f479` (password-in-URL rule), `f923d82` (traceability, STATE, tasks). Service repos, squash-merged to `main` (re-anchored: each commit is on `origin/main`, and its `main` run is `push success` at that sha): `fiap-x-api` `413905d`, `processing-catalog` `f73895b`, `processing-worker` `0878191`, `notification-service` `26e7c58`.
**Verifier**: independent sub-agent (author ≠ verifier), round 2 (final)

**Verdict**: PASS ✅. Both round-1 survivors are killed. M17 is re-run as the original shape: `kube.mjs` re-exports the name and the smoke adapter spawns it. It dies in `kube --self-test` (export list, "no export holds a binary name") and in `check-kubernetes` (identifier scan), default and self-test. M26 dies in `check-kubernetes`. Every realistic variant is also killed: a local literal, a re-export under another name, and a function returning the name. The survivors are deliberate obfuscation of the binary name (`'kube' + 'ctl'`, a split template, the first word of an exported message, `'ki' + 'nd'`), a script in a subdirectory of `scripts/`, a `KUBECONFIG=<kind file> kubectl` shell string (safe in fact), and credentials routed through a ConfigMap or container `args`. None of them is in the committed tree, and each is judged below as an observation, not a gap. They go to "Validar depois".

**Kube context safety (Verifier's own run)**: `kubectl config current-context` = `arn:aws:eks:us-east-1:541036791805:cluster/tech-challenge-eks-cluster` and `shasum ~/.kube/config` = `228cf9a7933d4c7f5d9df58c08c8754853054072`. Both were recorded at the start and again at the end, and they are identical. No cluster was created this round, because the fixes are offline guards and round 1 reproduced the live behavior. Every mutant ran with a PATH shim in front of the real binaries. The `kubectl` shim passed through only calls with `KUBECONFIG=~/.kube/kind-fiapx.config` and `--context kind-fiapx` first. The `kind` shim blocked every call. The shim log shows only the two intended blocks, from M39 and M40, whose mutated `kube.mjs` dropped the pin on a local `kustomize` render. No other unpinned call was attempted.

---

## Round 1 → Round 2

| Round-1 finding | Fix | Round-2 evidence | Status |
| --------------- | --- | ---------------- | ------ |
| Fix 1 (Major): `kube.mjs` exported `KUBECTL_BIN`, and the scan saw only quoted literals, so M17 survived | `aa132a3`: `scripts/kube.mjs:48-49` `KUBECTL`/`KIND` are module-private. New exports `KUBECTL_NOT_FOUND`, `KUSTOMIZE_RENDER_STEP` and `kubectlHint()` (`:97`), which always prefixes `KUBECONFIG=<kind file> kubectl --context kind-fiapx -n fiapx` and refuses redirecting flags. Self-test `:252-258`: no exported string is or ends in `kubectl`/`kind`, and the export list is pinned exactly. `scripts/check-kubernetes.mjs:594` `binaryName = /\bKUBECTL(?:_BIN)?\b/` outside `kube.mjs`, plus the kind twin in `rawKindProblems`. Self-test `:1144-1154`, `:1180-1183` | M17a (re-export + spawn in `kubectlObservation`) killed by kube-self, check-k8s, check-k8s-self. M17b, f, g and h killed. M31, M32, M34 and M35 (the new guard code) killed | ✅ Closed |
| Fix 2 (Minor): literal `amqp://guest:guest@…` passed (M26) | `033f479`: `scripts/check-kubernetes.mjs:97` `URL_WITH_PASSWORD`; `:512-513` message; self-test `:1019` (reject) and `:1001` (URLs without a password accepted) | M26 and M26f (upper-case scheme, `%40`, padded) killed by check-k8s. M26d (rule disabled) and M26e (regex broadened to any userinfo) killed by check-k8s-self | ✅ Closed |
| Traceability drift (open item 2) | `f923d82`: spec K8S-28..30 Verified with run ids; STATE Handoff updated | `spec.md` traceability rows and `STATE.md` Handoff read at HEAD | ✅ Closed (see Validar depois 7 for a leftover) |
| Refactor safety | `k8s-up.mjs` fakes now record calls under the label `kubectl()` (`KUBE_CALL`), not the binary name; `check-ci-governance.mjs:66,118` compares `KUSTOMIZE_RENDER_STEP` against `ci.yml:92` | The smoke kind adapter still routes through `kubectl()`: `scripts/smoke-local-integration.mjs:212-213` `const result = kubectl(args, { input })`, and self-test `:2217` asserts `kubectlArgs(args)` gains `--context kind-fiapx`. M40 kills smoke-self. `realDeps` still asserted to use the helpers (`scripts/k8s-up.mjs:781`). M37 (render step drifts from `ci.yml`) killed by gov. No other guard weakened: every round-1 rule and self-test is still present, and the counts only grew (check-kubernetes 57→65 corruptions, 15→20 good) | ✅ |

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1-T4 | ✅ Done | Merged to each service's `main`. The `main` runs 36588607051 / 36588618700 / 36588632985 / 36588648906 are `push success` at 413905d / f73895b / 0878191 / 26e7c58 (re-checked with `gh run view`). |
| T5-T34 | ✅ Done | One Conventional Commit each; T34 is live-recorded and was reproduced by the round-1 Verifier. |
| Post-verification Fix 1, Fix 2, Docs | ✅ Done | `aa132a3`, `033f479`, `f923d82` (`tasks.md` "Post-verification fixes"). |

---

## Spec-Anchored Acceptance Criteria

Line numbers are at HEAD `f923d82`. "Live (R1)" means the round-1 Verifier's own live run on 2026-09-29, with `CATALOG_HOST_PORT=33001 STORAGE_HOST_PORT=39000`, and T34. The fixes changed no manifest and no runtime call path. The one runtime-path file, `kube.mjs`, keeps `kubectlArgs`, `kubectl` and `kind` byte-identical in behavior (kube self-test: same 7 spawned, 13 refused, 4 kind built, 5 kind refused), so the live evidence carries over.

| Criterion | Spec-defined outcome | `file:line` + assertion / evidence | Result |
| --------- | -------------------- | ---------------------------------- | ------ |
| K8S-01 up creates or reuses `fiapx`, applies to ns `fiapx` | cluster `fiapx`; topology in `fiapx` | `scripts/k8s-up.mjs:747` `expect('re-run: decision', second.decision, 'reuse')`, fresh path `decision 'create'`. `scripts/kube.mjs:116` create/delete always get `--name fiapx --kubeconfig <kind file>`. Live (R1): create then reuse | ✅ PASS |
| K8S-02 exit 0 ⇒ every Deployment/StatefulSet Ready, Job Complete | all Ready; `storage-init` Complete | `scripts/k8s-up.mjs:851` wait cases. `scripts/check-kubernetes.mjs:580` required-workload rule. Live (R1): exit 0, 9 Deployments + 2 StatefulSets 1/1, Job Complete | ✅ PASS |
| K8S-03 not Ready in 600 s ⇒ non-zero naming each | 600 s; exit ≠ 0; names | `scripts/k8s-up.mjs:78` `WAIT_BUDGET_MS = 600000`; `:851` `wait: timeout names each workload and its reason` (exact list). R1 M20 killed | ✅ PASS (self-test) |
| K8S-04 `--context kind-fiapx` on every kubectl; current context never read or changed | every call pinned; kubeconfig untouched | `scripts/kube.mjs:80` `return ['--context', KUBE_CONTEXT, ...args]`, `:88` `KUBECONFIG: KUBECONFIG_PATH`, `:252-258` no export is a spawnable name and the export list is exact. `scripts/check-kubernetes.mjs:592-594` literal, command-line and identifier scans, `:1196` committed scripts pass. Sensor: M17a/b/f/g/h, M31, M32, M34, M35, M39 and M40 killed. Obfuscated aliases survive (observation O1). Verifier: context and sha identical start/end | ✅ PASS |
| K8S-05 missing tool ⇒ non-zero naming it, nothing created | exit ≠ 0; each named | `scripts/k8s-up.mjs:656-660` exact `preflight failed, nothing was created: …` messages, now using `KUBECTL_NOT_FOUND`. Live (R1) | ✅ PASS |
| K8S-06 busy host port ⇒ non-zero naming it, before create | exit ≠ 0; port named | `scripts/k8s-up.mjs` busy-port cases (up-self 99 assertions). R1 M21 killed; live (R1) | ✅ PASS |
| K8S-07 re-run ⇒ exit 0, same replicas | idempotent | `scripts/k8s-up.mjs:747-750` `decision 'reuse'`, `re-run: Secrets unchanged`. `k8s/worker.yaml` has no `spec.replicas` (rule `scripts/check-kubernetes.mjs:535`). Live (R1) | ✅ PASS |
| K8S-08 down deletes only `fiapx` | only `kind delete cluster --name fiapx` | `scripts/k8s-down.mjs` self-test (9 assertions); `scripts/kube.mjs:116`. Live (R1) | ✅ PASS |
| K8S-09 readiness `/health`, liveness `/health/live` on the port | per service | `scripts/check-kubernetes.mjs:522` rule; self-test `:1023-1025`. R1 M23 killed | ✅ PASS |
| K8S-10 smoke with the cluster target passes via `kubectl --context kind-fiapx exec/run` | exit 0 | `scripts/smoke-local-integration.mjs:212-213` `kubectl(args, { input })` through `kube.mjs`; `:2217` kind lines gain `--context kind-fiapx`. Live (R1) smoke exit 0 | ✅ PASS |
| K8S-11 host token accepted | 200 with token | `k8s/api.yaml` `OIDC_ISSUER: http://localhost:8080/realms/fiapx`. Live (R1): 200/401 | ✅ PASS |
| K8S-12 presigned URLs usable on `localhost:9000` | host `localhost:9000` | `scripts/k8s-up.mjs:713` `STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000'`. Live on the documented 39000 override | ✅ PASS (flag 1) |
| K8S-13 credentials only via `secretKeyRef`/`secretRef` | no literal credential | `scripts/check-kubernetes.mjs:510-513` name rule plus password-in-URL rule; self-test `:1019`. The committed render has no userinfo URL anywhere, no `envFrom`/`args`, and 0 Secrets (Verifier grep). M26 and M26f killed. ConfigMap/`args` routes unguarded (O3) | ✅ PASS |
| K8S-14 no versioned Secret with data | 0 | `scripts/check-kubernetes.mjs:503`; self-test `:1006-1008`; render has 0 Secret objects | ✅ PASS |
| K8S-15 Secrets generated per cluster | random; fixtures excepted | `scripts/k8s-up.mjs:738` `two clusters get different generated values`, `:750` unchanged on re-run. R1 M13/M14 killed | ✅ PASS |
| K8S-16 literal `*PASSWORD*`/`*SECRET*`/`*ACCESS_KEY*`/`*TOKEN*` ⇒ exit ≠ 0 naming manifest + variable | exit ≠ 0; object + variable | `scripts/check-kubernetes.mjs:95` regex, `:510-511` ``${where}: container … sets ${env.name} as a literal value``; self-test cases incl. init container and Job. R1 M06 killed | ✅ PASS |
| K8S-17 Secret with data ⇒ exit ≠ 0 naming it | exit ≠ 0 | `scripts/check-kubernetes.mjs:503`, `:1006` | ✅ PASS |
| K8S-18 ScaledObject 1..5, `processing` 2, `video-validation` 20 | exact | `k8s/worker-scaling.yaml:38-39,49,52,57,60`; rule `scripts/check-kubernetes.mjs:554-568`. R1 M10/11/12/27/28 killed | ✅ PASS |
| K8S-19 `get hpa` lists the Worker HPA | `keda-hpa-worker` | `scripts/check-kubernetes.mjs:670-674` live rule + self-test; live (R1) | ✅ PASS |
| K8S-20 scale out, max 5 | >1, ≤5 | Live (R1): 1 → 5, never above 5; T34 | ✅ PASS (live) |
| K8S-21 back to 1 within 300 s | ≤300 s | `k8s/worker-scaling.yaml:45` 60 s; live (R1) and T34: ~52-63 s | ✅ PASS (live) |
| K8S-22 in-flight job at scale-in ⇒ COMPLETED | not FAILED | T34 live: `redeliver 0 → 1`, COMPLETED (Worker ignores SIGTERM, V70) | ✅ PASS (live-recorded) |
| K8S-23 CPU request = limit = `FFMPEG_THREADS`; check fails otherwise | equal; exit ≠ 0 | `k8s/worker.yaml:79-80` and resources; rule `scripts/check-kubernetes.mjs:547`. R1 M09 killed | ✅ PASS |
| K8S-24 TriggerAuthentication from a Secret; no credentials in the ScaledObject | `authenticationRef`; no host | `scripts/check-kubernetes.mjs:568`; R1 M27 killed | ✅ PASS |
| K8S-25 every Worker pod scraped | one target per pod | `prometheus/prometheus.k8s.yml` pod SD; live rule + self-test (11 live cases); live (R1) | ✅ PASS |
| K8S-26 other targets `up == 1` | all up | live rule `LIVE_JOBS`; live (R1) `--live` exit 0 | ✅ PASS |
| K8S-27 Grafana serves `fiapx-overview` from the same JSON | provisioned | `k8s/kustomization.yaml:69-71`; `scripts/check-kubernetes.mjs:714-718` requires `meta.provisioned === true` | ✅ PASS |
| K8S-28 main ⇒ push `:<sha>` and `:main` after `quality` | both tags | Each service `ci.yml` at the merge sha: `needs: quality`, `push: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}`, tags `:${{ github.sha }}` and `:main` (e.g. `fiap-x-api` `ci.yml:60,82,84-85`). The `main` runs are `push success` (re-checked) | ✅ PASS |
| K8S-29 PR ⇒ build, no push | no push | same `push:` expression; R1 PR runs `Log in to GHCR: skipped`, `push: false` | ✅ PASS |
| K8S-30 `GITHUB_TOKEN` + `packages: write` | exactly | `fiap-x-api` `ci.yml:65` `packages: write`, `:76` `secrets.GITHUB_TOKEN`; same in the other three | ✅ PASS |
| K8S-31 manifests reference `ghcr.io/tech-challenge-workshop/` | never local | `k8s/kustomization.yaml:33-45`; rule `scripts/check-kubernetes.mjs:529`, self-test `:1032` | ✅ PASS |
| K8S-32 `topology` renders, validates, runs the offline check | three steps | `.github/workflows/ci.yml:79-94`; governance `scripts/check-ci-governance.mjs:118-120` (`KUSTOMIZE_RENDER_STEP` compared). The Verifier ran every step: exit 0, `Valid: 45` | ✅ PASS (first CI run pending the push) |
| K8S-33 `--self-test` rejects one corruption per rule | exit ≠ 0 per rule | `check-kubernetes --self-test`: 65 corruptions with exact messages, 20 good, spawned corrupted renders exit ≠ 0 | ✅ PASS |
| K8S-34 PR ⇒ `kubernetes` job: kind, up, smoke | job green | `.github/workflows/ci.yml:173-223`, guarded by governance. No run yet: branch unpushed | ⏳ Wiring PASS; first green run pending (open item) |
| K8S-35 `if:`/`continue-on-error`/`\|\| true` ⇒ governance exit ≠ 0 | exit ≠ 0 | `scripts/check-ci-governance.mjs:130` `KUBERNETES_COMMANDS`, `:327` etc.; self-test 56 bad workflows. R1 M18/M19 killed | ✅ PASS |
| K8S-36 README commands, tool versions, ports, exclusivity | all | `README.md:327` (kind 0.33, kubectl 1.36), `:344` ports + "cannot run at the same time" | ✅ PASS (flag 3) |
| K8S-37 README scaling scene | burst, `get hpa -w`, 1 → N → 1 | `README.md:357-364` (`:360` `get hpa -w` through the kind kubeconfig) | ✅ PASS |

**Status**: 36/37 ACs match the spec outcome with evidence. K8S-34 waits on its first CI run (merge order, a known open item). There are 3 spec-precision flags, all non-blocking.

**Payload/conjunction rule**: the self-tests compare whole values with `JSON.stringify`, including exact messages, the exact argument lists, the exact export list and exact Secret objects. The new cases follow suit: `scripts/check-kubernetes.mjs:1144-1149` expect the exact `scripts/<file>:<line>: spawns kubectl directly …` message.

**Spec-precision flags**

1. **K8S-12** names `localhost:9000`. The default is proven offline (`scripts/k8s-up.mjs:713`), and the port was proven live on the documented `STORAGE_HOST_PORT=39000` override, because a foreign process holds 9000 on this machine. Judged as met.
2. **K8S-13 vs K8S-16**: by the spec's own definition, K8S-16's offline rule is about literal env values. The added password-in-URL rule closes the round-1 case. A credential in a generated ConfigMap consumed through `envFrom`, or in container `args`, is still outside every rule (M26b, M26c). The committed render has none. Observation O3.
3. **K8S-36** gives no minimum version for Docker. Cosmetic.

---

## Discrimination Sensor

**Isolation.** Each mutant ran in its own `git worktree add --detach /private/tmp/s9a-v2-<id> HEAD`. It was mutated by an exact-anchor script that aborts unless each anchor occurs exactly once (no aborts), and run through the full offline gate below with the kubectl/kind safety shim first on `PATH`. The worktree was then removed with `git worktree remove --force` and pruned. The real tree's `git status --porcelain` baseline (` M .specs/LESSONS.md`, ` M .specs/lessons.json`, `?? …/validation.md`) was equal after every one of the 24 mutants. `git worktree list` shows only the real tree, and no `/private/tmp/s9a-v2-*` remains.

**Killers.** A mutant is killed when any gate step exits non-zero. `generate-db-script --check` is excluded from attribution in worktrees, because it needs the sibling service checkouts and fails environmentally under `/private/tmp`. It is 0 on the real tree.

| Mutation | File | Description | Killed by |
| -------- | ---- | ----------- | --------- |
| **M17a** (round-1 M17) | `scripts/kube.mjs:49` + `scripts/smoke-local-integration.mjs:8,213` | `kube.mjs` re-exports `KUBECTL_BIN = KUBECTL`; the smoke adapter does `spawnSync(KUBECTL_BIN, args, …)` | ✅ kube-self, check-k8s, check-k8s-self |
| M17b | `scripts/smoke-local-integration.mjs:213` | local `const bin = 'kubectl'; spawnSync(bin, …)` | ✅ check-k8s, check-k8s-self |
| M17c | `scripts/smoke-local-integration.mjs:213` | alias `const k = 'kube' + 'ctl'; spawnSync(k, …)` | ❌ survived → O1 (deliberate obfuscation) |
| M17d | `scripts/smoke-local-integration.mjs:213` | `` spawnSync('sh', ['-c', `kube${'ctl'} …`]) `` | ❌ survived → O1 |
| M17e | `scripts/smoke-local-integration.mjs:8,213` | `spawnSync(KUSTOMIZE_RENDER_STEP.split(' ')[0], …)` (first word of an exported string) | ❌ survived → O1 |
| M17f | `scripts/k8s-down.mjs:15` | `execFileSync('kubectl', ['get', 'nodes'])` | ✅ check-k8s, check-k8s-self |
| M17g | `scripts/kube.mjs` + smoke | re-export under another name (`export const CLIENT = KUBECTL`) and spawn it | ✅ kube-self (exports list + "exports holding a binary name") |
| M17h | `scripts/kube.mjs` + smoke | `export function binary() { return KUBECTL; }`, `spawnSync(binary(), …)` | ✅ kube-self (exports list) |
| M17i | `scripts/k8s-down.mjs` | `spawnSync('ki' + 'nd', ['delete', 'clusters', '--all'])` | ❌ survived → O1 |
| M17j | new `scripts/lib/raw.mjs` | `spawnSync('kubectl', ['get', 'pods', '-A'])` in a subdirectory | ❌ survived → O2 (scan reads `scripts/*.mjs` only, `scripts/check-kubernetes.mjs:740-745`) |
| M17k | `scripts/k8s-down.mjs` | `` execSync(`KUBECONFIG=${KUBECONFIG_PATH} kubectl get nodes`) `` (kind kubeconfig, no `--context`) | ❌ survived → O4 (safe in fact) |
| **M26** (round-1) | `k8s/worker.yaml:80` | literal `BROKER_URL: amqp://guest:guest@rabbitmq:5672` | ✅ check-k8s (`sets BROKER_URL to a literal URL with a password in it`) |
| M26b | `k8s/kustomization.yaml:49` + `k8s/worker.yaml` | same URL in a generated ConfigMap, consumed by `envFrom: configMapRef` | ❌ survived → O3 |
| M26c | `k8s/worker.yaml` | same URL in container `args` | ❌ survived → O3 |
| M26d | `scripts/check-kubernetes.mjs:512` | password-in-URL branch disabled | ✅ check-k8s-self |
| M26e | `scripts/check-kubernetes.mjs:97` | regex broadened to any userinfo (flags `smtp://fiapx@…`) | ✅ check-k8s-self |
| M26f | `k8s/worker.yaml:80` | `"  AMQP://guest:gu%40st@rabbitmq:5672/vhost  "` (upper-case scheme, encoded, padded) | ✅ check-k8s |
| M31 | `scripts/kube.mjs:101` | `kubectlHint` drops the `KUBECONFIG=` prefix | ✅ kube-self, up-self |
| M32 | `scripts/kube.mjs:100` | `kubectlHint` no longer refuses `--context`/`--kubeconfig` | ✅ kube-self |
| M34 | `scripts/check-kubernetes.mjs:594` | identifier scan loses `(?:_BIN)?` | ✅ check-k8s-self |
| M35 | `scripts/check-kubernetes.mjs` `rawKindProblems` | `KIND`/`KIND_BIN` identifier shape removed | ✅ check-k8s-self |
| M37 | `scripts/kube.mjs` `KUSTOMIZE_RENDER_STEP` | drops `--load-restrictor` (drifts from `ci.yml:92`) | ✅ gov |
| M39 | `scripts/kube.mjs:88` | isolated `KUBECONFIG` dropped (round-1 M02 re-run after the refactor) | ✅ kube-self, check-k8s |
| M40 | `scripts/kube.mjs:80` | `--context` no longer prepended (round-1 M01 re-run) | ✅ smoke-self, kube-self, check-k8s |

**Sensor depth**: expanded (safety-critical K8S-04). 24 mutations: M17 and 10 variants, M26 and 5 variants, and 8 against the new guard code and the refactor.
**Result**: 16/24 killed - PASS ✅. 8 survived, and every survivor is judged an observation, not a gap. **Every realistic regression is killed**: a spawn through any binary-name identifier or re-export, a literal, a command-line string without the context, a helper function returning the name, a dropped pin, and a credential URL in an env value.

**Judgment of survivors**

- **O1 (M17c, M17d, M17e, M17i): deliberate obfuscation.** Each needs someone to build the name on purpose (`'kube' + 'ctl'`, a split template, the first word of `KUSTOMIZE_RENDER_STEP`/`KUBECTL_NOT_FOUND`). A textual scan cannot be complete against intent. It is a tripwire for accidental raw spawns, which round 1's hole was: a constant exported for messages that happened to be spawnable. The behavioral guarantee is that every committed call site goes through `kubectl()`/`kind()`. `kube --self-test` proves those pin `--context`/`KUBECONFIG`, `smoke --self-test` proves it for the adapter, and `k8s-up --self-test:781` proves it for `realDeps`. Not a regression path an honest change takes. Spec-precision observation: `README.md:338` and the `kube.mjs` header say the check "fails when any other script spawns kubectl or kind directly". That is true of accidental forms, not of obfuscated ones.
- **O2 (M17j): subdirectories of `scripts/` are not scanned.** `scriptSources` reads `scripts/*.mjs` only. The repository has no subdirectory there today. A future `scripts/lib/` would be a realistic place for a new helper, so the scan should recurse. Minor, for "Validar depois".
- **O3 (M26b, M26c): credential in a ConfigMap or `args`.** This is outside K8S-16's rule as the spec defines it (literal env values). K8S-13 holds today (Verifier grep of the render: no userinfo URL, no `envFrom`, no `args`, 0 Secrets). Minor.
- **O4 (M17k): `KUBECONFIG=<kind file> kubectl …` without `--context`.** This breaks K8S-04's literal wording ("pass `--context kind-fiapx` on every invocation"). It is safe in fact, because that kubeconfig holds only `kind-fiapx`. The command-line regex anchors on a quote directly before `kubectl`. Minor.

---

## Interactive UAT Results

Not applicable (infrastructure, no UI).

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ The fixes touch only `kube.mjs`, `check-kubernetes.mjs`, `k8s-up.mjs`, `check-ci-governance.mjs` and specs. |
| No abstractions for single-use code | ✅ `kubectlHint` replaces three hand-built hint strings (`k8s-up.mjs` pending report, endpoint hints, `get hpa -w`). |
| Surgical changes | ✅ `k8s-up` fakes only relabel the recorded tool (`KUBE_CALL`); assertions unchanged in meaning. |
| Matches existing patterns/style | ✅ Exact-message self-test cases with near-misses (`KUBECTL_NOT_FOUND`, `KIND_CLUSTER`, `kubectlHint`); the scan builds its own identifiers at run time so it does not trip itself. |
| Spec-anchored outcome check | ✅ 36/37; K8S-34 pending CI |
| Per-layer Coverage Expectation | ✅ Every new branch has a self-test case, and each of those was proven discriminating by M31-M35. |
| Every test maps to a spec requirement | ✅ New cases are labelled K8S-04 / K8S-13. |
| Documented guidelines followed | ✅ `tasks.md` Gate Check Commands; `ci.yml` topology steps re-run green |

---

## Edge Cases

- [x] Current context is EKS: scripts act only on `kind-fiapx`. The Verifier's context and sha were identical, and the shim logged no unpinned call outside the two mutants built to drop the pin.
- [x] `fiapx` exists but is unhealthy: refused with the `k8s-down` hint (up self-test).
- [x] GHCR unreachable / tag missing: the wait names the pod with `ImagePullBackOff (image)` (`scripts/k8s-up.mjs:851`).
- [x] Bootstrap Job fails: exit 1 naming `Job storage-init failed` (up self-test).
- [x] Worker at 5 with growing queues stays at 5: live (R1).
- [ ] Wrong KEDA credentials: not exercised (KEDA's behavior). Open item.

---

## Gate Check

Run by the Verifier on HEAD `f923d82`, in the real tree, with `COMPOSE_FILE` and the port variables unset. **28/28 commands exit 0.**

| Command | Exit | Output |
| ------- | ---- | ------ |
| `docker compose config > rendered-compose.yml` (scratch) | 0 | |
| build-or-image assertion | 0 | 12 services |
| `check-worker-sizing` / `--self-test` | 0 / 0 | |
| `check-no-storage-writes` / `--self-test` | 0 / 0 | |
| `node --check scripts/smoke-local-integration.mjs` | 0 | |
| `smoke-local-integration --self-test` | 0 | 32 steps, 189 bad / 63 good, 9 adapter cases |
| `check-storage-bootstrap --self-test` | 0 | |
| `check-identity --self-test` | 0 | |
| `generate-db-script --self-test` | 0 | |
| `check-ci-governance` | 0 | "… kubernetes runs after topology alone and runs its 3 cluster commands unconditionally" |
| `check-ci-governance --self-test` | 0 | 56 bad / 3 good workflows; 12 bad rulesets |
| `check-docs-links --self-test` | 0 | |
| `apply-required-checks --self-test` | 0 | |
| `check-observability` / `--self-test` | 0 / 0 | 40 corruptions |
| `load-test --self-test` | 0 | |
| `kube --self-test` | 0 | 7 spawned, 13 refused, 4 kind built, 5 refused; hints pinned, 3 refused; no export holds a binary name |
| `check-kubernetes` | 0 | 45 rendered objects; only `kube.mjs` spawns kubectl or kind |
| `check-kubernetes --self-test` | 0 | 65 corruptions, 20 good, 7 parser readings, 11 live cases |
| `k8s-up --self-test` | 0 | 99 assertions |
| `k8s-down --self-test` | 0 | 9 assertions |
| `KUBECONFIG=~/.kube/kind-fiapx.config kubectl --context kind-fiapx kustomize --load-restrictor LoadRestrictionsNone k8s > rendered-k8s.yaml` | 0 | |
| `kubeconform -strict -summary …` (local v0.7.0; CI pins v0.8.0) | 0 | Valid: 45, Invalid: 0 |
| `check-docs-links` | 0 | 0 unresolved |
| `generate-db-script --check` | 0 | |
| `docker compose -f compose.yaml config -q` | 0 | |

- **Test count before round 2**: check-kubernetes 57 corruptions / 15 good; kube self-test without hint or export cases.
- **Test count after round 2**: check-kubernetes 65 / 20 (+8 / +5), kube self-test + 1 hint, 3 refused hints and 2 export assertions. k8s-up stays at 99, with no assertion removed: the same assertions are relabelled. Nothing weakened.
- **Skipped**: none. **Failures**: none.

---

## Fix Plans

None blocking. The round-1 fixes are verified above.

### Validar depois (open items, not blocking)

1. **K8S-34**: the first green `kubernetes` run on the platform PR needs the push (AD-018 merge order). The GHCR packages stay private until delivery and are pulled through `ghcr-pull` from `GITHUB_TOKEN` (V69).
2. **O2**: make `check-kubernetes`'s script scan recurse under `scripts/` (M17j), or state that scripts live flat in `scripts/`.
3. **O3**: extend the credential rule to generated ConfigMap data consumed by `envFrom`/`configMapKeyRef` and to container `args`/`command` (M26b, M26c), or scope K8S-13's guard explicitly to env values in the spec.
4. **O4**: have the command-line pattern also catch `kubectl` preceded by `KUBECONFIG=…` without `--context kind-fiapx` (M17k), for literal K8S-04 wording. Safe in fact today.
5. **O1 wording**: soften `README.md:338` and the `kube.mjs`/`check-kubernetes.mjs` headers to "fails on a raw kubectl or kind spawn (literal, command line or the binary-name identifiers)". The scan is a tripwire against accidents, not a proof against obfuscation (M17c/d/e/i).
6. Worker ignores SIGTERM (V70; K8S-22 holds through redelivery, T34). QEMU hang risk on the multi-arch build (V68). KEDA wrong-credentials edge case not exercised. Local kubeconform v0.7.0 vs CI v0.8.0 (both Valid 45). K8S-12 proven live only on the 39000 override.
7. **STATE drift**: `.specs/STATE.md` Handoff says "Uncommitted files: none". `.specs/LESSONS.md`, `.specs/lessons.json` and this `validation.md` are uncommitted, and the Handoff "Next step" still reads "Re-run the Verifier". Update both when this report is committed.

---

## Requirement Traceability Update

| Requirement | Previous Status (spec.md) | New Status |
| ----------- | ------------------------- | ---------- |
| K8S-01, 02, 05-12, 14, 15, 19-22, 25-30 | Verified | ✅ Verified |
| K8S-03 | Implemented | ✅ Verified (self-test; R1 M20 killed) |
| K8S-04 | Verified (cites aa132a3) | ✅ Verified (M17a/b/f/g/h killed; O1, O2, O4 observations) |
| K8S-13 | Implemented (cites 033f479) | ✅ Verified (M26/M26f killed; O3 observation) |
| K8S-16, 17, 18, 23, 24, 31, 33, 35 | Implemented | ✅ Verified (self-tests + sensor kills) |
| K8S-32 | Implemented | ✅ Verified locally; ⏳ first CI run |
| K8S-34 | In progress | ⏳ Wiring verified; first green PR run pending |
| K8S-36, 37 | Implemented | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready (offline and live, locally). K8S-34's first CI run follows the push.

**Spec-anchored check**: 36/37 ACs match the spec outcome, and K8S-34 is pending its first CI run. 3 non-blocking spec-precision flags.
**Sensor**: 16/24 killed. Both round-1 survivors (M17, M26) and every realistic variant are killed. The 8 survivors are obfuscation, scan-scope or out-of-rule observations, and none is in the committed tree.
**Gate**: 28/28 offline commands exit 0.

**What works**: every kubectl and kind call goes through `kube.mjs`, pinned to `kind-fiapx` in its own kubeconfig. No export hands out a spawnable binary name, and the export list is pinned. The scan catches the binary-name identifiers, literals and context-less command lines. Credentials embedded in URL values are rejected. Everything round 1 proved live still holds: 11 workloads Ready, smoke, KEDA 1 → 5 → 1, Prometheus per replica, Grafana dashboard, and multi-arch GHCR images from each service's `main`.

**Next steps**: commit this report and the lessons, then push `feat/local-kubernetes` with the go-ahead and record the first `kubernetes` run (K8S-34). Items 2-5 above are optional hardening.
