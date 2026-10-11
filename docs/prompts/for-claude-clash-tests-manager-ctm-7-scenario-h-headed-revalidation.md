# For Claude — CTM-7 Scenario H Headed Revalidation Package Only

Repository:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

## Owner authorization

The owner authorizes **one bounded headed Scenario H revalidation package only** for the accepted CTM-7 F-1 Option B remediation.

This authorization includes the **mandatory fail-closed evidence-helper preflight** required by the latest Independent Work Review.

This authorization does **not** authorize:

- CTM-8;
- L1–L8 remediation;
- further production/test/spec/plan changes;
- helper redesign beyond the bounded preflight needed to establish trustworthy evidence;
- commit/push;
- persistence/history/background runs;
- resize/separate-panel work;
- Core / Viewer Adapter / collision changes;
- G2 / C6 / C8 / G3 / R20-1;
- another package or milestone.

## Start-state verification

Before any headed execution, independently verify:

- repository / branch / HEAD / origin;
- working tree;
- `CLAUDE.md`;
- `docs/handoffs/latest.md`;
- latest F-1 Option B Independent Work Review:
  `docs/reviews/2026-10-11-clash-tests-manager-ctm-7-f1-option-b-remediation-independent-work-review.md`;
- upstream remediation final report:
  `docs/research/2026-10-11-clash-tests-manager-ctm-7-f1-option-b-remediation-final-report.md`;
- governing spec §26.6 / AC-M10;
- CTM-7 plan row;
- evidence-support files:
  `docs/research/evidence-support/ctm-7-h-revalidation/`.

Repository state is authoritative. Treat handoff/reports as navigation, not proof.

If the repo state materially differs from the accepted remediation package, stop and report the discrepancy.

## Purpose

Revalidate **Scenario H only** against the accepted Option B invariant:

> `viewer.hideModel(...)` is visibility-only when the same model key remains computationally available.
>
> Hide must not leave the Manager in `not loaded` / `models changed` while the editor remains Ready.
>
> Actual unload / binding loss must still make the test unavailable.
>
> New-key reload must not rebind old tests.

This package is not a full A–J rerun.

## Mandatory fail-closed preflight

Before the first H mutation, validate the evidence-capture helper against the live Viewer/DOM/VM.

Use the exact retained helper/schema/protocol intended for this run.

Preflight must verify all of the following:

1. exact helper source, schema and protocol are retained and hashable;
2. helper syntax passes;
3. runtime identity is captured and matches the expected supported envelope;
4. H0 capture has:
   - non-null Viewer carrier;
   - non-null host/panel/controller carrier;
   - non-null Manager carrier;
   - non-null editor ViewModel carrier;
   - non-null catalog/registry/model carrier;
   - expected nonzero model/test counts;
   - exact known test IDs/names used by the H oracle;
   - non-null readiness/status/Run fields;
   - matching model IDs/keys across catalog/editor/Viewer reads;
5. every selector/private field used by the H oracle is validated against the live DOM/VM;
6. optional unsupported fields are explicitly excluded, not silently accepted as null;
7. exact argument forms for:
   - `hideModel`
   - `showModel`
   - `unloadModel`
   are verified before mutation;
8. every accepted capture has:
   - `problems: []`
   - `settle.stable === true`
   - `settle.timedOut === false`

If any required preflight item fails:

- stop the run;
- persist the failure evidence;
- do not claim Scenario H PASS/FAIL;
- do not change helper/product code;
- do not continue into mutation steps.

A failed preflight makes the package INCONCLUSIVE and returns to owner decision.

## Scenario H headed sequence

Use the normal APS Viewer app and the same accepted SVF2 fixture composition used in prior CTM-7 validation where practical.

Revalidate only the lifecycle needed for H.

### H0 — baseline

Establish and capture:

- configured test identity;
- Set A / Set B;
- active test;
- Manager readiness/copy;
- editor readiness/Run state;
- model keys / catalog presence / registry binding;
- prior-run freshness/status if using a previously completed test.

Expected: Manager and editor agree.

### H1 — hide one required model

Call `viewer.hideModel(requiredModel)` with the verified supported argument form.

After settle:

- same model key remains computationally available;
- Manager must **not** show `not loaded`;
- Manager must **not** show `Models changed since this run` solely because of hide;
- editor remains Ready if all other conditions remain valid;
- Run remains enabled;
- active/inactive test rows remain coherent.

Capture screenshot + structured state.

### H2 — run while hidden

Run the same clash test while the model is hidden.

Verify:

- Run starts;
- Run completes;
- coverage is full;
- result count is coherent with the accepted fixture expectation;
- Manager/editor status and count agree;
- no stale unavailable copy appears;
- no stale Viewer ownership/presentation leaks.

Capture evidence.

### H3 — show the same model

