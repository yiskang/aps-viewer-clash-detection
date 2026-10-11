# For Claude — CTM-7 F-1 Option B Bounded Remediation Package Only

Repository:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

## Owner decision and authorization

The owner has explicitly selected **F-1 Option B**:

> **A hidden model remains computationally runnable.**
>
> `viewer.hideModel(...)` is treated as a visibility state, not as Clash Test model unavailability.
>
> The Manager must not classify a test as missing / not-loaded / models-changed solely because of a hide-only `MODEL_REMOVED_EVENT`.
>
> Actual unload / unregister / loss of the bound model remains an availability loss and must continue to invalidate readiness according to the existing contract.

The owner authorizes **one bounded F-1 remediation package only** to implement this decision, reconcile the governing contract, add directly required tests, and prepare the package for independent Work review.

This authorization does **not** authorize CTM-8, L1–L8 remediation, unrelated cleanup, checkpoint commit/push, or another product package.

## Start-state verification

Before editing anything, independently verify:

- repository path;
- branch / HEAD / origin;
- working tree;
- `CLAUDE.md`;
- `docs/handoffs/latest.md`;
- latest CTM-7 Independent Work Review:
  `docs/reviews/2026-10-11-clash-tests-manager-ctm-7-headed-svf2-validation-independent-work-review.md`;
- upstream CTM-7 report:
  `docs/research/2026-10-11-clash-tests-manager-ctm-7-headed-svf2-validation-final-report.md`;
- governing Viewer Clash Panel spec §26.5–§26.6 / AC-M4 / AC-M10;
- accepted Clash Tests Manager implementation plan and CTM-7 gate;
- current source paths involved in F-1:
  - `clashpanel/core/testsManager.js`
  - `clashpanel/core/setupValidation.js`
  - `clashpanel/core/controller.js`
  - `clashpanel/viewer/ViewerBridge.js`
  - `wwwroot/extensions/clashPanelHost.js`
  - directly related tests.

Repository state is authoritative. Treat handoff/report as navigation, not proof.

If repo state materially differs from the expected CTM-7 review state, stop and report the discrepancy.

## Governing F-1 decision

The desired invariant is:

### Visibility-only hide

When a model is hidden by Viewer visibility operations such as `viewer.hideModel(...)`, while:

- the same model key remains catalogued;
- the registry still has a valid binding;
- the collision computation can still resolve and run against it;

then Clash Tests Manager readiness must continue to treat that model as **available/runnable**.

The Manager must **not** show:

- `<model> is not loaded`
- `Models changed since this run`

solely because of the hide-only event.

The editor's existing Run eligibility remains valid in this case.

### Actual availability loss

When the bound model is genuinely unavailable because of actual unload / unregister / catalog disappearance / binding loss, the Manager and editor must continue to behave according to the existing unavailable-model contract.

A later reload that creates a **new model key** must not silently rebind old tests.

Same-key recovery semantics remain as governed.

## Required investigation before implementation

Independently trace the real event sequence and payloads for:

- `viewer.hideModel(model)`
- `viewer.showModel(model)`
- `viewer.unloadModel(model)`
- normal host reload producing a new key
- any same-key re-entry path supported by the existing host/runtime.

Confirm:

- which Viewer event(s) fire;
- which `reason` value is relayed by `ViewerBridge`;
- when catalog membership changes;
- when registry binding changes;
- whether hide and unload can be distinguished using already-existing event facts;
- whether any event ordering race needs explicit handling.

Do not assume the Work recommendation's implementation detail is sufficient until source/event tracing confirms it.

## Minimum implementation goal

Implement the **smallest correction** that makes Manager readiness follow actual computational availability rather than treating hide-only visibility events as departure.

Prefer to reuse already-relayed event reason / existing catalog+binding facts if sufficient.

Do not introduce a parallel readiness architecture.

Do not change Core/Adapter collision semantics.

Do not broaden editor readiness unless mechanically necessary to preserve one invariant.

## Required behavior

At minimum, the final implementation must satisfy all of the following:

1. `hideModel(existing bound model)`:
   - Manager does not mark the model `not loaded`;
   - Manager does not mark the test changed solely because of hide;
   - editor stays Ready if it was Ready before;
   - Run remains enabled if all other readiness conditions hold;
   - the test can still run using the hidden model;
   - active/inactive test rows remain coherent.

2. `showModel(same hidden model)`:
   - no false recovery transition is required because availability was never lost;
   - readiness copy does not flap unnecessarily.

3. actual `unloadModel` / binding loss:
   - affected tests become unavailable/stale exactly as governed;
   - editor and Manager agree;
   - Run blocks when the required model truly cannot be resolved.

4. reload as a **new key**:
   - old tests remain bound to the old unavailable key;
   - no automatic rebinding;
   - labels/disambiguation remain correct.

5. same-key recovery, if the host/runtime can produce it:
   - existing governed recovery behavior remains intact.

6. completed-result state:
   - hide-only visibility change must not incorrectly invalidate the completed run as "models changed";
   - actual availability/model identity change continues to invalidate according to contract.

