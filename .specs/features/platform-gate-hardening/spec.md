# Platform Gate Hardening Specification

## Problem Statement

The platform's build gate is the only place the whole system runs, and the S4, S5 and S6 Verifiers each found checks it cannot fail. The storage bootstrap's refusals are proven only by hand: loosening the foreign-rule check would make the next start **delete an operator's lifecycle rule** with the gate green (V34). The smoke would accept a download of the wrong request's archive (V35). Its observations and sentence check accept near-misses (V16, V17). Nothing proves that `main()` runs every step or that a failure exits non-zero (V14, V15). The database script can drift from the migrations (V10). The identity's properties are unguarded (V24, V25). Spec B's fixes have not run on the real stack. And a request that fails **in processing** has never been proven end to end (V8).

## Goals

- [ ] Every regression listed by the S4–S6 Verifiers for this repository turns the build gate red
- [ ] The smoke proves both failure paths end to end, and spec B's fixes on the real stack
- [ ] No gate check depends on a hand-run probe

## Out of Scope

| Feature | Reason |
| --- | --- |
| Running stack-dependent checks in CI | The `integration` job never runs (V11); spec D decides it |
| Required status checks (V12) | Spec D |
| Service code changes (V38–V41) | Other repositories; recorded as open items |
| A new processing-failure mechanism in the Worker | Decided: the failure comes from a fixture, not from a code or configuration change |

---

## Assumptions & Open Questions

Decisions of 2026-09-26 are in `context.md` beside this spec.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| How V8's processing failure is produced | A committed fixture that FFprobe accepts and FFmpeg fails on | Decided; it needs no Worker change and runs in the normal stack | y |
| If no such fixture can be found | The Design phase reports it, and GATE-16 goes back to open | Decided: no silent change of approach. Spike of 2026-09-26 found one (design.md) | y |
| V25 | `scripts/check-identity.mjs` with `--self-test`, in the build gate | Decided | y |
| Where the bucket scenarios run | Against the stack's own storage, on scratch buckets the runner creates and deletes; never on `fiapx` itself except the read-back | The real server is what the bootstrap talks to (AD-014); the live bucket must not be disturbed mid-gate | y |
| Database drift check | Regenerate from the sibling repositories' migrations and fail on any difference from the committed script, in the build gate | The generator needs the service repositories checked out, which only the build gate has today (V11) | y |
| "Exits non-zero" proof (V15) | Each gate script's `--self-test` runs the script itself as a child process with a forced failure and requires a non-zero exit and the failure message | Tests the process boundary, which an in-process test cannot | y |
| Which identity properties | Those the S5 Verifier proved only by hand: in-network `iss`, registration disabled, the H2 directory on `tmpfs`, the API starting after the identity is healthy, and `get-token` printing only the token and naming `identity` when unreachable | S5 `validation.md`, mutants K2, K4, K5, K6, T1, T2 | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: The storage bootstrap is guarded by the gate ⭐ MVP

**User Story**: As an operator, I want every refusal and repair the bootstrap makes proven on each gate run so that a regression can never delete a rule it does not own.

**Why P1**: It is the one gate gap that destroys data (V34).

**Acceptance Criteria**:

1. WHEN the build gate runs THEN a versioned bucket-scenario runner SHALL run the real `storage/bootstrap.sh` against scratch buckets on the stack's storage and SHALL exit non-zero if any scenario fails.
2. WHEN the runner bootstraps a fresh bucket THEN exactly the three owned rules SHALL be read back.
3. WHEN the runner bootstraps it again THEN the bootstrap SHALL print the three "already configured" lines and the configuration SHALL be byte-identical.
4. WHEN the runner bootstraps a bucket with S5's two rules THEN it SHALL be upgraded to the three rules.
5. IF a bucket carries a rule the bootstrap does not own THEN the bootstrap SHALL exit 1 naming it, and the configuration SHALL be byte-identical afterwards.
6. IF the abort rule is disabled, set to 2 days, narrowed to a prefix, or carries an extra action such as `Expiration` THEN the bootstrap SHALL rewrite it to the owned rule.
7. IF a bucket has a bucket policy THEN the bootstrap SHALL exit 1 naming the bucket.
8. WHEN the smoke runs THEN a step SHALL read the live bucket's lifecycle rules without the bootstrap and SHALL require exactly the three owned rules.

**Independent Test**: Loosen the foreign-rule check, or change `1` to `2` days, in a scratch copy: the gate fails naming the scenario.

---

### P2: The database script cannot drift ⭐ MVP

