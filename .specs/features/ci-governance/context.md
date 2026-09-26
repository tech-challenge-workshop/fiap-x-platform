# CI Governance — Context

Decisions captured on 2026-09-26, before Specify. This feature is **spec D**, the last spec in the plan that resolves the gap analysis's "Validar depois". The plan ran B, then C, then A (all merged), and now D.

## Scope decided

| Item | Decision |
| --- | --- |
| V11: the platform's `integration` job skips the stack when `SERVICES_READ_TOKEN` is absent, and it has never run | All five repositories are **public**, so the job checks the services out without a token. It **always runs** the stack and fails on any failed step, so the "cannot run" case no longer exists. Spec C deferred "running stack-dependent checks in CI" to this feature, so the job runs the build gate's stack steps |
| V12: `image` is not a required check | The `protect main` rulesets require `quality` and `image` in the four service repositories, and `topology`, `docs-links` and `integration` in the platform |
| The gap analysis's "Divergências neste documento" | Fixed in the artifact as part of this feature. It is not code and has no requirement ID |

## Gray areas resolved

| Question | Answer |
| --- | --- |
| V11, now that the repositories are public | **Always run, with no token.** This replaces the earlier decision to fail when the job cannot run, which assumed a token was required |
| V12 scope | **`image` in the services, plus every platform job** |

## Agent's discretion

- Which of the build gate's steps the `integration` job runs, and in what order. The only limit is the job's timeout.
- How the rulesets are changed: `gh api` with the ruleset id, recorded in a versioned file so the change can be reviewed and reapplied.

## Deferred

- Running the platform stack against a service PR's own branch, rather than each service's `main`. That is cross-repository PR orchestration, and it is not requested.
