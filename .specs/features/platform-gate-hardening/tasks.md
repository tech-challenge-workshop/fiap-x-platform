# Platform Gate Hardening Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/platform-gate-hardening/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — confirm before Execute. Same layers as `upload-download/tasks.md` (S6).
>
> Candidate lessons L-007..L-019 apply as guidance:
> - named, self-tested steps;
> - `main` runs only through the step list;
> - near-miss bad inputs;
> - literal negatives;
> - a restart that recreates (L-015);
> - every check the matrix assigns to the gate appears as a gate command (L-016);
> - scenario harnesses are versioned and run by the gate (L-018);
> - re-assert the link to the specific record (L-019).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Gate scripts (new or changed) | integration + self-test | Every check has one bad input, one near-miss input and one good input, each with its exact message; the script is spawned with a forced failure and must exit non-zero; the real run passes on the stack; a literal negative turns the gate red | `scripts/*.mjs` | Script plus its `--self-test` |
| Storage bootstrap | integration | Every scenario in design.md, run by the scenario runner against the stack's storage | `storage/bootstrap.sh` | `node scripts/check-storage-bootstrap.mjs` |
| Smoke steps | integration + self-test | Each new or changed step is required by the self-test, which gives it a bad and a near-miss input; the real run is green | `scripts/smoke-local-integration.mjs` | Smoke plus `--self-test` |
| Fixture | integration | Its properties are documented, and the smoke's processing-failure steps prove them on the stack | `fixtures/` | Smoke |
| Generated database script | integration | `--check` passes on the committed file and fails when one line is removed | `db/create-database.sql` | `node scripts/generate-db-script.mjs --check` |
| Documentation | none | Links resolve; every smoke step is named in the README (enforced by the smoke's self-test) | `README.md` | docs-links check |

## Gate Check Commands

> Generated from codebase — confirm before Execute. On this machine, run with `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002`. The sibling repositories must be on `main`, where spec B is merged.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Script-only changes whose checks need no stack | `node --check scripts/<changed>.mjs` and every script's `--self-test` |
| Full | Changes whose checks need the stack | `docker compose config -q`, `docker compose up --build -d --wait`, the changed script's real run, and every `--self-test` |
| Build | Last task of each phase | See the build gate steps below |

The build gate runs these steps in order:

1. `node clean-appledouble.mjs` (workspace root).
2. `docker compose config -q`.
3. `node scripts/check-worker-sizing.mjs` and its `--self-test`.
4. `node scripts/check-no-storage-writes.mjs` and its `--self-test`.
5. `node scripts/generate-db-script.mjs --check` and its `--self-test`.
6. `docker compose up --build -d --wait`.
7. `node scripts/check-storage-bootstrap.mjs` and its `--self-test`.
8. `node scripts/smoke-local-integration.mjs` and its `--self-test`.
9. `node scripts/check-identity.mjs` and its `--self-test`.
10. `docker compose up -d --wait --force-recreate identity storage-init api`.
11. The smoke and `check-identity.mjs` again.
12. `docker compose down -v`.
13. The `docs-links` job's script from `.github/workflows/ci.yml`, which must report `0 unresolved link(s)`.

Commands from scripts a task has not yet created are skipped until that task lands.

---

## Execution Plan

### Phase 1: Storage and database

```
T1 -> T2
T1 -> T3
T4
T5
```

### Phase 2: The smoke is exact and fails loudly

```
T6 -> T7
T8 -> T9
T10
```

### Phase 3: Identity, spec B, processing failure, gate

```
T11
T12
T13
T11 -> T14
T12 -> T14
T13 -> T14
```

---

## Task Breakdown

### Phase 1: Storage and database

### T1: Run the bootstrap's scenarios in the gate

**What**: Add `scripts/check-storage-bootstrap.mjs`. It runs the real `storage/bootstrap.sh` through `storage-init` against scratch buckets `fiapx-scenario-<name>`, covering these scenarios:

- `fresh`
- `rerun`
- `upgrade`
- `foreign`
- `abort-disabled`
- `abort-2-days`
- `abort-narrowed`
- `policy`

Every scenario deletes its bucket before and after. `--self-test` gives each assertion a bad, a near-miss and a good observation, and spawns the script with a forced failure.

**Where**: `scripts/check-storage-bootstrap.mjs`
**Depends on**: None
**Reuses**: The smoke's `dockerCompose()`; the self-test shape of `check-worker-sizing.mjs`
**Requirement**: GATE-01, GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] All 8 scenarios pass on the stack, and no `fiapx-scenario-*` bucket remains
- [x] Literal negatives in a scratch copy of the bootstrap each fail the named scenario:
  - loosening the foreign-rule check fails `foreign`;
  - `DaysAfterInitiation` 2 fails `fresh`;
  - removing the policy check fails `policy`
