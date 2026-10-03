# G2 real two-file flag flip — focused internal review

- **Date:** 2026-10-03
- **Baseline:** `main` = `origin/main` = `99029ff7be4ce4e2b502918a5ed975f73879f93e`; Node `v22.23.1` used for all runs.
- **Result:** 0 Critical / 0 High / 0 Medium / 1 Low (fixed within bounded amendment).

## Diff scope
- Implementation/test diff is exactly two files: harness `const LIVE_PATH_WIRED = false;` -> `true;` (line 119); the single `PIN (single, deliberate)` test in `live-path-isolation.test.mjs` (title + both assertions) -> `true`.
- Plus one documentation-only file (owner-authorized amendment): the plan paragraph lead restored to `**Required activation-preparation tests (implemented in \`7ae4147\`; …)**`.

## Finding
- **Low (fixed by amendment):** the committed docs checkpoint `99029ff` renamed that plan paragraph, breaking the pre-existing runtime-gates test `T-same-target: classification table…` (which locates the paragraph by prefix). It failed identically at `99029ff` without the flip (59/60), so it was independent of the activation. Restoring the prefix returns runtime-gates to 60/60. No test edited.

## Review points
- **Interlocks:** `G2_DUAL_COUNTER_GATE.resolved=true` unchanged; `main()` gate order unchanged: W0 -> LIVE_PATH_WIRED -> dual-counter gate -> W1 (`validateAuthorizationRecord`, startup scan) -> `checkG2HardRuntimeGates` -> W2a/W2b reservation. A missing/invalid record is refused at W1 before any fs write; covered by the activation/authorization suites (isolated copies).
- **Isolation:** CLI/activation suites use temp-root harness copies; no real record, attempts directory, Viewer, fixture or live run was created or entered (verified: attempts dir absent, no `G2-LIVE-EXECUTION:` line under `docs/prompts/`). The real harness was never executed.
- **Accidental live entry:** with the flag true, entry still requires `G2_LIVE_AUTHORIZED=YES`, `--execute-live-g2`, a valid sole record bound to HEAD + harness SHA; none exist. The activated harness SHA below differs from any value a record could bind, and no record exists.
- **Plan/procedure assumptions:** two-edit boundary, procedure SHA and verdict/attempt logic unchanged.

## Verification (Node v22.23.1)
- activation 11/11, authorization 26/26, preflight 7/7, journal 35/35, cli 11/11, gate 19/19, runtime-gates 60/60, live-path-isolation 11/11.
- Focused G2 (8 files): 903 total / 903 pass / 0 fail.
- `npm run test:offline`: 5,149 total / 5,148 pass / 0 fail / 0 cancelled / 0 skipped / 1 existing TODO.
- `git diff --check`: clean.
- Uncommitted activated harness SHA: `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4` (never bind to a record; recompute after any change/commit). Procedure SHA unchanged `d1ccfde2…5a75`.
