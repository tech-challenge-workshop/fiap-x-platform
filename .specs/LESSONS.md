# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Verify a container resource-limit edge case against the engine's actual behaviour before stating it in the spec
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: spec.md:158 fewer-cores edge case; docker rejects cpus > engine NCPU
- last seen: 2026-09-25T22:54:28Z

### L-002 - Wire every new check script into the build gate and CI in the same task that adds it
- signal: `ac_gap` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: RM-05 AC3; scripts/check-worker-sizing.mjs absent from the build gate and ci.yml
- last seen: 2026-09-25T22:54:28Z

### L-003 - Assert a security posture from outside at the end state, not only inside the bootstrap that sets it
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: M5b minio/bootstrap.sh:50
- last seen: 2026-09-25T22:54:28Z

### L-004 - Give every cleanup acceptance criterion an observable check that fails when the artefact remains
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: M10 scripts/smoke-local-integration.mjs:89
- last seen: 2026-09-25T22:54:28Z

### L-005 - Version the negative runs that prove a smoke assertion can fail instead of running them once by hand
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: M2 M3 M11 M12 scripts/smoke-local-integration.mjs
- last seen: 2026-09-25T22:54:28Z

### L-006 - Write each recorded deviation back into the spec and task text in the same change
- signal: `spec_deviation` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: minio/bootstrap.sh:16 SPEC_DEVIATION; RM-19 AC2 failureReason
- last seen: 2026-09-25T22:54:28Z

### L-007 - Give every gate script a self-test that feeds its comparisons failing and boundary values, not only the smoke
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: N2 N2b N2c scripts/check-worker-sizing.mjs:38,52
- last seen: 2026-09-25T23:25:58Z

### L-008 - Route every smoke assertion through a self-tested helper; an inline check in main is unguarded
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: N6 N9 scripts/smoke-local-integration.mjs:308,325
- last seen: 2026-09-25T23:25:58Z

### L-009 - Prove the smoke's main path calls each assertion, not only that each assertion rejects bad input
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: N3w N5 N7 N8 scripts/smoke-local-integration.mjs:294,314,319,330
- last seen: 2026-09-25T23:25:58Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
