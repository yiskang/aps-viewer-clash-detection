# Clash Tests Manager UI Architecture — Owner Decision

- **Date:** 2026-10-10
- **Decision owner:** Milestone owner (user)
- **Decision:** **Option A — ratify the current single-panel Manager + Test Editor architecture.**
- **Type:** Docs-only owner-decision persistence. No production code, tests, spec, plan, final report, or Independent Work Review was modified.

## Background

1. The original owner brief described the Clash Tests Manager as a manager layer for multiple tests, while the existing Clash Test Panel remained the single-test editor/runner.
2. During §26 design, the implementation direction evolved into a single Docking Panel with Manager/List ↔ Editor views.
3. That single-panel composition was implemented and functionally accepted (see the targeted M1/M2 Independent Work Review and checkpoint `8c102cb`), but the product-architecture change itself had not previously received an explicit owner decision. This was a governance gap.

## Alternatives presented to and adjudicated by the owner

### Option A — Ratify current single-panel architecture

- One APS Viewer Docking Panel.
- Manager/List and Test Editor are views within that Panel.
- The existing headless manager, one editor controller, active-test-only result residency and Viewer ownership remain unchanged.

### Option B — Restore the original separate-panel direction

- A Clash Tests Manager Docking Panel for listing/managing tests.
- The existing Clash Test Panel remains the separate single-test editor/runner.
- Both Panels may still share the same headless manager / single editor-controller architecture, so two Panels do not imply two controllers.

### Trade-off at decision time

- **Option A** required no architecture correction and matched the already accepted implementation.
- **Option B** would have required a bounded composition/lifecycle/UI-navigation redesign while preserving most manager core behavior.

## Decision

On 2026-10-10 the owner explicitly chose **Option A: ratify the current single-panel Manager + Test Editor architecture.** The owner selected Option A (not Option B), making it the governing product direction.

- This resolves the governance gap.
- Single-panel Manager/List ↔ Editor switching is the **governing product direction going forward**.

## Scope boundary (unchanged by this decision)

This ratification does **not** reopen:

- the accepted headless manager architecture;
- result residency;
- Viewer ownership;
- recovery;
- readiness;
- any other already-accepted implementation behavior.

## Remains unchanged and unauthorized

- CTM-7 (headed SVF2 product validation)
- CTM-8 (rebuild-cost calibration)
- The eight deferred Low findings (L1–L8)
- Any new product scope

## Related artifacts

- Governing spec §26: [spec](../superpowers/specs/2026-09-26-viewer-clash-panel-design.md)
- Plan: [implementation plan](../superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md)
- Package final report (read-only): [final report](../research/2026-10-10-clash-tests-manager-final-report.md)
- Latest independent authority: [targeted M1/M2 Independent Work Review](2026-10-10-clash-tests-manager-m1-m2-accessibility-remediation-targeted-independent-work-review.md)
