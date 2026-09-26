# Real Media Processing Validation — platform (Round 3)

**Date**: 2026-09-25
**Spec**: `.specs/features/real-media-processing/spec.md`
**Diff range**: `f225e2e..b2f40f9` (`feat/real-media-processing`). This round re-derives the whole range. It adds the round-2 fix batch `6845ad9..b2f40f9`: T18 `6845ad9`, T19 `244c359`, T20 `de58e6d`, T21 `780579e` and T22 `b2f40f9`.
**Verifier**: independent sub-agent, round 3 of 3 (author ≠ verifier). I trusted neither the round-1/2 reports nor the T18–T22 evidence text. Every claim below was re-run.
**Environment**: Docker Desktop 29.6.2, an engine with 10 CPUs, Node 22.22.3. The sibling repos were `processing-worker` `feat/real-media-processing@a0aaa4a`, `processing-catalog` `main@696029d`, `notification-service` `main@256f1a0` and `fiap-x-api` `main@cb1dbab`. All were clean before and after.

**Result**: FAIL. The gates are green: the documented Build gate, a second `up` without `-v`, and the CI `topology` job in a platform-only copy. All 23 ACs and 5 edge cases have `file:line` evidence and an observed outcome. All 19 round-1 mutants are killed. All 9 round-2 real-gap survivors are now killed (N2, N2b, N2c, N3w, N5, N6, N7, N8, N9).

However, 13 of 48 round-3 mutants disable or weaken real enforcement and pass every gate. They fall into four root causes:

1. **`main()` of the smoke is outside the self-test.** `main()` can run a subset of `SMOKE_STEPS`, and the self-test still passes (R3d, R3e). With `SMOKE_STEPS.slice(0, 6)`, the smoke exits 0 after `Catalog reached COMPLETED`. It never checks the rejection, the archive count, the no-archive listing or the deliveries. T20 moved the round-2 N5-class gap into one line; it did not close it.
2. **Exit status on failure is unproven in all three scripts (R7e, R8a, R8b).**
   - The smoke's `main().catch` without `process.exitCode = 1`: with W1 (16 frames), the smoke prints `holds 16 entries, expected 8` and **every gate exits 0**.
   - The sizing `fail()` without `process.exit(1)`: with M7 (`FFMPEG_THREADS=4`), the check prints the mismatch and exits 0, so CI's `topology` job would pass.
   - The seed's `fail()` without exit: with MinIO stopped, it exits 0.
3. **Observes are not under test (R1a, R1b, R1c, R7b).** The realistic one is R1b: `single delivery` counts `ctx.id` (the video) instead of `ctx.rejectedId`. That passes every gate, so a duplicate delivery for the rejected request would go unseen.
4. **The delivery sentence is not discriminated against near-misses (R5a, R5b, R5c, R5e).** A prefix, `startsWith`, truncated or case-insensitive compare passes, because the only wrong-sentence case (`Nao foi possivel processar o video.`) shares no prefix with the expected one.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1–T17 | ✅ Done | Re-verified by the gate run and the sensor below. |
| T18 | ✅ Done | `scripts/check-worker-sizing.mjs:23-42` holds `pairingProblem` and `engineCapacityProblem`, and `:82-165` holds the self-test (12 bad, 7 good). N2, N2b and N2c are killed. |
| T19 | ✅ Done, with a gap | `scripts/smoke-local-integration.mjs:166-188` holds `assertCompleted`, `assertArchiveKeyScoped` and `assertDeliverySentence`, and the self-test cases are at `:528-539`. N6 and N9 are killed. The key-scope near-misses R6a–R6d are killed. Gap: the sentence check survives prefix, `startsWith`, truncated and case-insensitive compares (R5a/b/c/e). |
| T20 | ⚠️ Done, but the claim is partial | `SMOKE_STEPS` is at `:340-441`, `runSteps` at `:443-449`, `REQUIRED_STEPS` at `:467-477`, and the presence check at `:618-622`. Removing a step (N3w/N5/N7/N8) and swallowing a check in `runSteps` (R2a–R2c) are killed. Gaps:<br>• nothing proves `main()` runs the whole list (R3d/R3e)<br>• nothing proves an observe reads the right thing (R1a–R1c)<br>• the `observed()` guard (`:331-334`) is itself untested (R7a alone is equivalent; R7b survives) |
| T21 | ✅ Done, with drift | The Build gate row (`tasks.md:39`) runs both self-tests. Two README drifts:<br>• `README.md:52` says an observation "is proved only by the real run". A real run against a correct stack does not prove it (R1b).<br>• `README.md:98` says the sizing self-test "does not test reading `docker compose config` or `docker info`". Since T22 it drives `main()` over simulated output of both, so that text is stale. |
| T22 | ✅ Done, with a gap | `main({ exec, fail, log })` is at `scripts/check-worker-sizing.mjs:47-78`, and `runMain` at `:112-128`. Every bypass of the injected path is killed: R4a, R4b, R4c, R4d, R4e, R4f, R4g, R4h and R4i. Gap: the default `fail` (`:16-19`) is outside the seam, so dropping its `process.exit(1)` survives (R8a). |

