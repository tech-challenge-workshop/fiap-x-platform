## Validation: platform-gate-hardening — PASS with open items

**Date**: 2026-09-26
**Spec**: `.specs/features/platform-gate-hardening/spec.md`
**Diff range**: `66278d1..77a24e2` (14 commits, T1-T14), branch `fix/platform-gate-hardening`
**Verifier**: independent sub-agent (author ≠ verifier), single and final round

**Spec-anchored check**: 17/17 requirements PASS; 4 spec-precision observations (none blocking)
**Gate**: build gate steps 1-13 all exit 0 (run by the Verifier from `down -v`, sibling repos clean on `main`)
**Sensor**: 35 mutations injected, 33 killed, 2 survived (both outside the ACs' explicit scenario list)

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1-T14 | ✅ Done | All marked complete in tasks.md; deviations (expire-extra-abort, video delivery check, api health step, lowercased case-change near-miss) are recorded and reasonable |

---

## Spec-Anchored Acceptance Criteria

| Req | Spec-defined outcome | Evidence (`file:line` + assertion) | Result |
| --- | --- | --- | --- |
| GATE-01 | Real `storage/bootstrap.sh` on scratch buckets; fresh = exactly 3 rules; rerun = 3 "already configured" lines + byte-identical; upgrade; foreign exit 1 naming it + byte-identical; policy exit 1 naming bucket; non-zero on any failure | `scripts/check-storage-bootstrap.mjs:127-152` SCENARIOS; `:76-81` `found !== canonicalRules(OWNED_RULES)`; `:85-89` `before !== after`; `:134` `stderr: () => '(IDs: operator-rule)'`; `:151` `bucket ${bucket} has a bucket policy`; `:222-226` runs the real bootstrap via `storage-init`; `:249-252` exitCode 1. Live: `10 bootstrap scenarios passed; no fiapx-scenario-* bucket left` | ✅ PASS |
| GATE-02 | Abort rule disabled / 2 days / narrowed / extra `Expiration` rewritten | `storage/bootstrap.sh:47-55` (`==null` checks); scenarios `abort-disabled`, `abort-2-days`, `abort-narrowed`, `abort-extra-expiration`, `expire-extra-abort` (`check-storage-bootstrap.mjs:136-150`), each `rules: true` | ✅ PASS |
| GATE-03 | Smoke reads live bucket without the bootstrap, requires exactly 3 owned rules | `scripts/smoke-local-integration.mjs:214-219` (`--entrypoint aws … get-bucket-lifecycle-configuration`); `:204-210` `found !== expected`; step `bucket lifecycle` `:993-1000`. Live negative L1: a 2-day bootstrap applied to `fiapx` → smoke exit 1 `Bucket fiapx lifecycle: expected exactly the 3 owned rules …` | ✅ PASS |
| GATE-04 | Regenerate from migrations; fail on any difference naming the file | `scripts/generate-db-script.mjs:162-172` `driftProblem`; `:174-187` `--check` throws; self-test spawns `--check` on a tampered tree `:236-248`. Live: `db/create-database.sql is exactly what the migrations generate` | ✅ PASS |
| GATE-05 | Script contains `uq_processing_request_owner_source` from `1789957000000-UniqueOwnerSource` | `db/create-database.sql:134-135` | ✅ PASS |
| GATE-06 | Recursive scan; real reader on a nested writer; zero files → non-zero | `scripts/check-no-storage-writes.mjs:55-67` walk; `:77` `no script was read under scripts/`; self-test `:143-163` real `readScripts` on `nested/writes.mjs`, spawn with `SCRIPTS_DIR` | ✅ PASS |
| GATE-07 | Download URL path equals `/<bucket>/<zipStorageKey>` of the same request | `smoke-local-integration.mjs:673-676` `path !== /${BUCKET}/${zipKey}`; key from `observedFor(ctx,'downloadRequest','id')` `:976`; self-test `:1735-1740` (other archive, bucket `fiapx2` near-miss, other id) | ✅ PASS |
| GATE-08 | Deliveries counted only for the request under test; self-test rejects another request's count | `:851-856` `observedFor`; `:1071`, `:1111`; self-test `:1711-1714` (other id, `-2` near-miss). Live negative L2: `countDeliveries(ctx.id)` in `single delivery` → `deliveries observed for <id>, expected <rejectedId>` | ✅ PASS (see observation O3) |
| GATE-09 | Exact sentence; self-test rejects prefix, truncation, extension, case change | `:256-264` `delivery.failureReason !== reason`; self-test `:1442-1448` | ✅ PASS |
| GATE-10 | Exactly one object at exactly `zipStorageKey` | `:161-165` `JSON.stringify(keys) !== JSON.stringify([zipKey])`; step `archive object` `:1013-1024`; self-test `:1715-1722` (none, two, `.tmp` near-miss) | ✅ PASS |
| GATE-11 | Self-test fails if `main()` steps differ in number, order or name | `:1197-1199` one-line `main()`; `:1186-1189` dry-run executor; `:1858-1862` spawned dry run `!== REQUIRED_STEPS` | ✅ PASS |
| GATE-12 | Each gate script's self-test spawns it with a forced failure; non-zero exit + message on stderr | smoke `:1865-1872`; sizing (`SIZING_CONFIG_JSON`); storage writes `check-no-storage-writes.mjs:153-189`; identity `check-identity.mjs:320-325`; bootstrap runner `check-storage-bootstrap.mjs:420-431`; db script `generate-db-script.mjs:244-248` | ✅ PASS |
| GATE-13 | alice's and bob's `sub` equal before and after the recreate | `check-identity.mjs:48-57` `sub !== pinned`; gate step 9 and step 11 both `sub pinned passed` around `--force-recreate identity storage-init api` | ✅ PASS |
| GATE-14 | iss, registration, tmpfs, API-after-identity, get-token CLI; self-test bad + good per check | `check-identity.mjs:59-104`; self-test `:236-316` (20 bad, 6 good, each check has both). Live: `6 identity checks passed` twice | ✅ PASS (see O4) |
| GATE-15 | Exact `400 …16777216 bytes`, retry `404`; second key `200`, same id, total unchanged | `smoke:588-605`, `:564-566`, `:548-558`; self-test `:1759-1780`. Live: both steps green | ✅ PASS |
| GATE-16 | Corrupted fixture → `FAILED (PROCESSAMENTO_FALHOU)`; no archive; one delivery with the sentence; FORMATO_INVALIDO fails | `smoke:232-236`, steps `:1074-1114`; self-test `:1790-1815`. Fixture SHA-256 `24123d94709fc8323c7245e759f4648e60d82427e014890bfe9175ea49259454` verified, and the `fixtures/README.md` command reproduced it byte for byte. Live on the real Worker: `Catalog reached FAILED (PROCESSAMENTO_FALHOU)`, `No archive exists`, `Notification delivered once … Nao foi possivel processar o video. Tente enviar novamente.` | ✅ PASS (see O4) |
| GATE-17 | Recreate includes `api`; smoke passes again; README names every gate command and step; links resolve | `tasks.md:60` and `README.md:247` step 10; `smoke:1249-1254` backticked step names; `README.md:234-250` gate section; docs-links `0 unresolved link(s)` | ✅ PASS |

**Existing S4-S6 smoke assertions:** none weakened. Every removed line in the smoke diff is a signature change (id-carrying observations, key arrays, an optional failure code defaulting to `FORMATO_INVALIDO`). All prior self-test cases are kept, and `assertNoArchiveListing` is stricter than before.

**Status**: ✅ All ACs covered; 4 spec-precision observations below.

---

## Discrimination Sensor

The sensor ran in a scratch `git worktree` at 77a24e2. The bootstrap mutants used scratch copies mounted with `BOOTSTRAP_UNDER_TEST`, and the live-smoke mutant used the worktree script with `COMPOSE_FILE` set to the real `compose.yaml`. The real tree was never edited.

| # | Mutation | File | Killed by | Result |
| --- | --- | --- | --- | --- |
| K1 | Foreign-rule check → `if false` | `storage/bootstrap.sh:75` | runner: `scenario foreign failed: bootstrap exited 0, expected 1` | ✅ Killed |
| K2 | Abort rule 1 → 2 days (desired + check) | `storage/bootstrap.sh:42,54` | runner: `scenario fresh failed …` (+8 more) | ✅ Killed |
| K3 | New `==null` checks removed | `storage/bootstrap.sh:49,54` | runner: `abort-extra-expiration`, `expire-extra-abort` | ✅ Killed |
| K4 | Policy check removed | `storage/bootstrap.sh:23-29` | runner: `scenario policy failed` | ✅ Killed |
| K6 | `correct()` drops `Status=='Enabled'` | `storage/bootstrap.sh:49` | nothing: `10 bootstrap scenarios passed` | ❌ Survived |
| K7 | `correct()` drops `Filter.Prefix=='$prefix'` | `storage/bootstrap.sh:49` | nothing: `10 bootstrap scenarios passed` | ❌ Survived |
| L1 | 2-day bootstrap applied to live `fiapx` | live bucket | smoke `bucket lifecycle`, exit 1 | ✅ Killed |
| L2 | `single delivery` counts `ctx.id` | `smoke:1069` | live smoke: `deliveries observed for …` | ✅ Killed |
| S1 | `main()` runs `SMOKE_STEPS.slice(0, 6)` | `smoke:1198` | self-test dry run | ✅ Killed |
| S2 | `observedFor` skips the id compare | `smoke:854` | self-test (15 failures) | ✅ Killed |
| S3 | Download path check removed | `smoke:674` | self-test | ✅ Killed |
| S4 | Sentence compared by `startsWith` | `smoke:259` | self-test (prefix near-miss) | ✅ Killed |
| S5 | Archive check accepts any key | `smoke:162` | self-test | ✅ Killed |
| S6 | Smoke `main()` catch sets exitCode 0 | `smoke:1920` | self-test spawn | ✅ Killed |
| S7 | README check by bare substring | `smoke:1250` | self-test (`no archive` without backticks) | ✅ Killed |
| S8 | Processing failure accepts `FORMATO_INVALIDO` | `smoke:233` | self-test | ✅ Killed |
| S9 | Lifecycle comparison never throws | `smoke:207` | self-test | ✅ Killed |
| S10 | Single delivery accepts ≥1 | `smoke:269` | self-test | ✅ Killed |
| S11 | Invalid parts accepts any 400 body | `smoke:595` | self-test | ✅ Killed |
| S12 | Replay total not compared | `smoke:555` | self-test | ✅ Killed |
| S13 | `runSteps` filters out `single delivery` | `smoke:1192` | self-test dry run | ✅ Killed |
| X1 | Sizing `fail()` exits 0 | `check-worker-sizing.mjs:19` | self-test spawn | ✅ Killed |
| X2 | Storage-writes `fail()` exits 0 | `check-no-storage-writes.mjs:71` | self-test spawn | ✅ Killed |
| X3 | Identity sets exitCode 0 on failures | `check-identity.mjs:210` | self-test spawn | ✅ Killed |
| X4 | Bootstrap runner sets exitCode 0 on failures | `check-storage-bootstrap.mjs:251` | self-test spawn | ✅ Killed |
| X5 | DB script `--check` exits 0 on drift | `generate-db-script.mjs:268` | self-test spawn | ✅ Killed |
| D1 | Drift check never reports | `generate-db-script.mjs:163` | self-test | ✅ Killed |
| W1 | Reader non-recursive | `check-no-storage-writes.mjs:62` | self-test (nested writer) | ✅ Killed |
| W2 | Zero files read passes | `check-no-storage-writes.mjs:77` | self-test (empty dir) | ✅ Killed |
| I1 | `registrationAllowed` check dropped | `check-identity.mjs:67` | self-test | ✅ Killed |
| I2 | `registrationAllowed === true` only | `check-identity.mjs:67` | self-test (absent near-miss) | ✅ Killed |
| I3 | `sub` not compared | `check-identity.mjs:53` | self-test | ✅ Killed |
| I4 | JWT line check loosened to "contains a dot" | `check-identity.mjs:93` | self-test | ✅ Killed |
| B1 | Runner accepts any non-null configuration | `check-storage-bootstrap.mjs:78` | self-test | ✅ Killed |
| B2 | Runner skips the byte-identical check | `check-storage-bootstrap.mjs:165` | self-test | ✅ Killed |

**Sensor depth**: P0-full (V34 is data-destroying).
**Result**: 33/35 killed. Both survivors (K6, K7) are outside the spec's explicit scenario list, so they are recorded as open items and do not fail the gate.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / surgical changes | ✅ (smoke grew ~650 lines; each new check is a small named function next to its peers) |
| No scope creep | ✅ |
| Matches patterns | ✅ (every new script follows the self-test shape of `check-worker-sizing`) |
| Spec-anchored outcome check (literals, not script constants, in self-tests) | ✅ |
| Every test maps to a spec requirement | ✅ |
| Documented guidelines followed: `coding-principles.md`, LESSONS L-007..L-019 | ✅ except the token-printing finding F2 |

---

## Edge Cases

- [x] An interrupted runner's scratch bucket is deleted first (`check-storage-bootstrap.mjs:172-193`; self-test cleanup orders `:376-391`).
- [x] A corrupted fixture rejected by validation fails, naming `FORMATO_INVALIDO` (`smoke:1792-1793`; mutant S8 killed).
- [x] The token refresh still works after the identity is recreated: step 11's smoke was green after `--force-recreate identity storage-init api`.

---

## Gate Check

Gate run from `down -v` with `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002`. The siblings `fiap-x-api`, `processing-catalog`, `processing-worker` and `notification-service` were all on `main` with a clean tree, and none was changed.

1. `clean-appledouble` exit 0.
2. `config -q` exit 0.
3. Sizing: `worker cpus 2 matches FFMPEG_THREADS 2`. Self-test 12/7, spawn non-zero.
4. Storage writes: `6 scripts under scripts/ checked`. Self-test 12/7, spawn non-zero.
5. `db/create-database.sql is exactly what the migrations generate`. Self-test 4/1, plus the spawned `--check`.
6. `up --build -d --wait` exit 0.
7. `10 bootstrap scenarios passed; no fiapx-scenario-* bucket left` (78 s). Self-test 10/33/17, 2 cleanup orders, spawn non-zero.
8. Smoke green, 29 steps. Self-test 29/168/58, with the dry run, the README check and the spawned failure.
9. `6 identity checks passed`. Self-test 6/20/6, spawn non-zero.
10. `up -d --wait --force-recreate identity storage-init api` exit 0.
11. Smoke green again (`alice lists 6 requests and bob 2`), and `6 identity checks passed` again.
12. `down -v` exit 0.
13. docs-links: `0 unresolved link(s)`.

- **Failures**: none. **Skipped**: none.

---

## Findings and Fix Plans (open items, ranked)

### F1 (Medium): the bootstrap scenarios do not cover the expire rules' Status or Prefix

- **Where**: `storage/bootstrap.sh:47-50` (`correct()`), `scripts/check-storage-bootstrap.mjs:127-152`.
- **Evidence**: mutants K6 and K7 survived the runner.
- **Failure scenario**: a refactor drops `Status=='Enabled'` or `Filter.Prefix=='$prefix'` from `correct()`. The bootstrap then prints "retention on zips/ already configured" for a bucket whose `expire-zips` is Disabled, or points at another prefix. Archives or sources never expire, and every gate command stays green. The smoke's `bucket lifecycle` step cannot help, because the gate's live bucket is always freshly bootstrapped.
- **Fix task**: add the scenarios `expire-disabled` and `expire-narrowed` (for example, `expire-zips` with Status Disabled, and with `Filter.Prefix` set to `""`), each expecting a rewrite to the owned rules. Add them to `REQUIRED_SCENARIOS` and give each self-test bad/good inputs.

### F2 (Low): `check-identity` prints alice's dev JWT when `get-token cli` fails

- **Where**: `scripts/check-identity.mjs:93-95`, `` `${call} printed ${JSON.stringify(ok.stdout)} on stdout …` ``.
- **Failure scenario**: `get-token` regresses to print `token: <jwt>`, or to print a second line. The gate's stderr then carries a valid bearer token for alice.
- **Judgement against "never print a token"**: it violates the principle. The same file (`:10-11`, `:150`) and design.md (`:223`) promise that credentials are never printed. Exposure is limited in three ways:
  - it is a 5-minute token for a local demo user whose password is published;
  - it only appears on the failure path;
  - CI runs only `--self-test`, which uses a synthetic JWT.

  So it does not block the feature.
- **Fix task**: describe the shape instead of the bytes. For example, print `printed 1 line(s) starting "token: " (JWT redacted)`, or replace each `[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` run with `<jwt>` before quoting. Update the two self-test expectations.

### O3 (Low, spec-precision): count and listing ids echo the query argument

- **Where**: `smoke-local-integration.mjs:170-177`, `:277-283`.
- **Detail**: `countDeliveries` and `listArchives` return the id they were called with, not an id read from the result. The GATE-08 self-test's "count for another id" therefore checks only the wiring in `observe`. It cannot see an SQL or prefix that ignores the id.
- **Mitigation**: a wrong query changes the live count or listing, so the live smoke still fails. Mutant L2 was killed live. This relates to the candidate lesson L-011 (an injectable IO seam).

### O4 (Low, spec-precision)

- **GATE-14 AC5** reads `depends_on.identity.condition` from `docker compose config` (`check-identity.mjs:81-86`). It does not observe the real start order. This is accepted in design.md; it is a proxy.
- **GATE-16 AC2** ("its failureReason SHALL be the Catalog's sentence") is proven through the delivery record. That record carries the Catalog's `failureReasonFor` output, but no step reads the failed request's `failureReason` as the API lists it. The self-test's good list carries it (`smoke:1383`), yet no check reads it. A regression in the API projection for `PROCESSAMENTO_FALHOU` alone would pass.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| GATE-01..GATE-17 | Implementing | ✅ Verified (F1/F2/O3/O4 recorded as open items) |

---

## Lessons signal

- **Surviving mutants K6/K7**: when a scenario list enumerates the variations of one owned rule (abort: disabled, 2 days, narrowed, extra action), apply the same variations to every owned rule. Otherwise the checker's other predicates go unguarded. This is a candidate lesson, grounded in `storage/bootstrap.sh:49` and `check-storage-bootstrap.mjs:127-152`.
- **F2**: a check's failure message that quotes the observed output must redact secrets the output may contain. Otherwise the check leaks the value on the path where the value is wrong. This is a candidate lesson, grounded in `check-identity.mjs:94`.
- **O3**: it reinforces L-011. An observation that echoes its query argument proves wiring, not the query. Read the id from the result when the result carries one, or inject the IO.
- **Confirmed useful**: L-010 (spawn with a forced failure), L-012 (near-misses), L-015 (force-recreate) and L-018 (versioned scenario harness) all held. Every mutant in their scope was killed.

---

## Summary

**Overall**: ✅ Ready, with open items.

- **Spec-anchored check**: 17/17; 4 spec-precision observations.
- **Sensor**: 33/35 killed (K6, K7 survived).
- **Gate**: 13/13 steps green.
- **Next steps**: record F1, F2, O3 and O4 in "Validar depois". F1 is the only one with a data-retention consequence.
- **Tree state**: the real tree ends clean at `77a24e2`. The scratch worktree was removed, and the stack was taken down with `down -v`.
