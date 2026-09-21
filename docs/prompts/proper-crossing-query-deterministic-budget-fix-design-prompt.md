# Prompt — Design the Fix for ProperCrossingQuery Wall-Clock Correctness Nondeterminism

Open a **fresh session** for this task.

This is a **fix-design task only**.

Do **not** implement code yet.
Do **not** continue M4 Phase 4.
Do **not** relax §6.4.
Do **not** widen the existing timing-diagnostic carve-out.
Do **not** modify the M4 verdict reducer.
Do **not** workerize `ProperCrossingQuery`.
Do **not** add a resumable traversal unless the design proves it is strictly necessary.

Write the design directly to:

`docs/superpowers/specs/2026-09-11-proper-crossing-query-deterministic-budget-fix-design.md`

Do not return a long design only in chat.

---

## Context

The M4 Phase 3 canonical matrix exposed a second pre-existing correctness blocker after the `three-mesh-bvh` defects were fixed.

The investigation report is:

`docs/research/m4-hard-clash-precheck-parity-blocker-investigation.md`

Read it first.

The investigation established:

- `ProperCrossingQuery.js:166` uses an ~8 ms wall-clock budget;
- that wall-clock budget can abort traversal mid-flight;
- a genuine crossing can therefore be suppressed;
- the same logical pair can flip from proven crossing / excluded to `conclusive:false` / inconclusive depending on timing;
- this is **semantic correctness nondeterminism**, not accounting-only drift;
- `clearanceHardClashExclusions` differs because accounting is faithfully reporting the changed semantic result;
- the failure is not intrinsically TLAS-vs-linear: repeated execution within one arm can also differ;
- this defect is independent of the previously-fixed `three-mesh-bvh` issue;
- §6.4 is correct to reject the run;
- Phase 3 canonical evidence is invalid until this is fixed.

The current recommendation class is:

**B — make wall-clock breach observational, and decide semantic completion with a deterministic bound instead.**

The investigation deliberately left six architecture questions open. This design must resolve them.

---

# Design goals

The fix must make `ProperCrossingQuery`:

1. **deterministic for identical geometric inputs;**
2. independent of machine speed, JIT state, GC timing, browser scheduling, candidate order, and incidental wall-clock timing;
3. still bounded by an explicit deterministic work limit;
4. still observable for responsiveness/performance purposes;
5. compatible with M1–M3 semantic contracts;
6. measurable by M4 without pre-implementing a worker architecture.

Correctness and responsiveness must be treated as separate concerns.

A slow-but-correct deterministic result is preferable to a fast nondeterministic semantic result. M4 exists to decide whether that slow work should later move off-main-thread.

---

# Required architecture decisions

Resolve all six decisions explicitly.

## Decision 1 — normative semantic rule

Adopt this direction unless source evidence proves it impossible:

> Wall-clock elapsed time must never directly determine the geometric semantic result.

A wall-clock threshold may produce telemetry such as:

- `timeBudgetExceeded`
- `slowTraversal`
- timing diagnostic/event data

but it must not by itself cause:

- `aborted`
- `conclusive:false`
- crossing suppression
- containment suppression
- a changed Hard-Clash exclusion decision

Define the new normative truth table for:

- crossing proven
- no crossing proven within deterministic bound
- deterministic bound exhausted
- wall-clock threshold crossed before completion
- wall-clock threshold crossed and crossing later proven
- unsupported/invalid geometry

State exactly which conditions are semantic vs telemetry-only.

---

## Decision 2 — continuation architecture

Default design constraint:

**Do not introduce resumable traversal or worker execution merely to fix correctness.**

Prefer:

- synchronous deterministic traversal;
- deterministic operation/sample budget;
- existing outer scheduler/checkpoints remain responsible for cooperative yielding between atomic operations;
- M4 measures whether the resulting atomic span is acceptable.

Only propose resumable traversal if the current algorithm cannot support a deterministic finite work bound without it.

If resumability is proposed, prove why simpler deterministic bounded traversal is insufficient.

---

## Decision 3 — deterministic replacement budget

Design a deterministic budget tied to actual algorithmic work rather than elapsed milliseconds.

Do not choose an arbitrary numeric cap.

First inspect actual `ProperCrossingQuery` mechanics and identify the best countable work unit, for example:

- triangle-pair candidate tests;
- BVH leaf/primitive visits;
- classified points;
- segment/triangle tests;
- geometric probes;
- another exact internal operation count.

The chosen counter must satisfy:

- deterministic for identical inputs;
- monotonically related to work;
- cheap to count;
- independent of machine/runtime timing;
- reset at the correct semantic scope;
- usable in tests without a fake clock;
- capable of bounding pathological inputs.

