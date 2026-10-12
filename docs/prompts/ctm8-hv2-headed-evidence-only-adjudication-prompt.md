# Claude/Codex Prompt — HV-2 Headed Evidence-Only Adjudication

## Owner authorization

The owner authorizes a **minimal headed evidence-only adjudication package** for CTM-8 HV-2 in:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This authorization is limited to determining whether the current HV-2 Focus check is:

- an evidence/check observability problem,
- an instrumentation/protocol mismatch,
- a real product defect,
- or still inconclusive.

This package must not rerun the headless CTM-8 campaign and must not modify production behavior.

## Owner dispositions already made

These decisions are already closed and must not be reopened:

### HM-REC

The 6/6 headed HM-REC `UNAVAILABLE` result is accepted as a **non-blocking protocol-conformant unavailable disposition**.

Do not open a separate HM-REC instrumentation package.

### Family M launch shift

The launch-0 versus launch-1/2 shift is accepted as a **non-blocking documented anomaly**.

Do not run a performance-refinement campaign for it in this package.

Do not assign a cause.

Do not derive a limit/budget/scalability claim from the shift.

### HV-2

HV-2 is **not accepted as demonstrated PASS**.

The current 9/9 headed result is insufficient to close the Focus correctness check.

This package exists only to adjudicate HV-2.

## Hard boundaries

Do **not**:

- rerun the mandatory headless campaign;
- rerun unrelated headed campaign points;
- modify production code;
- modify tests except for strictly non-production evidence tooling if absolutely necessary and explicitly justified;
- change Addendum B product semantics;
- change CTM-8 performance methodology;
- optimize Focus behavior;
- fix a product defect yourself;
- modify Core/collision/Viewer Adapter/host behavior;
- set limits/budgets;
- commit;
- push;
- begin another CTM-8 refinement package.

If HV-2 proves a real product defect, stop and return it to the responsible Addendum B implementation package.

## Governing inputs

Read and independently verify:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- current CTM-8 protocol (`CTM8-P0-v4`)
- `docs/research/2026-10-12-ctm-8-rebuild-cost-calibration-final-report.md`
- `docs/reviews/2026-10-12-ctm-8-execution-support-package-independent-work-review.md`
- relevant Addendum B design/spec sections defining Focus behavior
- relevant ViewerBridge / focus helper source
- existing CTM-8 headed evidence under:
  `docs/research/evidence/2026-10-12-ctm-8-rebuild-cost-calibration/`

Treat the existing CTM-8 execution report and Work review as evidence, not proof.

## First: verify repo state

Independently verify:

- repo / branch / HEAD / origin;
- working tree;
- no commit/push since the execution review;
- no unrelated production/test changes;
- CTM-8 execution package remains uncommitted;
- no separate refinement package already started.

If repo state materially differs, stop and report.

## Primary question

Answer exactly:

**Why did HV-2 fail to demonstrate Focus correctness at all 9 headed points?**

Classify the result as one of:

1. **CHECK/EVIDENCE DEFECT**
   - product Focus behavior is correct;
   - HV-2 check or observability method is wrong/inadequate.

2. **INSTRUMENTATION/PROTOCOL MISMATCH**
   - Focus may be correct;
   - current permitted instrumentation cannot prove it reliably.

3. **REAL PRODUCT DEFECT**
   - Focus behavior does not meet the accepted Addendum B contract.

4. **INCONCLUSIVE**
   - even after targeted evidence, correctness still cannot be established.

Do not invent a fifth category.

## Required source analysis

### 1. Exact HV-2 contract

Locate the exact HV-2 acceptance/check definition from the protocol/evidence package.

Record:

- preconditions;
- action;
- expected Focus behavior;
- expected observable post-state;
- current check predicate;
- why the previous 9 points did not satisfy it.

Do not paraphrase vaguely.

### 2. Addendum B Focus contract

Identify the accepted product behavior for selected-group Focus.

Determine:

- what user-visible behavior is actually required;
- whether Focus means fit-to-view / aggregate fit / camera movement / bounding visibility / another exact effect;
- which public Viewer state can prove it;
- whether the current HV-2 check measures the same thing.

### 3. Existing implementation path

Trace the current product path:

- group selection
- Focus action
- ViewerBridge/group presentation path
- aggregate fit helper
- any asynchronous Viewer/camera behavior
- available public observables

