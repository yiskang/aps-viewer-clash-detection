# Consolidated Invariant Model — Collision Library Milestone 1 (post-Round-21)

**Built fresh** from `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` as it exists
at 4216 lines, after the Round-21 High-only fix pass (the confirmed-open High findings from
`invariant-audit-v4.md`). No content was carried forward from `invariant-audit-v1.md`,
`invariant-audit-v2.md`, `invariant-audit-v3-model.md`, or `invariant-audit-v4-model.md`; every `line N`
citation below was read directly from the current file during this pass, over a complete sequential read of
all 4216 lines. `invariant-audit-v4-model.md` was consulted **only** for section-structure convention, and
`round-21-high-only-fix-pass-disposition.md` only to know where to look hardest — neither was trusted for
any claim about what the text now says.

**Scope discipline.** This is pure extraction. Where the spec says two things, both are recorded, marked
`[CONTRADICTION]`. Where it is under-determined, `[AMBIGUOUS]`. Where it says nothing, `[SILENT]`. Nothing
here is adjudicated, severity-rated, or repaired — that is the next step's job. Every marker is repeated in
the Appendix for triage. Three items surfaced during the model build itself as genuine tensions needing
adjudication rather than mere extraction; they are called out in §6 and flagged **ADJUDICATION** in the
Appendix.

**The six protected Critical invariants were re-verified, not assumed.** All six still hold in the current
text — see §1.1/§1.7 (Model-object identity / `loadEpoch`), §1.5 (disposed-first checkpoint semantics),
§2.3 (`GeometryRecord` cancellation ownership), §2.4 (active-range gating / compaction / weld / connectivity
/ BVH ownership), §2.7 (extraction's atomic-risk boundaries), §3.2 (the mode dependency matrix). None was
reopened by Round 21.

---

## Reading note — the document's own structure at this revision

| Lines | Section |
|---|---|
| 1–21 | Title / Status header |
| 23–709 | **Revision Notes (post-review)** — Rounds 1–21. Sub-entries at 25 (R1), 38 (R2), 66 (R3), 95 (R4), 130 (R5), 162 (R6), 191 (R9), 223 (R10), 260 (R11), 294 (R12), 332 (R13), 362 (R14), 396 (R15), 439 (R16), 484 (R17), 532 (R18), 593 (R19), 651 (R21). **There is still no Round 7, Round 8, or Round 20 entry**, but Round 21's entry now names Round 20 explicitly (654: "Round 20 (undocumented here — see `round-20-critical-fix-pass-disposition.md`)"). |
| 710–783 | Spike Findings (executable, `spike/`) |
| 784–810 | Purpose |
| 811–831 | Background |
| 832–864 | Milestone Scope |
| 865–979 | Architecture (runtime split, repo layout, dependency pins, vendor plan) |
| 980–1369 | **Components** — `ViewerModelAdapter` 982–1047; `ViewerGeometryAdapter` 1049–1128; `GeometryRegistry`/`GeometryIdentity` 1130–1149; **`CollisionInstance` cache 1151–1162 (new in Round 21)**; `ThreeMeshBvhBackend`/`BlasCache` 1164–1368 |
| 1370–1423 | Tolerances (table at 1396–1405) |
| 1424–1470 | Solid model |
| 1471–2223 | **Query modes and their preconditions** — mode table 1473–1477; welding 1521–1560; `GeometryConnectivity` 1562–1585; `SurfaceIntersectionQuery` 1587–1611; `ProperCrossingQuery` 1613–1852 (atomic-ops table 1750–1761); `ContainmentQuery` 1854–2090; `VolumeOverlapQuery` 2092–2128; `ContainmentModeQuery` 2130–2215; `CollisionWorld` 2217–2222 |
| 2224–2609 | Data Flow — Room Locate Query (step 1: 2226–2376; step 2: 2377–2387; step 3: 2388–2606; step 4: 2607–2608) |
| 2610–3219 | **Public API** — TS block 2612–2857; "Race safety" prose 2859–3046; `RoomLocatorExtension` sketch 3048–3098; diagnostics 3100–3218 |
| 3220–3373 | Error Handling & Edge Cases |
| 3374–4062 | Testing & Verification (unit 3376–3947; integration 3949–3960; performance gate 3962–4062) |
| 4064–4155 | Risks |
| 4156–4217 | Open Questions Deferred to Future Milestones |

**Structural observation about the changelog itself.** The Status header (lines 3–19) still reads
"revised after **seventeen** rounds of codex review", describes Round 18 as the most recent fix pass
("**This is 'Round 18' below**", line 7), and names only `invariant-audit-v1.md` / `invariant-audit-v2.md`.
It is now **four** fix passes stale (18, 19, 20, 21) — one worse than at v4. Round 21's own entry
(651–708) forward-references `invariant-audit-v5.md` (708). `[SILENT]` — no `### Round 20` entry exists;
what is new since v4 is that Round 21's entry at 654 at least *acknowledges* Round 20's existence and
points at its disposition doc, so the changelog is no longer silent about the pass, only about its content.

**Naming collision, carried forward unchanged.** Round 18's entry uses the labels "C4, C5" (line 567) for
`invariant-audit-v1.md` findings. Round 19's entry uses "C-1 … C-4" for `invariant-audit-v2.md` findings,
and the normative text refers to those as "finding C-1" (1757, 1759, 2410, 2469, 2502, 3250, 3737) and
"C-2" (3663). Round 20's C-5 is an `invariant-audit-v3.md` label, referenced at 3678 and 3685. Round 21's
entry (651–708) uses `invariant-audit-v4.md`'s H-* labels (H-L1/H-L2, H-Q1…, H-B5…, H-2/H-3), which appear
**only** inside that entry and nowhere in the normative text. `[AMBIGUOUS]` — four label namespaces are now
in play with no disambiguating convention stated anywhere in the document.

---

# 1. Model / world lifecycle

## 1.1 The two axes

**World axis:** `constructed → disposed`. `disposed: boolean` is a world-level terminal flag (2907–2909,
2820–2823). `dispose()` sets it **first, synchronously, before anything else** (2821–2822, 3008–3009,
3335–3336). It is "the system's single authoritative liveness signal rather than one input among several"
(2907–2909) and "this single write is now sufficient correctness-wise, on its own, for every check
anywhere in the system" (3009–3011).

**Model axis:** `(no entry) → live → evicted`, keyed by the exact `Model` **object**, never by `modelId`
(2876, 2879–2894).

```
modelLifecycle: WeakMap<Model, { state: 'live'; epoch: number } | { state: 'evicted' }>   (2879–2880)
```

- No entry at all = "never admitted *or* evicted — a legitimate first use, the only case `findClashes`
  treats as 'admit fresh'" (2887–2889).
- `'live'` carries `epoch: number`. `'evicted'` **carries no epoch at all** (2719–2722, 2880–2883) —
  "because nothing ever needs to compare one: every liveness/lease check short-circuits on
  `state !== 'live'` before it would ever read `.epoch`" (2721–2722).
- Transition is one-way and permanent: "it never deletes this entry" (2886); "permanently dead in this
  world: nothing re-admits it, ever, because nothing ever clears or overwrites it back to `'live'`"
  (2889–2890).
- `WeakMap` is chosen so "permanent" is free rather than a leak (2890–2894) — **and this is exactly why
  nothing may depend on enumerating `modelLifecycle`** (2893–2894).

**No `'disposed'` state exists on the model axis.** Disposal is world-level only.

**Round-21 scoping statement (new, 2235–2262).** A new paragraph in Data Flow step 1 explicitly bounds the
apparatus: "The `modelLifecycle`/`loadEpoch` tombstone-and-epoch scheme below … is the load-bearing
correctness mechanism **for as long as one `RoomLocatorExtension` instance and its `CollisionWorld` stay
alive** — including multiple admitted models, explicit eviction, delayed eviction, and in-flight work
racing an eviction. It does not, by itself, make the *instance* survive a model switch" (2236–2240). See
§1.8.

## 1.2 World-owned lifecycle state (inventory)

| Name | Type / shape | Cited | Role |
|---|---|---|---|
| `modelLifecycle` | `WeakMap<Model, {state:'live';epoch:number} \| {state:'evicted'}>` | 2879–2894 | authoritative per-object liveness; non-enumerable by design |
| `liveModelByModelId` | `Map<modelId, Model>` | 2895–2906 | **diagnostic/bookkeeping only**; "load-bearing for nothing" (416), "no correctness property … depends on this map's completeness anymore" (2901–2903) |
| `disposed` | `boolean` | 2907–2909 | world terminal flag; checked first everywhere |
| `nextLoadEpoch` | number counter, global to the `CollisionWorld` instance, only ever increments, never reset or scoped per `modelId` | 2910–2915 | `epoch = nextLoadEpoch++` on first admission (2911); guarantees a reused `modelId` still gets a strictly greater epoch (2912–2914) |

## 1.3 `ModelLease`

`{ model, epoch }` (2656, 2928) — "an opaque capture of this exact object's current lifecycle state, valid
until the object is evicted or the world is disposed" (2656–2657).

## 1.4 Public method contracts

### `world.admitModel(model): ModelLease` (2655–2673)

Synchronous, idempotent. Three outcomes **checked in this order** (2658–2659):
1. world disposed → **throws `WorldDisposedError`** (2660)
2. this exact object tombstoned `'evicted'` → **throws `ModelEvictedError`**, immediately, without
   assigning a new epoch — "a model that was ever evicted can never be re-leased" (2661–2662)
3. otherwise → admits if not already admitted (`epoch = nextLoadEpoch++`, records `liveModelByModelId`,
   "same lazy-admission path `findClashes`'s entry check uses") and returns the possibly-pre-existing
   lease (2663–2665)

Idempotence: "calling it again for an already-live object returns a lease with that same epoch (does not
re-admit or reassign)" (2657–2658). Pinned by fixtures 3821–3823 (spy: `nextLoadEpoch` consumed once) and
3824–3827 (evicted object → throws, no epoch consumed).

### `world.isLeaseValid(lease): boolean` (2675–2708)

"Strictly non-throwing and total: for any lease ever returned by `admitModel`, always returns a plain
boolean, never throws" (2676–2677). Checks `disposed` **FIRST, directly** — not inferred from
`lease.model`'s own `modelLifecycle` entry (2677–2678). Body given literally (2679–2681):

```
if (disposed) return false;
const entry = modelLifecycle.get(lease.model);
return entry?.state === 'live' && entry.epoch === lease.epoch;
```

This is **the first of exactly two deliberate exceptions** to "every public method throws
`WorldDisposedError` once disposed" (2687–2691). It "still answers only 'is this lease still valid,'
never why" (2708). A caller needing the cause calls `isModelLive` inside `try`/`catch` (2697–2701).

### `world.isModelLive(model): boolean` (2808–2818)

Checks `disposed` FIRST, directly — **throws `WorldDisposedError`** immediately if set, before consulting
`modelLifecycle` at all (2809–2810). Otherwise `true` iff this exact object has a `{state:'live'}` entry.
**"Never seen before → false"** (2811–2812) — explicitly *not* a pre-admission gate; Round 13 established
that contract is "wrong for a pre-admission gate" and "nothing public still depends on `isModelLive` for
that purpose" (2815–2818).

### `world.evictModel(model): void` (2710–2806)

Takes the exact `Model` object (2711). Body given literally (2724–2729):

```
if (disposed) return;                                     // no-op on a disposed world
const previous = modelLifecycle.get(model);
if (previous?.state === 'evicted') return;                // idempotent no-op
modelLifecycle.set(model, { state: 'evicted' });          // unconditional
if (previous?.state === 'live') releaseEpochScopedState(previous.epoch);
```

