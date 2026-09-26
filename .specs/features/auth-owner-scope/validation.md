# Auth and Owner Scope Validation — platform

**Date**: 2026-09-26
**Spec**: `.specs/features/auth-owner-scope/spec.md` (AUTH-14..AUTH-17)
**Diff range**: `1b409cf..f90d92a` on `feat/auth-owner-scope`. There are 13 commits: implementation `6ad28fb`, `9126671`, `cd26995`, `6c65d63`, `b95ad40`, `9013c75`, `c76e817`, `075467e`, `94cf39e`, `d77c4f9` and `f90d92a` (README), plus spec docs `588d13c` and `e583689`.
**Verifier**: independent sub-agent (author ≠ verifier), round 1 for the platform
**Siblings built by the stack (read-only)**: `fiap-x-api` `feat/auth-owner-scope@4c4edae`, `processing-catalog` `feat/auth-owner-scope@bd9154c`, `processing-worker` `main@bac44a9`, `notification-service` `main@256f1a0`. All four had an empty porcelain before and after. During this run, at 01:31, `fiap-x-api` gained one docs-only commit, `b431529` (`docs(specs): record the final api auth-owner-scope validation`). It changes no code, and the real-tree gate had already built from `4c4edae` at 01:29.
**Environment**: `POSTGRES_HOST_PORT=55432 STORAGE_HOST_PORT=39000 WORKER_HOST_PORT=33002` were exported for every stack command, and no override file was used. `fortal-postgres` (5432) and `fortal-minio` (127.0.0.1:9000) stayed up and were not touched. Mutant stacks ran from scratch copies under the scratchpad (`mroot/<id>/`, a `git archive f90d92a` copy with the sibling repositories symlinked beside it), with `COMPOSE_PROJECT_NAME=s5k`. Each was torn down with `down -v`.

**Result**: PASS. All 16 acceptance criteria and all 4 edge cases have `file:line` evidence and were observed on a live stack. The Build gate is green, including the second `up`. 35 behaviour-level mutants were injected: 34 were killed and 1 survived, and the survivor is equivalent. There are two non-blocking follow-ups, ranked under Gaps. The main one is that the tasks.md Build gate on its own does not discriminate the P1/P2 topology criteria. The orchestrator-defined probes do, and every one of those probes passed.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T10 PostgreSQL host port | ✅ Done | `6ad28fb`; `compose.yaml:192` |
| T1 identity + realm + API wiring | ✅ Done | `9126671`; the tmpfs deviation (`compose.yaml:54-55`) was re-verified below |
| T2 `get-token.mjs` | ✅ Done | `cd26995` |
| T3 DB script + generator fix | ✅ Done | `6c65d63`; the generator fix was re-verified (mutant G1) |
| T11 storage/worker host ports | ✅ Done | `b95ad40`; `compose.yaml:106`, `:217`, `scripts/smoke-local-integration.mjs:27` |
| T4–T8 smoke steps + refresh | ✅ Done | `9013c75`..`d77c4f9` |
| T9 README + proof | ✅ Done | `f90d92a`; every relative link resolves (checked). See Gap 1 on the `sub` evidence T4/T9 recorded |

Recorded deviations: (1) the Keycloak `tmpfs` on the H2 directory, found during Execute, is correct and needed (mutant K5). (2) The generator's `,?` fix and its query-count guard are correct (mutant G1). (3) T8 proved refresh with tampered tokens instead of a real expiry. That is acceptable, because a 5-minute expiry cannot occur in a run of about 10 s; the self-test's injected source discriminates it (M13–M15). No `SPEC_DEVIATION` markers are in the diff.

---

## Spec-Anchored Acceptance Criteria

### P1: An identity provider in the topology (AUTH-14, AUTH-15)