- [x] The self-test's spawned run exits non-zero with the message on stderr
- [x] Full gate passes

**Tests**: integration + self-test
**Gate**: full
**Status**: ✅ Complete
**Evidence**:
- **Real run.** `node scripts/check-storage-bootstrap.mjs` on the stack (RustFS 1.0.0, `STORAGE_HOST_PORT=39000`): `8 bootstrap scenarios passed; no fiapx-scenario-* bucket left`, in about 57 s. `list-buckets` afterwards: `fiapx` only.
- **Expectation.** The owned rules are literals in the runner, compared as ID-sorted canonical JSON, so a rule changed in the bootstrap fails instead of moving the expectation. `foreign` requires `(IDs: operator-rule)` on stderr; `policy` requires `bucket fiapx-scenario-policy has a bucket policy`, so a refusal for another reason does not pass.
- **Literal negatives.** `BOOTSTRAP_UNDER_TEST=<scratch copy>` mounts the copy over `/bootstrap.sh`; the tree was not touched:
  - `if [[ "$owned" != "$total" ]]` → `if false`: `scenario foreign failed: bootstrap exited 0, expected 1`; the other 7 passed.
  - `DaysAfterInitiation` 1 → 2 in both `desired` and `abort_correct()`: `scenario fresh failed: expected exactly the 3 owned lifecycle rules …`, and so did every other repair scenario; `foreign` and `policy` passed.
  - The policy block (lines 23-29) removed: `scenario policy failed: bootstrap exited 0, expected 1`; the other 7 passed.
- **Self-test.** `8 required scenarios present, 29 bad inputs rejected with the expected message, 15 good inputs accepted, 2 cleanup orders held, spawned failure exited non-zero`. The spawn uses a `COMPOSE_FILE` with no `storage-init` service, so it needs Docker's CLI but no stack; every scenario then fails with `no such service: storage-init`. Added to CI's `topology` job.

---

### T2: Refuse extra actions on owned rules

**What**: `correct()` and `abort_correct()` also require the other lifecycle actions to be absent (design.md). Add the scenario `abort-extra-expiration`, and `expire-extra-abort` for the check added to `correct()`.

**Where**: `storage/bootstrap.sh`
**Depends on**: T1
**Reuses**: The JMESPath checks already in the script
**Requirement**: GATE-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `abort-extra-expiration` passes: the rule is rewritten to exactly the owned one
- [x] Removing the new `==null` checks fails that scenario
- [x] Every T1 scenario still passes
- [x] Full gate passes

**Tests**: integration
**Gate**: full
**Status**: ✅ Complete
**Evidence**:
- **Red first.** With the two scenarios added and the bootstrap unchanged, the real run failed both: the abort rule kept `"Expiration":{"Days":30}`, and `expire-zips` kept its `AbortIncompleteMultipartUpload`. The other 8 passed.
- **Fix.** `correct()` adds `` AbortIncompleteMultipartUpload==`null` && Transitions==`null` && NoncurrentVersionExpiration==`null` ``; `abort_correct()` adds `` Expiration==`null` `` and the same two. JMESPath literals, since the `aws-cli` image has no `jq`.
- **Green.** `10 bootstrap scenarios passed; no fiapx-scenario-* bucket left`. On `up`, the live `fiapx` bucket printed the three `already configured` lines, so the fix does not rewrite a correct bucket.
- **Literal negative.** A scratch copy without the new `==null` checks: `abort-extra-expiration` and `expire-extra-abort` failed, the other 8 passed.
- **Deviation.** `expire-extra-abort` is not in the design's list. It covers the `correct()` half of this change, which no listed scenario reaches; design.md's table now lists it.
- **Self-test.** `10 required scenarios present, 33 bad inputs rejected with the expected message, 17 good inputs accepted, 2 cleanup orders held, spawned failure exited non-zero`.

---

### T3: The smoke reads the live lifecycle rules

**What**: Add the smoke step `bucket lifecycle`. It reads `fiapx`'s lifecycle configuration through `storage-init` and requires exactly the three owned rules, compared by ID-sorted JSON.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T1
**Reuses**: `dockerCompose()`, `listArchives` pattern
**Requirement**: GATE-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The self-test requires the step. It rejects these, each with the exact message: two rules, a fourth rule, the abort rule at 2 days, and an extra `Expiration` (near-miss). It accepts the exact set
- [x] The real run is green
- [x] Full gate passes