- Tombstone write precedes the (conditional) release, and is permanent either way (2730–2732).
- **Second deliberate non-throwing exception**: on a disposed world it returns immediately as a no-op,
  it does **not** throw (2773–2777). Three justifications, "in descending order of force" (2778):
  (1) a throw is verifiably destructive to the *Viewer* — cited to the pinned 7.124.2 bundle,
  `EventDispatcher.prototype.dispatchEvent` (viewer3D.js:13300–13341) with no try/catch,
  `Viewer3DImpl.unloadModel` (34052–34054), `unloadCurrentModel`'s unguarded loop (34253–34258),
  `Viewer3D.tearDown` (26583) wrapping extension unloads but **not** `unloadCurrentModel` (2779–2793);
  (2) nothing left for it to do — `dispose()` already released everything (2794–2798);
  (3) it is the branch the method already had (2799–2801).
- The no-op is **silent** — "a diagnostic on it would fire on every normal teardown" (2802–2803).
- **`releaseEpochScopedState`** — see §2.6 and §5.2. Explicitly required to be **non-throwing**
  (2756–2762): "a version which could throw partway through would leave the tombstone written (correct,
  permanent) but the release incomplete and unretriable, since the now-`'evicted'` entry no longer carries
  the epoch a second attempt would need". Framed as "a state-release/cleanup completeness concern, not a
  liveness-correctness one" (2761–2762).
- `liveModelByModelId` occupancy: deletes the id entry only if this object is still the current occupant
  (2763–2766, 2903–2906) — **explicitly bookkeeping only**.
- The **extension-owned room cache is NOT covered** by the disposed no-op; the handler must drop it
  unconditionally (2804–2806, 3088–3092).

### `world.dispose(): void` (2820–2856)

Terminal. Sets `disposed` FIRST, synchronously (2821–2822). "After `dispose()` returns, every public
method on this world instance — `findClashes`, `admitModel`, `isModelLive`, a second `dispose()` — rejects
or throws `WorldDisposedError`" (2824–2826). Two named exceptions, both of which still check `disposed`
directly and first, differing only in the action: `isLeaseValid` → `false` (2829–2831);
`evictModel` → no-op (2832–2835).

Also: wholesale-clears `GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity`, **and the
`CollisionInstance` cache** — "the entire cache, in one operation, not a per-model sweep over
`liveModelByModelId`" (2836–2838); best-effort tombstones whatever `liveModelByModelId` currently
references, "for diagnostic bookkeeping, but this is no longer load-bearing for correctness" (2848–2853).
A suspended query fails at its next checkpoint because that checkpoint checks `disposed` directly
(2854–2856).

**`dispose()` no longer needs to enumerate and tombstone every live model for correctness, and this spec
no longer claims it does** (3030–3031, 3340–3341).

### `world.findClashes(query)` entry contract (2619–2625, 2972–2993)

Order: `disposed` first (2973, 3013); then, for each of `query.source.model` / `query.target.model`:
a `'evicted'` entry rejects immediately with `ModelEvictedError`; no entry at all proceeds to **lazy
admission** (fresh epoch, `state:'live'`, recorded in `liveModelByModelId`) (2974–2976). "a model object
never seen before is a legitimate first use and is admitted normally; only an object this exact world has
already evicted is rejected" (2624–2625). Also rejects if `source.model !== target.model` (2626,
2389–2390).

A failure at the entry check **or any yield checkpoint aborts the entire call** — never a partial or
diagnosed `ClashResult` (2986–2991).

## 1.5 Checkpoint / yield sites and what each revalidates

**Universal two-part protocol:** `disposed` first and directly, then the model's load epoch
(2601–2604, 3014–3017, 2070–2074, 2085–2086, 2534–2535). `disposed` → `WorldDisposedError`; stale epoch →
`ModelEvictedError` (2987–2988, 2072–2074).

| # | Site | Cited | Yield or abort-only | Revalidates |
|---|---|---|---|---|
| 1 | `findClashes` entry | 2972–2976 | n/a | `disposed`, then tombstone/lazy-admit for both operands |
| 2 | before each requested dbId's extraction | 2391–2395, 2585–2586, 1801–1802 | yield | full two-part |
| 3 | between sibling nodes of the extraction walk | 2477–2479, 2462–2463 | yield | stated only as "a checkpoint against `frameBudgetMs`"; the two-part revalidation is stated universally at 2601–2604 |
| 4 | before the broad-phase scan | 2586, 1801–1802 | yield | full two-part |
| 5 | **before each individual instance pair inside the broad-phase scan** | 2530–2536, 1760, 2586–2587, 1803–1809 | yield-and-resume from exact `(sourceIndex, targetIndex)` | full two-part |
| 6 | before starting each candidate pair (cached or not) | 2585 | yield | full two-part |
| 7 | between each of a pair's composed sub-queries | 2587–2588 | yield | full two-part |
| 8 | **before each build phase** (weld / connectivity / BVH) | 1195–1204, 1237–1246, 2574–2577 | yield | `disposed` first, **then the liveness/epoch of the ONE model that owns this geometry** — the operand whose `loadEpoch` is in the record's key — **and nothing else** (1237–1244) |
| 9 | before each individual probe in `ProperCrossingQuery` | 1713–1730 | **abort-only** (bvhcast cannot pause) | — sets `aborted`; diagnosed `crossing-budget-exhausted` |
| 10 | at `bvhcast` callback entry for raw candidates | 1721–1723, 1755 | abort-only | — |
| 11 | **before each individual `classifyPoint` call** in `ContainmentQuery` sampling | 2065–2074 | yield-and-resume, non-truncating (2082–2084) | full two-part |
| 12 | before each witness-triangle attempt (stage 3, `maxWitnessTriangles = 8`) | 2085–2087 | yield-and-resume | full two-part |
| 13 | before each `SurfaceCrossingWitness` candidate's probe | 2087–2090, 2192–2195 | yield-and-resume | full two-part |

**Site 8 is the deliberate exception to "revalidate both operands":** "It must not reject because the
initiating query's *other* operand was evicted" (1240); "Each caller separately re-validates both of its
own operands at its own checkpoints, before and after awaiting a shared phase slot" (1243–1244); "a caller
whose own query aborts for an unrelated reason does not cancel a phase already in flight: every phase slot
runs to settlement" (1244–1246). Pinned by fixture 3686–3690.

