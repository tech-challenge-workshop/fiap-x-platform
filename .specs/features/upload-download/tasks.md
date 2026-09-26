# Upload and Download Tasks — platform

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/upload-download/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Same layers as `auth-owner-scope/tasks.md` (S5). Candidate lessons applied: L-007..L-017 — named, self-tested steps; main runs only through the step list; near-miss bad inputs; literal negatives; **every check the matrix assigns to the gate appears as a command in the gate** (L-016).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Compose topology | integration | API receives the storage variables; public endpoint follows `STORAGE_HOST_PORT`; API waits on the bootstrap | `compose.yaml` | Build gate |
| Storage bootstrap | integration | Three owned rules, idempotent, foreign rules refused, a two-rule bucket upgraded | `storage/bootstrap.sh` | Build gate + negatives |
| Smoke assertions | integration | Each new step required by the self-test with a bad and a near-miss input; real run green; literal negatives | `scripts/smoke-local-integration.mjs` | Build gate + `--self-test` |
| Generated database script | none | Regenerated and matching the migrations | `db/create-database.sql` | Build gate |
| Documentation | none | Links resolve | `README.md` | docs-links check |

## Gate Check Commands

> Generated from codebase - confirm before Execute. On this machine run with `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002` (S5 T10/T11). The seed step left the gate in T4, which added the storage-write check and its self-test (L-016).

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Script or document only | `node --check scripts/<changed>.mjs`, `node scripts/check-no-storage-writes.mjs`, the three `--self-test`s |
| Full | Compose / bootstrap changes | `docker compose config -q` then `docker compose up --build -d --wait` |
| Build | After a phase | `node clean-appledouble.mjs` (workspace root), `docker compose config -q`, `node scripts/check-worker-sizing.mjs`, `node scripts/check-worker-sizing.mjs --self-test`, `node scripts/check-no-storage-writes.mjs`, `node scripts/check-no-storage-writes.mjs --self-test`, `docker compose up --build -d --wait`, `node scripts/smoke-local-integration.mjs`, `node scripts/smoke-local-integration.mjs --self-test`, `docker compose up -d --wait --force-recreate identity storage-init` (L-015: a restart that recreates), the smoke again, `docker compose down -v`, and the `docs-links` job's script from `.github/workflows/ci.yml` reporting `0 unresolved link(s)` |

---

## Execution Plan

### Phase 1: Storage for the API

```
T1
T2
T3
```

### Phase 2: The smoke proves the real flow

```
T4 -> T5
T5 -> T6
T6 -> T7
T7 -> T8
```

---

## Task Breakdown

### Phase 1: Storage for the API

### T1: Give the API storage credentials and a public endpoint

**What**: The `api` service gets `STORAGE_ENDPOINT`, `STORAGE_PUBLIC_ENDPOINT=http://localhost:${STORAGE_HOST_PORT:-9000}`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, and `depends_on: storage-init: service_completed_successfully`.
**Where**: `compose.yaml`
**Depends on**: None
**Reuses**: The Worker's storage block
**Requirement**: UPL-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `docker compose config` renders the public endpoint with the default port unset and with `STORAGE_HOST_PORT=39000`
- [x] With the API from `feat/upload-download`: a part URL from `POST /uploads` targets `localhost:39000` and accepts a `PUT` from the host
- [x] Full gate passes

**Tests**: integration
**Gate**: full
**Status**: ✅ Complete
**Evidence**:
- **Config.** `docker compose config -q` passes. Unset, the `api` service renders `STORAGE_PUBLIC_ENDPOINT=http://localhost:9000`. With `STORAGE_HOST_PORT=39000`, it renders `http://localhost:39000`, and storage is published on `39000`. `STORAGE_ENDPOINT=http://storage:9000`, `STORAGE_BUCKET=fiapx` and the Worker's credentials are present. `depends_on.storage-init` is `service_completed_successfully`.
- **Full gate.** Ran with `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002`, with `fiap-x-api` `db0ce83` and `processing-catalog` `432ee94`. `up --build -d --wait` brought every service to healthy. `storage-init` exited 0 at 05:50:50, and `api` started at 05:50:57.
- **Probe.** `POST /uploads` as `alice` (token from `getToken`) with `{fileName:"t1-probe.mp4", contentType:"video/mp4", sizeBytes:27}` answered 201. It returned `partSize:16777216` and one part whose URL is `http://localhost:39000/fiapx/sources/<alice's sub>/<uploadId>.mp4?…`. A plain `PUT` of the bytes from the host answered 200 with an ETag.
- **Not yet in the gate.** The `PUT` was a one-off probe. It becomes a gate command with T4's `upload confirmed` step, and T8 adds its internal-host negative (L-016).
- **Interpretation.** The TTL overrides are left unset, so the API's defaults of 3600 s and 300 s apply. Setting them in compose would restate the defaults in a second place.

