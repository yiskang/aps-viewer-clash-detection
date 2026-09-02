# Consolidated Invariant Model — Collision Library Milestone 1 (post-Round-19)

**Source of truth:** `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
(**3993 lines** as it exists right now, after the Round-19 Critical-only fix pass). Every `line N`
citation below was read directly out of that file at this revision. **Nothing was carried forward from
`invariant-audit-v1.md` or `invariant-audit-v2.md`** — their reproduced models describe pre-Round-18 and
pre-Round-19 text and their line numbers no longer resolve (the file was 3851 lines at v2's model, and
the disposition doc's own "3935 after" figure is also already stale relative to the current 3993).

**Status of this document:** pure extraction. It records what the spec *says*, including where it says
two things. Where the spec is silent, ambiguous, or self-contradictory, that is marked `[SILENT]`,
`[AMBIGUOUS]`, or `[CONTRADICTION]` and left **unresolved** — adjudication, severity, and repair
direction are the audit pass's job, not this one's. Nothing here is a design proposal.

---

## Reading note — the document's own structure at this revision

| Lines | Section | Normative? |
|---|---|---|
| 1–21 | Title / Status line | Meta (Status line still says "revised after seventeen rounds of codex review", 3) |
| 23–635 | **Revision Notes** (round-by-round changelog) — Round 1 @25, R2 @38, R3 @66, R4 @95, R5 @130, R6 @162, R9 @191, R10 @223, R11 @260, R12 @294, R13 @329, R14 @359, R15 @390, R16 @433, R17 @475, **R18 @518–577**, **R19 @579–635** | Historical; repeatedly cited *as if* normative elsewhere |
| 637–709 | Spike Findings | Evidence, partly normative (measured constants) |
| 711–736 | Purpose | Non-normative |
| 738–757 | Background | Non-normative |
| 759–790 | Milestone Scope | Normative (inclusion/exclusion) |
| 792–905 | Architecture (runtime split, vendor tree, import map) | Normative |
| **907–2104** | **Components** | **Normative** |
| ↳ 909–974 | `ViewerModelAdapter` | |
| ↳ 976–1055 | `ViewerGeometryAdapter` | |
| ↳ 1057–1076 | `GeometryRegistry` / `GeometryIdentity` | |
| ↳ 1078–1269 | `ThreeMeshBvhBackend` / `BlasCache` (build pipeline + publication rules) | |
| ↳ 1271–1323 | Tolerances | |
| ↳ 1325–1370 | Solid model | |
| ↳ 1372–1461 | Query modes and their preconditions (+ mandatory welding, 1422–1461) | |
| ↳ 1463–1486 | `GeometryConnectivity` | |
| ↳ 1488–1512 | `SurfaceIntersectionQuery` | |
| ↳ 1514–1744 | `ProperCrossingQuery` (incl. **atomic-operations table 1645–1655**, worst-case-span 1705–1728) | |
| ↳ 1746–1976 | `ContainmentQuery` (`classifyPoint`, `anyComponentInside`, the guarantee block 1807–1878, the three stages 1889–1935) | |
| ↳ 1978–2014 | `VolumeOverlapQuery` | |
| ↳ 2016–2097 | `ContainmentModeQuery` (+ `SurfaceCrossingWitness` 2045–2079) | |
| ↳ 2099–2104 | `CollisionWorld` (facade, `frameBudgetMs = 8`) | |
| **2106–2459** | **Data Flow — Room Locate Query** (step 1 room cache 2108–2228; step 3 extraction 2243–2365, broad phase 2366–2410, narrow phase 2411–2455) | **Normative** |
| **2461–3036** | **Public API** (method contracts as code comments 2463–2696; "Race safety" prose 2698–2885; extension sketch 2887–2916; diagnostics 2918–3036) | **Normative** |
| 3038–3190 | Error Handling & Edge Cases | Normative |
| 3192–3852 | Testing & Verification (unit fixtures 3194–3752; integration 3754–3765; **performance gate 3767–3852**) | Normative (fixtures pin behavior) |
| 3854–3935 | Risks | Normative-ish (declared limits) |
| 3937–3993 | Open Questions Deferred | Non-normative |

Where changelog prose and normative text disagree, **both are cited below**.

---

# 1. Model / world lifecycle

## 1.1 The two axes

Two independent axes, checked in a **fixed order** at every site: world first, then model.

**World axis:** `constructed → disposed`. One-way, terminal. `disposed` is set **first, synchronously,
before anything else** (2662–2663, 2847–2849, 3153–3154). Since Round 15 it is "the system's single
authoritative liveness signal" (2746–2748, 2846–2850).

**Model axis** — keyed by the **exact `Model` object**, never by numeric `modelId` (2715, 2554–2556):

```
(no modelLifecycle entry)     "never been admitted or evicted — a legitimate first use, the only case
                               findClashes treats as 'admit fresh'"                     (2726–2728)
      │ admitModel(model)   OR   findClashes entry-point lazy admission        (2761–2773, 2811–2815)
      ▼
{ state: 'live', epoch: N }   N = nextLoadEpoch++, assigned exactly once at first admission
                                                                          (2507, 2749–2754)
      │ evictModel(model)
      ▼
{ state: 'evicted' }          NO epoch field. Permanent: "nothing re-admits it, ever, because nothing
                               ever clears or overwrites it back to 'live'"             (2728–2729)
