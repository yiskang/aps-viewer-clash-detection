# Claude/Codex Prompt — CTM-8 Execution and Support-Code Package (P0-v4 Baseline)

## Owner authorization

The owner authorizes the **CTM-8 execution/support-code package** for:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This authorization is based specifically on the accepted **CTM8-P0-v4** protocol and the latest PASS Independent Work Review.

This authorization is limited to:

- non-production calibration support code;
- deterministic calibration fixtures/generators;
- runtime-injected headed instrumentation;
- execution of the accepted mandatory CTM-8 campaign;
- durable evidence retention;
- CTM-8 execution final report;
- concise handoff update.

This authorization does **not** permit production behavior changes or performance remediation.

## Governing protocol and review

Use these as the primary governing inputs:

- `docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md` — version `CTM8-P0-v4`
- `docs/research/2026-10-12-ctm-8-p0-v4-correction-final-report.md`
- `docs/reviews/2026-10-12-ctm-8-p0-v4-targeted-independent-work-review.md`
- `docs/handoffs/latest.md`
- current CTM governing spec/plan
- `CLAUDE.md`

Latest authoritative review disposition:

- **PASS — READY FOR OWNER CTM-8 EXECUTION DECISION**
- 0 Critical / 0 High / 0 Medium / 5 Low
- blockers: none
- unresolved methodology decisions: none

The execution package must implement the accepted P0-v4 protocol exactly. Do not reopen methodology choices already closed by the owner and Work review.

## Hard boundaries

Do **not**:

- modify production code;
- modify runtime product behavior;
- add a production observation hook;
- change Core/collision/Viewer Adapter/host integration;
- change Viewer theming/selection;
- change public limits, budgets, thresholds, or supported maximums;
- optimize or remediate performance;
- remediate Addendum B L1/L2;
- remediate CTM-7 L1–L8;
- remediate O-1…O-4;
- remediate hide/departure, navScope, GP-F1, or other deferred findings;
- add new mandatory scenarios;
- turn optional SKEWED or `-PULL` into mandatory work;
- commit or push unless separately authorized after independent review.

Support code must remain clearly non-production and calibration-only.

## Before implementation/execution

Independently verify:

- repository path;
- branch;
- HEAD;
- `origin/main`;
- ahead/behind;
- working tree;
- modified/untracked paths;
- CTM-7 remains closed;
- Addendum B checkpoint remains intact;
- CTM8-P0-v4 is the current accepted protocol;
- no conflicting CTM-8 execution/support package already exists.

Expected checkpoint to verify, not assume:

`ac5bcb42b00e668442ce3add9764cba96d883309`

If repository state materially differs from the accepted review state, stop and report before changing files.

## Authorized implementation surface

You may create/modify **non-production calibration support only**, including as needed:

- headless calibration harness code;
- deterministic fixture generator code;
- test/support helpers under `test/` or another clearly non-production path;
- runtime-injected headed evidence instrumentation;
- calibration runner scripts/configuration;
- evidence manifest/checksum tooling;
- non-production support required for the P0-v4 Family R `mC` naming rule;
- support tests for the calibration tooling.

You are **not** authorized to modify production modules merely to make measurement easier.

If the accepted protocol cannot be executed without a production-code seam, stop and return to the owner gate.

## Mandatory campaign — frozen

### Family M

Scenarios:

- M-BASE
- M-REC
- M-HIT

Headless scale matrix:

Test records:
- 100
- 1,000
- 5,000
- 10,000

Referenced models per test record:
- 1
- 2
- 3

Mandatory Family M cells:

`3 × 4 × 3 = 36 cells / launch`

### Family R

Scenarios:

- R-BASE
- R-WARM
- R-GROUP-WARM
- R-COLD

Headless scale matrix:

Clash-result records:
- 100
- 1,000
- 5,000
- 10,000

Models:
- 1
- 2
- 3

Fixture profile:
- **UNIFORM only**

Mandatory Family R cells:

`4 × 4 × 3 × 1 = 48 cells / launch`

### Mandatory total

Per launch:

- Family M: 36
- Family R: 48
- total: **84 cells**

Across 3 launches:

- **252 cell executions**

Warm cells per launch:

- Family M: 36
- Family R warm: 36
- total: 72

Cold cells per launch:

- R-COLD: 12

Measured samples:

- warm: `72 × 30 × 3 = 6,480`
- cold: `12 × 15 × 3 = 540`
- total measured: **7,020**

