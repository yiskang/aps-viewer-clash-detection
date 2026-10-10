# Clash Tests Manager — Manager UI Layout / Responsive Polish — Design + Plan Package Final Report

Date: 2026-10-11 · Package type: bounded **design + implementation-plan amendment only** (no production code).

## 1. State (verified at start; re-verified at close — see §18)

- Repository `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`, branch `main`, HEAD `fdb8643aa1987e5a1c96355d97a3deb6a0e9a9de`, `origin/main` identical (after `git fetch`). Owner-decision checkpoint `fdb8643` is pushed.
- Working tree at start: **not literally clean** — one untracked file, the task brief `docs/prompts/for-claude-clash-tests-manager-ui-layout-responsive-polish-design-plan.md` (the brief itself); no tracked changes. At close the tree is dirty only with this package's docs (listed in §14).
- Protected paths (Core, Adapter, collision, ports, host, package files, all production JS/CSS, all tests): untouched.
- **Not committed, not pushed** (as instructed).

## 2. Authorized scope and governing artifacts

Authorized: Manager UI layout / responsive polish **design + spec/plan amendment** only. Read: `CLAUDE.md`, `docs/handoffs/latest.md` (top entries), [owner-decision record](../reviews/2026-10-10-clash-tests-manager-ui-architecture-owner-decision.md), spec §26 (§26.7, §26.8, §26.10, §26.12), the 13-task plan (Task 11 and the closing sections), the targeted M1/M2 and implementation Independent Work Reviews (for L1–L8), the Clash Tests Manager final report (format). Repository state, not conversation, was treated as authoritative. Option A (single Docking Panel, Manager/List ↔ Editor) is **not** reopened.

## 3. Owner-decision record

2026-10-10: owner ratified Option A. This package keeps one panel, the headless manager, one editor controller, active-test-only result residency and Viewer ownership. Three **new** presentation decisions are surfaced for the owner in §14 (CTM-UI-OD1…CTM-UI-OD3); none is guessed closed.

## 4. Current UI problem (evidence from the code)

- `clashpanel/ui/render/manager.js:176` renders `table.clash-manager-table` with 7 columns (Test, Mode, Set A, Set B, Status, Readiness, Actions); `MANAGER_CSS` sets `table-layout:fixed; width:100%` with **no column widths**, so every column is equal: ≈ 62 px each at the 460 px default and ≈ 46 px at the 340 px minimum. Cells have 2/4 px padding.
- `PANEL_CSS` (`panel.js:39-46`) applies `min-width:0; overflow-wrap:anywhere; word-break:break-word` to **every** descendant, so any narrow cell breaks mid-word — the one-character-per-line symptom the owner saw. Four text buttons (padding 6/10 px) per Actions cell worsen it.
- ` (active)` is appended to the name inside the row-header cell (`manager.js:153`), consuming scarce width.
- Disabled reasons are visible blocks per disabled button (`.clash-manager-reason{display:block}`), repeated up to three times per row while a run is active.

## 5. Implementation / CSS / icon-convention audit

Three parallel read-only audits (renderer/CSS/shell; icons/accessibility/spec-plan clauses; L1–L8/governance) were run and verified against source; full notes are in the session scratchpad (not repository artifacts). Key facts:

- **Shell** (`ClashDockingPanel.js:38-47`, inline styles): width `min(460px, 90vw)`, min `min(340px, 90vw)`, max `90vw`, height `calc(100% - 80px)`, `resize:none`. One DockingPanel hosts both views by hiding/showing (`renderManagedPanel`). No ResizeObserver / `setSize` / `getContainerBoundingRect` code; width is never written after `initialize`.
- **Viewer resize facts** (static check of the Viewer **7.124.2** bundle, gunzipped from the CDN URL in `wwwroot/index.html:46`): the base `DockingPanel.initialize` adds a footer with a `ResizeFooter` handle when `options.addFooter` is true; `ClashDockingPanel.initialize()` **overrides** it and never calls `createFooter`, and no repo code passes `addFooter`. Therefore **no user-resize affordance exists today** for this panel. The base `onViewerResize` can only *shrink* the container width/height to fit a smaller viewer. The panel can be dragged (title bar). Headed confirmation is a later gate (§12). *This check read a downloaded vendor bundle and is not a repository artifact; the claim is recorded here as the evidence.*
- **Styling**: `--nv-*` tokens on `.clash-panel-root` (light theme only — no dark theme exists), plain `<button>`s styled to mimic native `.adsk-button`; focus ring 2 px `--nv-accent-focus`; disabled opacity .4; no danger/icon style; no `@media`/`@container` anywhere.
- **Icons**: nothing reusable for edit/copy/reset/delete exists. The only precedent is the toolbar icon, an inline-SVG **data-URI `background-image`** (`wwwroot/main.css:165-173`), plus the `↔` glyph with `aria-label`. No `<svg>` elements, icon fonts, `adsk-icon-*` usage; `el()` has no SVG-namespace helper and `domIsolation` forbids `innerHTML`. No Viewer CSS is vendored, so no Viewer-native icon class can be verified from the repository.
- **Accessibility**: native `disabled` (not focusable) + visible sibling reason linked by `aria-describedby` (tests read the reason through the id); one persistent `role="status"` live region; confirmation is a `role="alertdialog"` banner.
- **Fixed English strings**: none of the visible labels drives logic (intents are dispatched by id). Load-bearing strings are `data-key`s (focus restoration, fault locks, tests) and `data-banner-id`, which the design keeps. New display-only labels (`Set A`, `Set B`, `Active`) carry no logic.