**Round-21 H-B4 verification — landed.** Site 13's scheduling class is now stated consistently: 2087–2090
("all three are plain JS loops with no native traversal in the way") and 2192–2195 ("Same
per-call-checkpointed budget as `anyComponentInside`'s sampling — **a plain JS loop, not a `bvhcast`
traversal** (see 'all three are plain JS loops with no native traversal in the way' above)"). The
contradicting "Same traversal and budget as the other two modes" wording that v4 flagged is **gone** —
grep for "Same traversal" returns zero hits.

**Round-21 H-B5 verification — landed.** The canonical checkpoint enumeration at 2584–2588 now names the
broad-phase scan's own per-pair checkpoint: "not only before each new build phase, but also before
starting each candidate pair (cached or not), before each dbId's extraction (above), **before the
broad-phase scan starts and again before each individual instance pair within it** (round 18's own
per-pair checkpoint — above), and between each of a pair's composed sub-queries."

`[AMBIGUOUS]` — **clock basis at the intra-loop checkpoints is stated three different ways.**
`ProperCrossingQuery`'s time-based abort is now explicitly the shared accumulator: "accumulated
synchronous time since the shared per-call accumulator's last yield — the same `performance.now()`-based
accumulator every other checkpoint in this call reads … **not a private clock local to this traversal**"
(1697–1700, the Round-21 H-B7 fix). But the round-11 paragraph two screens down still says only
"`performance.now()` is read **before each individual probe**" (1719–1720) with no basis named, and
`ContainmentQuery`'s intra-loop checkpoint says "**elapsed time** is read immediately before each sample's
classification. If it exceeds `frameBudgetMs` …" (2068–2069) — likewise unqualified. Line 1848 ("Both
mechanisms key off the same constant and **the same clock**") supports the shared reading but does not say
*accumulator since last yield* versus *wall-clock since some start*. Two of three sites remain
under-specified.

## 1.6 Error types

Exactly two are defined anywhere in the document:

| Error | Raised by | Cited |
|---|---|---|
| `WorldDisposedError` | `admitModel` (2660), `isModelLive` (2809–2810), `findClashes` entry + every checkpoint (2987, 3337), `dispose()`-after-`dispose()` (2824–2826, 3345), room-search callbacks via the disposed-first mapping (2332–2346, 2357–2361), a repeated `unload()`'s second `dispose()` (3073–3077) | throughout |
| `ModelEvictedError` | `admitModel` on tombstoned object (2661), `findClashes` entry + yield checkpoints (2987–2988), room-search callbacks — constructed as `new ModelEvictedError(model.id)` (2338) | throughout |

`isLeaseValid` and `evictModel` raise **neither** — by explicit design (2676–2677, 2773–2777).
`[SILENT]` — no error class is defined for the walk's `maxFragmentsPerDbId` / `maxChildrenPerNode`
rejections or for `maxBroadPhaseInstancePairs`; those are described only as "the same plain call-level
rejection" (2432–2433, 1759, 3253–3255) with no named type. Likewise `[SILENT]` on the error type for a
cross-model query (2389–2390, 3306–3308) and for "Invalid dbId: reject with a clear error" (3312).

## 1.7 `modelId` reuse semantics

`modelId` is used for: `liveModelByModelId` bookkeeping (318–319, 2895–2906); diagnostic metadata on a
`GeometryRecord` (1146–1148); and `ModelEvictedError`'s payload (2338, 2988). It is **not** a cache key
anywhere (Round 14; §2.1, §5.1).

Two supported states are explicitly named:
- A stale/duplicate `evictModel(oldModel)` arriving after a different object already reused the id
  (3357–3365): the old object is tombstoned; the new object's state "was never at risk" because it is
  epoch-keyed.
- Two objects sharing a reused `modelId` **both live simultaneously** (3366–3372, 2899–2901, 3000–3003) —
  "a state round 14's own epoch-keying fix made supported and tested". This is precisely why
  `liveModelByModelId` cannot be a complete enumeration.

## 1.8 Extension-side lifecycle (`RoomLocatorExtension`, 3048–3098)

- `load()` (3051–3061): "awaits `CollisionWorld.fromViewer(viewer, options)` to completion before
  returning; no room resolution here … and no eager BLAS building." **Round-21 H-L4 addition — landed:**
  "The `BEFORE_MODEL_UNLOAD_EVENT` listener and the context-menu item are registered **only after
  `fromViewer()` resolves, inside this same call** — `loadExtension()` treats this extension as ready the
  moment `load()`'s returned promise resolves, and nothing downstream is guaranteed to wait further, so no
  consumer can observe a registered listener referencing a not-yet-constructed world. If `fromViewer()`
  rejects, `load()`'s returned promise rejects with the same error before either registration runs —
  neither exists without the other" (3053–3061).
- `unload()` (3062–3087): `world.dispose()` **first**, listener + context-menu removal **second**, then
  clears the per-model room cache. **Two throw hazards are now documented (Round-21 H-L8 — landed):**
  - Hazard 1 (pre-existing): the window in which `BEFORE_MODEL_UNLOAD_EVENT` can still fire into a
    disposed world, which "can outlive `unload()` itself, since `Viewer3D.tearDown` catches a throw from
    `unload()` while leaving the listener registered". Benign "**but only because** `world.evictModel` is
    a no-op on a disposed world rather than a throw — it is the method's totality that makes this ordering
    safe, not the ordering itself" (3063–3072).
  - Hazard 2 (new): "a repeated `unload()` call re-invokes `world.dispose()`, and a second/repeated
    `dispose()` call is **guaranteed to throw `WorldDisposedError`** …, synchronously, before steps 2/3
    ever run — stranding listener removal, context-menu removal, and the room-cache clear for that
    invocation. `Viewer3D.tearDown` wraps each extension's own `unload()` call in try/catch …, so this
    throw is swallowed rather than propagating — the same 'benign only because something else catches it'
    shape as the first hazard, not a resolution of it. **Whether the Viewer or app code can invoke
    `unload()` a second time on one instance is unstated.**" (3072–3084).
  - **Explicitly left open**: "Per-step isolation of `unload()`'s three steps, and whether the listener
    should be removed before `dispose()` rather than after, remain open and are not settled here"
    (3084–3087).
- `BEFORE_MODEL_UNLOAD_EVENT` handler: `world.evictModel(event.model)` **AND** drop that object's
  room-cache entry, the latter "unconditional and independent of the `evictModel` call" (3088–3092,
  2285–2289, 2804–2806).
- `locateElementByRoom(dbId): Promise<number[]>` — rejects `ModelEvictedError` / `WorldDisposedError`
  (3093–3095).

**Round-21 H-L1/H-L2 verification — landed (2235–2262).** `tearDown()`/`keepCurrentModels` is now modeled.
The stated finding: extensions are registered once, in `config.extensions` at `viewer.start()`
(`wwwroot/viewer.js:15-24`); `loadModel()` passes `viewer.loadDocumentNode(doc, defaultGeometry)` with no
options object (`wwwroot/viewer.js:31-41`), "so `keepCurrentModels` is never set." Loading a second model
therefore invokes `Viewer3D.tearDown()`, which unloads every registered extension, "and nothing in this app
re-registers it afterward" — cited to `viewer3D.js:27710` and `viewer3D.js:88293`. **Conclusion stated:**
"on this app's current wiring, Room Locator **does not survive a second model load at all** — it is
unloaded once and never comes back, a Milestone-1 application-wiring gap, not a defect in the identity
apparatus itself" (2249–2251). The resolution (explicit reload vs. accepting the limit) is "neither …
decided here" (2251–2255). The companion narrowing of the stale Open Question landed at 4209–4212.

`[CONTRADICTION]` — **`tearDown()`-path listener claim vs. `unload()`'s own throw hazards.** Line
2255–2258 asserts: "On the `tearDown()`-driven path specifically, `BEFORE_MODEL_UNLOAD_EVENT` fires only
after `tearDown()`'s own extension-unload loop already ran, **so this extension's listener is already
deregistered and `world.evictModel` is never invoked for the outgoing model that way** — provided
`unload()` itself completes all three of its steps (see `RoomLocatorExtension.unload()`'s
per-step-isolation caveat), `world.dispose()`'s wholesale clear and the room-cache clear already release
everything a per-model `evictModel` call would have". The "provided …" proviso, as punctuated, governs the
*second* clause (what gets released), not the first (whether the listener is deregistered). But
`unload()`'s own note at 3066–3069 and 3072–3083 states two distinct ways `unload()` can fail to reach step
2 — a throw from `dispose()` on a repeated call, and `Viewer3D.tearDown` catching a throw from `unload()`
"while leaving the listener registered" — in which case the listener is **not** deregistered and
`evictModel` **is** invoked (as a no-op) for the outgoing model. The two passages are not reconciled.

`[SILENT]` — `locateElementByRoom(dbId)`'s public signature "is unchanged and still resolves 'the current
model' however it already does" (2269–2270); whether it should take a model argument is explicitly deferred
to `review-comments-v12.md` (2270–2272).

---

# 2. Geometry ownership / build pipeline

## 2.1 `GeometryRecord` identity

One `GeometryRecord` per unique **`(loadEpoch, geometryIndex)`** — keyed by the owning `Model` object's
admitted load epoch, **never** `modelId`, never the bare index (1130–1133, 1038–1047, 2956–2964).
`loadEpoch` = `modelLifecycle.get(model).epoch` (1039, 2959–2960). Because `nextLoadEpoch` is global,
monotonic and never reused, two objects sharing a `modelId` are "structurally guaranteed a disjoint epoch,
and therefore a disjoint `GeometryRecord` namespace, before its first geometry lookup ever runs"
(2961–2964).

Record fields named anywhere: `referenceCount` (1133), `buildState: 'building' | 'ready'` (1133),
`weldPromise` (1134), `accelerationPromise` (1135), lazy `connectivity` promise (1135–1136),
`L_X := diagonal(localBounds(X))` cached with the BLAS (1384–1386), and `modelId` as
display/diagnostic metadata only (1146–1148).

`[SILENT]` — `referenceCount` is named exactly once in normative text (line 1133) and never mentioned
again in 4216 lines (the only other hit is line 647, inside Round 19's list of deliberately-untouched
findings). Nothing states when it is incremented, decremented, or what happens at zero. Unchanged since v2.

## 2.2 The three kinds of registry entry

Stated at 1276–1284: "A registry lookup yields one of three things:"

| Kind | `buildState` | Cancellation signal | Phases | Cited |
|---|---|---|---|---|
| **oversized marking** | **none** ("it carries no `buildState`") | **none, ever** | none ever started | 1276–1284 |
| `'building'` record | `'building'` | created once at insertion | ≥1 unresolved | 1215–1218, 1256–1259 |
| `'ready'` record | `'ready'` | same signal, carried unchanged across the transition | weld+BVH resolved; connectivity may be unresolved | 1229–1236, 1258–1262 |

Oversized marking, verbatim (1276–1284): "*an oversized marking* (no phase is ever started for it, it
carries no `buildState`, and every pair needing it is skipped) … Because an oversized marking is rejected
*before* any build or derived phase ever starts, it has no unresolved phase work and therefore never has
the entry-scoped cancellation signal described above created for it at all — that signal is created
exactly once, at insertion, for a `'building'` entry, a trigger an oversized marking never undergoes.
`evictModel`'s `releaseEpochScopedState` and `dispose()`'s wholesale clear (below) **still enumerate and
remove oversized markings in the same sweep** as `'building'`/`'ready'` entries, but there is no signal on
them to reject — **removal is the entire cleanup**."

## 2.3 The entry-lifetime cancellation signal (Critical invariant — verified intact)

Stated at 1256–1275:
- "Every registry entry carries one entry-scoped cancellation signal, created once when the entry is first
  inserted in `buildState: 'building'` and kept alive, unchanged, for the entry's entire lifetime — the
  signal is *not* discarded or replaced when the entry transitions to `'ready'`." (1256–1259)
- "Every unresolved phase slot the entry ever hosts races that same signal, including a lazy connectivity
  build started later against an already-`'ready'` entry … the signal is scoped to the entry's lifetime,
  not to its `buildState`." (1259–1262)
- "The release paths reject that signal exactly once and drop the entry in the same step …
  unconditionally, for every entry they remove regardless of whether its `buildState` is `'building'` or
  `'ready'`." (1262–1265)
- "one signal per entry suffices; there is no per-phase-slot set or map of signals to keep in sync"
  — justified because "phases are strictly sequential and single-flight per entry … with at most one phase
  ever unresolved on a given entry at a time" (1266–1269)
- Removal is identity-guarded (1269–1273).
- **Round-20 carve-out sentence:** "This entry-lifetime signal is defined only for `'building'`/`'ready'`
  entries — an *oversized marking* (see below) never has one, because no phase is ever started for it and
  it carries no `buildState` to begin with." (1273–1275)

`[CONTRADICTION]` (**pre-existing, byte-identical since Round 20; deliberately untouched by Round 21 per
its own entry at 706**) — the bullet **opens** with the unrestricted universal "**Every registry entry**
carries one entry-scoped cancellation signal" (1256–1257) and **closes**, nineteen lines later, with "This
entry-lifetime signal is defined **only for `'building'`/`'ready'` entries** — an oversized marking … never
has one" (1273–1275). The opening sentence was not narrowed. The intervening clause at 1262–1265
("unconditionally, for every entry they remove regardless of whether its `buildState` is `'building'` or
`'ready'`") sits in the middle: "every entry they remove" is universal, while "regardless of whether its
`buildState` is `'building'` or `'ready'`" enumerates only the two states an oversized marking does not
have.

## 2.4 Pipeline stages, in order (Critical invariant — verified intact)

The build is **not atomic** — a yield-and-revalidate checkpoint sits before each phase (1208–1210,
1195–1199).

| # | Phase | Gated by | Checkpointed | Cited |
|---|---|---|---|---|
| 0 | Layout normalization → `ranges: TriangleRange[]` | — ("free, no per-triangle work") | — | 1294–1296, 1085–1124 |
| 0.5 | **Ceiling check**: `activeTriangleCount := Σ floor(ranges[i].count / 3)` vs `maxSyncTriangleCount` | the ceiling itself, "not gated by `frameBudgetMs`" | — | 1292–1309 |
| 1 | **Active-range compaction** → collision-owned compacted position/index pair | folded into the weld phase's checkpoint | shares the weld phase's own checkpoint | 1292–1316, 1752 |
| 2 | **Weld** (`mergeVertices` on position+index only) → `weldPromise` | `maxSyncTriangleCount` | own checkpoint, before it starts | 1177–1204, 1752, 1530–1534 |
| 3 | **Connectivity** (`GeometryConnectivity`) → own promise slot; **independently lazy** | `maxSyncTriangleCount` | own checkpoint, before it starts | 1180–1195, 1753, 1562–1585 |
| 4 | **BVH** (`MeshBVH`) → `accelerationPromise` | `maxSyncTriangleCount` | own checkpoint, before it starts | 1164–1165, 1754 |

Order is "weld first, then connectivity if it is needed, then the BVH" (1219–1221). All three run over the
**same** compacted buffer; "none of the three ever sees a triangle outside the active ranges" (1312–1313).

`[CONTRADICTION]` (**pre-existing, deliberately untouched — Round 19 list at 646–647, Round 21 list at
706–707**) — line 1293–1294 states the compaction phase runs "**Before welding, before the ceiling
check**, and before anything is handed to `mergeVertices`", while lines 1307–1310 state
"**`maxSyncTriangleCount` is checked against `activeTriangleCount` before any copying happens** … Only
once that check passes does compaction actually copy triangle data". The two orderings are inverted
relative to each other inside the same paragraph. Line 1752's table row calls it a single "compaction +
welding phase". Fixture 3700–3704 pins the 1307 ordering (spy on the compaction step: **zero** calls when
the active count alone exceeds the ceiling).

`[CONTRADICTION]` (**pre-existing, deliberately untouched**) — line 1348 states "A geometry **at or above**
that triangle count is **not** built synchronously" (i.e. `>=`), while line 2562 says "if either
**exceeds** it, skip the pair", line 3232 says "**exceeds** `maxSyncTriangleCount` … is skipped", and line
1308 says "a fragment whose active set alone **exceeds** the ceiling is marked oversized". The boundary
fixture at 3705–3710 uses 13,000 (skip) and 11,000 (build) — which does not discriminate the value
`12_000` itself.

## 2.5 Publication, single-flight, and what a caller may read

Stated at 1205–1255:
- **"A `GeometryRecord` is published when its build *starts*, not when it finishes"** (1205–1207). The
  earlier "only published once every phase completes" rule "could not hold" because the build is
  deliberately not atomic (1208–1210); publish-only-when-complete would defeat dedup and make in-flight
  builds unreachable from `evictModel`/`dispose()` (1210–1214).
