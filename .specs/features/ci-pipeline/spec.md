# Platform CI Pipeline Specification

## Problem Statement

`fiap-x-platform` owns the runtime topology and the documents the whole system is built from, but it has no code, no test runner, and no automated verification. A broken `compose.yaml` or a smoke script with a syntax error is discovered only when a developer tries to start the stack, which is the worst moment to find out.

Unlike the four services, this repository's value is that the pieces fit together. Its gate must verify composition, not unit behaviour.

## Goals

- [ ] Verify that the local topology is valid on every pull request.
- [ ] Keep job names stable so branch protection can require them as status checks.
- [ ] Make the cross-repository integration path verifiable in CI, not only on a developer machine.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| Deployment, registry publication, cluster provisioning | Belongs to S9a. |
| Kubernetes manifest validation | No manifests exist yet; S9a introduces them and extends this workflow. |
| Building or testing the four services | Each service repository owns its own gate. |
| Linting the Markdown documents for style | Prose style is a review concern, not a build failure. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Runner image | `ubuntu-latest` | Docker and Compose are preinstalled, and the topology targets Linux. | y |
| Triggers | Pull requests targeting `main`, and pushes to `main` | Matches the protected-branch workflow already in use. | y |
| Node version for the smoke script | 22 | Matches the services; the script uses `node:` built-ins only and has no dependencies. | y |
| Compose validation depth in P1 | Schema and rendering only, without sibling repositories present | `docker compose config` renders the file; whether it also requires each build context to exist is not relied upon. Build contexts are verified in P2, where the siblings are checked out. | y |
| Workspace layout for the integration job | All five repositories checked out as siblings **inside** `$GITHUB_WORKSPACE` | `actions/checkout` refuses a `path` outside the workspace, so the platform repository is checked out into its own subdirectory and the four services beside it, which makes `build: ../fiap-x-api` resolve as it does locally. | y |
| Credentials for cross-repository checkout | A token with read access to the four service repositories | Required only if the repositories are private; a public repository needs none. See the open item below. | n |

**Open questions:** one, recorded rather than silently assumed - **if the four service repositories are private, the P2 integration job needs a token with read access to them, configured as a repository or organization secret.** Creating an organization secret may require a permission level the team does not currently hold. P1 does not depend on this and can ship first. If the token is unavailable, P2 is deferred without blocking P1 or any other slice.

---

## User Stories

### P1: Topology validation on every pull request ⭐ MVP

**User Story**: As a maintainer, I want the local topology to be validated automatically so that a malformed `compose.yaml` or a broken script is caught in the pull request instead of when someone tries to start the stack.

**Why P1**: It is the whole verification value this repository can deliver on its own, it needs no credentials, and branch protection cannot require a check that does not exist.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN a pull request targets `main` THEN the workflow SHALL validate that `compose.yaml` parses and renders without error. <!-- event-driven -->
2. WHEN the workflow validates the topology THEN it SHALL assert that every service declares either a build context or an image. <!-- event-driven -->
3. WHEN the workflow checks the smoke script THEN it SHALL verify that `scripts/smoke-local-integration.mjs` parses under Node 22. <!-- event-driven -->
4. WHEN any validation step exits non-zero THEN the workflow SHALL fail the check run. <!-- event-driven -->
5. WHEN a commit is pushed to `main` THEN the workflow SHALL run the same validation. <!-- event-driven -->
6. The workflow SHALL expose a stable job name so branch protection can require it as a status check. <!-- ubiquitous -->
7. The P1 validation SHALL require no repository secret and SHALL NOT check out any other repository. <!-- ubiquitous -->

**Independent Test**: Introduce a YAML syntax error in `compose.yaml`, confirm the check fails, revert, and confirm it passes.

---

### P2: Cross-repository integration run

**User Story**: As a maintainer, I want CI to start the whole stack and run the smoke script so that a change breaking the integration between the four services is caught automatically.

**Why P2**: It is the strongest evidence the repository can produce, but it depends on cross-repository access that P1 deliberately avoids.

**Acceptance Criteria**:

1. WHEN the integration job runs THEN it SHALL check out this repository and the four service repositories as siblings inside the workspace. <!-- event-driven -->
2. WHEN all repositories are present THEN the workflow SHALL build and start the Compose topology. <!-- event-driven -->
3. WHILE the stack is running, the workflow SHALL run `scripts/smoke-local-integration.mjs` and SHALL fail the check run if it exits non-zero. <!-- state-driven -->
4. WHEN the integration job ends, whether it passed or failed, THEN the workflow SHALL tear the stack down. <!-- event-driven -->
5. IF the stack fails to reach a healthy state within the configured wait THEN the workflow SHALL fail and SHALL publish the container logs as a run artifact. <!-- unwanted-behavior -->
6. WHERE the cross-repository token is absent, the integration job SHALL be skipped without failing the check run for the pull request. <!-- optional-feature -->

**Independent Test**: Break the Catalog base URL in `compose.yaml` and confirm the smoke script fails the job with the container logs attached.

---

### P3: Documentation link integrity

**User Story**: As a maintainer, I want broken internal links in the documents to be reported so that the architecture documentation stays navigable as it is reorganised.

**Why P3**: Useful hygiene for a repository whose main product is documentation, but it blocks nothing.

**Acceptance Criteria**:

1. WHEN the workflow checks documentation THEN it SHALL report any relative link in `README.md` or `docs/` that does not resolve to a file in the repository. <!-- event-driven -->
2. The documentation check SHALL NOT fail the check run. <!-- ubiquitous -->

---

## Edge Cases

- IF `compose.yaml` references a build context that does not exist THEN the P2 integration job SHALL fail with that path named, rather than failing later as an opaque build error.
- IF a newer commit is pushed to the same pull request THEN the superseded run SHALL be cancelled so the reported status reflects the current head.
- IF the integration job exceeds 20 minutes THEN it SHALL time out and fail, and the stack SHALL still be torn down.
- WHEN `docs/FIAP X.pdf` is absent, as it is while the modelling board is redrawn, THEN the documentation check SHALL report the missing reference without failing the check run.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CI-01 | P1: Topology validation | Design | Pending |
| CI-02 | P1: Topology validation | Design | Pending |
| CI-03 | P1: Topology validation | Design | Pending |
| CI-04 | P1: Topology validation | Design | Pending |
| CI-05 | P1: Topology validation | Design | Pending |
| CI-06 | P1: Topology validation | Design | Pending |
| CI-07 | P1: Topology validation | Design | Pending |
| CI-08 | P2: Integration run | - | Pending |
| CI-09 | P2: Integration run | - | Pending |
| CI-10 | P2: Integration run | - | Pending |
| CI-11 | P2: Integration run | - | Pending |
| CI-12 | P2: Integration run | - | Pending |
| CI-13 | P2: Integration run | - | Pending |
| CI-14 | P3: Documentation links | - | Pending |
| CI-15 | P3: Documentation links | - | Pending |

**ID format:** `CI-[NUMBER]`

**Coverage:** 15 total, 0 mapped to tasks, 15 unmapped (mapping happens in Tasks).

---

## Success Criteria

- [ ] A pull request to `main` reports a passing check produced only by CI.
- [ ] A deliberately malformed `compose.yaml` fails that check.
- [ ] The check name is selectable in the branch protection settings as a required status check.
- [ ] The integration job proves the four services reach a completed processing request through the real broker, or is explicitly skipped for lack of credentials.
