# Collision Detection Library

A clash-detection library for the Autodesk Platform Services (APS) Viewer: given a live
`Autodesk.Viewing.Viewer3D` and one or more loaded models, it finds geometric relationships
(surface contact, containment, volume overlap, near-miss clearance) between two sets of elements,
identified by `dbId`.

This document covers the full shipped surface through **Milestone 3 (M3)** — what actually shipped
and was accepted, across every milestone. Sections and restrictions are labeled M1/M2/M2.1/M3 where
the distinction still matters — mainly: which `target` shape (legacy `{model, dbIds}` vs. the M2
`{targets: [...]}` shape), which `broadPhase` value, and which `mode` a given behavior applies to.
For design history/rationale, see
`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (M1, 4000+ lines),
`docs/superpowers/specs/2026-09-05-collision-library-milestone2-design.md` (M2),
`docs/superpowers/specs/2026-09-07-collision-library-m2.1-clash-witness-marker-design.md` (M2.1) and
`docs/superpowers/specs/2026-09-07-collision-library-milestone3-clearance-design.md` (M3) — only
needed if you want the "why", not the "how".

## What it does

`CollisionWorld` wraps one Viewer model's fragment geometry in a BVH-accelerated collision index
(via [`three-mesh-bvh`](https://github.com/gkjohnson/three-mesh-bvh)) and answers `findClashes`
queries against it: "does any element in set A touch/contain/overlap any element in set B?"

Everything is scoped to `dbId` — the caller supplies `dbId` arrays, the library extracts the
underlying render-fragment geometry itself, and results are reported back as `dbId` pairs.

## Supported query modes

Pass one of these as `query.mode`:

| Mode | Question answered |
|---|---|
| `surface-intersection` | Do the two operands' surfaces actually touch/cross? |
| `containment` | Is any of the source surface located inside the target's solid? (directed: source-in-target only) |
| `volume-overlap` | Do the two operands' solids overlap in volume (a "real" 3-D clash, not just touching surfaces)? |
| `clearance` (M3) | Do the two operands come within a caller-supplied world-unit distance of each other **without** overlapping in volume — a "near miss" / Soft Clash? Reports the minimum surface-to-surface distance and the two closest points. |

All four are single-mode-per-call — `findClashes` does not compose multiple modes in one query.
`clearance` is deliberately *disjoint* from `volume-overlap`: a dbId pair that is a Hard Clash is
excluded from clearance results entirely, never merely distance-filtered out (see "M3: Soft Clash /
Clearance" below).

## Quick start

```js
import { CollisionWorld } from './collision/index.js';

// `viewer` is an already-constructed, running Autodesk.Viewing.Viewer3D with a model loaded
// (viewer.model). Typically called once, e.g. from an extension's load().
const world = await CollisionWorld.fromViewer(viewer);

const bathtubDbId = 2530;                    // the element you're checking
const roomDbIds = [3885, 3886, 3887 /* … */]; // the candidate containers

const { pairs, statistics } = await world.findClashes({
  source: { model: viewer.model, dbIds: [bathtubDbId] },
  target: { model: viewer.model, dbIds: roomDbIds },
  mode: 'containment',
  groupBy: 'dbId',
});

for (const pair of pairs) {
  console.log(`dbId ${pair.source.dbId} is contained by dbId ${pair.target.dbId}`);
}

// A non-empty diagnostics array means the answer may be INCOMPLETE (a skipped fragment or an
// aborted, budget-exhausted traversal) — an empty `pairs` in that case is NOT the same statement
// as "definitely no clash." Always check this before trusting a negative result.
if (statistics.diagnostics.length > 0) {
  console.warn('findClashes result may be incomplete:', statistics.diagnostics);
}