```

`evictModel` on a model with **no prior entry at all** writes `{state:'evicted'}` unconditionally —
the Round-15 fix for `BEFORE_MODEL_UNLOAD_EVENT` firing for a model loaded but never touched by
`findClashes`/room-search (2559–2573, 2722–2726; changelog 412–419). Fixture: 3683–3692.

`modelLifecycle` is a `WeakMap` **deliberately**, so "permanent" is free rather than a leak — and
"**nothing in this design may depend on being able to *enumerate* `modelLifecycle`**" (2730–2733).

## 1.2 State owned by `CollisionWorld`

| Structure | Type | Role | Cite |
|---|---|---|---|
| `modelLifecycle` | `WeakMap<Model, {state:'live';epoch:number} \| {state:'evicted'}>` | THE liveness authority; object-identity keyed; never deleted; deliberately non-enumerable | 2718–2733 |
| `liveModelByModelId` | `Map<modelId, Model>` | **Bookkeeping/diagnostics only**, "load-bearing for nothing" since R15; structurally cannot represent two simultaneously-live objects sharing one `modelId` | 2734–2745, 2883–2885 |
| `disposed` | `boolean` | World-level terminal flag; single authoritative signal, checked **directly** at every site | 2746–2748, 2846–2865 |
| `nextLoadEpoch` | `number` | Single counter global to the world instance; monotonic; never reset, never scoped per `modelId` | 2749–2754 |
| `ModelLease` | `{ model, epoch }` | "an opaque capture of this exact object's current lifecycle state, valid until the object is evicted or the world is disposed" | 2500–2501 |

## 1.3 Public method contracts

**`CollisionWorld.fromViewer(viewer, options): Promise<CollisionWorld>`** (2464–2468). Options
`{ model?, narrowPhase:'three-mesh-bvh', indexOwnership:'clone' }`; any other value **throws**.
[SILENT-1] No stated behavior for `fromViewer` on a world that… (n/a — it is a static constructor);
but **no contract is stated for `options.model`** anywhere else in the document — it appears only in
this signature comment. `[SILENT]`

**`world.findClashes(query): Promise<ClashResult>`** (2470–2497)
- Rejects immediately, **before any geometry extraction**, if the world is disposed or if either
  operand `Model` is tombstoned evicted (2471–2476, 2811–2827).
- Otherwise admits **both** operand models through the same internal path `admitModel` exposes
  (2473–2476). `source.model` must `===` `target.model` (2477, 2241–2242).
- Modes: `'volume-overlap' | 'containment' | 'surface-intersection'` (2478–2488). `groupBy: 'dbId'`
  only (2490–2491). No `firstHitOnly` (2493–2497).
- Failure at the entry check **or any yield checkpoint** aborts the **entire** call: `disposed` →
  `WorldDisposedError`; evicted/mismatched epoch → `ModelEvictedError` naming the evicted `modelId`;
  "neither returns a partial or diagnosed `ClashResult`" (2825–2829).

**`world.admitModel(model): ModelLease`** (2499–2517)
- Synchronous, idempotent — a second call on an already-live object returns a lease with the **same**
  epoch and does not consume `nextLoadEpoch` (2501–2503; fixture 3626–3628).
- Three outcomes **in this order** (2503–2509):
  1. `disposed` → **throws** `WorldDisposedError`
  2. entry `{state:'evicted'}` → **throws** `ModelEvictedError` immediately, no epoch assigned
     ("a model that was ever evicted can never be re-leased") (fixture 3629–3632)
  3. otherwise → admit if not already (`epoch = nextLoadEpoch++`, record `liveModelByModelId`),
     return the possibly pre-existing lease.

**`world.isLeaseValid(lease): boolean`** (2519–2552) — **first of two deliberate non-throwing
exceptions.**
- "Strictly non-throwing and total … always returns a plain boolean, never throws" (2520–2521).
- Stated implementation (2523–2525):
  ```js
  if (disposed) return false;
  const entry = modelLifecycle.get(lease.model);
  return entry?.state === 'live' && entry.epoch === lease.epoch;
  ```
- Checks `disposed` **directly and first**, explicitly because `dispose()`'s own model sweep is
  incomplete (2535–2541). Fixture: 3651–3657.
- Never says *why* a lease is invalid; the caller derives that by calling `isModelLive` inside
  `try`/`catch` (2541–2552).

**`world.isModelLive(model): boolean`** (2649–2659) — **throwing contract.**
- `disposed` first, directly → **throws** `WorldDisposedError` before consulting `modelLifecycle`
  (2650–2651). Fixture: 3658–3660.
- Else `true` iff this exact object has `{state:'live'}`. **"Never seen before → `false`"**
  (2652–2653) — the conflation that broke every first-ever room search in Round 12/13
  (changelog 336–346; 2163–2167). Nothing public may still use it as a pre-admission gate (2656–2659).

**`world.evictModel(model): void`** (2554–2647) — takes the exact object (2555–2557).
**Second deliberate non-throwing exception** (Round 18).
- Stated body (2568–2573):
  ```js
  if (disposed) return;                                  // no-op on a disposed world
  const previous = modelLifecycle.get(model);
  if (previous?.state === 'evicted') return;             // idempotent no-op
  modelLifecycle.set(model, { state: 'evicted' });       // unconditional
  if (previous?.state === 'live') releaseEpochScopedState(previous.epoch);
  ```
- Tombstone write precedes the conditional release and is permanent either way (2574–2576).
- `releaseEpochScopedState` — see §2.5 / §5.2.
- Deletes `liveModelByModelId`'s entry **only if this object is still the current occupant** for its
  `model.id`; explicitly "diagnostic/bookkeeping only" (2604–2607, 2742–2745).
- **Must be non-throwing** as a step ("a synchronous map/set removal and promise rejection, nothing
  that can itself fail") — a partial throw would leave the tombstone written but the release
  incomplete and unretriable, since the `'evicted'` variant carries no epoch (2597–2603).
- Disposed-world no-op justification, three reasons in descending force (2614–2642): (1) a throw here
  is verifiably destructive to the **Viewer** — `EventDispatcher.dispatchEvent` (viewer3D.js:13300–13341)
  has no try/catch, the event is the first statement of `Viewer3DImpl.unloadModel`
  (viewer3D.js:34052–34054) called from the unguarded loop in `unloadCurrentModel`
  (viewer3D.js:34253–34258); (2) nothing left to do post-disposal; (3) it is the branch the method
  already had. Silent by design (2643–2644). Fixture: 3699–3706.
- **The extension-owned room cache is NOT covered by this no-op** — the handler must drop the room-cache
  entry unconditionally (2645–2647, 2906–2910).

**`world.dispose(): void`** (2661–2696)
- Sets `disposed` **first, synchronously** (2662–2663).
- After it returns, `findClashes`, `admitModel`, `isModelLive`, a second `dispose()` all reject/throw
  `WorldDisposedError` (2665–2667).
- Two exceptions, both still checking `disposed` first: `isLeaseValid` (returns `false`), `evictModel`
  (no-op) (2668–2676).
- **Wholesale-clears** `GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity` — "the
  entire cache, in one operation, not a per-model sweep over `liveModelByModelId`" — and **rejects
  every in-flight build promise, for every entry it removes regardless of `buildState`** (2677–2687,
  2869–2882). See §2.5.
- "**Best-effort** tombstones whatever `liveModelByModelId` currently references, for diagnostic
  bookkeeping" — explicitly no longer load-bearing (2687–2692, 3158–3161).
- A suspended query fails at its next checkpoint because that checkpoint checks `disposed` directly
  (2693–2695, 3153–3157).

[SILENT-2] `dispose()` never states whether `liveModelByModelId` itself is cleared, nor whether
`modelLifecycle` entries for models it did not reach are ever reconciled. Stated as unnecessary for
correctness (2866–2870) but the mechanical outcome is unstated. `[SILENT]`

[CONTRADICTION-1] **Changelog vs. current contract on "the one exception."** Round 14's entry states
the resolution was "making `isLeaseValid` **the one** deliberate, documented exception to 'every public
method throws once disposed'" (383–384), and Round 12's entry states `dispose()` sets a flag "checked
ahead of any per-model state by every public method, which reject/throw `WorldDisposedError` once set"
(320–323) — with no exception at all. Current normative text has **two** exceptions (2531–2533,
2617–2619, 2668–2676). Neither changelog entry carries a superseded-annotation, unlike the Round-16
entry Round 19 chose to annotate (446–448). `[CONTRADICTION]` (changelog-vs-normative; carried, listed
as still-open H-L7 in `round-19-critical-fix-pass-disposition.md` 102–103)

## 1.4 `modelId` reuse while the old object is still live

Supported and tested (2781–2793, 3641–3650, 3184–3190). Geometry state keyed by `(loadEpoch,
geometryIndex)` makes the two objects' namespaces structurally disjoint (2795–2809). A stale/duplicate
`evictModel(oldModel)` can only release records under `oldModel`'s own epoch (2593–2597, 3175–3183).
`liveModelByModelId` can only hold one of the two (2737–2741), which is why no correctness property may
depend on it (2740–2745, 2834–2844).

## 1.5 Checkpoint / yield sites and what each revalidates

**Universal protocol:** `disposed` first and directly, *then* the model's load epoch
(`modelLifecycle.get(model)?.state === 'live' && .epoch === epoch`) (2818–2824, 2852–2860, 2452–2455).

| # | Site | Cite | Revalidates |
|---|---|---|---|
| 1 | `findClashes` entry (both operands) | 2471–2476, 2811–2817 | `disposed`, then per-operand tombstone; lazily admits a never-seen object |
| 2 | Before each requested dbId's extraction | 2243–2247, 2438 | Universal two-part |
| 3 | Between sibling nodes at the same depth in the extraction walk | 2329–2331 | Stated as "a checkpoint against `frameBudgetMs`" — the two-part liveness protocol is **not restated here** `[AMBIGUOUS]` |
| 4 | Before the broad-phase scan starts | 2438, 1694–1697 | Universal two-part |
| 5 | **Inside** the broad-phase scan, before each individual instance pair | 2384–2388 | Explicitly `disposed` first, then load epoch; resumes at exact `(sourceIndex,targetIndex)` |
| 6 | Before starting each candidate pair (cached or not) | 2437–2439 | Universal two-part |
| 7 | Between each of a pair's composed sub-queries | 2438–2439 | Universal two-part |
| 8 | Before **each** build phase (weld/compaction, connectivity, BVH) | 1104–1113, 1146–1155 | **The record's *owner* only** — `disposed`, then the liveness/epoch of the one model whose `loadEpoch` is in the record's key; explicitly *not* the initiating query's other operand |
| 9 | `ProperCrossingQuery`: before each individual **probe**; at `bvhcast` callback entry for raw candidates | 1608–1625 | Time only → sets `aborted`; cannot yield (native traversal) |
| 10 | `ContainmentQuery`: before **every individual `classifyPoint` call** | 1951–1963 | Yields, then universal two-part, then resumes at the next unsampled vertex |
| 11 | Stage-3 witness-triangle loop (before each witness-triangle attempt) | 1971–1974 | Same yield-and-resume + two-part revalidation |
| 12 | `SurfaceCrossingWitness` per-candidate probe loop | 1974–1976 | Same — "all three are plain JS loops with no native traversal in the way" |

[CONTRADICTION-2] **`SurfaceCrossingWitness`'s scheduling class.** 1974–1976 classifies its probe loop
as a plain JS loop that can yield-and-resume; 2078 says it uses the "**Same traversal** and budget as
the other two modes" (i.e. the `bvhcast` traversal, which 1620–1622 says "cannot be paused and resumed
mid-traversal"). `[CONTRADICTION]` (carried; listed as still-open H-B4, disposition 105–106)

[AMBIGUOUS-1] **Which clock the `bvhcast` time-abort reads.** 1598–1599: "elapsed synchronous time
**since the traversal's own start** exceeding `frameBudgetMs`". 2436–2441: the narrow phase tracks
**one** accumulator for the call, tripping when "accumulated synchronous time **since the last yield**"
exceeds `frameBudgetMs`. 1740–1741 asserts "Both mechanisms key off the same constant and **the same
clock**". Three statements, two distinct clocks. `[AMBIGUOUS]` (carried; H-B7, disposition 107–108)

[AMBIGUOUS-2] Every checkpoint description says "**the** model's load epoch" (singular: 1958–1959,
2386–2387, 2452–2454) while `findClashes` has two operand fields — reconciled only by the Milestone-1
`source.model === target.model` rule (2241–2242, 2477). Never stated as the reason. `[AMBIGUOUS]`

## 1.6 Error types

Exactly two named error classes appear in the document: **`ModelEvictedError`** and
**`WorldDisposedError`** (41 and 36 occurrences respectively).

| Situation | Error | Cite |
|---|---|---|
| New call on disposed world (`findClashes`/`admitModel`/`isModelLive`/2nd `dispose()`) | `WorldDisposedError` | 2665–2667, 3162–3164 |
| Disposal observed at a resumed checkpoint | `WorldDisposedError` (**not** `ModelEvictedError`) | 3153–3157, 3665–3672 |
| Evicted object passed directly to `findClashes` | `ModelEvictedError`, immediately | 3147–3152 |
| Eviction observed at a resumed checkpoint | `ModelEvictedError` naming the evicted `modelId` | 2825–2827, 3136–3146 |
| `admitModel` on tombstoned object | `ModelEvictedError`, synchronous | 2505–2506 |
| Room-search callback, invalid lease | Derived disposed-first: caught `WorldDisposedError` → reject with it; else `new ModelEvictedError(model.id)` | 2184–2204 |
| `isLeaseValid` on disposed world | **No error** — returns `false` | 2520–2525 |
| `evictModel` on disposed world | **No error** — silent no-op | 2614–2616 |
| `maxFragmentsPerDbId` / `maxChildrenPerNode` / `maxBroadPhaseInstancePairs` tripped | "the entire `findClashes` call rejects" — **error class unnamed** | 2283–2285, 2302–2305, 2369–2371, 3054–3087 `[SILENT]` |
| Cross-model query | "rejects synchronously" — class unnamed | 3124–3126 `[SILENT]` |
| Invalid dbId | "reject with a clear error" — class unnamed | 3130 `[SILENT]` |
| `fromViewer` with an unsupported `narrowPhase`/`indexOwnership` value | "throws" — class unnamed | 2465–2468 `[SILENT]` |

[SILENT-3] Four distinct rejection paths name no error class. `[SILENT]`

## 1.7 Extension-side lifecycle (`RoomLocatorExtension`, 2887–2916)

- `load()` — constructs the `CollisionWorld` **only**; no room resolution, no eager BLAS (2890–2891,
  2108–2115).
- `unload()` — `world.dispose()` **first**, listener removal **second**, then clears the per-model room
  cache. The document itself flags the resulting window (a `BEFORE_MODEL_UNLOAD_EVENT` can still fire
  into an already-disposed world, and can outlive `unload()` because `Viewer3D.tearDown` catches a throw
  from `unload()` while leaving the listener registered). Declared benign **only because**
  `evictModel` is a no-op on a disposed world — "it is the method's totality that makes this ordering
  safe, not the ordering itself." Per-step isolation and listener-before-dispose ordering are
  **explicitly left open** (2892–2905).
- `BEFORE_MODEL_UNLOAD_EVENT` handler: `world.evictModel(event.model)` **and** unconditionally drop that
  object's room-cache entry (2906–2910, 2137–2141).
- `locateElementByRoom(dbId): Promise<number[]>` — rejects `ModelEvictedError` / `WorldDisposedError`
  (2911–2913).

[SILENT-4] **Where and when the `BEFORE_MODEL_UNLOAD_EVENT` listener is registered is never stated.**
`load()`'s contract (2890–2891) names only world construction; `unload()` names unregistration
(2892–2893). `[SILENT]` (carried; H-L4, disposition 102)

[SILENT-5] **`tearDown()` / `keepCurrentModels` are never modeled.** `Viewer3D.tearDown` appears only
as evidence about try/catch behavior (2630, 2897); `keepCurrentModels` appears **nowhere** in the file.
A model swap that keeps the world alive has no stated contract. `[SILENT]` (carried; H-L1/H-L2)

[SILENT-6] The Open Questions section (3986–3989) explicitly records that whether
`BEFORE_MODEL_UNLOAD_EVENT` can ever fail to fire is unresolved, and that "every race-safety guarantee
here is conditioned on the event firing at least once per removal." `[SILENT]` (self-declared)

---

# 2. Geometry ownership / build pipeline

## 2.1 Identity

- One `GeometryRecord` per unique **`(loadEpoch, geometryIndex)`** (1057–1059, 2591–2593, 2795–2799).
- `geometryIndex` = `fragList.getGeometryId(fragId)`, confirmed **model-local only** (965–974).
- `loadEpoch` = `modelLifecycle.get(model).epoch` from `admitModel`/`findClashes` admission (965–967).
- **Never** `(modelId, geometryIndex)`, never the bare index (971–974).
- `modelId` survives on a record **only** as display/diagnostic metadata (1073–1076).
- Cross-model geometry sharing out of scope (1076).

Record fields (1057–1068): `referenceCount`, `buildState: 'building' | 'ready'`, `weldPromise`
(compaction+weld), `accelerationPromise` (BLAS), the promise behind lazy `connectivity`. Also
`L_X := diagonal(localBounds(X))` "cached with the BLAS" (1285–1288).

[SILENT-7] **`referenceCount` is declared once (1060) and never used, incremented, decremented, or
consulted anywhere else in the document.** `[SILENT]` (carried; disposition 111 lists it as still-open)

## 2.2 Pipeline stages, in order

| # | Phase | Gate / checkpoint | Cite |
|---|---|---|---|
| 0 | **Extraction** (self-driven node walk → fragments → `CollisionInstance`s) | `frameBudgetMs` before each dbId; `maxFragmentsPerDbId`; `maxChildrenPerNode` | 2243–2365 |
| 1 | **Layout normalization** (`ViewerGeometryAdapter` → `TriangleGeometryView` incl. `ranges`) | "free, no per-triangle work"; computed in the earlier normalization pass | 976–1055, 1195–1198 |
| 2 | **Size gate** — `activeTriangleCount := Σ floor(ranges[i].count / 3)` vs `maxSyncTriangleCount` | Checked **before any copying** | 1198–1212, 2411–2417, 3047–3053 |
| 3 | **Active-range compaction** → collision-owned compacted position/index pair | Folded into the weld phase's checkpoint | 1193–1217, 1647 |
| 4 | **Weld** (`mergeVertices` after stripping to position+index only, `weldEpsilon = 1e-4 m / model.getUnitScale()`, fallback `1e-4`) | Own checkpoint before it starts | 1422–1461, 1104–1113 |
| 5 | **Connectivity** (`GeometryConnectivity` edge-based union-find + manifold classification) — independently lazy | Own checkpoint; only for modes calling `anyComponentInside` | 1091–1103, 1463–1486, 1648 |
| 6 | **BVH build** (`MeshBVH` over the compacted+welded geometry) | Own checkpoint | 1078–1079, 1649 |
| 7 | **Publication** | Insert-first (see §2.3) | 1114–1186 |

Phase order is enforced: each slot "awaits its prerequisites rather than being launched in parallel —
weld first, then connectivity if it is needed, then the BVH" (1128–1130).

Round 16 explicitly retired the "set `groups`/`drawRange` on the BVH input" workaround as unnecessary
after compaction (1230–1234, 470–473). `indexOwnership: 'clone'` is the only supported value and
`'indirect'` is "not merely unimplemented but inapplicable" (1226–1229, 3946–3948).

[CONTRADICTION-3] **Compaction-vs-gate ordering, header/body transposition.** 1193–1196: "The fix
inserts one more phase before the three above … active-range compaction. **Before welding, before the
ceiling check**, and before anything is handed to `mergeVertices` … are used to materialize a
collision-owned, compacted position/index pair." 1208–1212 states the opposite: "**`maxSyncTriangleCount`
is checked against `activeTriangleCount` before any copying happens** … without ever materializing a
compacted buffer for it. Only once that check passes does compaction actually copy triangle data."
Fixture 3505–3509 pins the 1208 reading (zero compaction calls for an over-ceiling fragment).
`[CONTRADICTION]` (carried; H-G2/H-G5, disposition 109–110)

[AMBIGUOUS-3] **`>=` vs `>` at the ceiling.** 1249–1251: "A geometry **at or above** that triangle
count is **not** built synchronously." 2414–2416 and 3050–3051: "if either **exceeds** it, skip."
Fixtures (3510–3515) test 13,000 (skip) and 11,000 (build) — neither pins exactly 12,000.
`[AMBIGUOUS]` (carried; disposition 111 lists the `>=`/`>` boundary as still-open)

## 2.3 Publication, single-flight, and what a caller may read

**"A `GeometryRecord` is published when its build *starts*, not when it finishes"** (1114–1116).
Rationale: the build is deliberately non-atomic (a checkpoint sits before each phase), so
publish-when-complete would (a) defeat concurrent dedup and (b) make in-flight builds unreachable to
`evictModel`/`dispose()` (1116–1123).

Rules, verbatim structure (1124–1186):
1. **Insert first, then build.** The missing caller inserts the record with `buildState: 'building'`
   **before the first phase's checkpoint — before any yield** (1124–1130).
2. **A caller that finds an existing entry never starts a duplicate build**; it awaits the phase slots
   its own query needs. This is the **only** dedup mechanism — `BlasCache` "owns no dedup mechanism of
   its own" (1131–1134, 1236–1244).
3. **Nothing reads a phase's product off a `'building'` record** — products are only ever the resolved
   values of their own slots (1135–1137).
4. **`'ready'` is record-level and mode-independent: compaction+weld and BVH both resolved.** A
   `'ready'` record is everything `surface-intersection` needs; `containment`/`volume-overlap`
   additionally await connectivity's slot on that same entry. "**Connectivity is never what makes a
   record un-`'ready'`**" (1138–1145). Fixture: 3470–3475.
5. **A build-phase checkpoint validates the record's *owner*, not the building caller's whole query**
   (1146–1155). A caller whose own query aborts for an unrelated reason does **not** cancel a phase
   already in flight: "every phase slot runs to settlement, so a `'building'` entry is never left
   permanently unsettled with other callers awaiting it" (1152–1155). Fixture: 3491–3495.
6. **There is no `'failed'` state.** A checkpoint failure rejects the phase slot with
   `ModelEvictedError`/`WorldDisposedError` and **removes the entry from `GeometryRegistry`
   synchronously as part of that rejection**, identity-guarded (1156–1164). Fixture: 3455–3462.
7. **Cancellation signal — the Round-19 C-2 rule** (see §2.4).
8. **An oversized geometry is a distinct kind of entry, not a build state.** A lookup yields one of
   three things: an *oversized marking* (no phase is ever started for it, **it carries no
   `buildState`**, every pair needing it is skipped), a `'building'` record, or a `'ready'` one
   (1183–1186).

[AMBIGUOUS-4] Rule 5 says a phase slot always "runs to settlement" (1152–1155); rules 6–7 say a phase
slot can be **rejected** by a checkpoint failure or by the cancellation signal (1156–1182). The two are
reconcilable if "runs to settlement" means "settles either way," but the sentence is written as a
guarantee against cancellation by a caller specifically. `[AMBIGUOUS]`

## 2.4 The entry-lifetime cancellation signal (Round-19 C-2) — **verified landed**

Normative statement (1165–1182), quoted structurally:
- "Every registry entry carries **one entry-scoped cancellation signal**, created **once when the entry
  is first inserted in `buildState: 'building'`** and kept alive, **unchanged, for the entry's entire
  lifetime** — the signal is *not* discarded or replaced when the entry transitions to `'ready'`"
  (1165–1168).
- "**Every unresolved phase slot the entry ever hosts races that same signal**, including a lazy
  connectivity build started later against an already-`'ready'` entry: the signal is scoped to the
  entry's lifetime, **not to its `buildState`**" (1168–1171).
- "The release paths reject that signal **exactly once** and drop the entry in the same step …
  **unconditionally, for every entry they remove regardless of whether its `buildState` is `'building'`
  or `'ready'`**. Clearing a map does not by itself settle a pending promise" (1171–1175).
- "**one signal per entry suffices**; there is no per-phase-slot set or map of signals to keep in sync"
  — because phases are strictly sequential and single-flight, at most one unresolved at a time
  (1175–1178).
- **Identity-guarded removal corollary:** "the release step deletes the entry only if the registry still
  holds this exact entry for that key, so a late-resolving continuation from a just-cancelled phase
  (weld, BVH, or a lazily-started connectivity build) can never republish its result or otherwise
  mutate state once the entry is gone" (1178–1182).

**Round-19 C-2 landing check — all four cited sites re-read at this revision:**

| Site | Line | Landed? |
|---|---|---|
| Signal-introduction passage | 1165–1182 | ✅ entry-lifetime-scoped, both release paths, identity guard |
| `evictModel` / `releaseEpochScopedState` settlement step | 2577–2587 | ✅ "For every entry it removes, **regardless of buildState**, it first rejects that entry's cancellation signal — the same signal … carried unchanged across its `'building' -> 'ready'` transition, **never scoped to `'building'` alone**"; identity-guarded delete "in the same step" |
| `dispose()` settlement step | 2677–2687 | ✅ "for every entry it removes regardless of `buildState`"; explicitly covers "a `'ready'` entry currently hosting an in-flight lazy connectivity build"; identity-guarded |
| Definitional "unresolved phase slots hanging off …" statement | 2874–2882 | ✅ corrected to "whether the entry is still `'building'` or has already reached `'ready'` and is now hosting a later, lazily-started connectivity build" |
| New fixtures | 3476–3490 | ✅ two fixtures (evict + dispose while lazy connectivity suspended on a `'ready'` entry), both requiring **reject, not hang** |

A residual grep confirms **no `For a 'building' entry` gating language remains** at any of the four
sites (consistent with disposition 126–127).

[AMBIGUOUS-5 — **new tension surfaced by C-2's own wording**] **An oversized marking has no cancellation
signal, but both release paths say they reject one for every entry they remove.** 1183–1186 states an
oversized marking "carries no `buildState`" and "no phase is ever started for it"; 1165–1167 creates the
signal "when the entry is first inserted **in `buildState: 'building'`**" — so an oversized marking
never gets one. Yet `releaseEpochScopedState` sweeps "every entry filed under the object's own admitted
epoch — in whichever build state, `'building'` or `'ready'`, **plus any oversized marking**" and then
says "**For every entry it removes, regardless of buildState, it first rejects that entry's cancellation
signal**" (2577–2583); `dispose()` likewise "rejects each removed entry's cancellation signal … in the
same pass that drops the entry" (2683–2686) and 2880 repeats "the clear rejects each entry's
cancellation signal as it drops the entry". `[AMBIGUOUS]` — recorded, not adjudicated.

[AMBIGUOUS-6 — **new tension surfaced by C-2's own wording**] **"At most one phase ever unresolved per
entry" vs. the `'ready'` + lazy-connectivity state that C-2 exists to cover.** 1175–1178 justifies one
signal per entry because "phases are strictly sequential and single-flight per entry — weld, then
connectivity if needed, then the BVH, **with at most one phase ever unresolved on a given entry at a
time**". But the `'ready'` state (weld+BVH resolved, connectivity started later on demand) means
connectivity is started **after** the BVH, not between weld and BVH — so the stated order
"weld → connectivity → BVH" (1128–1130) and the C-2 lazy-connectivity path (1141–1145, 1168–1171,
3470–3484) describe two different orderings of the same three phases. `[AMBIGUOUS]`

## 2.5 Release paths for geometry state

See §5.2. Both paths are specified to settle the signal *and* drop the entry in one step, identity-guarded.

## 2.6 Extraction contract (`ViewerModelAdapter`, 909–974 + Data Flow step 3, 2243–2365)

- **Never the recursive form.** `enumNodeFragments(dbId, cb, true)` was removed from the design entirely;
  "No code path in this design may call the recursive form" (911–921).
- **"`getChildCount` is not one of the walk's primitives"** (921–922) — pointing at the Data-Flow-step-3
  fanout-ceiling correction.
- Walk primitives: `enumNodeChildren(node, cb, false)` and `enumNodeFragments(node, cb, false)`
  (919–920).
- **Coverage-equivalence argument** (923–939): the recursive form delegates to `enumNodeInstances`,
  which enumerates each visited node's own direct fragments then recurses through a *non-recursive*
  `enumNodeChildren` — so the union of the walk's per-node results is the **same set** (not a superset);
  order not guaranteed, walk dedupes by fragment id.
- **Two conditions equivalence rests on** (940–953): (1) *no truncation* — both early-exit paths reject
  the **entire `findClashes` call** rather than returning a truncated set; (2) *a complete instance
  tree* — an under-reporting tree yields a walk that "finishes **normally**, with a silently short union
  and no budget trip to catch it." "See **Risks**; this spec does not claim to have closed the second."
- ElementId-vs-dbId hazard: `[420270]` is dbId 2530; `enumNodeFragments(420270, …)` returns empty
  (954–961).
- World matrix / world bounds per fragment, snapshotted per call (962–964, 2405–2410).

[SILENT-8] **The instance-tree-readiness forward reference is dangling.** 952–953 and 3540–3541 both
say "see **Risks**" for the incomplete-instance-tree condition, but the Risks section (3854–3935)
contains **no entry** about instance-tree completeness/readiness. `[SILENT]` (carried; H-B9,
disposition 108–109)

---

# 3. Query mode dependencies

## 3.1 `anyComponentInside` — the three stages (canonical statement)

Canonical location: **`ContainmentQuery`, 1880–1935**. Lead-in (1885–1887): "Three escalating stages,
per component — **the third is scoped to `volume-overlap` only; see the note after stage 3 for why
`containment` stops after the second:**"

| Stage | What it does | Cite | Which modes run it |
|---|---|---|---|
| 1 | **Spatially-spread vertex sampling** on stride `ceil(n / samplesPerComponent)`, `samplesPerComponent = 8`; stop at first `inside`/`outside` | 1889–1893 | both `containment` and `volume-overlap` |
| 2 | **Continue through the component** — keep walking remaining vertices until conclusive or exhausted | 1894–1897 | both |
| 3 | **Constructed interior witness** — from a triangle's centroid step ±normal by each `witnessLadder` rung, keep the first probe `classifyPoint` puts `inside` **the component's own geometry**; up to `maxWitnessTriangles = 8` triangles | 1898–1904 | **`volume-overlap` ONLY** |

**The stage-3 scoping note (1915–1935)** — the single source of truth:
- "**This stage is scoped to `volume-overlap`; `containment` never runs it**, and round 9 was the
  correction of an earlier draft that ran it in both" (1915–1916).
- Reason: the witness is built *inside the source's own volume*, off the surface entirely — right for
  `volume-overlap`, wrong for `containment`'s surface-only contract (1916–1923). Counterexample: two
  coincident closed boxes.
- "`containment`'s use of `anyComponentInside` … therefore **stops after stage 2**" (1925).
- **Not the same as asserting clean-false** — a component unresolved after stage 2 stays unresolved and
  follows the "unresolved component → diagnosed negative" rule; `SurfaceCrossingWitness` is what
  discharges the "surface dips inside without any vertex inside" case (1926–1935).

Resolution rule (1937–1940): "Only if all three stages fail (`volume-overlap`) or the first two fail
(`containment`) is the component unresolved, and a negative result with any unresolved component emits
`inconclusive-containment`."

**Round-19 C-3 landing check — verified by direct re-read.** Every stage-attribution statement now in
the file is consistent with the canonical rule, and the two offending passages were converted to
cross-references:

| Passage | Line | State now |
|---|---|---|
| Components / `ThreeMeshBvhBackend` connectivity paragraph | 1100–1103 | ✅ Now: "the component decomposition (stages 1–2) runs for both modes equally, **independent of which one does or doesn't also reach stage 3** (see the note after stage 3 under `anyComponentInside` for which mode that is)" — no attribution made |
| Round-16 Revision Notes entry | 445–449 | ✅ Annotated, not rewritten: "*(This entry originally went on to attribute stage 3 between the two modes here; that attribution was backwards — see the note after stage 3 under `anyComponentInside` for the correct, canonical statement…)*" |
| Tolerances table `witnessLadder` row | 1304 | ✅ "(`anyComponentInside` stage 3, **`volume-overlap` only**)" — consistent |
| Round-9 changelog entry | 195–202 | ✅ "`containment` now uses `anyComponentInside`'s first two stages only" — consistent |
| `ContainmentModeQuery` first term | 2027–2033 | ✅ "uses only `anyComponentInside`'s stages 1–2 …, never its stage-3 constructed interior witness" — consistent |
| Shared-implementation note | 2087–2090 | ✅ "only the constructed-interior-witness stage (`volume-overlap` only, see above)" — consistent |
| Fixture (coincident boxes) | 3402–3409 | ✅ pins `containment(A,B)` false + `inconclusive-containment` |

No residual inverted attribution found. **C-3 landed.** Note that the rule is still *stated* (not merely
cross-referenced) in five places (1304, 1886, 1915–1925, 2027–2029, 2087–2089) — all mutually
consistent, but the "single source of truth" framing (disposition 77–79) is a cross-reference policy,
not a de-duplication.

## 3.2 Mode → build-phase dependency matrix

| Mode | compaction+weld | connectivity | BVH | Cite |
|---|---|---|---|---|
| `surface-intersection` | ✅ required | ❌ **never** — "the only mode that never calls `anyComponentInside` at all, is genuinely connectivity-free" | ✅ required | 1102–1103, 1648, 2418–2422, 3452–3454 |
| `containment` | ✅ | ✅ required (via `anyComponentInside`, `ContainmentModeQuery` directly) | ✅ | 1096–1103, 1648, 2418–2422 |
| `volume-overlap` | ✅ | ✅ required (via its own containment term, run after `ProperCrossingQuery` returns false) | ✅ | 442–452, 1096–1103, 1648, 3445–3451 |

Corrected in Round 16 from "`containment`-only" (1096–1103, 1648, 513–516, 3805–3808). Fixtures at
3445–3454 pin all three.

## 3.3 Mode composition

```
volume-overlap(A, B) :=  ProperCrossingQuery(A, B)                    (1993–1997)
                      OR ContainmentQuery(anyComponentOf(A) inside B)
                      OR ContainmentQuery(anyComponentOf(B) inside A)
                      -- evaluated in that order with early exit (1999)