---

### T2: Own a third lifecycle rule that aborts abandoned uploads

**What**: `abort-incomplete-uploads` (`AbortIncompleteMultipartUpload` after 1 day, `Filter.Prefix: ""`) joins the bootstrap's owned rules; desired config and read-back carry three rules.
**Where**: `storage/bootstrap.sh`
**Depends on**: None
**Reuses**: The ID-based ownership from AD-014's fix
**Requirement**: UPL-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Fresh bucket → three rules read back; re-run → all three `already configured`; a two-rule bucket (the S5 state) → upgraded to three
- [x] A foreign rule still → exit 1 naming it, configuration intact; the abort rule disabled or at 2 days → rewritten
- [x] Full gate passes

**Tests**: integration
**Gate**: full
**Status**: ✅ Complete
**Evidence**:
- **How the scenarios ran.** Each scenario ran the real `storage/bootstrap.sh` through `docker compose run storage-init -e STORAGE_BUCKET=<scratch bucket>` against the stack's RustFS 1.0.0. A scenario asserts the exit code and the exact output line. It also asserts the read-back rules, sorted by ID and compared as JSON against the three rules the spec requires.
- **Results.** 27 of 27 assertions passed:
  - A fresh bucket gets `created`, then `… and abort of incomplete uploads configured`, and reads back exactly three rules.
  - A re-run prints all three `already configured` lines, does not rewrite, and leaves the configuration unchanged.
  - A bucket carrying only the S5 pair is upgraded to the three rules.
  - A foreign rule `someone-elses-rule` exits 1 with `… has 1 lifecycle rule(s) this bootstrap does not own (IDs: someone-elses-rule); refusing to overwrite them`, and the configuration stays byte-identical.
  - An abort rule that is `Disabled`, at 2 days, or narrowed to `sources/` is rewritten to the required rule.
- **Discrimination.** The same scenarios run against the pre-T2 bootstrap (`git show HEAD:storage/bootstrap.sh`, mounted over `/bootstrap.sh`) fail 16 assertions.
- **Read-back filter.** RustFS reads `Filter.Prefix: ""` back as `""`, so the abort check requires the whole-bucket filter as well as `Enabled` and 1 day.
- **Full gate.** Ran with the port overrides. `config -q` and `up --build -d --wait` pass, every service is healthy, and `storage-init` exits 0. It upgraded the live `fiapx` bucket, left in the S5 state by T1's run, from `expire-sources expire-zips` to `expire-sources expire-zips abort-incomplete-uploads`.
- **Open item (L-005).** The scenario harness is not versioned in the repository. No task names a location for it, so it ran from a scratch file.

---

### T3: Regenerate the database script with the idempotency key

**What**: `scripts/generate-db-script.mjs` against `processing-catalog`'s `feat/upload-download` migrations.
**Where**: `db/create-database.sql`
**Depends on**: None (needs `processing-catalog` T1 committed)
**Reuses**: The generator's `query()` count guard
**Requirement**: UPL-18

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] The script adds `idempotency_key` and `uq_processing_request_owner_idempotency`
- [x] Applied to an empty database, the columns and indexes equal the migrations'
- [x] Build gate passes (after Phase 2's T4 makes the smoke use the upload flow; until then recorded as Partial, as S5's T3 was)