// Release the world's BLAS cache / geometry registry state once you're done with it (e.g. from
// an extension's unload()). A disposed world cannot be reused — construct a new one instead.
world.dispose();
```

This is exactly the flow `wwwroot/extensions/RoomLocatorExtension.js` uses in production — see
[Reference sample](#reference-sample-room-locator) below.

## `CollisionWorld.fromViewer(viewer, options?)`

The library's one supported construction path.

```js
static async fromViewer(viewer, options = {})
// options.narrowPhase:     only 'three-mesh-bvh' is implemented (default, and the only legal value)
// options.indexOwnership:  only 'clone' is implemented (default, and the only legal value)
```

Both options exist as forward-looking seams; since `fromViewer` is `async`, passing anything else
**rejects the returned promise** (not a synchronous throw). Unrecognized option keys are ignored.
In practice you never need to pass `options` at all in M1.

`options.now`/`options.yieldToScheduler` are also accepted, but are internal test seams (clock/
scheduler injection for this library's own unit tests) — not part of the supported developer API,
even though nothing in JavaScript prevents passing them.

`viewer` may be `null` for lifecycle-only use (no narrow-phase query is reachable without one) —
the only thing ever called on it is `viewer.impl.getRenderProxy(model, fragId)`.

## `findClashes(query)`

```js
world.findClashes({
  source: { model, dbIds: number[] },
  target: { model, dbIds: number[] }                           // legacy, single-model shape (M1)
         | { targets: Array<{ model, dbIds?: number[] }> },     // M2: cross-model shape — dbIds
                                                                 // omitted on an entry means "whole
                                                                 // model" scope for that model
  mode: 'surface-intersection' | 'containment' | 'volume-overlap' | 'clearance',
  groupBy: 'dbId',
  broadPhase?: 'linear' | 'tlas',   // M2 only; default is shape-dependent — see below
  clearance?: number,               // M3: REQUIRED for mode:'clearance', rejected for every other
                                    // mode — see below
})
// -> Promise<{ pairs: ClashPair[], statistics: Statistics }>
```

**M3: the `clearance` parameter.** For `mode: 'clearance'`, `query.clearance` is a **required**,
finite, **strictly positive** number in world/model units (the same Viewer scene units the library's
witness points already use — no unit conversion happens inside `collision/`). Both directions are
enforced loudly at entry validation, before any lease/epoch is consumed and before any side effect:

- `mode: 'clearance'` with a missing, non-numeric, non-finite, or `<= 0` `clearance` throws
  `Error("findClashes: mode 'clearance' requires a finite, positive 'clearance' number")` — never a
  silent empty-`pairs` result.
- a `clearance` value supplied alongside any *other* mode throws too, rather than being silently
  accepted and discarded.

**The library itself has no default `clearance`** — there is deliberately no fallback value in
`collision/`. `DEFAULT_CLEARANCE = 0.05` lives in
`wwwroot/extensions/ClashFinderExtension.js` and is a *Viewer-extension-layer* default for the "Find
Soft Clashes" action only (provisional; see "M3: Soft Clash / Clearance" below). Do not describe it
as a library default.

`broadPhase`'s shape-dependent default applies to `mode: 'clearance'` exactly as it does to the three
pre-existing modes: a `targets`-shaped clearance call defaults to `'tlas'`, the legacy
`{model, dbIds}` shape to `'linear'`, and either may override explicitly.

**Restrictions on the legacy `target: {model, dbIds}` shape** (all rejected loudly with a thrown
`Error`, never silently degraded) — these do **not** apply to the M2 `target: {targets: [...]}`
shape, which exists specifically to lift the first one (see "M2: `broadPhase` and the
TLAS-accelerated path" below):

- `source.model` and `target.model` must be the **same model object** — a cross-model query using
  this legacy shape is rejected; use the `targets` shape for cross-model queries.
- `groupBy` must be exactly `'dbId'` — no other grouping is implemented (this restriction applies
  under both shapes, M1 and M2 alike).

**Result shape:**

- `pairs`: one entry per distinct `(sourceDbId, targetDbId)` pair with a positive result —
  `{ source: { modelId, dbId, model }, target: { modelId, dbId, model }, type: <mode> }`, plus a
  `witness` key present only when `type === 'volume-overlap'` (M2.1) or `type === 'clearance'` (M3)
  — **two different witness shapes**, see both sub-bullets below.
  `model` is the real `Model` object reference for that operand — a borrowed identity reference, and
  the **authoritative** one for same-model/cross-model comparisons (see the Clash Finder sample's own
  classification logic below). `modelId` is diagnostic/display-only: it is documented elsewhere in
  this library as reused-under-collision-prone across a session, so never compare on it. Order is
  insertion-order, not canonicalized.
  - **M2.1: `witness`.** Present as a key **only** on `volume-overlap` pairs — the key is always
    present (never `undefined`) on a `volume-overlap` pair, but is entirely omitted (not even set to
    `undefined`) on `containment`/`surface-intersection` pairs, so `'witness' in pair` stays `false`
    for those modes, exactly as before M2.1 (out of scope per the design). For a `volume-overlap`
    pair, `witness` is:
    ```js
    witness: {
      kind: 'surface-crossing' | 'containment',
      point: [x, y, z],   // Viewer scene/render coordinates
    } | null
    ```
    `point` is a plain 3-element array of finite numbers (never a `THREE.Vector3` of either
    revision) — keeps the public shape framework-agnostic and avoids the r71/r185 ambiguity
    entirely. For a complete, successfully-evaluated `volume-overlap` Hard Clash with valid geometry
    and transforms, `witness` is expected to be non-null — every code path that confirms the verdict
    also captures a geometrically-justified point at that same statement, so a non-null witness is
    the ordinary, expected outcome, not merely a possibility. The value remains nullable strictly as
    a fault-tolerance / degraded-result contract: `witness: null` means the clash verdict is still
    valid, but witness generation or its world-space transform failed or produced a non-finite
    result; the result carries a corresponding `statistics.diagnostics` entry
    (`reason: 'witness-unavailable'`), and `ClashFinderExtension` cannot render a marker for that
    pair. A clash is never suppressed or downgraded because witness capture failed. See the design
    spec's §1 ("Public result shape") for the full rationale.
  - **M3: the `clearance` pair shape.** A `mode: 'clearance'` call returns pairs carrying three
    additive keys the other three modes never have:
    ```js
    {
      source: { modelId, dbId, model },
      target: { modelId, dbId, model },
      type: 'clearance',
      distance: number,    // the measured minimum surface-to-surface distance, WORLD units,
                           // strictly inside (toleranceFloor, clearance]
      clearance: number,   // the threshold this call was issued with, echoed back
      witness: {
        sourcePoint: [x, y, z],   // the closest point ON THE SOURCE surface
        targetPoint: [x, y, z],   // the closest point ON THE TARGET surface
      },
    }
    ```
    **This is NOT Hard Clash's witness shape.** A clearance witness has **two** points and no
    `kind`; a `volume-overlap` witness has a single `point` plus a `kind`. Consumers that read
    `pair.witness.point` unconditionally will get `undefined` on a clearance pair — a real hazard
    already hit once, live, during M3 acceptance. Branch on `pair.type` (or feature-detect
    `witness.sourcePoint`), never assume one shape. `sourcePoint` always lies on the caller's own
    `source` operand and `targetPoint` on its `target`, regardless of which operand the query
    internally anchored its BVH traversal on.
    Unlike `volume-overlap`'s nullable witness, a clearance pair is only ever *emitted* with a real
    witness: if the closest points cannot be produced in finite world coordinates, the pair is not
    reported at all and a `clearance-distance-unavailable` diagnostic is pushed instead (see
    Diagnostics below). `ClashFinderExtension` still guards for a missing witness defensively.
- `statistics`: `{ broadPhasePairs, narrowPhasePairs, blasBuilt, blasCacheHits, broadPhaseMs,
  narrowPhaseMs, totalMs, diagnostics, ...9 M2 fields and 7 M3 clearance fields below }`. `blasBuilt`/`blasCacheHits` are
  currently always reported as `0` — the geometry registry doesn't yet expose build/hit counters to
  report real ones (not a correctness issue, just an unwired diagnostic field).

  **M2: 9 additional fields**, always present and default to `0` — never conditionally omitted,
  including for `broadPhase: 'linear'` calls and for a call that returns zero results (spec §7.5.1):

  | Field | Meaning |
  |---|---|
  | `tlasLeafRangeEmissions` | Raw TLAS leaf/range hits from traversal, summed across every per-source-instance query in the call, *before* expansion into per-primitive candidates. |
  | `tlasPrimitiveCandidatePairs` | Every individual primitive-index candidate produced by expanding a leaf/range match, summed across the call, counted *before* the target-scope filter and source self-exclusion are applied. This is exactly the running counter checked against `maxTlasCandidatePairs`. |
  | `tlasExactRetestSurvivors` | Candidates that passed the exact `_testBroadPhasePair` predicate (same predicate the linear path uses), summed across the call. |
  | `tlasNarrowPhaseInputPairs` | Unique fragment pairs actually handed to narrow phase. Equal to `tlasExactRetestSurvivors` for M2's adopted traversal pattern — kept as a separate field for forward-compatibility with a future dedup-capable traversal, and because an unexpected divergence today would itself be a useful bug signal. |
  | `tlasBuilds` | Count of TLAS builds/rebuilds *this call itself* performed, whether triggered by growth staleness, invalidation staleness, or a first-ever build for a never-built epoch. |
  | `tlasCacheHits` | Count of times this call found an already-warm, non-stale TLAS entry and queried it directly with no build/refresh. |
  | `tlasSharedBuildWaits` | Count of times this call had to await a *different* concurrent caller's already-in-flight build/refresh (single-flight sharing) rather than performing or avoiding a build itself. |
  | `tlasBuildMs` | Wall-clock time *this call itself* spent performing a build or a placement refresh it initiated — `0` for a cache hit, and `0` for a call that only awaited another caller's shared build (that wait is reflected in `broadPhaseMs` and `tlasSharedBuildWaits`, not here). |
  | `tlasQueryMs` | Wall-clock time this call spent in its own synchronous TLAS traversal, primitive expansion, filtering, and exact-retest work. |

  `broadPhaseMs` keeps its existing end-to-end meaning unchanged (total wall-clock time this call's
  broad phase took, including any waiting at checkpoints) — `tlasBuildMs`/`tlasQueryMs` break that
  total down further for a `broadPhase: 'tlas'` call, they don't replace it.

  **`broadPhasePairs` (existing M1 field) is a generalized, cross-path field**: under either
  `broadPhase` value it means "count of candidate pairs whose exact `_testBroadPhasePair` predicate
  was evaluated during broad phase." This is not a behavior change for `'linear'` callers — under
  `broadPhase: 'linear'` the linear scan already retests every one of its Cartesian pairs, so
  "pairs examined" and "pairs exact-retested" already coincide exactly; this is a documentation-
  level generalization of an already-true fact, not a new computation. Under `broadPhase: 'tlas'`,
  `broadPhasePairs` is **not** the same number as `tlasPrimitiveCandidatePairs` — target-scope
  filtering and source self-exclusion happen between primitive expansion and the exact retest, and
  are expected to remove real candidates in the ordinary case (e.g. any query whose target scope is
  a proper subset of an epoch's admitted population).

  **The inequality chain that makes the two `broadPhase` paths comparable** (spec §7.5.2 — any
  TLAS-path statistics-consistency test should assert this directly):

  ```
  tlasPrimitiveCandidatePairs  >=  broadPhasePairs             (filtering removes candidates)
  broadPhasePairs              >=  tlasExactRetestSurvivors     (not every retested pair passes)
  tlasExactRetestSurvivors     ==  tlasNarrowPhaseInputPairs    (structural no-dedup guarantee)
  tlasNarrowPhaseInputPairs    ==  narrowPhasePairs              (same set, same meaning, either path)
  ```

  **M3: 7 additional clearance fields**, always present and defaulting to `0` — never conditionally
  omitted, including for non-`'clearance'` calls and for a clearance call that returns zero results.
  This is the **definitive increment-point table** — where each field is incremented, not just what
  it loosely means:

  | Field | Increments when |
  |---|---|
  | `clearanceExpandedCandidatePairs` | TLAS `onCandidate`, after scope/self-exclusion/`currentByFragmentId` filters, before the exact retest. Always `0` under `broadPhase:'linear'`. |
  | `clearanceExactAabbSurvivors` | Once per candidate (linear or TLAS) whose exact, unpadded AABB distance is `<= clearance` |
  | `clearanceOverlapPrechecksRun` | Once per candidate whose precheck status is `excluded`, `proceed`, OR `inconclusive` — i.e. whenever `volumeOverlapQuery` actually ran. Never for `skip-precheck`. |
  | `clearanceHardClashExclusions` | Once per dbId-level pair in the complete `hardClashExcludedKeys` set (never per fragment pair) — including a key with zero surviving `clearanceCandidateByKey` entries |
  | `clearanceDistanceQueriesRun` | Once per actual `clearanceQuery` call (both the `proceed` and `skip-precheck` branches reach it) |
  | `clearanceHits` | `pairs.length` at the end of the call |
  | `clearanceQueryMs` | Wall-clock inside `clearanceQuery` calls only, same bracketing convention as `tlasQueryMs` |

  `clearanceExpandedCandidatePairs` reading `0` on a `broadPhase:'linear'` clearance call is
  **structural, not a bug** — only the TLAS broad phase increments it. Read
  `clearanceExactAabbSurvivors` for the cross-path candidate count.

  The generic M1/M2 fields keep their existing meanings on a clearance call and are **not** left
  unset: `broadPhasePairs`, `narrowPhasePairs`, `broadPhaseMs`/`narrowPhaseMs`/`totalMs`, and (under
  `broadPhase:'tlas'`) the nine `tlas*` fields are all populated at the analogous points in
  clearance's own traversal. Note that the *code* doing so is a deliberate structural twin
  (`_runClearanceTlasBroadPhase`), not the same function Hard Clash uses — the fields mean the same
  thing, but the two implementations are kept in sync by hand.

**Diagnostics — read this before trusting an empty result.** `statistics.diagnostics` is an array
of `{ scope: 'fragment' | 'pair', reason, ... }` entries describing anything the query could not
fully resolve: a fragment whose geometry wasn't loaded yet, one that was structurally rejected
(oversized/unsupported layout), or a narrow-phase traversal that hit its own time/candidate budget
and aborted. **A non-empty `diagnostics` array means the boolean/pair result may be incomplete** —
an empty `pairs` array in that situation is not the same statement as "no clash exists." Consumers
must surface this, not silently treat it as a clean negative (see the reference sample's own
`describeDiagnostics` / user-facing caveat for the expected pattern).

**M2.1 exception: `reason: 'witness-unavailable'` diagnostics do not count toward that caveat.** A
`witness-unavailable` entry means a `volume-overlap` pair's verdict was fully and correctly
evaluated but a marker point could not be captured for it — the pair result itself is complete, not
incomplete, so `ClashFinderExtension` (and any other consumer) must not fold `witness-unavailable`
entries into its "result may be incomplete" caveat computation the way it does for every other
diagnostic reason above. The existing developer-facing `console.warn` log is unpartitioned and still
logs every diagnostic, `witness-unavailable` included — only the user-facing completeness caveat is
partitioned.

**M3: four new clearance diagnostic reasons.** Emitted only by a `mode: 'clearance'` call:

| Reason | Scope | Emitted when |
|---|---|---|
| `clearance-invalid-transform` | **fragment**, deduped per `(epoch, fragmentId)` | Clearance's own admission validation found a non-finite/singular `worldMatrix`, or non-finite/mis-ordered `worldBounds`, for an extracted instance. Fires **before any pair exists** — it is an admission-time filter, not a pair evaluation. |
| `clearance-anisotropic-scale-unsupported` | **fragment**, deduped per `(epoch, fragmentId)`, one per offending side — with one rare exception, see the note below the table | An operand's `worldMatrix` failed `validateUniformScale` — anisotropic, sheared, reflected/negative, or otherwise unsupported scale. Diagnosed, never approximated. |
| `clearance-hard-clash-precheck-inconclusive` | **pair** (`sourceFragment` + `targetFragment`) | The tri-state Hard-Clash exclusion precheck could neither prove nor disprove volume overlap for this fragment pair (e.g. its crossing term hit `frameBudgetMs`), so the pair was dropped rather than assumed non-overlapping. |
| `clearance-distance-unavailable` | **pair** (`sourceFragment` + `targetFragment`) | `clearanceQuery` reached `closestPointToGeometry` but could not produce a trustworthy answer: a non-finite local distance, a failed world-space conversion of a closest point, or the two independently-derived world distances disagreeing beyond the documented cross-check tolerance. |

**Scope caveat on `clearance-anisotropic-scale-unsupported`.** It is fragment-scoped on the ordinary
emission path — the `validateUniformScale` rejection, which is where every realistic occurrence comes
from — but it **can** be emitted **pair**-scoped (`sourceFragment` + `targetFragment`, no
`role`/`fragment`, undeduped) in one extremely rare case: `clearanceQuery`'s own anchor-inverse guard
aborts with this same reason when the anchor operand's scale is uniform and *accepted* by
`validateUniformScale` yet small enough that `Matrix4.invert()`'s `1 / determinant` overflows to
`Infinity` — i.e. an affine determinant strictly between `0` and `1 / Number.MAX_VALUE`
(`≈ 5.5627e-309`), which for a uniform scale `s` (determinant `s³`) means `s` strictly between
`≈ 1.36e-108` and `≈ 1.772e-103`. Consumers that switch on `scope` for this reason must tolerate both
shapes.

**All four count toward "the result may be incomplete."** In particular
`clearance-distance-unavailable` and `clearance-hard-clash-precheck-inconclusive` **do** count —
this is the **opposite** partitioning from M2.1's `witness-unavailable` carve-out above, and the
M2.1 precedent deliberately does **not** transfer. The reason is not stylistic: for
`volume-overlap`, the boolean clash verdict is already fully determined by the time witness capture
fails, so the pair result is complete and only the marker is missing. For `clearance`, **the
distance itself is the verdict** — if the distance can't be evaluated (or the Hard-Clash precheck
can't be resolved), there is no fallback source of truth for whether that pair is within threshold,
so the answer genuinely is incomplete. A consumer must not fold clearance diagnostics into a
`witness-unavailable`-style carve-out.

Note also the scope split above: the two fragment-scoped reasons dedup per `(epoch, fragmentId)` in
their own independent namespaces (never shared with each other or with `oversizedDiagnosedFragments`),
and `clearance-invalid-transform` in particular fires before any pair has been formed — so counting
diagnostics is not the same as counting affected pairs.

## Model lifecycle: admission, eviction, dispose

`CollisionWorld` tracks Viewer `Model` objects through an explicit lease/lifecycle state machine:

- **`admitModel(model)`** — starts (or re-fetches) a lease `{ model, epoch }` for a model.
  Idempotent while the model is live (same epoch, no new epoch consumed). You rarely need to call
  this yourself — `findClashes` lazily admits a never-seen model automatically.
- **`evictModel(model)`** — releases all epoch-scoped state (geometry cache, BLAS cache) for that
  model. Call this from the Viewer's `BEFORE_MODEL_UNLOAD_EVENT`. **A model that has ever been
  evicted can never be re-admitted** — a fresh model object (e.g. after the Viewer reloads it) gets
  a fresh lease instead. `evictModel` never throws, even on an already-disposed world (it's
  intentionally a safe no-op there — see the class's own comments for why).
- **`isModelLive(model)` / `isLeaseValid(lease)`** — liveness checks. `isLeaseValid` never throws
  (total/non-throwing by design); `isModelLive` throws `WorldDisposedError` on a disposed world.
- **`dispose()`** — terminal. Releases everything the world owns. **Every other public method
  throws `WorldDisposedError` on a disposed world, and so does a second `dispose()` call** — a
  disposed `CollisionWorld` cannot be reused; construct a new one via `fromViewer` instead.
- **`invalidateModelPlacement(model)`** — marks an admitted model's placement (worldMatrix/
  worldBounds) stale, for **discrete, caller-controlled** federated coordination actions: a
  model-level alignment/move/rotate/translate performed **once**, e.g. by a coordination tool.
  **Not** for continuous per-frame movement, explode views, or animation of any kind — those remain
  unsupported by this call and by the library generally. Throws `WorldDisposedError`/
  `ModelEvictedError`, no-ops for a never-admitted model. **M2 Batch 4 status: real, wired.** A
  `broadPhase:'tlas'` query (`findClashes`'s own default for the new `targets` shape — see below)
  re-reads placement fresh from the Viewer before consulting a stale TLAS entry, triggered by this
  method's own invalidation record. `broadPhase:'linear'` never consults this record at all (it
  re-derives placement fresh from extraction on every call, unconditionally) and gains nothing from
  calling this method.

Errors thrown across this surface (`collision/index.js` re-exports all of them):
`WorldDisposedError`, `ModelEvictedError`, `RenderProxyUnavailableError` (transient, handled
internally per-candidate-pair — not usually something a consumer needs to catch),
`ObjectTreeUnavailableError`, `CapacityExceededError`, `ModelPlacementChangedError`, and
`ExtractionLimitExceededError` — thrown out of `findClashes` if a query's dbId walk exceeds
`maxFragmentsPerDbId` or `maxChildrenPerNode` (both in `collision/constants.js`) while enumerating a
requested dbId's own fragments/children.

**`ModelPlacementChangedError`** — `{ modelId, loadEpoch, expectedRevision, actualRevision }` — is a
real, user-facing M2 signal: it is thrown when a `broadPhase:'tlas'` call's composite checkpoint or
pre-insertion check detects that a captured model's placement revision changed **mid-call**, for a
reason the query did not itself cause, and cannot safely absorb it. The model is still live (unlike
`ModelEvictedError`) — its input geometry may simply have moved out from under an in-flight query.
Callers should retry the query. This is distinct from `TlasCache`'s own private, internal
`'superseded'` retry signal, which is **never** surfaced to callers — `CollisionWorld` re-derives
fresh state and retries that case internally on the caller's behalf.

## `groupBy: 'dbId'`

The only supported grouping in M1: results are reported per `dbId` pair, not per raw fragment.
Internally, every fragment under a given `dbId` is checked, but only the owning `dbId`s appear in
`pairs` — `ownerDbId` is captured once per fragment at extraction time (first-discovery-wins) and
is never re-derived from the query's own `dbIds` arrays, so it reflects where the geometry actually
lives even for multi-instance/nested elements.

## Current Viewer-version assumptions

- Developed and tested against **Autodesk Viewer `7.124.2`**. Raw fragment geometry parsing
  (`collision/viewer/ViewerGeometryAdapter.js`) recognizes specific internal buffer-layout shapes
  confirmed by decompiling that exact bundle version — an internal Viewer geometry-format change in
  a later version could require adding a new recognized shape.
- Assumes the Viewer's own three.js global is `window.THREE` at revision r71 (confirmed for
  `7.124.2`; the spec's original assumption of `Autodesk.Viewing.Private.THREE` was wrong — see
  `spike/FINDINGS.md`, finding B1). The library's own three.js (r185, via `three-mesh-bvh`) is kept
  strictly isolated from that global — see the runtime-isolation check in `test/README.md`.

## Known Milestone-1 limitations

- **Requires a locally-patched `three-mesh-bvh@0.9.14`.** The stock, unpatched npm package has two
  confirmed correctness defects that produce wrong `mode: 'clearance'` distances (and, more rarely,
  false `null`/`beyond-threshold` results) — see
  `docs/research/m4-three-mesh-bvh-patch-provenance.md` for the full defect analysis, the delivery
  mechanism (`patch-package`, reapplied automatically on every `npm install`/`npm ci`), and the
  residual failure modes (e.g. `--ignore-scripts`) that leave it unpatched. This repo ships the patch
  in-tree (`patches/three-mesh-bvh+0.9.14.patch`); a checked-in regression test
  (`test/vendor/three-mesh-bvh-patch-integrity.test.mjs`) fails loudly if it is ever silently reverted.
- **Undocumented/internal Viewer surfaces.** Fragment geometry extraction goes through
  `viewer.impl.getRenderProxy(model, fragId)` and reads internal, undocumented buffer-layout shapes
  (`vb`/`vbstride`, legacy interleaved attribute layouts) reverse-engineered from the real
  `viewer3D.js` bundle. This is inherently version-fragile; it is not a documented, stable public
  API contract.
- **No state continuity across extension replacement.** Unloading and reloading the sample
  extension (or any consumer following the same `load()`/`unload()` pattern) constructs a brand-new
  `CollisionWorld` from scratch — no cache, room-resolution, or lease state survives a
  replacement. This is an accepted M1 behavior, not a bug to work around.
- **Current broad phase is the M1 implementation, not a future acceleration structure.** Candidate
  pairs are found via a plain world-space AABB overlap scan (`O(sourceCount × targetCount)`,
  capped by `maxBroadPhaseInstancePairs`) — there is no spatial acceleration structure (e.g. a
  TLAS) over instances yet. Fine at the scale M1 was measured against; a future milestone's problem
  to accelerate further. **Superseded by M2 for the new `targets` shape** — see below.

## M2: `broadPhase` and the TLAS-accelerated path

`findClashes` accepts an optional `broadPhase: 'linear' | 'tlas'`. The default is **shape-dependent**
(spec §3.5): the legacy `target: {model, dbIds}` shape defaults to `'linear'`; the new
`target: {targets: [...]}` shape defaults to `'tlas'`. Either shape may pass `broadPhase` explicitly
to override its own default — `'linear'` always forces the M1 scan, and is the correctness oracle
both fixtures and any doubt about the TLAS path can fall back to
(`test/CollisionWorld.tlasTraversal.test.mjs`'s own differential tests assert `'tlas'` and `'linear'`
always produce identical `pairs`).

**`'linear'` keeps M1's cost model and placement-freshness behavior (re-derives placement fresh from
extraction on every call, unconditionally) unchanged — with one deliberate, narrow exception: source
self-exclusion now applies to it too.** M1 had no self-exclusion concept and counted/retested every
candidate pair unconditionally, including a pathological self-pair from a caller passing an
overlapping dbId on both `source` and `target`. M2 does not special-case the legacy single-model
shape for this — self-exclusion (`isSourceOwnFragment`) is applied before `broadPhasePairs` is
incremented and before `_testBroadPhasePair` ever runs, exactly as it is for the `'tlas'` path
(`CollisionWorld.js`'s own `_runBroadPhaseScan` comment documents this exact point, with a dedicated
compatibility test covering it). So describe `'linear'` as "M1-equivalent except for uniform source
self-exclusion," not as byte-for-byte identical to M1 in every case.

`maxTlasCandidatePairs` (`collision/constants.js`) bounds TLAS candidate expansion, checked
incrementally during traversal (not an upfront precheck like `maxBroadPhaseInstancePairs`, which is
not applied at all under `broadPhase:'tlas'` — a TLAS call's real cost is not proportional to
`sourceCount × targetCount`, so that precheck would reject queries the TLAS exists to make cheap).
The budget check is **conservative-range, not per-primitive-exact**: it is driven by
`CollisionInstanceBVH.queryBox`'s own `onLeafRange` raw leaf-expansion count (upstream of the
target-scope filter, self-exclusion, and the exact-overlap retest — spec §9.3.1), so a single leaf
whose count crosses the limit can push the internal counter past it by up to that leaf's own size
before the check fires. This never under-throws (a genuine overflow is never silently missed) and
never affects returned results (the call throws regardless) — the thrown
`CapacityExceededError('tlas-candidate-budget', ...)`'s `completed`/`attempted` fields are always
exactly `{limit, limit + 1}`, per spec §9.3.2, regardless of the real overshoot amount.
- **Extreme local aspect-ratio ceiling.** `maxLocalAspectRatio = 10,000` (max/min local AABB
  extent) is the declared supported bound — gated on `containment`'s **target** operand
  (`ContainmentModeQuery.js`) and on **both** operands of `volume-overlap` (`VolumeOverlapQuery.js`);
  `surface-intersection` never checks it. `collision/constants.js` documents the reasoning: 10,000
  is a **reasoned safety margin, not a measured pass/fail line** — the ~354,000:1 failure onset it's
  compared against is itself a *derived estimate* from the file's own max/min-local-extent metric,
  not a live measured test run at that scale. A known, tracked-but-not-fixed test gap exists at
  2,000,000:1 (`test/query/ContainmentQuery.classifyPoint.test.mjs`, `{ todo: true }`) — this is an
  accepted M1 gap, not a regression.
- **Other tunable budgets, all in `collision/constants.js` and all provisional** (not final,
  revise-if-measured-otherwise): `maxSyncTriangleCount` (12,000 triangles per synchronous geometry
  build — measured/confirmed by the performance gate), `maxFragmentsPerDbId` (5,000),
  `maxChildrenPerNode` (10,000 — **not exercised** by the performance gate, see below),
  `maxBroadPhaseInstancePairs` (1,000,000 — measured), `maxCollisionInstancesPerEpoch` (20,000 —
  measured at 27% headroom on the gate's test model). A query that exceeds
  `maxFragmentsPerDbId`/`maxChildrenPerNode` throws `ExtractionLimitExceededError`; one that exceeds
  `maxBroadPhaseInstancePairs` throws a plain `Error` from `findClashes` before any side effect.
- **A test-suite timing note, not a runtime limitation:** some `findClashes` test fixtures rely on
  a traversal-decided positive result and are, by construction, wall-clock sensitive under heavy
  concurrent test-runner load (`test/CollisionWorld.findClashes.dispatch.test.mjs` documents this
  and freezes the clock to avoid it in CI). This does not affect production behavior.
- **Instance-tree readiness is only partially handled.** `findClashes` waits for the Viewer's
  object tree to exist before extracting geometry, but does not wait for it to be fully *populated*
  if it exists in an under-enumerated state — see
  `docs/superpowers/specs/instance-tree-readiness-decision.md` ("Mode 2", explicitly left open).
- **Performance-gate items recorded as `NOT EXERCISED`, not failing.** The real performance gate
  (`docs/superpowers/specs/milestone-1-performance-gate-disposition.md`) passed all 12 criteria it
  could exercise on the model available, but 3 of the 12 could not be triggered at scale by that
  model and are honestly recorded as unexercised rather than assumed-passing:
  - Criterion 7 — `maxChildrenPerNode` (10,000) fanout ceiling: no node in the test model had more
    than 124 children.
  - Criterion 8 (precheck half) — over-capacity rejection: the test model's total fragment count
    (5,425) never approached `maxCollisionInstancesPerEpoch` (20,000).
  - Criterion 11 — `ViewerGeometryAdapter`'s `O(ranges)` normalization scaling: the most-fragmented
    geometry found had only 1 range.

  None of this blocks usage — it means these three specific edge cases have not yet been proven
  against a real model at the scale that would trigger them.

## M3: Soft Clash / Clearance

`mode: 'clearance'` answers a different question from the three M1/M2 modes: not "do these two
things touch or overlap?" but "do they come *too close* without overlapping?" It is the only mode
that returns a **numeric** result (`distance`) rather than a boolean verdict, and that changes what
counts as an incomplete answer (see Diagnostics above).

**The exact contract**, evaluated per source/target fragment pair and then aggregated to dbId level:

```
Soft Clash iff:
  NOT volume-overlap(source, target)              // reuses the existing, unmodified Hard Clash predicate
  AND distance > toleranceFloor                   // exclusive — "touching" is not a clearance violation
  AND distance <= clearance                       // inclusive threshold
