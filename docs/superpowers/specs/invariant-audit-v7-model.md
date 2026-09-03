# Consolidated Invariant Model — Collision Library Milestone 1 (v7, post-Round-29)

**Target**: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`, **4712 lines**, read
sequentially and completely for this pass (2026-09-03). Every line citation below is from this read of the
current file, not carried over from `invariant-audit-v1…v6*.md`. The spec has changed materially since v6
(Rounds 24–29 landed as disposition docs with no changelog entries), so **no factual claim in v6's model was
reused** — only its section-structure convention.

## Scope and method

Pure extraction. No adjudication, no severity rating, no fix proposals. Five systems, extracted together
because the text itself cross-references them:

1. Model/world lifecycle
2. Geometry ownership / build pipeline
3. Query-mode semantics and dependencies
4. Synchronous-work / budget / scheduling
5. Cache ownership / cleanup / concurrency

Markers used:

- `[CONTRADICTION]` — two passages of the **current text** say incompatible things. Both are recorded.
- `[AMBIGUOUS]` — the text is under-determined; two readings survive a careful read.
- `[SILENT]` — the text says nothing on a point this model needs.

**Changelog vs. normative text.** The spec's `## Revision Notes (post-review)` section (lines 40–799) is a
historical changelog written in the past tense ("Round N found X, fixed by Y"). A changelog entry is **not**
an invariant. Where a changelog entry describes a fix, the invariant is whatever the *normative body*
(lines 801–4712, plus the Status header at 1–38) now says. This model cites the normative body throughout
and cites the changelog only where explicitly labelled `[changelog]`. The document itself uses an
"annotate, never rewrite" convention for superseded changelog claims (e.g. 330–334, 344–347, 410–412,
487–491, 528–534, 604–607, 719–721, 729–731, 772–777) — those annotations are also changelog, not
normative.

---

## Reading note — the document's own structure at this revision