**User Story**: As a reviewer, I want the committed database script to be proven equal to the migrations so that the deliverable never describes a schema the services do not have.

**Why P2**: ENT-2 is a deliverable; today it matches only by convention (V10).

**Acceptance Criteria**:

1. WHEN the build gate runs THEN it SHALL regenerate `db/create-database.sql` from the service repositories' migrations and SHALL fail if the result differs from the committed file.
2. The committed script SHALL include `uq_processing_request_owner_source` from `processing-catalog`'s `1789957000000-UniqueOwnerSource`.

**Independent Test**: Delete one line from the committed script: the gate fails naming the file.

---

### P3: The storage-write check reads what it claims ⭐ MVP

**User Story**: As a reviewer, I want the "no script writes videos outside the API" check to read every script, so that it cannot pass by reading nothing.

**Why P3**: Its file reader is untested and it only scans the top of `scripts/` (V37).

**Acceptance Criteria**:

1. The check SHALL scan every script file under `scripts/`, including subdirectories.
2. WHEN the self-test runs THEN it SHALL run the real file reader on a temporary directory containing a nested script that writes to the bucket, and SHALL require the check to fail naming that file.
3. IF the check reads zero files THEN it SHALL exit non-zero.

**Independent Test**: Make the reader return no files: the self-test fails.

---

### P4: The smoke's observations are exact ⭐ MVP

**User Story**: As a reviewer, I want each smoke observation tied to the exact request and value it claims so that a wrong answer cannot pass.

**Why P4**: The smoke accepted another request's archive (V35), deliveries counted by the wrong id (V16), a near-miss sentence (V17), and an object at any key (V18).

**Acceptance Criteria**:

1. WHEN the download URL is issued THEN the smoke SHALL require its path to equal `/<bucket>/<zipStorageKey>` of that same request.
2. WHEN deliveries are counted THEN the smoke SHALL count only the deliveries whose request id is the one under test. Its self-test SHALL reject a count that includes another request's deliveries.
3. WHEN the delivery sentence is checked THEN the smoke SHALL require exact equality. Its self-test SHALL reject a prefix, a truncation, an extension and a case change.
4. WHEN the archive is checked in storage THEN the smoke SHALL require exactly one object, at exactly the request's `zipStorageKey`.

**Independent Test**: Serve the owner's first archive for every download from a scratch API image: the smoke fails naming the step.

---

### P5: Failures are fatal ⭐ MVP

**User Story**: As a reviewer, I want every gate script to fail loudly so that a green gate means every step ran and passed.

**Why P5**: `main()` running a subset of the steps passes every gate (V14), and no gate proves a non-zero exit (V15).

**Acceptance Criteria**:

1. The smoke's self-test SHALL fail if the steps `main()` runs differ from the declared step list in number, order or name.
2. WHEN the self-test of each gate script runs THEN it SHALL run that script as a child process with a forced failure, and SHALL require a non-zero exit code and the failure message on stderr. The scripts are the smoke, the Worker sizing check, the storage-write check, the identity check and the bucket-scenario runner.

**Independent Test**: Make the smoke's `main()` skip its last step, or make a script exit 0 on failure: its self-test fails.

---

### P6: The identity is proven by the gate

**User Story**: As an operator, I want the identity's configuration proven on every gate run so that a lost setting is caught before the demo.

**Why P6**: Six S5 properties are proven only by probes run by hand (V24, V25).

**Acceptance Criteria**:

1. WHEN the gate recreates the identity container THEN `alice`'s and `bob`'s `sub` SHALL be the same before and after.
2. WHEN `scripts/check-identity.mjs` runs THEN it SHALL fail if a token obtained inside the network does not carry `iss` `http://localhost:8080/realms/fiapx`.
3. WHEN it runs THEN it SHALL fail if self-registration is allowed on the realm.
4. WHEN it runs THEN it SHALL fail if the identity's data directory is not on `tmpfs`.
5. WHEN it runs THEN it SHALL fail if the API started before the identity was healthy.
6. WHEN it runs THEN it SHALL fail if `node scripts/get-token.mjs alice` prints anything but one JWT, or if its unreachable message does not name `identity`.
7. WHEN its `--self-test` runs THEN it SHALL reject a bad input for each check and accept a good one.

**Independent Test**: Set `registrationAllowed: true` in a scratch realm: the check fails naming it.

---

### P7: Spec B's fixes hold on the real stack

**User Story**: As a reviewer, I want the smoke to prove spec B's behaviour through the real API and storage so that the fixes are known to work outside the test doubles.

