# Independent visual/product review — Viewer Clash Panel native Viewer style alignment

## Verdict

**0 Critical / 0 High / 0 Medium / 2 Low.** The native-style alignment is accepted. The Panel now reads as a normal Viewer-native light-theme panel rather than a browser-default form, without changing its product semantics. The package is **ready for native-style checkpoint**; owner screenshot review is not required.

Review baseline: `main == origin/main == 838bbad40f778483cc9bf082ecaddbab84e19ea2`. The reviewed implementation is uncommitted. This review did not modify production code or tests, did not run or alter G2/C8/G3, and did not commit or push.

## Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

1. The Group legend remains slightly tighter to its preceding row than the Sort legend. This is cosmetic and does not affect hierarchy, control discovery, or interaction.
2. Native `text-transform: capitalize` renders “Filters And Grouping.” This is consistent with the harvested Viewer treatment but is a minor editorial polish item.

The opaque white body is not a finding. It is visually consistent with the light Viewer shell, keeps model geometry from reducing legibility, and preserves the existing opaque-shell contract. No owner-only style decision remains.

## Repository and scope verification

- The only runtime changes are `wwwroot/main.css` and the body class/offset change in `clashpanel/ui/ClashDockingPanel.js`; the directly affected tests are `test/clashpanel/hostStyles.test.mjs` and `test/clashpanel/dom/shell.dom.mjs`.
- Every custom style selector is rooted at `.clash-panel-root`. The only native classes added are applied to this Panel body. No rule targets Viewer, Room Locator, or Clash Finder globally.
- `render/*.js`, `PANEL_CSS`, controller behavior, ViewerBridge, Core, Adapter, M4, and host composition are unchanged. The shell remains thin and the five-region information architecture is unchanged.
- No theming API was introduced. Markers-only behavior and Viewer state ownership are unchanged.
- G2 remains `FAIL (row 3)`, C6 remains `NOT_EVIDENCED`, and C8 remains unresolved. No live retry, authorization-record change, procedure change, or G3 work occurred.

## Native fidelity and headed verification

The reference audit is consistent with the pinned Viewer 7.124.2 light-theme panels. The Panel reuses native docking-body classes and harvested Viewer values through local `--nv-*` tokens because the Viewer stylesheet exposes no equivalent CSS variables.

Independent headed reproduction at `?clashPanelDemo=1` verified:

- the Panel body begins below the approximately 50 px native title bar with no overlap;
- native-weight section bands, Artifakt typography, form controls, primary/secondary actions, compact rows, selection treatment, focus ring, disabled presentation, and the 6 px scrollbar render coherently;
- Structure + Mechanical completes with 491 clashes; Stop produces a valid partial result; grouping, filtering, paging, Focus, Back to All, Clear, X-close, and reopen operate normally;
- Soft remains disabled with the correct measurement-basis explanation when no verified common basis exists;
- the default URL does not expose the Clash Panel. The retained evidence records zero console errors and only Viewer-origin deprecation output.

The full final `after/` set contains 16 PNGs. All 16 were inspected independently: **16 PASS / 0 FAIL / 0 INCONCLUSIVE**. Compared with the committed Continuation II snapshots, the change is material and consistently native-looking across setup, running, completed, grouped, selected, paged, filtered, stopped, and empty states.

## Accessibility, responsive behavior, and width contract

- Keyboard focus remains visibly outlined and unclipped. Disabled labels remain readable; the nested input opacity correction prevents compounded dimming.
- Selected rows retain a non-color-only left-edge cue in addition to the native grey background. Existing ARIA and keyboard behavior are unaffected because markup and renderer semantics did not change.
- At a 700 px viewport the Panel remains within its 90vw cap, has no internal horizontal overflow, and preserves the body scrollbar. The separately documented page-level header overflow belongs to the demo host, not the Panel.
- The exact-width test asserts the intentional authored contract—`min(460px, 90vw)`, `min(340px, 90vw)`, `max-width: 90vw`—rather than device-rounded computed pixels. It is stable and closes the prior width-assertion gap.
- The 50 px body offset is reference-driven by the native title-bar geometry, not an arbitrary compensation.

## Regression and evidence assessment

- `npm run test:offline`: **5,192 total / 5,191 pass / 0 fail / 1 existing todo**.
- `npm run test:clashpanel:dom`: **83/83 pass**.
- Focused host-style suite: **8/8 pass**, including five new native-style assertions.
- `git diff --check`: clean before this review was written.
- The retained headed report covers 491-complete, 394-partial Stop, grouping, filtering, pager, selected actions, Clear, close/reopen, default-path containment, and console state. The 16 final PNGs are sufficient durable visual evidence.

Room Locator and Clash Finder risk is acceptably bounded for this style-only checkpoint: their extensions still load in the retained default-path smoke evidence, and the new CSS cannot select their DOM without a `.clash-panel-root` ancestor. A full interaction pass for those products is not required to accept this scoped change.

## Readiness

**ready for native-style checkpoint**

Recommended next action: owner authorization for one scoped checkpoint commit and push containing the native-style implementation, tests, evidence, reviews, prompt, and handoff. No additional implementation correction, screenshot decision, G2/C8 work, or G3 work is authorized by this review.
