# Independent implementation review — G1 SVF2 F1–F8 verification harness

**Date:** 2026-09-28  
**Reviewed branch:** `feature/g1-svf2-f1-f8-harness`  
**Reviewed HEAD:** `67b3fdf82bebbe216ce9585dea8a35041dcdb74b`  
**Baseline:** local `main` and merge base `038326ceec06ff789260f5fa2374659b08f8d240`  
**Scope:** completed harness implementation and tests through the bounded completion pass; no live F1–F8 execution

## Verdict

**The harness implementation is not yet accepted for live F1–F8 authorization.**

The activation interlock, Phase 0 evidence path, import map, fail-closed verdict computation, Viewer 7.124.2 accessor corrections, and six browser-realm control bridges are substantially implemented. Three High findings must be corrected before the one-shot live gate is safe and diagnostically valid:

1. an ordinary bridged-control exception does not taint the session and later phases can reuse it;
2. normal Phase 11 page/context/browser closes are unbounded and can prevent cleanup completion and durable evidence;
3. `wrong-owner` and `hidden-fragment` perturb hard-coded fragment IDs without proving those IDs belong to the authoritative F1/F2 population.

No Critical finding was found. These findings do not create a false PASS in the reviewed offline paths: the first forces `FAIL`, the second can prevent a verdict from being produced, and the third makes a healthy live fixture capable of failing a mandatory sensitivity control. They nevertheless block live execution authorization.

## Verified repository and scope state

- Actual branch/HEAD were independently read from Git: `feature/g1-svf2-f1-f8-harness` at `67b3fdf82bebbe216ce9585dea8a35041dcdb74b`.
- The local `main` baseline and merge base are both `038326ceec06ff789260f5fa2374659b08f8d240`; `origin/main` is `cb2a17d` at review time.
- The implementation range contains the original eight stages, their fix waves, Tasks 9–13, Task 14, and the completion-pass documentation commit. The implementation changes are confined to the G1 acceptance harness/tests and documentation. No Panel, Viewer Adapter, Core, M4, OQ-1, host-integration, G2/G3, or H1/H2 production work appears in the range.
- No retained live-result file exists at `test/acceptance/results/g1-svf2-f1-f8-verification-result.json`. The only real-browser action independently run during this review was the already-authorized local synthetic import-map acceptance; it used no APS credentials or model.

## Findings

### Critical

None.

### High

#### H1 — An ordinary bridged-control exception does not taint or stop the shared live session

**Evidence:** `test/acceptance/g1-svf2-f1-f8-verification.mjs:7497-7520`; the contrary behavior is explicitly asserted by `test/acceptance/g1-svf2-f1-f8-verification.controlbridge.test.mjs:680-700`.

`runControlSafely` sets `sessionTainted` for the outer watchdog and for settled `TIMED_OUT`, `RESTORE_FAILED`, or `restored === false` results. Its generic catch instead records a fatal error and returns `NOT_EXECUTABLE` without tainting. A rejection from the page bridge can occur after the browser control acquired a lease, patched Viewer state, or created a scratch session. Because the caller cannot prove that no mutation occurred, allowing F7/F8/F6 to continue reuses a potentially perturbed session.

The final verdict remains fail-closed because `fatalErrorObserved` forces `FAIL`; the defect is session-isolation and evidence-validity failure, not a direct false-PASS path.

**Minimum correction:** once a bridged control invocation has begun, treat every unexpected rejection as session-tainting unless the implementation can mechanically prove it occurred before any browser-realm mutation. Short-circuit all later checks/controls and proceed directly to bounded cleanup. Replace the test that requires `sessionTainted === false` with assertions that later phases do not execute.

**Disposition:** blocking before live F1–F8.

#### H2 — Normal Phase 11 browser teardown has no timeout

**Evidence:** `test/acceptance/g1-svf2-f1-f8-verification.mjs:1616-1629` directly awaits `page.close()`, `context.close()`, and `browser.close()` through the generic cleanup step. The bounded `closeAllBestEffort` at `8444-8494` is used only by the Phase 0 failure path.

