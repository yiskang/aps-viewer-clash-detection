# Clash Tests Manager — Manager UI Layout / Responsive Polish (Addendum A) — Implementation Package Final Report

Date: 2026-10-11 · Upstream implementation closeout. The earlier design/plan report
([UI-layout design final report](2026-10-11-clash-tests-manager-ui-layout-final-report.md)) keeps its historical role and was not rewritten as an implementation report (only its direct `§26.13` → `§26.14` cross-references were corrected, as authorized).

## 1. State

- Repository `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`, branch `main`, HEAD `fdb8643aa1987e5a1c96355d97a3deb6a0e9a9de`, `origin/main` identical (verified after `git fetch` before and at close).
- Starting tree (verified, not assumed): the reviewed design package present as docs-only working-tree changes (spec, plan, handoff modified; design final report, Independent Work Review and task briefs untracked); no production/test diff.
- Closing tree: **uncommitted, unpushed**. Modified: `clashpanel/ui/render/manager.js`; `test/clashpanel/dom/manager.dom.mjs`, `test/clashpanel/dom/managerComposition.dom.mjs`; spec, plan, handoff. New: `test/clashpanel/dom/managerLayout.dom.mjs`, `test/clashpanel/managerLayout.static.test.mjs`, this report; (untracked inputs: the three task briefs, design report, Independent Work Review).
- Protected paths (`clashpanel/core/**`, `clashpanel/ui/ClashDockingPanel.js`, `clashpanel/ui/render/panel.js`, other renderers, `clashpanel/viewer`, `clashpanel/ports.js`, `wwwroot/**` incl. `main.css`, Core/Adapter/collision, `server.js`, `routes`, `scripts`, `package.json`): **zero diff** (`git diff --stat -- <paths>` empty).

## 2. Authorization and governing artifacts

Owner authorization: implement plan Addendum A exactly as reviewed, plus the bounded `§26.13` → `§26.14` renumbering; no commit/push. Governing: spec **§26.14** (AC-UI1…AC-UI12), plan **Addendum A**, [Independent Work Review](../reviews/2026-10-11-clash-tests-manager-ui-layout-independent-work-review.md) (0C/0H/0M/1L; the Low is the renumbering), the [Option A owner record](../reviews/2026-10-10-clash-tests-manager-ui-architecture-owner-decision.md). Five owner-approved decisions applied: semantic list/item layout; 460 px preferred width kept; compact icon actions; `Active` badge replacing `(active)`; per-item deduplicated visible disabled reasons with every disabled control still linked. Production boundary re-verified against Addendum A before editing: only `clashpanel/ui/render/manager.js` — no discrepancy.

## 3. `§26.13` → `§26.14` documentation correction

The presentation amendment is now `26.14` in the spec (heading), with the three current-package cross-references updated: spec §26.10 ("see §26.14"), plan Addendum A (status paragraph and P1), the design package report (all its references), and the handoff. The original **§26.13 Gates and open items** and historical references to it (older spec final report; plan Self-review "§26.1–26.13"; Independent Work Review text) are unchanged. No decision, acceptance criterion or behavior text changed.

## 4. Delivered (production)

`clashpanel/ui/render/manager.js` only (147 lines changed):