**Why P7**: Spec B moved these proofs here.

**Acceptance Criteria**:

1. WHEN the smoke uploads a part of 1 byte followed by a final part and confirms THEN it SHALL require `400 Uploaded parts are invalid: every part except the last must be 16777216 bytes`, and a second confirmation SHALL be `404`.
2. WHEN the smoke confirms an already-confirmed upload with a second key THEN it SHALL require `200` with the same `processingRequestId` and `alice`'s total unchanged.

**Independent Test**: A scratch API that maps rejected parts to `502` fails the first step.

---

### P8: A processing failure is proven end to end

**User Story**: As a reviewer, I want the smoke to take a request to `FAILED` through processing, not only through validation, so that both terminal failures are proven.

**Why P8**: Only the rejection path is proven on the stack (V8).

**Acceptance Criteria**:

1. WHEN the smoke uploads and confirms the corrupted fixture THEN the request SHALL reach `FAILED` with `failureCode` `PROCESSAMENTO_FALHOU`, which only the processing path emits.
2. WHEN it reaches `FAILED` THEN its `failureReason` SHALL be the Catalog's sentence for a processing failure, and no archive SHALL exist under its `zips/` prefix.
3. WHEN the notification service handles it THEN exactly one delivery SHALL exist for that request, carrying the same sentence.

**Independent Test**: Replace the corrupted fixture with the valid one: the step fails because the request completes.

---

### P9: The gate recreates what it claims and the README is current

**User Story**: As a reviewer, I want the gate's restart to recreate every service whose state matters, and the README to describe the gate as it is.

**Why P9**: The force-recreate skips the API, and the README is stale (V18, V37).

**Acceptance Criteria**:

1. The build gate's recreate step SHALL recreate `identity`, `storage-init` and `api`, and the smoke SHALL pass again afterwards.
2. The README SHALL describe every gate command and every smoke step, and its links SHALL resolve.

**Independent Test**: The docs-links check reports 0 unresolved links, and each step name in the step list appears in the README.

---

## Edge Cases

- IF a scratch bucket from an interrupted runner still exists THEN the runner SHALL delete it before starting.
- IF the corrupted fixture is rejected by validation instead THEN the step SHALL fail naming `FORMATO_INVALIDO`, not pass.
- WHEN the identity is recreated THEN the smoke's token refresh SHALL still succeed.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| GATE-01 | P1: Bucket-scenario runner in the gate (V34, V20) | Tasks | In Tasks |
| GATE-02 | P1: Abort rule with extra actions rewritten (V36) | Tasks | In Tasks |
| GATE-03 | P1: Smoke reads the live lifecycle rules (V34) | Tasks | In Tasks |
| GATE-04 | P2: Database script drift check (V10, V37) | Tasks | In Tasks |
| GATE-05 | P2: Script includes spec B's index | Tasks | In Tasks |
| GATE-06 | P3: Storage-write check reads every script (V37) | Tasks | In Tasks |
| GATE-07 | P4: Download tied to the request's archive (V35) | Tasks | In Tasks |
| GATE-08 | P4: Deliveries counted by the right id (V16) | Tasks | In Tasks |
| GATE-09 | P4: Exact delivery sentence (V17) | Tasks | In Tasks |
| GATE-10 | P4: Exactly one object at the exact key (V18) | Tasks | In Tasks |
| GATE-11 | P5: `main()` runs every step (V14) | Tasks | In Tasks |
| GATE-12 | P5: Every gate script exits non-zero on failure (V15) | Tasks | In Tasks |
| GATE-13 | P6: `sub` stable across an identity recreate (V24) | Tasks | In Tasks |
| GATE-14 | P6: `check-identity.mjs` (V25) | Tasks | In Tasks |
| GATE-15 | P7: Spec B's fixes on the real stack | Tasks | In Tasks |
| GATE-16 | P8: Processing failure end to end (V8) | Tasks | In Tasks |
| GATE-17 | P9: Recreate includes the API; README current (V18, V37) | Tasks | In Tasks |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 17 total, 17 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] Each mutant the S4–S6 Verifiers left alive in this repository is killed by a gate command
- [ ] The smoke proves `COMPLETED`, rejection and processing failure on the real stack
- [ ] The gate has no step that only a hand-run probe proves

---

## Dependencies

`processing-catalog` and `fiap-x-api` `main` (spec B merged) for GATE-05 and GATE-15. The Worker image on `main` for GATE-16.
