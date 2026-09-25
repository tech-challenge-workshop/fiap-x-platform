# Real Media Processing Validation — platform

**Date**: 2026-09-25
**Spec**: `.specs/features/real-media-processing/spec.md`
**Diff range**: `f225e2e..a787035` (`feat/real-media-processing`). The implementation commits are `83e33ba`..`a787035` (11 commits). `eb24e9e`..`6c9238d` are spec documents.
**Verifier**: independent sub-agent (author ≠ verifier)
**Environment**: Docker Desktop engine with 10 CPUs. The sibling repos were `processing-worker` `feat/real-media-processing@a0aaa4a`, `processing-catalog` `main@696029d` and `notification-service` `main@256f1a0`, all clean before and after. MinIO `RELEASE.2025-09-07T16-13-09Z` and mc `RELEASE.2025-08-13T08-35-41Z`.

**Result**: FAIL. Every acceptance criterion has `file:line` evidence, and the build gate is green, run twice. One spec edge case is demonstrably violated: a CPU limit above the engine's core count stops the stack from starting. The check that enforces RM-05 AC3 is not wired into any gate. Six of 19 mutants survived. Four are assertion mutants that a correct stack cannot kill. Two (M5b, M10) are behaviours that no gate observes.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1–T11 | ✅ Done | All 11 are marked `✅ Complete` in `tasks.md`, with every `Done when` box checked. There is one commit per task: T1 `83e33ba`, T2 `1ce4aa2`, T3 `7445cb1`, T4 `c85d425`, T5 `5daf13d`, T6 `c5cbb7a`, T7 `d26e51b`, T8 `349fbf8`, T9 `dcfdef8`, T11 `b7ab225` and T10 `a787035`. |

The recorded deviations, and whether each still meets its AC's intent:

- **T4, fixture committed rather than generated.** Meets the intent. `fixtures/README.md:20-22` records the command, pinned by digest. The Verifier's ffprobe reports `h264 320x240 30/1, duration=8.000000`, and the SHA-256 matches `fixtures/README.md:13`. The spec's assumption row (`spec.md:40`) still says "generated" and was never amended.
- **T2, `private` instead of `none`.** Meets the intent. `mc anonymous get --json` returned `"permission":"private"`, and anonymous HTTP returned 403. The marker is at `minio/bootstrap.sh:16-18`. `tasks.md:122` still says `none`.
- **T11, both pre-S4 stubs needed to reach `COMPLETED`.** Meets the intent, and the Verifier reproduced it (W3 below). It has one side effect: see M3.
- **Catalog exposes `failureCode`, not `failureReason`.** Meets the intent. The sentence is asserted on the Notification delivery (`scripts/smoke-local-integration.mjs:248`). The spec text of RM-19 AC2 is now inaccurate: see the spec-precision gaps.

---

## Spec-Anchored Acceptance Criteria

### P1: Object storage in the local topology (RM-01, RM-02)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 storage healthy before Worker | readiness, then Worker | `compose.yaml:166` `mc ready local`, `compose.yaml:183-185` init waits `service_healthy`, `compose.yaml:69-70` worker waits `service_completed_successfully`. Observed start times: minio 22:29:20.97, init 22:29:26.60 to 26.77, worker 22:29:27.18. M6 and M6c were both killed | ✅ PASS |
| AC2 bucket `fiapx` exists | bucket `fiapx` | `compose.yaml:180` `STORAGE_BUCKET=fiapx`, `minio/bootstrap.sh:12` `mc mb --ignore-existing`. Log: ``Bucket created successfully `local/fiapx` `` | ✅ PASS |
| AC3 deny anonymous access | object reachable only with credentials | `minio/bootstrap.sh:19-23` asserts `"permission":"private"`, else exit 1. Verifier: anonymous `GET /fiapx/sources/sample-8s.mp4` gave 403 and `GET /fiapx/` gave 403. A bucket loosened by hand made `up` exit 1 with the Worker not started. M5a was killed; **M5b survived** | ⚠️ PASS (asserted once at bootstrap; no gate checks the end state) |
| AC4 existing bucket unaltered | success, no change | `minio/bootstrap.sh:12`. The second `up` without `-v` exited 0, and its log shows `retention on sources/ already configured`, `retention on zips/ already configured` | ✅ PASS |
| AC5 credentials via env | env only | `compose.yaml:62-65`, `:156-157`, `:179`. `git grep minioadmin a787035` finds only `compose.yaml` | ✅ PASS |