| Lines | Section |
|---|---|
| 1–38 | Title / **Status header** (frozen at the Round 17→18 transition by the doc's own convention, 21–22; the "check `round-*-disposition.md` rather than trusting this paragraph" hedge is at 28–30) |
| 40–799 | **Revision Notes (post-review)** — Rounds 1–23 only. Sub-entries at 42 (R1), 55 (R2), 83 (R3), 112 (R4), 147 (R5), 179 (R6), 208 (R9), 240 (R10), 277 (R11), 311 (R12), 353 (R13), 383 (R14), 417 (R15), 460 (R16), 505 (R17), 554 (R18), 618 (R19), 676 (R21), 760 (R22), 786 (R23). **No R7, R8, R20, R24–R29 entries.** |
| 801–873 | Spike Findings (executable, `spike/`) — B-part findings 836–873 |
| 875–900 | Purpose |
| 902–921 | Background |
| 923–954 | Milestone Scope (cross-model exclusion 947–951) |
| 956–1069 | Architecture (runtime split, repo layout 985–1015, dependency pins 1020–1023, import map 1038–1044, welding's vendor entry 1049–1069) |
| 1071–1537 | **Components** — `ViewerModelAdapter` 1073–1139; `ViewerGeometryAdapter` 1141–1220 (layout table 1162–1166); `GeometryRegistry`/`GeometryIdentity` 1222–1244; **`CollisionInstance` identity cache 1246–1306**; `ThreeMeshBvhBackend`/`BlasCache` 1308–1537 (three-phase rule 1321–1366; publication rule 1367–1452; compaction/gate 1454–1485; owned-buffer 1487–1512; ceiling value 1514–1537) |
| 1539–1593 | Tolerances (table 1567–1576) |
| 1595–1640 | Solid model (even-odd declaration 1602–1620; source-union 1622–1626; closed-only-establishes-volume 1628–1629) |
| 1642–2549 | **Query modes and their preconditions** — mode table 1644–1648; containment's directedness 1650–1690; welding-required 1692–1731; `GeometryConnectivity` 1733–1756; `SurfaceIntersectionQuery` 1758–1783; `ProperCrossingQuery` 1785–2158 (**atomic-operations table 1940–1952**; tier taxonomy 1966–2047; **Round-22 worst-case-span re-derivation 2049–2138**); `ContainmentQuery` 2160–2403 (`classifyPoint` 2174–2217; `anyComponentInside` + guarantee 2219–2371; intra-loop checkpoint 2372–2403); `VolumeOverlapQuery` 2405–2441; `ContainmentModeQuery` 2443–2540 (`SurfaceCrossingWitness` 2472–2520); `CollisionWorld` 2542–2549 |
| 2551–2989 | **Data Flow — Room Locate Query** — step 1 2553–2710 (extension-lifetime gap 2562–2596; room cache 2598–2710); step 2 2711–2721; step 3 2722–2987 (entry order 2723–2729; extraction 2730–2849; capacity admission 2851–2883; broad phase 2884–2932; narrow phase 2933–2985; aggregation 2986–2987); step 4 2988–2989 |
| 2991–3626 | **Public API** — TS block 2993–3250 (`findClashes` 3000–3036; `admitModel` 3038–3056; `isLeaseValid` 3058–3091; `evictModel` 3093–3194; `isModelLive` 3196–3206; `dispose` 3208–3249); **"Race safety" prose 3252–3446**; `RoomLocatorExtension` sketch 3448–3498; diagnostics 3500–3626 (union 3510–3544; role tables 3554–3568, 3580–3584) |
| 3628–3793 | Error Handling & Edge Cases |
| 3795–4558 | Testing & Verification — unit 3797–4404; integration 4406–4417; **performance gate 4419–4558** (10 pass-criterion bullets at 4436, 4458, 4460, 4462, 4476, 4486, 4506, 4519, 4527, 4540) |
| 4560–4650 | Risks |
| 4652–4712 | Open Questions Deferred to Future Milestones |

### 0. Structural / header staleness (minor observation, not the main job)

- **0.1** Status line 3 still reads "revised after seventeen rounds of codex review"; lines 21–22 declare the
  paragraph deliberately frozen at the Round 17→18 transition and state "The changelog below (**Revision
  Notes**) continues through Round 23." That is accurate for the changelog (last entry: Round 23 at 786).
- **0.2** Lines 23–30 enumerate the post-Round-23 rounds as "at minimum Round 24 …, Round 25 …, Round 26 …,
  and Round 27 … as of this writing". **Rounds 28 and 29 now exist** (`round-28-query-medium-low-disposition.md`,
  `round-29-budget-scheduling-medium-low-disposition.md`) and are not named. The paragraph self-hedges this
  at 26–30 ("with further rounds likely to follow the same pattern … check `docs/superpowers/specs/round-*-disposition.md`
  for the full, current list rather than trusting this paragraph's enumeration to stay exhaustive"), so the
  staleness is disclosed rather than silent.
- **0.3** Numbering gaps at Rounds 7, 8, 20 are disclosed at 30–32 ("a numbering gap is not evidence of
  missing content"). Round 20 is pointed at only via 679 (`round-20-critical-fix-pass-disposition.md`).
- **0.4** Five different finding-label conventions are disclosed at 32–36; a bare label ("C-1", "H2",
  "H-B7") is scoped to its own audit document, not globally.
- **0.5** **An audit marker has leaked into normative body text.** Line 3684 reads: "…carrying no named
  error class, the same `[SILENT]` gap those three share." The literal string `[SILENT]` — an
  invariant-audit marker vocabulary item — now appears inside the spec's own Error Handling section as
  normative prose.

---

# 1. Model / world lifecycle

## 1.1 The two axes

The design carries two orthogonal liveness axes; every checkpoint consults them in a fixed order.

| Axis | State | Owner | Terminal? | Cited |
|---|---|---|---|---|
| **World** | `disposed: boolean`, false → true | `CollisionWorld` instance | yes, permanent | 3300–3302, 3208–3211, 3404–3408 |
| **Model** | `modelLifecycle` entry: absent → `{state:'live', epoch}` → `{state:'evicted'}` | per `Model` **object** | yes, permanent, never cleared or overwritten back to `'live'` | 3272–3287, 3279–3283 |

- **1.1.1** `disposed` is "the system's single authoritative liveness signal rather than one input among
  several" (3300–3302) and is "checked directly and first" at every site (3404–3408, 3419–3422).
- **1.1.2** Model liveness is keyed by **object identity**, never by `modelId` (3269–3271, 3093–3096,
  337–340 `[changelog]`). A `Model` object with **no** entry has never been admitted *or* evicted — "a
  legitimate first use, the only case `findClashes` treats as 'admit fresh'" (3280–3282).
- **1.1.3** A tombstone is permanent: "nothing re-admits it, ever, because nothing ever clears or
  overwrites it back to `'live'`" (3282–3283); "this exact object can never become live again in this
  world, even if `model.id` is later reused by a different object" (3113–3115).

## 1.2 World-owned lifecycle state (inventory)

| Name | Shape | Cited | Role |
|---|---|---|---|
| `modelLifecycle` | `WeakMap<Model, {state:'live';epoch:number} \| {state:'evicted'}>` | 3272–3287, 3102–3104 | authoritative per-object liveness; **deliberately non-enumerable** (3284–3287, 3395–3396) |
| `liveModelByModelId` | `Map<modelId, Model>` | 3288–3299 | **diagnostic/bookkeeping only** — "no correctness property in this design depends on this map's completeness anymore" (3293–3295); "best-effort updated for diagnostic/bookkeeping purposes only" (3444–3446) |
| `disposed` | `boolean` | 3300–3302 | world terminal flag |
| `nextLoadEpoch` | number counter, global to the `CollisionWorld` instance, only ever increments, never reset or scoped per `modelId` | 3303–3308 | `epoch = nextLoadEpoch++` on first admission; "a different `Model` object reusing a `modelId` still gets a strictly greater epoch than anything issued before it" (3306–3307) |

- **1.2.1** The `'evicted'` variant **carries no epoch at all**, "because nothing ever needs to compare one:
  every liveness/lease check short-circuits on `state !== 'live'` before it would ever read `.epoch`"
  (3102–3106, 3274–3279).
- **1.2.2** The `WeakMap` choice is load-bearing twice: it makes "permanent" free rather than a leak
  (3284–3286), **and** "nothing in this design may depend on being able to *enumerate* `modelLifecycle`"
  (3286–3287).

## 1.3 `ModelLease`

- **1.3.1** `admitModel(model)` returns `{ model, epoch }` — "an opaque capture of this exact object's
  current lifecycle state, valid until the object is evicted or the world is disposed" (3039–3040).
- **1.3.2** Idempotent: calling again for an already-live object "returns a lease with that same epoch (does
  not re-admit or reassign)" (3040–3041); pinned by fixture 4259–4261.
- **1.3.3** A lease "only exists for a model this call itself admitted, so the callback always finds either a
  still-valid lease or one invalidated by a real eviction/disposal in between" (2700–2702).

## 1.4 Public method contracts

### `world.admitModel(model): ModelLease` — 3038–3056

Synchronous. Three outcomes **checked in this order** (3041–3048):

1. world disposed → **throws** `WorldDisposedError`
2. this exact object tombstoned `'evicted'` → **throws** `ModelEvictedError`, immediately, without
   assigning a new epoch ("a model that was ever evicted can never be re-leased", 3044–3045)
3. otherwise → admits if not already admitted (`epoch = nextLoadEpoch++`, records `liveModelByModelId`,
   "same lazy-admission path `findClashes`'s entry check uses") and returns the (possibly pre-existing) lease

### `world.isLeaseValid(lease): boolean` — 3058–3091

- **1.4.1** "**Strictly non-throwing and total**: for any lease ever returned by `admitModel`, always returns
  a plain boolean, never throws" (3059–3060).
- **1.4.2** Pseudocode (3062–3064): `if (disposed) return false;` then
  `entry?.state === 'live' && entry.epoch === lease.epoch`. `disposed` is checked **first, directly**, "not
  by inferring it from `lease.model`'s own `modelLifecycle` entry" (3060–3062).
- **1.4.3** It is **one of the two deliberate exceptions** to "every public method throws
  `WorldDisposedError` once disposed" (3070–3074); `evictModel` is the other.
- **1.4.4** It deliberately **cannot say why** a lease is invalid; the caller derives that outside the
  predicate via `isModelLive` inside a `try`/`catch` (3080–3091, 2668–2678).

### `world.evictModel(model): void` — 3093–3194

Normative pseudocode (3107–3112):

```
if (disposed) return;                                  // no-op — NOT a throw
const previous = modelLifecycle.get(model);
if (previous?.state === 'evicted') return;             // idempotent no-op
modelLifecycle.set(model, { state: 'evicted' });       // unconditional
if (previous?.state === 'live') releaseEpochScopedState(previous.epoch);
```

- **1.4.5** "The tombstone write happens before the (conditional) state release, and is permanent either
  way" (3113–3115).
- **1.4.6** **`evictModel` is the design's SECOND deliberate non-throwing exception** (3161–3166). Three
  justifications "in descending order of force" (3166–3189): (1) a throw is **verifiably destructive to the
  Viewer** — `EventDispatcher.prototype.dispatchEvent` (`viewer3D.js:13300-13341`) invokes each listener as
  a bare `callbackFn.call(this, event)` with no try/catch; the event is dispatched as the *first* statement
  of `Viewer3DImpl.unloadModel` (`viewer3D.js:34052-34054`), called from the unguarded loop in
  `unloadCurrentModel` (`viewer3D.js:34253-34258`), so an uncaught throw aborts the Viewer's own multi-model
  teardown; (2) "there is nothing left for it to do" — `dispose()` already released everything; (3) "it is
  the branch this method already had" (the `'evicted'` no-op).
- **1.4.7** The disposal no-op is **silent** — "a diagnostic on it would fire on every normal teardown"
  (3190–3191).
- **1.4.8** **The extension-owned room cache is explicitly NOT covered by this no-op**: "`world.dispose()`
  never touches it … The handler must therefore drop that object's room-cache entry unconditionally,
  independent of what `evictModel` does" (3192–3194, 3489–3492).
- **1.4.9** `releaseEpochScopedState` is **required to be non-throwing** (3145–3150) — a version that could
  throw partway "would leave the tombstone written (correct, permanent) but the release incomplete and
  unretriable, since the now-`'evicted'` entry no longer carries the epoch a second attempt would need".
  Explicitly framed as "a state-release/cleanup completeness concern, not a liveness-correctness one".
- **1.4.10** `liveModelByModelId` deletion is occupancy-guarded: "If this object is still
  `liveModelByModelId`'s current entry for its `model.id`, that entry is also deleted" (3151–3154);
  "bookkeeping hygiene, not what makes the new object's state safe" (3784–3786).

### `world.isModelLive(model): boolean` — 3196–3206

- Checks `disposed` **first, directly** → **throws** `WorldDisposedError` before consulting
  `modelLifecycle` at all (3197–3199).
- Otherwise true iff this exact object has a `{state:'live'}` entry. **"Never seen before → false"**
  (3199–3200) — explicitly the *wrong* contract for a pre-admission gate (3203–3206).

### `world.dispose(): void` — 3208–3249

- **1.4.11** Sets `disposed` **first, synchronously, before anything else** (3209–3211, 3405–3408).
- **1.4.12** After it returns, "every public method on this world instance — `findClashes`, `admitModel`,
  `isModelLive`, a second `dispose()` — rejects or throws `WorldDisposedError`" (3212–3214), with the two
  documented exceptions (3215–3223).
- **1.4.13** Wholesale-clears **four** caches — `GeometryRegistry`, `BlasCache`, every cached
  `GeometryConnectivity`, and the `CollisionInstance` identity cache — "each in its own single clear
  operation, not a per-model sweep over `liveModelByModelId`" (3224–3227, 3429–3432).
- **1.4.14** The wholesale clear is **required to be non-throwing** for the same reason as
  `releaseEpochScopedState`, and because "a second `dispose()` call throws `WorldDisposedError` rather than
  retrying the clear" (3228–3231).
- **1.4.15** `dispose()` "**no longer needs to enumerate and tombstone every live model for correctness**,
  and this spec no longer claims it does" (3427–3429); it "best-effort tombstones whatever
  `liveModelByModelId` currently references, for diagnostic bookkeeping" (3241–3246).

### `world.findClashes(query)` entry contract — 2723–2729, 3001–3007, 3365–3373

Three steps, **in this exact order** (this is the Round-26 canonical statement; the round-12 changelog
entry at 326–334 is annotated as superseded):

1. `disposed` → reject `WorldDisposedError` "regardless of query contents, before this or any other check
   runs" (2723–2725, 3001–3002, 3366–3367).
2. `query.source.model !== query.target.model` → reject immediately, "**ahead of** the per-operand eviction
   checks and lazy admission … a structurally unsupported query is rejected before either operand is
   admitted or looked up, and **never mutates any lifecycle state**" (2726–2729, 3003–3004, 3367–3370).
3. Per operand: tombstoned `'evicted'` → reject `ModelEvictedError`; no entry at all → lazy admission
   (fresh epoch, `state:'live'`, recorded in `liveModelByModelId`) (3004–3007, 3370–3373).

- **1.4.16** The entry check "composes with, rather than replaces, the existing per-yield re-validation"
  (3375–3376).
- **1.4.17** A failure at entry **or** at any yield checkpoint "aborts the **entire** `findClashes` call …
  neither returns a partial or diagnosed `ClashResult`" (3383–3385). Explicitly "a different failure than
  anything the diagnostic system answers" (3386–3387).
- **1.4.18** `ModelEvictedError` "naming the evicted `modelId`" (3385); constructed as
  `new ModelEvictedError(model.id)` on the room-search path (2672).
  `[SILENT]` — **the current text never states a constructor signature or payload for `WorldDisposedError`**,
  and never states one for `ModelEvictedError` outside the room-search callback's single literal at 2672.

## 1.5 Checkpoint / yield sites and what each revalidates

The canonical enumeration is at 2962–2969; the two-part protocol is stated universally at 2039–2047 and
2982–2985.

| # | Site | Cited | Yield or abort-only | Revalidates |
|---|---|---|---|---|
| 1 | `findClashes` entry | 2723–2729, 3365–3373 | n/a (rejection only) | `disposed` → cross-model → per-operand tombstone/lazy-admit |
| 2 | before each requested dbId's extraction | 2730–2734, 2963–2964 | yield if due | two-part (universal rule, 2039–2047) |
| 3 | between sibling nodes of the extraction walk | 2801–2802, 2816–2818 | yield if due | stated as "a checkpoint against `frameBudgetMs`"; two-part inherited from 2039–2047 |
| 4 | before the broad-phase scan starts | 2964 | yield if due | two-part |
| 5 | **before each individual instance pair inside the broad-phase scan** | 2900–2906, 2965 | yield-and-**resume from exactly the `(sourceIndex, targetIndex)` it left off at** | explicit: "`disposed` first, then the model's load epoch" (2903–2905) |
| 6 | before starting each candidate pair (cached or not) | 2963 | yield if due | two-part |
| 7 | between each of a pair's composed sub-queries | 2965–2966 | yield if due | two-part |
| 8 | **before each build phase** (weld / connectivity / BVH) | 1339–1343, 1345–1352, 2944–2948 | yield **only if the accumulator is already due** (1347–1350) | `disposed` first, **then the liveness/epoch of the ONE model that owns this geometry** — the operand whose `loadEpoch` is in the record's key — **"and nothing else"** (1403–1406) |
| 9 | before each individual probe in `ProperCrossingQuery` | 1908–1915 | **abort-only** — `bvhcast` "cannot be paused and resumed mid-traversal" (1915–1918) | — sets `aborted`; diagnosed `crossing-budget-exhausted` |
| 10 | at `bvhcast` callback entry for raw candidates | 1911–1912, 1945 | abort-only | — |
| 11 | **before each individual `classifyPoint` call** in `anyComponentInside` sampling | 2378–2387 | yield-and-resume, **non-truncating** (2395–2397) | explicit: "`disposed` first and directly, then the model's load epoch" (2383–2385) |
| 12 | before each witness-triangle attempt (stage 3, `maxWitnessTriangles = 8`) | 2398–2401 | yield-and-resume, "same two-part revalidation on resume" | two-part |
| 13 | **inside `SurfaceCrossingWitness`** — callback entry and immediately before every probe | 2515–2519 | **abort-only** — "Being `bvhcast`-native, this traversal cannot `await`, yield, or resume" (2515) | — sets a traversal-local `aborted` flag; `crossing-budget-exhausted` |

- **1.5.1** The two-part revalidation is stated as **unconditional**, independent of whether the yield fires:
  "The two-part lifecycle revalidation every checkpoint carries — `disposed` first, then the model's load
  epoch … runs whenever a checkpoint is reached, accumulator-due or not; **it is never itself skipped**"
  (2039–2041). And on resume it runs *again*: "When a checkpoint's `await` does fire — including an `await`
  on a shared build-phase slot, not only the accumulator-driven scheduling yield — the two-part
  revalidation runs again immediately on resume, in addition to the one that already ran when the
  checkpoint was reached" (2041–2044).
- **1.5.2** `[SILENT]` — **the abort-only sites (#9, #10, #13) are never said to perform the two-part
  lifecycle revalidation.** Their passages describe only the elapsed-time/count triggers and the `aborted`
  flag (1908–1920, 2515–2520). Yet 2034–2035 asserts "**Every checkpoint named in this document — the
  build-phase checkpoints and the `bvhcast`-entry checkpoints included — is this same mechanism**, except
  `bvhcast`'s own internal abort clock once a traversal is already under way", and 2039–2041 asserts the
  revalidation is never skipped at any checkpoint. Whether a synchronous native `bvhcast` callback performs
  (and can act on) a `disposed`/epoch check is not stated anywhere.
- **1.5.3** Naming disclaimer: "This document's other names for these sites ('every per-yield checkpoint',
  'every yield point', 'a yield-and-revalidate checkpoint', 'its next yield checkpoint') predate this
  conditional-yield correction and denote this same mechanism; they are historical naming, not a claim that
  every checkpoint yields" (2044–2047).

## 1.6 Error types

| Error | Raised by | Cited |
|---|---|---|
| `WorldDisposedError` | `admitModel` (3043), `isModelLive` (3197–3198), `findClashes` entry + every checkpoint (3366–3367, 3384, 3758–3759), a second `dispose()` (3213, 3474–3476), room-search callbacks via the disposed-first mapping (2666–2680), `locateElementByRoom` (3493–3495) | throughout |
| `ModelEvictedError` | `admitModel` on a tombstoned object (3044), `findClashes` entry + yield checkpoints (3371–3372, 3384–3385), room-search callbacks as `new ModelEvictedError(model.id)` (2672), build-phase slot rejection (1416–1418) | throughout |

- **1.6.1** Disposed-first ordering is explicitly the universal mapping rule, including on the room-search
  path: "Which error it rejects with follows the same disposed-first ordering every other site in this
  design uses" (2666).
- **1.6.2** "An earlier round had this callback collapse both causes to `ModelEvictedError`; that collapse
  is retired because it made one logical event — the world was disposed — surface as two different error
  classes depending only on whether disposal landed before or after `model.search`'s callback fired, while
  callers are explicitly told they may branch on which error class they got" (2681–2686, 3088–3091).
- **1.6.3** `[SILENT]` — the four **call-level ceiling rejections** (`maxFragmentsPerDbId`,
  `maxChildrenPerNode`, `maxBroadPhaseInstancePairs`, `maxCollisionInstancesPerEpoch`) reject the whole
  `findClashes` call but carry **no named error class**. The spec itself now says so, in normative text:
  "carrying no named error class, the same `[SILENT]` gap those three share" (3683–3684). See 0.5.

## 1.7 `modelId` reuse semantics

- **1.7.1** Two `Model` objects sharing one reused `modelId` may be **simultaneously live** — a "supported,
  tested state" (3397–3399, 1284–1287).
- **1.7.2** Their collision state is structurally disjoint because it is keyed by `loadEpoch`, "so a
  different `Model` object admitted under a reused `modelId` is structurally guaranteed a disjoint epoch,
  and therefore a disjoint `GeometryRecord` namespace, **before its first geometry lookup ever runs**"
  (3349–3357). Pinned by edge cases 3787–3793 and fixture 4293–4302.
- **1.7.3** A stale/delayed `evictModel(oldModel)` "can only ever release records filed under `oldModel`'s
  own epoch, which no other object's records are ever filed under, regardless of `model.id` reuse or call
  timing" (3140–3145, 3778–3786).

## 1.8 Extension-side lifecycle (`RoomLocatorExtension`, 3448–3498)

- **1.8.1** `load()`: awaits `CollisionWorld.fromViewer(...)` to completion before returning; the
  `BEFORE_MODEL_UNLOAD_EVENT` listener and the context-menu item are registered **only after** `fromViewer()`
  resolves, inside the same call, so "no consumer can observe a registered listener referencing a
  not-yet-constructed world". If `fromViewer()` rejects, both registrations are skipped — "neither exists
  without the other" (3451–3461).
- **1.8.2** `unload()`: three steps — `world.dispose()`, unregister context menu + listener, clear the
  per-model room cache (3462–3463). The **stated order is dispose-first, listener-removal-second**
  (3463–3464).
- **1.8.3** Two throw hazards are documented, both "benign only because something else catches it"
  (3464–3487):
  - a `BEFORE_MODEL_UNLOAD_EVENT` can still fire into the handler on an already-disposed world, and "the
    window can outlive `unload()` itself, since `Viewer3D.tearDown` catches a throw from `unload()` while
    leaving the listener registered". Benign **only because** `evictModel` is a no-op on a disposed world —
    "it is the method's totality that makes this ordering safe, not the ordering itself" (3469–3472).
  - a **repeated `unload()`** re-invokes `world.dispose()`, whose second call "is guaranteed to throw
    `WorldDisposedError` … synchronously, before steps 2/3 ever run — stranding listener removal,
    context-menu removal, and the room-cache clear for that invocation" (3473–3478). Swallowed by
    `tearDown`'s try/catch at `viewer3D.js:26583`.
- **1.8.4** `[SILENT]`/`[AMBIGUOUS]` — the text explicitly leaves three things unresolved: "Whether the
  Viewer or app code can invoke `unload()` a second time on one instance is **unstated**. Per-step isolation
  of `unload()`'s three steps, and whether the listener should be removed before `dispose()` rather than
  after, **remain open and are not settled here**" (3483–3487).
- **1.8.5** **Extension-instance survival gap.** Under this app's wiring, extensions are registered once in
  `config.extensions` at `viewer.start()` (`wwwroot/viewer.js:15-24`) and `loadModel()` passes no options
  object (`wwwroot/viewer.js:31-41`) so `keepCurrentModels` is never set; loading a second model invokes
  `Viewer3D.tearDown()`, unloading every registered extension, and "nothing in this app re-registers it
  afterward" (2566–2576). Normative conclusion: "**on this app's current wiring, Room Locator does not
  survive a second model load at all — it is unloaded once and never comes back, a Milestone-1
  application-wiring gap, not a defect in the identity apparatus itself**" (2576–2578).
- **1.8.6** `[SILENT]` — the resolution is deliberately left open: "either the application must explicitly
  reload the extension … or Milestone 1 is understood to support Room Locator only up to the first model
  replacement — **neither is decided here**" (2578–2582).
- **1.8.7** On the `tearDown()`-driven path, `BEFORE_MODEL_UNLOAD_EVENT` fires **after** the
  extension-unload loop already ran, so the listener is already deregistered and `world.evictModel` is
  never invoked for the outgoing model that way; `dispose()`'s wholesale clear plus the room-cache clear
  "already release everything a per-model `evictModel` call would have" (2582–2589). Cited internally
  against the pinned bundle (`viewer3D.js:26541-26560`, `:26583`, `:34052`, `:34054`) and flagged: "This
  ordering is an internal implementation detail, not documented or guaranteed by Autodesk — revalidate on
  any Viewer upgrade" (2590–2596). **The whole claim is conditioned on "provided `unload()` itself
  completes all three of its steps"** (2583–2586) — which 1.8.3's second hazard shows may not hold.
- **1.8.8** Room cache: `Map<Model, Promise<number[]>>` keyed by the exact `Model` object, owned by the
  extension, "**not by `model.id`**" (2598–2603).
- **1.8.9** Room-cache rejection rule is **unconditional and unified**: "every rejection path in this
  mechanism uses it, with no special-cased exception", the identity-guarded delete
  `if (roomCache.get(model) === thisPromise) roomCache.delete(model)` (2625–2634, 2659–2662, 2691–2699).
  Explicitly: "there is no 'leave the cache untouched' exception for either callback's invalid-lease
  branch. A design in which the two callbacks classify the same invalid lease differently, or delete the
  cache entry in one but not the other, **is a bug**" (2696–2699).
- **1.8.10** Cache-miss path admits **before** starting `model.search`: `const lease = world.admitModel(model)`
  captured in the closure; `admitModel` throws immediately (never starting the search) on a tombstoned model
  or disposed world (2652–2657).
- **1.8.11** The success callback's disposed-vs-evicted derivation calls `world.isModelLive(model)` inside
  a `try`/`catch`; "Nothing can interleave between the two calls — both are synchronous and there is no
  `await` between them — so the pair reads one consistent world state" (2668–2674). The `try`/`catch` is
  "load-bearing rather than defensive habit" (2674–2678).
- **1.8.12** Open question, still open: "whether `BEFORE_MODEL_UNLOAD_EVENT` can ever fail to fire for some
  model-removal path this spec hasn't identified. If it can, `evictModel`/the tombstone never runs for that
  model, and every race-safety guarantee for a model evicted *while the extension/world remain alive* is
  conditioned on the event firing at least once per removal" — explicitly **not** extending to the
  `tearDown()` path (4700–4708).
- **1.8.13** `[SILENT]` — `BEFORE_MODEL_UNLOAD_EVENT`'s **payload shape** is unverified: the installed
  typings declare the listener payload as `event: any`, so `event.model` "needs a one-time confirmation
  against the 7.124.2 source or a live console check during implementation" (2610–2615, 4575–4581).

---

# 2. Geometry ownership / build pipeline

## 2.1 `GeometryRecord` identity

- **2.1.1** One `GeometryRecord` per unique **`(loadEpoch, geometryIndex)`** — "keyed by the owning `Model`
  object's admitted load epoch, not its numeric `modelId`" (1222–1224, 3349–3352).
- **2.1.2** The dedup key is `fragList.getGeometryId(fragId)` combined with `modelLifecycle.get(model).epoch`;
  "the key must always be `(loadEpoch, geometryIndex)` — **never** `(modelId, geometryIndex)`, and never the
  bare index" (1130–1139).
- **2.1.3** `modelId` "remains attached to a record only as display/diagnostic metadata … it plays no role
  in cache identity" (1241–1244).
- **2.1.4** `referenceCount` is "**reserved, unused in Milestone 1** — release is epoch-scoped, not
  reference-counted" (1225–1227). `[SILENT]` — no semantics, increment/decrement sites, or future contract
  are given for it anywhere.
- **2.1.5** Each record carries `L_X := diagonal(localBounds(X))`, "computed once, in X's own local space,
  over the same collision-owned compacted-then-welded buffer the BLAS is built from — never the raw Viewer
  geometry — and cached with the BLAS" (1553–1556).

## 2.2 The three kinds of registry entry

"A registry lookup yields one of three things" (1444–1446):

| Kind | `buildState` | Cancellation signal | Phases | Cited |
|---|---|---|---|---|
| **oversized marking** | **none** ("it carries no `buildState`") | **none, ever** — "that signal is created exactly once, at insertion, for a `'building'` entry, a trigger an oversized marking never undergoes" | none ever started | 1444–1452 |
| `'building'` record | `'building'` | created once at insertion | ≥1 unresolved | 1377–1379, 1425–1428 |
| `'ready'` record | `'ready'` | **the same signal, carried unchanged across the transition** | weld+BVH resolved; connectivity may be unresolved | 1393–1402, 1428–1432 |

- **2.2.1** "Every pair needing it is skipped" for an oversized marking (1446, 1520, 1386–1388).
- **2.2.2** `[SILENT]` — **the text never says whether an oversized marking is ever re-evaluated or
  replaced.** It is removed only by `releaseEpochScopedState` or `dispose()` (1450–1452, 3116–3120,
  3239–3241). Since `maxSyncTriangleCount` is a fixed constant and the active count is a property of the
  geometry, re-evaluation is presumably moot — but a later run with a revised ceiling, or an entry marked
  oversized under a mode that never needed it, is not addressed.

## 2.3 The entry-lifetime cancellation signal

- **2.3.1** **Entry-lifetime-scoped, not `buildState`-scoped**: "created once when the entry is first
  inserted in `buildState: 'building'` and kept alive, unchanged, for the entry's entire lifetime — the
  signal is *not* discarded or replaced when the entry transitions to `'ready'`" (1425–1429).
- **2.3.2** "Every unresolved phase slot the entry ever hosts races that same signal, **including a lazy
  connectivity build started later against an already-`'ready'` entry**" (1429–1432).
- **2.3.3** Both release paths "reject that signal **exactly once** and drop the entry in the same step …
  **unconditionally, for every entry they remove regardless of whether its `buildState` is `'building'` or
  `'ready'`**" (1432–1435). Rationale restated: "Clearing a map does not by itself settle a pending
  promise" (1435–1436, 3129–3130).
- **2.3.4** **One signal per entry suffices** "Because phases are strictly sequential and single-flight per
  entry — weld, then connectivity if needed, then the BVH, with at most one phase ever unresolved on a
  given entry at a time — … there is no per-phase-slot set or map of signals to keep in sync" (1436–1439).
- **2.3.5** Removal is **identity-guarded** on both paths — "delete the entry only if the registry still
  holds this exact entry for that key" — so "a late-resolving continuation from a just-cancelled phase
  (weld, BVH, or a lazily-started connectivity build) can never republish its result or otherwise mutate
  state once the entry is gone" (1439–1443, 1422–1424, 3131–3134).

## 2.4 Pipeline stages, in order

| # | Phase | Gated by | Checkpointed | Cited |
|---|---|---|---|---|
| 0 | Layout normalization → `ranges: TriangleRange[]` | — ("free, no per-triangle work") | — | 1462–1465, 1177–1216 |
| 0.5 | **Ceiling check**: `activeTriangleCount := Σ floor(ranges[i].count / 3)` vs `maxSyncTriangleCount` | the ceiling itself, "**not gated by `frameBudgetMs`** but by the ceiling itself" | — | 1460–1478 |
| 1 | **Active-range compaction** → collision-owned compacted position/index pair | runs "only once the ceiling check below has passed" | folded into the weld phase's checkpoint | 1461–1481, 1942 |
| 2 | **Weld** (`mergeVertices` over position+index only) → `weldPromise` | `maxSyncTriangleCount` | own checkpoint, before it starts | 1229–1231, 1379–1381, 1942, 1701–1705 |
| 3 | **Connectivity** (`GeometryConnectivity`) → own promise slot; **independently lazy** | `maxSyncTriangleCount` | own checkpoint, before it starts | 1323–1339, 1943, 1733–1737 |
| 4 | **BVH** (`MeshBVH`) → `accelerationPromise` | `maxSyncTriangleCount` | own checkpoint, before it starts | 1308–1309, 1944 |

- **2.4.1** Slots "await their prerequisites rather than being launched in parallel — **weld first, then
  connectivity if it is needed, then the BVH** — preserving the phase order the narrow phase and the
  atomic-operations table already specify" (1381–1383).
- **2.4.2** The unit conversion is normative and stated at four sites: 1186–1189, 1467–1470, 2933–2936,
  3637–3640. "Nothing downstream may compare such a count against a triangle ceiling without converting
  first" (1186–1187). Ranges are **triangle-aligned** by normalization: "a clipped range whose `count` is
  not a multiple of 3 contributes only its whole triangles (`floor(count / 3)`), never a partial one —
  which is also all compaction can copy" (1183–1186).
- **2.4.3** The ceiling comparison is strictly **"exceeds" (`>`)**, not `>=` — pinned by fixture 4144–4148
  ("a fragment whose `activeTriangleCount` is exactly `12_000` … must be built, not skipped … matching
  every other site that states this comparison").
- **2.4.4** Compaction's ordering guarantee: "`maxSyncTriangleCount` is checked against `activeTriangleCount`
  **before any copying happens**" (1476–1478); "Only once that check passes does compaction actually copy
  triangle data, so its own cost is bounded by the now-confirmed-under-ceiling active count — never by the
  size of whatever 'inactive' portion of the raw buffer happens to exist, however large" (1478–1481).
- **2.4.5** "Welding, connectivity, and BVH construction (below) then all run over this **same** compacted
  buffer; **none of the three ever sees a triangle outside the active ranges**" (1481–1482).
- **2.4.6** Position and index are **owned**, not zero-copy: "`indexOwnership: 'clone'` remains the only
  supported value, and `'indirect'` is now not merely unimplemented but **inapplicable**" (1487–1497,
  4661–4663).
- **2.4.7** The previous "set `groups`/`drawRange` on the BVH input" workaround is **retired** — compaction
  already discards everything outside the active ranges (1498–1502).
- **2.4.8** `[AMBIGUOUS]` — **where the ceiling check physically lives.** Narrow phase says the check
  happens *there*, before the registry get/build: "for each candidate pair, check both geometries' active-range
  triangle counts … against `maxSyncTriangleCount` **first** — if either exceeds it, skip the pair:
  `GeometryRegistry` marks that geometry's entry oversized … **Otherwise** lazily get/build the
  `GeometryRecord`" (2933–2944). The Components text describes it as a pipeline phase inside the build:
  "**The fix inserts one more phase before the three above** … active-range compaction. Before welding …
  but only once the ceiling check below has passed" (1460–1462), with `GeometryRegistry` doing the marking
  (1517–1520). Whether the check is a narrow-phase precondition or the first step of the registry's build
  path — and therefore whether a `'building'` entry is ever inserted for a geometry that turns out
  oversized — is not settled by either passage.

## 2.5 Publication, single-flight, and what a caller may read

- **2.5.1** **"Insert first, then build."** The caller whose lookup misses inserts the record with
  `buildState: 'building'` **before the first phase's checkpoint — that is, before any yield** (1377–1379).
- **2.5.2** Rationale for rejecting publish-when-complete (1369–1376): the build "is deliberately *not*
  atomic"; under publish-only-when-complete a second concurrent caller sees a cache miss and duplicates
  every phase, "and neither `evictModel` nor `dispose()` can find the in-flight build promises both are
  specified to reject".
- **2.5.3** **"A caller that finds an existing entry never starts a duplicate build."** It awaits the phase
  slots its own query needs — "or, if the entry is an oversized marking instead, skips the pair immediately
  without awaiting anything" (1384–1388). "This single registry-level mechanism is what makes concurrent
  build requests dedupe, and it covers compaction/weld and connectivity exactly as it covers the BVH — see
  `BlasCache` below, **which owns no dedup mechanism of its own**" (1388–1389, 1502–1512).
- **2.5.4** **"Nothing reads a phase's product off a `'building'` record."** The compacted/welded buffers,
  the `MeshBVH`, and the `GeometryConnectivity` decomposition "are only ever the resolved values of their
  own phase slots, never fields read straight off the record" (1390–1392).
- **2.5.5** **`'ready'` is record-level and mode-independent**: "it means compaction+weld and the BVH have
  both resolved" — everything `surface-intersection` needs — "and it is `'ready'` whether or not the
  connectivity slot was ever created … **Connectivity is never what makes a record un-`'ready'`**"
  (1393–1402). Pinned by fixture 4080–4085.
- **2.5.6** **There is no `'failed'` state** (1416–1424): a rejecting phase produces
  `ModelEvictedError`/`WorldDisposedError` and "**the entry is removed from `GeometryRegistry`
  synchronously as part of that rejection**, discarding whichever intermediate buffers exist". "No later
  caller can then observe a half-built record — neither a lingering `'building'` entry nor a
  `'ready'`-looking one whose later phases never ran — and a later, valid attempt starts the whole pipeline
  fresh". Identity-guarded. Pinned by fixture 4065–4072.
- **2.5.7** **A caller's own abort does not cancel an in-flight phase**: "every phase slot runs to
  settlement, so a `'building'` entry is never left permanently unsettled with other callers awaiting it"
  (1413–1415).
- **2.5.8** **Owner-scoped build-phase checkpoint** (1403–1412): checks `disposed` first, "then the
  liveness/epoch of the one model that owns this geometry — the operand whose `loadEpoch` is in the
  record's key — **and nothing else**. It must not reject because the initiating query's *other* operand
  was evicted." Explicitly **vacuous under Milestone 1**: "under Milestone 1's `source.model === target.model`
  restriction, eviction of a distinct non-owner operand is unreachable, so this distinction is not yet
  behaviorally observable … The scoping is retained for a future cross-model milestone" (1407–1411). Each
  caller separately re-validates both of its own operands "at its own checkpoints, before and after
  awaiting a shared phase slot" (1411–1413). Fixture note at 4119–4123 confirms Milestone 1
  unreachability.

## 2.6 Release paths (geometry side)

| Path | Trigger | What it removes | Signal handling | Cited |
|---|---|---|---|---|
| **Build-phase rejection** | owning model evicted / world disposed at a between-phases checkpoint | this entry, synchronously, identity-guarded | slot rejects with `ModelEvictedError`/`WorldDisposedError` | 1416–1424 |
| **`releaseEpochScopedState(epoch)`** | `evictModel` on a previously-`'live'` object | every `GeometryRegistry` entry filed under that epoch — "in whichever build state, `'building'` or `'ready'`, **plus any oversized marking**" — "together with its cached BLAS and cached connectivity where it has any"; **and, as a separate operation over a different keyspace, the outgoing epoch's `CollisionInstance` bucket** | for every `'building'`/`'ready'` entry it removes, rejects that entry's signal **first**, exactly once; "An oversized marking carries no such signal — no phase is ever started for it — and is removed directly in the same sweep, with nothing to reject." Then identity-guarded delete. | 3116–3134 |
| **`dispose()` wholesale clear** | `dispose()` | `GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity`, **and the `CollisionInstance` identity cache** — four caches, each in its own single clear operation | "For every `'building'` or `'ready'` entry it removes, the clear rejects that entry's cancellation signal … exactly once, in the same pass that drops the entry, identity-guarded … **An oversized marking carries no cancellation signal at all** … so the clear removes it directly in the same wholesale pass, with nothing to reject." | 3224–3241, 3429–3443 |

- **2.6.1** The sweep can reach in-flight builds "at all only because a record is published to the registry
  when its build **starts** rather than when it completes; an in-flight build living only inside the
  building caller's closure would be unreachable from here" (3135–3138, 3433–3438).
- **2.6.2** "A wholesale clear cannot suffer the same enumeration gap a per-model sweep can, because it
  never needs to identify *which* models were live in the first place; it discards everything
  unconditionally" (3441–3443).
- **2.6.3** `[AMBIGUOUS]` — **`BlasCache`'s status as a keyspace.** `dispose()` lists `BlasCache` as one of
  four independently-cleared caches (3224–3226, 3429–3431), and 3335–3336 describes `GeometryRegistry`,
  `BlasCache` and `GeometryConnectivity` as having been separately keyed by `(modelId, geometryIndex)`.
  But the record-level design places the BLAS behind `accelerationPromise`, a single-flight slot **on the
  registry entry** (1229–1231, 1504–1507), and says `BlasCache` "owns building the `MeshBVH` and caching it
  behind that phase slot" (1511–1512). Whether `BlasCache` is a distinct map with its own keys or merely
  the storage behind a slot is not settled.
- **2.6.4** `[SILENT]` — **no keyspace-relationship statement exists for `BlasCache` or the cached
  `GeometryConnectivity` relative to `GeometryRegistry`.** `evictModel`'s release of these two is derived
  from the registry sweep ("together with its cached BLAS and cached connectivity where it has any",
  3118–3120). The `CollisionInstance` cache gets an explicit superset argument for why it must **not** be
  derived from a registry scan (1276–1280, 3120–3124); no equivalent statement establishes that
  `BlasCache`'s / connectivity's keyspaces are subsets of the registry's, which is what would make the
  derived release complete.

## 2.7 Extraction contract

- **2.7.1** **No recursive enumeration anywhere.** "**No code path in this design may call the recursive
  form**" (1085–1086). The normative path is "the **self-driven, depth-first node-by-node walk specified in
  Data Flow step 3**", built from `enumNodeChildren(node, cb, false)` and `enumNodeFragments(node, cb, false)`
  (1082–1086).
- **2.7.2** **`getChildCount` is not one of the walk's primitives** (1086–1087, 2758–2761, 3654–3661).
  Removed from the enforcement path "entirely — it is never called here, for any node shape" (1949). Pinned
  by fixture 4183–4189 ("Assert separately, in both runs, that **`getChildCount` is never called**").
- **2.7.3** **Coverage equivalence, verified not assumed** (1088–1104): the recursive form delegates to
  `enumNodeInstances`, which enumerates each visited node's own direct fragments then recurses through a
  non-recursive `enumNodeChildren`, "so it visits every node in the subtree, root and interior nodes
  included, not only the leaves, exactly once". Therefore "**The union of the walk's per-node
  `enumNodeFragments(node, cb, false)` results is therefore the same fragment set one
  `enumNodeFragments(dbId, cb, true)` call produces** — same set, not merely a superset; order is not
  guaranteed to match and is not relied on, and the walk dedupes by fragment id".
- **2.7.4** **Two conditions the equivalence rests on, only one of which this design guarantees**
  (1105–1118):
  1. *No truncation.* The walk's two early-exits (`maxFragmentsPerDbId` tally, `maxChildrenPerNode` fanout)
     "**reject the entire `findClashes` call** rather than returning a truncated fragment set … no result
     this design returns is ever built on a knowingly partial subtree."
  2. *A complete tree to walk.* "An instance tree that under-reports a node's children yields a walk that
     finishes **normally**, with a silently short union and no budget trip to catch it … The two conditions
     are independent and the rejection paths above cover only the first. See **Risks**; **this spec does not
     claim to have closed the second.**"
- **2.7.5** `[SILENT]` — instance-tree readiness: "no code path in this milestone checks Viewer-side
  tree-readiness before extraction begins. What readiness signal (if any) the installed Viewer version
  exposes for this, and whether `findClashes`/`world.admitModel` should check it, is **deferred to
  implementation**" (4582–4590).
- **2.7.6** The walk's per-node loop (2745–2796):
  - fanout ceiling `maxChildrenPerNode` enforced by **an in-callback counting abort inside non-recursive
    `enumNodeChildren(node, cb, false)` — "the sole enforcement mechanism, for every node shape"**;
    callback "counts its own invocations and returns literal `true` the moment the count would exceed
    `maxChildrenPerNode`", capping the call at `maxChildrenPerNode + 1` callbacks (2762–2771).
  - **Three normative implementation constraints** (2772–2782): the abort is recorded in a **local flag**,
    not the enumeration's return value ("the truthy result is forwarded as a dbId, and dbId `0` is falsy");
    the callback **only collects child ids, never descends inline**; and the installed typings declare both
    the callback and the return as `void`, "contradicting the documented contract, so the abort must be
    pinned by a test rather than trusted to the type surface".
  - `enumNodeFragments(node, cb, false)` for that node's own fragments; "**The tally counts callback
    invocations, not distinct fragment ids**" (2784–2786). `CollisionInstance` construction separately
    dedupes by fragment id (2786–2788).
  - tally checked against `maxFragmentsPerDbId` after every node's contribution; on exceed "**the walk stops
    immediately** … and the entire `findClashes` call rejects, naming the offending dbId" (2789–2792).
  - descend into collected child ids one at a time **after the `enumNodeChildren` call has returned**
    (2793–2796).
  - a `frameBudgetMs` checkpoint fires **between sibling nodes at the same depth** (2801–2802, 2816–2818).
- **2.7.7** **The wide-but-fragment-empty tree** is called out as a distinct failure mode caught by
  `maxChildrenPerNode`'s in-callback abort alone — "it contributes `0` to the fragment tally at every node,
  so it can never trip `maxFragmentsPerDbId` at all, and the `frameBudgetMs` sibling checkpoint fires
  *between* nodes, never inside the one `enumNodeChildren` call that would block on a million-child node"
  (2797–2810).
- **2.7.8** **The accepted atomic risk** (2820–2849): "one non-recursive `enumNodeFragments(node, cb, false)`
  call remains an accepted, non-preemptible Milestone-1 atomic risk, in the same category as the three
  `maxSyncTriangleCount` phases". Round 18's correction is normative: Round 17's stated justification is
  **factually wrong** — `ObjectTree.getInstanceCount(dbId)` is documented, and the truthy-return interrupt
  is documented for `enumNodeInstances`. "**The classification is nonetheless retained unchanged here, and
  restated as scope rather than as necessity** … applying both mechanisms here is a required follow-up this
  pass did not carry out. Round 16's standing instruction … no longer applies to this row on its own terms,
  and nothing in this spec should be read as claiming it does."
- **2.7.9** Rejection-vs-diagnostic distinction is normative and justified: a fanout/tally trip **rejects
  the whole call**, because "skipping a fanout silently voids the completeness of an **entire requested
  dbId** — an unbounded, unnamed subtree — and `findClashes` would return a clean `pairs: []` for geometry
  it never looked at" (3654–3672).

## 2.8 Welding

- **2.8.1** **Mandatory, not optional repair** (1692–1705, 816–821, 4664–4665): unwelded index-based
  connectivity splits a box into 6 components and a cylinder into 49; "`closedManifold` would be false for
  every solid, and the containment guarantee would never hold once".
- **2.8.2** **Strip to position + index only, then merge** — the strip must come first, because
  `mergeVertices` compares all attributes (1701–1705). "That makes the idea doc's 'do not copy rendering
  attributes' rule (written to save memory) **load-bearing for correctness**."
- **2.8.3** `weldEpsilon = 1e-4 m / model.getUnitScale()` (0.1 mm), falling back to `1e-4` if the unit scale
  is unavailable (1723–1725).
- **2.8.4** Upstream semantics stated: `mergeVertices(geometry, tolerance = 1e-4)`, tolerance an **absolute
  length in the geometry's own local units**, implemented as **grid quantization, not an epsilon-ball** —
  "the guarantee is 'identical coordinates always merge,' not 'anything within `tolerance` merges'"
  (1710–1721).

---

# 3. Query-mode semantics and dependencies

## 3.1 The three public modes (table at 1644–1648)

| mode | question answered | parity evaluated against | open **source** | open **target** |
|---|---|---|---|---|
| `surface-intersection` | do their surfaces meet anywhere, touching included? | **nothing — no parity at all** | fine, never diagnosed | fine, never diagnosed |
| `containment` | does any point **on the source's surface** lie inside the target's interior? | **target only** | fine, never diagnosed | `unverified-parity-operand` (`role:'target'`) |
| `volume-overlap` | do the two solids share positive volume? | **both** | `unverified-parity-operand` and/or `unverified-open-component`, both `role:'source'` | `unverified-parity-operand` and/or `unverified-open-component`, both `role:'target'` |

## 3.2 Solid model (1595–1640)

- **3.2.1** "**A target geometry's interior is defined by even-odd (parity) over its entire triangle set**"
  (1602) — a declared choice, justified by hollow solids/pipes (1606–1610), restated at 2213–2217.
- **3.2.2** Stated limitation: two genuinely **nested independent solids** in one geometry read the inner
  region as cavity; "no parity scheme can [distinguish them], because the two configurations have identical
  triangle sets" (1613–1620). Pinned by fixture 3882–3886.
- **3.2.3** "**A source geometry contributes as the union of its components.**" Union semantics on the
  source side, even-odd on the target side — "that asymmetry is intentional" (1622–1626).
- **3.2.4** "**Only closed components can establish positive volume.** An open shell encloses no *certified*
  volume, so its vertices reading `inside` a target proves **containment**, not **overlap**" (1628–1629).
- **3.2.5** Manifold classification is **per component**: "a component is **manifold** if every one of its
  edges is shared by exactly two triangles. Components with boundary edges (used once — an open shell) or
  non-manifold edges (used by three or more …) are flagged" (1752–1756).
- **3.2.6** `[AMBIGUOUS]` — **operand-level "certified closed" vs. component-level flag.** The parity
  precondition is stated at operand granularity: "**every operand that parity is evaluated against must be
  a certified closed manifold**" (2283), and parity itself is defined over the target's *entire triangle
  set* (1602, 2213–2215). But the flag being read is per component: "this parity check reads its cached
  manifold classification" off `GeometryConnectivity` (2291–2293), which classifies components (1752–1756).
  The text never states how a multi-component operand aggregates to "certified closed" — e.g. whether a
  two-closed-component target (a legitimate hollow-pipe-plus-cap case) is certified, or whether any flagged
  component in the operand disqualifies the whole operand.

## 3.3 `SurfaceIntersectionQuery` (1758–1783)

- **3.3.1** "**true iff any triangle pair from A and B has a non-empty geometric intersection**, including
  zero-volume coincident contact (face-face, edge-edge, vertex-face)" (1758–1760).
- **3.3.2** Built on `bvhcast`, **not** `MeshBVH.intersectsGeometry` — the latter "accepts no budget,
  exposes no per-candidate callback, and offers no abort hook" (1764–1773).
- **3.3.3** "the *same* `bvhcast` traversal `ProperCrossingQuery` uses, using the same
  `maxCandidatePairsExamined` ceiling, with a fresh traversal-local `candidatePairsExamined` counter for
  each traversal, the same per-candidate `intersectsTriangle` test, and **the same abort protocol** — with a
  weaker predicate" (1775–1779). Needs neither the coplanar split nor the probe ladder — "no interior
  classification, hence no parity, hence **no closure precondition**" (1779–1781).
- **3.3.4** It is the **only** mode that never calls `anyComponentInside`, hence the only genuinely
  connectivity-free mode (1332–1333, 1943, 2536–2537).

## 3.4 `ProperCrossingQuery` (1785–2158)

- **3.4.1** `bvhcast` yields **candidates, not intersections** — "the `intersectsTriangles` wrapper is a
  plain nested loop over every triangle in the two overlapping leaf ranges … with no intersection test
  anywhere" (1796–1810), with the upstream loop quoted at 1800–1804.
- **3.4.2** **Classify before doing anything else**, ordered so the upstream coplanar warning is never
  entered (1811–1821): coplanar iff `|nA·nB| ≥ 1 − coplanarAngleEpsilon` **and** planes coincide within
  target-frame `surfaceEpsilon`; coplanar → `intersectsTriangle(triB)` **without** a target line (records a
  *touching contribution*); non-coplanar → with `targetLine`, and on false "**do not read `targetLine`**".
- **3.4.3** Skipping coplanar pairs is "the *correct* answer, not merely the safe one" (1823–1828).
- **3.4.4** Four-quadrant probe: for each `(s₁,s₂) ∈ {+1,−1}²` with `d = s₁·nA + s₂·nB` non-degenerate, and
  each `offsetLadder` rung coarsest→finest, `P = M + δ × normalize(d)`. "The pair is a proper crossing iff
  some probe classifies as `inside` **both** A and B" (1829–1844). Winding-independent (1841–1842).
- **3.4.5** **Inconclusive probes propagate**: a `boundary` classification against either solid "proves
  nothing"; probes exhausted with no inside/inside but ≥1 boundary → the pair is **inconclusive**, and a
  negative overall result carries `inconclusive-crossing` (1845–1849).
- **3.4.6** Budgets: `maxCrossingPairsExamined = 64` counts **confirmed intersecting non-coplanar pairs**
  ("Coplanar pairs don't consume it"); `maxCandidatePairsExamined = 50_000` counts **raw candidate pairs
  entering the callback** (1850–1861).
- **3.4.7** **Abort protocol** (1863–1867): exceeding either budget sets `aborted` and returns `true` from
  `intersectsTriangles` — "the only way to stop a `bvhcast` traversal early". `bvhcast` therefore returns
  `true`, which "**must not be read as 'crossing found'**"; the caller checks the flag first and reports
  `crossing-budget-exhausted`. "Getting this backwards would turn a timeout into a fabricated clash."
- **3.4.8** **Third, time-based trigger** with a **private, traversal-local clock** — see §4.4.

## 3.5 `ContainmentQuery` — two layers (2160–2403)

- **3.5.1** `classifyPoint(point, targetBvh) → 'inside' | 'outside' | 'boundary'` is the low-level
  primitive; `ProperCrossingQuery` uses only this (2163–2164). `anyComponentInside(source, target)` is the
  per-component sampling wrapper, "Called by `VolumeOverlapQuery` (**only *after* `ProperCrossingQuery` has
  returned false**) and by `ContainmentModeQuery` directly, with no `ProperCrossingQuery` term ahead of it"
  (2165–2169). Non-circularity is explicit: "the primitive has no such precondition, and only the wrapper
  does" (2171–2172).
