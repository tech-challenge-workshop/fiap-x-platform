# Real Media Processing Validation — platform (Round 2)

**Date**: 2026-09-25
**Spec**: `.specs/features/real-media-processing/spec.md`
**Diff range**: `f225e2e..58b7cdd` (`feat/real-media-processing`). Round 1 covered `83e33ba..a787035`. This round re-derives the whole range. It adds the fix batch `87e6e00..e278149` (T12–T17) and the docs alignment commit `58b7cdd`.
**Verifier**: independent sub-agent, round 2 (author ≠ verifier). I did not trust the round 1 report or the evidence text of T12–T17. Every claim below was re-run.
**Environment**: Docker Desktop 29.6.2, engine with 10 CPUs (`docker info` NCPU=10). The sibling repos were `processing-worker` `feat/real-media-processing@a0aaa4a`, `processing-catalog` `main@696029d`, `notification-service` `main@256f1a0` and `fiap-x-api` `main@cb1dbab`, all clean before and after.

**Result**: FAIL. All 19 round-1 mutants are now killed, including the six that survived round 1. The build gate is green on both passes, and every AC and edge case has `file:line` evidence that I observed at runtime. However, 12 of the 17 new round-2 mutants survive. After excluding one equivalent mutant and two mutants of the test harness itself, 9 of them disable real enforcement and no gate notices:

- **The sizing check's own logic is not discriminated.** Disabling its engine-CPU comparison (N2), shifting its boundary (N2b), or disabling the CPU/thread pairing comparison (N2c) passes the Build gate and CI. The script has no self-test, and every gate runs it only with a matching, in-range config. RM-05 AC3 and the corrected CPU edge case are enforced only by code nobody tests.
- **Two smoke assertions are inline in `main()` and outside the self-test.** These are the RM-19 AC2 sentence check (N6) and the `zipStorageKey` scope check (N9).
- **The self-test proves the helper functions, not that `main()` calls them.** Removing the call to the anonymous-access check (N3w), the rejection check (N5), the no-archive check (N7) or the single-delivery check (N8) leaves every gate green.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1–T11 | ✅ Done | Re-verified by the gate run and the sensor below. |
| T12 | ✅ Done, with a gap | `scripts/check-worker-sizing.mjs:45-54` reads `docker info` NCPU. I re-ran it: `WORKER_CPUS=16` gave exit 1, `WORKER_CPUS is 16 but the Docker engine has only 10 CPUs; set WORKER_CPUS to at most 10`. `WORKER_CPUS=11` gave exit 1. `WORKER_CPUS=10` and the default gave exit 0. A bad `DOCKER_HOST` gave exit 1, `docker info failed …`. The spec edge case (`spec.md:158`) matches. Gap: the comparison itself is unguarded (N2 and N2b survive). |
| T13 | ✅ Done | `.github/workflows/ci.yml:36-37` runs the check in the `topology` job. `tasks.md:39` has it in the Build gate after `config -q`. In a CI-shaped copy (platform only, no siblings), `docker compose config` rendered, the check passed, and M7 made it exit 1. Gap: N2c survives. |
| T14 | ✅ Done | `scripts/smoke-local-integration.mjs:179-195`, called at `:294`. M5b is now killed. Gap: removing the call (N3w) survives. |
| T15 | ✅ Done | `scripts/smoke-local-integration.mjs:55-79` (`withScratchDir`). M10 is killed by both the smoke and the self-test. |
| T16 | ⚠️ Done, but its claim is overstated | `--self-test` (`:358-442`) rejects 13 bad inputs and accepts 7 good inputs. M2, M3, M11 and M12 are killed. The claim that the self-test covers "every assertion above" (`README.md:52`) is not true: the sentence check (`:325`), the key-scope check (`:308`), the video `COMPLETED` check (`:302`) and all call sites in `main()` are outside it. The self-test is also absent from the Build gate row (`tasks.md:39`). |
| T17 | ✅ Done | `spec.md:39-40` (fixture committed, 39,863 bytes) matches: SHA-256 `494956e2…7552` = `fixtures/README.md:13`. RM-19 AC2 is at `spec.md:128`. The `SPEC_DEVIATION` marker was removed from `minio/bootstrap.sh:14-17` in `58b7cdd`, and the text there now states the `private`/`none` naming. |

---

