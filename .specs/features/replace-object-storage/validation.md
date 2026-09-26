# Validation: replace-object-storage - FAIL

**Date**: 2026-09-26 (container clock; host date 2026-09-25 -03:00)
**Spec**: `.specs/features/replace-object-storage/spec.md` (ROS-01, ROS-02)
**Diff range**: `main` (`4a810fd`) `..7db819b` on `fix/replace-object-storage`, fiap-x-platform. Companion: processing-worker `feat/real-media-processing@d7e9e26`
**Verifier**: independent sub-agent (author != verifier). Read-only on every repository; mutations only in `git archive` scratch copies.
**Pinned siblings (checked before and after)**: processing-worker `feat/real-media-processing@d7e9e26`, processing-catalog `main@696029d`, notification-service `main@256f1a0`, fiap-x-api `main@cb1dbab`. All clean.

**Result**: FAIL - two real gaps in ROS-02 P2 AC3 (lifecycle), one shown on the live stack and one shown by a surviving mutant. All other ACs, the gate, the required negatives and the worker companion are green.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 compose | Done | Evidence confirmed (`compose.yaml:153,176,163-169,188-190,62-70`) |
| T2 bootstrap | Partial | The recorded negatives reproduce. But foreign rules without a top-level `Filter.Prefix` are silently overwritten, and a Disabled rule passes the read-back (Gaps 1 and 2) |
| T3 seed | Done | Reproduced: exactly two keys, one object per key, and stopped storage gives exit 1 naming the service |
| T4 smoke | Done | Reproduced, including the anonymous-access negative |
| T5 docs | Done | AD-014 is present. Minor drift in processing-worker docs (see notes) |
| T6 fresh machine | Done in substance | `docker compose config --images` lists no MinIO image. `quay.io/minio/minio` is still cached because `fortal-minio`/`t-minio` use it (not ours). Both new images resolve anonymously for linux/amd64 and linux/arm64 (`docker buildx imagetools inspect`) |

---

## Spec-Anchored Acceptance Criteria

### ROS-01 (P1)

| Criterion | Spec-defined outcome | Enforcing `file:line` + observed evidence | Verdict |
| --- | --- | --- | --- |
| AC1: storage from `rustfs/rustfs:1.0.0`, bootstrap from `amazon/aws-cli:2.37.4`, storage healthy before the bootstrap | exact images; health precedes the bootstrap | `compose.yaml:153` `image: rustfs/rustfs:1.0.0`; `compose.yaml:176` `image: amazon/aws-cli:2.37.4`; `compose.yaml:163-169` HTTP probe `curl -fsS http://localhost:9000/health`; `compose.yaml:188-190` `storage: condition: service_healthy`. Live: first healthy probe 02:10:51.57Z, storage-init started 02:10:52.10Z. M6a (healthcheck removed) killed by `up` exit 1 | ✅ PASS (⚠️ spec-precision: M6b `CMD true` is equivalent, see notes) |
| AC2: Worker gets `STORAGE_ENDPOINT=http://storage:9000` and the dev credentials, and starts only after the bootstrap succeeds | exact env values; `service_completed_successfully` | `compose.yaml:62-65` (`STORAGE_ENDPOINT=http://storage:9000`, `STORAGE_BUCKET=fiapx`, `STORAGE_ACCESS_KEY=fiapx-dev`, `STORAGE_SECRET_KEY=fiapx-dev-secret`); `compose.yaml:69-70` `storage-init: condition: service_completed_successfully`. Rendered config agrees. Live: storage-init finished 02:10:54.35Z, worker started 02:10:54.69Z. Under a public policy, `up` exit 1 and the worker stayed `created`. M5, M10b and M12 killed | ✅ PASS |
| AC3: no file references a MinIO image, `mc`, or the `minio`/`minio-init` services | nothing references them | `git grep -i minio 7db819b -- . ':!.specs'` → only `compose.yaml:152`, a comment explaining AD-014 (no image and no service). No `mc`/`MC_HOST`/`minio-init` outside `.specs`. Inside `.specs`, history remains (S4 `validation.md`, `tasks.md`, the superseded parts of `design.md`, `STATE.md` AD-005/AD-014) and the ROS spec itself (`spec.md:32,47`) | ✅ PASS for all executable and config files (⚠️ spec-precision: a literal "no file" cannot hold, because the spec names the old services itself) |