- **3.5.2** `classifyPoint` steps (2182–2217): (1) **surface-proximity pre-check** via
  `closestPointToPoint`; ≤ `surfaceEpsilon` → `boundary` immediately, which "guarantees the parity ray
  below cannot encounter a near-zero hit"; (2) parity in the target BVH's own local space, with
  `THREE.DoubleSide` explicit, **three generic non-axis-aligned local directions tried in order**,
  distance-**sort then merge** runs closer than `mergeDistance`, barycentric edge/vertex rejection with
  retry along the next direction, "**If every direction grazes, return `boundary`**".
- **3.5.3** **The containment guarantee and its preconditions** (2224–2305):
  - The guarantee applies "only once no proper crossing exists between source and target — established by
    `ProperCrossingQuery` returning false for `VolumeOverlapQuery`, and by `ContainmentModeQuery`'s own
    **two-term negative** for `containment`" (2224–2228). "**it governs negatives only**" (2231).
  - closed manifold component → "one conclusive sample determines it exactly"; **non-manifold or open
    component → sampling is best-effort, and the component is flagged** (2244–2245).
  - **In `volume-overlap` mode**: a **positive** whose deciding component isn't a certified closed manifold
    → `unverified-open-component`, `role` naming whichever public operand supplied it; a **negative**
    involving any flagged component → `non-manifold-component` (2252–2267).
  - **In `containment` mode**: "**neither rule applies to the source at all**: that mode's contract is
    containment, which open sources answer soundly, so an open source is not a caveat and is never
    diagnosed" (2269–2272).
  - **Target-side parity precondition**, checked **once per pair before any sampling** (2274–2296): every
    parity operand must be certified closed, else `unverified-parity-operand` naming the role, on positives
    *and* negatives. "**Which operands those are depends on the deciding path, not on the mode alone.**"
    Reading the flag is free once `GeometryConnectivity` exists; "**Building that record is not free** — it
    is its own separately-checkpointed lazy phase, and `containment`/`volume-overlap`'s connectivity gate …
    is what guarantees the *target*'s record has already gone through that phase before this check runs,
    not only the operand(s) `anyComponentInside` samples" (2291–2296).