containment(A, B)    :=  ContainmentQuery(anyComponentOf(A) inside B)  -- stages 1–2 ONLY (2019–2022)
                      OR SurfaceCrossingWitness(A, B)
                      -- one direction only, no bidirectional evaluation (2024–2025)

surface-intersection :=  first candidate pair that intersects at all — same bvhcast traversal,
                         same maxCandidatePairsExamined, same abort protocol, weaker predicate;
                         no coplanar split, no probe ladder, no closure precondition (1488–1512)
```

## 3.4 `ProperCrossingQuery` (1514–1744)

Steps: (1) `bvhcast` with `intersectsTriangles` — **candidates, not intersections** (1522–1539);
(2) classify candidate coplanar-vs-not *before anything else*, coplanar → `intersectsTriangle` **without**
a target line and continue; non-coplanar false → continue, **do not read `targetLine`** (1540–1557);
(3) midpoint `M` of a valid `targetLine` (1558); (4) four-quadrant probes `P = M + δ·normalize(s₁nA+s₂nB)`
over `offsetLadder` coarsest→finest — crossing iff some probe is `inside` **both** A and B (1559–1573);
(5) **inconclusive probes propagate** → `inconclusive-crossing` (1574–1578); (6) early-exit `true`,
budgets `maxCrossingPairsExamined = 64` (confirmed non-coplanar pairs) and
`maxCandidatePairsExamined = 50_000` (raw candidates) (1579–1590).

**Abort protocol** (1592–1596): exceeding either budget sets `aborted` and returns `true` from the
callback — the caller must check the flag first and report `crossing-budget-exhausted`, "getting this
backwards would turn a timeout into a fabricated clash."

## 3.5 Parity-closure preconditions

Declared mode table (1374–1378):

| mode | question | parity evaluated against | open **source** | open **target** |
|---|---|---|---|---|
| `surface-intersection` | surfaces meet anywhere, touching included | **nothing — no parity at all** | fine, never diagnosed | fine, never diagnosed |
| `containment` | any point **on the source's surface** inside the target's interior | **target only** | fine, never diagnosed | `unverified-parity-operand` (`role:'target'`) |
| `volume-overlap` | do the two solids share positive volume | **both** | `unverified-parity-operand` and/or `unverified-open-component`, `role:'source'` | same, `role:'target'` |

Reinforcing statements: `volume-overlap` needs **both** operands closed **including on the crossing
path** (step 4 classifies probes against both) (1400–1406); `containment` needs **only the target**
closed because the source is sampled, never parity-tested (1407–1410).

Precondition check (1858–1869): "every operand that parity is evaluated against must be a certified
closed manifold"; if not, **every** result depending on that parity — positive *and* negative — carries
`unverified-parity-operand` naming that operand's role. "Which operands those are depends on the
deciding path, not on the mode alone." The check is free (cached manifold flag) (1868–1869).

[AMBIGUOUS-7] **"Requires" — hard precondition or diagnosed caveat?** Public API says `volume-overlap`
"**Requires** BOTH operands certified closed" and `containment` "**Requires** only the TARGET certified
closed" (2479–2486). Everywhere else, an uncertified operand does **not** block the query — the pair
"is still reported rather than skipped; the caveat is what makes it honest" (3107–3112, 1876–1878,
1860–1862). `[AMBIGUOUS]` (carried; H-Q2, disposition 105)

[SILENT-9] **`anyComponentInside`'s stated caller list is stale.** 1751–1752: "`anyComponentInside(source,
target)` — the per-component sampling wrapper below. **`VolumeOverlapQuery` uses this**, and only *after*
`ProperCrossingQuery` has returned false." `ContainmentModeQuery` — which also uses it, via stages 1–2
(2019–2022, 2027–2029) — is not named at this site. `[SILENT]` (carried; H-Q1, disposition 104)

[SILENT-10] **Connectivity's trigger point is explicitly not decided.** 1141–1145: the connectivity slot
is "created on demand at whichever point this spec's connectivity-trigger rule fires (see the narrow
phase in **Data Flow** step 3 and 'Connectivity remains independently lazy' above — **this state model
does not by itself decide that trigger point**)". Data Flow step 3 (2418–2422) puts connectivity
eagerly in the get/build sequence "(only for a mode that calls `anyComponentInside`)", *before* the
query runs — whereas `VolumeOverlapQuery` only reaches its containment term after
`ProperCrossingQuery` returns false (1097–1099, 1994–1997), so a `volume-overlap` pair decided by the
crossing term consumes connectivity it never uses. `[SILENT]`/`[AMBIGUOUS]` (carried; H-Q4,
disposition 105–106)

## 3.6 Solid model (1325–1370)

- **Target interior = even-odd (parity) over its entire triangle set** (1332–1341). Justification:
  hollow solids/pipe bores. Declared limitation: two genuinely nested independent solids in one geometry
  read the inner region as cavity (1343–1350). Fixtures: 3279–3283.
- **Source contributes as the union of its components** (1352–1356) — union on the source side, even-odd
  on the target side, "that asymmetry is intentional."
- **Only closed components can establish positive volume** (1358–1359).

## 3.7 `classifyPoint` (1746–1800)

Three-valued `inside | outside | boundary`. (1) surface-proximity pre-check via `closestPointToPoint`,
≤ `surfaceEpsilon` → `boundary` immediately (1765–1769); (2) parity in the target BVH's local space:
`THREE.DoubleSide`, three **generic non-axis-aligned** local directions tried in order, sort-then-merge
hits within `mergeDistance`, `barycentricEpsilon` edge/vertex rejection → retry next direction, all
three graze → `boundary`; else odd = `inside` (1770–1800).

Budget: `maxContainmentSamples = 512` global, hitting it emits `incomplete-component-coverage`
(1942–1943).

---

# 4. Synchronous-work / budget model

## 4.1 The two tiers

Stated explicitly because "one flat '~16ms for every synchronous step' claim doesn't survive contact
with the design's own non-preemptible primitives" (1637–1643):

1. **A per-atomic-operation ceiling** — three build phases (weld, connectivity, BVH) each cost ~a full
   frame with no internal hook; each gets its own yield-and-revalidate checkpoint immediately *before*
   it starts so none is ever compounded with other work (1674–1687, 1104–1113). Every other atomic
   primitive (one raycast, one proximity check, one `classifyPoint`, one probe) is *expected* to be a
   small fraction of a frame — "**reasoned, not measured**" (1682–1687).
2. **A cooperative-composition ceiling** — what `frameBudgetMs = 8` actually bounds (1688–1703, 2102,
   2440–2441). Round 11 moved checkpoints to per-probe / per-`classifyPoint` granularity so overshoot
   is bounded by **one** atomic operation; Round 15 added the per-dbId and pre-broad-phase checkpoints;
   Round 18 added the per-instance-pair checkpoint inside the broad-phase scan.

`frameBudgetMs = 8` — "half the one-frame target, since a checkpoint can only fire *between*
primitives, not preempt one" (2440–2441). Yield primitive: `requestAnimationFrame`/`setTimeout(0)`
(2441–2442).

## 4.2 The atomic-operations table (1645–1655) — extracted verbatim in structure

| Row | Measured / reasoned | Value | What it bounds |
|---|---|---|---|
| `maxSyncTriangleCount` — **compaction + welding phase** | **Measured** (R15, weld only): ~16.8ms @ ~19,800 tris; compaction's own cost unmeasured | `12_000` | Non-preemptible; against the **compacted active-range** set, not the raw index. Own checkpoint before it starts. (1647) |
| `maxSyncTriangleCount` — **connectivity phase** | **Measured** (R15): ~6.9ms edge-map @ ~19,800 tris | `12_000` | Non-preemptible; independently lazy; runs first time a mode calling `anyComponentInside` (`containment` **or** `volume-overlap`) touches the record; **never** for `surface-intersection`-only. Own checkpoint. (1648) |
| `maxSyncTriangleCount` — **BVH phase** | **Measured** (spike): ~16ms @ 18k tris | `12_000` | Non-preemptible; the one phase every mode needs. Own checkpoint. (1649) |
| `maxCandidatePairsExamined` | **Measured**: ~0.3µs / raw candidate pair | `50_000` | Raw `bvhcast` candidate rejection, checked at callback entry (1650) |
| one probe / one `classifyPoint` call | **Reasoned, not yet measured** | — | Checked before every occurrence; composition is what `frameBudgetMs` bounds (1651) |
| `maxFragmentsPerDbId` | **Reasoned, not yet measured**; note now says "a later invariant-audit fix, **C-1, removed `getChildCount` from this walk entirely**" | `5_000` (provisional) | Bounds **cumulative work across the walk only** — aborts between nodes as soon as the tally crosses; does **not** bound any single node's own `enumNodeFragments` call (1652) |
| one `enumNodeFragments(node, cb, false)` call | R17 reasoned; **R18 correction: R17's justification is factually wrong** (`ObjectTree.getInstanceCount` exists; truthy-return interrupt documented for `enumNodeInstances`) | **— (no ceiling; accepted atomic risk — flagged for re-derivation)** | Non-preemptible, same category as the three `maxSyncTriangleCount` phases; "unbounded **by choice of scope, not by API limitation**"; follow-up pass required (1653) |
| **`maxChildrenPerNode`** | R18 reasoned, not measured; deliberately **not** derived from the ~0.3µs `bvhcast` figure ("a different API boundary") | `10_000` (provisional) | **"Enforced … by exactly one mechanism, not two."** `getChildCount` **removed from this enforcement path entirely — "it is never called here, for any node shape."** The **in-callback abort inside non-recursive `enumNodeChildren(node, cb, false)`** is the sole mechanism: callback counts its own invocations, returns truthy the moment the count would exceed the ceiling → **at most `maxChildrenPerNode + 1` callbacks** regardless of real fanout, "for a fragment-free node exactly as for a mixed one, with no distinction in the enforcement logic." Tripping **rejects the whole `findClashes` call**, naming node + observed partial child count + dbId — a plain rejection, **not** a `ClashDiagnostic`. "**This spec does not claim `10_000` callbacks fit inside `frameBudgetMs`**" (1654) |
| `maxBroadPhaseInstancePairs` | Reasoned, not measured; one AABB test O(µs) | `1_000_000` (provisional) | Pre-scan rejection via **overflow-safe division** (`sourceCount > ceiling / targetCount`). R18: ceiling bounds pairs tested, not span (~1,000ms ≈ 60× the gate's ~16ms) → scan now checks the shared accumulator **before each individual instance pair**, yields and resumes mid-scan → **cooperatively yieldable**, overshoot bounded by one AABB test. Ceiling retained unlowered (bounds total work, candidate-list memory, downstream narrow-phase work) (1655) |

**Round-19 C-1 landing check — verified by direct re-read of every `getChildCount` occurrence
(18 total).** Normative sites are correct:

| Site | Line | State |
|---|---|---|
| `ViewerModelAdapter` primitive list | 921–922 | ✅ "**`getChildCount` is not one of the walk's primitives**" |
| Atomic-operations `maxChildrenPerNode` row | 1654 | ✅ sole-mechanism wording; "never called here, for any node shape" |
| Atomic-operations `maxFragmentsPerDbId` row cross-ref | 1652 | ✅ names C-1 and the removal |
| Data Flow step 3, fanout ceiling | 2258–2295 | ✅ "**the sole enforcement mechanism, for every node shape**"; preflight explicitly removed; three normative implementation constraints retained (local flag not return value because dbId `0` is falsy; callback collects ids only, never descends inline; typings declare `void`, contradicting the documented contract, so pin by test) |
| Data Flow step 3, wide-but-fragment-empty case | 2312–2328 | ✅ "caught by `maxChildrenPerNode`'s **in-callback abort alone**"; preflight "never load-bearing here either" |
| Data Flow step 3, `enumNodeFragments` atomic-risk paragraph | 2333–2362 | ✅ retains the risk, notes C-1 found `getChildCount` unsound and that whether `getInstanceCount` fares better "is unverified and belongs to this row's own re-derivation, not to that fix" |
| Error Handling entry | 3064–3082 | ✅ single mechanism, for every node shape |
| Fixtures | 3542–3565 | ✅ run twice (fragment-free / mixed), assert **exactly `maxChildrenPerNode + 1`** invocations and that **`getChildCount` is never called**; first-child-dbId-`0` case; companion at-the-ceiling fixture asserting **exactly `maxChildrenPerNode`** invocations, complete enumeration, no rejection |
| Performance gate | 3823–3835 | ⚠ measures `maxChildrenPerNode + 1` callbacks and asserts the abort fires — **does not mention `getChildCount`** (consistent) |

[CONTRADICTION-4 — **C-1 incompleteness, changelog side**] **Two Revision Notes entries still assert
the removed preflight as current normative design, un-annotated.** Round 16's entry lists the walk's
primitives as "`enumNodeChildren`/**`getChildCount`**/non-recursive `enumNodeFragments`" (457–458).
Round 17's entry states: "**`getChildCount(node)` (verified, both classes) is now the explicit,
normative preflight before every `enumNodeChildren` call** — not merely 'useful where cheap' as round
16's wording had it" (496–498). Both directly contradict 921–922 / 1654 / 2272–2274 / 3550–3555.
Round 19 *did* annotate a comparable stale changelog claim for C-3 (446–448), establishing the pattern,
and the disposition's own grep claim — "no `getChildCount` occurrence outside historical/explanatory
context (18 remaining occurrences, all either Revision Notes history, the corrected table row …, or
fixture assertions that it is *never* called)" (disposition 124–126) — treats "Revision Notes history"
as self-evidently safe, which for 496–498 means an un-annotated present-tense normative assertion
("is now the explicit, normative preflight"). `[CONTRADICTION]` — recorded, severity not adjudicated.

## 4.3 Worst-case-span formula (1705–1728)

> "For the cooperative-composition tier, the resulting worst-case single synchronous span is bounded by
> roughly `max(frameBudgetMs + one small atomic operation's cost, one build-phase's own cost)`"
> (1705–1707)

— "dominated by the ~16ms class of cost shared by all three build phases (weld, connectivity, BVH — no
longer just the BVH build), not by `frameBudgetMs` alone."

**Explicit exclusion** (1708–1718): one non-recursive `enumNodeFragments(node, cb, false)` call "is
**explicitly excluded from the formula above and from any finite worst-case-span guarantee this spec
makes**." A pathological node "can produce a single synchronous span longer than the formula's value by
a margin this spec does not state, because it does not know it."

**What the formula does bound** (1720–1728): "the three `maxSyncTriangleCount` build phases, the
`maxChildrenPerNode`-capped `enumNodeChildren` call, the now-chunked broad-phase scan, and the
per-primitive checkpoints above" — and "only as good as the table's unmeasured rows."

[SILENT-11] **`releaseEpochScopedState` and `dispose()`'s wholesale clear are not classified anywhere in
the atomic-operations table.** Both are synchronous sweeps over `GeometryRegistry` (2577–2587,
2677–2687) with unbounded entry counts, and neither appears in 1645–1655 nor in the formula's
"what it bounds" list (1720–1726). `[SILENT]` (carried; H-B6, disposition 107)

[SILENT-12] The formula lists the broad-phase scan as bounded, but the scan's own longest uninterrupted
span is what the gate is asked to measure (3814–3817) — i.e. the bound is asserted before the
measurement that would establish it. Recorded as stated, not adjudicated. `[SILENT]`

## 4.4 The performance gate (3767–3852)

Two runs (cold + cache-warm) of one `volume-overlap` query on an MEP-scale model (3767–3782).

Pass criteria (3784–3843):
1. "**no single synchronous task exceeds `frameBudgetMs`'s tolerance band around ~16ms**", both runs
   (3784–3786);
2. any budget that trips does so with the correct diagnostic rather than a freeze or fabricated clash;
3. per-candidate/per-build costs recorded next to `measure.mjs`'s synthetic figures;
4. **one `classifyPoint` call and one crossing probe measured directly** (3791–3798);
5. **each of the three build phases measured individually at `maxSyncTriangleCount`**, with the
   connectivity run distinguished from a `surface-intersection`-only run (3799–3808);
6. **extraction cost for the largest single requested dbId + the broad-phase scan's cost**, and since
   R18 the scan's **longest uninterrupted span** between yields plus (a) the cost of one
   `performance.now()` read relative to one AABB test and (b) the candidate-list size at the ceiling
   (3809–3822);
7. **R18: one `enumNodeChildren` call at the fanout ceiling** measured separately — `maxChildrenPerNode + 1`
   callbacks on the widest node **and an assertion that the abort actually fires**; typings declare the
   callback return `void`, contradicting the Reference Guide, "so this is a behaviour the gate must
   observe rather than trust" (3823–3835);
8. **R17: worst-case cost of one `enumNodeFragments(node, cb, false)` call** measured separately
   (3836–3843).

Whatever the numbers, they "replace the 'reasoned, not yet measured' qualifier on every still-unmeasured
row"; `maxSyncTriangleCount = 12_000` "remains provisional until it has" run (3845–3848).

[CONTRADICTION-5] **The gate's own pass criterion contradicts the two-tier model.** Criterion 1 states
"no single synchronous task exceeds `frameBudgetMs`'s tolerance band around ~16ms" (3784–3785) —
but `frameBudgetMs = 8` (2102, 2440), and ~16ms is the *per-atomic-operation* ceiling, a different tier
(1637–1643, 1674–1687). The criterion conflates the two constants into one band. `[CONTRADICTION]`
(carried; H-B8, disposition 108)

[AMBIGUOUS-8] The gate is stated as a `volume-overlap` query (3768), while criterion 5 requires
distinguishing a `surface-intersection`-only run (3806–3808) and criterion 1 requires measurement on
"both runs" (cold/warm). Whether that is three runs or two is not stated. `[AMBIGUOUS]`

---

# 5. Cache ownership / cleanup

## 5.1 Inventory

| Cache | Key | Owner | Contents | Cite |
|---|---|---|---|---|
| `GeometryRegistry` | `(loadEpoch, geometryIndex)` | `CollisionWorld` | `GeometryRecord`: `referenceCount`, `buildState`, `weldPromise`, `accelerationPromise`, lazy `connectivity` promise, entry-scoped cancellation signal, `L_X`; **or** an oversized marking (no `buildState`) | 1057–1076, 1165–1186 |
| `BlasCache` | via the record's `accelerationPromise` slot | `CollisionWorld` | the `MeshBVH`; **owns no dedup mechanism of its own** | 1236–1244 |
| `GeometryConnectivity` cache | same entry's connectivity slot | `CollisionWorld` | component decomposition + manifold flags, "cached alongside the BLAS" | 1463–1467, 1868–1869 |
| room-dbId cache | `Map<Model, Promise<number[]>>` | **the extension**, not the world | resolved room dbIds per exact `Model` object | 2116–2120, 2645–2647 |
| `liveModelByModelId` | `modelId` | `CollisionWorld` | current live object for an id — **bookkeeping/diagnostics only** | 2734–2745 |
| `modelLifecycle` | `Model` object | `CollisionWorld` | liveness authority; never deleted; non-enumerable | 2718–2733 |
| `CollisionInstance`s / candidate list | — | **call-local**, per `findClashes` call | world matrix + world bounds **snapshotted during extraction** | 2364–2365, 2405–2410 |

[CONTRADICTION-6] **Is `CollisionInstance` state cached or call-local?** 2405–2410: "each
`CollisionInstance`'s world matrix and world bounds are **per-call snapshots** … and the candidate list
is **call-local**". But 2822–2824 speaks of "before touching any **cached** BLAS, `GeometryRecord`, or
**`CollisionInstance`** for that model", 3581–3584 of "must not touch any **cached** BLAS/instance/geometry
state", and 3634–3637 asserts a new object's "`CollisionInstance`/BLAS/geometry cache must be asserted
unchanged afterward (same object references, no rebuild triggered)". No `CollisionInstance` cache is
ever defined, keyed, or released anywhere. `[CONTRADICTION]` (carried; H-2/H-3 cache-adjacent,
disposition 104)

## 5.2 What each release path does

**`releaseEpochScopedState(epoch)` — called by `evictModel` only when `previous?.state === 'live'`**
(2573, 2577–2607):
- Sweeps `GeometryRegistry` for every entry filed under that epoch — "**in whichever build state,
  `'building'` or `'ready'`, plus any oversized marking**" — and drops each with its cached BLAS and
  cached connectivity (2577–2579).
- "**For every entry it removes, regardless of `buildState`, it first rejects that entry's cancellation
  signal** — the same signal created once when the entry was first inserted and **carried unchanged
  across its `'building' -> 'ready'` transition, never scoped to `'building'` alone** — which every
  unresolved phase slot the entry hosts races, **including a lazy connectivity build in flight against
  an already-`'ready'` entry**; this settles each in-flight build promise **exactly once** (clearing a
  map does not by itself settle a pending promise)" (2579–2585).
- "The entry is then deleted **identity-guarded** — deleted only if the registry still holds this exact
  entry for that key — **in the same step**, so a late-resolving continuation from the just-rejected
  phase can never republish or mutate state after the entry is gone" (2585–2587).
- Reachability depends on publish-on-start (2588–2591).
- Needs **no** occupancy check against `liveModelByModelId` — the epoch key partitions the space
  (2593–2597).
- **Must be non-throwing** (2597–2603).
- Additionally deletes `liveModelByModelId`'s entry if this object is still the occupant — bookkeeping
  only (2604–2607).

**`dispose()`'s wholesale clear** (2677–2687, 2869–2882):
- Clears `GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity` — "the entire cache, in
  one operation, not a per-model sweep over `liveModelByModelId`".
- "**rejects every in-flight build promise, for every entry it removes regardless of `buildState`**": a
  `'building'` entry is reachable by publish-on-start, "and a `'ready'` entry currently hosting an
  in-flight lazy connectivity build is reachable the same way, because that same **entry-scoped
  cancellation signal is carried unchanged across the entry's `'building' -> 'ready'` transition rather
  than discarded at it**" (2679–2683).
- "The clear rejects each removed entry's cancellation signal — which every unresolved phase slot on it
  races, whether that slot is weld, BVH, **or a later lazy connectivity build** — **exactly once**, in
  the same pass that drops the entry, **identity-guarded** so a late-resolving continuation cannot act
  on an entry already gone" (2683–2687).
- "A wholesale clear cannot suffer the same enumeration gap a per-model sweep can, because it never
  needs to identify *which* models were live" (2880–2882).
- **Does not touch the extension-owned room cache** (2645–2647, 2908–2910).

## 5.3 Room-cache rejection semantics (Round-19 C-4) — **verified landed**

The single unified rule, stated at three sites, all now consistent:

| Site | Line | Text |
|---|---|---|
| General rejection rule | 2143–2152 | "On rejection, the handler deletes that model object's cache entry — guarded by identity, `if (roomCache.get(model) === thisPromise) roomCache.delete(model)` … **This identity-guarded delete is unconditional: every rejection path in this mechanism uses it, with no special-cased exception (see the invalid-lease branches below).**" |
| Success callback, **invalid** lease branch | 2176–2204 | "→ reject, and apply **the same identity-guarded delete every rejection path in this mechanism uses** (`if (roomCache.get(model) === thisPromise) roomCache.delete(model)`) — **no special-cased 'leave the cache untouched' exception for this branch.**" |
| Error callback | 2209–2217 | "Both callbacks use one mapping, and **both apply the identical identity-guarded delete-on-rejection rule** described above — **there is no 'leave the cache untouched' exception for either callback's invalid-lease branch.** A design in which the two callbacks classify the same invalid lease differently, **or delete the cache entry in one but not the other, is a bug.**" |
| Success callback, **valid** lease branch | 2205–2208 | Also checks `roomCache.get(model) === thisCall's own promise` before writing and resolving |
| Fixture | 3707–3717 | Now pins **deletion**: "the cache slot for this promise must be **deleted** (identity-guarded: assert `roomCache.get(model)` no longer holds this promise, not merely that some entry exists), **not left cached**" + "**Assert the same for the error callback** … including the delete" + an explicit retry-after-rejection assertion ("A follow-up `locateElementByRoom` call for the same model afterward must trigger a fresh `model.search`, not replay the rejection or any stale state — … now confirmed for the invalid-lease branch specifically") |