Warm-ups:

- `72 × 5 × 3 = 1,080`

Total measured + warm-up operations:

- **8,100**

Do not execute SKEWED as mandatory.
Do not execute `-PULL` as mandatory.

They remain optional refinements and are not authorized by this package.

## Repetition and launch policy

Run exactly:

- 3 independent launches

### Warm cells

Per launch:

- 5 warm-up repetitions
- 30 measured repetitions

### Cold cells

Per launch:

- 15 measured repetitions

Do not silently reduce repetition counts.

## Timeout and failure policy

### Setup/reset timeout

Family M setup/reset uses the accepted protocol's **120,000 ms** untimed safety bound.

This is distinct from the per-sample measurement timeout.

If initial setup exceeds 120 seconds:

- retain the setup failure;
- mark the cell exactly as the protocol specifies, e.g. `INVALID_SETUP` / `NOT EXECUTED — setup timeout`;
- do **not** classify it as product performance failure;
- continue the rest of the campaign according to protocol rules.

No preflight probe is required.

### Per-sample timeout

Per measured sample:

- **30 seconds**

This is an execution safety bound only.

It is not:
- a performance threshold;
- a product budget;
- an acceptance target.

Timeout samples must remain in evidence.

### Consecutive failure rule

If one cell has 3 consecutive failures/timeouts:

- stop remaining repetitions for that cell only;
- preserve all collected samples;
- mark the cell failed/inconclusive as specified;
- continue the rest of the campaign.

A true global harness/runtime failure may stop the overall run and must be recorded distinctly.

## Statistics

Implement exactly the P0-v4 statistical policy.

Preserve at minimum:

- raw samples;
- median;
- min;
- max;
- warm p95 using the fixed protocol estimator;
- cold per-launch p95 = `n/a`;
- pooled p95 only if explicitly labelled pooled and computed exactly as specified.

Do not silently delete outliers.
Do not overwrite unsuccessful attempts with successful retries.

## Family M fixture contract

Implement the exact P0-v4 Family M fixture contract.

Use the verified support paths, including:

- `test/clashpanel/core/testsManager.integration.test.mjs`
- `test/clashpanel/support/controllerHarness.mjs`

### Naming

Each record uses:

`CTM8-M-<N>-<n>-<i>`

Where:

- `N` = manager test-record count
- `n` = referenced-model dimension
- `i` = deterministic record index

### Set A

- `[mA]`

### Set B

- `n=1` → `[mA]`
- `n=2` → `[mB]`
- `n=3` → `[mB, mC]`

### Semantic meaning of `n_models`

Family M `n_models` means:

**models referenced by each test record**

It does **not** mean catalog cardinality.

Record catalog cardinality separately:

- `n=1` → catalog contains `mA`, `mB`
- `n=2` → catalog contains `mA`, `mB`
- `n=3` → catalog contains `mA`, `mB`, `mC`

Do not change this definition.

## Family M subscriber placement

This is a frozen P0-v4 requirement.

For each Family M cell:

1. create/build all `N_tests` records with **no calibration/user subscriber attached**;
2. verify readiness/final fixture predicates;
3. perform the required untimed settle;
4. attach the no-op/counting calibration subscriber;
5. perform the protocol-defined post-subscribe untimed settle/cache/notification-stability proof;
6. only then begin warm-up and measured scenarios;
7. dispose in the exact accepted order:
   - unsubscribe
   - manager dispose
   - controller dispose

Do not attach the calibration subscriber during bulk fixture creation.

Do not infer any complexity class or feasibility claim from static code inspection.

## Family M scenarios

### M-BASE

Implement the exact accepted synchronous timing boundary.

The timed window must:

- start at `t0` immediately before the exact reversible catalog mutation / `catalog.fire()` defined by P0-v4;
- include the intended synchronous listener work and subscribed manager rebuilds;
- include the protocol-required final `manager.getViewModel()` / predicate if specified;
- contain **no `await`**;
- end at `t1` after the intended synchronous work returns.

Untimed quiescence drains occur before/after the sample as specified.

Async continuations are excluded.

Do not substitute another mutation or timing window.

### M-REC

Use the exact active-record setup/name transition.

Preserve the accepted inclusion of forwarded editor work.

Do not invent a manager-only seam.

### M-HIT

Use the exact accepted warm/cache-hit read path.

