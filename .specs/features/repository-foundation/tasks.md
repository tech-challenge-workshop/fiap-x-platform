# FIAP X Repository Foundation Tasks

## Execution Protocol

Implement these tasks with the `tlc-spec-driven` skill and its Execute flow. The workspace itself is not a Git repository, so the planning artifacts remain uncommitted in the workspace. Each task's completed repository receives its own required atomic commit.

**Design**: `.specs/features/repository-foundation/design.md`
**Status**: Done

## Test Coverage Matrix

> Generated from the workspace. Guidelines found: `AGENTS.md` and `.agents/skills/tlc-spec-driven/`; no executable application or test framework exists, so structural shell checks are the appropriate foundation gate.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Repository metadata | structural | Every repository has the required tracked files, clean `main` branch, and one initial Conventional Commit. | repository root and `docs/` | `git` and `test` shell checks |
| Application code | none | No application implementation is in scope. | - | build gate only |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After initializing one repository | `git -C <repo> status --porcelain && git -C <repo> branch --show-current && git -C <repo> log -1 --pretty=%s` |
| Full | After all four repositories exist | `for repo in fiap-x-api processing-catalog processing-worker notification-service; do test -d "$repo/.git" && test -f "$repo/README.md" && test -f "$repo/.gitignore" && test -f "$repo/docs/service-boundary.md" && test "$(git -C "$repo" branch --show-current)" = main && test -z "$(git -C "$repo" status --porcelain)" && test "$(git -C "$repo" rev-list --count HEAD)" -ge 1 && git -C "$repo" log -1 --format=%s "$(git -C "$repo" rev-list --max-parents=0 HEAD)" | rg -q '^chore\\('; done; rg -q 'HTTP edge' fiap-x-api/docs/service-boundary.md && rg -q 'ProcessingRequest' processing-catalog/docs/service-boundary.md && rg -q 'FFprobe' processing-worker/docs/service-boundary.md && rg -q 'terminal processing events' notification-service/docs/service-boundary.md && for repo in fiap-x-api processing-catalog processing-worker notification-service; do rg -q 'node_modules/' "$repo/.gitignore" && rg -q 'dist/' "$repo/.gitignore" && rg -q 'coverage/' "$repo/.gitignore" && rg -q '^\\.env$' "$repo/.gitignore" && rg -q '\\.DS_Store' "$repo/.gitignore"; done` |
| Build | Before completion | `for repo in fiap-x-api processing-catalog processing-worker notification-service; do find "$repo/.git" -type f -name '._*' -delete && git -C "$repo" fsck --no-reflogs --no-dangling && git -C "$repo" diff --check HEAD; done && for repo in fiap-x-api processing-catalog processing-worker notification-service; do test -d "$repo/.git" && test -f "$repo/README.md" && test -f "$repo/.gitignore" && test -f "$repo/docs/service-boundary.md" && test "$(git -C "$repo" branch --show-current)" = main && test -z "$(git -C "$repo" status --porcelain)" && test "$(git -C "$repo" rev-list --count HEAD)" -ge 1 && git -C "$repo" log -1 --format=%s "$(git -C "$repo" rev-list --max-parents=0 HEAD)" | rg -q '^chore\\('; done; rg -q 'HTTP edge' fiap-x-api/docs/service-boundary.md && rg -q 'ProcessingRequest' processing-catalog/docs/service-boundary.md && rg -q 'FFprobe' processing-worker/docs/service-boundary.md && rg -q 'terminal processing events' notification-service/docs/service-boundary.md` |

## Execution Plan

### Phase 1: Create service repositories

```
T1 → T2 → T3 → T4 → T5
```

## Task Breakdown

### T1: Create FIAP X API repository

**What**: Initialize the API repository on `main` with boundary documentation, ignore rules, and one initial commit.
**Where**: `fiap-x-api/`
**Depends on**: None
**Reuses**: `docs/foudation.md`
**Requirement**: REPO-01, REPO-02, REPO-03, REPO-04, REPO-05

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] The repository documents HTTP edge and owner authorization responsibility.
- [ ] The repository documents its Cognito, S3, and Processing Catalog integrations and exclusions.
- [ ] The quick gate passes.

**Tests**: structural
**Gate**: quick
**Status**: Complete - `a487933`

### T2: Create Processing Catalog repository

**What**: Initialize the catalog repository on `main` with boundary documentation, ignore rules, and one initial commit.
**Where**: `processing-catalog/`
**Depends on**: T1
**Reuses**: `docs/foudation.md`
**Requirement**: REPO-01, REPO-02, REPO-03, REPO-04, REPO-05

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] The repository documents Processing Request, lifecycle, and outbox ownership.
- [ ] The repository documents PostgreSQL and RabbitMQ integrations and exclusions.
- [ ] The quick gate passes.

**Tests**: structural
**Gate**: quick
**Status**: Complete - `770a2ee`

### T3: Create Processing Worker repository

**What**: Initialize the worker repository on `main` with boundary documentation, ignore rules, and one initial commit.
**Where**: `processing-worker/`
**Depends on**: T2
**Reuses**: `docs/foudation.md`
**Requirement**: REPO-01, REPO-02, REPO-03, REPO-04, REPO-05

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] The repository documents FFprobe/FFmpeg and S3 media-processing responsibility.
- [ ] The repository documents RabbitMQ result events and exclusions.
- [ ] The quick gate passes.

**Tests**: structural
**Gate**: quick
**Status**: Complete - `aedc073`

### T4: Create Notification Service repository

**What**: Initialize the notification repository on `main` with boundary documentation, ignore rules, and one initial commit.
**Where**: `notification-service/`
**Depends on**: T3
**Reuses**: `docs/foudation.md`
**Requirement**: REPO-01, REPO-02, REPO-03, REPO-04, REPO-05

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] The repository documents terminal-event email-delivery responsibility.
- [ ] The repository documents RabbitMQ and SES integrations and exclusions.
- [ ] The full and build gates pass.

**Tests**: structural
**Gate**: full
**Status**: Complete - `0eb6ed1`

### T5: Align API boundary documentation with the structural gate

**What**: State the FIAP X API HTTP-edge ownership in its service-boundary document so the repository's documented boundary satisfies the approved structural gate.
**Where**: `fiap-x-api/docs/service-boundary.md`
**Depends on**: T4
**Reuses**: `fiap-x-api/README.md` and `docs/foudation.md`
**Requirement**: REPO-03

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] The service-boundary document explicitly states that FIAP X API owns the HTTP edge.
- [ ] The full and build gates pass.

**Tests**: structural
**Gate**: build
**Status**: Complete - `fb07d3f`

## Phase Execution Map

```
Phase 1: T1 → T2 → T3 → T4 → T5
```

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | One repository foundation | ✅ Granular |
| T2 | One repository foundation | ✅ Granular |
| T3 | One repository foundation | ✅ Granular |
| T4 | One repository foundation | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | None | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Repository metadata | structural | structural | ✅ OK |
| T2 | Repository metadata | structural | structural | ✅ OK |
| T3 | Repository metadata | structural | structural | ✅ OK |
| T4 | Repository metadata | structural | structural | ✅ OK |
| T5 | Repository metadata | structural | structural | ✅ OK |