**Tests**: integration + self-test
**Gate**: full
**Status**: ✅ Complete
**Evidence**:
- **Step.** `bucket lifecycle`, after `anonymous access`, reads `fiapx` with `get-bucket-lifecycle-configuration` through `storage-init`'s `aws` entrypoint, never through the bootstrap. The owned rules are literals in the smoke, compared as ID-sorted canonical JSON.
- **Real run.** Green: `Bucket fiapx carries exactly expire-sources and expire-zips (7 days) and abort-incomplete-uploads (1 day)`, and every earlier step still passed.
- **Self-test.** From 20/108/44 to `21 required steps present, 112 bad inputs rejected with the expected message, 45 good inputs accepted`. The good input is the configuration as RustFS printed it, written literally in another key order.
- **Literal negative.** A scratch copy whose comparison never throws fails the self-test four times: `step "bucket lifecycle" given a bad observation: accepted, expected rejection …`.

---

### T4: The database script cannot drift

**What**: Add `generate-db-script.mjs --check`, which compares in memory and exits 1 naming the file and the first differing line, plus a `--self-test`. Then regenerate `db/create-database.sql`, which adds `uq_processing_request_owner_source`.

**Where**: `scripts/generate-db-script.mjs` (+ regenerated `db/create-database.sql`)
**Depends on**: None
**Reuses**: The existing generation path and its query-count guard
**Requirement**: GATE-04, GATE-05, GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `--check` passes on the regenerated file
- [x] Deleting one line from the file fails `--check`, naming the file
- [x] The script contains `uq_processing_request_owner_source`
- [x] Applied to an empty `postgres:17-alpine`, the script yields the same columns and indexes as the migrated stack
- [x] The self-test spawns `--check` against a tampered copy and requires a non-zero exit
- [x] Full gate passes

**Tests**: integration + self-test
**Gate**: full
**Status**: ✅ Complete
**Evidence**:
- **Drift was real.** Before the regeneration, `--check` on the committed file exited 1: `first difference at line 134, expected "-- from 1789957000000-UniqueOwnerSource.ts"`. The regeneration adds exactly that block, 4 lines: `CREATE UNIQUE INDEX IF NOT EXISTS uq_processing_request_owner_source ON processing_request (owner_user_id, source_storage_key)`. Afterwards: `db/create-database.sql is exactly what the migrations generate`.
- **One line deleted.** Line 100 removed from the committed file: `--check` exited 1 with `db/create-database.sql is not what the migrations generate: first difference at line 100, expected "        event_id              text        PRIMARY KEY,", found …`. File restored, `--check` green again.
- **Applied to an empty database.** A scratch `postgres:17-alpine` on port 55439 took the script with `ON_ERROR_STOP=1`. Its columns (`information_schema.columns`) and indexes (`pg_indexes`) in `catalog` and `notification`, TypeORM's `migrations` table excluded, gave 35 lines, identical to the migrated stack's (`diff` empty, `uq_processing_request_owner_source` in both). The container was removed.
- **Self-test.** `4 bad inputs rejected with the expected message, 1 good input accepted, --check passed on a generated script and exited non-zero with one line removed`. It needs neither the sibling repositories nor Docker: `DB_SCRIPT_ROOT` points the script at a temporary tree with one migration per service. Added to CI's `topology` job; `--check` itself needs the siblings, so it runs only in the build gate (step 5).
- **Literal negative.** A scratch copy whose comparison never reports drift fails all six self-test cases, including the spawned `--check` exiting 0.

---

### T5: The storage-write check reads every script

**What**: Walk `scripts/` recursively; reading zero files exits 1. The self-test runs the real reader on a temporary directory with `nested/writes.mjs`, and spawns the script with `SCRIPTS_DIR` pointing there.

**Where**: `scripts/check-no-storage-writes.mjs`
**Depends on**: None
**Reuses**: Its existing pattern list and self-test
**Requirement**: GATE-06, GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The nested writing script fails the check, naming `nested/writes.mjs`; without it, the check passes
- [x] An empty directory exits 1 with `no script was read under scripts/`
- [x] A reader that returns no files fails the self-test (literal negative)
- [x] The spawned run exits non-zero
- [x] Build gate passes

**Tests**: integration + self-test
**Gate**: build
**Status**: ✅ Complete
**Evidence**:
- **Red first.** The new self-test cases, added before the reader changed, failed four times: the nested writer and the empty directory were accepted, and the spawned run exited 0 with nothing on stderr.
- **Change.** `readScripts(dir)` walks subdirectories, still skipping `._*` and itself, and names files `scripts/<relative path>`. `SCRIPTS_DIR` re-roots it. Zero files read → `no script was read under scripts/`, exit 1.
- **Self-test.** From 10/6 to `12 bad inputs rejected with the expected message, 7 good inputs accepted, spawned failure exited non-zero`. The real reader runs on temporary trees: `nested/writes.mjs` with `aws s3 cp … s3://fiapx/sources/clip.mp4` is named as `scripts/nested/writes.mjs`; the same tree without it passes; an empty directory fails. The spawned run with `SCRIPTS_DIR` on that tree must exit non-zero with exactly the naming line on stderr.
- **Real run.** `5 scripts under scripts/ checked`; `SCRIPTS_DIR=<empty dir>` → `no script was read under scripts/`, exit 1.
- **Literal negatives** (scratch copies): a reader returning `[]` fails the self-test three times; a reader that skips directories fails it three times, including the spawned run exiting 0.
- **Build gate.** Steps 1-13 green with every script that exists so far: 10 bootstrap scenarios, the smoke before and after `--force-recreate identity storage-init api`, `down -v`, and docs-links `0 unresolved link(s)`. Step 9 and `check-identity.mjs` in step 11 are skipped until T11.

