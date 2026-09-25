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
| Build | After phase completion | `node clean-appledouble.mjs` from the workspace root, then `docker compose config -q`, `docker compose up --build -d --wait`, `node scripts/seed-source-video.mjs`, `node scripts/smoke-local-integration.mjs`, `docker compose down -v` |

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
- [x] Asserts `mc anonymous get` reports `none` and exits non-zero otherwise; it never **sets** the policy, because a set could only loosen it
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
- [ ] `mc ilm rule add --expire-days 7 --prefix "sources/"` and the same for `zips/`
- [ ] Each rule is guarded by a check for an existing rule on that prefix, so a re-run neither fails nor accumulates duplicates
- [ ] Reading the lifecycle configuration back shows exactly two rules, both at 7 days
- [ ] Verified after a second `up` without `down -v`: still exactly two rules
- [ ] Full gate passes: `docker compose config -q` then `docker compose up --build -d --wait`

**Tests**: integration
**Gate**: full

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
- [ ] `fixtures/sample-8s.mp4` exists: 8 seconds, 320×240, H.264 in MP4, a few hundred KB
- [ ] `fixtures/README.md` carries the exact generating command verbatim, the declared duration, and the frame count that follows at 1 frame per second
- [ ] The README states that the expected frame count in the smoke is derived from this file, so changing the fixture without changing the expectation fails the smoke rather than passing unnoticed
- [ ] The design's revision is reflected: the fixture is committed rather than generated at seed time, because generating would require FFmpeg on the host
- [ ] Quick gate passes: the relative-link check from the `docs-links` job in `.github/workflows/ci.yml`

**Tests**: none
**Gate**: quick

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
- [ ] Transfers the fixture with `mc` in a container rather than an SDK, naming the file explicitly rather than globbing the directory - exFAT sidecars would otherwise be uploaded
- [ ] Prints the resulting storage key on stdout, so the smoke can consume it
- [ ] Uses a fixed key, so running twice leaves exactly one object without a delete-then-write
- [ ] Exits non-zero naming the unreachable service when the stack is down, rather than reporting success
- [ ] Quick gate passes: `node --check scripts/seed-source-video.mjs`

**Tests**: none
**Gate**: quick

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
- [ ] A single `.env` value drives both the Worker's `cpus` limit and its `FFMPEG_THREADS`
- [ ] The check reads `docker compose config` **output**, not the template, so it verifies the substitution rather than the intent
- [ ] A deliberate mismatch fails the check, and the message names both values
- [ ] Uses the top-level `cpus` field rather than `deploy.resources.limits`, which Compose ignores outside Swarm - a declared limit that is not enforced would make the pairing unprovable locally
- [ ] The README states that this declared value is the contract S9a carries into Kubernetes `limits`
- [ ] Full gate passes: `docker compose config -q` then `docker compose up --build -d --wait`

**Tests**: integration
**Gate**: full

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
- [ ] The smoke seeds (or requires a seeded key) and posts a request naming it
- [ ] `zipStorageKey` is read from the Catalog status the smoke already polls
- [ ] Each run creates a distinct request, so a second run cannot assert against the previous run's archive
- [ ] Quick gate passes: `node --check scripts/smoke-local-integration.mjs`

**Tests**: none
**Gate**: quick

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
- [ ] Scans backwards for the `0x06054b50` signature and reads the 16-bit total-entries field at offset 10
- [ ] Throws a distinguishable error when no signature is found, so "unreadable" is separable from "empty"
- [ ] Keeps the repository dependency-free - no `package.json` is introduced to unzip a file
- [ ] Quick gate passes: `node --check scripts/smoke-local-integration.mjs`

**Tests**: none
**Gate**: quick

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
- [ ] The archive is downloaded and its entry count asserted equal to the fixture's duration in seconds at 1 frame per second
- [ ] The three failure outcomes are reported distinctly: absent (the transfer fails), unreadable (no EOCD signature), empty (zero entries)
- [ ] A count mismatch names both the expected and the actual number, so an off-by-one is legible
- [ ] No downloaded artefact is left behind after the script exits
- [ ] **Verified negatively**: with the Worker's frame packager replaced by one that stores nothing, the smoke exits non-zero and names the absent archive. An assertion that has never failed is not known to work - this is the concrete lesson from the previous slice, where a status-only smoke would have passed against a fully stubbed implementation
- [ ] Build gate passes: `node clean-appledouble.mjs`, `docker compose config -q`, `docker compose up --build -d --wait`, `node scripts/seed-source-video.mjs`, `node scripts/smoke-local-integration.mjs`, `docker compose down -v`

**Tests**: integration
**Gate**: build

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
- [ ] The seed places a small text payload under `sources/` with an `.mp4` name, generated at seed time rather than committed
- [ ] The smoke creates one request per seeded object and waits for both to settle
- [ ] The rejected request is asserted `FAILED` with the exact safe reason the Catalog maps from `FORMATO_INVALIDO`, no object under its `zips/` prefix, and exactly one Notification delivery record for its terminal event
- [ ] A request that settles `COMPLETED`, or stays non-terminal past the timeout, fails the smoke naming the observed status
- [ ] **Verified negatively**: with the Worker bound back to `AcceptAllVideoValidator`, the smoke exits non-zero and names `COMPLETED` where `FAILED` was expected
- [ ] Build gate passes: the same sequence as T9

**Tests**: integration
**Gate**: build

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
- [ ] The bucket layout and both prefixes are documented, with the 7-day expiry stated as a product rule from `docs/foudation.md`
- [ ] Seeding is documented as a stand-in that S6 removes, so nobody maintains it as a feature
- [ ] It states that the bootstrap runs on every start and is therefore idempotent - unlike the SQL bootstrap, which runs only on an empty volume
- [ ] It states that the declared CPU limit is the contract S9a carries into Kubernetes `limits`
- [ ] It states that the smoke proves two outcomes per run: an archive with the right frame count, and a rejection with the safe reason
- [ ] Quick gate passes: the relative-link check from the `docs-links` job in `.github/workflows/ci.yml`

**Tests**: none
**Gate**: quick

---

## Phase Execution Map

Phases run in sequence; tasks within a phase run in order.

```
Phase 1 (T1 T2 T3) then Phase 2 (T4 T5) then Phase 3 (T6) then Phase 4 (T7 T8 T9 T11 T10)
```

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

The five `Tests: none` tasks all sit on layers the matrix marks `none`: this repository has no test runner, and its scripts and documents are verified by the topology run and the link check rather than by unit tests. T4, T5, T7 and T8 are each proved by T9, which fails when the fixture, the seed, the key or the count is wrong - and which is itself verified by a deliberate red run.