### ROS-02 (P2)

| Criterion | Spec-defined outcome | Enforcing `file:line` + observed evidence | Verdict |
| --- | --- | --- | --- |
| AC1: bucket `fiapx` ensured; a second run succeeds without altering it | create once; the re-run is a no-op | `storage/bootstrap.sh:13-18` (`head-bucket`, then `create-bucket`). Live first up: `bucket fiapx created`. Second `up` without `-v`: `bucket fiapx exists`, `retention on sources/ already configured`, `retention on zips/ already configured`, exit 0, and no `put-bucket-lifecycle-configuration` ran (the `configured` line is absent) | ✅ PASS |
| AC2: any bucket policy → non-zero exit naming it; the Worker does not start | exit ≠ 0, policy named, worker not started | `storage/bootstrap.sh:23-29`. Live: a public GetObject+ListBucket policy gave anonymous GET 200, then the bootstrap printed `bucket fiapx has a bucket policy, which may allow anonymous access: {…}` and exited 1. `up -d --wait` exited 1 (`service "storage-init" didn't complete successfully: exit 1`) with the worker `created` and never started. Deleting the policy restored anonymous GET to 403 | ✅ PASS |
| AC3: bucket ends with exactly two rules at 7 days on `sources/` and `zips/`; a missing rule is added; **any other rule** makes the bootstrap exit non-zero rather than be overwritten | exactly `{sources/:7, zips/:7}` in force; foreign rules never lost | `storage/bootstrap.sh:35-75`. Live, as specified: foreign `tmp/` rule → exit 1 `refusing to overwrite them` with the configuration unchanged; only `sources/`, only `zips/`, or no configuration → exactly the two 7-day rules restored. **Live, violating:** (E1) a whole-bucket rule `Filter:{}` plus only `sources/` → exit 0, and the foreign 30-day rule was **deleted**; (E2) a `Filter.And{Prefix:logs/,Tags}` rule plus only `sources/` → exit 0, and the foreign rule was **deleted**. Cause: `bootstrap.sh:41-42` lists only `Rules[].Filter.Prefix`, so rules without a top-level prefix are invisible to the foreign check at `:47-49`, and `:64` replaces the whole configuration. (E3) a `sources/` rule with `Status: Disabled` → exit 0 and `bucket fiapx expires sources/ and zips/ after 7 days`, although nothing expires; the read-back at `:69-72` never checks `Status` (mutant M11 survives) | ❌ GAP |
| AC4: seed uploads the fixture and the non-video, prints both keys; unreachable storage → non-zero exit naming `storage` | stdout exactly two keys; exit 1 naming the service | `scripts/seed-source-video.mjs:54-61` (probe and unreachable message), `:63-74` (two `aws s3 cp`), `:76-77` (prints). Live: stdout bytes are exactly `sources/sample-8s.mp4\nsources/not-a-video.mp4\n` with empty stderr. The bucket lists `sources/not-a-video.mp4 66` and `sources/sample-8s.mp4 39863` after several seeds. With `storage` stopped: exit 1, `seed-source-video: object storage (compose service "storage", http://storage:9000) is unreachable - …` | ✅ PASS |
| AC5: every S4 smoke assertion passes on the real stack; the archive is fetched and the rejected prefix listed through aws-cli | green smoke; aws-cli for fetch and list | `scripts/smoke-local-integration.mjs:118-126` (`aws s3 cp s3://… -`), `:155-162` (`s3api list-objects-v2 … --query Contents[].Key`, `None` → empty). Live smoke exit 0 (8 frames, FAILED FORMATO_INVALIDO, no archive under the rejected prefix, delivered once, anonymous 403, no leftovers). Self-test: `9 required steps present, 28 bad inputs …, 20 good inputs` (unchanged). Absent-key run through the real `transferArchive` + `assertArchiveTransferred`: `Archive absent: fiapx/zips/never-uploaded/x/frames.zip could not be transferred from storage (download failed: … (404) … Not Found)`. M8 killed | ✅ PASS |

