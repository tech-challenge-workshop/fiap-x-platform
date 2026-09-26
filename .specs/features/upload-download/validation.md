## Validation: upload-download (platform) — PASS with open items

**Date**: 2026-09-26
**Spec**: `fiap-x-platform/.specs/features/upload-download/spec.md` (UPL-15..UPL-18)
**Diff range**: `d02e16e..feb4fad` (8 commits, T1-T8), branch `feat/upload-download`
**Stack**: `fiap-x-api` 22d8bbb (code = db0ce83), `processing-catalog` 432ee94, Worker bac44a9 and Notification 256f1a0 at `main`, RustFS 1.0.0
**Verifier**: independent sub-agent (author ≠ verifier), final round. Read-only over the real trees: every mutation ran in a scratch `git worktree`, in scratch bootstrap files or in rsync'd API copies.

The implementation is correct. Every behaviour UPL-15..18 asks for held on the real stack, the build gate is green, and the self-test counts match the claims. The open items are regression-protection gaps. Eight of 23 mutants survive the documented gate. Four of them sit in the bootstrap, whose negative scenarios exist only in a scratch harness (L-005/L-016). One API mutant serves another request's archive and still passes. Under a strict reading of validate.md, the bootstrap row alone would be FAIL: UPL-16 AC3 has no versioned `file:line` evidence. They are recorded here as open items, since this is the last round.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 API storage wiring | ✅ Done | compose.yaml:22-26, :34-35 |
| T2 Third lifecycle rule | ✅ Done, open item | Scenario harness not versioned (its own L-005 note); 4 gate survivors |
| T3 DB script | ✅ Done, open item | Regenerated and identical; no gate command checks it (L-016) |
| T4 Seed removed, upload flow | ✅ Done | Seed deleted (77 lines); storage-write check in the gate and CI |
| T5 Idempotency steps | ✅ Done | |
| T6 Download step | ✅ Done, open item | URL not tied to this request's zipStorageKey |
| T7 Cross-owner download | ✅ Done | |
| T8 Real stack + README | ✅ Done | README accurate; links resolve |

---

## Spec-Anchored Acceptance Criteria

### UPL-15 — the API can sign URLs the client can use: ✅ PASS

| Criterion | Spec outcome | Evidence | Result |
| --- | --- | --- | --- |
| AC1 endpoints, bucket and credentials via env | internal + public endpoint, bucket, keys | `compose.yaml:22-26`; the API fails closed without them (`fiap-x-api/src/storage/storage.config.ts:39-43`, `required()`); the live API signs and lists | ✅ |
| AC2 URL targets `http://localhost:<STORAGE_HOST_PORT>` and works from the host | origin equality + PUT 200 | `smoke-local-integration.mjs:442` `if (origin !== STORAGE_ORIGIN)`, `:445` `if (put.status !== 200)`, download `:519`; real run: part URL on `http://localhost:39000`, PUT 200, download URL served 66999 bytes | ✅ |
| AC3 public endpoint follows `STORAGE_HOST_PORT` | no other change | `compose.yaml:23` `http://localhost:${STORAGE_HOST_PORT:-9000}`; `docker compose config` renders `:39000` when set and `:9000` when unset or empty; the smoke's `STORAGE_ORIGIN` (`:27-30`) comes from the same variable | ✅ |
| AC4 API starts only after the bootstrap | `service_completed_successfully` | `compose.yaml:34-35`; storage-init exited 06:24:22, the API started 06:24:29; mutant B1 (bootstrap exits 1) makes `up --wait` fail | ✅ |

### UPL-16 — abandoned uploads are discarded: ✅ PASS on behaviour, ⚠️ open item on evidence

I ran my own scenarios against the stack's RustFS through `docker compose run storage-init`. **29/29 pass.**