- **Insert first, then build**: the missing caller inserts the record with `buildState: 'building'`
  **before the first phase's checkpoint — that is, before any yield** (1215–1218).
- Each phase is a **single-flight slot**, created at most once, on demand, awaiting its prerequisites
  rather than launched in parallel (1218–1221).
- **"A caller that finds an existing entry never starts a duplicate build."** "This single registry-level
  mechanism is what makes concurrent build requests dedupe, and it covers compaction/weld and connectivity
  exactly as it covers the BVH — see `BlasCache` below, **which owns no dedup mechanism of its own**"
  (1222–1225, echoed 1334–1343).
- **"Nothing reads a phase's product off a `'building'` record."** Products are "only ever the resolved
  values of their own phase slots, never fields read straight off the record" (1226–1228).
- **`'ready'` is record-level and mode-independent**: weld+BVH resolved (1229–1231). "it is `'ready'`
  whether or not the connectivity slot was ever created"; "**Connectivity is never what makes a record
  un-`'ready'`**" (1231–1236).
- **A build-phase checkpoint validates the record's owner, not the building caller's whole query**
  (1237–1246) — see §1.5 site 8.
- **There is no `'failed'` state** (1247). A failing build-phase checkpoint rejects the slot and "**the
  entry is removed from `GeometryRegistry` synchronously as part of that rejection**", discarding
  intermediate buffers (1247–1253). Identity-guarded (1253–1255). Pinned by fixture 3637–3644.