A grep confirms the only two remaining occurrences of "leave the cache untouched" (2180, 2215) are the
new sentences **stating that the exception no longer exists**. **C-4 landed.**

Related, unchanged: `admitModel` is called synchronously **before** `model.search` starts, and throws
(→ the returned promise rejects) if already tombstoned or the world is disposed, "without ever calling
`model.search` at all" (2170–2175). The general retry-after-rejection fixture is at 3604–3607.

[SILENT-13] **The room cache has no stated release path on `world.dispose()`.** `dispose()` "never
touches it" (2645–2647); `unload()` "clears the per-model room cache" (2893) as its third step, after
`dispose()` and listener removal, whose per-step isolation is explicitly open (2902–2905). A world
disposed without `unload()` running to completion leaves the room cache stated-unowned. `[SILENT]`

## 5.4 Consistency between release paths

| Property | `evictModel` / `releaseEpochScopedState` | `dispose()` | Consistent? |
|---|---|---|---|
| Scope | one epoch's entries | every entry, wholesale | by design (2577–2578 vs 2677–2679) |
| Rejects cancellation signal for every removed entry regardless of `buildState` | ✅ 2579–2583 | ✅ 2679–2686 | ✅ (post-C-2) |
| Covers a `'ready'` entry hosting lazy connectivity | ✅ 2582–2584 | ✅ 2681–2685 | ✅ (post-C-2) |
| Settles exactly once | ✅ 2584 | ✅ 2685 | ✅ |
| Identity-guarded delete in the same step | ✅ 2585–2587 | ✅ 2686–2687 | ✅ |
| Covers oversized markings | ✅ explicitly (2578) | implicit in "the entire cache" (2677–2679) | see [AMBIGUOUS-5] |
| Non-throwing requirement stated | ✅ 2597–2603 | ❌ not stated | [SILENT-14] |
| Touches `liveModelByModelId` | deletes if still occupant (2604–2607) | "best-effort tombstones whatever it currently references" (2687–2689) | asymmetric, both declared non-load-bearing |
| Touches the extension room cache | ❌ never (handler does it) | ❌ never (2645–2647) | ✅ |