- **3.5.4** **Three escalating stages per component** (2307–2367), with the **third scoped to
  `volume-overlap` only**:
  1. Spatially-spread vertex sampling on a stride `ceil(n / samplesPerComponent)`, `samplesPerComponent = 8`;
     stop at first `inside`/`outside`.
  2. Continue through the component's remaining vertices until conclusive or exhausted.
  3. **Constructed interior witness**: from a triangle's centroid step ±normal by each `witnessLadder` rung,
     keeping the first probe `classifyPoint` puts `inside` **the component's own geometry**; up to
     `maxWitnessTriangles = 8` triangles.
  - `witnessLadder` is scaled by `L_source`, **not** `L_canonical` (1574, 2333–2340).
  - **"This stage is scoped to `volume-overlap`; `containment` never runs it"** (2342–2350) — the witness is
    "deliberately constructed *inside the source's own volume* … which is exactly right for
    `volume-overlap`'s question … but wrong for `containment`'s, whose contract is restricted to points
    **on the source's surface**". Counterexample: two coincident closed boxes.
  - `containment`'s use "therefore stops after stage 2. **This is not the same as asserting the component
    is clean-false**" — an unresolved component "stays unresolved for this term … rather than being
    asserted false" (2352–2358). What discharges the genuine "surface dips inside without any vertex
    inside" case is `SurfaceCrossingWitness` (2359–2362).