If a renderer or browser process wedges, the normal `runCleanup` path can await one close forever. Later cleanup steps, viewer-integrity finalization, `computeOverall`, and the atomic evidence write then never occur. That contradicts the harness's one-shot evidence durability and the requirement that cleanup failure cannot prevent later cleanup or mask the primary result.

**Minimum correction:** apply a bounded, independently-attempted close to page, context, and browser in the normal Phase 11 path, retaining each timeout/failure in `cleanupFailures` and continuing to later closes. An unresolved close must remain PASS-blocking.

**Disposition:** blocking before live F1–F8.

#### H3 — Two mandatory controls assume fragment IDs `0` and `1` without proving eligibility

**Evidence:** `wrongOwnerControlInPage` patches only `fragId === 0` at `test/acceptance/g1-svf2-f1-f8-verification.mjs:3866`; `hiddenFragmentControlInPage` removes only `fragId === 1` at `4000`. The retained initializer/fixture diagnostic establishes SVF2 classification but does not establish that either ID belongs to the loaded, tree-reachable, attributable F1/F2 population.

On a valid model whose fragment IDs do not include `0` or `1`, or where the chosen ID is outside the relevant observable class, the mutation is never exercised. The mandatory control then returns `NOT_DETECTED`, forcing an overall `FAIL` for the harness rather than detecting the intended defect. The controls therefore have real oracles once perturbed, but their target-selection precondition is not established from live evidence.

**Minimum correction:** deterministically select control targets from the retained authoritative F1/F2 population produced by the primary observations and pass those IDs into the browser controls. If no eligible target exists, return a fail-closed `NOT_EXECUTABLE` with the missing precondition recorded. Add cases with non-zero/non-one fragment IDs.

**Disposition:** blocking before live F1–F8.

### Medium

None.

### Low

#### L1 — Combined bounds-control detection/restoration failure is mislabeled

The disclosed `bounds-beyond-tolerance` edge case can report `NOT_EXECUTABLE` when perturbation representation and restoration both fail. The active lease is still found by Phase 11 and prevents PASS, so this is diagnostic classification hardening rather than a live authorization blocker.

#### L2 — Phase 0 handler lacks a final outer guard

The current `handlePhase0Failure` implementation catches its known capture, close, and evidence-write failures and preserves the primary error. The caller nevertheless awaits it without a last-resort `try`, so an unforeseen handler defect could replace the primary Phase 0 error. Add a final guard when convenient; current tested paths are safe.

#### L3 — Abandoned scratch state is not explicitly reclaimed

A lease-lost continuation may leave a scratch session in page memory. The session is tainted and the page realm is later destroyed, so it is not a live resource or false-PASS path. Explicit accounting/removal would improve cleanup evidence.

#### L4 — Six superseded Node-side control functions remain

The old Node-side controls are not reachable from `main()` or `buildRealControls` and still contain stale bare-property conventions. They are cosmetic/dead-code cleanup, but leaving two implementations raises future maintenance risk.

## Required behavior verification

### Activation interlock

`main()` checks `parseLiveActivation` before timestamping, file/network activity, the dynamic Playwright import, or browser launch. Authorization requires both the exact CLI flag `--execute-live-f1-f8` and exact environment value `G1_F1_F8_LIVE_AUTHORIZED=YES`. The only direct executable entry invokes `main()`, and repository search found no alternate real-dependency caller that bypasses this guard. `runHarness` remains dependency-injected for offline tests and cannot construct Chromium by itself.

**Result:** verified fail-closed; no bypass found.

### Import map and Phase 0

`BARE_PAGE_HTML` places the exact three-entry import map in `<head>` before the pinned Viewer script and before any served module loading. The local synthetic Chromium acceptance passed both positive resolution and the negative stripped-map control.

The Phase 0 try covers integrity construction, Playwright import, launch/context/page creation, route/listener setup, navigation, Viewer readiness, and module installation. Failure evidence is bounded/redacted and written atomically; evidence-write failure is attached to, rather than substituted for, the primary error. Phase 0 cleanup uses independently bounded closes. L2 is the only remaining defense-in-depth issue in this path.