| Criterion | Spec-defined outcome | `file:line` + evidence | Result |
| --- | --- | --- | --- |
| AC1 provider healthy before the API starts | `api` waits on `identity` healthy | `compose.yaml:21-22` `identity: condition: service_healthy`; readiness probe `compose.yaml:59-68` (bash `/dev/tcp` → `GET /health/ready`, `"UP"`). Live: the first healthy probe of `identity` was at 04:29:28.90 and `api` started at 04:29:29.38 | ✅ PASS |
| AC2 imports `fiapx` from a versioned file | `--import-realm` of the repo file | `compose.yaml:36` `start-dev --import-realm`, `:49` bind of `./identity/fiapx-realm.json`; `identity/fiapx-realm.json:2` `"realm": "fiapx"`. Log: `Realm 'fiapx' imported` | ✅ PASS |
| AC3 API gets issuer, audience, key-set URL via env | three env vars | `compose.yaml:13` `OIDC_ISSUER=http://localhost:8080/realms/fiapx`, `:14` `OIDC_AUDIENCE=fiapx-api`, `:15` `OIDC_JWKS_URL=http://identity:8080/.../certs` | ✅ PASS |
| AC4 `iss` = `http://localhost:8080/realms/fiapx` from host and from inside the network | exact string both ways | `compose.yaml:45` `KC_HOSTNAME=http://localhost:8080`. Decoded host token: `iss` `http://localhost:8080/realms/fiapx`. Token from a `curlimages/curl` container on `fiap-x-platform_default` to `identity:8080`: the same `iss`, and the API answered 200 to it | ✅ PASS |
| AC5 `aud` includes `fiapx-api` | `fiapx-api` in `aud` | `identity/fiapx-realm.json:20-28` `oidc-audience-mapper`, `included.custom.audience: fiapx-api`, `access.token.claim: true`. Decoded: `"aud":"fiapx-api"`, RS256, TTL 300 s | ✅ PASS |

### P2: A token with one command (AUTH-16)

| Criterion | Spec-defined outcome | `file:line` + evidence | Result |
| --- | --- | --- | --- |
| AC1 exactly `alice` and `bob`, each with a dev password | two users | `identity/fiapx-realm.json:33-66` (pinned ids `:35`, `:51`; `temporary: false` `:47`, `:63`). Admin API `GET /admin/realms/fiapx/users` → `[alice 0f1c3a52-…-a11ce0000001, bob 0f1c3a52-…-b0b000000002]` | ✅ PASS |
| AC2 known user → only the access token on stdout, exit 0 | a single JWT line, exit 0 | `scripts/get-token.mjs:78` `console.log(await getToken(...))`, token only `:60`. Live: `alice` exit 0, one stdout line matching `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`, 0 bytes of stderr; `bob --password bob-dev-password` exit 0 | ✅ PASS |
| AC3 user/password rejected → non-zero, naming the user and the provider's error | exit ≠ 0, user + `error_description` | `scripts/get-token.mjs:53-55`, `:80-81`. Live: `mallory`, and `alice --password nope`, each exit 1 with empty stdout and `rejected user "<user>" with 400: Invalid user credentials` | ✅ PASS |
| AC4 provider unreachable → non-zero, naming `identity` | exit ≠ 0, names the service | `scripts/get-token.mjs:20`, `:40-42`. Live, with `identity` stopped: exit 1, `the identity service (compose service "identity", http://localhost:8080) is unreachable (ECONNREFUSED)`. An unknown host gives `ENOTFOUND` with the same naming | ✅ PASS |
| AC5 no self-registration | `registrationAllowed` false | `identity/fiapx-realm.json:4` `"registrationAllowed": false`; client `:15` `standardFlowEnabled: false`. Admin API read `False`; the registrations endpoint answers 400 (302 with the mutant) | ✅ PASS |

