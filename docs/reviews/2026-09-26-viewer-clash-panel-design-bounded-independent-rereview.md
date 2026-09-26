# Viewer Clash Panel design — bounded independent re-review

- **Review date:** 2026-09-26
- **Repository / branch / HEAD:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` · `main` @ `255dcca4650e15193c3bf78a698f2a6f54fdb374` (`origin/main` identical)
- **Artifact:** `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`
- **Scope:** only the remediated H1/H2/M1/L1 areas, the normative v1 UX addition, SVF2/RQ-1, and directly affected cross-references
- **Verdict:** **ready for owner acceptance**
- **Findings:** 0 Critical / 0 High / 0 Medium / 2 Low

No live Viewer test was run. No production code, test, implementation plan, Core, Viewer Adapter, M4, OQ-1, host-integration, or design-spec file was modified by this review.

## Finding

### Critical

None.

### High

None.

### Medium

None.

### Low

#### L1 — One internal-review classification row still names theming as a v1 PG-1 gate

- **Location:** `docs/reviews/2026-09-26-viewer-clash-panel-design-internal-codex-review.md`, “Classification of remaining concerns”.
- **Issue:** the Viewer-API verification row still includes “theming on isolated nodes” under PG-1. The remediated spec explicitly removes Viewer theming from v1 (PD-16, §9.2, §16, PG-1, AC-P19), and the research artifact's scope note correctly says its theming evidence is retained only for a possible future exclusive-theming design.
- **Disposition:** stale review-record wording only. It is non-normative, does not change the design, does not require another remediation round, and does not block owner acceptance. If the review record is later reconciled, remove that phrase; no spec or code change is needed.

#### L2 — The spec's introductory working-tree parenthetical is stale

- **Location:** `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`, introductory “Source of truth” paragraph.
- **Issue:** it says the working tree contains only the untracked authorization prompt. The verified tree also contains the uncommitted Panel spec, research, internal and independent reviews, and handoff edit.
- **Disposition:** stale repository-state wording only. The handoff accurately lists the documentation-only working tree, and this does not affect a design contract or owner-acceptance verdict. Reconcile when the documentation baseline is next edited or committed; no production or design correction is required.

## Bounded verification

### H1 — markers-only v1: resolved

- PD-16 and §9.2 remove the theming option and prohibit every `setThemingColor` / `clearThemingColors` call in v1. AC-P19 makes that prohibition mechanically testable and preserves pre-existing foreign theming unchanged.
- Emphasis resources are Panel-created overlay meshes in a dedicated scene. The write-ahead, token-keyed ledger records the created meshes before mutation and cleanup removes those named resources individually. No foreign theming or overlay resource is read, overwritten, or cleared.
- Focus is best-effort camera framing and deliberately outside rollback; it owns no durable Viewer state. Guarded Isolate captures a readable pre-image, uses canonical read-and-compare ownership, is disabled when isolation or hidden state cannot be represented safely, and never uses a conservative clear fallback. Back to All awaits `clear()`, removes Panel markers, and restores isolation only while the Panel still owns the current state.
- §9.6 and AC-P6/AC-P16 cover every cleanup trigger and failure/supersession interleaving. The ownership model is internally consistent. No theming API is a v1 dependency.

### H2 — Soft common-basis correctness: resolved

- §6.2 step 4 makes Soft available only for one participating model or a host-supplied `{state:'verified'}` common measurement-basis verdict. Missing, malformed, thrown, timed-out, incompatible, and unverified verdicts all fail closed.
- Display-unit choice occurs only after basis verification and is expressly prohibited as evidence of computational compatibility. No converted distance is used or shown.
- Hard remains available and unaffected when Soft is disabled; if Soft was selected, only that selection blocks Run until the user changes mode or scope.
- PD-17, §16, PR-BASIS, PG-5, OD-13, AC-P18, §21, and the handoff agree. PR-BASIS/PG-5 are host evidence and live-verification gates for multi-model Soft, not Core changes and not prerequisites for the headless Hard path.

### M1 — host-composition boundary: resolved

- `EnginePort` exposes only read-only `registry.bindingFor`; AC-P20 excludes `register`, `unregister`, `invalidateModelPlacement`, and `wireModelUnload`.
- §5.1 and §11.1 assign model loading, identity derivation, registration, reload re-registration, unload wiring, placement invalidation, and measurement-basis evidence to host composition/OQ-1.
- An absent or stale binding disables Run or makes a result side unavailable. The Panel does not create, repair, refresh, or indirectly trigger registration.
- No Viewer Adapter extension, Core change, M4 change, OQ-1 implementation, or host-integration implementation is silently required by the Panel core design.

### Normative v1 UX: consistent

- PD-19 and §14 make `Autodesk.Viewing.UI.DockingPanel` the normative Viewer-native shell.
- The DockingPanel owns only container lifecycle, visibility, DOM rendering, and intent forwarding. Domain/workflow state remains in `clashpanel/core`; Viewer mutation remains in the ViewerBridge; AC-P21 makes reconstruction from the controller view-model testable.
- The five-region order is normative: **Test Setup → Run / Status → Filters / Grouping → Result Navigation / List → Selected Clash Actions**.
- The screenshot-derived concepts are mapped to existing contracts or explicit deferrals. WASM, heap/CPU/RAM telemetry, ETA, and reference-sample assumptions are expressly excluded.

### SVF2 / RQ-1: consistent

- PD-15 and §§1/2.1 identify SVF2/OTG as the v1 target and explicitly limit historical Adapter T3 evidence to Audubon / SVF non-OTG / Viewer 7.124.2 / Chromium 151.
- No current wording claims SVF2 validation. F1–F8 and PG-4 remain unevidenced runtime assumptions/gates.
- RQ-1 is consistently closed as option (b): after owner acceptance and separate implementation authorization, model-format-agnostic/headless Panel work may proceed; bounded SVF2 verification gates real Adapter/Collision/ViewerBridge integration and live acceptance.
- This is package-scoped gating, not authorization to run SVF2 verification or modify the Adapter.

## Owner decisions and authorization

- OD-5 is correctly constrained to markers-only v1; any theming mode requires a separate enforceable ownership design and authorization.
- OD-13 correctly separates the non-optional common-basis validity rule from the later unit-label product choice.
- OD-1–OD-4, OD-6–OD-12, and OD-14 remain genuine product/integration choices. None hides a current technical contradiction. OD-8 remains an integration/OQ-1 policy decision.
- No blocking technical issue remains in this bounded scope. The design is ready for owner acceptance.
- Owner acceptance would close the design gate only. Under `CLAUDE.md`, it would not itself authorize implementation planning, implementation, SVF2 live verification, OQ-1, host integration, or Core/Adapter/M4 changes. Those transitions still require explicit owner authorization.

## Gate verdict

**Ready for owner acceptance.** The prior H1, H2, M1, and L1 findings are resolved. RQ-1/SVF2 gating is internally consistent. No Viewer Adapter or Core extension is required by the accepted design; a later live failure would be triaged separately rather than pre-authorized here.