---

## Spec-Anchored Acceptance Criteria

### P1: Object storage in the local topology (RM-01, RM-02)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 storage healthy before the Worker | storage ready, then the Worker | The chain `compose.yaml:166` (`mc ready local`) → `:183-185` (init waits `service_healthy`) → `:69-70` (the Worker waits `service_completed_successfully`). The config renders `{'minio-init': {'condition': 'service_completed_successfully'}}`. M6 and M6c are killed by `up --wait` exit 1. M13 (healthcheck → `true`) is equivalent: the init's `mc` calls still require a serving MinIO | ✅ PASS |
| AC2 bucket `fiapx` exists | bucket `fiapx` | `compose.yaml:180`, `minio/bootstrap.sh:12`. Log: ``Bucket created successfully `local/fiapx`.`` | ✅ PASS |
| AC3 deny anonymous access | refused without credentials | At bootstrap: `minio/bootstrap.sh:18-22` requires `"permission":"private"`. At the end state: `scripts/smoke-local-integration.mjs:212-219`, step `anonymous access` at `:350-360`. `curl` gave 403 on the object, on `fiapx/` and on `not-a-video.mp4`. M5a, M5b, N3 and N3w are killed | ✅ PASS (R1a, a fabricated observe, survives; see gap 3) |
| AC4 existing bucket unaltered | success, no change | `minio/bootstrap.sh:12` (`--ignore-existing`), `:33-35` (guard). The second `up` gave exit 0, with `retention on sources/ already configured` and `retention on zips/ already configured`, and objects were kept. M15 (drop `--ignore-existing`) is killed by the second `up` | ✅ PASS |
| AC5 credentials via env | env only | `compose.yaml:62-65`, `:156-157`, `:179` | ✅ PASS |

### P2: Retention (RM-03)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 7-day lifecycle | expire at 7 days | `minio/bootstrap.sh:37`. The read-back at `:42-48` requires 2 rules at 7 days. `ilm rule ls` shows `sources/ 7` and `zips/ 7`. M14 (30 days) is killed at `up` | ✅ PASS |
| AC2 existing rule kept | success, no duplicate | `minio/bootstrap.sh:33-35`. After the second `up`, there is still exactly 1 rule per prefix | ✅ PASS |
| AC3 both prefixes | `sources/` and `zips/` | `minio/bootstrap.sh:30`. M4 is killed at `up` (minio-init exit 1) | ✅ PASS |

### P3: A real video, seeded (RM-04)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 readable MP4 under `sources/`, key printed | key on stdout | `scripts/seed-source-video.mjs:62-68`, `:75-76`. Output was `sources/sample-8s.mp4`, and that key produced the 8-frame archive. M9 is killed | ✅ PASS |
| AC2 twice leaves one object at that key | exactly one | The fixed key at `scripts/seed-source-video.mjs:20`. After the standalone seed plus the smoke's seed, `mc ls sources/` shows one `sample-8s.mp4` | ✅ PASS (⚠️ spec precision: R8c) |
| AC3 unreachable → non-zero naming the service | exit ≠ 0, service named | `scripts/seed-source-video.mjs:53-59`. With MinIO stopped: exit 1, `object storage (compose service "minio", http://minio:9000) is unreachable` | ✅ PASS on the code as written (R8b, the exit dropped, survives; see gap 2) |
| AC4 fixture states duration and fps | derivable count | `fixtures/README.md:9-11`, `scripts/smoke-local-integration.mjs:11-15` | ✅ PASS |

### P4: The smoke proves a ZIP (RM-06)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 download at `zipStorageKey`, readable | fetched and parsed | `scripts/smoke-local-integration.mjs:376-380` (the key scoped to `zips/<id>/`), `:389-402` (transfer and parse), `:117-136` | ✅ PASS |
| AC2 entries = 8 | 8 | `:13-15`, `:109-111`. Self-test cases are at `:502-505` and `:594-595`. M1, M2 and W1 are killed | ✅ PASS |
| AC3 absent / unreadable / empty, named, exit ≠ 0 | three messages, exit ≠ 0 | `:90` `Archive absent`, `:102` `Archive unreadable`, `:107` `Archive empty`. End to end: W2 `Archive absent`, W5 `Archive unreadable`, W4 `Archive empty`. Exit status: `:658-661` | ⚠️ The messages are enforced. **The exit ≠ 0 is not guarded**: R7e survives, and W1+R7e has every gate green |
| AC4 no downloaded artefact left | dir gone | `:66-84` (`withScratchDir`), and the `no leftovers` step at `:431-440`. 0 `fiapx-smoke-*` remained after all runs. M10, N4+M10 and N4b are killed | ✅ PASS |