## Spec-Anchored Acceptance Criteria

### P1: Object storage in the local topology (RM-01, RM-02)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 storage healthy before Worker | readiness, then Worker | `compose.yaml:166` `mc ready local`, `:183-185` init waits `service_healthy`, `:69-70` worker waits `service_completed_successfully`. M6 and M6c are killed by `up --wait` exit 1 | ✅ PASS |
| AC2 bucket `fiapx` exists | bucket `fiapx` | `compose.yaml:180`, `minio/bootstrap.sh:12` `mc mb --ignore-existing`. Log: ``Bucket created successfully `local/fiapx` `` | ✅ PASS |
| AC3 deny anonymous access | reachable only with credentials; 403 | At bootstrap: `minio/bootstrap.sh:18-22` requires `"permission":"private"`. At the end state: `scripts/smoke-local-integration.mjs:179-186` (`status !== 403` → throw), called at `:294`. I observed 403 with curl on the object, on `fiapx/` and on `not-a-video.mp4`. M5a and **M5b are both killed**. Self-test cases are at `:387-390` | ✅ PASS (wiring mutant N3w survives, see the sensor) |
| AC4 existing bucket unaltered | success, no change | `minio/bootstrap.sh:12`, `:34-35`. The second `up` without `-v` gave exit 0, and its log shows `retention on sources/ already configured`, `retention on zips/ already configured` | ✅ PASS |
| AC5 credentials via env | env only | `compose.yaml:62-65`, `:156-157`, `:179`. `git grep minioadmin 58b7cdd` matches only `compose.yaml`, plus the prose in the round-1 report | ✅ PASS |

### P2: Retention (RM-03)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 7-day lifecycle | expire at 7 days | `minio/bootstrap.sh:37` `--expire-days 7`. The read-back at `:42-48` requires 2 rules, both at 7 days. `mc ilm rule ls` showed `sources/ 7` and `zips/ 7` | ✅ PASS |
| AC2 existing rule left in place | success, no duplicate | `minio/bootstrap.sh:34-35` guard. After the second `up`, `ilm rule ls` still showed exactly 2 `Enabled` rules | ✅ PASS |
| AC3 both prefixes | `sources/` and `zips/` | `minio/bootstrap.sh:30`. M4 is killed: `up` exit 1, `minio-init didn't complete successfully`, Worker not started | ✅ PASS |

### P3: A real video, seeded (RM-04)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 readable MP4 under `sources/`, key printed | key on stdout | `scripts/seed-source-video.mjs:62-68`, `:75`. Output was `sources/sample-8s.mp4`, and the key reached 8 frames. M9 is killed: `expected COMPLETED, observed FAILED (FORMATO_INVALIDO)` | ✅ PASS |
| AC2 twice leaves one object | exactly one | Fixed key at `scripts/seed-source-video.mjs:20`. After the standalone seed plus the smoke's own seed, `mc ls sources/` shows one `sample-8s.mp4` (39KiB) | ✅ PASS |
| AC3 unreachable → non-zero naming the service | exit ≠ 0, service named | `scripts/seed-source-video.mjs:53-59`. With the stack down: exit 1, `object storage (compose service "minio", http://minio:9000) is unreachable` | ✅ PASS |
| AC4 fixture states duration and fps | derivable count | `fixtures/README.md:9-11`, `scripts/smoke-local-integration.mjs:11-15`. The SHA-256 and size match | ✅ PASS |

### P4: The smoke proves a ZIP (RM-06)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 download at `zipStorageKey`, readable | fetched and parsed | `scripts/smoke-local-integration.mjs:307-311` (key from the Catalog, scoped to `zips/<id>/`), `:113-127` (transfer and parse) | ✅ PASS (N9, the scope check disabled, survives) |
| AC2 entries = 8 | 8 | `:13-15`, `:104-106`, with self-test cases at `:367-370`. M1, M2 and W1 are killed | ✅ PASS |
| AC3 absent / unreadable / empty named | three distinct messages | `:85` `Archive absent`, `:97` `Archive unreadable`, `:102` `Archive empty`. End to end: W2 gave `Archive absent`, W5 gave `Archive unreadable` and W4 gave `Archive empty`. The self-test pins each exact message (`:371-376`). Nempty and N1a are killed | ✅ PASS |
| AC4 no downloaded artefact left | dir gone after exit | `:62-79` (`rmSync` then `assertScratchRemoved(dir, existsSync(dir))`), with self-test cases at `:391`, `:397-406`. The real runs left 0 `fiapx-smoke-*`. M10, N4b and N4+M10 are killed | ✅ PASS |

