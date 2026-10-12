# Claude/Codex Prompt — CTM-8 P0 Docs-Only Remediation

## Owner authorization

The owner authorizes a **bounded docs-only remediation of CTM-8 P0** in:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This authorization exists solely to correct the P0 calibration protocol and its package status so it can be re-reviewed.

Do **not** execute calibration.
Do **not** create benchmark/calibration support code.
Do **not** create fixture generators under `test/`.
Do **not** create observation seams.
Do **not** modify production code or tests.
Do **not** modify CTM-7 or Addendum B implementation.
Do **not** commit or push unless separately authorized.
Do **not** begin another CTM-8 package.

## Governing review

Use as the authoritative remediation input:

`docs/reviews/2026-10-11-ctm-8-p0-calibration-protocol-independent-work-review.md`

The review verdict is:

- **FAIL — P0 REMEDIATION REQUIRED**
- 0 Critical / 5 High / 3 Medium / 1 Low

The remediation must resolve the protocol defects and owner decisions recorded below. Do not reinterpret or widen the package.

## Owner decisions — final for this remediation

### Campaign families

Use **both Family M and Family R**.

#### Family M
Family M measures Clash Tests Manager **manager test-record** rebuild behavior.

Keep the full exploratory headless matrix:

Records:
- 100
- 1,000
- 5,000
- 10,000

Models:
- 1
- 2
- 3

Family M exists because the original CTM-8 gate explicitly concerns manager ViewModel rebuild cost.

#### Family R
Family R measures active sealed-set **clash-result record** behavior, including the owner-required:

- baseline rebuild;
- selected-group path;
- cold-label path;
- warm-label path.

Use the same full exploratory headless 4 × 3 scale matrix for the required Family R core scenarios.

### `-PULL` disposition

All `-PULL` variants are **excluded from the mandatory campaign**.

They may be documented as optional follow-up refinements only.

Do not include them in mandatory cell counts, required execution, acceptance language, or headed coverage.

### Repetition / launch policy

Use:

- **3 independent launches**
- **30 measured repetitions for warm scenarios**
- **15 measured repetitions for cold scenarios**

Warm scenarios may report:

- median
- min
- max
- coarse p95

Cold scenarios:

- per-launch p95 must be `n/a`
- pooled p95 may be reported only if:
  - the quantile estimator is explicitly fixed in the protocol;
  - pooling is explicitly labelled as pooled;
  - raw samples remain available.

Do not silently remove outliers.

### Observability boundary

Use **only public-observable sentinel-based classification** for cold/warm state.

Do **not** authorize:

- `textIndexed`
- `labelsPending`
- any other private controller-state dependency
- test-only label-index observation seam
- production observation hook

The minimum campaign must work without such seams.

The exact **label-index commit sub-phase** is therefore **unavailable** unless a future owner authorization explicitly adds an observation seam.

`R-COLD total` remains valid and must be retained.

### Headed reachability

Headed runs use only **practical real-product / real Viewer / real SVF2 corroboration points**.

If an exact requested scale point cannot be reached naturally:

- record actual produced/retained counts;
- mark the requested point `NOT REACHABLE HEADED` or equivalent;
- optionally use the nearest reachable point if explicitly labelled;
- retain headless coverage at the requested scale where valid.

Do **not** inject fake records and call them real headed evidence.

Headed mode does not need to execute every Cartesian scale cell if the protocol defines a justified corroboration subset.

## Before editing

Independently verify:

- repository path;
- branch;
- HEAD;
- `origin/main`;
- working tree;
- modified/untracked files;
- CTM-7 remains closed;
- Addendum B remains checkpointed;
- no CTM-8 execution/support code has appeared.

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- current CTM governing spec/plan
- `docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`
- `docs/research/2026-10-11-ctm-8-p0-calibration-protocol-final-report.md`
- `docs/reviews/2026-10-11-ctm-8-p0-calibration-protocol-independent-work-review.md`

If repo state materially differs from the reviewed P0 state, stop and report before remediation.

## Required protocol remediation

Update the existing CTM-8 P0 protocol in place.

Do not create a second competing protocol.

### H1 — remove private-state cold/warm dependency

Remove every normative dependency on private/internal state such as:

- `textIndexed`
- `labelsPending`

Define exactly one canonical **public sentinel predicate** for warm-state proof.

The protocol must specify a deterministic preparation where:

- the committed filter is known;
- `busy === false` or the actual public equivalent is satisfied;
- the expected warm-only ids/count are exactly known;
- failure to prove the sentinel makes `R-WARM` unavailable/inconclusive rather than guessed.

For cold behavior:

