# Consolidated Invariant Model — Collision Library Milestone 1 (post-Round-20)

**Built fresh** from `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` as it exists
at 4017 lines, after the Round-20 Critical-only fix pass (finding C-5 from `invariant-audit-v3.md`). No
content was carried forward from `invariant-audit-v1.md`, `invariant-audit-v2.md`, or
`invariant-audit-v3-model.md`; every `line N` citation below was read directly from the current file during
this pass. Those prior models were consulted **only** for section-structure convention, after this model's
content was already extracted.

**Scope discipline.** This is pure extraction. Where the spec says two things, both are recorded, marked
`[CONTRADICTION]`. Where it is under-determined, `[AMBIGUOUS]`. Where it says nothing, `[SILENT]`. Nothing
here is adjudicated, severity-rated, or repaired — that is the next step's job. Every marker is repeated in
the Appendix for triage.

---

## Reading note — the document's own structure at this revision

| Lines | Section |
|---|---|
| 1–21 | Title / Status header |
| 23–636 | **Revision Notes (post-review)** — Rounds 1–19. Sub-entries at 25 (R1), 38 (R2), 66 (R3), 95 (R4), 130 (R5), 162 (R6), 191 (R9), 223 (R10), 260 (R11), 294 (R12), 329 (R13), 359 (R14), 390 (R15), 433 (R16), 475 (R17), 518 (R18), 579 (R19). **There is no Round 7, Round 8, or Round 20 entry.** |
| 637–710 | Spike Findings (executable, `spike/`) |
| 711–737 | Purpose |
| 738–758 | Background |
| 759–791 | Milestone Scope |
| 792–906 | Architecture (runtime split, repo layout, dependency pins, vendor plan) |
| 907–1278 | **Components** — `ViewerModelAdapter` 909–974; `ViewerGeometryAdapter` 976–1055; `GeometryRegistry`/`GeometryIdentity` 1057–1076; `ThreeMeshBvhBackend`/`BlasCache` 1078–1277 |
| 1279–1332 | Tolerances (table at 1305–1314) |
| 1333–1379 | Solid model |
| 1380–2113 | **Query modes and their preconditions** — mode table 1382–1386; welding 1430–1469; `GeometryConnectivity` 1471–1494; `SurfaceIntersectionQuery` 1496–1520; `ProperCrossingQuery` 1522–1752 (atomic-ops table 1653–1663); `ContainmentQuery` 1754–1984; `VolumeOverlapQuery` 1986–2022; `ContainmentModeQuery` 2024–2105; `CollisionWorld` 2107–2112 |
| 2114–2468 | Data Flow — Room Locate Query (step 1: 2116–2236; step 2: 2237–2247; step 3: 2248–2465; step 4: 2466–2467) |
| 2469–3048 | **Public API** — TS block 2471–2707; "Race safety" prose 2709–2896; `RoomLocatorExtension` sketch 2898–2927; diagnostics 2929–3047 |
| 3049–3201 | Error Handling & Edge Cases |
| 3203–3876 | Testing & Verification (unit 3205–3777; integration 3778–3789; performance gate 3791–3876) |
| 3878–3959 | Risks |
| 3961–4017 | Open Questions Deferred to Future Milestones |

**Structural observation about the changelog itself.** The Status header (lines 3–19) still reads
"revised after **seventeen** rounds of codex review", describes Round 18 as the most recent fix pass
("**This is 'Round 18' below**", line 7), and names only `invariant-audit-v1.md` / `invariant-audit-v2.md`.
It does not mention Round 19, `invariant-audit-v3.md`, or the Round-20 pass. Round 19's own entry
(579–635) does forward-reference `invariant-audit-v3.md` (line 634). **`[SILENT]` — no `### Round 20`
entry exists anywhere in the Revision Notes; the C-5 fix that just landed in the normative text is
unrecorded in this document's own changelog, breaking the pattern every prior fix pass followed
(Rounds 18 and 19 each got one).** Grep for `Round 20` / `round 20` / `invariant-audit-v4` returns zero
hits across all 4017 lines.

**Naming collision worth flagging up front for the auditing agents.** Round 18's entry uses the labels
"C4, C5" (line 553) for findings from `invariant-audit-v1.md`. The fix just landed is C-**5** from
`invariant-audit-v3.md` — a completely different finding (oversized markings vs. cancellation signal).
Do not conflate line 553–564's "C5" (extraction / `getChildCount` preflight) with the Round-20 C-5.
Round 19's entry uses "C-1 … C-4" for `invariant-audit-v2.md` findings, and the normative text refers to
those as "finding C-1" (lines 1660, 1662, 2270, 2329, 2362, 3079, 3566) and "C-2" (3492) — so the
document's inline labels are `invariant-audit-v2` labels, while Round 18's changelog labels are
`invariant-audit-v1` labels. `[AMBIGUOUS]` — no disambiguating convention is stated in the document.

---

# 1. Model / world lifecycle

## 1.1 The two axes

**World axis:** `constructed → disposed`. `disposed: boolean` is a world-level terminal flag (2757–2759,
2671–2674). `dispose()` sets it **first, synchronously, before anything else** (2672–2673, 2858–2859,
3164–3165). It is "the system's single authoritative liveness signal rather than one input among several"
(2757–2759) and "this single write is now sufficient correctness-wise, on its own, for every check
anywhere in the system" (2859–2861).

**Model axis:** `(no entry) → live → evicted`, keyed by the exact `Model` **object**, never by `modelId`
(2726, 2729–2744).

```
modelLifecycle: WeakMap<Model, { state: 'live'; epoch: number } | { state: 'evicted' }>   (2729–2730)
```

- No entry at all = "never admitted *or* evicted — a legitimate first use, the only case `findClashes`
  treats as 'admit fresh'" (2737–2739).
- `'live'` carries `epoch: number`. `'evicted'` **carries no epoch at all** (2571–2574, 2730–2735) —
  "because nothing ever needs to compare one: every liveness/lease check short-circuits on
  `state !== 'live'` before it would ever read `.epoch`" (2573–2574).
- Transition is one-way and permanent: "it never deletes this entry" (2736); "permanently dead in this
  world: nothing re-admits it, ever, because nothing ever clears or overwrites it back to `'live'`"
  (2739–2740).
- `WeakMap` is chosen so "permanent" is free rather than a leak (2741–2744) — **and this is exactly why
  nothing may depend on enumerating `modelLifecycle`** (2743–2744).

**No `'disposed'` state exists on the model axis.** Disposal is world-level only.

## 1.2 World-owned lifecycle state (inventory)

| Name | Type / shape | Cited | Role |
|---|---|---|---|
| `modelLifecycle` | `WeakMap<Model, {state:'live';epoch:number} \| {state:'evicted'}>` | 2729–2744 | authoritative per-object liveness; non-enumerable by design |
| `liveModelByModelId` | `Map<modelId, Model>` | 2745–2756 | **diagnostic/bookkeeping only**; "load-bearing for nothing" (410–411), "no correctness property … depends on this map's completeness anymore" (2751–2752) |
| `disposed` | `boolean` | 2757–2759 | world terminal flag; checked first everywhere |
| `nextLoadEpoch` | number counter, global to the `CollisionWorld` instance, only ever increments, never reset or scoped per `modelId` | 2760–2765 | `epoch = nextLoadEpoch++` on first admission (2761); guarantees a reused `modelId` still gets a strictly greater epoch (2762–2764) |

## 1.3 `ModelLease`

`{ model, epoch }` (2508, 2778) — "an opaque capture of this exact object's current lifecycle state, valid
until the object is evicted or the world is disposed" (2508–2509).

## 1.4 Public method contracts

### `world.admitModel(model): ModelLease` (2507–2525)

Synchronous, idempotent. Three outcomes **checked in this order** (2511):
1. world disposed → **throws `WorldDisposedError`** (2512)
2. this exact object tombstoned `'evicted'` → **throws `ModelEvictedError`**, immediately, without
   assigning a new epoch — "a model that was ever evicted can never be re-leased" (2513–2514)
3. otherwise → admits if not already admitted (`epoch = nextLoadEpoch++`, records `liveModelByModelId`,
   "same lazy-admission path `findClashes`'s entry check uses") and returns the possibly-pre-existing
   lease (2515–2517)

Idempotence: "calling it again for an already-live object returns a lease with that same epoch (does not
re-admit or reassign)" (2509–2510). Pinned by fixture 3650–3652 (spy: `nextLoadEpoch` consumed once) and
3653–3656 (evicted object → throws, no epoch consumed).

### `world.isLeaseValid(lease): boolean` (2527–2560)

"Strictly non-throwing and total: for any lease ever returned by `admitModel`, always returns a plain
boolean, never throws" (2528–2529). Checks `disposed` **FIRST, directly** — not inferred from
`lease.model`'s own `modelLifecycle` entry (2529–2530). Body given literally (2531–2533):

