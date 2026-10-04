# For Claude — G2 D0 Viewer API Evidence + D1 R1 Replay Only

I explicitly authorize **one bounded G2 research/investigation task only** covering:

- **D0 — Viewer API / source evidence**
- **D1 — R1 replay / evidence reconstruction**

This task is research-only.

It does **not** authorize:

- C8 implementation or instrumentation;
- C6/N2 implementation;
- T4 settle-rule changes;
- synthetic-transition implementation;
- diagnostic live run;
- another G2 acceptance retry;
- new authorization-record issuance;
- attempt reset;
- harness/test/production/procedure changes;
- G3 or downstream work;
- commit or push.

Use the repository, immutable preserved evidence, checked-in source/docs, and authoritative Autodesk documentation/source as the source of truth.

---

## 1. Verify authoritative baseline

Before research, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed HEAD:
  `ef436d4a5632692fadbddc09fb9aa6410fadc258`
- `main == origin/main`
- tracked tree clean
- committed harness SHA:
  `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`
- accepted procedure SHA unchanged from the accepted G2 procedure
- immutable evidence snapshot unchanged:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/`
- historical live G2 verdict remains:
  `FAIL (row 3)`
- C3/C2 checkpoint is committed and pushed
- C8 remains unresolved
- C6 remains `NOT_EVIDENCED`
- T4 remains unchanged
- no retry occurred
- no new authorization record was issued
- no attempt state was reset

Read at minimum:

- `docs/research/2026-10-04-g2-c3-c8-c6-remediation-plan.md`
- `docs/reviews/2026-10-04-g2-c3-c8-c6-remediation-plan-independent-review.md`
- `docs/handoffs/latest.md`
- immutable evidence snapshot and manifest
- current harness C6/C8/C20 logic
- relevant APS Viewer/navigation/camera source available in repo or vendored artifacts

If baseline differs materially, stop and report.

---

# Part A — D0 Viewer API / Source Evidence

## 2. D0 objective

Determine, from source/API evidence, what APS Viewer exposes or guarantees about:

- camera/navigation transitions;
- completion of `fitToView` / framing / navigation operations used by the harness;
- camera state mutation timing;
- render-frame timing;
- camera-change notifications;
- transition/interpolation completion;
- observability of "settled" camera state.

The goal is to answer:

> What signal(s), if any, can the harness use to know that the camera state relevant to C8/C6 belongs to the current request rather than a previous/transient state?

Do not choose a new settle rule yet.

---

## 3. Evidence hierarchy

Use evidence in this order:

1. checked-in Viewer source / vendored source if available;
2. official Autodesk APS Viewer documentation;
3. official Autodesk samples/source;
4. current harness/product code;
5. preserved runtime evidence;
6. clearly labeled inference.

Do not silently substitute general Three.js knowledge for Viewer-specific behavior.

If official docs are silent, say so.

---

## 4. Inspect the actual navigation path

Trace the exact call path used by the current implementation/harness for C6/C8-related framing/navigation.

Identify:

- public Viewer/navigation API called;
- internal navigation/camera functions reached;
- whether the API is synchronous or asynchronous in effect;
- whether it returns before transition completion;
- whether interpolation/transition is optional/configurable;
- whether calls can coalesce, supersede, or overlap;
- whether the call queues work for later frames.

Record exact file/function references.

---

## 5. Identify observable completion/settle signals

Investigate whether APS Viewer exposes any usable signal such as:

- camera-changed event;
- transition-complete event;
- navigation-complete callback;
- `transitionActive` or equivalent state;
- animation queue state;
- render-presented event;
- camera/viewer idle state;
- navigation lock/state;
- promise/callback on framing operations;
- private API with sufficiently stable semantics.

For each signal, record:

- source/API location;
- what it actually guarantees;
- what it does **not** guarantee;
- whether it is tied to a specific navigation request;
- whether it is public, private, deprecated, or unsupported;
- whether it can discriminate current-request completion from previous-request camera state.

Do not recommend private APIs merely because they exist; assess stability/risk.

---

## 6. Analyze current T4 settle rule against source facts

Inspect the current frozen T4 settle behavior.

Document:

- current predicate;
- what fields are compared;
- number of frames/samples;
- sampling interval;
- whether target/up/projection/FOV/ortho scale are included;
- whether transition state is included;
- whether the predicate is request-correlated.

Then compare T4 to the D0 Viewer source facts.

Classify each concern as:

- **source-proven gap**
- **plausible inference**
- **not supported**

Do not modify T4.

---

## 7. Static coalescing / previous-camera hypothesis

Investigate from source whether consecutive framing/navigation requests can cause behavior consistent with:

> request N samples camera state from request N-1.

Look for:

- asynchronous transition scheduling;
- delayed camera commits;
- event order;
- render-loop application;
- transition cancellation;
- request supersession/coalescing;
- stale closure/callback state;
- immediate getter values vs presented/rendered values.

State whether the source makes this:

- directly supported;
- plausible but unproven;
- contradicted.

Do not overclaim.

---

# Part B — D1 R1 Replay / Evidence Reconstruction

## 8. D1 objective

Perform a **read-only replay/reconstruction** of the preserved live evidence to test the previous-request-camera hypothesis without rerunning Viewer/live G2.

Use:

`docs/research/evidence/g2-live-20261004-75a3ccb9/`

and especially R1 plus related evidence.

No evidence file may be modified.

---

## 9. Reconstruct the sequence of camera/framing requests

From preserved evidence, build an ordered timeline/table containing as much as evidence permits:

- request/check ID;
- target model/dbId;
- requested framing operation;
- timestamp/start sequence;
- camera sample used by oracle;
- observed bounds/frustum result;
- previous request's target/camera;
- next request if relevant;
- C6/C8/N2 relationship.

Do not invent missing fields.

Mark unknowns explicitly.

---

## 10. Test previous-request-camera alignment

For each relevant C6/C8/N2 sample, compare:

- the camera sampled for request N;
- the expected camera/target of request N;
- the prior request N-1 camera/target.

Evaluate whether the observed sample is more consistent with:

- current request N;
- previous request N-1;
- neither;
- insufficient evidence.

Define an objective comparison where possible.

Examples may include:

- reconstructed target point proximity;
- camera direction;
- framed bounds overlap;
- projected/NDC position;
- expected model/dbId alignment.

Do not retrofit a threshold without justification.

---

## 11. Recompute frustum/oracle math from preserved values

Where evidence is sufficient, independently recompute:

- target world bounds;
- camera matrices / projection inputs;
- projected/NDC bounds;
- frustum-plane distances;
- C8 excess;
- any C6 framing metric.

Confirm whether the preserved values reproduce the original C8 result.

Separate:

- math/oracle correctness;
- camera-sample correctness.

If the math reproduces exactly but the sampled camera appears stale, state that clearly.

---

## 12. Check request-to-sample lag pattern

Determine whether multiple observations show a consistent one-request lag.

For example:

- N sample matches N-1;
- N+1 sample matches N;
- etc.

Classify the pattern as:

- strong evidence of one-request lag;
- weak/partial pattern;
- absent;
- impossible to determine.

A single anecdotal match is not enough.

---

## 13. C6/N2 replay

Apply the same replay logic to C6/N2.

Determine whether:

- N2's non-discrimination is consistent with the same stale-camera hypothesis;
- positive and control samples may be observing the same/previous camera;
- the preserved evidence supports another cause instead.

Do not change C6's authoritative `NOT_EVIDENCED` result.

---

## 14. D1 limits

Explicitly list what the preserved R1/evidence **cannot** prove.

At minimum consider:

- camera event timeline not retained;
- transition-active state not retained;
- exact presented-frame camera not retained;
- Viewer internal animation state not retained;
- screenshots/C20 evidence absent;
- request-correlated camera identity may be unavailable.

These limitations matter for deciding whether D2 synthetic-transition work is necessary.

---

# D0 + D1 Synthesis

## 15. Build a fact / inference matrix

Create a matrix with rows such as:

- Viewer API returns before final camera presentation
- explicit transition-complete signal exists
- current T4 can settle on transient state
- one-request camera lag occurred
- frustum math is correct
- fixture expectation remains viable
- C6/N2 shares the C8 root cause

Columns:

- source fact
- preserved-evidence fact
- inference
- confidence
- unresolved gap

Do not blur these categories.

---

## 16. Decide D2 necessity

Based only on D0/D1 evidence, recommend one of:

- **D2 not needed** — root cause sufficiently established offline;
- **D2 synthetic-transition research recommended**;
- **D2 required before any implementation decision**;
- **live diagnostic eventually required**, but only after D2/offline work.

Do not start D2.

If D2 is recommended, define its purpose narrowly:

- what unresolved question it must answer;
- what synthetic model/state it should reproduce;
- what success/failure evidence would discriminate hypotheses.

---

## 17. T4 owner-decision input

Do not modify T4.

Provide owner decision input:

- evidence for keeping T4 unchanged;
- evidence for revising it;
- what additional evidence is needed before revision;
- whether a T4 change would require procedure re-acceptance.

Prefer "gather evidence first" if root cause remains ambiguous.

---

## 18. C6 margin decision input

Do not choose an arbitrary margin.

Use D1 reconstruction to determine whether any quantitative separation can be derived from existing evidence.

If not, state that margin derivation must wait for D2 synthetic/offline fixtures.

---

## 19. Research artifact

Persist the D0/D1 research under:

`docs/research/`

Suggested filename:

`docs/research/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay.md`

Include:

- source citations/file references;
- exact Viewer API/source findings;
- R1 replay tables;
- fact/inference matrix;
- unresolved gaps;
- D2 recommendation;
- T4 decision input;
- C6 margin decision input;
- non-goals.

Do not write an implementation plan.

---

## 20. Focused internal review

Perform one focused internal review of the D0/D1 research.

Review:

- source/API accuracy;
- whether private/public APIs are distinguished;
- previous-camera inference strength;
- replay math;
- fact vs inference labeling;
- D2 recommendation;
- T4 decision framing;
- C6 margin conclusion;
- scope discipline.

Classify Critical / High / Medium / Low.

Fix genuine Critical/High research defects within this research-only scope.

Persist under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

---

## 21. Handoff requirements

Update handoff to state:

- baseline checkpoint `ef436d4...`;
- C3/C2 checkpoint complete;
- C8/C6/T4 unchanged;
- D0/D1 research status;
- whether one-request camera lag is supported, plausible, or unproven;
- whether D2 is recommended/required;
- no implementation authorized;
- no retry/new record authorized;
- next action:
  **independent Work review of D0/D1 research**.

---

## 22. Commit policy

Do not commit or push.

Leave the research, review, and handoff update uncommitted for independent Work review.

---

## 23. Stop gate

Stop after:

- D0 source/API research;
- D1 read-only R1 replay;
- synthesis;
- research artifact;
- internal review;
- handoff update.

Do not:

- implement synthetic-transition tests;
- modify harness/tests/product/procedure;
- change T4;
- redesign C6/N2;
- run live G2;
- issue a new authorization record;
- reset attempt state;
- commit;
- push.

Next gate:

**Independent Work review of G2 D0 Viewer API evidence + D1 R1 replay → owner decision on D2 synthetic-transition research**

## Final report

Report:

- branch / HEAD / origin relation;
- research artifact path;
- key D0 source/API findings;
- D1 replay result;
- strength of previous-request-camera hypothesis;
- frustum-math verdict;
- C6/N2 replay result;
- D2 recommendation;
- T4 decision input;
- C6 margin conclusion;
- internal review findings;
- working-tree state;
- exact next gate.

Explicitly confirm:

- no C8/C6/T4 implementation change;
- no harness/test/product/procedure change;
- no live retry;
- no new authorization record;
- immutable evidence unchanged;
- no commit;
- no push.