7. Viewer presentation cleanup / ownership:
   - no regression to held-result ownership, overlays, isolation, selection, or switching teardown.

## Tests

Use TDD for the F-1 behavior.

Add/update only tests directly required to pin the chosen invariant.

At minimum, add mechanically meaningful coverage for:

- hide-only event:
  - Manager readiness remains available;
  - no `not loaded` copy;
  - no false `models changed`;
  - editor/Manager agreement;
  - Run eligibility remains consistent.

- show after hide:
  - no spurious transition.

- actual unload:
  - Manager and editor both become unavailable/not-ready;
  - Run disabled.

- unload then new-key reload:
  - old test does not rebind.

- same-key re-entry if already covered by current architecture:
  - preserve the prior behavior and prove no regression.

- active and inactive test records.

- previously completed run:
  - hide-only does not stale it;
  - actual unload/identity change still does.

Do not weaken or delete existing tests merely to make the new behavior pass.

If an existing test encodes the old hide==unavailable behavior, update it only after tracing confirms it is exactly the superseded F-1 contract.

## Governing documentation reconciliation

Because the owner has selected Option B, reconcile only the directly affected normative/current governing text necessary to make the invariant explicit.

Expected areas may include:

- Viewer Clash Panel design §26.6 / AC-M10;
- Clash Tests Manager implementation plan CTM-7/readiness language if it currently conflates hide with unload;
- current handoff.

Do not rewrite historical review artifacts.

Do not edit the prior upstream CTM-7 final report; preserve it as read-only historical input.

If a new upstream remediation report is needed, create a new report rather than mutating that prior report.

## Evidence-capture hardening for later H revalidation

The Independent Work Review also found that the prior JSON state captures were not independently reproducible because the in-page capture helper/schema/settle protocol was not retained.

For this remediation package, prepare the **future H revalidation support** so that when revalidation is separately authorized, the evidence method can be retained.

You may add a bounded, test/evidence-support script or durable capture helper **only if it belongs to the validation/evidence layer and does not alter production behavior**.

At minimum, define/persist:

- capture helper source;
- capture schema;
- field meanings;
- settle conditions;
- command sequence;
- hashing/manifest convention.

Do **not** run the headed H revalidation in this package unless separately authorized later.

The purpose here is to make the next evidence package reproducible.

## Internal review

Run one bounded internal review focused on:

- hide vs unload event classification;
- event-order races;
- Manager/editor readiness agreement;
- false stale-state transitions;
- actual-unload regression;
- new-key reload behavior;
- same-key recovery;
- active/inactive records;
- completed-result freshness;
- unintended Viewer ownership/presentation changes;
- spec/plan drift;
- tests that could pass vacuously;
- accidental L1–L8 / CTM-8 / unrelated scope;
- evidence-support code accidentally entering production paths.

Fix only in-scope findings.

Do not expand scope.

## Verification

Run the focused tests and the repository's relevant canonical suites required for this bounded remediation.

At minimum:

- focused manager/readiness/model-lifecycle tests;
- DOM tests if affected;
- canonical `npm test` if that is the repo's standard implementation gate;
- `git diff --check`;
- protected-path diff check.

Record exact counts.

No headed live run is required in this package.

## Protected boundaries

Do not change:

- collision algorithms;
- Viewer Adapter computational behavior;
- Core query semantics;
- result residency model;
- one-editor architecture;
- Manager/List ↔ Editor single-panel architecture;
- public APIs unrelated to the F-1 invariant;
- persistence/history/background runs;
- resize work;
- L1–L8;
- CTM-8;
- G2/C6/C8/G3/R20-1;
- unrelated UI polish;
- another milestone.

## Upstream remediation final report

Create one new upstream final report under:

`docs/research/`

Suggested filename:

`docs/research/2026-10-11-clash-tests-manager-ctm-7-f1-option-b-remediation-final-report.md`

Include:

- repo / branch / HEAD / origin / tree;
- owner decision: Option B;
- source/event investigation;
- exact root cause;
- files changed;
- normative contract change;
- implementation behavior;
- tests added/updated;
- verification counts;
- internal review findings/disposition;
- protected-scope verification;
- future headed H revalidation support;
- limitations/gaps;
- readiness for Independent Work review;
- exact next gate.

## Handoff

Update:

`docs/handoffs/latest.md`

Record concisely:

- current repo/branch/HEAD/tree;
- CTM-7 remains blocked pending remediation review/revalidation;
- owner selected Option B;
- remediation status;
- governing artifacts;
- new remediation final report;
- CTM-8 remains unauthorized;
- L1–L8 remain deferred;
- next gate;
- work that must not begin without authorization.

## Stop condition

Stop after:

- Option B remediation is implemented;
- directly affected tests are complete;
- governing current docs are reconciled;
- internal review is complete;
- verification is complete;
- remediation final report exists;
- handoff is updated.

Do not perform the headed H revalidation yet.

Do not commit or push.

The next gate is:

**Independent Work review of the bounded F-1 Option B remediation package.**