## 6. Proposed Manager layout

Normative text: **spec §26.14**. Summary — a semantic list (`ul`/`li`), not a restyled table (setting `display:grid/flex` on `tr/td` strips table semantics in Chromium/Safari):

```
Clash tests (this session only)                      [New test]
┌──────────────────────────────────────────────────────────┐
▌ Clash test 1  [Active]            [✎] [⧉] [↺] [🗑*]      │  head: name · badge · actions
▌ Hard · Not run                                             │  meta: mode · existing status text
▌ Set A  Architecture                                        │  clamp 2 lines, title=full
▌ Set B  Mechanical + Structure                              │  clamp 2 lines, title=full
▌ Setup complete — readiness to run is checked when opened   │  wraps, never clamped
└──────────────────────────────────────────────────────────┘
(* glyphs are illustrative — they are CSS mask icons, never emoji)
```

Scan order: test + active + actions → mode/run state → Set A → Set B → readiness → disabled reasons (only when relevant). DOM order equals visual order. "Hard · Not run" is two elements (`.clash-manager-mode`, `.clash-manager-status`) so the pinned status text and ` · ` joiner stay byte-identical.

## 7. Panel sizing contract

- Shell geometry **unchanged** (460 preferred / 340 min / 90vw max). Widening alone is *not* the fix; the structure is.
- **Manager and Editor share one width.** View switching never reads or writes width → user drag/viewer clamp results are preserved by construction. No auto-resize on switch, under any condition.
- User resize: not currently offered (§5). The contract is width-agnostic for any content width from the **240 px content floor**, guaranteed for a viewport and Viewer container ≥ 300 px (below that: unsupported but safe degradation — see spec §26.14) up to the maximum, so adding a resize handle later needs no list change.
- Tiers by the list's own width *W* (flex-wrap / container query, never viewport media queries): normal ≥ 360, moderate 280–359, floor 240–279 (§26.14).
- CTM-UI-OD1 (below) records the alternative of a larger preferred width.

## 8. Responsive behavior

| Field | Normal / moderate / floor | Truncate? | Full value |
| --- | --- | --- | --- |
| Name | ≤ 2 lines, min 10ch; action group wraps below rather than shrinking it | ellipsis after 2 lines | `title` + full DOM text |
| Set A / Set B value | ≤ 2 lines, min 12ch; at floor the label stacks above | ellipsis after 2 lines | `title` + full DOM text |
| Mode, status, readiness, reasons, badge | wrap at words; break an unbroken token only if it alone exceeds the line | **never** | DOM text |
| Actions | `flex:none` group of 28×28 icon buttons, 4 px gap; wraps as a unit | no | accessible names |

Pathological wrapping is prevented by (a) minimum inline sizes with specificity above `.clash-panel-root *{min-width:0}`, (b) `overflow-wrap:break-word; word-break:normal` on list elements (overriding `break-word`/`anywhere`), (c) wrapping the head line instead of shrinking the name, (d) clamping instead of growing. Layout never depends on short model names (hostile 10 000-character names are acceptance inputs).

## 9. Action / icon accessibility contract

| Action | Meaning / glyph (CSS mask) | `aria-label` (unchanged) | `title` | Notes |
| --- | --- | --- | --- | --- |
| Open | pencil | `Open “<name>”` | `Open` | the user's "Open/Edit"; label text stays `Open` (no semantic rename) |
| Duplicate | two overlapping squares | `Duplicate “<name>”` | `Duplicate` | |
| Reset results | counter-clockwise arrow | `Reset results “<name>”` | `Reset results` | existing confirm when unsaved results would be discarded |
| Delete test | trash can, **last** position | `Delete test “<name>”` | `Delete test` | always confirms; distinct glyph + position, not color alone |

Common: native `<button type="button">`; keyboard Enter/Space; `:focus-visible` 2 px ring (existing rule); native `disabled` (non-focusable, non-operable — semantics unchanged); visible reason linked by `aria-describedby`; decorative icon `aria-hidden`; hit area ≥ 28×28 at every supported width; `currentColor` masks inherit hover/disabled colors; text-label fallback where mask is unsupported; confirmation banners and confirm labels unchanged. Native Viewer icons could not be verified (not vendored), and no icon library is introduced.