### P3: The smoke proves authentication and owner scope (AUTH-17)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| AC1 anonymous create → `401` | exactly 401 | `scripts/smoke-local-integration.mjs:281-290` `if (status !== 401) throw`; observe `:293-301` (no `Authorization`); step `:543-549`. Self-test `:796-801` (201/500/403), step case `:914`. Live: `API refused an anonymous POST /processing-requests (401)` | ✅ PASS |
| AC2 create as `alice`; every S4 assertion still passes | Bearer alice, no `ownerUserId`; S4 steps green | `scripts/smoke-local-integration.mjs:347-352` body `{ sourceStorageKey }` only, `:358` `createRequestAs('alice', …)`. Live: every S4 line green (storage 403, COMPLETED with 8 frames, FAILED `FORMATO_INVALIDO`, no archive, delivery once, no leftovers) | ✅ PASS |
| AC3 lists disjoint | alice ∌ bob's id; bob ∌ any alice id | `scripts/smoke-local-integration.mjs:412-423` (own ids required `:415-418`, leak checks `:419`, `:420-422` over this run's ids ∪ alice's listed ids); paged read `:399-408`; step `:631-643`. Self-test `:808-816`, `:932`. Live: `alice lists 2 requests and bob 1` | ✅ PASS |
| AC4 bob reads alice's id → `404`, same body as a random id | 404, byte-identical body | `scripts/smoke-local-integration.mjs:456-470` (`randomRead.status !== 404`, `crossRead.status !== 404`, `crossRead.body !== randomRead.body`); step `:645-652` uses `randomUUID()`. Self-test `:818-826`, `:934`. Live: green | ✅ PASS |
| AC5 no `sourceStorageKey`/`zipStorageKey`/`failureCode`/`ownerUserId`; the rejected request has the safe `failureReason` | fields absent (even null); exact sentence | `scripts/smoke-local-integration.mjs:426` `INTERNAL_FIELDS`, `:433` `Object.hasOwn`, `:440` `!== FORMATO_INVALIDO_REASON`; step `:654-658`. Self-test `:828-837` (each field literally, a null value, the sentence without its period, a missing reason, a missing request), `:936`. Live: green | ✅ PASS |
| AC6 `--self-test` requires each new step and rejects a bad input for each new assertion | 5 new required steps, each with a rejection | `scripts/smoke-local-integration.mjs:694-709` `REQUIRED_STEPS` (+`anonymous refused`, `bob request created`, `lists disjoint`, `cross-owner read 404`, `no internal fields`); step rejections `:911-940`; missing-step failure `:956`. Live: `14 required steps present, 58 bad inputs rejected …, 31 good inputs accepted` | ✅ PASS |

**Status**: ✅ 16/16 ACs evidenced, and the asserted values match the spec outcomes.

---

## Edge Cases

- [x] **Healthy provider with a failed import must not start the API.** Import failure makes Keycloak exit, so `identity` never turns healthy and `api` stays `Created`, because it depends on `compose.yaml:21-22`. Three broken realm files were tried in scratch copies. (a) Truncated JSON: exit 1, `Failed to run import: Unexpected end-of-input`. (b) The file missing, so Docker bind-mounts a directory: exit 1, `fiapx-realm.json (Is a directory)`. (c) The realm renamed: exit 1, `File name / realm name mismatch`. In all three, `up --wait` exited 1 with `dependency failed to start: container s5k-identity-1 exited (1)`, and `api` had `StartedAt=0001-01-01`. See spec-precision note 1.
- [x] **A restart reloads the realm, and a hand change does not survive.** `compose.yaml:54-55` puts a `tmpfs` on `/opt/keycloak/data/h2`, with no data volume. Live, through the admin API (admin/admin): `registrationAllowed` was set true and a user `eve` was added. `eve` could get a token. After `docker compose restart identity` (same container `f83010f794fe`) the log showed `Realm 'fiapx' imported` again, `registrationAllowed` read `False`, the users were `[alice, bob]`, and `get-token eve` exited 1 with `Invalid user credentials`.
- [x] **`sub` is unchanged across a restart.** The ids are pinned at `identity/fiapx-realm.json:35` and `:51`. Live: alice `0f1c3a52-7a2e-4d8b-9c61-a11ce0000001` and bob `…-b0b000000002` were the same across the gate's second `up`, across `up -d --wait --force-recreate identity` (container `fa2ad26ea550` → `f83010f794fe`) and across a plain restart. After the re-create, alice's list still held both of her smoke requests (the owner was kept). See Gap 1: only the re-create discriminates.
- [x] **A token that expires during a long run is refreshed.** `scripts/smoke-local-integration.mjs:307-321` defines `createTokenSource` and `:324-333` defines `withFreshToken`, which refetches once on 401 and fails naming the step on a second 401. Every authenticated call goes through `fetchAs` (`:337-345`). Self-test `:839` (two 401s fail naming `lists disjoint`) and `:872-883` (a 401 then a 200 uses `alice-token-1` then `alice-token-2`).