**Result:** accepted.

### Viewer 7.124.2 API and realm validity

The pinned public `viewer3D.js` was independently retrieved and decoded; its SHA-256 is `12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`, matching `EXPECTED_VIEWER_SHA256`.

The bundle confirms the implementation-relevant surface: `Model.getFragmentList()`, synchronous/callback-capable `Model.getObjectTree()`, deprecated `getInstanceTree()` fallback, `FragmentList.getCount()`/`getDbIds()`, and tree `enumNodeFragments()`/`getNodeBox()`. The final fix wave correctly replaced nonexistent bare `model.fragList`/`model.tree` access in the three affected browser controls. The bootstrap registry installs the functions in one page-realm lexical closure and Node exchanges serialized arguments/results only.

**Result:** API/realm correction accepted, subject to H3 target selection.

### Mandatory controls and verdict model

All six required browser controls are wired through stable in-page keys and return the reviewed `ControlResult` shape. Their detection mechanisms use the actual F1/F2/F7 observers; restoration is descriptor-based for shared state and scratch sessions isolate the observation reruns. Any `NOT_DETECTED`, `RESTORE_FAILED`, `TIMED_OUT`, or `NOT_EXECUTABLE` mandatory control is PASS-blocking. Fatal/runtime errors, cleanup ownership failure, invalid Viewer identity, and cleanup failures have precedence in `computeOverall`; PASS requires all checks and controls to pass.

**Result:** verdict logic is fail-closed. H1 and H3 prevent acceptance of the control execution lifecycle for a live run.

### Cleanup

Browser-realm cleanup attempts listeners, wiring, patches, Viewer unload, registry unregister, world eviction/disposal, and postconditions independently. Actual repository signatures match the calls: `ModelRegistry.unregister(model)`, registry `bindingFor(key)`, and the CollisionWorld eviction/liveness/disposal APIs. Cleanup failures are retained and prevent PASS once cleanup completes.

**Result:** resource coverage is adequate, but H2 makes completion itself unbounded.

## Disclosed residual adjudication

| Residual | Classification | Live-gate disposition |
|---|---|---|
| Internal control exception does not taint session | High correctness/evidence issue | **Blocking**; H1 |
| Bounds double failure mislabeled | Low diagnostic hardening | Non-blocking |
| Browser-close cleanup has no timeout | High durability/resource-safety issue | **Blocking**; H2 |
| Six dead Node-side controls | Low dead-code cleanup | Cosmetic/non-blocking |
| Phase 0 evidence handler lacks final outer `try` | Low defense-in-depth | Non-blocking |
| Possible abandoned scratch session | Low cleanup-accounting hardening | Non-blocking |

H3 is an additional independent finding not listed in the completion-pass residuals.

## Test and evidence verification

- `npm run test:offline`, rerun from the reviewed branch with the required local bind permission: **4125 total / 4124 pass / 0 fail / 1 existing todo**. The todo is the pre-existing M4 browser-probe gap.
- The local synthetic Chromium import-map acceptance passed with no retry and no APS model: both served modules resolved with the import map; the stripped-map negative control failed resolution as required.
- Browser-local/synthetic suites cover interlock ordering, Phase 0 evidence, bridge serialization, control result mapping, staged six-control execution, taint outcomes, schema, and final integration. The generic-exception test currently locks in H1's unsafe continuation behavior; the hard-coded fixture IDs hide H3.
- No live APS F1–F8 result/evidence artifact exists and no live run was performed during this review.

## Authorization and next gate

The branch is **not ready for the owner live-execution gate**. A bounded implementation remediation is required for H1–H3, followed by an independent re-review and a clean canonical offline/synthetic verification. Live F1–F8 execution remains unauthorized. G2/G3, H1/H2, OQ-1, host integration, Viewer Adapter/Core/M4 changes, model upload/retranslation, and production initializer changes remain outside scope and unauthorized.