---

### Phase 2: The smoke is exact and fails loudly

### T6: Observations carry the id they were taken for

**What**: These helpers return `{ id, … }`, and each check requires the observed id before judging the value:

- `countDeliveries`
- `listArchives`
- `waitForNotificationDelivery`
- `waitForTerminalStatus`

Add a new step `archive object`, which requires the keys under `zips/<id>/` to be exactly `[zipStorageKey]`.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None (Phase 1 complete)
**Reuses**: `observed()`, the existing checks
**Requirement**: GATE-08, GATE-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The self-test rejects each observation taken for another id, with the exact "observed for X, expected Y" message
- [x] `archive object` rejects no keys, two keys, and one key under another name (near-miss); it accepts exactly the key
- [x] The real run is green
- [x] Full gate passes

**Tests**: integration + self-test
**Gate**: full
**Status**: ✅ Complete
**Evidence**:
- **Red first.** The new self-test cases, added before the helpers changed, failed 20 times: the two new required steps were missing, and every wrong-id observation was accepted or judged on its value.
- **Change.** `observedFor(ctx, key, idKey)` requires `ctx[key].id === ctx[idKey]` and otherwise throws `<key> observed for X, expected Y`. It is used by every check that reads a Catalog record, a delivery, a count or a listing: `video completed`, `key scope`, `archive object`, `rejection`, `archive count`, `no archive`, `video delivery`, `delivery sentence` and `single delivery`.
- **Where the id comes from.** `waitForTerminalStatus` and `waitForNotificationDelivery` take it from the record's own `processingRequestId`. `countDeliveries` and `listArchives` carry the id their query was bound to, since a count and a prefix listing hold no id of their own.
- **`archive object`.** A new step after `key scope` lists `zips/<id>/` and requires exactly `[zipStorageKey]`: `Archive for X: expected exactly [...] under zips/X/, found [...]`.
- **Changed existing checks.** `assertNoArchiveListing` takes the key array instead of the joined text. The check is unchanged: any key fails, and the message joins the keys as before.
- **Deviation.** `video delivery` had no check, so it was not required. It now stores its record and checks its id, and it is in `REQUIRED_STEPS`.
- **Self-test.** From 21/112/45 to `23 required steps present, 125 bad inputs rejected with the expected message, 47 good inputs accepted`. Ten wrong-id cases, one of them a near-miss (`<rejectedId>-2`). `archive object` rejects no keys, a second key and `<zipStorageKey>.tmp` (near-miss).
- **Real run.** Green: `Exactly one object exists under zips/564a…/: zips/564a…/9a6c…/frames.zip`.
- **Literal negative.** A scratch copy whose `observedFor` skips the comparison fails the self-test on all 10 wrong-id cases.

---

### T7: Exact download path and delivery sentence

**What**: `download issued` requires the decoded URL path to equal `/fiapx/<zipStorageKey>` of the same request. The sentence check gains four near-misses in the self-test.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T6
**Reuses**: `assertDownloadIssued`, `assertDeliverySentence`
**Requirement**: GATE-07, GATE-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The self-test rejects a URL for another request's archive, and a URL for the right key under another bucket (near-miss)
- [x] The self-test rejects the sentence's prefix, its truncation without the final period, the sentence plus a space, and an uppercase first word
- [x] A literal negative passes: a scratch API image that serves the owner's first archive for every download fails `download issued` on its second run
- [x] Full gate passes

**Tests**: integration + self-test
**Gate**: full
**Status**: ✅ Complete
**Evidence**:
- **Red first.** The three path cases failed before the check existed; the four sentence near-misses passed at once, since `assertDeliverySentence` already compares with `!==`. They now guard that comparison.
- **Change.** `assertDownloadIssued(id, download, zipKey)` requires `decodeURIComponent(new URL(url).pathname) === /fiapx/<zipKey>` after the origin check: `Download URL for X names <path>, expected /fiapx/<zipKey>, the archive of that request`.
- **Where the key comes from.** `download issued` runs before `video completed`, so its observe reads the Catalog record once the URL is issued (`downloadRequest`), and the check takes the key only after `observedFor(ctx, 'downloadRequest', 'id')`. The step keeps its place, so the live poll still sees the `409` not-yet answers.
- **Self-test.** From 23/125/47 to `23 required steps present, 132 bad inputs rejected with the expected message, 47 good inputs accepted`:
  - another request's archive;
  - the right key under bucket `fiapx2` (near-miss);
  - a `downloadRequest` for another id;
  - the sentence's prefix, its truncation, the sentence plus a space, and a case change.
