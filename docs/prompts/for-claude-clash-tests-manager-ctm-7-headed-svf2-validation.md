# For Claude — CTM-7 Headed SVF2 Product Validation Package Only

Repository:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

## Owner authorization

The owner explicitly authorizes **CTM-7 headed SVF2 product validation only** for the checkpointed Clash Tests Manager v1.

This authorization does **not** authorize CTM-8, remediation, production changes, L1–L8 work, persistence/history/background runs, or any new product scope.

The current accepted checkpoint is:

`85aee231289dab39b7d98a63c9f2067b57db01b6`

Before doing anything, independently verify the repository state rather than assuming the checkpoint still matches this value.

## Start-state verification

Verify:

- repository / branch / HEAD / origin;
- working tree;
- `CLAUDE.md`;
- `docs/handoffs/latest.md`;
- latest Clash Tests Manager implementation and UI-layout checkpoints;
- governing spec and accepted implementation plan;
- latest Independent Work reviews;
- current CTM-7 definition / acceptance requirements in the governing artifacts.

Treat handoff content as navigation, not proof.

If repository state, governing artifacts, or CTM-7 scope differ materially from this prompt, stop and report the discrepancy instead of silently reconciling it.

## Purpose

CTM-7 is the **real headed SVF2 product-flow validation gate** for the session-scoped Clash Tests Manager.

This is not another UI-layout validation.

The question to answer is:

> Does the accepted Clash Tests Manager v1 behave coherently and reliably through its real multi-test lifecycle in the normal APS Viewer / SVF2 federated workflow?

Use the repository's existing normal Viewer host, supported demo/sample path, and existing Audubon or equivalent accepted SVF2 fixtures. Do not invent a parallel host or alternative product path if the repo already provides one.

## Required scope

Validate the current implementation in a real headed Viewer session with actual SVF2 model instances.

At minimum, exercise and persist evidence for the following product flows where the current implementation and fixtures make them applicable.

### A. Session manager basics

1. Open Clash Tests Manager.
2. Verify the existing list of session tests is coherent.
3. Create a new Clash Test.
4. Give it a test name.
5. Configure Set A / Set B.
6. Select Hard or Soft as supported by the real fixture/configuration.
7. Return to Manager and confirm the new test's summary/readiness is correct.

### B. Multiple tests / active-test lifecycle

1. Maintain at least two distinct Clash Tests in the same Viewer session.
2. Switch the active test between them.
3. Verify Manager ↔ Editor state stays aligned.
4. Verify only the active test owns the live result set / Viewer-facing state.
5. Verify inactive tests retain the intended session metadata/readiness without incorrectly retaining Viewer ownership.
6. Verify opening a different test does not leak the prior test's result presentation or selection state.

### C. Run lifecycle

For at least one real federated test:

1. Open the test.
2. Run it to completion when practical under the accepted fixtures.
3. Verify:
   - status;
   - result count;
   - readiness;
   - Manager summary;
   - Editor state;
   - result ownership;
   - Viewer presentation.
4. Return to Manager and reopen the completed test.
5. Verify the held result set is the expected active test result set and is not duplicated across inactive tests.

If a Soft run is not honestly executable with the current fixture/basis contract, record that limitation rather than fabricating a PASS.

### D. Switching with held results / confirmation behavior

Exercise the implemented confirmation behavior when switching away from a test that has the relevant held/unsaved state.

Verify:

- the confirmation appears only when the governing contract requires it;
- cancel leaves the current active test/state intact;
- confirm performs the intended switch;
- no stale Viewer state remains after the switch.

Do not broaden or reinterpret the confirmation contract.

### E. Duplicate

1. Duplicate a configured test.
2. Verify the duplicated record carries exactly the contractually intended fields.
3. Verify the duplicate receives independent identity/session state.
4. Verify no result-set or Viewer ownership is incorrectly shared.
5. Verify basis attestation semantics remain as governed.

### F. Reset results

1. Use Reset results on an eligible test.
2. Verify result/status fields return to the intended state.
3. Verify configuration remains intact.
4. Verify Viewer-side held result presentation is cleared as intended.
5. Verify Manager and Editor agree afterward.

### G. Delete

1. Delete a non-active test if applicable.
2. Delete an active test if the governing contract permits it.
3. Exercise the confirmation.
4. Verify deleting the last test produces the governed fresh-test behavior.
5. Verify no deleted test continues to own Viewer/result state.

### H. Model departure / readiness / stale behavior

Exercise the existing event-only model-departure and same-key re-entry contract using the normal Viewer flow.

Validate, where safely reproducible:

1. A referenced model leaves the Viewer/session.
2. Affected tests become stale/not-ready exactly as governed.
3. Unrelated tests are not incorrectly invalidated.
4. The same model key re-enters.
5. Readiness/status recovers according to the governing contract.
6. No hidden rebinding/persistence behavior outside v1 scope appears.

If the normal host does not expose a safe path for one of these transitions, record it as INCONCLUSIVE rather than modifying the product or host.

### I. Manager ↔ Editor round trips

Across the scenarios above, repeatedly move:

Manager → Editor → Manager.

Verify:

- active test identity;
- test name;
- Set A / Set B;
- mode;
- readiness;
- status;
- result count;
- confirmation state;
- Viewer/result ownership;

stay coherent.

### J. Fault/recovery paths

Only exercise fault/recovery states if the repository already contains a **safe, existing, accepted** way to trigger them without modifying production or acceptance semantics.

Do not invent a new fault injection path for CTM-7.