```

So the distance line is partitioned as: `{0} ∪ (0, toleranceFloor]` = touching or dead band
(reported by no mode at all), `(toleranceFloor, clearance]` = Soft Clash, `(clearance, ∞)` = not
reported.

**Hard Clash exclusion is semantic, not numeric.** A dbId pair with *any* contributing fragment pair
that is a real `volume-overlap` under the same query scope is excluded from clearance results
outright — it is never merely "distance-filtered out." This matters because `containment`-style
overlap has no surface-crossing requirement: a fully enclosed component's surfaces can sit a large
measured distance from its container's surfaces, so distance alone would happily misreport an
enclosed element as a near miss. The exclusion is therefore implemented by querying the existing
`volume-overlap` predicate through a **tri-state** precheck (`excluded` / `proceed` / `inconclusive`,
plus a `skip-precheck` fast path for provably disjoint AABBs). The tri-state never collapses to a
boolean: an `inconclusive` precheck drops the pair **with a diagnostic**, and is never silently
treated as "proven no overlap."

**The tolerance floor.** `collision/query/ClearanceTransform.js`'s `computeToleranceFloor`:

```
toleranceFloor = surfaceEpsilonFactor × max(source.localDiagonal × source.scaleFactor,
                                            target.localDiagonal × target.scaleFactor)