## 10. Exact files expected to change later (not changed now)

Production (only): `clashpanel/ui/render/manager.js` (`MANAGER_CSS`, `renderList`, `row`, `actionCell` + helpers). `wwwroot/main.css` has a zero diff (icon masks live in `MANAGER_CSS`).
Tests: `test/clashpanel/dom/manager.dom.mjs` (:13-33, :229-240 selector edits; :35-47 unchanged), `test/clashpanel/dom/managerComposition.dom.mjs` (:34-51, :127-151 count selectors), new manager-layout DOM test file, a static source-shape guard addition. **Unchanged and must still pass:** `shell.dom.mjs` geometry, `managerViewModel.test.mjs` row key list, `testsManager.*`, `hostStyles.test.mjs`, fault-lock/live-region/confirmation tests.
Docs: governing spec §26.14 (done), plan Addendum A (done), later final report/handoff.

## 11. Spec / plan amendment summary

- **Spec:** (1) §26.10 first sentence reworded minimally: "row header" → "primary label (the table row header, or the list item's name element — see §26.14)". (2) New **§26.14** (presentation contract + AC-UI1…AC-UI12) appended at the end of §26, labeled *owner-authorized UI-presentation amendment, design only*. §26.7, §26.8, §26.9, §26.11, §26.12 and AC-M1…M19 untouched; no behavioral or architectural clause changed.
- **Plan:** new **Addendum A** appended after the Self-review; Tasks 1–13 and the completed implementation history are untouched and explicitly marked historical. Addendum A lists tasks P1–P4, the zero-diff guard, the enumerated structural test edits, new tests, the later headed pass, and the L1–L8 analysis.
- Task 11 text intentionally still describes the *as-built* table.

## 12. Acceptance criteria

Automated (spec AC-UI1…12, plan Addendum A tests 1–8): no table elements; one `li` per test; active badge/`aria-current`; icon-only actions with unchanged `aria-label`, `title`, ≥ 28×28 hit area, Tab order, Enter/Space; disabled non-operable with visible reason linked by `aria-describedby`; confirmations unchanged; hostile 10 000-char names at 240/280/340/436 px with no overflow, minimum sizes, ≤ 2 lines, `title` = full text, un-clamped status/readiness; shell geometry strings and width identical across view switches; zero-diff guard on protected files; no `innerHTML`/SVG-DOM/emoji.

Later **headed** visual acceptance (separate authorization; not CTM-7): scenario list in plan Addendum A (460/340/320 px, hostile Autodesk model names, all row states and disabled-reason combinations, hover/focus/disabled of every icon, contrast, tooltip behavior on disabled buttons, panel dragged then switched, viewport shrink clamp, keyboard-only, screen-reader spot check, toolbar-overlap observation), packaged like the grouping evidence (`MANIFEST.sha256` + README scenario table). Also confirms the static finding that no resize affordance is present.

## 13. Protected semantics, deferred work, L1–L8

- **Protected / unchanged:** single-panel architecture, headless manager, one editor controller, active-test-only residency, Viewer ownership, recovery, terminal fault, readiness/stale, departure/re-entry, creation/Open/Duplicate/Reset/Delete semantics, confirmations, active switching, Set A/B identity and label scope, public API, dispatch contracts, result ownership, all copy strings. The manager ViewModel row key list is pinned.
- **Deferred / unauthorized:** CTM-7, CTM-8, L1–L8, persistence/history/background runs/lifecycle, resize feature, G2/C6/C8/G3, R20-1, Core/Adapter/collision.
- **L1–L8 interaction:** L1 (focus falls to body after rebuild), L5 (index-based `data-key` focus restoration), L7 (missing focus DOM tests) touch the Manager list rebuild. The design **keeps the `data-key` scheme and rebuild model**, so their behavior is unchanged and the layout change proceeds **without** remediating them; new tests must not pin focus restoration either way. L3 (two wording nits): all strings unchanged — no overlap. L2/L4/L6/L8: no overlap. No L-remediation is required, so no owner stop is triggered; if implementation finds otherwise it must stop (plan Addendum A).

## 14. Owner decisions surfaced (not guessed closed)