---

## Gate Check

Build gate as written in `tasks.md:182`, run on the real tree:

| Step | Outcome |
| --- | --- |
| `node clean-appledouble.mjs` | exit 0 |
| `docker compose config -q` | exit 0 (unset: `5432`/`9000`/`3002` published; set: `55432`/`39000`/`33002`) |
| `node scripts/check-worker-sizing.mjs` | `worker cpus 2 matches FFMPEG_THREADS 2, within the engine's 10 CPUs` |
| `node scripts/check-worker-sizing.mjs --self-test` | `12 bad inputs rejected …, 7 good inputs accepted` |
| `docker compose up --build -d --wait` | exit 0; 8 services healthy, `storage-init` exited 0 |
| `node scripts/seed-source-video.mjs` | exit 0 |
| `node scripts/smoke-local-integration.mjs` | exit 0 (summary lines below) |
| `node scripts/smoke-local-integration.mjs --self-test` | `14 required steps present, 58 bad inputs rejected with the expected message, 31 good inputs accepted` |
| second `docker compose up -d --wait` (no `-v`) | exit 0; alice's `sub` was the same before and after, and her list still had total 2 |
| `docker compose down -v` | exit 0 |

`node --check` passes for every `scripts/*.mjs`.

Smoke summary lines (live run):

```
Storage refused anonymous GET of fiapx/sources/sample-8s.mp4 and of the fiapx listing (403)
API refused an anonymous POST /processing-requests (401)
Created processing request 22f9ed03-… as alice
Created processing request 662156ec-… for the non-video as alice
Catalog reached COMPLETED for 22f9ed03-… with archive zips/22f9ed03-…/42b672ec-…/frames.zip
Catalog reached FAILED (FORMATO_INVALIDO) for 662156ec-…
Archive … holds 8 frames, as 8 s at 1 frame/s requires
No archive exists under zips/662156ec-…/
Notification delivered for 22f9ed03-…
Notification delivered once for 662156ec-…: O arquivo enviado nao e um video MP4 ou MOV valido.
Created processing request 05321149-… as bob
alice lists 2 requests and bob 1; neither list holds the other's
bob reading alice's request 22f9ed03-… got 404 with the same body as a random id
alice's list carries no internal field, and 662156ec-… carries the safe failureReason
No downloaded artefact left behind (1 scratch directory removed)
```

The orchestrator-defined probes were run on the live stack:

- **Claims.** From the host, alice and bob tokens decode to RS256, `iss` `http://localhost:8080/realms/fiapx`, `aud` `fiapx-api`, `azp` `fiapx-cli`, TTL 300 s and the pinned `sub`s. From inside the network, a token requested from `identity:8080` has the same `iss` and `aud`. The API answers 200 to both, and 401 without a token.
- **`sub` across a re-create of `identity`.** It was unchanged for both users, and so was the owner of existing requests.
- **`get-token`.** The success paths and each failure path are as listed under P2 AC2–AC4. With no arguments, or with an unknown flag, it exits 2 with the usage message.
- **Self-tests.** The smoke reports 14 / 58 / 31 and the sizing check 12 / 7.

**Test integrity**: before (`1b409cf`, per `tasks.md` T2/T3 evidence) the smoke self-test counted 9 required steps, 28 bad inputs and 20 good inputs. After, it counts 14 / 58 / 31. No S4 case was removed. The diff only adds to `REQUIRED_STEPS`, the rejections and the acceptances.

---

## Runtime Negatives