Then determine how the cap should be selected.

Preferred approach:

1. derive candidate bounds from existing shipped geometry ceilings and current fixture distributions;
2. characterize operation counts on:
   - existing M1/M2/M3 fixtures;
   - the failing real pair;
   - pathological synthetic geometry;
3. choose a pre-registered deterministic limit high enough not to censor known legitimate work but finite enough to protect pathological cases;
4. document the evidence and margin.

If the final numeric cap cannot honestly be selected in this design without additional measurement, specify a bounded calibration task and state exactly what evidence is needed before implementation.

Do not silently reuse “8 ms” as an operation-count equivalent.

---

## Decision 4 — return/result contract

Clarify the meaning of the query result after the fix.

Recommended direction:

- `aborted` means **deterministic semantic work budget exhausted before the query could conclude**;
- wall-clock threshold breach does **not** set `aborted`;
- wall-clock threshold breach is telemetry only;
- `conclusive` reflects geometric/deterministic-budget completion only.

Define:

- exact result shape;
- whether any public fields change;
- whether new telemetry stays internal/diagnostic-event-only;
- how `VolumeOverlapQuery` and `ClearanceHardClashPrecheck` consume the result;
- how `inconclusiveCauses` should represent deterministic budget exhaustion;
- whether existing diagnostic strings remain stable.

Prefer no public API change.

---

## Decision 5 — fix scope

The defect is in shared `ProperCrossingQuery`, not only in clearance.

Therefore evaluate and preferably adopt:

> Fix the shared query semantics once, rather than adding a clearance-only workaround.

Explicitly assess impact on:

- `volume-overlap`
- `clearance` Hard-Clash precheck
- containment/crossing composition
- M1/M2/M3 fixtures and diagnostics
- any shipped `aborted` or inconclusive semantics

If changing shared behavior alters an earlier milestone's assumption, classify whether that is:

- a bug fix preserving intended semantics, or
- a genuine contract change requiring architecture-change discipline.

Do not preserve known incorrect nondeterminism merely to avoid touching shared code.

---

## Decision 6 — regression expectation vs normative constant

The observed `clearanceHardClashExclusions = 347` for the failing S2 tuple may be used as a **pinned fixture regression expectation** if validated.

It must **not** become a library normative constant.

The actual normative contract is:

- identical geometric inputs produce the same semantic precheck outcome;
- TLAS and linear arms agree semantically;
- repeated runs agree semantically;
- deterministic budget exhaustion is reproducible.

State this explicitly.

---

# Detailed design work

## 1. Trace the current algorithm

Document the relevant call chain:

`ClearanceHardClashPrecheck`
→ `volumeOverlapQuery`
→ `ProperCrossingQuery`
→ traversal / crossing classification

Identify:

- current wall-clock check location(s);
- current `aborted` propagation;
- how crossing success short-circuits;
- how “no crossing” is represented;
- where the query allocates/reuses scratch state;
- whether any state persists across calls;
- current counters already available;
- current public/internal diagnostics.

Use exact current source, not stale spec prose.

---

## 2. Define deterministic work accounting

Specify the exact counter lifecycle.

For each counter define:

- name
- increment site
- unit
- reset point
- max value
- overflow behavior
- telemetry/reporting behavior
- test seam, if any

Avoid multiple overlapping counters unless each has a distinct correctness purpose.

If one global deterministic budget can safely cover all relevant crossing work, prefer that.

---

## 3. Define wall-clock telemetry behavior

Retain performance visibility without allowing time to change semantic output.

Design how the existing 8 ms concept should survive, if at all.

For example:

- record first threshold crossing timestamp;
- emit one diagnostic-event entry;
- continue semantic traversal;
- report total elapsed duration;
- M4 scheduler-conformance/X-1 handles responsiveness.

Do not emit repeated unbounded telemetry inside a hot loop.

Define whether the existing timing-derived diagnostic reason remains:

- unchanged but telemetry-only;
- renamed;
- deprecated;
- or removed from correctness comparison.

Any change to §6.4 diagnostic carve-out must be avoided unless strictly necessary. Prefer keeping §6.4 unchanged by making timing diagnostics clearly non-semantic.

---

## 4. Specify deterministic exhaustion semantics

When the deterministic work limit is hit:

- traversal stops;
- result becomes reproducibly inconclusive;
- cause must be deterministic;
- statistics/diagnostics must be stable;
- repeated identical runs must produce identical exhaustion.

Define how this composes with:

- `VolumeOverlapQuery`
- source-in-target containment
- target-in-source containment
- Hard-Clash precheck
- clearance fallback

Make sure one deterministic exhaustion does not get misreported as a proven non-overlap.