### S4 guarantees touched by the swap (re-checked)

| Requirement | Guarantee | Evidence | Verdict |
| --- | --- | --- | --- |
| RM-01 AC1/AC2/AC4 | storage healthy, bucket ensured, Worker waits, idempotent | same as ROS-01 AC1/AC2 and ROS-02 AC1 | ✅ |
| RM-01 AC3 | bucket denies anonymous access | `bootstrap.sh:23-29` (no policy) plus smoke `anonymous access` step (`smoke-local-integration.mjs:219-237`): live 403 on the object and the listing; 200 under a policy makes the smoke exit 1 with `Anonymous access allowed: GET http://localhost:9000/fiapx/sources/sample-8s.mp4 returned 200` | ✅ |
| RM-01 AC5 | credentials via environment | `compose.yaml:157-158,181-184,62-65` | ✅ |
| RM-03 AC1-3 | 7-day expiry on `sources/` and `zips/`; an existing rule left in place | happy path ✅ live; a rule on `sources/` at 30 days makes the bootstrap exit 1 (read-back); a **Disabled** rule passes (Gap 2) | ⚠️ (Gap 2; inherited: S4's read-back did not check Status either) |
| RM-04 AC1-3 | seed prints key, one object per key, unreachable names the service | ROS-02 AC4 | ✅ |
| RM-06 AC1-4 | ZIP downloaded, 8 entries, absent/unreadable/empty distinguished, no leftovers | live smoke plus the absent-key run above; unreadable/empty through the self-test | ✅ |
| RM-19 | rejection proven across services | live smoke: `Catalog reached FAILED (FORMATO_INVALIDO)`, `No archive exists under zips/<id>/`, `Notification delivered once … O arquivo enviado nao e um video MP4 ou MOV valido.` | ✅ |

**Status**: ❌ Gaps present (ROS-02 AC3), and ⚠️ 3 spec-precision notes.

---

## Gate Check

Build gate from `tasks.md:24`, run exactly as written from `/Volumes/HIKSEMI/repository/fiap-x/fiapx`:

| Step | Exit | Key line |
| --- | --- | --- |
| `node clean-appledouble.mjs` | 0 | - |
| `docker compose config -q` | 0 | images: aws-cli 2.37.4, rustfs 1.0.0, postgres, rabbitmq, four builds (no MinIO) |
| `node scripts/check-worker-sizing.mjs` | 0 | `worker cpus 2 matches FFMPEG_THREADS 2, within the engine's 10 CPUs` |
| `… --self-test` | 0 | `12 bad inputs rejected …, 7 good inputs accepted` |
| `docker compose up --build -d --wait` | 0 | all 7 long-running services healthy; storage-init `Exited (0)`: `bucket fiapx created` / `is private` / `retention on sources/ and zips/ configured` / `expires … after 7 days` |
| `node scripts/seed-source-video.mjs` | 0 | exactly the two keys |
| `node scripts/smoke-local-integration.mjs` | 0 | `holds 8 frames, as 8 s at 1 frame/s requires`; `FAILED (FORMATO_INVALIDO)`; `delivered once`; `refused anonymous GET … (403)`; `No downloaded artefact left behind` |
| `… --self-test` | 0 | `9 required steps present, 28 bad inputs rejected …, 20 good inputs accepted` |
| second `docker compose up -d --wait` (no `-v`) | 0 | `bucket fiapx exists`, both prefixes `already configured`; the smoke re-run afterwards was green |
| `docker compose down -v` | 0 | no containers or volumes left |

Test counts: this repository has no test runner. The self-tests (12/7 sizing; 9/28/20 smoke) are unchanged from S4, so they did not decrease.

---

## Runtime Negatives (live stack, each restored before the next)

| # | Negative | Expected | Observed | Verdict |
| --- | --- | --- | --- | --- |
| N1 | public bucket policy (GetObject + ListBucket, `Principal:*`) | bootstrap exit 1; smoke fails on anonymous access | anonymous GET 200. Bootstrap exit 1 naming the policy JSON. `up` exit 1 with the worker `created`. Smoke exit 1 `Anonymous access allowed: GET http://localhost:9000/fiapx/sources/sample-8s.mp4 returned 200 …`. Restored with `delete-bucket-policy` → 403 | ✅ |
| N2 | foreign `tmp/` rule next to both of ours | exit 1, not overwritten | exit 1 `… (prefixes: tmp/); refusing to overwrite them`; configuration byte-identical before and after | ✅ |
| N3a | only `sources/` | exactly two 7-day rules | `retention on sources/ already configured`, then `configured`, exit 0 → `{sources/ 7 Enabled, zips/ 7 Enabled}` | ✅ |
| N3b | only `zips/` | same | same outcome | ✅ |
| N3c | no configuration (`delete-bucket-lifecycle`) | same | same outcome | ✅ |
| N4 | `storage` stopped, seed | exit 1 naming the service | exit 1 `object storage (compose service "storage", http://storage:9000) is unreachable …` (aws: `Could not connect to the endpoint URL: "http://storage:9000/fiapx"`); restored by `up` and the seed was green again | ✅ |
| N5 | key never uploaded | reported absent | `aws s3 cp` exit 1, `download failed: … (404) … Not Found`. Through the smoke's own functions: `Archive absent: fiapx/zips/never-uploaded/x/frames.zip could not be transferred from storage (…)`. `head-object` 404/254. The listing of an empty prefix prints `None`, which `listArchives` maps to empty | ✅ |
| E1 (verifier) | whole-bucket foreign rule `Filter:{}` (30 d) plus only `sources/` | exit ≠ 0, not overwritten (AC3 "any other rule") | **exit 0; the foreign rule was deleted** | ❌ |
| E2 (verifier) | `Filter.And{Prefix: logs/, Tags}` foreign rule plus only `sources/` | same | **exit 0; the foreign rule was deleted** | ❌ |
| E3 (verifier) | `sources/` rule at 7 d but `Status: Disabled` | 7-day expiry in force, or exit ≠ 0 | **exit 0, prints `expires sources/ and zips/ after 7 days`; the rule stays Disabled** | ❌ |
| E4 (verifier) | `sources/` rule at 30 d | exit ≠ 0 | exit 1 `found 2 rules (1 at 7 days)` | ✅ |
| E5 (verifier) | whole-bucket rule plus both of ours | exit ≠ 0 | exit 1 `found 3 rules` (read-back) | ✅ |

---

## Discrimination Sensor

Each mutant ran in a fresh `git archive 7db819b` copy under the scratchpad. The sibling repositories were symlinked read-only for Compose paths. Images were reused (no `--build`), so no images were created. The same Compose project name was used sequentially, with `down -v` after each mutant, and the copy was deleted afterwards. A control run of the unmutated copy was fully green. "Gate" means the automated Build gate. "Recorded neg" means the negatives recorded in `tasks.md` T2 to T4. "Verifier neg" means E1 to E5 and N5.

| # | Mutation (`file:line`) | Gate | Recorded neg | Verifier neg | Outcome | Classification |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | policy check skipped (`storage/bootstrap.sh:23`) | survives | **killed**: bootstrap exit 0, worker `running`, smoke exit 1 `Anonymous access allowed` | - | Killed | harness-only for the automated gate (no negative inside it) |
| M2 | foreign detection off (`storage/bootstrap.sh:48`) | survives | survives: with both of ours present, the read-back still exits 1 and names `tmp/` | **killed**: foreign `tmp/` + only `sources/` → exit 0 and `tmp/` deleted | Killed (verifier only) | harness-only: the recorded "third rule" negative does not discriminate the foreign check |
| M3 | missing-rule loop checks only `sources/` (`storage/bootstrap.sh:56`) | survives | **killed**: only `sources/` → exit 1 instead of restoring | - | Killed | - |
| M4a | read-back rule count `!= 2` → `-lt 2` (`storage/bootstrap.sh:72`) | survives | survives (the foreign check fires first) | **killed** by E5: exit 0 with 3 rules | Killed (verifier only) | harness-only: no recorded run reaches the rule-count read-back |
| M4b | read-back 7-day count `!= 2` → `!= 1` (`storage/bootstrap.sh:72`) | **killed**: `up` exit 1 | - | - | Killed | - |
| M4c | read-back 7-day check removed (`storage/bootstrap.sh:72`) | survives | survives | **killed** by E4: 30-day rule → exit 0 | Killed (verifier only) | harness-only |
| M5 | Worker's `depends_on: storage-init` removed (`compose.yaml:69-70`) | **killed**: `up --wait` exit 1 `storage-init-1 exited (0)` (incidental, as in S4) | **killed**: under a policy the worker is `running` | - | Killed | - |
| M6a | storage healthcheck removed (`compose.yaml:163-169`) | **killed**: `dependency storage failed to start` | - | - | Killed | - |
| M6b | healthcheck → `["CMD","true"]` (`compose.yaml:166`) | survives | survives | survives | Survived | **equivalent**: the bootstrap's aws-cli calls need a serving S3 API, so ordering still holds (same as S4 M13) |
| M7 | seed's unreachable regex never matches (`scripts/seed-source-video.mjs:57`) | survives | exit 1 `bucket fiapx is not available in object storage (compose service "storage", …)` | - | Survived | **equivalent** for AC4: the fallback message still names the service and exits 1 |
| M8 | `listArchives` treats `None` as a key (`scripts/smoke-local-integration.mjs:161`) | **killed**: smoke `left an archive under zips/<id>/: None` | - | - | Killed | - |
| M9 | `transferArchive` returns `status: 0` on a failed copy (`scripts/smoke-local-integration.mjs:125`) | survives | survives | **killed** by N5: absent key no longer reported as absent (it would surface as "unreadable") | Killed (verifier only) | harness-only: only a live missing-archive run exercises it, and no such run is recorded |
| M10 | Worker `STORAGE_ENDPOINT` → `http://storage:9001` (`compose.yaml:62`) | survives | - | - | Survived | **equivalent**: RustFS serves the S3 API on its console port 9001 as well (verified with `list-buckets` through `:9001`) |
| M10b | Worker `STORAGE_ENDPOINT` → `http://storage:9002` | **killed**: smoke `still RECEIVED after 60000 ms` | - | - | Killed | - |
| M11 | bootstrap writes `expire-sources` as `Status: Disabled` (`storage/bootstrap.sh:36`) | survives | survives | survives (the read-back cannot see Status; E3 shows the same on the real code) | Survived | **real gap**: the bootstrap reports "expires … after 7 days" and exits 0 while `sources/` never expires |
| M12 | Worker `STORAGE_SECRET_KEY` wrong (`compose.yaml:65`) | **killed**: smoke `still RECEIVED after 60000 ms` | - | - | Killed | - |

**Sensor depth**: expanded (16 behaviour-level mutants).
**Tally**: 16 injected; 12 killed (6 by the gate, 2 more by the recorded negatives, 4 only by verifier negatives); 4 survived (3 equivalent, 1 real gap). Harness-only: 5 (M1, M2, M4a, M4c, M9); M3 also needs a recorded negative that sits outside the automated gate.
**Isolation**: real-tree porcelain was recorded before the sensor (all 5 repositories clean at their pinned SHAs) and was identical after it. No `git stash`, no worktree was added, and no image was created. Scratch copies were deleted.

---

## Worker Companion (processing-worker `d7e9e26`)

Code review of `git show d7e9e26`:
- `.github/workflows/ci.yml:37-47` starts `rustfs/rustfs:1.0.0` with `RUSTFS_ACCESS_KEY=fiapx-dev` / `RUSTFS_SECRET_KEY=fiapx-dev-secret` and polls `http://localhost:9000/health` for up to 30 s. `:48-50` exports **only** `STORAGE_ENDPOINT` to `npm run test:e2e`. ✅ Keys are not exported, so `createObjectStorage` (`src/storage/storage.module.ts:16-26`) keeps the AppModule e2e suites on the in-memory adapter.
- `test/s3-object-storage.e2e-spec.ts:20-21` defaults to `fiapx-dev` / `fiapx-dev-secret`, and `:24-30` fails in CI when the endpoint is unset. `src/storage/storage.module.ts:21` defaults to `http://storage:9000`.

CI-shaped run: a private network with RustFS 1.0.0 (dev credentials, S3 on port 9000). Separately, `node:22-alpine` + `apk add ffmpeg` (FFmpeg 8.1.2, Node 22.23.2) with the `git archive d7e9e26` source copied in (`docker cp`, never bind-mounted). Env: only `CI=true` and `STORAGE_ENDPOINT=http://ros-verify-storage:9000`.

| Run | Exit | Summary |
| --- | --- | --- |
| `jest --config test/jest-e2e.json test/s3-object-storage test/composition` | 0 | 2 suites, 9 tests passed (S3 round-trip really ran: head undefined, upload + head size/type + byte-identical download) |
| same with `STORAGE_ACCESS_KEY/SECRET=minioadmin` (old defaults) | 1 | `InvalidAccessKeyId`: the credential change is load-bearing, and the test really talks to RustFS |
| `CI=true` without `STORAGE_ENDPOINT` | 1 | `STORAGE_ENDPOINT must be set in CI` (1 failed, 2 skipped) |
| `npm run lint` / `typecheck` | 0 / 0 | - |
| `npm test -- --coverage` | 0 | 21 suites, 163 tests |
| `npm run test:e2e` | 0 | 9 suites, 51 tests, none skipped |
| `npm run build` | 0 | - |

The containers and network were removed afterwards. processing-worker is still `feat/real-media-processing@d7e9e26` with a clean porcelain.

---

## Spec-Precision Notes

1. **ROS-01 AC1** ("healthy before the bootstrap") is satisfied by any healthcheck, including `CMD true` (M6b equivalent). The load-bearing outcome is that the bootstrap succeeds against a serving S3 API. This is the same observation as S4 note 7.
2. **ROS-01 AC3** says "no file in this repository", but the spec and the S4 history files necessarily name `minio-init` and `mc`. Suggested rewording: "no executable or configuration file (compose, scripts, bootstrap, README)".
3. **ROS-02 AC3** says "any other rule" but does not say what a rule's identity is (ID, prefix, filter shape) or that "7-day expiry" means an *Enabled* rule. The code took identity to be `Filter.Prefix`, which is what lets E1/E2 through.
4. The smoke self-test sample for "archive absent" (`scripts/smoke-local-integration.mjs:513`, `fatal error: … Key "…" does not exist`) is not what aws-cli against RustFS prints (`download failed: … (404) … Not Found`). This is harmless because the assertion keys on the exit status, but T4 claimed the sample "becomes aws-cli's".
5. The RustFS console listens on `:9001` inside the network and serves the S3 API there too (with `RUSTFS_CONSOLE_CORS_ALLOWED_ORIGINS=*`). It is not published to the host, so there is no exposure. For information only.
6. processing-worker docs still name MinIO as the default: `.specs/features/real-media-processing/design.md:258` shows `STORAGE_ENDPOINT` default `http://minio:9000` (the code now says `http://storage:9000`), and `docs/service-boundary.md:14` says "MinIO locally". This is minor doc drift in the companion.

---

## Ranked Gaps

1. **Foreign lifecycle rules without a top-level prefix are silently destroyed** (ROS-02 P2 AC3; a regression from S4's additive `mc ilm rule add`). Location: `storage/bootstrap.sh:40-49`, where `Rules[].Filter.Prefix` drops `Filter:{}`, `Filter.And` and legacy rules, followed by the whole-configuration `put` at `:64`. Live evidence: E1 and E2 above. Related code-read risk, not reproduced: `prefixes()` at `:41-42` swallows *every* `get-bucket-lifecycle-configuration` error (`2>/dev/null || true`). A transient or permission error is therefore read as "no configuration", and the `put` then replaces whatever exists. **Fix task**: detect foreign rules by listing every rule that is not exactly one of ours, e.g. `--query "Rules[?!(Filter.Prefix=='sources/' || Filter.Prefix=='zips/')].ID"`, which counts a missing prefix as foreign. Also treat only `NoSuchLifecycleConfiguration` as "none" and fail on any other error. Add negatives for `Filter:{}` and `Filter.And` alongside a missing rule of ours. **Severity**: Major.
2. **The read-back accepts Disabled rules** (ROS-02 P2 AC3 "7-day expiry"; RM-03). Location: `storage/bootstrap.sh:57` (the presence check) and `:69-72` (the read-back ignores `Status`). Evidence: M11 survives everything, and live E3 prints `expires … after 7 days` while `sources/` is Disabled. This is inherited from S4's read-back, but ROS rewrote that read-back and restated the guarantee. **Fix task**: count `Rules[?Expiration.Days==\`7\` && Status=='Enabled']` and require the pair of prefixes among *those* rules, and treat a Disabled rule of ours as needing a rewrite (or as a failure). Add a Disabled-rule negative. **Severity**: Major (local only, but the bootstrap asserts a false post-condition).
3. **Harness-only weaknesses** (not blocking by themselves): M2, M4a, M4c and M9 are killed only by verifier-authored negatives, and M1/M3 only by recorded negatives outside the automated gate. **Fix task**: script the bootstrap negatives (policy; foreign plus a missing rule; whole-bucket rule plus both of ours; 30-day rule; Disabled rule) and one missing-archive transfer into a repeatable check (for example a `storage/bootstrap-negatives.sh` run in the Build gate), so these guarantees stop depending on hand runs. **Severity**: Minor.
4. Doc drift in processing-worker (`design.md:258`, `docs/service-boundary.md:14`). **Severity**: Cosmetic.

---

## Code Quality

| Check | Status |
| --- | --- |
| Minimum code / surgical changes | ✅ (11 files; the changes stay within the swap) |
| No scope creep | ✅ |
| Matches existing patterns | ✅ (scripts keep S4's structure, messages and self-tests) |
| Spec-anchored outcomes | ❌ ROS-02 AC3 (Gaps 1-2) |
| Documented guidelines | tlc-spec-driven `validate.md`; AD-005/AD-014 honoured |

## Requirement Traceability Update (proposed)

| Requirement | Previous | New |
| --- | --- | --- |
| ROS-01 | Pending | ✅ Verified |
| ROS-02 | Pending | ❌ Needs Fix (P2 AC3) |

## Summary

**Overall**: ❌ Not Ready.
**Spec-anchored check**: 7/8 ACs matched the spec outcome (ROS-02 AC3 fails); 3 spec-precision notes, plus 3 informational ones.
**Sensor**: 16 injected, 12 killed, 4 survived (3 equivalent, 1 real gap: M11).
**Gate**: all Build-gate steps exited 0, including the second `up` and `down -v`.
**Worker companion**: green (163 unit tests + 51 e2e, RustFS round-trip real, only `STORAGE_ENDPOINT` exported).
