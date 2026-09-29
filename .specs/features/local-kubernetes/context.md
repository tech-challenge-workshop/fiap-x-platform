# Local Kubernetes (S9a) Context

**Gathered:** 2026-09-29
**Spec:** `.specs/features/local-kubernetes/spec.md`
**Status:** Ready for design

---

## Feature Boundary

The whole Compose topology runs on a local kind cluster from versioned manifests in `fiap-x-platform`, the Worker autoscales on RabbitMQ queue depth through KEDA (1 → 5 → 1), credentials reach pods only through Secrets generated at provisioning, the four services publish their images to GHCR from CI, and the platform CI proves the manifests offline and on a real kind cluster.

---

## Implementation Decisions

### Cluster tool

- kind, one cluster named `fiapx`, kube context `kind-fiapx`.
- Every `kubectl` call from the platform's scripts names `--context kind-fiapx`; the current context is never read or switched. Reason found in the scan: this machine's current context is a real EKS cluster (`tech-challenge-eks-cluster`) from another project.

### Image delivery (CD)

- Each service's CI `image` job pushes `ghcr.io/tech-challenge-workshop/<repo>:<sha>` and `:main` on `main`; pull requests build only.
- The cluster pulls those images. No local build + `kind load` mode in this slice; Compose stays the inner dev loop.

### Platform CI

- `topology`: render with `kubectl kustomize`, schema validation, offline manifest check with `--self-test`.
- New `kubernetes` job: kind cluster on the runner, the up command, the smoke with the cluster target. Guarded by `check-ci-governance` like `integration`.

### Worker scaling floor

- Minimum 1 replica (no scale to zero); maximum 5.

### Agent's Discretion

- Namespace layout, host-port mapping, KEDA thresholds, Worker sizing, secret generation, storage classes, and the manifest file layout (see the spec's Assumptions table; all `n` rows are agent defaults open to override at design review).

### Declined / Undiscussed Gray Areas → Assumptions

- Coexistence with Compose (exclusive, same host ports), GHCR package visibility (public, uncertain), required-check promotion (after first green run, with go-ahead), merge order (services first). All recorded in the spec's Assumptions table.

---

## Specific References

- "Pronto quando" from the gap analysis: `kubectl get hpa` shows the Worker's replicas rising under load and returning to the minimum afterwards - the scene that proves scalability in the video.

---

## Deferred Ideas

- Local build + `kind load` dev mode for unmerged service changes.
- Scale to zero.
- Per-message consumer log lines (V66), so the correlation trace shows in cluster logs too.
