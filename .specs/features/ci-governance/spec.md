# CI Governance Specification

## Problem Statement

Two gaps weaken the CI.

- **The platform's `integration` job has never run the stack in CI.** Without `SERVICES_READ_TOKEN` it prints a note and passes, so a green check proves nothing (V11). All five repositories are public, so no token is needed at all.
- **The `protect main` rulesets require too little.** The services require only `quality`, so a broken image can merge (V12). The platform requires only `topology`, so a broken README link or a broken stack can merge.

## Goals

- [ ] The `integration` job runs the real stack on every run and is red when anything in it fails
- [ ] No pull request can merge into `main` while any of its CI jobs is red

## Out of Scope

| Feature | Reason |
| --- | --- |
| Testing a service PR against the platform stack | Cross-repository orchestration, not requested (context.md) |
| Reviews or approvals in the rulesets | Not part of V12 |
| CD / deployment | S9a |

---

## Assumptions & Open Questions

Decisions of 2026-09-26 are in `context.md` beside this spec.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Token | The job no longer reads `SERVICES_READ_TOKEN`; it checks out the four public service repositories anonymously | Decided; the repositories are public | y |
| Which service revision the job uses | Each service repository's `main` | The platform validates itself against the services as merged | y |
| What the job runs | The build gate's stack steps from `platform-gate-hardening`: bring the stack up, the bootstrap scenarios, the database drift check, the smoke, the identity check, the force-recreate, the smoke and identity check again, and tear down | Spec C deferred running these in CI to this feature | y |
| Required checks | Services: `quality`, `image`. Platform: `topology`, `docs-links`, `integration` | Decided | y |
| How the rulesets change | Through the GitHub API. The desired required-check list for each repository is versioned in this repository, and a script compares it with the live ruleset | A settings change nobody can review or reapply is how V12 happened | y |
| Applying the rulesets | An externally visible change, so it runs only with an explicit go-ahead at Execute | The skill's blast-radius rule | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: The integration job always runs the stack ⭐ MVP

**User Story**: As a reviewer, I want the platform's `integration` check to mean the stack was built, exercised and found healthy, so that its green result is evidence.

**Why P1**: Today a green `integration` check means nothing ran (V11).

**Acceptance Criteria**:

1. WHEN the `integration` job runs THEN it SHALL check out the four service repositories without a token.
2. WHEN the job runs THEN it SHALL bring the stack up and run, in order:
   - the storage-bootstrap scenarios;
   - the database drift check;
   - the smoke and the identity check;
   - the force-recreate of `identity`, `storage-init` and `api`;
   - the smoke and the identity check again.
3. IF any of those steps fails THEN the job SHALL fail.
4. The workflow SHALL NOT contain a path on which the job passes without running the stack.
5. IF the job fails THEN it SHALL upload the containers' logs as an artifact.

**Independent Test**: Push a branch whose smoke is made to fail in one assertion, and see `integration` go red. On an unchanged branch, `integration` goes green and its log shows the smoke's step lines.

---

### P2: Every CI job is required to merge ⭐ MVP

**User Story**: As the project owner, I want every CI job required by `main`'s ruleset, so that no red job can be merged past.

**Why P2**: `image` in the services, and `docs-links` and `integration` in the platform, can be red on a merged PR today (V12).

**Acceptance Criteria**:

1. The `protect main` ruleset of each of `fiap-x-api`, `processing-catalog`, `processing-worker` and `notification-service` SHALL require `quality` and `image`.
2. The `protect main` ruleset of `fiap-x-platform` SHALL require `topology`, `docs-links` and `integration`.
3. The desired required checks for each repository SHALL be versioned in `fiap-x-platform`.
4. WHEN the ruleset check runs THEN it SHALL fail if any repository's live required checks differ from the versioned ones, naming the repository and the difference.
5. WHEN the ruleset check runs with `--self-test` THEN it SHALL reject a missing check, an extra check, and a different ruleset target, and accept an exact match, without calling GitHub.

**Independent Test**: Run the ruleset check against the live organisation: it passes. Remove `image` from one repository's versioned list and run it again: it fails naming that repository.

---

## Edge Cases

- IF a service's `main` is broken THEN the platform's `integration` SHALL be red, and platform PRs SHALL be blocked until the service is fixed. This is intended: the system is broken.
- WHEN a job is renamed THEN the versioned check list SHALL be updated in the same change, or the ruleset check SHALL fail.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CIG-01 | P1: Anonymous checkout, no skip path (V11) | Tasks | In Tasks |
| CIG-02 | P1: The stack steps run and fail the job (V11) | Tasks | In Tasks |
| CIG-03 | P2: Versioned required checks + live comparison (V12) | Tasks | In Tasks |
| CIG-04 | P2: Rulesets applied (V12) | Tasks | In Tasks |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 4 total, 4 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] `integration` runs the stack on the PR that delivers this feature, and is green
- [ ] The five rulesets require exactly the versioned checks, and the comparison script proves it

---

## Dependencies

Specs B, C and A merged: `integration` runs spec C's gate against their `main`.