- **List/item structure.** `table/caption/thead/tbody/tr/th/td` replaced by `p.clash-manager-caption#<ns>-manager-list-caption` + `ul.clash-manager-items[aria-labelledby=<caption id>]` + one `li.clash-manager-item[data-test-id][aria-current]` per test, creation order unchanged. Item children in reading order: head line (`.clash-manager-title` = `.clash-manager-name` + `.clash-manager-badge` when active, then the action group) → meta (`.clash-manager-mode`, `span.clash-manager-sep[aria-hidden]`, `.clash-manager-status` with the unchanged ` · ` joined text) → Set A → Set B (`Set A`/`Set B` label + value) → `.clash-manager-readiness` → `.clash-manager-reasons` (only when an action is disabled).
- **Actions.** `div[role=group][aria-label="Actions for “<name>”"]` of four native `<button type="button">` in the existing order Open, Duplicate, Reset results, Delete test, each with the unchanged `data-key` (`manager-<id>-<rowIndex>`), unchanged `aria-label` (`<Label> “<name>”`), `title` = bare label, native `disabled` exactly as before, the same click → `dispatch({type, testId})`. Each holds an `aria-hidden` icon span and a hidden text span.
- **Icons.** CSS `mask-image` + `-webkit-mask-image` data-URI SVG glyphs painted with `currentColor` (pencil, duplicate squares, counter-clockwise arrow, trash), all in `MANAGER_CSS` (precedent: toolbar icon). No icon font/library/emoji/DOM-built SVG. Fallback: `@supports not ((mask-image:none) or (-webkit-mask-image:none))` and the identical test-seam class `.clash-manager-no-mask` show text labels (fallback buttons `height:auto;min-height:28px`, action group wraps).
- **Active state.** Visible `Active` badge + `aria-current="true"` on the item + a decorative left accent bar. No `(active)` suffix.
- **Disabled reasons.** One `p.clash-manager-reason-row` per distinct reason (first-disabled-action order) = `span.clash-manager-reason-for` ("Open, Reset results, Delete test: ") + `span.clash-manager-reason#<ns>-manager-<i>-reason-<k>` (exact gate reason); every disabled button's `aria-describedby` targets the shared element; native `disabled` unchanged; distinct reasons stay distinct rows.
- **Responsive.** All rules scoped to `.clash-manager-list`, with specificity above the panel-wide `.clash-panel-root *` reset: head line `flex-wrap`; name `min-width:10ch`, Set values `min-width:12ch`; name/Set values clamped to 2 lines (explicit 16 px line-height) with `title` = full text; mode/status/readiness/reasons/badge never clamped (`overflow-wrap:break-word; word-break:normal`); action group `flex:none` (wraps as a unit below the name); `container-type:inline-size` + `@container (max-width:279px)` puts actions on their own row and stacks the Set label over its value. No viewport `@media`.
- **Width.** Shell geometry untouched (`min(460px,90vw)` / `min(340px,90vw)` / `90vw`); the renderer never reads or writes width; Manager ↔ Editor switching leaves `container.style.width` unchanged; no resize feature.

## 5. Tests

New: `test/clashpanel/dom/managerLayout.dom.mjs` (10 tests: AC-UI1/2 structure + badge; meta/status separator; AC-UI3/11 icon actions — names, titles, order, 28×28, ≥4 px gaps, aria-hidden icons, mask data-URIs, Tab order, Enter/Space/click intents, focus ring; AC-UI4 dedup + links + non-operability; AC-UI6/7 10 000-char names at 240/280/340/436 px — no overflow, ≥10ch/12ch with a same-font `ch` probe, ≤2 lines, `title` = full text, status/readiness unclamped, actions inside item; responsive tiering and non-shrinking action group; 300/280 px supported-floor behavior; icon fallback at all four widths; AC-UI8 renderer writes no width; hostile-name inertness in `aria-label`/`title`) and `test/clashpanel/managerLayout.static.test.mjs` (4 offline guards: AC-UI12 no `innerHTML`/`createElementNS`/`<svg` outside the CSS block/emoji; AC-UI8/9 no width/geometry API in `manager.js`, shell geometry strings intact, `main.css` has no manager rules; `data-key`/`aria-label`/gate wiring and no table elements; no `@media`).
Existing-test edits (structural selectors only, as enumerated in Addendum A): `manager.dom.mjs` list-view test (rows now read `.clash-manager-item` name + `Active` badge + `aria-current`; caption selector) and the hostile-name selector; `managerComposition.dom.mjs` row selectors (`.clash-manager-table tbody tr` → `.clash-manager-list .clash-manager-item`) plus one **added** E2E test (AC-UI8: real shell width identical across view switches and a width set from outside survives both switches). The behavioral/dispatch/confirmation/focus/a11y assertions (`manager-open-1`… dispatches, Reset label + reason lookup, confirmation banner, live region, M1/M2, fault locks) are **unchanged and pass**; `shell.dom.mjs` and `managerViewModel.test.mjs` are unmodified.
TDD: tests were written first and run red (12 failing of 136 DOM tests) before the renderer was changed; two of the three layout failures found afterwards were test-fixture/measurement mistakes, one a genuine CSS bug (column-flex `flex-basis` on Set values), all fixed.

## 6. Verification (fresh runs)