Call `viewer.showModel(sameModel)`.

Verify:

- no false availability recovery transition is required;
- no readiness flap;
- no stale `departed` state;
- Manager/editor remain coherent.

### H4 — actual unload

Call `viewer.unloadModel(requiredModel)` using the verified supported argument form.

After settle:

- affected test becomes unavailable/stale according to the governing contract;
- Manager shows the actual unavailability;
- editor becomes not-ready / Run-disabled;
- Manager/editor agree;
- unrelated tests are not incorrectly invalidated.

Capture evidence.

### H5 — reload as new key

Reload the same model through the normal host flow so that it receives a new model key, if that remains the host's actual behavior.

Verify:

- old test remains bound to the old unavailable key;
- no automatic rebinding;
- label/disambiguation remains correct;
- Manager/editor agree.

### H6 — same-key recovery

Only if the current host/runtime exposes a genuine same-key re-entry path already supported by the product, exercise it.

If no such safe headed path exists, mark this subcase INCONCLUSIVE rather than inventing one.

## Scenario verdict

Scenario H may be:

- **PASS** only if hide/show/unload/new-key behavior matches Option B with no Manager/editor contradiction;
- **FAIL** if a real product contradiction remains;
- **INCONCLUSIVE** if the mandatory preflight or required evidence path cannot establish the result.

Do not use PASS-with-finding.

## Evidence requirements

Persist a new H-revalidation evidence package under:

`docs/research/evidence/`

Use a date/scope-specific directory.

Include:

- exact capture helper source used;
- capture schema;
- settle protocol;
- exact command sequence;
- runtime identity;
- structured captures;
- screenshots;
- console log;
- scenario log;
- manifest / hashes;
- preflight result;
- H0–H5/H6 adjudication.

Every retained state capture must be traceable to the retained helper/schema/protocol version used for this run.

Review all screenshots yourself.

## Console/runtime review

Record:

- errors;
- warnings;
- model identity changes;
- Viewer version/browser/runtime;
- whether any host/Viewer behavior materially differs from the prior CTM-7 run.

Do not ignore a console/runtime contradiction merely because the UI looks correct.

## Protected boundaries

Do not modify:

- `clashpanel/core/testsManager.js`;
- any production code;
- tests;
- spec;
- plan;
- Core;
- Viewer Adapter;
- collision;
- UI layout;
- public API;
- L1–L8;
- CTM-8.

If headed H exposes a remaining product defect:

- preserve evidence;
- state exact failure;
- state minimum correction;
- stop for owner authorization.

Do not fix it.

## Upstream H-revalidation final report

Create one new upstream final report under:

`docs/research/`

Suggested filename:

`docs/research/2026-10-11-clash-tests-manager-ctm-7-scenario-h-headed-revalidation-final-report.md`

Include:

- repo / branch / HEAD / origin / tree;
- governing Option B decision;
- latest remediation Independent Work Review;
- mandatory preflight outcome;
- runtime/Viewer/browser/models;
- exact H sequence;
- H0–H6 results;
- final Scenario H verdict;
- Manager/editor readiness agreement;
- run/result-count observations;
- unload/new-key behavior;
- same-key recovery coverage/gap;
- evidence integrity;
- console/runtime observations;
- production/test/spec/plan zero-diff confirmation;
- CTM-8/L1–L8 untouched;
- readiness for Independent Work review;
- exact next gate.

## Internal review

Run one bounded internal review of the H evidence package.

Specifically check for:

- preflight not actually fail-closed;
- null/zero selectors accepted vacuously;
- stale helper/private-field assumptions;
- screenshot/state mismatch;
- hide and unload conflated;
- new-key reload misread as same-key recovery;
- successful run claimed without full coverage/result agreement;
- Manager/editor contradiction;
- unsupported selector or field silently ignored;
- missing helper/schema/protocol retention;
- production/test/spec/plan mutation;
- accidental CTM-8/L1–L8 work.

Resolve only documentation/evidence issues that are in scope.

Do not remediate product code.

## Handoff

Update:

`docs/handoffs/latest.md`

Record concisely:

- repo / branch / HEAD / tree;
- Option B remediation accepted;
- Scenario H revalidation package status;
- preflight status;
- final H verdict;
- evidence/report path;
- blockers/findings;
- CTM-7 closeout readiness;
- CTM-8 still unauthorized;
- L1–L8 still deferred;
- exact next gate;
- prohibited work.

## Stop condition

Stop after:

- preflight is complete;
- bounded headed H revalidation is complete or fail-closed inconclusive;
- evidence is retained and hashed;
- upstream H report exists;
- internal review is complete;
- handoff is updated.

Do not commit or push.

Do not start CTM-8.

The next gate is:

**Independent Work review of the bounded Scenario H headed revalidation package.**
