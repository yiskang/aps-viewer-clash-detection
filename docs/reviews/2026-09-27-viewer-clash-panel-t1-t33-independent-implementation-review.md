# Viewer Clash Panel T1–T33 — independent implementation review

**Date:** 2026-09-27  
**Branch:** `feature/viewer-clash-panel-t1-t33`  
**Reviewed HEAD:** `d381e582188bb16e05e0f59c8c84d2ec38ac0a3b`  
**Baseline:** `main` = `origin/main` = merge base `e302b39720244b1085863220d75ac41e99075bac`  
**Implementation range:** `a0134bb..d381e58` (39 commits; the preceding `a0134bb` commit records the owner authorization)

## Verdict

**T1–T33 is not yet accepted for milestone closeout.** The implementation preserves the accepted architecture and authorized scope, and no Critical or High implementation defect was found. Two Medium items remain:

1. the grouped Results DOM has an invalid `listbox` accessibility structure and requires a bounded UI/test correction; and
2. the canonical aggregate gate is not independently green in the current environment because one unchanged pre-Panel collision test fails reproducibly.

The second item is a verification/baseline-test disposition, not a Viewer Clash Panel implementation defect. Panel-specific verification is green: 615/615 offline Panel tests and 77/77 DOM tests.

## Repository and scope verification

- The branch, HEAD, baseline and merge base match the values above. The implementation branch has 40 commits including the authorization record, and 39 commits after it.
- The range changes only the authorization prompt, the new `clashpanel/` package, `test/clashpanel/`, `scripts/run-dom-tests.mjs`, `package.json`, `test/README.md`, and `test/acceptance/README.md`.
- `collision/`, `clashtest/` (Core and Viewer Adapter), `wwwroot/`, `server.js`, `scripts/run-tests.mjs`, the lockfile, M4 artifacts, the accepted design, and the reviewed implementation plan are unchanged from `e302b39` in the implementation range.
- No G1–G3 or H1–H2 work is present. There is no SVF2 live verification, OQ-1 implementation, host composition, route/toolbar integration, registration/unload wiring, Viewer Adapter work, Core work, M4 work, push, or merge.
- `a0134bb` is a governance-only baseline that records the exact T1–T33 authorization. Using it as the T33 range base is valid; it neither adds product behavior nor expands scope.

## Architecture verification

- `clashpanel/core/` is headless and consumes narrowed engine/catalog/bridge/scheduler ports. It does not import Viewer or DOM implementation modules.
- `clashpanel/viewer/` is the sole Viewer-mutating layer. Viewer method names are centralized by `viewerApi.js`; markers, guarded isolation, fitting, event registration and teardown are invoked behind `ViewerBridge`.
- `clashpanel/ui/ClashDockingPanel.js` is a thin `Autodesk.Viewing.UI.DockingPanel` view adapter. It renders a controller view-model and dispatches intents; it owns no collision, lease, persistence, identity, registration, or Viewer-presentation policy.
- Markers-only v1 is preserved. No production theming call exists, and negative controls make theming calls fail.
- The accepted information architecture is implemented in fixed order: Test Setup; Run / Status; Filters / Grouping; Results / Navigation; Selected Clash Actions.
- Soft remains fail-closed unless the injected measurement-basis verdict is verified; Hard remains available. Result residency, cancellation, stale binding, and single-slot admission stay in the headless controller/residency layer.

## Findings

### Critical

None.

### High

None.

### Medium

#### M1 — grouped Results uses an invalid `listbox` owned-child structure

**Location:** `clashpanel/ui/render/results.js`, `renderResults()` and `groupRow()` (currently lines 41–52 and 106–109).

The container is `role="listbox"`. Result rows are `role="option"`, but a grouped header is emitted as `li role="presentation"` containing a focusable `<button aria-expanded>`. Removing the `li` from the accessibility tree leaves a button as a direct semantic child of a listbox rather than an option. Keyboard access happens to work, but the widget's ARIA hierarchy is invalid and assistive technology cannot rely on a coherent listbox contract.

**Disposition:** implementation defect; blocks T1–T33 acceptance. Apply a bounded semantic correction. The least-surprising options are a coherent `tree`/`treeitem` widget for grouped and result rows, or moving group-toggle controls outside the listbox. Preserve bounded rendering, Enter/Space selection, group expansion, pagination and focusability, and add DOM assertions for the final owned-child structure.

#### M2 — the canonical aggregate gate is not independently green

**Location:** unchanged baseline test `test/query/ContainmentModeQuery.test.mjs:64–80`.

The ignored T33 log records the reported closeout run at `d381e58`: offline 3,587 total / 3,586 pass / 0 fail / 1 todo and DOM 77/77. An independent `npm test` run reached the same 3,587 offline total but produced 3,585 pass / 1 fail / 1 todo, so `&&` correctly prevented the DOM half from starting. The failing assertion is `default scheduler makes frameBudgetMs live for the witness term`: expected `witnessTerm.aborted === true`, observed `false`. Running that file alone reproduces the failure (11/12 pass).

The failing test and the collision implementation it exercises are byte-unchanged from `e302b39`; the branch has no collision/Core diff. Separately, every Panel offline test passes (615/615) and the DOM suite passes (77/77). This is therefore an existing timing-sensitive baseline-test/verification problem, not evidence of a Panel regression.

**Disposition:** verification blocker, not a Panel production-code fix. Before closeout, obtain an authorized disposition for the unchanged baseline test and rerun the canonical `npm test` gate to a clean exit. Do not silently exclude or weaken the test as part of a Panel fix.

