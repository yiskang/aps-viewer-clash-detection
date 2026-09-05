# Collision Detection Library (Milestone 1)

A clash-detection library for the Autodesk Platform Services (APS) Viewer: given a live
`Autodesk.Viewing.Viewer3D` and a loaded model, it finds geometric relationships (surface contact,
containment, volume overlap) between two sets of elements, identified by `dbId`.

This document covers the Milestone-1 (M1) surface only — what actually shipped and was accepted.
For design history/rationale, see `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
(4000+ lines; only needed if you want the "why", not the "how").

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
  target: { model, dbIds: number[] },
  mode: 'surface-intersection' | 'containment' | 'volume-overlap',
  groupBy: 'dbId',
})
// -> Promise<{ pairs: ClashPair[], statistics: Statistics }>
```

**Milestone-1 restrictions** (all rejected loudly with a thrown `Error`, never silently degraded):

- `source.model` and `target.model` must be the **same model object** — cross-model queries are
  out of scope in M1.
- `groupBy` must be exactly `'dbId'` — no other grouping is implemented.

**Result shape:**

- `pairs`: one entry per distinct `(sourceDbId, targetDbId)` pair with a positive result —
  `{ source: { modelId, dbId }, target: { modelId, dbId }, type: <mode> }`. Order is
  insertion-order, not canonicalized.
- `statistics`: `{ broadPhasePairs, narrowPhasePairs, blasBuilt, blasCacheHits, broadPhaseMs,
  narrowPhaseMs, totalMs, diagnostics }`. `blasBuilt`/`blasCacheHits` are currently always reported
  as `0` — the geometry registry doesn't yet expose build/hit counters to report real ones (not a
  correctness issue, just an unwired diagnostic field).

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

Errors thrown across this surface (`collision/index.js` re-exports all of them):
`WorldDisposedError`, `ModelEvictedError`, `RenderProxyUnavailableError` (transient, handled
internally per-candidate-pair — not usually something a consumer needs to catch),
`ObjectTreeUnavailableError`, `CapacityExceededError`, and `ExtractionLimitExceededError` — thrown
out of `findClashes` if a query's dbId walk exceeds `maxFragmentsPerDbId` or `maxChildrenPerNode`
(both in `collision/constants.js`) while enumerating a requested dbId's own fragments/children.

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
  to accelerate further.
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

## Developer entry points

Read these, in this order, before making changes — no design-spec reading required for ordinary use:

1. `collision/index.js` — the library's single public entry point (everything else is internal).
2. `collision/CollisionWorld.js` — the lifecycle + `findClashes` surface documented above.
3. `collision/constants.js` — every tunable tolerance/budget in one place.
4. `collision/errors.js` — the error classes the public surface throws.
5. `wwwroot/extensions/RoomLocatorExtension.js` — the reference sample, generic-usage vs.
   Room-Locator-specific glue table above.
6. This file, plus `test/acceptance/README.md` and `test/performance/README.md` for how the
   milestone's acceptance/performance claims were actually verified.

Only go to `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4000+ lines)
if you need the *design rationale* behind a specific tolerance or algorithm choice — normal usage
never requires it.