[SILENT-14] **`dispose()`'s clear carries no non-throwing requirement**, although `releaseEpochScopedState`
does and for the same structural reason (a partial failure leaves state unreleased and unretriable)
(2597–2603 vs 2677–2687). `[SILENT]`

---

# 6. Cross-cutting observations from this extraction pass

These are **recorded, not adjudicated** — they are places where the Round-19 disposition doc's account
and the current text differ, or where a Round-19 fix appears complete on the normative side but leaves
a matching statement elsewhere.

1. **All four Round-19 fixes landed on the normative side.** Every site the disposition names
   (24–96) was re-read at this revision and matches the claim. C-2's four sites, C-3's two passages,
   C-4's three sites and its fixture, and C-1's seven sites plus two fixtures all check out.
2. **C-1 is incomplete on the changelog side** — see [CONTRADICTION-4] (lines 457–458 and 496–498).
3. **C-2's own wording introduces two new tensions** — see [AMBIGUOUS-5] (oversized markings have no
   cancellation signal but both release paths say they reject one for every removed entry) and
   [AMBIGUOUS-6] (the "at most one unresolved phase per entry" justification versus the
   `'ready'`-then-connectivity ordering C-2 exists to cover).
4. **Line-count drift.** The disposition says the file is 3935 lines after the pass (9–10); it is
   **3993**. The Status line (3–19) still describes the document as post-round-17 with Round 18 as the
   latest fix pass and makes no mention of Round 19 or `invariant-audit-v2.md`'s successor — it does
   name `invariant-audit-v2.md` at line 19, but the Round-19 entry (579–635) and
   `round-19-critical-fix-pass-disposition.md` are not reflected in it. `[SILENT]`