- Focused: `node --test test/clashpanel/dom/managerLayout.dom.mjs` → 10/10 pass; with `manager.dom.mjs` + `managerComposition.dom.mjs` → 27/27 before the final review fix; `test/clashpanel/managerLayout.static.test.mjs` → 4/4.
- Canonical `npm test` (offline + DOM), first run after implementation: exit 0 — offline **5613 total / 5612 pass / 0 fail / 1 todo** (baseline 5609/5608: +4 static tests); DOM **136/136** (baseline 125: +10 layout, +1 composition). **Final run after the internal-review fix (final code): exit 0 — offline 5613 total / 5612 pass / 0 fail / 1 todo; DOM 136/136 (identical counts).** Focused `managerLayout.dom.mjs` after the fix: 10/10.
- `git diff --check` clean; protected-path diff empty (§1). No CTM-7, CTM-8 or headed run was performed.

## 7. Protected architecture and semantics

Unchanged: single-panel Manager/List ↔ Editor, headless manager, one editor controller, active-test-only residency, Viewer ownership, recovery/terminal-fault, readiness/stale, departure/re-entry, Create/Open/Duplicate/Reset/Delete and switching semantics, Set A/B identity and label scope, confirmations, live announcements, ViewModel keys (row key-list test untouched), `MANAGER_TEXT`, intents/dispatch contracts, public API, Core/Adapter/collision.

## 8. Disclosures

1. The per-button reason element ids changed from `<ns>-manager-<i>-<action>-reason` to the shared `<ns>-manager-<i>-reason-<k>` (inherent in the owner-approved dedup); no test or code referenced the old pattern (tests resolve the reason through `aria-describedby`).
2. The `Active` badge replaced the ` (active)` text; the old row-header text assertion was updated accordingly.
3. Chromium DOM tests are the evidence for layout; the internal Codex reviewer could not execute Chromium in its read-only sandbox (`EPERM`) and reviewed statically.
4. Real non-Chromium engines (Firefox/Safari, absent-mask behavior) were not run; the fallback is verified through the `.clash-manager-no-mask` seam and the presence of the production `@supports not` rule (per spec §26.14).

## 9. L1–L8

None remediated. The list still rebuilds through `rebuild(list, …)` with the same row-index `data-key` scheme and `dom.js` focus restoration (L1/L5 unchanged; no new focus assertion — L7 unchanged). L3 copy strings untouched; L2, L4, L6, L8 not touched. No conflict with a deferred contract arose, so no stop was required.

## 10. Internal review (bounded)

One `codex-review code` (medium) of the production diff, tests and §26.14 contract (request `20261011-010746-73440-23133`): 0 Critical / 0 High / 2 Medium / 1 Low; **no dispatch, confirmation, focus-restoration, data-key or geometry regression found.**

| # | Finding | Disposition |
| --- | --- | --- |
| M1 | No-mask text fallback can overflow/clip at the 240 px floor (fixed 28 px height, non-wrapping action row) | **Accepted, fixed** — fallback adds `height:auto;min-height:28px` and `flex-wrap:wrap` on the group (both in the `@supports not` rule and the seam) |
| M2 | Fallback test only exercised the wide layout | **Accepted, fixed** — runs at 240/280/340/436 px asserting no overflow, labels/buttons inside the item, text inside its button, ≥28×28 |
| L1 | 280 px degradation assertion nearly vacuous (`content > 0`) | **Accepted, fixed** — asserts full DOM text, actions on their own row, inside the item, no root overflow, width not increased |

No finding was rejected; no finding required protected-architecture, deferred-Low, or public-API changes.

## 11. Headed / visual status

Not run. The headed layout pass (plan Addendum A) is a separate, later, separately authorized gate; CTM-7 and CTM-8 not run. Layout evidence in this package is DOM/computed-geometry in real Chromium only.

## 12. Exact next gate

**Independent Work implementation review** of the Clash Tests Manager UI Layout / Responsive Polish package. Not self-authorized. Remains unauthorized: commit/push, the headed layout pass, CTM-7, CTM-8, L1–L8 remediation, resize feature, persistence/history/background runs, Core/Adapter/collision, G2/C6/C8/G3, R20-1, separate-panel architecture, any new milestone.