### P2: Retention (RM-03)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 7-day lifecycle | expire 7 days after creation | `minio/bootstrap.sh:38` `--expire-days 7`. The read-back at `minio/bootstrap.sh:43-49` requires 2 rules at 7 days. `mc ilm rule ls` shows `sources/ 7`, `zips/ 7` | ✅ PASS |
| AC2 existing rule left in place | success, no duplicate | Guard at `minio/bootstrap.sh:34-36`. The second `up` still shows exactly 2 prefixes | ✅ PASS |
| AC3 both prefixes | `sources/` and `zips/` | `minio/bootstrap.sh:31`. M4 (drop `zips/`) was killed: `up` exit 1, `expected 2 lifecycle rules at 7 days, found 1` | ✅ PASS |

### P3: A real video, seeded (RM-04)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 readable MP4 under `sources/`, key printed | key on stdout | `scripts/seed-source-video.mjs:62-68` upload and `:75` print. The key is consumed at `scripts/smoke-local-integration.mjs:148` and the video reached 8 frames. M9 (wrong key printed) was killed: `expected COMPLETED, observed FAILED (FORMATO_INVALIDO)` | ✅ PASS |
| AC2 twice leaves one object | exactly one | Fixed key at `scripts/seed-source-video.mjs:20`. After the seed plus the smoke's own seed, `mc ls sources/` shows one `sample-8s.mp4` | ✅ PASS |
| AC3 unreachable, non-zero naming the service | exit ≠ 0, names service | `scripts/seed-source-video.mjs:53-59`. With minio stopped: exit 1, `object storage (compose service "minio", http://minio:9000) is unreachable` | ✅ PASS |
| AC4 fixture states duration and fps | derivable count | `fixtures/README.md:9-11` (8 s, 30 fps, 8 frames at 1 fps) and `scripts/smoke-local-integration.mjs:11-15` | ✅ PASS |

### P4: The smoke proves a ZIP (RM-06)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 download at `zipStorageKey`, readable | archive fetched and parsed | `scripts/smoke-local-integration.mjs:228-231` (key from the Catalog, scoped to `zips/<id>/`) and `:57-66` transfer | ✅ PASS |
| AC2 entries = seconds × 1 | 8 | `scripts/smoke-local-integration.mjs:15`, `:84-86`. M1 (expects 7) was killed. W1 (Worker at fps=2) was killed: `holds 16 entries, expected 8` | ✅ PASS |
| AC3 absent / unreadable / empty named distinctly | three messages | `scripts/smoke-local-integration.mjs:65` `Archive absent`, `:77` `Archive unreadable`, `:82` `Archive empty`. **All three were proved end to end by the Verifier**: W2 gave `Archive absent`, W5 gave `Archive unreadable`, and W4 gave `Archive empty`. M8 (parser returns 0) gave `Archive empty` | ✅ PASS |
| AC4 no downloaded artefact left | nothing in tmp | `scripts/smoke-local-integration.mjs:68`, `:88-89` (`finally rmSync`). The real runs left 0 `fiapx-smoke-*`. **M10 survived**: the smoke was green and leaked 1 dir | ⚠️ PASS (code only; no gate observes it) |

### P6: The smoke proves a rejection (RM-19)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 seed a non-video, second request | 2 requests | `scripts/seed-source-video.mjs:21-22`, `:70-73`, and `scripts/smoke-local-integration.mjs:219` | ✅ PASS |
| AC2 `FAILED` + safe `FORMATO_INVALIDO` text | `FAILED`, reason `O arquivo enviado nao e um video MP4 ou MOV valido.` | `scripts/smoke-local-integration.mjs:235` (`status`, `failureCode` on the Catalog) and `:248` (exact sentence on the delivery) | ⚠️ PASS (recorded deviation: `failureReason` is not on the Catalog) |
| AC3 no archive + exactly one delivery | 0 objects, 1 row | `scripts/smoke-local-integration.mjs:103-107`, `:242`, and `:112-118`, `:254` (`deliveries !== 1`, a row count in `notification.delivery_record`). M11 and M12 survived against a correct stack (see the sensor) | ✅ PASS |
| AC4 `COMPLETED` or non-terminal fails, naming the status | exit ≠ 0 naming the status | `scripts/smoke-local-integration.mjs:235-236`, `:192`. W3 (pre-S4 Worker) gave exit 1 with `expected FAILED (FORMATO_INVALIDO), observed COMPLETED`. `POLL_TIMEOUT_MS=300` gave exit 1 with `is still RECEIVED after 300 ms` | ✅ PASS |

