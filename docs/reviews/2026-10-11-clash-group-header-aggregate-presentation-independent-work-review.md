# Clash group header aggregate presentation — Independent Work Review

**Date:** 2026-10-11  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD / origin:** `main` / `9e49f4036137bafd098ceb8631bcd16fff6c4da6` / `origin/main` at the same commit  
**Baseline tree:** clean before this review; this report and the handoff update are the only review outputs  
**Verdict:** **OWNER DECISION REQUIRED**  
**Findings:** 0 Critical / 2 High / 1 Medium / 0 Low

## Scope and authority

This is a review/design-only package. It does not restore the discarded aggregate-through-`present()` implementation and does not modify production code, tests, the governing design, or the implementation plan.

The governing baseline is:

- [Viewer Clash Panel design](../superpowers/specs/2026-09-26-viewer-clash-panel-design.md), especially §§9–10, §12 and grouping addendum §25;
- [Viewer Clash Panel implementation plan](../superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md), especially Tasks 13, 18, 23–26 and 29–30;
- [grouping/navigation final report](../research/2026-10-08-clash-test-result-grouping-navigation-final-report.md) and its [Independent Work Review](2026-10-08-clash-test-result-grouping-navigation-independent-work-review.md);
- the CTM-7 closeout recorded in [the current handoff](../handoffs/latest.md) and the [owner-ratification record](2026-10-11-clash-tests-manager-ctm-7-scenario-h-evidence-owner-ratification.md).

Repository history verifies that CTM-7 is closed at the owner-ratified checkpoint and that CTM-8 has not started. CTM-8 remains unauthorized. No upstream implementation final report is expected or created for this design-only review.

## Verdict and findings

### High H1 — the single-clash `present()` contract cannot carry an aggregate group

`ViewerBridge.present()` accepts one clash's `sides` only: a non-empty array of one or two live `{model, dbId}` entries, plus that clash's witness `point` or `closestPoints` and `{focus,isolate,marker}`. `validateRequest()` rejects any other cardinality with `present: sides must hold 1–2 entries`. The controller constructs this request from one selected `resultId`; the marker transaction assigns side-1/side-2 outlines and one clash location; the selected region likewise describes exactly two clash sides.

The invariant is intentional single-clash semantics, not an incidental capacity check. Widening it would make witness ownership, the two side colors, Selected Clash state and the tested bridge contract ambiguous. The discarded runtime failure is therefore evidence that the discarded composition crossed the abstraction boundary; it is not evidence that the invariant should be relaxed.

**Minimum correction before implementation:** add a separately validated aggregate operation, recommended as `ViewerBridge.presentGroup(request)`, and keep `present()` byte-for-byte compatible in meaning and cardinality. `presentGroup` should share the bridge's queue, token invalidation, one held ledger, isolation ownership and clear/dispose machinery, but must have its own aggregate request and marker rules.

### High H2 — the governing spec/plan do not authorize the new selection and bridge contract

The current design says row selection is `resultId`, `present()` is 1–2 sides, a group header is an expansion control, and region 5 is Selected Clash. The plan and tests encode those same assumptions. The owner-approved split target—disclosure toggles only, row body selects/presents the aggregate—adds a new presentation-selection state, a new user-facing intent and a new ViewerBridge port operation. That is a bounded extension, but it is not already described by §§9–10 or §25.

**Minimum correction before implementation:** a narrow design/plan addendum must record the contract below, including the marker disposition from M1. It need not reopen Core, collision, CTM-7 or CTM-8. After that docs-only package is independently reviewed, implementation may be authorized as a pre-CTM-8 correction.

### Medium M1 — aggregate marker behavior is a genuine owner/product decision

A group has no single witness and can contain many clashes and participants. Replaying every child witness/closest-point marker would multiply overlays, preserve duplicates, and imply that the group is a collection of selected clashes. Drawing one bounds outline per de-duplicated participant is meaningful but adds an unmeasured overlay-volume/capacity policy. Suppressing aggregate markers is the smallest safe behavior and leaves focus plus guarded isolation as the Viewer presentation.

**Owner options:**

1. **Recommended minimum:** no markers/outlines in group mode; Focus and guarded Isolate operate on the aggregate. The group action state shows Markers as unavailable with a group-specific reason.
2. **Larger follow-up:** bounds outlines for every unique live participant, with no child witness markers. This requires a reviewed capacity/omission contract and headed evidence; it must not silently become part of the minimum implementation.

Displaying all child clash markers is not recommended for v1.

## Required design answers

### 1. Existing presentation contract

`present({sides, point?, closestPoints?, options})` is one-clash presentation. It accepts one live side when the other side is unavailable, or two live sides for the normal clash. The 1–2 invariant protects:

