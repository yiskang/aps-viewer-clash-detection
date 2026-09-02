# Consolidated Invariant Model — Collision Library Milestone 1 (post-Round-22)

**Built fresh** from `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` as it exists
at **4429 lines**, after the Round-22 single-finding re-derivation pass (which closes
`invariant-audit-v5.md`'s deferred High, H2). No content was carried forward from
`invariant-audit-v1.md` … `invariant-audit-v5-model.md`; every `line N` citation below was read directly
from the current file during this pass, over a complete sequential read of all 4429 lines.
`invariant-audit-v5-model.md` was consulted **only** for section-structure convention, and
`round-22-h2-derivation-pass-disposition.md` / `round-21-high-only-fix-pass-disposition.md` only to know
where to look hardest — none was trusted for any claim about what the text now says. This matters more
than usual at v6: the current text differs from v5's model in **two** places, not one — Round 22's own
edits, **and** the five self-corrections Round 21 applied to its own first draft after the v5 audit
(`bvhcast`'s clock basis reverted to a private clock, `SurfaceCrossingWitness` reclassified as a
`bvhcast`-native traversal, and the `CollisionInstance` cache redesigned as a frozen transform-free
identity object with an independent epoch sweep and a new `maxCollisionInstancesPerEpoch` ceiling). Several
v5-model claims are therefore **no longer true of the current text**; they are not repeated here.

**Scope discipline.** This is pure extraction. Where the spec says two things, both are recorded, marked
`[CONTRADICTION]`. Where it is under-determined, `[AMBIGUOUS]`. Where it says nothing, `[SILENT]`. Nothing
here is adjudicated, severity-rated, or repaired — that is the next step's job. Every marker is repeated in
the Appendix for triage.

**The six protected Critical invariants were re-verified, not assumed.** All six still hold in the current
text — see §1.1/§1.7 (Model-object identity / `loadEpoch`), §1.5 (disposed-first checkpoint semantics),
§2.3 (`GeometryRecord` cancellation ownership), §2.4 (active-range gating / compaction / weld /
connectivity / BVH ownership), §2.7 (extraction's atomic-risk boundaries), §3.2 (the mode dependency
matrix). None was reopened by Round 22, which touched no mechanism at all — its own entry says "No
behavior, fixture, query/lifecycle/cache/extraction mechanism, or other finding touched" (750–751).

---

## Reading note — the document's own structure at this revision

| Lines | Section |
|---|---|
| 1–21 | Title / Status header |
| 23–751 | **Revision Notes (post-review)** — Rounds 1–22. Sub-entries at 25 (R1), 38 (R2), 66 (R3), 95 (R4), 130 (R5), 162 (R6), 191 (R9), 223 (R10), 260 (R11), 294 (R12), 332 (R13), 362 (R14), 396 (R15), 439 (R16), 484 (R17), 532 (R18), 593 (R19), 651 (R21), **732 (R22 — new)**. **There is still no Round 7, Round 8, or Round 20 entry**; Round 21's entry names Round 20 only by pointing at its disposition doc (654). |
| 753–825 | Spike Findings (executable, `spike/`) |
| 827–852 | Purpose |
| 854–873 | Background |
| 875–906 | Milestone Scope |
| 908–1021 | Architecture (runtime split, repo layout, dependency pins, vendor plan) |
| 1023–1454 | **Components** — `ViewerModelAdapter` 1025–1090; `ViewerGeometryAdapter` 1092–1171; `GeometryRegistry`/`GeometryIdentity` 1173–1192; **`CollisionInstance` identity cache 1194–1239 (rewritten by Round 21's self-correction)**; `ThreeMeshBvhBackend`/`BlasCache` 1241–1454 |
| 1456–1508 | Tolerances (table at 1482–1491) |
| 1510–1555 | Solid model |
| 1557–2382 | **Query modes and their preconditions** — mode table 1559–1563; welding 1607–1646; `GeometryConnectivity` 1648–1671; `SurfaceIntersectionQuery` 1673–1697; `ProperCrossingQuery` 1699–1999 (atomic-ops table 1845–1857; **Round 22's rewritten composition analysis 1871–1999**); `ContainmentQuery` 2001–2237; `VolumeOverlapQuery` 2239–2275; `ContainmentModeQuery` 2277–2373; `CollisionWorld` 2375–2382 |
| 2384–2785 | Data Flow — Room Locate Query (step 1: 2386–2543; step 2: 2544–2554; step 3: 2555–2783; step 4: 2784–2785) |
| 2787–3399 | **Public API** — TS block 2789–3037; "Race safety" prose 3039–3227; `RoomLocatorExtension` sketch 3229–3279; diagnostics 3281–3399 |
| 3401–3553 | Error Handling & Edge Cases |
| 3555–4275 | Testing & Verification (unit 3557–4147; integration 4149–4160; **performance gate 4162–4275**) |
| 4277–4367 | Risks |
| 4369–4429 | Open Questions Deferred to Future Milestones |

**Structural observation about the changelog itself.** The Status header (3–19) still reads "revised after
**seventeen** rounds of codex review", describes Round 18 as the most recent fix pass ("**This is 'Round 18'
below**", line 7), and names only `invariant-audit-v1.md` / `invariant-audit-v2.md`. It is now **five** fix
passes stale (18, 19, 20, 21, 22) — one worse than at v5. Round 22's own entry (732–751) forward-references
`invariant-audit-v6.md` (751). `[SILENT]` — no `### Round 20` entry exists.

**Naming collision, carried forward unchanged.** Round 18's entry uses "C4, C5" (567) for
`invariant-audit-v1.md` findings. Round 19's entry uses "C-1 … C-4" for `invariant-audit-v2.md` findings,
and the normative text refers to those as "finding C-1" (1852, 1854, 2577, 2636, 2669, 3431, 3918) and
"C-2" (3844). Round 20's C-5 is an `invariant-audit-v3.md` label, referenced at 3859 and 3866. Round 21's
entry (651–730) uses `invariant-audit-v4.md`'s H-* labels. **Round 22's entry (732–751) adds a fifth
namespace**, `invariant-audit-v5.md`'s "H2" — which also appears *inside the normative text* at 1929
("closing `invariant-audit-v5.md`'s H2"), the first time an audit label from this lineage has been written
into the design prose rather than only into the changelog. `[AMBIGUOUS]` — five label namespaces are now in
play with no disambiguating convention stated anywhere.

---

# 1. Model / world lifecycle

## 1.1 The two axes

**World axis:** `constructed → disposed`. `disposed: boolean` is a world-level terminal flag (3087–3089,
3000–3001). `dispose()` sets it **first, synchronously, before anything else** (3001, 3188–3189,
3516–3517). It is "the system's single authoritative liveness signal rather than one input among several"
(3087–3089) and "this single write is now sufficient correctness-wise, on its own, for every check anywhere
in the system" (3189–3191).

**Model axis:** `(no entry) → live → evicted`, keyed by the exact `Model` **object**, never by `modelId`
(3056, 3059–3074).

```
modelLifecycle: WeakMap<Model, { state: 'live'; epoch: number } | { state: 'evicted' }>   (3059–3060)
```

- No entry at all = "has simply never been admitted *or* evicted — a legitimate first use, the only case
  `findClashes` treats as 'admit fresh'" (3067–3069).
- `'live'` carries `epoch: number`. `'evicted'` **carries no epoch at all** (2896–2899, 3060–3063) —
  "because nothing ever needs to compare one: every liveness/lease check short-circuits on
  `state !== 'live'` before it would ever read `.epoch`" (2898–2899).
- Transition is one-way and permanent: "it never deletes this entry" (3066); "permanently dead in this
  world: nothing re-admits it, ever, because nothing ever clears or overwrites it back to `'live'`"
  (3069–3070).
- `WeakMap` is chosen so "permanent" is free rather than a leak (3070–3074) — **and this is exactly why
  nothing may depend on enumerating `modelLifecycle`** (3073–3074).

**No `'disposed'` state exists on the model axis.** Disposal is world-level only.

**Scoping statement (2395–2429).** Data Flow step 1 explicitly bounds the apparatus: "The
`modelLifecycle`/`loadEpoch` tombstone-and-epoch scheme below … is the load-bearing correctness mechanism
**for as long as one `RoomLocatorExtension` instance and its `CollisionWorld` stay alive** — including
multiple admitted models, explicit eviction, delayed eviction, and in-flight work racing an eviction. It
does not, by itself, make the *instance* survive a model switch" (2396–2400). See §1.8.

## 1.2 World-owned lifecycle state (inventory)

| Name | Type / shape | Cited | Role |
|---|---|---|---|
| `modelLifecycle` | `WeakMap<Model, {state:'live';epoch:number} \| {state:'evicted'}>` | 3059–3074 | authoritative per-object liveness; non-enumerable by design |
| `liveModelByModelId` | `Map<modelId, Model>` | 3075–3086 | **diagnostic/bookkeeping only**; "load-bearing for nothing" (416), "no correctness property … depends on this map's completeness anymore" (3081–3083) |
| `disposed` | `boolean` | 3087–3089 | world terminal flag; checked first everywhere |
| `nextLoadEpoch` | number counter, global to the `CollisionWorld` instance, only ever increments, never reset or scoped per `modelId` | 3090–3095 | `epoch = nextLoadEpoch++` on first admission (3091–3092); guarantees a reused `modelId` still gets a strictly greater epoch (3092–3094) |

## 1.3 `ModelLease`

`{ model, epoch }` (2832–2833) — "an opaque capture of this exact object's current lifecycle state, valid
until the object is evicted or the world is disposed" (2833–2834).

## 1.4 Public method contracts

### `world.admitModel(model): ModelLease` (2832–2850)

Synchronous, idempotent. Three outcomes **checked in this order** (2835–2836):
1. world disposed → **throws `WorldDisposedError`** (2837)
2. this exact object tombstoned `'evicted'` → **throws `ModelEvictedError`**, immediately, without
   assigning a new epoch — "a model that was ever evicted can never be re-leased" (2838–2839)
3. otherwise → admits if not already admitted (`epoch = nextLoadEpoch++`, records `liveModelByModelId`,
   "same lazy-admission path findClashes's entry check uses") and returns the possibly-pre-existing lease
   (2840–2842)

Idempotence: "calling it again for an already-live object returns a lease with that same epoch (does not
re-admit or reassign)" (2834–2835). Pinned by fixtures 4002–4004 (spy: `nextLoadEpoch` consumed once) and
4005–4008 (evicted object → throws, no epoch consumed).

### `world.isLeaseValid(lease): boolean` (2852–2885)

"Strictly non-throwing and total: for any lease ever returned by admitModel, always returns a plain
boolean, never throws" (2853–2854). Checks `disposed` **FIRST, directly** — not inferred from
`lease.model`'s own `modelLifecycle` entry (2854–2855). Body given literally (2856–2858):

```
if (disposed) return false;
const entry = modelLifecycle.get(lease.model);
return entry?.state === 'live' && entry.epoch === lease.epoch;
```

This is **the first of exactly two deliberate exceptions** to "every public method throws
`WorldDisposedError` once disposed" (2864–2867). It "still answers only 'is this lease still valid,' never
why" (2885). A caller needing the cause calls `isModelLive` inside `try`/`catch` (2874–2878).

### `world.isModelLive(model): boolean` (2988–2998)

Checks `disposed` FIRST, directly — **throws `WorldDisposedError`** immediately if set, before consulting
`modelLifecycle` at all (2989–2990). Otherwise `true` iff this exact object has a `{state:'live'}` entry.
**"Never seen before → false"** (2991) — explicitly *not* a pre-admission gate; Round 13 established that
contract is "*wrong* for a pre-admission gate" and "nothing public still depends on `isModelLive` for that
purpose" (2995–2998).

### `world.evictModel(model): void` (2887–2986)

Takes the exact `Model` object (2888). Body given literally (2901–2906):

```
if (disposed) return;                                     // no-op on a disposed world
const previous = modelLifecycle.get(model);
if (previous?.state === 'evicted') return;                // idempotent no-op
modelLifecycle.set(model, { state: 'evicted' });          // unconditional
if (previous?.state === 'live') releaseEpochScopedState(previous.epoch);
```

- Tombstone write precedes the (conditional) release, and is permanent either way (2907–2909).
- **Second deliberate non-throwing exception**: on a disposed world it returns immediately as a no-op, it
  does **not** throw (2953–2958). Three justifications, "in descending order of force" (2958):
  (1) a throw is verifiably destructive to the *Viewer* — cited to the pinned 7.124.2 bundle,
  `EventDispatcher.prototype.dispatchEvent` (`viewer3D.js:13300-13341`) with no try/catch,
  `Viewer3DImpl.unloadModel` (`34052-34054`), `unloadCurrentModel`'s unguarded loop (`34253-34258`),
  `Viewer3D.tearDown` (`26583`) wrapping extension unloads but **not** `unloadCurrentModel` (2959–2973);
  (2) nothing left for it to do — `dispose()` already released everything (2974–2978);
  (3) it is the branch the method already had (2979–2981).
- The no-op is **silent** — "a diagnostic on it would fire on every normal teardown" (2982–2983).
- **`releaseEpochScopedState`** — see §2.6 and §5.2. Explicitly required to be **non-throwing**
  (2936–2942): "a version which could throw partway through would leave the tombstone written (correct,
  permanent) but the release incomplete and unretriable, since the now-`'evicted'` entry no longer carries
  the epoch a second attempt would need". Framed as "a state-release/cleanup completeness concern, not a
  liveness-correctness one" (2941–2942).
- `liveModelByModelId` occupancy: deletes the id entry only if this object is still the current occupant
  (2943–2946, 3083–3086) — **explicitly bookkeeping only**.
- The **extension-owned room cache is NOT covered** by the disposed no-op; the handler must drop it
  unconditionally (2984–2986, 3269–3273).

### `world.dispose(): void` (3000–3037)

Terminal. Sets `disposed` FIRST, synchronously (3001). "After `dispose()` returns, every public method on
this world instance — `findClashes`, `admitModel`, `isModelLive`, a second `dispose()` — rejects or throws
`WorldDisposedError`" (3004–3006). Two named exceptions, both of which still check `disposed` directly and
first, differing only in the action: `isLeaseValid` → `false` (3009–3011); `evictModel` → no-op
(3012–3015).

Also: wholesale-clears `GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity`, **and the
`CollisionInstance` identity cache** — "the entire cache, in one operation, not a per-model sweep over
`liveModelByModelId`" (3016–3018); best-effort tombstones whatever `liveModelByModelId` currently
references, "for diagnostic bookkeeping, but this is no longer load-bearing for correctness" (3028–3033).
A suspended query fails at its next checkpoint because that checkpoint checks `disposed` directly
(3034–3036).

**`dispose()` no longer needs to enumerate and tombstone every live model for correctness, and this spec
no longer claims it does** (3210–3211, 3521–3522).

### `world.findClashes(query)` entry contract (2796–2802, 3152–3173)

Order: `disposed` first (3153, 3193); then, for each of `query.source.model` / `query.target.model`: a
`'evicted'` entry rejects immediately with `ModelEvictedError`; no entry at all proceeds to **lazy
admission** (fresh epoch, `state:'live'`, recorded in `liveModelByModelId`) (3154–3156). "a model object
never seen before is a legitimate first use and is admitted normally; only an object this exact world has
already evicted is rejected" (2801–2802). Also rejects if `source.model !== target.model` (2803,
2556–2557).