- **Deviation.** The sentence's first word is `O`, already uppercase, so "an uppercase first word" would equal the sentence. The case-change near-miss lowercases it instead (`o arquivo …`).
- **Literal negative.** A scratch copy of `fiap-x-api` whose `DownloadService` signs the owner's first archive forever (S6's mutant A3), built through a compose override: run 1 green, run 2 exit 1 with `Download URL for dc1b… names /fiapx/zips/389d…/…/frames.zip, expected /fiapx/zips/dc1b…/…/frames.zip, the archive of that request`. The real API was rebuilt afterwards (no `firstArchive` in its `dist`), the smoke was green on it, and `../fiap-x-api` has no changes.

---

### T8: `main()` runs every step

**What**: `main()` becomes the one line `runSteps(SMOKE_STEPS, {}, executorFor(process.env))`. `SMOKE_DRY_RUN=1` prints each step name without observing. The self-test spawns the dry run and requires the printed names to equal `REQUIRED_STEPS`, in order.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None (Phase 1 complete)
**Reuses**: `runSteps`
**Requirement**: GATE-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Each of these fails the self-test: `SMOKE_STEPS.slice(0, 6)` in `main()`, a filter that drops one step, and two steps reordered
- [x] The real run is green
- [x] Quick gate passes

**Tests**: self-test
**Gate**: quick
**Status**: ✅ Complete
**Evidence**:
- **Red first.** Before the executor existed, the spawned "dry run" ran the live smoke and printed report lines instead of step names; the `api health` cases failed too.
- **Change.** `main()` is the one line `await runSteps(SMOKE_STEPS, {}, executorFor(process.env))`. `runSteps` hands each step to an executor. `runStep` (observe, check, report) is the live one and the default. `executorFor` returns a printer of `step.name` when `SMOKE_DRY_RUN=1`.
- **Self-test.** It spawns the script with `SMOKE_DRY_RUN=1` and requires exit 0 and stdout lines equal to `REQUIRED_STEPS`, in order. From 23/132/47 to `24 required steps present, 134 bad inputs rejected with the expected message, 48 good inputs accepted, main() ran every step in order in a dry run`.
- **Deviation.** `api health` is a step `main()` runs, but it had no check and was not in `REQUIRED_STEPS`, so the dry run could never equal the list. `waitForApiHealth` now returns the answering status; the step stores it; and `assertApiHealthy` requires 200 (bad 503, near-miss 204). `api health` heads `REQUIRED_STEPS`. The rule that every required step has a check is kept, with no exemption.
- **Literal negatives** (scratch copies), each failing the self-test once, on the dry-run comparison, with exit 1:
  - `SMOKE_STEPS.slice(0, 6)` in `main()`;
  - a filter dropping `single delivery`;
  - `no internal fields` moved before `cross-owner download 404`.
- **Real run.** Green.

---

### T9: The smoke exits non-zero on failure

**What**: The smoke's self-test spawns it with `API_URL=http://127.0.0.1:9 HEALTH_TIMEOUT_MS=1`, and requires a non-zero exit and the health message on stderr.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T8
**Reuses**: T8's spawn helper
**Requirement**: GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Replacing `process.exitCode = 1` with `0` in `main()`'s catch fails the self-test
- [x] Quick gate passes

**Tests**: self-test
**Gate**: quick
**Status**: ✅ Complete
**Evidence**:
- **Change.** The self-test spawns the live run, with `SMOKE_DRY_RUN` removed from its environment, as `API_URL=http://127.0.0.1:9 HEALTH_TIMEOUT_MS=1`. It requires a non-zero exit and stderr exactly `API health check timed out\n`. The run takes about 1 s (one poll interval) and needs no stack.
- **Passes on arrival.** `main()`'s catch already set exit code 1, so the new case passed at once; the literal negatives below are its red.
- **Self-test.** Counts unchanged at 24/134/48; the line now ends `…, main() ran every step in order in a dry run, spawned failure exited non-zero`.
- **Literal negatives** (scratch copies), each failing the self-test with exit 1:
  - `process.exitCode = 0` in `main()`'s catch: `spawned run against an unreachable API exited 0, expected non-zero`;
  - the error printed with `console.log`: `… printed "" on stderr, expected "API health check timed out\n"`.

---

### T10: The Worker sizing check exits non-zero on failure

