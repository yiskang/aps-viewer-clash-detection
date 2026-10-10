# Clash Tests Manager — Manager UI Layout / Responsive Polish Addendum A Implementation — Independent Work Review

**Date:** 2026-10-11  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `fdb8643aa1987e5a1c96355d97a3deb6a0e9a9de`  
**Origin relation:** `HEAD == origin/main`  
**Working tree:** uncommitted and unpushed implementation, tests and documentation; production diff is limited to `clashpanel/ui/render/manager.js`  
**Governing design / plan:** Viewer Clash Panel design §26.14 (AC-UI1…AC-UI12); Clash Tests Manager implementation plan Addendum A  
**Read-only upstream input:** `docs/research/2026-10-11-clash-tests-manager-ui-layout-implementation-final-report.md`  
**Prior authority:** `docs/reviews/2026-10-11-clash-tests-manager-ui-layout-independent-work-review.md`  
**Verdict:** **implementation accepted; ready for owner decision on headed visual validation / checkpoint disposition**  
**Findings:** **0 Critical / 0 High / 0 Medium / 1 Low**

## Review scope and method

This review independently read `CLAUDE.md`, the current handoff, §26.14, Addendum A, the prior UI-layout Independent Work Review, the owner authorization brief, the upstream implementation final report, the complete production/test/documentation diff and the directly affected renderer and tests. The handoff and upstream report were treated as navigation and claims to verify, not proof. The upstream final report was preserved unchanged.

The codebase-memory graph was used for structural discovery and call-boundary verification, followed by direct source/diff reads. Coverage checks reported no recorded issue for every relied-on source, test and documentation path. Repository and test evidence was reproduced from disk.

No production implementation, test, governing spec/plan or upstream final report was modified by Work.

## Verdict and readiness

Addendum A is implemented within its authorized presentation boundary. The seven-column table is replaced by a labelled semantic list without changing manager state, action intent, controller composition, Viewer ownership, held-result residency or public APIs. The owner-approved 460 px preferred width remains unchanged. Compact icon actions, the visible `Active` badge and per-item reason deduplication satisfy §26.14 while preserving native disabled behavior, confirmations and accessible names.

No implementation blocker remains. The absence of the separately authorized headed visual pass limits this review to source, Chromium DOM/computed-geometry and automated acceptance evidence; it does not invalidate the Addendum A implementation checkpoint.

## Findings

### Low L1 — current governing-document status labels still describe the pre-implementation gate

Spec §26.14 still says “design only — not implemented; implementation not authorized,” and Addendum A's heading/final non-authorization line retain the same pre-authorization state. The durable owner authorization brief, implementation diff, upstream implementation report and current handoff establish that implementation was subsequently authorized and completed, so this does not create a code or acceptance contradiction. The upstream final report also says there are three untracked task briefs while `git ls-files --others --exclude-standard docs/prompts` shows two.

**Impact:** documentation bookkeeping only; no behavior, test, scope or current gate is ambiguous when the current handoff and authorization brief are followed.  
**Minimum correction:** the responsible package agent may reconcile the current spec/plan status labels and task-brief count during a separately authorized documentation/checkpoint closeout. Preserve the upstream final report as read-only; record any correction in a new upstream-owned artifact or other authorized current-status document.

## Implementation acceptance against §26.14 / Addendum A

- **Structure and semantics (AC-UI1/2/7/11):** `renderList` creates the visible caption plus `ul[aria-labelledby]`; each test is one ordered `li[data-test-id]`. The item reading order is head, meta, Set A, Set B, readiness and conditional reasons. Only the active item gets `aria-current="true"` and the exposed `Active` badge. Status/readiness strings and the decorative hidden separator remain distinct and unclamped.
- **Actions and accessibility (AC-UI3/4/5/10/11):** the four native buttons retain action order, `data-key`, `aria-label`, intents, test id, confirmations and native `disabled`. Each has a bare-label `title`, an `aria-hidden` glyph and a 28×28 minimum hit area. Equal reasons are grouped by exact string in first-disabled-action order, rendered once, and referenced from every disabled action they explain; distinct reasons remain separate. Existing confirmation, live-region, terminal-fault and manager-composition tests remain green.
- **Responsive layout and width (AC-UI6/8):** list-local flex/container rules preserve 10ch/12ch minimums, two-line clamps and complete DOM/title text. Shell geometry is unchanged, the renderer has no width API, and the real shell composition test proves a 410 px externally supplied width survives Manager ↔ Editor switches. The 240/280/340/436 px geometry tests pass with no root overflow.
- **Icons and fallback (AC-UI3/12):** glyphs are Manager-local CSS mask data URIs using `currentColor`; no dependency, asset, DOM SVG, emoji or HTML injection was introduced. The production `@supports not` fallback and deterministic seam use the same declaration source.
- **Architecture and scope (AC-UI9):** the only production diff is `clashpanel/ui/render/manager.js`. Core, DockingPanel shell, `panel.js`, other renderers, Viewer, ports, shared CSS, package, server, routes, scripts, Adapter and collision paths have zero diff. Manager ViewModel/intents/controller/public API are unchanged.

## Internal-review fix verification

The 240 px fallback-overflow correction is effective: fallback buttons use automatic height with a 28 px minimum and the action group wraps. The focused Chromium test exercises fallback mode at 240, 280, 340 and 436 px and verifies root overflow, item containment, button/text containment, visible labels and minimum hit areas. The former wide-only test gap is therefore closed.

The two formerly weak assertions are now material:

- the fallback test covers every required width and would fail the earlier fixed-height/non-wrapping fallback;
- the 280 px degradation branch verifies full DOM text, a separate action row, item containment, no root overflow and no renderer-induced width increase rather than merely asserting positive width.

These are behavioral geometry checks, not markup snapshots.

## Verification reproduced

- Focused `node --test test/clashpanel/dom/managerLayout.dom.mjs`: **10/10 pass**.
- Canonical `npm test`: exit 0; offline **5,613 total / 5,612 pass / 0 fail / 1 existing todo**; Chromium DOM **136/136 pass**.
- `git diff --check`: clean.
- Protected-path diff: empty.
- `main` and `origin/main`: both `fdb8643aa1987e5a1c96355d97a3deb6a0e9a9de`.

The existing todo is the known containment-query gap and is unrelated to this package. The canonical pretest's vendor synchronization created no repository diff.

## Deferred L1–L8 and protected boundaries

L1–L8 remain deferred and untouched. In particular, the list still rebuilds, action keys remain row-index based, and no focus-restoration claim or remediation was introduced (L1/L5/L7). Existing copy, fault-description replacement, lifecycle defenses, non-settling dispatch and documentation debt are unchanged (L2/L3/L4/L6/L8). No headed visual pass, CTM-7, CTM-8, persistence/history/background-run work, resize feature, separate-panel work or Core/Adapter/collision change occurred.

## Evidence and remaining gate

Automated Chromium evidence supports the semantic, interaction, fallback, pathological-name, responsive-width and width-invariance contracts. No headed screenshots or real Viewer visual/product evidence were produced, and this review makes no headed visual, tooltip-on-disabled-control, real non-Chromium fallback or screen-reader claim.

**Blockers:** none.  
**Exact next gate:** owner decision on whether to authorize the headed visual validation package or accept/dispose the implementation checkpoint without it.  
**Must not begin without explicit owner authorization:** headed visual validation; checkpoint commit/push; CTM-7; CTM-8; L1–L8 remediation; persistence/history/background runs; resize or separate-panel work; Core/Viewer Adapter/collision/G2/C6/C8/G3/R20-1 work; or another package/milestone.
