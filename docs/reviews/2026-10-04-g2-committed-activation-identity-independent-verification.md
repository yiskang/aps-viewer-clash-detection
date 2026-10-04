# G2 committed activation identity — independent verification

- **Date:** 2026-10-04
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Reviewed branch / commit:** `main` @ `7fe9c99b4d1aaf49c3996514132ccd54f9ff1ab0`
- **Scope:** committed/pushed activation identity and readiness for a separately authorized G2 authorization-record preparation/issuance step
- **Verdict:** **committed activation identity fully verified; ready for a separate owner decision on authorization-record preparation/issuance only**
- **Live status:** no record issued, no attempt reserved or consumed, and live G2 remains unauthorized

## Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

#### L1 — pre-activation narrative remains in the governing plan and harness comments

The runtime state is unambiguous and correct, but some prose still describes the pre-activation state:

- the plan header/scope guard still says `LIVE_PATH_WIRED=false` and describes the activation as pending;
- several harness comments still say this revision is dormant or the flag is false;
- `G2_DUAL_COUNTER_GATE.finding` retains the historical `awaiting-independent-confirmation` label although `resolved=true`.

This does not change execution. The real constant is `true`, the deliberate pin expects `true`, the gate ordering is enforced by code, and the plan's record schema/runbook remain usable. Treat those lines as historical pre-activation narrative; current state authority is committed source plus this review and the handoff. Reconciliation is optional documentation cleanup and is not a record-preparation blocker.

## 1. Committed repository identity

Verified directly from Git and disk before writing this review:

- branch: `main`;
- `HEAD`, `main`, and `origin/main`: `7fe9c99b4d1aaf49c3996514132ccd54f9ff1ab0`;
- working tree: clean;
- no untracked authorization/activation artifact;
- no `test/acceptance/results/clashpanel-viewerbridge-g2-attempts/` directory;
- no G2 authorization marker under `docs/prompts/`;
- no real reservation, journal, consumed-attempt, Viewer-load, fixture-load, or live-G2 evidence artifact found.

The later review/handoff edits make the tree intentionally documentation-dirty; they do not alter this verified pre-review baseline.

## 2. Committed identities

Recomputed from the files at the clean committed checkout:

| Artifact | SHA-256 | Verdict |
|---|---|---|
| activated harness `test/acceptance/clashpanel-viewerbridge.acceptance.mjs` | `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4` | exact match to the independently reviewed pre-commit activation SHA |
| accepted procedure `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md` | `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75` | exact accepted SHA; unchanged by activation |

No working-tree overlay affected either computation.

## 3. Committed activation state and scope

Committed source establishes:

- `LIVE_PATH_WIRED=true` at harness line 119;
- `G2_DUAL_COUNTER_GATE.resolved=true` at harness line 3716;
- the real-state pin in `clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs` expects `true` in its title and both assertions.

Commit `7fe9c99` contains exactly the reviewed runtime/test activation edits:

1. harness activation literal `false -> true`;
2. one deliberate pin title plus its two assertions `false -> true`.

The plan-anchor edit changes `Activation-preparation tests` to `Required activation-preparation tests`; it has no runtime effect. The other five files are handoff/prompts/review records. No production, Core, Viewer Adapter, M4, Panel implementation, fixture, or unrelated test behavior changed.

## 4. Missing-authorization boundary

The committed call chain is fail-closed:

1. `parseLiveActivation()` requires the exact CLI flag, exact environment value, and record path.
2. `main()` checks the activation and resolved dual-counter gates.
3. `validateAuthorizationRecord()` and the startup scan run at W1.
4. only after W1 succeeds do hard runtime gates run, followed by attempts-directory establishment and `reserveAttempt()`.
5. `import('playwright')` is enclosed in the post-reservation path and is not reached before durable `AUTH_BOUND`.

With no real authorization record present, the activated-copy test reaches W1 and returns `record-not-found` while creating nothing. The verified path cannot reach runtime gates, attempts state, `AUTH_BOUND`, `ATTEMPT_CONSUMED`, Playwright import, browser/Viewer access, or fixture load.

Graph-backed structural tracing confirmed the `main -> validateAuthorizationRecord -> runtime gates -> establishAttemptsDirectory -> reserveAttempt -> runPostReservation` ordering. The index reported no coverage issue for the harness and relied-on tests; the current handoff was read directly because its graph metadata had changed.

## 5. Offline verification

Using the already-installed exact Node `/Users/kangea/.nvm/versions/node/v22.23.1/bin/node`, the focused non-live gate set passed:

- activation, authorization, runtime-gates, preflight, journal, CLI, gate, and live-path-isolation;
- **180/180 pass, 0 fail, 0 skipped/todo**;
- no retry;
- no real authorization, attempt, browser, Viewer, fixture, or live evidence created.

This supplements the pre-commit accepted verification; it is not live G2 evidence.

## 6. Runtime prerequisites

Committed hard gates still require:

- Node `v22.23.1`;
- `playwright` `1.62.1`;
- `playwright-core` `1.62.1`;
- `chromium-headless-shell` revision `1234`, version `151.0.7922.34`.

The packages and browser metadata match. Exact Node `v22.23.1` is installed. The current default shell resolves to **Node `v26.10.0`**, so the operator must explicitly select and verify `v22.23.1` before record issuance/live preparation. This is an operational prerequisite, not an activation-identity failure.

## 7. Authorization-record gate readiness

The repository is technically ready for a **separate owner authorization of authorization-record preparation/issuance only**, subject to using exact Node `v22.23.1` and rechecking the clean committed state before issuance.

The record must bind:

- `Baseline-HEAD: 7fe9c99b4d1aaf49c3996514132ccd54f9ff1ab0`;
- procedure SHA `d1ccfde2...e45a75` and harness SHA `471fae40...e77ac4`;
- Model-A URN SHA `db7efe5c237b10757c8e69fbb925facd9a1bf43c307a60702ae42fa2968dd10d`;
- Model-B URN SHA `806f99964bb937085874557ec2b03101a612db26031469a063446796d7ebb53d`;
- `Runtime: viewer=7.124.2 env=AutodeskProduction2 api=streamingV2`, a new unique authorization ID, and the exact single-attempt marker.

The issued record must remain untracked, be the sole non-superseded valid candidate under `docs/prompts/`, and match the path passed to the harness. No schema/evidence prerequisite remains unresolved before record preparation.

## 8. Remaining gates before live G2

1. Owner explicitly authorizes authorization-record preparation/issuance only.
2. The issued record is independently verified against HEAD, artifact/fixture hashes, schema, uniqueness, runtime envelope, and stale/superseded-record rules.
3. Owner separately authorizes exactly one live G2 execution.
4. The operator selects Node `v22.23.1` and the harness performs its final clean-tree/runtime/identity preflights.
5. One attempt is reserved, consumed, executed, and closed out under the accepted procedure; no retry is implied.

## Final disposition

- **Committed HEAD:** verified.
- **`main == origin/main`:** verified.
- **Pre-review tree cleanliness:** verified.
- **Committed activation identity:** fully verified.
- **Authorization-record gate:** ready for a separate owner decision; not authorized by this review.
- **Live G2:** remains unauthorized.

**Recommended next authorized action:** owner authorization for one bounded authorization-record preparation/issuance task only, using exact Node `v22.23.1` and the bindings above; then independently verify the issued record before any live-execution decision.