**Tests**: none
**Gate**: build
**Status**: ✅ Complete. The build box was ticked by T4, whose build gate ran green with this script in the stack's database; see T4's evidence.
**Evidence**:
- **Generated script.** Generated from `processing-catalog` `432ee94`. The script gains a block `-- from 1789956000000-AddIdempotencyKey.ts` with `ALTER TABLE processing_request ADD COLUMN IF NOT EXISTS idempotency_key text NULL;` and `CREATE UNIQUE INDEX IF NOT EXISTS uq_processing_request_owner_idempotency ON processing_request (owner_user_id, idempotency_key);`. Nothing else changed. The generator's count guard passed: both `query()` calls were read.
- **Empty-database comparison.** The script was applied with `ON_ERROR_STOP=1` to an empty `postgres:17-alpine` with no published port (container removed). Its columns and indexes, 34 rows of `information_schema.columns` plus `pg_indexes` for `catalog` and `notification` excluding the ledger, are identical to the stack's migration-run database. That database's ledger holds all four Catalog migrations and the Notification one. `idempotency_key` is `text`, nullable. The unique index is `(owner_user_id, idempotency_key)`.
- **Build gate.** Ran with the port overrides. These all pass:
  - `clean-appledouble`, `config -q`
  - the sizing check and its self-test (12 / 7)
  - `up --build -d --wait`
  - smoke `--self-test` (14 / 58 / 31)
  - `up -d --wait --force-recreate identity storage-init`: the recreated bootstrap reports all three rules already configured
  - `down -v`
- **Where the smoke stops.** Both real smoke runs stop at `Anonymous POST http://localhost:3000/processing-requests without a token returned 404, expected 401`. The step before creation already sees the removed endpoint, which T4 replaces with the upload flow.

---

### Phase 2: The smoke proves the real flow

### T4: Remove the seed and upload through the API

**What**: Delete `scripts/seed-source-video.mjs` and its gate step; add `uploadThroughApi` and `confirm`; the smoke uploads the fixture and the non-video as `alice` through the API; new steps `old create gone` and `upload confirmed`.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: None
**Reuses**: `getToken`, `SMOKE_STEPS`, `runSteps`
**Requirement**: UPL-17, UPL-18

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] No script writes videos to storage outside the API (the seed is gone; a check asserts no `aws s3 cp`/`put-object` to `sources/` remains in `scripts/`)
- [x] Every S4/S5 step still passes with both requests created through uploads
- [x] Self-test requires both new steps and rejects a bad and a near-miss input each
- [x] T3's build box ticked once this gate is green
- [x] Build gate passes

**Tests**: integration
**Gate**: build
**Status**: ✅ Complete
**Evidence**:
- **Seed removed.** `scripts/seed-source-video.mjs` is deleted. Nothing references it outside earlier features' records.
- **Storage-write check.** `scripts/check-no-storage-writes.mjs` fails, naming the file and the kind of write, when a script under `scripts/` writes into the bucket. It flags an `aws s3 cp` whose last path is `s3://`, `s3 mv`/`sync`, `put-object`, `copy-object`, the multipart calls and SDK writes. It flags any write into the bucket, not only a literal `sources/` key, because the seed held its key in a constant on another line. Against the tree before the deletion it exited 1: `scripts/seed-source-video.mjs writes into the bucket outside the API (aws s3 cp into the bucket); …`. After the deletion it passes: `4 scripts under scripts/ checked`.
  - Its `--self-test` passes with 10 bad and 6 good inputs. The seed's two calls verbatim, a shell copy, the archive read with its paths swapped (near-miss), `sync`, `put-object`, the multipart pair, `PutObjectCommand`, two writers among clean files, and `main` with the seed among the scripts are each named. The archive read to stdout, a read to a file, a listing and a `PUT` to an issued URL pass.
  - Both commands are in the Build and Quick gates and in CI's `topology` job (L-002, L-016).
- **Smoke.** Steps before: `api health`, `seed`, `anonymous access`, `anonymous refused`, `create requests`, `video completed`, `key scope`, `rejection`, `archive count`, `no archive`, `video delivery`, `delivery sentence`, `single delivery`, `bob request created`, `lists disjoint`, `cross-owner read 404`, `no internal fields`, `no leftovers`. Steps after: `api health`, `anonymous refused`, `old create gone`, `upload confirmed`, `anonymous access`, then the S4/S5 steps from `video completed` on, unchanged in order.
  - `uploadThroughApi` starts an upload, then `PUT`s each part's slice to its URL from the host. `confirm` sends the `Idempotency-Key`. Neither judges its answer.
  - `upload confirmed` uploads the fixture and the non-video as `alice`, each with its own key. `assertUploaded` requires 201 with an `uploadId` and part URLs, every URL on `STORAGE_ORIGIN` (named before its `PUT` is judged), and every `PUT` 200. `assertConfirmed` requires 201, a `processingRequestId` and `RECEIVED`. The source key for `anonymous access` is read from the part URL's path.
  - `bob request created` goes through the same upload and the same two checks.
  - `anonymous refused` now requires 401 on `POST /uploads`, `POST /uploads/:uploadId/complete` and `GET /processing-requests`, because creation is two calls now.
  - `old create gone` requires `alice`'s `POST /processing-requests` to answer 404 with the message `Cannot POST /processing-requests`. A 2xx fails as `Old creation route still creates`.