### P6: The smoke proves a rejection (RM-19)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 non-video seeded, second request | 2 requests | `scripts/seed-source-video.mjs:21-22`, `:70-73`; `scripts/smoke-local-integration.mjs:361-368` | ✅ PASS |
| AC2 `FAILED`/`FORMATO_INVALIDO`, and the exact sentence on the delivery | `O arquivo enviado nao e um video MP4 ou MOV valido.` | Code: `:159-163`, step `:381-388`. Sentence: `:182-188`, step `:416-422`. Observed: `Notification delivered once for …: O arquivo enviado nao e um video MP4 ou MOV valido.` N6 and R5d are killed | ⚠️ **"exact" is not discriminated**: R5a, R5b, R5c and R5e survive |
| AC3 no archive and exactly one delivery | 0 objects, 1 row | `:148-155` with step `:403-410`; `:192-207` with step `:423-430`. Delivery rows: 1 per request. M11, M12, N7 and N8 are killed | ⚠️ R1b (counts the video's id) and R1c (fabricated listing) survive |
| AC4 `COMPLETED` or non-terminal → exit ≠ 0 naming the status | status named | `:159-163`, `:308`. W3 (pre-S4): `expected FAILED (FORMATO_INVALIDO), observed COMPLETED`. M4: `is still RECEIVED after 60000 ms` | ✅ PASS on the message (exit status: see gap 2) |

### P5: CPU limit and thread count (RM-05)

| Criterion | Spec-defined outcome | `file:line` + enforcement | Result |
| --- | --- | --- | --- |
| AC1 explicit CPU limit | `cpus` | `compose.yaml:53`, with the container at `NanoCpus=2000000000` | ✅ PASS |
| AC2 threads from the same limit | `FFMPEG_THREADS` = the limit | `compose.yaml:59`, and `printenv FFMPEG_THREADS` = `2` | ✅ PASS |
| AC3 disagreement fails, naming both | exit ≠ 0, both values | `scripts/check-worker-sizing.mjs:23-32`, `:64-65`, `.github/workflows/ci.yml:36-39`, `tasks.md:39`. M7 and R8d are killed. N2c and R4d are killed | ⚠️ **The exit ≠ 0 is not guarded**: with R8a+M7, the check prints `worker cpus is 2 but FFMPEG_THREADS is 4` and exits 0 |

**Status**: ❌. 23 of 23 ACs have `file:line` evidence and a matching observed outcome on the real code. However, 6 ACs rest on enforcement whose weakening passes every gate: RM-06 AC3, RM-19 AC2, RM-19 AC3, RM-05 AC3, RM-04 AC3 and RM-01 AC3. Every smoke-driven AC is also exposed to the `main()` subset (R3e).

---

## Edge Cases

- [x] **Bootstrap fails, so the Worker does not start.** The sequence was: `rm -sf worker`, then `mc anonymous set download`, then `up -d --wait`. That gave exit 1, `service "minio-init" didn't complete successfully: exit 1`, and the Worker container at `state=created startedAt=0001-01-01T00:00:00Z`, never started. On the same bucket, the smoke exits 1 with `Anonymous access allowed … returned 200`.
- [x] **Stale volume without the lifecycle rule.** `mc ilm rule rm --all --force` then `up` gave exit 0 and `Lifecycle configuration rule added` twice, with 1 rule per prefix.
- [x] **Smoke run twice.** It ran 4 times on one stack, across 2 `up`s, and was green each time with distinct ids (`387cb8f2-…` and `fe9f119e-…`). Each archive sat under its own `zips/<id>/`. Scoping is at `scripts/smoke-local-integration.mjs:174-178`. N9 and R6a–R6d are killed.
- [x] **FFmpeg unavailable where the fixture is generated.** Moot (the fixture is committed). The zero-byte guard is at `scripts/seed-source-video.mjs:49`.
- [x] **CPU limit above the engine's count: the check fails first, naming both.** `scripts/check-worker-sizing.mjs:37-42`, `:67-75`. `WORKER_CPUS=11`: exit 1, `WORKER_CPUS is 11 but the Docker engine has only 10 CPUs; set WORKER_CPUS to at most 10`. `16`: exit 1. `10`: exit 0. N2, N2b, R4e and R4h are killed (the exit status carries R8a's caveat).

---

## Gate Check

- **Documented Build gate** (`tasks.md:39`), run exactly as written:
  - `node clean-appledouble.mjs` from `fiapx`: 0.
  - Then in `fiap-x-platform`:
    - `docker compose config -q`: 0
    - `node scripts/check-worker-sizing.mjs`: 0
    - `--self-test`: 0
    - `docker compose up --build -d --wait`: 0 (20 s)
    - `node scripts/seed-source-video.mjs`: 0
    - `node scripts/smoke-local-integration.mjs`: 0 (4 s)
    - `node scripts/smoke-local-integration.mjs --self-test`: 0
  - `docker compose down -v`: 0, run at the very end, after the sensor. No containers, volumes or sensor images were left.
- **Second `up` without `-v`**: 0. The bootstrap reported `already configured` for both prefixes. The smoke then ran twice, both 0, with distinct request ids.
- **CI `topology` job, platform-only copy** (a `git archive` of HEAD, no siblings):
  - `docker compose config > rendered-compose.yml`: 0
  - `8 services validated`
  - sizing: 0
  - sizing self-test: 0
  - `node --check`: 0
  - smoke self-test: 0