```

`surfaceEpsilonFactor` is the library's existing `1e-6` near-zero convention, reused rather than
inventing a new epsilon. The load-bearing detail is the **per-operand conversion to world units
before the `max()`**: `localDiagonal` is a local-frame quantity, and comparing it against a
world-space distance without first multiplying by that operand's own validated uniform scale factor
mixes two frames and silently produces a floor that is wrong by the scale ratio. What the floor
protects against is reporting numerical surface noise as a clearance violation — two surfaces
separated by ~`1e-6` of their own size are, for this library's purposes, touching, and touching is a
Hard Clash concern, not a Soft Clash one. It is also the source of the dead band documented under
"Known M3 limitations" below.

**Uniform scale only — diagnosed, never approximated.** Every clearance operand's `worldMatrix` must
decompose to rigid motion plus **positive uniform scale**. `validateUniformScale`
(`collision/query/ClearanceTransform.js`) rejects, structurally rather than by magnitude alone:
non-finite elements, a projective bottom row, a non-finite or exactly-zero determinant (checked
*before* trusting `Matrix4.decompose()`, which silently reports scale `(1,1,1)` for a degenerate
matrix), reflected/negative scale, per-axis scales that disagree by more than
`clearanceUniformScaleRelativeTolerance` (`1e-4` relative, `collision/constants.js`), and
shear/non-orthogonal basis columns. Anything rejected produces a
`clearance-anisotropic-scale-unsupported` diagnostic — the pair is never evaluated with an
approximated transform.

**The documented error bound that buys.** When a matrix *is* accepted, the single `scaleFactor` the
validator reports may differ from any one axis's true scale by up to `1e-4` relative, so a world
distance derived from it carries a bounded relative error of that same order. This is a real,
declared approximation, not silently-exact arithmetic. Two downstream constants exist purely to keep
that admitted slack from producing false results rather than merely imprecise ones:
`clearanceDistanceCrossCheckCombinedRelativeTolerance` (`3e-4` — the same world distance is derived
independently from *each* operand's own scale factor and cross-checked; two validator-blessed
operands can err in opposite directions, so the naive `1e-4` bound would spuriously abort on input
the validator itself accepted), and `clearanceTraversalThresholdSafetyMargin` (`4e-4`, i.e. `4 ×
1e-4`), which widens the BVH traversal threshold by 0.04% so that float32 node padding rather than
geometry can't decide a candidate sitting exactly at `clearance`. The widened threshold is safe
because `clearanceQuery` **always** applies an exact `worldDistance > clearance` post-filter
afterwards — a more permissive traversal can only cost a little extra traversal, never admit a
result beyond `clearance`.

**Geometry resolution is the shared path, not a second one.** Clearance's narrow phase resolves
each operand's BLAS/geometry record through `resolveGeometryRecord`/`diagnoseFragmentOnce` — the
*identical* functions the three pre-existing modes use. These were genuinely extracted (M3 Task 9)
out of `_runNarrowPhasePair`'s own private closures and `_runNarrowPhasePair` rewritten to call
them, with the full existing regression suite proving zero observable behavior change for
`surface-intersection`/`containment`/`volume-overlap`. Clearance did not get a parallel, divergent
geometry path. (The TLAS *broad* phase is the one place where a deliberate structural twin exists
instead — see the statistics note above.)

**Budgets and provisional constants.** All of the following are explicitly **provisional** — chosen
by reasoning, kept because the M3 performance gate found no evidence to change them, and revisable
the moment real usage says otherwise:

| Constant | Value | Where | Measured evidence (Task 18 gate) |
|---|---|---|---|
| `maxClearanceNarrowPhasePairs` | 20,000 | `collision/constants.js` | **9.89% used** (1,978 candidates) by a single-source-instance query against the whole ~7,474-fragment federated scene. Exceeding it throws `CapacityExceededError('clearance-narrow-phase-budget')`, checked as one upfront preflight on the assembled candidate list — not incrementally during traversal. |
| `DEFAULT_CLEARANCE` | 0.05 world units | `wwwroot/extensions/ClashFinderExtension.js` — **not** the library | The value the whole M3 gate and the live positive acceptance case were measured at. A caller may override it via `options.defaultClearance`, validated at `load()` time. |
| `clearanceUniformScaleRelativeTolerance` | `1e-4` | `collision/constants.js` | Not retuned; the spec left it qualitative ("a small relative tolerance") and it was matched to the existing weld-epsilon order of magnitude. |
| `clearanceDistanceCrossCheckRelativeTolerance` | `1e-4` | `collision/constants.js` | Same. Derived constants `…CombinedRelativeTolerance` (`3e-4`) and `clearanceTraversalThresholdSafetyMargin` (`4e-4`) follow from it. |

**No constant was changed by the M3 performance gate** — it implemented the measurement, not the
revision.

**Measured cost, briefly** (`test/performance/run-gate-m3.mjs`, real 3-discipline federated fixture;
full write-up in `CHANGELOG.md`'s "M3 performance gate" section and `test/performance/README.md`):
worst single `clearanceQuery` call **6.10–6.50 ms** against `frameBudgetMs = 8` over ~500–520 real
production spans with **zero** over budget — a **GO**, but on roughly 20–24% headroom, which is thin,
not comfortable. TLAS reduced clearance broad-phase candidates **3.78x** (1,978 vs. 7,473), bit-identical
across every run. The surprising finding: `clearanceQuery` is **not** the dominant cost — 96.7% of
candidates reach the Hard-Clash precheck while only 6.6% ever reach a distance query, so ~89% of warm
narrow-phase time is geometry resolution plus that precheck. Future clearance-performance work should
target the precheck, not `ClearanceQuery`.

## Reference sample: Room Locator

`wwwroot/extensions/RoomLocatorExtension.js` is the Milestone-1 reference integration — a real
Viewer extension built entirely on this library's public surface (`fromViewer`, `findClashes`,
`admitModel`, `isLeaseValid`, `evictModel`, `isModelLive`, `dispose` — it never reaches into
`CollisionWorld` internals).

**What it does:** given a selected element's `dbId`, it finds which Revit `Rooms`-category
element(s) contain it (`mode: 'containment'`), then isolates and fits the view to the result.

**Starting it:** it's already wired into `wwwroot/main.js`/`viewer.js` — start the app (`npm start`)
and open a model at `http://localhost:8080/#<URN>`. The known acceptance model (Autodesk's RAC
basic sample project) is
`dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL3JhY2Jhc2ljc2FtcGxlcHJvamVjdC5ydnQ`.