- **3.5.5** "Only if all three stages fail (`volume-overlap`) or the first two fail (`containment`) is the
  component unresolved, and a negative result with any unresolved component emits
  `inconclusive-containment`. On a non-manifold-flagged component the same stages run, but no guarantee
  attaches to their result" (2364–2367).
- **3.5.6** Global `maxContainmentSamples = 512` bounds over-segmented geometry; hitting it emits
  `incomplete-component-coverage` (2369–2370).
- **3.5.7** `[CONTRADICTION]` — **whether `containment` mode can emit `non-manifold-component` for its
  source.**
  - **Side A (three sites, "never diagnosed"):** 2269–2272 — "In **`containment`** mode **neither rule
    applies to the source at all** … an open source is not a caveat and **is never diagnosed**" (the two
    rules just enumerated being `unverified-open-component` on positives and `non-manifold-component` on
    negatives). Mode table 1647 — `containment` / open **source** → "fine, never diagnosed". Public API
    3022–3024 — "open sources are sound here by construction and **are never diagnosed**".
  - **Side B (one site, Error Handling):** 3692–3696 — "**Non-manifold or open components sampled by
    `anyComponentInside`** (**the public source in `containment` mode**; either public operand in
    `volume-overlap` mode …): the containment guarantee doesn't cover them …, so **a negative result
    involving one emits `non-manifold-component`**."
  - The `ClashDiagnostic` union's own comments do not settle it: `unverified-open-component` is annotated
    "(never emitted in 'containment' mode — see Query modes)" (3527), but `non-manifold-component` carries
    **no** mode scope (3524).

## 3.6 `VolumeOverlapQuery` (2405–2441)

- **3.6.1** Composition, evaluated in order with early exit (2420–2426):
  ```
  volume-overlap(A, B) :=  ProperCrossingQuery(A, B)
                        OR ContainmentQuery(anyComponentOf(A) inside B)
                        OR ContainmentQuery(anyComponentOf(B) inside A)
  ```
- **3.6.2** "The containment terms are *any component*, not 'the whole of A'" (2426–2428). "Both directions
  are required for symmetry" (2430–2432).
- **3.6.3** "Pure touching correctly returns **false**" (2432–2434). "Any unresolved component,
  inconclusive candidate, or truncated examination turns a negative into a *diagnosed* negative rather than
  a clean one" (2434–2435).
- **3.6.4** Known limits stated: exact for closed manifold geometry with overlaps deeper than
  `minPenetrationDepth`; best-effort (with diagnostics) for non-manifold/open components on either side,
  shallower overlaps, and budget exhaustion (2437–2441).
- **3.6.5** `volume-overlap` needs **both** operands closed, **including on the crossing path** — "step 4
  decides a crossing by classifying probe points as `inside` **both** A and B, and that classification is
  ray parity" (1670–1676).

## 3.7 `ContainmentModeQuery` (2443–2540)

- **3.7.1** Composition (2446–2449):
  ```
  containment(A, B) :=  ContainmentQuery(anyComponentOf(A) inside B)   // a source VERTEX inside B
                     OR SurfaceCrossingWitness(A, B)                   // a point on a source TRIANGLE inside B
  ```
  "One direction only, and no bidirectional evaluation" (2451–2452).
- **3.7.2** "**The first term uses only `anyComponentInside`'s stages 1–2 (vertex sampling), never its
  stage-3 constructed interior witness**" (2454–2456). An unresolved component "contributes no witness here
  and, if the second term below also finds nothing, the pair is a diagnosed negative
  (`inconclusive-containment`), never a witness manufactured by stepping off the surface" (2458–2460).
- **3.7.3** "**The second term is not optional**" (2462–2470) — without it a source straddling the target
  boundary with no vertex inside returns a **clean false**. "`volume-overlap` never had the bug because
  `ProperCrossingQuery` runs ahead of its containment terms; this mode has nothing ahead of it."
- **3.7.4** **`SurfaceCrossingWitness`** (2472–2520): given a source triangle properly (non-coplanarly)
  intersecting the target along segment `L`, take midpoint `M`, in-plane direction
  `u = normalize(nA × dir(L))`, and `dAvail` = distance from `M` to the triangle's own edge along `u`
  (`-u` handled symmetrically, possibly different `dAvail`). Probe `P = M ± δ·u` for
  `δ ∈ crossingProbeFractions × dAvail` = `[0.5, 0.1, 0.01] × dAvail`, coarsest first. "The witness holds
  when some `P` classifies `inside` the target."
- **3.7.5** "**If no rung produces a probe that both stays inside the triangle and clears `surfaceEpsilon`
  against the target, the candidate is inconclusive, not a rejected witness**" → `inconclusive-crossing`
  (2492–2498).
- **3.7.6** **Scope contrast is normative** (2500–2506): `ProperCrossingQuery` "steps off the intersection
  curve into space and demands `inside` **both** solids … and inherits both closure preconditions. This one
  stays **on the source surface** and demands `inside` the target only … It therefore **never parity-tests
  the source**, which is exactly what lets `containment` accept open sources while `volume-overlap` cannot."
- **3.7.7** Its own traversal budgets (2506–2515): its own `bvhcast` over source and target BVHs; each
  callback is one raw candidate pair, incrementing a **traversal-local `candidatePairsExamined`** before any
  coplanarity or intersection test, aborting past `maxCandidatePairsExamined = 50_000`; a confirmed
  non-coplanar intersection entering the probe ladder "also consumes `maxCrossingPairsExamined = 64`". At
  most **six** probes per confirmed pair (two in-plane directions × three fractions), each classifying
  against the **target BVH only** — "at most half the *classification* count per confirmed pair, though
  total runtime still needs measurement, not the 'roughly half' this passage previously overclaimed".
- **3.7.8** `[AMBIGUOUS]` — whether `maxCrossingPairsExamined` inside `SurfaceCrossingWitness` is
  traversal-local. `candidatePairsExamined` is explicitly "a traversal-local … counter" (2508–2509); the
  crossing counter is described only as "also consumes `maxCrossingPairsExamined = 64`" (2510–2511), with no
  scope stated. Same silence applies to `ProperCrossingQuery`'s own `maxCrossingPairsExamined`.
- **3.7.9** "**Term ordering is cheapest-first**: vertex sampling resolves the common case … without any
  traversal at all. A negative now requires *both* composition terms to fail, which strictly strengthens
  `anyComponentInside`'s guarantee rather than weakening it — that guarantee was stated under 'no proper
  crossing exists,' and the second term (`SurfaceCrossingWitness`) is what now establishes the antecedent
  instead of assuming it" (2522–2526).
- **3.7.10** Layer-name split is normative: "**`ContainmentQuery`** is the internal point-classification
  component (`classifyPoint` + `anyComponentInside`), used by `containment` and `volume-overlap` — never by
  `surface-intersection` … **`ContainmentModeQuery`** is the thin public composition" (2535–2540).

## 3.8 Mode dependency matrix

| Mode | compaction+weld | BVH | connectivity | parity | closure precondition |
|---|---|---|---|---|---|
| `surface-intersection` | yes ('ready') | yes ('ready') | **no** (1332–1333, 1943, 2946, 4062–4064) | none | none (1781) |
| `containment` | yes | yes | **yes** — for **both** operands (1334–1339, 2291–2296) | target only (1647, 3565–3568) | target closed (1677–1680) |
| `volume-overlap` | yes | yes | **yes** — for both operands | **both** (1670–1676, 3556) | both closed (1670–1676) |

- **3.8.1** "Both `containment` and `volume-overlap` call `anyComponentInside` … and `anyComponentInside`
  samples per connected component, which requires `GeometryConnectivity`'s decomposition **regardless of
  which of the two modes is asking** — the component decomposition (stages 1–2) runs for both modes
  equally, independent of which one does or doesn't also reach stage 3" (1326–1332).
- **3.8.2** "**Only `surface-intersection`, which never calls `anyComponentInside` at all, is genuinely
  connectivity-free**" (1332–1333).
- **3.8.3** The connectivity gate "also builds connectivity for an operand `anyComponentInside` never itself
  decomposes: `containment`'s parity-closure precondition … reads a cached manifold-classification flag off
  the *target*'s `GeometryConnectivity` … so **both operands' records go through this same connectivity
  gate** in `containment`/`volume-overlap` mode" (1334–1339).

## 3.9 Diagnostics (3500–3626, 3628–3793)

- **3.9.1** Two scopes: `{scope:'fragment', reason, role, fragment}` for normalization/size failures
  "independent of any pairing", and `{scope:'pair', reason, role?, sourceFragment, targetFragment}`
  (3532–3543).
- **3.9.2** `role` is **required** for `unverified-parity-operand` and `unverified-open-component`, and
  **absent** for pair-wide reasons (budget exhaustion, coverage truncation, inconclusive results)
  (3539–3542).
