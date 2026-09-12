# Fix Design — Reload-Unstable Canonical Ordering / Operand Symmetry

**Executes:** `docs/prompts/canonical-ordering-operand-symmetry-fix-design-prompt.md`.
**Date:** 2026-09-11
**Branch:** `feature/m4-performance-worker-decision-design`, base commit `db64324`.
**Revision:** 2 — revised against an independent `codex-review architecture` (high) pass; see §14.
**Status:** design only. No code was changed, nothing was committed, `collision/` was not touched,
§6.4 was not edited, the M4 verdict reducer was not opened, no diagnostic tolerance was widened, no
Viewer reload was suppressed, and M4 Phase 4 was not started.

**Input it fixes:** `docs/research/m4-effect-b-precheck-diagnostic-nondeterminism-investigation.md`
(disposition `SEMANTIC_PRECHECK_NONDETERMINISM` / `FIX_REQUIRED_BEFORE_M4_CAN_CONTINUE`).

---

## 0. The answer, in one paragraph

The defect is **not** that `geometryIndex` is unstable. It is that a **geometric tolerance is decided
by an identity comparator at all**. `comparePlacedCanonically` picks which operand's `localDiagonal`
becomes `L_canonical`, and `L_canonical` scales both of `properCrossingQuery`'s tolerance knobs. When
the *smaller* operand wins that comparison, ladder rungs fall at or below the other operand's own
`classifyPoint` surface band — and because the probe is launched from a point that lies **on both
surfaces**, such a rung is **provably incapable of producing anything but `boundary`** (§4.0). The
`inconclusive-crossing` oscillation Effect B measured is that arithmetic, not geometry; and the
repository's own `ductThroughBeamFixture` regression already records the stronger form of the same
failure in prose — the small-operand orientation *loses a real crossing*
(`test/CollisionWorld.findClashes.dispatch.test.mjs:266-286`).

The fix therefore does not look for a better identifier. It draws an explicit line:
**`properCrossingQuery` is a directional kernel and carries no symmetry contract; `volumeOverlapQuery`
is the canonical wrapper and carries the whole contract.** The wrapper orients the two operands by a
**total geometric order** — world-space diagonal, then triangle count, then vertex count, then world
matrix, then a cached geometry-content digest — so the same physical operand is always the kernel's
`A`, whichever way the caller labels the pair. That makes the kernel's *entire* output, `aborted`
included, bit-identical under operand swap, and invariant across Viewer reloads because every rank
key is proven bit-stable across loads. Separately, the coplanarity epsilon is **tightened** to a
symmetric minimum so the fix cannot widen an existing tolerance as a side effect.
`comparePlacedCanonically` survives **only** as a dbId-level aggregation tie-break, re-keyed to drop
`geometryIndex`. No traversal work is duplicated and no deterministic cap changes — but the *measured*
span envelope is **not** preserved by that argument, so a **focused recalibration (Phase B′) is
required** (§9.4).

---

## 1. Established inputs, and what each is used for here

Every fact is cited to its source. **No number in this document is a new measurement**; where
evidence is inferential it is labelled inferential, and where it is pending it is labelled pending.

| # | Fact | Source | Used by |
|---|---|---|---|
| F1 | `comparePlacedCanonically` orders by `(loadEpoch, geometryIndex, fragmentId)` and exists **only** to pick `L_canonical` | `CollisionWorld.js:162-198` | Decisions 1, 3 |
| F2 | `geometryIndex` = Viewer `FragmentList.getGeometryId(fragId)`, captured at `ViewerModelAdapter.js:117,267` | research doc §6.5 | Decision 4 |
| F3 | **490 / 543** Structure fragments received a different `geometryId` across 14 independent loads of the identical fixture | research doc §6.4 | Decision 4 |
| F4 | Across the same 14 loads, per `fragmentId`: stored `worldMatrix` bytes **0 / 543** differ; welded `position`+`index` bytes **0 / 543** differ; an FNV digest over every fragment world matrix of all three models is identical (`3913657232`) | research doc §6.4 | Decisions 3, 4 |
| F5 | Operand swap inside one page load flips `inconclusive` on **66 / 106** replayed pairs, changes `pointClassifications` on **106 / 106**, and flips `crossing` on **0 / 106** | research doc §6.5a | Decisions 2, 3, 6 |
| F6 | The class-B pair (`L_source = 290.969`, `L_target = 3.918`, ratio **74:1**) moves a clearance precheck between `proceed` and `inconclusive`, taking `conclusive`, `inconclusiveCauses` and the §6.4-compared statistic `clearanceDistanceQueriesRun` (129 ↔ 130) with it | research doc §5.1 | Decisions 3, 6 |
| F7 | `ladder = offsetLadderFactors × localDiagonalA` and `surfaceEpsilon = surfaceEpsilonFactor × localDiagonalA` are the only two readers of `L_canonical` | `ProperCrossingQuery.js:114-115` | Decision 3 |
| F8 | `classifyPoint` uses **that side's own** `L`: a point whose closest distance to the surface is `≤ 1e-6 × L` is classified `boundary` **before** any parity casting — so `inside` and `outside` each carry a ≥ `1e-6 × L` separation margin by construction | `ContainmentQuery.js:78-84`, `constants.js:9-10` | §4.0, §14 Finding 2 |
| F9 | Phase A + Phase C **have landed** (`db64324`): the wall clock is telemetry-only; the only terminators are `maxCandidatePairsExamined = 50_000`, `maxCrossingPairsExamined = 64`, `maxCrossingPointClassifications = 1536` (= 64 × 24, non-binding by construction) | `ProperCrossingQuery.js:128-134`, `constants.js:43-74` | Decision 3, §9.4, §9.5 |
| F10 | Phase B calibration: `S_worst = **15.5 ms**` on the authoritative tier → **CAUTION**; zero of 21,300 traversals exceeded 24.8 ms; the worst traversal was **candidate-pair-saturated** (`cand 50001`, `pointClassifications 0`); worst real-model traversal **10.8 ms**; **`pointClassifications` maxed at 1152 — 75 % of the cap**, and `exhaustedBudget === 'point-classifications'` occurred **0 times** | calibration doc §3.1, §6, §7, §9 | §9.4 |
| F11 | M1 **explicitly considered and rejected** deriving a symmetric scalar, choosing identity-canonical ordering instead, to make "symmetry structural rather than a property to be argued about" | M1 design `:1679-1686` | Decision 3, §9.6 |
| F12 | A committed regression already documents the stronger failure: at ~707:1, the small-operand orientation makes "the ladder's largest step land inside the duct's own `classifyPoint` boundary band, every probe reports `boundary`, and it returns a clean `overlap: false`" — **a real crossing is lost** | `test/CollisionWorld.findClashes.dispatch.test.mjs:266-323` | Decision 3 |
| F13 | `validateUniformScale` validates **one matrix** as rigid + positive uniform scale (orthogonal columns, no reflection, no projective row). It says **nothing** about the *relative* scale between two operands: two operands at uniform scales 1 and 1000 both pass | `collision/query/ClearanceTransform.js:25-70` | §4.0 |
| F14 | `computeToleranceFloor`, in the same file, already converts **both** operands' local diagonals to world units via their own `scaleFactor` **before** taking a `max`, with the explicit comment that "comparing local- and world-frame quantities directly is invalid" | `ClearanceTransform.js:72-80` | §4.0 — the in-repo precedent for the world-space max rule |
| F15 | The Phase B calibration harness calls the **kernel directly** — `properCrossingQuery(a.bvh, b.bvh, matrixBtoA, a.localDiagonal, b.localDiagonal, { frameBudgetMs: Infinity })` — over a fixed catalogue order; it never goes through `volumeOverlapQuery` | `test/performance/m4/proper-crossing-budget-calibration.mjs:223` | §9.4 (Phase B′ seam) |
| F16 | `collision/index.js` exports only `CollisionWorld`, the error classes and `ExtractionLimitExceededError`, and states in its own header that consumers "import from here, never from the individual implementation modules". The only non-test importers of `VolumeOverlapQuery.js` are `CollisionWorld.js` and `ClearanceHardClashPrecheck.js` | `collision/index.js:1-15`; import scan | §9.6 |
| F17 | `ThreeMeshBvhBackend.build()` returns `{ bvh, localDiagonal, aspectRatio, aspectRatioExceeded, geometry }`, computing `localDiagonal` from the already-welded buffers — the natural, once-per-geometry-per-epoch hook for a cached content digest | `blas/ThreeMeshBvhBackend.js:64,82` | §4.3 C-1 rank 5 |

---

## 2. Decision 1 — separate identity ordering from geometric operand ordering

### 2.1 Every purpose `comparePlacedCanonically` currently serves

| # | Call site | Purpose class | Does a flipped sign change anything geometric? |
|---|---|---|---|
| C1 | `CollisionWorld.js:2273` — `_runNarrowPhasePair`, `mode:'volume-overlap'`; the sign becomes `options.compareCanonical` | **Geometric operand orientation** | **Yes — everything.** `L_canonical`, the probe ladder, the coplanarity epsilon, which solid is classified first, the direction of the relative matrix, candidate enumeration order (hence the 50,000 cap), and which crossing probe is accepted first (hence the witness) |
| C2 | `CollisionWorld.js:2409` — `_runClearanceNarrowPhasePair`, the Hard-Clash exclusion precheck | **Geometric operand orientation** | **Yes**, identically to C1 — and this site reaches `clearanceHardClashExclusions`, `clearanceDistanceQueriesRun` and the public clearance pair set |
| C3 | `CollisionWorld.js:244-245` — final tie-break inside `compareWitnessCandidates` | **Deterministic aggregation / tie-breaking only** | No geometry. Selects which fragment pair's already-computed **witness payload** is published, and which pair a `witness-unavailable` diagnostic blames |
| C4 | `CollisionWorld.js:259-260` — final tie-break inside `compareClearanceCandidates` | **Deterministic aggregation / tie-breaking only** | No geometry. Selects which equal-distance fragment pair supplies the published `distance` and witness payload |
| R1 | M4 implementation plan `:11007-11018` — `compareIdentityCanonically`, a planned **structural replica** for the S7′ precheck spike. `spike/m4/s7-precheck/` **does not exist yet** | Replica of C2 | Would inherit C2's defect verbatim |
| R2 | `test/CollisionWorld.findClashes.test.mjs:1102-1160` | Test of C3 | No |

Adjacent, part of the same identity audit but **not** the comparator: `geometryIndex` is the
`GeometryRegistry` cache key (`CollisionWorld.js:317-318`), the key of
`_representativeFragmentByGeometry` (`:574`), and a field of the `precheck-candidate-list` spike
capture (`:1752-1756`) — **cache/index ordering** and **diagnostics/provenance**. Both legitimate;
see Decision 4.

### 2.2 The ruling

The comparator is **overloaded across two semantically different responsibilities** (C1/C2 vs.
C3/C4), and the design does not prove that safe — F5/F6 prove the opposite.