**Exercising it:**
1. Select an element in the 3-D view (or via the Model Browser search — see below).
2. Right-click it → choose **"Locate Room"** from the context menu.
3. On success, the Viewer isolates and fits to the containing room(s); a clean "no room found"
   negative surfaces via `console.warn` only. **`alert()` fires only when `statistics.diagnostics`
   was non-empty** (the result may be incomplete), on either outcome — this app has no toast/
   notification framework, so `alert` is the established "the user must see this" convention
   (matches `wwwroot/viewer.js`'s own error path). A thrown error from the locate action itself
   goes to `console.error` only, no `alert()`.

**Known acceptance example:** searching the Model Browser for
`Bathtub-TOTO-Nexus-FBF794S [420270]` (dbId `2530`), right-clicking it, and choosing "Locate Room"
isolates to **Master Bath 207** (dbId `3885`) — matching `spike/FINDINGS.md`'s known-in-advance
ground truth (907 of the bathtub's 1003 world-space vertices classify inside that room; all 13
other rooms score 0). Verified against a live server and both an automated Playwright run
(`test/acceptance/room-locator.acceptance.mjs`, 12/12 assertions) and a manual click-through.

**"No containing room found":** surfaced via `console.warn` plus an `alert()` — this is the correct,
expected outcome for any element genuinely outside every `Rooms`-category element (e.g. outdoor
furniture), not an error. If `findClashes` also reported diagnostics, the alert explicitly says the
result "may be incomplete" rather than reading as a plain negative.

**Generic library usage vs. Room-Locator-specific glue:**

| Generic (reusable for any collision-library consumer) | Room-Locator-specific |
|---|---|
| `CollisionWorld.fromViewer` in `load()`, `dispose()` in `unload()` | Resolving "room" dbIds via `model.search('Revit Rooms', ...)` |
| `evictModel` wired to `BEFORE_MODEL_UNLOAD_EVENT` | The per-model room-dbId cache (`Map<Model, Promise<number[]>>`) |
| `findClashes({ mode: 'containment', groupBy: 'dbId' })` call shape | The context-menu "Locate Room" UI entry and `alert()`-based caveat surfacing |
| Reading `statistics.diagnostics` to detect an incomplete result | `describeDiagnostics()`'s specific message formatting |

## Reference sample: Clash Finder

`wwwroot/extensions/ClashFinderExtension.js` is the Milestone-2 reference integration — a real
Viewer extension built entirely on this library's public surface (`fromViewer`, `findClashes`,
`evictModel`, `dispose` — it never reaches into `CollisionWorld` internals), sibling to
`RoomLocatorExtension.js` but exercising the new cross-model `targets` shape and `mode:
'volume-overlap'` end to end.