### P6: The smoke proves a rejection (RM-19)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 non-video seeded, second request | 2 requests | `scripts/seed-source-video.mjs:21-22`, `:70-73`, `scripts/smoke-local-integration.mjs:298` | ✅ PASS |
| AC2 Catalog `FAILED`/`FORMATO_INVALIDO` and exact sentence on the delivery | `FAILED`, `FORMATO_INVALIDO`, `O arquivo enviado nao e um video MP4 ou MOV valido.` | Code: `:151-155` (`assertRejected`, self-tested at `:377-380`), called at `:314`. Sentence: `:325` (inline, **not self-tested**). Observed: `Notification delivered once for …: O arquivo enviado nao e um video MP4 ou MOV valido.` | ⚠️ PASS on a correct stack; **N6 (sentence check disabled) and N5 (call removed) survive** |
| AC3 no archive + exactly one delivery | 0 objects, 1 row | `:139-147` and `:159-174` (self-tested at `:381-386`), called at `:319` and `:330`. M11 and M12 are killed | ⚠️ PASS; **N7 and N8 (calls removed) survive** |
| AC4 `COMPLETED` or non-terminal → exit ≠ 0, naming the status | status named | `:151-155`, `:269`. The faithful pre-S4 W3 (accept-all validator plus key-only packager) gave exit 1, `expected FAILED (FORMATO_INVALIDO), observed COMPLETED`. A non-terminal request is named at `:269`: `M4` gave `is still RECEIVED after 60000 ms` | ✅ PASS |

### P5: CPU limit and thread count (RM-05)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 explicit CPU limit | declared `cpus` | `compose.yaml:53` `cpus: ${WORKER_CPUS:-2}`. Container `NanoCpus=2000000000` | ✅ PASS |
| AC2 threads from the same limit | `FFMPEG_THREADS` = limit | `compose.yaml:59`. `printenv FFMPEG_THREADS` in the container gives `2` | ✅ PASS |
| AC3 disagreement fails naming both | exit ≠ 0, both values | `scripts/check-worker-sizing.mjs:38-40`, now wired into `.github/workflows/ci.yml:36-37` and `tasks.md:39`. M7 is killed (full copy and CI-shaped copy): `worker cpus is 2 but FFMPEG_THREADS is 4; both must come from WORKER_CPUS` | ⚠️ PASS for config drift; **N2c (the comparison disabled) survives every gate** |

**Status**: ❌ discrimination gaps present. 23 of 23 ACs have `file:line` evidence and a matching observed outcome. 4 ACs (RM-05 AC3, RM-19 AC2, RM-19 AC3, RM-01 AC3) rest on enforcement code whose removal or neutralisation no gate detects.

---

## Edge Cases

- [x] **Bootstrap fails → Worker not started.** On a live stack I ran `worker` removed, then `mc anonymous set download`, then `up -d --wait`. Result: exit 1, `service "minio-init" didn't complete successfully: exit 1`, and `bucket local/fiapx allows anonymous access: {…"permission":"download"…}`. Worker containers: 0. On the same loosened bucket the smoke exits 1 with `Anonymous access allowed: GET …/sources/sample-8s.mp4 returned 200`.
- [x] **Stale volume without the lifecycle rule.** `mc ilm rule rm --all --force`, then `up`: exit 0, both rules re-added (`Lifecycle configuration rule added` ×2), and the smoke passed.
- [x] **Smoke run twice.** It ran three times on one stack, and again after the second `up`. All runs were green with distinct request ids. The key is scoped at `scripts/smoke-local-integration.mjs:308`. ⚠️ N9 (scope check reduced to a type check) survives, so nothing guards the scoping.
- [x] **FFmpeg unavailable where the fixture is generated.** Moot after T4 (the fixture is committed). The zero-byte guard is at `scripts/seed-source-video.mjs:49`.
- [x] **CPU limit above the engine's count → the sizing check fails first, naming both.** `scripts/check-worker-sizing.mjs:45-54`. `WORKER_CPUS=16` gave exit 1 naming 16 and 10. `WORKER_CPUS=11` gave exit 1. `WORKER_CPUS=10` gave exit 0. It runs before `up` in the Build gate (`tasks.md:39`) and in CI. ⚠️ N2 and N2b survive: no gate ever runs the check with a limit above NCPU, or at the boundary.