`[AMBIGUOUS]` (**pre-existing, three-way, deliberately untouched**) — the connectivity **trigger point** is
explicitly not decided by the state model: "created on demand at whichever point this spec's
connectivity-trigger rule fires (see the narrow phase in **Data Flow** step 3 and 'Connectivity remains
independently lazy' above — **this state model does not by itself decide that trigger point**)"
(1233–1236). Data Flow step 3 (2566–2569) places it inline between weld and BVH ("active-range compaction
and welding together, then (only for a mode that calls `anyComponentInside` …) connectivity, then the
BVH"), which is a *build-time* trigger. Fixture 3652–3657 describes a `containment` caller *driving the
connectivity phase itself against an already-`'ready'` entry* — a third timing. The three are not
reconciled.

`[SILENT]` (**pre-existing, deliberately untouched**) — nothing states whether an **oversized marking**
participates in the single-flight / "caller that finds an existing entry" rule, i.e. whether a second
candidate pair needing the same oversized geometry re-computes `activeTriangleCount` or reads the marking.
Line 1277 says "every pair needing it is skipped" (implying the marking is consulted), while Data Flow's
narrow phase (2559–2566) describes the ceiling check as run per candidate pair *before* the registry
get/build. The `geometry-too-large-for-sync-build` diagnostic is stated to be "fragment-scoped and
deduplicated … one entry is emitted per oversized fragment no matter how many candidate pairs it appears
in" (2564–2566), which requires *some* memory across pairs but does not say it is the marking, and never
names the dedup store.

`[SILENT]` — **nothing states which code path creates the oversized marking, or when.** 1348–1351 says
"`GeometryRegistry` marks the record oversized"; 1308 says "a fragment whose active set alone exceeds the
ceiling is marked oversized"; 2562–2564 says the narrow phase checks the count "first — if either exceeds
it, skip the pair and record a `geometry-too-large-for-sync-build` diagnostic". No passage says the narrow
phase's check is what inserts the marking into `GeometryRegistry`, nor whether the marking is inserted at
all on the first pair that trips it.

## 2.6 Release paths (geometry side)

| Path | Trigger | What it removes | Signal handling | Cited |
|---|---|---|---|---|
| **Build-phase rejection** | owning model evicted / world disposed at a between-phases checkpoint | this entry, synchronously, identity-guarded | slot rejects with `ModelEvictedError`/`WorldDisposedError` | 1247–1255 |
| **`releaseEpochScopedState(epoch)`** | `evictModel` on a previously-`'live'` object | every entry filed under that epoch — "in whichever build state, `'building'` or `'ready'`, **plus any oversized marking**" — with cached BLAS, cached connectivity, **and cached `CollisionInstance`s** | for **every `'building'` or `'ready'` entry it removes**, rejects that entry's signal first; **"An oversized marking carries no such signal — no phase is ever started for it — and is removed directly in the same sweep, with nothing to reject."** Then identity-guarded delete. | 2733–2746 |
| **`dispose()` wholesale clear** | `dispose()` | `GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity`, **and the `CollisionInstance` cache**, in one operation | "For **every `'building'` or `'ready'` entry it removes**, the clear rejects that entry's cancellation signal … exactly once, in the same pass that drops the entry, identity-guarded … **An oversized marking carries no cancellation signal at all — no phase is ever started for it — so the clear removes it directly in the same wholesale pass, with nothing to reject.**" | 2836–2848 |

**Residual C-5 site — still present, confirmed byte-identical.** Line 3032–3041, inside the
"`world.dispose()` is terminal" prose block, still says "…and **rejects every in-flight build promise,
exactly once**, on the same disposal call. 'Every in-flight build promise' is enumerable at all only
because … the unresolved phase slots hanging off the registry's entries … *are* the in-flight builds …
**and the clear rejects each entry's cancellation signal as it drops the entry.**" No oversized carve-out.
`[CONTRADICTION]` — see §5.4.

## 2.7 Extraction contract (Critical invariant — verified intact)

`ViewerModelAdapter` 982–1047 + Data Flow step 3, 2391–2513.

- **No code path may call `enumNodeFragments(dbId, cb, true)`** (993–994). The normative path is the
  self-driven, depth-first, node-by-node walk in Data Flow step 3, built from
  `enumNodeChildren(node, cb, false)` and `enumNodeFragments(node, cb, false)` (991–993).
- **"`getChildCount` is not one of the walk's primitives"** (994–995).
- Coverage-equivalence argument (996–1012), verified against the pinned 7.124.2 bundle's
  `enumNodeInstances`; "**The union of the walk's per-node `enumNodeFragments(node, cb, false)` results is
  therefore the same fragment set one `enumNodeFragments(dbId, cb, true)` call produces**" (1008–1010).
  Walk dedupes by fragment id (1011–1012, 2445–2449).
- Two conditions the equivalence rests on (1013–1026): (1) *no truncation* — both early-exit paths reject
  the entire `findClashes` call; (2) *a complete tree to walk* — **explicitly not closed**: "See
  **Risks**; this spec does not claim to have closed the second" (1026).
- `maxChildrenPerNode` (`10_000`, provisional) — **sole enforcement mechanism is the in-callback abort
  inside non-recursive `enumNodeChildren(node, cb, false)`, for every node shape** (2406–2422, 1759,
  3246–3255). Three normative implementation constraints (2433–2443): local flag not the forwarded return
  value (dbId `0` is falsy); callback **only collects child ids**, never descends inline; typings declare
  both as `void`, contradicting the documented contract, so it must be pinned by test.
- `maxFragmentsPerDbId` (`5_000`, provisional) — tally counts **callback invocations, not distinct
  fragment ids** (2445–2449); checked after every node's contribution; the walk stops immediately and the
  entire call rejects (2450–2453).
- **One node's own `enumNodeFragments(node, cb, false)` call remains an accepted, non-preemptible atomic
  risk** (2481–2510, 1758, 516–519, 3241–3245) — with the explicit note that Round 17's justification for
  it was factually wrong and "a required follow-up this pass did not carry out" (2499–2508).

**Round-21 `getChildCount` changelog-residue fix — landed.** The Round-16 entry's primitive list (463–464)
now carries an in-place annotation at 466–470 ("*This primitive list named `getChildCount` as part of round
16's walk; a later invariant-audit fix, C-1, found it unsound as a fanout preflight and removed it from the
walk entirely — see the canonical statement under* **Components** …"). The Round-17 entry's preflight
bullet (505–507) now carries its own annotation at 507–512 ("*Superseded: a later invariant-audit fix, C-1,
found `getChildCount` is O(1) only for a fragment-free node and linearly scans the same slots
`enumNodeChildren` walks for a mixed one …*"). Both match the document's stated superseded-annotation
convention (452–454).

`[AMBIGUOUS]` — **one unannotated present-tense residue survives in the Round-17 entry's own preamble.**
Line 496–498 still states, without annotation, that "`getChildCount(dbId)`/`getChildCount(node)` is
documented on both the deprecated `InstanceTree` class and its replacement `Autodesk.Viewing.ObjectTree`
as 'Get number of children under the specified id,' **returned without enumerating those children**." That
final clause is precisely the factual claim C-1 refuted for a mixed node (605–610, 1759, 2411–2422). The
Round-21 annotation was attached to the *bullet* at 505–512, not to this preamble sentence, so a reader who
stops at 498 still gets the refuted claim. Whether the annotation at 507–512 is close enough to cover it is
not stated.

---

# 3. Query mode dependencies

## 3.1 `anyComponentInside` — the three stages (canonical statement, 1994–2054)

Preamble: "Three escalating stages, per component — **the third is scoped to `volume-overlap` only; see
the note after stage 3 for why `containment` stops after the second**" (1999–2001).

| Stage | What | Cited |
|---|---|---|
| 1 | **Spatially-spread vertex sampling** — stride `ceil(n / samplesPerComponent)`, `samplesPerComponent = 8`. Stop at first `inside` or `outside`. | 2003–2007 |
| 2 | **Continue through the component** — if every strided pick reads `boundary`, keep walking remaining vertices until conclusive or exhausted. "On a manifold component this is where the guarantee is actually discharged." | 2008–2011 |
| 3 | **Constructed interior witness** — centroid ± normal × each `witnessLadder` rung, keeping the first probe `classifyPoint` puts `inside` **the component's own geometry**; up to `maxWitnessTriangles = 8` triangles. | 2012–2018 |

**Stage-3 scoping (the single source of truth, 2029–2049):** "This stage is scoped to `volume-overlap`;
**`containment` never runs it**, and round 9 was the correction of an earlier draft that ran it in both."
Reason: the witness is constructed inside the source's own volume, off the surface entirely, which
violates `containment`'s surface-only contract; two coincident closed boxes are the counterexample
(2030–2037). "`containment`'s use of `anyComponentInside` (in `ContainmentModeQuery` below) therefore
stops after stage 2" (2039).

Explicit non-claim (2040–2049): stopping after stage 2 "is **not** the same as asserting the component is
clean-false"; an unresolved component "stays unresolved for this term … rather than being asserted false";
what discharges the genuine case is `SurfaceCrossingWitness`'s independent triangle-level search.

Exhaustion: "Only if all three stages fail (`volume-overlap`) or the first two fail (`containment`) is the
component unresolved, and a negative result with any unresolved component emits
`inconclusive-containment`" (2051–2053).

Global cap: `maxContainmentSamples = 512` → `incomplete-component-coverage` (2056–2057).

**Round-21 H-Q1 verification — landed.** The caller list is now stated once and cross-referenced from the
two former restatement sites. Canonical enumeration under `ThreeMeshBvhBackend`/`BlasCache` at 1182–1189
("Both `containment` and `volume-overlap` call `anyComponentInside` (`ContainmentModeQuery` directly;
`VolumeOverlapQuery` through its own containment term, run *after* `ProperCrossingQuery` returns false) …
Only `surface-intersection`, which never calls `anyComponentInside` at all, is genuinely
connectivity-free"). Restatement sites now defer to it: 1859–1863 ("see **`ThreeMeshBvhBackend`/
`BlasCache`** above for the full caller list") and 2210–2212 ("used by `containment` and `volume-overlap`
— never by `surface-intersection` (see **`ThreeMeshBvhBackend`/`BlasCache`** above for the full caller
list)").

## 3.2 Mode → dependency matrix (Critical invariant — verified intact)

| | `surface-intersection` | `containment` | `volume-overlap` |
|---|---|---|---|
| calls `anyComponentInside` | **no** (1189, 2211–2212) | yes, **stages 1–2 only** (2141–2147) | yes, **all three stages** (2029–2030) |
| requires compaction+weld | yes (1178–1179) | yes | yes |
| requires BVH | yes — "the one phase every mode needs" (1754) | yes | yes |
| requires **connectivity** | **no** — "the only mode that never calls `anyComponentInside` at all, is genuinely connectivity-free" (1189, 1753, 2568, 3634–3636) | **yes** (1182–1195) | **yes** (1182–1189; Round 16 corrected the opposite claim, 448–458) |
| parity evaluated against | **nothing — no parity at all** (1475) | **target only** (1476) | **both** (1477) |
| closure precondition | none (1475, 2644) | target only (1506–1509, 2639–2642) | both operands (1499–1505, 2629–2634) |
| open source | fine, never diagnosed (1475, 1476) | fine, never diagnosed (1476, 1960–1963) | `unverified-parity-operand` and/or `unverified-open-component`, `role:'source'` (1477) |
| open target | fine, never diagnosed (1475) | `unverified-parity-operand` (`role:'target'`) (1476) | both diagnostics, `role:'target'` (1477) |

**Round-21 H-Q4 verification — landed (1190–1195).** The connectivity gate's rationale now covers the
target: "This same mode gate also builds connectivity for an operand `anyComponentInside` never itself
decomposes: `containment`'s parity-closure precondition … reads a cached manifold-classification flag off
the *target*'s `GeometryConnectivity`, independent of the source-side component decomposition — so **both
operands' records go through this same connectivity gate** in `containment`/`volume-overlap` mode, not only
the operand(s) `anyComponentInside` samples."

**Round-21 Public-API "certified closed" verification — landed; v4's `[CONTRADICTION]` is resolved.** The
mode comments at 2628–2643 now read: "'volume-overlap' … **Soundest when BOTH operands are certified
closed; an operand that isn't degrades gracefully rather than rejecting** — every result depending on that
operand's parity carries `unverified-parity-operand` naming its role, and a positive whose deciding
component isn't a certified closed manifold also carries `unverified-open-component`"; and "'containment'
… **Soundest when the TARGET is certified closed**; open sources are sound here by construction and are
never diagnosed. An open TARGET degrades gracefully rather than rejecting — the result still runs and
carries `unverified-parity-operand` (role: 'target')." Grep for "Requires … certified closed" returns zero
hits. This is now consistent with 1477, 1990, 3294 ("The pair is still reported rather than skipped") and
fixture 3510–3516.

## 3.3 Mode composition

```
volume-overlap(A, B) :=                                      (2107–2111)
      ProperCrossingQuery(A, B)
   OR ContainmentQuery(anyComponentOf(A) inside B)
   OR ContainmentQuery(anyComponentOf(B) inside A)
```
Evaluated in that order with early exit (2113). Both directions required for symmetry (2117–2119). Pure
touching correctly returns **false** (2119–2121).

```
containment(A, B) :=                                         (2132–2136)
      ContainmentQuery(anyComponentOf(A) inside B)   // a source VERTEX inside B
   OR SurfaceCrossingWitness(A, B)                   // a point on a source TRIANGLE inside B
```
One direction only, no bidirectional evaluation (2138–2139). First term uses stages 1–2 only
(2141–2147). Second term "is not optional" (2149–2157). Stage ordering cheapest-first (2197–2201).

`surface-intersection` — "true iff any triangle pair from A and B has a non-empty geometric intersection,
including zero-volume coincident contact" (1587–1589); the *same* `bvhcast` traversal
`ProperCrossingQuery` uses, sharing `maxCandidatePairsExamined`, the same per-candidate
`intersectsTriangle` test and the same abort protocol, under a weaker predicate (1604–1611).

`[AMBIGUOUS]` — **"stage" names two different nesting levels.** Under `anyComponentInside`, "stage 1/2/3"
are the three escalating per-component searches (2003–2018). Under `ContainmentModeQuery`, "Stage ordering
is cheapest-first … A negative now requires *both* stages to fail … and **stage 2** is what now establishes
the antecedent instead of assuming it" (2197–2201) — where "stage 2" is `SurfaceCrossingWitness`, the mode
composition's *second term*. The same paragraph pair also says "The first term uses only
`anyComponentInside`'s **stages 1–2**" (2141), so both senses appear within sixty lines of each other. The
containment-guarantee restatement at 1920–1921 compounds it: "`ContainmentModeQuery`'s **own two-stage
negative** for `containment`". No disambiguating convention is stated.

## 3.4 `ProperCrossingQuery` (1613–1852)

Six numbered steps (1621–1695): 1. `bvhcast` traversal, callback receives **candidate** pairs not
intersecting ones (1624–1638). 2. Classify candidate first, ordered so the upstream coplanar warning path
is never entered (1639–1656). 3. Midpoint `M` of the valid `targetLine` (1657). 4. Four-quadrant probes
`P = M + δ × normalize(s₁·nA + s₂·nB)` over `offsetLadder`, coarsest to finest; "The pair is a proper
crossing iff some probe classifies as `inside` **both** A and B" (1658–1672). 5. **Inconclusive probes
propagate** → `inconclusive-crossing` (1673–1677). 6. Early-exit `true`; two independent budgets
(1678–1689).

**Abort protocol** (1691–1695): exceeding either budget sets `aborted` and returns `true` from
`intersectsTriangles` — "`bvhcast` therefore returns `true`, which **must not be read as 'crossing
found'**". Overshoot bounded to one probe's cost (1732–1736).

**Round-21 H-B7 verification — landed (1697–1703).** The third, time-based trigger now reads the shared
accumulator: "accumulated synchronous time since the shared per-call accumulator's last yield — **the same
`performance.now()`-based accumulator every other checkpoint in this call reads** …, **not a private clock
local to this traversal** — exceeding `frameBudgetMs`. Reading a private start time here would let a
traversal beginning just under the shared budget still consume a fresh, full `frameBudgetMs` before
aborting, up to ~2× the per-checkpoint overshoot this design elsewhere holds to one atomic operation's own
cost; reading the shared accumulator closes that gap."

`[SILENT]` — **the fix's own boundary case is unaddressed.** With the shared accumulator, a `bvhcast`
traversal entered when the accumulator already sits just under `frameBudgetMs` (the pair/sub-query
checkpoint at 2585–2588 yields only when the budget is *due*, i.e. exceeded) will trip its time trigger at
or near the first candidate callback, setting `aborted` and producing a `crossing-budget-exhausted`
diagnostic on a pair no geometry problem affects. Nothing in the document states whether that is intended,
whether the pre-traversal checkpoint is expected to yield preemptively, or how the resulting
scheduling-induced diagnostic should be read. The abort's semantics ("the pair is reported as inconclusive
with `crossing-budget-exhausted`", 1693–1695) do not distinguish budget-exhaustion-by-work from
budget-exhaustion-by-arrival-time.

## 3.5 Parity-closure preconditions (1913–1992, 1972–1983)

- "**every operand that parity is evaluated against must be a certified closed manifold.** If one is not,
  each result depending on that parity — positive *and* negative — carries `unverified-parity-operand`
  naming that operand's role." (1974–1976)
- "**Which operands those are depends on the deciding path, not on the mode alone.**" (1977–1981)
- "The check is free: `GeometryConnectivity` already computes manifold classification per geometry and
  caches it alongside the BLAS" (1982–1983).
- Role tables at 3153–3158 (parity) and 3172–3176 (open component).

**The containment guarantee** (1918–1936): conditional. **Round-21 H-Q2 rewrite — landed (1918–1922):**
"`anyComponentInside` only decides the outcome once **no proper crossing exists between source and
target** — established by `ProperCrossingQuery` returning false for `VolumeOverlapQuery`, and by
`ContainmentModeQuery`'s own two-stage negative for `containment`, which has no `ProperCrossingQuery` term
ahead of it (see **Stage ordering is cheapest-first**, under `ContainmentModeQuery` below)." The
precondition is now the logical fact both modes establish, not `VolumeOverlapQuery`'s mechanism named
universally. Then: "closed manifold component → the guarantee holds … non-manifold or open component →
sampling is best-effort, and the component is flagged" (1935–1936). Flagging follows whichever component
decided the outcome, **in either direction** (1938–1958).

## 3.6 Solid model (1424–1470)

- **Target interior = even-odd (parity) over its entire triangle set** (1431–1433). Justification: hollow
  solids / pipe bores (1435–1440). Stated limitation: two genuinely nested independent solids read the
  inner region as cavity (1442–1449).
- **A source geometry contributes as the union of its components** (1451–1455) — "union semantics on the
  source side and even-odd on the target side, and that asymmetry is intentional".
- **"Only closed components can establish positive volume."** An open shell's vertices reading `inside`
  proves **containment**, not **overlap** (1457–1458).
- Vertex welding is a required normalization step, not optional repair (1521–1534); `weldEpsilon =
  1e-4 m / model.getUnitScale()`, falling back to `1e-4` (1552–1554).

## 3.7 `classifyPoint` (1854–1911)

Three-valued `'inside' | 'outside' | 'boundary'` (1857). Two layers deliberately kept distinct so the
guarantee isn't circular (1854–1866): `ProperCrossingQuery` uses only `classifyPoint`;
`anyComponentInside` is used by `VolumeOverlapQuery` "(only *after* `ProperCrossingQuery` has returned
false)" and by `ContainmentModeQuery` directly (1859–1863).

1. **Surface-proximity pre-check** — `closestPointToPoint`; ≤ `surfaceEpsilon` → `boundary` immediately
   (1876–1880).
2. **Parity test** in the target BVH's own local space: `THREE.DoubleSide` explicitly (1882–1883);
   **generic non-axis-aligned local-frame directions**, three of them tried in order (1884–1894); sort
   hits by distance **then** collapse runs closer than `mergeDistance` (1895–1898); barycentric
   edge/vertex graze → retry next direction, all three graze → `boundary` (1899–1906); otherwise odd →
   `inside`, even → `outside` (1907–1911).

## 3.8 `SurfaceCrossingWitness` (2159–2208)

Probes **within the source triangle's own plane** and classifies **against the target only** (2159–2167).
`δ ∈ crossingProbeFractions × dAvail` (`[0.5, 0.1, 0.01]`, per-candidate, recomputed rather than cached)
(2164–2177). If no rung both stays inside the triangle and clears `surfaceEpsilon` → **inconclusive, not a
rejected witness** → `inconclusive-crossing` (2179–2184). "It therefore never parity-tests the source,
which is exactly what lets `containment` accept open sources while `volume-overlap` cannot" (2191–2192).
Scheduling class: **plain JS loop, per-call checkpoints, not a `bvhcast` traversal** (2192–2195) — see
§1.5 site 13.

---

# 4. Synchronous-work / budget model

## 4.1 The two tiers (1742–1748, 1775–1809)

1. **Per-atomic-operation ceiling** — primitives with no internal checkpoint possible. Named members:
   the three `maxSyncTriangleCount` phases (weld, connectivity, BVH) (1780–1788), one non-recursive
   `enumNodeFragments(node, cb, false)` call (1758, 2495–2497), and — **new in Round 21** —
   `releaseEpochScopedState`/`dispose()`'s per-epoch registry sweep (1761). Every other atomic primitive
   (one raycast, one proximity check, one `classifyPoint`, one probe) is "expected to be a small fraction
   of a frame, but that expectation is **reasoned, not measured**" (1788–1793).
2. **Cooperative-composition ceiling** — what `frameBudgetMs` actually bounds (1794–1809).
   `frameBudgetMs = 8` — "half the one-frame target, since a checkpoint can only fire *between*
   primitives, not preempt one" (2220, 2589–2590).

## 4.2 The atomic-operations table (1750–1761) — extracted

| Row | Value | Measured/reasoned | What it bounds |
|---|---|---|---|
| `maxSyncTriangleCount` — compaction + welding phase | `12_000` | **Measured** (R15, weld only): ~16.8ms @ ~19,800 tri; compaction's own cost unmeasured | non-preemptible; against the compacted active-range set only; own checkpoint before it starts (1752) |
| `maxSyncTriangleCount` — connectivity phase | `12_000` | **Measured** (R15): ~6.9ms @ ~19,800 tri | non-preemptible; lazy; runs for `containment` **or** `volume-overlap`; never for `surface-intersection`-only (1753) |
| `maxSyncTriangleCount` — BVH phase | `12_000` | **Measured**: ~16ms @ 18k tri | non-preemptible; the one phase every mode needs (1754) |
| `maxCandidatePairsExamined` | `50_000` | **Measured**: ~0.3µs/pair | raw `bvhcast` candidate rejection, checked at callback entry (1755) |
| one probe / one `classifyPoint` | — | **Reasoned, not yet measured** | checked before every occurrence (1756) |
| `maxFragmentsPerDbId` | `5_000` (provisional) | **Reasoned, not measured** | **cumulative work across the walk only**, via early termination *between* nodes (1757) |
| one `enumNodeFragments(node, cb, false)` call | **— (no ceiling; accepted atomic risk, flagged for re-derivation)** | reasoned; R18 correction: R17's justification factually wrong | non-preemptible; "unbounded **by choice of scope, not by API limitation**"; follow-up required (1758) |
| `maxChildrenPerNode` | `10_000` (provisional) | **Reasoned, deliberately not derived from any existing measurement**; ~0.3µs bvhcast figure explicitly **not** borrowed as a proxy | **enforced by exactly one mechanism** — the in-callback abort; `getChildCount` "removed from this enforcement path entirely — it is never called here, for any node shape"; caps one call at `maxChildrenPerNode + 1` callbacks. "**This spec does not claim `10_000` callbacks fit inside `frameBudgetMs`**" (1759) |
| `maxBroadPhaseInstancePairs` | `1_000_000` (provisional) | **Reasoned, not measured**: one AABB test O(µs) | pre-scan rejection via overflow-safe division; **R18: bounds work not span** (~1,000ms at the ceiling, ~60× the gate's ~16ms); checks `frameBudgetMs` before **each individual instance pair**, yielding and resuming — "cooperatively yieldable"; ceiling retained unlowered, also bounding candidate-list memory (1760) |
| **`releaseEpochScopedState`'s (and `dispose()`'s equivalent) per-epoch registry sweep** — **NEW, Round 21 H-B6** | **— (no ceiling; accepted atomic risk)** | **"Unmeasured, uncategorized in this table until this pass."** Grew from "drop some map entries" (R15) into a per-entry enumerative pass with per-entry cancellation-signal rejection (R18 C3) and an oversized-marking carve-out (R20) | **"Non-preemptible, same category as one `enumNodeFragments` call and the three `maxSyncTriangleCount` phases."** Runs entirely inside the Viewer's uncaught-throw-sensitive `BEFORE_MODEL_UNLOAD_EVENT`/`dispose()` call frames; enumerates every `GeometryRegistry` entry filed under one epoch and settles each `'building'`/`'ready'` entry's signal in the same synchronous step; "cost scales with the number of live entries under that epoch, which nothing in this design ceilings. No checkpoint exists inside it — it is required to be non-throwing …, not preemptible." (1761) |

Other constants not in the table: `maxCrossingPairsExamined = 64` (1680), `maxContainmentSamples = 512`
(2056), `samplesPerComponent = 8` (2004), `maxWitnessTriangles = 8` (2018).

`[AMBIGUOUS]` — **the new sweep row's cost model does not match what the sweep is now specified to
enumerate.** Row 1761 says the sweep enumerates "every `GeometryRegistry` entry filed under one epoch" and
that "cost scales with the number of live entries under that epoch". But `releaseEpochScopedState` at
2733–2735 (as amended by Round 21) also drops "cached `CollisionInstance`s", which live in a **separate
cache keyed `(loadEpoch, fragmentId)`** (1151–1152) — a different keyspace with its own cardinality
(fragments, not unique geometries). Neither the row nor the worst-case-span exclusion (1817–1826) accounts
for it.

## 4.3 Worst-case-span formula (1811–1836)

> "For the cooperative-composition tier, the resulting worst-case single synchronous span is bounded by
> roughly **`max(frameBudgetMs + one small atomic operation's cost, one build-phase's own cost)`**"
> (1811–1812)

**Round-21 H-B6(b) verification — landed (1814–1826).** The honesty guard now excludes **two** rows, not
one: "a `max(…)` is a bound only when every term it ranges over has a ceiling, and the table above
deliberately contains **rows** that have none — one non-recursive `enumNodeFragments(node, cb, false)`
call, **and `releaseEpochScopedState`/`dispose()`'s own per-epoch registry sweep** …, for which **this spec
claims no bound and accepts the cost as a Milestone-1 risk**. **Both rows** … are **explicitly excluded
from the formula above and from any finite worst-case-span guarantee this spec makes.**" The scenario
sentence was extended correspondingly: "A model in which one node directly owns a pathological fragment
count, **or one epoch accumulates a pathological number of live `GeometryRegistry` entries**, can produce a
single synchronous span longer than the formula's value by a margin this spec does not state."

What it *does* bound (1828–1836): the three `maxSyncTriangleCount` phases, the `maxChildrenPerNode`-capped
`enumNodeChildren` call, the now-chunked broad-phase scan, and the per-primitive checkpoints — "only as
good as the table's unmeasured rows."

## 4.4 The performance gate (3962–4062)

One `volume-overlap` query against an MEP-scale model, run **twice** (cold, then cache-warm) (3962–3967).
Pass criteria (3977–4053):
1. **Round-21 H-B8 rewrite — landed:** "no single synchronous task exceeds `frameBudgetMs`'s tolerance band
   around ~16ms, measured on **both** runs, **except the two synchronous spans this spec explicitly
   excludes from any worst-case-span guarantee** — one `enumNodeFragments(node, cb, false)` call and
   `releaseEpochScopedState`/`dispose()`'s own per-epoch registry sweep … — for which a measurement above
   the band is **a required recorded finding, not a gate failure**; a measurement above the band on any
   other synchronous task **is** a gate failure" (3979–3987). The two exceptions match exactly the two rows
   §4.3 excludes — no new exception is invented.
2. any budget that trips does so with the correct diagnostic (3988–3989);
3. measured per-candidate and per-build costs recorded next to `measure.mjs`'s synthetic figures
   (3990–3991);
4. **one `classifyPoint` call and one crossing probe measured directly** (3992–3999);
5. **each of the three build phases measured individually at `maxSyncTriangleCount`** — and a
   connectivity-measuring cold run must be distinguished from a `surface-intersection`-only run
   (4000–4009);
6. extraction cost for the largest single dbId, **and** the broad-phase scan's **longest uninterrupted
   span** between yields (not just total), plus the cost of one `performance.now()` read relative to one
   AABB test, plus the candidate-list size at the ceiling (4010–4023);
7. **one `enumNodeChildren` call at the fanout ceiling** — `maxChildrenPerNode + 1` invocations on the
   widest node, **and an assertion that the abort actually fires** (4024–4036);
8. **one `enumNodeFragments(node, cb, false)` call** on the node owning the most fragments (4037–4044);
9. **NEW (Round 21 H-B6(c)): the per-epoch registry sweep is measured** "at a `GeometryRegistry` populated
   with as many live entries under one epoch as the model actually produces … Measure the sweep triggered
   from **both** `world.evictModel` (mid-session eviction) **and** `world.dispose()` (whole-world
   teardown), since both run this operation over a potentially different entry count" (4045–4053).

For (7), (8) and (9) alike: a model that cannot exercise the case "cannot exercise this at all — recording
that limitation is itself a gate finding, not a pass" (4034–4036, 4042–4044, 4051–4053).

`maxSyncTriangleCount`'s `12_000` "specifically remains provisional until it has [run]" (4058).

`[SILENT]` — the gate still does **not** list measuring the extraction walk's per-sibling-node
`frameBudgetMs` checkpoint (site 3 in §1.5). (The release-path half of v4's equivalent SILENT is now
closed by criterion 9.)

---

# 5. Cache ownership / cleanup

## 5.1 Inventory

| Cache | Key | Owner | Cited |
|---|---|---|---|
| `GeometryRegistry` | `(loadEpoch, geometryIndex)` | `CollisionWorld` | 1130–1133, 2750–2752, 2956–2960 |
| `BlasCache` | behind the registry entry's `accelerationPromise` slot | `CollisionWorld`; **"owns no dedup mechanism of its own"** | 1222–1225, 1334–1343 |
| `GeometryConnectivity` decomposition | per unique `GeometryRecord`, cached alongside the BLAS | `CollisionWorld` | 1562–1566, 1982–1983 |
| `L_X` tolerance scale | per `GeometryRecord`, "cached with the BLAS" | `CollisionWorld` | 1384–1386 |
| **`CollisionInstance` cache** — **NEW, Round 21 H-2/H-3** | **`(loadEpoch, fragmentId)`** — "mirroring `GeometryRegistry`'s epoch-based keying for the same race-safety reason" | `CollisionWorld` | 1151–1162 |
| `modelLifecycle` | `Model` object identity (`WeakMap`) | `CollisionWorld` | 2879–2894 |
| `liveModelByModelId` | `modelId` | `CollisionWorld`; diagnostic only | 2895–2906 |
| room-dbId cache | `Map<Model, Promise<number[]>>`, **keyed by the exact `Model` object, not `model.id`** | **the extension**, not the world | 2264–2268, 2804–2806 |
| `geometry-too-large-for-sync-build` dedup store | unnamed | unnamed | 2564–2566 (`[SILENT]`) |

**The `CollisionInstance` cache, verbatim (1151–1162):** "`CollisionInstance`s are cached per
`(loadEpoch, fragmentId)` — mirroring `GeometryRegistry`'s epoch-based keying for the same race-safety
reason … — **not rebuilt on every `findClashes` call**; the fragment-id dedup already stated under
`ViewerModelAdapter` and Data Flow step 3 governs identity **within** a build, this governs identity
**across calls**. Ownership and release follow `GeometryRegistry`'s epoch-scoped lifetime exactly: an entry
lives as long as its `(loadEpoch, …)` namespace does and is dropped in the same sweep — see
`world.evictModel`'s `releaseEpochScopedState` and `world.dispose`'s wholesale clear, both of which
enumerate this cache alongside `GeometryRegistry`/`BlasCache`/`GeometryConnectivity`. This does not change
the per-call world-matrix/world-bounds snapshot guarantee under **Broad phase**: **a cache hit still
re-captures the current `fragList.getWorldMatrix`/`getWorldBounds` values into the shared instance at the
start of the call reusing it**, so a scan resuming after a yield still never observes mixed pre-yield and
post-yield transform state."

## 5.2 What each release path does

| Path | Registry | BLAS | Connectivity | `CollisionInstance` | `liveModelByModelId` | `modelLifecycle` | room cache |
|---|---|---|---|---|---|---|---|
| `evictModel` (live object, not disposed) | sweeps + deletes every entry under that epoch, identity-guarded, incl. oversized markings (2733–2746) | dropped with each entry (2734–2736) | dropped with each entry (2734–2736) | **dropped in the same sweep (2735–2736)** | deletes only if this object is still the occupant (2763–2766) | writes `{state:'evicted'}` unconditionally, **before** the release (2727–2729) | **untouched** — the handler drops it separately (2804–2806, 3088–3092) |
| `evictModel` (disposed world) | no-op | no-op | no-op | no-op | no-op | **no tombstone written** (2724) | still dropped by the handler unconditionally (2804–2806) |
| `evictModel` (already `'evicted'`) | no-op | no-op | no-op | no-op | no-op | no-op (2726) | — |
| `evictModel` (never admitted) | nothing to release (2729, 3878–3887) | — | — | — | — | writes `{state:'evicted'}` (2727–2728) | — |
| `dispose()` | wholesale clear, one operation (2836–2838) | wholesale clear | wholesale clear | **wholesale clear (2836–2837)** | best-effort tombstone only (2848–2853) | best-effort, **not load-bearing** (2850–2853) | **never touched** (2804–2805, 3090–3092) |
| build-phase rejection | this entry only, synchronously, identity-guarded (1247–1255) | intermediate buffers discarded | — | — | — | — | — |
| room-search rejection | — | — | — | — | — | — | identity-guarded delete (2296–2300) |

## 5.3 Room-cache rejection semantics

**One rule, no exception** (2296–2300): "On rejection, the handler deletes that model object's cache
entry — guarded by identity, `if (roomCache.get(model) === thisPromise) roomCache.delete(model)` … **This
identity-guarded delete is unconditional: every rejection path in this mechanism uses it, with no
special-cased exception (see the invalid-lease branches below).**"

Invalid-lease branch of the **success** callback (2324–2352): reject **and** "apply the same
identity-guarded delete every rejection path in this mechanism uses … **no special-cased 'leave the cache
untouched' exception for this branch**" (2326–2328). Cause derivation: `isLeaseValid(lease)` first; on
`false`, call `world.isModelLive(model)` inside `try`/`catch` — a caught `WorldDisposedError` **is** the
rejection reason; otherwise `new ModelEvictedError(model.id)` (2333–2338). "Nothing can interleave between
the two calls — both are synchronous and there is no `await` between them" (2338–2339).

**Error** callback (2357–2365): "follows the same shape … Both callbacks use one mapping, and both apply
the identical identity-guarded delete-on-rejection rule … **there is no 'leave the cache untouched'
exception for either callback's invalid-lease branch. A design in which the two callbacks classify the
same invalid lease differently, or delete the cache entry in one but not the other, is a bug.**"

Valid branch: also checks `roomCache.get(model) === thisCall's own promise` before writing (2353–2356).

Admission-before-search: `const lease = world.admitModel(model)` is called synchronously on the
cache-miss path **before** `model.search`, and throws (never starting the search) if already tombstoned or
if the world is disposed (2318–2323).

Fixture pins deletion, not "untouched", for **both** callbacks (3902–3912). No grep hit for "leave the
cache untouched" as a live rule; the phrase survives only inside the two explicit disclaimers at 2327 and
2363.

`[SILENT]` — **no release path names the room cache.** `world.dispose()` "never touches it" (2804–2805,
3091–3092); `evictModel` does not touch it; the *handler* drops one object's entry. Nothing states what
happens to the room cache for models other than the one being unloaded when the extension is torn down
along a path where `unload()` step 3 does not run (see §1.8, hazard 2).

## 5.4 Consistency between release paths

`dispose()`'s clear is described **three** times. The three descriptions are not identical:

| # | Location | Signal-rejection wording | Oversized carve-out? | Names `CollisionInstance` cache? |
|---|---|---|---|---|
| A | `ThreeMeshBvhBackend`/`BlasCache` bullet, 1262–1265 | "reject that signal exactly once and drop the entry in the same step … unconditionally, for every entry they remove regardless of whether its `buildState` is `'building'` or `'ready'`" | **Yes** — appended at 1273–1275 and 1282–1284 | n/a (registry-scoped statement) |
| B | `world.dispose()` TS comment, 2836–2848 | "**For every `'building'` or `'ready'` entry it removes**, the clear rejects that entry's cancellation signal … exactly once, in the same pass that drops the entry, identity-guarded" | **Yes** — 2846–2848 | **Yes** — 2836–2837 |
| C | **"`world.dispose()` is terminal" prose, 3032–3041** | "…and **rejects every in-flight build promise, exactly once**, on the same disposal call. … **and the clear rejects each entry's cancellation signal as it drops the entry.**" | **No** | **No** — lists only `GeometryRegistry`, `BlasCache`, "every cached `GeometryConnectivity`" (3032–3034) |

`[CONTRADICTION]` — **site C (line 3041) is the residual C-5 instance, unchanged.** "the clear **rejects
each entry's cancellation signal** as it drops the entry" is universally quantified over entries dropped,
and the wholesale clear drops oversized markings too (per 1282–1284 and 2846–2848). Note that the
*preceding* clause at 3034 ("rejects every in-flight build promise") is arguably narrower and satisfiable,
since an oversized marking has no in-flight build — the problem is specifically the final clause at 3041,
which shifts the quantifier from *promises* to *entries*. Round 21 confirmed this untouched by design (its
disposition doc's "byte-identical" note; the Round 21 changelog entry at 706 lists "the two Round-20
wording Mediums" as deliberately skipped).

`[CONTRADICTION]` (**new — introduced by Round 21's own H-2/H-3 fix**) — **site C omits the
`CollisionInstance` cache.** Round 21 threaded the new cache into sites B (2836–2837) and into
`releaseEpochScopedState` (2735–2736), but line 3032–3034 still enumerates the wholesale clear's targets as
"`GeometryRegistry`, `BlasCache`, and every cached `GeometryConnectivity` — the entire cache, not a
per-model sweep over `liveModelByModelId`". The new cache's own declaration at 1155–1158 asserts that
**both** sweeps "enumerate this cache alongside `GeometryRegistry`/`BlasCache`/`GeometryConnectivity`",
which site C contradicts by omission. This is the same three-sites-one-missed shape as the C-5 residual,
one paragraph away from it.

Corresponding check on `evictModel`: `releaseEpochScopedState` is defined at 2733–2746 (both carve-out and
`CollisionInstance` present) and named at exactly five other lines — 1157, 1263, 1282, 2729 (the
pseudocode call site), 1761 (the atomic-ops row), 1818 (the span-formula exclusion), 3664 (a fixture
description), 3982 and 4045 (gate criteria). Of those, only 1761 restates what the sweep enumerates, and it
names only `GeometryRegistry` (see §4.2's `[AMBIGUOUS]`). None reproduces the signal defect.

`[SILENT]` — no site states what `releaseEpochScopedState` or `dispose()` does about an oversized
marking's **`geometry-too-large-for-sync-build` diagnostic dedup record** (2564–2566), or whether removing
the marking mid-call could cause the same fragment to be re-diagnosed. The dedup mechanism's storage is
never named.

`[AMBIGUOUS]` — `releaseEpochScopedState` "drops each one together with its **cached BLAS, cached
connectivity, and cached `CollisionInstance`s**" (2734–2736). For an oversized marking neither the BLAS nor
the connectivity exists (no phase ever started, 1279–1281), so those two clauses are vacuous for that entry
kind and the text does not say so — unlike the signal, which now *is* explicitly carved out. The
`CollisionInstance` clause is a third case: instances are keyed by `fragmentId`, not `geometryIndex`, so
whether they are dropped "together with" a *geometry* entry, or swept independently per epoch, is not
stated.

`[AMBIGUOUS]` — the C-5 fixtures at 3673–3685 assert "**zero** calls attributable to the oversized
marking's entry" on "whatever mechanism rejects a cancellation signal". Since the design says the signal is
never *created* for such an entry (1279–1281), there is no object to attribute a call to; the fixture is
phrased against an implementation that might create one. Nothing in the normative text forbids an
implementation from creating an inert signal it never rejects.

## 5.5 Other cross-path consistency statements

- `GeometryRegistry` keys by `(loadEpoch, geometryIndex)` "**specifically so this step can never touch
  another object's state**" — which is why the epoch-scoped release "needs no occupancy check against
  `liveModelByModelId` the way round 13's interim fix did" (2750–2756, 2965–2970).
- `dispose()`'s wholesale clear "cannot suffer the same enumeration gap a per-model sweep can, because it
  never needs to identify *which* models were live in the first place" (3041–3043).
- The sweep can reach in-flight builds "at all only because a record is published to the registry when its
  build STARTS rather than when it completes" (2747–2749, 3035–3037).

## 5.6 The per-call snapshot guarantee vs. the cross-call `CollisionInstance` cache

Two statements now sit in tension across the Round-21 boundary:

- **Broad phase (2553–2558):** "the mid-scan suspension is safe only because **each `CollisionInstance`'s
  world matrix and world bounds are per-call snapshots**, copied out of
  `fragList.getWorldMatrix`/`getWorldBounds` **during extraction** …, and the candidate list is call-local
  — so a scan resuming after a yield cannot mix pre-yield and post-yield scene state."
- **`CollisionInstance` cache (1158–1162):** instances are "**not rebuilt on every `findClashes` call**";
  the snapshot guarantee is preserved because "a cache hit still re-captures the current
  `fragList.getWorldMatrix`/`getWorldBounds` values **into the shared instance** at the start of the call
  reusing it".

`[AMBIGUOUS]` — three unreconciled points. (a) *When*: 2554 says the copy happens "during extraction"; a
cache hit is precisely the case where extraction is skipped, and 1160–1161 relocates the copy to "the start
of the call reusing it" without amending 2554. (b) *Where*: 1160 says the values are re-captured "**into
the shared instance**" — a mutation of cross-call state, while 2556 says "the candidate list is call-local".
The candidate list may be call-local while the instances it points at are not. (c) *Concurrency*: two
concurrent `findClashes` calls are an explicitly supported and fixture-pinned state (3645–3651, 3652–3657);
if call B re-captures transforms into an instance call A is mid-scan over, A's per-yield snapshot invariant
is broken by a write A never made. Nothing in the document addresses whether the re-capture is per-call
private, copy-on-read, or guarded.

---

# 6. Cross-cutting observations from this extraction pass

1. **Round 21's High-only pass landed at every site it claimed.** Verified in the current text:
   H-L1/H-L2 (2235–2262 + 4209–4212), H-L4 (3053–3061), H-L7 (324–326, 389–391), H-L8 (3072–3084),
   H-Q1 (1182–1189 + 1859–1863 + 2210–2212), H-Q2 (1918–1922), H-Q4 (1190–1195), H-B4 (2192–2195),
   Public-API closure wording (2628–2643), `getChildCount` changelog residue (466–470, 507–512),
   H-B5 (2584–2588), H-B6 (1761 + 1817–1826 + 4045–4053), H-B7 (1697–1703), H-B8 (3979–3987),
   H-B9 (4086–4094), H-2/H-3 (1151–1162 + 2735–2736 + 2836–2837). A Round-21 changelog entry exists
   (651–708).
2. **All six protected Critical invariants are intact.** No Round-21 edit narrowed, widened, or
   re-attributed any of them; the edits are caller-list corrections, scheduling-class corrections,
   changelog annotations, overclaim narrowings, and one previously-undeclared-state declaration.
3. **One new inconsistency appears traceable to Round 21's own H-2/H-3 fix** (§5.4): the third of
   `dispose()`'s three clear-descriptions (3032–3034) was not updated to name the `CollisionInstance`
   cache, and the new cache's own declaration (1155–1158) asserts that it was. Structurally identical to
   the residual C-5 defect one paragraph below it.
4. **Two Round-21 fixes surfaced follow-on questions the pass did not answer** — H-B7's shared-accumulator
   abort has an unaddressed arrival-time boundary case (§3.4), and H-2/H-3's cache creates a
   per-call-snapshot / cross-call-sharing tension under concurrency (§5.6). Both are flagged
   **ADJUDICATION** below rather than resolved here.
5. **The residual C-5 site (3041) and the intra-bullet signal tension (1256 vs. 1273) are both present and
   byte-identical**, as Round 21 declared. So are every other deliberately-untouched Medium/Low: the
   compaction/gate ordering transposition (§2.4), the `>=`/`>` boundary (§2.4), the oversized-marking
   single-flight gap (§2.5), the connectivity trigger-point three-way ambiguity (§2.5), `referenceCount`
   (§2.1), the intra-loop clock-basis ambiguity (§1.5), the room-cache release-path gap (§5.3), and the
   Status-header staleness (Reading note).
6. **One `getChildCount` residue is still unannotated** (§2.7): the Round-17 entry's preamble at 496–498,
   as distinct from its bullet at 505–512, which Round 21 did annotate.
7. **The changelog's own numbering is now four namespaces deep** (v1 "C4/C5", v2 "C-1…C-4", v3 "C-5",
   v4 "H-*") with no stated convention (Reading note).

---

# Appendix: candidate items for the audit pass

Every `[SILENT]` / `[AMBIGUOUS]` / `[CONTRADICTION]` marker placed above, plus the three **ADJUDICATION**
items the model build itself surfaced. No severity is assigned here.

**Adjudication items (surfaced by this model build — flagged, not decided)**

A1. **ADJUDICATION** — **`bvhcast`'s shared-accumulator abort has an unaddressed arrival-time boundary.**
    Round 21's H-B7 fix (1697–1703) makes the traversal's time trigger read the shared per-call
    accumulator. The pair/sub-query checkpoint ahead of it (2585–2588) yields only when the budget is
    *due*. So a traversal entered at, say, 7.9ms of an 8ms budget aborts almost immediately and emits
    `crossing-budget-exhausted` — a diagnosed-inconclusive pair caused purely by scheduling, not by
    geometry or by work done. The spec neither sanctions nor forbids this, and the diagnostic's stated
    meaning (1693–1695, 3295–3297, 3122) does not distinguish the two causes. Needs adjudication:
    intended-and-should-be-stated, or a real behavioral regression from the fix. (§3.4)

A2. **ADJUDICATION** — **the `CollisionInstance` cache's cross-call sharing versus the per-call
    world-matrix/world-bounds snapshot guarantee.** 1158–1162 asserts the guarantee is preserved because a
    cache hit "re-captures the current … values **into the shared instance** at the start of the call
    reusing it"; 2553–2558 states the guarantee as "per-call snapshots, copied … **during extraction** …
    and the candidate list is call-local". Under two concurrent `findClashes` calls — an explicitly
    fixture-pinned state (3645–3657) — call B's re-capture mutates an instance call A is mid-scan over.
    Needs adjudication: is the re-capture per-call private, is the shared instance immutable after first
    build, or is the mid-scan snapshot guarantee actually weakened? (§5.6)

A3. **ADJUDICATION** — **the `tearDown()`-path claim that the listener is already deregistered
    (2255–2258) versus `unload()`'s own two documented throw hazards (3066–3069, 3072–3083).** Both
    hazards leave step 2 (listener removal) unrun, in which case `BEFORE_MODEL_UNLOAD_EVENT` *does* reach
    the handler and `world.evictModel` *is* invoked (as a no-op). As punctuated, 2255–2258's "provided
    `unload()` itself completes all three of its steps" governs only the release claim, not the listener
    claim. Needs adjudication: re-punctuate/condition the listener claim, or state that the hazard branch
    is out of scope. (§1.8)

**Extraction markers**

1. `[SILENT]` — **Status header stale by four passes** (3–19): says "seventeen rounds", calls Round 18 the
   current pass, names only `invariant-audit-v1`/`v2`. (Reading note)
2. `[SILENT]` — **No `### Round 20` Revision Notes entry.** Round 21's entry (654) now acknowledges the
   pass and points at its disposition doc, but the changelog carries none of its content. Rounds 7 and 8
   likewise have no entries. (Reading note)
3. `[AMBIGUOUS]` — **Four finding-label namespaces in play** (v1 "C4/C5" at 567; v2 "C-1…C-4" at 1757,
   1759, 2410, 2469, 2502, 3250, 3663, 3737; v3 "C-5" at 3678, 3685; v4 "H-*" throughout 651–708) with no
   disambiguating convention stated. (Reading note)
4. `[AMBIGUOUS]` — **Intra-loop clock basis stated three ways**: shared accumulator since last yield
   (1697–1700), bare "`performance.now()` is read before each individual probe" (1719–1720), bare "elapsed
   time" (2068–2069); "the same clock" at 1848 does not disambiguate. (§1.5)
5. `[SILENT]` — **No error class is named** for the `maxFragmentsPerDbId` / `maxChildrenPerNode` /
   `maxBroadPhaseInstancePairs` call-level rejections (2432–2433, 1759, 3253–3255), for a cross-model
   query (2389–2390, 3306–3308), or for "Invalid dbId" (3312). (§1.6)
6. `[CONTRADICTION]` — **`tearDown()`-path listener claim vs. `unload()`'s throw hazards** (2255–2258 vs.
   3066–3069 / 3072–3083). Also **A3**. (§1.8)
7. `[SILENT]` — **`locateElementByRoom`'s model resolution** explicitly deferred to
   `review-comments-v12.md` (2269–2272). (§1.8)
8. `[SILENT]` — **`referenceCount` is named once** (1133) in normative text and never again; no
   increment/decrement/zero semantics. (§2.1)
9. `[CONTRADICTION]` — **Intra-bullet signal-universality tension** (byte-identical since Round 20):
   1256–1257 "**Every registry entry** carries one entry-scoped cancellation signal" vs. 1273–1275
   "defined **only for** `'building'`/`'ready'` entries — an oversized marking … never has one", with
   1262–1265's mixed-quantifier clause between them. (§2.3)
10. `[CONTRADICTION]` — **Compaction/gate ordering transposition** (deliberately untouched): 1293–1294
    "Before welding, **before the ceiling check**" vs. 1307–1310 "checked … **before any copying happens**
    … Only once that check passes does compaction actually copy". Fixture 3700–3704 pins the 1307
    ordering. (§2.4)
11. `[CONTRADICTION]` — **`>=` vs `>` boundary** (deliberately untouched): 1348 "**at or above** that
    triangle count is not built" vs. 2562 / 3232 / 1308 "**exceeds**". Fixture 3705–3710 (13,000 / 11,000)
    does not discriminate `12_000`. (§2.4)
12. `[AMBIGUOUS]` — **Connectivity trigger point**, three unreconciled timings: the state model explicitly
    declines to decide (1233–1236); Data Flow step 3 places it inline in the build sequence (2566–2569);
    fixture 3652–3657 has a caller driving it against an already-`'ready'` entry. (§2.5)
13. `[SILENT]` — **Whether an oversized marking participates in the "caller that finds an existing entry"
    lookup rule** (1222–1225) is unstated; 1277 implies the marking is consulted, 2559–2566 implies the
    ceiling check is re-run per pair. The `geometry-too-large-for-sync-build` dedup store (2564–2566) is
    never named. (§2.5)
14. `[SILENT]` — **Nothing states which code path creates the oversized marking, or when** (1308,
    1348–1351, 2562–2564 each describe a different actor/site without one being normative). (§2.5)
15. `[AMBIGUOUS]` — **One unannotated `getChildCount` present-tense residue survives**: Round 17's entry
    preamble at 496–498 ("returned without enumerating those children"), the exact claim C-1 refuted for a
    mixed node. Round 21 annotated the bullet at 505–512 but not this sentence. (§2.7)
16. `[SILENT]` — **The performance gate does not require measuring** the extraction walk's
    per-sibling-node `frameBudgetMs` checkpoint (site 3 in §1.5). (§4.4)
17. `[AMBIGUOUS]` — **"Stage" names two nesting levels**: `anyComponentInside`'s stages 1/2/3
    (2003–2018) vs. `ContainmentModeQuery`'s "both stages" / "stage 2" meaning its two composition terms
    (2197–2201), plus "own two-stage negative" at 1920–1921. (§3.3)
18. `[SILENT]` — **`bvhcast`'s shared-accumulator abort boundary case** (1697–1703 vs. 2585–2588); see
    **A1**. (§3.4)
19. `[AMBIGUOUS]` — **The new sweep row's cost model** (1761) says the sweep enumerates "every
    `GeometryRegistry` entry filed under one epoch", but `releaseEpochScopedState` (2735–2736) also drops
    the `CollisionInstance` cache, a separate `(loadEpoch, fragmentId)` keyspace with different
    cardinality. The worst-case-span exclusion (1817–1826) inherits the same omission. (§4.2)
20. `[CONTRADICTION]` — **Residual C-5 site at line 3041**, in the "`world.dispose()` is terminal" prose
    (3032–3041): "**the clear rejects each entry's cancellation signal as it drops the entry**" —
    universal over entries dropped, no oversized carve-out, in a clear that per 1282–1284 and 2846–2848
    also drops oversized markings. Byte-identical since Round 20, deliberately untouched. (§5.4)
21. `[CONTRADICTION]` (**new, from Round 21's own H-2/H-3 fix**) — **site C (3032–3034) omits the
    `CollisionInstance` cache** from `dispose()`'s wholesale-clear enumeration, while sites A/B and the
    cache's own declaration (1155–1158) assert both sweeps enumerate it. (§5.4)
22. `[SILENT]` — **Nothing states what the release paths do about the `geometry-too-large-for-sync-build`
    dedup record** when an oversized marking is swept, or whether a fragment could be re-diagnosed.
    (§5.4)
23. `[AMBIGUOUS]` — **`releaseEpochScopedState`'s "drops each one together with its cached BLAS, cached
    connectivity, and cached `CollisionInstance`s"** (2734–2736) is vacuous in its first two clauses for an
    oversized marking (1279–1281), and its third clause spans a different keyspace (`fragmentId`, not
    `geometryIndex`) whose sweep relationship to a geometry entry is unstated. (§5.4)
24. `[AMBIGUOUS]` — **The C-5 fixtures (3673–3685) assert "zero calls attributable to the oversized
    marking's entry"** on the signal-rejection mechanism, but the design says no signal is ever *created*
    for such an entry (1279–1281). Nothing normative forbids an implementation from creating an inert
    signal it never rejects; the fixture would pass either way. (§5.4)
25. `[SILENT]` — **No release path owns the room cache** beyond the per-model handler drop: `dispose()`
    "never touches it" (2804–2805, 3091–3092), and nothing states what happens to entries for other models
    when `unload()`'s step 3 does not run (see A3 / §1.8 hazard 2). (§5.3)
26. `[AMBIGUOUS]` — **Per-call snapshot vs. cross-call `CollisionInstance` cache** (1158–1162 vs.
    2553–2558), three unreconciled points (when / where / under concurrency); see **A2**. (§5.6)