**What it does:** given exactly one selected source element — via `viewer.getAggregateSelection()`,
**never** `getSelection()`, which returns bare dbIds with no model provenance — it finds every Hard
Clash (`mode: 'volume-overlap'`) between that source and every currently loaded model, including
the source's own model. `CollisionWorld`'s own source self-exclusion is what keeps the source
element out of its own results; the extension deliberately never pre-filters the source model out
of the target list, nor post-filters the source dbId out of any result. On success it isolates and
fits the view to every involved `Model`, source included.

**Starting it:** it's already wired into `wwwroot/main.js`/`viewer.js` alongside Room Locator —
start the app (`npm start`) and open a model. To exercise the cross-model path you need a SECOND
(and optionally third) model loaded in the same session: check **"Load as additional model"**
(`#keep-current-models`, `wwwroot/index.html`) before loading the next URN — this keeps the
already-loaded model resident instead of replacing it, giving the Viewer a genuinely federated
scene for "Find Clashes" to query.

**Exercising it:**
1. Load one model normally, then check "Load as additional model" and load a second (and
   optionally third) model into the same session.
2. Select exactly one element in the 3-D view — the context-menu entry only appears when
   `getAggregateSelection()` has exactly one entry whose own selection is exactly one dbId; any
   other shape (no selection, multiple models, or multiple dbIds) is unsupported in M2 and the
   entry does not appear.
3. Right-click it → choose **"Find Clashes"**.
4. On success, the Viewer isolates and fits to every clashing element (plus the source) across
   every involved model. Unlike Room Locator's quieter silent-on-clean-success convention, this
   workflow's own result is always reported via `alert()` — `"N clashes found (X in this model, Y
   in other models)"` or `"No clashes found."` — every single call, per the spec's own "UI reports"
   requirement. As with Room Locator, a non-empty `statistics.diagnostics` appends "The result may
   be incomplete — …" to that same alert, on either outcome, rather than letting it read as a plain
   negative/positive.

**Known acceptance example** (`test/acceptance/clash-finder.acceptance.mjs`, live-verified against
a real federated 3-discipline Revit host+links scene — an Architecture host file
(`Audubon_Architecture_clash_test.rvt`, 5,435 fragments, loaded first) plus its Structure
(`Audubon_Structure_clash_test.rvt`, 543 fragments) and Mechanical
(`Audubon_Mechanical_clash_test.rvt`, 1,496 fragments) links, each independently translated and
loaded second/third via "Load as additional model" — ~7,474 total fragments, one real coordinated
building genuinely modeled by three disciplines):

- Selecting dbId `2734` in the Structure model ("SMBH-W-Wide Flange [272782]", a steel beam) and
  choosing "Find Clashes" against all three loaded models finds **2 pairs** — one cross-model hit
  (Architecture model, dbId `3686`) and one same-model hit (Structure model, dbId `3663`) — with 12
  diagnostics, so the alert carries the "may be incomplete" caveat.
- Selecting dbId `3965` in the Structure model ("HSS-Hollow Structural Section-Column [681589]", a
  real column) finds **0 pairs, 0 diagnostics** — a genuine, diagnostic-free negative: "No clashes
  found." with no caveat appended.

**Same-model vs. cross-model classification:** done by comparing `pair.target.model` against the
source's own `Model` object with strict `===` identity — **never `modelId`**, which is documented
elsewhere in this library as reused-under-collision-prone across a session and non-load-bearing for
identity comparisons.

**Diagnostics/caveat handling:** the identical pattern to Room Locator — a static
`describeDiagnostics` helper (count + distinct reasons, not every entry) and the same
`alert()`-based `_notifyUser` convention, reused verbatim rather than reinvented.

**Generic library usage vs. Clash-Finder-specific glue:**

