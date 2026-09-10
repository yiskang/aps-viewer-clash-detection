# Prompt — Investigate M4 Hard-Clash Precheck TLAS/Linear Parity Blocker

Open a **fresh session** for this investigation.

This is a **read-only root-cause investigation first**.

Do **not** modify source.
Do **not** relax §6.4.
Do **not** change verdict semantics.
Do **not** continue M4 Phase 4.
Do **not** widen any existing diagnostic tolerance.
Do **not** treat this as related to the already-fixed `three-mesh-bvh` blocker unless evidence proves otherwise.

## Context

The `three-mesh-bvh@0.9.14` correctness blocker has already been fixed and verified locally:

- stale shared `obb2` state in `closestPointToGeometry`
- `OrientedBox.distanceToBox` `max[f2] -> max[f3]` typo
- S2 `k=100` distance/witness parity is now clean
- the complete Phase 3 canonical M4 matrix was then rerun

That rerun still aborted under §6.4, but on a **different** issue:

- runtime: historical runtime
- case: `S2[k=100:typical:clearance]`
- state: cold
- repetition: 1
- arm order: reversed
- failing pair: `structure:3547/frag363 -> architecture:3551/frag30`
- TLAS produced one extra `clearance-hard-clash-precheck-inconclusive` diagnostic
- `clearanceHardClashExclusions` also differed by one: `346 vs 347`
- distance differences: `0`
- witness differences: `0`

The failing execution path is:

`ClearanceHardClashPrecheck -> volumeOverlapQuery -> ProperCrossingQuery / containment`

It does **not** call `closestPointToGeometry` or `OrientedBox.distanceToBox`.

Therefore this is a new blocker.

The M4 design correctly aborted because this is not diagnostic-only divergence: a correctness-bearing statistic differs too.

## Source of truth

Read:

- current M4 design spec
- current M4 implementation plan
- current M4 execution ledger / Phase 3 checkpoint notes
- current implementations of:
  - `ClearanceHardClashPrecheck`
  - `VolumeOverlapQuery`
  - `ProperCrossingQuery`
  - containment query paths
  - traversal/sample/wall-clock budget logic
  - `CollisionWorld` accounting for `clearanceHardClashExclusions`
  - canonical §6.4 comparator
- exact failing S2 artifacts/logs
- existing tests for precheck inconclusive behavior, crossing-budget exhaustion, containment budgets, and TLAS-vs-linear parity

Prefer landed code and captured artifacts over stale prose.

Write the full investigation directly to:

`docs/research/m4-hard-clash-precheck-parity-blocker-investigation.md`

Do not make me manually copy findings between sessions.

## Investigation goals

Determine why the same logical fragment pair can produce a different Hard-Clash precheck classification across TLAS and linear arms, and whether the root cause is:

- wall-clock budget nondeterminism
- candidate/traversal order dependence
- shared mutable state
- differing geometry/cache state
- containment sample-budget dependence
- crossing-query budget dependence
- diagnostic classification drift
- statistics accounting bug
- or another cause

Separate:

1. diagnostic divergence
2. precheck `conclusive` / exclusion divergence
3. final clearance result divergence

Do not assume they have the same cause.

## Step 1 — Reproduce the exact failing tuple

Re-run only the minimum scope needed to reproduce `S2[k=100:typical:clearance]` under the same runtime/state/arm-order conditions.

For pair `structure:3547/frag363 -> architecture:3551/frag30`, capture:

- candidate position/order
- geometry identity
- matrices
- AABBs
- triangle/component counts
- precheck `conclusive`
- disposition (`excluded` / `proceed` / `inconclusive` / `skip-precheck`)
- `inconclusiveCauses`
- containment samples
- crossing/containment budget counters and elapsed time if available
- exact stage timing
- cold/reused cache state
- contribution to `clearanceHardClashExclusions`

Do not add instrumentation yet. If telemetry is insufficient, state exactly what is missing.

## Step 2 — Determine whether arm order matters

Run the smallest matrix needed to compare:

- TLAS first, then linear
- linear first, then TLAS

with identical fixture/source/state setup.

Determine whether classification follows arm type, execution order, or timing.

## Step 3 — Build a direct deterministic pair-level reproduction

Extract the exact pair operands and reproduce outside the full S2 matrix.