**What**: `SIZING_CONFIG_JSON` injects the rendered configuration. The self-test spawns the script with mismatched values and requires a non-zero exit and the message.

**Where**: `scripts/check-worker-sizing.mjs`
**Depends on**: None (Phase 1 complete)
**Reuses**: Its existing comparisons
**Requirement**: GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Exiting 0 on a mismatch fails the self-test
- [x] The real run still reads `docker compose config` when the variable is unset
- [x] Build gate passes

**Tests**: integration + self-test
**Gate**: build
**Status**: ✅ Complete
**Evidence**:
- **Red first.** The spawn case, added before the variable existed, failed twice: the spawned script rendered the real configuration, exited 0, and printed nothing on stderr.
- **Change.** `main()` takes `configJson`, which defaults to `process.env.SIZING_CONFIG_JSON`. When set, it stands in for the output of `docker compose config`; when unset, `exec` runs the command as before. Every check after that point is unchanged.
- **Self-test.** From 12/7 to `12 bad inputs rejected with the expected message, 7 good inputs accepted, spawned failure exited non-zero`. The spawn injects `cpus: 2`, `FFMPEG_THREADS: "4"` and requires a non-zero exit and exactly `check-worker-sizing: worker cpus is 2 but FFMPEG_THREADS is 4; both must come from WORKER_CPUS\n` on stderr. The mismatch stops the script before `docker info`, so it needs no Docker.
- **Real run unchanged.** Without the variable: `worker cpus 2 matches FFMPEG_THREADS 2, within the engine's 10 CPUs`. With `WORKER_CPUS=3`, the same run reports `cpus 3 … FFMPEG_THREADS 3`, so it still reads the rendered compose configuration.
- **Literal negative.** A scratch copy whose `fail()` calls `process.exit(0)` fails the self-test: `spawned run with mismatched values exited 0, expected non-zero`.
- **Build gate** (Phase 2 close), steps 1-13 green with every script that exists so far:
  - 10 bootstrap scenarios;
  - the smoke (24 steps) before and after `--force-recreate identity storage-init api`;
  - `down -v`;
  - docs-links `0 unresolved link(s)`.

  Step 9, and `check-identity.mjs` in step 11, are skipped until T11.

---

### Phase 3: Identity, spec B, processing failure, gate

### T11: Check the identity's properties

**What**: Add `scripts/check-identity.mjs` with the six checks in design.md: pinned `sub`, in-network `iss`, registration disabled, `tmpfs`, API after identity, and the `get-token` CLI. Its `--self-test` gives each check bad, near-miss and good inputs, and spawns the script with `IDENTITY_URL=http://127.0.0.1:9`.

**Where**: `scripts/check-identity.mjs`
**Depends on**: None (Phase 2 complete)
**Reuses**: `getToken`, `IDENTITY_URL`, the realm file's pinned ids
**Requirement**: GATE-13, GATE-14, GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The real run passes on the stack
- [x] Each literal negative, on scratch copies, fails its named check:
  - `KC_HOSTNAME` dropped;
  - `registrationAllowed: true`;
  - `tmpfs` dropped;
  - `api`'s `depends_on: identity` dropped;
  - `get-token` printing `token: <jwt>`
- [x] The spawned run exits non-zero naming `identity`
- [ ] Full gate passes (not run in T11: it ends in `down -v`, and the stack stays up for T12; runs at T14)

**Tests**: integration + self-test
**Gate**: full
**Status**: ✅ Complete (full gate pending, see above)
**Evidence**:
- **Red first.** A scratch copy whose six checks return without judging fails the self-test with 20 failures, one per bad input, and exits 1.
- **Self-test.** `6 required checks present, 20 bad inputs rejected with the expected message, 6 good inputs accepted, spawned failure exited non-zero`. Each check has a bad input and at least one near-miss (trailing slash on `iss`, `registrationAllowed` absent or `"false"`, tmpfs on the parent directory, `service_started`, a token of two segments). The spawn sets `IDENTITY_URL=http://127.0.0.1:9` and requires a non-zero exit and a stderr line starting `check-identity: sub pinned failed: the identity service (compose service "identity", http://127.0.0.1:9) is unreachable`. It needs no stack; CI's `topology` job runs it.
- **Real run.** `6 identity checks passed` on the stack.
- **Literal negatives.** Each uses an override file or scratch copy in the scratchpad, never the real `compose.yaml`, realm or script:
  - `KC_HOSTNAME` dropped (`environment: !override`, identity recreated): `in-network iss failed: … carries iss "http://identity:8080/realms/fiapx"`;
  - a scratch realm with `registrationAllowed: true` mounted over the import: `registration disabled failed: realm fiapx has registrationAllowed true`;
  - `tmpfs: !reset []`: `h2 on tmpfs failed: … no tmpfs at /opt/keycloak/data/h2 (tmpfs mounts: {})`;
  - api's `depends_on` without identity (`COMPOSE_FILE` with the override, identity and api recreated): `api after identity failed: … condition undefined`;
  - a scratch `get-token.mjs` printing `token: <jwt>`, run through `GET_TOKEN_UNDER_TEST`: `get-token cli failed: … printed "token: <jwt>\n" on stdout, expected exactly one JWT line`.

  Each run failed only its named check and exited 1. The stack was then restored with `docker compose up -d --wait --force-recreate identity api` and the real run was green again.

