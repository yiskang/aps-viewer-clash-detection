# For Claude — Authorize G2 Live ViewerBridge / DockingPanel Verification Only

I explicitly authorize **G2 — live ViewerBridge / DockingPanel verification only** for the Viewer Clash Panel milestone.

This authorization does **not** include G3 full Panel live acceptance, H1/H2 host integration, OQ-1, production host composition, Core/Adapter/M4 changes, or any next milestone.

## Repository baseline

Before doing any live work:

1. Verify the repository currently in scope.
2. Read:
   - `CLAUDE.md`
   - `docs/handoffs/latest.md`
   - `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`
   - `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md`
   - the G1 verified-PARTIAL closeout artifacts
   - the accepted Viewer Clash Panel T1–T33 implementation/reviews
   - any normative G2 gate definition in the plan/spec
3. Verify:
   - branch: `main`
   - local `main` = `origin/main`
   - expected baseline HEAD: `f139dda`
   - working tree is clean
   - G1 is closed as verified `PARTIAL`
   - F1–F6 and F8 PASS
   - F7 `NOT_EVIDENCED` under accepted CAL-B disposition
   - G2 is now the explicitly authorized action
   - G3/H1/H2/OQ-1/host integration remain unauthorized

If the governing plan/spec says G2 cannot proceed with the accepted G1 `PARTIAL` state, stop and report the exact blocking clause. Do not reinterpret or waive it.

Treat repository artifacts as authoritative.

## G2 purpose

G2 exists to verify the **real Viewer-facing integration behavior** of the already-implemented ViewerBridge and DockingPanel shell under the accepted SVF2 runtime path.

G2 is **not** full end-to-end Panel acceptance.

Do not expand it into G3.

## Runtime envelope

Use the accepted runtime path:

- Viewer 7.124.2
- `env: 'AutodeskProduction2'`
- `api: 'streamingV2'`
- existing accepted SVF2 fixture suitable for this gate
- no upload/retranslation
- no Viewer version change

Use the fixture required by the governing G2 plan/spec. If the plan does not name one, prefer the already accepted `Audubon_Mechanical_clash_test.rvt` only if it satisfies every G2 prerequisite.

Do not silently choose a different fixture if the governing artifact says otherwise.

## Scope of live verification

Verify only the real ViewerBridge / DockingPanel assumptions that belong to G2.

### 1. DockingPanel shell

Verify:

- `Autodesk.Viewing.UI.DockingPanel` can host the implemented v1 Panel shell;
- the Panel renders the accepted five regions:
  1. Test Setup
  2. Run / Status
  3. Filters / Grouping
  4. Results / Navigation
  5. Selected Clash Actions
- the DockingPanel remains a thin shell;
- no duplicate controller/domain state appears in the view;
- open/close/dispose behavior is deterministic;
- closing the Panel leaves no Panel-owned DOM/listener residue.

Do not perform G3 workflow acceptance.

### 2. ViewerBridge live API validity

Verify the real Viewer APIs used by ViewerBridge against Viewer 7.124.2.

Where required by the reviewed design, verify:

- model/dbId resolution;
- fit/focus path;
- guarded isolation;
- Panel-owned markers / bounds outlines;
- marker cleanup;
- Back to All / restore behavior;
- selection/navigation interactions that are owned by ViewerBridge;
- stale/unavailable binding behavior at the ViewerBridge boundary.

Do not add theming.

Explicitly verify no calls occur to:

- `setThemingColor`
- `clearThemingColors`

### 3. Markers-only ownership

Verify:

- markers/overlays are Panel-owned;
- Panel cleanup removes only Panel-owned visualization;
- foreign Viewer theming remains untouched;
- marker replacement does not leak old markers;
- selected-clash changes do not accumulate stale overlays.

If the real Viewer reveals that the current marker/overlay assumptions are wrong, preserve evidence and stop. Do not patch production code in this authorization.

### 4. Guarded isolation

Verify the accepted isolation ownership contract using the real Viewer.

Confirm:

- isolation is used only when the reviewed preconditions hold;
- foreign/unknown visibility state is not blindly cleared;
- failed/superseded isolation does not strand Viewer state;
- model unload/staleness does not leave Panel-owned isolation behind;
- Back to All / close restores only what the Panel is allowed to restore.

