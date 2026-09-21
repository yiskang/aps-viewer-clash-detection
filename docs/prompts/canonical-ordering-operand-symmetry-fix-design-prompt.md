# Prompt — Design the Fix for Reload-Unstable Canonical Ordering / Operand Symmetry

Open a **fresh Claude session**.

This is a **fix-design task only**.

Do **not** implement code yet.
Do **not** continue M4 Phase 4.
Do **not** relax §6.4.
Do **not** modify the M4 verdict reducer.
Do **not** work around the issue by suppressing Viewer reloads.
Do **not** widen diagnostic tolerances.
Do **not** simply replace `geometryIndex` with another identifier without proving its stability and semantics.

Write the design directly to:

`docs/superpowers/specs/2026-09-11-canonical-ordering-operand-symmetry-fix-design.md`

Do not return a long design only in chat.

---

## Context

The M4 Effect B investigation is complete.

Read first:

- `docs/research/m4-effect-b-precheck-diagnostic-nondeterminism-investigation.md`
- current M4 design spec
- current M4 implementation plan
- current `CollisionWorld.js`
- current `comparePlacedCanonically` implementation and every call site
- current `ProperCrossingQuery`
- current `VolumeOverlapQuery`
- current containment/crossing composition
- current aggregation/tie-break logic
- any tests that depend on canonical operand ordering or deterministic aggregation

The investigation established:

- Viewer fragment `geometryIndex` is reassigned across page loads;
- 490/543 Structure fragments changed `geometryIndex` across sessions while geometry bytes remained identical;
- `CollisionWorld.js:189-198` uses `geometryIndex` in `comparePlacedCanonically`;
- that comparator decides A/B operand order for geometric evaluation;
- operand order changes epsilon/probe-ladder behavior in `ProperCrossingQuery`;
- replaying the same geometry pair with operands swapped reproduced the production flip pattern exactly (106/106);
- final clash results happened to remain stable in the observed runs, but:
  - `inconclusiveCauses`
  - `clearanceDistanceQueriesRun`
  - and other §6.4 correctness-bearing intermediate statistics/diagnostics
  were not stable;
- the instability is triggered by Viewer reload/re-enumeration, not by geometry changes;
- §6.4 must remain strict;
- M4 remains blocked until this correctness issue is fixed.

This is not an M4 harness defect.

---

# Design goal

Restore deterministic collision semantics across Viewer reloads and operand permutations.

The design must answer two distinct questions:

1. **Should geometric semantics depend on a canonical A/B operand order at all?**
2. **If a canonical order is still required somewhere, what data may legally participate in that order?**

Do not assume the current answer is “replace geometryIndex with fragmentId.”

---

# Required architecture decisions

Resolve all of the following explicitly.

## Decision 1 — separate identity ordering from geometric operand ordering

Determine every purpose currently served by `comparePlacedCanonically`.

Classify each call site into one of:

- deterministic aggregation/tie-breaking only;
- geometric operand orientation;
- cache/index ordering;
- diagnostics/provenance formatting;
- another purpose.

The same comparator must not remain overloaded across semantically different responsibilities unless the design proves that is safe.

Preferred direction:

> canonical ordering used for deterministic aggregation should be separate from any ordering that can affect geometric predicate semantics.

If geometric evaluation does not require canonical orientation, remove that coupling.

---

## Decision 2 — define the permutation-invariance requirement

Determine whether these predicates are intended to be semantically symmetric under operand swap:

- `ProperCrossingQuery(A, B)` vs `ProperCrossingQuery(B, A)`
- `VolumeOverlapQuery(A, B)` vs `VolumeOverlapQuery(B, A)`
- Hard-Clash precheck
- containment composition
- clearance Hard-Clash exclusion

For each one, define:

- semantic result that must be invariant;
- diagnostics/counters that must be invariant;
- any output that is legitimately directional.

Preferred invariant:

> Swapping A/B may change source/target provenance presentation, but must not change the geometric truth value or completeness classification for a symmetric predicate.

If the algorithm is inherently directional internally, the design must define how two directional evaluations compose into one symmetric semantic result.

Do not mask asymmetry with an arbitrary stable ID order unless that is explicitly justified.

---

## Decision 3 — determine whether ProperCrossingQuery itself must become swap-invariant

