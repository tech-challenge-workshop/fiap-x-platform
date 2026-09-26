# Replace Object Storage Tasks — platform

**Spec**: `.specs/features/replace-object-storage/spec.md`
**Status**: Approved (user chose "another S3 server" on 2026-09-26)

Executed inline (≤ 8 tasks, one batch), then the independent Verifier.

## Test Coverage Matrix

Same as S4's matrix for this repository: no test runner; the tests are the topology coming up, the bootstrap, the scripts' self-tests and the smoke on the real stack.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Compose topology | integration | Stack starts from pullable images; storage healthy before the bootstrap; Worker waits on it | `compose.yaml` | Build gate |
| Storage bootstrap | integration | Idempotent across a second `up`; fails on a policy and on a foreign lifecycle rule | `storage/bootstrap.sh` | Build gate + negative runs |
| Scripts | integration | Seed and smoke green on the real stack; self-tests unchanged in coverage | `scripts/*.mjs` | Build gate |
| Documentation | none | Links resolve | `README.md`, `.specs/` | docs-links check |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Script or document only | `node --check scripts/<changed>.mjs`, both `--self-test`s |
| Build | After compose/bootstrap/script changes and at the end | `node clean-appledouble.mjs` (workspace root), `docker compose config -q`, `node scripts/check-worker-sizing.mjs`, `node scripts/check-worker-sizing.mjs --self-test`, `docker compose up --build -d --wait`, `node scripts/seed-source-video.mjs`, `node scripts/smoke-local-integration.mjs`, `node scripts/smoke-local-integration.mjs --self-test`, a second `docker compose up -d --wait` without `-v`, `docker compose down -v` |

## Execution Plan

```
T1 -> T2
T2 -> T3
T3 -> T4
T4 -> T6
T5 -> T6
```

T1 to T4 must land together before a Build gate can pass (the stack needs the new service, bootstrap, seed and smoke), so T1–T3 run the Quick gate and T4 runs the Build gate for all four.

## Task Breakdown

### T1: Run RustFS and an aws-cli bootstrap service in the topology

**What**: Replace `minio`/`minio-init` with `storage` (`rustfs/rustfs:1.0.0`, healthcheck on `/health`, volume `storage-data`) and `storage-init` (`amazon/aws-cli:2.37.4`, runs the bootstrap); point the Worker at `http://storage:9000` with the new credentials and make it wait on `storage-init`.
**Where**: `compose.yaml`
**Depends on**: None
**Requirement**: ROS-01

**Done when**:
- [x] No MinIO image, `minio` service or `MC_HOST_*` remains in `compose.yaml`
- [x] `storage` reports healthy before `storage-init` runs; the Worker waits on `service_completed_successfully`
- [x] Quick gate: `docker compose config -q` and the sizing check pass

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete

---

### T2: Rewrite the bootstrap with aws-cli

**What**: Move `minio/bootstrap.sh` to `storage/bootstrap.sh` and rewrite it against the S3 API: create the bucket if `head-bucket` fails; fail on any bucket policy; ensure exactly the two 7-day prefix rules without overwriting any other rule; read the configuration back.
**Where**: `storage/bootstrap.sh` (was `minio/bootstrap.sh`)
**Depends on**: T1
**Requirement**: ROS-02 (P2 AC1–AC3)

**Done when**:
- [x] A second run is a no-op that reports both rules already configured
- [x] A bucket with a public policy makes it exit 1 naming the policy
- [x] A third lifecycle rule makes it exit 1 naming it; a missing one of ours is added
- [x] The read-back uses JMESPath (`length(Rules)`, `Rules[?Expiration.Days==\`7\`]`, the prefixes) — no text counting

**Tests**: integration
**Gate**: quick

**Evidence (2026-09-26)** against `storage` running RustFS 1.0.0: first run creates the bucket and the rules; a re-run reports `retention on sources/ already configured` and the same for `zips/`; a public GetObject policy → exit 1 naming the policy; a third rule on `tmp/` → exit 1 `refusing to overwrite them` (prefixes: tmp/); only `sources/` present, or no configuration at all → both rules written and read back as `sources/ 7`, `zips/ 7`. A first draft compared tab-separated aws-cli output against spaces and silently rewrote the rules on every run; caught by the re-run check above and fixed before this commit.
**Status**: ✅ Complete

---

### T3: Seed through aws-cli

**What**: `scripts/seed-source-video.mjs` uploads the fixture and the non-video with `aws s3 cp` in the `storage-init` image, probes the bucket with `head-bucket`, and names the `storage` service when it is unreachable.
**Where**: `scripts/seed-source-video.mjs`
**Depends on**: T2
**Requirement**: ROS-02 (P2 AC4)

**Done when**:
- [x] stdout is exactly the two keys; two runs leave one object per key
- [x] With `storage` stopped it exits 1 naming the service
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick

**Evidence (2026-09-26)**: two runs each print exactly `sources/sample-8s.mp4` and `sources/not-a-video.mp4`; the bucket then lists one object per key (`sample-8s.mp4` 39863 bytes, `not-a-video.mp4` 66 bytes). With `storage` stopped: exit 1, `object storage (compose service "storage", http://storage:9000) is unreachable`.
**Status**: ✅ Complete

---

### T4: Fetch and list through aws-cli in the smoke

**What**: The smoke fetches the archive with `aws s3 cp s3://… -` and lists the rejected request's prefix with `s3api list-objects-v2`, keeping every assertion, step and self-test case; sample error text in the self-test becomes aws-cli's.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T3
**Requirement**: ROS-02 (P2 AC5)

**Done when**:
- [x] No `mc` or `minio` remains in the smoke
- [x] The self-test still reports 9 required steps and the same numbers of bad and good cases
- [x] Build gate passes, including the second `up`; the anonymous-access negative (a public bucket policy set by hand) makes the smoke exit 1 naming the exposure

**Tests**: integration
**Gate**: build

**Evidence (2026-09-26)**, Build gate on RustFS 1.0.0 (processing-worker at `feat/real-media-processing`): sizing and its self-test green; `up --build -d --wait` healthy; seed printed both keys; smoke: `Storage refused anonymous GET … (403)`, `Catalog reached COMPLETED … with archive zips/<id>/<attempt>/frames.zip`, `holds 8 frames, as 8 s at 1 frame/s requires`, `Catalog reached FAILED (FORMATO_INVALIDO)`, `No archive exists under zips/<id>/`, `Notification delivered once …`, `No downloaded artefact left behind`; self-test `9 required steps present, 28 bad inputs rejected …, 20 good inputs accepted` (unchanged); second `up` → bootstrap `already configured` for both prefixes and the smoke green again. Negative: a public GetObject/ListBucket policy set by hand → smoke exit 1 with `Anonymous access allowed: GET http://localhost:9000/fiapx/sources/sample-8s.mp4 returned 200`. `down -v` afterwards.
**Status**: ✅ Complete

---

### T5: Record the swap and correct the documentation

**What**: Add AD-014 (RustFS + aws-cli replace MinIO; why) to `.specs/STATE.md`; update README and the S4 spec/design text that name MinIO, `mc` or the old services; add a note to S4's `validation.md`-adjacent docs is NOT required (history stays as written).
**Where**: `.specs/STATE.md`, `README.md`, `.specs/features/real-media-processing/spec.md`, `.specs/features/real-media-processing/design.md`
**Depends on**: None
**Requirement**: ROS-01

**Done when**:
- [x] AD-014 records the decision, the evidence (registry probes and the spike) and the trade-off
- [x] README and the S4 living docs describe RustFS/aws-cli; S4's `validation.md` and `tasks.md` evidence stay untouched as history
- [x] Relative links still resolve

**Tests**: none
**Gate**: quick

**Evidence (2026-09-26)**: AD-014 added to `.specs/STATE.md`, and AD-005's status notes the amendment. README's stack table, object-storage section and layout table describe RustFS, `storage/` and `storage-init`. S4's spec credentials row is updated; S4's design keeps its MinIO mechanics as history under a superseding note at the top and in its Tech Decisions row. S4's `validation.md` and `tasks.md` are untouched.
**Status**: ✅ Complete

---

### T6: Prove a fresh machine can start the stack

**What**: Remove every locally cached MinIO image, then run the full Build gate.
**Where**: none (verification)
**Depends on**: T4, T5
**Requirement**: ROS-01

**Done when**:
- [x] `docker image ls` shows no MinIO image before the gate
- [x] The Build gate is green end to end

**Tests**: integration
**Gate**: build

**Evidence (2026-09-26)**: `quay.io/minio/mc` was removed; `quay.io/minio/minio` could not be, because two containers outside this stack still use it (`fortal-minio`, compose project `fortal-backend`, and an unlabeled `t-minio`) and they are not ours to delete. So the first box is met in substance rather than literally: `docker compose config --images` lists 0 MinIO images (`amazon/aws-cli:2.37.4`, `rustfs/rustfs:1.0.0`, `postgres:17-alpine`, `rabbitmq:4-management-alpine` and the four service builds), and both new images were pulled from their public registries during this task. Full Build gate green: sizing + self-test, `up --build -d --wait`, seed, smoke (`holds 8 frames`, `FAILED (FORMATO_INVALIDO)`, `delivered once`, `refused anonymous GET … (403)`, `No downloaded artefact left behind`), smoke self-test (9 / 28 / 20), second `up` with both prefixes `already configured`, `down -v`.
**Status**: ✅ Complete