- **3.9.3** **Parity role table** (3554–3559):

  | decided by | parity ran against | roles that can be indicted |
  |---|---|---|
  | proper crossing | both operands | `source` and/or `target` |
  | containment of A in B | B only | `target` |
  | containment of B in A | A only | `source` |
  | a negative | every path ran | `source` and/or `target` |

  "One diagnostic is emitted per offending operand, so a pair with both open produces two" (3561).
- **3.9.4** **Mode scope** (3563–3568): the `proper crossing` row, the `containment of B in A` row, the
  two-role `a negative` row, and the both-open two-diagnostic case "apply **only** to `volume-overlap`".
  For `containment`, both terms parity-test only the target B, "so a `containment` result — positive or
  negative — **can indict `target` only**".
- **3.9.5** **Open-component role table** (3580–3584): containment of A in B → open component belongs to A →
  `role:'source'`; containment of B in A → belongs to B → `role:'target'`. Which row applies "is a property
  of which term actually produced the positive, not of the pair in the abstract" (3585–3588).
- **3.9.6** "Note what is *not* covered by this: an open component on a containment-decided
  **`volume-overlap`** positive is **not a parity fault at all** — it was sampled, never parity-tested"
  (3570–3574). A fixture asserts the two don't collapse (3574, 3941–3945).
- **3.9.7** **Completeness vs. soundness split** (3590–3619): completeness diagnostics
  (`incomplete-component-coverage`, `inconclusive-containment`, `inconclusive-crossing`,
  `crossing-budget-exhausted`) "never attach to a positive"; soundness diagnostics
  (`unverified-parity-operand`, `unverified-open-component`) "apply in both directions".
- **3.9.8** "Diagnostics are emitted for **partially**-unresolved negatives, not only totally-unresolved
  ones … **any unresolved component or truncated examination that could have changed a negative result
  emits a pair diagnostic**" (3595–3600).
- **3.9.9** `inconclusive-crossing` is **redefined to cover two cases**: a probe classified `boundary`, OR
  no offset both stayed inside the source triangle and cleared `surfaceEpsilon`
  (`SurfaceCrossingWitness`) (3519–3521, 2496–2498, 3717–3723).
- **3.9.10** `geometry-too-large-for-sync-build` is **fragment-scoped and deduplicated** against a
  fragment-keyed set scoped to one `findClashes` call — "being oversized is a property of the geometry
  alone, not of the pairing, but the diagnostic still names the fragment … so one entry is emitted per
  oversized fragment no matter how many candidate pairs it appears in" (2938–2944).
- **3.9.11** `findClashes` "**always resolves `{ pairs, statistics }`**", with counters zeroed when there
  are no candidates (3621–3626); same for the no-fragments and no-rooms edge cases (3724–3732).

---

# 4. Synchronous-work / budget / scheduling

## 4.1 `frameBudgetMs` — what it is

- **4.1.1** `frameBudgetMs = 8` — "half the one-frame target, since a checkpoint can only fire *between*
  primitives, not preempt one" (2547, 2969–2971).
- **4.1.2** **One shared `performance.now()`-based accumulator per `findClashes` call** (2951–2969),
  measuring "accumulated synchronous time since the last yield"; when exceeded it `await`s a scheduling
  yield (`requestAnimationFrame`/`setTimeout(0)`).
- **4.1.3** **What is conditional is only the scheduling yield** (2036–2041): "A checkpoint that finds the
  accumulator not yet due **does not yield at all**; it lets whatever non-preemptible or abort-only unit
  follows it run to completion in the same span." The two-part lifecycle revalidation is not conditional
  (see 1.5.1).
- **4.1.4** The count-based budgets (`maxCandidatePairsExamined`, `maxCrossingPairsExamined`,
  `maxContainmentSamples`) "still bound each stage's total *work* — how much can happen at all — which the
  time-based checkpoints don't replace"; `frameBudgetMs` bounds their **composition** (2140–2148,
  2972–2975).
- **4.1.5** `frameBudgetMs` explicitly does **not** bound: (a) any single non-preemptible atomic
  operation's own cost (1932–1938, 1971–1995); (b) the two accepted ceiling-less atomic risks (2110–2125);
  (c) how many yields occur (a yield fires only when due — pinned by fixture 4037–4040).

## 4.2 The scheduling-class taxonomy (1966–2047)

Three tiers:

1. **Per-atomic-operation ceiling** (1971–1995) — non-preemptible primitives with no internal hook:
   `MeshBVH` build, welding, connectivity construction; each gets its own checkpoint *before* it, giving
   "each phase its own hard ceiling on *its own* cost". **Round 22 correction, normative**: an earlier draft
   concluded "so no phase ever compounds with another build phase in the same span" — "**false at the doc's
   own measured figures**" (1977–1990). Every *other* atomic primitive in a span (one raycast, one proximity
   check, one `classifyPoint`, one probe) "is expected to be a small fraction of a frame, but that
   expectation is **reasoned, not measured** … This spec does not claim it as fact" (1991–1995).
2. **Abort-only ceiling** (1996–2018) — `ProperCrossingQuery`'s `bvhcast`-native `intersectsTriangles`
   traversal. "its **own** duration is self-bounded independent of what ran before it — a private,
   traversal-local clock, deliberately not the shared accumulator …, worst case `frameBudgetMs` + one
   probe's own cost; **this is the one documented, deliberate exception to the shared-accumulator
   convention** every other checkpoint in this design follows". But "the checkpoint that decides *whether to
   start* that traversal at all … is the same conditional, shared-accumulator check".
3. **Cooperative-composition ceiling** (2019–2047) — what `frameBudgetMs` actually bounds; overshoot at any
   one checkpoint is bounded by **one atomic operation's own cost** thanks to round 11's per-primitive
   granularity, extended by round 15 (extraction, pre-scan) and round 18 (per-pair inside the broad-phase
   scan). "**Every checkpoint named in this document — the build-phase checkpoints and the `bvhcast`-entry
   checkpoints included — is this same mechanism**, except `bvhcast`'s own internal abort clock once a
   traversal is already under way."

