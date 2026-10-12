# Claude/Codex Prompt — CTM-8 P0 Calibration Protocol Design

## Owner authorization

The owner authorizes **CTM-8 P0** as a **docs-only calibration protocol design package** for:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This authorization is limited to defining the CTM-8 calibration protocol.

Do **not** modify production code.
Do **not** modify tests.
Do **not** implement a benchmark harness unless the governing repo already treats that as documentation-only and no executable code is required.
Do **not** run the calibration campaign yet.
Do **not** establish production limits, performance budgets, scalability claims, or pass/fail thresholds.
Do **not** begin any later CTM-8 package.

## Owner decisions for P0

The following decisions are final for this package.

### Measurement modes

Use **both**:

1. **Headless measurement**
   - primary repeatable calibration mode;
   - intended for controlled, comparable measurements.

2. **Headed Viewer measurement**
   - real Viewer/SVF2 validation;
   - intended to confirm that the headless measurements represent actual product behavior and UI responsiveness.

P0 defines the protocol only. Actual calibration execution is a later gate.

### Exploratory scale points

Define the initial calibration matrix using:

**Records**
- 100
- 1,000
- 5,000
- 10,000

**Models**
- 1
- 2
- 3

These are **exploratory calibration points only**.

They are not:
- product limits;
- supported maximums;
- acceptance thresholds;
- scalability claims.

The later execution package may add intermediate or larger points if the measured curve shows a knee or other behavior that justifies refinement.

### Paths to include

P0 must include both:

1. **Selected-group path**
   - because aggregate group presentation is now a real product path after Addendum B;
   - measure any rebuild/presentation cost relevant to the selected-group state separately from ordinary unselected grouping where necessary.

2. **Cold-label and warm-label paths**
   - cold-label-index behavior must be measured separately;
   - warm/steady-state label behavior must be measured separately;
   - do not combine cold-index warm-up cost with ordinary steady-state rebuild cost into one metric.

## Repository workflow

Before editing documentation:

1. Identify the repository and confirm it is:
   `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
2. Read:
   - `CLAUDE.md`
   - `docs/handoffs/latest.md`
   - current CTM governing spec
   - current CTM implementation plan
   - `docs/reviews/2026-10-11-ctm-8-entry-gate-independent-work-review.md`
3. Verify independently:
   - branch;
   - HEAD;
   - `origin/main`;
   - working tree;
   - CTM-7 remains closed;
   - Addendum B checkpoint is present;
   - CTM-8 has no implementation/calibration package yet.
4. Confirm the current checkpoint:
   `ac5bcb42b00e668442ce3add9764cba96d883309`
5. If repo state materially differs from the CTM-8 entry review, stop and report the discrepancy.

Treat handoff/review content as navigation and evidence, not proof.

## P0 objective

Create a durable CTM-8 calibration protocol that defines:

- what will be measured;
- how it will be measured;
- which scenarios and scale points will be exercised;
- which environment/configuration must be controlled;
- how evidence will be captured;
- how measurements will be reported;
- how later interpretation will avoid unsupported performance claims.

The protocol must be sufficiently precise that a later execution package can run it without inventing methodology.

## Required protocol content

### 1. CTM-8 purpose and non-goals

State that CTM-8 is a **rebuild-cost calibration gate**.

Define the purpose as empirical measurement of the relevant Clash Tests Manager / Viewer Clash Panel rebuild and interaction costs across controlled scale points.

Explicitly state that P0 does **not**:

- define a supported record limit;
- define a supported model-count limit;
- define a frame-time budget;
- define a pass/fail threshold;
- claim scalability;
- claim production readiness at a particular scale;
- modify production implementation;
- remediate unrelated deferred findings.

### 2. Measurement questions

Define the exact questions the execution package must answer.

At minimum include:

- how rebuild cost changes with record count;
- how rebuild cost changes with model count;
- whether cost is approximately linear, superlinear, or shows a visible knee over the tested range;
- the cost difference between cold-label and warm-label paths;
- the incremental cost of selected-group state;
- whether headed Viewer responsiveness materially diverges from headless measurements;
- whether any scenario causes visible UI stalls, delayed presentation, or inconsistent state transitions.

Do not pre-answer these questions.

### 3. Scenario matrix

Define a scenario matrix covering the initial Cartesian scale points:

Records:
- 100
- 1,000
- 5,000
- 10,000

Models:
- 1
- 2
- 3

Specify which scenarios must be measured for each point.

At minimum distinguish:

- baseline rebuild with no active selected group;
- selected-group rebuild/presentation path;
- warm-label filtering/rebuild;
- cold-label filtering/rebuild.

If not every path should be run at every Cartesian point, justify the reduced matrix explicitly and preserve enough coverage to compare scaling behavior.

### 4. Headless protocol

Define the primary repeatable headless measurement method.

Specify:

- entry point / operation under measurement;
- setup steps;
- fixture generation or fixture selection;
- model-count construction;
- record-count construction;
- warm-up policy;
- cold versus warm label-index preparation;
- number of measured repetitions;
- whether first-run samples are excluded;
- timing source;
- synchronization rules;
- how asynchronous work is awaited;
- what constitutes measurement start and stop;
- how selected-group state is established;
- how previous state is reset between samples;
- how outliers are retained/reported rather than silently discarded.

Do not invent an executable implementation if the repo does not yet provide one. The protocol may specify what the later execution package must implement.

### 5. Headed Viewer protocol

Define the headed validation method against real Viewer/SVF2 models.

Specify:

- required real-model setup;
- Viewer version recording;
- browser/runtime/environment recording;
- model combinations for 1 / 2 / 3 model scenarios;
- how record-count scale is produced or selected;
- user-visible action sequence;
- focus/isolate/group-selection conditions where relevant;
- cold-label and warm-label sequence;
- how responsiveness is observed;
- how timing is captured if timing is feasible;
- what visual/state evidence is required.

Headed evidence must not be substituted for repeatable headless calibration, and headless numbers must not be assumed to represent user-visible responsiveness without headed corroboration.

### 6. Measurement metrics

Define the metrics to record without creating acceptance thresholds.

At minimum consider:

- elapsed rebuild duration;
- selected-group rebuild/presentation duration where separable;
- cold-label warm-up duration;
- warm-label rebuild duration;
- repetition count;
- median;
- p95 if repetition count is sufficient;
- min/max for context;
- model count;
- record count;
- environment metadata;
- visible headed responsiveness observation.

If a metric cannot be measured reliably with current architecture, mark it explicitly as unavailable or requiring instrumentation in the execution package.

Do not create fake precision.

### 7. Timing boundaries

Define precise timing boundaries for each measured operation.

The protocol must prevent mixing unrelated work into a sample.

For each scenario, state:

- setup excluded from measurement;
- work included in measurement;
- async completion condition;
- whether Viewer rendering/presentation is included or excluded;
- how headless and headed timing boundaries differ.

### 8. Cold-label versus warm-label policy

Define cold-label and warm-label as separate named scenarios.

Cold-label must capture the cost of the label-index warm-up path.

Warm-label must measure steady-state behavior after the label index is available.

Do not average these together into a single headline number.

Require reports to label them separately.

### 9. Selected-group path

Define how selected-group calibration differs from baseline.

At minimum specify:

- how a group is selected;
- whether group membership is fixed across repetitions;
- how filtered `memberIndexes` are controlled;
- whether `presentGroup()` is included in the measured boundary;
- whether Viewer focus/isolate is disabled or controlled for headless measurement;
- how headed validation confirms that the selected-group state remains correct.

Do not reopen Addendum B product semantics.

### 10. Fixtures and data provenance

Define requirements for fixture provenance.

The protocol must record:

- how synthetic or generated result sets are produced;
- whether record distributions are uniform or representative;
- how model keys / dbIds are generated or sourced;
- how duplicate participants are handled;
- whether fixture composition changes with model count;
- how fixture generation remains deterministic.

If real production distributions are unavailable, say so explicitly rather than claiming representativeness.

### 11. Environment control

Define environment metadata required for every calibration run.

Include as applicable:

- machine / CPU architecture;
- OS;
- runtime / Node version;
- browser version;
- APS Viewer version for headed runs;
- model identifiers;
- model loading mode if relevant;
- debug/release/dev-server state;
- background workload constraints.

The goal is repeatability, not environmental normalization.

### 12. Repetition and statistical reporting

Define a reasonable repetition policy for exploratory calibration.

The protocol must explain:

- warm-up count;
- measured repetition count;
- why the repetition count is sufficient for exploratory calibration;
- median reporting;
- p95 only when statistically meaningful;
- no silent outlier deletion;
- any sample exclusion rules must be predeclared and recorded.

Do not create a performance gate from these statistics.

### 13. Evidence layout

Define the durable evidence location for the later execution package, for example:

`docs/research/evidence/<date>-ctm-8-rebuild-cost-calibration/`

Define required contents such as:

- manifest/checksums where appropriate;
- raw measurement data;
- environment metadata;
- scenario matrix/results;
- headed screenshots/video/state captures where appropriate;
- execution notes;
- anomalies;
- exact commands.

Do not create fake evidence in P0.

### 14. Execution report contract

Define the later CTM-8 execution final report requirements.

The execution report should include:

- protocol version;
- commit/branch/environment;
- exact scenarios executed;
- raw/summary measurements;
- cold/warm separation;
- selected-group results;
- headed corroboration;
- anomalies;
- inconclusive cases;
- no unsupported extrapolation;
- explicit statement that tested points are calibration observations, not product limits.

### 15. Interpretation rules

Add strict interpretation rules.

The later execution package must not:

- extrapolate a supported maximum beyond measured points;
- convert a measured knee into a product limit without a separate reviewed decision;
- claim a frame-budget guarantee from a small sample;
- merge cold and warm measurements;
- compare headed and headless timings as if they measured identical boundaries unless the protocol explicitly makes them equivalent;
- hide failed/inconclusive scale points.

If results show a knee, timeout, or material responsiveness degradation, the next gate should be a review/decision on whether to refine scale points, add instrumentation, or open a design/implementation package.

### 16. Protected boundaries

P0 must explicitly preserve these boundaries:

- no production implementation;
- no tests implementation;
- no Core/collision/Viewer Adapter/host changes;
- no Viewer theming/selection changes;
- no public limits;
- no L1–L8 remediation;
- no Addendum B Low L1/L2 remediation;
- no hide/departure remediation;
- no neighboring navScope remediation;
- no new grouping semantics;
- no persistence/history work.

### 17. Exact execution gate

Define the next gate after P0.

The expected flow is:

1. Claude/Codex produces the docs-only P0 protocol.
2. Work performs an Independent Work Review of P0.
3. Owner decides whether to authorize CTM-8 calibration execution.
4. Only after that authorization may the execution harness/evidence package begin.

Do not authorize the execution package from inside P0.

## Governing artifact placement

Use the repository's existing artifact taxonomy.

Prefer a durable research/protocol artifact under `docs/research/` unless the governing CTM spec/plan clearly requires another location.

Suggested filename:

`docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`

If the repo's conventions require a different location/name, use the governing convention and explain the choice.

Because this is a docs-only protocol package, do not create an implementation final report.

## Required package report

Create a concise upstream package report only if the repository workflow requires a durable completion report for substantial research/protocol work.

If required, place it under `docs/research/*-final-report.md` and clearly distinguish:

- the protocol artifact itself;
- the package completion report.

Do not fabricate execution results.

## Handoff update

Update:

`docs/handoffs/latest.md`

Record concisely:

- repo / branch / HEAD / tree state;
- CTM-7 closed;
- Addendum B checkpoint;
- CTM-8 P0 authorized;
- protocol artifact path;
- P0 status;
- no calibration execution yet;
- blockers/deferred work;
- exact next gate: Independent Work Review of P0;
- CTM-8 execution remains unauthorized until owner approval after review.

## Stop condition

After the P0 protocol package and required handoff/report artifacts are complete:

**STOP.**

Do not execute calibration.
Do not create or modify benchmark code.
Do not modify production code or tests.
Do not commit or push unless separately authorized.
Do not begin the CTM-8 execution package.

The next gate is **Independent Work Review of CTM-8 P0**.