```
if (disposed) return false;
const entry = modelLifecycle.get(lease.model);
return entry?.state === 'live' && entry.epoch === lease.epoch;
```

This is **the first of exactly two deliberate exceptions** to "every public method throws
`WorldDisposedError` once disposed" (2539–2543). It "still answers only 'is this lease still valid,'
never why" (2560). A caller needing the cause calls `isModelLive` inside `try`/`catch` (2549–2553).

### `world.isModelLive(model): boolean` (2659–2669)

Checks `disposed` FIRST, directly — **throws `WorldDisposedError`** immediately if set, before consulting
`modelLifecycle` at all (2660–2661). Otherwise `true` iff this exact object has a `{state:'live'}` entry.
**"Never seen before → false"** (2662–2663) — explicitly *not* a pre-admission gate; Round 13 established
that contract is "wrong for a pre-admission gate" and "nothing public still depends on `isModelLive` for
that purpose" (2666–2669).

### `world.evictModel(model): void` (2562–2657)

Takes the exact `Model` object (2563). Body given literally (2576–2581):

```
if (disposed) return;                                     // no-op on a disposed world
const previous = modelLifecycle.get(model);
if (previous?.state === 'evicted') return;                // idempotent no-op
modelLifecycle.set(model, { state: 'evicted' });          // unconditional
if (previous?.state === 'live') releaseEpochScopedState(previous.epoch);
```

- Tombstone write precedes the (conditional) release, and is permanent either way (2582–2584).
- **Second deliberate non-throwing exception**: on a disposed world it returns immediately as a no-op,
  it does **not** throw (2624–2628). Three justifications, "in descending order of force" (2629):
  (1) a throw is verifiably destructive to the *Viewer* — cited to the pinned 7.124.2 bundle,
  `EventDispatcher.prototype.dispatchEvent` (viewer3D.js:13300–13341) with no try/catch,
  `Viewer3DImpl.unloadModel` (34052–34054), `unloadCurrentModel`'s unguarded loop (34253–34258),
  `Viewer3D.tearDown` (26583) wrapping extension unloads but **not** `unloadCurrentModel` (2630–2644);
  (2) nothing left for it to do — `dispose()` already released everything (2645–2649);
  (3) it is the branch the method already had (2650–2652).
- The no-op is **silent** — "a diagnostic on it would fire on every normal teardown" (2653–2654).
- **`releaseEpochScopedState`** — see §2.5 and §5.2. Explicitly required to be **non-throwing**
  (2607–2613): "a version which could throw partway through would leave the tombstone written (correct,
  permanent) but the release incomplete and unretriable, since the now-`'evicted'` entry no longer carries
  the epoch a second attempt would need". Framed as "a state-release/cleanup completeness concern, not a
  liveness-correctness one" (2611–2613).
- `liveModelByModelId` occupancy: deletes the id entry only if this object is still the current occupant
  (2614–2617, 2753–2756) — **explicitly bookkeeping only**.
- The **extension-owned room cache is NOT covered** by the disposed no-op; the handler must drop it
  unconditionally (2655–2657, 2919–2921).

### `world.dispose(): void` (2671–2707)

Terminal. Sets `disposed` FIRST, synchronously (2672–2673). "After `dispose()` returns, every public
method on this world instance — `findClashes`, `admitModel`, `isModelLive`, a second `dispose()` — rejects
or throws `WorldDisposedError`" (2675–2677). Two named exceptions, both of which still check `disposed`
directly and first, differing only in the action: `isLeaseValid` → `false` (2680–2682);
`evictModel` → no-op (2683–2686).

Also: wholesale-clears `GeometryRegistry`, `BlasCache`, and every cached `GeometryConnectivity` — "the
entire cache, in one operation, not a per-model sweep over `liveModelByModelId`" (2687–2689); best-effort
tombstones whatever `liveModelByModelId` currently references, "for diagnostic bookkeeping, but this is no
longer load-bearing for correctness" (2698–2703). A suspended query fails at its next checkpoint because
that checkpoint checks `disposed` directly (2704–2706).

**`dispose()` no longer needs to enumerate and tombstone every live model for correctness, and this spec
no longer claims it does** (2880–2881, 3169–3171).

### `world.findClashes(query)` entry contract (2478–2484, 2822–2843)

Order: `disposed` first (2823, 2863); then, for each of `query.source.model` / `query.target.model`:
a `'evicted'` entry rejects immediately with `ModelEvictedError`; no entry at all proceeds to **lazy
admission** (fresh epoch, `state:'live'`, recorded in `liveModelByModelId`) (2824–2826). "a model object
never seen before is a legitimate first use and is admitted normally; only an object this exact world has
already evicted is rejected" (2483–2484). Also rejects if `source.model !== target.model` (2485, 2249–2250).

A failure at the entry check **or any yield checkpoint aborts the entire call** — never a partial or
diagnosed `ClashResult` (2836–2841).

## 1.5 Checkpoint / yield sites and what each revalidates

**Universal two-part protocol:** `disposed` first and directly, then the model's load epoch
(2460–2463, 2864–2867, 1966–1968, 1979–1980, 2394–2395). `disposed` → `WorldDisposedError`; stale epoch →
`ModelEvictedError` (2837–2838, 1967–1968).

| # | Site | Cited | Yield or abort-only | Revalidates |
|---|---|---|---|---|
| 1 | `findClashes` entry | 2822–2826 | n/a | `disposed`, then tombstone/lazy-admit for both operands |
| 2 | before each requested dbId's extraction | 2251–2255, 2446, 1702–1704 | yield | full two-part |
| 3 | between sibling nodes of the extraction walk | 2337–2339 | yield | full two-part (stated as "a checkpoint against `frameBudgetMs`"; the two-part revalidation is stated universally at 2460–2463) |
| 4 | before the broad-phase scan | 2446, 1703–1704 | yield | full two-part |
| 5 | **before each individual instance pair inside the broad-phase scan** | 2392–2396, 1706–1711 | yield-and-resume from exact `(sourceIndex, targetIndex)` | full two-part |
| 6 | before starting each candidate pair (cached or not) | 2446 | yield | full two-part |
| 7 | between each of a pair's composed sub-queries | 2446 | yield | full two-part |
| 8 | **before each build phase** (weld / connectivity / BVH) | 1105–1113, 1146–1151, 2444–2446 | yield | `disposed` first, **then the liveness/epoch of the ONE model that owns this geometry** — the operand whose `loadEpoch` is in the record's key — **and nothing else** (1146–1151) |
| 9 | before each individual probe in `ProperCrossingQuery` | 1621–1628 | **abort-only** (bvhcast cannot pause) | — sets `aborted`; diagnosed `crossing-budget-exhausted` |
| 10 | at `bvhcast` callback entry for raw candidates | 1624–1626, 1658 | abort-only | — |
| 11 | **before each individual `classifyPoint` call** in `ContainmentQuery` sampling | 1959–1968 | yield-and-resume, non-truncating | full two-part |
| 12 | before each witness-triangle attempt (stage 3, `maxWitnessTriangles = 8`) | 1980–1981 | yield-and-resume | full two-part |
| 13 | before each `SurfaceCrossingWitness` candidate's probe | 1981–1983 | yield-and-resume | full two-part |

**Site 8 is the deliberate exception to "revalidate both operands":** "It must not reject because the
initiating query's *other* operand was evicted" (1149); "Each caller separately re-validates both of its
own operands at its own checkpoints, before and after awaiting a shared phase slot" (1152–1153); "a caller
whose own query aborts for an unrelated reason does not cancel a phase already in flight: every phase slot
runs to settlement" (1153–1155). Pinned by fixture 3515–3519.

