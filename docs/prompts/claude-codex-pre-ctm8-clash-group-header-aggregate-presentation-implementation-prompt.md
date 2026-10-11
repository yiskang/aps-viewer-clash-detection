# Claude/Codex Implementation Prompt — Pre-CTM-8 Clash Group Header Aggregate Presentation

## Authorization

Implement the reviewed **pre-CTM-8 Addendum B correction only** in:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This authorization covers the bounded implementation described by the accepted design/spec addendum and implementation-plan addendum.

**CTM-8 remains unauthorized and must not begin.**

Do not commit or push unless separately authorized after implementation review.

## Before implementation

Independently verify and read:

- repository / branch / HEAD / origin / working tree
- `CLAUDE.md` and any repo-level instructions
- `docs/handoffs/latest.md`
- governing Viewer Clash Panel design, including the accepted aggregate-presentation addendum
- governing Clash Tests Manager implementation plan, including Addendum B
- `docs/reviews/2026-10-11-clash-group-header-aggregate-presentation-independent-work-review.md`
- `docs/reviews/2026-10-11-clash-group-header-aggregate-presentation-addendum-independent-work-review.md`

Verify that the implementation starts from the reviewed baseline and that CTM-7 remains closed.

If repository state contradicts the reviewed handoff/spec/plan, stop and report the discrepancy rather than guessing.

## Required behavior

### 1. Preserve the existing single-clash contract

Do not widen or redefine the existing `ViewerBridge.present()` contract.

It remains a **single-clash presentation** contract with one or two sides.

Existing single-clash behavior, markers/witness semantics, Selected Clash behavior, isolation, focus, rollback, clear/dispose behavior and tests must remain compatible.

### 2. Add a separate aggregate group presentation path

Implement the reviewed sibling aggregate operation, expected as:

`ViewerBridge.presentGroup(...)`

The aggregate path must:

- support arbitrary participant cardinality;
- support one, two, or more than two models;
- have validation independent from `present()`;
- never fall back through `present()`;
- reuse the existing ViewerBridge queue / supersession / held-ledger / guarded isolation / fit / rollback / clear / disposal machinery where the reviewed design allows;
- not introduce a new public collision/Core/Adapter resource limit.

### 3. Group participant aggregation

For a selected group:

- use the group's **current filtered `memberIndexes`**;
- visit both sides of every child clash;
- use durable identity `{modelKey, dbId}`;
- de-duplicate using the compound identity, never dbId alone;
- resolve live `{model, dbId}` values only at action time through the existing provenance-aware resolver;
- do not retain Viewer `Model` objects in durable controller state.

Unavailable participants may be omitted.

If no participant resolves live:

- clear stale Viewer presentation;
- retain truthful selected-group UI state;
- make Viewer actions unavailable as specified by the reviewed design.

### 4. UI interaction contract

The owner-approved interaction contract is fixed:

#### Disclosure control

The disclosure triangle / chevron:

- expands or collapses the group only;
- dispatches only the existing group-toggle intent;
- must never trigger aggregate presentation.

#### Group row body

The group row body / label:

- selects the group;
- presents all current filtered clash participants for that group;
- must not change expansion state;
- dispatches only the new group-presentation intent.

Use sibling native interactive controls rather than nested interactive content.

Preserve keyboard behavior for click / Enter / Space and the reviewed ARIA semantics.

Prevent cross-triggering through the appropriate DOM event handling.

### 5. Group selection state

Implement the reviewed distinct group-presentation selection state.

The expected minimum direction is a mutually exclusive `selectedGroupId` alongside existing single-clash selection state.

Required behavior:

- selecting a group clears current clash selection / clash navigation scope as required by the reviewed design;
- selecting a child clash clears group selection and restores the existing single-clash path;
- group selection survives disclosure expand/collapse;
- if the selected group disappears because of filtering or grouping-mode change, clear the aggregate selection and Viewer presentation as specified;
- honor the reviewed lifecycle rules for run, active-test switch/delete, panel hide, model departure/re-entry and clear/back-to-all behavior.

### 6. Owner decision A — no group markers/outlines

This decision is final for this implementation.

In group mode:

- do **not** create clash witness markers;
- do **not** create participant bounds outlines;
- the Markers control is disabled/unavailable;
- show the reviewed group-specific explanation for why Markers are unavailable.

When the user selects a child clash again, existing single-clash marker/witness behavior must return unchanged.

Do not implement Option B or any aggregate outline-capacity policy.

### 7. Focus and isolate

Group presentation must use the aggregate participant set.

#### Focus

- group activation with focus enabled fits the entire live aggregate;
- explicit Focus action fits the entire live aggregate;
- support one, two, and more than two participating models.

#### Isolate

- when enabled and allowed by existing prerequisites, isolate all unique live aggregate participants in one aggregate reconcile;
- restoration must preserve the existing ownership-guard behavior.

Do not move Viewer mutation responsibility out of ViewerBridge.

### 8. Selected region

A selected group is not a clash.

When a group is selected:

- immediately stop showing stale child-clash details;
- do not fabricate sides, gap, location, witness, ordinal or other clash-specific values;
- show only the reviewed minimal selected-group context;
- retain applicable shared controls such as Focus, Isolate and Back to All;
- show Markers as unavailable with the group-specific reason.

Do not create a larger new product surface beyond the reviewed bounded group-selected variant.

### 9. Back to all

Back to All must:

- use the existing ViewerBridge clear/restore behavior;
- clear both clash selection and group selection;
- preserve filters, grouping, expansion and page state as specified.

### 10. Shared grouping path

Element, Category, Model Pair and Level grouping should use the common aggregate path over the existing group object / `memberIndexes`.

Do not introduce per-group-type presentation implementations unless repository evidence demonstrates they are required.

Grouping mode `none` has no aggregate group action.

## Expected production surface

Keep implementation bounded to the reviewed seams.

Expected production files include:

- `clashpanel/core/intents.js`
- `clashpanel/core/controller.js`
- `clashpanel/core/rows.js`
- `clashpanel/core/viewModel.js`
- `clashpanel/viewer/ViewerBridge.js`
- `clashpanel/ui/render/results.js`
- `clashpanel/ui/render/selected.js`
- `wwwroot/main.css`

Use:

- `clashpanel/core/testsManager.js`
- `clashpanel/core/managerViewModel.js`

only where required by the reviewed Addendum B terminal-fault intent/control-equivalence contract.

Do not modify unrelated production areas.

## Protected boundaries

Do not:

- begin CTM-8;
- reopen CTM-7;
- remediate L1-L8;
- change Core / collision / Viewer Adapter / host integration contracts;
- change Viewer theming/selection architecture;
- add new grouping modes or nested grouping;
- add persistence/history;
- add aggregate child-witness overlays;
- add participant outline mode;
- widen `present()`;
- introduce new public limits;
- silently expand the reviewed implementation surface.

If implementation proves that a governing contract must change, stop and report the contradiction instead of silently changing the spec/plan.

## Required tests

Follow Addendum B and add/adjust the minimum tests necessary to prove the contract.

### Controller / unit

Cover at least:

- Element group with multiple child clashes;
- Category group with multiple child clashes;
- shared path for Model Pair / Level;
- aggregate spanning more than two models;
- duplicate participants across clashes;
- same `dbId` in different models;
- empty / no-live participants;
- single-child group;
- collapsed group selection;
- filtered-membership refresh / disappearance;
- group -> child transition;
- Back to All;
- model departure;
- existing single-clash regression;
- terminal-fault classification for the new group-present intent.

### ViewerBridge

Cover at least:

- independent `presentGroup()` request validation;
- arbitrary participant cardinality;
- compound de-duplication;
- one-model and many-model isolate targets;
- aggregate fit;
- no aggregate markers/outlines;
- supersession;
- rollback;
- clear/dispose;
- failure injection;
- existing `present()` continues to reject invalid cardinality including 0 or >2 sides.

### Renderer / DOM

Cover at least:

- sibling disclosure and row-body controls;
- disclosure never presents;
- row-body never toggles expansion;
- click / Enter / Space behavior;
- selected-group semantics / ARIA / styling;
- focus retention;
- child transition;
- group-selected action region;
- Markers disabled with the reviewed reason;
- terminal-fault intent/control equivalence where applicable.

## Verification

Run the reviewed required verification, including:

- relevant focused tests;
- canonical full offline test suite;
- DOM tests;
- `git diff --check`;
- protected-path / changed-file inspection.

Report exact totals rather than only saying "tests pass."

After implementation is complete, run the separately reviewed headed/manual evidence matrix for this **pre-CTM-8 correction only**, including:

- one-model group;
- two-model group;
- more-than-two-model group;
- aggregate focus;
- aggregate isolate / restore;
- Back to All;
- unavailable-participant behavior;
- selected visuals;
- Markers disabled in group mode;
- no cross-trigger between disclosure and group-row body.

Do not label any of this as CTM-8 evidence.

## Required durable artifacts

After implementation and verification, create the upstream package completion report under:

`docs/research/<date>-clash-group-header-aggregate-presentation-final-report.md`

It must accurately record:

- repo / branch / HEAD / origin / tree state;
- governing spec / Addendum B;
- implementation scope;
- exact changed production/test files;
- behavior implemented;
- tests and exact totals;
- headed/manual evidence;
- deviations, if any;
- unresolved issues;
- protected boundaries;
- readiness for independent review.

Do **not** author the Independent Work Review yourself.

Update `docs/handoffs/latest.md` concisely with:

- repo / branch / HEAD / tree state;
- CTM-7 remains closed;
- CTM-8 remains not started;
- governing spec/plan;
- implementation final report;
- implementation status;
- verification summary;
- blockers/deferred work;
- exact next gate.

## Stop condition

When implementation, tests, headed evidence, upstream final report and handoff update are complete:

**STOP.**

Do not commit.
Do not push.
Do not begin CTM-8.
Do not perform the Independent Work Review.

The next gate is an independent Work review of this implementation package, followed by owner decision on checkpoint commit/push.
