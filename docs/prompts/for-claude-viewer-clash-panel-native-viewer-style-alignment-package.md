# For Claude — Viewer Clash Panel Native Viewer Style Alignment Package

I explicitly authorize one **larger bounded Viewer Clash Panel native Viewer style-alignment package**.

The goal is to make the current Clash Panel look and feel like a normal APS Viewer / Autodesk Viewer panel, while preserving all existing product behavior.

This is a **style and visual-consistency package**, not a feature-expansion package.

Proceed autonomously through:

**current-state audit → Viewer-native reference audit → style implementation → headed Viewer before/after validation → snapshot capture → Claude visual triage → in-scope fixes → relevant tests → internal review → handoff update**

and then stop at:

**Ready for independent Work visual/product review**

Do not stop for owner approval between those in-scope steps unless a hard owner-only boundary is reached.

---

# 1. Authoritative baseline

Verify first:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- baseline:
  `838bbad40f778483cc9bf082ecaddbab84e19ea2`
- `main == origin/main`
- `git status --short` is completely empty
- zero modified files
- zero untracked files

Read:

- `docs/handoffs/latest.md`
- governing Clash Panel design/spec
- governing implementation plan
- latest product-facing reviews
- current Clash Panel implementation
- current panel markup/CSS
- current demo/sample wiring
- relevant DOM/product tests
- repository instructions such as `CLAUDE.md`

Treat repository state as authoritative.

The handoff is navigation, not proof.

---

# 2. Current-state visual evidence

Treat the existing Continuation II screenshots as the authoritative **before-state / current-state evidence**.

Primary source:

`docs/research/2026-10-06-viewer-clash-panel-product-facing-continuation-ii/snapshots/`

The uploaded `Archive.zip` is only a copy of those same snapshots for external review convenience.

Important:

> The existing screenshots show the current visual state.  
> They are **not** the target style reference.

Do not reproduce the existing styling merely because it is present in the screenshots.

---

# 3. Package objective

Align the Viewer Clash Panel visually with standard APS Viewer / Autodesk Viewer panel conventions so that it looks like a first-class Viewer tool rather than a plain custom HTML form inside a DockingPanel.

The target should feel visually native to Viewer.

Prioritize reuse of Viewer-native classes, DOM conventions, spacing patterns, controls, and styling where available.

Avoid creating a separate design system.

---

# 4. Find the real Viewer-native references

Before editing styles, inspect actual Viewer-native references.

Use, in order of preference:

1. Viewer panel implementations already in this repository
2. standard `Autodesk.Viewing.UI.DockingPanel` structure/classes
3. Viewer built-in extensions/panels available in source
4. existing Autodesk Viewer CSS/classes already loaded by the app
5. official Viewer examples already vendored/referenced in the repo

Identify concrete references for:

- panel title/header
- close button
- drag/title area
- body container
- section spacing
- typography
- buttons
- select controls
- checkboxes
- rows/list items
- hover state
- selected state
- disabled state
- divider/border usage
- scrollbar behavior
- dark/light theme handling
- responsive sizing

Document the chosen reference pattern briefly before implementation.

Do not guess at “Viewer-like” styling if reusable Viewer conventions already exist.

---

# 5. Style-only scope

This package may modify visual structure/classes/CSS needed to align with Viewer-native styling.

Authorized areas include:

## Panel shell
- title/header presentation
- body background
- border/shadow
- padding
- spacing
- min/max sizing
- scroll container behavior

## Typography
- font family
- font size
- font weight
- label hierarchy
- secondary text
- section titles

## Controls
- buttons
- selects
- inputs
- checkboxes
- toggles if already present
- disabled states
- hover/active states
- focus states

## Sections
- section spacing
- dividers
- grouping hierarchy
- checklist/status presentation
- action areas

## Results
- result rows
- group rows
- selected row
- hover row
- disabled/non-actionable rows
- pager/filter area
- count/status text

## Selected clash/action region
- action buttons
- metadata spacing
- marker/action state
- visual hierarchy

## Responsive behavior
- width constraints
- viewport fit
- scroll behavior
- ~700 px narrow viewport behavior if the style work naturally touches it

## Theme consistency
- Viewer dark theme contrast
- any supported Viewer theme class conventions already present

---

# 6. Preserve all product semantics

Do **not** change any functional behavior unless a visual/DOM adjustment requires a narrowly scoped bug fix.

Explicitly preserve:

- Group None behavior
- Group Element behavior
- grouping semantics
- Focus behavior
- Isolate behavior
- Markers behavior
- Back to all
- filtering
- paging
- selected-row semantics
- Soft unavailable behavior
- Run / Stop behavior
- result counts
- cancellation semantics
- framing semantics
- cross-reload behavior
- Viewer selection semantics
- model keys
- Clash result model
- current error/empty-state behavior

Do not add:

- new Group By modes
- persistence
- Viewer object selection
- new framing policy
- new clash semantics
- new milestone
- G3 work

---

# 7. Preserve current product decisions

Keep these decisions unchanged:

- framing remains acceptable for v1
- Viewer selection remains excluded by spec §9.2
- cross-reload persistence remains deferred
- G2/C6/C8 verification debt remains separate
- no renewed G2 causality research

Do not reopen them merely because visual styling changes.

---

# 8. Before-state audit

Use the current screenshots to identify concrete visual mismatches.

Create a short before-state audit under `docs/research/` or inside the style package.

At minimum assess:

- panel header/title bar
- body background
- border/shadow
- typography
- section hierarchy
- vertical rhythm
- control density
- native vs browser-default-looking controls
- checkbox presentation
- buttons
- selected row
- group row
- status/checklist area
- action buttons
- scrollbars
- panel width
- responsive/narrow viewport state
- contrast/readability

Avoid vague judgments such as “looks bad.”

Tie each issue to a specific visible mismatch and Viewer-native reference.

---

# 9. Implementation principles

Prefer:

- existing Viewer classes
- existing Viewer CSS variables/classes
- existing panel/control conventions
- minimal custom CSS
- semantic class names
- centralized panel styling

Avoid:

- large one-off inline style blocks
- arbitrary magic colors if Viewer already defines equivalents
- recreating Viewer controls from scratch
- unnecessary markup churn
- behavior changes disguised as styling

If Viewer-native styling cannot be reused directly, create the smallest custom layer needed to match it.

---

# 10. Headed before/after validation

This package requires real headed Viewer validation.

Run:

`npm start`

Open the current demo URL used by the repository.

Capture before/after visual evidence.

Suggested package path:

`docs/research/2026-10-06-viewer-clash-panel-native-style-alignment/`

Suggested structure:

- `before/`
- `after/`
- `style-alignment-evidence-report.md`

Do not duplicate all historical screenshots if the committed before-state package can be referenced directly.

Capture after-state snapshots for at least:

1. panel initial/open state
2. test setup area
3. run/loading state
4. completed results
5. Group None
6. Group Element collapsed
7. Group Element expanded
8. selected result
9. action controls
10. filter/pager state
11. empty/clear state
12. Soft unavailable state
13. narrow viewport around ~700 px
14. close/reopen state

Use deterministic filenames.

---

# 11. Claude visual comparison

Claude must compare current/before evidence against after-state evidence.

For each visual category record:

- PASS
- FAIL
- INCONCLUSIVE

Judge:

- does it now look consistent with Viewer-native panels?
- are controls visually coherent?
- is information hierarchy clearer?
- are browser-default styles eliminated where inappropriate?
- are spacing and density consistent?
- is text readable?
- are selected/hover/disabled states obvious but not overstyled?
- does the panel remain usable in the narrow viewport?
- did any visual regression appear?

If FAIL and in scope:

- fix it
- rerun headed validation
- regenerate affected screenshots

Do not ask the owner to inspect screenshots before Claude and later Work have reviewed them.

---

# 12. Native-style comparison criteria

The evidence report should explicitly compare:

| Area | Before | After | Viewer-native reference | Verdict |
|---|---|---|---|---|
| Header | | | | |
| Body | | | | |
| Typography | | | | |
| Buttons | | | | |
| Selects | | | | |
| Checkboxes | | | | |
| Sections | | | | |
| Group rows | | | | |
| Result rows | | | | |
| Selected row | | | | |
| Disabled state | | | | |
| Scroll behavior | | | | |
| Responsive width | | | | |

Do not rely only on subjective prose.

---

# 13. Responsive behavior

The current product debt includes ~700 px overflow.

Because this package touches panel style/sizing, independently evaluate whether it can be corrected naturally within the style scope.

If the problem is primarily panel CSS/layout and can be fixed without changing unrelated Viewer toolbar behavior:

- fix it
- add/adjust visual evidence
- add a focused width assertion if appropriate

If the overflow comes from unrelated Viewer toolbar/page layout outside Clash Panel ownership:

- do not expand scope
- document it as external/deferred