---

## Gate Check

- **Gate command**:
  - `node clean-appledouble.mjs` (workspace root).
  - Then, in `fiap-x-platform`: `docker compose config -q && node scripts/check-worker-sizing.mjs && docker compose up --build -d --wait && node scripts/seed-source-video.mjs && node scripts/smoke-local-integration.mjs && node scripts/smoke-local-integration.mjs --self-test`.
  - Then a second `up --build -d --wait` without `-v`, and the smoke again.
  - Then `docker compose down -v`.
- **Outcome**:
  - The first pass: clean 0, config 0, sizing 0, up 0 (18 s), seed 0, smoke 0 (4 s), self-test 0.
  - The second pass: up 0 (the bootstrap re-ran and reported `already configured` for both prefixes), smoke 0, and a third smoke 0.
  - After the edge-case probes: `down -v` 0, with no `fiap-x-platform` volumes left.
- **Summary lines**:
  - `worker cpus 2 matches FFMPEG_THREADS 2, within the engine's 10 CPUs`
  - `Storage refused anonymous GET of fiapx/sources/sample-8s.mp4 and of the fiapx listing (403)`
  - `Catalog reached COMPLETED for 5d8b8985-… with archive zips/5d8b8985-…/b25feaa6-…/frames.zip`
  - `Catalog reached FAILED (FORMATO_INVALIDO) for 43bd1096-…`
  - `Archive zips/5d8b8985-…/…/frames.zip holds 8 frames, as 8 s at 1 frame/s requires`
  - `No archive exists under zips/43bd1096-…/`
  - `Notification delivered once for 43bd1096-…: O arquivo enviado nao e um video MP4 ou MOV valido.`
  - `Self-test passed: 13 bad inputs rejected with the expected message, 7 good inputs accepted`
- **CI-shaped check** (platform checkout only, no siblings): `docker compose config` rendered, sizing 0, `node --check` 0, self-test 0. M7 gave sizing exit 1.
- **Before and after**: there are no unit tests. The smoke gains 2 assertions (anonymous 403 and temp-dir removal) and a 20-case self-test. The sizing check gains the NCPU comparison. Nothing was removed or weakened.
- **CI**: the `integration` job still self-skips without `SERVICES_READ_TOKEN` (V11, out of scope), so the end-to-end smoke is proved only locally. The `topology` job now runs sizing and the self-test.

---

## Discrimination Sensor

**Method.** The platform was `rsync`ed (`--exclude .git`) into a scratchpad copy named `fiap-x-platform`, with the four siblings symlinked beside it. The project name is therefore the same, and the built images were reused. A pristine copy was restored before every mutant. Each edit went through a helper that aborts unless the pattern occurs exactly once.

- **Script mutants** ran against a live scratch stack: sizing, seed, smoke and `--self-test`.
- **`compose.yaml` and bootstrap mutants** ran the full gate each time: `down -v`, then `config -q`, sizing, `up --build -d --wait`, seed, smoke and self-test.
- **Worker faults** used throwaway images `FROM fiap-x-platform-worker`, with a guarded patch of `/app/dist/…`. The scratch `compose.yaml` pointed the worker at the patched image (`build:` → `image:`), and each ran the full gate.
- **Control.** An unmutated control run was fully green.

**Isolation.** The real tree's `git status --porcelain` was byte-identical before and after (empty), and HEAD is still `58b7cdd`. All siblings are clean at the same HEADs. The scratch copies, the 6 sensor images and every leaked `fiapx-smoke-*` directory were removed. No `git stash` was used.

### Round-1 mutants (re-injected)