- **Summary lines**:
  - `worker cpus 2 matches FFMPEG_THREADS 2, within the engine's 10 CPUs`
  - `check-worker-sizing self-test passed: 12 bad inputs rejected with the expected message, 7 good inputs accepted`
  - `Storage refused anonymous GET of fiapx/sources/sample-8s.mp4 and of the fiapx listing (403)`
  - `Catalog reached COMPLETED for 3e709124-… with archive zips/3e709124-…/389d1e19-…/frames.zip`
  - `Catalog reached FAILED (FORMATO_INVALIDO) for 7916a631-…`
  - `Archive zips/3e709124-…/…/frames.zip holds 8 frames, as 8 s at 1 frame/s requires`
  - `No archive exists under zips/7916a631-…/`
  - `Notification delivered once for 7916a631-…: O arquivo enviado nao e um video MP4 ou MOV valido.`
  - `No downloaded artefact left behind (1 scratch directory removed)`
  - `Self-test passed: 9 required steps present, 28 bad inputs rejected with the expected message, 20 good inputs accepted`
- **Before and after**: nothing was removed or weakened. The smoke self-test grew from 13 bad / 7 good (round 2) to 28 bad / 20 good plus 9 step-presence checks. The sizing self-test is new: 12 bad / 7 good.
- **CI**: the `integration` job still self-skips without `SERVICES_READ_TOKEN` (V11, out of scope).

---

## Discrimination Sensor

**Method.**
- **Copies.** A `git archive b2f40f9` pristine copy was restored (`rsync --delete`) before every mutant. The sensor copy was named `fiap-x-platform`, with the four siblings symlinked, so the Compose project and built images were shared.
- **Edits.** Each edit went through a Node helper that aborts unless the pattern occurs exactly once. Script mutants ran the sizing check, both self-tests and, where relevant, the seed and the smoke against a live stack.
- **Stack mutants.** Compose and bootstrap mutants ran `down -v`, `config -q`, `up --build -d --wait`, then the same checks.
- **Worker faults.** These used throwaway images `FROM fiap-x-platform-worker`, with an exact-once patch of `/app/dist/…`, bound through `image:` in the scratch `compose.yaml`.
- **Controls.** An unmutated control was green both quick and full.

**Isolation.**
- The real tree's `git status --porcelain` was identical before and after (empty). HEAD is `b2f40f9`.
- The siblings' porcelain was unchanged, at the same HEADs.
- The scratch copies, the 5 fault images and every leaked `fiapx-smoke-*` directory were removed.
- `git stash` was not used.

Legend: **K** killed. **S-real**: a survivor that weakens spec enforcement unseen. **S-eq**: equivalent. **S-harness**: the mutation is inside a self-test's own expectations or reporting.

### Round-1 mutants (re-injected)

| # | Mutation | Caught by | Verdict |
| --- | --- | --- | --- |
| M1 | `FIXTURE_SECONDS` 8 → 7 (`smoke:13`) | self-test `frame count 7: accepted`; smoke `holds 8 entries, expected 7` | K |
| M2 | count comparison → `if (false)` (`smoke:109`) | self-test `frame count 16/7: accepted`, `step "archive count" … accepted` (the smoke alone is green) | K |
| M3 | `assertRejected` returns on `COMPLETED` (`smoke:159`) | self-test `rejected request observed COMPLETED: accepted`, `step "rejection" …` | K |
| M4 | retention loop drops `zips/` (`bootstrap.sh:30`) | `up` exit 1 (minio-init); smoke `still RECEIVED after 60000 ms` | K |
| M5a | `anonymous set download` before the assertion (`bootstrap.sh:18`) | `up` exit 1; smoke `Anonymous access allowed … 200` | K |
| M5b | `anonymous set download` after all checks (`bootstrap.sh:49`) | smoke exit 1 `Anonymous access allowed … 200` | K |
| M6 | the Worker does not depend on minio-init (`compose.yaml:69-70`) | `up --wait` exit 1, `minio-init-1 exited (0)` (an incidental mechanism, as in rounds 1–2) | K |
| M6c | condition → `service_started` (`compose.yaml:70`) | same | K |
| M7 | `FFMPEG_THREADS=4` (`compose.yaml:59`) | sizing exit 1 `worker cpus is 2 but FFMPEG_THREADS is 4` | K |
| M8 | EOCD returns 0 (`smoke:48`) | self-test (count cases get `Archive empty`); smoke `Archive empty` | K |
| M9 | seed prints the non-video key first (`seed:75`) | smoke `for the video: expected COMPLETED, observed FAILED (FORMATO_INVALIDO)` | K |
| M10 | `rmSync` removed (`smoke:76`) | self-test (leak appended); smoke `Downloaded artefact left behind` | K |
| M11 | `deliveries !== 1` → `< 1` (`smoke:193`) | self-test `2 deliveries: accepted` | K |
| M12 | no-archive check → `if (false)` (`smoke:149`) | self-test `archive present for the rejected request: accepted` | K |
| W1 | Worker `fps=1` → `fps=2` | smoke `holds 16 entries, expected 8` | K |
| W2 | Worker upload removed | smoke `Archive absent … Object does not exist.` | K |
| W3 | pre-S4: validator accepts all, packager returns the key only | smoke `for the non-video: expected FAILED (FORMATO_INVALIDO), observed COMPLETED` | K |
| W4 | Worker uploads a valid 0-entry ZIP | smoke `Archive empty … holds 0 entries, expected 8` | K |
| W5 | Worker uploads non-ZIP bytes | smoke `Archive unreadable … no End of Central Directory record` | K |