| Generic (reusable for any collision-library consumer) | Clash-Finder-specific |
|---|---|
| `CollisionWorld.fromViewer` in `load()`, `dispose()` in `unload()` | The aggregate-selection shape check (exactly one model, one dbId) gating the "Find Clashes" context-menu entry |
| `evictModel` wired to `BEFORE_MODEL_UNLOAD_EVENT` | The per-invocation action token that discards a superseded (not failed) in-flight "Find Clashes" call |
| `findClashes({ mode: 'volume-overlap', groupBy: 'dbId', target: { targets: [...] } })` call shape | Grouping every involved dbId by its own `Model` object (`===`, never `modelId`) across every model, then isolating/fitting once per model |
| Reading `statistics.diagnostics` to detect an incomplete result | `describeDiagnostics()`'s specific message formatting; the unconditional "N clashes found"/"No clashes found" report on every call |

## Reference sample: Find Soft Clashes

`wwwroot/extensions/ClashFinderExtension.js` gained a **second, fully independent** context-menu
action in M3 — **"Find Soft Clashes"** — living alongside "Find Clashes" in the same extension
rather than being a mode toggle grafted onto it. That was deliberate: the existing Hard Clash flow
and its live acceptance coverage stay entirely untouched, and no modal/settings UI was needed.

**What it does:** same single-element aggregate-selection gate as "Find Clashes" (exactly one model,
exactly one dbId — via `viewer.getAggregateSelection()`, never `getSelection()`), same whole-model
`targets` scope across every loaded model including the source's own. It issues
`findClashes({ mode: 'clearance', clearance: this._clearance, groupBy: 'dbId', target: { targets: [...] } })`,
then isolates, fits, draws its own visualization, and reports the result via the same
`alert()`-based `_notifyUser` convention — `"N clashes found (X in this model, Y in other models)"`
or `"No clashes found."`, on every call, with the same "The result may be incomplete — …" caveat
appended when the result carries completeness-affecting diagnostics.

**The clearance value:** resolved **once**, in `load()`, as
`this._clearance = this.options.defaultClearance ?? DEFAULT_CLEARANCE` (`0.05` world units) and
validated immediately (finite, `> 0`). An invalid caller-supplied override fails `load()` itself with
a thrown error — a loud configuration-time failure, not a per-click failure deep inside a
context-menu callback. There is no per-call UI for the threshold; the action is always invocable with
zero configuration.

**Independence from Hard Clash — the parts that are genuinely separate:**

- **Its own action token.** `_latestSoftClashActionToken` is monotonic and completely separate from
  Hard Clash's `_latestActionToken`. Firing one action never cancels or is cancelled by an in-flight
  run of the other; each code path reads and writes only its own token. Being superseded by another
  *Soft Clash* action is discarded silently (a supersession is not a failure); a genuine error clears
  Soft Clash's own isolation contribution and overlay and surfaces the message.
- **Its own overlay scene and color.** `SOFT_CLASH_OVERLAY_NAME = 'clash-finder-soft-markers'` is a
  separate registered overlay scene from Hard Clash's `MARKER_OVERLAY_NAME`, and
  `SOFT_CLASH_COLOR = 0x2b8fff` (blue) is visually distinct from Hard Clash's orange `MARKER_COLOR`.
  Both scenes can be registered and visible at the same time, and running one action leaves the
  other's markers untouched.
- **Its own radius clamp.** `SOFT_CLASH_MIN_MARKER_RADIUS` (0.05) / `SOFT_CLASH_MAX_MARKER_RADIUS`
  (2.0), reusing the *shared* `MARKER_RADIUS_FRACTION` rather than a second fraction constant.

**The visualization, per clearance pair:** two small sphere `Mesh`es — one at `witness.sourcePoint`,
one at `witness.targetPoint` — plus **one connecting `THREE.Line`** between them. That's three
objects per pair, versus Hard Clash's single marker: a clearance result's whole point is the *gap*,
so the pair of endpoints and the segment spanning them is the useful picture. One shared
`SphereGeometry`, one shared sphere `MeshBasicMaterial`, and one shared `LineBasicMaterial` are
reused across every object the extension ever creates; the **line geometry alone is per-pair** (each
line needs its own two vertices) and is disposed individually on clear, while the shared trio
outlives clear/re-add cycles and is disposed only in `unload()`. `depthTest: false`, same as Hard
Clash, so a marker inside occluding geometry stays visible. All overlay objects are built from the
Viewer's own `window.THREE` (r71), never the collision library's imported `three` (r185).

**A zero-pair Soft Clash query leaves no trace at all.** The early return on `pairs.length === 0`
happens before `_addSoftClashVisualization` — the only caller of `_ensureSoftClashOverlay` — so the
overlay scene is never even *registered* and the shared geometry/material are never allocated. Not
"an empty scene": no scene. This mirrors Hard Clash's own `_addMarkers` contract, and was confirmed
live (a first-draft acceptance assertion expecting an empty scene failed and was corrected to assert
this instead).

**Isolation is a UNION; `fitToView` is not.** Each action tracks its **own** isolation contribution
(`_setHardIsolation` / `_setSoftIsolation`), and either one changing triggers a reconciliation that
applies the union of both contributions to the Viewer. So running "Find Soft Clashes" after "Find
Clashes" *adds* its elements to what is isolated instead of clobbering the previous result. Camera
framing is deliberately **not** unioned: `fitToView` frames only what *this* action just found.
Verified live in M3 acceptance — one run isolated Structure `[2734, 3663, 3965, 3976, 4135]` (the
union of both actions' contributions) while `fitToView` framed only `[3965, 3976, 4135]`.

**Lifecycle.** Soft Clash's teardown is wired in as a new **outermost** `finally` around the existing
Hard Clash cleanup in both `unload()` and the `BEFORE_MODEL_UNLOAD_EVENT` handler, so each rung runs
regardless of whether an inner one threw. Both tokens are bumped at the top of `unload()`, before any
teardown. A model unload clears Soft Clash's overlay *objects* while leaving the overlay *scene*
registered; only `unload()` removes the scene and disposes the shared geometry/materials — exactly
the split Hard Clash's own `_clearMarkers`/`unload` contract already documents.

**Known acceptance example** (`test/acceptance/clash-finder.acceptance.mjs`, live-verified against
the same real 3-discipline Audubon federated fixture): selecting Structure dbId `3965`
("HSS-Hollow Structural Section-Column [681589]" — the same element that is a *diagnostic-free
negative* for Hard Clash) and choosing "Find Soft Clashes" at the production default clearance
(`0.05`, **no override**) finds **2 pairs**: Structure `3976` and Structure `4135`, two HSS members
that stop just short of the column, both at a measured distance of **0.0417** world units. The same
element at clearance `0.02` correctly finds **0 pairs** — the same source, through the same
production action, is genuinely threshold-sensitive. The `0.0417` gap is independently corroborated
against the `InstanceTree`'s own node boxes (`0.041667938` vs. the measured `0.041666163`, agreeing
to Float32 quantization) — a cross-check that uses no part of the collision pipeline.

**Generic library usage vs. Soft-Clash-specific glue:**

| Generic (reusable for any collision-library consumer) | Soft-Clash-specific |
|---|---|
| `findClashes({ mode: 'clearance', clearance, groupBy: 'dbId', target: { targets: [...] } })` call shape | Resolving and validating `this._clearance` once in `load()` from `options.defaultClearance ?? DEFAULT_CLEARANCE` |
| Branching on `pair.type` before reading `pair.witness` (two witness shapes exist) | The two-sphere-plus-connecting-line rendering of `witness.sourcePoint`/`witness.targetPoint` |
| Reading `statistics.diagnostics` to detect an incomplete result | A second, independent action token so the two clash actions can never cancel each other |
| `evictModel` wired to `BEFORE_MODEL_UNLOAD_EVENT` (shared with Hard Clash — one world, one wiring) | Per-action isolation contributions reconciled as a union, while `fitToView` stays per-action |

## Known M2 limitations