Identify whether the implementation has any obvious divergence from the accepted contract.

Do not modify it.

## Evidence-only execution

Run the smallest headed experiment necessary to adjudicate HV-2.

### Scope

Use only enough representative real Viewer/SVF2 points to determine the failure class.

Prefer:

- one low-scale Family R headed point;
- one middle/high naturally reachable Family R headed point;
- one multi-model point if needed to exercise aggregate fit.

Do not repeat all 9 original points unless evidence proves that repetition is necessary.

### Before each check

Record:

- exact model set;
- selected group;
- participant count;
- aggregate bounds if available;
- camera state before Focus;
- Viewer fit/focus-relevant public state;
- screenshot/state capture.

### Focus action

Trigger the exact existing user/product Focus action.

Do not substitute a direct helper call if the product path is meant to include UI/controller dispatch.

### After Focus

Wait using the smallest reliable public completion strategy available.

Record:

- camera state after;
- aggregate bounds / visible participant coverage;
- any Viewer public state relevant to fit;
- screenshots before/after;
- state captures/logs;
- whether camera actually changed;
- whether all selected-group participants are in-frame / fitted according to the accepted contract.

If there is no reliable public “fit complete” event, state that explicitly.

## Adjudication rules

### CHECK/EVIDENCE DEFECT

Use this only if visual/state evidence shows Focus behavior is correct and the existing HV-2 predicate is simply wrong or too strict.

Record the exact predicate defect.

### INSTRUMENTATION/PROTOCOL MISMATCH

Use this only if the product appears correct but the allowed instrumentation cannot prove completion/state strongly enough.

Record the missing observable.

### REAL PRODUCT DEFECT

Use this only if the actual visible/product behavior fails the Addendum B Focus contract.

Capture the concrete failure.

Do not fix it.

### INCONCLUSIVE

Use this only if targeted evidence still cannot distinguish the above categories.

Explain exactly why.

## Visual adjudication

Persist a small evidence package under:

`docs/research/evidence/2026-10-12-ctm-8-hv2-focus-adjudication/`

or the repository-conformant equivalent.

Include:

- screenshots before/after;
- state captures;
- console/log output where relevant;
- environment metadata;
- exact scenario IDs;
- manifest/checksum if consistent with repo evidence convention;
- a concise results file.

Report:

- PASS / FAIL / INCONCLUSIVE totals for the targeted cases;
- but do not redefine HV-2's historical 9/9 result.

The historical 9/9 remains preserved as prior evidence.

## No performance interpretation

Do not:

- measure Focus latency as a performance result;
- derive frame budgets;
- compare Focus timings across scale;
- infer scalability.

This package is correctness/evidence adjudication only.

## Required upstream artifact

Create a durable evidence/adjudication report under `docs/research/`.

Preferred filename:

`docs/research/2026-10-12-ctm-8-hv2-focus-adjudication-final-report.md`

The report must include:

- repo / branch / HEAD / origin / tree;
- governing HV-2 contract;
- Addendum B Focus contract;
- implementation-path analysis;
- targeted headed scenarios;
- evidence path;
- classification:
  - CHECK/EVIDENCE DEFECT
  - INSTRUMENTATION/PROTOCOL MISMATCH
  - REAL PRODUCT DEFECT
  - INCONCLUSIVE
- visual/state evidence;
- whether CTM-8 checkpoint can proceed;
- whether a separate product-remediation package is required;
- no performance claims.

## Handoff update

Update:

`docs/handoffs/latest.md`

Keep it concise.

Record:

- CTM-8 execution package remains complete;
- HM-REC accepted non-blocking unavailable;
- launch shift accepted non-blocking anomaly;
- HV-2 targeted adjudication status;
- evidence/report paths;
- whether checkpoint readiness is restored;
- exact next gate;
- commit/push remains unauthorized.

## Independent review boundary

Do **not** author the Independent Work Review yourself.

After the targeted HV-2 evidence/adjudication package and handoff update:

**STOP.**

The next gate is:

**Independent Work review of the HV-2 evidence adjudication package**.

## Stop condition

Do not:

- modify production behavior;
- fix Focus;
- rerun headless calibration;
- open broader refinement;
- commit;
- push.

Wait for Independent Work review and owner direction.