**Round 1: 19/19 killed.**

### Round-2 mutants (re-injected, adapted to the step-list structure)

| # | Mutation | Caught by | Verdict |
| --- | --- | --- | --- |
| N1a | self-test expectation for `archive empty` weakened to the mismatch text | self-test `archive empty: rejected with "Archive empty…"` | K |
| N1b | self-test exact-message compare → `if (false)` (`smoke:628`) | nothing | S-harness (the self-test's own comparison) |
| N1b+Nempty | N1b plus the empty branch deleted | nothing | S-harness (second-order, rests on N1b) |
| Nempty | empty branch deleted (`smoke:106-108`) | self-test `archive empty: rejected with "Archive frame count mismatch…"` | K |
| N2 | engine comparison → `if (false)` (`sizing:38`) | sizing self-test `cpus 16 … accepted`, `cpus 11 … accepted`, `main: cpus 11 … accepted` | K (survived in round 2) |
| N2b | `>` → `>=` (`sizing:38`) | sizing self-test `cpus 10 on a 10-CPU engine (equal): rejected a good input` | K (survived in round 2) |
| N2c | pairing comparison → `if (false)` (`sizing:28`) | sizing self-test `threads 4 with cpus 2: accepted`, `main: threads 4 …` | K (survived in round 2) |
| N3 | anonymous check accepts 200 (`smoke:213,216`) | self-test (object, listing, step) | K |
| N3w | step `anonymous access` removed from `SMOKE_STEPS` | self-test `required step "anonymous access" is missing …` | K (survived in round 2) |
| N3w-call | `anonymous access` check body emptied | self-test `step "anonymous access" given a bad observation: accepted` | K |
| N4 | `assertScratchRemoved(dir, false)` in `withScratchDir` | nothing | S-eq (`rmSync` still removes the dir) |
| N4+M10 | N4 plus `rmSync` removed | self-test `8-frame archive, scratch directory removed: rejected a good input`; smoke | K |
| N4b | `assertScratchRemoved` never throws | self-test `temp directory remaining: accepted`, `step "no leftovers" …` | K |
| N5 | step `rejection` removed | self-test `required step "rejection" is missing …` | K (survived in round 2) |
| N5-call | `rejection` check → no-op | self-test `step "rejection" given a bad observation: accepted` | K |
| N6 | sentence/status check → `if (false)` (`smoke:183`) | self-test `delivery with another sentence: accepted`, `delivery observed COMPLETED: accepted` | K (survived in round 2) |
| N7 | step `no archive` removed | self-test `required step "no archive" is missing …` | K (survived in round 2) |
| N8 | step `single delivery` removed | self-test `required step "single delivery" is missing …` | K (survived in round 2) |
| N9 | key-scope check reduced to the type check (`smoke:175`) | self-test `archive key under another request: accepted`, `… extends this one: accepted` | K (survived in round 2) |

**Round 2: 19 mutants (the 17 of the round-2 report plus 2 check-body variants), 16 killed, 3 survived (2 S-harness, 1 S-eq). All 9 round-2 real-gap survivors are killed.**

### Round-3 mutants (new, aimed at T18–T22)

| # | Aim | Mutation | Caught by | Verdict |
| --- | --- | --- | --- | --- |
| R1a | observe reads nothing real | `anonymous access` observe fabricates 403 for both URLs (`smoke:353`) | nothing | **S-real** (RM-01 AC3 is no longer observed) |
| R1b | observe reads nothing real | `single delivery` observe counts `ctx.id` instead of `ctx.rejectedId` (`smoke:426`) | nothing | **S-real** (RM-19 AC3: the rejected request's delivery count is never read; a realistic slip) |
| R1c | observe reads nothing real | `no archive` observe stores `''` (`smoke:406`) | nothing | **S-real** (RM-19 AC3) |
| R1d | observe reads nothing real | `rejection` observe polls `ctx.id` (`smoke:384`) | smoke `for the non-video: expected FAILED (FORMATO_INVALIDO), observed COMPLETED` | K |
| R1e | observe reads nothing real | `no leftovers` observe stores `[]` (`smoke:434`) | nothing | S-eq (`withScratchDir` `:76-81` asserts removal immediately; the step is a redundant second check) |
| R1f | observe removed | `anonymous access` observe deleted | smoke `Nothing was observed for anonymous; …` | K |
| R1g | observe reads nothing | `anonymousStatuses` iterates `[]` (`smoke:228`) | smoke `Anonymous GET … returned undefined, expected 403` | K |
| R2a | `runSteps` swallows a check | `try { step.check(ctx) } catch {}` (`smoke:446`) | self-test (all 9 `step "…" given a bad observation: accepted`) | K |
| R2b | `runSteps` swallows a check | the same, but logging `err.message` | self-test | K |
| R2c | `runSteps` skips checks | `if (step.check && step.observe)` | self-test | K |
| R2d | `runSteps` does not await | `observe` not awaited (`smoke:445`) | smoke `Nothing was observed for anonymous` | K |
| R3a | required list shortened | `'rejection'` dropped from `REQUIRED_STEPS` (`smoke:471`) | nothing | S-harness (the self-test's own list; product unchanged) |
| R3b | required list shortened | R3a plus the `rejection` step removed from `SMOKE_STEPS` | self-test `step "rejection" given a bad observation: rejected with "step \"rejection\" is missing …"` | K (the step-rejection table double-covers the list) |
| R3c | required list shortened | `REQUIRED_STEPS = []` | nothing (`0 required steps present`) | S-harness |
| R3d | main runs a subset | `runSteps(SMOKE_STEPS.filter((s) => s.name !== 'single delivery'), {})` (`smoke:452`) | nothing | **S-real** (RM-19 AC3) |
| R3e | main runs a subset | `runSteps(SMOKE_STEPS.slice(0, 6), {})` (`smoke:452`) | nothing: the smoke exits 0 after `Catalog reached COMPLETED …` | **S-real** (RM-06 AC1–AC4 and RM-19 AC2–AC3 are never asserted) |
| R4a | injected exec bypassed | `compose config` via `spawnSync` (`sizing:49`) | sizing self-test `main: threads 4 with cpus 2: accepted`, … | K |
| R4b | injected exec bypassed | `docker info` via `spawnSync` (`sizing:67`) | sizing self-test `main: engine CPU count unreadable: accepted` | K |
| R4c | injected deps bypassed | `main()` ignores exec, fail and log | sizing self-test exit 1 (the real `fail` exits) | K |
| R4d | T22 call site | `if (pairing) fail(pairing);` deleted (`sizing:65`) | sizing self-test `main: threads 4 …: accepted`, `main: threads 0 …` | K |
| R4e | T22 call site | `if (capacity) fail(capacity);` deleted (`sizing:75`) | sizing self-test `main: cpus 11 …: accepted` | K |
| R4f | T22 guard | engine positive-integer guard deleted (`sizing:71-73`) | sizing self-test `main: engine CPU count unreadable: accepted` | K |
| R4g | T22 wiring | `pairingProblem(cpus, String(cpus))` | sizing self-test `main: threads 4 …`, `main: threads 0 …` | K |
| R4h | T22 wiring | capacity against `engineCpus + 1` | sizing self-test `main: cpus 11 …: accepted` | K |
| R4i | T22 wiring | threads read as `String(worker.cpus)` | sizing self-test `main: threads 4 …` | K |
| R5a | sentence prefix | `startsWith(REASON.slice(0, 17))` (`smoke:183`) | nothing | **S-real** (RM-19 AC2 "exact safe sentence") |
| R5b | sentence prefix | `String(reason).startsWith(REASON)` (accepts any suffix) | nothing | **S-real** (RM-19 AC2) |
| R5c | sentence prefix | `REASON.startsWith(String(reason ?? 'x'))` (accepts `''` or truncated) | nothing | **S-real** (RM-19 AC2) |
| R5d | sentence status half | status half dropped | self-test `delivery observed COMPLETED: accepted` | K |
| R5e | sentence case | case-insensitive compare | nothing | **S-real** (RM-19 AC2; trivial severity) |
| R6a | sibling prefix | trailing `/` dropped (`smoke:175`) | self-test `… whose id extends this one: accepted` | K |
| R6b | sibling prefix | first 8 characters of the id only | self-test `… extends this one: accepted` | K |
| R6c | sibling prefix | `zipKey.includes(id)` | self-test `… extends this one: accepted` | K |
| R6d | sibling prefix | any `zips/` key | self-test (3 cases) | K |
| R6e | sibling prefix | step passes `observed(ctx,'rejectedId') && observed(ctx,'id')` | nothing | S-eq (my mutant was malformed: the `&&` evaluates to `ctx.id`, so behaviour is identical) |
| R6f | sibling prefix | the step accepts a key under either this id or the rejected sibling's id (`smoke:378`) | nothing | S-eq in effect: a key under `zips/<rejectedId>/` makes the `no archive` step (`:403-410`) fail on the real stack |
| R7a | `observed()` guard | guard → `if (false)` (`smoke:332`) | nothing | S-eq alone (only matters when an observe is missing) |
| R7b | `observed()` guard | R7a plus the `no archive` observe deleted | nothing: `undefined` is falsy, so `assertNoArchiveListing` passes | **S-real** (second-order; the guard itself is untested) |
| R7c | archive check | `ctx.frames = EXPECTED_FRAMES` instead of `checkArchiveBytes` | self-test `step "archive count" given a bad observation: accepted` | K |
| R7d | self-test reporting | `process.exitCode = 1` removed from `selfTest` (`smoke:644`) | nothing | S-harness |
| R7e | smoke exit status | `process.exitCode = 1` removed from `main().catch` (`smoke:660`) | nothing. **W1+R7e: the smoke prints `holds 16 entries, expected 8`, and every gate exits 0** | **S-real** (RM-06 AC3, RM-19 AC4: "SHALL exit non-zero") |
| R8a | sizing exit status | `process.exit(1)` removed from the default `fail` (`sizing:18`) | nothing. **R8a+M7: it prints `worker cpus is 2 but FFMPEG_THREADS is 4 …` and exits 0**, so CI's `topology` job would pass | **S-real** (RM-05 AC3) |
| R8b | seed exit status | `process.exit(1)` removed from the seed's `fail` (`seed:28`) | nothing. With MinIO stopped it prints `… is unreachable` and exits 0 (pristine: 1) | **S-real** (RM-04 AC3) |
| R8c | seed key | `KEY` made unique per run (`seed:20`) | nothing: the smoke is green and objects accumulate (3 `sample-8s*` observed) | S-eq under RM-04 AC2's wording ("exactly one object **at that key**" holds for any key); see spec note 1 |
| R8d | sizing | `cpus: 4` with `FFMPEG_THREADS` unchanged (`compose.yaml:53`) | sizing exit 1 `worker cpus is 4 but FFMPEG_THREADS is 2` | K |
| M13 | readiness | MinIO healthcheck → `["CMD","true"]` (`compose.yaml:166`) | nothing | S-eq for AC1's outcome: the Worker still waits for minio-init, whose `mc` calls require a serving MinIO; the readiness probe only prevents a spurious init failure |
| M14 | retention | `--expire-days 7` → `30` (`bootstrap.sh:37`) | `up` exit 1 (read-back needs 7 days) | K |
| M15 | idempotence | `mc mb` without `--ignore-existing` (`bootstrap.sh:12`) | the second `up` exit 1 (minio-init). The first `up` and the documented one-pass Build gate are green | K by the matrix-required second `up` (`tasks.md:25`); not in the Build gate row (spec note 6) |

Demonstrations (not counted separately): W1+R7e, R8a+M7 and R7e+M1 each keep every gate green, or print a failure but exit 0. They confirm that R7e and R8a are not equivalent.

**Round 3: 48 mutants, 26 killed, 22 survived: 13 S-real, 6 S-eq, 3 S-harness.**

**Sensor depth**: expanded, 86 mutations (19 + 19 + 48).
**Sensor total**: 61/86 killed. There are 25 survivors: 13 S-real, 7 S-eq and 5 S-harness. The S-real survivors are R1a, R1b, R1c, R3d, R3e, R5a, R5b, R5c, R5e, R7b, R7e, R8a and R8b. **FAIL ❌**

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / surgical / no scope creep | ✅ T18–T22 touch only `scripts/check-worker-sizing.mjs`, `scripts/smoke-local-integration.mjs`, `ci.yml`, `README.md` and the spec/tasks text |
| Matches patterns | ✅ Dependency-free `node:` scripts, exact-message self-tests, and T22 injection mirrors the T16 pattern |
| Spec-anchored outcome check | ✅ Asserted values are exact: 8, 7 days, `private`, 403, `FORMATO_INVALIDO`, the exact sentence, `=== 1`, NCPU |
| Tests non-shallow / discriminating | ❌ Four gaps:<br>• `main()` of the smoke is outside the self-test (R3d/R3e)<br>• the process exit status on failure is untested in all three scripts (R7e, R8a, R8b)<br>• observes are unverified (R1a–R1c, R7b)<br>• the sentence check has no near-miss case (R5a/b/c/e) |
| Documentation accuracy | ⚠️ Two README drifts:<br>• `README.md:52`: "proved only by the real run" is overstated (R1b passes a real run).<br>• `README.md:98`: says the sizing self-test does not test reading `docker compose config`/`docker info`; since T22 it drives `main()` over simulated output of both. |
| Documented guidelines | The `tasks.md` Test Coverage Matrix and the Gate Check Commands. The Build gate row (`tasks.md:39`) has no second `up`, although the matrix (`tasks.md:25`) requires one for bootstrap idempotence |

---

## Fix Plans

### Fix 1: Prove the smoke's `main()` runs the whole list (Major; RM-06, RM-19)

- **Root cause**: `main()` (`scripts/smoke-local-integration.mjs:451-453`) is never executed by the self-test. `runSteps(SMOKE_STEPS.slice(0, 6))` passes every gate (R3e).
- **Fix task**: make `main` take injected dependencies, as T22 did for sizing, and have the self-test drive `main()` itself. Two options:
  - Inject `steps`/`runSteps` and assert that `main` hands over exactly `SMOKE_STEPS`.
  - Or inject the observers and assert that each required step's check ran.
- **Done when**: R3d and R3e make `--self-test` exit 1.

### Fix 2: Prove a failure exits non-zero, in all three scripts (Major; RM-06 AC3, RM-19 AC4, RM-05 AC3, RM-04 AC3)

- **Root cause**: the self-tests inject or catch failures, so the real `process.exit(1)` / `process.exitCode = 1` paths (`smoke:658-661`, `sizing:16-19`, `seed:25-29`) are never exercised by a gate.
- **Fix task**: each self-test spawns its own script as a child process with a forced failure and requires exit ≠ 0:
  - **Sizing**: `WORKER_CPUS` above NCPU, or a fake `docker` on `PATH`.
  - **Seed**: an unreachable `DOCKER_HOST`, or a fake `docker` on `PATH`.
  - **Smoke**: an env hook that makes the first check fail against an unreachable `API_URL` with a 1 s `HEALTH_TIMEOUT_MS`.
- **Done when**: R7e, R8a and R8b each fail a gate.

### Fix 3: Put the observes under test (Moderate; RM-01 AC3, RM-19 AC3)

- **Root cause**: an observe that reads the wrong request, or fabricates a value, passes every gate (R1a, R1b, R1c). The `observed()` guard is not itself tested (R7b).
- **Fix task**:
  - Route `fetch`, `docker compose run/exec` and `psql` through an injectable I/O object. Drive each step's `observe` in the self-test with a fake that records the id/URL it was asked for and returns a bad value. Require the step to fail. At minimum, assert that `single delivery` and `no archive` query `rejectedId`, and that `anonymous access` fetches the real URLs.
  - Add one self-test case that runs a required step with its observed key absent and requires `Nothing was observed for …`.
  - Alternatively, write this residual into the spec with a rationale.
- **Done when**: R1a, R1b, R1c and R7b are killed, or the accepted residual is written in `spec.md`.

### Fix 4: Discriminate the exact sentence (Minor; RM-19 AC2)

- **Fix task**: add bad delivery cases for:
  - the sentence plus a suffix
  - the sentence truncated by one character
  - an empty reason
  - a different sentence sharing the prefix `O arquivo enviado`
  - a lowercase variant
- **Done when**: R5a, R5b, R5c and R5e are killed.

### Fix 5: Documentation (Cosmetic)

- Correct `README.md:52` and `README.md:98`, per the Code Quality notes.
- Either add a second `up` to the Build gate row, or state in the matrix that idempotence is proved manually.

---

## Spec-Precision Gaps

1. **RM-04 AC2** (`spec.md:94`) says "exactly one object **at that key**". That is true for any key, including one unique per run (R8c accumulated 3 video objects with every gate green). The success criterion (`spec.md:191`) says "running it twice leaves one object". The AC should say the key is fixed, or that `sources/` holds one video object after two runs.
2. **The CPU edge case** (`spec.md:158`) says "SHALL fail before the stack starts". That holds only through gate order (carried from round 2).
3. **P5 AC3** (`spec.md:146`): "the topology check" is not defined in the spec (carried).
4. **Three assumption rows are `Confirmed? n`** (`spec.md:41-43`) (carried).
5. **RM-01 AC3**: the smoke requires exactly 403 (`scripts/smoke-local-integration.mjs:216`), stricter than "refused" (carried; acceptable).
6. **Bootstrap idempotence** (P1 AC4, P2 AC2) is proved only by a second `up`, which the matrix requires (`tasks.md:25`) but the Build gate row (`tasks.md:39`) omits. M15 passes the documented one-pass gate.
7. **P1 AC1** "reports healthy before the Worker starts" is satisfied by any healthcheck. The load-bearing ordering is minio-init's success (M13 is equivalent). Consider stating the outcome as "the Worker starts only after the bucket bootstrap succeeded against a serving storage".

---

## Requirement Traceability Update

The Verifier does not edit `spec.md`. Recommended statuses:

- RM-02 and RM-03: ✅ Verified.
- RM-01: ✅ Verified at runtime, with a Minor follow-up (R1a, Fix 3).
- RM-04: ✅ Verified at runtime, with a Minor follow-up (R8b, Fix 2; AC2 wording).
- RM-05: ❌ Needs Fix (Fix 2, R8a: the CI check can exit 0 on a mismatch).
- RM-06: ❌ Needs Fix (Fixes 1 and 2).
- RM-19: ❌ Needs Fix (Fixes 1–4).

---

## Summary

**Overall**: ❌ Not Ready (round 3 of 3, so escalate to the user).
**Spec-anchored check**: 23/23 ACs have evidence and matching observed outcomes. All 5 edge cases hold at runtime. There are 7 spec-precision notes.
**Sensor**: 61/86 killed. All 19 round-1 mutants and all 9 round-2 real survivors are now killed. There are 13 real round-3 survivors in 4 root causes, plus 7 equivalent and 5 harness-only.
**Gate**: green. That covers the documented Build gate, the second `up` (idempotent), the CI-shaped `topology` job, and `down -v`.

**What works**:
- The sizing comparisons and the sizing `main()` wiring are fully discriminated. All of T18/T22's targets (N2, N2b, N2c, R4a–R4i) are killed.
- Removing a smoke step, emptying a check, or swallowing a check in `runSteps` is caught.
- The Worker faults W1–W5 each turn the smoke red, naming the cause.

**Next steps**: escalate to the user. Fixes 1 and 2 are required for PASS. Fixes 3 and 4 are required, unless the user accepts them as a written residual in `spec.md`. Fix 5 is text only.