5. **Deliberately-untouched residuals confirmed still present**, exactly as the disposition's
   "What was deliberately not touched" section claims (100–113): `tearDown()`/`keepCurrentModels`
   [SILENT-5], listener timing [SILENT-4], the stale disposal-rule changelog entries
   [CONTRADICTION-1], `unload()` per-step isolation (2902–2905), the `CollisionInstance`-cache gap
   [CONTRADICTION-6], `anyComponentInside`'s caller list [SILENT-9], the "requires" precondition
   ambiguity [AMBIGUOUS-7], the connectivity trigger gap [SILENT-10],
   `SurfaceCrossingWitness`'s scheduling class [CONTRADICTION-2], `releaseEpochScopedState`/`dispose()`
   unclassified in the table [SILENT-11], the `bvhcast` clock [AMBIGUOUS-1], the gate's pass criterion
   [CONTRADICTION-5], the dangling Risks forward reference [SILENT-8], the compaction/gate transposition
   [CONTRADICTION-3], `referenceCount` [SILENT-7], and the `>=`/`>` boundary [AMBIGUOUS-3].
6. **The broad-phase checkpoint-enumeration item (H-B5)** surfaces here as [AMBIGUOUS-2] (checkpoints
   say "the model's load epoch", singular) and the step-3 sibling-node checkpoint
   ([AMBIGUOUS] row #3 in §1.5, 2329–2331, which names only `frameBudgetMs` and never restates the
   two-part liveness protocol).

