# Gate Guards — Context

Decisions captured on 2026-09-26, before Specify.

This feature is **spec E**, the first of three that resolve the Verifiers' leftovers from specs A–D. The gap analysis tracks those leftovers as V40–V52 under "Validar depois". The plan runs E → F → G:

- **E** `gate-guards`: this repository.
- **F** `service-robustness`: Catalog, Notification, Worker.
- **G** `api-test-hardening`: API.

## Scope decided

| Item | Decision |
| --- | --- |
| V50 (Major): the CI guard accepts `if: failure()` anywhere in `integration` | In |
| V51 (Minor): shell masking in `run: \|`, no guard for `docs-links`, untested `exclude` rule, an apply transform tested only with growing lists, the apply self-test missing from CI, contexts without `integration_id` | In, including `integration_id` |
| V42 (Medium): expiry rules lack `disabled`/`narrowed` scenarios | In |
| V43 (Low): `check-identity` can quote a token in a failure | In |
| V44 (Low/precision): observations echo their query id; start order read from config; `failureReason` not read through the API | In, **except the start order** |
| V52 (Cosmetic): "without a token" wording | In |

## Decisions (user, 2026-09-26)

| Question | Answer |
| --- | --- |
| V51: pin the required checks to the GitHub Actions app (`integration_id`) | **Do it.** The app id is `15368`, confirmed on the check runs of `fiap-x-platform` and `fiap-x-api`. Applying it to the rulesets is a GitHub change and needs an explicit go-ahead at Execute, as in spec D |
| V44: observe the identity-before-API start order instead of reading `depends_on` | **Accept reading the config, and document it.** Observing the real order needs container start timestamps, and the rule is declarative |

## Agent's discretion

- How the `docs-links` guard is built: extend the workflow check, or move the script into `scripts/` with its own `--self-test`.
- The exact redaction format for a JWT in a failure message.