A failure at the entry check **or any yield checkpoint aborts the entire call** — never a partial or
diagnosed `ClashResult` (3166–3171).

## 1.5 Checkpoint / yield sites and what each revalidates

**Universal two-part protocol:** `disposed` first and directly, then the model's load epoch (2778–2781,
3194–3197, 2217–2221, 2232–2234, 2706–2708). `disposed` → `WorldDisposedError`; stale epoch →
`ModelEvictedError` (3167–3168, 2219–2221).

| # | Site | Cited | Yield or abort-only | Revalidates |
|---|---|---|---|---|
| 1 | `findClashes` entry | 3152–3156 | n/a | `disposed`, then tombstone/lazy-admit for both operands |
| 2 | before each requested dbId's extraction | 2558–2562, 2762–2763 | yield | full two-part |
| 3 | between sibling nodes of the extraction walk | 2644–2646, 2629–2630 | yield | stated only as "a checkpoint against `frameBudgetMs`"; the two-part revalidation is stated universally at 2778–2781 |
| 4 | before the broad-phase scan | 2763, 1915–1916 | yield | full two-part |
| 5 | **before each individual instance pair inside the broad-phase scan** | 2703–2709, 1855, 2763–2764 | yield-and-resume from exact `(sourceIndex, targetIndex)` | full two-part (2706–2708) |
| 6 | before starting each candidate pair (cached or not) | 2762 | yield | full two-part |
| 7 | between each of a pair's composed sub-queries | 2764–2765 | yield | full two-part |
| 8 | **before each build phase** (weld / connectivity / BVH) | 1272–1290, 1323–1332, 2743–2748 | yield **only if the accumulator is already due** (Round 22, 1278–1290) | `disposed` first, **then the liveness/epoch of the ONE model that owns this geometry** — the operand whose `loadEpoch` is in the record's key — **and nothing else** (1323–1330) |
| 9 | before each individual probe in `ProperCrossingQuery` | 1808–1825 | **abort-only** (`bvhcast` cannot pause) | — sets `aborted`; diagnosed `crossing-budget-exhausted` |
| 10 | at `bvhcast` callback entry for raw candidates | 1816–1819, 1850 | abort-only | — |
| 11 | **before each individual `classifyPoint` call** in `ContainmentQuery` sampling | 2212–2224 | yield-and-resume, non-truncating (2229–2231) | full two-part (2217–2221) |
| 12 | before each witness-triangle attempt (stage 3, `maxWitnessTriangles = 8`) | 2232–2235 | yield-and-resume | full two-part |
| 13 | **inside `SurfaceCrossingWitness`** — at callback entry and immediately before every probe | 2339–2353 | **abort-only** — "Being `bvhcast`-native, this traversal cannot `await`, yield, or resume" (2348) | — sets a traversal-local `aborted` flag; `crossing-budget-exhausted` |

**Site 8 is the deliberate exception to "revalidate both operands":** "It must not reject because the
initiating query's *other* operand was evicted" (1326); "Each caller separately re-validates both of its
own operands at its own checkpoints, before and after awaiting a shared phase slot" (1329–1330); "a caller
whose own query aborts for an unrelated reason does not cancel a phase already in flight: every phase slot
runs to settlement" (1330–1332). Pinned by fixture 3867–3871.

**Site 13 changed since v5.** `SurfaceCrossingWitness` is now stated to be **its own `bvhcast`-native
traversal**, not a plain JS loop: "`SurfaceCrossingWitness` performs its own `bvhcast` over the source and
target BVHs — a real traversal, not the plain-JS sampling loop `anyComponentInside` uses" (2339–2340), and
`ContainmentQuery`'s own passage now says "`SurfaceCrossingWitness`, below, is **not** a third instance of
this pattern — it is its own `bvhcast`-native traversal, non-resumable like `ProperCrossingQuery`'s, and is
checkpointed accordingly" (2235–2237). The "all three are plain JS loops" phrasing v5's model recorded is
gone; the current text says "both this sampling loop and stage 3's are plain JS loops with no native
traversal in the way" (2234–2235) — i.e. **two**, not three.

`[CONTRADICTION]` — **`SurfaceCrossingWitness`'s clock basis contradicts `ProperCrossingQuery`'s.** Line
2349 states that in `SurfaceCrossingWitness` "**the shared elapsed-time accumulator** is checked at callback
entry and immediately before every probe". `ProperCrossingQuery`'s clock-basis passage (1783–1798) states
the opposite rule for a `bvhcast`-native traversal — "elapsed synchronous time since the **traversal's own
start**" (1783–1784), and "Reading the *shared* accumulator instead — as a prior draft of this passage did
— would make that permanent, result-altering abort a function of the traversal's arrival time" (1789–1791)
— and the composition analysis at 1897–1907 groups **both** traversals under one "abort-only ceiling" whose
clock is "a private, traversal-local clock, deliberately not the shared accumulator (see the clock-basis
passage), worst case ~2×`frameBudgetMs`" (1901–1902). The two `bvhcast` traversals are therefore assigned
two different clock bases in two different passages.

`[AMBIGUOUS]` — **clock basis at the remaining intra-loop checkpoints is still stated three ways.**
`ProperCrossingQuery`'s round-11 paragraph says "`performance.now()` is read **before each individual
probe**" with no basis named (1814–1815); `ContainmentQuery`'s intra-loop checkpoint says "**elapsed time**
is read immediately before each sample's classification. If it exceeds `frameBudgetMs` …" (2215–2216),
likewise unqualified; and the closing sentence of the budget section states, verbatim (1995–1999): "Both
mechanisms key off the same constant and **the same clock**; they differ only in *where* the check runs and
*what happens* when it trips — abort-and-diagnose inside a synchronous native traversal that cannot pause,
versus genuinely yield-and-resume in plain JS loops that can". What "the same clock" denotes is not defined
there, and this model does not interpret it; it is recorded alongside the private-clock exception at
1783–1798 and 1901–1902 without deciding between them.

## 1.6 Error types

Exactly two are defined anywhere in the document:

| Error | Raised by | Cited |
|---|---|---|
| `WorldDisposedError` | `admitModel` (2837), `isModelLive` (2989–2990), `findClashes` entry + every checkpoint (3167, 3518), `dispose()`-after-`dispose()` (3004–3006, 3526), room-search callbacks via the disposed-first mapping (2498–2519, 2524–2528), a repeated `unload()`'s second `dispose()` (3254–3258) | throughout |
| `ModelEvictedError` | `admitModel` on tombstoned object (2838), `findClashes` entry + yield checkpoints (3167–3168), room-search callbacks — constructed as `new ModelEvictedError(model.id)` (2505) | throughout |

`isLeaseValid` and `evictModel` raise **neither** — by explicit design (2853–2854, 2953–2958).
`[SILENT]` — no error class is defined for the walk's `maxFragmentsPerDbId` / `maxChildrenPerNode`
rejections, for `maxBroadPhaseInstancePairs`, or for the **new** `maxCollisionInstancesPerEpoch` rejection;
all are described only as "the same plain call-level rejection" / "rejects the entire call" (2599–2600,
1854, 1857, 3434–3436) with no named type. Likewise `[SILENT]` on the error type for a cross-model query
(2556–2557, 3487–3489) and for "Invalid dbId: reject with a clear error" (3493).

## 1.7 `modelId` reuse semantics

`modelId` is used for: `liveModelByModelId` bookkeeping (318–319, 3075–3086); diagnostic metadata on a
`GeometryRecord` (1189–1191); and `ModelEvictedError`'s payload (2505, 3168). It is **not** a cache key
anywhere (Round 14; §2.1, §5.1).

Two supported states are explicitly named:
- A stale/duplicate `evictModel(oldModel)` arriving after a different object already reused the id
  (3538–3546): the old object is tombstoned; the new object's state "was never at risk" because it is
  epoch-keyed.
- Two objects sharing a reused `modelId` **both live simultaneously** (3547–3553, 3079–3081, 3180–3183) —
  "a state round 14's own epoch-keying fix made supported and tested". This is precisely why
  `liveModelByModelId` cannot be a complete enumeration.

## 1.8 Extension-side lifecycle (`RoomLocatorExtension`, 3229–3279)

- `load()` (3232–3242): "awaits `CollisionWorld.fromViewer(viewer, options)` to completion before
  returning; no room resolution here … and no eager BLAS building." Registration ordering is normative:
  "The `BEFORE_MODEL_UNLOAD_EVENT` listener and the context-menu item are registered **only after
  `fromViewer()` resolves, inside this same call** — `loadExtension()` treats this extension as ready the
  moment `load()`'s returned promise resolves, and nothing downstream is guaranteed to wait further, so no
  consumer can observe a registered listener referencing a not-yet-constructed world. If `fromViewer()`
  rejects, `load()`'s returned promise rejects with the same error before either registration runs —
  neither exists without the other" (3234–3242).
- `unload()` (3243–3268): `world.dispose()` **first**, listener + context-menu removal **second**, then
  clears the per-model room cache. **Two throw hazards are documented:**
  - Hazard 1: the window in which `BEFORE_MODEL_UNLOAD_EVENT` can still fire into a disposed world, which
    "can outlive `unload()` itself, since `Viewer3D.tearDown` catches a throw from `unload()` while leaving
    the listener registered". Benign "**but only because** `world.evictModel` is a no-op on a disposed
    world rather than a throw — it is the method's totality that makes this ordering safe, not the ordering
    itself" (3244–3253).
  - Hazard 2: "a repeated `unload()` call re-invokes `world.dispose()`, and a second/repeated `dispose()`
    call is **guaranteed to throw `WorldDisposedError`** …, synchronously, before steps 2/3 ever run —
    stranding listener removal, context-menu removal, and the room-cache clear for that invocation.
    `Viewer3D.tearDown` wraps each extension's own `unload()` call in try/catch …, so this throw is
    swallowed rather than propagating — the same 'benign only because something else catches it' shape as
    the first hazard, not a resolution of it. **Whether the Viewer or app code can invoke `unload()` a
    second time on one instance is unstated.**" (3253–3265).
  - **Explicitly left open**: "Per-step isolation of `unload()`'s three steps, and whether the listener
    should be removed before `dispose()` rather than after, remain open and are not settled here"
    (3265–3268).
- `BEFORE_MODEL_UNLOAD_EVENT` handler: `world.evictModel(event.model)` **AND** drop that object's
  room-cache entry, the latter "unconditional and independent of the `evictModel` call" (3269–3273,
  2452–2456, 2984–2986).
- `locateElementByRoom(dbId): Promise<number[]>` — rejects `ModelEvictedError` / `WorldDisposedError`
  (3274–3276).

**`tearDown()`/`keepCurrentModels` is modeled (2395–2429).** The stated finding: extensions are registered
once, in `config.extensions` at `viewer.start()` (`wwwroot/viewer.js:15-24`); `loadModel()` passes
`viewer.loadDocumentNode(doc, defaultGeometry)` with no options object (`wwwroot/viewer.js:31-41`), "so
`keepCurrentModels` is never set." Loading a second model therefore invokes `Viewer3D.tearDown()`, which
unloads every registered extension, "and nothing in this app re-registers it afterward" — cited to
`viewer3D.js:27710` and `viewer3D.js:88293`. **Conclusion stated:** "on this app's current wiring, Room
Locator **does not survive a second model load at all** — it is unloaded once and never comes back, a
Milestone-1 application-wiring gap, not a defect in the identity apparatus itself" (2409–2411). The
resolution (explicit reload vs. accepting the limit) is "neither … decided here" (2411–2415). The companion
narrowing of the stale Open Question is at 4422–4425.