---

# Appendix: candidate items for the audit pass

Every marker placed above, numbered for triage. **No severity is assigned** — that is the next step's job.

**Silences**

1. **[SILENT-1]** `options.model` in `fromViewer` (2465) has no contract anywhere else in the document.
2. **[SILENT-2]** `dispose()` never states whether `liveModelByModelId` is cleared, nor how unreached
   `modelLifecycle` entries are handled (2687–2692, 2866–2870).
3. **[SILENT-3]** Four rejection paths name no error class: budget-ceiling rejections (2283–2285,
   2302–2305, 2369–2371), cross-model query (3124–3126), invalid dbId (3130), unsupported
   `fromViewer` option value (2465–2468).
4. **[SILENT-4]** `BEFORE_MODEL_UNLOAD_EVENT` listener registration site/timing never stated
   (2890–2893). *(H-L4)*
5. **[SILENT-5]** `tearDown()` / `keepCurrentModels` never modeled; `keepCurrentModels` appears nowhere
   in the file. *(H-L1/H-L2)*
6. **[SILENT-6]** Whether `BEFORE_MODEL_UNLOAD_EVENT` can fail to fire is self-declared open, and every
   race-safety guarantee is conditioned on it (3986–3989).
7. **[SILENT-7]** `referenceCount` declared once (1060), never used anywhere.
8. **[SILENT-8]** The instance-tree-readiness "see **Risks**" forward reference (952–953, 3540–3541) has
   no target — Risks (3854–3935) has no such entry. *(H-B9)*
