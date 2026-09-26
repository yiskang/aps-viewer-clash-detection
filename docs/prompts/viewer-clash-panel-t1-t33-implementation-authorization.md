# Prompt — Authorize Viewer Clash Panel Implementation T1–T33 Only

I explicitly authorize implementation of **Viewer Clash Panel Tasks T1–T33 only**, according to the independently reviewed and owner-approved implementation plan.

This authorization does **not** include any gated work beyond T33.

## Repository baseline

Before starting:

1. Verify the repository is the expected APS clash-detection repository.
2. Read:
   - `CLAUDE.md`
   - `docs/handoffs/latest.md`
   - `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`
   - `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md`
   - the latest independent implementation-plan reviews under `docs/reviews/`
3. Verify:
   - branch: `main`
   - expected planning baseline: `e302b39`
   - `main == origin/main`
   - working tree is clean
   - implementation planning is complete and independently accepted
   - OD-1(a) and OD-7(a) are owner-approved
   - G-OD is satisfied

If the actual repository state materially differs, stop and report the discrepancy before implementation.

Treat repository artifacts as authoritative.

## Authorized scope

Implement **T1–T33 exactly within the reviewed plan**.

Preserve the accepted architecture and product decisions:

- top-level `clashpanel/`
- headless Panel controller/state layer
- ViewerBridge as the only Panel layer allowed to mutate the Viewer
- thin `Autodesk.Viewing.UI.DockingPanel` shell
- no custom floating-window framework
- markers-only v1
- no Viewer theming
- Soft/clearance fail-closed unless the reviewed common measurement-basis prerequisite is satisfied
- sealed-result browsing
- pagination
- presentation-side Group by Element
- approved OD-7(a) replace-results behavior
- accepted snapshot-derived UX:
  1. Test Setup
  2. Run / Status
  3. Filters / Grouping
  4. Results / Navigation
  5. Selected Clash Actions

Do not silently change any accepted design or plan decision.

If implementation reveals a real contradiction, stop and report it rather than redesigning the milestone in-place.

## Task execution

Follow the reviewed T1–T33 dependency order and commit boundaries.

For every task:

- follow the planned RED → GREEN sequence;
- run the task-specific checks;
- finish the task with all required tests green;
- do not commit intentionally failing scaffolding;
- keep commits scoped to the task;
- preserve the reviewed layering constraints.

Use the plan's exact files, APIs, fixtures, negative controls, and acceptance checks unless actual repository code proves a mechanical correction is required.

If a mechanical correction is needed:
- keep it minimal;
- record the deviation;
- do not change architecture or product behavior without owner authorization.

## Required architecture constraints

### Headless Panel core

The headless core may own:

- draft/test setup state;
- validation state;
- run lifecycle state;
- sealed-result indexing;
- filtering;
- grouping;
- sorting;
- pagination;
- selected-result navigation;
- stale/unavailable presentation state;
- Soft availability based on injected measurement-basis evidence.

The headless layer must not:

- access Viewer globals directly;
- register models;
- derive host identity;
- wire unload/reload events;
- mutate Viewer state;
- implement collision geometry logic.

### ViewerBridge

ViewerBridge is the only Panel layer that may perform Viewer mutations planned by T1–T33.

Preserve:

- markers-only emphasis;
- bounds outlines/Panel-owned overlays;
- guarded isolate;
- fit/focus;
- write-ahead rollback / ownership ledger;
- deterministic cleanup.

Do not call:

- `setThemingColor`
- `clearThemingColors`

Do not read, overwrite, clear, or attempt to restore foreign theming.

### DockingPanel

`Autodesk.Viewing.UI.DockingPanel` is the normative v1 shell.

Keep it thin:

- no domain state ownership;
- no collision logic;
- no direct Viewer mutation;
- no hidden second controller.

The implemented UI must remain recognizable as the accepted Clash Detection panel workflow, not merely expose a headless API.

## No-clash wording correctness

Implement the reviewed T11/T17/T19 rule exactly.

A user-facing clearance/no-clash statement may appear only when the settled pair satisfies BOTH:

- `claim.allowed === true`
- completed `freshness.state === "current"`

Requirements:

- claim and freshness belong to the same check;
- no wording while either read is pending;
- stale/superseded checks cannot publish a claim;
- failed claim/freshness reads fail closed;
- re-check start withdraws any previously held clearance claim;
- adverse resolution order must remain safe;
- never render a bare misleading “No clashes” statement.

Do not change Core behavior to achieve this.

## Soft / measurement-basis correctness

Preserve the accepted fail-closed design:

