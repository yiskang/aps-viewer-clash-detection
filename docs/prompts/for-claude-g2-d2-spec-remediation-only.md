# For Claude — G2 D2 Specification Remediation Only

I explicitly authorize **one bounded documentation-only remediation of the G2 D2 synthetic-transition specification** based on the latest independent Work review.

This task is limited to correcting the Critical / High / Medium specification defects identified by Work.

It does **not** authorize:

- D2-OFFLINE implementation;
- simulator code;
- harness/test/product/procedure changes;
- T4/C6/C8 implementation;
- live diagnostic;
- acceptance retry;
- new authorization record;
- attempt reset;
- commit or push.

Use the repository and latest independent Work review as the source of truth.

## 1. Verify baseline

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `dee0850b1fbcf23ff8762cf614b4cb4ca88b2836`
- `main == origin/main`
- harness SHA unchanged
- procedure SHA unchanged
- immutable evidence unchanged
- historical G2 remains `FAIL (row 3)`
- C6 remains `NOT_EVIDENCED`
- C8 remains unresolved
- T4 remains unchanged
- no D2 implementation exists
- no live retry/new record/attempt reset occurred

Read:

- `docs/research/2026-10-04-g2-d2-synthetic-transition-spec.md`
- `docs/reviews/2026-10-04-g2-d2-synthetic-transition-spec-independent-review.md`
- `docs/reviews/2026-10-04-g2-d2-synthetic-transition-spec-internal-review.md`
- latest handoff
- relevant current T4/C6/C8 harness code
- pinned Viewer 7.124.2 source used by the spec

If baseline differs materially, stop and report.

---

# Critical Remediation

## 2. Fix the closed-loop `δ=0` causal-order defect

Work found a Critical:

> closed-loop `δ=0` schedules issue request N before the `H` sample that authorizes it.

Correct the schedule model so no request is issued before the event/observation that causally enables it.

### Required correction

Define causal phases explicitly.

At minimum distinguish:

- state before harness sample;
- harness sample `H`;
- decision derived from `H`;
- request issuance;
- Viewer tick/rAF processing;
- transition/pending-state update.

For `δ=0`, define a same-frame ordering that remains causal.

If two source-plausible same-frame orderings exist, enumerate both rather than creating a time-travel edge.

No schedule may contain:

`issue(request N)` before the sample/decision that triggers request N.

### Recount requirement

Because this changes schedule construction:

- recompute the schedule-space cardinality;
- recompute witness count if affected;
- update all stated counts;
- update any output-size caps derived from counts.

Do not preserve `14,580 + 36` if no longer correct.

---

# High Remediations

## 3. Restore/autocam synchronization

Work found restore/autocam synchronization underspecified or inconsistent.

Correct the model so restore/autocam operations have explicit ordering and ownership.

Define:

- when restore writes camera state;
- whether an active transition exists;
- whether pending autocam request is already queued;
- which operation is allowed to overwrite camera on the next transition step;
- whether restore affects pending request state;
- what completion/event state is visible after restore.

Model only source-supported possibilities.

If multiple valid branches exist, enumerate them.

Do not collapse restore into "reset succeeded."

## 4. Replace self-referential request-tagged oracle

Work found the tagged oracle self-referential.

Correct it so the idealized request-tagged completion oracle can be evaluated independently of the candidate result.

The oracle must not define success by saying, in effect:

> current request completed if the camera observed is the current request's completed camera.

Instead define independent state such as:

- explicit synthetic request ID attached to the modeled transition;
- ownership carried through state-machine transitions;
- completion emitted when that modeled request reaches terminal transition state.

Then compare T4's observation to this independent synthetic ownership state.

No circularity.

## 5. Reconcile classifier vs outcome matrix

Work found classifier/outcome inconsistency.

Review:

- H2/H5 classification;
- CL/OP outcomes;
- A–E outcome matrix.

Make them mechanically consistent.

Each terminal simulation result must map to exactly one defined class/outcome or an explicit invalid/ambiguous state.

Define:

- precedence;
- mutually exclusive predicates;
- invalid-state handling;
- what evidence each outcome records.

No result should satisfy two contradictory outcomes.