9. **[SILENT-9]** `anyComponentInside`'s caller list (1751–1752) omits `ContainmentModeQuery`. *(H-Q1)*
10. **[SILENT-10]** Connectivity's trigger point declared undecided at 1141–1145 while Data Flow step 3
    (2418–2422) builds it eagerly before the query runs, ahead of `VolumeOverlapQuery`'s early-exit
    crossing term. *(H-Q4)*
11. **[SILENT-11]** `releaseEpochScopedState` and `dispose()`'s clear are unclassified in the
    atomic-operations table (1645–1655) and absent from the worst-case-span "what it bounds" list
    (1720–1726). *(H-B6)*
12. **[SILENT-12]** The worst-case-span formula claims the broad-phase scan as bounded (1721–1722) while
    the gate is asked to measure the span that would establish it (3814–3817).
13. **[SILENT-13]** No stated release path for the extension-owned room cache on `world.dispose()`
    (2645–2647, 2893, 2902–2905).
14. **[SILENT-14]** `dispose()`'s wholesale clear carries no non-throwing requirement, unlike
    `releaseEpochScopedState` (2597–2603 vs 2677–2687).
15. **[SILENT]** Status line (3–19) does not reflect Round 19 or its disposition doc; disposition's
    stated post-pass line count (3935) does not match the file (3993). *(§6 item 4)*

**Ambiguities**

16. **[AMBIGUOUS-1]** Two clocks for the `bvhcast` time-abort: "since the traversal's own start"
    (1598–1599) vs. the shared "since the last yield" accumulator (2436–2441), with 1740–1741 asserting
    both use "the same clock". *(H-B7)*
17. **[AMBIGUOUS-2]** Checkpoints say "**the** model's load epoch" (singular) while `findClashes` has two
    operand fields (1958–1959, 2386–2387, 2452–2454 vs 2477).
18. **[AMBIGUOUS — §1.5 row 3]** The extraction walk's sibling-node checkpoint (2329–2331) names only
    `frameBudgetMs` and never restates the universal `disposed`-then-epoch protocol.
19. **[AMBIGUOUS-3]** `>=` vs `>` at `maxSyncTriangleCount`: "at or above … is **not** built" (1249–1251)
    vs "if either **exceeds** it, skip" (2414–2416, 3050–3051); fixtures (3510–3515) don't pin 12,000.
20. **[AMBIGUOUS-4]** "Every phase slot runs to settlement" (1152–1155) vs. phase slots being rejected by
    checkpoint failure (1156–1164) and by the cancellation signal (1165–1182).
21. **[AMBIGUOUS-5 — new, C-2-adjacent]** An oversized marking has no `buildState` and no cancellation
    signal (1165–1167, 1183–1186), yet both release paths say they reject "that entry's cancellation
    signal" for **every** entry removed, and `releaseEpochScopedState` explicitly includes oversized
    markings in its sweep (2577–2583, 2683–2686, 2880).
22. **[AMBIGUOUS-6 — new, C-2-adjacent]** "At most one phase ever unresolved on a given entry at a time,
    weld → connectivity → BVH" (1128–1130, 1175–1178) vs. the `'ready'`-then-lazy-connectivity ordering
    the C-2 fix is built to cover (1141–1145, 1168–1171, 3476–3490).
23. **[AMBIGUOUS-7]** "Requires BOTH/the TARGET certified closed" (2479–2486) reads as a hard
    precondition; everywhere else an uncertified operand only produces `unverified-parity-operand` and
    the pair is still evaluated and reported (1876–1878, 3107–3112). *(H-Q2)*
24. **[AMBIGUOUS-8]** Whether the performance gate is two runs or three (3767–3772 vs 3806–3808).

**Contradictions**

25. **[CONTRADICTION-1]** Round-12 (320–323) and Round-14 (383–384) changelog entries state
    `dispose()`'s rule with zero and one exception respectively; current text has two (2531–2533,
    2617–2619, 2668–2676). Neither entry is annotated. *(H-L7)*
26. **[CONTRADICTION-2]** `SurfaceCrossingWitness` classed as a pausable plain-JS loop (1974–1976) and
    as running the "same traversal" as the other two modes (2078), which cannot pause (1620–1622).
    *(H-B4)*
27. **[CONTRADICTION-3]** Compaction-vs-size-gate ordering: "Before welding, **before the ceiling
    check** … materialize a compacted pair" (1193–1196) vs "checked against `activeTriangleCount`
    **before any copying happens** … Only once that check passes does compaction actually copy"
    (1208–1212); fixture 3505–3509 pins the latter. *(H-G2/H-G5)*
28. **[CONTRADICTION-4 — C-1 incompleteness]** Round-16 (457–458) lists `getChildCount` among the walk's
    primitives, and Round-17 (496–498) states in the present tense that it "**is now the explicit,
    normative preflight before every `enumNodeChildren` call**" — both directly contradicting the
    post-C-1 normative text (921–922, 1654, 2272–2274) and the fixtures that assert it is never called
    (3550–3555). Round 19 annotated the analogous stale C-3 changelog claim (446–448) but not these.
29. **[CONTRADICTION-5]** Performance-gate criterion 1 conflates `frameBudgetMs` (= 8) with the ~16ms
    per-atomic-operation ceiling into one "tolerance band" (3784–3785 vs 2102/2440 and 1637–1687).
    *(H-B8)*
30. **[CONTRADICTION-6]** `CollisionInstance` state is call-local per-call snapshots (2405–2410) but is
    referred to as a cache that must be released/asserted-unchanged (2822–2824, 3581–3584, 3634–3637);
    no such cache is ever defined or keyed. *(H-2/H-3 cache-adjacent)*