| Negative | How | Observed |
| --- | --- | --- |
| Broken realm keeps `api` from starting | scratch copies N1 (truncated JSON), N2 (file deleted), N3 (realm renamed); full `up --build -d --wait` | `identity` exited 1 in each (`Failed to run import` / `Is a directory` / `File name / realm name mismatch`); `up --wait` exited 1 with `dependency failed to start`; `api` state `Created`, never started |
| A hand change via the admin API does not survive a restart | real tree stack, admin/admin: `registrationAllowed=true` + user `eve`, then `docker compose restart identity` | re-imported; `registrationAllowed` `False`; users `[alice, bob]`; `eve` rejected. Restored by the restart itself |
| With `identity` stopped, `get-token` names the service | `docker compose stop identity` | exit 1, `the identity service (compose service "identity", http://localhost:8080) is unreachable (ECONNREFUSED)`; restored with `up -d --wait identity` |

---

## Discrimination Sensor

Every mutant ran in a fresh scratch copy (`git archive f90d92a` under `scratchpad/mroot/<id>`). An applier exits non-zero unless its anchor matches exactly once, so no mutant ran unapplied. Two gate sets decide a kill. **Gate A** is the `tasks.md` Build gate: config, `up --wait`, seed, smoke, self-tests and the second `up`. **Gate B** is the orchestrator-defined probes: decoded claims from the host and the network, `sub` across `--force-recreate identity`, the `get-token` paths, the three runtime negatives and the start-order read.

