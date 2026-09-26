# Auth and Owner Scope Context

**Gathered:** 2026-09-26
**Spec:** `.specs/features/auth-owner-scope/spec.md` (this repository), plus the same feature in `fiap-x-api` and `processing-catalog`
**Status:** Ready for design

---

## Feature Boundary

S5 makes every user-facing call authenticated and owner-scoped. The API validates a JWT issued by a local OIDC provider, takes the owner from the token's `sub`, and exposes two reads the product did not have — the owner's list of processing requests and a single request by id — backed by owner-filtered queries in the Catalog. This repository adds the identity provider to the topology and proves all of it end to end.

Already fixed by `docs/foudation.md` and not re-discussed: OIDC/JWKS validation reading only `sub`, `iss`, `aud` and `exp`; `sub` is the owner; access is owner-only with no application roles; provisioning is administrative; the API never exposes storage keys; the API queries the Catalog filtered by `ownerUserId`.

---

## Implementation Decisions

### Listing and its fields

- Pagination is `page` + `pageSize`, returning `items`, `page`, `pageSize` and `total`. Default 20, maximum 100, newest first.
- A request exposes `processingRequestId`, `status`, `createdAt`, `updatedAt` and, only when `FAILED`, `failureReason` — the same safe sentence the notification uses.
- Never exposed: `sourceStorageKey`, `zipStorageKey`, `failureCode`, `attemptId`, `ownerUserId`.
- `GET /processing-requests/:id` returns one request in the same shape, to its owner only.

### Login for the demo

- Keycloak with a realm versioned in this repository and imported at start.
- The realm's client allows the password grant, so `node scripts/get-token.mjs <user>` gets a token from the terminal and the smoke can authenticate unattended. The grant is discouraged by OAuth 2.1; acceptable for a local development client, and documented as such.
- Two fixed demo users, `alice` and `bob`, with development passwords committed in the realm (the same rule as the PostgreSQL credentials: nothing reaches a deployed environment). No self-registration.

### Error semantics

- No token, a malformed or expired token, a wrong signature, or a wrong `iss` or `aud` → `401`, and the Catalog is not called.
- Another user's request → `404`, indistinguishable from one that does not exist.
- The identity provider unreachable with no cached signing key to validate the token → `503` ("authentication temporarily unavailable"). A token signed by an already-cached key keeps validating.
- Invalid pagination (`page` < 1, `pageSize` outside 1–100, non-numeric) → `400` naming the parameter and its allowed range; never silently clamped.

### Creation during S5

- `POST /processing-requests` keeps taking `sourceStorageKey` in the body until S6 replaces it with the upload flow.
- The owner always comes from the token's `sub`; an `ownerUserId` in the body is ignored, not rejected.

### Agent's Discretion

- Token access lifetime: Keycloak's default (5 minutes).
- The Catalog trusts the API on the internal network and does not validate JWTs itself; it requires an owner on every owner-scoped query, so it can never return an unscoped list.

### Declined / Undiscussed Gray Areas → Assumptions

None declined; all four areas were discussed.

---

## Specific References

- `docs/foudation.md` lines 27, 36, 108, 162–163 (ownership through `sub`, standard claims only, OIDC provider, status listing by user).
- The gap analysis S5 seed criteria (401 without calling the Catalog; owner from `sub`, body owner ignored; lists filtered by `sub`; another's request 404; filtering at the repository level).

---

## Deferred Ideas

- **`sourceStorageKey` is free-form until S6**, so an authenticated user could name another user's source object and receive its frames. S5 records this as a known risk; S6 closes it by generating keys under the owner (`sources/<sub>/…`) in the upload flow.
- Filtering the list by status — not requested; a separate capability.
- Browser login (authorization code + PKCE) — belongs with a front end, which is out of the project's scope.
