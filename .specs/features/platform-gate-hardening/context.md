# Platform Gate Hardening — Context

Decisions captured on 2026-09-26, before Specify. This feature is **spec C** of the plan that resolves the gap analysis's "Validar depois" section. The plan runs B → C → A → D; B (`api-hardening`) is merged.

## Scope decided

| Item | Decision |
| --- | --- |
| Which items | **Phase 1, storage and database:** V34, V36, V20, V10, and the database-drift part of V37. **Phase 2, smoke rigour:** V35, V14, V15, V16, V17, V18, V24, V25, the rest of V37, and the processing-failure part of V8 |
| Spec B on the real stack | Included. Spec B's Out of Scope moved "smoke steps proving these fixes" here: invalid parts → `400`, and a second key on one upload → `200` |
| Spec B's new migration | `1789957000000-UniqueOwnerSource` enters `db/create-database.sql` here |
| Out | V11 and V12 (spec D, `ci-governance`), and V38–V41 (service code; not this repository) |

## Gray areas resolved

| Question | Answer |
| --- | --- |
| How to prove a request that fails **in processing** (V8) | **A corrupted fixture**: a video that FFprobe accepts and FFmpeg fails on, generated and committed in `fixtures/`. The Design phase spikes it against the real Worker image; if no such file can be found, the item goes back to open instead of switching approach silently |
| Identity checks now proven only by hand (V25) | **Include** `scripts/check-identity.mjs` with `--self-test`, run in the build gate, alongside V24's `sub` comparison across a recreate |

## Agent's discretion

- Where the bucket-scenario runner lives, and its name.
- How the self-test proves `main()` runs every step (V14) and that each script exits non-zero on failure (V15), as long as it is a gate command (L-016).
- The exact identity properties are taken from the S5 Verifier's report (`auth-owner-scope/validation.md`, K2, K4, K5, K6, T1, T2).

## Deferred

- Running the stack-dependent checks in CI. The `integration` job never runs today (V11); spec D decides it.