- preserve the total cold-path measurement;
- keep observable result transitions;
- explicitly mark exact label-index commit timing unavailable.

Do not imply a hidden observation seam exists.

### H2 — make headed action and completion boundaries executable

For every headed scenario that remains mandatory, define:

- exact action;
- exact payload/input;
- exact pre-state;
- start timestamp boundary;
- exact post-state;
- completion predicate;
- which Viewer work is included/excluded.

For headed results rendering, preserve the results-region semantic/quiet completion predicate where valid.

For operations such as:

- `presentGroup`
- Focus
- Isolate
- restore / Back to All

either:

1. define an observable completion condition that proves Viewer mutation finished, or
2. explicitly exclude that Viewer work from the timing boundary and keep it as a correctness-only corroboration check.

Do not claim Viewer work is included if the stop condition cannot observe its completion.

Make R-BASE headed action equivalent to the intended headless transition when comparison is expected.

### H3 — make Family M transitions exact and executable

#### M-BASE

Freeze one exact reversible catalog mutation.

Specify:

- the object changed;
- exact before/after values;
- exact intent/API/payload;
- untimed setup;
- timed mutation;
- completion predicate;
- reset/restore operation.

Do not allow implementations to arbitrarily choose model name, load state, catalog membership, etc.

#### M-REC

Make the target record explicit:

- choose record index `k = floor(N / 2)` or another fixed deterministic rule;
- activate/open that record during untimed setup;
- use the exact public `INTENT.SETUP_NAME` path with alternating deterministic payloads if that is the validated existing route;
- define the manager VM/record-identity completion predicate;
- state clearly whether forwarded editor work is intentionally included in the measured workload.

If a manager-only invalidation cannot be expressed with existing public behavior, do not pretend it can. Mark that narrower variant unavailable unless a future owner authorizes a test-only seam.

### H4 — make selected-group comparator valid

For the primary paired comparator:

`R-GROUP-WARM` versus `R-WARM`

require:

- identical selected group identity;
- identical `memberIndexes` across T1/T2;
- no group-membership change in the timed window;
- no `presentGroup()` scheduling in the timed window if the purpose is controller/ViewModel selected-group incremental cost;
- an assertion/evidence rule that the above remains true.

If membership-changing selected-group behavior is useful, define it as a **separately named unpaired scenario**, optional unless explicitly added later.

Do not mix membership-change/presentation work into the primary paired delta.

### H5 — remove the false 10,000 retained-cap claim

Remove every statement that says or implies:

`10,000 is the engine retained cap`

Replace it consistently with:

- 10,000 is an **exploratory target**;
- the repository default cap currently observed by the review is 100,000;
- execution records configured / produced / retained / truncated values;
- real headed reachability is empirical;
- unreachable headed targets are never forced with synthetic data.

Search the full protocol for duplicate stale wording, not only the section cited by the review.

## Medium remediation

### M1 — freeze campaign scope and exact mandatory cell counts

Rewrite the campaign section so the two different `N` populations are impossible to confuse.

Use explicit names such as:

- `M.N_tests`
- `R.N_results`

Do not use an unlabeled generic `records` field in evidence schemas.

For each family, state exactly which required scenarios run across the full 4 × 3 headless matrix.

Mandatory campaign must reflect the owner decisions:

#### Family M mandatory core
Full 4 × 3 headless matrix for the reviewed manager rebuild scenarios retained after H3 remediation.

#### Family R mandatory core
Full 4 × 3 headless matrix for the required core scenarios:
- baseline rebuild;
- selected-group primary comparator;
- cold-label total;
- warm-label rebuild.

If the protocol retains any additional R scenario, clearly mark whether it is:
- mandatory;
- optional refinement;
- headed-only correctness corroboration.

`-PULL` is optional and excluded from mandatory counts.

Compute and write the exact mandatory:

- scenario cells;
- launch count;
- measured sample count;
- warm-up count.

Do not leave campaign size as a later execution decision.

### M2 — freeze fixture/statistical parameters

Make Family R fixture generation deterministic.

Specify exactly:

- participant assignment algorithm;
- model-key assignment;
- dbId generation;
- duplicate-participant distribution if any;
- uniform profile parameters;
- skew profile parameters if retained;
- deterministic seeds;
- exact expected counts.

Replace qualitative examples such as:

- “e.g. round-robin”
- “approximately 50%”
- “approximately 10%”

with exact formulas/count rules.

Set the per-sample wall-time cap now.

The cap is an execution safety bound, not a product performance threshold.

Specify exactly:

- timeout value;
- what happens when exceeded;
- whether the sample is retained and labelled timeout;
- whether repetitions continue or stop for that cell;
- no silent repetition reduction.

