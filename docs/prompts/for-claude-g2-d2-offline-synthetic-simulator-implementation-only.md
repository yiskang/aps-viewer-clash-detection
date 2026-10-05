# For Claude — G2 D2-OFFLINE Synthetic Simulator Implementation Only

I explicitly authorize **one bounded G2 D2-OFFLINE synthetic simulator implementation task only**.

This authorization is limited to implementing and verifying the offline synthetic simulator defined by the independently accepted D2 specification.

It does **not** authorize:

- changes to the real G2 harness;
- changes to product/Core/Viewer Adapter/Panel code;
- changes to the accepted procedure;
- changes to T4;
- changes to C6/N2 runtime behavior;
- changes to C8 runtime/oracle behavior;
- browser/Viewer execution;
- diagnostic live run;
- G2 acceptance retry;
- new authorization-record issuance;
- attempt reset;
- G3/downstream work;
- commit or push.

Use the repository and accepted D2 spec as the source of truth.

---

## 1. Verify authoritative baseline

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed HEAD:
  `53ea0a74b215b4a3c7463b8fe7da4bf783b8c8fb`
- `main == origin/main`
- tracked tree clean
- only expected untracked artifacts remain:
  - the three historical/spent authorization records
  - the non-authoritative historical-live-artifacts checkpoint prompt
- committed harness SHA:
  `cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b`