- **Self-test.** Before: 14 steps, 58 bad inputs, 31 good. After: 16 steps, 74 bad inputs, 37 good.
  - The step `old create gone` is given 201 (bad) and a 404 `Processing request not found` (near-miss).
  - The step `upload confirmed` is given a part URL on `http://storage:9000` (bad) and on `127.0.0.1` at the same port with `PUT` 403 (near-miss). It is also given the non-video confirmed with 200.
  - Direct helper cases:
    - old route: 201, 400, a 404 with another message, and a 404 for `/processing-requests/`
    - upload: `PUT` 403, start 400, 201 without parts
    - confirmation: `RECEIVE`, not `RECEIVED`
    - anonymous calls: the confirmation 201 and a read 200
  - One acceptance runs `upload confirmed` and requires the two ids and the source key it records (L-011).
  - Scratch mutations fail the self-test: `old create gone`'s check emptied, the fixture's `assertUploaded` dropped, and the origin comparison disabled.
- **Build gate.** Every command in the row above ran with the three port exports, and the gate was green:
  - `clean-appledouble`, `config -q`
  - sizing 12/7 and the storage-write check 10/6, each with its self-test
  - `up --build -d --wait`
  - the smoke, then its self-test (16/74/37)
  - `up -d --wait --force-recreate identity storage-init`, then the smoke again
  - `down -v`

  Both real runs printed every step. The part URL was on `http://localhost:39000`, the fixture reached `COMPLETED` with 8 frames, and the non-video reached `FAILED (FORMATO_INVALIDO)` with one delivery. The second run listed 4 of `alice`'s requests and 2 of `bob`'s, disjoint. Services: `fiap-x-api` `db0ce83`, `processing-catalog` `432ee94`, Worker and Notification at `main`.
- **Adequacy.** Each criterion maps to an assertion:
  - no writer: `check-no-storage-writes.mjs:124` (`main` with the seed, rejected)
  - old route gone: `smoke-local-integration.mjs:381`, `:1097`, `:1099`
  - upload from the host on the published port: `:463`, `:1101`, `:1103`
  - confirmation 201: `:475`, `:1105`
  - both steps required: `:810`
  - anonymous creation 401: `:279`, `:939`

  Every new case maps to UPL-15 AC2, UPL-17 AC1/AC7/AC8, UPL-18 or AUTH-17 AC1; none is speculative.
- **Deviations.**
  - The check is a script of its own, not part of the smoke. It needs no stack, and it follows `check-worker-sizing.mjs`'s shape. So `scripts/check-no-storage-writes.mjs` and `.github/workflows/ci.yml` are touched beyond this task's **Where**.
  - `anonymous refused` probes the two creation calls and a read instead of the removed route, whose absence `old create gone` now asserts.

---

### T5: Prove confirmation is idempotent

