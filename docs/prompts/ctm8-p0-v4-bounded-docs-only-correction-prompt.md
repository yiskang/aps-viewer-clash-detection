# Claude/Codex Prompt — CTM8-P0-v4 Bounded Docs-Only Correction

## Owner authorization

The owner authorizes a **bounded docs-only correction** of CTM8 P0, producing **CTM8-P0-v4**, in:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This authorization is limited to correcting the protocol defects identified in the latest failed targeted review:

- **High H1** — Family R `n_models=3` fixture/name-count contract is not executable as written because `makeHarness` hard-wires `mC` element names
- **High H2** — Family M fixture construction attaches the subscriber too early, causing repeated full manager ViewModel rebuilds during setup and making large `N_tests` setup impractical
- **Medium M1** — M-BASE timing window boundary is under-specified
- **Medium M2** — Family M cost-model prose overstates the effect of the 1/2/3 model axis

Do **not** broaden scope beyond these four findings except for strictly necessary documentation consistency in the same affected sections.

## Hard boundaries

Do **not**:

- execute calibration;
- create or modify headless calibration harness code;
- create or modify deterministic fixture-generator code;
- create observation seams;
- create headed instrumentation;
- modify production code;
- modify tests;
- modify CTM-7 or Addendum B implementation;
- remediate unrelated deferred findings;
- reopen already settled owner methodology decisions;
- commit;
- push;
- begin another CTM-8 package.

This is a docs-only correction.

## Before editing

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
- no CTM-8 execution/support code has begun.

Expected checkpoint to verify, not assume:

`ac5bcb42b00e668442ce3add9764cba96d883309`

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- current CTM governing spec/plan
- `docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`
- latest CTM-8 P0 correction/remediation reports
- latest failed targeted Independent Work Review
- the relevant source/support files cited by the findings, including:
  - `test/clashpanel/support/controllerHarness.mjs`
  - `clashpanel/core/managerViewModel.js`
  - any manager/controller source needed to verify exact setup and timing semantics

If repo state materially differs from the reviewed state, stop and report before editing.

## Preserve all previously closed protocol decisions

Do not reopen these:

### Mandatory Family M headless matrix

Scenarios:
- M-BASE
- M-REC
- M-HIT

Scale:
- 100 / 1,000 / 5,000 / 10,000 test records
- 1 / 2 / 3 referenced models per test record

### Mandatory Family R headless matrix

Scenarios:
- R-BASE
- R-WARM
- R-GROUP-WARM
- R-COLD

Scale:
- 100 / 1,000 / 5,000 / 10,000 clash-result records
- 1 / 2 / 3 models
- UNIFORM only

SKEWED remains optional only.

### Mandatory arithmetic

- 84 cells / launch
- 252 cell executions across 3 launches
- 7,020 measured samples
- 1,080 warm-ups
- 8,100 total operations

### Launch / repetition policy

- 3 launches
- 30 measured warm repetitions
- 15 measured cold repetitions
- 5 warm-ups per warm cell

### Timeout / failure policy

- 30 s per sample
- safety bound only
- after 3 consecutive failures/timeouts, abort only that cell and continue the campaign
- global harness/runtime failures remain separately classified

### Observability

- public sentinel only
- no observation seam
- exact label-index commit sub-phase unavailable

### Headed Family M

- 5 / 25 / 100 test records
- 1 / 3 models

## High H1 — repair Family R `n_models=3` fixture contract

The latest review found that the current Family R three-model protocol cannot run as written because `makeHarness` hard-wires `mC` element names in `controllerHarness.mjs`.

### Required correction

Inspect the actual harness source and define a Family R fixture contract that is executable **without changing support code yet**.

The corrected protocol must explicitly define:

- how the Family R harness receives or derives model/element-name data for `mA`, `mB`, and `mC`;
- how tag/name expectations are constructed for:
  - 1 model
  - 2 models
  - 3 models
- how the UNIFORM generator derives expected counts for the 3-model case;
- how the public label/filter sentinel remains valid when `mC` is involved;
- how the fixture proves its expected names/counts before any timed sample runs.

Do not assume the current hard-wired `mC` names match generated protocol tags.

If the current support API cannot express the required three-model naming contract exactly, the protocol must state the **minimum non-production support-code change** the later execution package must implement.

That support-code change may be authorized later, but this docs-only package must **specify it precisely** now.

Do not silently reduce the mandatory 3-model Family R matrix unless source evidence proves the protocol cannot support it and an owner decision is required.

### Acceptance for this correction

The protocol must leave the future execution agent with an exact, source-consistent rule for constructing and validating 3-model Family R fixtures.

No tag/name/count rule may remain implicit.

## High H2 — move Family M subscriber attachment after fixture build

The latest review found that the protocol registers a subscriber before Family M fixture construction.

Because each manager mutation then rebuilds the full manager ViewModel, large fixture creation can repeatedly trigger full rebuild work during untimed setup.

This makes the setup itself pathologically expensive and may cause 5,000 / 10,000 record cells to hit the setup timeout before calibration begins.

### Required correction

Update the Family M fixture construction protocol so:

1. the fixture is created **without the calibration subscriber attached**;
2. all `N_tests` records are fully constructed and settled first;
3. readiness/final fixture predicates are verified;
4. only then is the calibration subscriber attached;
5. the measurement scenario begins after subscriber registration and any defined final untimed settle;
6. subscriber lifecycle/disposal is exact and per-cell/per-launch as defined by the protocol.