| Criterion | Spec outcome | Evidence | Result |
| --- | --- | --- | --- |
| AC1 exactly three rules | 7d `sources/`, 7d `zips/`, abort after 1 day | `storage/bootstrap.sh:39-43`, read-back `:90-94`; live: fresh bucket reads back exactly the 3 rules (JSON compare) | ✅ behaviour; ⚠️ self-asserted only (B4/B5 survive) |
| AC2 re-run leaves the rules and reports them as already configured | 3 × "already configured", no rewrite | `bootstrap.sh:79-82`; live re-run prints all three lines, no put, config unchanged; the gate's force-recreate printed them too | ✅ behaviour; ⚠️ no gate command asserts the lines |
| AC3 foreign rule → non-zero exit naming it | exit 1, ID named, config intact | `bootstrap.sh:71-77`; live: `someone-elses-rule` and a foreign whole-bucket abort rule `their-abort` both exit 1 with `(IDs: …)`, config byte-identical | ✅ behaviour; ❌ **no versioned evidence** (B2 survives the gate) |
| Done-when: a two-rule S5 bucket is upgraded | 3 rules | live ✅ | ✅ behaviour; ⚠️ not gated |
| Done-when: an abort rule that is Disabled, at 2 days or narrowed is rewritten | rewritten to the required rule | live ✅ ×3 | ✅ behaviour; ⚠️ not gated (B3 survives) |

### UPL-17 — the smoke proves the real flow: ✅ PASS