### P5: CPU limit and thread count (RM-05)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 explicit CPU limit | declared `cpus` | `compose.yaml:53` `cpus: ${WORKER_CPUS:-2}`. The container shows `NanoCpus=2000000000` | ✅ PASS |
| AC2 threads from the same limit | `FFMPEG_THREADS` = limit | `compose.yaml:59` `FFMPEG_THREADS=${WORKER_CPUS:-2}`. In the container, `printenv FFMPEG_THREADS` gives `2` | ✅ PASS |
| AC3 disagreement fails naming both | exit ≠ 0, both values | `scripts/check-worker-sizing.mjs:38-40`. M7 was killed: `worker cpus is 2 but FFMPEG_THREADS is 4`. **However, no gate runs it**: it is absent from the Build gate (`tasks.md:39`) and from CI (`.github/workflows/ci.yml:14-37`, `:83-90`). M7 passes both | ❌ GAP (enforcement unwired) |

**Status**: ❌ gaps present. There are 27 ACs. 26 have evidence and 1 is a wiring gap (RM-05 AC3). 2 pass only by code evidence or at bootstrap time, and 1 rests on a recorded deviation.

---

## Discrimination Sensor

Each mutant ran in its own scratch copy of the platform, with the four siblings symlinked (`rsync --exclude .git` into the scratchpad). Each run was the full gate: `config -q`, `up --build -d --wait`, seed, smoke, sizing, then `down -v`. Each edit was applied by a script that aborts unless the pattern matches exactly once. The Worker faults are images derived from the built `fiap-x-platform-worker`, with a `sed` over `dist/` guarded by `grep -q`. They were run through a scratch `compose.yaml` that uses `image:` in place of `build:`. A control run of the unmutated copy was green.

| # | File:line | Mutation | Caught by | Killed? |
| --- | --- | --- | --- | --- |
| M1 | `scripts/smoke-local-integration.mjs:13` | `FIXTURE_SECONDS` 8 → 7 | smoke: `holds 8 entries, expected 7` | ✅ |
| M2 | `scripts/smoke-local-integration.mjs:84` | count comparison disabled | nothing. Still green when paired with W1 (a 16-frame archive passes) | ❌ Survived |
| M3 | `scripts/smoke-local-integration.mjs:235` | rejection check accepts `COMPLETED` | nothing on a correct stack. Paired with W3, it is killed only incidentally, by `Archive absent` for the *video* | ❌ Survived |
| M4 | `minio/bootstrap.sh:31` | retention loop drops `zips/` | bootstrap read-back, `up` exit 1 | ✅ |
| M5a | `minio/bootstrap.sh:19` | `mc anonymous set download` before the assertion | bootstrap assertion, `up` exit 1, Worker not started | ✅ |
| M5b | `minio/bootstrap.sh:50` | `mc anonymous set download` after the checks (bucket ends public) | nothing: whole gate green | ❌ Survived |
| M6 | `compose.yaml:69-70` | Worker no longer depends on `minio-init` | `up --wait`: `container minio-init exited (0)`, exit 1 | ✅ |
| M6c | `compose.yaml:70` | condition becomes `service_started` | `up --wait`, exit 1 (same mechanism) | ✅ |
| M7 | `compose.yaml:59` | `FFMPEG_THREADS=4`, decoupled from `cpus` | `check-worker-sizing.mjs` exit 1, naming both values. **The Build gate and CI would pass it** | ✅ (only with the sizing script) |
| M8 | `scripts/smoke-local-integration.mjs:47` | EOCD parser returns 0 | smoke: `Archive empty` | ✅ |
| M9 | `scripts/seed-source-video.mjs:75` | seed prints the wrong key | smoke: `expected COMPLETED, observed FAILED (FORMATO_INVALIDO)` | ✅ |
| M10 | `scripts/smoke-local-integration.mjs:89` | temp dir not removed | nothing: green, and 1 `fiapx-smoke-*` leaked (removed by the Verifier) | ❌ Survived |
| M11 | `scripts/smoke-local-integration.mjs:254` | `deliveries !== 1` → `< 1` | nothing on a correct stack | ❌ Survived |
| M12 | `scripts/smoke-local-integration.mjs:106` | no-archive check disabled | nothing on a correct stack | ❌ Survived |
| W1 | Worker `dist/media/ffmpeg-frame-extractor.js` | `fps=1` → `fps=2` | smoke: `holds 16 entries, expected 8` | ✅ |
| W2 | Worker `dist/processing/media-frame-packager.js` | packager stores nothing (T9 reproduction) | smoke: `Archive absent … Object does not exist` | ✅ |
| W3 | Worker packager + `ffprobe-video-validator.js` | pre-S4: accept all, store nothing (T11 reproduction) | smoke: `expected FAILED (FORMATO_INVALIDO), observed COMPLETED` | ✅ |
| W4 | Worker packager | uploads a valid ZIP with 0 entries | smoke: `Archive empty … holds 0 entries, expected 8` | ✅ |
| W5 | Worker packager | uploads non-ZIP bytes | smoke: `Archive unreadable … no End of Central Directory record` | ✅ |