---

### T12: Spec B on the real stack

**What**: Add two smoke steps:

- `invalid parts rejected`: 20 MiB declared, 1 byte then 4 MiB; confirmation → exact `400`, retry → `404 Upload not found`.
- `second key replays`: the fixture's completed upload confirmed with a fresh key → `200`, same id, `alice`'s total unchanged.

**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None (Phase 2 complete)
**Reuses**: `uploadThroughApi`, `putPart`, `confirm`, `totalAs`, `assertReplayed`
**Requirement**: GATE-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] The self-test requires both steps and rejects these: a `502`, a `400` with another message (near-miss), a retry `400`, a replay `201`, another id, and a grown total
- [x] The real run is green
- [ ] Full gate passes (not run in T12: it ends in `down -v`, and the stack stays up for T13; runs at T14)

**Tests**: integration + self-test
**Gate**: full
**Status**: ✅ Complete (full gate pending, see above)
**Evidence**:
- **Red first.** With both names in `REQUIRED_STEPS` and the self-test cases written, before the steps existed, the self-test failed 16 times (dry run unequal to `REQUIRED_STEPS`, both steps missing, every bad and good input) and exited 1.
- **Change.** `second key replays` runs right after `confirmation replay`: it confirms `ctx.videoUpload` with a fresh key and measures alice's total before and after its own call, so neither step's total sees the other's confirmation. Its check is `assertReplayed` with its own call name (`assertReplayed` takes the call as an optional fourth argument; the existing messages are unchanged). `invalid parts rejected` runs after `key reuse conflict`: `uploadInvalidParts` starts a 20971520-byte upload, PUTs 1 byte to part 1 and 4194304 bytes to part 2, and confirms twice with one fresh key. `assertInvalidPartsRejected` requires the upload started and both PUTs answered 200 (`assertUploaded`), then exactly `400 {"statusCode":400,"message":"Uploaded parts are invalid: every part except the last must be 16777216 bytes"}` (field order ignored, no extra field), then exactly `404 {"statusCode":404,"message":"Upload not found"}`. A 2xx first answer is named `Invalid parts accepted`.
- **Self-test.** From 24/134/48 to `26 required steps present, 145 bad inputs rejected with the expected message, 50 good inputs accepted, main() ran every step in order in a dry run, spawned failure exited non-zero`. New bad inputs: second key `201` (with a grown total), another id, a grown total, a `409`; invalid parts `502`, `201`, `400 No part has been uploaded`, `400` with `16 MiB` for `16777216` (near-miss), retry `400`, retry `404 Processing request not found` (near-miss), a PUT `403`. The expected messages and bodies are literals, not the script's constants.
- **Real run.** Green on the stack (API built from `fiap-x-api` `323fc3a`): `alice's confirmed upload confirmed with a second key answered 200 with <id>; she still has N requests` and `alice's 20 MiB upload with a 1-byte part 1 was refused with 400 (…16777216 bytes), and its retry found no upload (404)`.
- **Literal negative.** A scratch copy of `fiap-x-api` (scratchpad, `git archive HEAD`) whose `complete-upload.service.ts` throws `BadGatewayException` for rejected parts, built through a compose override `api.build`: the smoke failed `invalid parts rejected` with `alice's confirmation of a 20 MiB upload whose part 1 holds 1 byte returned 502, expected 400` and exited 1, every earlier step green. The real API was rebuilt with `docker compose up -d --build --wait api`, and the smoke and the self-test were green again.

---

### T13: Prove a processing failure end to end

**What**: Commit `fixtures/corrupted-8s.mp4` (`sample-8s.mp4` with its `mdat` payload zeroed; SHA-256 `24123d94…9454`) and document it in `fixtures/README.md`. Add three smoke steps:

- `processing failure`: `FAILED` with `PROCESSAMENTO_FALHOU`.
- `processing failure archive`: no key.
- `processing failure delivery`: one record with the exact sentence `Nao foi possivel processar o video. Tente enviar novamente.`