| Criterion | Named required step | Evidence (`smoke-local-integration.mjs`) | Result |
| --- | --- | --- | --- |
| AC1 upload the fixture as alice via part URLs, confirm with a key, COMPLETED with an 8-frame archive | `upload confirmed`, `video completed`, `archive count` | `:726-729` (`assertUploaded`, `assertConfirmed` 201 and `RECEIVED` `:456-460`), `:117` `entries !== EXPECTED_FRAMES` | ✅ |
| AC2 same key → same id, no additional request | `confirmation replay` | `:470` 201 rejected, `:473` `id !== firstId`, `:476` `totals.after !== totals.before` | ✅ |
| AC3 key on a second upload → 409 | `key reuse conflict` | `:490` `!== 409`, `:491` exact message; the second upload is judged too (`:760`) | ✅ |
| AC4 the non-video still satisfies every S4/S5 assertion | `rejection`, `no archive`, `delivery sentence`, `single delivery`, `no internal fields` | all on `rejectedId` from the upload (`:729`) | ✅ |
| AC5 fetch the URL from the host and count entries through it | `download issued` + `archive count` | fetch `:770` → `fetchArchive` `:544-551`; count reads those bytes `:813`; real run 66999 bytes → 8; M03 (fetch skipped) killed; API A1 (URL to a missing key) killed `Archive absent` | ✅ (⚠️ URL not tied to this request's key, finding 2) |
| AC6 bob → the constant 404 | `cross-owner download 404` | `:628` `!== 404`, `:631` body byte-equal to a random id's | ✅ |
| AC7 `POST /processing-requests` → 404 | `old create gone` | `:359`, `:360` exact `Cannot POST /processing-requests` | ✅ |
| AC8 self-test requires each new step, bad + near-miss | all 6 new steps | `REQUIRED_STEPS` `:931-952`, presence `:1368`; step rejections `:1291-1348` (for example `${id}-2` near-miss `:1325`, short message `:1333`, 127.0.0.1 `:1297`/`:1315`, 1 s before `:1311`, trailing space `:1347`); **20/108/44 confirmed** | ✅ |
| AC9 no script writes videos outside the API | storage-write check | see UPL-18 | ✅ |
| Edge: 409 while polling is "not yet" | `download issued` | `:536`; real run: "issued after 2 not-yet answer(s) (409)" in both runs | ✅ |
| Edge: stack re-created → rules re-applied, API still signs for the public endpoint | gate force-recreate + second smoke | second run green; recreated storage-init printed 3 × already configured | ✅ (⚠️ spec-precision: the API itself is not recreated, L-017) |

### UPL-18 — nothing writes outside the API: ✅ PASS

| Criterion | Evidence | Result |
| --- | --- | --- |
| Seed deleted | `git diff --stat`: `scripts/seed-source-video.mjs` −77; no references outside earlier records; repo-wide grep finds no object writer | ✅ |
| Check is a real gate command, in tasks.md and CI | `tasks.md:34,36`; `.github/workflows/ci.yml:40-43`; **10/6 confirmed**; main path with the seed rejected `check-no-storage-writes.mjs:124` | ✅ (⚠️ W2, finding 5) |
| DB script equals the migrations | `generate-db-script.mjs` re-run in a scratch worktree: byte-identical; applied to an empty postgres:17 with ON_ERROR_STOP: columns and indexes (34 rows) **identical** to the stack's migrated DB; `idempotency_key text NULL`, `uq_processing_request_owner_idempotency (owner_user_id, idempotency_key)` | ✅ (⚠️ not gated, finding 4) |

---

## S4/S5 assertions after the move off the seed (old `d02e16e` vs new)

| Step | Before | After | Weakened? |
| --- | --- | --- | --- |
| `anonymous refused` | anonymous `POST /processing-requests` → 401 | anonymous `POST /uploads`, `POST /uploads/:id/complete`, `GET /processing-requests` → 401 (`:704`); each carries a body and headers a signed-in caller could send | No, broader |
| `create requests` → `upload confirmed` | inline in observe, any 2xx + id, **no check** | checked step: 201, id, `RECEIVED`, origin, PUT 200 | No, stronger |
| `bob request created` | `POST` with alice's seeded key, 201 + id | bob uploads his own, `assertUploaded` + 201 + id + `RECEIVED` (`:853-854`) | No, stronger |
| `archive count` | `aws s3 cp s3://fiapx/<zipStorageKey>`: the bytes were **this request's** archive | bytes from the download URL; the key is used only in messages | **Yes, one dimension**: the tie to this request's archive is lost (finding 2, A3) |
| `anonymous access` | seeded key | uploaded source key from the part URL (`:730`) | No |
| others (`video completed`, `key scope`, `rejection`, `no archive`, deliveries, lists, cross-owner read, internal fields, leftovers) | unchanged | unchanged | No |

`main` runs only through the step list (`:915-917` → `runSteps(SMOKE_STEPS, {})`), and every assertion is in a step's check.

---

## Discrimination Sensor

**Depth**: expanded (≥5 per area). **Result: 15 killed / 23; 8 survived.** For each mutant, "killed" means by a command in the documented Build gate.

| # | Area | Mutation | Killed? |
| --- | --- | --- | --- |
| B1 | bootstrap.sh:42 | abort rule removed from `desired` | ✅ gate (storage-init exit 1 → `up --wait` fails) |
| B2 | bootstrap.sh:73 | foreign-rule refusal loosened (`!=` → `-gt`) | ❌ **survived the gate** (my harness: foreign rule silently deleted, exit 0) |
| B3 | bootstrap.sh:52 | abort check ignores `Status` | ❌ survived (a Disabled rule counts as configured) |
| B4 | bootstrap.sh | whole file reverted to S5 (2 rules) | ❌ survived (nothing outside the bootstrap reads the rules, L-003) |
| B5 | bootstrap.sh:42,52 | abort 1 day → 2 days, desired and check consistent | ❌ survived |
| M01 | smoke:473 | replay id comparison dropped | ✅ self-test |
| M02 | smoke:470-471 | replay 201 accepted | ✅ self-test |
| M03 | smoke:770 | URL fetch skipped (empty bytes) | ✅ real run (`Archive unreadable`) |
| M04 | smoke:117 | 7 entries accepted | ✅ self-test |
| M05 | smoke:628,631 | 409 for bob accepted | ✅ self-test |
| M06 | smoke:490-491 | key reuse: any 4xx, no message | ✅ self-test |
| M07 | smoke:442 | upload origin unchecked | ✅ self-test |
| M08 | smoke:476 | replay total unchecked | ✅ self-test |
| M09 | smoke:515 | expiresAt unchecked | ✅ self-test |
| M10 | smoke:360 | old-route message unchecked | ✅ self-test |
| M11 | smoke:916 | `main` filters out `cross-owner download 404` | ❌ survived (self-test proves presence in SMOKE_STEPS, not that main runs it; pre-existing since S4, L-009) |
| M12 | smoke:519 | download origin unchecked | ✅ self-test |
| W1 | check-no-storage-writes:24 | `s3 cp` pattern dropped | ✅ self-test |
| W2 | check-no-storage-writes:52-53 | real `readScripts` reads nothing | ❌ survived (self-test injects files; main prints "0 scripts … checked" and exits 0) |
| A1 | API download.service.ts:63 | signs `<key>.missing` | ✅ real run: `Archive absent: … answered 404` |
| A2 | API uploads.controller.ts:49 | replay answers 201 | ✅ real run: `Replay created a request: … returned 201` |
| A3 | API download.service.ts | signs the owner's **first** archive forever | ❌ **survived 2 real smoke runs**: run 2's download for `cc76…` signed `zips/a4fd…/…/frames.zip` (run 1's), 8 frames, green; the report line claims the `cc76` archive was read |
| D1 | db/create-database.sql | any drift | ❌ survived by construction (compose mounts only `db/init`; no gate command regenerates or diffs) |

Isolation: the real `fiap-x-platform` porcelain was empty before and after, and so were `fiap-x-api` and `processing-catalog`. The worktree was removed and the API copies deleted. The real API was rebuilt from its own tree and a final smoke ran green before `down -v`.

---

## Gate Check

- **Command**: the Build row, `tasks.md:36`, with `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002`.
- **Result**: green end to end:
  - `clean-appledouble`, `config -q`
  - sizing 12/7
  - storage-write check (4 scripts) and its self-test 10/6
  - `node --check`
  - `up --build -d --wait` (all healthy)
  - smoke run 1 green (20 steps printed)
  - smoke `--self-test` 20/108/44, at port 39000 and the default port
  - `up -d --wait --force-recreate identity storage-init` (3 × already configured)
  - smoke run 2 green (alice 4, bob 2)
  - `down -v`
  - docs-links: `0 unresolved link(s)`
- **Test counts**: self-test 14/58/31 before the feature, 20/108/44 after. The storage-write check is new, at 10/6. Nothing was deleted or skipped.

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / surgical | ✅ (bootstrap 29 changed lines; compose +13) |
| No scope creep | ✅ (storage-write check outside T4's Where is recorded as a deviation) |
| Matches patterns | ✅ (check script mirrors `check-worker-sizing.mjs`; steps follow L-007..L-012) |
| Spec-anchored outcomes | ✅ exact statuses, messages and literals |
| Every test maps to a requirement | ✅ |
| Commit messages | ✅ all 8 pass `check_commit.py` |
| README | ✅ verified live: part URL `X-Amz-Expires=3600` and expiresAt +3600 s, download +300 s, malformed id → the same 404 body, 256-char key → 400, size mismatch → 400, abort rule, seed removal; `#object-storage` resolves |

---

## Findings / Fix Plans (open items for "Validar depois")

### 1. Major — the bootstrap's negative scenarios are not in the gate (L-016, L-005, L-003)
- **Where**: `tasks.md:23` assigns "Build gate + negatives" to the bootstrap, but `tasks.md:36` has no such command. T2's own evidence (`tasks.md:127`) records the harness as unversioned. See `storage/bootstrap.sh:42,52,73`.
- **Failure scenario**: someone loosens `if [[ "$owned" != "$total" ]]` (B2). The next start silently deletes a rule an operator added, and the gate stays green. B3, B4 (full revert to 2 rules) and B5 (abort after 2 days) are also green. So UPL-16 AC1's "exactly three" is asserted only by the code under test.
- **Fix task**: version the scenario runner, for example `scripts/check-storage-bootstrap.sh` running scratch buckets through `docker compose run storage-init`. It covers: fresh, re-run lines, S5 upgrade, foreign refused with config intact, and Disabled / 2-day / narrowed rewritten. Add it to the Build gate. Also add a smoke step that reads `get-bucket-lifecycle-configuration` from outside and compares all three rules exactly, which kills B4/B5.

### 2. Medium — the download is not tied to this request's archive (S4 `archive count` weakened)
- **Where**: `smoke-local-integration.mjs:507-524` and `:811-814`. `zipStorageKey` only labels the messages.
- **Failure scenario** (demonstrated, A3): the API signs a stale or other archive of the same owner. On any second run, which the gate's force-recreate guarantees, it serves the older 8-frame ZIP. Every step passes, and the report prints "Archive zips/<this id>/… read through its download URL, holds 8 frames", which is false. Under S4, `aws s3 cp s3://fiapx/<zipStorageKey>` read exactly this request's archive.
- **Fix task**: in `archive count`, after `video completed` has supplied the key, require `decodeURIComponent(new URL(url).pathname) === /fiapx/<zipStorageKey>`. Add self-test cases: another request's key (bad) and `zips/<id>-2/…` (near-miss).

### 3. Low — an owned abort rule with extra actions passes as configured
- **Where**: `storage/bootstrap.sh:51-53` (the same shape applies to `correct()` `:45-48`).
- **Failure scenario** (live on RustFS): the stored rule `abort-incomplete-uploads` has `AbortIncompleteMultipartUpload 1` plus `Expiration {Days:1}` on the whole bucket. RustFS stores it. The bootstrap prints "already configured", exits 0, and the bucket then deletes every object after 1 day, breaking the 7-day product rule.
- **Fix**: require the absent actions too (`Expiration==null` on the abort rule, `AbortIncompleteMultipartUpload==null` on the expiry rules), or compare the whole configuration to `desired`.

### 4. Low — DB-script drift is not gated (L-016)
- **Where**: `tasks.md:25` puts "Regenerated and matching the migrations" in the Build gate, but no command in `tasks.md:36` does it.
- **Failure scenario** (D1): a hand edit or a new Catalog migration leaves `db/create-database.sql` stale, and the gate stays green, since compose mounts only `db/init`. Today it is identical: verified by regeneration and by an empty-DB apply.
- **Fix**: gate command `node scripts/generate-db-script.mjs && git diff --exit-code db/create-database.sql`.

### 5. Low — the storage-write check's real reader is never proved
- **Where**: `check-no-storage-writes.mjs:51-55`. The self-test injects `read` (`:117`). The scan is top-level `scripts/` only and non-recursive, while AC9 says "the repository".
- **Failure scenario** (W2): a filter change makes `readScripts` return nothing. The output is "0 scripts under scripts/ checked; none writes…", exit 0, in the gate and CI. Separately, a writer in `scripts/lib/` or `tools/` escapes.
- **Fix**: fail when fewer than one file is read, or have the self-test run the real reader over a temp dir holding a writer (L-010). Consider scanning all tracked `*.sh|*.mjs|*.js`.

### 6. Low, pre-existing — the self-test cannot see `main` skipping a step (L-009)
- **Where**: `smoke:916`, `:1368`.
- **Failure scenario** (M11): `main` filters or slices `SMOKE_STEPS`, and the self-test and the real run both stay green. It has been present since S4, and S6 did not introduce it.
- **Fix**: have the self-test run `main`'s own step sequence with stubbed observes and record which checks ran.

### Spec-precision notes
- Edge "stack re-created": the gate recreates `identity` and `storage-init` but not `api` or `storage` (L-017). Name the operation.
- UPL-16 AC2 "report them as already configured": the lines are printed but no gate command asserts them. Finding 1's runner covers this.

## Requirement Traceability Update

| Requirement | Previous | New |
| --- | --- | --- |
| UPL-15 | Implementing | ✅ Verified |
| UPL-16 | Implementing | ✅ Verified (behaviour); open item: finding 1, finding 3 |
| UPL-17 | Implementing | ✅ Verified; open item: finding 2 (finding 6 pre-existing) |
| UPL-18 | Implementing | ✅ Verified; open items: findings 4, 5 |

## Summary

**Overall**: ✅ Ready, with open items.
**Spec-anchored check**: 17 of 17 UPL-15/17/18 criteria matched with `file:line` evidence. UPL-16's 3 criteria are verified live, and AC3 has no versioned evidence. 2 spec-precision notes.
**Sensor**: 15 of 23 killed. Survivors: B2, B3, B4, B5, M11, W2, A3, D1.
**Gate**: green (both smoke runs, 20/108/44, 10/6, 12/7, 0 unresolved links).
**Not done here**: `validate_state.py` and `.specs/features/upload-download/validation.md` in the repo. The brief requires a clean tree at `feb4fad`, so this report lives in the scratchpad.