### Low

#### L1 — focus can fall to the document body when a focused control becomes disabled

`rebuild()` restores focus by `data-key`, but a replacement Run or Prev/Next button may now be disabled and therefore cannot receive focus. The browser then leaves focus on the body. This is a keyboard continuity defect, but every action remains reachable and it does not corrupt Panel state. It is non-blocking for T1–T33; a follow-up should move focus to the nearest enabled stable control or region heading and test that transition.

#### L2 — long duplicate model names can hide their disambiguating suffix in the closed native model filter

The label service correctly appends a stable key suffix, but the suffix is at the end of the `<option>` text and can be visually clipped in the closed, width-bounded native `<select>`. The stored filter value remains correct, and wrapped names elsewhere remain visible. This is non-blocking UX/accessibility polish. A follow-up should expose the full disambiguated label (for example via a stable accessible/title value or a suffix-first presentation) without changing identity.

#### L3 — four no-clash claim-gate hardening ideas are outside the published Core contract

The recorded ideas concern an extra `unqualified === false` check, validation of unpublished freshness shapes, a stale banner for malformed freshness, and rejecting the bare-string freshness shape that Core itself currently accepts. The implemented gate already requires an allowed claim and a completed `current` freshness value from the same check and safely suppresses wording during pending/failed reads. Requiring unpublished Core values would create an unauthorized coupling. These are optional boundary-hardening candidates, not T1–T33 defects or acceptance blockers.

## Plan deviations and implementation corrections

All reviewed deviations are bounded mechanical corrections; none requires owner design adjudication:

- **T17 claim-gate race (`054ece9`):** synchronously supersedes the old paired claim/freshness read so stale “no clashes” wording cannot reappear. This implements the accepted fail-closed contract.
- **T25 isolation replacement (`c4f76b6`):** restores the prior owned isolation when replacement isolation fails to apply. This repairs AC-P16 transaction semantics.
- **T3 fixture shape (`a546594`) and T12 vacuous test (`00b2212`):** align the fake summary with actual Core data and make the intended guard mechanically sensitive. Test corrections only.
- **Model-leave isolation (`9f3bcb1`), Panel-owned result-set release (`50b0ac0`), and dispose reporting (`d381e58`):** implement already accepted lifecycle, ownership and failure-reporting behavior; they do not add a new architecture.
- **T22/T23/T24/T26 scaffold additions:** keep the module manifest current as the planned Viewer-layer files are added. **`a0134bb`:** governance evidence only.

The smaller recorded C-2–C-4 corrections—avoiding a duplicate badge prefix, strengthening a composition export assertion, and matching the actual aggregate `fitToView` call shape—are likewise mechanical and tested.

## Test and T33 assessment

- **Recorded T33 evidence:** the ignored `.superpowers/.../t33-npm-test.txt` contains the claimed green 3,587/3,586/0/1 offline and 77/77 DOM summaries.
- **Independent current evidence:** aggregate offline half 3,587/3,585/1/1; isolated unchanged failure 11/12; Panel offline 615/615; Panel DOM 77/77.
- **Default wiring:** `npm test` runs `test:offline && test:clashpanel:dom`; the DOM runner fails closed on a missing Playwright package, missing Chromium, no DOM files, a killed child, or a non-zero DOM result. The READMEs accurately distinguish the aggregate gate, browser-free offline command, fake DOM suite, and excluded live gates.
- **77 versus planned 75:** benign. One additional T29-era DOM case corrected the plan's count, and the final dispose/teardown regression added one more. The extra tests exercise authorized behavior.
- **T33 negative controls:** no final rerun is required. T27 ran the missing-Chromium and deliberately failing-DOM controls, and the runner, scripts, guards and README wiring were not changed after T27. Re-run them only if those files change. A clean final `npm test` rerun is still required for M2.

## Recorded-but-not-fixed item dispositions

| Item | Severity | Blocks T1–T33? | Disposition |
|---|---:|:---:|---|
| Invalid Results-list ARIA structure | Medium | **Yes** | Bounded UI/test correction before acceptance. |
| Focus falls to body when a control becomes disabled | Low | No | Keyboard-focus follow-up; no state corruption. |
| Long model name can hide duplicate suffix in closed select | Low | No | Presentation/accessibility follow-up; identity remains correct. |
| Four claim-gate hardening gaps outside published Core values | Low | No | Optional boundary hardening; do not couple to unpublished Core fields. |
| Live DockingPanel/Viewer assumptions | Gate G2 | No for T1–T33 | Correctly deferred; must be verified before live integration acceptance. |

## Evidence durability

The ignored per-task red/green reports do **not** all need to be copied into tracked documentation. The commit sequence, committed tests, implementation-status ledger copied into `docs/reviews/`, three area reviews, fix-wave report and this independent review provide durable traceability without duplicating scratch output.

One closeout datum does need durable treatment because recorded and independent results differ: after M2 is dispositioned, record the final canonical aggregate-gate command, commit/HEAD, environment and exact summary in the closeout review or a small `docs/research/` evidence record. The existing ignored green log may remain scratch evidence; it is not sufficient by itself to resolve the current independent red run.

## Authorization and next gate

- T1–T33 implementation beyond the two items above must not expand.
- G1–G3, H1–H2, SVF2 live verification, OQ-1, host integration, Viewer Adapter/Core/M4 work, push and merge remain unauthorized.
- The branch is **not ready for the next owner gate** until M1 is fixed and M2 has an explicit baseline-test disposition followed by a clean canonical aggregate run.