Fix one quantile estimator for p95, for example a clearly defined nearest-rank or another standard method.

Specify whether:

- per-launch summaries;
- pooled summaries

are authoritative for each statistic.

Do not allow the execution agent to choose later.

### M3 — correct package status without rewriting history

Do not silently rewrite the existing upstream P0 final report as though the first review had fully passed.

Create an authorized **P0 remediation final report/addendum** under `docs/research/` that records:

- the Work review FAIL;
- 5 High / 3 Medium / 1 Low;
- owner campaign/observability decisions;
- protocol sections corrected;
- exact residual limitations;
- no execution performed;
- no code/test changes;
- targeted re-review required.

Preserve the original P0 final report as historical input.

## Low remediation

Clean up duplicated support-code owner decisions and unstable numbering in the protocol.

Separate clearly:

1. calibration harness / deterministic fixture generator authorization;
2. optional observation seam authorization.

For this P0 version:

- neither is authorized for execution yet;
- observation seam is explicitly **not required** for the minimum campaign;
- exact index-commit sub-phase remains unavailable.

## Headed matrix remediation

Define a bounded headed corroboration policy.

Do not automatically replicate the full headless campaign.

Specify a small but meaningful real-product subset that covers:

- low / middle / high reachable result scale where practical;
- 1 / 2 / 3 model behavior where practical;
- baseline;
- selected-group;
- warm-label;
- cold-label correctness/observable transition;
- Viewer responsiveness/correctness.

For any 10,000 target:

- attempt only where the real product path can naturally reach it;
- record actual result count;
- otherwise mark `NOT REACHABLE HEADED`.

Manager headed scale may use only practical owner-reviewed corroboration points; do not create 10,000 tests through artificial UI seeding and call it real headed evidence.

The protocol must state that the primary scaling curve comes from repeatable headless calibration; headed runs corroborate product behavior and responsiveness.

## Execution-support authorization boundary

The remediated protocol must state that the next execution package will require a separate owner authorization for, at minimum:

1. calibration-only headless harness;
2. deterministic fixture generator under a non-production support path such as `test/`;
3. runtime-injected headed evidence instrumentation;
4. execution of the accepted mandatory matrix;
5. evidence and execution final-report writes.

Do not authorize or create these in P0 remediation.

No production observation hook is required or recommended.

## Protected boundaries

Do not pull in:

- Addendum B L1/L2;
- CTM-7 L1–L8;
- O-1…O-4;
- hide-versus-departure;
- neighboring single-clash navScope issue;
- GP-F1 visual polish;
- Core/collision/Viewer Adapter/host work;
- Viewer theming/selection;
- persistence/history;
- grouping semantics changes;
- public resource/performance limits.

## Required durable outputs

### 1. Updated protocol

Update:

`docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`

Give it an incremented protocol revision/version indicating this is the remediated P0 protocol.

### 2. P0 remediation final report

Create:

`docs/research/2026-10-11-ctm-8-p0-calibration-protocol-remediation-final-report.md`

It must include:

- repo/branch/HEAD/origin/tree state;
- governing Work review;
- owner decisions;
- each H1–H5 disposition;
- each M1–M3 disposition;
- L1 disposition;
- exact mandatory campaign size;
- headed corroboration policy;
- observability boundary;
- execution support still unauthorized;
- no calibration performed;
- no production/test code changed;
- residual limitations;
- next gate.

### 3. Handoff

Update:

`docs/handoffs/latest.md`

Keep it concise.

Record:

- repo / branch / HEAD / tree;
- CTM-7 closed;
- Addendum B checkpoint;
- CTM-8 P0 remediation status;
- protocol path/version;
- original P0 final report;
- remediation final report;
- governing failed Independent Work Review;
- owner decisions;
- execution remains unauthorized;
- exact next gate: targeted Independent Work re-review of the remediated P0 protocol.

## Verification

Before stopping:

- re-read the entire remediated protocol for internal contradictions;
- search for stale:
  - `textIndexed`
  - `labelsPending`
  - `10,000 ... cap`
  - ambiguous generic `records`
  - mandatory `-PULL`
  - undefined M-BASE/M-REC mutations;
- verify exact campaign counts mathematically;
- run `git diff --check`;
- verify changed paths are docs-only.

Do not execute calibration or tests merely to validate the protocol.

## Stop condition

When the updated protocol, remediation final report, and handoff are complete:

**STOP.**

Do not run calibration.
Do not create harness/generator code.
Do not create observation seams.
Do not modify production/tests/spec/plan.
Do not commit.
Do not push.
Do not begin CTM-8 execution.

The next gate is:

**targeted Independent Work re-review of the remediated CTM-8 P0 protocol**.
