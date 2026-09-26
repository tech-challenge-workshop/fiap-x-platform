# Upload and Download Specification — platform

## Problem Statement

The API is about to sign URLs that a client on the host will use, but it has never talked to object storage: it has no storage credentials, and the only storage address in the topology is `http://storage:9000`, which a client outside the network cannot reach. A multipart upload that is started and never confirmed would sit in storage forever, since the bucket's rules only expire `sources/` and `zips/` objects. And the smoke still puts videos in storage with `seed-source-video.mjs` — the stand-in S4 created for exactly this slice to delete — so nothing proves the real upload and download.

## Goals

- [ ] URLs the API issues work from the client's machine, while the API itself reaches storage inside the network
- [ ] Abandoned multipart uploads are discarded by the bucket, not by hand
- [ ] The smoke proves the product's flow end to end: upload through the API, confirm idempotently, process, download the ZIP — and nothing else puts videos in storage

## Out of Scope

| Feature | Reason |
| --- | --- |
| The upload/confirm/download endpoints | `fiap-x-api` (UPL-01 to UPL-10) |
| Idempotent creation, the archive key | `processing-catalog` (UPL-11 to UPL-14) |
| TLS, a public DNS name, CORS for a browser client | No front end and no deployment in scope (S9a/S9b) |

---

## Assumptions & Open Questions

Decisions from the gray-area discussion of 2026-09-26 are in `context.md` beside this spec.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Two storage addresses for the API | An internal endpoint (`http://storage:9000`) for the API's own calls and a public endpoint for the URLs it signs, `http://localhost:${STORAGE_HOST_PORT:-9000}` | A presigned URL is bound to the host it was signed for; the client can only reach the published port. The public endpoint follows `STORAGE_HOST_PORT` (S5 T11) so both stay in step | y |
| API storage credentials | The same development credentials as the Worker, through the API's environment | AD-005: development values in `environment`, nothing reaches a deployed environment | y |
| Abandoned multipart uploads | A third bucket lifecycle rule, `AbortIncompleteMultipartUpload` after 1 day, owned by the bootstrap by ID like the other two | context.md (Agent's Discretion); the bootstrap already refuses rules it does not own, so the new one must be one of its own | y |
| The seed script | Deleted, with its gate step | S4 designed it as the first thing S6 removes; keeping it would be a second way to put videos in storage | y |
| Upload in the smoke | The smoke uploads the committed fixture and the generated non-video through the API: start, `PUT` each part, confirm | It is the only proof that the URLs work from the host | y |
| Whether RustFS supports presigned multipart and the abort rule | To be verified in Design before it is specified further | After MinIO's images vanished (AD-014), behaviour a slice depends on is checked against the real server first | y |

**Open questions:** none - all resolved or logged above. (The RustFS capability check is a Design task, not an open product question.)

---

## User Stories

### P1: The API can sign URLs the client can use ⭐ MVP

**User Story**: As the API, I want storage credentials and a public endpoint so that the URLs I sign work from the client's machine.

**Why P1**: Without it, every URL the API issues points at an address the client cannot reach.

**Acceptance Criteria**:

1. The API SHALL receive an internal storage endpoint, a public storage endpoint, the bucket name and credentials through environment variables.
2. WHEN a URL is issued THEN it SHALL target `http://localhost:<STORAGE_HOST_PORT>` and SHALL be usable from the host.
3. WHEN `STORAGE_HOST_PORT` is set THEN the public endpoint SHALL follow it without any other change.
4. The API SHALL start only after the storage bootstrap has completed.

**Independent Test**: Start the stack with `STORAGE_HOST_PORT=39000`; the part URLs the API returns use port 39000 and accept a `PUT` from the host.

---

### P2: Abandoned uploads are discarded ⭐ MVP

**User Story**: As the operator, I want incomplete multipart uploads discarded automatically so that storage does not fill with abandoned parts.

**Why P2**: A 500 MB upload abandoned mid-way would otherwise occupy storage forever.

**Acceptance Criteria**:

1. WHEN the bootstrap runs THEN the bucket SHALL carry exactly three lifecycle rules: 7-day expiry on `sources/` and on `zips/`, and abort of incomplete multipart uploads after 1 day.
2. WHEN the bootstrap runs again THEN it SHALL leave the three rules unchanged and report them as already configured.
3. IF the bucket carries a lifecycle rule the bootstrap does not own THEN it SHALL still exit non-zero naming it, as today.

**Independent Test**: Run the bootstrap twice and read the configuration back: three rules, the third an abort after one day.

---

### P3: The smoke proves the real flow ⭐ MVP

**User Story**: As a reviewer, I want the smoke to upload, confirm, process and download through the API so that a green run proves the product works as a user would use it.

**Why P3**: Until now the smoke put videos in storage behind the API's back.

**Acceptance Criteria**:

1. WHEN the smoke runs THEN it SHALL upload the fixture as `alice` through the API's part URLs, confirm it with an `Idempotency-Key`, and assert the resulting request reaches `COMPLETED` with an 8-frame archive.
2. WHEN the smoke repeats the confirmation with the same key THEN it SHALL assert the same `processingRequestId` and that `alice` has no additional request.
3. WHEN the smoke uses that key to confirm a second upload THEN it SHALL assert `409`.
4. WHEN the smoke uploads and confirms the non-video THEN every S4 and S5 assertion about the rejected request SHALL still hold.
5. WHEN `alice` requests the download of her completed request THEN the smoke SHALL fetch the returned URL from the host and count the archive's entries through it.
6. WHEN `bob` requests the download of `alice`'s request THEN the smoke SHALL assert the constant `404`.
7. The smoke SHALL assert that `POST /processing-requests` is gone (`404`).
8. The smoke's `--self-test` SHALL require each new step and reject a bad input for each new assertion.
9. The repository SHALL contain no script that writes videos to storage outside the API.

**Independent Test**: Run the smoke on the stack; then, in a scratch copy of the API, make confirmation create a second request on replay and see the smoke fail naming it.

---

## Edge Cases

- WHEN the stack is re-created THEN the lifecycle rules SHALL be re-applied by the bootstrap and the API SHALL still sign for the public endpoint.
- IF a download URL is requested before the request completes THEN the smoke SHALL treat `409` as expected, not as a failure, while polling.

---

## Requirement Traceability

`UPL-` is shared: `fiap-x-api` owns `UPL-01` to `UPL-10`, `processing-catalog` `UPL-11` to `UPL-14`, this repository `UPL-15` to `UPL-18`.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| UPL-15 | P1: The API can sign URLs the client can use | Validate | Verified |
| UPL-16 | P2: Abandoned uploads are discarded | Validate | Implementing (open: V34, failure scenarios B2-B5 not in the gate; V36, extra actions on the abort rule accepted) |
| UPL-17 | P3: The smoke proves the real flow | Validate | Implementing (open: V35, download not tied to this request's archive) |
| UPL-18 | P3: No script writes videos outside the API (seed removed; database script regenerated) | Validate | Implementing (open: V37, DB-script drift and the storage-write reader not gated) |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 4 total, 4 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] The smoke uploads the fixture through the API from the host, confirms it twice with one key, and downloads an 8-frame ZIP through the returned URL
- [ ] `bob` cannot obtain a download URL for `alice`'s request
- [ ] The bucket carries the abort rule, and no seed script remains

---

## Dependencies

`fiap-x-api` UPL-01 to UPL-10 and `processing-catalog` UPL-11 to UPL-14 for P3. P1 and P2 are buildable first.