## 6. Model T4 numerically, not symbolically

Work found symbolic pose identity is not an exact replacement for T4's real comparison.

Correct D2 so T4 uses the same effective numeric comparison semantics as the harness:

- 32-entry sample;
- element-wise numeric comparison;
- tolerance `1e-9`;
- adjacent-pair equality rule;
- one sample per modeled frame;
- same included/excluded fields as actual T4.

If the synthetic state uses abstract labels, it must still materialize numeric 32-entry samples for T4 evaluation.

Do not replace tolerance logic with symbolic state identity.

## 7. Unify separation-gap formulas

Work found conflicting formulas for C6/N2 separation.

Identify all definitions of:

- gap;
- separation;
- `d_min`;
- `3×` exploratory rule;
- class margin.

Choose one coherent notation.

Requirements:

- `3×` remains exploratory only;
- `d_min` remains an observed/statistical quantity, not an accepted threshold;
- no final production/acceptance margin is selected;
- formulas must agree across geometry definitions, classifier, and outcome matrix.

---

# Medium Remediations

## 8. Add D=1 duration

Work recommends duration set:

`{1,2,3,4,6,10}`

Add `D=1`.

Clarify what D means exactly:

- number of transition steps;
- whether zero-motion step is included/excluded;
- completion timing.

Keep this consistent with the corrected off-by-one semantics.

## 9. Add D=30 characterization witness

Add a non-exhaustive characterization witness at:

`D=30`

Clearly label it:

- characterization only;
- not part of exhaustive schedule-space count unless intentionally included;
- used to compare scaled short transitions with a longer source-like duration.

Do not let this witness alter exhaustive impossibility claims.

## 10. Add bounded sub-epsilon tail-stall sensitivity

Do not assume tail stalls cannot happen.

Add a bounded sensitivity branch where:

- camera movement remains below T4 `1e-9` for a finite number of frames;
- transition is not formally complete yet.

Define a small finite domain, for example a bounded tail length.

The goal is to test whether T4 can settle during a numerically quiet tail.

Keep this branch explicitly synthetic unless source proves it.

Recount schedule space if included in exhaustive enumeration.

## 11. Scaled-timeout clarification

Work found timeout scaling underspecified.

Clarify how synthetic frame durations relate to any timeout concept.

Do not imply synthetic frame counts correspond directly to real milliseconds.

Define:

- synthetic frame unit;
- whether timeouts exist in D2-OFFLINE;
- how a timeout branch, if modeled, is bounded;
- whether timeout is excluded from acceptance-like conclusions.

## 12. Shadow-counter domains

Work found shadow-counter domains underspecified.

Identify every shadow/debug counter used by the simulator spec.

Define:

- domain/range;
- initialization;
- update rule;
- reset behavior;
- whether it is observable or internal only;
- whether it participates in classification.

No unbounded or undefined counter domain.

## 13. Relabel 0.9

The `0.9` value must not be called a margin.

Relabel it as a:

**synthetic calibration anchor**

or equivalent.

State clearly:

- it is not an acceptance threshold;
- it is not the C6 margin;
- it exists only to construct/scale synthetic geometry or calibration cases.

Search and correct every coupled reference.

---

# Owner Recommendation Adoption

## 14. Durations

Adopt the Work-recommended base duration set unless the spec reveals a contradiction:

`{1,2,3,4,6,10}`

plus:

- `D=30` characterization witness.

If you deviate, explain why in the spec.

## 15. 3× and d_min

Keep both exploratory.

Do not convert either into a gate/threshold.

The spec should require collecting D2-OFFLINE results before any owner decision on threshold adoption.

## 16. Simulator location

Record the recommended future code location:

`docs/research/2026-10-04-g2-d2-synthetic-transition/`

Do not create simulator code now.

If supporting schema/example files are needed for the specification only, keep them documentation/data-only.

## 17. Undocumented Viewer observables

Record this policy:

- allowed as version-bound offline/source-model inputs;
- allowed in a separately authorized diagnostic run if explicitly approved;
- not allowed as production or acceptance dependencies without procedure re-acceptance.

Do not wire any observable now.

---

# Recompute Spec Mechanics