Vary one factor at a time:

1. same operands, repeated call, same predecessor
2. same operands, different predecessor
3. same operands, different candidate position/order
4. fresh query/world/cache
5. warmed cache
6. wall-clock checks disabled only through an existing test seam
7. deterministic fake clock only if an existing seam already exists

Goal: prove whether the outcome is geometric or time/order/state dependent.

## Step 4 — Trace exclusion accounting

Verify exactly how precheck output increments `statistics.clearanceHardClashExclusions`.

Answer:

- which disposition increments it
- whether `conclusive:false` can still increment it
- whether diagnostics and exclusion count can legitimately diverge
- whether candidate order changes dedup/winner behavior
- whether one arm can evaluate/skip a pair differently

If this is accounting-only, prove that separately from semantic divergence.

## Step 5 — Audit wall-clock budget behavior

Inspect every time/budget branch in `ProperCrossingQuery`, containment, `VolumeOverlapQuery`, and relevant scheduler/clock abstractions.

For each budget identify:

- clock source
- injected vs private
- wall-clock vs operation count
- reset scope
- whether earlier candidates influence later ones
- whether JIT/GC/scheduling can affect the result
- whether TLAS vs linear ordering changes exposure
- whether exhaustion changes only diagnostics or correctness-bearing semantic disposition

If wall-clock timing can produce:

same operands -> one run `excluded`, another `proceed/inconclusive`

classify it as production correctness nondeterminism, not benchmark noise.

## Step 6 — Audit traversal/candidate-order dependence

Compare failing-pair candidate position under TLAS vs linear and inspect prior work, cache/JIT/budget state, and any reused mutable scratch/query objects.

Search explicitly for shared mutable state analogous to the prior `obb2` defect.

## Step 7 — Separate crossing from containment

For the exact pair, independently record:

- ProperCrossingQuery result/reason
- containment A-in-B
- containment B-in-A

Identify the first substage whose result differs and whether its inputs are identical.

## Step 8 — Re-evaluate the existing diagnostic carve-out

Determine whether this case is:

A. diagnostic-only difference plus accounting artifact, or
B. genuine semantic precheck divergence.

If B, state explicitly:

**the existing carve-out must NOT be widened.**

## Step 9 — Determine minimum fix class

Do not implement yet.

Classify likely remediation as one of:

A. deterministic operation/sample budget
B. wall-clock budget becomes diagnostic-only while semantic result remains deterministic
C. reset/isolate per-pair budget state
D. eliminate shared mutable state
E. statistics accounting-only fix
F. traversal/order-dependence fix
G. another narrow correction

For each plausible option report correctness impact, public-contract impact, performance impact, M1–M3 impact, scope classification, and regression surface.

Do not retune thresholds merely to pass the gate.

## Step 10 — Required regression tests

Specify deterministic tests for the eventual fix, including:

1. exact failing pair `structure:3547/frag363 -> architecture:3551/frag30`
2. pair-level order independence
3. S2 `k=100:typical:clearance` TLAS/linear parity
4. `clearanceHardClashExclusions` equality
5. deterministic diagnostic behavior under budget exhaustion
6. containment budget regression if implicated
7. ProperCrossingQuery budget regression if implicated
8. full collision unit suite
9. Phase 3 canonical matrix rerun only after focused parity is clean

Tests must distinguish diagnostic-only, semantic, and accounting nondeterminism.

## Step 11 — Final disposition

End with exactly one:

- `FIX_REQUIRED_BEFORE_M4_CAN_CONTINUE`
- `ACCOUNTING_ONLY_FIX_REQUIRED`
- `EXISTING_DIAGNOSTIC_CARVEOUT_IS_SUFFICIENT`
- `INSUFFICIENT_EVIDENCE`

Also state whether:

- §6.4 remains unchanged
- current Phase 3 canonical result remains invalid
- previous provisional D remains unusable
- Phase 4 remains blocked

## Output

Write:

`docs/research/m4-hard-clash-precheck-parity-blocker-investigation.md`

Do not edit source.
Do not commit.
Do not run Phase 4.
Do not modify the reducer.
Do not modify §6.4.

Return only a concise summary with:

- root cause, if established
- semantic vs accounting-only classification
- recommended fix class
- disposition
- report path
