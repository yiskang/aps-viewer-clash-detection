# For Claude — G2 D2 Synthetic-Transition Specification/Research Only

I explicitly authorize **one bounded G2 D2 specification/research task only**.

This task is for **offline synthetic-transition research and specification**. It does **not** authorize implementation in the harness/product, live diagnostics, another G2 acceptance attempt, T4 changes, C6/N2 implementation, new authorization-record issuance, attempt reset, or downstream work.

Use the repository, committed D0/D1 research, immutable evidence, current harness, and pinned Viewer 7.124.2 source/API evidence as the source of truth.

## 1. Verify authoritative baseline

Before starting, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed HEAD:
  `dee0850b1fbcf23ff8762cf614b4cb4ca88b2836`
- `main == origin/main`
- tracked tree clean
- committed harness SHA:
  `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`
- accepted procedure SHA unchanged
- immutable evidence snapshot unchanged:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/`
- historical live G2 remains:
  `FAIL (row 3)`
- C3/C2 correction checkpoint is committed
- C6 remains:
  `NOT_EVIDENCED`
- C8 remains unresolved
- T4 remains unchanged
- no retry occurred
- no new authorization record was issued
- no attempt state was reset
- no harness/test/product/procedure implementation change has occurred since the checkpoint

Read at minimum:

- `docs/research/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay.md`
- `docs/research/2026-10-04-g2-c3-c8-c6-remediation-plan.md`
- latest independent D0/D1 reviews
- immutable evidence manifest and relevant preserved R1/R2/R3 artifacts
- current T4/C6/C8 harness logic
- pinned Viewer 7.124.2 source relevant to transition scheduling and camera updates

If baseline differs materially, stop and report.

---

# D2 Objective

## 2. Research question

Design a bounded, offline synthetic-transition model that can answer:

> Can the current harness observation strategy mechanically produce a stale or previous-request camera observation under Viewer-like transition scheduling?

The purpose is **mechanical possibility and falsifiability**, not historical proof.

D2 must not claim to reconstruct the exact historical live run.

---

## 3. Explicit D2 non-goals

D2 must not:

- prove that the historical C8 failure was caused by stale-camera sampling;
- reconstruct unavailable historical geometry as if it were retained evidence;
- change T4;
- change C6/N2 semantics;
- run the actual Viewer;
- run a browser;
- run live G2;
- modify harness/product code;
- choose a final C6 margin;
- authorize a future live diagnostic.

---

# Inputs and Model Boundary

## 4. Historical inputs allowed

Use only retained historical inputs that actually exist.

At minimum:

- retained U framing data;
- retained A:104 data;
- preserved camera/frustum numbers needed for D1 comparison.

Do not claim retained historical geometry for:

- B:111
- A:135
- home-camera target geometry

unless repository evidence proves it exists.

## 5. Synthetic inputs

Where D2 needs missing geometry/state, define it explicitly as **synthetic**.

Synthetic inputs may include:

- synthetic target bounds;
- synthetic camera poses;
- synthetic transition durations;
- synthetic event timings;
- synthetic pending-request sequences.

Every synthetic input must be labeled as such.

Do not blur synthetic data with retained evidence.

---

# State Machine / Scheduling Model

## 6. Define the minimal transition state machine

Specify a minimal model representing the Viewer behaviors established by D0.

At minimum model:

- idle state;
- active transition;
- one shared pending request slot;
- last-writer-wins replacement of pending request;
- request consumption;
- transition start delay;
- transition progress over frames;
- transition completion;
- optional restore-state branch;
- camera sampling tick;
- harness settle sampling.

Define state variables explicitly.

Suggested state variables may include:

- `activeRequest`
- `pendingRequest`
- `transitionActive`
- `transitionProgress`
- `cameraState`
- `lastCommittedCamera`
- `sampledCamera`
- `frameIndex`
- `tickIndex`
- `completionEventCount`

Refine based on actual source evidence.

## 7. Pending-request semantics

Model exactly what the pinned Viewer source supports:

- one pending slot;
- last-writer-wins behavior;
- pending request held while a transition is active;
- pending consumption timing after transition completion.

Do not add queue semantics not supported by source.

## 8. restoreState branch

Represent `restoreState(..., true)` as a separate branch, not as a guaranteed reset/cancel operation.

At minimum model variants:

- restore succeeds and camera state changes immediately;
- restore returns false/no-op;
- restore changes camera but active transition later overwrites it;
- restore occurs while a transition is active;
- restore occurs while idle.

Do not encode one branch as universally historical.

## 9. rAF/tick ordering

Define the minimum ordering dimensions required to test the stale-camera hypothesis.

At minimum consider:

- request issued before/after harness tick;
- pending request consumed before/after rAF;
- camera mutation before/after settle sample;
- transition-complete event before/after camera sample;
- restoreState before/after active-transition frame;
- multiple harness ticks inside a pre-motion zero-motion window.

Avoid an unbounded scheduler.

---

# T4 Modeling

## 10. Model current T4 exactly

Represent current frozen T4 behavior without changing it.

Capture:

- fields T4 compares;
- number of equal frames/samples required;
- sample cadence;
- zero-motion acceptance behavior;
- lack of transition-state input;
- lack of request correlation.

Do not propose a new T4 algorithm in D2.

## 11. Request-tagged completion concept

Define the research concept of **request-tagged completion**:

A completion signal/state is request-tagged only if the harness can determine that completion corresponds to the specific framing/navigation request whose result is being evaluated.

Distinguish this from:

- generic camera change;
- generic transition completed;
- generic render completion.

D2 may model request-tagged completion as an idealized oracle for comparison, but must not assume the real Viewer exposes it publicly.

---

# Schedule Exploration

## 12. Bounded schedule space

Define a finite, explicit schedule space.

The model must be small enough to explore exhaustively or near-exhaustively.

At minimum vary:

- transition start delay;
- transition duration in discrete frames;
- harness sample timing;
- pending-request insertion timing;
- restoreState timing;
- completion-event timing.

State exact finite domains.

Do not claim exhaustive impossibility unless all modeled dimensions are actually enumerated.

## 13. Falsifiability rules

Define what outcomes support or reject each hypothesis.

### H2 — stale/early camera observation
Supported if the model can produce:
- T4 = settled
- while sampled camera belongs to prior/transient state
- before current request ownership is established

Rejected within the modeled state space if no such schedule exists under exhaustive exploration.

### H5 — other async state
Supported if a stale observation appears without the specific one-request-lag mechanism.

### Product/navigation defect
D2 cannot prove or reject this historically; it only isolates whether harness-side stale observation is mechanically possible.

Be explicit.

---

# D1 Pattern Comparison

## 14. Synthetic pattern targets

Use D1 only as pattern targets, not as ground truth causality.

The synthetic model may compare generated sequences against:

- C6-like sample;
- N2-like sample;
- C8-like sample;
- moderate/partial lag characteristics.

Do not require exact historical B:111/A:135 geometry.

## 15. Similarity metrics

Define any similarity metrics before implementation.

Possible metrics:

- camera-target distance;
- direction cosine;
- framing-centre distance;
- normalized projected-bounds difference;
- frustum excess pattern.

Do not assign unexplained thresholds.

If thresholds are exploratory, label them exploratory.

---

# C6 / N2 Synthetic Control Research

## 16. D2 goal for C6/N2

Design synthetic scenarios that can test whether the current N2 control is capable of discriminating:

- aggregate framing;
- single-model framing;
- stale-camera observation;
- prior-request camera reuse.

Do not implement C6/N2 yet.

## 17. Discriminating observable

Specify what observable should differ between positive and control cases.

Examples may include:

- normalized framing centre;
- target coverage;
- projected-bounds separation;
- frustum margin.

Choose based on current harness semantics.

## 18. Margin derivation research

Do not choose the final C6 margin.

Instead define how D2 could produce evidence for a later margin decision:

- collect synthetic positive/control distributions;
- measure within-class variability;
- measure between-class separation;
- derive a candidate absolute dimensionless margin only if there is stable separation.

If no stable separation exists, say that the current control design may be unsuitable.

---

# D2 Output / Decision Logic

## 19. Required D2 conclusions

The D2 specification must make it possible for a later implementation/research run to produce one of these conclusions:

### Outcome A
Current T4 can mechanically report settled before current-request camera ownership is established.

### Outcome B
Within the explicitly modeled schedule space, T4 cannot produce that failure mode.

### Outcome C
The model is insufficient to distinguish mechanisms.

### Outcome D
C6/N2 synthetic control can be made discriminating with defensible separation.

### Outcome E
C6/N2 remains non-discriminating even synthetically.

Do not collapse these outcomes into a historical-causality verdict.

## 20. D2 cannot prove historical causality

State explicitly:

Even if D2 reproduces a one-request-behind pattern, it proves only **mechanical possibility under the modeled assumptions**.

Historical causality still requires:

- request-correlated live instrumentation;
- or another independently accepted evidence source.

---

# Future Gate Mapping

## 21. Separate future gates

Define the future gates clearly.

### Gate D2-SPEC
Current task:
- specification/research only.

### Gate D2-OFFLINE
Future:
- implement offline synthetic simulator/tests.

### Gate DIAGNOSTIC-INSTRUMENTATION
Future:
- add request-correlated camera/transition evidence capture.

### Gate DIAGNOSTIC-LIVE
Future:
- separately authorized diagnostic live run if still required.

### Gate T4-REMEDIATION
Future:
- only if evidence supports T4 change;
- requires procedure re-acceptance.

### Gate ACCEPTANCE-RETRY
Future:
- separate from diagnostic live;
- new checkpoint;
- new authorization record;
- explicit exactly-one owner authorization.

No gate may authorize itself.

---

# Evidence / Size Bounds

## 22. Diagnostic-data bounds

Specify bounded output for future D2 implementation.

Define limits for:

- number of schedules;
- frames per schedule;
- camera samples;
- retained failure witnesses;
- output file size;
- summary vs raw traces.

Prefer deterministic caps.

The design must preserve enough witnesses for review without unbounded evidence growth.

---

# Reproducibility

## 23. Reproducibility requirements

The D2 spec must define:

- implementation language/runtime expectation;
- deterministic seed if randomness is used;
- no randomness preferred;
- input files;
- synthetic fixture definitions;
- exact output schema;
- schedule enumeration order;
- expected commands for later implementation;
- no dependency on live Viewer/browser.

Do not implement these commands now.

---

# Research Artifact

## 24. Persist D2 specification/research

Create a research/specification artifact under:

`docs/research/`

Suggested filename:

`docs/research/2026-10-04-g2-d2-synthetic-transition-spec.md`

This is a research/spec artifact, not an implementation authorization.

Include:

- goals;
- non-goals;
- source-derived model assumptions;
- state machine;
- schedule space;
- falsifiability rules;
- synthetic fixtures;
- C6/N2 discrimination research design;
- margin-derivation method;
- D2 outcome matrix;
- future gate mapping;
- evidence-size bounds;
- reproducibility requirements;
- unresolved owner decisions.

---

# Internal Review

## 25. Focused internal review

Perform one focused internal review of the D2 spec.

Review:

- source-faithful scheduling semantics;
- historical vs synthetic boundary;
- exhaustive-search claims;
- T4 fidelity;
- request-tagged completion definition;
- C6/N2 discrimination design;
- margin-derivation method;
- gate separation;
- evidence-size bounds;
- reproducibility;
- scope discipline.

Classify Critical / High / Medium / Low.

Fix genuine Critical/High spec defects within research scope.

Persist under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

---

# Handoff

## 26. Handoff requirements

Update handoff to state:

- baseline checkpoint `dee0850b...`;
- D0/D1 checkpoint complete;
- D2 synthetic-transition spec/research status;
- no D2 implementation authorized;
- C8 unresolved;
- C6 remains `NOT_EVIDENCED`;
- T4 unchanged;
- no live retry/new record/attempt reset;
- next action:
  **independent Work review of D2 synthetic-transition specification/research**.

---

# Commit Policy

## 27. Do not commit or push

Leave:

- D2 spec/research artifact;
- internal review;
- handoff update

uncommitted for independent Work review.

---

# Stop Gate

## 28. Stop after specification/research

Stop after:

- D2 state model;
- schedule-space definition;
- falsifiability design;
- synthetic fixture design;
- C6/N2 discrimination research design;
- margin-derivation method;
- future gate mapping;
- internal review;
- handoff update.

Do not:

- implement simulator;
- modify harness/tests/product/procedure;
- change T4;
- redesign C6/N2 in code;
- run browser/Viewer;
- run live diagnostic;
- rerun G2;
- issue a new authorization record;
- reset attempt state;
- commit;
- push.

Next gate:

**Independent Work review of G2 D2 Synthetic-Transition Specification/Research → owner decision on D2 offline simulator implementation**

---

# Final Report

Report:

- branch / HEAD / origin relation;
- D2 artifact path;
- modeled Viewer scheduling assumptions;
- state machine summary;
- finite schedule-space definition;
- falsifiability rules;
- synthetic fixture/input design;
- C6/N2 discrimination design;
- margin-derivation strategy;
- D2 outcome matrix;
- future gate mapping;
- evidence-size bounds;
- internal review findings;
- working-tree state;
- exact next gate.

Explicitly confirm:

- no D2 implementation occurred;
- no C8/C6/T4 code change;
- no harness/test/product/procedure change;
- no live diagnostic/retry;
- no new authorization record;
- immutable evidence unchanged;
- no commit;
- no push.