## 18. Recompute schedule cardinality

After all causal-order, duration, and tail-stall changes:

- derive the finite domains explicitly;
- recompute the exhaustive schedule count;
- separately count characterization/witness runs;
- show the arithmetic in the spec.

Do not preserve stale counts.

## 19. Revalidate output-size bounds

Update caps based on the new schedule count.

Confirm:

- raw traces bounded;
- retained witnesses bounded;
- summary size bounded;
- no output explosion from D=30 or tail sensitivity.

## 20. Revalidate reproducibility

Ensure the corrected spec still defines:

- deterministic enumeration order;
- exact synthetic domains;
- no randomness, or fixed seed if unavoidable;
- output schema;
- schedule identifiers;
- witness identifiers;
- future command shape;
- no Viewer/browser dependency.

---

# Scope Integrity

## 21. Preserve historical/synthetic boundary

Do not change accepted boundaries:

Historical retained inputs:
- U
- A:104
- retained camera/frustum values

Synthetic:
- missing B:111 geometry
- A:135 geometry
- home target geometry
- transition timing/order branches
- tail-stall sensitivity

No synthetic input may be described as reconstructed history.

## 22. Preserve research-only status

This artifact remains a spec/research artifact.

It is not:

- implementation authorization;
- procedure amendment;
- acceptance contract change;
- live diagnostic authorization.

---

# Verification

## 23. Documentation/spec verification

Perform:

- internal consistency sweep;
- formula consistency sweep;
- causal-order sweep;
- schedule-count recomputation;
- outcome/classifier exhaustiveness check;
- stale terminology search;
- `git diff --check`.

No simulator execution is required because no simulator exists.

## 24. Focused internal review

Perform one focused internal review over the corrected D2 spec.

Explicitly re-check every independent Work finding:

### Critical
- closed-loop `δ=0` causality

### High
- restore/autocam synchronization
- self-referential tagged oracle
- classifier/outcome inconsistency
- symbolic T4 equality
- conflicting separation formulas

### Medium
- tail-stall exclusion
- missing `D=1`
- scaled timeout
- shadow-counter domains
- `0.9` mislabeling

Also re-check:
- schedule count
- D=30 witness
- output caps
- undocumented-observable policy

Classify Critical / High / Medium / Low.

Fix genuine Critical/High spec defects within this documentation-only scope.

Persist under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

---

# Handoff

## 25. Handoff requirements

Update handoff to state:

- baseline `dee0850b...`;
- D2 spec remediation status;
- new schedule count;
- durations `{1,2,3,4,6,10}` + D=30 witness;
- bounded tail-stall sensitivity status;
- tagged oracle no longer circular;
- T4 numeric fidelity status;
- separation formulas unified;
- `0.9` is calibration anchor, not margin;
- no D2-OFFLINE implementation authorized;
- T4/C6/C8 unchanged;
- no live retry/new record/attempt reset;
- next action:
  **targeted independent Work re-review of corrected D2 spec**.

---

# Commit Policy

## 26. Do not commit or push

Leave the corrected D2 spec, internal review, and handoff update uncommitted.

---

# Stop Gate

## 27. Stop after spec remediation

Do not:

- implement simulator;
- modify harness/tests/product/procedure;
- change T4/C6/C8;
- run Viewer/browser/live G2;
- issue new authorization record;
- reset attempt state;
- commit/push.

Next gate:

**Targeted independent Work re-review of corrected G2 D2 specification → owner decision on checkpoint commit/push and D2-OFFLINE implementation authorization**

---

# Final Report

Report:

- branch / HEAD / origin relation;
- exact spec sections changed;
- Critical fix;
- five High fixes;
- five Medium fixes;
- new duration domain;
- D=30 witness disposition;
- tail-stall branch;
- unified separation notation;
- calibration-anchor wording;
- recomputed schedule count;
- output-size bounds;
- internal review findings;
- working-tree state;
- exact next gate.

Explicitly confirm:

- no D2 implementation occurred;
- no harness/test/product/procedure change;
- no T4/C6/C8 implementation change;
- no live retry;
- no new authorization record;
- immutable evidence unchanged;
- no commit;
- no push.