| # | File:line | Mutation | Caught by | Killed? |
| --- | --- | --- | --- | --- |
| M1 | `scripts/smoke-local-integration.mjs:13` | `FIXTURE_SECONDS` 8 → 7 | smoke `holds 8 entries, expected 7`; self-test `frame count 7: accepted` | ✅ |
| M2 | `:104` | count comparison → `if (false)` | self-test `frame count 16: accepted`, `frame count 7: accepted` (the smoke alone is green) | ✅ |
| M3 | `:151` | `assertRejected` returns early on `COMPLETED` | self-test `rejected request observed COMPLETED: accepted` | ✅ |
| M4 | `minio/bootstrap.sh:30` | retention loop drops `zips/` | `up` exit 1 (minio-init), Worker not started, smoke timeout | ✅ |
| M5a | `minio/bootstrap.sh:18` | `mc anonymous set download` before the assertion | `up` exit 1; smoke `Anonymous access allowed … 200` | ✅ |
| M5b | `minio/bootstrap.sh:49` (end) | `mc anonymous set download` after all checks | smoke exit 1: `Anonymous access allowed: GET …/sources/sample-8s.mp4 returned 200` | ✅ (survived in round 1) |
| M6 | `compose.yaml:69-70` | Worker no longer depends on `minio-init` | `up --wait` exit 1: `container …minio-init-1 exited (0)` | ✅ (incidental mechanism, as in round 1) |
| M6c | `compose.yaml:70` | condition → `service_started` | `up --wait` exit 1, same mechanism | ✅ |
| M7 | `compose.yaml:59` | `FFMPEG_THREADS=4` | sizing exit 1 in the full copy and the CI-shaped copy: `worker cpus is 2 but FFMPEG_THREADS is 4` | ✅ (now in the Build gate and CI) |
| M8 | `scripts/smoke-local-integration.mjs:48` | EOCD parser returns 0 | smoke `Archive empty`; self-test | ✅ |
| M9 | `scripts/seed-source-video.mjs:75` | seed prints the non-video key first | smoke `for the video: expected COMPLETED, observed FAILED (FORMATO_INVALIDO)` | ✅ |
| M10 | `scripts/smoke-local-integration.mjs:71` | `rmSync` removed | smoke `Downloaded artefact left behind: …/fiapx-smoke-1hY83Z still exists after cleanup`; self-test | ✅ (survived in round 1) |
| M11 | `:160` | `deliveries !== 1` → `< 1` | self-test `2 deliveries: accepted` | ✅ |
| M12 | `:140` | no-archive check → `if (false)` | self-test `archive present for the rejected request: accepted` | ✅ |
| W1 | Worker `dist/media/ffmpeg-frame-extractor.js` | `fps=1` → `fps=2` | smoke `holds 16 entries, expected 8` | ✅ |
| W2 | Worker `dist/processing/media-frame-packager.js` | upload removed (stores nothing) | smoke `Archive absent … Object does not exist.` | ✅ |
| W3 | Worker packager + `dist/validation/ffprobe-video-validator.js` | pre-S4: validator accepts all, packager returns the key only | smoke `for the non-video: expected FAILED (FORMATO_INVALIDO), observed COMPLETED` | ✅ |
| W4 | Worker packager | uploads a valid 0-entry ZIP | smoke `Archive empty … holds 0 entries, expected 8` | ✅ |
| W5 | Worker packager | uploads non-ZIP bytes | smoke `Archive unreadable … no End of Central Directory record` | ✅ |

**Round-1 set: 19/19 killed.** A first W3 variant, which kept the real packager, was also killed but by `observed FAILED (PROCESSAMENTO_FALHOU)`. It was replaced by the faithful pre-S4 binding above.

### Round-2 mutants (new, aimed at T12–T16)