- **4.2.1** **`SurfaceCrossingWitness`'s tier assignment** (2008–2018): "**`SurfaceCrossingWitness` is a
  second `bvhcast`-native traversal … but is not a second instance of this exception**: its own passage
  states its time-based abort checks *the shared* elapsed-time accumulator, at callback entry and before
  every probe — not a private clock. At that fine, per-probe granularity **it belongs to the
  cooperative-composition tier below** (bounded overshoot: one probe's own cost) rather than to this one,
  and contributes nothing beyond that tier's existing addend to the formula." Repeated at 2084–2086 and
  2129–2131.
- **4.2.2** The doc flags its own unresolved question here: "(Whether reading the shared accumulator inside a
  permanent, result-altering `bvhcast` abort — the same scheduling-position-dependent-verdict shape Round
  21's H-B7 fix moved `ProperCrossingQuery` away from — is itself sound is a **pre-existing question this
  re-derivation does not resolve**; it is a verdict-determinism concern, not a worst-case-span-bound one,
  and is out of this pass's scope.)" (2014–2018).
- **4.2.3** `[AMBIGUOUS]` — **`SurfaceCrossingWitness`'s scheduling class.** The tier it is assigned to
  (cooperative-composition) is defined by its *members'* ability to be paused: 2032–2033 — "It is a plain JS
  loop this library drives, so unlike the native traversals it can genuinely be paused rather than only
  aborted"; 2155–2158 — "abort-and-diagnose inside a synchronous native traversal that cannot pause, versus
  genuinely yield-and-resume in plain JS loops that can". `SurfaceCrossingWitness` is explicitly on the
  wrong side of that line: "**Being `bvhcast`-native, this traversal cannot `await`, yield, or resume**"
  (2515), and "it is its own `bvhcast`-native traversal, **non-resumable like `ProperCrossingQuery`'s**, and
  is checkpointed accordingly" (2401–2403). The doc reconciles this by tiering on *overshoot granularity*
  and *clock basis* rather than on pausability (2008–2014, 2150–2154), but the two membership criteria are
  never stated as separable, and 2151 lists it as a third thing alongside them ("The yield-and-resume
  mechanism, **and `SurfaceCrossingWitness`'s own abort-and-diagnose check**, read the shared per-call
  accumulator").
- **4.2.4** `[SILENT]` — **`SurfaceIntersectionQuery`'s traversal is absent from the entire taxonomy.** It
  is a third `bvhcast`-native traversal (the doc counts three: 4001–4005, "`ContainmentModeQuery`'s second
  composition term added a **third** traversal to the design"). It inherits "the same abort protocol"
  (1778–1779), which at 1863–1893 includes the time-based trigger on a **private, traversal-local clock**.
  But: it is **never named** in the abort-only tier (1996–2018), never named in the worst-case-span
  formula's tier list (2084–2093), never named in the "what the formula does bound" list (2127–2132),
  and never named in the clock-basis reconciliation at 2150–2154, which names only the yield-and-resume
  mechanism, `SurfaceCrossingWitness`, and `ProperCrossingQuery`. Whether its time-abort reads the private
  clock (by inheritance) or the shared accumulator (like the other witness traversal) is not stated.

## 4.3 The atomic-operations table (1940–1952) — verbatim inventory

| Row | Cost basis | Value | Class |
|---|---|---|---|
| `maxSyncTriangleCount` — compaction + welding | **Measured** ~16.8ms @ ~19,800 tri; compaction's own cost unmeasured but "bounded by the same ceiling and expected small relative to welding" | `12_000` | non-preemptible, own checkpoint |
| `maxSyncTriangleCount` — connectivity | **Measured** ~6.9ms @ ~19,800 tri | `12_000` | non-preemptible, independently lazy, "Never runs for `surface-intersection`-only sessions" |
| `maxSyncTriangleCount` — BVH | **Measured** ~16ms @ 18k tri | `12_000` | non-preemptible, "the one phase every mode needs" |
| `maxCandidatePairsExamined` | **Measured** ~0.3µs/pair | `50_000` | checked at callback entry, "adequate at that granularity" |
| one probe / one `classifyPoint` | **Reasoned, not yet measured** — "expected sub-millisecond" | — | checked before every occurrence |
| `maxFragmentsPerDbId` | **Reasoned, not yet measured** | `5_000` (provisional) | bounds **cumulative work across the walk only**; "does **not** bound any single node's own `enumNodeFragments` call" |
| one `enumNodeFragments(node, cb, false)` call | **Reasoned, not measured**; Round 18 correction: round 17's justification is **factually wrong** (`getInstanceCount`/`getFragmentCount` and the truthy-return interrupt both exist) | **— (no ceiling; accepted atomic risk — flagged for re-derivation)** | non-preemptible; "**unbounded by choice of scope, not by API limitation**"; follow-up required |
| `maxChildrenPerNode` | **Reasoned, not measured — and deliberately not derived from any existing measurement**; the `bvhcast` 0.3µs figure is explicitly **not** borrowed as a proxy | `10_000` (provisional) | **enforced by exactly one mechanism**: the in-callback abort inside non-recursive `enumNodeChildren`; `getChildCount` "**is removed from this enforcement path entirely**"; "**This spec does not claim `10_000` callbacks fit inside `frameBudgetMs`**" |
| `maxBroadPhaseInstancePairs` | **Reasoned, not measured**; one AABB test O(µs) | `1_000_000` (provisional) | pre-scan rejection via **overflow-safe division**; ceiling-case ≈1,000ms; "moves it from non-preemptible to **cooperatively yieldable**" via a per-pair checkpoint |
| `releaseEpochScopedState`/`dispose()`'s per-epoch registry sweep | **Unmeasured, uncategorized until Round 21** | **— (no ceiling; accepted atomic risk)** | non-preemptible; runs inside the Viewer's uncaught-throw-sensitive call frames; "**No checkpoint exists inside it — it is required to be non-throwing …, not preemptible**" |
| `maxCollisionInstancesPerEpoch` | **Reasoned, not measured** — "A synchronous size comparison … is O(1) per affected epoch" | **provisional, value not yet chosen** | pre-mutation call rejection; "bounds worst-case retained *count*, not retained *bytes*" |

- **4.3.1** The sweep row's own scope note (1951): "This cost model covers **only the `GeometryRegistry`
  half** of the sweep — the same step also performs an independent deletion over the `CollisionInstance`
  cache's own keyspace, which this row does not separately cost". For `evictModel` that deletion is one
  outer-`Map.delete(loadEpoch)`, **O(1)**; for `dispose()` it is one outer-`Map.clear()` over every live
  epoch's bucket at once, "**whether that scales with the number of live epochs … is unstated and
  unmeasured here**".
- **4.3.2** `[SILENT]` — **the `CollisionInstance` capacity admission's own synchronous cost is not in the
  table.** The row calls only the size comparison O(1) (1952), but the admission step also (a) recomputes
  which of the call's unique fragment ids are missing "against that bucket's *current* contents"
  (2860–2864, 1289–1293) and (b) constructs and commits **every** missing canonical instance "in that same
  synchronous step — no intervening `await`" (2865–2872, 1295–1300). Both are O(unique fragments in the
  call), bounded only by `maxFragmentsPerDbId × (number of requested dbIds)`, and neither is classified
  anywhere in the scheduling taxonomy, the atomic-operations table, or the worst-case-span formula.

## 4.4 The `bvhcast` traversal-local clock exception (1869–1901)

- **4.4.1** "A third, time-based trigger sets the same `aborted` flag: elapsed synchronous time since **the
  traversal's own start** exceeding `frameBudgetMs`" (1869–1870).
- **4.4.2** The rationale for a private clock: a time-based abort here "is **destructive**: it permanently
  ends the traversal and turns a would-be result into a diagnosed `crossing-budget-exhausted` negative".
  Reading the shared accumulator would make that abort "a function of the traversal's arrival time … not of
  this traversal's own work: two calls presented with the identical pair could reach opposite verdicts
  depending on what else ran first" (1871–1881).
- **4.4.3** Its own worst case: "at most `frameBudgetMs` + one probe's own cost, **not a separately-derived
  factor of two**" (1881–1884). "**This corrects an earlier draft of this passage, which asserted the
  traversal's own worst case at ~2×`frameBudgetMs` with no derivation reproducing that factor**"
  (1884–1888).
- **4.4.4** Admitting it to the abort-only tier "does not increase the worst-case-span formula's controlling
  unit-cost term: at the Round 22 measurements, the independently measured ~16.8ms weld phase remains larger
  than this traversal's own `frameBudgetMs` + one probe worst case" (1888–1894).
- **4.4.5** Granularity: the check "is read **before each individual probe** …, not once per callback and
  not once per confirmed pair. A raw candidate pair that never reaches probe classification is still checked
  at callback entry" (1908–1913). "**This bounds the overshoot to one probe's cost (up to two `classifyPoint`
  calls), not one confirmed pair's cost (up to 24)**" (1922–1923) — with the caveat that a single
  `classifyPoint`'s cost "is reasoned but not yet measured" (1923–1926).

## 4.5 The worst-case-synchronous-span derivation (2049–2138)

- **4.5.1** **Formula** (2049–2054): "the worst-case single synchronous span is `frameBudgetMs + [worst-case
  cost of the one non-preemptible or abort-only atomic unit, if any, that immediately follows a checkpoint
  which found the accumulator not yet due]`, **not** the two-term
  `max(frameBudgetMs + one small atomic operation's cost, one build-phase's own cost)` this section stated
  through Round 21."
- **4.5.2** Per-tier addends (2061–2093):
  - cooperatively-yieldable tier → one small atomic op's own cost, sub-millisecond;
  - enforceably-bounded non-preemptible tier → that unit's own worst case. Three of its four members are
    measured; **welding is the largest at ~16.8ms**, measured at ~19,800 triangles, "**not at the `12_000`
    sync-triangle ceiling itself; scaled down to the ceiling the true cost is smaller (~10.2ms), so using
    the as-measured ~16.8ms figure here is conservative, not tight**". `8 + 16.8 = 24.8ms` → **≈24ms**.
    "**The fourth member, one `enumNodeChildren` call at the `maxChildrenPerNode` ceiling, is not one of the
    three measured costs this ≈24ms is computed from**" — "**≈24ms is provisional for it specifically until
    the performance gate measures it** (gate criterion 7)".
  - abort-only tier → `frameBudgetMs` + (`frameBudgetMs` + one probe) ≈ **~16ms**, "comfortably under the
    enforceably-bounded tier's controlling ≈24ms figure".
- **4.5.3** **"Any number of checkpointed units may share a synchronous span — not only one"** (2095–2108).
  The prior claim that only one such unit could absorb prior undischarged work is "**false at the doc's own
  measured figures**" — connectivity (~6.9ms) is itself below `frameBudgetMs` (8). The bound is derived
  structurally: "whichever unit is *last* in the span, the checkpoint immediately before it did not yield,
  so the aggregate cost of every unit that ran earlier in that same span is itself below `frameBudgetMs` …
  The span's total is therefore that sub-`frameBudgetMs` prefix plus the last unit's own cost, which is at
  most `frameBudgetMs` + `Cmax`". Concrete counterexample given at 1355–1360: connectivity (~6.9ms) + BVH
  (~16ms) ≈ **22.9ms** in one span.
- **4.5.4** **The formula is explicitly NOT a whole-design guarantee** (2110–2125): "**This corrected formula
  is still not a finite worst-case-span guarantee for the whole design, and Round 22 does not claim it is
  one**". Two rows have no ceiling — one `enumNodeFragments(node, cb, false)` call, and
  `releaseEpochScopedState`/`dispose()`'s per-epoch sweep — "for which **this spec claims no bound and
  accepts the cost as a Milestone-1 risk**. Both rows … are **explicitly excluded from the formula above and
  from any finite worst-case-span guarantee this spec makes**." A pathological model "can produce a single
  synchronous span longer than the formula's value **by a margin this spec does not state, because it does
  not know it**."
- **4.5.5** What the formula **does** bound (2127–2136): the three build phases, the
  `maxChildrenPerNode`-capped `enumNodeChildren` call, `ProperCrossingQuery`'s traversal's self-bound, the
  chunked broad-phase scan, and the per-primitive checkpoints — "Even over those it is only as good as the
  table's unmeasured rows".
- **4.5.6** `[CONTRADICTION]` — **whether the budgets bound the worst case.**
  - **Side A (normative, budget section):** 2110–2125, quoted above — no finite worst-case-span guarantee;
    two ceiling-less rows explicitly excluded; "this design still cannot prove a global bound" (782–783
    `[changelog]`, echoing it).
  - **Side B (normative, Risks):** 4628–4630 — "**With `maxCandidatePairsExamined` added this round, the
    budgets do now bound the worst case** — but note that claim was made in round 5 and was **false when
    written** … Treat 'the budgets bound it' as a property to re-verify whenever a new traversal is added,
    not as a standing invariant." The Risks entry's first clause asserts, in the present tense, exactly what
    the budget section says the design cannot claim. (The same Risks bullet is what 2137–2138 cites as "the
    concrete reason for the standing warning under **Risks**" — i.e. the budget section cites the second
    half of the sentence while the first half contradicts it.)
- **4.5.7** `[CONTRADICTION]` — **the gate criterion figure quoted inside the broad-phase passage.**
  - Data Flow step 3, 2893–2898 (normative body, unannotated): "At this table's own stated O(µs) per
    AABB-overlap test, `1_000_000` pairs is roughly **1,000ms** of uninterruptible synchronous work — the
    largest single span in this design, about **60× the performance gate's own ~16ms pass criterion**".
  - Atomic-operations table, `maxBroadPhaseInstancePairs` row (1950): "~1,000ms, **~40× the gate's own
    ≈24ms worst-case-span bound** (Round 18's own comparison used this document's then-current ~16ms figure,
    superseded by Round 22's re-derivation; the conclusion is unchanged either way)".
  - Performance gate, 4436–4443: the pass/fail line is **24.8ms**, "not the ≈16ms this criterion stated
    through Round 21".
  The table row carries the superseded-annotation; the Data Flow instance does not, and states `~16ms` as
  the gate's *current* pass criterion.

## 4.6 The broad-phase scan (2884–2932)

- **4.6.1** Pre-scan rejection: `sourceInstances.length × targetInstances.length` vs
  `maxBroadPhaseInstancePairs`, "using **overflow-safe division** (`sourceInstances.length >
  maxBroadPhaseInstancePairs / targetInstances.length`) rather than computing the product directly"
  (2884–2890). "**`maxBroadPhaseInstancePairs` remains a pre-scan rejection**, computed once by
  overflow-safe division against instance-array lengths captured before the scan begins, **never a mid-scan
  cutoff**" (2921–2922).
- **4.6.2** Inner checkpoint **before each individual instance pair**, yielding and resuming "from exactly
  the `(sourceIndex, targetIndex)` it left off at" (2900–2906). Per-pair rather than batched is deliberate
  (2906–2910).
- **4.6.3** `[SILENT]`-adjacent, but explicitly acknowledged: "The cost of a `performance.now()` read
  relative to one AABB-overlap test is **unmeasured**; if the gate finds the clock read materially
  dominates, batching may be reintroduced **only** with a measured per-batch cost and the composition bound
  restated as `frameBudgetMs + one full batch`, never silently" (2910–2913).
- **4.6.4** Three load-bearing non-changes (2917–2932): yielding **never truncates** the scan ("a time check
  used as a cutoff here would silently drop candidate pairs, which is a false negative, not a budget");
  the ceiling stays a pre-scan rejection; and mid-scan suspension is safe **only because** each
  `PlacedCollisionInstance`'s matrix and bounds are per-call, call-owned snapshots. "The lifecycle
  checkpoint catches eviction and disposal; it does **not** catch a transform, explode, or visibility change
  mid-scan, and the snapshot is what makes that harmless rather than a torn read" (2930–2932).

## 4.7 Performance-gate criteria (4419–4558)

Two runs required — cold and cache-warm (4419–4433). Ten pass-criterion bullets:

| # | Line | Criterion |
|---|---|---|
| 1 | 4436 | no single synchronous task exceeds **24.8ms** (`8 + 16.8`) — "**this criterion's own pass/fail line is the literal 24.8ms, not the rounded-down ≈24ms shorthand**"; measured on **both** runs; **except** the two explicitly excluded accepted-risk spans, for which an over-bound measurement "is a required recorded finding, not a gate failure"; **with one provisional exception**, the `enumNodeChildren` call at the fanout ceiling (criterion 7) |
| 2 | 4458 | any budget that trips does so with the correct diagnostic rather than a freeze or a fabricated clash |
| 3 | 4460 | measured per-candidate and per-build costs recorded next to `measure.mjs`'s synthetic figures |
| 4 | 4462 | worst-case cost of **one `classifyPoint` call, one crossing probe, and one `SurfaceCrossingWitness` in-triangle probe** measured directly; "a run whose measured per-call cost turns out non-negligible is itself an acceptance finding, not a pass" |
| 5 | 4476 | **each of the three build phases measured individually, at `maxSyncTriangleCount`**; a connectivity-measuring cold run (either `containment` **or** `volume-overlap`) must be distinguished from a `surface-intersection`-only run |
| 6 | 4486 | extraction cost for the largest single requested dbId; the broad-phase scan's cost **and its longest uninterrupted span between two consecutive yields**; the extraction walk's **longest uninterrupted span between two consecutive per-sibling-node checkpoints**; the `performance.now()`-vs-AABB-test cost ratio; the candidate-list size at the ceiling |
| 7 | 4506 | **one `enumNodeChildren(node, cb, false)` call at the fanout ceiling**, measured separately — `maxChildrenPerNode + 1` invocations on the widest node, **plus an assertion that the abort actually fires**; "The installed typings declare the callback's return as `void`, contradicting the Reference Guide's documented truthy-return interrupt, so this is a behaviour the gate must **observe** rather than trust" |
| 8 | 4519 | **one `enumNodeFragments(node, cb, false)` call**, on the node owning the most direct fragments the model allows |
| 9 | 4527 | **`releaseEpochScopedState`/`dispose()`'s per-epoch sweep**, from **both** call sites; `dispose()`'s measurement "must additionally vary the number of *simultaneously live epochs* at teardown" |
| 10 | 4540 | **the `CollisionInstance` identity cache's retained size, per epoch, across a realistic session** — steady-state ceiling, not one call's marginal cost |

- **4.7.1** For criteria 7, 8, 9 and 10 the doc repeats: a model that cannot exercise the risk at scale means
  "recording that limitation is itself a gate finding, not a pass" (4516–4518, 4524–4526, 4537–4539,
  4547–4549).
- **4.7.2** Closing clause: the MEP numbers "replace the 'reasoned, not yet measured' qualifier on every
  still-unmeasured row … this milestone cannot claim that table's unmeasured rows as verified until this
  gate has run once, and `maxSyncTriangleCount`'s `12_000` value specifically remains provisional until it
  has" (4551–4554).

## 4.8 Accepted-unbounded vs. genuinely bounded — summary

| Genuinely bounded (enforced) | Accepted-but-unbounded |
|---|---|
| three `maxSyncTriangleCount` build phases (measured) | one `enumNodeFragments(node, cb, false)` call — "no ceiling; accepted atomic risk — **flagged for re-derivation**" (1948, 2830–2849, 3649–3653) |
| `maxChildrenPerNode`-capped `enumNodeChildren` (enforced, unmeasured) | `releaseEpochScopedState`/`dispose()` per-epoch sweep — "no ceiling; accepted atomic risk" (1951) |
| `maxCandidatePairsExamined` / `maxCrossingPairsExamined` / `maxContainmentSamples` (count-based) | total retained `CollisionInstance` count across all live epochs = `maxCollisionInstancesPerEpoch × (live epochs)`, "**unceilinged**" (1284–1288) |
| `maxFragmentsPerDbId` (cumulative walk work only) | `dispose()`'s `CollisionInstance`-cache clear scaling with live-epoch count — "unstated and unmeasured" (1951, 2119–2123) |
| `maxBroadPhaseInstancePairs` + per-pair checkpoint | the capacity-admission commit's own O(missing) synchronous step (see 4.3.2) `[SILENT]` |
| `ProperCrossingQuery` traversal's private-clock self-bound | `SurfaceIntersectionQuery`'s traversal — unclassified (see 4.2.4) `[SILENT]` |

---

# 5. Cache ownership / cleanup / concurrency

## 5.1 The `CollisionInstance` identity cache (1246–1306)

- **5.1.1** **Identity and immutability**: "`CollisionInstance`s are canonical, immutable identity objects
  cached per **`(loadEpoch, fragmentId)`** — mirroring `GeometryRegistry`'s epoch-based keying for the same
  race-safety reason — so repeated `findClashes` calls against the same admitted `Model` object receive the
  **same object reference** for a given fragment" (1246–1250).
- **5.1.2** **Contents**: "only its `fragmentId` and an immutable `GeometryIdentity { loadEpoch,
  geometryIndex }`; **both the instance and its nested identity value are frozen after construction**. **It
  contains no `Model`, `GeometryRecord`, BLAS, world matrix, world bounds, or other call-varying or mutable
  state**" (1250–1253). Geometry is resolved lazily through `GeometryRegistry` from the identity, "after the
  caller's normal disposed/epoch liveness check" (1253–1255).
- **5.1.3** "A cache hit returns the existing object unchanged — **no `findClashes` call ever writes through
  a cached `CollisionInstance`**" (1257–1258).
- **5.1.4** **Placement is call-local, never cached** (1260–1268): each call builds fresh
  `PlacedCollisionInstance` values `{ instance, worldMatrix, worldBounds }` "with newly owned matrix and
  bounds objects copied from `fragList.getWorldMatrix`/`getWorldBounds` during that call's extraction".
  Broad and narrow phases "consume these placement values, never matrix or bounds fields off the canonical
  `CollisionInstance` (which has none)". "Source and target placement arrays are owned solely by their call
  and remain unchanged across its yields — this is what preserves the per-call snapshot guarantee …
  concurrent calls may share the same immutable `instance` reference while each holds its own independent
  transform snapshot, and neither call can overwrite state the other resumes with." Pinned by fixture
  4278–4286.
- **5.1.5** **Physical partitioning**: `Map<loadEpoch, Map<fragmentId, CollisionInstance>>`, "**not one flat
  map**" (1270–1272).
- **5.1.6** **Release is its own operation, independent of `GeometryRegistry`** (1272–1280): each release
  path deletes "exactly the outgoing epoch's bucket (`evictModel`) or every bucket (`dispose`) — **not**
  derived from a `GeometryRegistry` scan, a geometry reference count, a numeric `modelId`, or
  `liveModelByModelId`". Rationale: this cache's keyspace is "built from every collected fragment, **a
  strict superset of `GeometryRegistry`'s lazily-built candidate-pair keyspace**" — a registry-derived
  release could not honor it.
- **5.1.7** **Never individually evicted** while its epoch is live: "doing so would break the
  stable-reference guarantee … so capacity is recovered only by epoch eviction or whole-world disposal, the
  same two release paths every other epoch-scoped cache in this design uses" (1303–1306).

## 5.2 Epoch-scoped capacity: the check-and-commit ordering (1282–1306, 2851–2883)

The normative four-phase sequence (2856–2876), with the Components restatement at 1289–1302:

1. **While walking**, capture for each unique fragment "not just its id but everything a canonical instance
   or a placement will need — `fragmentId`, `GeometryIdentity` (`loadEpoch` + `geometryIndex`), and **this
   call's own `worldMatrix`/`worldBounds` snapshot** — so no later phase needs to call back into `fragList`
   or any other Viewer getter" (2856–2859).
2. **After every requested dbId's walk has completed** — "never per dbId, per node, or per fragment"
   (2852–2853) — **and after the walk's last possible yield** (2860), look up the affected epoch's bucket
   **without creating it**, and **recompute** which of the call's unique fragment ids are still missing
   "**against that bucket's *current* contents, not a count carried over from earlier in the walk**. A
   concurrent call's commits during any of the walk's own yields can otherwise leave an earlier count
   stale" (2860–2864).
3. **In that same synchronous step — "no intervening `await`, no call out to any external callback, getter,
   or other reentrant operation"** — check `currentBucketSize + uniqueMissingCount` against
   `maxCollisionInstancesPerEpoch`. On exceed, **reject the entire call now**: "**no bucket is created, no
   canonical instance is constructed, and no `PlacedCollisionInstance` is constructed for any fragment in
   the query**". Otherwise create the bucket if absent and construct+publish every missing canonical
   instance "entirely from the inputs phase 1 captured" (2865–2872, 1295–1300).
4. **Only after that admission succeeds**, build this call's `PlacedCollisionInstance` values (2873–2876).

- **5.2.1** The atomicity purpose is stated: "so two concurrent calls cannot both pass against the same
  stale capacity observation" (1298–1300, 1952).
- **5.2.2** "**'Look up or create,' applied to this cache anywhere else in this document, means exactly this
  sequence** — a lookup that finds nothing stages nothing on its own; the instance is only ever constructed
  during phase 3's admission, never earlier and never partially" (2878–2880).
- **5.2.3** **Scope limit of the zero-mutation guarantee**, stated twice: "This zero-mutation guarantee is
  specific to a capacity rejection — a later failure in placement construction or in the broad-/narrow-phase
  work that follows **can still leave already-admitted canonical instances resident**, and is not covered by
  it" (1301–1303, 2880–2883).
- **5.2.4** **Retention is bounded per epoch, not in total** (1282–1288): the ceiling "does not ceiling how
  many epochs are simultaneously live — the design explicitly supports two objects sharing a reused
  `modelId` both live at once … so total retained instance count across all live epochs is
  `maxCollisionInstancesPerEpoch × (live epochs)`, **unceilinged**".
- **5.2.5** `[AMBIGUOUS]` — **singular vs. plural "affected epoch."** Data Flow says "the affected epoch's
  bucket" throughout (2860–2867), consistent with Milestone 1's `source.model === target.model` restriction
  yielding exactly one epoch per call. The atomic-operations table says "if publishing the call's missing
  instances would push **any affected epoch's** bucket over the limit … O(1) **per affected epoch**"
  (1952), and Components says "**the affected epoch**" (1290, 1295–1296). Whether the plural phrasing is
  forward-looking (a future cross-model milestone) or implies a currently-reachable multi-epoch call is not
  stated.
- **5.2.6** `[SILENT]` — `maxCollisionInstancesPerEpoch`'s **value is not chosen**: "provisional, value not
  yet chosen" (1952); the gate is what must set it (4540–4549).
- **5.2.7** `[SILENT]` — the capacity rejection carries **no named error class** (3678–3684); self-labelled
  in-text as "the same `[SILENT]` gap" shared with `maxFragmentsPerDbId`, `maxChildrenPerNode` and
  `maxBroadPhaseInstancePairs`. See 0.5 and 1.6.3.

## 5.3 Release completeness across all caches

| Cache | `evictModel` (epoch-scoped) | `dispose()` (wholesale) |
|---|---|---|
| `GeometryRegistry` | every entry filed under that epoch — `'building'`, `'ready'`, **plus any oversized marking**; signal rejected first for `'building'`/`'ready'`; identity-guarded delete (3116–3134) | single clear; same signal rule; same oversized carve-out (3224–3241, 3433–3441) |
| `BlasCache` | released "together with" each removed registry entry, "where it has any" (3118–3120) | its own single clear operation (3224–3226, 3429–3431) |
| cached `GeometryConnectivity` | same as BLAS (3118–3120) | its own single clear operation (3224–3226, 3429–3431) |
| `CollisionInstance` identity cache | **independent operation over a different keyspace**, "not derived from this `GeometryRegistry` sweep"; deletes the outgoing epoch's bucket (3120–3124, 1272–1280) | included in the four-cache clear; one outer-`Map.clear()` over every live epoch's bucket (3224–3226, 1951) |
| extension-owned room cache (`Map<Model, Promise<number[]>>`) | **not touched** by `evictModel`; the handler drops the entry itself, unconditionally (3192–3194, 3489–3492) | **`world.dispose()` never touches it** (3192–3193); `unload()` clears it as its third step (3462–3463) |

- **5.3.1** Both sweeps are **required to be non-throwing** (3145–3150, 3228–3231); neither is preemptible
  ("No checkpoint exists inside it", 1951).
- **5.3.2** `[SILENT]` — see 2.6.4: no statement establishes that `BlasCache`'s and the connectivity cache's
  keyspaces are subsets of `GeometryRegistry`'s, which is what makes a registry-derived `evictModel` release
  complete. The `CollisionInstance` cache received exactly such a statement (a superset argument, 1276–1280)
  precisely because a derived release would have leaked; no corresponding analysis exists for these two.
- **5.3.3** `[SILENT]` — the **extension-owned room cache has no capacity ceiling and no eviction policy
  other than per-model deletion and `unload()`'s clear.** Nothing bounds how many `Model` keys it can
  accumulate; it is not one of the "four caches" `dispose()` clears.

## 5.4 Concurrency invariants

- **5.4.1** **Shared identity, private placement** — the redesign's core property (1264–1268, 2923–2930,
  fixture 4278–4286): "two concurrent calls sharing the same canonical `CollisionInstance` reference never
  observe or mutate each other's placement snapshots."
- **5.4.2** **Single-flight phase slots** are the sole dedup mechanism for concurrent builds (1384–1389,
  1502–1512), pinned by fixtures 4073–4085.
- **5.4.3** **Entry-scoped cancellation broadcasts to every waiter**: fixture 4114–4123 — "the entry-scoped
  cancellation signal must be rejected **exactly once**; **both** `findClashes` promises must reject with
  `ModelEvictedError`, neither may remain pending, and the evicted entry must no longer be present in
  `GeometryRegistry`. Build spies must show the shared phase was started only once."
- **5.4.4** **The capacity check-and-commit is the only stated cross-call atomicity requirement** outside
  the build slots (5.2.3). Its guarantee is scoped strictly to capacity rejection.
- **5.4.5** **Stale-eviction fixture** (4266–4277) is what the frozen-identity design exists to satisfy:
  after a stale `evictModel(oldModel)`, the new object's cache entries must be "**same canonical object
  references** (per `(loadEpoch, fragmentId)` for `CollisionInstance`, per `(loadEpoch, geometryIndex)` for
  the registry), no rebuild triggered — and a `findClashes` call against the new object immediately after
  must succeed without a fresh BLAS build **and constructs a fresh, call-local `PlacedCollisionInstance`
  for each fragment as normal**".
- **5.4.6** `[AMBIGUOUS]` — **"cross-model query rejects synchronously."** Error Handling 3727–3729 says
  "`findClashes` **rejects synchronously** rather than silently computing a meaningless result", while the
  Public API declares `findClashes(query): Promise<ClashResult>` (3000) and Data Flow says "reject
  immediately" (2726). Whether "synchronously" means a thrown exception before the promise is constructed,
  or a promise rejected without any await, is not stated. (The same distinction applies to `admitModel`,
  which is explicitly synchronous and **throws**, 3039–3048.)

---

## Appendix — marker index

**`[CONTRADICTION]` — 3**

| Ref | Subject | Sites |
|---|---|---|
| 3.5.7 | `containment` mode: is a non-manifold/open **source** component diagnosable on a negative? | 2269–2272 + 1647 + 3022–3024 (never diagnosed) **vs.** 3692–3696 (`non-manifold-component` on a containment-mode source) |
| 4.5.6 | Do the budgets bound the worst case? | 2110–2125 (no finite guarantee; two rows excluded) **vs.** 4628–4630 (Risks: "the budgets do now bound the worst case") |
| 4.5.7 | The gate's current pass criterion cited inside the broad-phase passage | 2893–2898 (`~16ms`, unannotated) **vs.** 1950 (`≈24ms`, annotated) + 4436–4443 (`24.8ms` literal) |

**`[AMBIGUOUS]` — 7**

| Ref | Subject | Sites |
|---|---|---|
| 2.4.8 | Where the `maxSyncTriangleCount` ceiling check physically lives (narrow phase vs. registry build path); whether a `'building'` entry is ever inserted for a geometry that turns out oversized | 2933–2944 vs. 1460–1478, 1517–1520 |
| 2.6.3 | Is `BlasCache` a distinct keyspace or the storage behind `accelerationPromise`? | 3224–3226, 3335–3336 vs. 1229–1231, 1504–1512 |
| 3.2.6 | "Certified closed manifold" as an operand-level predicate read off a per-component flag; no aggregation rule for multi-component operands | 2283, 1602, 2213–2215 vs. 1752–1756, 2291–2293 |
| 3.7.8 | Is `maxCrossingPairsExamined` traversal-local? (stated for `candidatePairsExamined`, not for the crossing counter, in either traversal) | 2508–2511, 1776–1777, 1852–1853 |
| 4.2.3 | `SurfaceCrossingWitness`'s scheduling class — abort-only mechanism assigned to the "cooperatively-yieldable" tier whose stated membership criterion is pausability | 2008–2018, 2084–2086, 2129–2131 vs. 2032–2033, 2155–2158, 2401–2403, 2515 |
| 5.2.5 | "the affected epoch" (singular) vs. "any affected epoch" (plural) | 2860–2867, 1290 vs. 1952 |
| 5.4.6 | "Rejects synchronously" for a `Promise`-returning method | 3727–3729 vs. 3000, 2726 |

**`[SILENT]` — 13**

| Ref | Subject | Nearest cited context |
|---|---|---|
| 1.4.18 | No constructor signature/payload stated for `WorldDisposedError`; `ModelEvictedError`'s only literal is one call site | 2672, 3385 |
| 1.5.2 | Whether the abort-only `bvhcast` checkpoints (#9, #10, #13) perform the two-part `disposed`/epoch revalidation the universal rule claims is never skipped | 1908–1920, 2515–2520 vs. 2034–2035, 2039–2041 |
| 1.6.3 / 5.2.7 | No named error class for the four call-level ceiling rejections — self-labelled in-text with a literal `[SILENT]` marker | 3678–3684 |
| 1.8.4 | Whether `unload()` can be invoked twice; per-step isolation; listener-removal ordering — all "unstated"/"remain open" | 3483–3487 |
| 1.8.6 | Whether the app reloads the extension after `tearDown()` — "neither is decided here" | 2578–2582 |
| 1.8.13 | `BEFORE_MODEL_UNLOAD_EVENT` payload shape (`event.model`) unverified | 2610–2615, 4575–4581 |
| 2.1.4 | `referenceCount` — reserved, unused, no semantics anywhere | 1225–1227 |
| 2.2.2 | Whether an oversized marking is ever re-evaluated or replaced within a live epoch | 1444–1452 |
| 2.6.4 / 5.3.2 | No keyspace-relationship statement for `BlasCache`/connectivity vs. `GeometryRegistry` (the analysis the `CollisionInstance` cache received) | 3118–3120 vs. 1276–1280 |
| 2.7.5 | Instance-tree readiness at extraction time — deferred to implementation, no code path checks it | 4582–4590, 1112–1118 |
| 4.2.4 | `SurfaceIntersectionQuery`'s `bvhcast` traversal absent from the scheduling-class taxonomy, the abort-only tier, the worst-case-span formula, and the clock-basis reconciliation | 1775–1783 vs. 1996–2018, 2084–2093, 2127–2132, 2150–2154 |
| 4.3.2 | The `CollisionInstance` capacity admission's own O(unique-fragments) recompute-and-commit step is unclassified in the taxonomy, the atomic table, and the span formula | 2860–2872, 1289–1300 vs. 1952 |
| 5.3.3 | The extension-owned room cache has no capacity ceiling or eviction policy; not among `dispose()`'s four caches | 2598–2603, 3192–3194 |

**Totals: 3 `[CONTRADICTION]`, 7 `[AMBIGUOUS]`, 13 `[SILENT]` — 23 markers.**