- **CTM-UI-OD1 — Preferred width.** Recommendation: keep `min(460px,90vw)`/340/90vw (layout fixes the problem; `shell.dom.mjs` unchanged). Alternative: raise the preferred width (e.g. 520) — changes a pinned shell test and does not fix narrow behavior.
- **CTM-UI-OD2 — Icon mechanism.** Recommendation: CSS `mask-image` data-URI glyphs with `currentColor` (precedent: toolbar icon), text-label fallback. Alternatives: a tiny DOM-SVG helper (`createElementNS`; needs a static-guard exception) or Unicode glyphs (inconsistent rendering). No library, no emoji.
- **CTM-UI-OD3 — Presentation text replacements.** `(active)` → `Active` badge; per-button visible reasons → one visible reason per distinct reason per item. Requires the enumerated structural test edits. Recommendation: accept.

**Implementation remains not authorized** until the owner accepts CTM-UI-OD1…CTM-UI-OD3 and explicitly authorizes Addendum A.

## 15. Internal review

One bounded Codex review (`codex-review spec`, medium; request `20261011-002201-25971-29108`) of a bundle of spec §26.14 + plan Addendum A + this report. Verdict: *requires major revision*; 2 Critical, 4 High, 1 Medium, 4 clarifications. **Every finding was independently checked against the repository and accepted** (none rejected); all were in-scope documentation fixes, applied once. No second full review was run (CLAUDE.md review boundary); the revised areas were re-read for consistency only.

| # | Finding | Disposition |
| --- | --- | --- |
| C1 | New OD-1…3 collide with the spec's existing OD-1…OD-14 (§17) | **Accepted** — renamed `CTM-UI-OD1…3` everywhere in this package; spec/plan state the namespace is distinct; stale "§16" reference corrected to §14 |
| C2 | 240 px floor does not cover widths reachable from `min(340px,90vw)`/`90vw` | **Accepted** — supported minimum declared: viewport and Viewer container ≥ 300 px (guarantees ≥ 240 px content); below is unsupported-but-safe-degradation; viewport ≠ embedded container distinguished; narrow-container headed check and 300/280 px tests added |
| H1 | "No copy change / every string from the ViewModel" is false (`Active`, `Set A/B`, group name, annotations) | **Accepted** — spec now separates ViewModel copy (unchanged) from an enumerated list of renderer-owned fixed-English literals; no localization mechanism in scope |
| H2 | Visible caption does not label the `ul` | **Accepted** — namespaced caption id + `ul[aria-labelledby]`; AC-UI11/test 9 assert resolved accessible names |
| H3 | `CSS.supports` stubbing cannot drive an `@supports` fallback test | **Accepted** — deterministic seam class `.clash-manager-no-mask` selecting the same fallback declarations, plus a static check that the production `@supports not` rule exists |
| H4 | Optional `main.css` edit contradicts AC-UI9 zero-diff | **Accepted** — masks live in `MANAGER_CSS`; `main.css` zero diff (AC-UI9 names it) |
| M5 | 28 vs 24 px ambiguity; `ch` and line-count measurement not mechanical | **Accepted** — 28×28 at every supported width; same-font `ch` probe; explicit numeric `line-height` for clamped fields |
| Q1 | Meta separator undefined | **Accepted** — `span.clash-manager-sep[aria-hidden]`; `.clash-manager-status.textContent` unchanged (test 10) |
| Q2 | Reason-annotation markup undefined | **Accepted** — `div.clash-manager-reasons` / `p.clash-manager-reason-row` / `span.clash-manager-reason-for` + `span.clash-manager-reason`; dedup + order test |
| Q3 | Browser matrix unstated | **Accepted** — evergreen Chromium mandatory, Firefox/Safari best-effort, text fallback mandatory wherever mask unavailable |
| Q4 | Fixed English literals | **Accepted** — same as H1 |

Classification of remaining concerns: none are design/spec correctness blockers; CTM-UI-OD1…3 are product decisions; real-engine fallback behavior and the user-resize/tooltip observations are verification gates (headed pass). The Codex review did not find any behavior change, a11y regression beyond the above, or reopening of the separate-panel architecture.

## 16. Run / reproduction

No code was run beyond `git fetch`/`git status` and a one-off download of the Viewer 7.124.2 bundle into the session scratchpad for the resize check. No tests were run (no code changed). Baseline test numbers quoted in the handoff (offline 5609/5608/0/1todo, DOM 125/125) are from the accepted checkpoint, not re-run.

## 17. Next gate

Ready for **independent Work review / owner implementation authorization**. Recommended (not authorized) next action: owner decides CTM-UI-OD1…CTM-UI-OD3 and authorizes Addendum A; Work writes the Independent Work Review Report; then the package agent adjudicates before implementing.

## 18. Close-state verification

Verified at close with `git status` / `git diff --stat` (see the final chat summary for the exact output): only documentation files changed — spec (`docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`), plan, this report, `docs/handoffs/latest.md`; plus the untracked task brief. Zero diff in `clashpanel/`, `wwwroot/`, `test/`, `scripts/`, Core/Adapter/collision, package files. No commit, no push. No tests were run (no code changed); `git diff --check` run on the docs.