| # | File:line | Mutation | Caught by | Killed? |
| --- | --- | --- | --- | --- |
| N1a | `scripts/smoke-local-integration.mjs:376` | self-test expected message for `archive empty` weakened to the generic mismatch text | self-test `archive empty: rejected with "Archive empty…", expected "Archive frame count mismatch…"` | ✅ |
| N1b | `:421` | self-test accepts any thrown message (`err.message !== expected` → `false`) | nothing | ❌ Survived (mutant of the test harness itself; informational) |
| N1b+Nempty | `:421` + `:101-103` | N1b plus the empty branch deleted (a 0-entry archive is reported as a generic mismatch) | nothing: the gate is green and RM-06 AC3 "say which" is violated | ❌ Survived (second-order; shows discrimination rests on the exact-message compare) |
| Nempty | `:101-103` | empty branch deleted | self-test `archive empty: rejected with "Archive frame count mismatch…"` | ✅ |
| N2 | `scripts/check-worker-sizing.mjs:52` | NCPU comparison → `if (false)` | nothing: sizing, smoke and self-test all 0 | ❌ Survived |
| N2b | `scripts/check-worker-sizing.mjs:52` | `cpuCount > engineCpus` → `>=` (rejects the valid `WORKER_CPUS=10` on 10 CPUs) | nothing | ❌ Survived |
| N2c | `scripts/check-worker-sizing.mjs:38` | pairing comparison → `if (false)` | nothing | ❌ Survived |
| N3 | `scripts/smoke-local-integration.mjs:180,183` | anonymous check accepts 200 | self-test `anonymous GET of the object answered 200: accepted` (and the listing) | ✅ |
| N3w | `:294` | call to `checkAnonymousAccess` removed | nothing | ❌ Survived |
| N4 | `:73` | `assertScratchRemoved(dir, existsSync(dir))` → `(dir, false)` | nothing: `rmSync` still removes the dir | ➖ Equivalent alone |
| N4+M10 | `:71` + `:73` | leak check neutralised and removal deleted | self-test `8-frame archive, scratch directory removed: rejected a good input with "…fiapx-smoke-tkPqEs still exists"` (the smoke alone is green and leaks) | ✅ |
| N4b | `:56` | `assertScratchRemoved` → never throws | self-test `temp directory remaining: accepted` | ✅ |
| N5 | `:314` | call to `assertRejected` removed | nothing | ❌ Survived |
| N6 | `:325` | RM-19 AC2 sentence/status check on the delivery → `if (false)` | nothing | ❌ Survived |
| N7 | `:319` | call to `assertNoArchive` removed | nothing | ❌ Survived |
| N8 | `:330` | call to `assertSingleDelivery` removed | nothing | ❌ Survived |
| N9 | `:308` | `zipStorageKey` scope check reduced to a type check | nothing | ❌ Survived |

**Round-2 set: 17 mutants, 5 killed and 12 survived.** Not every survivor is a real gap:

- **N4** is equivalent.
- **N1b and N1b+Nempty** mutate the self-test itself, so no checker can kill them alone. They are recorded, not counted.
- **The 9 non-equivalent survivors are N2, N2b, N2c, N3w, N5, N6, N7, N8 and N9.**

**Sensor depth**: expanded, 36 mutations (14 platform and 5 Worker faults from round 1, plus 17 new).
**Result**: 24/36 killed. There are 9 non-equivalent, non-meta survivors. **FAIL ❌**

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / surgical / no scope creep | ✅ T12–T17 touch only the sizing script, the smoke, `ci.yml`, the spec/tasks/design text and the README |
| Matches patterns | ✅ Dependency-free `node:` scripts; failure messages keep the existing `check-worker-sizing:` and named-cause styles |
| Spec-anchored outcome check | ✅ Every asserted value is exact: 8, 7 days, `private`, 403, `FORMATO_INVALIDO`, the exact sentence, `=== 1`, NCPU |
| Every check maps to a requirement | ✅ The self-test cases map to RM-06 AC2–AC4, RM-19 AC2–AC3 and RM-01 AC3 |
| Tests non-shallow / discriminating | ❌ The sizing script has no negative test in any gate (N2, N2b, N2c). Two inline smoke assertions and every `main()` call site are unguarded (N3w, N5–N9) |
| Documentation accuracy | ⚠️ `README.md:52` says the self-test covers "every assertion above". It covers the helpers, not the delivery sentence (`:325`), the key scope (`:308`), or the calls in `main()` |
| Documented guidelines | The `tasks.md` Test Coverage Matrix and Gate Check Commands. The Build gate row (`tasks.md:39`) omits `--self-test`, so under the documented Build gate M2, M3, M11 and M12 would still pass; only CI's `topology` job kills them |

---

## Fix Plans

### Fix 1: Give the sizing check a self-test (Major; RM-05 AC3 and the CPU edge case)

- **Root cause**: the check's comparisons (`scripts/check-worker-sizing.mjs:38`, `:52`) are exercised only with a matching config inside the engine's range, so disabling or shifting them changes no gate outcome (N2, N2b, N2c).
- **Fix task**: factor the decision into a pure function of `(cpus, threads, engineCpus)`, and add `--self-test`. It must reject 2/4 (pairing) and 16 on 10 CPUs, and 11 on 10 CPUs (boundary), each by its exact message. It must accept 2/2 on 10 CPUs and 10/10 on 10 CPUs. Run it in CI's `topology` job and in the Build gate.
- **Done when**: N2, N2b and N2c each turn the self-test red.