Do not create a large responsive redesign.

---

# 14. Existing 3 Low debts

Current remaining Lows from prior product work include:

1. UUID fallback entropy
2. ~700 px responsive overflow
3. missing exact-width assertion

Rules:

- UUID entropy is not part of this style package unless code is touched for another valid reason
- responsive overflow may be fixed if naturally within panel styling scope
- exact-width assertion may be added if the style changes define a stable width contract

Do not chase unrelated debt for completeness.

---

# 15. Tests

Run all relevant current suites.

Add focused tests only where stable DOM/style contracts are appropriate.

Potential focused coverage:

- panel width clamp
- CSS/class assignment
- section classes
- selected-row class
- disabled state class
- Viewer-native class usage
- narrow viewport constraint

Avoid brittle screenshot-pixel tests unless the repo already uses them.

Preserve current functional regression baseline.

---

# 16. Functional regression baseline

Re-check that style work does not break:

- panel open/close
- X-close button sync
- rapid first click
- Run / Stop
- Group None
- Group Element
- filter
- pager
- Focus
- Isolate
- Markers
- Back to all
- Clear
- close/reopen
- 491-clash full run
- default URL behavior
- Room Locator
- Clash Finder

Any behavioral regression is blocking.

---

# 17. Console/runtime verification

During headed validation verify:

- 0 product console errors
- only known Viewer-origin deprecation warnings
- no CSS/runtime exception
- no extension load failure
- no stale state introduced by style DOM changes

---

# 18. Internal review

Perform a full internal review after style implementation and headed validation.

Use explicit:

- Critical
- High
- Medium
- Low

Review:

- Viewer-native reference fidelity
- CSS reuse vs unnecessary custom styling
- theme consistency
- typography
- spacing
- controls
- result/group rows
- selected/hover/disabled states
- scrolling
- responsive width
- functional regression safety
- headed visual evidence
- screenshot coverage
- test coverage
- scope discipline
- no behavior semantics drift

Fix all in-scope Critical/High/Medium findings autonomously.

If substantial fixes follow:

- rerun relevant tests
- rerun headed validation
- refresh affected snapshots

---

# 19. Owner escalation rule

Do not ask the owner to inspect screenshots merely because styling changed.

Escalate only if:

- Claude and Work later disagree materially on visual quality
- a genuine visible defect remains
- there are two valid Viewer-native style directions requiring product intent
- a scope decision beyond style alignment is required

Otherwise Claude and Work should resolve visual issues first.

---

# 20. Exit criteria

Continue autonomously until:

- Clash Panel visually aligns with the chosen Viewer-native reference
- required after-state screenshots exist
- Claude visual review has no unresolved in-scope FAIL
- functional regression baseline passes
- relevant tests pass
- internal review has no unresolved in-scope Critical/High/Medium
- handoff updated

Then stop at:

**Ready for independent Work visual/product review**

Do not commit or push.

---

# 21. Handoff

Update `docs/handoffs/latest.md` with:

- repo / branch / HEAD / working tree
- authorized scope:
  `Viewer Clash Panel Native Viewer Style Alignment`
- Viewer-native reference used
- main style changes
- headed validation status
- before/after evidence path
- test results
- remaining product debt
- G2/C6/C8 debt kept separate
- no retry/new record/reset
- next action:
  **independent Work visual/product review**

Keep the handoff concise.

---

# 22. Hard boundaries

Do not:

- add new product features
- add new grouping behavior
- add persistence
- add Viewer selection
- change framing semantics
- change clash semantics
- restart G2/C8 research
- run a new G2 acceptance attempt
- issue/reset authorization records
- alter acceptance procedure
- start G3
- commit
- push

---

# 23. Final report

Report:

- branch / HEAD / origin relation
- files changed
- Viewer-native references chosen
- before-state issues identified
- style changes implemented
- exact launch command
- before/after evidence path
- visual comparison summary
- PASS/FAIL/INCONCLUSIVE totals
- responsive-width result
- console/runtime result
- functional regression test results
- focused style/DOM test results
- internal review C/H/M/L
- autonomous fixes performed
- remaining product debt
- G2/C6/C8 debt separation
- working-tree state
- exact next gate:
  **independent Work visual/product review**

Explicitly confirm:

- Archive/current screenshots were used only as before-state evidence, not target styling
- no product semantics changed
- no unauthorized feature expansion
- no G2 retry
- no new authorization record
- no attempt reset
- no acceptance-procedure change
- no G3
- no commit
- no push
