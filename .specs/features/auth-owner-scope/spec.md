# Auth and Owner Scope Specification — platform

## Problem Statement

S5 puts the API behind JWT validation, but the topology has no identity provider: nothing issues a token, nobody can log in, and the smoke creates requests anonymously with `ownerUserId` in the body. AD-005 chose Keycloak as the local OIDC provider; this repository owns the topology, so the provider, its realm and its demo users belong here, together with the proof that authentication and owner scoping hold end to end.

## Goals

- [ ] The local topology runs an OIDC provider whose tokens the API accepts, with a versioned realm and two demo users
- [ ] A developer gets a token for a demo user with one command
- [ ] The smoke proves, on the real stack, that anonymous calls are refused and that two users can never see each other's requests — while every S4 assertion keeps passing

## Out of Scope

| Feature | Reason |
| --- | --- |
| JWT validation and owner-scoped reads | `fiap-x-api` (AUTH-01 to AUTH-09) and `processing-catalog` (AUTH-10 to AUTH-13) |
| Browser login, a front end | No front end in scope (context.md, Deferred Ideas) |
| Self-registration, password reset, account management | Provisioning is administrative (`docs/foudation.md`) |
| A production identity provider, secrets management | S9a/S9b; AD-005 keeps secrets in Kubernetes secrets |
| Constraining `sourceStorageKey` per owner | S6 (known risk recorded in the API spec) |

---

## Assumptions & Open Questions

Decisions from the gray-area discussion of 2026-09-26 are in `context.md` beside this spec.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Identity provider image | `quay.io/keycloak/keycloak:26.7.4` | AD-005 names Keycloak. Checked pullable for amd64 and arm64 on 2026-09-26, and mirrored at `docker.io/keycloak/keycloak` — after MinIO's images vanished (AD-014), availability is verified before it is specified | y |
| How the realm exists | A versioned realm file imported at start (`--import-realm`); the provider runs in development mode with its embedded database and no volume, so every start reloads the realm from the file | The file is the source of truth and is reviewable; nothing configured by hand survives a restart to drift from it | y |
| Login for the demo | A public client that allows the password grant; `node scripts/get-token.mjs <user>` prints an access token | Discussed: scriptable, so the smoke authenticates unattended and the video shows username-and-password login in one command. The grant is discouraged by OAuth 2.1; acceptable for a local development client and documented as such | y |
| Demo users | `alice` and `bob`, development passwords committed in the realm | Discussed: two users are the minimum that proves disjoint lists; same rule as the PostgreSQL credentials | y |
| The issuer the API validates | One fixed issuer for every token, set by pinning the provider's public hostname to `http://localhost:8080`, while the API fetches signing keys from the internal address `http://identity:8080` | Tokens are requested from the host and validated inside the network; without a fixed hostname the `iss` would differ between the two and every token would fail validation | y |
| The audience the API validates | The realm adds the API's audience (`fiapx-api`) to access tokens issued to the demo client | Keycloak does not put the API in `aud` by default; validating `aud` (AD-005's standard claims) needs it there | y |
| Token lifetime | The provider's default (5 minutes) | Nothing asks for another value; long enough for the smoke | y |
| Status polling in the smoke | Keeps using the Catalog's local-only observation endpoint for `zipStorageKey`, which the API deliberately never exposes, and additionally asserts the API's owner-scoped reads | The archive check needs the key; the API reads are what this slice must prove | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: An identity provider in the topology ⭐ MVP

**User Story**: As the API, I want an OIDC provider in the local topology so that there are tokens to validate.

**Why P1**: Nothing in this slice can be demonstrated without it.

**Acceptance Criteria**:

1. WHEN the topology starts THEN the stack SHALL run an OIDC provider that reports healthy before the API starts.
2. WHEN the provider starts THEN it SHALL import the `fiapx` realm from a file versioned in this repository.
3. The API SHALL receive the issuer, the audience and the signing-key endpoint through environment variables.
4. WHEN a token is issued THEN its `iss` SHALL be `http://localhost:8080/realms/fiapx`, whether it was requested from the host or from inside the network.
5. WHEN a token is issued to the demo client THEN its `aud` SHALL include `fiapx-api`.