**Round-21's `tearDown()`-path proviso has been re-punctuated since v5.** The current text reads: "On the
`tearDown()`-driven path specifically — **provided `unload()` itself completes all three of its steps**
(see `RoomLocatorExtension.unload()`'s per-step-isolation caveat; the same proviso `unload()`'s own
ordering note applies to the sibling case where `BEFORE_MODEL_UNLOAD_EVENT` fires into an already-disposed
world) — `BEFORE_MODEL_UNLOAD_EVENT` fires only after `tearDown()`'s own extension-unload loop already ran,
so this extension's listener is already deregistered and `world.evictModel` is never invoked for the
outgoing model that way; `world.dispose()`'s wholesale clear and the room-cache clear already release
everything a per-model `evictModel` call would have" (2415–2422). The proviso now sits **ahead of** both
clauses (v5 recorded it as trailing and governing only the second), and the bundle citations are present
(2423–2429: `viewer3D.js:26541-26560`, `:26583`, `:34052`, `:34054`, plus "This ordering is an internal
implementation detail, not documented or guaranteed by Autodesk — revalidate on any Viewer upgrade").

`[SILENT]` — `locateElementByRoom(dbId)`'s public signature "is unchanged and still resolves 'the current
model' however it already does" (2436–2437); whether it should take a model argument is explicitly deferred
to `review-comments-v12.md` (2437–2439).

---

# 2. Geometry ownership / build pipeline

## 2.1 `GeometryRecord` identity

One `GeometryRecord` per unique **`(loadEpoch, geometryIndex)`** — keyed by the owning `Model` object's
admitted load epoch, **never** `modelId`, never the bare index (1173–1176, 1081–1090, 3136–3151).
`loadEpoch` = `modelLifecycle.get(model).epoch` (1082, 3139–3140). Because `nextLoadEpoch` is global,
monotonic and never reused, two objects sharing a `modelId` are "structurally guaranteed a disjoint epoch,
and therefore a disjoint `GeometryRecord` namespace, before its first geometry lookup ever runs"
(3141–3143).

Record fields named anywhere: `referenceCount` (1176), `buildState: 'building' | 'ready'` (1176),
`weldPromise` (1177), `accelerationPromise` (1178), lazy `connectivity` promise (1179–1180),
`L_X := diagonal(localBounds(X))` cached with the BLAS (1470–1472), and `modelId` as display/diagnostic
metadata only (1189–1191).

`[SILENT]` — `referenceCount` is named exactly once in normative text (line 1176) and never mentioned again
in 4429 lines (the only other hit is line 647, inside Round 19's list of deliberately-untouched findings).
Nothing states when it is incremented, decremented, or what happens at zero. Unchanged since v2. Note that
1223 now explicitly says the `CollisionInstance` cache's release is "**not** derived from … a geometry
reference count", the only other place any reference count is mentioned.

## 2.2 The three kinds of registry entry

Stated at 1362–1370: "A registry lookup yields one of three things:"

| Kind | `buildState` | Cancellation signal | Phases | Cited |
|---|---|---|---|---|
| **oversized marking** | **none** ("it carries no `buildState`") | **none, ever** | none ever started | 1362–1370 |
| `'building'` record | `'building'` | created once at insertion | ≥1 unresolved | 1301–1304, 1342–1345 |
| `'ready'` record | `'ready'` | same signal, carried unchanged across the transition | weld+BVH resolved; connectivity may be unresolved | 1315–1322, 1344–1348 |

Oversized marking, verbatim (1362–1370): "*an oversized marking* (no phase is ever started for it, it
carries no `buildState`, and every pair needing it is skipped) … Because an oversized marking is rejected
*before* any build or derived phase ever starts, it has no unresolved phase work and therefore never has
the entry-scoped cancellation signal described above created for it at all — that signal is created exactly
once, at insertion, for a `'building'` entry, a trigger an oversized marking never undergoes.
`evictModel`'s `releaseEpochScopedState` and `dispose()`'s wholesale clear (below) **still enumerate and
remove oversized markings in the same sweep** as `'building'`/`'ready'` entries, but there is no signal on
them to reject — **removal is the entire cleanup**."

## 2.3 The entry-lifetime cancellation signal (Critical invariant — verified intact)

Stated at 1342–1361:
- "**Every registry entry** carries one entry-scoped cancellation signal, created once when the entry is
  first inserted in `buildState: 'building'` and kept alive, unchanged, for the entry's entire lifetime —
  the signal is *not* discarded or replaced when the entry transitions to `'ready'`." (1342–1345)
- "Every unresolved phase slot the entry ever hosts races that same signal, including a lazy connectivity
  build started later against an already-`'ready'` entry … the signal is scoped to the entry's lifetime,
  not to its `buildState`." (1345–1348)
- "The release paths reject that signal exactly once and drop the entry in the same step …
  unconditionally, for every entry they remove regardless of whether its `buildState` is `'building'` or
  `'ready'`." (1348–1351)
- "one signal per entry suffices; there is no per-phase-slot set or map of signals to keep in sync" —
  justified because "phases are strictly sequential and single-flight per entry … with at most one phase
  ever unresolved on a given entry at a time" (1352–1354)
- Removal is identity-guarded (1355–1359).
- **Carve-out sentence:** "This entry-lifetime signal is defined only for `'building'`/`'ready'` entries —
  an *oversized marking* (see below) never has one, because no phase is ever started for it and it carries
  no `buildState` to begin with." (1359–1361)

`[CONTRADICTION]` (**pre-existing, byte-identical since Round 20**) — the bullet **opens** with the
unrestricted universal "**Every registry entry** carries one entry-scoped cancellation signal" (1342–1343)
and **closes**, nineteen lines later, with "This entry-lifetime signal is defined **only for
`'building'`/`'ready'` entries** — an oversized marking … never has one" (1359–1361). The opening sentence
was not narrowed. The intervening clause at 1348–1351 ("unconditionally, for every entry they remove
regardless of whether its `buildState` is `'building'` or `'ready'`") sits in the middle: "every entry they
remove" is universal, while the qualifier enumerates only the two states an oversized marking does not
have.

## 2.4 Pipeline stages, in order (Critical invariant — verified intact)

The build is **not atomic** — a checkpoint sits before each phase (1272–1276, 1294–1296).

| # | Phase | Gated by | Checkpointed | Cited |
|---|---|---|---|---|
| 0 | Layout normalization → `ranges: TriangleRange[]` | — ("free, no per-triangle work") | — | 1380–1382, 1128–1167 |
| 0.5 | **Ceiling check**: `activeTriangleCount := Σ floor(ranges[i].count / 3)` vs `maxSyncTriangleCount` | the ceiling itself, "not gated by `frameBudgetMs`" | — | 1378–1395 |
| 1 | **Active-range compaction** → collision-owned compacted position/index pair | folded into the weld phase's checkpoint | shares the weld phase's own checkpoint | 1378–1402, 1847 |
| 2 | **Weld** (`mergeVertices` on position+index only) → `weldPromise` | `maxSyncTriangleCount` | own checkpoint, before it starts | 1254–1290, 1847, 1616–1620 |
| 3 | **Connectivity** (`GeometryConnectivity`) → own promise slot; **independently lazy** | `maxSyncTriangleCount` | own checkpoint, before it starts | 1256–1272, 1848, 1648–1671 |
| 4 | **BVH** (`MeshBVH`) → `accelerationPromise` | `maxSyncTriangleCount` | own checkpoint, before it starts | 1241–1242, 1849 |

Order is "weld first, then connectivity if it is needed, then the BVH" (1305–1306). All three run over the
**same** compacted buffer; "none of the three ever sees a triangle outside the active ranges" (1398–1399).

**Round-22 amendment to the per-phase-checkpoint claim (1278–1290)** — see §4.5. The phase ordering and
ownership are unchanged; what changed is what the pre-phase checkpoint is claimed to guarantee about
*spans*.

`[CONTRADICTION]` (**pre-existing, deliberately untouched — Round 19 list at 646–647**) — line 1379–1380
states the compaction phase runs "**Before welding, before the ceiling check**, and before anything is
handed to `mergeVertices`", while lines 1393–1396 state "**`maxSyncTriangleCount` is checked against
`activeTriangleCount` before any copying happens** … Only once that check passes does compaction actually
copy triangle data". The two orderings are inverted relative to each other inside the same paragraph. Line
1847's table row calls it a single "compaction + welding phase". Fixture 3881–3885 pins the 1393 ordering
(spy on the compaction step: **zero** calls when the active count alone exceeds the ceiling).

`[CONTRADICTION]` (**pre-existing, deliberately untouched**) — line 1434 states "A geometry **at or above**
that triangle count is **not** built synchronously" (i.e. `>=`), while line 2739–2740 says "if either
**exceeds** it, skip the pair", line 3413 says "**exceeds** `maxSyncTriangleCount` … is skipped", and line
1394 says "a fragment whose active set alone **exceeds** the ceiling is marked oversized". The boundary
fixture at 3886–3891 uses 13,000 (skip) and 11,000 (build) — which does not discriminate the value `12_000`
itself.

## 2.5 Publication, single-flight, and what a caller may read

Stated at 1291–1370:
- **"A `GeometryRecord` is published when its build *starts*, not when it finishes"** (1291–1293). The
  earlier "only published once every phase completes" rule "could not hold" because the build is
  deliberately not atomic (1294–1296); publish-only-when-complete would defeat dedup and make in-flight
  builds unreachable from `evictModel`/`dispose()` (1296–1300).
- **Insert first, then build**: the missing caller inserts the record with `buildState: 'building'`
  **before the first phase's checkpoint — that is, before any yield** (1301–1303).
- Each phase is a **single-flight slot**, created at most once, on demand, awaiting its prerequisites
  rather than launched in parallel (1303–1307).
- **"A caller that finds an existing entry never starts a duplicate build."** "This single registry-level
  mechanism is what makes concurrent build requests dedupe, and it covers compaction/weld and connectivity
  exactly as it covers the BVH — see `BlasCache` below, **which owns no dedup mechanism of its own**"
  (1308–1311, echoed 1420–1429).
- **"Nothing reads a phase's product off a `'building'` record."** Products are "only ever the resolved
  values of their own phase slots, never fields read straight off the record" (1312–1314).
- **`'ready'` is record-level and mode-independent**: weld+BVH resolved (1315–1317). "it is `'ready'`
  whether or not the connectivity slot was ever created"; "**Connectivity is never what makes a record
  un-`'ready'`**" (1317–1322).
- **A build-phase checkpoint validates the record's owner, not the building caller's whole query**
  (1323–1332) — see §1.5 site 8.
- **There is no `'failed'` state** (1333). A failing build-phase checkpoint rejects the slot and "**the
  entry is removed from `GeometryRegistry` synchronously as part of that rejection**", discarding
  intermediate buffers (1333–1339). Identity-guarded (1339–1341). Pinned by fixture 3818–3825.

`[AMBIGUOUS]` (**pre-existing, three-way, deliberately untouched**) — the connectivity **trigger point** is
explicitly not decided by the state model: "created on demand at whichever point this spec's
connectivity-trigger rule fires (see the narrow phase in **Data Flow** step 3 and 'Connectivity remains
independently lazy' above — **this state model does not by itself decide that trigger point**)"
(1319–1322). Data Flow step 3 (2743–2746) places it inline between weld and BVH ("active-range compaction
and welding together, then (only for a mode that calls `anyComponentInside` …) connectivity, then the
BVH"), which is a *build-time* trigger. Fixture 3833–3838 describes a `containment` caller *driving the
connectivity phase itself against an already-`'ready'` entry* — a third timing. The three are not
reconciled.

`[SILENT]` (**pre-existing, deliberately untouched**) — nothing states whether an **oversized marking**
participates in the single-flight / "caller that finds an existing entry" rule, i.e. whether a second
candidate pair needing the same oversized geometry re-computes `activeTriangleCount` or reads the marking.
Line 1363 says "every pair needing it is skipped" (implying the marking is consulted), while Data Flow's
narrow phase (2736–2743) describes the ceiling check as run per candidate pair *before* the registry
get/build. The `geometry-too-large-for-sync-build` diagnostic is stated to be "fragment-scoped and
deduplicated … one entry is emitted per oversized fragment no matter how many candidate pairs it appears
in" (2741–2743), which requires *some* memory across pairs but does not say it is the marking, and never
names the dedup store.

`[SILENT]` — **nothing states which code path creates the oversized marking, or when.** 1434–1437 says
"`GeometryRegistry` marks the record oversized"; 1394 says "a fragment whose active set alone exceeds the
ceiling is marked oversized"; 2739–2741 says the narrow phase checks the count "first — if either exceeds
it, skip the pair and record a `geometry-too-large-for-sync-build` diagnostic". No passage says the narrow
phase's check is what inserts the marking into `GeometryRegistry`, nor whether the marking is inserted at
all on the first pair that trips it.

## 2.6 Release paths (geometry side)

| Path | Trigger | What it removes | Signal handling | Cited |
|---|---|---|---|---|
| **Build-phase rejection** | owning model evicted / world disposed at a between-phases checkpoint | this entry, synchronously, identity-guarded | slot rejects with `ModelEvictedError`/`WorldDisposedError` | 1333–1341 |
| **`releaseEpochScopedState(epoch)`** | `evictModel` on a previously-`'live'` object | every `GeometryRegistry` entry filed under that epoch — "in whichever build state, `'building'` or `'ready'`, **plus any oversized marking**" — "together with its cached BLAS and cached connectivity"; **and, as a separate operation over a different keyspace, the outgoing epoch's `CollisionInstance` bucket** | for **every `'building'` or `'ready'` entry it removes**, rejects that entry's signal first; **"An oversized marking carries no such signal — no phase is ever started for it — and is removed directly in the same sweep, with nothing to reject."** Then identity-guarded delete. | 2910–2926 |
| **`dispose()` wholesale clear** | `dispose()` | `GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity`, **and the `CollisionInstance` identity cache**, in one operation | "For **every `'building'` or `'ready'` entry it removes**, the clear rejects that entry's cancellation signal … exactly once, in the same pass that drops the entry, identity-guarded … **An oversized marking carries no cancellation signal at all — no phase is ever started for it — so the clear removes it directly in the same wholesale pass, with nothing to reject.**" | 3016–3028 |

**Residual C-5 site — still present.** Line 3210–3222, inside the "`world.dispose()` is terminal" prose
block, still says "…and **rejects every in-flight build promise, exactly once**, on the same disposal call.
'Every in-flight build promise' is enumerable at all only because … the unresolved phase slots hanging off
the registry's entries … *are* the in-flight builds … **and the clear rejects each entry's cancellation
signal as it drops the entry.**" No oversized carve-out. `[CONTRADICTION]` — see §5.4.

## 2.7 Extraction contract (Critical invariant — verified intact)

`ViewerModelAdapter` 1025–1090 + Data Flow step 3, 2558–2686.

- **No code path may call `enumNodeFragments(dbId, cb, true)`** (1036–1037). The normative path is the
  self-driven, depth-first, node-by-node walk in Data Flow step 3, built from
  `enumNodeChildren(node, cb, false)` and `enumNodeFragments(node, cb, false)` (1034–1036).
- **"`getChildCount` is not one of the walk's primitives"** (1037–1038).
- Coverage-equivalence argument (1039–1055), verified against the pinned 7.124.2 bundle's
  `enumNodeInstances`; "**The union of the walk's per-node `enumNodeFragments(node, cb, false)` results is
  therefore the same fragment set one `enumNodeFragments(dbId, cb, true)` call produces**" (1051–1053).
  Walk dedupes by fragment id (1054–1055, 2612–2616).
- Two conditions the equivalence rests on (1056–1069): (1) *no truncation* — both early-exit paths reject
  the entire `findClashes` call; (2) *a complete tree to walk* — **explicitly not closed**: "See
  **Risks**; this spec does not claim to have closed the second" (1069). The Risks entry now exists
  (4299–4307).
- `maxChildrenPerNode` (`10_000`, provisional) — **sole enforcement mechanism is the in-callback abort
  inside non-recursive `enumNodeChildren(node, cb, false)`, for every node shape** (2573–2610, 1854,
  3427–3445). Three normative implementation constraints (2600–2610): local flag not the forwarded return
  value (dbId `0` is falsy); callback **only collects child ids**, never descends inline; typings declare
  both as `void`, contradicting the documented contract, so it must be pinned by test.
- `maxFragmentsPerDbId` (`5_000`, provisional) — tally counts **callback invocations, not distinct fragment
  ids** (2612–2616); checked after every node's contribution; the walk stops immediately and the entire
  call rejects (2617–2620).
- **One node's own `enumNodeFragments(node, cb, false)` call remains an accepted, non-preemptible atomic
  risk** (2648–2677, 1853, 516–519, 3417–3426) — with the explicit note that Round 17's justification for
  it was factually wrong and applying the two available mechanisms "is a required follow-up this pass did
  not carry out" (2666–2675).

**`getChildCount` changelog annotations are present.** The Round-16 entry's primitive list (463–464) carries
an in-place annotation at 466–470; the Round-17 entry's preflight bullet (505–507) carries its own at
507–512. Both match the document's stated superseded-annotation convention (452–454).

`[AMBIGUOUS]` — **one unannotated present-tense residue survives in the Round-17 entry's own preamble.**
Line 496–498 still states, without annotation, that "`getChildCount(dbId)`/`getChildCount(node)` is
documented on both the deprecated `InstanceTree` class and its replacement `Autodesk.Viewing.ObjectTree` as
'Get number of children under the specified id,' **returned without enumerating those children**." That
final clause is precisely the factual claim C-1 refuted for a mixed node (605–610, 1854, 2578–2589). The
annotation was attached to the *bullet* at 507–512, not to this preamble sentence.

---

# 3. Query mode dependencies

## 3.1 `anyComponentInside` — the three stages (canonical statement, 2141–2204)

Preamble: "Three escalating stages, per component — **the third is scoped to `volume-overlap` only; see the
note after stage 3 for why `containment` stops after the second**" (2146–2148).

| Stage | What | Cited |
|---|---|---|
| 1 | **Spatially-spread vertex sampling** — stride `ceil(n / samplesPerComponent)`, `samplesPerComponent = 8`. Stop at first `inside` or `outside`. | 2150–2154 |
| 2 | **Continue through the component** — if every strided pick reads `boundary`, keep walking remaining vertices until conclusive or exhausted. "On a manifold component this is where the guarantee is actually discharged." | 2155–2158 |
| 3 | **Constructed interior witness** — centroid ± normal × each `witnessLadder` rung, keeping the first probe `classifyPoint` puts `inside` **the component's own geometry**; up to `maxWitnessTriangles = 8` triangles. | 2159–2165 |

**Stage-3 scoping (the single source of truth, 2176–2196):** "This stage is scoped to `volume-overlap`;
**`containment` never runs it**, and round 9 was the correction of an earlier draft that ran it in both."
Reason: the witness is constructed inside the source's own volume, off the surface entirely, which violates
`containment`'s surface-only contract; two coincident closed boxes are the counterexample (2176–2184).
"`containment`'s use of `anyComponentInside` (in `ContainmentModeQuery` below) therefore stops after stage
2" (2186).

Explicit non-claim (2187–2196): stopping after stage 2 "is **not** the same as asserting the component is
clean-false"; an unresolved component "stays unresolved for this term … rather than being asserted false";
what discharges the genuine case is `SurfaceCrossingWitness`'s independent triangle-level search.

Exhaustion: "Only if all three stages fail (`volume-overlap`) or the first two fail (`containment`) is the
component unresolved, and a negative result with any unresolved component emits
`inconclusive-containment`" (2198–2200).

Global cap: `maxContainmentSamples = 512` → `incomplete-component-coverage` (2203–2204).

**Caller list stated once, cross-referenced from the two restatement sites.** Canonical enumeration under
`ThreeMeshBvhBackend`/`BlasCache` at 1259–1266 ("Both `containment` and `volume-overlap` call
`anyComponentInside` (`ContainmentModeQuery` directly; `VolumeOverlapQuery` through its own containment
term, run *after* `ProperCrossingQuery` returns false) … Only `surface-intersection`, which never calls
`anyComponentInside` at all, is genuinely connectivity-free"). Restatement sites defer to it: 2006–2010 and
2368–2370.

## 3.2 Mode → dependency matrix (Critical invariant — verified intact)

| | `surface-intersection` | `containment` | `volume-overlap` |
|---|---|---|---|
| calls `anyComponentInside` | **no** (1266, 2369–2370) | yes, **stages 1–2 only** (2288–2294) | yes, **all three stages** (2176–2177) |
| requires compaction+weld | yes (1255–1256) | yes | yes |
| requires BVH | yes — "the one phase every mode needs" (1849) | yes | yes |
| requires **connectivity** | **no** — "the only mode that never calls `anyComponentInside` at all, is genuinely connectivity-free" (1266, 1848, 2745, 3815–3817) | **yes** (1259–1272) | **yes** (1259–1266; Round 16 corrected the opposite claim, 448–458) |
| parity evaluated against | **nothing — no parity at all** (1561) | **target only** (1562) | **both** (1563) |
| closure precondition | none (1561, 2821) | target only (1592–1595, 2816–2819) | both operands (1585–1591, 2806–2811) |
| open source | fine, never diagnosed (1561, 1562) | fine, never diagnosed (1562, 2107–2110) | `unverified-parity-operand` and/or `unverified-open-component`, `role:'source'` (1563) |
| open target | fine, never diagnosed (1561) | `unverified-parity-operand` (`role:'target'`) (1562) | both diagnostics, `role:'target'` (1563) |

**The connectivity gate covers the target too (1267–1272).** "This same mode gate also builds connectivity
for an operand `anyComponentInside` never itself decomposes: `containment`'s parity-closure precondition …
reads a cached manifold-classification flag off the *target*'s `GeometryConnectivity`, independent of the
source-side component decomposition — so **both operands' records go through this same connectivity gate**
in `containment`/`volume-overlap` mode, not only the operand(s) `anyComponentInside` samples."

**Public-API mode comments state graceful degradation, not a hard precondition (2805–2820).** "'volume-
overlap' … **Soundest when BOTH operands are certified closed; an operand that isn't degrades gracefully
rather than rejecting** — every result depending on that operand's parity carries
`unverified-parity-operand` naming its role, and a positive whose deciding component isn't a certified
closed manifold also carries `unverified-open-component`"; and "'containment' … **Soundest when the TARGET
is certified closed**; open sources are sound here by construction and are never diagnosed. An open TARGET
degrades gracefully rather than rejecting — the result still runs and carries `unverified-parity-operand`
(role: 'target')." Grep for "Requires … certified closed" returns zero hits. Consistent with 1563, 2137,
3475 ("The pair is still reported rather than skipped") and fixture 3691–3697.

## 3.3 Mode composition

```
volume-overlap(A, B) :=                                      (2254–2258)
      ProperCrossingQuery(A, B)
   OR ContainmentQuery(anyComponentOf(A) inside B)
   OR ContainmentQuery(anyComponentOf(B) inside A)
```
Evaluated in that order with early exit (2260). Both directions required for symmetry (2264–2266). Pure
touching correctly returns **false** (2266–2268).

```
containment(A, B) :=                                         (2280–2283)
      ContainmentQuery(anyComponentOf(A) inside B)   // a source VERTEX inside B
   OR SurfaceCrossingWitness(A, B)                   // a point on a source TRIANGLE inside B
```
One direction only, no bidirectional evaluation (2285–2286). First term uses stages 1–2 only (2288–2294).
Second term "is not optional" (2296–2304). Stage ordering cheapest-first (2355–2359).

`surface-intersection` — "true iff any triangle pair from A and B has a non-empty geometric intersection,
including zero-volume coincident contact" (1673–1675); the *same* `bvhcast` traversal `ProperCrossingQuery`
uses, sharing `maxCandidatePairsExamined`, the same per-candidate `intersectsTriangle` test and the same
abort protocol, under a weaker predicate (1690–1697).

`[AMBIGUOUS]` — **"stage" names two different nesting levels.** Under `anyComponentInside`, "stage 1/2/3"
are the three escalating per-component searches (2150–2165). Under `ContainmentModeQuery`, "Stage ordering
is cheapest-first … A negative now requires *both* stages to fail … and **stage 2** is what now establishes
the antecedent instead of assuming it" (2355–2359) — where "stage 2" is `SurfaceCrossingWitness`, the mode
composition's *second term*. The same paragraph pair also says "The first term uses only
`anyComponentInside`'s **stages 1–2**" (2288), so both senses appear within seventy lines of each other.
The containment-guarantee restatement at 2067–2068 compounds it: "`ContainmentModeQuery`'s **own two-stage
negative** for `containment`". The `ContainmentModeQuery` fixture at 3763 adds a third use ("Stage 2 added a
third traversal to the design"). No disambiguating convention is stated.

## 3.4 `ProperCrossingQuery` (1699–1999)

Six numbered steps (1707–1781): 1. `bvhcast` traversal, callback receives **candidate** pairs not
intersecting ones (1710–1724). 2. Classify candidate first, ordered so the upstream coplanar warning path
is never entered (1725–1742). 3. Midpoint `M` of the valid `targetLine` (1743). 4. Four-quadrant probes
`P = M + δ × normalize(s₁·nA + s₂·nB)` over `offsetLadder`, coarsest to finest; "The pair is a proper
crossing iff some probe classifies as `inside` **both** A and B" (1744–1758). 5. **Inconclusive probes
propagate** → `inconclusive-crossing` (1759–1763). 6. Early-exit `true`; two independent budgets
(1764–1775).

**Abort protocol** (1777–1781): exceeding either budget sets `aborted` and returns `true` from
`intersectsTriangles` — "`bvhcast` therefore returns `true`, which **must not be read as 'crossing
found'**". Overshoot bounded to one probe's cost (1827–1831).

**Clock basis — the private-clock exception (1783–1798).** The third, time-based trigger is "elapsed
synchronous time since **the traversal's own start** exceeding `frameBudgetMs`" (1783–1784). The rationale
is stated at length: a `bvhcast` traversal "cannot yield or resume mid-call", so "unlike every other
checkpoint in this design, which only yields when the shared per-call accumulator is already due and never
changes how much work happens, a time-based abort here is destructive" (1786–1789); reading the shared
accumulator "would make that permanent, result-altering abort a function of the traversal's arrival time
relative to the rest of the call's already-spent budget, not of this traversal's own work: two calls
presented with the identical pair could reach opposite verdicts depending on what else ran first"
(1789–1793). "A private, traversal-local clock avoids that: its own worst case is bounded by one
`frameBudgetMs` span starting fresh at this traversal's own entry — **at most ~2×`frameBudgetMs`, which
sits within, not beyond, the performance gate's own ~16ms tolerance band (see the performance gate)** —
and the verdict depends only on this traversal's own cost, not on scheduling position" (1795–1799).

`[CONTRADICTION]` — **the parenthetical at 1797–1798 still names the pre-Round-22 gate band.** It asserts
~2×`frameBudgetMs` (~16ms) "sits within, not beyond, the performance gate's own **~16ms** tolerance band",
but the gate's pass criterion was rewritten by Round 22 (4179–4190) to state a **≈24ms** bound and no
longer states a ~16ms band at all. The claim's arithmetic ("within, not beyond") is unaffected under the
new bound, but the figure it cites no longer exists at the cited target. See §4.6.

## 3.5 Parity-closure preconditions (2065–2139, 2119–2130)

- "**every operand that parity is evaluated against must be a certified closed manifold.** If one is not,
  each result depending on that parity — positive *and* negative — carries `unverified-parity-operand`
  naming that operand's role." (2121–2123)
- "**Which operands those are depends on the deciding path, not on the mode alone.**" (2124–2128)
- "The check is free: `GeometryConnectivity` already computes manifold classification per geometry and
  caches it alongside the BLAS" (2129–2130).
- Role tables at 3334–3339 (parity) and 3353–3356 (open component).

**The containment guarantee** (2065–2083): conditional, and its precondition is stated as the logical fact
each mode independently establishes: "`anyComponentInside` only decides the outcome once **no proper
crossing exists between source and target** — established by `ProperCrossingQuery` returning false for
`VolumeOverlapQuery`, and by `ContainmentModeQuery`'s own two-stage negative for `containment`, which has
no `ProperCrossingQuery` term ahead of it" (2065–2069). Then: "closed manifold component → the guarantee
holds … non-manifold or open component → sampling is best-effort, and the component is flagged"
(2082–2083). Flagging follows whichever component decided the outcome, **in either direction** (2085–2105).

## 3.6 Solid model (1510–1555)

- **Target interior = even-odd (parity) over its entire triangle set** (1517–1519). Justification: hollow
  solids / pipe bores (1521–1526). Stated limitation: two genuinely nested independent solids read the
  inner region as cavity (1528–1535).
- **A source geometry contributes as the union of its components** (1537–1541) — "union semantics on the
  source side and even-odd on the target side, and that asymmetry is intentional".
- **"Only closed components can establish positive volume."** An open shell's vertices reading `inside`
  proves **containment**, not **overlap** (1543–1544).
- Vertex welding is a required normalization step, not optional repair (1607–1620); `weldEpsilon =
  1e-4 m / model.getUnitScale()`, falling back to `1e-4` (1638–1640).

## 3.7 `classifyPoint` (2001–2058)

Three-valued `'inside' | 'outside' | 'boundary'` (2004). Two layers deliberately kept distinct so the
guarantee isn't circular (2001–2013): `ProperCrossingQuery` uses only `classifyPoint`; `anyComponentInside`
is called by `VolumeOverlapQuery` "(only *after* `ProperCrossingQuery` has returned false)" and by
`ContainmentModeQuery` directly (2006–2010).

1. **Surface-proximity pre-check** — `closestPointToPoint`; ≤ `surfaceEpsilon` → `boundary` immediately
   (2023–2027).
2. **Parity test** in the target BVH's own local space: `THREE.DoubleSide` explicitly (2029–2030);
   **generic non-axis-aligned local-frame directions**, three of them tried in order (2031–2041); sort hits
   by distance **then** collapse runs closer than `mergeDistance` (2042–2045); barycentric edge/vertex
   graze → retry next direction, all three graze → `boundary` (2046–2053); otherwise odd → `inside`, even →
   `outside` (2054–2058).

## 3.8 `SurfaceCrossingWitness` (2306–2353)

Probes **within the source triangle's own plane** and classifies **against the target only** (2306–2314).
`δ ∈ crossingProbeFractions × dAvail` (`[0.5, 0.1, 0.01]`, per-candidate, recomputed rather than cached)
(2311–2324). If no rung both stays inside the triangle and clears `surfaceEpsilon` → **inconclusive, not a
rejected witness** → `inconclusive-crossing` (2326–2331). "It therefore never parity-tests the source,
which is exactly what lets `containment` accept open sources while `volume-overlap` cannot" (2336–2339).

**Scheduling class (changed since v5): its own `bvhcast`-native traversal** (2339–2353). "each
`intersectsTriangles` callback is one raw candidate pair and increments a traversal-local
`candidatePairsExamined` counter before any coplanarity or intersection test, aborting the traversal past
`maxCandidatePairsExamined = 50_000`; a confirmed non-coplanar intersection that enters the probe ladder
also consumes `maxCrossingPairsExamined = 64`. At most six probes per confirmed pair … Being
`bvhcast`-native, this traversal cannot `await`, yield, or resume: the shared elapsed-time accumulator is
checked at callback entry and immediately before every probe, and exceeding either count ceiling or
`frameBudgetMs` sets a traversal-local `aborted` flag and returns `true` from the callback — inspected
after `bvhcast` returns, exactly as `ProperCrossingQuery`'s own abort protocol works, producing a diagnosed
negative with `crossing-budget-exhausted` rather than a witness. The outer `CollisionWorld` checkpoint may
still yield afterward." See §1.5 site 13 for the `[CONTRADICTION]` this raises about which clock it reads.

---

# 4. Synchronous-work / budget model

> **This is the system Round 22 rewrote.** §4.3–§4.6 state precisely what the current text now claims, so a
> downstream auditor can check every other passage against it. §4.7 records where the superseded wording
> survives and where it does not.

## 4.1 Where the model lives

Four passages carry it, and they must agree:
1. **`ThreeMeshBvhBackend`/`BlasCache`**'s per-phase-checkpoint claim, 1254–1290 (the "**Round 22
   correction:**" paragraph is 1278–1290).
2. The **atomic-operations table**, 1845–1857 (11 rows) plus its trailing notes 1859–1869.
3. **"Atomic operations and what remains non-preemptible"** + the Round-22 re-derivation, 1871–1999.
4. The **performance gate** pass criteria, 4177–4266.

## 4.2 The atomic-operations table (1845–1857) — extracted

| Row | Value | Measured/reasoned | What it bounds |
|---|---|---|---|
| `maxSyncTriangleCount` — compaction + welding phase | `12_000` | **Measured** (R15, weld only): ~16.8ms @ ~19,800 tri; compaction's own cost unmeasured | non-preemptible; against the compacted active-range set only; own checkpoint before it starts (1847) |
| `maxSyncTriangleCount` — connectivity phase | `12_000` | **Measured** (R15): ~6.9ms @ ~19,800 tri | non-preemptible; lazy; runs for `containment` **or** `volume-overlap`; never for `surface-intersection`-only (1848) |
| `maxSyncTriangleCount` — BVH phase | `12_000` | **Measured**: ~16ms @ 18k tri | non-preemptible; the one phase every mode needs (1849) |
| `maxCandidatePairsExamined` | `50_000` | **Measured**: ~0.3µs/pair | raw `bvhcast` candidate rejection, checked at callback entry (1850) |
| one probe / one `classifyPoint` | — | **Reasoned, not yet measured** | checked before every occurrence (1851) |
| `maxFragmentsPerDbId` | `5_000` (provisional) | **Reasoned, not measured** | **cumulative work across the walk only**, via early termination *between* nodes (1852) |
| one `enumNodeFragments(node, cb, false)` call | **— (no ceiling; accepted atomic risk, flagged for re-derivation)** | reasoned; R18 correction: R17's justification factually wrong | non-preemptible; "unbounded **by choice of scope, not by API limitation**"; follow-up required (1853) |
| `maxChildrenPerNode` | `10_000` (provisional) | **Reasoned, deliberately not derived from any existing measurement**; ~0.3µs bvhcast figure explicitly **not** borrowed as a proxy | **enforced by exactly one mechanism** — the in-callback abort; `getChildCount` "removed from this enforcement path entirely — it is never called here, for any node shape"; caps one call at `maxChildrenPerNode + 1` callbacks. "**This spec does not claim `10_000` callbacks fit inside `frameBudgetMs`**" (1854) |
| `maxBroadPhaseInstancePairs` | `1_000_000` (provisional) | **Reasoned, not measured**: one AABB test O(µs) | pre-scan rejection via overflow-safe division; **R18: bounds work not span** (~1,000ms at the ceiling, ~60× the gate's ~16ms); checks `frameBudgetMs` before **each individual instance pair**, yielding and resuming — "cooperatively yieldable"; ceiling retained unlowered, also bounding candidate-list memory (1855) |
| `releaseEpochScopedState`'s (and `dispose()`'s equivalent) per-epoch registry sweep | **— (no ceiling; accepted atomic risk)** | **"Unmeasured, uncategorized in this table until this pass."** Grew from "drop some map entries" (R15) into a per-entry enumerative pass with per-entry cancellation-signal rejection (R18 C3) and an oversized-marking carve-out (R20) | **"Non-preemptible, same category as one `enumNodeFragments` call and the three `maxSyncTriangleCount` phases."** Runs inside the Viewer's uncaught-throw-sensitive `BEFORE_MODEL_UNLOAD_EVENT`/`dispose()` call frames; **"enumerating every `GeometryRegistry` entry filed under one epoch"**; "cost scales with the number of live entries under that epoch, which nothing in this design ceilings. No checkpoint exists inside it — it is required to be non-throwing …, not preemptible." (1856) |
| **`maxCollisionInstancesPerEpoch`** — **new since v5** | **provisional, value not yet chosen** | **Reasoned, not yet measured.** "A synchronous size comparison against a bucket's current count is O(1) per affected epoch; the check itself is cheap. What is unmeasured is the **retention** this ceiling accepts": a resident canonical instance is never individually evicted while its epoch stays live, "so retained memory for a long-lived epoch grows monotonically toward this ceiling and stays there" | Rejects the whole `findClashes` call, before any bucket changes or broad-/narrow-phase work starts, if publishing the call's missing instances would push any affected epoch's bucket over the limit — "checked once per call, synchronously, with no intervening `await` between the check and committing every missing instance, so two concurrent calls cannot both pass against the same stale capacity observation." Bounds worst-case retained **count**, not **bytes** (1857) |

Other constants not in the table: `maxCrossingPairsExamined = 64` (1766), `maxContainmentSamples = 512`
(2203), `samplesPerComponent = 8` (2151), `maxWitnessTriangles = 8` (2165), `frameBudgetMs = 8`
(2380, 2766–2767).

`[AMBIGUOUS]` — **the sweep row's cost model (1856) still describes only the `GeometryRegistry` half.** It
says the sweep enumerates "every `GeometryRegistry` entry filed under one epoch" and that "cost scales with
the number of live entries under that epoch". Since Round 21's self-correction, `releaseEpochScopedState`
also performs a **second, independent** operation over a different keyspace — deleting the outgoing epoch's
`CollisionInstance` bucket (2912–2915), a keyspace the document explicitly calls "a strict superset of the
registry's lazily-built candidate-pair keyspace" (1227–1228, 2913–2915). Neither the row nor the
worst-case-span exclusion (1961–1972) accounts for that second operation's cost.

## 4.3 The three composition-tier bullets, as the current text states them (1871–1927)

The section opens by naming the tiers it is about to give (1871–1874). The bullets are:

**(a) "A per-atomic-operation ceiling"** (1876–1896). Names the three build phases as the primitives with
no internal checkpoint possible, then carries the **Round 22 correction verbatim**:

> "**Round 22 correction:** that per-phase checkpoint is not a guaranteed yield — it is the same
> conditional, shared-`frameBudgetMs`-accumulator check every other checkpoint in this design uses (see the
> cooperative-composition bullet immediately below and `bvhcast`'s clock-basis passage under
> `ProperCrossingQuery`'s budgets, the one documented exception). It yields only when the accumulator is
> already due. A phase whose checkpoint finds the accumulator not yet due runs immediately, in the same
> span as whatever cooperative work already accumulated — see the corrected worst-case-span formula below
> for what that composes to. **Through Round 21 this passage read 'each phase either *is* the whole span …
> or doesn't share a span with meaningful other work,' which stated the opposite of the conditional rule
> this document states explicitly elsewhere.**" (1883–1891)

The bullet closes by re-stating that every *other* atomic primitive (one raycast, one proximity check, one
`classifyPoint` call, one probe) "is expected to be a small fraction of a frame, but that expectation is
**reasoned, not measured**" (1892–1896).

**(b) "An abort-only ceiling"** (1897–1907) — **new in Round 22.** Verbatim:

> "for the two `bvhcast`-native traversals (`ProperCrossingQuery`'s `intersectsTriangles`,
> `SurfaceCrossingWitness`; see `ProperCrossingQuery`'s budgets above for the full derivation). A `bvhcast`
> traversal cannot pause and resume once started, so its ceiling is enforced by permanently aborting it
> rather than by a checkpoint inside it, and its **own** duration is self-bounded independent of what ran
> before it — a private, traversal-local clock, deliberately not the shared accumulator (see the
> clock-basis passage), worst case ~2×`frameBudgetMs`. But the checkpoint that decides *whether to start*
> that traversal at all — the ordinary pair/stage checkpoint under **`CollisionWorld`** — is the same
> conditional, shared-accumulator check as the build-phase bullet above, not a guaranteed yield. A
> `bvhcast` traversal's self-bound describes its own cost once started, not the full span it can end up
> part of — the same composition gap as the build phases, folded into the same corrected formula below."

**(c) "A cooperative-composition ceiling"** (1908–1927) — what `frameBudgetMs` actually bounds. Round
10/11/15/18 checkpoint history, then the **load-bearing general rule**, verbatim:

> "**Every checkpoint named in this document — the build-phase checkpoints and the `bvhcast`-entry
> checkpoints included — is this same mechanism**, except `bvhcast`'s own internal abort clock once a
> traversal is already under way. A checkpoint that finds the accumulator not yet due does not yield at
> all; it lets whatever non-preemptible or abort-only unit follows it run to completion in the same span."
> (1923–1927)

**How to read the taxonomy — important for downstream auditing.** Round 22's *working record*
(`round-22-h2-derivation-pass-disposition.md`, lines 20–39) enumerates a **four-class** scheduling taxonomy.
The *normative design text does not*. What the design text actually asserts is: **three named bounded tiers
— cooperatively composed small operations (bullet c, 1908–1927), enforceably bounded non-preemptible units
(bullet a, 1876–1896), and abort-only native traversals (bullet b, 1897–1907) — and, separately, two
ceiling-less accepted non-preemptible atomic risks that are excluded from both the formula and from any
finite whole-design guarantee.** The excluded class is *not* a fourth coequal bullet: it appears only (i) as
two rows of the atomic-operations table (1853, 1856), and (ii) in the exclusion paragraph at 1961–1972. The
per-tier derivation at 1940–1952 likewise enumerates only three tiers — in the order cooperative,
enforceably-bounded, abort-only — and does not list the excluded class. An auditor checking a passage
against "the taxonomy" should expect **three in-formula tiers plus one separately-stated excluded class**,
and should not treat the disposition doc's four-class framing as if the design text asserted it.

**Two measurement-status qualifications the formula's own text attaches, easy to drop when paraphrasing:**
- The cooperative tier's addend is called "sub-millisecond and negligible relative to `frameBudgetMs`"
  (1941–1942), but bullet (a) explicitly says of exactly those primitives that "that expectation is
  **reasoned, not measured** … This spec does not claim it as fact; the performance gate below is now
  required to measure it before this guarantee can be called verified rather than designed" (1892–1896).
  "Negligible" is a designed expectation, not a verified fact.
- The **≈24ms** figure is stated "at the measured weld/`bvhcast` figures" (4181) — i.e. it is derived from
  welding's ~16.8ms and `bvhcast`'s ~2×`frameBudgetMs`. The other member of the enforceably-bounded tier,
  the `maxChildrenPerNode`-capped `enumNodeChildren` call (1944–1946), has **no measured cost at all**:
  "**This spec does not claim `10_000` callbacks fit inside `frameBudgetMs`**; that remains unmeasured, and
  the gate is required to measure it" (1854, and gate criterion 7 at 4227–4239). The ≈24ms bound therefore
  does not cover that tier member empirically.

## 4.4 The corrected worst-case-span formula (1929–1959)

The formula's own sentence, verbatim (1929–1933):

> "**Round 22 re-derivation (closing `invariant-audit-v5.md`'s H2): the worst-case single synchronous span
> is `frameBudgetMs + [worst-case cost of the one non-preemptible or abort-only atomic unit, if any, that
> immediately follows a checkpoint which found the accumulator not yet due]`, not the two-term
> `max(frameBudgetMs + one small atomic operation's cost, one build-phase's own cost)` this section stated
> through Round 21.**"

Why the old form was wrong, as the text puts it: "That prior formula's second term treated entering a build
phase (or a `bvhcast` traversal) as if it always started a fresh span — the same 'checkpoint always yields'
premise the two bullets above now name as false for every checkpoint in this design" (1933–1935).

Per-tier addends (1940–1952):

| Tier | Addend | Composed span |
|---|---|---|
| cooperatively-yieldable (one raycast, one proximity check, one `classifyPoint` call, one probe, **one AABB test**) | one small atomic operation's own cost, "sub-millisecond and negligible relative to `frameBudgetMs`" — "This part of the prior formula's first term was correct and stays" | ≈ `frameBudgetMs` |
| enforceably-bounded, non-preemptible (the three `maxSyncTriangleCount` build phases; **the `maxChildrenPerNode`-capped `enumNodeChildren` call**) | "that unit's own worst-case cost — measured at ~16.8ms for welding, the largest of the three, at the sync-triangle ceiling" | **`frameBudgetMs` (8) + 16.8 ≈ 24ms**, "not the ≈16ms this section stated through Round 21 — about 1.5× larger, because the prior figure silently dropped the `frameBudgetMs` prefix" |
| abort-only (a `bvhcast` traversal) | "that traversal's own self-bounded worst case, ~2×`frameBudgetMs` (~16ms, independently derived under `ProperCrossingQuery`'s budgets and unchanged by this re-derivation)" | **`frameBudgetMs` + ~2×`frameBudgetMs` ≈ 24ms** |

**The only-one-unit argument (1954–1959), verbatim:**

> "Only *one* such non-preemptible or abort-only unit can ever be the one absorbing prior undischarged work
> in a given span: any build phase or traversal at or near this ceiling already costs more than
> `frameBudgetMs` on its own, so the very next checkpoint immediately after it finds the accumulator
> already overdue and does yield. A multi-phase build's *total* wall-clock cost (still up to roughly 3× one
> phase's ceiling — see **`ThreeMeshBvhBackend`/`BlasCache`**, unchanged by this re-derivation) is not
> itself one synchronous span; only its first phase's span can absorb the extra `frameBudgetMs`."

## 4.5 The two ceiling-less exclusions (1961–1972)

Verbatim:

> "**This corrected formula is still not a finite worst-case-span guarantee for the whole design, and Round
> 22 does not claim it is one** — for the same reason this section already gave through Round 21: the table
> above deliberately contains rows with no ceiling at all — one non-recursive
> `enumNodeFragments(node, cb, false)` call, and `releaseEpochScopedState`/`dispose()`'s own per-epoch
> registry sweep (see the atomic-operations table), for which **this spec claims no bound and accepts the
> cost as a Milestone-1 risk**. Both rows, and the `enumNodeFragments` atomic risk rounds 16 and 17 tracked
> more generally, are **explicitly excluded from the formula above and from any finite worst-case-span
> guarantee this spec makes.** A model in which one node directly owns a pathological fragment count, or
> one epoch accumulates a pathological number of live `GeometryRegistry` entries, can produce a single
> synchronous span longer than the formula's value by a margin this spec does not state, because it does
> not know it; the performance gate is required to measure it rather than assume it away."

**What the formula *does* bound (1974–1983)** — the list was extended by Round 22 to include the two
traversals: "the three `maxSyncTriangleCount` build phases, the `maxChildrenPerNode`-capped
`enumNodeChildren` call, **the two `bvhcast`-native traversals' own self-bounded worst case**, the
now-chunked broad-phase scan, and the per-primitive checkpoints above. Even over those it is only as good
as the table's unmeasured rows."

**The `ThreeMeshBvhBackend`/`BlasCache` mirror of the same claim (1278–1290), verbatim:**

> "**Round 22 correction:** each phase's checkpoint (disposed, then model epoch — see 'Race safety') is the
> same conditional, shared-`frameBudgetMs`-accumulator check every other checkpoint in this design uses …
> and it yields only when the accumulator is already due, not unconditionally (see the worst-case-span
> formula under `ProperCrossingQuery`'s budgets). So the *first* phase whose checkpoint finds the
> accumulator not yet due can still share one uninterrupted synchronous span with up to `frameBudgetMs` of
> prior work — only every phase *after* it is guaranteed a checkpoint that actually yields, because that
> first phase's own cost alone already exceeds `frameBudgetMs`. See the corrected formula for what that
> composes to (≈24ms, not the ≈16ms a per-phase-only reading of 'own checkpoint' implied through Round 21).
> The per-phase discipline still does what it was introduced for — the three phases never compound *with
> each other* in one span — it just doesn't also guarantee a fresh span relative to whatever cooperative
> work preceded the first one."

## 4.6 The performance gate (4162–4275)

One `volume-overlap` query against an MEP-scale model, run **twice** (cold, then cache-warm) (4162–4167).
Pass criteria (4177–4266):

1. **Round-22 rewritten criterion (4179–4190), verbatim on the load-bearing clause:** "no single
   synchronous task exceeds the corrected worst-case-span bound established under `ProperCrossingQuery`'s
   budgets — `frameBudgetMs` plus one non-preemptible or abort-only atomic unit's own worst-case cost,
   **≈24ms** at the measured weld/`bvhcast` figures, not the ≈16ms this criterion stated through Round 21
   (which omitted the `frameBudgetMs` prefix a conditional checkpoint can let a phase or traversal inherit
   — see the Round 22 re-derivation) — measured on **both** runs, **except the two synchronous spans this
   spec explicitly excludes from any worst-case-span guarantee** — one `enumNodeFragments(node, cb, false)`
   call and `releaseEpochScopedState`/`dispose()`'s own per-epoch registry sweep … — for which a
   measurement above the band is a required recorded finding, not a gate failure; a measurement above the
   corrected bound on any other synchronous task **is** a gate failure." The two exceptions match exactly
   the two rows §4.5 excludes — no new exception is invented. Note the criterion mixes vocabulary: it
   states a "corrected … bound" but still calls a measurement above it "above the **band**" once.
2. any budget that trips does so with the correct diagnostic (4191–4192);
3. measured per-candidate and per-build costs recorded next to `measure.mjs`'s synthetic figures
   (4193–4194);
4. **one `classifyPoint` call and one crossing probe measured directly** (4195–4202);
5. **each of the three build phases measured individually at `maxSyncTriangleCount`** — and a
   connectivity-measuring cold run must be distinguished from a `surface-intersection`-only run
   (4203–4212);
6. extraction cost for the largest single dbId, **and** the broad-phase scan's **longest uninterrupted
   span** between yields (not just total), plus the cost of one `performance.now()` read relative to one
   AABB test, plus the candidate-list size at the ceiling (4213–4226);
7. **one `enumNodeChildren` call at the fanout ceiling** — `maxChildrenPerNode + 1` invocations on the
   widest node, **and an assertion that the abort actually fires** (4227–4239);
8. **one `enumNodeFragments(node, cb, false)` call** on the node owning the most fragments (4240–4247);
9. **the per-epoch registry sweep is measured** "at a `GeometryRegistry` populated with as many live
   entries under one epoch as the model actually produces … Measure the sweep triggered from **both**
   `world.evictModel` (mid-session eviction) **and** `world.dispose()` (whole-world teardown)" (4248–4256);
10. **NEW since v5: the `CollisionInstance` identity cache's retained size, per epoch, measured across a
    realistic session** — "repeated `findClashes` calls against a long-lived model, not a single call" —
    because "this cache's resident count only grows while its epoch stays live … so the number that matters
    is the *steady-state ceiling* a realistic query pattern reaches over a session, not one call's marginal
    cost." Record the bucket size after the model's full unique-fragment population has been queried at
    least once, and whether `maxCollisionInstancesPerEpoch` needs to sit meaningfully above it
    (4257–4266).

For (7), (8), (9) and (10) alike: a model/session that cannot exercise the case "cannot exercise this at
all — recording that limitation is itself a gate finding, not a pass" (4238–4239, 4245–4247, 4254–4256,
4264–4266).

`maxSyncTriangleCount`'s `12_000` "specifically remains provisional until it has [run]" (4271).

`[SILENT]` — the gate still does **not** list measuring the extraction walk's per-sibling-node
`frameBudgetMs` checkpoint (site 3 in §1.5), nor `SurfaceCrossingWitness`'s own traversal span (criterion 1
covers "any synchronous task" generically, but no criterion names this traversal the way criteria 7/8/9
name their targets).

## 4.7 Superseded-wording residue check (for downstream auditors)

Reference sweep of the current file for the forms Round 22 replaced:

- **The `max(...)` formula.** The literal string `max(frameBudgetMs` occurs at exactly **two** lines — 736
  (inside Round 22's own changelog entry, describing what the formula *used to* say) and 1932 (inside the
  re-derivation, naming the superseded form it replaces). Both are explicitly retrospective. **No live
  claim states the `max(...)` form.**
- **"Checkpoint always yields" framing.** Both sites that carried it are annotated in place: 1883–1891
  ("Through Round 21 this passage read 'each phase either *is* the whole span …'") and 1278–1290. The
  general rule now states the opposite at 1923–1927.
- **`≈16ms` as a live bound.** Round 22 rewrote the gate criterion (4179–4190). Remaining `~16ms` mentions
  are: 1839 (BVH build measured at ~16ms — a *cost*, not a span bound); 1849 (same, table); 1797–1798
  (`bvhcast`'s self-bound "sits within … the performance gate's own ~16ms tolerance band" — **stale
  reference to the pre-Round-22 gate wording**, see §3.4); 1855 (`maxBroadPhaseInstancePairs` row: "~60×
  the gate's own ~16ms" — likewise a pre-Round-22 gate reference); 2699 (Data Flow's broad-phase paragraph:
  "about **60× the performance gate's own ~16ms pass criterion**" — same); 4219 (gate criterion 6: "a total
  wall-clock figure says nothing about the ~16ms criterion" — a **live gate sentence still naming the
  ~16ms criterion Round 22 replaced in criterion 1**). `[CONTRADICTION]` — 4219 and 4179–4190 are in the
  same list.
- **`frameBudgetMs = 8`** is stated at 2380 and 2766–2767 and is unchanged.
- **The budget section's closing "same clock" sentence (1995–1999) was not touched by Round 22** and is
  reproduced verbatim in §1.5. It predates both the private-clock exception and the Round-22 rewrite; this
  model records it without interpreting what "the same clock" denotes.

---

# 5. Cache ownership / cleanup

## 5.1 Inventory

| Cache | Key | Owner | Cited |
|---|---|---|---|
| `GeometryRegistry` | `(loadEpoch, geometryIndex)` | `CollisionWorld` | 1173–1176, 2930–2932, 3136–3143 |
| `BlasCache` | behind the registry entry's `accelerationPromise` slot | `CollisionWorld`; **"owns no dedup mechanism of its own"** | 1308–1311, 1420–1429 |
| `GeometryConnectivity` decomposition | per unique `GeometryRecord`, cached alongside the BLAS | `CollisionWorld` | 1648–1652, 2129–2130 |
| `L_X` tolerance scale | per `GeometryRecord`, "cached with the BLAS" | `CollisionWorld` | 1470–1472 |
| **`CollisionInstance` identity cache** — **redesigned since v5** | **`Map<loadEpoch, Map<fragmentId, CollisionInstance>>`** — physically partitioned by epoch, "not one flat map" | `CollisionWorld` | 1194–1239 |
| `modelLifecycle` | `Model` object identity (`WeakMap`) | `CollisionWorld` | 3059–3074 |
| `liveModelByModelId` | `modelId` | `CollisionWorld`; diagnostic only | 3075–3086 |
| room-dbId cache | `Map<Model, Promise<number[]>>`, **keyed by the exact `Model` object, not `model.id`** | **the extension**, not the world | 2431–2433, 2984–2986 |
| `geometry-too-large-for-sync-build` dedup store | unnamed | unnamed | 2741–2743 (`[SILENT]`) |
| `PlacedCollisionInstance` values | **not a cache** — call-local, never cached, never mutated | the individual `findClashes` call | 1208–1216 |

**The `CollisionInstance` identity cache (1194–1239), as the current text states it.** Four normative
paragraphs:

1. **Identity and immutability (1194–1206).** "`CollisionInstance`s are canonical, immutable identity
   objects cached per `(loadEpoch, fragmentId)` — mirroring `GeometryRegistry`'s epoch-based keying for the
   same race-safety reason … — so repeated `findClashes` calls against the same admitted `Model` object
   receive the **same object reference** for a given fragment, which the stale-eviction fixture … depends
   on. A `CollisionInstance` contains only its `fragmentId` and an immutable
   `GeometryIdentity { loadEpoch, geometryIndex }`; both the instance and its nested identity value are
   frozen after construction. **It contains no `Model`, `GeometryRecord`, BLAS, world matrix, world bounds,
   or other call-varying or mutable state** — geometry is resolved lazily through `GeometryRegistry` from
   the instance's `GeometryIdentity`, after the caller's normal disposed/epoch liveness check. … A cache hit
   returns the existing object unchanged — **no `findClashes` call ever writes through a cached
   `CollisionInstance`.**"
2. **Placement state is call-local, never cached (1208–1216).** "Each `findClashes` call builds fresh
   `PlacedCollisionInstance` values — `{ instance, worldMatrix, worldBounds }` — with newly owned matrix
   and bounds objects copied from `fragList.getWorldMatrix`/`getWorldBounds` during that call's extraction
   … Broad and narrow phases consume these placement values, never matrix or bounds fields off the
   canonical `CollisionInstance` (which has none). Source and target placement arrays are owned solely by
   their call and remain unchanged across its yields — this is what preserves the per-call snapshot
   guarantee under **Broad phase** unchanged: concurrent calls may share the same immutable `instance`
   reference while each holds its own independent transform snapshot, and neither call can overwrite state
   the other resumes with."
3. **Ownership and release are epoch-scoped, independent of `GeometryRegistry` (1218–1228).**
   "`world.evictModel`'s `releaseEpochScopedState` and `world.dispose`'s wholesale clear each release this
   cache **as an operation of their own** — deleting exactly the outgoing epoch's bucket (`evictModel`) or
   every bucket (`dispose`) — **not** derived from a `GeometryRegistry` scan, a geometry reference count, a
   numeric `modelId`, or `liveModelByModelId`… A delayed `evictModel(oldModel)` therefore cannot touch a
   newer object's different epoch bucket, satisfying the stale-eviction fixture without a
   `GeometryRegistry`-keyspace dependency this cache's own keyspace (built from **every collected
   fragment, a strict superset of `GeometryRegistry`'s lazily-built candidate-pair keyspace**) cannot
   honor."
4. **Retention is explicitly bounded (1230–1239).** `maxCollisionInstancesPerEpoch` (provisional,
   unmeasured). "After collecting a call's complete unique fragment-id set, but before constructing or
   publishing any missing instance, `findClashes` checks `currentBucketSize + uniqueMissingCount` against
   the limit for every affected epoch; exceeding it rejects the entire call before any bucket changes or
   broad-/narrow-phase work starts. Otherwise all missing instances are committed **without an intervening
   `await`**, so two concurrent calls cannot both pass against the same stale capacity observation. Entries
   are never individually evicted while their epoch remains live — doing so would break the
   stable-reference guarantee above — so capacity is recovered only by epoch eviction or whole-world
   disposal."

The Data Flow step-3 counterpart is at 2679–2686 (look up or create the canonical instance, then build a
fresh call-local `PlacedCollisionInstance`; capacity checked "before publishing any newly-created
instance"). The Broad-phase counterpart is at 2726–2735. `CollisionWorld`'s own facade line now says the
broad phase scans "`PlacedCollisionInstance.worldBounds`" (2375–2378).

`[AMBIGUOUS]` — **capacity-check ordering across two passages.** 1232–1235 says the check happens "After
collecting a call's complete unique fragment-id set, but **before constructing or publishing any missing
instance**", and that exceeding it "rejects the entire call **before any bucket changes or broad-/narrow-
phase work starts**". Data Flow step 3 (2684–2686) places it inside the per-fragment loop that already
constructs placements — "For each fragment this walk collected … look up or create the epoch's canonical
`CollisionInstance` …, then build a fresh, call-local `PlacedCollisionInstance` … **Before publishing any
newly-created instance**, check the affected epoch's `maxCollisionInstancesPerEpoch` capacity …; exceeding
it rejects the call before this step's cache/placement construction completes." The fixture (4030–4035)
asserts "no `PlacedCollisionInstance` is constructed for **any** fragment in the query", which matches
1232–1235's whole-set-first reading and not step 3's per-fragment-loop reading.

## 5.2 What each release path does

| Path | Registry | BLAS | Connectivity | `CollisionInstance` bucket | `liveModelByModelId` | `modelLifecycle` | room cache |
|---|---|---|---|---|---|---|---|
| `evictModel` (live object, not disposed) | sweeps + deletes every entry under that epoch, identity-guarded, incl. oversized markings (2910–2926) | dropped with each entry (2912) | dropped with each entry (2912) | **deleted as an independent operation over a different keyspace (2912–2915)** | deletes only if this object is still the occupant (2943–2946) | writes `{state:'evicted'}` unconditionally, **before** the release (2904–2906) | **untouched** — the handler drops it separately (2984–2986, 3269–3273) |
| `evictModel` (disposed world) | no-op | no-op | no-op | no-op | no-op | **no tombstone written** (2901) | still dropped by the handler unconditionally (2984–2986) |
| `evictModel` (already `'evicted'`) | no-op | no-op | no-op | no-op | no-op | no-op (2903) | — |
| `evictModel` (never admitted) | nothing to release (2906, 4078–4087) | — | — | — | — | writes `{state:'evicted'}` (2904–2905) | — |
| `dispose()` | wholesale clear, one operation (3016–3018) | wholesale clear | wholesale clear | **every bucket (1221–1223, 3016–3017)** | best-effort tombstone only (3028–3033) | best-effort, **not load-bearing** (3030–3033) | **never touched** (2984–2985, 3272–3273) |
| build-phase rejection | this entry only, synchronously, identity-guarded (1333–1341) | intermediate buffers discarded | — | — | — | — | — |
| room-search rejection | — | — | — | — | — | — | identity-guarded delete (2462–2467) |

## 5.3 Room-cache rejection semantics

**One rule, no exception** (2462–2467): "On rejection, the handler deletes that model object's cache entry
— guarded by identity, `if (roomCache.get(model) === thisPromise) roomCache.delete(model)` … **This
identity-guarded delete is unconditional: every rejection path in this mechanism uses it, with no
special-cased exception (see the invalid-lease branches below).**"

Invalid-lease branch of the **success** callback (2491–2519): reject **and** "apply the same
identity-guarded delete every rejection path in this mechanism uses … **no special-cased 'leave the cache
untouched' exception for this branch**" (2493–2495). Cause derivation: `isLeaseValid(lease)` first; on
`false`, call `world.isModelLive(model)` inside `try`/`catch` — a caught `WorldDisposedError` **is** the
rejection reason; otherwise `new ModelEvictedError(model.id)` (2500–2505). "Nothing can interleave between
the two calls — both are synchronous and there is no `await` between them" (2505–2507).

**Error** callback (2524–2532): "follows the same shape … Both callbacks use one mapping, and both apply
the identical identity-guarded delete-on-rejection rule … **there is no 'leave the cache untouched'
exception for either callback's invalid-lease branch. A design in which the two callbacks classify the same
invalid lease differently, or delete the cache entry in one but not the other, is a bug.**"

Valid branch: also checks `roomCache.get(model) === thisCall's own promise` before writing (2520–2523).

Admission-before-search: `const lease = world.admitModel(model)` is called synchronously on the cache-miss
path **before** `model.search`, and throws (never starting the search) if already tombstoned or if the
world is disposed (2485–2490).

Fixture pins deletion, not "untouched", for **both** callbacks (4102–4112). The phrase "leave the cache
untouched" survives only inside the two explicit disclaimers at 2495 and 2530.

`[SILENT]` — **no release path names the room cache.** `world.dispose()` "never touches it" (2984–2985,
3272–3273); `evictModel` does not touch it; the *handler* drops one object's entry. Nothing states what
happens to the room cache for models other than the one being unloaded when the extension is torn down
along a path where `unload()` step 3 does not run (see §1.8, hazard 2).

## 5.4 Consistency between release paths

`dispose()`'s clear is described **three** times. The three descriptions are not identical:

| # | Location | Signal-rejection wording | Oversized carve-out? | Names `CollisionInstance` cache? |
|---|---|---|---|---|
| A | `ThreeMeshBvhBackend`/`BlasCache` bullet, 1348–1351 | "reject that signal exactly once and drop the entry in the same step … unconditionally, for every entry they remove regardless of whether its `buildState` is `'building'` or `'ready'`" | **Yes** — 1359–1361 and 1368–1370 | n/a (registry-scoped statement) |
| B | `world.dispose()` TS comment, 3016–3028 | "**For every `'building'` or `'ready'` entry it removes**, the clear rejects that entry's cancellation signal … exactly once, in the same pass that drops the entry, identity-guarded" | **Yes** — 3026–3028 | **Yes** — 3016–3017 |
| C | **"`world.dispose()` is terminal" prose, 3210–3222** | "…and **rejects every in-flight build promise, exactly once**, on the same disposal call. … **and the clear rejects each entry's cancellation signal as it drops the entry.**" | **No** | **Yes — this is new since v5** (3212–3214 now names "the `CollisionInstance` identity cache") |

`[CONTRADICTION]` — **site C (line 3222) is the residual C-5 instance, unchanged.** "the clear **rejects
each entry's cancellation signal** as it drops the entry" is universally quantified over entries dropped,
and the wholesale clear drops oversized markings too (per 1368–1370 and 3026–3028). The *preceding* clause
at 3215 ("rejects every in-flight build promise") is arguably narrower and satisfiable, since an oversized
marking has no in-flight build — the problem is specifically the final clause at 3222, which shifts the
quantifier from *promises* to *entries*.

**v5's second `[CONTRADICTION]` at this site is now closed.** Site C's enumeration at 3212–3214 reads
"`GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity`, **and the `CollisionInstance`
identity cache** … — the entire cache, not a per-model sweep over `liveModelByModelId`", matching sites A/B
and the cache's own declaration.

Corresponding check on `evictModel`: `releaseEpochScopedState` is defined at 2910–2926 (carve-out present;
`CollisionInstance` bucket present as an explicitly *independent* operation) and named at 1221, 1349, 1368,
2906 (the pseudocode call site), 1856 (the atomic-ops row), 1964 (the span-formula exclusion), 3845 (a
fixture description), 4185 and 4248 (gate criteria). Of those, only 1856 restates what the sweep
enumerates, and it names only `GeometryRegistry` (see §4.2's `[AMBIGUOUS]`).

`[SILENT]` — no site states what `releaseEpochScopedState` or `dispose()` does about an oversized marking's
**`geometry-too-large-for-sync-build` diagnostic dedup record** (2741–2743), or whether removing the marking
mid-call could cause the same fragment to be re-diagnosed. The dedup mechanism's storage is never named.

`[AMBIGUOUS]` — `releaseEpochScopedState` "drops each one together with its **cached BLAS and cached
connectivity**" (2910–2912). For an oversized marking neither the BLAS nor the connectivity exists (no
phase ever started, 1365–1367), so both clauses are vacuous for that entry kind and the text does not say
so — unlike the signal, which *is* explicitly carved out. (v5's third sub-case is resolved: the
`CollisionInstance` clause is now stated as a separate operation over a separate keyspace, 2912–2915, not
as something dropped "together with" a geometry entry.)

`[AMBIGUOUS]` — the C-5 fixtures at 3854–3866 assert "**zero** calls attributable to the oversized
marking's entry" on "whatever mechanism rejects a cancellation signal". Since the design says the signal is
never *created* for such an entry (1365–1367), there is no object to attribute a call to; the fixture is
phrased against an implementation that might create one. Nothing in the normative text forbids an
implementation from creating an inert signal it never rejects.

## 5.5 Other cross-path consistency statements

- `GeometryRegistry` keys by `(loadEpoch, geometryIndex)` "**specifically so this step can never touch
  another object's state**" — which is why the epoch-scoped release "needs no occupancy check against
  `liveModelByModelId` the way round 13's interim fix did" (2930–2936, 3145–3151).
- `dispose()`'s wholesale clear "cannot suffer the same enumeration gap a per-model sweep can, because it
  never needs to identify *which* models were live in the first place" (3222–3224).
- The sweep can reach in-flight builds "at all only because a record is published to the registry when its
  build STARTS rather than when it completes" (2927–2930, 3215–3218).

## 5.6 The per-call snapshot guarantee, as now stated

v5's `[AMBIGUOUS]` about per-call snapshots vs. a cross-call mutable instance is **closed by construction**
in the current text. Both statements now agree:

- **Broad phase (2726–2735):** "the mid-scan suspension is safe only because **each
  `PlacedCollisionInstance`'s world matrix and world bounds are per-call, call-owned snapshots** — never
  fields on the shared, immutable `CollisionInstance` itself, which carries no transform state at all …
  copied out of `fragList.getWorldMatrix`/`getWorldBounds` **during extraction** …, and the candidate list
  is call-local — so a scan resuming after a yield cannot mix pre-yield and post-yield scene state, and two
  concurrent calls sharing the same canonical `CollisionInstance` reference never observe or mutate each
  other's placement snapshots."
- **`CollisionInstance` identity cache (1208–1216):** identical shape, stated from the cache's side.

Pinned by fixture 4021–4029 (two interleaved calls, transform mutated between them: same canonical instance
reference asserted, A's own placement snapshot asserted unchanged).

---

# 6. Cross-cutting observations from this extraction pass

1. **Round 22 landed at the three sites its disposition doc claims, plus its changelog entry.** Verified in
   the current text: `ThreeMeshBvhBackend`/`BlasCache` (1278–1290), the atomic-operations-and-composition
   section under `ProperCrossingQuery`'s budgets (1883–1891, 1897–1907, 1923–1927, 1929–1983), the
   performance gate's pass criterion (4179–4190), and a `### Round 22` Revision Notes entry (732–751).
2. **Round 22 introduced no new mechanism, constant, or fixture.** The two ceiling-less exclusions are
   textually identical in scope to Round 21's; the only new *content* in the formula section is the
   abort-only bullet (1897–1907) and the per-tier derivation (1940–1959).
3. **Five v5-model claims are stale against the current text and are not repeated here** — v5 recorded
   `bvhcast`'s clock as the shared accumulator, `SurfaceCrossingWitness` as a plain JS loop, the
   `CollisionInstance` cache as cross-call mutable with a `(loadEpoch, fragmentId)` flat keying subordinate
   to `GeometryRegistry`'s sweep, site C of `dispose()`'s clear as omitting that cache, and the
   `tearDown()` proviso as trailing. All five were changed by Round 21's own post-v5 self-correction pass.
4. **The load-bearing general rule for the whole budget system is one sentence: 1923–1927.** Every other
   scheduling claim in the document is checkable against it.
5. **Three residues of the pre-Round-22 `~16ms` bound survive in live prose** (1797–1798, 1855/2699, 4219),
   two of them referring to "the performance gate's own ~16ms" criterion that criterion 1 no longer states.
   Flagged in §4.7; not adjudicated here.
6. **The `bvhcast` clock basis is asserted two different ways for the two traversals** (§1.5 site 13,
   §3.4, §3.8): private/traversal-local for `ProperCrossingQuery` and for "the two `bvhcast`-native
   traversals" collectively (1783–1798, 1901–1902), shared-accumulator for `SurfaceCrossingWitness`
   specifically (2349).
7. **Deliberately-untouched items from prior rounds are all still present**: the residual C-5 site (3222),
   the intra-bullet signal tension (1342 vs. 1359), the compaction/gate ordering transposition (§2.4), the
   `>=`/`>` boundary (§2.4), the oversized-marking single-flight gap (§2.5), the connectivity trigger-point
   three-way ambiguity (§2.5), `referenceCount` (§2.1), the unannotated `getChildCount` preamble residue
   (§2.7), the room-cache release-path gap (§5.3), and the Status-header staleness (Reading note).
8. **The changelog's numbering is now five namespaces deep** (v1 "C4/C5", v2 "C-1…C-4", v3 "C-5", v4
   "H-*", v5 "H2"), and v5's "H2" is the first to appear in the normative text (1929).

---

# Appendix: candidate items for the audit pass

Every `[SILENT]` / `[AMBIGUOUS]` / `[CONTRADICTION]` marker placed above. No severity is assigned here.

1. `[SILENT]` — **Status header stale by five passes** (3–19): says "seventeen rounds", calls Round 18 the
   current pass, names only `invariant-audit-v1`/`v2`. (Reading note)
2. `[SILENT]` — **No `### Round 20` Revision Notes entry**; Rounds 7 and 8 likewise have none. (Reading
   note)
3. `[AMBIGUOUS]` — **Five finding-label namespaces in play** with no disambiguating convention; v5's "H2"
   now appears in normative text at 1929 as well as the changelog at 733/735. (Reading note)
4. `[CONTRADICTION]` — **`SurfaceCrossingWitness`'s clock basis (2349, "the shared elapsed-time
   accumulator") versus `ProperCrossingQuery`'s clock-basis passage (1783–1798, "the traversal's own
   start") and the abort-only bullet's collective claim about both traversals (1901–1902, "a private,
   traversal-local clock, deliberately not the shared accumulator").** (§1.5 site 13, §3.8)
5. `[AMBIGUOUS]` — **Intra-loop clock basis stated three ways**: bare "`performance.now()` is read before
   each individual probe" (1814–1815); bare "elapsed time" (2215–2216); and the budget section's closing
   sentence "Both mechanisms key off the same constant and **the same clock**" (1995–1999), whose "same
   clock" is left undefined and sits alongside the private-clock exception at 1783–1798 / 1901–1902.
   (§1.5)
6. `[SILENT]` — **No error class is named** for the `maxFragmentsPerDbId` / `maxChildrenPerNode` /
   `maxBroadPhaseInstancePairs` / **`maxCollisionInstancesPerEpoch`** call-level rejections (2599–2600,
   1854, 1857, 3434–3436), for a cross-model query (2556–2557, 3487–3489), or for "Invalid dbId" (3493).
   (§1.6)
7. `[SILENT]` — **`locateElementByRoom`'s model resolution** explicitly deferred to
   `review-comments-v12.md` (2436–2439). (§1.8)
8. `[SILENT]` — **`referenceCount` is named once** (1176) in normative text and never again; no
   increment/decrement/zero semantics. Line 1223 mentions "a geometry reference count" only to say the
   `CollisionInstance` release is *not* derived from one. (§2.1)
9. `[CONTRADICTION]` — **Intra-bullet signal-universality tension**: 1342–1343 "**Every registry entry**
   carries one entry-scoped cancellation signal" vs. 1359–1361 "defined **only for** `'building'`/`'ready'`
   entries — an oversized marking … never has one", with 1348–1351's mixed-quantifier clause between them.
   (§2.3)
10. `[CONTRADICTION]` — **Compaction/gate ordering transposition**: 1379–1380 "Before welding, **before the
    ceiling check**" vs. 1393–1396 "checked … **before any copying happens** … Only once that check passes
    does compaction actually copy". Fixture 3881–3885 pins the 1393 ordering. (§2.4)
11. `[CONTRADICTION]` — **`>=` vs `>` boundary**: 1434 "**at or above** that triangle count is not built"
    vs. 2739–2740 / 3413 / 1394 "**exceeds**". Fixture 3886–3891 (13,000 / 11,000) does not discriminate
    `12_000`. (§2.4)
12. `[AMBIGUOUS]` — **Connectivity trigger point**, three unreconciled timings: the state model explicitly
    declines to decide (1319–1322); Data Flow step 3 places it inline in the build sequence (2743–2746);
    fixture 3833–3838 has a caller driving it against an already-`'ready'` entry. (§2.5)
13. `[SILENT]` — **Whether an oversized marking participates in the "caller that finds an existing entry"
    lookup rule** (1308–1311) is unstated; 1363 implies the marking is consulted, 2736–2743 implies the
    ceiling check is re-run per pair. The `geometry-too-large-for-sync-build` dedup store (2741–2743) is
    never named. (§2.5)
14. `[SILENT]` — **Nothing states which code path creates the oversized marking, or when** (1394,
    1434–1437, 2739–2741 each describe a different actor/site without one being normative). (§2.5)
15. `[AMBIGUOUS]` — **One unannotated `getChildCount` present-tense residue survives**: Round 17's entry
    preamble at 496–498 ("returned without enumerating those children"), the exact claim C-1 refuted for a
    mixed node. The bullet at 505–512 *is* annotated. (§2.7)
16. `[AMBIGUOUS]` — **"Stage" names two nesting levels**: `anyComponentInside`'s stages 1/2/3 (2150–2165)
    vs. `ContainmentModeQuery`'s "both stages" / "stage 2" meaning its two composition terms (2355–2359),
    plus "own two-stage negative" at 2067–2068 and "Stage 2 added a third traversal" at 3763. (§3.3)
17. `[CONTRADICTION]` — **`bvhcast`'s self-bound cites a gate band that no longer exists**: 1797–1798 says
    ~2×`frameBudgetMs` "sits within, not beyond, the performance gate's own **~16ms** tolerance band", but
    the gate's criterion 1 (4179–4190) now states a **≈24ms** bound and no ~16ms band. (§3.4, §4.7)
18. `[AMBIGUOUS]` — **The sweep row's cost model (1856)** says the sweep enumerates "every
    `GeometryRegistry` entry filed under one epoch" and scales with that count, but
    `releaseEpochScopedState` also performs a second, independent deletion over the `CollisionInstance`
    cache's own keyspace — "a strict superset of `GeometryRegistry`'s" (1227–1228, 2912–2915). The
    worst-case-span exclusion (1961–1972) inherits the same omission. (§4.2)
19. `[CONTRADICTION]` — **Gate criterion 6 still names the superseded ~16ms criterion** (4219: "a total
    wall-clock figure says nothing about the ~16ms criterion") inside the same pass-criteria list whose
    criterion 1 (4179–4190) replaced ~16ms with ≈24ms. (§4.7)
20. **Pre-Round-22 `~16ms` gate references outside the gate**: 1855 (`maxBroadPhaseInstancePairs` row,
    "~60× the gate's own ~16ms") and 2699 ("about **60× the performance gate's own ~16ms pass
    criterion**"). Recorded for completeness; both are arithmetic comparisons against a figure the gate no
    longer states. (§4.7)
21. `[SILENT]` — **The performance gate does not require measuring** the extraction walk's
    per-sibling-node `frameBudgetMs` checkpoint (site 3 in §1.5), nor `SurfaceCrossingWitness`'s own
    traversal span by name. (§4.6)
22. `[CONTRADICTION]` — **Residual C-5 site at line 3222**, in the "`world.dispose()` is terminal" prose
    (3210–3222): "**the clear rejects each entry's cancellation signal as it drops the entry**" —
    universal over entries dropped, no oversized carve-out, in a clear that per 1368–1370 and 3026–3028
    also drops oversized markings. (§5.4)
23. `[SILENT]` — **Nothing states what the release paths do about the `geometry-too-large-for-sync-build`
    dedup record** when an oversized marking is swept, or whether a fragment could be re-diagnosed. (§5.4)
24. `[AMBIGUOUS]` — **`releaseEpochScopedState`'s "drops each one together with its cached BLAS and cached
    connectivity"** (2910–2912) is vacuous in both clauses for an oversized marking (1365–1367), and the
    text does not say so, unlike the signal which is explicitly carved out. (§5.4)
25. `[AMBIGUOUS]` — **The C-5 fixtures (3854–3866) assert "zero calls attributable to the oversized
    marking's entry"** on the signal-rejection mechanism, but the design says no signal is ever *created*
    for such an entry (1365–1367); the fixture would pass either way. (§5.4)
26. `[SILENT]` — **No release path owns the room cache** beyond the per-model handler drop: `dispose()`
    "never touches it" (2984–2985, 3272–3273), and nothing states what happens to entries for other models
    when `unload()`'s step 3 does not run (see §1.8 hazard 2). (§5.3)
27. `[AMBIGUOUS]` — **`maxCollisionInstancesPerEpoch`'s capacity-check ordering** is stated
    whole-set-before-any-construction at 1232–1235 and per-fragment-inside-the-loop at 2684–2686; the
    fixture (4030–4035) matches the first. (§5.1)