| # | File:line | Mutation | Gate A | Gate B | Killed? |
| --- | --- | --- | --- | --- | --- |
| M01 | `scripts/smoke-local-integration.mjs:286` | anonymous check accepts 403 (`>= 500`) | self-test: `anonymous creation answered 403: accepted` | — | ✅ |
| M02 | `scripts/smoke-local-integration.mjs:547` | `anonymous refused` check becomes a no-op | self-test: step given 201 accepted | — | ✅ |
| M03 | `scripts/smoke-local-integration.mjs:419` | alice-leak check removed | self-test | — | ✅ |
| M04 | `scripts/smoke-local-integration.mjs:420` | bob-leak ignores older alice ids | self-test: `bob's list holding an older alice request: accepted` | — | ✅ |
| M05 | `scripts/smoke-local-integration.mjs:418` | bob's own request not required (empty list passes) | self-test | — | ✅ |
| M06 | `scripts/smoke-local-integration.mjs:467` | cross-owner body comparison removed | self-test: `404 with another body: accepted` | — | ✅ |
| M07 | `scripts/smoke-local-integration.mjs:464` | cross-owner 403 accepted | self-test | — | ✅ |
| M08 | `scripts/smoke-local-integration.mjs:426` | `failureCode` dropped from `INTERNAL_FIELDS` | self-test (fields named literally) | — | ✅ |
| M09 | `scripts/smoke-local-integration.mjs:433` | a null-valued internal field accepted | self-test: `ownerUserId as null: accepted` | — | ✅ |
| M10 | `scripts/smoke-local-integration.mjs:440` | any non-empty `failureReason` accepted | self-test: near-miss sentence accepted | — | ✅ |
| M11 | `scripts/smoke-local-integration.mjs:654` | `no internal fields` removed from `SMOKE_STEPS` | self-test: required step missing | — | ✅ |
| M12 | `scripts/smoke-local-integration.mjs:645` | `cross-owner read 404` removed from `SMOKE_STEPS` | self-test | — | ✅ |
| M18 | `scripts/smoke-local-integration.mjs:543` | `anonymous refused` removed from `SMOKE_STEPS` | self-test | — | ✅ |
| M19 | `scripts/smoke-local-integration.mjs:631` | `lists disjoint` removed from `SMOKE_STEPS` | self-test | — | ✅ |
| M20 | `scripts/smoke-local-integration.mjs:621` | `bob request created` removed from `SMOKE_STEPS` | self-test | — | ✅ |
| M16 | `scripts/smoke-local-integration.mjs:626` | `bob request created` skips `assertCreated` | self-test: step given 401 accepted | — | ✅ |
| M13 | `scripts/smoke-local-integration.mjs:326` | refresh happens zero times | self-test (both refresh cases) | — | ✅ |
| M14 | `scripts/smoke-local-integration.mjs:327` | refresh happens two times | self-test: `called with ["alice-token-1","alice-token-3"]` | — | ✅ |
| M15 | `scripts/smoke-local-integration.mjs:315` | `refresh` returns the cached token | self-test: `called with ["alice-token-1","alice-token-1"]` | — | ✅ |
| M17 | `scripts/smoke-local-integration.mjs:696` | `anonymous refused` removed from `REQUIRED_STEPS` only | survived (13 / 58 / 30) | survived | ⚪ Equivalent: the step is still in `SMOKE_STEPS` with its check, so the smoke's behaviour is unchanged. Removing it from `SMOKE_STEPS` is killed (M18) |
| G1 | `scripts/generate-db-script.mjs:52` | regex reverted to reject the trailing comma | generator exits 1: `up() makes 2 query() calls but only 1 could be read` (control run: exit 0, byte-identical `db/create-database.sql`) | — | ✅ |
| K1 | `identity/fiapx-realm.json:35` | alice's pinned `id` dropped | **survived**: the second `up` gave the same `sub` `475bbb5b-…` because it re-creates nothing | `--force-recreate` → `c816fc81-…`, restart → `31b07e83-…` | ✅ (Gate B only; Gap 1) |
| K2 | `compose.yaml:45` | `KC_HOSTNAME` dropped | **survived**: smoke green (the host tokens still carry `localhost`) | in-network token `iss` `http://identity:8080/realms/fiapx`, and the API answers **401** to it | ✅ (Gate B only; Gap 2) |
| K3 | `identity/fiapx-realm.json:19-30` | audience mapper dropped | smoke exit 1: `Step "create requests": alice's request was refused with 401 twice …` | no `aud` in the token | ✅ |
| K4 | `identity/fiapx-realm.json:4` | `registrationAllowed: true` | survived | admin read `True`; registrations endpoint 302 instead of 400 | ✅ (Gate B only; Gap 2) |
| K5 | `compose.yaml:54-55` | `tmpfs` dropped | survived | hand change kept after the restart: `Import skipped`, `registrationAllowed` `True` | ✅ (Gate B only; Gap 2) |
| K6 | `compose.yaml:21-22` | `api` `depends_on: identity` dropped | survived (smoke green) | `api` started 04:40:48.68, before `identity`'s first healthy probe at 04:40:52.64 | ✅ (Gate B only; Gap 2) |
| K7 | `compose.yaml:217` | storage host port fixed to `9000:9000` | `up` fails: `Bind for 127.0.0.1:9000 failed: port is already allocated` | — | ✅ (discriminates only on a machine where 9000 is held) |
| K8 | `compose.yaml:192` | postgres host port fixed to `5432:5432` | `up` fails: `Bind for 0.0.0.0:5432 failed` | — | ✅ (same caveat) |
| T1 | `scripts/get-token.mjs:78` | CLI prints `token: <jwt>` | survived (the smoke imports `getToken`, not the CLI) | stdout no longer a lone JWT (0 lines match); decode fails | ✅ (Gate B only; Gap 2) |
| T2 | `scripts/get-token.mjs:20` | unreachable message stops naming `identity` | survived | message names the token URL, not `identity` | ✅ (Gate B only) |
| T3 | `scripts/get-token.mjs:55` | rejection stops naming the user and the error | survived | `rejected the request with 400` | ✅ (Gate B only) |
| N1–N3 | `identity/fiapx-realm.json` | truncated / missing / renamed realm | `up --wait` exit 1; `api` never starts | — | ✅ (edge case 1) |