**Sensor depth**: expanded (19 mutations: 14 platform, 5 injected Worker faults).
**Isolation**: the real tree's `git status --porcelain` was byte-identical before and after (empty), with HEAD `a787035`. All three sibling repos are clean at the same HEADs. The scratch copies, the 5 scratch images and the leaked temp dir were removed.
**Result**: 13/19 killed, 6 survived. The system and configuration faults were killed (M1, M4–M9, W1–W5), except M5b and M10. M2, M3, M11 and M12 delete the smoke's own assertions. A correct stack cannot kill them, and this repository re-proves them only through one-off manual negative runs (T9 and T11). **Result: FAIL ❌**

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / surgical / no scope creep | ✅ Each change touches one of 11 files. Nothing is outside the slice |
| Matches patterns | ✅ Healthcheck, named-volume and credential-comment conventions. Scripts are dependency-free `node:` only, and `node --check` passes for all four |
| Spec-anchored outcome check | ✅ 8 frames, 7 days, both prefixes, `private`, `FORMATO_INVALIDO`, the exact sentence and `=== 1` are all exact values |
| Every check maps to a requirement | ✅ `SPEC_DEVIATION` is marked at `minio/bootstrap.sh:16` |
| Documented guidelines | `.specs/features/real-media-processing/tasks.md` Test Coverage Matrix. The README relative links all resolve |

---

## Edge Cases

- [x] Bootstrap fails, so the Worker does not start. The Verifier loosened the bucket with `mc anonymous set download`: `up --wait` exited 1 with `service "minio-init" didn't complete successfully`, and the Worker was `running=false`.
- [x] Stale volume without the lifecycle rule. The Verifier ran `mc ilm rule rm --all`: the next `up` re-added both rules (`minio/bootstrap.sh:34-39`). It was not tested with a stale rule of a *different* expiry on the same prefix. In that case the guard skips the rule and the read-back at `minio/bootstrap.sh:46` fails the start, which surfaces the problem rather than fixing it.
- [x] Smoke run twice. The requests were distinct and each key is scoped to `zips/<id>/` (`scripts/smoke-local-integration.mjs:229`). Three runs on one stack were all green.
- [x] FFmpeg unavailable where the fixture is generated. This is moot after the T4 deviation. The zero-byte guard at `scripts/seed-source-video.mjs:49` keeps its intent.
- [ ] **Fewer cores than the declared CPU limit: the stack SHALL still start.** Violated. `WORKER_CPUS=16` on the 10-CPU engine made `up` exit 1 with `Error response from daemon: range of CPUs is from 0.01 to 10.00, as there are only 10 CPUs available`. The default of 2 will fail the same way on a 1-CPU engine. Nothing in the slice handles or documents it.

---

## Gate Check

- **Gate command**: `node clean-appledouble.mjs` (workspace root), then `docker compose config -q && docker compose up --build -d --wait && node scripts/seed-source-video.mjs && node scripts/smoke-local-integration.mjs && node scripts/check-worker-sizing.mjs`, then a second `up --build -d --wait` without `-v`, then `docker compose down -v`.
- **Outcome**: clean 0, config 0, up 0 (19 s), seed 0 (two keys), smoke 0 (5 s), sizing 0, second up 0 (bootstrap re-ran and reported `already configured`), smoke after the second up 0, down -v 0.
- **Smoke summary lines**:
  - `Catalog reached COMPLETED for c121e5c6-… with archive zips/c121e5c6-…/411acf56-…/frames.zip`
  - `Catalog reached FAILED (FORMATO_INVALIDO) for b2c2819b-…`
  - `Archive zips/c121e5c6-…/411acf56-…/frames.zip holds 8 frames, as 8 s at 1 frame/s requires`
  - `No archive exists under zips/b2c2819b-…/`
  - `Notification delivered once for b2c2819b-…: O arquivo enviado nao e um video MP4 ou MOV valido.`
  - `worker cpus 2 matches FFMPEG_THREADS 2`
