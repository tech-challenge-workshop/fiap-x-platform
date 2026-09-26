# Replace Object Storage Specification — platform

## Problem Statement

S4 put MinIO in the topology: `quay.io/minio/minio` for storage and `quay.io/minio/mc` for the bootstrap, the seed and the smoke. On 2026-09-26 both images stopped being pullable anonymously from every public registry (`quay.io/minio/*` answers 401, Docker Hub `minio/minio` 404, Bitnami's mirror gone), verified against a control image from each registry. The stack now comes up only on a machine that still has the images cached, and `processing-worker`'s CI, which starts MinIO for its S3 adapter test, fails at `docker run`.

AD-005 already made the port the S3 protocol, not a vendor, so the fix is to swap the server behind the same protocol and to stop depending on a vendor CLI for the topology's own scripts.

## Goals

- [ ] The local topology starts on a fresh machine from images that are publicly pullable for amd64 and arm64
- [ ] Every S4 storage guarantee still holds and is still asserted: private bucket, 7-day retention on `sources/` and `zips/`, bootstrap before the Worker, seeded fixture, archive proven by the smoke
- [ ] No script in this repository depends on a storage vendor's CLI

## Out of Scope

| Feature | Reason |
| --- | --- |
| Changing the Worker's S3 adapter | It speaks the S3 API with a configurable endpoint (AD-005); only its CI's server changes, in `processing-worker` |
| Fixing V14–V18 | Open items from S4's final verification; unrelated to the server swap |
| Production storage | S9a/S9b |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Replacement server | RustFS `rustfs/rustfs:1.0.0` | Spike on 2026-09-26 with aws-cli: bucket create/head, lifecycle put/get with two 7-day prefix rules read back verbatim, `NoSuchBucketPolicy` on a new bucket, anonymous GET of object and listing 403, a public policy turns both to 200 and deleting it restores 403, head-object size and 404. Multi-arch image; `/health` answers 200 and the image ships `curl`. Garage and SeaweedFS were also available but need more setup (keys/layout) for the same guarantees | y |
| CLI for bootstrap, seed and smoke | `amazon/aws-cli:2.37.4` | The reference S3 client; multi-arch; its checks are protocol-level, so the scripts survive another server swap | y |
| Private-bucket assertion | "no bucket policy" (`get-bucket-policy` → `NoSuchBucketPolicy`) | The protocol-level equivalent of MinIO's anonymous `private`; plus the smoke's outside check (anonymous GET → 403), which is server-agnostic | y |
| Service names | `storage` and `storage-init` (was `minio`, `minio-init`) | Vendor-neutral names keep a future swap from rippling into every script and env var | y |
| Development credentials | `fiapx-dev` / `fiapx-dev-secret` | Same rule as before (AD-005): development values in `environment`, nothing reaches a deployed environment | y |

**Open questions:** none.

---

## User Stories

### P1: The topology starts from pullable images ⭐ MVP

**Acceptance Criteria**:

1. WHEN the topology starts THEN the storage service SHALL run from `rustfs/rustfs:1.0.0` and the bootstrap from `amazon/aws-cli:2.37.4`, and SHALL report healthy before the bootstrap runs.
2. The Worker SHALL receive `STORAGE_ENDPOINT=http://storage:9000` and the development credentials, and SHALL start only after the bootstrap completes successfully.
3. No file in this repository SHALL reference a MinIO image, `mc`, or the `minio` / `minio-init` services.

### P2: The storage guarantees still hold

**Acceptance Criteria**:

1. WHEN the bootstrap runs THEN it SHALL ensure bucket `fiapx` exists, and a second run SHALL succeed without altering it.
2. IF the bucket has any bucket policy THEN the bootstrap SHALL exit non-zero naming it, and the Worker SHALL NOT start.
3. WHEN the bootstrap runs THEN the bucket SHALL end with exactly two lifecycle rules, 7-day expiry on `sources/` and on `zips/`; a missing rule SHALL be added, and any other rule SHALL make the bootstrap exit non-zero rather than be overwritten.
4. WHEN the seed runs THEN it SHALL upload the fixture and the non-video to their keys and print both keys; IF storage is unreachable THEN it SHALL exit non-zero naming the `storage` service.
5. WHEN the smoke runs THEN every S4 assertion SHALL still pass on the real stack, with the archive fetched and the rejected request's prefix listed through aws-cli.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ROS-01 | P1 | Tasks | Pending |
| ROS-02 | P2 | Tasks | Pending |

**Coverage:** 2 total, 2 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] `docker compose up --build -d --wait` succeeds after `docker image rm` of every MinIO image
- [ ] The Build gate is green, including a second `up` and both self-tests
- [ ] `processing-worker`'s CI passes with RustFS as its S3 endpoint