**Sensor depth**: P0 (authentication and owner isolation). There are 35 mutants in all: 20 on smoke checks and steps (M01–M20, including the equivalent M17), 1 on the generator (G1), 8 on the topology and realm (K1–K8), 3 on `get-token` (T1–T3) and 3 broken realms (N1–N3).
**Isolation**: the real tree's `git status --porcelain` was empty before and is empty after. No `git stash` was used and the real tree was never edited. The sibling repositories were only read, as build contexts.
**Result**: 34/34 non-equivalent mutants killed by Gate A ∪ Gate B. Survivors: 1 (real 0, equivalent 1, harness-only 0). Gate A on its own leaves 7 non-equivalent survivors (K1, K2, K4, K5, K6, T1, T2); T3 is also caught only outside Gate A, by the probes (count corrected by the orchestrator from the Verifier's own note), and each breaks a P1/P2 criterion or edge case. See Gaps 1 and 2.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / surgical | ✅ The diff covers the `identity` service, the realm, a dependency-free token script, five new smoke steps, one refresh helper, the host-port substitutions and the generator fix. Nothing unrelated changed |
| Matches patterns | ✅ Each smoke assertion is a named step with a pure `check` and self-test cases (L-007..L-009); service conventions match the others; `fetch` only |
| Spec-anchored outcome check | ✅ Exact 401/404/201, byte-identical 404 bodies, the exact sentence, field presence via `Object.hasOwn` (so a null counts) |
| Minor inconsistency (not a gap) | `postProcessingRequest` accepts any 2xx (`scripts/smoke-local-integration.mjs:360`), while `assertCreated` requires 201 (`:376`). This pattern is from S4 and does not affect any criterion |
| Documented guidelines | lessons L-007..L-014 applied, as `tasks.md:164` states |

---

## Spec-precision notes

1. **Edge case 1 relies on Keycloak exiting.** The healthcheck (`compose.yaml:64`) reads only `/health/ready`, not the `fiapx` realm. With 26.7.4, every broken realm tried makes the process exit, so "healthy but import failed" cannot happen. A future image that skipped a failed import instead would pass the healthcheck without anything noticing. The pinned image makes this acceptable, but the spec does not say which mechanism enforces the edge case.
2. **"WHEN the stack restarts" is undefined.** A no-op `up`, `restart`, `--force-recreate` and `down`/`up` behave differently. Only the last three re-import the realm. The `tasks.md` Build gate's "second `up` without `-v`" restarts nothing, so it cannot be the restart the two restart edge cases mean (see Gap 1).
3. **P1 AC4's "from inside the network" has no consumer in the running system.** Nothing requests tokens in the network today, so the smoke cannot observe it (K2). Only a probe can.

---

## Gaps (ranked, non-blocking)

1. **The Build gate's "second `up` without `-v`" does not exercise the `sub` edge case, so the `sub` evidence recorded in T4/T9 is vacuous.** `tasks.md:182` runs a plain `docker compose up -d --wait`, which re-creates nothing when nothing changed. Mutant K1 (alice's pinned `id` removed) gave the same `sub` before and after that step. The edge case itself holds: the ids are pinned at `identity/fiapx-realm.json:35` and `:51`, and `sub` and ownership held across `--force-recreate identity` here and in T1's evidence. The gate as written cannot catch a regression, though. Fix: make the gate step `docker compose up -d --wait --force-recreate identity` (or `down` without `-v`, then `up`), compare `sub` for both users, and check that alice's earlier request is still listed.
2. **The P1/P2 topology criteria have no repeatable guard in the gate.** The test matrix (`tasks.md:168-169`) assigns the `iss`/`aud` claims, `sub` stability and the `get-token` success and failure paths to the Build gate, but the gate's command list runs none of them. Mutants K2 (in-network `iss`), K4 (registration), K5 (tmpfs), K6 (start order) and T1–T3 (`get-token` output) pass the Build gate and are caught only by manual probes. Optional fix: add a `scripts/check-identity.mjs` with `--self-test` to the Build gate. It would decode a host token and an in-network token (via `docker compose run`/`exec`), compare `sub` across a re-create, run `get-token` for `alice` and `mallory`, and read `registrationAllowed`.

---

## Requirement Traceability Update

AUTH-14, AUTH-15, AUTH-16 and AUTH-17 can move from Implementing to ✅ Verified. The Verifier does not edit `spec.md`.

---

## Summary

**Overall**: ✅ Ready, with two non-blocking follow-ups
**Spec-anchored check**: 16/16 ACs and 4/4 edge cases evidenced; 3 spec-precision notes
**Sensor**: 35 mutants; 34 killed, 1 equivalent survivor
**Gate**: Build gate green, including the second `up`. Smoke self-test 14 / 58 / 31, sizing self-test 12 / 7. The claims, `sub` and `get-token` probes and the three runtime negatives all behave as specified