- **No measurable end-to-end wall-clock benefit from TLAS, on the fixture measured so far.** The M2
  performance gate (`test/performance/run-gate-m2.mjs`) ran against a real 3-discipline federated
  fixture (~7,474 total fragments across Architecture/Structure/Mechanical models) and found a
  genuine **~3.9x reduction** in exact broad-phase retest candidates
  (`statistics.broadPhasePairs`: **1,913** under `broadPhase:'tlas'` vs. **7,473** under
  `broadPhase:'linear'`, for the specific query measured) — but **no measurable end-to-end
  wall-clock improvement** on that same fixture, because broad phase is under 0.3% of total call
  time either way; narrow phase (BLAS build plus containment/crossing queries against the shared
  1,913 narrow-phase input pairs) dominates both paths equally. Stated plainly: the M2 gate's own
  question (spec §14.1, "is there a measurable candidate-search benefit of TLAS over linear on a
  realistic federated/fragment-dense case?") is answered **yes**, specifically for candidate-search
  cost — but the overall wall-clock picture at this fixture's scale is a wash. The candidate-count
  reduction is expected to matter more as narrow-phase-per-candidate cost drops or the number of
  source instances in a query grows; that was not re-measured at a larger scale.
- **`tlasSharedBuildWaits` was `NOT EXERCISED`** by the M2 gate — the gate drives every call from a
  single Playwright page with no genuine concurrent caller racing the same epoch's TLAS build, so
  the field reads `0` throughout for a structural reason (no exercised code path), not because the
  field itself is broken.
- **`reportSpan`/`setSpanRecorder` have no generation-awareness at their own direct call sites**
  (found by codex-review during the closeout pass that added the `'tlas-build'` span above). A
  build cancelled mid-flight keeps running in the background (JS cannot preempt it); if the global
  span recorder is cleared and a different one installed before that abandoned build's own
  `finally` block settles, its span reports into the later, unrelated recorder instead of being
  dropped. This is not new to `'tlas-build'` — `GeometryRegistry._runPhase`'s weld/connectivity/
  bvh-construction spans and `CollisionWorld`'s `'capacity-admission-commit'` span share the
  identical pattern (a local `performance.now()` timer plus `finally { reportSpan(...) }`, raced
  against a cancellation signal) and the identical gap. Not exercised by the M2 gate's own
  single-page, sequential-per-measurement harness (see `tlasSharedBuildWaits` above). A real fix
  needs a generation-bound span API in `collision/scheduler.js` shared by every direct `reportSpan`
  call site, not a local patch to one of them — tracked as a follow-up, not fixed here.

## Known M2.1 limitations

- **One marker per witness-bearing pair, no density cap.** `ClashFinderExtension` renders exactly
  one sphere marker per `volume-overlap` pair whose `witness` is non-null — there is no cap on the
  total number of markers drawn for a source with many simultaneous clashes, and no clustering/LOD
  behavior. A source dbId with a large number of positive pairs draws a proportionally large number
  of markers.
- **No click-to-select, tooltip, or dashboard interaction on markers.** Markers are visual-only
  overlay geometry (`viewer.overlays.addMesh`) — there is no picking, hover tooltip, or panel/
  dashboard row wired to an individual marker in M2.1. Selecting or inspecting a specific clash pair
  still goes through the existing dbId-based Viewer selection/isolation flow, not through the marker
  itself.
- **Marker radius is computed from local (pre-placement) `InstanceTree` bounds; the witness point
  itself is world-space.** The marker's radius (`clamp(sceneBoundingSphereRadius * radiusFraction,
  MIN_MARKER_RADIUS, MAX_MARKER_RADIUS)`) is derived from the model's own local bounding-sphere
  scale, not re-derived per placement transform, while `witness.point` is fully world-space and
  reflects the model's current placement (including after `invalidateModelPlacement`). This is a
  documented, accepted M2.1 simplification, not a bug: the marker still moves to the correct
  world-space location on realignment, only its radius does not additionally scale with a
  non-uniform placement transform.

## Known M3 limitations

- **Uniform scale only.** `mode: 'clearance'` supports rigid motion plus *positive uniform* scale and
  nothing else. Anisotropic, sheared, reflected, and negative-scale transforms are **diagnosed
  unsupported** (`clearance-anisotropic-scale-unsupported`) and the pair is dropped — the library
  never approximates a distance through a transform it can't honestly handle. This is a real
  restriction on federated scenes that use non-uniformly scaled links, not a theoretical one. And
  even *within* the supported class there is admitted slack: an accepted transform's reported
  `scaleFactor` may be up to `1e-4` relative off any single axis's true scale, so a reported
  `distance` carries a bounded relative error of that order. Documented, not silently exact.
- **A narrow, deliberate dead band that no mode reports.** Because `toleranceFloor` is *exclusive*
  ("touching is not a clearance violation") while `surface-intersection` performs exact, zero-tolerance
  intersection testing, a real, strictly-positive gap smaller than
  `surfaceEpsilonFactor × (larger operand's world diagonal)` — on the order of `1e-6` relative to
  instance size — is reported by **neither** mode: not a `surface-intersection` hit (the surfaces
  genuinely don't touch) and not a `clearance` hit (excluded by the floor). This is an accepted
  consequence of reusing the library's existing near-zero epsilon convention rather than inventing a
  new threshold, but it is a genuine gap, not a redirection to another mode.
- **The budget bounds candidate *count*, not a single call's *duration*.** `maxClearanceNarrowPhasePairs`
  (20,000) is an upfront preflight on how many candidate pairs a clearance call may take into narrow
  phase. **Nothing bounds how long one individual `clearanceQuery` call may take.** The M3
  performance gate *reports* worst single-call span against `frameBudgetMs` (8 ms) as a
  GO/CAUTION/NO-GO disposition — that is a measurement, not an enforced cap, and no code path aborts
  or degrades a distance query that runs long. The measured worst case was 6.10–6.50 ms, i.e. ~20–24%
  headroom, on a **single-source-instance** query against one fixture; denser source geometry could
  plausibly push one call past 8 ms with nothing in the library to stop it.
- **Roughly a quarter of near-contact candidates resolve as neither a Hard Clash nor a clearance
  result.** On the gate's fixture, ~24% of Hard-Clash prechecks (464–465 of 1,913) returned
  `inconclusive` rather than a definitive verdict, so those candidates were dropped with a
  `clearance-hard-clash-precheck-inconclusive` diagnostic and never reached a distance query. This is
  spec-sanctioned, fail-safe behavior — an inconclusive `volumeOverlapQuery` must never be treated as
  "proven no overlap" — and it is correctly surfaced through the incompleteness caveat rather than
  hidden. It is nonetheless a real volume, and the first thing any future clearance-performance or
  clearance-recall work should look at.
- **Live acceptance found a real near-miss — and the threshold it was measured with is not an
  independent oracle.** The bounded discovery spike genuinely discovered a near-miss on its second
  call (Structure dbId 3965 → 3976/4135 at ~0.0417 world units), so M3's positive acceptance case ran
  against real, unforced geometry through the real production menu action at the real default
  clearance; nothing was synthesized and no fallback was needed. What is *not* proven is that
  0.0417 is that element's global minimum distance to anything in the scene — it was found using the
  same implementation the acceptance cases exercise, so that part is partly circular. It is
  corroborated independently against the `InstanceTree`'s own node boxes, and the known-negative case
  claims only what it can show (the same source through the same action is threshold-sensitive:
  0 pairs at 0.02, exactly 2 at 0.05). A fully independent Viewer-owned world-bounds oracle would
  close the residual circularity and remains available as future work.

## Developer entry points

Read these, in this order, before making changes — no design-spec reading required for ordinary use:

1. `collision/index.js` — the library's single public entry point (everything else is internal).
2. `collision/CollisionWorld.js` — the lifecycle + `findClashes` surface documented above.
3. `collision/constants.js` — every tunable tolerance/budget in one place.
4. `collision/errors.js` — the error classes the public surface throws.
5. `wwwroot/extensions/RoomLocatorExtension.js` — the M1 reference sample, generic-usage vs.
   Room-Locator-specific glue table above.
6. `wwwroot/extensions/ClashFinderExtension.js` — the M2 reference sample (cross-model `targets`,
   `mode: 'volume-overlap'`) **and** the M3 one ("Find Soft Clashes", `mode: 'clearance'`) in one
   file; both glue tables above.
7. `collision/query/ClearanceQuery.js` and `collision/query/ClearanceTransform.js` — M3's distance
   query and its uniform-scale/tolerance-floor contract. Both carry substantial block comments
   explaining *why* their operand ordering and tolerances are what they are; read them before
   changing either.
8. This file, plus `test/acceptance/README.md` and `test/performance/README.md` for how the
   milestones' acceptance/performance claims were actually verified.

Only go to `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (M1, 4000+
lines), `docs/superpowers/specs/2026-09-05-collision-library-milestone2-design.md` (M2) or
`docs/superpowers/specs/2026-09-07-collision-library-milestone3-clearance-design.md` (M3) if you
need the *design rationale* behind a specific tolerance or algorithm choice — normal usage never
requires it.