- one result/witness context;
- the two side-specific outline colors;
- one Selected Clash state;
- bounded, tested rollback through one visualization ledger.

The invariant must remain protected.

### 2. Current Viewer operations and UI state

- **Isolate/show:** `isolation.apply()` groups arbitrary `{model,dbId}` values into one `setAggregateIsolation` reconcile; `isolation.restore()` is ownership guarded.
- **Selection/highlight:** the Panel never mutates Viewer selection or theming. UI selection is controller state; Viewer emphasis is Panel-owned overlay markers/outlines.
- **Focus:** `fitSides()` already de-duplicates by model and dbId and can form an aggregate fit request for any number of models; its comments are stale at “two models,” but its implementation is not cardinality-limited. Its first-element fallback remains a live-behavior limitation.
- **Markers:** `createMarkerSet()` creates one clash location and per-side bounds outlines. The location API is clash-specific; outline creation can iterate arbitrary sides but has only alternating two-color semantics and no aggregate capacity contract.
- **Restore:** `ViewerBridge.clear()` removes held Panel markers and ownership-guardedly restores isolation; Back to All also clears controller selection.
- **Selected Clash:** controller/view-model/renderer state is keyed to one selected result. It is not Viewer state.

### 3. Correct aggregate abstraction

Use a separate `presentGroup()` ViewerBridge operation. The controller must not call `viewerApi`, `fitSides`, `isolation.apply` or marker primitives directly; ViewerBridge remains the only Viewer-mutating layer. Internally, `present()` and `presentGroup()` may share a private transaction runner and the same single-flight/ledger machinery, but their validation and semantics remain distinct.

Recommended minimum request shape after the marker decision:

```js
presentGroup({
  participants: [{ model, dbId }],
  options: { focus, isolate, marker }
})
```

`participants` is non-empty and unbounded by clash-side cardinality; implementation resource behavior remains bounded by de-duplication and the existing result-set/group limits. No new Core or public collision limit is introduced.

### 4. Participant identity and aggregation

The durable/controller identity is the existing `ElementRef` pair `{modelKey, dbId}`. Build it from every filtered member index in the active group, visiting both `record.pair.first` and `record.pair.second`, and de-duplicate by the compound identity—prefer a `Map<modelKey, Set<dbId>>`, never a set of dbIds.

Resolve each `ElementRef` at action time through the existing provenance-aware result resolver. Only then form ephemeral `{model,dbId}` ViewerBridge participants. The controller must not retain `Model` objects after the call. This handles equal dbIds in different federated models correctly.

Because §25.9 defines a displayed group over the filtered list and the header shows `filteredCount of count`, the aggregate must use the current filtered `memberIndexes`, not hidden members. A selected group whose filtered membership changes must be re-presented from the new membership; if the group disappears or the grouping mode changes, clear the aggregate selection and Viewer presentation.

### 5. Multi-model behavior

- **One model:** one de-duplicated model entry for isolation and per-model fit.
- **Two models:** one aggregate isolation reconcile and aggregate fit when available.
- **More than two models:** the same operation over all participating model entries; no 1–2 restriction.

If an element is unavailable, omit it and surface a note. If no participant resolves live, clear the previous presentation and retain a non-misleading selected-row state with Viewer actions unavailable. Aggregate fit across more than two real models remains a headed-verification item; it does not justify falling back to the single-clash contract.

### 6. UI state semantics

- **Selection:** add a group presentation selection distinct from `selection`'s clash occurrence. The minimum-change controller shape is a mutually exclusive `selectedGroupId` alongside the existing clash selection; child selection clears the group selection, and group selection clears the clash selection/nav scope.
- **Isolate:** when enabled and the existing prerequisite passes, isolate every unique live aggregate participant in one reconcile.
- **Focus on select:** group-row activation fits the whole live aggregate when enabled. A later Focus action always requests aggregate fit.
- **Selected Clash:** it must immediately stop displaying the previous child. Architecture requires a minimal contextual state in region 5 so Focus/Isolate/Back to All remain available; it should show the group label/count and shared presentation controls, not fabricate clash sides, gap, location or ordinal. This is a bounded “group selected” state, not a new analysis/product surface.
- **Markers:** owner decision M1 applies. Under the recommended minimum, the Markers control is disabled for a group with a visible reason.
- **Back to all:** use the existing `bridge.clear()`, then clear both clash and group selection while preserving filters, grouping, expansion and page.

Group selection should survive disclosure expansion/collapse because the row exists in both states. Starting a run, switching/deleting the active test, panel hide and model departure use the existing restore table; a model departure clears the aggregate Viewer presentation when its `modelKey` is among the presented keys.