---

## 5. Examine containment interactions

Even if the confirmed blocker is `ProperCrossingQuery`, inspect whether containment logic uses analogous wall-clock correctness budgets.

Classify each timing budget in the composed overlap query:

- semantic and deterministic;
- wall-clock and correctness-bearing;
- wall-clock but diagnostic-only;
- sample-count deterministic.

If containment has the same defect class, decide whether it must be fixed in the same correction to restore true deterministic `VolumeOverlapQuery` semantics.

Do not expand scope casually, but do not knowingly leave the same correctness defect one call later in the same composed predicate.

---

## 6. Performance implications

Estimate what happens when a query that previously stopped at ~8 ms is allowed to continue until deterministic completion/exhaustion.

Report:

- expected worst atomic-span growth;
- whether current `frameBudgetMs` can preempt it (likely not);
- whether outer scheduler checkpoints still behave correctly;
- whether this increases the chance M4 will justify a worker boundary;
- whether any shipped capacity ceiling needs reinterpretation.

Do not retune `frameBudgetMs`.
Do not introduce a worker to hide the cost.

---

## 7. M4 implications

State explicitly:

- this is a prerequisite correctness fix discovered by M4;
- it is not evidence for A/B/C/D;
- prior Phase 3 canonical run remains invalid;
- previous provisional D remains unusable;
- Phase 4 remains blocked;
- after the fix, focused parity must pass before a full Phase 3 rerun.

Also determine whether M4 instrumentation should retain per-pair precheck evidence more directly for future debugging.

If yes, keep it bounded and diagnostic-only.

Do not change verdict semantics.

---

# Required regression matrix

Design deterministic regression tests before implementation.

At minimum:

## A. Exact real failing pair

`structure:3547/frag363 -> architecture:3551/frag30`

Verify stable semantic result across repeated execution.

## B. Pair-order independence

Same exact pair, change only predecessor/candidate order.

Semantic result must remain identical.

## C. Wall-clock independence

Using an internal test clock/seam if needed:

- simulate slow elapsed time;
- semantic result must remain unchanged;
- telemetry may differ.

## D. Deterministic budget exhaustion

Construct a case that exceeds the deterministic operation limit.

Verify:

- same operation count every run;
- same `aborted`/inconclusive result every run;
- same cause every run.

## E. TLAS vs linear parity

Re-run:

`S2[k=100:typical:clearance]`

Require:

- `clearanceHardClashExclusions` equality;
- diagnostics equality except already-approved telemetry-only exceptions;
- distance/witness equality;
- full §6.4 parity.

## F. Same-arm repeat stability

Run the failing tuple repeatedly under only TLAS and only linear.

No semantic/statistics drift.

## G. M1/M2/M3 semantic regressions

Run affected unit and performance/acceptance gates.

Do not require timing values to remain identical if the old value depended on premature wall-clock abort, but require semantic/correctness contracts to remain intact.

## H. Pathological geometry

Exercise the deterministic cap with synthetic worst-case geometry and verify bounded completion.

---

# Implementation planning boundary

This design should finish with a concrete implementation shape but **must not implement it**.

If the deterministic cap value still requires empirical calibration, define a small pre-implementation measurement task with:

- exact inputs;
- exact counter(s);
- exact output;
- decision rule for selecting the cap.

Do not let the implementer pick the number ad hoc.

---

# Review requirements

After drafting:

1. run one independent architecture/correctness review;
2. focus review on:
   - semantic determinism;
   - deterministic budget correctness;
   - containment interaction;
   - M1–M3 compatibility;
   - telemetry vs semantic separation;
   - no accidental workerization;
3. fix genuine Critical/High issues in the design;
4. do not start implementation planning yet.

---

# Final design report

End with:

## Adopted decisions

List all six architecture decisions explicitly.

## Proposed semantic truth table

Summarize wall-clock vs deterministic-budget behavior.

## Deterministic budget definition

Name the work unit and how the cap is selected.

## Compatibility disposition

State whether this is a bug fix or public contract change.

## Required implementation tasks

High-level only.

## M4 restart sequence

Exactly:

1. implement deterministic correctness fix;
2. focused regressions;
3. S2 k=100 TLAS/linear parity;
4. same-arm repeat stability;
5. full Phase 3 canonical matrix;
6. VALID §6.4 checkpoint;
7. only then evaluate Phase 4 authorization.

End with exactly one readiness statement:

- `READY_FOR_IMPLEMENTATION_PLANNING`
- `BLOCKED_ON_BUDGET_CALIBRATION`
- `BLOCKED_ON_ARCHITECTURE_DECISION`

Do not commit.
Do not implement.