- accepted procedure SHA unchanged
- immutable evidence snapshot unchanged:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/`
- historical G2 remains:
  `FAIL (row 3)`
- C6 remains:
  `NOT_EVIDENCED`
- C8 remains unresolved
- T4 remains unchanged
- no live retry
- no new authorization record
- no attempt reset
- no simulator implementation currently exists

Read at minimum:

- `docs/research/2026-10-04-g2-d2-synthetic-transition-spec.md`
- `docs/reviews/2026-10-04-g2-d2-corrected-targeted-independent-rereview.md`
- committed D0/D1 research
- latest handoff
- current T4/C6/C8 harness logic as read-only reference
- immutable evidence only as read-only historical context

If baseline differs materially, stop and report.

---

# 2. Authorized implementation location

Create the D2-OFFLINE implementation only under:

`docs/research/2026-10-04-g2-d2-synthetic-transition/`

Do not place simulator code under:

- `src/`
- `test/acceptance/`
- production packages
- Viewer extension code
- harness code

Keep D2 isolated as research tooling.

---

# 3. Required implementation scope

Implement exactly the accepted D2 synthetic model.

At minimum include:

- deterministic state machine;
- request/pending-transition model;
- restore/autocam branches;
- numeric T4 model;
- finite schedule enumeration;
- request ownership oracle;
- outcome classifier;
- synthetic geometry model;
- C6/N2 discrimination metrics;
- tail-stall branch;
- D=30 characterization witnesses;
- bounded witness/trace retention;
- runtime/input hash validation;
- deterministic output artifacts.

Do not add behavior not defined by the accepted spec.

If implementation requires changing the spec contract, stop and report instead of silently adapting.

---

# 4. State machine fidelity

Implement the accepted Viewer-like state machine exactly.

Required modeled elements:

- idle;
- active transition;
- single shared pending request slot;
- last-writer-wins pending replacement;
- request consumption;
- transition start;
- zero-motion first step;
- transition progress;
- completion;
- restoreState branch;
- camera sample/tick;
- settle evaluation;
- request ownership tracking.

Preserve the accepted causal ordering.

No request may issue before the observation/decision that enables it.

---

# 5. δ=0 / same-frame continuation

Implement the accepted **post-H continuation** semantics.

For δ=0:

- sample/decision `H` occurs first;
- request issuance occurs after that enabling observation in the same modeled frame;
- remaining same-frame phases then execute.

For δ=1:

- request issues in the next frame's external-event phase.

Add targeted tests for both.

Include invariant checks that reject any causal inversion.

---

# 6. restore/autocam branches

Implement the accepted explicit branch model.

At minimum:

- restore during idle;
- restore during active transition;
- valid restore immediate camera write;
- restore no-op/failure branch where specified;
- camera-change dispatch timing:
  - same-tick
  - next-tick
- pending request unaffected by restore unless the spec explicitly says otherwise;
- active transition ownership unaffected unless the spec explicitly says otherwise.

Do not reinterpret restore as a guaranteed cancel/reset.

---

# 7. Numeric T4 implementation

Implement T4 numerically and faithfully.

Required:

- materialized 32-entry sample;
- element-wise comparison;
- tolerance:
  `1e-9`
- first equal adjacent pair rule;
- one sample per modeled frame;
- exact settle-loop activation defined by the spec;
- same included/excluded fields as current harness T4.

Do not use symbolic pose identity as a shortcut.

Add unit tests against known equal/non-equal 32-entry samples.

---

# 8. Request-tagged ownership oracle

Implement the accepted synthetic ownership oracle.

Required:

- synthetic request IDs/tokens;
- request ownership propagated through state transitions;
- camera writes tagged with current synthetic request ownership;
- completion derived from state-machine progress, not from comparing to expected camera destination;
- oracle independent of candidate T4 result.

Add tests proving the oracle cannot self-validate.

---

# 9. Schedule enumeration

Implement the full accepted finite schedule space.

Required base durations:

`D ∈ {1,2,3,4,6,10}`

Tail length:

`L ∈ {0,1,2}`

Tail synthetic movement:

`τ = 1e-10`

Plus:

- D=30 characterization-only witnesses
- deterministic enumeration order
- stable schedule IDs

Expected exhaustive total:

`52,308`

Expected characterization witnesses:

`36`

Before trusting outputs:

- programmatically recompute the count from declared domains;
- assert it matches the accepted spec;
- fail closed if it does not.

Do not hard-code only the final count without deriving it.

---

# 10. Tail-stall sensitivity

Implement the bounded synthetic tail-stall branch.

Requirements:

- finite L domain;
- sub-epsilon movement using `τ=1e-10`;
- transition not formally complete during tail;
- T4 may sample during the quiet tail;
- classification can distinguish premature settle during tail.

Add targeted witnesses for each L.

Do not present this as historical Viewer behavior; it is synthetic sensitivity research.

---

# 11. D=30 characterization

Implement exactly 36 D=30 witness schedules.

They must:

- remain outside exhaustive outcome counts;
- feed characterization only;
- not affect impossibility claims;
- be clearly labeled in output.

Add a guard preventing D=30 witness results from entering A–E classification aggregates.

---

# 12. Classifier and outcomes

Implement the accepted single decision-list classifier.

Ensure every terminal schedule maps to exactly one result.

Include:

- normal A–E outcomes;
- `C1-INVALID`
- `C2-INCONCLUSIVE`
- THROW handling

Required semantics:

- `C1-INVALID` → exit `2`
- `C2-INCONCLUSIVE` → exit `0`

Invalid results must not count as evidence.

Inconclusive results must not masquerade as success.

Add exhaustive classifier tests over representative states.

---

# 13. THROW semantics

Implement accepted THROW behavior.

Requirements:

- simulator/harness research execution path stops;
- modeled Viewer state may continue only as specified by the model;
- no undefined classifier state after THROW;
- bounded diagnostic witness retained;
- no accidental normal outcome assignment.

Add targeted tests.

---

# 14. Scaled timeout

Implement the accepted synthetic timeout semantics.

Required:

- synthetic frame unit clearly separated from real milliseconds;
- 64-sample timeout exactly;
- bounded timeout outcome;
- timeout not interpreted as an acceptance verdict.

Add tests for:
- below timeout;
- exactly at boundary;
- over boundary.

---

# 15. Counter domains

Implement every shadow/debug counter with:

- explicit finite domain;
- initialization;
- update rule;
- reset rule;
- overflow/fail-closed behavior if applicable;
- classification role or explicit non-role.

Add invariant assertions.

---

# 16. Synthetic geometry

Implement the accepted geometry definitions exactly.

Required:

- declared coordinate system;
- normalized/unit conventions;
- retained U/A:104 inputs where specified;
- explicitly synthetic B:111/A:135/home geometry where specified;
- exact offsets;
- exact pair-distance constant:
  `263.857`
  where required by the accepted spec;
- no substitution with current live model geometry.

Add deterministic geometry tests.

---

# 17. C6/N2 discrimination metrics

Implement only the **research metrics** defined by the spec.

Do not change real C6/N2 harness semantics.

Implement:

- synthetic positive/control classes;
- unified separation formula;
- observed `d_min`;
- exploratory `3×` analysis;
- calibration anchor:
  `κ = 0.9`

Important:

- `κ=0.9` is **not** a margin;
- `3×` is **not** an accepted threshold;
- `d_min` is observed/derived only;
- no final C6 margin may be selected.

Output sufficient statistics for later owner review.

---

# 18. Historical/synthetic boundary

Enforce in implementation/output metadata:

Historical/retained:
- U
- A:104
- retained camera/frustum values where used

Synthetic:
- B:111 geometry
- A:135 geometry
- home geometry
- transition timing/order
- tail stalls
- synthetic calibration inputs

Every generated output must identify whether a field is historical-derived or synthetic.

Do not imply reconstruction of unavailable history.

---

# 19. Input/hash validation

At simulator startup, validate the exact accepted inputs.

At minimum hash-check:

- D2 spec file;
- current harness file;
- retained R1 input;
- fixture/input files identified by spec.

Mismatch must fail closed before enumeration.

Do not alter historical evidence.

Record validated hashes in output metadata.

---

# 20. Output structure

Produce deterministic offline research outputs under the D2 research directory.

Suggested structure:

`docs/research/2026-10-04-g2-d2-synthetic-transition/results/`

Include:

- summary JSON
- schedule-count report
- outcome histogram
- bounded witness traces
- C6/N2 discrimination statistics
- D=30 characterization report
- metadata/hashes

Do not write into:
- `test/acceptance/results/`
- historical live evidence directory

---

# 21. Output-size caps

Enforce accepted caps:

- at most `154` retained traces
- per-output cap:
  `2.5 MiB`
- total output cap:
  `3.5 MiB`

Use deterministic witness selection/truncation.

Do not silently drop required representative witnesses.

If cap would be exceeded, fail/report according to spec.

---

# 22. Reproducibility

Implementation must be deterministic.

Requirements:

- no randomness preferred;
- if any randomness exists, fixed explicit seed;
- deterministic schedule order;
- stable IDs;
- stable JSON key/order where feasible;
- exact commands documented;
- no Viewer/browser/network dependency.

Run from a clean checkout with the documented command.

---

# 23. Tests

Create D2-local tests under the research directory or another research-only location accepted by repo conventions.

Do **not** add tests to the production G2 acceptance suite unless separately authorized.

At minimum test:

- δ=0 causal ordering
- δ=1 ordering
- pending-slot overwrite
- restore branches
- numeric T4 comparison
- tail-stall sensitivity
- request ownership oracle
- classifier exclusivity
- C1/C2 outcomes
- timeout boundary
- schedule count `52,308`
- D=30 witness count `36`
- geometry constants
- hash-validation failure
- output cap behavior
- determinism

---

# 24. Required implementation run

After implementation, run the full D2-OFFLINE simulator once.

This is **not** a live G2 run.

Report at minimum:

- derived schedule count
- enumerated schedule count
- outcome counts
- H2-support/rejection result within modeled space
- H5 result
- C6/N2 discrimination statistics
- D=30 characterization summary
- tail-stall sensitivity result
- invalid/inconclusive counts
- retained witness count
- output sizes
- reproducibility hash

Do not interpret mechanical possibility as historical causality.

---

# 25. Second deterministic run

Run D2-OFFLINE a second time from a clean output directory.

Compare:

- output hashes
- schedule counts
- outcome counts
- witness IDs
- summary bytes where specified

They must be deterministic.

If they differ, classify and stop before any checkpoint recommendation.

---

# 26. Findings boundary

D2-OFFLINE may conclude:

- mechanical stale observation is possible under modeled schedules;
- not observed within exhaustive modeled schedules;
- model insufficient;
- C6 synthetic control discriminates;
- C6 synthetic control remains non-discriminating.

It may **not** conclude:

- historical C8 cause proven;
- product defect proven;
- live Viewer behavior proven;
- T4 should be changed automatically;
- G2 is ready to retry.

---

# 27. No real-system changes

Do not modify:

- `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`
- real G2 acceptance tests
- Viewer product code
- procedure/spec contracts outside D2 research docs
- T4
- C6/N2 runtime semantics
- C8 runtime/oracle logic
- immutable historical evidence

If implementation appears to require any of these, stop and report.

---

# 28. Documentation

Update or add D2-local README/docs covering:

- simulator architecture;
- commands;
- input hashes;
- schedule domains;
- output schema;
- interpretation limits;
- historical/synthetic boundary;
- known limitations.

Do not alter accepted D2 spec semantics.

---

# 29. Focused internal review

Perform one focused internal review of the D2-OFFLINE implementation.

Review:

- spec fidelity;
- causal ordering;
- T4 numeric fidelity;
- request oracle independence;
- schedule completeness/count;
- classifier exclusivity;
- geometry exactness;
- C6 metrics;
- output caps;
- determinism;
- input hash checks;
- historical/synthetic separation;
- scope discipline.

Classify:

- Critical
- High
- Medium
- Low

Fix genuine Critical/High implementation defects within the authorized D2-OFFLINE scope.

Persist under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

---

# 30. Handoff requirements

Update handoff to state:

- baseline checkpoint `53ea0a7...`;
- D2 spec checkpoint complete;
- D2-OFFLINE implementation status;
- simulator path;
- exact schedule count/result;
- deterministic rerun status;
- H2/H5 mechanical-result summary;
- C6/N2 synthetic-discrimination summary;
- no historical causality claim;
- T4 unchanged;
- C6/C8 runtime logic unchanged;
- no Viewer/live run;
- no new authorization record;
- no attempt reset;
- next action:
  **independent Work review of D2-OFFLINE implementation and results**.

---

# 31. Commit policy

Do not commit or push.

Leave simulator code/results/tests, internal review, and handoff update uncommitted for independent Work review.

---

# 32. Stop gate

Stop after:

- D2-OFFLINE simulator implementation;
- local research tests;
- full deterministic run;
- second reproducibility run;
- result generation;
- internal review;
- handoff update.

Do not:

- modify real harness/tests/product/procedure;
- change T4/C6/C8 runtime behavior;
- run Viewer/browser;
- run diagnostic live;
- retry G2;
- issue new authorization record;
- reset attempt state;
- commit;
- push.

Next gate:

**Independent Work review of G2 D2-OFFLINE simulator implementation/results → owner decision on checkpoint commit/push and any later diagnostic-instrumentation gate**

---

# Final report

Report:

- branch / HEAD / origin relation;
- files/directories created;
- simulator command;
- test results;
- derived vs actual schedule count;
- outcome counts;
- H2/H5 result;
- C6/N2 discrimination result;
- D=30 witness result;
- tail-stall result;
- invalid/inconclusive counts;
- retained trace count;
- output-size totals;
- deterministic rerun hashes;
- internal review findings;
- working-tree state;
- exact next gate.

Explicitly confirm:

- no real harness/test/product/procedure change;
- no T4/C6/C8 runtime change;
- no Viewer/browser/live run;
- no G2 retry;
- no new authorization record;
- no attempt reset;
- immutable evidence unchanged;
- no commit;
- no push.