- **Before and after**: no unit tests exist. The smoke's assertions grew from 2 (status and delivery) to 11 (key scope, 3 archive causes, count, rejection status and code, no-archive, sentence, row count, timeout). There is 1 new check script.
- **CI**: the `integration` job still self-skips without `SERVICES_READ_TOKEN` (V11, out of scope). The `topology` job does not run `check-worker-sizing.mjs`.

---

## Fix Plans

### Fix 1: The CPU-limit edge case is violated (Major)

- **Root cause**: Docker rejects `cpus` greater than the engine's CPU count. The spec edge case assumes it does not.
- **Fix task**: amend the spec edge case (`spec.md:158`) to the real behaviour, a named failure, and make it true in `scripts/check-worker-sizing.mjs`. Read `docker info --format '{{.NCPU}}'` and fail naming `WORKER_CPUS` and the engine CPU count when the limit exceeds it. Add one line to the README "Worker sizing" section.
- **Done when**: `WORKER_CPUS=16` on a 10-CPU engine makes the check exit 1 naming 16 and 10, and the spec matches.

### Fix 2: No gate runs the sizing check (Major)

- **Root cause**: `scripts/check-worker-sizing.mjs` is not in the Build gate (`tasks.md:39`) or in `.github/workflows/ci.yml`.
- **Fix task**: add `node scripts/check-worker-sizing.mjs` to the `topology` job after `docker compose config`, and to the Build gate row in `tasks.md`.
- **Done when**: M7 (`FFMPEG_THREADS=4`) turns CI's `topology` job red.

### Fix 3: The private posture is not checked at the end state (Minor)

- **Fix task**: have the smoke issue an unauthenticated `GET http://localhost:9000/fiapx/<videoKey>` and require 403, so RM-01 AC3 is proved from outside after bootstrap.
- **Done when**: M5b turns the smoke red.

### Fix 4: The smoke's artefact cleanup is unobserved (Minor)

- **Fix task**: after `assertArchiveFrameCount`, assert that the `mkdtemp` path no longer exists.
- **Done when**: M10 turns the smoke red.

### Fix 5: The smoke's negative proofs are one-off (Minor)

- **Fix task**: version the negative runs (a pre-S4 or stub-packager Worker override, as the Verifier built with `dist` patches) as a script that requires a red smoke with the named cause.
- **Done when**: M2, M3, M11 and M12 are each killed by some checked-in run. M3 in particular is currently caught only by the archive check on the *other* request.

---

## Spec-Precision Gaps

1. RM-19 AC2 names `failureReason` on the request, but the Catalog exposes only `failureCode`. The smoke splits the assertion across the Catalog code and the Notification sentence. The spec should say so.
2. `spec.md:40` still says the fixture is generated at seed time, and `:39-43` stay `Confirmed? n`. The design revision was never written back.
3. `tasks.md:122` still says `none`, while the code asserts `private`. The code carries the `SPEC_DEVIATION`; the task text does not.
4. `spec.md:158` (fewer cores) states behaviour the engine does not allow. See Fix 1.
5. RM-06 AC4 ("no downloaded artefact") has no observable outcome defined for a check. See Fix 4.

---

## Requirement Traceability Update

The Verifier does not edit `spec.md`. The statuses it recommends are:

- RM-01, RM-02, RM-03, RM-04 and RM-06: ✅ Verified. RM-01 AC3 and RM-06 AC4 carry the minor follow-ups (Fixes 3 and 4).
- RM-19: ✅ Verified, with the recorded deviation and spec-text drift.
- RM-05: ❌ Needs Fix (Fixes 1 and 2).

---

## Summary

**Overall**: ❌ Not Ready. The fixes are small.
**Spec-anchored check**: 26/27 ACs evidenced, 1 wiring gap (RM-05 AC3). 1 edge case is violated. There are 5 spec-precision gaps.
**Sensor**: 13/19 killed. The survivors are M2, M3, M5b, M10, M11 and M12.
**Gate**: green on both passes. The bootstrap is idempotent.

**What works**: the storage, the private bucket, 7-day retention on both prefixes, and bootstrap ordering, which `up --wait` enforces. The seed is idempotent and names an unreachable service. The smoke proves an 8-frame archive and names the absent, unreadable and empty cases, all three observed end to end. It proves a `FORMATO_INVALIDO` rejection with no archive and exactly one delivery.

**Next steps**: Fixes 1 and 2 are required before PASS. Fixes 3–5 are recommended, then re-verify.