If not exercised headed, retain existing automated coverage and explicitly mark the headed path as not exercised.

## Product assertions to protect

CTM-7 must not silently change or reinterpret:

- single DockingPanel Manager/List ↔ Editor architecture;
- one editor controller;
- headless manager semantics;
- one active test;
- active-test-only held Result Set / residency;
- Viewer mutation ownership;
- existing public APIs / intents / dispatch contracts;
- atomic test-load semantics;
- readiness/recovery/fault contracts;
- Create / Open / Duplicate / Reset / Delete semantics;
- Set A / Set B identity/label contracts;
- confirmation behavior;
- event-only model departure / same-key re-entry behavior;
- current UI layout checkpoint.

## Explicitly unauthorized

Do **not**:

- change production code;
- change tests to make CTM-7 pass;
- change the governing spec/plan;
- remediate L1–L8;
- execute CTM-8;
- change performance architecture;
- add persistence/history/background runs;
- add New / Existing / Resolved issue lifecycle;
- add cloud/server persistence;
- add resize features;
- reopen separate-panel architecture;
- change Core / Viewer Adapter / collision;
- change G2 / C6 / C8 / G3 / R20-1;
- upload/retranslate models unless the governing CTM-7 procedure explicitly requires an already-authorized fixture operation;
- commit;
- push;
- begin another package or milestone.

If validation exposes a genuine product defect, preserve the evidence, identify the minimum correction, and stop for owner authorization. Do not fix it during CTM-7.

## Evidence requirements

Persist durable evidence under a new CTM-7-specific directory beneath:

`docs/research/evidence/`

Use the repository's current evidence conventions.

Include as applicable:

- screenshots;
- structured JSON/state captures if existing tooling supports them;
- console/runtime logs;
- run/result summaries;
- exact scenario mapping;
- Viewer/browser/runtime/model identities;
- manifest / hashes where this repository's current evidence convention requires them.

Every required CTM-7 scenario must be explicitly adjudicated:

- PASS
- FAIL
- INCONCLUSIVE
- N/A only where the governing contract truly makes the scenario inapplicable

Do not convert missing evidence into PASS.

Review all retained screenshots/evidence yourself before closeout.

## Visual/product adjudication

This package is primarily a product-flow validation, but visible UI/Viewer behavior matters.

Independently inspect:

- Manager summaries;
- Editor state;
- active test;
- result counts/status;
- confirmations;
- readiness/stale state;
- Viewer result presentation/cleanup;
- result ownership when switching tests;
- no stale overlays/selection/isolation/markers leaking across tests.

If any visible product contradiction exists, record it as a finding even if automated tests remain green.

## Verification

Run only the verification needed for CTM-7 and to establish that validation did not mutate the accepted codebase.

At minimum:

- verify repository diff before and after validation;
- `git diff --check`;
- confirm production/test files are unchanged;
- confirm no prohibited scope entered the tree.

Do not rerun CTM-8 or unrelated heavy suites merely for completeness unless a governing CTM-7 requirement explicitly demands them.

## Upstream final report

Create exactly one upstream package final report under:

`docs/research/`

Suggested filename:

`docs/research/2026-10-11-clash-tests-manager-ctm-7-headed-svf2-validation-final-report.md`

The report must include:

- repo / branch / HEAD / origin / tree state;
- governing CTM-7 contract and artifacts;
- exact runtime / Viewer / browser / fixtures;
- exact launch procedure;
- scenarios exercised;
- scenario-by-scenario PASS / FAIL / INCONCLUSIVE / N/A;
- totals;
- screenshots/evidence index;
- active-test/result-ownership observations;
- run/status/result-count observations;
- duplicate/reset/delete observations;
- model-departure/re-entry observations;
- confirmation observations;
- fault/recovery coverage and gaps;
- console/runtime observations;
- evidence integrity;
- deviations / limitations;
- confirmation that no production/test/spec/plan change occurred;
- confirmation CTM-8 and L1–L8 were not entered;
- internal review findings and disposition;
- readiness for Independent Work review;
- exact next gate.

## Internal review

Perform one normal bounded internal review of the CTM-7 evidence/package.

Review specifically for:

- evidence gaps presented as PASS;
- stale Viewer state across test switches;
- result ownership contradictions;
- Manager/Editor disagreement;
- stale readiness after model departure/re-entry;
- incorrect duplicate/reset/delete semantics;
- confirmation behavior drift;
- accidental reliance on UI text instead of stable state where inappropriate;
- production/test mutation during validation;
- accidental CTM-8/L1–L8/new-scope work;
- unsupported claims about Soft/fault/non-Chromium behavior;
- visual evidence that contradicts written conclusions.

Resolve documentation/evidence defects inside this validation package if in scope.

Do not remediate production behavior.

## Handoff

Update:

`docs/handoffs/latest.md`

Keep the newest entry concise and include:

- repo / branch / HEAD / tree state;
- current checkpoint `85aee23` or the verified current checkpoint SHA;
- CTM-7 status;
- governing artifacts;
- CTM-7 final report and evidence;
- scenario totals;
- blockers/findings;
- CTM-8 still unauthorized;
- L1–L8 still deferred;
- exact next gate;
- prohibited work.

## Stop condition

Stop after:

- CTM-7 headed SVF2 validation is complete;
- evidence is durable;
- all scenarios are adjudicated;
- the upstream final report exists;
- internal review is complete;
- handoff is updated.

Do not implement fixes.

Do not commit or push.

The next gate is:

**Independent Work review of the CTM-7 headed SVF2 product-validation package.**
