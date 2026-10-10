# Clash Tests Manager — Manager UI Layout Headed Validation — Independent Work Review

**Date:** 2026-10-11  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `fdb8643aa1987e5a1c96355d97a3deb6a0e9a9de`  
**Origin relation:** `HEAD == origin/main`  
**Working tree:** uncommitted and unpushed accepted Addendum A implementation plus documentation/evidence; the headed-validation package adds no production or test change  
**Governing design / plan:** Viewer Clash Panel design §26.14 (AC-UI1…AC-UI12); Clash Tests Manager implementation plan Addendum A  
**Read-only upstream inputs:** `docs/research/2026-10-11-clash-tests-manager-ui-layout-implementation-final-report.md`; `docs/research/2026-10-11-clash-tests-manager-ui-layout-headed-validation-final-report.md`  
**Prior implementation authority:** `docs/reviews/2026-10-11-clash-tests-manager-ui-layout-implementation-independent-work-review.md`  
**Evidence package:** `docs/research/evidence/2026-10-11-manager-layout-headed/`  
**Verdict:** **headed validation accepted; ready for owner checkpoint disposition / commit-push decision**  
**Findings:** **0 Critical / 0 High / 0 Medium / 1 Low**

## Scope and method

This review independently read `CLAUDE.md`, the current handoff, §26.14, Addendum A, the prior implementation final report and Independent Work Review, the upstream headed-validation final report, the evidence README and manifest. The handoff and upstream reports were treated as navigation and claims to verify, not proof. Both upstream final reports were preserved unchanged.

All 19 retained PNGs were inspected directly at original resolution. The manifest was independently verified with `shasum -a 256 -c`; all 19 entries matched. The current renderer/protected boundaries were verified through the codebase-memory graph plus direct source and diff reads. Coverage checks reported no recorded issue for every relied-on source and documentation path.

No production implementation, tests, governing spec/plan or upstream final report was modified by Work.

## Readiness verdict

The headed evidence confirms the owner-approved presentation direction in the normal APS Viewer application: semantic item cards, the visible Active badge, compact icon actions, deduplicated disabled reasons, responsive narrow behavior, width invariance and visual compatibility with the native Viewer shell. No screenshot exposes a product defect in the Addendum A implementation.

The evidence supports **9 required scenarios PASS (3 with caveats) / 0 FAIL / 0 INCONCLUSIVE**. At screenshot granularity, **19 PASS (3 with caveats) / 0 FAIL / 0 INCONCLUSIVE**. The caveats are bounded evidence/product observations rather than implementation blockers.

## Finding

### Low L1 — ML-02b's retained caption overstates what the screenshot proves

The evidence README describes `ML-02b-manager-viewport360-viewer-toolbar-hidden.png` as “Whole list visible.” The image shows the native toolbar removed and the scrollable Panel content unobscured, but it does not show every item's complete vertical content at once; the bottom item is only partially visible within the viewport.

**Failure mode:** a later reader could treat this image as proof that the full four-item list fits simultaneously at 360 px. It proves the narrower claim that hiding the toolbar removes the toolbar occlusion and leaves the list scrollable/intact.  
**Impact:** evidence-caption precision only. It does not change S2's product verdict, because horizontal fit, readable wrapping and the toolbar-overlap caveat are independently visible in ML-02/02b/03.  
**Minimum correction:** the responsible upstream package agent should, if a documentation closeout is authorized, replace “Whole list visible” with wording such as “visible Panel content is no longer occluded by the Viewer toolbar; the list remains vertically scrollable.” The upstream report and README remain read-only in this review.

## Independent screenshot adjudication