`[AMBIGUOUS]` — Site 13 (`SurfaceCrossingWitness`'s probe loop) is described at 1981–1983 as one of
"three … plain JS loops with no native traversal in the way," i.e. genuinely yieldable. But
`SurfaceCrossingWitness` is described at 2086 as sharing the "Same traversal and budget as the other two
modes" — i.e. running inside the `bvhcast` native callback, which 1628–1630 states explicitly "cannot be
paused and resumed mid-traversal — there is no way to `await` inside a synchronous native callback."
The two statements are not reconciled anywhere in the current text. (Listed as a deliberately-untouched
`invariant-audit-v2` finding at line 632.)

## 1.6 Error types

Exactly two are defined anywhere in the document (71 total occurrences of the two names combined):

| Error | Raised by | Cited |
|---|---|---|
| `WorldDisposedError` | `admitModel` (2512), `isModelLive` (2660–2661), `findClashes` entry + every checkpoint (2837, 3166), `dispose()`-after-`dispose()` (2675–2677), room-search callbacks via the disposed-first mapping (2196–2206, 2217–2221) | throughout |
| `ModelEvictedError` | `admitModel` on tombstoned object (2513), `findClashes` entry + yield checkpoints (2837–2838), room-search callbacks — constructed as `new ModelEvictedError(model.id)` (2198) | throughout |

`isLeaseValid` and `evictModel` raise **neither** — by explicit design (2528–2529, 2624–2628).
`[SILENT]` — no error class is defined for the walk's `maxFragmentsPerDbId` / `maxChildrenPerNode`
rejections or for `maxBroadPhaseInstancePairs`; those are described only as "the same plain call-level
rejection" (2292–2293, 1662, 3082–3084) with no named type. Likewise `[SILENT]` on the error type for a
cross-model query (2249–2250, 3135–3137) and for "Invalid dbId: reject with a clear error" (3141).

## 1.7 `modelId` reuse semantics

`modelId` is used for: BLAS/geometry cache keys — **no longer true since Round 14** (see §2.1);
`liveModelByModelId` bookkeeping (318–319, 2745–2756); diagnostic metadata on a `GeometryRecord`
(1073–1075); and `ModelEvictedError`'s payload (2198, 2838).

Two supported states are explicitly named:
- A stale/duplicate `evictModel(oldModel)` arriving after a different object already reused the id
  (3186–3194): the old object is tombstoned; the new object's state "was never at risk" because it is
  epoch-keyed.
- Two objects sharing a reused `modelId` **both live simultaneously** (3195–3201, 2749–2751, 2850–2853) —
  "a state round 14's own epoch-keying fix made supported and tested". This is precisely why
  `liveModelByModelId` cannot be a complete enumeration.

## 1.8 Extension-side lifecycle (`RoomLocatorExtension`, 2898–2927)

- `load()`: constructs the `CollisionWorld` only — no room resolution, no eager BLAS (2901–2902, 2116–2117).
- `unload()`: `world.dispose()` **first**, listener removal **second**, then clears the per-model room
  cache (2903–2916). The spec itself flags the resulting window in which `BEFORE_MODEL_UNLOAD_EVENT` can
  still fire into a disposed world, notes the window "can outlive `unload()` itself, since
  `Viewer3D.tearDown` catches a throw from `unload()` while leaving the listener registered", and states
  the window is "benign, but only because `world.evictModel` is a no-op on a disposed world rather than a
  throw — it is the method's totality that makes this ordering safe, not the ordering itself"
  (2905–2913). **Explicitly left open**: "Per-step isolation of `unload()`'s three steps, and whether the
  listener should be removed before `dispose()` rather than after, remain open and are not settled here"
  (2913–2916).
- `BEFORE_MODEL_UNLOAD_EVENT` handler: `world.evictModel(event.model)` **AND** drop that object's
  room-cache entry, the latter "unconditional and independent of the `evictModel` call" (2917–2921,
  2146–2149, 2655–2657).
- `locateElementByRoom(dbId): Promise<number[]>` — rejects `ModelEvictedError` / `WorldDisposedError`
  (2922–2924).

`[SILENT]` — `keepCurrentModels` appears nowhere in the normative text (only at line 632, inside Round
19's list of deliberately-untouched findings). The document does not state what happens when a model is
added without unloading the previous one.

`[SILENT]` — `locateElementByRoom(dbId)`'s public signature "is unchanged and still resolves 'the current
model' however it already does" (2130–2131); the question of whether it should take a model argument is
explicitly deferred to `review-comments-v12.md` (2131–2132).

---

# 2. Geometry ownership / build pipeline

## 2.1 `GeometryRecord` identity

One `GeometryRecord` per unique **`(loadEpoch, geometryIndex)`** — keyed by the owning `Model` object's
admitted load epoch, **never** `modelId`, never the bare index (1057–1059, 965–974, 2806–2814).
`loadEpoch` = `modelLifecycle.get(model).epoch` (966, 2809–2810). Because `nextLoadEpoch` is global,
monotonic and never reused, two objects sharing a `modelId` are "structurally guaranteed a disjoint epoch,
and therefore a disjoint `GeometryRecord` namespace, before its first geometry lookup ever runs"
(2811–2814).

Record fields named anywhere: `referenceCount` (1060), `buildState: 'building' | 'ready'` (1060),
`weldPromise` (1061), `accelerationPromise` (1062), lazy `connectivity` promise (1062–1063),
`L_X := diagonal(localBounds(X))` cached with the BLAS (1293–1295), and `modelId` as
display/diagnostic metadata only (1073–1075).

`[SILENT]` — `referenceCount` is named once (line 1060) and never mentioned again in 4017 lines. Nothing
states when it is incremented, decremented, or what happens at zero. (Listed as a deliberately-untouched
`invariant-audit-v2` finding at line 633.)

## 2.2 The three kinds of registry entry (Round-20 C-5 fix — **verified landed**)

Stated at 1185–1193: "A registry lookup yields one of three things:"

| Kind | `buildState` | Cancellation signal | Phases | Cited |
|---|---|---|---|---|
| **oversized marking** | **none** ("it carries no `buildState`") | **none, ever** | none ever started | 1186–1193 |
| `'building'` record | `'building'` | created once at insertion | ≥1 unresolved | 1124–1127, 1166–1167 |
| `'ready'` record | `'ready'` | same signal, carried unchanged across the transition | weld+BVH resolved; connectivity may be unresolved | 1138–1145, 1167–1171 |

Oversized marking, verbatim (1186–1193): "*an oversized marking* (no phase is ever started for it, it
carries no `buildState`, and every pair needing it is skipped) … Because an oversized marking is rejected
*before* any build or derived phase ever starts, it has no unresolved phase work and therefore never has
the entry-scoped cancellation signal described above created for it at all — that signal is created
exactly once, at insertion, for a `'building'` entry, a trigger an oversized marking never undergoes.
`evictModel`'s `releaseEpochScopedState` and `dispose()`'s wholesale clear (below) **still enumerate and
remove oversized markings in the same sweep** as `'building'`/`'ready'` entries, but there is no signal on
them to reject — **removal is the entire cleanup**."

## 2.3 The entry-lifetime cancellation signal (Round-19 C-2 + Round-20 C-5)

Stated at 1165–1184:
- "Every registry entry carries one entry-scoped cancellation signal, created once when the entry is first
  inserted in `buildState: 'building'` and kept alive, unchanged, for the entry's entire lifetime — the
  signal is *not* discarded or replaced when the entry transitions to `'ready'`." (1165–1168)
- "Every unresolved phase slot the entry ever hosts races that same signal, including a lazy connectivity
  build started later against an already-`'ready'` entry … the signal is scoped to the entry's lifetime,
  not to its `buildState`." (1168–1171)
- "The release paths reject that signal exactly once and drop the entry in the same step …
  unconditionally, for every entry they remove regardless of whether its `buildState` is `'building'` or
  `'ready'`." (1171–1174)
- "one signal per entry suffices; there is no per-phase-slot set or map of signals to keep in sync"
  — justified because "phases are strictly sequential and single-flight per entry … with at most one phase
  ever unresolved on a given entry at a time" (1175–1178)
- Removal is identity-guarded (1178–1182).
- **Round-20 carve-out sentence:** "This entry-lifetime signal is defined only for `'building'`/`'ready'`
  entries — an *oversized marking* (see below) never has one, because no phase is ever started for it and
  it carries no `buildState` to begin with." (1182–1184)

`[CONTRADICTION]` (**candidate, internal to this one bullet, introduced by the Round-20 edit**) —
the bullet **opens** with the unrestricted universal "**Every registry entry** carries one entry-scoped
cancellation signal" (1165–1166) and **closes**, nineteen lines later, with "This entry-lifetime signal is
defined **only for `'building'`/`'ready'` entries** — an oversized marking … never has one" (1182–1184).
The opening sentence was not narrowed. A reader who stops at line 1167 gets the pre-fix universal claim;
a reader who reaches 1184 gets the carve-out. The intervening sentence at 1171–1174 ("unconditionally, for
every entry they remove regardless of whether its `buildState` is `'building'` or `'ready'`") is itself
in the middle: "every entry they remove" is universal, while "regardless of whether its `buildState` is
`'building'` or `'ready'`" enumerates only the two states an oversized marking does not have.

## 2.4 Pipeline stages, in order

The build is **not atomic** — a yield-and-revalidate checkpoint sits before each phase (1117–1119,
1104–1108).

| # | Phase | Gated by | Checkpointed | Cited |
|---|---|---|---|---|
| 0 | Layout normalization → `ranges: TriangleRange[]` | — ("free, no per-triangle work") | — | 1203–1205, 1012–1051 |
| 0.5 | **Ceiling check**: `activeTriangleCount := Σ floor(ranges[i].count / 3)` vs `maxSyncTriangleCount` | the ceiling itself, "not gated by `frameBudgetMs`" | — | 1202–1218 |
| 1 | **Active-range compaction** → collision-owned compacted position/index pair | folded into the weld phase's checkpoint | shares the weld phase's own checkpoint | 1202–1225, 1655 |
| 2 | **Weld** (`mergeVertices` on position+index only) → `weldPromise` | `maxSyncTriangleCount` | own checkpoint, before it starts | 1091–1113, 1655, 1439–1443 |
| 3 | **Connectivity** (`GeometryConnectivity`) → own promise slot; **independently lazy** | `maxSyncTriangleCount` | own checkpoint, before it starts | 1093–1103, 1656, 1471–1494 |
| 4 | **BVH** (`MeshBVH`) → `accelerationPromise` | `maxSyncTriangleCount` | own checkpoint, before it starts | 1078–1079, 1657 |

Order is "weld first, then connectivity if it is needed, then the BVH" (1128–1130). All three run over the
**same** compacted buffer; "none of the three ever sees a triangle outside the active ranges" (1221–1222).

`[CONTRADICTION]` (**pre-existing, listed as deliberately untouched at line 633 as "the compaction/gate
ordering transposition"**) — line 1202–1203 states the compaction phase runs "**Before welding, before the
ceiling check**, and before anything is handed to `mergeVertices`", while lines 1216–1219 state
"**`maxSyncTriangleCount` is checked against `activeTriangleCount` before any copying happens** … Only
once that check passes does compaction actually copy triangle data". The two orderings are inverted
relative to each other in the same paragraph. Line 1655's table row calls it a single "compaction +
welding phase". Fixture 3529–3533 pins the 1216 ordering (spy on the compaction step: **zero** calls when
the active count alone exceeds the ceiling).

`[CONTRADICTION]` (**pre-existing, listed as untouched at line 633 as "the `>=`/`>` boundary wording"**) —
line 1257 states "A geometry **at or above** that triangle count is **not** built synchronously" (i.e.
`>=`), while line 2422 says "if either **exceeds** it, skip the pair", line 3061 says "**exceeds**
`maxSyncTriangleCount` … is skipped", and line 1216 says "a fragment whose active set alone **exceeds** the
ceiling is marked oversized". The boundary fixture at 3534–3539 uses 13,000 (skip) and 11,000 (build) —
which does not discriminate the value `12_000` itself.

## 2.5 Publication, single-flight, and what a caller may read

Stated at 1114–1164:
- **"A `GeometryRecord` is published when its build *starts*, not when it finishes"** (1114–1116). The
  earlier "only published once every phase completes" rule "could not hold" because the build is
  deliberately not atomic (1117–1119); publish-only-when-complete would defeat dedup and make in-flight
  builds unreachable from `evictModel`/`dispose()` (1119–1123).
- **Insert first, then build**: the missing caller inserts the record with `buildState: 'building'`
  **before the first phase's checkpoint — that is, before any yield** (1124–1127).
- Each phase is a **single-flight slot**, created at most once, on demand, awaiting its prerequisites
  rather than launched in parallel (1127–1130).
- **"A caller that finds an existing entry never starts a duplicate build."** "This single registry-level
  mechanism is what makes concurrent build requests dedupe, and it covers compaction/weld and connectivity
  exactly as it covers the BVH — see `BlasCache` below, **which owns no dedup mechanism of its own**"
  (1131–1134, echoed 1243–1252).
- **"Nothing reads a phase's product off a `'building'` record."** Products are "only ever the resolved
  values of their own phase slots, never fields read straight off the record" (1135–1137).
- **`'ready'` is record-level and mode-independent**: weld+BVH resolved (1138–1140). "it is `'ready'`
  whether or not the connectivity slot was ever created"; "**Connectivity is never what makes a record
  un-`'ready'`**" (1140–1145).
- **There is no `'failed'` state** (1156). A failing build-phase checkpoint rejects the slot and "**the
  entry is removed from `GeometryRegistry` synchronously as part of that rejection**", discarding
  intermediate buffers (1156–1162). Identity-guarded (1162–1164). Pinned by fixture 3466–3473.

`[AMBIGUOUS]` — the connectivity **trigger point** is explicitly not decided by the state model: "created
on demand at whichever point this spec's connectivity-trigger rule fires (see the narrow phase in **Data
Flow** step 3 and 'Connectivity remains independently lazy' above — **this state model does not by itself
decide that trigger point**)" (1142–1145). Data Flow step 3 (2426–2429) places it between weld and BVH
("active-range compaction and welding together, then (only for a mode that calls `anyComponentInside` …)
connectivity, then the BVH"), which is a *build-time* trigger, not an on-demand-at-query-time one. The two
descriptions are not reconciled. Fixture 3481–3486 describes a `containment` caller *driving the
connectivity phase itself against an already-`'ready'` entry* — a third timing.

`[SILENT]` — nothing states whether an **oversized marking** participates in the single-flight /
"caller that finds an existing entry" rule, i.e. whether a second candidate pair needing the same
oversized geometry re-computes `activeTriangleCount` or reads the marking. Line 1186 says "every pair
needing it is skipped" (implying the marking is consulted), while Data Flow's narrow phase (2419–2426)
describes the ceiling check as run per candidate pair *before* the registry get/build. The
`geometry-too-large-for-sync-build` diagnostic is stated to be "fragment-scoped and deduplicated … one
entry is emitted per oversized fragment no matter how many candidate pairs it appears in" (2424–2426),
which requires *some* memory across pairs but does not say it is the marking.

## 2.6 Release paths (geometry side)

| Path | Trigger | What it removes | Signal handling | Cited |
|---|---|---|---|---|
| **Build-phase rejection** | owning model evicted / world disposed at a between-phases checkpoint | this entry, synchronously, identity-guarded | slot rejects with `ModelEvictedError`/`WorldDisposedError` | 1156–1164 |
| **`releaseEpochScopedState(epoch)`** | `evictModel` on a previously-`'live'` object | every entry filed under that epoch — "in whichever build state, `'building'` or `'ready'`, **plus any oversized marking**" — with cached BLAS and cached connectivity | for **every `'building'` or `'ready'` entry it removes**, rejects that entry's signal first; **"An oversized marking carries no such signal — no phase is ever started for it — and is removed directly in the same sweep, with nothing to reject."** Then identity-guarded delete. | 2585–2597 |
| **`dispose()` wholesale clear** | `dispose()` | `GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity`, in one operation | "For **every `'building'` or `'ready'` entry it removes**, the clear rejects that entry's cancellation signal … exactly once, in the same pass that drops the entry, identity-guarded … **An oversized marking carries no cancellation signal at all — no phase is ever started for it — so the clear removes it directly in the same wholesale pass, with nothing to reject.**" | 2687–2698 |

**Round-20 C-5 verification — the four edited sites, read at this pass:**

| Site | Claimed lines | Actual lines now | Landed? |
|---|---|---|---|
| Signal-lifetime paragraph + oversized-marking definition | ~1165–1186 | **1165–1193** | **Yes** — carve-out at 1182–1184 and the expanded three-kinds bullet at 1185–1193 |
| `evictModel`'s `releaseEpochScopedState` | ~2577–2595 | **2585–2597** | **Yes** — scoping at 2587–2588 ("For every `'building'` or `'ready'` entry it removes"), carve-out sentence at 2593–2594 |
| `dispose()`'s wholesale clear | ~2677–2698 | **2687–2698** | **Yes** — scoping at 2693, carve-out at 2696–2698 |
| Two new fixtures | ~3502–3514 | **3502–3514** | **Yes** — `evictModel` case 3502–3510, `dispose()` case 3511–3514, both labeled C-5 regression tests, both immediately after the Round-19 C-2 pair at 3487–3501 |

**Answering the task's direct question:** at all three normative sites the current wording *does*
unambiguously state that (a) oversized markings have no cancellation signal, (b) they are excluded from
the signal-rejection step, and (c) they are still included in the removal sweep. The phrasing is
near-identical across the three ("carries no such signal" / "carries no cancellation signal at all" — "no
phase is ever started for it" — "removed directly in the same sweep, with nothing to reject").

**Residual site the pass did not reach** — see §5.4 for the full text: **line 2884–2891**, inside the
"`world.dispose()` is terminal" prose block, still says "**the clear rejects each entry's cancellation
signal as it drops the entry**" with **no oversized carve-out**. `[CONTRADICTION]` candidate.

## 2.7 Extraction contract (`ViewerModelAdapter` 909–974 + Data Flow step 3, 2251–2373)

- **No code path may call `enumNodeFragments(dbId, cb, true)`** (920–921). The normative path is the
  self-driven, depth-first, node-by-node walk in Data Flow step 3, built from
  `enumNodeChildren(node, cb, false)` and `enumNodeFragments(node, cb, false)` (918–920).
- **"`getChildCount` is not one of the walk's primitives"** (921–922).
- Coverage-equivalence argument (923–939), verified against the pinned 7.124.2 bundle's
  `enumNodeInstances`; "**The union of the walk's per-node `enumNodeFragments(node, cb, false)` results is
  therefore the same fragment set one `enumNodeFragments(dbId, cb, true)` call produces**" (935–938).
  Walk dedupes by fragment id (938–939, 2307–2309).
- Two conditions the equivalence rests on (940–953): (1) *no truncation* — both early-exit paths reject
  the entire `findClashes` call; (2) *a complete tree to walk* — **explicitly not closed**: "this spec does
  not claim to have closed the second" (953).
- `maxChildrenPerNode` (`10_000`, provisional) — **sole enforcement mechanism is the in-callback abort
  inside non-recursive `enumNodeChildren(node, cb, false)`, for every node shape** (2266–2282, 1662,
  3075–3084). Three normative implementation constraints (2293–2303): local flag not the forwarded return
  value (dbId `0` is falsy); callback **only collects child ids**, never descends inline; typings declare
  both as `void`, contradicting the documented contract, so it must be pinned by test.
- `maxFragmentsPerDbId` (`5_000`, provisional) — tally counts **callback invocations, not distinct
  fragment ids** (2306–2309); checked after every node's contribution; the walk stops immediately and the
  entire call rejects (2310–2313).
- **One node's own `enumNodeFragments(node, cb, false)` call remains an accepted, non-preemptible atomic
  risk** (2351–2370, 1661, 572–573, 3070–3074) — with the explicit note that Round 17's justification for
  it was factually wrong and "a required follow-up this pass did not carry out" (2359–2368).

`[CONTRADICTION]` (**pre-existing, explicitly deliberately-untouched per line 62–67 of the Round-20
disposition doc**) — **Revision Notes residue on `getChildCount`.** Normative text removes it entirely
(921–922, 1662, 2280–2282, 3078–3082, 3574–3579: "assert … that `getChildCount` is never called"). But
the changelog still asserts it in the present tense, unannotated:
- line 457: the walk is "built from `InstanceTree`'s non-recursive primitives
  (`enumNodeChildren`/**`getChildCount`**/non-recursive `enumNodeFragments`, confirmed present in the
  installed typings)"
- lines 496–498: "**`getChildCount(node)` (verified, both classes) is now the explicit, normative preflight
  before every `enumNodeChildren` call** — not merely 'useful where cheap' as round 16's wording had it —
  since it *is* a verified O(1)-shaped check the walk can and should perform before fanning out."
- line 487–490 restates the O(1) claim the C-1 fix refuted.

Contrast: the Round-16 stage-3 attribution error at 446–449 **was** annotated in place ("*(This entry
originally went on to attribute stage 3 …; that attribution was backwards …)*"), establishing the
document's own convention for correcting stale changelog claims (622). No equivalent annotation exists on
the Round-16/17 `getChildCount` entries.

---

# 3. Query mode dependencies

## 3.1 `anyComponentInside` — the three stages (canonical statement, 1888–1948)

Preamble: "Three escalating stages, per component — **the third is scoped to `volume-overlap` only; see
the note after stage 3 for why `containment` stops after the second**" (1893–1895).

| Stage | What | Cited |
|---|---|---|
| 1 | **Spatially-spread vertex sampling** — stride `ceil(n / samplesPerComponent)`, `samplesPerComponent = 8`. Stop at first `inside` or `outside`. | 1897–1901 |
| 2 | **Continue through the component** — if every strided pick reads `boundary`, keep walking remaining vertices until conclusive or exhausted. "On a manifold component this is where the guarantee is actually discharged." | 1902–1905 |
| 3 | **Constructed interior witness** — centroid ± normal × each `witnessLadder` rung, keeping the first probe `classifyPoint` puts `inside` **the component's own geometry**; up to `maxWitnessTriangles = 8` triangles. | 1906–1912 |

**Stage-3 scoping (the single source of truth, 1923–1943):** "This stage is scoped to `volume-overlap`;
**`containment` never runs it**, and round 9 was the correction of an earlier draft that ran it in both."
Reason: the witness is constructed inside the source's own volume, off the surface entirely, which
violates `containment`'s surface-only contract; two coincident closed boxes are the counterexample
(1924–1931). "`containment`'s use of `anyComponentInside` (in `ContainmentModeQuery` below) therefore
stops after stage 2" (1933).

Explicit non-claim (1933–1943): stopping after stage 2 "is **not** the same as asserting the component is
clean-false"; an unresolved component "stays unresolved for this term … rather than being asserted false";
what discharges the genuine case is `SurfaceCrossingWitness`'s independent triangle-level search.

Exhaustion: "Only if all three stages fail (`volume-overlap`) or the first two fail (`containment`) is the
component unresolved, and a negative result with any unresolved component emits
`inconclusive-containment`" (1945–1947).

Global cap: `maxContainmentSamples = 512` → `incomplete-component-coverage` (1950–1951).

**Round-19 C-3 verification — landed.** Both previously-drifting passages now cross-reference this section
instead of restating the attribution: Components at 1100–1103 ("independent of which one does or doesn't
also reach stage 3 (**see the note after stage 3 under `anyComponentInside` for which mode that is**)");
Round-16 changelog at 446–449, annotated in place rather than rewritten.

## 3.2 Mode → dependency matrix

| | `surface-intersection` | `containment` | `volume-overlap` |
|---|---|---|---|
| calls `anyComponentInside` | **no** (1103) | yes, **stages 1–2 only** (2035–2041) | yes, **all three stages** (1923–1924) |
| requires compaction+weld | yes (1092–1093) | yes | yes |
| requires BVH | yes — "the one phase every mode needs" (1657) | yes | yes |
| requires **connectivity** | **no** — "the only mode that never calls `anyComponentInside` at all, is genuinely connectivity-free" (1103, 1656, 2428, 3463–3465) | **yes** (1096–1103) | **yes** (1096–1103; Round 16 corrected the opposite claim, 442–452) |
| parity evaluated against | **nothing — no parity at all** (1384) | **target only** (1385) | **both** (1386) |
| closure precondition | none (1384, 2496) | target only (1415–1418, 2493–2494) | both operands (1408–1414, 2487–2488) |
| open source | fine, never diagnosed (1384, 1385) | fine, never diagnosed (1385, 1854–1857) | `unverified-parity-operand` and/or `unverified-open-component`, `role:'source'` (1386) |
| open target | fine, never diagnosed (1384) | `unverified-parity-operand` (`role:'target'`) (1385) | both diagnostics, `role:'target'` (1386) |

## 3.3 Mode composition

```
volume-overlap(A, B) :=                                      (2001–2005)
      ProperCrossingQuery(A, B)
   OR ContainmentQuery(anyComponentOf(A) inside B)
   OR ContainmentQuery(anyComponentOf(B) inside A)
```
Evaluated in that order with early exit (2007). Both directions required for symmetry (2011–2013). Pure
touching correctly returns **false** (2013–2015).

```
containment(A, B) :=                                         (2026–2030)
      ContainmentQuery(anyComponentOf(A) inside B)   // a source VERTEX inside B
   OR SurfaceCrossingWitness(A, B)                   // a point on a source TRIANGLE inside B
```
One direction only, no bidirectional evaluation (2032–2033). First term uses stages 1–2 only
(2035–2041). Second term "is not optional" (2043–2051). Stage ordering cheapest-first (2089–2093).

`surface-intersection` — "true iff any triangle pair from A and B has a non-empty geometric intersection,
including zero-volume coincident contact" (1496–1498); the *same* `bvhcast` traversal
`ProperCrossingQuery` uses, sharing `maxCandidatePairsExamined`, the same per-candidate
`intersectsTriangle` test and the same abort protocol, under a weaker predicate (1513–1520).

## 3.4 `ProperCrossingQuery` (1522–1752)

Six numbered steps (1530–1604): 1. `bvhcast` traversal, callback receives **candidate** pairs not
intersecting ones (1533–1547). 2. Classify candidate first, ordered so the upstream coplanar warning path
is never entered (1548–1565). 3. Midpoint `M` of the valid `targetLine` (1566). 4. Four-quadrant probes
`P = M + δ × normalize(s₁·nA + s₂·nB)` over `offsetLadder`, coarsest to finest; "The pair is a proper
crossing iff some probe classifies as `inside` **both** A and B" (1568–1581). 5. **Inconclusive probes
propagate** → `inconclusive-crossing` (1582–1586). 6. Early-exit `true`; two independent budgets
(1587–1598).

**Abort protocol** (1600–1604): exceeding either budget sets `aborted` and returns `true` from
`intersectsTriangles` — "`bvhcast` therefore returns `true`, which **must not be read as 'crossing
found'**". Third, time-based trigger sets the same flag (1606–1633). Overshoot bounded to one probe's cost
(1635–1639).

## 3.5 Parity-closure preconditions (1815–1886, 1866–1877)

- "**every operand that parity is evaluated against must be a certified closed manifold.** If one is not,
  each result depending on that parity — positive *and* negative — carries `unverified-parity-operand`
  naming that operand's role." (1868–1870)
- "**Which operands those are depends on the deciding path, not on the mode alone.**" (1871–1875)
- "The check is free: `GeometryConnectivity` already computes manifold classification per geometry and
  caches it alongside the BLAS" (1876–1877).
- Role tables at 2982–2987 (parity) and 3001–3004 (open component).

**The containment guarantee** (1815–1830): conditional. "closed manifold component → the guarantee holds
… non-manifold or open component → sampling is best-effort, and the component is flagged" (1829–1830).
Flagging follows whichever component decided the outcome, **in either direction** (1832–1852).

`[CONTRADICTION]` (**pre-existing; the second of the two v3 Highs the Round-20 pass deliberately did not
touch, per disposition doc lines 62–67**) — the Public API comment block states closure as a **hard
precondition** on the mode: "'volume-overlap' … **Requires BOTH operands certified closed** (see Query
modes)" (2487–2488) and "'containment' … **Requires only the TARGET certified closed**" (2493–2494). Every
other site treats an uncertified operand as producing a **diagnostic on a still-returned result**, not a
rejection or a precondition the caller must satisfy: "The pair is still reported rather than skipped; the
caveat is what makes it honest" (3123); "Positives are reported as true rather than suppressed throughout"
(1884); the mode table's own cells name diagnostics, not rejections (1386). Nothing anywhere describes
`findClashes` refusing a query for an unclosed operand.

## 3.6 Solid model (1333–1379)

- **Target interior = even-odd (parity) over its entire triangle set** (1340–1342). Justification: hollow
  solids / pipe bores (1344–1349). Stated limitation: two genuinely nested independent solids read the
  inner region as cavity (1351–1358).
- **A source geometry contributes as the union of its components** (1360–1364) — "union semantics on the
  source side and even-odd on the target side, and that asymmetry is intentional".
- **"Only closed components can establish positive volume."** An open shell's vertices reading `inside`
  proves **containment**, not **overlap** (1366–1367).
- Vertex welding is a required normalization step, not optional repair (1430–1443); `weldEpsilon =
  1e-4 m / model.getUnitScale()`, falling back to `1e-4` (1461–1463).

## 3.7 `classifyPoint` (1754–1808)

Three-valued `'inside' | 'outside' | 'boundary'` (1757). Two layers deliberately kept distinct so the
guarantee isn't circular (1754–1763): `ProperCrossingQuery` uses only `classifyPoint`;
`VolumeOverlapQuery` uses `anyComponentInside` "and only *after* `ProperCrossingQuery` has returned false"
(1760).

1. **Surface-proximity pre-check** — `closestPointToPoint`; ≤ `surfaceEpsilon` → `boundary` immediately
   (1773–1777).
2. **Parity test** in the target BVH's own local space: `THREE.DoubleSide` explicitly (1779–1780);
   **generic non-axis-aligned local-frame directions**, three of them tried in order (1781–1791); sort
   hits by distance **then** collapse runs closer than `mergeDistance` (1792–1795); barycentric
   edge/vertex graze → retry next direction, all three graze → `boundary` (1796–1803); otherwise odd →
   `inside`, even → `outside` (1804–1808).

## 3.8 `SurfaceCrossingWitness` (2053–2100)

Probes **within the source triangle's own plane** and classifies **against the target only** (2053–2061).
`δ ∈ crossingProbeFractions × dAvail` (`[0.5, 0.1, 0.01]`, per-candidate, recomputed rather than cached)
(2058–2071). If no rung both stays inside the triangle and clears `surfaceEpsilon` → **inconclusive, not a
rejected witness** → `inconclusive-crossing` (2073–2078). "It therefore never parity-tests the source,
which is exactly what lets `containment` accept open sources while `volume-overlap` cannot" (2085–2086).

---

# 4. Synchronous-work / budget model

## 4.1 The two tiers (1645–1652, 1677–1711)

1. **Per-atomic-operation ceiling** — primitives with no internal checkpoint possible. Named members:
   the three `maxSyncTriangleCount` phases (weld, connectivity, BVH) (1682–1690), plus one non-recursive
   `enumNodeFragments(node, cb, false)` call (1661, 2355–2357). Every other atomic primitive (one raycast,
   one proximity check, one `classifyPoint`, one probe) is "expected to be a small fraction of a frame, but
   that expectation is **reasoned, not measured**" (1690–1695).
2. **Cooperative-composition ceiling** — what `frameBudgetMs` actually bounds (1696–1711).
   `frameBudgetMs = 8` — "half the one-frame target, since a checkpoint can only fire *between*
   primitives, not preempt one" (2110, 2448–2449).

## 4.2 The atomic-operations table (1653–1663) — extracted

| Row | Value | Measured/reasoned | What it bounds |
|---|---|---|---|
| `maxSyncTriangleCount` — compaction + welding phase | `12_000` | **Measured** (R15, weld only): ~16.8ms @ ~19,800 tri; compaction's own cost unmeasured | non-preemptible; against the compacted active-range set only; own checkpoint before it starts (1655) |
| `maxSyncTriangleCount` — connectivity phase | `12_000` | **Measured** (R15): ~6.9ms @ ~19,800 tri | non-preemptible; lazy; runs for `containment` **or** `volume-overlap`; never for `surface-intersection`-only (1656) |
| `maxSyncTriangleCount` — BVH phase | `12_000` | **Measured**: ~16ms @ 18k tri | non-preemptible; the one phase every mode needs (1657) |
| `maxCandidatePairsExamined` | `50_000` | **Measured**: ~0.3µs/pair | raw `bvhcast` candidate rejection, checked at callback entry (1658) |
| one probe / one `classifyPoint` | — | **Reasoned, not yet measured** | checked before every occurrence (1659) |
| `maxFragmentsPerDbId` | `5_000` (provisional) | **Reasoned, not measured** | **cumulative work across the walk only**, via early termination *between* nodes (1660) |
| one `enumNodeFragments(node, cb, false)` call | **— (no ceiling; accepted atomic risk, flagged for re-derivation)** | reasoned; R18 correction: R17's justification factually wrong | non-preemptible; "unbounded **by choice of scope, not by API limitation**"; follow-up required (1661) |
| `maxChildrenPerNode` | `10_000` (provisional) | **Reasoned, deliberately not derived from any existing measurement**; ~0.3µs bvhcast figure explicitly **not** borrowed as a proxy | **enforced by exactly one mechanism** — the in-callback abort; `getChildCount` "removed from this enforcement path entirely — it is never called here, for any node shape"; caps one call at `maxChildrenPerNode + 1` callbacks. "**This spec does not claim `10_000` callbacks fit inside `frameBudgetMs`**" (1662) |
| `maxBroadPhaseInstancePairs` | `1_000_000` (provisional) | **Reasoned, not measured**: one AABB test O(µs) | pre-scan rejection via overflow-safe division; **R18: bounds work not span** (~1,000ms at the ceiling, ~60× the gate's ~16ms); now checks `frameBudgetMs` before **each individual instance pair**, yielding and resuming — "cooperatively yieldable"; ceiling retained unlowered, also bounding candidate-list memory (1663) |

Other constants not in the table: `maxCrossingPairsExamined = 64` (1589), `maxContainmentSamples = 512`
(1950), `samplesPerComponent = 8` (1898), `maxWitnessTriangles = 8` (1912).

**Round-19 C-1 verification — landed.** `getChildCount` is absent from the enforcement path at every
normative site (921–922, 1660, 1662, 2266–2282, 2324–2331, 3075–3084) and the fixture asserts it is never
called (3574–3579). See §2.7 for the changelog residue.

## 4.3 Worst-case-span formula (1713–1736)

> "For the cooperative-composition tier, the resulting worst-case single synchronous span is bounded by
> roughly **`max(frameBudgetMs + one small atomic operation's cost, one build-phase's own cost)`**"
> (1713–1714)

Guarded explicitly (1716–1726): "**Read that sentence for exactly what it says** … a `max(…)` is a bound
only when every term it ranges over has a ceiling, and the table above deliberately contains a row that
has none — one non-recursive `enumNodeFragments(node, cb, false)` call … That row … is **explicitly
excluded from the formula above and from any finite worst-case-span guarantee this spec makes.**"

What it *does* bound (1728–1736): the three `maxSyncTriangleCount` phases, the `maxChildrenPerNode`-capped
`enumNodeChildren` call, the now-chunked broad-phase scan, and the per-primitive checkpoints — "only as
good as the table's unmeasured rows."

## 4.4 The performance gate (3791–3876)

One `volume-overlap` query against an MEP-scale model, run **twice** (cold, then cache-warm) (3791–3796).
Pass criteria (3806–3867):
1. no single synchronous task exceeds `frameBudgetMs`'s tolerance band around ~16ms, on **both** runs
   (3808–3810);
2. any budget that trips does so with the correct diagnostic (3811–3812);
3. measured per-candidate and per-build costs recorded next to `measure.mjs`'s synthetic figures
   (3813–3814);
4. **one `classifyPoint` call and one crossing probe measured directly** (3815–3822);
5. **each of the three build phases measured individually at `maxSyncTriangleCount`** — and a
   connectivity-measuring cold run must be distinguished from a `surface-intersection`-only run
   (3823–3832);
6. extraction cost for the largest single dbId, **and** the broad-phase scan's **longest uninterrupted
   span** between yields (not just total), plus the cost of one `performance.now()` read relative to one
   AABB test, plus the candidate-list size at the ceiling (3833–3846);
7. **one `enumNodeChildren` call at the fanout ceiling** — `maxChildrenPerNode + 1` invocations on the
   widest node, **and an assertion that the abort actually fires** (3847–3859);
8. **one `enumNodeFragments(node, cb, false)` call** on the node owning the most fragments (3860–3867).

For (7) and (8) alike: "a model whose widest node has far fewer children than the ceiling cannot exercise
this at all — recording that limitation is itself a gate finding, not a pass" (3857–3859, 3865–3867).

`maxSyncTriangleCount`'s `12_000` "specifically remains provisional until it has [run]" (3872).

`[SILENT]` — the gate does **not** list measuring the extraction walk's per-node
`frameBudgetMs` sibling checkpoint (site 3 in §1.5), nor any release-path / eviction-sweep cost.

---

# 5. Cache ownership / cleanup

## 5.1 Inventory

| Cache | Key | Owner | Cited |
|---|---|---|---|
| `GeometryRegistry` | `(loadEpoch, geometryIndex)` | `CollisionWorld` | 1057–1058, 2601–2602, 2806–2810 |
| `BlasCache` | behind the registry entry's `accelerationPromise` slot | `CollisionWorld`; **"owns no dedup mechanism of its own"** | 1131–1134, 1243–1252 |
| `GeometryConnectivity` decomposition | per unique `GeometryRecord`, cached alongside the BLAS | `CollisionWorld` | 1471–1475, 1876–1877 |
| `L_X` tolerance scale | per `GeometryRecord`, "cached with the BLAS" | `CollisionWorld` | 1293–1295 |
| `modelLifecycle` | `Model` object identity (`WeakMap`) | `CollisionWorld` | 2729–2744 |
| `liveModelByModelId` | `modelId` | `CollisionWorld`; diagnostic only | 2745–2756 |
| room-dbId cache | `Map<Model, Promise<number[]>>`, **keyed by the exact `Model` object, not `model.id`** | **the extension**, not the world | 2124–2128, 2655–2657 |

## 5.2 What each release path does

| Path | Registry | BLAS | Connectivity | `liveModelByModelId` | `modelLifecycle` | room cache |
|---|---|---|---|---|---|---|
| `evictModel` (live object, not disposed) | sweeps + deletes every entry under that epoch, identity-guarded, incl. oversized markings (2585–2597) | dropped with each entry (2586–2587) | dropped with each entry (2586–2587) | deletes only if this object is still the occupant (2614–2617) | writes `{state:'evicted'}` unconditionally, **before** the release (2579–2582) | **untouched** — the handler drops it separately (2655–2657, 2919–2921) |
| `evictModel` (disposed world) | no-op | no-op | no-op | no-op | **no tombstone written** (2576) | still dropped by the handler unconditionally (2655–2657) |
| `evictModel` (already `'evicted'`) | no-op | no-op | no-op | no-op | no-op (2578) | — |
| `evictModel` (never admitted) | nothing to release (2581, 3707–3716) | — | — | — | writes `{state:'evicted'}` (2579–2580) | — |
| `dispose()` | wholesale clear, one operation (2687–2689) | wholesale clear | wholesale clear | best-effort tombstone only (2698–2703) | best-effort, **not load-bearing** (2700–2703) | **never touched** (2655–2656, 2919–2921) |
| build-phase rejection | this entry only, synchronously, identity-guarded (1156–1164) | intermediate buffers discarded | — | — | — | — |
| room-search rejection | — | — | — | — | — | identity-guarded delete (2151–2160) |

## 5.3 Room-cache rejection semantics (Round-19 C-4 — **verified landed**)

**One rule, no exception** (2151–2160): "On rejection, the handler deletes that model object's cache
entry — guarded by identity, `if (roomCache.get(model) === thisPromise) roomCache.delete(model)` … **This
identity-guarded delete is unconditional: every rejection path in this mechanism uses it, with no
special-cased exception (see the invalid-lease branches below).**"

Invalid-lease branch of the **success** callback (2184–2212): reject **and** "apply the same
identity-guarded delete every rejection path in this mechanism uses … **no special-cased 'leave the cache
untouched' exception for this branch**" (2186–2188). Cause derivation: `isLeaseValid(lease)` first; on
`false`, call `world.isModelLive(model)` inside `try`/`catch` — a caught `WorldDisposedError` **is** the
rejection reason; otherwise `new ModelEvictedError(model.id)` (2193–2198). "Nothing can interleave between
the two calls — both are synchronous and there is no `await` between them" (2198–2199).

**Error** callback (2217–2225): "follows the same shape … Both callbacks use one mapping, and both apply
the identical identity-guarded delete-on-rejection rule … **there is no 'leave the cache untouched'
exception for either callback's invalid-lease branch. A design in which the two callbacks classify the
same invalid lease differently, or delete the cache entry in one but not the other, is a bug.**"

Valid branch: also checks `roomCache.get(model) === thisCall's own promise` before writing (2213–2216).

Admission-before-search: `const lease = world.admitModel(model)` is called synchronously on the
cache-miss path **before** `model.search`, and throws (never starting the search) if already
tombstoned or if the world is disposed (2178–2183).

Fixture pins deletion, not "untouched", for **both** callbacks (3731–3741).

No grep hit for "leave the cache untouched" as a live rule anywhere; the phrase survives only inside the
two explicit disclaimers at 2187 and 2223.

## 5.4 Consistency between release paths

Both release paths are described **three** times each in the document. The three descriptions of
`dispose()`'s clear are not identical:

| # | Location | Signal-rejection wording | Oversized carve-out? |
|---|---|---|---|
| A | `ThreeMeshBvhBackend`/`BlasCache` bullet, 1171–1174 | "reject that signal exactly once and drop the entry in the same step … unconditionally, for every entry they remove regardless of whether its `buildState` is `'building'` or `'ready'`" | **Yes** — appended at 1182–1184 and 1191–1193 |
| B | `world.dispose()` TS comment, 2687–2698 | "**For every `'building'` or `'ready'` entry it removes**, the clear rejects that entry's cancellation signal … exactly once, in the same pass that drops the entry, identity-guarded" | **Yes** — 2696–2698 |
| C | **"`world.dispose()` is terminal" prose, 2882–2891** | "…and **rejects every in-flight build promise, exactly once**, on the same disposal call. 'Every in-flight build promise' is enumerable at all only because … the unresolved phase slots hanging off the registry's entries … *are* the in-flight builds … **and the clear rejects each entry's cancellation signal as it drops the entry.**" | **No** |

`[CONTRADICTION]` — **site C (line 2891) is the residual instance of the C-5 defect the Round-20 pass did
not reach.** "the clear **rejects each entry's cancellation signal** as it drops the entry" is universally
quantified over entries dropped, and the wholesale clear drops oversized markings too (per 1191–1193 and
2696–2698). This is the same literal-unsatisfiability shape the fix removed from sites A and B. Note that
the *preceding* clause at 2884 ("rejects every in-flight build promise") is arguably narrower and
satisfiable, since an oversized marking has no in-flight build — the problem is specifically the final
clause at 2891, which shifts the quantifier from *promises* to *entries*. The Round-20 disposition doc's
own verification (its lines 76–80) searched only for the string `regardless of.*build.*state`, which does
not match this phrasing.

Corresponding check on `evictModel`: `releaseEpochScopedState` is defined at 2585–2597 (carve-out
present) and named at exactly four other lines — 1172, 1191, 2581 (the pseudocode call site), and 3493
(a fixture description). None of those four restates the signal rule in a way that could reproduce the
defect, so there is no equivalent residual site on the eviction path. (Verified by grep: five hits total.)

`[SILENT]` — no site states what `releaseEpochScopedState` or `dispose()` does about an oversized
marking's **`geometry-too-large-for-sync-build` diagnostic dedup record** (2424–2426), or whether removing
the marking mid-call could cause the same fragment to be re-diagnosed. The dedup mechanism's storage is
never named.

`[AMBIGUOUS]` — `releaseEpochScopedState` "drops each one together with its **cached BLAS and cached
connectivity**" (2586–2587). For an oversized marking neither exists (no phase ever started, 1188–1190),
so the sweep's stated action is vacuous for that entry kind; the text does not say so. Contrast the
signal, which now *is* explicitly carved out.

`[AMBIGUOUS]` — the fixtures at 3502–3514 assert "**zero** calls attributable to the oversized marking's
entry" on "whatever mechanism rejects a cancellation signal". Since the design says the signal is never
*created* for such an entry (1188–1190), there is no object to attribute a call to; the fixture is phrased
against an implementation that might create one. Nothing in the normative text forbids an implementation
from creating an inert signal it never rejects.

## 5.5 Other cross-path consistency statements

- `GeometryRegistry` keys by `(loadEpoch, geometryIndex)` "**specifically so this step can never touch
  another object's state**" — which is why the epoch-scoped release "needs no occupancy check against
  `liveModelByModelId` the way round 13's interim fix did" (2601–2607, 2815–2820).
- `dispose()`'s wholesale clear "cannot suffer the same enumeration gap a per-model sweep can, because it
  never needs to identify *which* models were live in the first place" (2891–2893).
- The sweep can reach in-flight builds "at all only because a record is published to the registry when its
  build STARTS rather than when it completes" (2598–2601, 2885–2887).

---

# 6. Cross-cutting observations from this extraction pass

1. **The Round-20 fix landed cleanly at all four claimed sites** (§2.6 table). The wording at 1182–1184,
   2593–2594 and 2696–2698 is unambiguous on all three required points (no signal / excluded from
   rejection / still removed).
2. **It introduced one new intra-bullet tension** (§2.3): the bullet at 1165–1184 opens with "Every
   registry entry carries one entry-scoped cancellation signal" and closes by contradicting that
   universal. The opening sentence was not narrowed.
3. **It left one residual site** (§5.4, line 2891). The pass's own grep pattern could not have found it.
4. **It left no Round-20 changelog entry** (§Reading note), breaking the pattern Rounds 18 and 19 set, and
   the Status header (3–19) is now three passes stale.
5. **The two v3 Highs the pass deliberately skipped are both still present and verifiable**: the
   `getChildCount` Revision Notes residue (§2.7) and the Public API "Requires … certified closed" hard-
   precondition wording (§3.5).
6. **The `invariant-audit-v2` findings Round 19 listed as untouched (line 632–633) are all still present**:
   `tearDown()`/`keepCurrentModels` (§1.8), `SurfaceCrossingWitness`'s scheduling ambiguity (§1.5 site 13),
   the compaction/gate ordering transposition (§2.4), `referenceCount` (§2.1), and the `>=`/`>` boundary
   wording (§2.4).

---

# Appendix: candidate items for the audit pass

Every `[SILENT]` / `[AMBIGUOUS]` / `[CONTRADICTION]` marker placed above, for the next step's agents to
triage. No severity is assigned here.

1. `[SILENT]` — **No `### Round 20` Revision Notes entry exists.** Changelog stops at Round 19 (579–635).
   Zero grep hits for "Round 20" / "invariant-audit-v4" across all 4017 lines. (Reading note)
2. `[SILENT]` — **Status header stale** (3–19): says "seventeen rounds", calls Round 18 the current pass,
   names only `invariant-audit-v1`/`v2`. (Reading note)
3. `[AMBIGUOUS]` — **Finding-label collision**: Round 18's changelog "C4/C5" (line 553) are
   `invariant-audit-v1` labels; the document's inline "finding C-1"/"C-2" references (1660, 1662, 2270,
   2329, 2362, 3079, 3492, 3566) are `invariant-audit-v2` labels; the just-landed C-5 is an
   `invariant-audit-v3` label. No disambiguating convention is stated. (Reading note)
4. `[AMBIGUOUS]` — **`SurfaceCrossingWitness` scheduling**: 1981–1983 calls its probe loop a plain JS,
   yield-and-resume loop "with no native traversal in the way"; 2086 says it shares the "Same traversal"
   as the other two modes, i.e. the `bvhcast` native callback that 1628–1630 says cannot be paused.
   (§1.5, site 13)
5. `[SILENT]` — **No error class is named** for the `maxFragmentsPerDbId` / `maxChildrenPerNode` /
   `maxBroadPhaseInstancePairs` call-level rejections (2292–2293, 1662, 3082–3084), for a cross-model
   query (2249–2250, 3135–3137), or for "Invalid dbId" (3141). (§1.6)
6. `[SILENT]` — **`keepCurrentModels` appears nowhere** in the normative text (only at 632, inside a list
   of untouched findings). (§1.8)
7. `[SILENT]` — **`locateElementByRoom`'s model resolution** is explicitly deferred to
   `review-comments-v12.md` (2130–2132). (§1.8)
8. `[SILENT]` — **`referenceCount` is named once** (1060) and never mentioned again; no
   increment/decrement/zero semantics. (§2.1)
9. `[CONTRADICTION]` — **Intra-bullet, introduced by the Round-20 edit**: 1165–1166 "**Every registry
   entry** carries one entry-scoped cancellation signal" vs. 1182–1184 "defined **only for**
   `'building'`/`'ready'` entries — an oversized marking … never has one". The intermediate clause at
   1171–1174 ("unconditionally, for every entry they remove regardless of whether its `buildState` is
   `'building'` or `'ready'`") sits between the two. (§2.3)
10. `[CONTRADICTION]` — **Compaction/gate ordering transposition** (pre-existing, flagged untouched at
    633): 1202–1203 "Before welding, **before the ceiling check**" vs. 1216–1219 "checked …
    **before any copying happens** … Only once that check passes does compaction actually copy". Fixture
    3529–3533 pins the 1216 ordering. (§2.4)
11. `[CONTRADICTION]` — **`>=` vs `>` boundary** (pre-existing, flagged untouched at 633): 1257 "**at or
    above** that triangle count is not built" vs. 2422 / 3061 / 1216 "**exceeds**". Fixture 3534–3539
    (13,000 / 11,000) does not discriminate `12_000`. (§2.4)
12. `[AMBIGUOUS]` — **Connectivity trigger point** is explicitly left undecided by the state model
    (1142–1145), while Data Flow step 3 (2426–2429) places it inline in the build sequence and fixture
    3481–3486 describes a caller driving it against an already-`'ready'` entry. Three timings, unreconciled.
    (§2.5)
13. `[SILENT]` — **Whether an oversized marking participates in the "caller that finds an existing entry"
    lookup rule** (1131–1134) is unstated; 1186 implies the marking is consulted, 2419–2426 implies the
    ceiling check is re-run per pair. The `geometry-too-large-for-sync-build` dedup store (2424–2426) is
    never named. (§2.5)
14. `[CONTRADICTION]` — **`getChildCount` Revision Notes residue** (the first of the two v3 Highs
    deliberately skipped): normative text removes it (921–922, 1662, 2280–2282, 3078–3082, 3574–3579) while
    changelog entries assert it in the present tense, unannotated — 457 (listed as one of the walk's
    primitives), 487–490, 496–498 ("**is now** the explicit, normative preflight before every
    `enumNodeChildren` call"), 502–505. Contrast the Round-16 stage-3 entry at 446–449, which **was**
    annotated in place — the document's own stated convention (622). (§2.7)
15. `[CONTRADICTION]` — **Public API "Requires … certified closed"** (the second v3 High deliberately
    skipped): 2487–2488 / 2493–2494 state closure as a hard mode precondition, while 1386, 1884, 3118–3123
    and the whole diagnostic model treat an uncertified operand as producing a diagnostic on a
    still-returned result, never a rejection. (§3.5)
16. `[SILENT]` — **The performance gate does not require measuring** the extraction walk's per-sibling-node
    `frameBudgetMs` checkpoint, nor any release-path / eviction-sweep cost. (§4.4)
17. `[CONTRADICTION]` — **Residual C-5 site at line 2891**, in the "`world.dispose()` is terminal" prose
    (2882–2891): "**the clear rejects each entry's cancellation signal as it drops the entry**" — universal
    over entries dropped, no oversized carve-out, in a clear that per 1191–1193 and 2696–2698 also drops
    oversized markings. The Round-20 pass's own verification grep (`regardless of.*build.*state`) could not
    match this phrasing. (§5.4)
18. `[SILENT]` — **Nothing states what the release paths do about the `geometry-too-large-for-sync-build`
    dedup record** when an oversized marking is swept, or whether a fragment could be re-diagnosed as a
    result. (§5.4)
19. `[AMBIGUOUS]` — **`releaseEpochScopedState`'s "drops each one together with its cached BLAS and cached
    connectivity"** (2586–2587) is vacuous for an oversized marking (no phase ever started, 1188–1190), and
    the text does not say so — unlike the signal, which is now explicitly carved out. (§5.4)
20. `[AMBIGUOUS]` — **The new C-5 fixtures (3502–3514) assert "zero calls attributable to the oversized
    marking's entry"** on the signal-rejection mechanism, but the design says no signal is ever *created*
    for such an entry (1188–1190). Nothing normative forbids an implementation from creating an inert
    signal it never rejects; the fixture would pass either way. (§5.4)