The protocol must state the exact order.

### Important distinction

Do not claim or infer a measured complexity class from the static code inspection.

The review's “roughly cubic total setup cost” concern is a static risk estimate, not calibration data.

The corrected protocol should say only:

- early subscriber attachment causes repeated full ViewModel rebuilds during fixture creation;
- this contaminates setup and makes large setup impractical;
- subscriber-after-build isolates fixture construction from measured subscribed rebuild behavior.

Do not turn that static reasoning into a performance claim.

### Compatibility

Verify the corrected subscriber timing remains compatible with:

- M-BASE
- M-REC
- M-HIT

and does not accidentally remove required subscribed behavior from the actual timed scenario.

## Medium M1 — freeze M-BASE timing window exactly

The latest review says the M-BASE measurement window remains under-specified.

### Required correction

Define one exact M-BASE timing contract.

The protocol must state:

- exact untimed pre-state;
- exact reversible catalog mutation;
- exact API/intent used to apply it;
- exact timestamp start point;
- exact subscribed work included;
- exact async/semantic completion predicate;
- exact timestamp stop point;
- whether editor/controller side effects are included or excluded;
- exact reverse/reset mutation after the sample;
- settle condition before the next repetition.

Do not leave “catalog change” or “rebuild completes” as informal language.

The future harness must be able to implement M-BASE from the protocol without interpreting the boundary.

## Medium M2 — correct Family M model-axis cost claims

The latest review found that protocol prose overstates how much the Family M 1/2/3 referenced-model dimension should affect cost.

### Required correction

Remove or rewrite any claim that implies:

- manager rebuild cost should scale materially with the 1/2/3 model axis;
- `modelsChangedOf` / `derivedOf` necessarily impose substantial model-count-dependent work;
- the model axis is expected to produce a particular slope.

Replace with neutral empirical framing:

- `n_models` is an exploratory controlled dimension;
- it changes per-record reference/readiness/model-change state;
- current source inspection suggests much of manager rebuild cost may remain dominated by test-record count;
- the calibration must measure whether the model dimension has a material effect;
- no effect size or direction is assumed before measurement.

Do not make a scalability claim from static inspection.

### Preserve current semantic definition

Family M `n_models` remains:

**the number of models referenced by each test record**, not catalog cardinality.

Keep catalog cardinality reported separately.

Do not reopen that owner-approved definition.

## Low findings

The latest review also reported 5 Low items.

Do not independently remediate unrelated Low findings in this package.

You may fix a Low only if:

- it is in the exact paragraph/section being edited for H1/H2/M1/M2; and
- leaving it would make the corrected text internally contradictory.

Otherwise leave it deferred and record it in the correction report if relevant.

## Protocol version

Update the current protocol version to:

`CTM8-P0-v4`

or the repository-consistent equivalent.

Do not create a parallel competing protocol.

Update in place:

`docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`

## Required correction report

Create a new durable correction report under `docs/research/`.

Preferred filename:

`docs/research/2026-10-12-ctm-8-p0-v4-correction-final-report.md`

The report must record:

- repo / branch / HEAD / origin / tree state;
- governing failed targeted review;
- owner authorization for bounded v4 correction;
- H1 disposition;
- H2 disposition;
- M1 disposition;
- M2 disposition;
- any strictly necessary Low consistency edits;
- protocol version/hash;
- confirmation that mandatory campaign arithmetic is unchanged;
- confirmation no calibration was run;
- confirmation no harness/generator/seam/support code was created;
- confirmation no production/test code changed;
- residual limitations;
- exact next gate.

Preserve all older P0 reports and prior reviews as historical artifacts.

Do not rewrite them except for an allowed concise supersession pointer if repository workflow permits it.

## Handoff update

Update:

`docs/handoffs/latest.md`

Keep it concise.

Record:

- repo / branch / HEAD / tree state;
- CTM-7 closed;
- Addendum B checkpoint;
- CTM-8 P0-v4 status;
- protocol path/version;
- latest failed targeted review;
- v4 correction final report;
- H1/H2/M1/M2 correction status;
- execution/support code remains unauthorized;
- exact next gate: targeted Independent Work re-review of CTM8-P0-v4;
- no commit/push authorization.

## Verification before stopping

Perform documentation-only verification.

At minimum:

- re-read the full affected protocol sections;
- verify Family R 3-model fixture contract is source-consistent and executable;
- verify the future support-code requirement, if any, is explicit and non-production;
- verify Family M subscriber is attached only after fixture build/settle;
- verify M-BASE timing boundaries are exact;
- verify Family M cost-model prose is neutral and empirical;
- verify no mandatory campaign arithmetic changed;
- verify no SKEWED or `-PULL` scope regression;
- verify no private-state observability regression;
- verify no support-code authorization leaked into P0;
- run `git diff --check`;
- verify every changed path remains under `docs/`.

Do not run calibration or test suites.

## Stop condition

After the CTM8-P0-v4 docs-only correction is complete:

**STOP.**

Do not:

- execute calibration;
- create harness/generator/instrumentation;
- modify production/tests/spec/plan;
- create observation seams;
- commit;
- push;
- begin another CTM-8 package.

The next gate is:

**targeted Independent Work re-review of CTM8-P0-v4**.