Do not redefine it.

## Family M model-axis framing

Do not claim that cost should scale materially with 1/2/3 referenced models.

Treat `n_models` as an exploratory controlled dimension only.

Record the results neutrally.

Do not infer slope/direction before measurement.

## Family R deterministic fixture contract

Implement the accepted UNIFORM generator exactly.

Preserve:

- deterministic seeds;
- exact model assignment;
- exact dbId assignment;
- exact duplicate-participant rules;
- exact expected counts;
- exact scenario identifiers.

Do not substitute SKEWED.

## Family R 3-model `mC` naming support

This is a frozen P0-v4 requirement.

Define/use the pure deterministic rule:

`NAME(modelKey, dbId)`

for all Family R model element names.

### mA / mB

Apply their generated names through the supported harness `names` option.

### mC

Immediately after `makeHarness`:

- replace `h.extraModels.mC.getObjectTree` with the non-production calibration behavior specified by P0-v4;
- ensure it resolves `mC` element names through the exact `NAME(modelKey, dbId)` rule;
- perform this before:
  - relevant dispatch/sealing;
  - label reads;
  - warm/cold sentinel establishment;
  - manifest hashing;
  - any timed sample.

Do not edit production code.

Do not edit `controllerHarness.mjs` unless P0-v4 explicitly authorizes the later non-production support implementation there. Prefer the minimum support implementation required by the accepted protocol.

### Pre-timing proof

Before any Family R timed sample, prove the fixture is valid exactly as specified by P0-v4, including:

- `mC` object identity / expected harness reference;
- every generated distinct reference resolves to the expected `NAME`;
- exact first-ViewModel counts;
- warm-sentinel reference lists/counts;
- no mismatch in 1/2/3-model scenarios.

If the proof fails:

- classify as invalid setup;
- do not measure the cell.

## Cold/warm observability

Use only the accepted public sentinel method.

Do not read/expose private state such as:

- `textIndexed`
- `labelsPending`

Do not add an observation seam.

### R-WARM

Only classify warm when the exact public predicate passes.

If it cannot be proven:

- record unavailable/inconclusive exactly as specified;
- do not guess.

### R-COLD

Measure the total cold path.

The exact label-index commit sub-phase remains unavailable.

Do not fabricate or infer a timestamp for it.

## Selected-group comparator

Implement R-GROUP-WARM exactly.

Requirements:

- fixed selected-group identity;
- identical `memberIndexes` across the paired T1/T2 path;
- no membership-change work in the primary timed comparator;
- no `presentGroup()` scheduling inside the timed window when excluded by protocol;
- explicit proof/assertion that membership remains unchanged.

Do not include optional membership-changing variants in the mandatory campaign.

## Headless timing

For every scenario:

- keep untimed setup outside measurement;
- take start timestamp at the exact P0-v4 boundary;
- await only the exact protocol-defined completion where async completion is part of the scenario;
- stop at the exact accepted completion point;
- reset/settle exactly as specified before the next sample.

Do not mix setup, label preparation, Viewer presentation, or unrelated async work into scenarios where P0-v4 excludes them.

## Headed corroboration

Headed mode is product corroboration, not the primary scaling curve.

Use real Viewer/SVF2 paths only.

### Family M headed points

Use:

Test records:
- 5
- 25
- 100

Models:
- 1
- 3

### Family R headed points

Use only the practical real-product corroboration subset specified by P0-v4.

For requested 5,000 / 10,000 result targets:

- attempt only if naturally reachable;
- record configured/produced/retained/truncated counts;
- if unreachable, record the accepted `NOT REACHABLE HEADED` / equivalent disposition;
- nearest reachable points may be used only if explicitly labelled;
- do not inject synthetic records and call them real headed evidence.

### Viewer work

Where Viewer completion is not publicly observable, keep operations such as:

- `presentGroup`
- Focus
- Isolate
- restore / Back to All

outside the timing boundary and treat them as correctness-only checks.

Do not claim their timing is included.

## Evidence retention

Create durable evidence under the protocol-defined path, expected in the form:

`docs/research/evidence/<date>-ctm-8-rebuild-cost-calibration/`

Follow the exact P0-v4 naming/layout if different.

Preserve:

- raw measurement records;
- scenario IDs;
- launch IDs;
- seeds;
- environment metadata;
- exact commands;
- configured/produced/retained/truncated counts;
- invalid samples;
- setup-timeout cells;
- timed-out samples;
- failed cells;
- inconclusive/unavailable cells;
- statistical summaries;
- headed screenshots/state/video where required;
- console/log evidence;
- manifests/checksums where required;
- anomalies.

Do not hide unsuccessful outcomes.

## Environment metadata

Record all protocol-required environment metadata, including as applicable:

- machine/CPU architecture;
- OS;
- runtime/Node version;
- browser version;
- APS Viewer version;
- model identifiers;
- loading mode;
- debug/release/dev-server state;
- relevant environment flags.

## Interpretation safeguards

Do not claim:

- supported maximum;
- record limit;
- model-count limit;
- performance budget;
- frame-time guarantee;
- scalability certification;
- production readiness at a specific scale.

Do not extrapolate beyond measured points.

Do not convert a knee into a product limit.

Do not merge cold and warm results.

Do not present setup-timeout/unreachable cells as product performance failures.

Do not treat headed/headless timings as equivalent unless their boundaries are truly equivalent under P0-v4.

## Support-code quality

Calibration support code must be:

- deterministic;
- non-production;
- minimal;
- independently reviewable;
- isolated from runtime product behavior.

Add focused tests for support tooling where appropriate, especially:

- fixture determinism;
- Family M cell construction;
- Family R `mC` naming injection;
- scenario enumeration;
- arithmetic;
- timeout/failure handling;
- raw evidence serialization.

Do not modify production tests merely to force calibration success.

## Required verification before completion

At minimum:

- run calibration-support tests;
- run relevant existing tests needed to ensure support code did not disturb test infrastructure;
- run `git diff --check`;
- inspect protected paths;
- verify no production path changed;
- verify mandatory enumeration equals:
  - 84 cells / launch
  - 252 cell executions
  - 7,020 measured
  - 1,080 warm-ups
  - 8,100 total operations;
- verify SKEWED and `-PULL` are absent from mandatory execution;
- verify Family R 3-model preflight/name proof works;
- verify Family M subscriber is absent during fixture build and present during measured scenarios.

Record exact test totals.

## Execution final report

Create:

`docs/research/<date>-ctm-8-rebuild-cost-calibration-final-report.md`

or the repository-conformant equivalent.

The report must include:

- repo / branch / HEAD / origin / tree state;
- protocol version/hash;
- support-code implementation scope;
- exact changed non-production support/test files;
- exact campaign executed;
- cells attempted/completed/failed/inconclusive;
- setup-timeout cells;
- exact sample counts;
- environment;
- Family M results;
- Family R results;
- model-axis observations stated neutrally;
- cold/warm separation;
- selected-group results;
- headed corroboration;
- unreachable headed points;
- timeouts/failures;
- anomalies;
- raw evidence path;
- summary statistics;
- no-extrapolation statement;
- any observed knee/degradation as observation only;
- unresolved questions;
- whether a follow-up refinement/optimization decision is warranted.

Do not make the owner decision yourself.

## Handoff update

Update:

`docs/handoffs/latest.md`

Keep it concise.

Include:

- repo / branch / HEAD / tree state;
- CTM-7 closed;
- Addendum B checkpoint;
- CTM8-P0-v4 accepted;
- execution package status;
- protocol path/version;
- execution final report path;
- evidence path;
- support-code paths;
- campaign completion summary;
- blockers/anomalies;
- deferred work;
- exact next gate;
- commit/push remains unauthorized.

## Independent review boundary

Do **not** author the Independent Work Review yourself.

After support code, execution, evidence, final report, and handoff are complete:

**STOP.**

The next gate is:

**Independent Work review of the CTM-8 execution/support-code package**.

That review must independently adjudicate:

- support-code scope;
- protocol conformance;
- Family R 3-model support;
- Family M subscriber placement;
- M-BASE timing boundary;
- mandatory arithmetic;
- setup-timeout handling;
- evidence integrity;
- timing boundaries;
- headed corroboration;
- interpretation claims;
- whether any observed knee/anomaly requires owner action.

## Commit/push boundary

Do not commit.
Do not push.

Checkpoint commit/push requires a later owner decision after Independent Work Review.

## Stop condition

When the authorized execution package is complete:

**STOP.**

Do not:

- optimize performance;
- open remediation;
- set limits/budgets;
- modify production;
- begin another CTM-8 package;
- commit/push.

Wait for Independent Work review and owner direction.