Do not broaden this into host lifecycle integration.

### 5. Fit/focus and bounds behavior

Verify the real Viewer path used by ViewerBridge for fit/focus.

Confirm:

- the actual Viewer 7.124.2 API signatures match implementation assumptions;
- target bounds are accepted;
- focus/fit does not throw for valid live results;
- superseded focus actions cannot overwrite a newer selection;
- any runtime discrepancy is retained in evidence.

Do not reinterpret F7 calibration research as part of G2 unless the governing G2 contract explicitly depends on it.

### 6. Live unload/stale behavior within G2 scope

Only verify the stale/unavailable behavior already assigned to ViewerBridge/G2.

Do not implement or solve:

- OQ-1 durable host identity;
- production model registration;
- host reload/re-registration composition;
- placement invalidation.

If the test requires one of those, stop and report the dependency instead of starting H1/H2/OQ-1.

## Explicitly out of scope

Do not:

- run G3 full Panel live acceptance;
- start H1 host routes/toolbar/composition;
- start H2 OQ-1/measurement-basis/placement integration;
- change production host wiring;
- modify Core;
- modify Viewer Adapter;
- modify M4;
- modify Viewer Clash Panel production code to make G2 pass;
- change the F7 calibration/tolerance;
- run the optional F7 probe;
- change limits;
- upload/retranslate models;
- change Viewer version;
- start another milestone.

If G2 exposes a defect, preserve evidence and stop for review/owner authorization.

## Execution discipline

Follow the accepted G2 procedure in the governing plan/spec.

If the plan defines one bounded live execution, obey that exactly.

Do not retry-until-green.

Do not weaken assertions or change runtime parameters after a failure.

A pure preflight failure before the actual G2 live interaction begins should be recorded separately from a consumed live attempt if the governing procedure distinguishes them.

## Evidence

Persist the G2 live evidence under the established repository structure.

At minimum retain:

- exact command
- timestamps
- branch / HEAD
- Node / Playwright / Chromium / Viewer versions
- fixture/model identity
- `env` / `api`
- `isOTG()` / `isSVF2()` where relevant
- DockingPanel creation/disposal result
- each ViewerBridge live check result
- marker ownership/cleanup evidence
- isolation/restore evidence
- fit/focus evidence
- stale/unavailable behavior evidence
- console/page/runtime error ledger
- cleanup result
- overall G2 verdict
- limitations / unevidenced items

Retain:

- machine-readable JSON
- raw/live log if useful
- human-readable research/report artifact

Do not overclaim beyond the exact tested envelope.

## Verdict and failure discipline

Use the G2 verdict model defined by the accepted plan/spec.

Do not manually reinterpret a failure as PASS.

If G2 produces FAIL/PARTIAL/BLOCKED or exposes a runtime contradiction:

- preserve it exactly;
- do not patch production code;
- do not retry merely to obtain PASS;
- stop for independent Work verification.

## After execution

After G2:

1. persist evidence;
2. update `docs/handoffs/latest.md` with:
   - exact G2 verdict;
   - runtime envelope;
   - live ViewerBridge/DockingPanel findings;
   - residuals/blockers;
   - G3/H1/H2/OQ-1/host remain unauthorized;
   - next authorized action: none / awaiting independent Work verification and owner decision;
3. do not commit/push unless separately authorized.

## Stop gate

Stop after G2 evidence collection and handoff update.

Do not start G3.

Do not start H1/H2/OQ-1/host integration.

Do not modify production code.

The next gate is:

**independent ChatGPT Work verification of G2 evidence → owner decision**

## Final report

Report:

- branch / HEAD before and after;
- working-tree state;
- exact G2 command/procedure;
- runtime versions;
- fixture/model used;
- DockingPanel result;
- ViewerBridge live-check results;
- marker/cleanup result;
- isolation/restore result;
- fit/focus result;
- stale/unavailable result;
- overall G2 verdict;
- warnings/residuals;
- evidence artifact paths;
- whether anything was committed or pushed.

Explicitly confirm:

- G3 was not started;
- H1/H2 were not started;
- OQ-1/host integration were not started;
- no Core/Adapter/M4/Panel production changes were made;
- no F7 probe or calibration change occurred.

Stop after the G2 verification gate.