| Evidence | Independent result | Adjudication |
| --- | --- | --- |
| `ML-01-manager-460-normal.png` | PASS | Clear item hierarchy, four distinct cards, readable status/sets/reasons, Active badge and compact actions; no visible horizontal overflow. |
| `ML-02-manager-viewport360.png` | PASS (caveat) | 324 px Panel remains readable and horizontally contained; native Viewer toolbar visibly overlaps the lower Panel, a disclosed pre-existing host behavior. |
| `ML-02b-manager-viewport360-viewer-toolbar-hidden.png` | PASS | Removing the toolbar removes the occlusion and leaves the list intact/scrollable; caption overstatement recorded as Low L1. |
| `ML-03-manager-viewport300-supported-minimum.png` | PASS | At the supported minimum, actions occupy their own row, Set labels stack, text remains readable and no horizontal escape is visible. |
| `ML-04-long-content-panel-460.png` | PASS (caveat) | Long realistic and unbroken names clamp cleanly to two lines; live evidence cannot prove a Set value longer than the available real-model composition or native tooltip painting. |
| `ML-05a-active-item.png` | PASS | `Active` text, accent bar and tint identify state without relying on color alone; action area remains aligned. |
| `ML-05b-inactive-item-with-disabled-reason.png` | PASS | Disabled Reset is visually distinct and its reason remains visible without damaging layout. |
| `ML-06a-focus-open.png` | PASS | Open has a clear cyan focus ring around the compact button. |
| `ML-06b-focus-delete.png` | PASS | Delete has the same visible keyboard focus treatment and a distinct trash glyph/last position. |
| `ML-06c-hover-duplicate.png` | PASS | Duplicate hover state is visible; disabled Reset remains distinguishable; all glyphs are legible. |
| `ML-07-disabled-reasons-run-active.png` | PASS | Run-active action restrictions and per-item reasons remain readable across the full Panel. |
| `ML-07b-shared-reason-active-running-item.png` | PASS | Reset/Delete share one visible reason line; layout and Active state remain coherent. |
| `ML-08a-editor-after-switch-460.png` | PASS | Editor view is intact at the same Panel width and preserves the accepted five-region product layout. |
| `ML-08b-manager-after-round-trip-460.png` | PASS | Manager returns intact after the round trip, with no visible width/layout change. |
| `ML-08c-manager-externally-set-400-after-round-trip.png` | PASS | Externally supplied 400 px width remains usable; long name and Set text clamp without horizontal failure. |
| `ML-09-viewer-native-alignment-with-model-browser.png` | PASS (caveat) | Panel chrome, font family, title bar, close affordance, shadow and colors align with the native Model panel; the disclosed 12 px vs 14 px content density difference is the existing Clash Panel base style. |
| `ML-10a-icon-fallback-460.png` | PASS | Fallback labels replace glyphs, remain readable, and wrap without overflow at normal width. |
| `ML-10b-icon-fallback-viewport300.png` | PASS | Four fallback labels wrap to bounded rows at the supported minimum; toolbar overlap remains the same host caveat, not a fallback defect. |
| `ML-11-delete-confirmation-banner.png` | PASS | Confirmation banner, destructive/cancel actions, global action lock and shared pending-confirmation reasons are visually coherent. |

## Required product-contract assessment

- **Normal and narrow presentation:** the 460 px hierarchy is scanable, while 324 px and 270 px states preserve readable names, actions, sets, status and reasons. The bottom-toolbar collision at narrow viewports is real but pre-existing and outside Addendum A's Viewer-host ownership.
- **Long content and width behavior:** long names clamp without collapsing to one-character columns. Manager ↔ Editor screenshots and the retained probes support unchanged `min(460px, 90vw)` and preservation of an externally supplied 400 px width.
- **Actions, state and accessibility presentation:** Active is conveyed by text plus visual styling. Icons are distinguishable, focus/hover/disabled states are visible, and fallback text is usable. Screenshot evidence for reason deduplication agrees with the previously accepted DOM linkage evidence; screenshots alone do not prove `aria-describedby`.
- **Viewer-native alignment:** the package fits the Viewer panel chrome without pretending to duplicate the native Model tree's 14 px density or resize footer. Those differences are existing product boundaries, not new regressions.
- **Resolved owner decisions:** list/item layout, 460 px preference, icon actions, Active badge, reason deduplication, single DockingPanel architecture and no view-switch width writes remain implemented consistently and are not reopened.

## Verification and evidence gaps

- Manifest: **19/19 hashes verified**; all images inspected directly.
- `git diff --check`: clean; protected-path diff: empty.
- Runtime evidence reports 0 console errors and one disclosed pre-existing Viewer deprecation warning; no contradictory retained evidence was found.
- The 240 px list-content floor remains automated Chromium DOM evidence rather than a headed screenshot; viewport narrowing reaches approximately 264 px list content.
- Embedded-Viewer-container narrowing, Firefox/Safari, a real mask-unsupported engine, native tooltip painting and screen-reader behavior were not exercised. The fallback seam is headed evidence for fallback presentation, not proof of a naturally mask-unsupported browser.
- The Reset confirmation was not separately captured; Delete exercises the shared banner presentation and the accepted DOM suite covers both confirmation semantics.

The headed-validation package is documentation/evidence only. Canonical implementation tests were not rerun because the production/test tree is the same uncommitted Addendum A implementation already independently tested and accepted; this review reverified the current diff and protected boundaries instead.

## Deferred work and next gate

L1–L8 remain deferred and untouched. CTM-7, CTM-8, persistence/history/background runs, resize work, separate-panel architecture, Core/Viewer Adapter/collision, G2/C6/C8/G3 and R20-1 remain outside this package.

**Blockers:** none.  
**Unresolved owner decision:** whether to accept/checkpoint the current implementation and headed evidence now; no product-design decision is reopened.  
**Exact next gate:** **owner checkpoint disposition / commit-push decision**.  
**Must not begin without explicit owner authorization:** commit/push; any remediation of Low L1 or the prior documentation-bookkeeping Low; CTM-7; CTM-8; L1–L8; additional headed/live runs; resize/separate-panel work; persistence/history/background runs; Core/Viewer Adapter/collision/G2/C6/C8/G3/R20-1 work; or another package/milestone.
