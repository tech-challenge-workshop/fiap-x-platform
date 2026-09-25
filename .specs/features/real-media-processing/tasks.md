# Real Media Processing Tasks — platform

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/real-media-processing/design.md`
**Status**: Draft

**Tools for every task below**: MCP `NONE`, Skill `NONE`. The `mc` command forms were read from MinIO's own documentation during Design (`mc mb --ignore-existing`, `mc ilm rule add --expire-days --prefix`, `mc anonymous get`); nothing here needs an API resolved at implementation time.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `.specs/features/durable-persistence/tasks.md` (prior matrix for this repository), `.specs/features/ci-pipeline/tasks.md`. This repository has no `package.json`, no test runner and no application source - its tests are the topology coming up and the smoke passing, which is why every layer below is integration or none.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Compose topology | integration | The stack starts, the storage service reports healthy, the bootstrap completes before the Worker starts, and the smoke still passes | `compose.yaml` | `docker compose up --build -d --wait` then `node scripts/smoke-local-integration.mjs` |
| Storage bootstrap | integration | Bucket, private access and both retention rules verified against a running service; asserted again after a **second** `up` to prove idempotence | `minio/bootstrap.sh` | exercised by the topology run |
| Scripts | none | Syntax-checked only; their behaviour is verified by the topology run | `scripts/*.mjs` | `node --check scripts/<name>.mjs` |
| Smoke assertions | integration | The new archive assertion is verified **negatively** - stub the packager and require a red run | `scripts/smoke-local-integration.mjs` | `node scripts/smoke-local-integration.mjs` |
| Fixture | integration | Its declared duration is asserted by the frame count the smoke checks | `fixtures/` | exercised by the topology run |
| Documentation | none | Build gate only | `README.md`, `fixtures/README.md` | the relative-link check from the `docs-links` job in `.github/workflows/ci.yml` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks touching a script or a document only | `node --check scripts/<changed>.mjs` and the relative-link check from the `docs-links` job in `.github/workflows/ci.yml` |
| Full | After tasks touching `compose.yaml` or the bootstrap | `docker compose config -q` then `docker compose up --build -d --wait` |
| Build | After phase completion | `node clean-appledouble.mjs` from the workspace root, then `docker compose config -q`, `node scripts/check-worker-sizing.mjs`, `node scripts/check-worker-sizing.mjs --self-test`, `docker compose up --build -d --wait`, `node scripts/seed-source-video.mjs`, `node scripts/smoke-local-integration.mjs`, `docker compose down -v` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order. Arrows show **within-phase** dependencies.

### Phase 1: Storage in the topology

```
T1 -> T2
T2 -> T3
```

### Phase 2: A real video to process

```
T4 -> T5
```

### Phase 3: Sizing that cannot drift

```
T6
```

### Phase 4: A smoke that proves the archive

```
T7 -> T8
T8 -> T9
T9 -> T11
T11 -> T10
```

---

## Task Breakdown

### Phase 1: Storage in the topology

### T1: Add the object storage service

**What**: Add MinIO to the topology with a readiness check and a named volume.
**Where**: `compose.yaml`
**Depends on**: None
**Reuses**: The health-check, named-volume and development-credentials conventions the existing six services already follow
**Requirement**: RM-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] The service exposes the S3 API and reports healthy using `mc ready local` rather than a TCP probe - a listening server that is not yet serving would let the bootstrap start too early
- [x] Data lives in a named volume, so `down -v` starts the next run empty
- [x] Credentials appear only in the `environment` block, with the same comment the PostgreSQL service carries: nothing here reaches a deployed environment (AD-005)
- [x] The Worker receives the endpoint, bucket and credentials as environment variables
- [x] Full gate passes: `docker compose config -q` then `docker compose up --build -d --wait`

**Tests**: integration
**Gate**: full
**Status**: ✅ Complete

---

### T2: Create the bucket, idempotently, before the Worker starts

**What**: A one-shot bootstrap service that ensures the bucket exists and is private, and which the Worker waits for.
**Where**: `minio/bootstrap.sh`
**Depends on**: T1
**Reuses**: The `depends_on` condition pattern already in the file
**Requirement**: RM-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Uses `mc mb --ignore-existing`, so a second run is a no-op rather than a failure - unlike the SQL bootstrap, this runs on **every** start, which is the same trap that made `CREATE ROLE` fail on a second database
- [x] Asserts `mc anonymous get` reports `private` (how the pinned `mc` names a closed bucket; `none` is the value `mc anonymous set` writes) and exits non-zero otherwise; it never **sets** the policy, because a set could only loosen it
- [x] The Worker declares `depends_on` with `condition: service_completed_successfully`, so it can never start against a missing bucket
- [x] A failed bootstrap exits non-zero and keeps the Worker from starting
- [x] Verified by bringing the stack up **twice** without `down -v` between runs
- [x] Full gate passes: `docker compose config -q` then `docker compose up --build -d --wait`

**Tests**: integration
**Gate**: full
**Status**: ✅ Complete

---

### T3: Configure the 7-day retention

**What**: Add lifecycle rules expiring objects after 7 days under both prefixes.
**Where**: `minio/bootstrap.sh` (extend)
**Depends on**: T2
**Reuses**: The bootstrap from T2
**Requirement**: RM-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `mc ilm rule add --expire-days 7 --prefix "sources/"` and the same for `zips/`
- [x] Each rule is guarded by a check for an existing rule on that prefix, so a re-run neither fails nor accumulates duplicates
- [x] Reading the lifecycle configuration back shows exactly two rules, both at 7 days
- [x] Verified after a second `up` without `down -v`: still exactly two rules
- [x] Full gate passes: `docker compose config -q` then `docker compose up --build -d --wait`

**Tests**: integration
**Gate**: full
**Status**: ✅ Complete

---

### Phase 2: A real video to process

### T4: Commit the fixture and its provenance

**What**: A small synthetic MP4 plus the record of how it was made and what it asserts.
**Where**: `fixtures/README.md`
**Depends on**: None
**Reuses**: Nothing
**Requirement**: RM-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `fixtures/sample-8s.mp4` exists: 8 seconds, 320×240, H.264 in MP4, a few hundred KB
- [x] `fixtures/README.md` carries the exact generating command verbatim, the declared duration, and the frame count that follows at 1 frame per second
- [x] The README states that the expected frame count in the smoke is derived from this file, so changing the fixture without changing the expectation fails the smoke rather than passing unnoticed
- [x] The design's revision is reflected: the fixture is committed rather than generated at seed time, because generating would require FFmpeg on the host
- [x] Quick gate passes: the relative-link check from the `docs-links` job in `.github/workflows/ci.yml`

**Tests**: none
**Gate**: quick
**Status**: ✅ Complete

---

### T5: Add the seed script

**What**: A script that puts the fixture in the bucket and prints the key.
**Where**: `scripts/seed-source-video.mjs`
**Depends on**: T4
**Reuses**: The dependency-free plain-Node script convention - this repository has no `package.json`
**Requirement**: RM-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Transfers the fixture with `mc` in a container rather than an SDK, naming the file explicitly rather than globbing the directory - exFAT sidecars would otherwise be uploaded
- [x] Prints the resulting storage key on stdout, so the smoke can consume it
- [x] Uses a fixed key, so running twice leaves exactly one object without a delete-then-write
- [x] Exits non-zero naming the unreachable service when the stack is down, rather than reporting success
- [x] Quick gate passes: `node --check scripts/seed-source-video.mjs`

**Tests**: none
**Gate**: quick
**Status**: ✅ Complete

---

### Phase 3: Sizing that cannot drift

### T6: Tie the CPU limit to the thread count

**What**: One value driving both the Worker's CPU limit and its FFmpeg thread count, with a check that they agree in the rendered configuration.
**Where**: `scripts/check-worker-sizing.mjs`
**Depends on**: None
**Reuses**: The `docker compose config -q` step already in the topology gate
**Requirement**: RM-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] A single `.env` value drives both the Worker's `cpus` limit and its `FFMPEG_THREADS`
- [x] The check reads `docker compose config` **output**, not the template, so it verifies the substitution rather than the intent
- [x] A deliberate mismatch fails the check, and the message names both values
- [x] Uses the top-level `cpus` field rather than `deploy.resources.limits`, which Compose ignores outside Swarm - a declared limit that is not enforced would make the pairing unprovable locally
- [x] The README states that this declared value is the contract S9a carries into Kubernetes `limits`
- [x] Full gate passes: `docker compose config -q` then `docker compose up --build -d --wait`

**Tests**: integration
**Gate**: full
**Status**: ✅ Complete

---

### Phase 4: A smoke that proves the archive

### T7: Seed before the smoke and carry the key through

**What**: Make the smoke create its request against the seeded object and read `zipStorageKey` from the status it already polls.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None
**Reuses**: The existing request creation and polling; the seed script from T5
**Requirement**: RM-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] The smoke seeds (or requires a seeded key) and posts a request naming it
- [x] `zipStorageKey` is read from the Catalog status the smoke already polls
- [x] Each run creates a distinct request, so a second run cannot assert against the previous run's archive
- [x] Quick gate passes: `node --check scripts/smoke-local-integration.mjs`

**Tests**: none
**Gate**: quick
**Status**: ✅ Complete

The smoke runs the seed itself rather than requiring a seeded key, because the CI `integration` job starts the stack and runs the smoke without seeding. It also requires the reported `zipStorageKey` to sit under `zips/<this run's processingRequestId>/`, which is what makes an earlier run's archive unreachable.

---

### T8: Count the archive's entries without a dependency

**What**: A function that returns an archive's entry count by reading its End of Central Directory record.
**Where**: `scripts/smoke-local-integration.mjs` (extend)
**Depends on**: T7
**Reuses**: `node:fs` only
**Requirement**: RM-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Scans backwards for the `0x06054b50` signature and reads the 16-bit total-entries field at offset 10
- [x] Throws a distinguishable error when no signature is found, so "unreadable" is separable from "empty"
- [x] Keeps the repository dependency-free - no `package.json` is introduced to unzip a file
- [x] Quick gate passes: `node --check scripts/smoke-local-integration.mjs`

**Tests**: none
**Gate**: quick
**Status**: ✅ Complete

The distinguishable error is `UnreadableArchiveError`. Checked by hand against the function's own text: a Worker archive gives 8, an empty ZIP gives 0, and a text file and a 1-byte file both throw `UnreadableArchiveError`.

---

### T9: Assert the frame count, and prove the assertion can fail

**What**: Download the archive, assert its entry count equals the fixture's seconds, and verify the assertion by making it fail.
**Where**: `scripts/smoke-local-integration.mjs` (extend)
**Depends on**: T8
**Reuses**: `countZipEntries` from T8; `mc` for the transfer
**Requirement**: RM-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] The archive is downloaded and its entry count asserted equal to the fixture's duration in seconds at 1 frame per second
- [x] The three failure outcomes are reported distinctly: absent (the transfer fails), unreadable (no EOCD signature), empty (zero entries)
- [x] A count mismatch names both the expected and the actual number, so an off-by-one is legible
- [x] No downloaded artefact is left behind after the script exits
- [x] **Verified negatively**: with the Worker's frame packager replaced by one that stores nothing, the smoke exits non-zero and names the absent archive. An assertion that has never failed is not known to work - this is the concrete lesson from the previous slice, where a status-only smoke would have passed against a fully stubbed implementation
- [x] Build gate passes: `node clean-appledouble.mjs`, `docker compose config -q`, `docker compose up --build -d --wait`, `node scripts/seed-source-video.mjs`, `node scripts/smoke-local-integration.mjs`, `docker compose down -v`

**Tests**: integration
**Gate**: build
**Status**: ✅ Complete

**Evidence (2026-09-25, local; CI does not run the smoke, V11).**
- Build gate green on the real Worker: `Archive zips/<id>/<attemptId>/frames.zip holds 8 frames, as 8 s at 1 frame/s requires`.
- Negative run: the Worker was built from a scratch copy with `FRAME_PACKAGER` bound to `DeterministicFramePackager`, as a separate image through a Compose override outside both repositories. The request still reached `COMPLETED`, and the smoke exited 1 with: `Archive absent: fiapx/zips/edd8a9ac-…/075c63cc-…/frames.zip could not be transferred from storage (mc: <ERROR> Unable to read from … Object does not exist.)`. The Worker's tree was left clean and the scratch image removed.
- The unreadable and empty outcomes are proven on `countZipEntries` itself (T8). No real Worker produces them end to end.

---

### T11: Drive a non-video object to FAILED, and prove the assertion can fail

**What**: Seed a second, non-video object, create a request for it in the same smoke run, and assert it settles as `FAILED` with the safe reason, no archive, and one Notification delivery.
**Where**: `scripts/seed-source-video.mjs` (extend), `scripts/smoke-local-integration.mjs` (extend)
**Depends on**: T9
**Reuses**: The seed script from T5; the request creation and polling from T7
**Requirement**: RM-19

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] The seed places a small text payload under `sources/` with an `.mp4` name, generated at seed time rather than committed
- [x] The smoke creates one request per seeded object and waits for both to settle
- [x] The rejected request is asserted `FAILED` with the exact safe reason the Catalog maps from `FORMATO_INVALIDO`, no object under its `zips/` prefix, and exactly one Notification delivery record for its terminal event
- [x] A request that settles `COMPLETED`, or stays non-terminal past the timeout, fails the smoke naming the observed status
- [x] **Verified negatively**: with the pre-S4 Worker binding restored (both stubs, `AcceptAllVideoValidator` and `DeterministicFramePackager`), the smoke exits non-zero and names `COMPLETED` where `FAILED` was expected. The validator stub alone reaches `FAILED (PROCESSAMENTO_FALHOU)`, because the real packager refuses a text file
- [x] Build gate passes: the same sequence as T9

**Tests**: integration
**Gate**: build
**Status**: ✅ Complete

**How the safe reason is asserted.** The Catalog's status view carries `failureCode`, not the sentence, because the sentence is derived when the terminal event is published and is never stored. The smoke therefore asserts `failureCode` `FORMATO_INVALIDO` on the Catalog. It asserts the exact sentence, `O arquivo enviado nao e um video MP4 ou MOV valido.`, on the Notification delivery record, which is where the terminal event delivers it. `GET /local/deliveries/:id` returns one record and cannot show a duplicate, so "exactly one" is a row count in `notification.delivery_record`, run through `psql` in the postgres container. The seed now prints two lines: the video key, then `sources/not-a-video.mp4`.

**Evidence (2026-09-25, local; CI does not run the smoke, V11).**
- Build gate green on the real Worker: `Catalog reached FAILED (FORMATO_INVALIDO)`, `No archive exists under zips/<id>/`, `Notification delivered once for <id>: O arquivo enviado nao e um video MP4 ou MOV valido.`, alongside the 8-frame archive from T9.
- Negative run 1, with only `VIDEO_VALIDATOR` bound to `AcceptAllVideoValidator`: exit 1, `Request 6cd7f7a8-… for the non-video: expected FAILED (FORMATO_INVALIDO), observed FAILED (PROCESSAMENTO_FALHOU)`. The real packager still refuses the text file, so this binding alone cannot reach `COMPLETED`.
- Negative run 2, with the pre-S4 binding restored (`AcceptAllVideoValidator` and `DeterministicFramePackager`): exit 1, `Request 886c4d46-… for the non-video: expected FAILED (FORMATO_INVALIDO), observed COMPLETED`. The rejection is asserted before the archive, so a Worker that validates nothing is named for that rather than for a missing archive.
- Timeout branch: `POLL_TIMEOUT_MS=300` gives exit 1, `Request 8c782ec5-… is still RECEIVED after 300 ms; expected it to settle`.
- Both negative Workers were built from a scratch copy, as a separate image through a Compose override outside both repositories. The image was removed afterwards, and `git -C ../processing-worker status --porcelain` is empty.

---

### T10: Document the storage, the seed and the retention

**What**: A README section covering the bucket layout, how to seed a video, what retention applies, and the sizing contract.
**Where**: `README.md`
**Depends on**: T11
**Reuses**: The README's existing structure, including the empty-volume section written for PostgreSQL
**Requirement**: RM-01, RM-03, RM-04, RM-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] The bucket layout and both prefixes are documented, with the 7-day expiry stated as a product rule from `docs/foudation.md`
- [x] Seeding is documented as a stand-in that S6 removes, so nobody maintains it as a feature
- [x] It states that the bootstrap runs on every start and is therefore idempotent - unlike the SQL bootstrap, which runs only on an empty volume
- [x] It states that the declared CPU limit is the contract S9a carries into Kubernetes `limits`
- [x] It states that the smoke proves two outcomes per run: an archive with the right frame count, and a rejection with the safe reason
- [x] Quick gate passes: the relative-link check from the `docs-links` job in `.github/workflows/ci.yml`

**Tests**: none
**Gate**: quick
**Status**: ✅ Complete

The S9a sentence was already written under "Worker sizing" by T6 and is kept there. The run command is now `docker compose up --build -d --wait`: in the foreground, `up` never returns, so the smoke line after it could not run.

---

### Phase 5: Verifier fixes (round 1)

Added by the orchestrator from the platform Verifier's FAIL of 2026-09-25 (13 of 19 mutants killed, RM-05 AC3 unwired, one edge case untrue). Each task closes one ranked gap.

```
T12 -> T13
T14 -> T16
T15 -> T16
T17
```

---

### T12: Make the sizing check refuse a limit the engine cannot grant

**What**: Correct the edge case that was never true, and make the sizing check fail fast, naming both values, when `WORKER_CPUS` exceeds the engine's CPU count.
**Where**: `scripts/check-worker-sizing.mjs`, `.specs/features/real-media-processing/spec.md` (Edge Cases)
**Depends on**: None
**Reuses**: The existing check's failure message style
**Requirement**: RM-05

**Why**: Docker refuses to create a container whose `cpus` exceeds the engine's CPUs ("range of CPUs is from 0.01 to 10.00"), so "the stack SHALL still start" cannot hold. The Verifier reproduced it with `WORKER_CPUS=16` on a 10-CPU engine.

**Done when**:
- [x] The edge case reads: WHEN the declared CPU limit exceeds the engine's CPU count THEN the sizing check SHALL fail before the stack starts, naming both values
- [x] The check reads the engine's CPU count from `docker info` (`NCPU`) and fails naming `WORKER_CPUS` and that count when the limit exceeds it
- [x] Verified: with `WORKER_CPUS` above the engine's count the check exits 1 naming both; with the default it still passes
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete

**Evidence (2026-09-25, 10-CPU engine).** The check reads `docker info --format '{{.NCPU}}'` after the pairing check. `WORKER_CPUS=16`: exit 1, `WORKER_CPUS is 16 but the Docker engine has only 10 CPUs; set WORKER_CPUS to at most 10`. `WORKER_CPUS=10` and the default 2: exit 0. With no reachable daemon (`DOCKER_HOST` pointing at a missing socket): exit 1, `docker info failed, so the engine's CPU count is unknown`, so it never passes silently.

---

### T13: Run the sizing check in the Build gate and in CI

**What**: Wire `scripts/check-worker-sizing.mjs` into this feature's Build gate and into the CI `topology` job.
**Where**: `.github/workflows/ci.yml`, `.specs/features/real-media-processing/tasks.md` (Gate Check Commands)
**Depends on**: T12
**Reuses**: The `topology` job's rendered-config step
**Requirement**: RM-05 AC3

**Why**: Mutant M7 (thread count decoupled from `cpus`) passed both the Build gate and CI. The check existed and nothing ran it.

**Done when**:
- [x] The Build gate command includes `node scripts/check-worker-sizing.mjs` after `docker compose config -q`
- [x] The CI `topology` job runs the check and fails the job on a mismatch
- [x] Verified by a deliberate mismatch in a scratch copy: the check exits non-zero
- [x] Quick gate passes, and the workflow file still parses (`docker compose config` unaffected)

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete

**Evidence (2026-09-25).** The `topology` job runs `node scripts/check-worker-sizing.mjs` after `actions/setup-node`; a non-zero exit fails the step and the job. M7 (`FFMPEG_THREADS=4`) in a scratch copy holding only `compose.yaml` and the script, which is what the `topology` checkout has without the sibling repositories: exit 1, `worker cpus is 2 but FFMPEG_THREADS is 4; both must come from WORKER_CPUS`. The workflow parses with `yaml.safe_load`, and `docker compose config -q` still exits 0.

---

### T14: Assert from outside that the bucket stays private

**What**: The smoke issues an anonymous GET for the seeded object and for the bucket, and fails unless both are refused.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None
**Reuses**: The smoke's existing failure reporting
**Requirement**: RM-02 (P1 AC3)

**Why**: Mutant M5b made the bucket public after the bootstrap's own check and survived: only the bootstrap asserted the posture, and only at bootstrap time.

**Done when**:
- [x] An unauthenticated request for `sources/sample-8s.mp4` and for the bucket listing is refused (HTTP 403); any 2xx fails the smoke naming the URL
- [x] Verified negatively: with anonymous download enabled by hand on a running stack, the smoke exits 1 naming the exposure
- [x] Build gate passes

**Tests**: integration
**Gate**: build
**Status**: ✅ Complete

**Evidence (2026-09-25, local).** Right after seeding, the smoke sends two plain `fetch` requests with no S3 signature, to `http://localhost:9000/fiapx/sources/sample-8s.mp4` and to `http://localhost:9000/fiapx/` (`STORAGE_URL` overrides the host). It requires exactly 403. A 2xx fails with `Anonymous access allowed: GET <url> returned <status>`, and any other status fails naming it and 403.
- Build gate green, including the new line `Storage refused anonymous GET of fiapx/sources/sample-8s.mp4 and of the fiapx listing (403)`.
- Negative run (the end state M5b leaves): `mc anonymous set download local/fiapx` on the running stack gave exit 1, `Anonymous access allowed: GET http://localhost:9000/fiapx/sources/sample-8s.mp4 returned 200; the bucket must refuse requests without credentials`. With `anonymous set public`, the listing URL answers 200 as well, so the second request is a real signal. `anonymous set none` restored 403 on both, then `down -v`.

---

### T15: Observe that the smoke leaves no artefact behind

**What**: After cleanup, the smoke asserts its own temporary directory no longer exists, and fails naming it otherwise.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None
**Reuses**: The existing cleanup path
**Requirement**: RM-06 (P4 AC4)

**Why**: Mutant M10 (temp directory not removed) survived: the requirement had no observable check.

**Done when**:
- [x] The smoke checks the directory is gone after cleanup, on success and on failure paths, and exits non-zero naming the path if it remains
- [x] Covered by the self-test from T16 or verified negatively by disabling the removal in a scratch copy
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete

**Evidence (2026-09-25, local).** The download now runs inside `withScratchDir`, which removes the directory whatever the outcome and then fails with `Downloaded artefact left behind: <dir> still exists after cleanup` if it survived. When the archive check has already failed, the leak is appended to that message instead of replacing it, so the check holds on the success path and on the unreadable, empty and mismatch paths. The absent path fails before any directory is created.
- The real smoke was green against a live stack, and no `fiapx-smoke-*` remained in the temp directory.
- Negative run (M10): with the `rmSync` line removed in a scratch copy, the smoke against the same stack exited 1 with `Downloaded artefact left behind: /var/folders/…/T/fiapx-smoke-MXhsfs still exists after cleanup`. The leaked directory and the scratch copy were removed. T16's self-test also exercises `withScratchDir` directly, so the same mutant fails without a stack.

---

### T16: Give the smoke's assertions a self-test that proves each can fail

**What**: `node scripts/smoke-local-integration.mjs --self-test` feeds each assertion a synthetic bad input and exits non-zero if any assertion accepts it; CI's `topology` job runs it.
**Where**: `scripts/smoke-local-integration.mjs`, `.github/workflows/ci.yml`
**Depends on**: T14, T15
**Reuses**: The assertion functions the smoke already has, factored so they can be called without a stack
**Requirement**: RM-06, RM-19

**Why**: Mutants M2 (count comparison removed), M3 (rejection accepts COMPLETED), M11 (`deliveries < 1`) and M12 (no-archive check disabled) survived, because the negative runs of T9/T11 were one-off and manual. A self-test that needs no Docker makes every assertion's failure mode permanent and CI-enforced.

**Done when**:
- [x] The self-test covers, at minimum: frame count differs from 8; archive absent, unreadable and empty; rejected request observed as COMPLETED and as FAILED with another code; delivery count 0 and 2; an archive present for the rejected request; the bucket answering an anonymous request; the temp directory remaining
- [x] Each case asserts the specific failure message, not merely a non-zero exit
- [x] The self-test exits 0 only when every case was rejected; CI's `topology` job runs it
- [x] Verified: re-applying each of M2, M3, M11 and M12 in a scratch copy makes the self-test exit non-zero
- [x] Quick gate passes (`node --check` and `--self-test`)

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete

**Evidence (2026-09-25).** The assertions are now pure functions that the smoke calls: `assertArchiveTransferred`, `assertArchiveContents` (run inside `withScratchDir`), `assertRejected`, `assertSingleDelivery`, `assertNoArchiveListing`, `assertAnonymousRefused` and `assertScratchRemoved`. `--self-test` needs no stack and runs 13 bad inputs, each of which must throw its exact message:
- frame count 16 and 7
- archive absent, unreadable and empty
- rejected request observed `COMPLETED`, and `FAILED (PROCESSAMENTO_FALHOU)`
- 0 and 2 deliveries
- an archive listed for the rejected request
- anonymous 200 on the object and on the listing
- a remaining temp directory

It also runs 7 good inputs, each of which must pass: an 8-frame archive whose scratch directory is gone afterwards, a transfer that succeeded, `FAILED (FORMATO_INVALIDO)`, 1 delivery, an empty listing, 403, and no leftover. Output: `Self-test passed: 13 bad inputs rejected with the expected message, 7 good inputs accepted`, exit 0. CI's `topology` job runs it after the parse check.

Mutants were re-applied to a scratch copy of the script, never to this tree. Each self-test exited 1, naming the case that caught it:
- M2 (count comparison disabled): `frame count 16: accepted` and `frame count 7: accepted`
- M3 (rejection returns early on `COMPLETED`): `rejected request observed COMPLETED: accepted`
- M11 (`deliveries < 1`): `2 deliveries: accepted`
- M12 (no-archive check disabled): `archive present for the rejected request: accepted`
- M10 (removal disabled): the leak message is appended to the archive cases
- The 2xx branch of the anonymous check disabled: the wrong message is named

An unmutated control copy exited 0. The scratch copies and the directories M10 leaked were removed.

---

### T17: Write the recorded deviations back into the spec and tasks

**What**: Align the text with what was built and verified.
**Where**: `.specs/features/real-media-processing/spec.md`, `.specs/features/real-media-processing/tasks.md`
**Depends on**: None
**Reuses**: The deviations recorded in the task evidence
**Requirement**: RM-02, RM-04, RM-19

**Done when**:
- [x] The fixture assumption says it is committed, with the generating command in `fixtures/README.md`, and states its real size
- [x] RM-19 AC2 names where the safe reason is observable: `failureCode` on the Catalog, the exact sentence on the Notification delivery record
- [x] T2's text says `mc anonymous get` must report `private`, which is how the pinned `mc` names a closed bucket
- [x] The T11 negative is described as binding the pre-S4 Worker (both stubs)
- [x] `validate_spec.py` and `validate_tasks.py` report 0 errors

**Tests**: none
**Gate**: quick
**Status**: ✅ Complete

**Evidence (2026-09-25).** The following were updated:
- `spec.md`:
  - The two fixture assumption rows: committed, with the command in `fixtures/README.md`, 39,863 bytes, confirmed `y`.
  - RM-19 AC2: `failureCode` on the Catalog, and the exact sentence on the Notification delivery record.
  - P6's Independent Test: the pre-S4 binding with both stubs.
  - Traceability coverage: T1-T17.
- `tasks.md`:
  - T2's criterion now reads `private`.
  - T11's negative criterion names both stubs.

`validate_spec.py`: 0 errors, 0 warnings. `validate_tasks.py`: 0 errors; its 11 warnings are the pre-existing `Tests: none` and multi-file `Where` notices.

---

### Phase 6: Verifier fixes (round 2)

Added by the orchestrator from the platform Verifier's round-2 FAIL (24 of 36 mutants killed; every round-1 survivor now killed, but 9 new mutants disable enforcement unseen). This is the last fix round before escalating to the user.

```
T18
T19 -> T20
T21
```

---

### Phase 6: Verifier fixes (round 2)

### T18: Give the sizing check a self-test on its comparisons

**What**: `node scripts/check-worker-sizing.mjs --self-test` feeds the check's pure comparison functions failing and boundary values and requires the specific failure message for each; the Build gate and CI's `topology` job run it.
**Where**: `scripts/check-worker-sizing.mjs`, `.github/workflows/ci.yml`
**Depends on**: None
**Reuses**: The smoke's `--self-test` pattern (T16): pure functions, exact messages, good inputs must pass
**Requirement**: RM-05 AC3, the CPU edge case

**Why**: Round-2 mutants N2 (engine-CPU comparison disabled), N2b (`>` → `>=`) and N2c (cpus/threads comparison disabled) passed the Build gate and CI.

**Done when**:
- [x] The cpus/threads comparison and the engine-CPU comparison are pure functions called by the check's main path
- [x] The self-test rejects, with the exact message: threads ≠ cpus; non-integer or non-positive threads; cpus above the engine count (including engine + 1); and accepts cpus equal to the engine count and below it
- [x] Verified in scratch copies: N2, N2b and N2c each make the self-test exit non-zero
- [x] The Build gate row and CI's `topology` job run `--self-test`
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete

**Evidence (2026-09-25, 10-CPU engine).** The two comparisons are now `pairingProblem(cpus, threads)` and `engineCapacityProblem(cpus, engineCpus)`. Each returns the failure message or `undefined`, and neither touches Docker. `main()` calls both and exits 1 with the message they return. The `docker info` call stays in `main()`, so `--self-test` runs with `DOCKER_HOST` pointing at a missing socket.
- The self-test feeds values shaped as `docker compose config --format json` renders them (`cpus` a number, `FFMPEG_THREADS` a string). It runs 8 bad inputs, each of which must return its exact message: threads 4 and 1 with cpus 2; threads 1.5, `two`, 0 and -1; cpus 16 and 11 (engine + 1) on 10 CPUs. It runs 5 good inputs, each of which must return nothing: 2/2 and 10/10; cpus 2, 9 (engine - 1) and 10 (equal) on 10 CPUs. Output: `check-worker-sizing self-test passed: 8 bad inputs rejected with the expected message, 5 good inputs accepted`, exit 0.
- The real check is unchanged in behaviour: the default gives exit 0 (`worker cpus 2 matches FFMPEG_THREADS 2, within the engine's 10 CPUs`), `WORKER_CPUS=11` gives exit 1 naming 11 and 10, and `WORKER_CPUS=10` gives exit 0.
- CI's `topology` job runs `--self-test` after the check. The Build gate row runs it after the check.

Mutants were applied to a scratch copy of the script, never to this tree, through a helper that aborts unless the pattern occurs exactly once. Each self-test exited 1, naming the case that caught it:
- N2 (engine comparison → `if (false)`): `cpus 16 on a 10-CPU engine: accepted` and `cpus 11 … (engine + 1): accepted`
- N2b (`>` → `>=`): `cpus 10 on a 10-CPU engine (equal): rejected a good input`
- N2c (pairing comparison → `if (false)`): `threads 4 with cpus 2: accepted` and `threads 1 with cpus 2: accepted`
- Also killed: the boundary moved to `> engineCpus + 1` (engine + 1 accepted), the positive-integer check loosened to `threadCount < 0`, and the pairing loosened to `cpus < threads`.

An unmutated control copy exited 0. The scratch copies were removed.

---

### T19: Route the inline smoke checks through self-tested helpers

**What**: Move the delivery-sentence check (RM-19 AC2) and the archive-key-scope check (the "smoke twice" edge case) out of `main()` into helpers, and add their failing cases to the smoke's self-test.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None
**Reuses**: The existing assertion helpers and self-test cases
**Requirement**: RM-19 AC2, RM-06 (smoke-twice edge case)

**Why**: Round-2 mutants N6 (sentence check disabled) and N9 (key-scope check weakened) survived: the checks were inline in `main()`, where no self-test reaches.

**Done when**:
- [x] The self-test rejects a delivery with a different sentence and an archive key outside `zips/<processingRequestId>/`, each with its exact message
- [x] Verified in scratch copies: N6 and N9 make the self-test exit non-zero
- [x] Quick gate passes (`node --check`, `--self-test`)

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete

**Evidence (2026-09-25).** `main()` now calls three helpers in place of its inline checks, with the same messages: `assertCompleted` (the video settles `COMPLETED`), `assertArchiveKeyScoped` (the key sits under `zips/<id>/`) and `assertDeliverySentence` (the delivery is `FAILED` with the exact sentence). The video `COMPLETED` check is included because T20 allows no assertion in `main()` outside its step list, and the round-2 report asked for it. The self-test gains 6 bad inputs, each with its exact message:
- the video observed `FAILED (PROCESSAMENTO_FALHOU)`
- an archive key under another request, and under a request whose id extends this one (`zips/<id>-2/`)
- a missing archive key
- a delivery with another sentence, and a delivery observed `COMPLETED` that carries the right sentence

It gains 3 good inputs: the video `COMPLETED`, a key under this request, and a `FAILED` delivery with the sentence. The self-test spells the sentence as a literal, so changing `FORMATO_INVALIDO_REASON` fails it too. Output: `Self-test passed: 19 bad inputs rejected with the expected message, 10 good inputs accepted` (was 13 and 7; no case removed or changed), exit 0. `node --check` exit 0.

Mutants were applied to a scratch copy of the script, never to this tree, through the exact-once helper. Each self-test exited 1:
- N6 (sentence/status check → `if (false)`): `delivery with another sentence: accepted` and `delivery observed COMPLETED: accepted`
- N9 (scope check reduced to the type check): `archive key under another request: accepted` and `… whose id extends this one: accepted`
- Also killed: the status half dropped (`delivery observed COMPLETED`), the sentence half dropped (`delivery with another sentence`), the trailing slash dropped from the scope prefix (`… whose id extends this one`), the sentence constant changed (the good delivery rejected), and the video check → `if (false)` (`video request observed FAILED: accepted`).

An unmutated control copy exited 0. The scratch copies were removed.

---

### T20: Prove the smoke's main path runs every assertion

**What**: `main()` runs its checks from one declared, ordered list of named steps, and the self-test fails when a required assertion is missing from that list.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T19
**Reuses**: The helpers from T14–T16 and T19
**Requirement**: RM-06, RM-19

**Why**: Round-2 mutants N3w, N5, N7 and N8 removed a call from `main()` and survived, because the self-test calls helpers directly.

**Done when**:
- [x] Every assertion `main()` performs is a named step in one exported list, and `main()` performs no assertion outside it
- [x] The self-test checks the list contains every required step (anonymous access, archive count, rejection, no archive, single delivery, delivery sentence, key scope, no leftovers) and fails naming any that is missing
- [x] Verified in scratch copies: N3w, N5, N7 and N8 (a step removed from the list) make the self-test exit non-zero
- [x] Build gate passes, including a real smoke run

**Tests**: integration
**Gate**: build
**Status**: ✅ Complete

**Evidence (2026-09-25, local).** `main()` is now `runSteps(SMOKE_STEPS, {})`, and nothing else. `SMOKE_STEPS` is the one exported, ordered list: `api health`, `seed`, `anonymous access`, `create requests`, `video completed`, `key scope`, `rejection`, `archive count`, `no archive`, `video delivery`, `delivery sentence`, `single delivery`, `no leftovers`. A step may `observe` the live stack into a shared context, then `check` it, then `report` a line. Every assertion is in a `check`, and a check reads only the context. The I/O helpers that used to assert (`assertArchiveFrameCount`, `assertNoArchive`, `checkAnonymousAccess`) are now observe-only (`transferArchive`, `listArchives`, `anonymousStatuses`). A check that reads a value its observe never stored fails with `Nothing was observed for <key>; …` instead of passing on `undefined`. `withScratchDir` records each directory it creates, and `no leftovers` checks at the end of the run that none still exists. It keeps its own immediate check from T15.
- The self-test adds three layers to the 19 + 10 cases from T19, which are unchanged:
  - For each of the 9 required steps (the 8 named above plus `video completed`), the step must be in `SMOKE_STEPS` with a `check`. A missing one fails with `required step "<name>" is missing from SMOKE_STEPS, or has no check`.
  - Each required step's own check runs through `runSteps`. It must reject a context holding one bad observation, with the exact message, and accept a context holding none.
  - `runSteps` must observe before it checks.
- Output: `Self-test passed: 9 required steps present, 28 bad inputs rejected with the expected message, 20 good inputs accepted`, exit 0.
- Build gate green: clean 0, `config -q` 0, sizing 0, sizing self-test 0, `up --build -d --wait` 0, seed 0, and the smoke 0 twice with distinct request ids. The run ends `No downloaded artefact left behind (1 scratch directory removed)`, and the smoke self-test gave 0. No `fiapx-smoke-*` remained. `down -v` gave 0, with no volumes left.
- Live negative: `mc anonymous set download local/fiapx` on the running stack made the smoke exit 1 at its third step, with `Anonymous access allowed: GET http://localhost:9000/fiapx/sources/sample-8s.mp4 returned 200; …`.

Mutants were applied to scratch copies of the script, never to this tree, and each pattern had to match exactly once. Each self-test exited 1:
- N3w, N5, N7 and N8 as a step removed from the list (`anonymous access`, `rejection`, `no archive`, `single delivery`): each named, e.g. `required step "rejection" is missing from SMOKE_STEPS, or has no check`.
- The same four as the assertion call removed inside the step's check: `step "<name>" given a bad observation: accepted`.
- Also killed:
  - `runSteps` no longer calling `check`
  - the removal of `no leftovers`, `key scope`, `archive count`, `delivery sentence` or `video completed`
  - the leftover check emptied
  - the archive check skipping the count
  - N6 and N9 re-applied to the restructured file

An unmutated control copy exited 0. The scratch copies were removed.

---

### T21: Put the self-tests in the documented Build gate and state their reach exactly

**What**: The Build gate row includes both `--self-test` runs, and the README describes precisely what each self-test covers.
**Where**: `.specs/features/real-media-processing/tasks.md` (Gate Check Commands), `README.md`
**Depends on**: None
**Requirement**: RM-05, RM-06

**Why**: Under the documented Build gate, M2, M3, M11 and M12 would pass (only CI ran the self-test), and the README claimed the self-test covered "every assertion above" when it did not.

**Done when**:
- [ ] The Build gate row runs `node scripts/check-worker-sizing.mjs --self-test` and `node scripts/smoke-local-integration.mjs --self-test`
- [ ] The README's description of both self-tests matches what they check, with no overstatement
- [ ] `validate_tasks.py` reports 0 errors

**Tests**: none
**Gate**: quick

---

## Phase Execution Map

Phases run in sequence; tasks within a phase run in order.

```
Phase 1 (T1 T2 T3) then Phase 2 (T4 T5) then Phase 3 (T6) then Phase 4 (T7 T8 T9 T11 T10) then Phase 5 (T12 T13 T14 T15 T16 T17) then Phase 6 (T18 T19 T20 T21)
```

Phase 5 (6 tasks) is one batch and was added after the first Verifier run; the Verifier re-runs after T17.

11 tasks pack into two task-budgeted batches at ~7 tasks per worker, cutting only on phase boundaries: **Phases 1-3** (6) and **Phase 4** (5). Because that is more than one batch, Execute must present the sub-agent offer before dispatching, and the Verifier runs automatically after T10. T11 was added after the S1–S3 verification of 2026-09-24.

**Cross-repository ordering.** T9's negative verification needs the Worker's real packager to exist so it can be substituted, and the positive assertion needs it to work; T11 likewise needs the Worker's real validator (its Phase 3). Run the Worker's Phases 3 and 4 before this repository's Phase 4; Phases 1-3 here come first, because the Worker cannot be exercised without a bucket.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Storage service | 1 service block | ✅ Granular |
| T2: Bucket bootstrap | 1 script + its ordering | ✅ Granular (cohesive - the ordering is what makes it verifiable) |
| T3: Retention rules | 1 script, extended | ✅ Granular |
| T4: Fixture + provenance | 1 binary + 1 document, one concept | ⚠️ OK - cohesive; the document is the binary's only reviewable surface |
| T5: Seed script | 1 script | ✅ Granular |
| T6: Sizing check | 1 script | ✅ Granular |
| T7: Carry the key through the smoke | 1 script | ✅ Granular |
| T8: Count archive entries | 1 function | ✅ Granular |
| T9: Assert the count + prove it fails | 1 assertion | ✅ Granular |
| T10: Documentation | 1 document | ✅ Granular |
| T11: Rejection path in the smoke | 1 seed step + 1 assertion | ✅ Granular (cohesive - the assertion is unverifiable without its seed) |
| T12: Engine-CPU sizing check + edge case | 1 script + 1 spec line | ✅ Granular (cohesive - the check enforces the corrected edge case) |
| T13: Sizing check in gate and CI | 1 workflow step + 1 gate line | ✅ Granular |
| T14: Anonymous-access assertion | 1 assertion | ✅ Granular |
| T15: Leftover-artefact assertion | 1 assertion | ✅ Granular |
| T16: Smoke self-test | 1 mode + 1 workflow step | ✅ Granular (cohesive - CI is what makes the self-test permanent) |
| T17: Deviations written back | 2 documents | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | None | — | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | None | — | ✅ Match |
| T7 | None | — | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T8 | T8 → T9 | ✅ Match |
| T10 | T11 | T11 → T10 | ✅ Match |
| T11 | T9 | T9 → T11 | ✅ Match |
| T12 | None | — | ✅ Match |
| T13 | T12 | T12 → T13 | ✅ Match |
| T14 | None | — | ✅ Match |
| T15 | None | — | ✅ Match |
| T16 | T14, T15 | T14 → T16, T15 → T16 | ✅ Match |
| T17 | None | — | ✅ Match |

No task depends on a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Compose topology | integration | integration | ✅ OK |
| T2 | Storage bootstrap | integration | integration | ✅ OK |
| T3 | Storage bootstrap | integration | integration | ✅ OK |
| T4 | Fixture + documentation | none | none | ✅ OK |
| T5 | Scripts | none | none | ✅ OK |
| T6 | Compose topology + script | integration | integration | ✅ OK |
| T7 | Scripts | none | none | ✅ OK |
| T8 | Scripts | none | none | ✅ OK |
| T9 | Smoke assertions | integration | integration | ✅ OK |
| T10 | Documentation | none | none | ✅ OK |
| T11 | Scripts + smoke assertions | integration | integration | ✅ OK |
| T12 | Scripts + spec | integration | integration | ✅ OK |
| T13 | CI + gate | integration | integration | ✅ OK |
| T14 | Smoke assertions | integration | integration | ✅ OK |
| T15 | Smoke assertions | integration | integration | ✅ OK |
| T16 | Smoke assertions + CI | integration | integration | ✅ OK |
| T17 | Documentation | none | none | ✅ OK |

The five `Tests: none` tasks all sit on layers the matrix marks `none`: this repository has no test runner, and its scripts and documents are verified by the topology run and the link check rather than by unit tests. T4, T5, T7 and T8 are each proved by T9, which fails when the fixture, the seed, the key or the count is wrong - and which is itself verified by a deliberate red run.