### Fix 2: Bring the inline smoke assertions under the self-test (Major; RM-19 AC2, the "smoke twice" edge case)

- **Fix task**: move the delivery status and sentence check (`scripts/smoke-local-integration.mjs:325-329`) and the `zipStorageKey` scope check (`:308-310`) into helpers, and add bad-input cases for each: a wrong sentence, a `COMPLETED` delivery, a key under another request's prefix, and a non-string key. Also cover the video `COMPLETED` check at `:302`.
- **Done when**: N6 and N9 turn the self-test red.

### Fix 3: Prove that `main()` calls each assertion (Minor)

- **Root cause**: the self-test calls the helpers directly, so removing a call site in `main()` (N3w, N5, N7, N8) is invisible.
- **Fix task**: pick one and record it:
  - Drive `main()`'s sequence from a single table of (observation → assertion) that the self-test iterates.
  - Or add a self-test case that runs `main()` against injected fakes for fetch, docker and psql, returning each bad observation.
  - Or accept the residual explicitly in the spec with a rationale.
- **Done when**: N3w, N5, N7 and N8 are killed, or the accepted residual is written down.

### Fix 4: Put the self-test in the documented Build gate (Minor)

- **Fix task**: add `node scripts/smoke-local-integration.mjs --self-test`, and the sizing self-test from Fix 1, to `tasks.md:39`. Correct `README.md:52` to what the self-test actually covers.
- **Done when**: M2 fails the Build gate as documented, not only CI.

---

## Spec-Precision Gaps

1. **The CPU edge case says "SHALL fail before the stack starts"** (`spec.md:158`). This holds only because of gate order: the check is a separate script, and a bare `docker compose up` still fails with the daemon's own message. The spec should name the gate, or say "when the sizing check runs".
2. **P5 AC3 says "the topology check"** (`spec.md:146`). The enforcing artefact is `scripts/check-worker-sizing.mjs` in CI `topology` and the Build gate. This is acceptable, but the term is not defined in the spec.
3. **Three assumption rows remain `Confirmed? n`** (`spec.md:41-43`: the CPU default, MinIO credentials and the bucket layout). They are implemented as stated, but they were never confirmed.
4. **RM-01 AC3 asserts 403 exactly** (`scripts/smoke-local-integration.mjs:183`). The spec says only "refused". The stricter assertion is fine; recorded for precision.

Round-1 gaps 1–5 are closed: RM-19 AC2 text, fixture rows, T2 `private`, the CPU edge case, and RM-06 AC4 now observable.

---

## Requirement Traceability Update

The Verifier does not edit `spec.md`. Recommended statuses:

- RM-01, RM-02, RM-03, RM-04 and RM-06: ✅ Verified. For RM-01 and RM-06, N3w and N9 are Minor follow-ups.
- RM-05: ❌ Needs Fix (Fix 1). The check is wired, but its logic is not discriminated.
- RM-19: ❌ Needs Fix (Fix 2). The AC2 sentence check is undiscriminated; see Fix 3 for the call sites.

---

## Summary

**Overall**: ❌ Not Ready (round 2 of at most 3).
**Spec-anchored check**: 23/23 ACs have evidence and matching observed outcomes. All 5 edge cases hold at runtime. 4 spec-precision notes.
**Sensor**: 24/36 killed. All 19 round-1 mutants are killed, and all six round-1 survivors are closed. 12 of the 17 new mutants survive: 9 real, 1 equivalent, and 2 in the test harness itself.
**Gate**: green on both passes. The bootstrap is idempotent, the sizing check is in CI and in the Build gate, and the self-test is in CI.

**What works**:
- The private bucket is now proved from outside at the end state (M5b killed).
- The cleanup is observed (M10 killed).
- The round-1 assertion mutants (M2, M3, M11, M12) are killed permanently by a CI self-test that pins exact messages.
- The sizing check refuses a limit above NCPU, naming both values.
- The pre-S4 Worker turns the smoke red with `observed COMPLETED`.

**Next steps**: Fixes 1 and 2 are required. Fix 3 must be fixed, or accepted in writing. Fix 4 is a text fix. Then re-verify (round 3).