Evaluate at least these strategies:

### A. Keep one directional call, but choose a stable canonical operand order
Requires a reload-stable ordering key.

Assess:
- correctness;
- reload stability;
- cost;
- whether it merely hides directional sensitivity rather than fixing it.

### B. Evaluate both directions and combine
Evaluate A→B and B→A and combine under a deterministic truth table.

Assess:
- semantic correctness;
- completeness;
- cost multiplier;
- diagnostic/counter merging;
- interaction with deterministic work budgets;
- whether duplicate geometric work is acceptable.

### C. Refactor the crossing algorithm so one evaluation is intrinsically symmetric
Assess:
- complexity;
- risk;
- whether current math naturally supports it.

### D. Another narrowly justified design

Choose one and explain why.

Do not default to the cheapest implementation if it leaves semantic correctness dependent on arbitrary identity order.

---

## Decision 4 — if any canonical identity tie-break remains, define legal key material

Audit potential fields:

- `geometryIndex`
- `fragmentId`
- `dbId`
- `loadEpoch`
- model object identity
- modelId
- geometry content hash
- world matrix values
- local geometry bounds
- representative fragment selection
- other stable geometric/provenance data

For each candidate state:

- stable across page reload?
- stable across model replacement?
- unique enough?
- deterministic across arms?
- cheap enough?
- correctness-bearing or diagnostic-only?
- already part of public/internal contract?

Explicitly reject unsuitable fields.

Important:

- `geometryIndex` is proven reload-unstable and must not remain correctness-bearing for semantic ordering.
- `loadEpoch` is intentionally runtime/session-specific and cannot be treated as durable identity.
- do not assume `fragmentId` is reload-stable without evidence.

If no existing runtime identifier is safe, say so.

---

## Decision 5 — deterministic aggregation tie-break

Separate dbId-level/result aggregation from geometric predicate semantics.

Define a deterministic aggregation tie-break that is:

- stable within the call;
- reproducible across TLAS/linear arms;
- independent of traversal order;
- not allowed to alter geometric truth.

If cross-reload byte-for-byte identical aggregation is required, prove the chosen key supports it.

If only same-run arm parity is required for aggregation, state that distinction clearly.

---

## Decision 6 — diagnostics/statistics semantics

Define how the fix affects:

- `inconclusiveCauses`
- `clearanceDistanceQueriesRun`
- `clearanceHardClashExclusions`
- crossing/containment counters
- witnesses
- final pair selection

The design must ensure:

- reload cannot change correctness-bearing counters merely by permuting operand identity;
- TLAS and linear arms agree under §6.4;
- same geometry replayed after reload produces equivalent semantic evidence.

Do not solve this by deleting diagnostics from the comparator.

---

# Detailed design work

## 1. Map comparePlacedCanonically call graph

Document every call site and what changes if the comparator order flips.

For each call site answer:

- does order affect only output ordering?
- does order affect which geometry is anchor/source/target?
- does order affect epsilon, scale, probe ladder, containment direction, or pruning?
- does order affect dbId winner selection?

This call graph is required before choosing a fix.

---

## 2. Verify identifier stability experimentally

Using existing fixture/load flows, measure across repeated page loads:

- `fragmentId`
- `dbId`
- `geometryIndex`
- any candidate alternative ordering fields

For a representative set of fragments, report:

- stable count / total;
- changed count / total;
- collisions;
- whether geometry bytes stayed identical.

If a candidate field is proposed for correctness-bearing ordering, it must be backed by this evidence.

---

## 3. Define semantic truth table for operand permutation

Write a truth table covering at minimum:

### Proper crossing
- A→B proves crossing, B→A proves crossing
- only one direction proves crossing
- neither proves crossing conclusively
- one/both directions exhaust deterministic budget
- unsupported geometry

### Containment
- A in B
- B in A
- neither
- inconclusive one direction
- inconclusive both directions

### Volume overlap
Define how directional sub-results combine into:
- proven overlap
- proven non-overlap if such a state exists
- inconclusive

The truth table must be deterministic and independent of arbitrary identity order.

---

## 4. Account for performance cost

If the chosen fix evaluates both directions or adds work, quantify expected cost.

Use existing telemetry/calibration where possible.

Report:

- expected multiplier on crossing work;
- impact on worst atomic span;
- impact on the new deterministic 1536 cap;
- whether a cap must apply per direction or across the composed symmetric query;
- whether the previous Phase B `S_worst = 15.5 ms` calibration remains valid.

Do not silently reuse that calibration if the algorithm doubles work.

If new calibration is required, define it explicitly and block implementation progression at the right point.

---

## 5. Interaction with the ProperCrossing deterministic-budget fix

Clarify:

- implementation order;
- whether Phase C should land before or after this fix;
- whether the 1536 classification cap is directional or combined;
- how deterministic exhaustion is merged if evaluating both directions;
- telemetry semantics;
- regression ownership.

Preferred outcome:

> no semantic result depends on wall-clock time or reload-unstable identity.

---

## 6. Scope and compatibility classification

Determine whether this is:

- a correctness bug fix preserving intended symmetric geometry semantics;
- or a public/internal contract change.

Assess impact on:

- M1 volume-overlap
- M2/M2.1 Hard Clash
- M3 clearance precheck
- deterministic dbId aggregation
- existing diagnostics
- existing acceptance fixtures

Do not preserve incorrect reload-dependent behavior merely for backward compatibility.

---

# Required regression design

Specify tests before implementation.

At minimum:

## A. Reload stability
Same geometric pair must produce identical semantic precheck outcome across reloads even when `geometryIndex` changes.

## B. Operand-swap invariance
For the 106-pair causal replay set:
- evaluate original order;
- evaluate swapped order;
- require semantic equivalence under the new contract.

## C. Exact known unstable pairs
Pin several Effect B pairs and require stable:
- conclusive/disposition;
- inconclusive causes;
- exclusion contribution;
- distance-query decision.

## D. TLAS/linear parity
Re-run `S2[k=100:typical:clearance]` and require full §6.4 parity.

## E. Cross-reload M4 parity
Explicitly test the harness pattern that reloads between comparable arms/runs.

## F. Aggregation determinism
Equal-distance/equal-priority candidates must choose the same dbId-level winner independent of traversal order.

## G. M1/M2/M2.1/M3 compatibility
Run affected tests/gates and classify changed diagnostics/results.

## H. ProperCrossing deterministic-budget composition
Verify symmetry under:
- normal completion;
- deterministic budget exhaustion;
- wall-clock telemetry threshold crossing.

---

# M4 stop gate

Until this fix is designed and implemented:

- Phase 3 canonical result remains invalid;
- prior provisional D remains unusable;
- M2/M3/full canonical reruns remain blocked;
- Phase 4 remains blocked.

The fix itself is not evidence for A/B/C/D.

---

# Review requirements

After drafting:

1. run one independent architecture/correctness review;
2. focus on:
   - permutation invariance;
   - reload-stable identity assumptions;
   - aggregation-vs-geometry separation;
   - performance/cap interaction;
   - M1–M3 compatibility;
3. fix genuine Critical/High findings in the design;
4. do not implement yet.

---

# Final design format

End with:

## Adopted fix strategy

State exactly which approach was chosen:
- stable canonical ordering;
- dual-direction composition;
- intrinsic symmetric refactor;
- or another design.

## Identity policy

List which fields are:
- permitted for semantic ordering;
- permitted only for runtime lookup/cache;
- permitted only for diagnostics;
- forbidden as correctness-bearing tie-breaks.

## Symmetry truth table

Summarize the semantic composition rules.

## Performance/calibration impact

State whether the previous ProperCrossing calibration remains valid or must be rerun.

## Compatibility disposition

State whether this is a bug fix or contract change.

## Required implementation phases

High-level only.

## M4 restart sequence

Exactly:

1. implement canonical-ordering / operand-symmetry fix;
2. focused Effect B regressions;
3. complete/validate ProperCrossing deterministic-budget Phase C;
4. recalibrate if required;
5. S2 k=100 TLAS/linear parity;
6. M1/M2/M2.1/M3 compatibility validation;
7. full Phase 3 canonical matrix;
8. VALID §6.4 checkpoint;
9. only then evaluate Phase 4 authorization.

End with exactly one:

- `READY_FOR_IMPLEMENTATION_PLANNING`
- `BLOCKED_ON_RECALIBRATION`
- `BLOCKED_ON_ARCHITECTURE_DECISION`

Do not implement.
Do not commit.
