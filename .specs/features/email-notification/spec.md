# Email Notification — Platform Specification

## Problem Statement

RF-5 cannot be demonstrated end-to-end without a real SMTP endpoint in the local topology and a way to observe what actually landed in it. The AD-005 stack table already names Mailpit for this; nothing has wired it in yet.

## Goals

- [ ] Add Mailpit to `compose.yaml`, reachable by `notification` over SMTP and by the host/smoke over its HTTP API.
- [ ] Extend the smoke to prove exactly one failure email lands in Mailpit for each of the two failure fixtures, carrying the exact safe sentence.
- [ ] Record AD-015 in `.specs/STATE.md`: the owner's email is resolved once, from the token's standard `email` claim, and carried structurally to the terminal event only.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| Asserting the success email in the smoke | Not required by this slice's Definition of Done, which names only the failure path; the success template is exercised by `notification-service`'s own tests. |
| A production SMTP relay | Local-first (AD-005): Mailpit is the target for this delivery, a real provider is a later, documented evolution. |
| Any change to the smoke's existing delivery-record assertions (`video delivery`, `delivery sentence`, `single delivery`, `processing failure delivery`) | Those already prove `DeliveryRecord` correctness; this slice adds a black-box proof on top, it does not replace them. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Image | `axllent/mailpit`, exact tag to be pinned at implementation time | No registry access from this design session to confirm the current tag; AD-014 already showed an unpinned/assumed tag is the wrong way to find that out | n — pin and verify pullable before merging, same process as AD-014 |
| Ports | `1025` (SMTP) reachable only inside the network; `8025` (HTTP UI + API) published to the host | Services never need the HTTP side; the smoke and a human both need it from the host | y |
| Mailbox reset between smoke runs | Not reset — Mailpit has no volume, so it empties on `docker compose down`, but a same-session rerun (e.g. the build gate's force-recreate step) accumulates messages | The build gate's step 10 force-recreates only `identity`, `storage-init`, `api` — not `mailpit` or `notification` — so a second smoke run in the same gate sees the first run's messages too | y |
| How the smoke tells its own message apart from an earlier run's | Search Mailpit by recipient **and** the exact safe sentence **and** the `processingRequestId` the templates embed | `processingRequestId` is unique per run (a fresh UUID each time), so filtering on it is what makes "exactly one" a correct assertion even in an accumulating mailbox | y |
| Mailpit's search query syntax | To confirm during implementation against the pinned version's actual API/docs | Same reasoning as the image tag — not something to assert confidently without checking the running service | n |

**Open questions:** two, both logged above, both resolved by verifying against the running service at implementation time rather than by design-time assumption.

---

## User Stories

### P1: Mailpit in the topology ⭐ MVP

**User Story**: As a developer, I want `docker compose up` to give me a working SMTP sink, so that `notification-service` has somewhere to send to and I have somewhere to look.

**Why P1**: Nothing else in this slice can run locally without it.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN the topology starts THEN it SHALL include a Mailpit service reachable at `mailpit:1025` by services and `localhost:8025` by the host. <!-- event-driven -->
2. `notification`'s environment SHALL point its SMTP configuration at Mailpit, not a placeholder. <!-- ubiquitous -->
3. WHILE Mailpit is not healthy, `notification` SHALL NOT be started. <!-- state-driven -->

**Independent Test**: `docker compose up --build -d --wait`, then confirm `notification` is healthy and `http://localhost:8025` answers.

---

### P2: Prove the failure email in the smoke

**User Story**: As an evaluator, I want the smoke to show a real email in Mailpit for an invalid video, because that is the observable proof RF-5's Definition of Done asks for.

**Why P2**: Depends on P1's service existing and `notification-service`'s send path (its own feature) being wired.

**Acceptance Criteria**:

1. WHEN the smoke's rejected-upload and corrupted-video runs each reach their terminal `FAILED` status THEN a new smoke step SHALL query Mailpit's HTTP API and SHALL find exactly one message to that request's owner carrying the exact safe sentence and that request's id. <!-- event-driven -->
2. IF that count is not exactly one THEN the step SHALL fail naming the count found, matching the existing smoke convention (e.g. the `archive count` step). <!-- unwanted-behavior -->

**Independent Test**: Run the smoke twice against the same stack without tearing it down; both runs' failure-email steps SHALL pass independently, proving the per-run filter (not "the mailbox is empty") is what the assertion actually relies on.

---

## Edge Cases

- IF Mailpit is reachable but its API's search returns messages in an unexpected shape (a version drift after the tag is bumped later) THEN the check SHALL fail naming what it expected, not throw an unrelated error — the same "fail naming it" convention as every other smoke check.
- WHEN the build gate's step 10 force-recreates `identity`/`storage-init`/`api` and step 11 reruns the smoke THEN the failure-email steps SHALL still each find exactly one matching message, scoped by that run's own `processingRequestId`, undisturbed by the first run's messages still sitting in the same mailbox.

---

## Requirement Traceability

`EN-` is shared across this feature: `fiap-x-api` owns `EN-01` to `EN-05`, `processing-catalog` owns `EN-06` to `EN-10`, `notification-service` owns `EN-11` to `EN-21`, this repository owns `EN-22` to `EN-26`.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| EN-22 | P1: Mailpit in the topology | Design | Pending |
| EN-23 | P1: Mailpit in the topology | Design | Pending |
| EN-24 | P1: Mailpit in the topology | Design | Pending |
| EN-25 | P2: Prove it in the smoke | Design | Pending |
| EN-26 | P2: Prove it in the smoke | Design | Pending |

**ID format:** `EN-[NUMBER]`

**Coverage:** 5 total, 0 mapped to tasks, 5 unmapped (mapping happens in Tasks).

---

## Success Criteria

- [ ] `docker compose up --build -d --wait` brings up a healthy Mailpit, and `notification` starts only after it.
- [ ] The smoke's two failure fixtures each produce exactly one matching message in Mailpit, found by the smoke itself.
- [ ] Running the smoke twice in the same session (as the build gate does) never produces a false "more than one" or "none found" from accumulated mailbox state.
- [ ] AD-015 is recorded in `.specs/STATE.md`.