- Hard remains available when otherwise valid;
- Soft is enabled only when the reviewed measurement-basis condition is satisfied;
- display-unit conversion does not establish computational compatibility;
- if common basis is unverified, Soft is disabled with the reviewed user-facing explanation;
- do not invent a new unit-conversion system.

The host evidence needed for real SVF2 integration remains outside T1–T33.

## Test gate requirements

Follow the reviewed test wiring.

Before T27:
- use the task-specific/default gates defined by the plan.

From T27 onward:

- `npm test` is the canonical aggregate gate;
- it runs:
  - `npm run test:offline`
  - `npm run test:clashpanel:dom`
- Playwright Chromium is therefore required for `npm test`;
- `npm run test:offline` remains browser-free;
- Panel DOM tests use fakes and require:
  - no server
  - no credentials
  - no network
  - no live APS Viewer

Live acceptance scripts remain excluded from `npm test`.

Implement the planned updates to:

- `test/README.md`
- `test/acceptance/README.md`

Do not weaken the README guards, script-recursion guards, DOM negative controls, or final scope checks.

Every implementation checkpoint that the plan says uses the aggregate gate must actually run it.

## Explicitly NOT authorized

Do **not** begin or execute any gated work beyond T33.

Specifically, do not execute:

- **G1** — SVF2 verification of F1–F8
- **G2** — live ViewerBridge / DockingPanel verification
- **G3** — Panel live acceptance
- **H1** — host composition / routes / toolbar integration
- **H2** — OQ-1 / placement invalidation / measurement-basis host evidence

Also do not:

- run any SVF2 live verification;
- start OQ-1;
- start host integration;
- add toolbar integration;
- add real model registration/re-registration logic;
- modify Viewer Adapter behavior;
- modify Core behavior;
- reopen M4;
- fix frozen-Core lease-dead behavior;
- fix duplicate `owner-mapping-mismatch`;
- add optional Viewer Adapter walk-helper checkpoints;
- add remote persistence;
- add annotation workflows;
- add ACC/Model Coordination parity work;
- add new public resource-limit policy;
- add Viewer theming;
- start any milestone after T33.

If T1–T33 expose a dependency on any of these, stop and report the blocker.

Do not absorb gated work into an “implementation fix”.

## SVF2 boundary

Viewer Clash Panel v1 targets **SVF2 / OTG-loaded models**.

However:

- T1–T33 are intentionally limited to model-format-agnostic code and fake/injected Viewer work;
- historical Viewer Adapter T3 evidence covers SVF non-OTG only;
- do not claim SVF2 support or production readiness from T1–T33;
- do not run real SVF2 Viewer checks during this authorization.

SVF2 evidence remains a later explicit owner gate.

## Internal review during implementation

Follow the reviewed plan's task-level review strategy.

For substantial implementation slices:

- use separate reviewing agents/subagents as planned;
- fix genuine Critical/High implementation findings inside the authorized T1–T33 scope;
- do not let review feedback silently expand milestone scope;
- persist substantial final review findings under `docs/reviews/` where required by repository convention.

If a review recommends G1–G3, H1–H2, Core, Adapter, M4, OQ-1, or host work:
- record it;
- do not execute it.

## Final T33 gate

After T33:

1. Run the reviewed final default/full test gate.
2. Verify all T1–T33 acceptance criteria.
3. Verify the snapshot-derived five-region UX is present.
4. Verify markers-only behavior and no theming calls.
5. Verify README/default-test documentation matches actual scripts.
6. Verify no gated work was started.
7. Verify no unauthorized Core/Adapter/M4/host changes occurred.
8. Update `docs/handoffs/latest.md`.
9. Persist the required implementation review/status artifacts.

Then stop.

Do **not** automatically proceed to G1, G2, G3, H1, H2, SVF2 verification, host integration, or any next milestone.

The next gate after T33 is:

**independent ChatGPT Work implementation review**

## Final report

Report:

- branch;
- starting HEAD;
- ending HEAD;
- implementation commit range;
- T1–T33 completion status;
- full/default test totals;
- DOM suite totals;
- internal review findings and fixes;
- deviations from the reviewed plan, if any;
- blocked/deferred dependencies discovered;
- files/artifacts added;
- updated handoff/review paths;
- final git status;
- whether anything was pushed.

Explicitly confirm:

- G1–G3 were not executed;
- H1–H2 were not started;
- no SVF2 live verification was run;
- no OQ-1 work was started;
- no host integration was started;
- no Viewer Adapter/Core/M4 change was made outside the reviewed T1–T33 scope;
- no next milestone was started.

Stop at the T33 implementation-complete checkpoint.