**Where**: `scripts/smoke-local-integration.mjs` (+ `fixtures/corrupted-8s.mp4`, `fixtures/README.md`)
**Depends on**: None (Phase 2 complete)
**Reuses**: `uploadAndConfirm`, T6's id-carrying observations, `assertDeliverySentence` generalised by code
**Requirement**: GATE-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The committed fixture's SHA-256 matches, and the README's command reproduces it
- [ ] The self-test rejects `COMPLETED`, `FAILED (FORMATO_INVALIDO)` (the edge case), an archive key, two deliveries, and the `FORMATO_INVALIDO` sentence
- [ ] The real run is green
- [ ] Literal negative: with the valid fixture in its place, `processing failure` fails naming `COMPLETED`
- [ ] Full gate passes

**Tests**: integration + self-test
**Gate**: full

---

### T14: Recreate what matters and document the gate

**What**:

- The build gate's recreate step becomes `--force-recreate identity storage-init api`, followed by the smoke and `check-identity.mjs`.
- `README.md` describes every gate command, the three new scripts, every smoke step and the new fixture.
- The smoke's self-test requires every step name to appear in `README.md`.
- Update the Build row of this file's gate table.

**Where**: `README.md` (+ the smoke's self-test and this `tasks.md`)
**Depends on**: T11, T12, T13
**Reuses**: The docs-links job
**Requirement**: GATE-13, GATE-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Removing a step's name from the README fails the self-test
- [ ] The full build gate is green, with `check-identity.mjs` passing before and after the recreate
- [ ] The docs-links check reports 0 unresolved links

**Tests**: self-test
**Gate**: build

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3 T4 T5) then Phase 2 (T6 T7 T8 T9 T10) then Phase 3 (T11 T12 T13 T14)
```

14 tasks: **Phase 1** (5), **Phase 2** (5), **Phase 3** (4). This repository only.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Scenario runner | 1 new script | ✅ Granular |
| T2: Exact owned rules | 2 functions in 1 script | ✅ Granular |
| T3: Lifecycle step | 1 step | ✅ Granular |
| T4: Drift check + regeneration | 1 mode + its generated output | ⚠️ OK - cohesive; the check cannot pass without the regeneration |
| T5: Recursive storage-write check | 1 script | ✅ Granular |
| T6: Id-carrying observations | 4 helpers + 1 step in 1 file | ⚠️ OK - cohesive; one invariant applied to every observation |
| T7: Exact path and sentence | 2 checks | ✅ Granular |
| T8: Dry-run executor | 1 function | ✅ Granular |
| T9: Smoke exit code | 1 self-test case | ✅ Granular |
| T10: Sizing exit code | 1 script | ✅ Granular |
| T11: Identity check | 1 new script | ✅ Granular |
| T12: Spec B steps | 2 steps | ✅ Granular |
| T13: Fixture + failure steps | 1 fixture + 3 steps | ⚠️ OK - cohesive; the fixture exists only for these steps |
| T14: Gate + README | 1 document + 1 self-test check (+ the gate row in this file) | ⚠️ OK - cohesive; documents the gate it closes |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T1 | T1 → T3 | ✅ Match |
| T4 | None | — | ✅ Match |
| T5 | None | — | ✅ Match |
| T6 | None (Phase 1 complete) | — | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | None (Phase 1 complete) | — | ✅ Match |
| T9 | T8 | T8 → T9 | ✅ Match |
| T10 | None (Phase 1 complete) | — | ✅ Match |
| T11 | None (Phase 2 complete) | — | ✅ Match |
| T12 | None (Phase 2 complete) | — | ✅ Match |
| T13 | None (Phase 2 complete) | — | ✅ Match |
| T14 | T11, T12, T13 | T11 → T14, T12 → T14, T13 → T14 | ✅ Match |

No task depends on a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Gate script | integration + self-test | integration + self-test | ✅ OK |
| T2 | Storage bootstrap | integration | integration | ✅ OK |
| T3 | Smoke step | integration + self-test | integration + self-test | ✅ OK |
| T4 | Gate script + generated database script | integration + self-test | integration + self-test | ✅ OK |
| T5 | Gate script | integration + self-test | integration + self-test | ✅ OK |
| T6 | Smoke steps | integration + self-test | integration + self-test | ✅ OK |
| T7 | Smoke steps | integration + self-test | integration + self-test | ✅ OK |
| T8 | Smoke (`main`) | self-test | self-test | ✅ OK |
| T9 | Smoke (exit code) | self-test | self-test | ✅ OK |
| T10 | Gate script | integration + self-test | integration + self-test | ✅ OK |
| T11 | Gate script | integration + self-test | integration + self-test | ✅ OK |
| T12 | Smoke steps | integration + self-test | integration + self-test | ✅ OK |
| T13 | Fixture + smoke steps | integration + self-test | integration + self-test | ✅ OK |
| T14 | Documentation + smoke self-test | none + self-test | self-test | ✅ OK |