**Adopted (the prompt's preferred direction):**

1. **The geometric half is deleted, not re-keyed.** `options.compareCanonical` and
   `defaultCompareCanonical` are removed from `VolumeOverlapQuery.js`; orientation becomes an
   **internal, non-overridable function of the two `Instance` operands' own geometry and placement**
   (§4.3). No caller can inject an ordering into the geometric path again.
2. **A layer boundary is declared, not assumed** (§3.1): the kernel is directional, the wrapper is
   canonical.
3. **No identity enters `Instance`.** `orientForCrossing` reads `localDiagonal`, `geometry`, `matrix`
   and one new **content-derived** field (`geometryDigest`, §4.3 C-1). A content digest is *derived
   from geometry bytes*, not an identifier, so `toInstance`'s deliberate property — *"what is
   deliberately NOT here: any identity field"* (`CollisionWorld.js:385-387`) — is preserved and
   becomes load-bearing.
4. **The aggregation half survives**, renamed, and re-keyed to drop `geometryIndex` (Decision 5).

---

## 3. Decision 2 — the permutation-invariance requirement

### 3.1 The layer boundary, stated first because everything else depends on it

> **`properCrossingQuery(bvhA, bvhB, matrixBtoA, …)` is a DIRECTIONAL KERNEL.** It carries **no**
> swap-invariance contract. Exchanging its first and second operands is expected to change candidate
> enumeration, `aborted`, `pointClassifications`, the accepted witness, and float rounding. Tests may
> characterize that; nothing may depend on it.
>
> **`volumeOverlapQuery(source, target)` is the CANONICAL WRAPPER.** It carries the entire symmetry
> contract, and it discharges it by *always handing the kernel the same physical operand as `A`*,
> whichever way the caller labels the pair.

This resolves the contradiction an independent review correctly identified between a symmetry table
demanding invariant `aborted` and a limitation permitting direction-dependent exhaustion. With a
**total** geometric order (§4.3 C-1) the wrapper never runs the other direction, so `aborted` *is*
invariant at the wrapper — bit-for-bit, along with every other kernel output. Directional exhaustion
remains a property of the kernel, where it belongs.

### 3.2 The requirement, per predicate

| Predicate | Semantic result that MUST be invariant | Diagnostics / counters that MUST be invariant | Legitimately directional |
|---|---|---|---|
| `properCrossingQuery` (kernel) | **nothing — directional by contract** (§3.1) | — | all of it |
| `volumeOverlapQuery` (wrapper) | `overlap`, `conclusive`, `inconclusiveCauses` (as a set) | the `reason` multiset of `diagnostics` **up to the `role` relabelling** `source ↔ target`; **and every crossing-term output and counter, bit-identically**, because the same kernel call is made either way | `via`, `witness.kind` / `witness.point`, `containmentSamplesUsed`, `stats.aInB` / `stats.bInA`, every `role` label — all of which move because the *containment* terms are ordered by the public roles and early-exit |
| Hard-Clash precheck | `status` ∈ {`skip-precheck`, `excluded`, `proceed`, `inconclusive`} | presence of `clearance-hard-clash-precheck-inconclusive` | the diagnostic's fragment-provenance ordering |
| Containment composition | the **disjunction** `aInB.inside ∨ bInA.inside`; on a negative (both terms always run) `unresolvedComponentCount > 0` on either side | `inconclusive-containment`, `non-manifold-component`, `unverified-parity-operand` presence | which term proved it, its `role`, `samplesUsed` |
| `mode:'containment'` | **nothing — intentionally directional** (`CollisionWorld.js:2248`) | — | all of it |
| Clearance Hard-Clash exclusion | membership of `hardClashExcludedKeys` (`status === 'excluded'`) | `clearanceHardClashExclusions` | — |
| `clearanceQuery` distance | `distance`, `withinClearance` | `clearanceDistanceQueriesRun` | the anchor choice (`anchorIsSource`) and witness-pair ordering — already designed directional, out of scope |

**Adopted invariant (the prompt's, verbatim):**

> Swapping A/B may change source/target provenance presentation, but must not change the geometric
> truth value or completeness classification for a symmetric predicate.

**One declared residue.** With the content digest at rank 5, the wrapper's orientation is total
**up to a digest collision** between two geometrically distinct meshes that also share world
diagonal, triangle count, vertex count and world matrix. On such a collision the wrapper falls to
rank 6 (the public `source` role) and swap-invariance degrades to the kernel's directional behaviour.
This is L-3, its probability is stated there, and it is the *only* remaining swap-asymmetry in the
wrapper. Reload-invariance is unaffected by it, because the public role is caller-determined and
stable across loads.

> **Superseded note (final-review fix round, Minor #1):** "up to a digest collision between two
> geometrically distinct meshes" understates how often rank 6 is actually reached. Rank 6 is reached
> whenever a pair ties through rank 5 for **any** reason — including two byte-identical or co-located
> instances of the same catalogue part, a routine BIM condition, not only a hash-collision edge case
> between distinct meshes. The shipped documentation already states this correctly: see
> `collision/README.md`'s kernel/wrapper contract section ("includes byte-identical geometry, not only
> a digest collision between two distinct meshes") and CHANGELOG.md's residue entry ("including
> byte-identical geometry, not only a digest collision between"). Treat those two as the accurate
> statement of the residue; this paragraph is the historical, narrower framing.

---

## 4. Decision 3 — must `ProperCrossingQuery` itself become swap-invariant?

**No — and that is now an explicit architectural decision, not an omission.** The *kernel* stays
directional (§3.1); the *wrapper* becomes swap-invariant by always choosing the same kernel
direction. The alternatives are evaluated below against that framing.

### 4.0 The dead-rung theorem — derived in world units, for the supported transform class

This is the load-bearing argument. It is stated as a **necessary** condition only: it proves certain
ladder rungs *cannot* work; it does **not** claim any rung *will* work.

**Setup, in world units — because comparing local-frame quantities across two frames is invalid, as
`computeToleranceFloor` already states in this repository (F14).** For an operand `X` whose world
matrix lies in the supported class (rigid + positive uniform scale — `validateUniformScale`'s class,
F13), the linear part is `s_X · R_X` with `R_X` orthonormal, so **every column norm equals `s_X`
exactly**. Define the world-space diagonal

```
D_X  :=  L_X × s_X
```

the same quantity `computeToleranceFloor` computes. The A-local → B-local stretch is `s_A / s_B`.

`_mid` is the centre of the segment along which `triA` and `triB` intersect, so **`_mid` lies on both
solids' surfaces**. The probe is `_mid + _dir × delta` in A's frame; let `W := delta × s_A` be its
world displacement. Then:

```
dist(probe,   surface(A))  ≤  delta                      [A-local]  ⟺  ≤ W        [world]
dist(probeInB, surface(B)) ≤  (s_A/s_B) × delta          [B-local]  ⟺  ≤ W        [world]
```

`classifyPoint` returns `boundary` whenever that distance is `≤ 1e-6 × L_thatSide` in that side's own
frame (F8) — i.e. `≤ 1e-6 × D_thatSide` in world — **before any parity casting**. Therefore:

> **Dead-rung theorem.** A ladder rung whose world displacement is `W ≤ 1e-6 × max(D_A, D_B)` is
> *guaranteed* to classify `boundary` on at least one side, for every probe it generates. Such a rung
> can never produce a crossing and can only add `AMBIGUOUS` observations.

The ladder is applied in A's local frame with `delta = f × L_canonical = f × L_A`, so its world
displacement is `W = f × L_A × s_A = f × D_A` — the local-frame scaling converts to world
automatically. With the finest rung `f = 1e-5`:

```
every rung is live   ⟺   1e-5 × D_A  >  1e-6 × max(D_A, D_B)   ⟺   D_A > 0.1 × max(D_A, D_B)
```

- **`A` = the operand with the larger world diagonal `D`** satisfies it with a **10× margin on the
  finest rung**, 1000× on the coarsest.
- `A` = the smaller **fails whenever `D_max / D_min > 10`** — the finest rung is provably dead.
- A geometric mean fails past a ratio of 100.

**`max(D_A, D_B)` is therefore the minimal symmetric world-space scalar under which the declared
three-rung ladder has no provably dead rung**, and selecting it is equivalent to orienting the larger
operand first. Checked against both measurements the repository already holds (both fixtures use
rigid placements, so `D = L`):

| Pair | `D_max` | `D_min` | ratio | rungs with the small operand first | band `1e-6 × D_max` | provably dead rungs | measured outcome, small first | measured outcome, large first |
|---|---|---|---|---|---|---|---|---|
| Effect B class-B (F6) | 290.969 | 3.918 | 74:1 | {3.9e-3, 3.9e-4, 3.9e-5} | **2.9e-4** | rung 3 (3.9e-5 ≤ 2.9e-4); rung 2 is only **1.34×** the band | `inconclusive`, 147 classifications, precheck → `inconclusive` | **conclusive**, 198 classifications, precheck → `proceed` |
| `ductThroughBeamFixture` (F12) | ~3000 | ~4.243 | 707:1 | {4.2e-3, 4.2e-4, 4.2e-5} | **3.0e-3** | rungs 2 **and** 3; rung 1 is only **1.41×** the band | "every probe reports `boundary` … a clean `overlap: false`" — **a real crossing lost** | `overlap: true` via `'crossing'` |

The theorem predicts both observations exactly, including how many rungs are dead and why the
surviving rung still failed empirically.

**The thin-solid counter-argument, answered honestly.** A larger `delta` can in principle step
straight through a thin member; the repository already warns that a global AABB diagonal "cannot
detect a thin local feature embedded inside an otherwise roughly-cubic AABB" (`constants.js:36-37`).
Three things bound that, none of them an assumption:

1. Detection at world scale `W` requires `W < thickness` **and** `W > 1e-6 × D_max` (the theorem). A
   member thinner than `1e-5 × D_max` was therefore **never** detectable at any rung, whatever
   `L_canonical` was — the small-operand ladder only *appeared* to offer finer probes.
2. That threshold is exactly `minPenetrationDepthFactor × L_canonical`, the **already declared**
   detection limit (M1 design `:1696`). §9.6 states the compatibility consequence.
3. Empirically `crossing` flipped **0 / 106** under forced operand swap (F5), and the one
   extreme-ratio fixture the repository tracks is *fixed*, not broken, by the large-first orientation
   (F12).

**No tracked fixture yet proves this at extreme ratios.** Regression A.3 adds it.

**Anisotropic transforms — scope of the guarantee, stated explicitly.** When an operand's world
matrix is outside the supported class, `s_X` and therefore `D_X` are not well-defined and the
derivation above does **not** apply. The adopted policy (reviewer Question 2) is:

- **Anisotropic transforms remain accepted, not gated.** Introducing a rejection would change the
  input class `volume-overlap` accepts today and would be a contract change this fix has no mandate
  for. `clearance` already gates them per-operand (`CollisionWorld.js:2386-2388`).
- **The dead-rung guarantee is scoped to the supported class** and is not claimed outside it.
- **Orientation determinism — the property Effect B actually needs — holds regardless**, because the
  rank-1 key is a deterministic function of bit-stable data.
- The degradation is quantified in **L-1**: the rank-1 proxy is exact for the supported class and a
  lower bound on `σ_max` within `√3` otherwise, so misranking is possible only when true world
  extents lie within `√3` of each other, degrading the 10× margin to ≥ 5.8×. Under strong anisotropy
  no scalar rank can bound direction-specific compression (`σ_min`); that is M1's already-declared
  limitation (M1 design `:1702-1710`), unchanged by this fix and not made worse by it — today's
  identity orientation provides **no** guarantee under any transform class.

### 4.1 Strategy A — one directional call with a stable canonical ordering key

| Criterion | Assessment |
|---|---|
| Correctness | **Fails the design goal.** It leaves a geometric tolerance decided by an arbitrary identity order, and §4.0 + F12 show the wrong arbitrary winner silently loses a real crossing. "Any stable key" is not enough; the key would have to *happen* to pick the larger operand, which no identity key does |
| Reload stability | Achievable. A geometry content hash is bit-stable (F4). `(loadEpoch, fragmentId)` is stable **only under an identical model-admission order** — `loadEpoch` is compared first (`CollisionWorld.js:192`), so loading Structure before Architecture flips canonical order for every cross-model pair: the same defect class, merely rarer |
| Cost | Content hash: one pass per geometry at build. `(loadEpoch, fragmentId)`: free |
| Does it merely hide directional sensitivity? | **Yes, explicitly** — it converts a non-deterministic wrong answer into a deterministic wrong answer |

**Rejected.**

### 4.2 Strategy B — evaluate both directions and combine

| Criterion | Assessment |
|---|---|
| Semantic correctness | Sound in principle: `crossing` is a proof obligation, so `crossing_AB ∨ crossing_BA` is valid and strictly more complete |
| Completeness | Improves `crossing`; **degrades everything else.** The composition must choose *union-of-doubt* (more `inconclusive` → more prechecks returning `inconclusive` → **fewer published clearance hits**, since an `inconclusive` precheck drops the pair entirely, `CollisionWorld.js:2446-2453` + `:1791`) or *intersection-of-doubt* (weaker than today's worst orientation, unjustifiable without new evidence). §4.0 shows neither is necessary |
| Cost multiplier | A second `bvhcast` per pair. F10's worst traversal was candidate-pair-saturated, i.e. entirely in the tier a second traversal duplicates. **A ~2× planning estimate (~31 ms, past the 24.8 ms ceiling) is plausible but UNVERIFIED** — reverse-direction cost need not equal forward cost. Cost is a **secondary** reason for rejection; §4.0 is the primary one |
| Diagnostic/counter merging | Requires a new merge contract for four scalars that are currently single and attributable (`ProperCrossingQuery.js:126-131`) |
| Interaction with deterministic budgets | Forces the prompt's own question: per direction (silently **doubling** the search envelope) or across the composed query (**halving** each direction's envelope, truncating traversals the pre-fix code completed — which Phase C's governing principle forbids) |

A **ratio-gated** variant was also rejected: a tuned threshold with no evidence base that addresses
only the scalar-band argument, not candidate-cap directionality, coplanarity differences, matrix
rounding, or first-hit witness selection. **Rejected.**

### 4.3 Strategy C — a canonical wrapper over a directional kernel — **ADOPTED**

**C-1 — orientation becomes a deterministic geometric policy, and a *total* order.**

Replace the injected `compareCanonical` with an internal pure function over the two `Instance`
operands:

```
orientForCrossing(x, y) -> [first, second]
  rank by, in order:
    1. world-space diagonal, DESCENDING   -- localDiagonal × stretch(instance.matrix)
    2. triangle count,       DESCENDING   -- geometry.index.count
    3. vertex count,         DESCENDING   -- geometry.attributes.position.count
    4. the 16 world-matrix elements, lexicographic ASCENDING
    5. geometryDigest,       lexicographic ASCENDING   -- cached content digest (NEW, see below)
    6. the caller's public `source` role  -- reached only on a rank-5 digest collision (L-3)
```

`stretch(M)` is the **maximum column norm of `M`'s 3×3 linear part**. For the supported transform
class this is **exact**: a rigid + uniform-scale linear part is `s·R` with `R` orthonormal, so all
three column norms equal `s` precisely, and rank 1 is exactly `D_X = L_X × s_X`. Outside that class
it is a proxy whose bounded error is L-1. **`stretch` appears only in the ranking, never in a
tolerance** — once rank 1 has chosen the larger operand as `A`, `ProperCrossingQuery.js:114`'s
ladder reads `localDiagonalA` exactly as it does today, and §4.0 shows the local-frame scaling
converts to the correct world displacement automatically.

**Rank 5 — the cached geometry-content digest — is required, not optional.** Ranks 1–4 do not
discriminate two geometrically distinct meshes that happen to share bounding-box diagonal, triangle
count, vertex count and placement, and that is **not** a remote case in BIM: fragments of one element
routinely share a single placement, and box-like sub-meshes routinely share counts. Worse, **rank 4's
real discriminating power in this codebase is unmeasured** — if a model's fragment world matrices are
largely identical (geometry baked into local vertex positions, a common APS Viewer arrangement), rank
4 contributes nothing. The design must not rest on an unmeasured assumption, so rank 5 closes it:

- **Where it lives:** computed once per geometry per epoch in `ThreeMeshBvhBackend.build()` (F17),
  alongside `localDiagonal`, over the already-welded `position` and `index` buffers, and cached on the
  same record — amortized against welding and `new MeshBVH(...)`, both far more expensive.
- **Why it is legal here:** it is *derived from geometry content*, not an identifier, so §2.2 item 3
  holds. It is reload-stable by F4 (welded bytes 0/543 differ) and deterministic across arms.
- **Width:** a 128-bit digest. On a collision the two operands fall to rank 6 and the wrapper degrades
  to the kernel's directional behaviour — bounded, declared (L-3), and reload-invariant regardless.
- **Bytewise comparison on digest collision is rejected** as over-engineering: it would add a full
  buffer comparison to a per-pair hot path to remove a residue already below every other error term
  in the system.

**C-2 — the coplanarity epsilon is TIGHTENED to a symmetric minimum.**

`surfaceEpsilon` (`ProperCrossingQuery.js:115,180`) is a *different* tolerance from the probe ladder,
and this design now treats it separately — reversing an earlier draft that coupled it to
`L_canonical`.

```
surfaceEpsilon = surfaceEpsilonFactor × min( localDiagonalA, localDiagonalB × stretch(matrixBtoA) )
```

computed once per traversal (`matrixBtoA` is already a kernel parameter).

**Why `min`, and why this is the only safe choice for this fix.** The coplanar branch *discards* a
candidate pair without probing it (`:182-188`). Enlarging its epsilon therefore removes geometry from
the search. An earlier draft argued the discard was bounded because
`surfaceEpsilonFactor (1e-6) < minPenetrationDepthFactor (1e-5)`; **that argument is wrong and is
withdrawn.** The test is an approximate parallel-normal check (`|nA·nB| ≥ 1 − 1e-6`, i.e. up to
`√(2e-6) ≈ 1.41e-3 rad ≈ 0.081°` of divergence) combined with the offset of **one vertex**
(`_nA·_triA.a − _nA·_triB.a`). Over a triangle of extent `E` the two planes can diverge by
`E × 1.41e-3` — for a long triangle with `E ≈ D_max`, that is `1.4e-3 × D_max`, **140× the declared
`1e-5 × D_max` detection limit**. So a pair can pass the angle test, have one vertex within the
epsilon, and still form a genuine, deeper-than-declared crossing at its far end.

`min` makes the change **monotone in the safe direction**: in world units the new epsilon is
`1e-6 × min(D_A, D_B)`, which is `≤` *both* of the two values the pre-fix code could produce
(`1e-6 × D_A` or `1e-6 × D_B`). **The coplanarity change can therefore only increase completeness,
never decrease it** — it cannot discard any pair the pre-fix code would have probed, under either
orientation. It is also symmetric, so it introduces no new directional dependence.

The underlying structural weakness — a single-vertex offset test with a finite angle tolerance — is
**pre-existing, is now documented (L-8), and is deliberately not fixed here**. Bounding all three
vertices (or using robust triangle-plane distances) is the right repair and is recorded as a
separately-scoped follow-up; it belongs to the tolerance model, not to the identity defect, and it
would add arithmetic to the 50,000-iteration tier-B loop.

**C-3 — `comparePlacedCanonically` leaves the geometric path.**

`options.compareCanonical` and `defaultCompareCanonical` are deleted; `CollisionWorld.js:2273` and
`:2409` stop computing `canonicalOrder`. `volumeOverlapQuery` still needs to know which operand became
`canonicalFirst` to map the crossing witness into world space (`VolumeOverlapQuery.js:176-181`); it
now obtains that from `orientForCrossing`'s own return value, preserving the witness-frame contract
exactly. To avoid a silent behaviour change for any in-repo caller that still passes the option,
`volumeOverlapQuery` **throws on an unrecognised `compareCanonical` option** rather than ignoring it
(§9.6).

**C-4 — orientation provenance becomes observable.**

Effect B took a full investigation partly because operand orientation left no trace. The replacement
is a multi-rank policy, so it records itself. On the **existing, recorder-gated** `hard-clash-precheck`
`stage:'crossing'` event (`VolumeOverlapQuery.js:132-157`), add — constructed only when
`diagnosticPairContext` is present, exactly like every other field there:

```
orientedFirstRole : 'source' | 'target'
orientationRank   : 1 | 2 | 3 | 4 | 5 | 6     -- which rank decided
sourceWorldDiagonal, targetWorldDiagonal      -- the two rank-1 proxies
```

This is telemetry on an opt-in event, not a public result field and not a §6.4-compared field, so it
changes no contract and costs nothing in production. It is what makes a future orientation-driven
verdict change diagnosable from a gate artifact instead of from a fresh replay harness.

**What is deliberately NOT in this fix.** An earlier draft also proposed replacing the kernel's
per-probe rule so that `(boundary, outside)` stops counting as ambiguous. **That change is removed
from scope**, for a decisive reason: once C-1 fixes the orientation, the wrapper is already
swap-invariant *and* reload-invariant without it — the same physical operand is always `A`, so the
per-probe rule's own asymmetry is never exercised. The change is therefore **separable**, and it is a
semantic change to ambiguity reporting in safety-relevant software, which deserves its own
justification, its own fixtures and its own compatibility pass rather than riding an identity fix.
The motivation is recorded for that follow-up: today's rule is an asymmetric *mis-aggregation* of a
three-valued conjunction (`unknown ∧ false` is `false`, not `unknown` — and per F8 an `outside`
classification carries a ≥ `1e-6 × L` separation margin by construction, so it is a definite, not a
provisional, `false`), and at product level a surplus `inconclusive` *suppresses* a clearance result
rather than protecting against one. Neither point is acted on here. **Decision: deferred, tracked as
follow-up FU-1.**

### 4.4 Strategy D — narrowly justified alternatives, and why they are rejected

**D-1 — pass an explicit `ladderScale` from the caller.** Rejected: it re-opens the "a caller decides
a tolerance" hole C-3 exists to close.

**D-2 — a symmetric *union* of both operands' ladders in one traversal.** The strongest alternative,
recommended by the design-time consult (§13). Rejected on §4.0's own arithmetic:

- The *raw* union adds exactly the rungs the dead-rung theorem proves can only yield `boundary`.
  Checked on the pinned class-B pair: the added `3.9e-4` rung sits at **1.34×** the band and is
  empirically a boundary probe, so the raw union would **return the pinned pair to `inconclusive`** —
  undoing the fix on the one pair the whole investigation pinned.
- A *filtered* union keeping only rungs clearing the band by the design's own 10× factor keeps only
  rungs `> 1e-5 × D_max` — and `1e-5 × D_max` **is** the large-first ladder's finest rung. On the
  class-B pair the filter admits one extra rung (`3.9e-3`) already bracketed by two existing rungs.
  **With a principled filter the union degenerates to the large-first ladder**, at the cost of
  doubling the tier-C structural cap from 1536 to 3072.

**Rejected**, with the arithmetic shown rather than asserted.

### 4.5 Chosen, and why

**Strategy C.** It is the only option that removes identity from the tolerance, does not duplicate
traversal work, keeps every deterministic cap numerically unchanged, cannot widen any tolerance, and
is supported by two independent measurements already in the repository (F6, F12). It subsumes
Strategy A's cheapness — there *is* still a canonical orientation — but the key is the geometry itself
and the choice is justified by the dead-rung theorem, not by "some stable key". That distinction is
the whole of the prompt's *"do not mask asymmetry with an arbitrary stable ID order"*: nothing here is
arbitrary, and nothing here is an ID.

---

## 5. Decision 4 — legal key material, if any canonical identity tie-break remains

After Decision 3 the geometric path uses **no identity at all**. One identity tie-break remains, at
dbId-level aggregation only.

| Candidate | Reload-stable? | Stable across model replacement? | Unique enough? | Deterministic across arms? | Cheap? | Class | Verdict |
|---|---|---|---|---|---|---|---|
| `geometryIndex` | **NO — 490/543 permuted (F3)** | No | Per epoch, yes | Yes within a load | Free | Today: correctness-bearing | **FORBIDDEN as a correctness-bearing tie-break.** Permitted as a *runtime cache/lookup key* — a cache needs only within-process stability |
| `fragmentId` | **Yes — direct empirical evidence for this fixture over 14 loads** (§9.2); **not** a Viewer contractual guarantee | **No** (a re-authored version re-enumerates fragments) | Yes within an epoch (`CollisionWorld.js:177`) | Yes | Free | Permitted only as a last-resort aggregation tie-break | **PERMITTED, narrowly** (Decision 5), scoped to same-model reloads (§6.6), with §5.1's fallback named |
| `dbId` | **Yes — measured**: 1197/1197 public pair signatures and 30/30 clearance pairs identical across 17 sessions (research doc §4.3) | Not guaranteed | Not unique at fragment level — it *is* the aggregation key | Yes | Free | Already the public result identity | **PERMITTED** as the key; **useless** as a tie-break inside it |
| `loadEpoch` | No — a runtime counter, identical across loads only if admission order is | No | Yes within a process | Yes | Free | Correctness-bearing today | **FORBIDDEN as durable identity.** Retained only where **provably non-discriminating** (§6.3) |
| model object identity | Process-local reference | No | Yes | Yes | Free | — | **FORBIDDEN** — not orderable, not serializable, meaningless across a reload or worker boundary |
| `modelId` | Unknown | No | **No** — documented reused-under-collision-prone; §6.4 uses `modelTag`; `CollisionWorld.js:541-542` records it diagnostic-only | n/a | Free | Diagnostic-only | **FORBIDDEN as correctness-bearing** — a pre-existing ruling |
| **geometry content digest** | **Yes** — welded bytes 0/543 (F4) | **Yes** — it is content | Collides by design for two instances of one geometry; cryptographically negligible collision between distinct geometries | Yes | One pass per geometry per epoch at BLAS build (F17) | Correctness-bearing | **PERMITTED and ADOPTED** — `orientForCrossing` rank 5 (§4.3 C-1). It is *derived data*, not an identifier |
| world matrix values | **Yes** — 0/543 (F4) | No | Two coincident instances share one matrix; **discriminating power in this codebase is unmeasured** | Yes | Free | Used by the fix | **PERMITTED and ADOPTED** — rank 4, but the design does **not** depend on it (rank 5 carries the totality) |
| local geometry bounds / `localDiagonal` | **Yes** — derived from bit-identical welded bytes (F4) | Yes | Ties are common | Yes | Free (`ThreeMeshBvhBackend.js:64`) | Used by the fix | **PERMITTED and ADOPTED** — rank 1 |
| triangle / vertex count | **Yes** — same basis | Yes | Ties are common | Yes | Free | Used by the fix | **PERMITTED and ADOPTED** — ranks 2–3 |
| representative fragment selection | **No** — explicitly first-discovery-wins, with a documented mis-attribution caveat (`CollisionWorld.js:329-337`) | No | No | Not guaranteed | Free | Diagnostic-only | **FORBIDDEN as correctness-bearing** |

### 5.1 If no existing runtime identifier is safe

For the **geometric** path: **none is needed, and none is used** — the total order is built entirely
from geometry and placement. That is the core of this design.

For the **aggregation** tie-break, `fragmentId` is safe enough for the narrow role Decision 5 gives
it, on §9.2's evidence, which is empirical for one fixture and one Viewer build and **not a
guarantee**. The **named fallback, specified now so it cannot block implementation**, is a fully
geometric tie-break inserted *before* the identity term: compare the candidate's own witness point
coordinates lexicographically (bit-stable by F4), then the source and target world-matrix elements,
then the two `geometryDigest`s — which rank 5 now makes available — and only then `fragmentId`.

---

## 6. Decision 5 — deterministic aggregation tie-break

### 6.1 What aggregation needs

`compareWitnessCandidates` (C3) and `compareClearanceCandidates` (C4) reduce several *fragment-pair*
candidates onto one *dbId-level* key, so that "the winner never depends on which fragment pair the
broad phase happened to visit first" (`CollisionWorld.js:216-217`, `:254-255`).

| Requirement | Status after the fix |
|---|---|
| Stable **within** the call | A total order gives a unique min-reduction regardless of arrival order — preserved |
| Reproducible across **TLAS / linear** arms | Yes: both arms produce the same candidate *set* in different orders |
| Independent of traversal order | Yes, same reason |
| Must **not** alter geometric truth | Structurally guaranteed after Decision 1 — the comparator is unreachable from any geometric path |
| Byte-for-byte identical **across reloads of the same model** | **Required, and achieved** — §6.3, scope in §6.6 |

### 6.2 The re-keyed comparator

```
compareAggregationIdentity(a, b)      // renamed from comparePlacedCanonically
  1. loadEpoch    ascending    -- retained for TOTALITY only; provably non-discriminating here (§6.3)
  2. fragmentId   ascending
  (geometryIndex is REMOVED)
```

`compareWitnessCandidates` and `compareClearanceCandidates` keep their structure verbatim, with the
call swapped at `CollisionWorld.js:244-245` and `:259-260`. Dropping a middle term from a
lexicographic order preserves reflexivity, antisymmetry and transitivity, so both remain total orders.

### 6.3 Why this is reload-stable, and why `loadEpoch` is harmless here

Both comparators are only ever consulted **between two candidates competing for the same aggregation
key**, and that key is
`` `${sourceOperand.epoch}:${sourcePlaced.ownerDbId}:${targetOperand.epoch}:${targetPlaced.ownerDbId}` ``
(`CollisionWorld.js:1786` clearance, `:1876` three-mode). Every candidate under one key therefore
shares **both** epochs by construction, so **`loadEpoch` can never discriminate inside a tie-break**.
The effective key is `fragmentId` alone. `loadEpoch`'s prohibited property (session-specific,
admission-order-dependent) is not merely tolerated here — it is **unreachable**.

### 6.4 What this actually changes, stated accurately

Dropping `geometryIndex` is **not** provenance-only. The surviving candidate carries its own
**witness payload**, so the published `witness.point` for a dbId key — a §6.4-compared field — can
change, as can the fragment pair behind a published `distance` and the pair a `witness-unavailable`
diagnostic blames. What it **cannot** change is any truth value: the winner is already equal to its
rivals on `distance` (clearance) and on witness presence and kind (volume-overlap). Research doc §6.8
recorded exactly this exposure as structurally reachable but never observed; this design closes it on
the structural argument and asserts it directly in regression F.

### 6.5 Same-run parity vs. cross-reload reproducibility

- **§6.4 of the M4 design requires only same-run arm parity** for aggregation. Today's comparator
  already satisfies §6.4 and always did.
- **M4's canonical matrix additionally requires cross-reload reproducibility**, because the gate
  launches a separate browser per runtime tier (`run-gate-m4.mjs:2934`) and can `page.reload()`
  mid-run on the `attributionPoisoned` recovery path (`:3144`) — both re-assign every geometry id.
  **That is the requirement today's comparator fails**, and the one the re-keying satisfies.

### 6.6 Scope of the reproducibility claim (reviewer Question 4)

**Identical model reloads only.** A model *replacement* admits a new epoch with freshly extracted
`CollisionInstance`s, and a re-authored model version may renumber fragments *and* move dbIds, so two
results taken across a replacement are not comparable outcomes of the same query in the first place.
M4's reproducibility requirement is over repeated loads of the *same* fixture, and that is the scope
this design claims and tests (regression E). Model replacement is explicitly **out of scope** and is
declared in L-4.

---

## 7. Decision 6 — diagnostics and statistics semantics

Nothing is deleted from the comparator, from `statistics.diagnostics`, or from any diagnostic event.
The fix changes *what decides* a diagnostic, never *whether it is emitted* — and C-4 **adds**
orientation provenance so the next such investigation starts with evidence.

| Surface | Effect of the fix | Required property afterwards |
|---|---|---|
| `inconclusive-crossing` | Becomes a deterministic function of the operands' geometry and placement. Two sources of change: orientation is now large-first (§4.0), and the coplanarity epsilon is **tightened** (§4.3 C-2), which lets *more* candidate pairs into the probe ladder. The net direction is **not predicted here** — it is measured by regressions D/E | Identical multiset across reloads; identical across TLAS/linear arms |
| `crossing-budget-exhausted` | Semantically untouched. Its *attribution* can shift for a pair whose orientation changes, since `candidatePairsExamined` is direction-dependent; and the tightened epsilon admits more pairs to tier-B work | Identical across reloads and arms; still the only `aborted` cause |
| `crossing-tolerance-ambiguous` | Moves with `inconclusive-crossing` (`VolumeOverlapQuery.js:359`) | As above |
| `inconclusiveCauses` | Every member is computed symmetrically from both operands (`:357-366`); after the fix the crossing members are deterministic | Swap-invariant **and** reload-invariant, as a sorted set |
| `clearanceDistanceQueriesRun` | Stops oscillating 129 ↔ 130 (F6) | Bit-stable across reloads; §6.4-compared, compared unchanged |
| `clearanceHardClashExclusions` | Contributed to only by `overlap === true`, which flipped 0/106 (F5) — expected unchanged, but **must be verified, not assumed**: research doc §7 is explicit that the mechanism can move it | Bit-stable across reloads and arms |
| `clearanceOverlapPrechecksRun` | Unchanged | Bit-stable |
| Crossing counters | `candidatePairsExamined` and `crossingPairsExamined` change for pairs whose orientation changed and for pairs the tightened epsilon newly admits; `pointClassifications` follows. All become reload-stable and **swap-invariant at the wrapper** (the same kernel call is made either way) | Reload-stable, arm-stable, and wrapper-swap-invariant |
| Witnesses | The crossing witness is directional *in the kernel* but fixed at the wrapper. The *published* witness for a dbId key becomes reload-stable via Decision 5, and its value may change from today's (§6.4) | Reload-stable. §6.4's existing `1e-9 × worldDiagonal` tolerance unchanged and **not** widened |
| Orientation provenance (**new**) | `orientedFirstRole`, `orientationRank`, and the two world-diagonal proxies on the recorder-gated `hard-clash-precheck` `stage:'crossing'` event | Present whenever a recorder is installed; absent and zero-cost otherwise; never a §6.4-compared field |
| Final pair selection | Expected unchanged on the measured fixture (research doc §4.3), but a crossing verdict *can* move | Verified by regressions D, E, G — not assumed |

**The three guarantees the prompt requires, as acceptance criteria:**

1. **A reload cannot change a correctness-bearing counter by permuting operand identity** — no
   correctness-bearing decision reads any identity afterwards. Structural, testable without a Viewer
   (regression A).
2. **TLAS and linear agree under §6.4** — re-verified at S2 `k=100:typical:clearance` (regression D).
3. **The same geometry replayed after reload produces equivalent semantic evidence** (regression E).

**§6.4 is neither relaxed nor widened.** The `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` carve-out was
written for a wall-clock-gated `crossing-budget-exhausted` that Phase C already deleted, and Effect B
is the other reason those diagnostics moved. After both land it should have nothing left to excuse.
**Narrowing or retiring it requires its own evidence and is deliberately out of scope**; leaving it is
strictly conservative, and removing it on this design's say-so would be a §6.4 edit, which is
forbidden.

---

## 8. Detailed design work — 1. The `comparePlacedCanonically` call graph

| Site | Order affects only output ordering? | Order affects which geometry is anchor/source/target? | Order affects epsilon, scale, probe ladder, containment direction, or pruning? | Order affects dbId winner selection? | Disposition |
|---|---|---|---|---|---|
| **C1** `_runNarrowPhasePair` → `volumeOverlapQuery` | No | **Yes** — decides `canonicalFirst`, hence `bvhA`, hence the frame the probes and the witness live in | **Yes, all of them**: `surfaceEpsilon`; the ladder; which solid is classified first; `matrixBtoA` vs. its inverse; candidate enumeration order (hence the 50,000 abort); which crossing probe is accepted first. It does **not** affect the containment terms' direction, which follow the public roles (`VolumeOverlapQuery.js:202-269`), nor broad-phase pruning | Indirectly — only by changing whether the pair is a `hit` | **Removed** (C-3) |
| **C2** `_runClearanceNarrowPhasePair` → `classifyHardClashPrecheck` → `volumeOverlapQuery` | No | **Yes**, as C1 | **Yes**, as C1 — the site F6 measures moving a precheck between `proceed` and `inconclusive` | Indirectly — an `excluded` verdict removes the whole dbId key (`:1809-1811`) | **Removed** (C-3) |
| **C3** `compareWitnessCandidates` | **Yes, only** | No | No | **Yes** — which fragment pair's `witness` **payload** is published | **Retained, re-keyed** (Decision 5) |
| **C4** `compareClearanceCandidates` | **Yes, only** — after `distance` | No | No | **Yes** — which equal-distance pair supplies the published `distance` and witness | **Retained, re-keyed** (Decision 5) |
| **R1** planned S7′ spike replica | — | inherits C2 | inherits C2 | No | **Plan edit required.** The M4 plan's Task 4.5 text (`:11007-11018`) and its "Critical #3" note (`:10530-10545`) must be rewritten — the replica's entire justification was fidelity to production's `compareCanonical`. No code exists yet, so this is documentation only |
| **R2** `findClashes` tie-break tests | Yes | No | No | Yes | **Expected to keep passing** — they assert order-independence of the winner, not a specific key |

**What the call graph forces:** exactly two of four live sites are geometric, and they are the only
two that can reach a §6.4-compared field through a tolerance. Both are removable without touching the
other two. That is what makes Decision 1's separation a *deletion* rather than a *refactor*.

---

## 9. Detailed design work — 2 through 6

### 9.2 Identifier stability — the evidence, and what is pending

All measurement needed already exists, from the 14 sessions in which the Viewer's geometry ids were
captured. A live re-measurement was deliberately **not** run for this design.

| Field | Stable / total | Collisions | Geometry bytes identical? | Source |
|---|---|---|---|---|
| `geometryIndex` | **53 / 543 stable — 490 changed** | n/a | **Yes** — 0/543 differ | research doc §6.4 |
| stored `worldMatrix` bytes, **keyed by `fragmentId`** | **543 / 543** | n/a | Yes | research doc §6.4 |
| welded `position` + `index` bytes, **keyed by `fragmentId`** | **543 / 543** | n/a | Yes | research doc §6.4 |
| FNV digest over **every** fragment world matrix, all 3 models | identical (`3913657232`) every session | n/a | Yes | research doc §6.4 |
| `dbId` (at result level) | **1197 / 1197** public pair signatures; **30 / 30** clearance pairs including distances | n/a | Yes | research doc §4.3 |
| `fragmentId` | **Direct empirical evidence for this fixture across 14 loads** | — | Yes | research doc §6.4 |

**The `fragmentId` claim, scoped precisely.** Every per-fragment fingerprint above is *keyed by
`fragmentId`*, and every one matched across sessions; the FNV digest is taken over the whole
fragment-matrix sequence, so an identical digest means the `fragmentId → worldMatrix` **sequence** is
identical load to load. That is direct evidence that `fragmentId → (geometry, placement)` was stable
across those 14 loads. It is **not** evidence of a Viewer contractual guarantee, and no repository
evidence establishes one. Supporting structure: `fragId2dbId` is a dense array populated in model
order (`m2-extractAllFragments-viewer-evidence.md:83,164-166`), `fragList.getCount()` read a constant
`789` for Architecture, and a whole-model cross-check agreed 789/789 between the forward tree walk
and the reverse lookup (`:109-110`).

**Two measurements are pending, both non-blocking.** (1) A *direct* per-`fragmentId` assertion across
two loads, folded into regression E. (2) The **discriminating power of rank 4** — how many fragment
pairs in the fixture share a world matrix, and whether world matrices are largely identity — folded
into regression E as a one-line harness count. Neither blocks implementation: the geometric path no
longer reads `fragmentId`, rank 5's digest carries the order's totality independently of rank 4's
power, and §5.1 names the aggregation fallback in advance.

### 9.3 Semantic truth tables for operand permutation

#### 9.3.1 Proper crossing — per probe (**unchanged by this fix**)

The kernel's existing rule is retained verbatim: classify against `bvhA`; on `boundary` set
`sawBoundaryProbe` and continue; on anything but `inside` continue; otherwise classify against
`bvhB`; on `boundary` set `sawBoundaryProbe` and continue; on `inside` record the crossing and exit
(`ProperCrossingQuery.js:235-252`). It is asymmetric in the two solids, and that is now **acceptable
by construction**, because the wrapper guarantees the same solid is always `bvhA` (§3.1). Making it
intrinsically symmetric is follow-up **FU-1** (§4.3), deliberately out of scope.

#### 9.3.2 Proper crossing — per traversal

| Condition | `crossing` | `aborted` | `inconclusive` | diagnostic |
|---|---|---|---|---|
| any probe classified `inside` against both solids | `true` | `false` | `false` | — |
| no crossing; a deterministic cap reached | `false` | `true` | `false` | `crossing-budget-exhausted` |
| no crossing; no cap; ≥ 1 `boundary` probe | `false` | `false` | **`true`** | `inconclusive-crossing` |
| no crossing; no cap; no `boundary` probe | `false` | `false` | `false` | — |
| operand geometry unsupported (`aspectRatioExceeded` on either **public** role) | `false` | `false` | `true` (synthetic `skipped`) | `geometry-aspect-ratio-exceeds-tolerance-model`, one per offending role |

`aborted` masking `crossing` is preserved unchanged (`ProperCrossingQuery.js:302`).

#### 9.3.3 The permutation contract

The prompt asks for a table over "A→B proves crossing / B→A proves crossing / only one / neither /
budget exhaustion / unsupported geometry". Under the adopted design the **wrapper never evaluates both
directions**, so the table states what the wrapper must produce for a *physical* pair, and what the
kernel is permitted to do under a forced swap.

| Hypothetical kernel A→B | Hypothetical kernel B→A | Required **wrapper** result | Status |
|---|---|---|---|
| crossing | crossing | `crossing: true` | Normal positive |
| crossing | not crossing | the wrapper returns whichever direction `orientForCrossing` selects — and that is **always the same direction for the same physical pair**, so the divergence is never observed through the wrapper | Kernel-level only; characterized, not contracted |
| ambiguous | clean negative | same | This row is exactly F5's 66/106 today, observed **through the wrapper** because orientation was identity-driven. After the fix it is unreachable through the wrapper |
| clean negative | clean negative | conclusive negative | Yes |
| budget exhausted | not exhausted | the selected direction's result, deterministically | Kernel-level only; **this is the row that made the old design self-contradictory**, and §3.1 resolves it |
| unsupported geometry | unsupported geometry | synthetic skipped result, `inconclusive: true` | Gated on the **public** roles, already symmetric |

**Wrapper-level contract, stated as the assertion regression B makes:** for every physical pair,
`volumeOverlapQuery(x, y)` and `volumeOverlapQuery(y, x)` produce **bit-identical crossing-term
output** — `crossing`, `aborted`, `inconclusive`, `diagnostics`, all three counters, `exhaustedBudget`
and the witness point — and identical `overlap`, `conclusive` and `inconclusiveCauses`. Only the
containment-term presentation fields differ.

#### 9.3.4 Containment

| `A in B` | `B in A` | `overlap` | `conclusive` | notes |
|---|---|---|---|---|
| `inside` | not run (early exit) | `true` | `true` | `via: 'containment(A in B)'` — directional presentation |
| `false` | `inside` | `true` | `true` | `via: 'containment(B in A)'` |
| `false` | `false` | `false` | crossing conclusive **∧** both `unresolvedComponentCount === 0` **∧** no non-manifold/unverified taint (`VolumeOverlapQuery.js:325-330`) | both terms ran, so every input is symmetric |
| inconclusive one direction (not aspect-gated) | — | `false` | `false` | cause `unresolved-containment` |
| inconclusive both directions | — | `false` | `false` | same cause, once (a `Set`) |

#### 9.3.5 Volume overlap — how directional sub-results compose

| Composed state | Definition | Exists? |
|---|---|---|
| **proven overlap** | any of the three terms positive → `overlap: true, conclusive: true` | Yes |
| **proven non-overlap** | `overlap: false` **and** `conclusive: true` — all three terms ran with no taint. This feeds precheck `proceed` | **Yes, and it is load-bearing** |
| **inconclusive** | `overlap: false`, `conclusive: false`, with the enumerated `inconclusiveCauses` | Yes |

All three are swap-invariant and reload-invariant after the fix.

#### 9.3.6 Hard-Clash precheck and the clearance exclusion

| Input | `status` | Contributes to `clearanceHardClashExclusions`? |
|---|---|---|
| `aabbMinDistance(sourceBounds, targetBounds) > 0` | `skip-precheck` | No |
| `overlap === true` | `excluded` | **Yes** |
| `overlap === false`, `conclusive === true` | `proceed` → `clearanceQuery` | No |
| `overlap === false`, `conclusive === false` | `inconclusive` + diagnostic; **the pair is dropped from the clearance result entirely** (`CollisionWorld.js:1791`) | No |

### 9.4 Performance, cost, and the calibration disposition

**Expected multiplier on crossing work: 1.00× traversals.** One `bvhcast` per pair, as today.

| Cost tier | Change | Bound |
|---|---|---|
| Tier B — candidate triangle pairs | Two effects, in **opposite** directions and both pair-specific: orientation changes which frame `bvhcast` traverses; and the **tightened** coplanarity epsilon lets *more* pairs through the coplanar gate into `intersectsTriangle` and, when they intersect, into the probe ladder | Unchanged cap `maxCandidatePairsExamined = 50_000` |
| Tier C — probe classifications | Rises where the tightened epsilon admits new crossing pairs; falls where large-first scaling removes `boundary` results (the 147 → 198 shift in F6 is this axis) | Per-probe maximum **2**, so **24 per crossing pair** (12 probe points × 2) and **1536 per traversal** — numerically unchanged |
| Early exit | A pair that now reaches the ladder and proves a crossing terminates `bvhcast` **earlier**; a pair that reaches it and fails costs a full ladder | — |
| Orientation computation | ≤ 18 multiplies plus a digest comparison per composed pair, replacing two field comparisons; plus one content-digest pass per geometry per epoch at BLAS build | Amortized; **must still be measured in aggregate, not declared negligible from operation counts** — Phase B′ scope item (e) |

**Impact on the deterministic 1536 cap: none.** It stays `maxCrossingPairsExamined × 24` and stays
non-binding by construction. **Per direction or across the composed query?** Moot — there is one
direction, so the cap is per traversal as today. That is one of the strongest arguments against
Strategy B.

**Does Phase B's `S_worst = 15.5 ms` calibration remain valid? — NO. A focused recalibration is
REQUIRED.**

An earlier draft argued that unchanged *caps* imply an unchanged *span envelope*. That argument does
not hold and is withdrawn. Caps bound **work counts**, not time, and four things break the inference:

1. **The caps were never the empirical envelope.** `pointClassifications` maxed at **1152 — 75 % of
   the cap** over 21,300 traversals, with **0** classification-cap exhaustions (F10).
2. **The tightened coplanarity epsilon admits more candidate pairs into `intersectsTriangle` and the
   probe ladder**, a direct and deliberate work increase.
3. **New probe locations have different costs** — `classifyPoint` is one `closestPointToPoint` plus up
   to three full `DoubleSide` raycasts, and large-first probes sit at different points in the BVH.
4. **Orientation changes candidate enumeration**, and the measured `S_worst` lives exactly at the
   50,001-candidate cap.

The measured 15.5 ms worst case also had **zero** classifications, so it says nothing about the
boundary-heavy path this fix changes most.

**Phase B′ — the required recalibration, defined explicitly.**

| Item | Specification |
|---|---|
| **When** | Against the exact **P3** commit (SHA recorded in the output), **after** regressions A and B are green and **before** regression D, regression G's gate re-baselining, and the Phase 3 canonical matrix |
| **Call seam — CORRECTED** | Phase B's harness calls the **kernel** directly over a fixed catalogue order (F15), so reusing it verbatim would measure the *old* direction and miss the changed workload entirely. Phase B′ **keeps the sampling protocol and the fixture catalogue but changes the call seam**: each catalogue pair is run through the production orientation policy (`orientForCrossing`, then the kernel with the selected direction), the **selected direction is recorded per record**, and both the kernel span and the end-to-end `volumeOverlapQuery` span are reported. Results are therefore **not byte-comparable with Phase B**, and that is stated in the output rather than hidden — they are representative of the implementation being authorized |
| **Protocol** | Otherwise reuse calibration doc §14.1–14.3 verbatim: both runtime tiers, `frameBudgetMs: Infinity` for measurement, **no new library instrumentation** beyond C-4's recorder-gated fields |
| **Scope — five case families** | (a) **boundary-heavy** pairs; (b) **real-model** pairs including the pinned Effect B pairs; (c) **candidate-saturation** cases (`H1-combs-1500`, the family that produced 15.5 ms); (d) **early-exit co-occurrence** cases, where a coplanarity change moves an early exit; (e) an **aggregate million-candidate** pass that includes the per-pair orientation and digest cost end to end |
| **Disposition rule** | Calibration doc §14.4's three branches, **reused verbatim and not relaxed**: `S_worst ≤ 8 ms` → CONFORMANT; `8 < S_worst ≤ 24.8 ms` → **CAUTION** (status quo); `S_worst > 24.8 ms` → **stop and escalate to the milestone owner** |
| **Where progression blocks** | Branch 3 halts M4 progression at the end of P3, changes this design's disposition to `BLOCKED_ON_RECALIBRATION`, and re-opens §4.3's ladder and epsilon choices with the measurement in hand |
| **Output** | Appended as a new section to `docs/research/proper-crossing-query-deterministic-budget-calibration.md`, so the two measurements sit side by side with the seam difference documented |

**The semantic cost counters.** `candidatePairsExamined > 50_000 ⇒ aborted ⇒ crossing forced false`
is the one place a cost counter is semantic. After the fix it is a deterministic function of geometry,
so it is reload-stable, arm-stable **and wrapper-swap-invariant** — the wrapper makes the same kernel
call either way. Direction-dependent exhaustion survives only *inside the kernel*, where §3.1 declares
it expected. On the measured fixture `crossing-budget-exhausted` was a constant **11** in all 17
sessions (research doc §4.1).

### 9.5 Interaction with the ProperCrossing deterministic-budget fix (Phase C)

**Current state, verified against the tree.** Phase A **and** Phase C **have already landed** as
commit `db64324`, full unit suite green (1078 passed). What remains open from that design is its own
M4 restart-sequence items 2–7 — i.e. Phase C's **validation**, not its code.

| Question | Answer |
|---|---|
| **Implementation order** | This fix lands **next**, before Phase C's focused validation is attempted |
| **Should Phase C land before or after this fix?** | Phase C's *code* is already in and stays in. Phase C's *validation* must come **after** this fix: Effect B currently forces every Phase C comparison to be confined to a single page load (research doc §7.2), because a cross-load comparison carries Effect B's ±36-entry swing on top of Phase C's own delta. Removing Effect B **removes that confound** and gains the ability to compare across loads at all |
| **Is the 1536 cap directional or combined?** | **Neither — per traversal, and there is one traversal.** Unchanged from Phase C |
| **How is deterministic exhaustion merged across directions?** | **No merge exists or is needed.** `exhaustedBudget` stays a single attributable scalar, preserving Phase C's invariant that "`aborted === true` if and only if `exhaustedBudget !== null`" |
| **Telemetry semantics** | `elapsedMs` / `timeBudgetExceeded` stay fault-isolated telemetry that annotates and never decides; the three deterministic counters continue to ride the opt-in `hard-clash-precheck` `stage:'crossing'` event. This fix **adds three recorder-gated orientation fields to that same event** (C-4) and nothing else — no new event, no new public field, no new export |
| **Regression ownership** | Phase C owns determinism *within* a page load (fixtures vary the **clock**). **This fix owns determinism *across* page loads and across operand permutation** (fixtures vary the **operand order and the load**). Disjoint by construction. Where they meet — S2 `k=100:typical:clearance` parity — this fix's regression D subsumes Phase C's item 3. **Phase B′ supersedes Phase B** for the crossing term's span envelope, with a documented seam change |

**Preferred outcome:** *no semantic result depends on wall-clock time or reload-unstable identity.*
Phase C removed the wall-clock half; this fix removes the reload-unstable-identity half. It does
**not** yet hold for `surface-intersection` and `containment` mode, which Phase C knowingly deferred
(L-6).

### 9.6 Scope and compatibility classification

**Two distinct classifications, because the review correctly showed one label was doing two jobs.**

**(a) Behavioural change to the library's geometric output: a correctness bug fix.** The repository
already *declares* the symmetric semantics this fix restores: `comparePlacedCanonically`'s own header
calls the asymmetry "a public verdict bug, not a tolerance nuance" (`CollisionWorld.js:170-173`); a
committed regression asserts swap-invariance with a measured fixture (F12); and M1's design states
the goal as "a deterministic function of the pair, not of argument order" (F11). What changes is the
**mechanism**: M1 chose identity ordering *explicitly over* deriving a symmetric scalar (F11), and
this design reverses that specific choice on evidence M1 could not have had (F3). No public shape,
field, mode, diagnostic `reason`, or exported symbol moves; `collision/index.js` is untouched (F16).

**(b) Removal of `options.compareCanonical`: an internal API migration, named as such.** It is an
option on an exported function of a module that is not re-exported from `collision/index.js`, whose
own header states consumers "import from here, never from the individual implementation modules"
(F16). The complete set of importers of `VolumeOverlapQuery.js` outside tests is **two files inside
`collision/`**. The migration is therefore closed and enumerable — but it will **not** be done
silently: `volumeOverlapQuery` **throws on a supplied `compareCanonical`** rather than ignoring it, so
any missed in-repo call site or deep-import consumer fails loudly at the first call instead of
silently losing control of orientation. The guard is removed once the repository has no references
left; until then it is the cheap insurance the review asked for.

| Area | Impact | Disposition |
|---|---|---|
| **M1 volume-overlap** | `L_canonical`'s *definition* moves to "the larger of the two operands' world diagonals". The declared `minPenetrationDepth = 1e-5 × L_canonical` keeps its **formula text** and becomes **well-defined and achievable per pair for the first time** (§4.0). The coplanarity epsilon is **tightened**, which can only add candidate pairs to the search. Borderline pairs change verdict **in the direction of finding crossings previously lost** | **Documentation update required** to M1's Tolerances table and its "Canonical operand order" paragraph, plus `CHANGELOG.md`. Fixtures re-baselined by regression G |
| **M2 / M2.1 Hard Clash** | Witness *kind* ranking and *frame* mapping untouched. `compareWitnessCandidates`'s tie-break is re-keyed, which **can change a published `witness.point`** (§6.4) | Re-baseline via regression G; the witness *contract* is unchanged |
| **M3 clearance precheck** | Directly affected — where F6 lives. Precheck dispositions become deterministic | Re-baseline via regressions C, D, G |
| **Deterministic dbId aggregation** | Strengthened: the tie-break becomes reload-stable, closing research doc §6.8 | Regression F |
| **Existing diagnostics** | No reason string added, removed, or renamed. Counts change; §6.4's rules do not. Three recorder-gated telemetry fields are added (C-4) | §7 |
| **Existing acceptance fixtures** | Must be re-run and every change **classified**, never silently accepted | Regression G |
| **`ThreeMeshBvhBackend` record shape** | Gains a cached `geometryDigest`; `toInstance` forwards it | Internal typedef change, enumerated in P2 |

**Tests that must change:**

| Test | Why | Disposition |
|---|---|---|
| `test/query/VolumeOverlapQuery.test.mjs:133` and `:429` | Both force the order via the deleted option | **Re-expressed** against `orientForCrossing` — the public role must still be the diagnostic role, and the witness-frame contract must still be asserted. Both fixtures use equal-diagonal boxes, so the orientation outcome is decided by ranks 2–5 and must be asserted explicitly |
| `test/query/ClearanceHardClashPrecheck.test.mjs:111` | Asserts threading of a deleted option | **Re-expressed** to assert `scheduler` threading only |
| `test/CollisionWorld.findClashes.dispatch.test.mjs:294` — the 707:1 swap-invariance test | Its comment attributes the fix to `geometryIndex` ordering | **Kept green, comment rewritten.** `orientForCrossing` orients the duct (L ≈ 3000) first, so `overlap: true` both ways is preserved — and the test becomes **stronger**, no longer depending on the fixture's `geometryIndex` assignment |
| `test/query/ProperCrossingQuery.*` pinned counter assertions (`=== 26`, `=== 5`, the `CAP` cases) | The kernel's only change is the coplanarity epsilon, and those fixtures are equal-diagonal boxes where `min == max` | **Expected unchanged.** Re-baseline **only if** they move, and then only with a recorded justification — never loosened to an inequality |
| `test/CollisionWorld.findClashes.test.mjs:1102-1160` tie-break tests | Assert winner order-independence, not a key | **Expected green unchanged** |

**Backward compatibility is explicitly not preserved where it would preserve the defect.** A consumer
who today gets `overlap: false` on a 707:1 pair because the small operand won an arbitrary identity
comparison will now get `overlap: true`. That is the fix, and it goes in the CHANGELOG.

---

## 10. Required implementation phases (high level)

| Phase | Content | Gate |
|---|---|---|
| **P1 — separation (behaviour-preserving)** | Rename `comparePlacedCanonically` → `compareAggregationIdentity`, drop the `geometryIndex` term, repoint C3/C4 | Full unit suite green; tie-break tests unchanged |
| **P2 — content digest + orientation** | Add the cached `geometryDigest` in `ThreeMeshBvhBackend.build`, forward it through `toInstance`; add `orientForCrossing`; delete `compareCanonical` and add the fail-loud guard; remove `canonicalOrder` from `CollisionWorld.js:2273`/`:2409`; add C-4's telemetry fields; re-express three tests | Regressions A, B RED→GREEN; `ductThroughBeamFixture` green without `geometryIndex` |
| **P3 — coplanarity epsilon** | Tighten to the symmetric `min` inside the kernel | Regression A.4; kernel pinned counters verified |
| **Phase B′ — recalibration** | §9.4's five case families, **corrected call seam**, against the P3 commit | **Blocking** on §14.4 branch 3 |
| **P4 — documentation** | M1 Tolerances + "Canonical operand order", `collision/README.md`, `CHANGELOG.md`, the M4 plan's Task 4.5 replica text (R1) | — |
| **P5 — validation** | Regressions C–G, in §11's order | The M4 restart sequence |

No code is written before an implementation plan exists; this document authorizes planning, not
implementation.

---

## 11. Required regression design

**A. Reload stability — deterministic, no Viewer.**
Two fixed operands with sharply different `localDiagonal`s (74:1 and 707:1), held constant, driven
through **`volumeOverlapQuery`** twice with the operand orders exchanged — the in-process stand-in for
a reload-induced permutation, and the durable test the research doc asked for (§10.1, limitation 8).
Assert equality of `overlap`, `conclusive`, `inconclusiveCauses`, and the diagnostic `reason`
multiset. RED today.

> **A.2** — the same, with world matrices scaled so the **world**-diagonal ranking disagrees with the
> **local**-diagonal ranking, pinning rank 1 as a world-space key. This is the test that would have
> caught the `σ = 1` error (§14 Finding 4).
> **A.3** — a **thin-solid** fixture: a thin plate crossing a very large member at a diagonal ratio in
> the 1e3–1e5 range, asserting the crossing is still found under the large-first ladder. This is the
> fixture that would falsify §4.0's detection-limit argument; none exists today.
> **A.4** — **near-parallel thin-overlap** fixtures at extreme ratios, asserting that no crossing
> detectable under either pre-fix orientation is lost under the tightened epsilon. Because the
> epsilon is monotonically tightened (§4.3 C-2), this must pass by construction; the test exists to
> prove the monotonicity claim rather than to explore it.
> **A.5** — a **rank-5 fixture**: two geometrically distinct meshes sharing diagonal, triangle count,
> vertex count and world matrix, asserting the digest decides and that swapping them is
> bit-identical. Without rank 5 this test is RED.

**B. Operand-swap invariance — at the wrapper, over the 106-pair replay set.**
Rebuild the research doc's §6.5a harness (single page load; operands from
`world._registry.getOrBuildGeometry` + `world._placementByEpoch`), but drive each pair through
**`volumeOverlapQuery` in both public-role orders**, and require the full wrapper contract of §9.3.3 —
`crossing`, `aborted`, `inconclusive`, `diagnostics`, all three counters, `exhaustedBudget` and the
witness point **bit-identical**, plus identical `overlap` / `conclusive` / `inconclusiveCauses`. This
is a strictly stronger assertion than the earlier draft's, and it is possible only because the wrapper
now makes the same kernel call either way. Pre-fix baseline: **66/106 flips on `inconclusive`** (F5).
A separate **kernel-level** replay (forced A/B swap on `properCrossingQuery`) is retained as a
**characterization** test documenting that the kernel *is* directional — never as a contract.
**Retention requirement:** per-session JSON under `test/performance/results/`, closing research doc

> **Superseded note (final-review fix round, Important #3):** this paragraph's requirement that the
> **witness point** be asserted **bit-identical** directly contradicts §3.2's own predicate table,
> which lists `witness.kind` / `witness.point` under "Legitimately directional" for `volumeOverlapQuery`
> — those two statements cannot both hold. Task A4.2's implementation resolved this in favor of §3.2:
> the shipped assertion set (`test/performance/m4/operand-swap-replay.mjs`) is role-normalized
> diagnostic-*reason* multiset equality, plus `overlap` / `conclusive` / `inconclusiveCauses` and every
> crossing-term counter, and it **explicitly rejects** witness-point equality as contradicting §3.2 —
> see that file's own header comment for the full reasoning. Deriving regression B from this
> paragraph's literal text again would reintroduce a flaky assertion the branch already removed once;
> §3.2's predicate table is the authority here, not this sentence.
limitation 9.

**C. The exact known-unstable pairs, pinned.**
The class-B pair (`structure frag 537 → structure frag 427`) plus a sample of the 36 unstable
`inconclusive-crossing` target fragments. Across ≥ 5 independent page loads each must show a
**single** value for: precheck disposition, `conclusive`, `inconclusiveCauses`, contribution to
`clearanceHardClashExclusions`, and whether the distance query ran. Pre-fix the class-B pair takes
**both** values across 14 sessions (F6).

**D. TLAS / linear parity.**
Re-run `S2[k=100:typical:clearance]` under the **full, unrelaxed §6.4 comparator**, **N ≥ 10 clean
runs** (`m4-hard-clash-precheck-parity-blocker-investigation.md:374`). §6.4 is not edited, and the
`TIME_BUDGET_DIAGNOSTIC_DIVERGENCE` carve-out must not be invoked — if it fires, that is a finding.

**E. Cross-reload M4 parity — the test that did not exist before.**
Run the identical query in two independent page loads, and separately across a mid-run `page.reload()`
+ `loadFixtureAndReconfirm()` (`run-gate-m4.mjs:3144`), requiring §6.4-field equality **between
loads**. Pre-fix RED by `clearanceDistanceQueriesRun` 129 ↔ 130 and by the 56 entering/leaving
diagnostic entries. **Also carries §9.2's two pending measurements:** assert the
`fragId → (worldMatrixHash, ownerDbId)` maps are identical across loads, and report how many
fragment pairs share a world matrix (rank 4's real discriminating power).

**F. Aggregation determinism.**
Two candidate fragment pairs collapsing onto one dbId key with *bit-identical* `distance` and
*same-kind* witnesses must select the same winner (a) under reversed broad-phase visit order — the
existing tests at `test/CollisionWorld.findClashes.test.mjs:1117-1160` must stay green — and (b)
**across two page loads with different `geometryIndex` assignments**, which is new and RED today. The
**witness payload** must be compared, closing research doc limitation 3.

**G. M1 / M2 / M2.1 / M3 compatibility.**
Full `node --test`, `test/acceptance/clash-finder.acceptance.mjs`, and the M1/M2/M3 gates. Every
changed result or diagnostic must be **classified** as: *(i)* a borderline pair whose verdict changed
in the direction §4.0 predicts, *(ii)* a counter shift explained by the tightened epsilon, *(iii)* an
aggregation winner or witness-payload change explained by Decision 5, or *(iv)* **unexplained — which
blocks**. Silent acceptance of a changed gate result is not permitted.

**H. Composition with the deterministic budget.**
Verify at the wrapper under Phase C's three regimes: *(i)* **normal completion**; *(ii)* **deterministic
budget exhaustion** — force each `exhaustedBudget` value via `options.max*`, **including a
deliberately binding lowered `maxCrossingPointClassifications`**, and require **bit-identical** results
under both public-role orders (which must now hold unconditionally, since the same kernel call is
made); *(iii)* **wall-clock telemetry threshold crossing** — inject a slow `now()` and require
`timeBudgetExceeded: true` to change **no** semantic field.

---

## 12. Declared limitations and follow-ups

- **L-1 — anisotropic transforms.** `orientForCrossing`'s rank-1 key is **exact** for the supported
  class (rigid + positive uniform scale: all column norms equal `s`) and a lower bound on `σ_max`
  within `√3` otherwise, so misranking is possible only when true world extents lie within `√3`,
  degrading the dead-rung margin from 10× to ≥ 5.8×. Under strong anisotropy no scalar rank bounds
  direction-specific compression (`σ_min`). Anisotropic transforms remain **accepted, not gated**
  (§4.0); the *guarantee* is scoped to the supported class, and orientation *determinism* holds
  regardless. This inherits M1's declared limitation (M1 design `:1702-1710`) and does not worsen it.
- **L-2 — kernel directionality is contractual, not residual.** `properCrossingQuery` may return
  different `aborted`, counters, witness and rounding under a forced operand swap. §3.1 makes this an
  explicit kernel contract; the wrapper never exercises it.
- **L-3 — rank-5 digest collision.** Two geometrically distinct meshes sharing world diagonal,
  triangle count, vertex count, world matrix **and** a 128-bit content digest fall to rank 6 (public
  role), where wrapper swap-invariance degrades to L-2. Reload-invariance is unaffected. Bytewise
  comparison on collision was considered and rejected (§4.3 C-1).
- **L-4 — `fragmentId` stability is empirical, not contractual** (§9.2), scoped to **same-model
  reloads** (§6.6); model replacement is out of scope. §5.1 names the fallback in advance.
- **L-5 — single fixture, single Viewer build** (research doc §9.5). The *mechanism* is code-level and
  fixture-independent; the *rate* at which it changes anything is not.
- **L-6 — `surface-intersection` and `containment` modes** carry Phase C's deferred wall-clock defect
  class, untouched here.
- **L-7 — the post-fix span envelope is unmeasured** until Phase B′ runs (§9.4). This design states
  the disposition rule and the escalation branch rather than predicting the number.
- **L-8 — the coplanarity predicate is structurally weak, pre-existing.** It combines an approximate
  parallel-normal test (up to ≈ 0.081° of divergence) with a **single-vertex** plane offset, so two
  long near-parallel triangles can be judged coplanar while diverging by up to ≈ `1.4e-3 × D` at their
  far ends — two orders of magnitude beyond the declared detection limit. This fix **narrows** the
  hole by tightening the epsilon (§4.3 C-2) but does not close it.

**Follow-ups, deliberately out of this fix's scope:**

- **FU-1 — intrinsically symmetric per-probe rule.** Make the kernel's probe rule a correct
  three-valued conjunction over the two solids, so `(boundary, outside)` stops being reported as
  ambiguous. Motivated in §4.3; needs its own fixtures, its own compatibility pass, and its own
  argument about fail-open/fail-closed posture, because it reduces reported ambiguity in
  safety-relevant software. **Not required for this fix**: the wrapper is already swap- and
  reload-invariant without it.
- **FU-2 — robust coplanarity predicate.** Bound all three vertices (or use robust triangle-plane
  distances) instead of one vertex, closing L-8. Belongs to the tolerance model, and adds arithmetic
  to the 50,000-iteration tier-B loop, so it needs its own calibration.

---

## 13. Design-time independent consult — findings and disposition

One `codex-advisor` consult was run **during** drafting (request `20260911-140315-17242-15375`),
recorded as a design input.

| Finding | Disposition |
|---|---|
| The `max` derivation is not rigorous: probe distance is the normal component of `delta`, not `delta` | **Accepted and fixed.** §4.0 is a *necessary* condition (`dist ≤ delta` because `_mid` lies on both surfaces), needing no normal-component assumption |
| A `1e-5 × maxDiagonal` step can cross through a thin member; no tracked fixture proves otherwise | **Accepted.** Bounded in §4.0 by the detection-limit identity; regression **A.3** added |
| `maxColumnNorm` underestimates `σ_max` by up to `√3`, so it cannot prove band clearance | **Accepted and fixed.** `stretch` appears **only** in the orientation ranking, never in a tolerance; it is **exact** for the supported class; the consequence is L-1 |
| The coplanarity epsilon should not inherit the `max` scale | **Now fully accepted** (it was only partially accepted in revision 1). §4.3 C-2 tightens it to the symmetric `min`; see §14 Finding 3 |
| The probe truth table is symmetric, but not under a *binding* classification budget | **Moot** — the per-probe change is deferred (FU-1); regression H still exercises a binding override |
| The structural maximum is 12 probe points × 2, not "2 × 24 probes" | **Accepted**; arithmetic corrected |
| Orientation remains semantic; describe it as policy, not plumbing | **Accepted**; §3.1 makes it an explicit layer contract |
| Deleting `compareCanonical` while keeping an identity fallback would change the `Instance` contract | **Addressed**: rank 6 is the public role, never identity; rank 5 is *content-derived*, not an identifier (§2.2 item 3) |
| Dropping `geometryIndex` changes published witness payloads, not just provenance | **Accepted**; §6.4 |
| The `fragmentId` evidence is direct, not inferential — but is not a Viewer guarantee | **Accepted**; §9.2 |
| The 2× cost / 31 ms breach for Strategy B is a planning estimate | **Accepted**; §4.2 softened |
| Recommended: a symmetric *union* of both ladders | **Rejected, with arithmetic** (§4.4 D-2) |
| The envelope argument for reusing Phase B's calibration is not rigorous | **Accepted in full**; §9.4 requires Phase B′ |

---

## 14. Independent architecture review — findings and disposition

`codex-review architecture` at `high` effort against revision 1. Overall readiness: *Requires major
revision*. Every finding was re-verified against the actual source before disposition.

| # | Finding (severity) | Verification | Disposition |
|---|---|---|---|
| **1** | *The proposed canonicalizer is not canonical* — rank 5 falls back to the caller's `source` role, so swapping can still reverse the traversal and produce different `aborted` / overlap outcomes (Critical) | **Confirmed.** Ranks 1–4 cannot separate two distinct meshes sharing diagonal, counts and placement — and rank 4's real discriminating power in this codebase is **unmeasured** (fragments of one element commonly share a placement; baked-in geometry with identity matrices is a common APS arrangement). Revision 1 also mischaracterized the consequence as "~1 ulp" (R-a) when a reversed traversal changes candidate enumeration and can change `aborted` | **ACCEPTED.** §4.3 C-1 adds a cached, content-derived **`geometryDigest` at rank 5** (hooked at `ThreeMeshBvhBackend.build`, F17), making the order total up to a 128-bit collision; §3.1 declares the kernel/wrapper layer contract so `aborted` is invariant *at the wrapper*; L-2/L-3 rewritten; regression **A.5** added. **Bytewise comparison on digest collision is rejected** as disproportionate |
| **2** | *The new probe rule equates "not a witness" with "no uncertainty"; `outside` carries no separation margin* (Critical) | **The stated reason is factually wrong.** Per F8, `classifyPoint` returns `boundary` for any closest distance `≤ 1e-6 × L` **before** parity casting, so an `outside` result carries a ≥ `1e-6 × L` margin **by construction**. The per-probe rule is also a correct three-valued conjunction (`unknown ∧ false = false`), and at product level a surplus `inconclusive` *drops* a clearance pair (`CollisionWorld.js:1791`) rather than protecting against a miss — so "conservative" is not obviously the safe direction either | **Reason REJECTED; recommendation ACCEPTED on independent grounds.** The change is **removed from scope** (FU-1) because it is **not needed**: once C-1 fixes orientation the wrapper is swap- and reload-invariant without it, so a semantic change to ambiguity reporting in safety-relevant software should not ride an identity fix. The reviewer's own fallback — "keep the existing conservative ambiguity semantics out of this identity fix" — is what is adopted |
| **3** | *Increasing the coplanarity epsilon can discard real crossings without the claimed bound* (Critical) | **Confirmed, and the arithmetic is worse than the reviewer stated.** `coplanarAngleEpsilon = 1e-6` admits divergence up to `√(2e-6) ≈ 1.41e-3 rad`; over a triangle of extent `E ≈ D_max` the planes diverge by ≈ `1.4e-3 × D_max`, **140×** the `1e-5 × D_max` declared limit — while the offset test samples **one vertex** (`_nA·_triA.a − _nA·_triB.a`, `ProperCrossingQuery.js:180`). Revision 1's `surfaceEpsilonFactor < minPenetrationDepthFactor` argument therefore does **not** bound the discard | **ACCEPTED, and revision 1's dissent withdrawn.** §4.3 C-2 **tightens** the epsilon to the symmetric `min(localDiagonalA, localDiagonalB × stretch(matrixBtoA))`, which in world units is `≤` *both* pre-fix values — the change is **monotone toward more completeness** and cannot discard any pair the pre-fix code probed. The underlying structural weakness is documented as pre-existing (**L-8**) with the reviewer's robust predicate recorded as **FU-2** |
| **4** | *The load-bearing scale proof uses an incorrect relative-transform assumption* — two individually-uniform scales give relative stretch `s_A/s_B`, not 1 (High) | **Confirmed against source.** `validateUniformScale` (`ClearanceTransform.js:25-70`) validates **one** matrix as rigid + positive uniform; operands at scales 1 and 1000 both pass (F13). Revision 1's "`σ = 1`; every case clearance permits" was wrong on both clauses. **Also found: the repository already does this correctly elsewhere** — `computeToleranceFloor` converts both diagonals to world units via each operand's own `scaleFactor` before `max`, with an explicit comment that mixing frames is invalid (F14) | **ACCEPTED.** §4.0 is rewritten entirely **in world units** with `D_X = L_X × s_X`, deriving the guaranteed-boundary condition as `W ≤ 1e-6 × max(D_A, D_B)` — which holds for arbitrary individually-uniform scales. The **conclusion survives and is strengthened**: rank 1 is the world diagonal, and `stretch` is *exact* for the supported class. Anisotropic policy is now an explicit decision (**accepted, not gated**; guarantee scoped; L-1 quantified). Regression **A.2** added specifically to pin rank 1 as world-space. **The recommendation to gate anisotropic inputs is rejected** — it would change the input class `volume-overlap` accepts today |
| **5** | *Compatibility classification understates the internal API change* (Medium) | **Partly confirmed.** `collision/index.js` exports only `CollisionWorld` + errors and states consumers must not deep-import (F16); the only non-test importers of `VolumeOverlapQuery.js` are `CollisionWorld.js` and `ClearanceHardClashPrecheck.js`. So no external consumer exists — but revision 1's blanket "no internal contract change" was still imprecise, and a *silent* option drop is a genuine footgun | **ACCEPTED in substance.** §9.6 now splits the classification into **(a)** a behavioural correctness bug fix and **(b)** an explicitly named **internal API migration** with an enumerated, closed call-site set. The suggested transition guard is adopted in its cheapest form: `volumeOverlapQuery` **throws** on a supplied `compareCanonical` instead of ignoring it. A longer deprecation period is rejected — there is no external consumer to deprecate for |
| **6** | *The design removes the only easy evidence explaining orientation decisions* (Medium) | **Confirmed by the history itself** — Effect B needed a full replay investigation precisely because orientation left no trace, and revision 1 replaced one opaque rule with a six-rank one while stating it adds no telemetry | **ACCEPTED.** §4.3 **C-4** adds `orientedFirstRole`, `orientationRank` and the two world-diagonal proxies to the **existing recorder-gated** `hard-clash-precheck` `stage:'crossing'` event — opt-in, zero production cost, never a §6.4-compared field, no new event and no new export |
| **7** | *Phase B′ does not exercise the changed orientation path* (High) | **Confirmed at the exact line cited.** `test/performance/m4/proper-crossing-budget-calibration.mjs:223` calls `properCrossingQuery(a.bvh, b.bvh, matrixBtoA, a.localDiagonal, b.localDiagonal, …)` directly over a fixed catalogue order — it never reaches `volumeOverlapQuery`, so revision 1's "reuse the harness verbatim" would have measured the *old* direction (F15) | **ACCEPTED.** §9.4's Phase B′ now keeps the sampling protocol and fixture catalogue but **changes the call seam**: every pair runs through the production orientation policy, the selected direction is recorded per record, and both kernel and end-to-end spans are reported, with the loss of byte-comparability stated in the output. The reviewer's further note — measure per-pair orientation cost in aggregate rather than declaring it negligible — is adopted as Phase B′ scope item **(e)** |
| **—** | *Budget exhaustion lacks one authoritative contract: the symmetry table requires invariant `aborted` while L-2 permits directional exhaustion* | **Confirmed** — revision 1 was internally inconsistent | **ACCEPTED.** §3.1 resolves it by declaring the kernel directional and the wrapper canonical; with a total order the wrapper's `aborted` is invariant, and directional exhaustion lives only in the kernel where it is expected |

### 14.1 The reviewer's four required decisions, settled

1. **Is the contract full operand-swap invariance including deterministic exhaustion, or only reload
   invariance for the canonical wrapper?** — **Full operand-swap invariance at the
   `volumeOverlapQuery` boundary, `aborted` included**, delivered by the wrapper always selecting the
   same kernel direction. The kernel carries no symmetry contract (§3.1). The only exception is a
   rank-5 digest collision (L-3).
2. **Are anisotropic relative transforms supported, rejected, or explicitly allowed to return an
   inconclusive result?** — **Supported, unchanged, not gated.** Adding a rejection would change the
   input class `volume-overlap` accepts today, which this fix has no mandate for. The dead-rung
   *guarantee* is scoped to the supported transform class; orientation *determinism* holds regardless;
   the degradation is quantified in L-1 (§4.0).
3. **Is C-2 independently justified, or can it be removed from this defect fix?** — **Removed**
   (FU-1). It is not needed for either invariant this fix must deliver.
4. **Must aggregation reproducibility cover identical model reloads only, or also model
   replacement?** — **Identical model reloads only** (§6.6). Across a replacement, fragments *and*
   dbIds may move, so the two results are not comparable outcomes of the same query; declared in L-4.

---

# Adopted fix strategy

**A canonical wrapper over a directional kernel (Strategy C)** — not stable canonical ordering by
identity, and not dual-direction composition.

1. **An explicit layer contract.** `properCrossingQuery` is a **directional kernel** with no symmetry
   obligation; `volumeOverlapQuery` is the **canonical wrapper** that carries the whole contract by
   always handing the kernel the same physical operand as `A`.
2. **A total geometric order.** `orientForCrossing` ranks by world-space diagonal (descending), then
   triangle count, vertex count, world-matrix elements, and a **cached geometry-content digest** —
   **no identity at any rank**. Rank 1 selects the larger operand, which by the dead-rung theorem
   (§4.0, derived in world units) is the minimal symmetric choice under which no rung of the declared
   ladder is provably dead. `options.compareCanonical` is deleted and **throws** if supplied.
3. **A tightened, symmetric coplanarity epsilon**: `1e-6 × min(D_A, D_B)`, which is `≤` both pre-fix
   values, so the fix cannot widen a tolerance as a side effect.
4. **Orientation provenance on the existing opt-in diagnostic event**, so the next such investigation
   starts from a gate artifact rather than a replay harness.
5. **`comparePlacedCanonically` leaves the geometric path entirely**, surviving only as
   `compareAggregationIdentity`, a dbId-level tie-break.

Cost: **1.00× traversals**, **unchanged deterministic caps**, ≤ 18 extra multiplies plus a digest
comparison per narrow-phase pair, and one content-digest pass per geometry per epoch. The *measured*
span envelope is not preserved by that argument and is re-measured by **Phase B′**.

# Identity policy

| Class | Fields |
|---|---|
| **Permitted for semantic ordering** | **No identity field whatsoever.** Only geometry- and placement-derived data: `localDiagonal` / local bounds, triangle count, vertex count, world-matrix element values, the max-column-norm stretch of a linear part (exact for the supported transform class), and the **cached geometry-content digest** — all bit-stable across page loads (F4) |
| **Permitted only for runtime lookup / cache** | `geometryIndex` (the `GeometryRegistry` key, `_representativeFragmentByGeometry`), `loadEpoch` (lease/lifecycle/epoch-liveness and aggregation-key qualification), model object identity (`_modelLifecycle` WeakMap) |
| **Permitted only for diagnostics / provenance** | `modelId`, `geometryIndex` in the `precheck-candidate-list` capture, representative-fragment selection, `role` labels, `via`, witness provenance, and C-4's new orientation fields |
| **Permitted as a narrow aggregation tie-break** | `fragmentId` — **only** as the last term of `compareAggregationIdentity`, only between candidates already equal on every semantically meaningful field, inside a key that already fixes both epochs and both dbIds, and **scoped to same-model reloads** (§6.6). It cannot change a truth value, though it selects which equal-ranked candidate's witness payload is published (§6.4). Backed by §9.2's empirical evidence, **not** by a Viewer guarantee, with §5.1's fallback named |
| **Forbidden as correctness-bearing tie-breaks** | `geometryIndex` (490/543 re-permuted), `loadEpoch` as durable identity, `modelId` (collision-prone, diagnostic-only), model object identity (not orderable or serializable), representative-fragment selection (first-discovery-wins, documented as mis-attributing) |

# Symmetry truth table

**Kernel (directional, no contract):** unchanged from today — classify against `bvhA`, `boundary`
sets ambiguity and continues, `inside` proceeds to `bvhB`, `inside`/`inside` is a crossing.

**Wrapper (the contract):** for a given physical pair, `volumeOverlapQuery(x, y)` and
`volumeOverlapQuery(y, x)` make the **same kernel call**, so every crossing-term output is
bit-identical — `crossing`, `aborted`, `inconclusive`, `diagnostics`, all three counters,
`exhaustedBudget`, witness point.

**Per traversal:** `crossing` if any probe was `inside` against both solids; else `aborted` if a
deterministic cap was reached (`crossing` forced false); else `inconclusive` if any probe was
`boundary`; else a conclusive negative.

**Per composed volume-overlap:** `overlap = crossing ∨ (A in B) ∨ (B in A)` (commutative);
`conclusive` on a negative = crossing conclusive **∧** both containment terms resolved every component
**∧** no non-manifold/unverified taint; `inconclusiveCauses` is the sorted union of the symmetric
causes.

**Per precheck:** AABB-disjoint → `skip-precheck`; `overlap` → `excluded`; conclusive negative →
`proceed`; inconclusive negative → `inconclusive` (and the pair is dropped from the clearance result).

**Invariant under operand swap:** every kernel output listed above, plus `overlap`, `conclusive`,
`inconclusiveCauses`, precheck `status`, exclusion-set membership, `distance`, and every diagnostic
`reason`. **Legitimately directional:** `via`, which containment term produced the witness,
`containmentSamplesUsed`, `role` labels, and provenance fragment ordering.

# Performance / calibration impact

**The previous ProperCrossing calibration does NOT remain valid. A focused recalibration — Phase B′ —
is REQUIRED, and its call seam is corrected.** The deterministic *caps* are numerically unchanged
(1536 stays `maxCrossingPairsExamined × 24`, non-binding by construction), so no cap redesign is
needed and the "per direction or combined" question is moot. But caps bound work counts, not time; the
measured envelope was never at the cap (`pointClassifications` maxed at **1152 = 75 %**, zero
classification-cap exhaustions); the **tightened** coplanarity epsilon deliberately admits more
candidate pairs into the probe ladder; probes move to different BVH locations; and orientation changes
candidate enumeration, where the measured 15.5 ms worst case lives.

Phase B′ (§9.4) keeps Phase B's sampling protocol and fixture catalogue but **replaces the kernel call
seam with the production orientation policy**, records the selected direction, reports kernel and
end-to-end spans, and adds an aggregate million-candidate pass covering per-pair orientation and
digest cost. Calibration doc §14.4's three disposition branches are **reused verbatim and not
relaxed**. **Escalation trigger:** `S_worst > 24.8 ms` halts M4 progression at the end of P3, changes
this design's disposition to `BLOCKED_ON_RECALIBRATION`, and re-opens §4.3's ladder and epsilon
choices.

# Compatibility disposition

**Two classifications, because one label was doing two jobs.**

**(a) Behavioural:** a **correctness bug fix**, preserving intended symmetric geometry semantics. No
public shape, field, mode, diagnostic `reason`, or exported symbol changes; `collision/index.js` is
untouched. The repository already declares the symmetric contract in three places
(`CollisionWorld.js:170-173`, the committed 707:1 regression, M1 design `:1679-1686`); what changes is
the mechanism, reversing one explicitly-rejected M1 alternative (F11) on evidence M1 could not have
had. `minPenetrationDepth = 1e-5 × L_canonical` keeps its formula and gains a well-defined
`L_canonical` — a **documentation correction**, since `1e-5 × D_min` was never achievable (§4.0). The
coplanarity epsilon is **tightened**, so that axis can only add candidate pairs to the search.

**(b) Structural:** an **internal API migration**, named as such — `options.compareCanonical` is
removed from `volumeOverlapQuery`, whose module is not re-exported from `collision/index.js` and whose
only non-test importers are two files inside `collision/` (F16). The migration is closed and
enumerable, and is made **fail-loud**: a supplied `compareCanonical` throws rather than being ignored.
`ThreeMeshBvhBackend`'s record gains a cached `geometryDigest`, forwarded by `toInstance` — an
internal typedef change.

Observable results **will** change for borderline pairs, in the direction of recovering crossings the
small-operand orientation silently lost; every change is classified by regression G rather than
accepted silently. Reload-dependent behaviour is not preserved for backward compatibility.

# Required implementation phases

**P1** separation (rename + drop `geometryIndex` from the aggregation tie-break; behaviour-preserving).
**P2** content digest + geometry-derived orientation (`geometryDigest`, `orientForCrossing`, delete `compareCanonical` with a fail-loud guard, C-4 telemetry, re-express three tests).
**P3** coplanarity epsilon tightened to the symmetric `min`.
**Phase B′** focused recalibration against the P3 commit, **with the corrected call seam** — blocking on §14.4 branch 3.
**P4** documentation (M1 Tolerances + canonical-order paragraph, `collision/README.md`, `CHANGELOG.md`, the M4 plan's Task 4.5 replica text).
**P5** validation, in regression order A → H.

# M4 restart sequence

1. Implement the canonical-ordering / operand-symmetry fix.
2. Focused Effect B regressions (A including A.2–A.5, B, C, F).
3. Complete and validate the ProperCrossing deterministic-budget Phase C — its own focused validation,
   now unconfounded by Effect B.
4. **Recalibrate — Phase B′ (§9.4). Required, not conditional.** Progression halts here on §14.4
   branch 3.
5. `S2 k=100` TLAS/linear parity (regression D), N ≥ 10 clean runs.
6. M1 / M2 / M2.1 / M3 compatibility validation (regression G), every change classified.
7. Full Phase 3 canonical matrix.
8. VALID §6.4 checkpoint.
9. Only then evaluate Phase 4 authorization.

**The fix itself is not evidence for A / B / C / D.**

---

**Terminal disposition.** All six required architecture decisions are resolved; the independent
review's four required decisions are settled in §14.1; every Critical and High finding is either
applied or rejected with source-verified reasoning; the order is now total up to a stated digest
collision; the tolerance proof is derived in the correct frame; no tolerance is widened; and no
numeric constant is left for an implementer to invent. Two changes were *removed* from scope rather
than defended (FU-1, FU-2), which narrows the fix to the defect it is for.

Phase B′ is **required**, but it is a measurement that can only be defined on the post-fix build — it
gates M4 *progression*, at a named point, not implementation *planning*; treating it as a precondition
would deadlock, since there is nothing yet to measure. No architecture question remains open that this
document does not close. The disposition is therefore `READY_FOR_IMPLEMENTATION_PLANNING`, and it
becomes `BLOCKED_ON_RECALIBRATION` the moment Phase B′ returns §14.4 branch 3.

READY_FOR_IMPLEMENTATION_PLANNING