**What**: Steps `confirmation replay` (same key → 200, same id, `alice`'s total unchanged) and `key reuse conflict` (the key on a second upload → 409).
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T4
**Reuses**: The upload helper
**Requirement**: UPL-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Self-test rejects a replay returning 201, another id, or a grown total; and a conflict returning 200 or 201
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete
**Evidence**:
- **Steps.** Both steps run right after `upload confirmed`.
  - `confirmation replay` reads `alice`'s total (`GET /processing-requests?page=1&pageSize=1`). It then confirms the fixture's upload again with the same key and reads the total again. `assertReplayed` requires 200 and the first confirmation's id, and requires the two totals to be equal. A 201 fails as `Replay created a request: … returned 201, expected 200`, and a grown total as `Replay created a request: alice had 3 requests before the replay and 4 after`.
  - `key reuse conflict` uploads the non-video again as `alice` and confirms it with the fixture's key. `assertUploaded` judges the upload, so a failed `PUT` cannot pass as a conflict. `assertKeyReuseConflict` requires 409 with `Idempotency-Key is already used for another upload`, and a 2xx fails as `Key reused: …`.
- **Self-test.** Before: 16 steps, 74 bad inputs, 37 good. After: 18 steps, 90 bad inputs, 41 good.
  - The step `confirmation replay` is rejected when given:
    - 201 with another id and a grown total
    - 200 with `<id>-2`, an id extending the first (near-miss)
    - only the grown total
  - The step `key reuse conflict` is rejected when given:
    - 200
    - 201
    - 409 with the shortened message `Idempotency-Key is already used` (near-miss)
    - a second upload whose `PUT` answered 403
  - The helpers are also rejected directly when given a replay answering 409, a replay answering 200 without an id, and a conflict answering 400.
  - The expected message is written as a literal, not `KEY_REUSED`.
  - Scratch mutations each fail the self-test: the total comparison disabled, the id comparison disabled, the replay step's check emptied, the conflict check dropped, and the message comparison disabled.
- **Quick gate.** All of these pass:
  - `node --check`
  - the storage-write check and its self-test (10/6)
  - the sizing self-test (12/7)
  - the smoke's self-test, with the default port and with `STORAGE_HOST_PORT=39000`

  The real run is T8's build gate.
- **Adequacy.** Each AC maps to an assertion in `smoke-local-integration.mjs`:
  - AC2, same id: `:494`, `:1222`
  - AC2, no additional request: `:497`, `:1224`
  - replay creating: `:491`, `:1220`
  - AC3, 409: `:506`/`:512`, `:1226`–`:1232`

  Every new case maps to UPL-17 AC2, AC3 or AC8.

---

### T6: Prove the download through its URL

**What**: Step `download issued`: poll `GET …/download` (409 is "not yet"), fetch the URL from the host, count entries (8) with the EOCD reader; the archive check reads through this URL instead of `aws s3 cp`.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T5
**Reuses**: `countZipEntries`, the archive assertions
**Requirement**: UPL-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Self-test rejects a body without `url`, an `expiresAt` in the past, a URL answering 403, and an archive with 7 entries
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete
**Evidence**:
- **Step.** `download issued` runs right after the idempotency steps, while the fixture is still processing, so the real run exercises the 409 edge case.
  - `waitForDownload` polls `alice`'s `GET …/download`. It counts each 409 as not yet, returns the first other answer unjudged with the time it arrived, and fails naming the id if 409 lasts past `POLL_TIMEOUT_MS`.
  - `fetchArchive` GETs the issued URL from the host.
  - `assertDownloadIssued` requires:
    - 200
    - a `url`
    - an `expiresAt` that parses and is after the answer's arrival
    - the URL on `STORAGE_ORIGIN`
    - the fetch answering 200

    A 404 from the URL is reported as `Archive absent: …`, the S4 cause, now observed through the URL.
- **Archive check.** `archive count` counts the bytes the URL served, with the same EOCD reader and the same unreadable, empty and mismatch messages. `transferArchive` and its `aws s3 cp` are gone, and nothing in the smoke reads storage with aws-cli except the `list-objects-v2` behind `no archive`.
- **Interpretation.** The task text puts the count in `download issued`. It stays in the required S4 step `archive count`, which now reads the bytes `download issued` fetched. Folding it in would remove a required step.
- **Self-test.** Before: 18 steps, 90 bad inputs, 41 good. After: 19 steps, 101 bad inputs, 42 good.
  - The step `download issued` is rejected when given:
    - a body without `url`
    - `expiresAt` one second before the answer (near-miss)
    - the URL answering 403
    - the URL on `127.0.0.1` at the published port (near-miss)
  - The step `archive count` is rejected when given 7 entries.
  - The helpers are rejected directly when given:
    - 409
    - an `expiresAt` equal to the answer's time
    - an `expiresAt` that is not a date
    - the internal host
    - a 404 (`Archive absent`)
  - Scratch mutations fail the self-test:
    - the future comparison loosened to `<`
    - the fetch-status check disabled
    - the `url` check dropped
    - the step's check emptied
    - `archive count` counting a synthetic archive instead of the fetched bytes
- **Quick gate.** All of these pass:
  - `node --check`
  - the smoke's self-test at both ports
  - the storage-write check (4 scripts, and still green without `aws s3 cp`) and its self-test (10/6)
  - the sizing self-test (12/7)
- **Adequacy.** Each check maps to a line in `smoke-local-integration.mjs`:
  - AC5, the URL is fetched from the host: `:523`, `:1284`
  - the entries are counted through it: `:805`, `:1278`
  - `url`: `:512`, `:1280`
  - `expiresAt` in the future: `:515`, `:1282`
  - 409 while polling: `:536`

  Each maps to UPL-17 AC5, AC8 or the 409 edge case.

---

### T7: Prove another user cannot download

**What**: Step `cross-owner download 404`: `bob` requesting `alice`'s download gets the constant 404, identical to a random id.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T6
**Reuses**: The S5 cross-owner step's comparison
**Requirement**: UPL-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Self-test rejects a 200, a 409 and a 404 whose body differs by one character
- [x] Quick gate passes

**Tests**: integration
**Gate**: quick
**Status**: ✅ Complete
**Evidence**:
- **Step.** `cross-owner download 404` runs after `cross-owner read 404`. It has `bob` request the download of `alice`'s completed request and of a random id, and it keeps each status with its raw body text (`downloadAs`).
  - Its check is S5's `assertCrossOwnerNotFound`, given the suffix `/download`. The random id must answer 404. The cross-owner answer fails as `Owner scope leak: …` on a 2xx and as `… expected 404 as for a random id` on any other status. It must also match the random id's body byte for byte.
  - With the suffix empty, S5's messages are unchanged, and every existing case still passes with its old text.
- **Self-test.** Before: 19 steps, 101 bad inputs, 42 good. After: 20 steps, 108 bad inputs, 44 good.
  - The step is rejected when given a 200 carrying a URL, a 409 `Processing request is not completed`, and a 404 whose body has one trailing space.
  - The helper is rejected directly when given a 200, a 409, a body that differs by one character's case (`Found`), and a random id's download answering 409.
  - Scratch mutations fail the self-test: the step's check emptied, and the step comparing S5's read observations instead of the download's.
- **Quick gate.** All of these pass:
  - `node --check`
  - the smoke's self-test at both ports
  - the storage-write check and its self-test (10/6)
  - the sizing self-test (12/7)
- **Adequacy.** UPL-17 AC6 maps to `smoke-local-integration.mjs:620`–`:631` (the comparison), to the step cases at `:1343`–`:1347`, and to the direct cases at `:1168`–`:1170`.

---

### T8: Prove it on the real stack and document it

**What**: Build gate with the three service branches; literal negatives on scratch API images; README (upload flow, TTLs, the abort rule, the seed's removal).
**Where**: `README.md`
**Depends on**: T7
**Reuses**: S5 T9's negative procedure
**Requirement**: UPL-15, UPL-16, UPL-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Build gate green, including the force-recreate step
- [x] Negatives: replay creating a second request fails `confirmation replay`; a URL signed for the internal host fails `upload confirmed`; `bob` receiving a URL fails `cross-owner download 404`
- [x] README updated; links resolve

**Tests**: none
**Gate**: build
**Status**: ✅ Complete
**Evidence**:
- **Build gate.** Every command in the Build row ran with the three port exports, and the gate was green:
  - `clean-appledouble`, `config -q`
  - sizing 12/7
  - the storage-write check (4 scripts) and its self-test (10/6)
  - `up --build -d --wait`
  - the smoke, then its self-test (20/108/44)
  - `up -d --wait --force-recreate identity storage-init`, then the smoke again
  - `down -v`
  - `docs-links`: `0 unresolved link(s)`

  The docs check joined the row here because the matrix assigns it to the gate (L-016). Services: `fiap-x-api` at `db0ce83`'s code, `processing-catalog` `432ee94`, Worker and Notification at `main`. `fiap-x-api` moved to `22d8bbb` during the run, but that commit changes only `.specs/`, which its `.dockerignore` excludes.
- **What the real runs showed.** Both runs printed all 20 assertion steps:
  - The part URL was on `http://localhost:39000`, and its `PUT` was accepted from the host.
  - The replay answered 200 with the same id, and the total was unchanged (2, then 4 after the recreate).
  - The key on a second upload answered 409 with the exact message.
  - The download was issued after 2 not-yet answers (409). So the edge case ran for real, not only in the self-test.
  - The URL served 66999 bytes to the host: 8 frames through the EOCD reader.
  - `bob` got the constant 404 on the download.

  The second run, after identity and the bootstrap were recreated, shows the rules re-applied and the API still signing for the public endpoint (spec edge case).
- **Negatives.** Each ran on a scratch copy of `fiap-x-api` (`rsync` without `node_modules`/`dist`/`.git`, AppleDouble cleaned). Each copy was built through a compose override whose `api.build` pointed at the copy, and the smoke ran against it. Each mutation failed exactly its named step:
  - **Replay creates a second request.** `CompleteUploadService` sends the Catalog `${idempotencyKey}-${randomUUID()}`. Result: `confirmation replay` fails with `Replay created a request: alice's replayed confirmation (same upload, same Idempotency-Key) returned 201, expected 200`.
  - **URLs signed for the internal host.** The presigner is built on `config.endpoint`. Result: `upload confirmed` fails with `Part 1 URL for the fixture targets http://storage:9000, expected http://localhost:39000: the API must sign for the storage port published on the host`.
  - **`bob` receives a URL.** `DownloadService` falls back to the Catalog's unscoped record when the owned lookup finds nothing. Every earlier step passes, and `cross-owner download 404` fails with `Owner scope leak: bob's GET http://localhost:3000/processing-requests/<id>/download returned 200; alice's request must be invisible to bob`.

  After each negative, the real API was rebuilt (`up --build -d --wait api`). The final smoke against it was green, and then `down -v` ran. The real `fiap-x-api` tree stayed clean throughout.
- **README.** A new section, "Uploading a video and downloading its frames", covers:
  - the four calls, with example requests
  - formats and the 500 MB limit
  - the size-mismatch rule and the idempotency rules
  - the URL lifetimes: 1 hour for parts and 5 minutes for the download, with `UPLOAD_URL_TTL_SECONDS`/`DOWNLOAD_URL_TTL_SECONDS` as the API's defaults
  - the owner-only 404 and 409
  - the 1-day abort rule
  - signing for `STORAGE_HOST_PORT`
  - the removal of `POST /processing-requests` and of `seed-source-video.mjs`, and `check-no-storage-writes.mjs`

  Other README changes:
  - "What the smoke proves" lists the new assertions, the twenty required steps and the three S6 negatives.
  - "Object storage" names the per-owner source keys and the third rule, with the bootstrap's three owned rules and the API's wait on it.
  - "Seeding a source video" and the seed line under host ports are removed.
  - The layout row names the storage-write check.

  The `docs-links` script reports `0 unresolved link(s)`, and the in-page link `#object-storage` matches the `### Object storage` heading.
- **Open item (L-005).** The negatives ran from scratch files (`negatives.sh`, three override files) and are not versioned. No task names a location for them, as with T2's harness.

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3) then Phase 2 (T4 T5 T6 T7 T8)
```

8 tasks: **Phase 1** (3) and **Phase 2** (5). Cross-repository order: `processing-catalog`, `fiap-x-api`, then this repository.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: API storage wiring | 1 service block | ✅ Granular |
| T2: Third lifecycle rule | 1 script | ✅ Granular |
| T3: Database script | 1 generated file | ✅ Granular |
| T4: Seed removal + upload helper + 2 steps | 1 script (+1 deletion) | ⚠️ OK - cohesive; the smoke cannot run without replacing the seed |
| T5: Idempotency steps | 2 steps | ✅ Granular |
| T6: Download step | 1 step | ✅ Granular |
| T7: Cross-owner download | 1 step | ✅ Granular |
| T8: Proof + README | 1 document + verification | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | None | — | ✅ Match |
| T3 | None | — | ✅ Match |
| T4 | None | — | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |

No task depends on a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Compose topology | integration | integration | ✅ OK |
| T2 | Storage bootstrap | integration | integration | ✅ OK |
| T3 | Generated database script | none | none | ✅ OK |
| T4 | Smoke assertions | integration | integration | ✅ OK |
| T5 | Smoke assertions | integration | integration | ✅ OK |
| T6 | Smoke assertions | integration | integration | ✅ OK |
| T7 | Smoke assertions | integration | integration | ✅ OK |
| T8 | Documentation (+ verification) | none | none | ✅ OK |
