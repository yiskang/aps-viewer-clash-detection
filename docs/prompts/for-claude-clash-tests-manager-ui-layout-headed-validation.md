# For Claude — Clash Tests Manager UI Layout Headed Visual Validation Only

Repository:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

## Authorization

The owner explicitly authorizes **one bounded headed visual validation package only** for the already-implemented and independently accepted **Clash Tests Manager — Manager UI Layout / Responsive Polish — Addendum A**.

This authorization does **not** authorize production remediation, CTM-7, CTM-8, L1–L8 remediation, checkpoint commit/push, or any new product scope.

## Start by verifying repository state

Independently verify:

- repository / branch / HEAD / origin relation;
- working-tree state;
- `CLAUDE.md`;
- `docs/handoffs/latest.md`;
- governing Viewer Clash Panel design §26.14;
- Clash Tests Manager implementation plan Addendum A;
- upstream implementation final report:
  `docs/research/2026-10-11-clash-tests-manager-ui-layout-implementation-final-report.md`;
- latest Independent Work implementation review:
  `docs/reviews/2026-10-11-clash-tests-manager-ui-layout-implementation-independent-work-review.md`.

Treat the handoff as navigation, not proof. Repository state is authoritative.

Expected reviewed baseline is `main` / `fdb8643...`, with the Addendum A implementation still uncommitted/unpushed, but verify rather than assuming.

## Governing owner-approved product direction

The following are already decided and must not be reopened:

- one APS Viewer DockingPanel with Manager/List ↔ Test Editor views;
- semantic list/item layout instead of the old seven-column table;
- preferred Panel width remains 460 px;
- compact icon actions;
- visible `Active` badge;
- duplicate visible disabled reasons are deduplicated per item while every affected disabled control retains its accessibility linkage;
- Manager and Editor share the same shell width;
- switching Manager ↔ Editor must not write width;
- manager/controller/result-ownership semantics remain unchanged.

## Scope of this validation

Validate the actual implemented UI in a real headed APS Viewer session.

This is a **visual/product validation package**, not an implementation package.

Do not edit production code or tests during this task.

If a genuine visible/product defect is found, preserve evidence, describe the exact failure and minimum correction, update the package report/handoff, and stop for owner authorization rather than fixing it.

## Required headed scenarios

Use the normal repo launch path and the existing Viewer Clash Panel demo/sample path appropriate for the current repository. Do not invent a new host or test harness if an existing one is available.

Capture and review evidence for at least these scenarios:

1. **Normal Manager view at the preferred width**
   - approximately 460 px;
   - multiple clash tests if current demo/state allows;
   - verify hierarchy and scanability.

2. **Narrower Panel behavior**
   - exercise a materially narrower width within the implemented supported envelope;
   - verify no pathological one-character-per-line wrapping;
   - verify no renderer-induced horizontal overflow;
   - verify actions remain usable.

3. **Long content**
   - long Clash Test name;
   - long Set A label;
   - long Set B label;
   - verify two-line clamping/readable degradation and that full values remain available through the designed title/accessible mechanism.

4. **Active-state presentation**
   - visible `Active` badge;
   - active state is understandable without relying only on color;
   - no stale `(active)` text remains.

5. **Action controls**
   - Open;
   - Duplicate;
   - Reset results;
   - Delete test;
   - verify icon legibility, spacing, alignment, destructive-action distinction, focus appearance, and Viewer-native visual fit;
   - verify accessible labels/tooltip behavior where observable without changing the product.

6. **Disabled actions / reason presentation**
   - capture at least one reachable disabled-action state;
   - verify a repeated reason appears once visually per item;
   - verify the UI remains understandable and does not become vertically or horizontally broken.

7. **Manager ↔ Editor switch**
   - switch from Manager to Editor and back;
   - verify Panel width does not unexpectedly change;
   - verify neither view becomes visually broken after switching.

8. **Viewer-native visual alignment**
   - compare the Manager presentation with surrounding APS Viewer DockingPanel chrome and existing Clash Panel visual language;
   - check spacing, typography, control density, hit areas, borders, backgrounds and hierarchy.

9. **Icon fallback**
   - only if the implementation provides a safe deterministic way to exercise `.clash-manager-no-mask` without changing production behavior;
   - if exercised, verify text fallback does not overflow at supported narrow widths;
   - if not safely exerciseable headed, record that limitation rather than modifying code.

## Evidence requirements

Persist headed evidence under a new date/scope-specific directory beneath:

`docs/research/evidence/`

Include:

- retained screenshots for each required scenario;
- a concise evidence index/README mapping screenshot names to scenario and adjudication;
- launch/runtime details necessary to reproduce validation;
- relevant viewport / Panel width information;
- PASS / FAIL / INCONCLUSIVE per scenario;
- totals;
- console errors/warnings that materially affect interpretation;
- hashes/manifests if that is the repository's current convention for headed packages.

Review the screenshots yourself. Do not ask the owner to inspect screenshots merely because they exist.

## Visual adjudication rules

A scenario is:

- **PASS** when observed presentation satisfies §26.14 / Addendum A and no material visible defect is present;
- **FAIL** when there is a genuine visible/product defect or contradiction with the accepted UI contract;
- **INCONCLUSIVE** only when the scenario could not be meaningfully exercised or evidence cannot establish the result.

Do not convert an evidence gap into PASS.

Do not treat cosmetic preference alone as a blocker unless it contradicts the accepted design or materially harms usability/readability.

## Protected boundaries

Do not change or remediate:

- production code or tests;
- manager state or intents;
- controller composition;
- Viewer ownership;
- result residency;
- public APIs;
- shell geometry;
- resize behavior;
- L1–L8;
- CTM-7;
- CTM-8;
- persistence/history/background runs;
- separate-panel architecture;
- Core / Viewer Adapter / collision;
- G2 / C6 / C8 / G3 / R20-1.

The current Independent Work review's documentation-bookkeeping Low is also **not** part of this visual validation package unless separately authorized.

## Required package report

Create one upstream package report under:

`docs/research/`

Suggested filename:

`docs/research/2026-10-11-clash-tests-manager-ui-layout-headed-validation-final-report.md`

The report must include:

- repo / branch / HEAD / origin / tree state;
- governing spec/plan/reviews;
- validation scope;
- exact launch/run method;
- runtime/Viewer/browser details;
- scenarios exercised;
- evidence directory/index;
- PASS / FAIL / INCONCLUSIVE totals;
- visual adjudication for each scenario;
- console/runtime observations;
- limitations and unexercised cases;
- confirmation that production/tests were not changed;
- confirmation that CTM-7/CTM-8/L1–L8 were not entered;
- any genuine visible defect and its minimum correction, if found;
- readiness for Independent Work visual/product review;
- exact next gate.

## Handoff

Update `docs/handoffs/latest.md` concisely with:

- repo / branch / HEAD / tree state;
- headed-validation package status;
- governing §26.14 / Addendum A;
- implementation final report;
- latest implementation Independent Work review;
- headed evidence/report;
- visual PASS/FAIL/INCONCLUSIVE totals;
- blockers or limitations;
- deferred L1–L8;
- CTM-7/CTM-8 still unauthorized;
- exact next gate;
- work that must not begin without authorization.

## Stop condition

Stop after:

- headed validation is complete;
- evidence is persisted;
- visual adjudication is recorded;
- the upstream headed-validation final report is written;
- handoff is updated.

Do not commit or push.

Do not implement a fix.

The exact next gate is:

**Independent Work visual/product review of the headed-validation package.**
