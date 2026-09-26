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

### L-010 - Make each gate script's self-test run the script as a child process with a forced failure and require a non-zero exit code
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: R7e/R8a/R8b; scripts/smoke-local-integration.mjs:658-661
- last seen: 2026-09-26T00:11:20Z

### L-011 - Route every smoke observation through an injectable IO seam so the self-test proves it queries the right id
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: R1b; scripts/smoke-local-integration.mjs:426
- last seen: 2026-09-26T00:11:20Z

### L-012 - Give every exact-match assertion a near-miss bad case that shares the expected value's prefix
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: R5a/R5b/R5c; scripts/smoke-local-integration.mjs:183
- last seen: 2026-09-26T00:11:20Z

### L-013 - Word an idempotence criterion so that a non-deterministic key would violate it
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: spec.md:94 (R8c)
- last seen: 2026-09-26T00:11:20Z

### L-014 - Put every verification step the coverage matrix requires into the documented build gate
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · harmful: 0
- features: real-media-processing
- evidence: tasks.md:39 vs tasks.md:25 (M15)
- last seen: 2026-09-26T00:11:20Z

### L-015 - A gate step meant to prove state survives a restart must force-recreate the container, since a no-op compose up restarts nothing
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: auth-owner-scope
- evidence: validation.md K1 (identity/fiapx-realm.json:35; tasks.md:182 second up)
- last seen: 2026-09-26T04:47:15Z

### L-016 - Every check the test matrix assigns to a gate must appear as a command in that gate, not only as a one-off manual probe
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: auth-owner-scope
- evidence: validation.md K2 K4 K5 K6 T1-T3 (tasks.md:168-169 vs :182)
- last seen: 2026-09-26T04:47:15Z

### L-017 - Name the exact restart operation (restart, force-recreate or down then up) whenever a spec requires state to survive a restart
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · harmful: 0
- features: auth-owner-scope
- evidence: spec.md Edge Cases (restart); validation.md spec-precision note 2
- last seen: 2026-09-26T04:47:15Z

### L-018 - Scenario harnesses used to prove a task must be versioned and run by the gate, or later regressions pass green.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `gate` · harmful: 0
- features: upload-download
- evidence: storage/bootstrap.sh:73 (gate)
- last seen: 2026-09-26T06:41:54Z

### L-019 - When the smoke switches to a new read path, re-assert the link to the specific record the old path proved, not just the shape of the result.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `smoke` · harmful: 0
- features: upload-download
- evidence: scripts/smoke-local-integration.mjs:507 (smoke)
- last seen: 2026-09-26T06:41:54Z

### L-020 - When scenarios enumerate the variations of one owned rule, apply the same variations to every owned rule, or the other predicates go unguarded.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `storage` · harmful: 0
- features: platform-gate-hardening
- evidence: storage/bootstrap.sh:49 (storage)
- last seen: 2026-09-26T17:47:51Z

### L-021 - A check's failure message that quotes observed output must redact secrets the output may contain.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `gate` · harmful: 0
- features: platform-gate-hardening
- evidence: scripts/check-identity.mjs:94 (gate)
- last seen: 2026-09-26T17:47:51Z

### L-022 - An observation that echoes its query argument proves wiring, not the query; read the id from the result when it carries one.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `smoke` · harmful: 0
- features: platform-gate-hardening
- evidence: scripts/smoke-local-integration.mjs:170 (smoke)
- last seen: 2026-09-26T17:47:51Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
