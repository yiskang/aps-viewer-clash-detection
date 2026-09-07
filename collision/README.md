# Collision Detection Library

A clash-detection library for the Autodesk Platform Services (APS) Viewer: given a live
`Autodesk.Viewing.Viewer3D` and one or more loaded models, it finds geometric relationships
(surface contact, containment, volume overlap) between two sets of elements, identified by `dbId`.

This document covers the full shipped surface through **Milestone 2 (M2)** — what actually shipped
and was accepted, across both milestones. Sections and restrictions are labeled M1/M2 where the
distinction still matters — mainly: which `target` shape (legacy `{model, dbIds}` vs. the M2
`{targets: [...]}` shape) and which `broadPhase` value a given behavior applies to. For design
history/rationale, see `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
(M1, 4000+ lines) and `docs/superpowers/specs/2026-09-05-collision-library-milestone2-design.md`
(M2) — only needed if you want the "why", not the "how".

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

All three are single-mode-per-call — `findClashes` does not compose multiple modes in one query.

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
  mode: 'surface-intersection' | 'containment' | 'volume-overlap',
  groupBy: 'dbId',
  broadPhase?: 'linear' | 'tlas',   // M2 only; default is shape-dependent — see below
})
// -> Promise<{ pairs: ClashPair[], statistics: Statistics }>
```

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
  `{ source: { modelId, dbId, model }, target: { modelId, dbId, model }, type: <mode> }`. `model` is
  the real `Model` object reference for that operand — a borrowed identity reference, and the
  **authoritative** one for same-model/cross-model comparisons (see the Clash Finder sample's own
  classification logic below). `modelId` is diagnostic/display-only: it is documented elsewhere in
  this library as reused-under-collision-prone across a session, so never compare on it. Order is
  insertion-order, not canonicalized.
- `statistics`: `{ broadPhasePairs, narrowPhasePairs, blasBuilt, blasCacheHits, broadPhaseMs,
  narrowPhaseMs, totalMs, diagnostics, ...9 M2 fields below }`. `blasBuilt`/`blasCacheHits` are
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

**Diagnostics — read this before trusting an empty result.** `statistics.diagnostics` is an array
of `{ scope: 'fragment' | 'pair', reason, ... }` entries describing anything the query could not
fully resolve: a fragment whose geometry wasn't loaded yet, one that was structurally rejected
(oversized/unsupported layout), or a narrow-phase traversal that hit its own time/candidate budget
and aborted. **A non-empty `diagnostics` array means the boolean/pair result may be incomplete** —
an empty `pairs` array in that situation is not the same statement as "no clash exists." Consumers
must surface this, not silently treat it as a clean negative (see the reference sample's own
`describeDiagnostics` / user-facing caveat for the expected pattern).

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

## Developer entry points

Read these, in this order, before making changes — no design-spec reading required for ordinary use:

1. `collision/index.js` — the library's single public entry point (everything else is internal).
2. `collision/CollisionWorld.js` — the lifecycle + `findClashes` surface documented above.
3. `collision/constants.js` — every tunable tolerance/budget in one place.
4. `collision/errors.js` — the error classes the public surface throws.
5. `wwwroot/extensions/RoomLocatorExtension.js` — the M1 reference sample, generic-usage vs.
   Room-Locator-specific glue table above.
6. `wwwroot/extensions/ClashFinderExtension.js` — the M2 reference sample (cross-model `targets`,
   `mode: 'volume-overlap'`), generic-usage vs. Clash-Finder-specific glue table above.
7. This file, plus `test/acceptance/README.md` and `test/performance/README.md` for how the
   milestones' acceptance/performance claims were actually verified.

Only go to `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (M1, 4000+
lines) or `docs/superpowers/specs/2026-09-05-collision-library-milestone2-design.md` (M2) if you
need the *design rationale* behind a specific tolerance or algorithm choice — normal usage never
requires it.