### 7. Event separation

Today one header button contains the chevron, label and count, so every click dispatches only `GROUP_TOGGLE`. Implementation should render two sibling native buttons inside the group row:

- a disclosure button with `aria-expanded`, accessible expand/collapse name and only `GROUP_TOGGLE`;
- a row-body button with selected semantics and only the new group-presentation intent.

Sibling targets avoid nested interactive content. Each handler should prevent accidental cross-activation; `stopPropagation()` is required if any handler remains on a common ancestor, and is harmless belt-and-suspenders on the disclosure handler. Enter/Space should retain native button behavior. The group header remains outside the child listbox, preserving the existing ARIA correction.

### 8. Shared grouping path

Element, Model Pair, Category and Level all converge on the same filtered group object:

```text
{ groupId, ref, count, filteredCount, memberIndexes }
```

The descriptors differ only in how their group table and label are produced. One controller aggregate path over `memberIndexes` is therefore correct. No per-mode presentation logic is justified. `none` has no group row and no aggregate action.

### 9. Minimum test matrix

**Controller/unit:** Element and Category multi-child aggregation; Model Pair/Level shared path; >2 models; duplicate participants; same dbId in distinct models; empty/no-live; single-child; collapsed selection; filtered-membership refresh/disappearance; group→child transition; Back to All; model-left; single-clash regression; manager fault-policy classification for the new intent.

**ViewerBridge/unit/integration:** independent request validation; arbitrary participant cardinality; de-duplication; one/many-model isolate target; aggregate fit; marker disposition; supersession, rollback, clear/dispose and failure injection; `present()` still rejects 0 or >2 sides.

**Renderer/DOM:** sibling disclosure/body controls; triangle never presents; body never toggles; click/Enter/Space; group selected ARIA/style; focus retention; child transition; group action region; fault-state disabling and intent/control equivalence.

**Headed/manual after implementation authorization:** real one-, two- and >2-model focus; isolate/restore/Back to All; unavailable participant; selected visuals; chosen marker behavior; no cross-trigger between disclosure and body. This is not CTM-8 and makes no performance-closeout claim.

### 10. Minimum implementation surface

**Required production changes:**

- `clashpanel/core/intents.js`, `controller.js`, `rows.js`, `viewModel.js`;
- `clashpanel/viewer/ViewerBridge.js` (private reuse of `fit.js`/`isolation.js`; marker code only if the owner chooses outlines);
- `clashpanel/ui/render/results.js`, `selected.js`, and `wwwroot/main.css`;
- `clashpanel/core/testsManager.js` and `managerViewModel.js` only as required to classify/disable the new user-facing intent in terminal fault.

**Required tests:** focused controller grouping/navigation, ViewerBridge transaction/validation, row/view-model, manager fault-equivalence and DOM results/selected suites; fake bridge/support shapes and public-surface enumeration tests must grow exactly where the new port/intent is public to those seams.

**Documentation:** a narrow spec addendum and implementation-plan addendum are required before implementation. The implementation package later needs its own read-only upstream final report and Independent Work Review.

**Out of scope:** new grouping modes, nested grouping, persistence/history, Core/Adapter/collision changes, Viewer theming/selection, arbitrary child-witness overlays, virtualization, new public resource limits, L1–L8 remediation and CTM-8.

### 11. Governing spec/plan impact

The existing architecture supports the extension—headless controller, shared group data, ViewerBridge ownership and lower-level aggregate isolate/fit composition are all reusable—but the externally observable group selection and bridge operation are not specified. A narrow contract clarification is mandatory; silently treating this as already covered would contradict §§9.2–9.3, §10.2 and §25.

## Verification and boundaries

- Git state and graph index both resolve to `main` at `9e49f4036137bafd098ceb8631bcd16fff6c4da6`; origin matches and the pre-review tree was clean.
- Structural graph searches/traces were cross-checked with direct source reads. Coverage checks report no recorded issue for every relied-on source/spec/plan/handoff path; that signal is best-effort, so material contracts were verified from disk.
- No test execution was necessary to adjudicate a clean-baseline design question. Existing focused source/tests were inspected; no implementation evidence is claimed.
- CTM-7 remains closed. CTM-8, implementation, headed execution, spec/plan edits, commit and push remain unauthorized.

## Exact next authorized action

Owner decision on aggregate marker behavior only: choose **(A) suppress group markers/outlines** (recommended minimum) or **(B) unique-participant bounds outlines with a separately reviewed capacity/omission contract**. After that decision, the next package is a bounded docs-only design/plan addendum implementing this review's contract, followed by Independent Work review. Production implementation must not begin before that gate clears.
