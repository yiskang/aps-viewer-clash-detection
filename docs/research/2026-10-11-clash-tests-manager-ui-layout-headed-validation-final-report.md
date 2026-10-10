# Clash Tests Manager — Manager UI Layout / Responsive Polish — Headed Visual Validation Final Report

Date: 2026-10-11 · Package type: bounded headed visual/product validation only. No production code, test, spec or plan was edited by this package; no commit or push.

## 1. State (verified)

- Repository `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`, branch `main`, HEAD `fdb8643aa1987e5a1c96355d97a3deb6a0e9a9de`, `origin/main` identical (after `git fetch`, before and at close).
- Working tree: the accepted Addendum A implementation, **uncommitted/unpushed**, exactly as reviewed — modified `clashpanel/ui/render/manager.js`, `test/clashpanel/dom/manager.dom.mjs`, `test/clashpanel/dom/managerComposition.dom.mjs`, spec, plan, handoff; untracked new tests, reports, reviews, prompts. This package adds only documentation/evidence (this report, the evidence directory, a handoff entry). `git status` tracked-modified list is unchanged by validation.
- Governing: spec §26.14 (AC-UI1…12), plan Addendum A, [implementation final report](2026-10-11-clash-tests-manager-ui-layout-implementation-final-report.md), [implementation Independent Work Review](../reviews/2026-10-11-clash-tests-manager-ui-layout-implementation-independent-work-review.md) (0C/0H/0M/1L doc bookkeeping; not in this package's scope), [Option A owner record](../reviews/2026-10-10-clash-tests-manager-ui-architecture-owner-decision.md).

## 2. Scope and method

Validate the implemented UI in a real headed APS Viewer session; observe, adjudicate, persist evidence, stop. **Launch:** `PORT=8080 node server.js` (credentials from the existing `.env`, not read); Playwright MCP headed Chrome 155, macOS, DPR 1; open `http://localhost:8080/#<Audubon Architecture URN>`, tick "Load as additional model", load the Structure and Mechanical URNs (3 models), open the Clash Panel from the toolbar (normal app, not the demo path). Viewer 7.124.2 (CDN pin). State: four tests (one run to completion, one with a 154-character realistic name and a 3-model Set A, one with an 87-character unbroken name, one not run). Narrow widths were produced by narrowing the browser viewport (360 px → panel 324 px; 300 px → panel 270 px, the supported minimum); width probes read `style.width` and `getBoundingClientRect` before/after view switches; icon fallback was exercised through the documented `.clash-manager-no-mask` seam class toggled from the console (no source change). The server was stopped and the browser closed afterward.

## 3. Evidence

Directory: [`docs/research/evidence/2026-10-11-manager-layout-headed/`](evidence/2026-10-11-manager-layout-headed/README.md) — 19 PNGs, `MANIFEST.sha256` (verified with `shasum -a 256 -c`), README with scenario table. All 19 screenshots were reviewed by the agent; none was deferred to the owner.

## 4. Scenario adjudication

| Required scenario | Result | Evidence / adjudication |
| --- | --- | --- |
| 1 Normal Manager view, 460 px | **PASS** | ML-01. Name · Active badge · icon actions → mode · status → Set A → Set B → readiness → reasons reads top-to-bottom; items are separated cards; no horizontal overflow |
| 2 Narrower Panel | **PASS (caveat)** | ML-02/02b (324 px), ML-03 (270 px supported minimum). No overflow (318/318, 264/264); no one-character-per-line; at 264 px list width the container query puts actions on their own row and stacks Set label over value; actions remain 28×28 and usable. Caveat: native Viewer toolbar overlaps the panel bottom at narrow viewports (pre-existing) |
| 3 Long content | **PASS (caveat)** | ML-04, ML-02, ML-08c. Name clamps to two lines with ellipsis; Set values clamp at narrow widths; `title` equals the full text on every clamped element; full text is in the DOM. Caveat: no live Set label longer than the three real model names exists; 10 000-character values are covered by the DOM suite; native tooltip painting is not capturable |
| 4 Active state | **PASS** | ML-05a: pill badge text `Active`, accent bar, tint, `aria-current="true"`; no `(active)` text (DOM assertion) |
| 5 Action controls | **PASS** | ML-06a–c: legible pencil / duplicate / reset / trash glyphs, 28×28 with 4 px gaps, focus ring 2 px cyan, hover accent, disabled faded; names `<Label> “<name>”`, `title` bare label; Tab order Open→Duplicate→Reset→Delete; Delete is distinguished by glyph and position (design) |
| 6 Disabled reasons | **PASS** | ML-07/07b/11/05b: reasons render once per distinct reason; shared (`Reset results, Delete test: Stop the running test first.` once; four actions share the confirmation-pending reason once); linkage by `aria-describedby` verified in the DOM; layout stays intact |
| 7 Manager ↔ Editor | **PASS** | ML-08a–c: `style.width` byte-identical (`min(460px, 90vw)`) across both switches; a width set from outside (400 px) survives a round trip; neither view is visually broken |
| 8 Viewer-native alignment | **PASS (caveat)** | ML-09: same title bar/close/shadow/font/text color as the native Model panel. Caveat: 12 px item text versus the native tree's 14 px — the existing Clash Panel base size |
| 9 Icon fallback | **PASS** | ML-10a/b via the seam: text labels visible, glyphs hidden, ≥ 28 px tall, no overflow at 460 px and at the 300 px viewport |

**Totals: 9 PASS (3 with caveats) / 0 FAIL / 0 INCONCLUSIVE** (19 PASS sub-rows in the evidence README).

## 5. Runtime / console

0 console errors, 1 expected pre-existing Viewer deprecation warning (`Model#getInstanceTree`); no page errors. The Viewer base panel wrote `max-width` and `max-height` pixel values on the shell container (`max-width:1300px; max-height:902px` at the 1300 px viewport); it never wrote `width`, and the Manager renderer wrote nothing.

## 6. Observations, limitations, unexercised

Non-blocking observations (all pre-existing or by design): toolbar overlap at narrow viewports; the unclamped header `Test: <name>` line above the list; the existing active-running wording `Results not held — open and re-run to view` (deferred L3); Delete distinguished by glyph and position only; the existing 12 px density versus the native 14 px tree.
Limitations: the 240 px list-content floor is below what viewport narrowing can reach (panel minimum `min(340px, 90vw)` → list ≥ 264 px at a 300 px viewport) and is covered by the DOM suite, not headed; an embedded Viewer container narrower than the browser viewport was not exercised; Firefox/Safari and a real no-mask engine were not run; native tooltip painting and screen-reader announcements were not observed (attributes asserted); the Reset-confirmation banner was not captured (Delete's, which shares the banner code, was); no resize interaction exists to exercise (the native Model panel shows a resize footer, the Clash Panel does not).

## 7. Confirmations

- No production code, test, spec, plan or the implementation report was changed by this package (`git diff` of tracked files is identical to the pre-validation state; protected paths still zero diff).
- CTM-7, CTM-8, L1–L8 remediation, persistence/history/background runs, resize work and any commit/push were not entered.
- No genuine visible/product defect was found, so no remediation is proposed. The Independent Work review's documentation-bookkeeping Low (stale "design only" status labels) is untouched, as instructed.

## 8. Readiness and next gate

Ready for **Independent Work visual/product review of the headed-validation package**. Not self-authorized: that review's outcome; commit/push; CTM-7; CTM-8; L1–L8; the documentation-bookkeeping Low; any other scope.