**Independent Test**: Start the stack, request a token from the host, decode it, and see the fixed issuer and the API audience; the API accepts it.

---

### P2: A token with one command ⭐ MVP

**User Story**: As a developer or presenter, I want a token for a demo user with one command so that I can call the API as that user.

**Why P2**: It is how the smoke and the video log in.

**Acceptance Criteria**:

1. The realm SHALL contain exactly the users `alice` and `bob`, each with a development password.
2. WHEN `node scripts/get-token.mjs <user>` runs with a known user THEN it SHALL print only the access token on stdout and exit 0.
3. IF the user or password is rejected THEN the script SHALL exit non-zero naming the user and the provider's error.
4. IF the provider is unreachable THEN the script SHALL exit non-zero naming the `identity` service.
5. The realm SHALL NOT allow self-registration.

**Independent Test**: `node scripts/get-token.mjs alice` prints a JWT; `node scripts/get-token.mjs mallory` exits 1 naming the rejection.

---

### P3: The smoke proves authentication and owner scope ⭐ MVP

**User Story**: As a reviewer, I want the smoke to prove authentication and owner isolation on the real stack so that a green run means users are protected from each other.

**Why P3**: Unit tests can prove the guard; only the running stack proves the provider, the API and the Catalog agree.

**Acceptance Criteria**:

1. WHEN the smoke runs THEN it SHALL assert that creating a request without a token is refused with `401`.
2. WHEN the smoke creates requests THEN it SHALL do so as `alice` with her token, and every S4 assertion SHALL still pass.
3. WHEN the smoke has created a request as `bob` THEN `alice`'s list SHALL NOT contain it and `bob`'s list SHALL NOT contain any of `alice`'s.
4. WHEN `bob` reads one of `alice`'s request ids THEN the smoke SHALL assert `404`, with the same body a random id gets.
5. WHEN `alice` lists her requests THEN the smoke SHALL assert that no item contains `sourceStorageKey`, `zipStorageKey`, `failureCode` or `ownerUserId`, and that her rejected request carries the safe `failureReason`.
6. The smoke's `--self-test` SHALL require each new step and SHALL reject a bad input for each new assertion.

**Independent Test**: Run the smoke; then make the API return `bob`'s requests to `alice` in a scratch copy and see the smoke fail naming the leak.

---

## Edge Cases

- IF the provider is healthy but the realm import failed THEN the stack SHALL NOT report the API as started against a provider without the realm.
- WHEN the stack restarts THEN the realm SHALL be reloaded from the file, and a change made by hand in the provider's console SHALL NOT survive.
- WHEN the stack restarts THEN each demo user's `sub` SHALL be unchanged, so requests created before the restart keep their owner. (Added after the design spike showed that users without a pinned `id` get a new `sub` on every re-import.)
- IF a token expires during a long smoke run THEN the smoke SHALL obtain a new one rather than fail on expiry.

---

## Requirement Traceability

`AUTH-` is shared: `fiap-x-api` owns `AUTH-01` to `AUTH-09`, `processing-catalog` `AUTH-10` to `AUTH-13`, this repository `AUTH-14` to `AUTH-17`.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| AUTH-14 | P1: An identity provider in the topology | Tasks | In Tasks |
| AUTH-15 | P1: An identity provider in the topology | Tasks | In Tasks |
| AUTH-16 | P2: A token with one command | Tasks | In Tasks |
| AUTH-17 | P3: The smoke proves authentication and owner scope | Tasks | In Tasks |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 4 total, 4 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] `docker compose up --build -d --wait` brings up the provider with the realm, and the API accepts tokens from `scripts/get-token.mjs`
- [ ] The smoke is green as `alice` and `bob`, and fails when the API leaks one user's request to the other
- [ ] Every S4 smoke assertion still passes

---

## Dependencies

`fiap-x-api` AUTH-01 to AUTH-09 and `processing-catalog` AUTH-10 to AUTH-13 must exist for P3. P1 and P2 are buildable and demonstrable first.
