# G2 `SELENIUM_REMOTE_URL` redaction — targeted independent re-review

- **Date:** 2026-10-03
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Baseline:** `main` = `origin/main` = `87dac9d63feab7b13e9b2dba2d9e7cba20d266ea`
- **Scope:** only the bounded `SELENIUM_REMOTE_URL` redaction correction, its two permanent tests, and directly affected status evidence
- **Result:** **0 Critical / 0 High / 0 Medium / 0 Low** in this bounded scope
- **Verdict:** the prior plaintext-credential blocker is fully closed; the uncommitted activation-preparation checkpoint is ready for an owner-authorized commit with `LIVE_PATH_WIRED=false`

## Repository and authorization state

The expected baseline is present. The branch is `main`; `HEAD` and `origin/main` both resolve to `87dac9d63feab7b13e9b2dba2d9e7cba20d266ea`. The activation-preparation implementation, tests, support files, prompt, reviews, and handoff remain uncommitted. The procedure file is unchanged and hashes to `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.

The harness still declares `G2_DUAL_COUNTER_GATE.resolved=true` and `LIVE_PATH_WIRED=false`. Repository inspection after the requested offline tests found no G2 authorization record, real attempts directory, live-result/log evidence, or other newly created live artifact. The tests used isolated temp-root copies and fakes; no Viewer, fixture, Playwright browser, or live G2 path was invoked.

## Findings

### Critical

None.

### High

None.

### Medium

None in the bounded remediation. The two pre-existing non-blocking Medium dispositions remain unchanged: the controlled-local-environment gate-to-import/launch TOCTOU residual, and the scratch-copy full flag-flip simulation required during the separately authorized activation change.

### Low

None introduced by the remediation. The prior activation-preparation Lows remain dispositioned and outside this bounded fix.

## Redaction-blocker verification

The correction redacts at the first retained representation. `resolveG2RuntimeEnvelope` reads the environment value only into a local variable. Its returned `detected.env.SELENIUM_REMOTE_URL` is:

- `null` when unset;
- `""` when explicitly empty; or
- the fixed string `(set; value withheld)` for every non-empty value.

The refusal check independently tests only presence/non-emptiness and emits the fixed message `SELENIUM_REMOTE_URL is set; remote-browser environments are not permitted`. It neither parses nor interpolates the URL. The raw value is not stored in `detected`, `failures`, or any returned object, so downstream formatting cannot replace the marker with the original value.

The prior blocker is therefore **closed**: a non-empty value still fails closed, while its username, password, query token, API key, fragment, hostname, path, and full raw form have no retained production path.

## Leak-path audit

| Surface | Independent result |
| --- | --- |
| Detected snapshot / resolver return | Safe marker only; raw input remains a local value and is absent from the returned graph. |
| stderr/O1 | `formatG2RuntimeGateReport` serializes the marker and constant failure message only. |
| `G2RefusalError` message, stack, detail, serialization, inspection | The top-level message is the generic hard-gate refusal. `detail.failures` contains the constant message and `detail.detected` contains the marker. No raw value is reachable. |
| Main event log, summaries, journals, snapshots | The gate refuses before W2a/W2b, `AUTH_BOUND`, attempt state, browser import, and post-reservation state construction. No such durable surface is created. |
| Generic environment dumps / assertions | Repository-wide search found no generic environment dump in the harness. Permanent tests inspect captured output and serialized errors as booleans; their named sentinels are fixed test data, not operator environment values. |

The only other `env` values printed by this runtime-gate report belong to different accepted sources. The correction did not broaden or alter their policy.

## Refusal semantics

Behavior is unchanged apart from redaction:

1. Any non-empty value, including whitespace and `"0"`, produces `runtime-browser-path-unsupported` at step `selenium-remote`.
2. Empty and absent values retain their prior accepted behavior.
3. `main()` invokes the gate after read-only W1 validation/startup inspection but before the first W2a write, binding construction, reservation, `AUTH_BOUND`, `ATTEMPT_CONSUMED`, `import('playwright')`, or browser launch.
4. The isolated activated-copy test observes no filesystem write, D1/D2, browser-package access, serve action, or event-log entry; the record remains unspent.

`LIVE_PATH_WIRED=false` additionally keeps the real repository harness dormant.

## Sentinel-test assessment

The permanent test set is strong enough without relying on the manual mutation exercise.

- It uses three distinct fixed inputs: user/password URL; token + API-key query and fragment; and a distinctive sentinel.
- The direct-gate test checks full values and identifying substrings against stderr/O1, error message, stack, serialized error, `detail`, and the resolver result. It also requires the exact safe marker and exact constant failure message.
- The isolated activated-copy `main()` test proves W1 is reached first, then the runtime gate refuses before any durable write or browser/event activity; it checks captured stderr, error/detail/stack, and the injected operation log for the same sentinels.
- Existing no-write helpers and explicit D1/D2 absence checks establish pre-reservation behavior. Empty/unset coverage remains present.

The reported temporary mutation is useful supporting evidence but is not required for the verdict; the committed-form tests directly fail if either retained raw-value path is restored.

## Independent verification

| Gate | Result |
| --- | --- |
| Focused G2 | **903 tests / 903 pass / 0 fail** |
| Runtime gates | **60 / 60 pass** |
| Activation / preflight / CLI / live-path isolation | **11 / 7 / 11 / 11 pass** |
| Offline aggregate | **5,149 total / 5,148 pass / 0 fail / 1 existing TODO** |
| `git diff --check` | clean |
| Post-test repository/live state | status unchanged apart from this review/handoff; no authorization, attempts, Viewer/fixture, or live evidence artifact |

The aggregate TODO is the pre-existing containment-query known gap, not a failure and not related to G2.

## Hash and scope verification

- Independently recomputed uncommitted harness SHA-256: `d34d470cf51f5f74c5cf3cfa8380944822af2ce6c2e07d27f4117ea71fd19c39`.
- Independently recomputed procedure SHA-256: `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`.
- The procedure has no diff. The current correction is confined to the harness's safe marker/constant message, two runtime-gate tests, and status documentation. Comparison with the immediately prior independent review's recorded source behavior found no adjacent semantic change.
- Verdict/attempt semantics, `T-same-target`, other runtime refusals, executable-SHA disposition, production, Core, Viewer Adapter, M4, Panel, OQ-1, and host integration are unchanged.

The harness digest is an uncommitted-tree identity. It must be checked again after any edit and after the eventual checkpoint commit. No authorization record may bind it now.

## Readiness and authorization

The activation-preparation checkpoint is **ready for an owner-authorized commit**. That commit must preserve `LIVE_PATH_WIRED=false` and must not issue an authorization record or create attempt state.

The following remain separate and unauthorized:

- flipping `LIVE_PATH_WIRED` (including its required scratch-copy flip simulation and independent review);
- preparing/issuing the single-use authorization record with final committed identities;
- reserving or consuming an attempt, launching Viewer/fixtures, or running live G2.

## Recommended next action

Owner may authorize one activation-preparation checkpoint commit containing the reviewed dormant harness/tests/support and review/handoff records, with no push and no live activation unless separately authorized. After that commit, independently verify the clean tree and recompute the committed harness SHA before considering the separate activation gate.
