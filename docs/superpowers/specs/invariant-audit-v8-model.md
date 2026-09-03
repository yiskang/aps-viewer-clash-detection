# Consolidated Invariant Model — Collision Library Milestone 1 (v8, post-Round-30)

**Target**: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`, **4812 lines**, read
sequentially and completely for this pass (2026-09-03). Every line citation below is from this read of the
current working-tree file, not carried over from `invariant-audit-v1…v7*.md`. The spec has changed
materially since v7 (Round 30's 25-hunk High-only fix pass; `git diff --stat` = 175 insertions, 75
deletions, **uncommitted in the working tree** — HEAD still holds the 4712-line post-Round-29 text), so
**no factual claim in v7's model was reused** — only its section-structure convention.

**`round-30-high-only-fix-pass-disposition.md` was read for orientation only and trusted as evidence of
nothing.** Every one of its five claimed fixes was independently re-derived from the live spec text; see
§6 for the verification record, including the two places where the disposition's account is incomplete.

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
(lines 801–4812, plus the Status header at 1–38) now says. This model cites the normative body throughout
and cites the changelog only where explicitly labelled `[changelog]`. The document uses an
"annotate, never rewrite" convention for superseded changelog claims (330–334, 344–347, 410–412, 487–491,
528–534, 604–607, 719–721, 729–731, 772–777) — those annotations are also changelog, not normative.
**Round 30 added no `### Round 30` changelog entry**, per the convention Rounds 24–29 established
(disposition doc only); the changelog therefore still ends at Round 23 (786).

---

## Reading note — the document's own structure at this revision

| Lines | Section |
|---|---|
| 1–38 | Title / **Status header** (frozen at the Round 17→18 transition by the doc's own convention, 21–22; the "check `round-*-disposition.md` rather than trusting this paragraph" hedge is at 28–30) |
| 40–799 | **Revision Notes (post-review)** — Rounds 1–23 only. Sub-entries at 42 (R1), 55 (R2), 83 (R3), 112 (R4), 147 (R5), 179 (R6), 208 (R9), 240 (R10), 277 (R11), 311 (R12), 353 (R13), 383 (R14), 417 (R15), 460 (R16), 505 (R17), 554 (R18), 618 (R19), 676 (R21), 760 (R22), 786 (R23). **No R7, R8, R20, R24–R30 entries.** |
| 801–873 | Spike Findings (executable, `spike/`) — B-part findings 836–873 |
| 875–900 | Purpose |
| 902–921 | Background |
| 923–954 | Milestone Scope (cross-model exclusion 947–951) |
| 956–1069 | Architecture (runtime split 958–980, repo layout 985–1015, dependency pins 1020–1023, import map 1038–1044, welding's vendor entry 1049–1069) |
| 1071–1546 | **Components** — `ViewerModelAdapter` 1073–1139; `ViewerGeometryAdapter` 1141–1220 (layout table 1162–1166); `GeometryRegistry`/`GeometryIdentity` 1222–1244; **`CollisionInstance` identity cache 1246–1306**; `ThreeMeshBvhBackend`/`BlasCache` 1308–1546 (three-phase rule 1321–1366; publication rule 1367–1452; **compaction/gate + gate-input provenance 1454–1494**; owned-buffer 1496–1521; ceiling value 1523–1546) |
| 1548–1602 | Tolerances (table 1576–1585) |
| 1604–1649 | Solid model (even-odd declaration 1611–1629; source-union 1631–1635; closed-only-establishes-volume 1637–1638) |
| 1651–2592 | **Query modes and their preconditions** — mode table 1653–1657; containment's directedness 1659–1699; welding-required 1701–1740; `GeometryConnectivity` 1742–1765; `SurfaceIntersectionQuery` 1767–1799; `ProperCrossingQuery` 1801–2201 (**atomic-operations table 1948–1981**; tier taxonomy 1983–2073; **Round-22 worst-case-span re-derivation 2075–2201**); `ContainmentQuery` 2203–2446 (`classifyPoint` 2217–2260; `anyComponentInside` + guarantee 2262–2413; intra-loop checkpoint 2415–2446); `VolumeOverlapQuery` 2448–2484; `ContainmentModeQuery` 2486–2583 (`SurfaceCrossingWitness` 2515–2563); `CollisionWorld` 2585–2592 |
| 2594–3055 | **Data Flow — Room Locate Query** — step 1 2596–2753 (extension-lifetime gap 2605–2639; room cache 2641–2753); step 2 2754–2764; step 3 2765–3053 (entry order 2766–2772; extraction 2773–2892; **capacity admission 2894–2939, now five numbered steps**; broad phase 2940–2990; narrow phase 2991–3051; aggregation 3052–3053); step 4 3054–3055 |
| 3057–3693 | **Public API** — TS block 3059–3316 (`findClashes` 3066–3102; `admitModel` 3104–3122; `isLeaseValid` 3124–3157; `evictModel` 3159–3260; `isModelLive` 3262–3272; `dispose` 3274–3315); **"Race safety" prose 3318–3512**; `RoomLocatorExtension` sketch 3514–3564; diagnostics 3566–3693 (union 3576–3611; role tables 3621–3628, 3647–3655) |
| 3695–3863 | Error Handling & Edge Cases |
| 3865–4650 | Testing & Verification — unit 3867–4486; integration 4488–4499; **performance gate 4501–4650 (now ELEVEN pass-criterion bullets at 4518, 4540, 4542, 4544, 4558, 4568, 4588, 4601, 4611, 4619, 4632** — Round 30 inserted the 4601 capacity-admission criterion) |
| 4652–4750 | Risks |
| 4752–4812 | Open Questions Deferred to Future Milestones |

### 0. Structural / cross-reference observations (minor, not the main job)

- **0.1** Status line 3 still reads "revised after seventeen rounds of codex review"; lines 21–22 declare
  the paragraph deliberately frozen at the Round 17→18 transition and state "The changelog below
  (**Revision Notes**) continues through Round 23." Accurate for the changelog (last entry: Round 23 at
  786).
- **0.2** Lines 23–30 enumerate post-Round-23 rounds as "at minimum Round 24 …, Round 25 …, Round 26 …,
  and Round 27 … as of this writing". **Rounds 28, 29 and 30 now exist** and are not named. Self-hedged at
  26–30 ("check `docs/superpowers/specs/round-*-disposition.md` for the full, current list rather than
  trusting this paragraph's enumeration to stay exhaustive"), so the staleness is disclosed rather than
  silent. Staleness has grown by one round since v7.
- **0.3** Numbering gaps at Rounds 7, 8, 20 disclosed at 30–32. Round 20 pointed at only via 679.
- **0.4** Five finding-label conventions disclosed at 32–36; a bare label ("C-1", "H2", "H-B7") is scoped
  to its own audit document.
- **0.5** **An audit marker still leaks into normative body text.** Line 3751: "…carrying no named error
  class, the same `[SILENT]` gap those three share." Exactly one occurrence in the 4812-line file
  (grep-confirmed). Untouched by Round 30.
- **0.6** `[SILENT]` **— NEW, Round-30-introduced: a dangling section cross-reference.** Two normative
  sites now point at a section named **"Budget enforcement and yield points"**:
  - 1784: "…the whole-design worst-case-span guarantee that **Budget enforcement and yield points**
    explicitly disclaims (see 'still not a finite worst-case-span guarantee')."
  - 4724: "…excluded from the formula on purpose (see **Budget enforcement and yield points**, 'still not a
    finite worst-case-span guarantee,' and the atomic-operations table)."

  **No section, sub-heading, or bolded anchor with that name exists anywhere in the document**
  (grep-confirmed: the phrase occurs exactly twice, both as forward references). `git log -S` confirms the
  phrase has never appeared in any committed revision — both occurrences are new in Round 30's H-2 edits.
  The quoted sub-phrase "still not a finite worst-case-span guarantee" *does* resolve — it is the
  Round-22 passage at **2149–2164**, inside `ProperCrossingQuery`'s budgets. Every other
  cross-reference in this region uses the anchor "`ProperCrossingQuery`'s budgets" or "the
  worst-case-span formula".

---

# 1. Model / world lifecycle

## 1.1 The two axes

| Axis | State | Owner | Terminal? | Cited |
|---|---|---|---|---|
| **World** | `disposed: boolean`, false → true | `CollisionWorld` instance | yes, permanent | 3366–3368, 3274–3277, 3470–3474 |
| **Model** | `modelLifecycle` entry: absent → `{state:'live', epoch}` → `{state:'evicted'}` | per `Model` **object** | yes, permanent, never cleared or overwritten back to `'live'` | 3338–3353, 3345–3349 |

- **1.1.1** `disposed` is "the system's single authoritative liveness signal rather than one input among
  several" (3366–3367) and is "checked directly and first" at every site (3470–3474, 3485–3488).
- **1.1.2** Model liveness is keyed by **object identity**, never by `modelId` (3335, 3159–3162,
  337–340 `[changelog]`). A `Model` object with **no** entry has never been admitted *or* evicted — "a
  legitimate first use, the only case `findClashes` treats as 'admit fresh'" (3346–3348).
- **1.1.3** A tombstone is permanent: "nothing re-admits it, ever, because nothing ever clears or
  overwrites it back to `'live'`" (3348–3349); "this exact object can never become live again in this
  world, even if `model.id` is later reused by a different object" (3179–3181).

**Verdict: HOLDS.** Round 30 touched none of this (no diff hunk falls in 3159–3512).

## 1.2 World-owned lifecycle state (inventory)

| Name | Shape | Cited | Role |
|---|---|---|---|
| `modelLifecycle` | `WeakMap<Model, {state:'live';epoch:number} \| {state:'evicted'}>` | 3338–3353, 3168–3170 | authoritative per-object liveness; **deliberately non-enumerable** (3350–3353, 3461–3462) |
| `liveModelByModelId` | `Map<modelId, Model>` | 3354–3365 | **diagnostic/bookkeeping only** — "no correctness property in this design depends on this map's completeness anymore" (3360–3362); "best-effort updated for diagnostic/bookkeeping purposes only" (3510–3512) |
| `disposed` | `boolean` | 3366–3368 | world terminal flag |
| `nextLoadEpoch` | number counter, global to the `CollisionWorld` instance, only ever increments, never reset or scoped per `modelId` | 3369–3374 | `epoch = nextLoadEpoch++` on first admission; "a different `Model` object reusing a `modelId` still gets a strictly greater epoch than anything issued before it" (3371–3373) |

- **1.2.1** The `'evicted'` variant **carries no epoch at all**, "because nothing ever needs to compare one:
  every liveness/lease check short-circuits on `state !== 'live'` before it would ever read `.epoch`"
  (3168–3172, 3340–3345).
- **1.2.2** The `WeakMap` choice is load-bearing twice: it makes "permanent" free rather than a leak
  (3350–3352), **and** "nothing in this design may depend on being able to *enumerate* `modelLifecycle`"
  (3352–3353).
- **1.2.3** `[SILENT]` **(carried, v7 M-L2).** `dispose()` enumerates exactly four caches it clears
  (3290–3292, 3495–3497) and **never states that `liveModelByModelId` is cleared**. It only "best-effort
  tombstones whatever `liveModelByModelId` currently references" (3307–3309). `liveModelByModelId` is a
  plain `Map` holding strong `Model` references — the one remaining world-owned structure that does — so
  the `WeakMap`-is-free-not-a-leak argument at 3350–3352 does not cover it. Re-verified: the two "all four
  caches" enumerations (3290–3292, 3495–3497) both omit it.

## 1.3 `ModelLease`

- **1.3.1** `admitModel(model)` returns `{ model, epoch }` — "an opaque capture of this exact object's
  current lifecycle state, valid until the object is evicted or the world is disposed" (3105–3106).
- **1.3.2** Idempotent: calling again for an already-live object "returns a lease with that same epoch (does
  not re-admit or reassign)" (3106–3107); pinned by fixture 4332–4334.
- **1.3.3** A lease "only exists for a model this call itself admitted, so the callback always finds either a
  still-valid lease or one invalidated by a real eviction/disposal in between" (3743–3745).

## 1.4 Public method contracts

### `world.admitModel(model): ModelLease` — 3104–3122

Synchronous. Three outcomes **checked in this order** (3108–3114):
1. world disposed → **throws** `WorldDisposedError`
2. this exact object tombstoned `'evicted'` → **throws** `ModelEvictedError`, immediately, no new epoch
3. otherwise → admits if not already admitted (`epoch = nextLoadEpoch++`, records `liveModelByModelId`)
   and returns the (possibly pre-existing) lease

Fixtures: 4332–4334 (idempotence, `nextLoadEpoch` consumed once), 4335–4338 (evicted → throws, no epoch).

### `world.isLeaseValid(lease): boolean` — 3124–3157

- **Strictly non-throwing and total** for any lease `admitModel` ever returned (3125–3126).
- Checks `disposed` **first, directly** (3126–3130); pseudocode is explicit:
  `if (disposed) return false; const entry = modelLifecycle.get(lease.model); return entry?.state === 'live' && entry.epoch === lease.epoch;`
- **One of exactly two deliberate exceptions** to "every public method throws `WorldDisposedError` once
  disposed" (3136–3139); `evictModel` is the other.
- Cannot say *why* a lease is invalid; the caller derives that outside the predicate via `isModelLive` in a
  `try`/`catch` (3146–3151).
- Fixture 4385–4391 (post-`dispose()` from a mocked async callback → `false`, no throw).

### `world.evictModel(model): void` — 3159–3260

Pseudocode (3173–3178), in this order:
```
if (disposed) return;                              // no-op, NOT a throw
const previous = modelLifecycle.get(model);
if (previous?.state === 'evicted') return;         // idempotent no-op
modelLifecycle.set(model, { state: 'evicted' });   // unconditional
if (previous?.state === 'live') releaseEpochScopedState(previous.epoch);
```
- **1.4.1** Tombstone write precedes the conditional release, and is permanent either way (3179–3181).
- **1.4.2** `releaseEpochScopedState` (3182–3200): sweeps `GeometryRegistry` for **every** entry under the
  epoch — `'building'`, `'ready'`, **plus any oversized marking** — and drops each "together with its cached
  BLAS and cached connectivity where it has any". For each `'building'`/`'ready'` entry it **first rejects
  that entry's cancellation signal** — created once at insertion, carried unchanged across
  `'building' → 'ready'` — then deletes identity-guarded. An oversized marking has no signal; removal is
  the entire cleanup.
- **1.4.3** It also, "as an independent operation over a different keyspace (not derived from this
  `GeometryRegistry` sweep — the `CollisionInstance` cache is keyed by every collected fragment, a strict
  superset of the registry's lazily-built candidate-pair keyspace), deletes the outgoing epoch's own
  `CollisionInstance` bucket" (3186–3190).
- **1.4.4** **Must be non-throwing** (3210–3216): "a synchronous map/set removal and promise rejection,
  nothing that can itself fail"; a throw would leave the tombstone written but the release incomplete and
  *unretriable* (the `'evicted'` entry no longer carries the epoch).
- **1.4.5** `liveModelByModelId` entry deleted only if this object is still that id's current occupant —
  explicitly "diagnostic/bookkeeping only" (3217–3220).
- **1.4.6** **Disposed → silent no-op, not a throw** (3227–3257), with three justifications in descending
  force: (1) verifiably destructive to the Viewer (`EventDispatcher.dispatchEvent` at `viewer3D.js:13300-13341`
  has no try/catch; `unloadModel` at `:34052-34054`; unguarded loop at `:34253-34258`; `tearDown` at `:26583`
  wraps extension unloads but **not** `unloadCurrentModel`); (2) nothing left to do; (3) it is the branch
  the method already had.
- **1.4.7** The extension-owned room cache is **not** covered by the no-op — the handler must drop it
  unconditionally (3258–3260, restated 3554–3558).

### `world.isModelLive(model): boolean` — 3262–3272

`disposed` first → **throws** `WorldDisposedError`. Otherwise true iff `{state:'live'}`. **Never seen → false**
(3265–3266). Explicitly wrong as a pre-admission gate (3269–3272). Fixture 4392–4394.

### `world.dispose(): void` — 3274–3315

- Sets `disposed` **first, synchronously, before anything else** (3275–3277).
- After it returns, `findClashes`, `admitModel`, `isModelLive`, and a second `dispose()` all reject/throw
  `WorldDisposedError` (3278–3280).
- **Two deliberate exceptions**, both still checking `disposed` directly and first: `isLeaseValid` (returns
  `false`), `evictModel` (no-op) — 3281–3289.
- Wholesale-clears **all four caches** — `GeometryRegistry`, `BlasCache`, every cached
  `GeometryConnectivity`, and the `CollisionInstance` identity cache — "each in its own single clear
  operation, not a per-model sweep over `liveModelByModelId`" (3290–3293).
- **Also required to be non-throwing**, for the identical unretriability reason (3293–3298).
- Rejects every in-flight build promise via the same entry-scoped cancellation signal, including a lazy
  connectivity build on an already-`'ready'` entry; oversized markings carry no signal (3298–3307).
- Best-effort tombstones `liveModelByModelId`, explicitly non-load-bearing (3307–3312).

### `world.findClashes(query)` entry contract — 3066–3073, 3431–3456, 2766–2772

**Canonical three-step entry order**, stated identically at all three sites:
1. `disposed` → reject `WorldDisposedError`, "regardless of query contents, before this or any other check
   runs" (2766–2768, 3067–3068, 3432–3433).
2. `source.model !== target.model` → reject immediately, "ahead of the per-operand eviction checks and lazy
   admission … a structurally unsupported query is rejected before either operand is admitted or looked up,
   and never mutates any lifecycle state" (2768–2772; 3069–3070; 3433–3436).
3. Per operand: `'evicted'` → `ModelEvictedError`; no entry → lazy admission (3070–3073, 3436–3439).

- **1.4.8** A failure at entry *or any yield checkpoint* aborts the **entire** call: `WorldDisposedError` or
  `ModelEvictedError` "naming the evicted `modelId`" — "**neither returns a partial or diagnosed
  `ClashResult`**" (3449–3453). This is the clause that collides with the abort-only tier's diagnosed-negative
  exit; see 1.5.4.
- **1.4.9** `[AMBIGUOUS]` (carried). 3797–3799 says a cross-model query "**rejects synchronously**", but
  `findClashes` returns `Promise<ClashResult>` (3066) and Data Flow calls it as an awaited promise (2754).
  A `Promise`-returning method cannot "reject synchronously"; the intended meaning (reject without doing any
  work) is inferable but not stated.

## 1.5 Checkpoint / yield sites and what each revalidates

**The universal rule** (2064–2073, the most load-bearing lifecycle sentence in the budget section):

> "**What is conditional here is only the scheduling yield.** The two-part lifecycle revalidation every
> checkpoint carries — `disposed` first, then the model's load epoch (see 'Race safety' under
> **`world.evictModel`**) — runs whenever a checkpoint is reached, accumulator-due or not; **it is never
> itself skipped.** When a checkpoint's `await` does fire — including an `await` on a shared build-phase
> slot, not only the accumulator-driven scheduling yield — the two-part revalidation runs again immediately
> on resume…"

Quantifier at 2060–2062: "**Every checkpoint named in this document — the build-phase checkpoints and the
`bvhcast`-entry checkpoints included — is this same mechanism**, except `bvhcast`'s own internal abort clock
once a traversal is already under way."

Enumerated checkpoint sites in the current text:

| # | Site | Cited | Can it pause/resume? |
|---|---|---|---|
| 1 | before each requested dbId's extraction | 2775–2777, 3030 | yes |
| 2 | between sibling nodes at the same depth in the extraction walk | 2859–2861, 2844–2845 | yes |
| 3 | before the broad-phase scan starts | 3030 | yes |
| 4 | before **each individual instance pair** inside the broad-phase scan | 2958–2964, 3031 | yes (resumes at exact `(sourceIndex, targetIndex)`) |
| 5 | before each candidate pair (cached or not) | 3029 | yes |
| 6 | between each of a pair's composed sub-queries | 3031–3032 | yes |
| 7 | before the compaction+welding phase | 1339–1341, 1958 | yes (before it starts) |
| 8 | before the connectivity phase | 1339–1341, 1959 | yes |
| 9 | before the BVH phase | 1339–1341, 1960 | yes |
| 10 | before **each individual `classifyPoint` call** in `anyComponentInside` stages 1–2 | 2421–2430 | yes, yield-and-resume, non-truncating |
| 11 | before each witness-triangle attempt (stage 3) | 2441–2443 | yes |
| 12 | `ProperCrossingQuery`'s `bvhcast` callback entry | 1927–1931 | **no — abort only** |
| 13 | `ProperCrossingQuery`'s per-probe check inside a confirmed pair | 1924–1931 | **no — abort only** |
| 14 | `SurfaceCrossingWitness`'s callback entry and per-probe checks | 2558–2562 | **no — abort only**, but reads the *shared* accumulator |
| 15 | **`SurfaceIntersectionQuery`'s `bvhcast` callback entry** — NEW in scope as of Round 30 | 1795–1799, 2021–2029 | **no — abort only**, private clock |

- **1.5.1** Site 4's mid-scan suspension is safe **only** because each `PlacedCollisionInstance`'s matrix and
  bounds are per-call, call-owned snapshots and the candidate list is call-local (2981–2990). The lifecycle
  checkpoint "does **not** catch a transform, explode, or visibility change mid-scan, and the snapshot is
  what makes that harmless rather than a torn read" (2988–2990).
- **1.5.2** Site 10's yield "does **not** truncate the search — sampling resumes exactly where it paused"
  (2438–2440). Distinct from the abort-only sites by design.
- **1.5.3** Site 7's checkpoint is stated to also gate `ViewerGeometryAdapter`'s work (1958, 1465,
  3001–3002) — new in Round 30. See §2.4.
- **1.5.4** `[SILENT]` **(carried from v7 1.5.2, and now BROADER).** Sites 12, 13, 14 and — new as of
  Round 30 — **15** are quantified over by 2060–2062's "every checkpoint … the `bvhcast`-entry checkpoints
  included" and by 2064–2067's "never itself skipped", yet **none of the four passages defining them
  specifies any lifecycle check, any precedence between a lifecycle failure and an `aborted` flag, or any
  propagation mechanism.** The passages state only:
  - 1927–1936 (`ProperCrossingQuery`): "The moment elapsed time crosses `frameBudgetMs` at either
    checkpoint, `aborted` is set exactly as the count-based triggers do… the pair is reported via
    `crossing-budget-exhausted` and `findClashes` returns to an `await`-capable context."
  - 2558–2563 (`SurfaceCrossingWitness`): "…the shared elapsed-time accumulator is checked at callback entry
    and immediately before every probe, and exceeding either count ceiling or `frameBudgetMs` sets a
    traversal-local `aborted` flag and returns `true` from the callback".
  - 1795–1799 (`SurfaceIntersectionQuery`): "**'The same abort protocol' includes the private,
    traversal-local time-based trigger**… this traversal's own worst case is therefore `frameBudgetMs` + one
    raw candidate callback's own cost".
  - 2021–2029 (abort-only tier): "the time-based trigger is checked at callback entry exactly as it is for a
    raw candidate pair… so it applies unchanged to a traversal with no probe loop at all."

  The **only specified exit** from any of these is `aborted` → a **diagnosed negative**, which is exactly the
  result shape 3449–3453 forbids for a lifecycle failure ("neither returns a partial or diagnosed
  `ClashResult`"). Round 30 **did not touch this gap and extended its scope by one traversal** — the
  abort-only tier now normatively has two members (2018–2029, 2118–2119), and the "every checkpoint" claim at
  2060–2062 now quantifies over both.
- **1.5.5** Fixtures pin sites 10's lifecycle behavior explicitly: 4031–4033 (evicted during mid-loop yield →
  `ModelEvictedError`), 4034–4037 (`dispose()` during mid-loop yield → `WorldDisposedError`, "A design whose
  intra-stage checkpoints re-check only the load epoch passes the eviction fixture above and fails this one").
  **No fixture anywhere pins lifecycle behavior at sites 12–15.**

## 1.6 Error types

- **1.6.1** `WorldDisposedError` — thrown/rejected by `findClashes`, `admitModel`, `isModelLive`, repeated
  `dispose()` (3278–3280); at every checkpoint on `disposed` (3477–3480); by the room-search callbacks
  (3151–3153).
- **1.6.2** `ModelEvictedError` — "naming the evicted `modelId`" (3451); one literal construction site,
  `new ModelEvictedError(model.id)` (3715). Callers "may branch on which error class they got" (3728–3729,
  4397–4398).
- **1.6.3** `[SILENT]` (carried, v7 L-L2). **No constructor signature or payload shape is stated for
  `WorldDisposedError` anywhere** — grep-confirmed zero `new WorldDisposedError` occurrences in the file.
- **1.6.4** `[SILENT]` (carried, v7 L-L3). `ModelEvictedError(model.id)` carries precisely the identifier
  the round-12→14 redesign established is insufficient to identify a load (3159–3162, 3401–3413). Under the
  design's own supported two-live-objects-sharing-a-`modelId` state, the payload is ambiguous.
- **1.6.5** `[SILENT]` / **self-labelled** (carried, v7 1.6.3 / 5.2.7). Four call-level ceiling rejections —
  `maxFragmentsPerDbId` (3711–3720), `maxChildrenPerNode` (3721–3739), `maxBroadPhaseInstancePairs`
  (3740–3744), `maxCollisionInstancesPerEpoch` (3745–3751) — carry **no named error class**. The fourth
  bullet says so in the audit's own private vocabulary: "carrying no named error class, the same `[SILENT]`
  gap those three share" (3750–3751). **Round 30 added a fifth rejection path (the step-2 precheck,
  2903–2911) with no named error class either**, and did not update this bullet's "those three" count — the
  precheck's rejection is folded into the same 3745–3751 bullet only implicitly.

## 1.7 `modelId` reuse semantics

- **1.7.1** Supported and tested: two `Model` objects sharing a reused `modelId` may be simultaneously live
  (3358–3360, 3463–3466, fixtures 4339–4350, 4375–4384, 4407–4416).
- **1.7.2** Structural disjointness: `(loadEpoch, geometryIndex)` and `(loadEpoch, fragmentId)` keying makes
  the two objects' caches disjoint "before its first geometry lookup ever runs" (3415–3429, 1246–1248).
- **1.7.3** A stale/delayed `evictModel(oldModel)` "can only ever release records filed under `oldModel`'s
  own epoch" (3206–3210, 3848–3856).

## 1.8 Extension-side lifecycle (`RoomLocatorExtension`, 3514–3564)

- **1.8.1** `load()` awaits `CollisionWorld.fromViewer` to completion **before** registering the
  `BEFORE_MODEL_UNLOAD_EVENT` listener or the context-menu item, in the same call; if `fromViewer()` rejects,
  neither registration runs — "neither exists without the other" (3517–3527).
- **1.8.2** `unload()`'s three steps, in stated order: `world.dispose()`, unregister context menu +
  listener, clear the per-model room cache (3528–3529).
- **1.8.3** Two disclosed throw hazards (3529–3553):
  - the dispose-first ordering leaves a window where `BEFORE_MODEL_UNLOAD_EVENT` can fire into an
    already-disposed world — "benign, but only because `world.evictModel` is a no-op on a disposed world
    rather than a throw — it is the method's totality that makes this ordering safe, not the ordering itself";
  - a **repeated `unload()`** re-invokes `world.dispose()`, which "is guaranteed to throw
    `WorldDisposedError` … synchronously, before steps 2/3 ever run — **stranding listener removal,
    context-menu removal, and the room-cache clear** for that invocation". `Viewer3D.tearDown` swallows it —
    "the same 'benign only because something else catches it' shape as the first hazard, not a resolution of it".
- **1.8.4** `[SILENT]` (carried). "Whether the Viewer or app code can invoke `unload()` a second time on one
  instance is unstated. **Per-step isolation of `unload()`'s three steps**, and whether the listener should be
  removed before `dispose()` rather than after, **remain open and are not settled here**" (3549–3553).
- **1.8.5** `[SILENT]` (carried). Extension-instance survival across a model switch: "on this app's current
  wiring, Room Locator does not survive a second model load at all — it is unloaded once and never comes
  back" (2619–2621); "either the application must explicitly reload the extension … or Milestone 1 is
  understood to support Room Locator only up to the first model replacement — **neither is decided here**"
  (2621–2625).
- **1.8.6** The `tearDown()` ordering claim (2625–2639) is source-cited to `viewer3D.js:26541-26560`, `:26583`,
  `:34052`, `:34054`, and self-marked "an internal implementation detail, not documented or guaranteed by
  Autodesk — **revalidate on any Viewer upgrade**".
- **1.8.7** `[SILENT]` (carried). `BEFORE_MODEL_UNLOAD_EVENT`'s payload shape: typings declare `event: any`,
  so `event.model` "needs a one-time confirmation against the 7.124.2 source or a live console check during
  implementation" (2651–2659, 4667–4673).
- **1.8.8** Room-cache rules, unified: **every** rejection path applies the identity-guarded delete
  `if (roomCache.get(model) === thisPromise) roomCache.delete(model)` — "This identity-guarded delete is
  unconditional: every rejection path in this mechanism uses it, with no special-cased exception"
  (2668–2677, 2701–2709, 2734–2742).
- **1.8.9** The disposed-first mapping inside the callbacks: `isLeaseValid(lease)` false → derive the cause
  via `isModelLive` inside `try`/`catch`; caught `WorldDisposedError` **is** the rejection reason, otherwise
  `new ModelEvictedError(model.id)` (2709–2729). "Nothing can interleave between the two calls — both are
  synchronous and there is no `await` between them."
- **1.8.10** Both callbacks (success and error) use **one** mapping and **one** delete rule: "A design in
  which the two callbacks classify the same invalid lease differently, or delete the cache entry in one but
  not the other, is a bug" (2734–2742). Fixture 4441–4451.

---

# 2. Geometry ownership / build pipeline

## 2.1 `GeometryRecord` identity

- **2.1.1** One `GeometryRecord` per unique **`(loadEpoch, geometryIndex)`** — "keyed by the owning `Model`
  object's admitted load epoch, not its numeric `modelId`" (1222–1224); dedup key derivation at 1130–1139;
  restated 3204–3206, 3415–3423.
- **2.1.2** `modelId` "remains attached to a record only as display/diagnostic metadata … it plays no role in
  cache identity" (1241–1243).
- **2.1.3** Record fields: `referenceCount` (reserved/unused), `buildState: 'building' | 'ready'`, and one
  lazily-created promise per build phase — `weldPromise` (compaction + weld), `accelerationPromise` (BLAS),
  and the promise behind a lazy `connectivity` (1225–1232). Each phase promise "is created at most once per
  unique geometry and its product reused by every fragment instancing it" (1239–1241).
- **2.1.4** `[SILENT]` (carried). `referenceCount` — "reserved, unused in Milestone 1 — release is
  epoch-scoped, not reference-counted" (1225–1227). Its Milestone-1 contract is complete; **no forward
  contract for any future milestone is stated anywhere**, and the field appears in no other normative site
  (grep-confirmed: 672 `[changelog]`, 1225).

## 2.2 The three kinds of registry entry

"A registry lookup yields one of three things: an **oversized marking** (no phase is ever started for it, it
carries no `buildState`, and every pair needing it is skipped), a `'building'` record, or a `'ready'` one"
(1444–1446).

- **2.2.1** An oversized marking "has no unresolved phase work and therefore **never has the entry-scoped
  cancellation signal … created for it at all**" (1446–1450). Both release paths still enumerate and remove
  it; "removal is the entire cleanup" (1450–1452). Restated 3196–3197, 3305–3307. Fixtures 4173–4185.
- **2.2.2** `[SILENT]` (carried). **Whether an oversized marking is ever re-evaluated or replaced within a
  live epoch is unstated.** 2991–2999 says an existing oversized marking "skips the pair immediately …
  **without re-running `ViewerGeometryAdapter` or the ceiling check**, both of which already ran and settled
  this verdict the first time any pair touched this geometry" — which now makes the marking explicitly
  permanent for the entry's lifetime (Round 30 strengthened this), but nothing states what happens if the
  underlying inputs could change within one epoch.

## 2.3 The entry-lifetime cancellation signal

- **2.3.1** "Every `'building'`/`'ready'` registry entry carries **one entry-scoped cancellation signal,
  created once when the entry is first inserted in `buildState: 'building'` and kept alive, unchanged, for
  the entry's entire lifetime** — the signal is *not* discarded or replaced when the entry transitions to
  `'ready'`" (1425–1429).
- **2.3.2** "Every unresolved phase slot the entry ever hosts races that same signal, including a lazy
  connectivity build started later against an already-`'ready'` entry" (1429–1432).
- **2.3.3** One signal per entry suffices "because phases are strictly sequential and single-flight per
  entry — weld, then connectivity if needed, then the BVH, with at most one phase ever unresolved on a given
  entry at a time" (1436–1439).
- **2.3.4** Both release paths reject exactly once and drop the entry in the same step, unconditionally,
  identity-guarded (1432–1443; 3190–3200; 3298–3307).
- **2.3.5** "Clearing a map does not by itself settle a pending promise, which is what both of those
  guarantees require" (1435–1436). Fixtures 4158–4172, 4186–4195.

**Verdict: HOLDS.** Untouched by Round 30.

## 2.4 Pipeline stages, in order

The canonical sequencing invariant, in the order the current text states it:

**`ViewerGeometryAdapter` normalization → `activeTriangleCount` computation → `maxSyncTriangleCount` gate →
active-range compaction → weld → connectivity (when required) → BVH.**

Stated at three sites, now mutually reinforcing after Round 30:
- **1454–1494** (`ThreeMeshBvhBackend`/`BlasCache`, the gate's own passage)
- **1958** (atomic-operations table, compaction+welding row)
- **2991–3013** (narrow phase, restructured by Round 30 into registry-lookup-first)

- **2.4.1** **Gate-input provenance — NEW in Round 30.** 1464–1468 now reads:

  > "`ViewerGeometryAdapter` itself runs **once per unique `(loadEpoch, geometryIndex)`, as the first
  > sub-step of this same phase/checkpoint, on the registry's first touch of this geometry — never per
  > candidate pair, and never re-run for an entry already present as an oversized marking or a
  > `'building'`/`'ready'` record** (see the atomic-operations table's compaction+welding-phase row and the
  > narrow phase below, which resolves the call-frequency ambiguity an earlier draft of this passage left
  > open)."

  The narrow phase (2991–3013) implements exactly this: an existing oversized marking skips "**without
  re-running `ViewerGeometryAdapter` or the ceiling check**"; an existing `'building'`/`'ready'` entry "skips
  straight to awaiting its phase slots"; "**Only a lookup that finds no entry at all** runs, in this order,
  inside that first-touch phase/checkpoint: `ViewerGeometryAdapter`'s layout normalization producing
  `ranges: TriangleRange[]`; the conversion to `activeTriangleCount = Σ floor(ranges[].count / 3)`; then the
  ceiling check". Fixture 4196–4205 updated to "(from `ViewerGeometryAdapter`, computed once on this
  geometry's first registry touch — see the active-range gate)". **The "already-normalized … computed during
  the earlier layout-normalization pass" wording v7 flagged is gone** (grep: zero occurrences of "already-
  normalized" outside `[changelog]` line 498).
- **2.4.2** The gate's own arithmetic: `activeTriangleCount := Σ floor(ranges[i].count / 3)` (1475–1476,
  1187–1189, 3003–3005, 3704–3707). Comparing raw `sum(ranges[].count)` "would enforce a ceiling roughly 3×
  stricter … about 4,000 real triangles, not `12_000`" (1479–1481). Fixtures 4211–4216 (39,000/33,000 index
  elements) and 4217–4221 (exactly `12_000` → built, pinning strict `>`).
- **2.4.3** `maxSyncTriangleCount` is checked **before any copying happens**: "a fragment whose active set
  alone exceeds the ceiling is marked oversized and diagnosed exactly as before, without ever materializing a
  compacted buffer for it" (1485–1488). Fixture 4206–4210 (spy on compaction: zero calls).
- **2.4.4** Compaction, weld, connectivity, BVH "all run over this **same** compacted buffer; none of the
  three ever sees a triangle outside the active ranges" (1490–1491). Round 16 retired the
  "set `groups`/`drawRange` on the BVH input" workaround as unnecessary (1507–1511).
- **2.4.5** Each phase "gets its own checkpoint immediately **before** it starts — not partway through, since
  none of the three can be paused mid-call" (1339–1341).
- **2.4.6** The Round-22 correction: each phase's checkpoint is "the same conditional,
  shared-`frameBudgetMs`-accumulator check every other checkpoint in this design uses… It yields only when
  the accumulator is already due" (1345–1352). It "prevents *another* phase from starting once the shared
  accumulator is already due — it does not guarantee one build phase per synchronous span" (1350–1352). The
  concrete counterexample: connectivity (~6.9ms) + BVH (~16ms) ≈ **22.9ms** in one span (1357–1360).
- **2.4.7** `[AMBIGUOUS]` — **NEW/aggravated by Round 30.** 1460–1462 still opens the compaction passage with:

  > "**The fix inserts one more phase before the three above, not gated by `frameBudgetMs` but by the ceiling
  > itself: active-range compaction.**"

  Round 30 then appended, three lines later (1465), that `ViewerGeometryAdapter` runs "as the first sub-step
  of **this same phase/checkpoint**". The nearest antecedent for "this same phase/checkpoint" is a phase the
  sentence at 1460–1461 says is **not gated by `frameBudgetMs`**. Three other sites say the opposite — 1958
  ("Own checkpoint, before it starts"; "This phase's own checkpoint also gates `ViewerGeometryAdapter`'s
  layout-normalization"), 1339–1341, and 3001–3002 ("inside that first-touch phase/checkpoint"). The
  three-site reading is clearly intended; the 1460–1461 clause is stale relative to the folding the table row
  itself records ("Round 16 folded active-range compaction into this same phase/checkpoint"), and Round 30
  made it load-bearing by anchoring a new normative claim to it.
- **2.4.8** `[AMBIGUOUS]` (carried, v7 2.4.8, now **narrowed but not closed**). Where the ceiling check
  physically lives is now settled by 2991–3013 (narrow phase, on first registry touch). What remains
  under-determined is **whether a `'building'` entry is ever inserted for a geometry that turns out
  oversized**: 3006–3008 says "over the ceiling, the entry is inserted **as an oversized marking** … at or
  under it, the entry is inserted `'building'`" — i.e. never. But 1444–1452 describes the oversized marking as
  a lookup outcome without saying who inserts it or when, and 1378–1380 states the insert-first rule as
  "The caller whose lookup misses inserts the `GeometryRecord` … with `buildState: 'building'` **before** the
  first phase's checkpoint — that is, before any yield." Under 1378–1380 read literally, insertion precedes
  the checkpoint that (per 1465) hosts the normalization and gate that decide oversized-ness. The two orders
  are not reconciled in one place.

## 2.5 Publication, single-flight, and what a caller may read

- **2.5.1** "**Insert first, then build.**" (1378–1380). "A caller that finds an existing entry never starts a
  duplicate build" (1384–1389).
- **2.5.2** "**Nothing reads a phase's product off a `'building'` record.** The compacted/welded buffers, the
  `MeshBVH`, and the `GeometryConnectivity` decomposition are only ever the resolved values of their own
  phase slots, never fields read straight off the record" (1390–1392).
- **2.5.3** "**`buildState: 'ready'` is record-level and mode-independent: it means compaction+weld and the
  BVH have both resolved**" — everything `surface-intersection` needs; `containment`/`volume-overlap`
  additionally await connectivity's slot on the same entry. "Connectivity is never what makes a record
  un-`'ready'`" (1393–1402).
- **2.5.4** "**A build-phase checkpoint validates the record's *owner*, not the building caller's whole
  query**" — `disposed` first, then the liveness/epoch of the one model whose `loadEpoch` is in the record's
  key, "and nothing else" (1403–1412). Explicitly vacuous under Milestone 1's same-model restriction and
  retained forward-looking (1406–1411); fixture 4186–4195 notes it "is not a test of the
  owner-vs-counterpart scoping distinction … which Milestone 1's same-model restriction makes unreachable".
- **2.5.5** "There is no `'failed'` state." A rejecting phase removes the entry from `GeometryRegistry`
  **synchronously as part of that rejection**, identity-guarded (1416–1424). Fixture 4137–4144.
- **2.5.6** "A caller whose own query aborts for an unrelated reason does not cancel a phase already in
  flight: every phase slot runs to settlement, so a `'building'` entry is never left permanently unsettled
  with other callers awaiting it" (1412–1415).

## 2.6 Release paths (geometry side)

- **2.6.1** `evictModel` → `releaseEpochScopedState(epoch)`: `GeometryRegistry` sweep over that epoch, plus
  the independent `CollisionInstance` bucket delete (3182–3190). See 1.4.2–1.4.4.
- **2.6.2** `dispose()` → wholesale clear of all four caches, no enumeration of models (3290–3293,
  3495–3509).
- **2.6.3** `[AMBIGUOUS]` (carried, v7 2.6.3 / M-7C3). **Is `BlasCache` a distinct keyspace or the storage
  behind a registry-entry phase slot?** Two unannotated normative readings coexist:
  - *Slot, no keyspace of its own*: "that dedup is **not** a mechanism `BlasCache` owns. It is the
    registry-level rule above applied to one phase: what a concurrent caller observes is the published
    `GeometryRegistry` entry, and `accelerationPromise` is one of that entry's single-flight phase slots …
    `BlasCache` owns building the `MeshBVH` and caching it behind that phase slot — not the
    not-building-it-twice rule" (1512–1521); and `GeometryRecord` itself holds `accelerationPromise`
    (1229–1231).
  - *One of four independently-cleared caches*: "`dispose()` also wholesale-clears **all four caches** —
    `GeometryRegistry`, `BlasCache`, every cached `GeometryConnectivity`, and the `CollisionInstance`
    identity cache — **each in its own single clear operation**" (3290–3293); repeated 3495–3497.

  Untouched by Round 30. Determines whether 2.6.4 is a documentation nicety or a completeness precondition.
- **2.6.4** `[SILENT]` (carried, v7 2.6.4 / 5.3.2). **No keyspace-relationship statement exists for
  `BlasCache` or cached `GeometryConnectivity` relative to `GeometryRegistry`.** `evictModel`'s release of
  both is purely derived — "drops each one, **together with its cached BLAS and cached connectivity where it
  has any**" (3183–3186) — and a derived release is complete only if the derived-from keyspace is a superset.
  The `CollisionInstance` cache received exactly that argument, explicitly (1276–1280, 3186–3190); these two
  received none.

## 2.7 Extraction contract

- **2.7.1** **No code path may call recursive `enumNodeFragments(dbId, cb, true)`** (1076–1087). "**`getChildCount`
  is not one of the walk's primitives**" (1086–1087, 2802–2804, 3724–3728).
- **2.7.2** Coverage equivalence, verified against the pinned bundle: "**The union of the walk's per-node
  `enumNodeFragments(node, cb, false)` results is therefore the same fragment set one
  `enumNodeFragments(dbId, cb, true)` call produces** — same set, not merely a superset" (1100–1104).
- **2.7.3** Two conditions the equivalence rests on (1105–1118): (1) *no truncation* — both early exits
  reject the **entire** `findClashes` call; (2) *a complete tree to walk* — "**this spec does not claim to
  have closed the second**". Restated as a Risk (4674–4682).
- **2.7.4** The walk's normative steps (2788–2861): fanout ceiling via in-callback abort inside
  non-recursive `enumNodeChildren` (**sole** enforcement, every node shape); per-node non-recursive
  `enumNodeFragments`; tally check against `maxFragmentsPerDbId` after every node's contribution, stopping
  immediately; descend into collected child ids **after** the call returns; `frameBudgetMs` checkpoint
  between sibling nodes.
- **2.7.5** Three normative implementation constraints (2815–2825): abort recorded in a **local flag** (the
  forwarded return is a dbId and `0` is falsy); the callback **only collects child ids**, never descends
  inline; typings declare both callback and return as `void`, contradicting the documented contract, "so the
  abort must be pinned by a test rather than trusted to the type surface".
- **2.7.6** "The tally counts **callback invocations, not distinct fragment ids**" (2827–2831).
- **2.7.7** `[SILENT]` (carried). Instance-tree readiness at extraction time — "no code path in this
  milestone checks Viewer-side tree-readiness before extraction begins" (4674–4682, 1112–1118).

## 2.8 Welding

- **2.8.1** Mandatory, not optional (1701–1714). Strip to **position + index only** first — "That makes the
  idea doc's 'do not copy rendering attributes' rule (written to save memory) **load-bearing for
  correctness**" (1710–1714).
- **2.8.2** `weldEpsilon = 1e-4 m / model.getUnitScale()`, falling back to `1e-4` (1732–1734); upstream is a
  **grid quantization, not an epsilon-ball** — "the guarantee is 'identical coordinates always merge,' not
  'anything within `tolerance` merges'" (1724–1730).
- **2.8.3** Position and index are **owned** buffers; `indexOwnership: 'clone'` is the only supported value
  and `'indirect'` is "not merely unimplemented but inapplicable" (1496–1507).

## 2.9 `GeometryConnectivity`

- **2.9.1** Union-find over triangles sharing an **edge**; computed once per unique `GeometryRecord` and
  cached alongside the BLAS (1742–1746). Manifold classification falls out for free (1745–1746, 1761–1765).
- **2.9.2** A component is **manifold** iff every edge is shared by exactly two triangles; boundary edges
  (used once) or non-manifold edges (three or more) flag it (1761–1765).
- **2.9.3** `[CONTRADICTION]` (carried, v7 M7-G2). **The definition is still range-restricted.** 1742–1744:

  > "decomposes the welded geometry into connected components by union-find over triangles that share an
  > **edge** (two vertex indices), **restricted to the active triangle ranges**."

  But since Round 16 connectivity runs over the **compacted-then-welded** buffer, which by construction
  contains only active triangles and whose vertex numbering the original `ranges` offsets no longer index
  (1490–1494, 1496–1507). Applied literally the restriction is wrong, not merely redundant. Round 16 retired
  the structurally identical clause on the BVH side (1507–1511) but not here. Untouched by Round 30.

## 2.10 Fragment-scoped diagnostics and dedup

- **2.10.1** `FragmentDiagnosticReason` has three members (3577–3580): `'unsupported-geometry-layout'`,
  `'rejected-primitive-range'`, `'geometry-too-large-for-sync-build'`.
- **2.10.2** `[SILENT]` (carried, v7 M7-G3). **Only the oversized case has a dedup rule and a persistent
  registry-entry kind.** 2993–2998: "**fragment-scoped and deduplicated** against a fragment-keyed set scoped
  to this `findClashes` call: being oversized is a property of the geometry alone, not of the pairing … so one
  entry is emitted per oversized fragment no matter how many candidate pairs it appears in." The other two
  (3697–3703) share the identical pairing-independent justification ("if the adapter can't detect a
  position/index source on a fragment, or the fragment uses a legacy `offsets` layout … skip that fragment and
  record a `scope: 'fragment'` diagnostic") but have **neither a dedup rule nor a registry-entry kind**, so an
  unsupported fragment can be re-diagnosed once per candidate pair it appears in.
- **2.10.3** `[SILENT]` (carried, v7 L7-G1). The canonical operand-order sort key at 1570–1571 names
  `geometryKey` and `instanceId` — fields that occur **nowhere else in the document** (the actual vocabulary
  is `geometryIndex` / `fragmentId`) — and includes `modelId` as a sort component against the design's own
  "it plays no role in cache identity" statement (1241–1243). Harmless only because Milestone 1 rejects
  cross-model pairs (947–951).

---

# 3. Query-mode semantics and dependencies

## 3.1 The three public modes (table at 1653–1657)

| mode | question | parity against | open **source** | open **target** |
|---|---|---|---|---|
| `surface-intersection` | do their surfaces meet anywhere, touching included? | nothing — no parity at all | fine, never diagnosed | fine, never diagnosed |
| `containment` | does any point **on the source's surface** lie inside the target's interior? | **target only** | fine, never diagnosed | `unverified-parity-operand` (`role: 'target'`) |
| `volume-overlap` | do the two solids share positive volume? | **both** | `unverified-parity-operand` and/or `unverified-open-component`, both `role: 'source'` | same, both `role: 'target'` |

- **3.1.1** `[AMBIGUOUS]` (carried, v7 L-Q2). The "never diagnosed" cells read as blanket claims but scope
  only to the parity/closure diagnostics the table's own column headers are about, not to the other
  diagnostics each mode can still emit (`inconclusive-containment`, `crossing-budget-exhausted`, etc.). The
  narrow reading is fixture-pinned (3983–3989) and is now also stated as blanket normative text at 3591 and
  3594; see 3.9.4.

## 3.2 Solid model (1604–1649)

- **3.2.1** "**A target geometry's interior is defined by even-odd (parity) over its entire triangle set**"
  (1611–1613). Justified by hollow solids/pipes (1615–1620); the stated limitation is genuinely nested
  independent solids (1622–1629), fixture-pinned (3952–3956).
- **3.2.2** "**A source geometry contributes as the union of its components**" — union on the source side,
  even-odd on the target side, "and that asymmetry is intentional" (1631–1635).
- **3.2.3** "**Only closed components can establish positive volume.** An open shell encloses no *certified*
  volume, so its vertices reading `inside` a target proves **containment**, not **overlap**" (1637–1638).
- **3.2.4** `[AMBIGUOUS]` (carried, v7 3.2.6 / M-Q3). **"Certified closed manifold" is asserted at operand
  granularity; the flag actually consulted is per-component, with no aggregation rule.** 2326–2328: "**every
  operand that parity is evaluated against must be a certified closed manifold**". 2334–2339: "this parity
  check reads its cached manifold classification". But `GeometryConnectivity` "**classifies each
  component**" (1761–1765) and 2287–2288 is explicitly per-component ("closed manifold component" /
  "non-manifold or open component"). No rule says how per-component flags aggregate to an operand-level
  predicate. Not hypothetical: the doc's own headline hollow-pipe justification (1615–1620) is a
  two-component operand after welding.

## 3.3 `SurfaceIntersectionQuery` (1767–1799)

- **3.3.1** "**true iff any triangle pair from A and B has a non-empty geometric intersection**, including
  zero-volume coincident contact" (1767–1769). No parity, no closure precondition (3093).
- **3.3.2** Built on `bvhcast`, **not** `MeshBVH.intersectsGeometry` (1773–1785). It is "the *same*
  `bvhcast` traversal `ProperCrossingQuery` uses, using the same `maxCandidatePairsExamined` ceiling, with a
  **fresh traversal-local `candidatePairsExamined` counter for each traversal**, the same per-candidate
  `intersectsTriangle` test, and the same abort protocol — with a weaker predicate" (1787–1791).
- **3.3.3** **NEW in Round 30** (1795–1799):

  > "**'The same abort protocol' includes the private, traversal-local time-based trigger** (see
  > `ProperCrossingQuery`'s Abort protocol below, and the scheduling taxonomy's abort-only tier, which this
  > traversal shares with `ProperCrossingQuery`'s): this traversal's own worst case is therefore
  > `frameBudgetMs` + one raw candidate callback's own cost, not a function of the shared accumulator or of
  > what else ran earlier in the same call."

- **3.3.4** **NEW in Round 30** — the per-traversal claim at 1781–1785 is now explicitly scoped:

  > "…while the spec claimed its budgets bound the worst case **for this traversal**. That per-traversal
  > claim is only true once both modes traverse the same way — it is not, and was never meant to be, the
  > whole-design worst-case-span guarantee that **Budget enforcement and yield points** explicitly disclaims
  > (see 'still not a finite worst-case-span guarantee')."

  (The section name is dangling — see 0.6.)
- **3.3.5** `[SILENT]` (carried, v7 L-Q1). `crossing-budget-exhausted`'s definition names "candidate-count,
  crossing-count, or elapsed-time ceiling hit" (3588–3589); `surface-intersection` has no crossing concept —
  `maxCrossingPairsExamined` counts "confirmed intersecting non-coplanar pairs — the ones that reach probe
  classification" (1868–1869), and this mode "returns `true` on the first candidate pair that intersects **at
  all**", needing neither coplanar split nor probe ladder (1791–1793). Only one of the three triggers
  demonstrably applies. Fixtures 3877–3883 assert `crossing-budget-exhausted` for this mode anyway.

## 3.4 `ProperCrossingQuery` (1801–2201)

- **3.4.1** Callback receives **candidate** pairs, not intersecting ones (1812–1826), verified against
  `v0.9.14`.
- **3.4.2** Classification order avoids the upstream coplanar warning path (1827–1844): coplanar candidate →
  `intersectsTriangle(triB)` **without** a target line; non-coplanar → with `targetLine`, and "**do not read
  `targetLine`**" on false.
- **3.4.3** Skipping coplanar pairs is "the *correct* answer, not merely the safe one" (1839–1844).
- **3.4.4** Four-quadrant probe with `offsetLadder` rungs coarsest-first; "the pair is a proper crossing iff
  some probe classifies as `inside` **both** A and B" (1845–1860).
- **3.4.5** "**Inconclusive probes propagate.**" A `boundary` probe proves nothing; a negative with any
  inconclusive pair carries `inconclusive-crossing` (1861–1865).
- **3.4.6** Two count budgets (1866–1877): `maxCrossingPairsExamined = 64` (confirmed non-coplanar pairs),
  `maxCandidatePairsExamined = 50_000` (raw candidates).
- **3.4.7** **Abort protocol** (1879–1883): exceeding either budget sets `aborted` and returns `true` from
  `intersectsTriangles` — "the only way to stop a `bvhcast` traversal early." `bvhcast` therefore returns
  `true`, which "**must not be read as 'crossing found'**". Fixture 3910–3915.
- **3.4.8** **The private-clock third trigger** (1885–1917). The clock-basis argument: reading the shared
  accumulator "would make that permanent, result-altering abort a function of the traversal's arrival time …
  two calls presented with the identical pair could reach opposite verdicts depending on what else ran
  first". The private clock's own worst case is "at most `frameBudgetMs` + one probe's own cost, not a
  separately-derived factor of two" (1897–1904).
- **3.4.9** Round-11 granularity: `performance.now()` read **before each individual probe**, not once per
  callback (1919–1936). Raw candidates still checked at callback entry (1927–1930). Fixtures 3916–3932.
- **3.4.10** `[AMBIGUOUS]` (carried, v7 3.7.8 / M-Q4). **`maxCrossingPairsExamined`'s scope is unstated.**
  `candidatePairsExamined` is explicitly traversal-local at both traversals that maintain one (1788–1789,
  2551–2552; grep "traversal-local" → 1789, 1795, 1897, 2017, 2119, 2196, 2551, 2560). The crossing counter
  is never so qualified at either site (1868–1869, 2553–2554).

## 3.5 `ContainmentQuery` — two layers (2203–2446)

- **3.5.1** Two layers kept distinct so the design is not circular (2203–2215): `classifyPoint` (used by
  `ProperCrossingQuery` on its own synthesized points, with no precondition) and `anyComponentInside` (the
  per-component wrapper, called by `VolumeOverlapQuery` only after `ProperCrossingQuery` returns false, and by
  `ContainmentModeQuery` directly).
- **3.5.2** `classifyPoint` is three-valued; the `boundary` case is load-bearing (2217–2223). Steps:
  surface-proximity pre-check via `closestPointToPoint` ≤ `surfaceEpsilon` → `boundary` immediately
  (2225–2229); parity test with `THREE.DoubleSide`, three **generic non-axis-aligned** local-frame directions
  (2230–2243); sort-then-merge hits within `mergeDistance` (2244–2247); `barycentricEpsilon` grazing →
  retry next direction, all three grazing → `boundary` (2248–2255); odd → `inside` (2256–2260).
- **3.5.3** **The containment guarantee and its preconditions** (2267–2348). The antecedent — "no proper
  crossing exists" — is "established by `ProperCrossingQuery` returning false for `VolumeOverlapQuery`, and by
  `ContainmentModeQuery`'s own two-term negative for `containment`" (2267–2271). "**it governs negatives
  only**" (2274).
- **3.5.4** Conditional form (2287–2288): closed manifold component → guarantee holds; non-manifold or open
  component → best-effort, flagged.
- **3.5.5** **Flagging follows whichever component decided the outcome, in either direction** (2290–2310),
  and the rules are explicitly prefixed "**in `volume-overlap` mode**" (2295–2296):
  - positive whose deciding component is not certified closed → `unverified-open-component`, `role` naming
    whichever public operand supplied it (2298–2309);
  - negative involving any flagged component → `non-manifold-component` (2310).
- **3.5.6** **Containment-mode exemption** (2312–2315):

  > "In **`containment`** mode neither rule applies to the source at all: that mode's contract is
  > containment, which open sources answer soundly, so an open source is not a caveat and is never
  > diagnosed."

- **3.5.7** Target-side closure precondition, checked once per pair before any sampling (2317–2339); which
  operands are implicated "depends on the deciding path, not on the mode alone" (2329–2333). Reading the flag
  is free once connectivity is built; **building** it is a separately-checkpointed lazy phase, and the mode
  gate is what guarantees the *target*'s record went through it (2334–2339).
- **3.5.8** Three escalating sampling stages (2350–2413): (1) strided vertex sampling,
  `samplesPerComponent = 8`; (2) continue through the component; (3) constructed interior witness with
  `witnessLadder` scaled by `L_source`, `maxWitnessTriangles = 8`. **Stage 3 is `volume-overlap`-only**
  (2385–2393); `containment` stops after stage 2 (2395–2405).
- **3.5.9** "A component left unresolved after stage 2 **stays unresolved** for this term … rather than being
  asserted false" (2399–2401). What discharges the genuine case is `SurfaceCrossingWitness` (2401–2405).
- **3.5.10** `maxContainmentSamples = 512` → `incomplete-component-coverage` (2412–2413).

## 3.6 `VolumeOverlapQuery` (2448–2484)

```
volume-overlap(A, B) :=
      ProperCrossingQuery(A, B)
   OR ContainmentQuery(anyComponentOf(A) inside B)
   OR ContainmentQuery(anyComponentOf(B) inside A)
```
(2463–2467) — evaluated in that order with early exit. Both directions required for symmetry (2473–2475).
Pure touching correctly returns **false** (2475–2477). "Any unresolved component, inconclusive candidate, or
truncated examination turns a negative into a *diagnosed* negative rather than a clean one" (2477–2478).

## 3.7 `ContainmentModeQuery` (2486–2583)

```
containment(A, B) :=
      ContainmentQuery(anyComponentOf(A) inside B)   // a source VERTEX inside B
   OR SurfaceCrossingWitness(A, B)                   // a point on a source TRIANGLE inside B
```
(2489–2492) — one direction only (2494–2495).

- **3.7.1** First term uses **stages 1–2 only** (2497–2503).
- **3.7.2** Second term is not optional (2505–2513) — vertex sampling alone returns a clean false on a source
  straddling the boundary with no vertex inside.
- **3.7.3** `SurfaceCrossingWitness` (2515–2523): in-plane direction `u = normalize(nA × dir(L))`, `dAvail` =
  distance from `M` to the triangle's own edge along `u`, probes `P = M ± δ·u` for
  `δ ∈ crossingProbeFractions × dAvail` (`[0.5, 0.1, 0.01]`). "The witness holds when some `P` classifies
  `inside` the target."
- **3.7.4** No producible probe → **inconclusive**, not a rejected witness → `inconclusive-crossing`
  (2535–2541).
- **3.7.5** It "performs its own `bvhcast` over the source and target BVHs — a real traversal, not the
  plain-JS sampling loop `anyComponentInside` uses" (2549–2551), with a traversal-local
  `candidatePairsExamined` counter, `maxCandidatePairsExamined = 50_000`, and `maxCrossingPairsExamined = 64`
  for confirmed pairs entering the probe ladder (2551–2554). At most six probes per confirmed pair, each
  classifying against the target BVH only (2554–2558).
- **3.7.6** **It reads the *shared* accumulator**: "the shared elapsed-time accumulator is checked at callback
  entry and immediately before every probe, and exceeding either count ceiling or `frameBudgetMs` sets a
  traversal-local `aborted` flag" (2558–2562). Restated 2036–2039, 2120–2122, 2170, 2193–2194.
- **3.7.7** `[AMBIGUOUS]` (carried, v7 4.2.3, **narrowed but not closed by Round 30**).
  `SurfaceCrossingWitness`'s scheduling class: it is an abort-only, non-resumable native traversal by its own
  passage (2549–2563; "Being `bvhcast`-native, this traversal cannot `await`, yield, or resume"; 2444–2446
  "**not** a third instance of this pattern — it is its own `bvhcast`-native traversal, non-resumable like
  `ProperCrossingQuery`'s"), yet it is assigned to the **cooperatively-yieldable** tier whose stated
  membership criterion is pausability (2036–2040, 2120–2122, 2170, 4552–4557). The document itself brackets
  the soundness question rather than resolving it (2040–2044):

  > "(Whether reading the shared accumulator inside a permanent, result-altering `bvhcast` abort — the same
  > scheduling-position-dependent-verdict shape Round 21's H-B7 fix moved `ProperCrossingQuery` away from —
  > is itself sound is a **pre-existing question this re-derivation does not resolve**; it is a
  > verdict-determinism concern, not a worst-case-span-bound one, and is out of this pass's scope.)"

  Round 30 confirmed the *distinctness* of this classification from `SurfaceIntersectionQuery`'s but did not
  resolve the tier question.
- **3.7.8** `[CONTRADICTION]` — **traversal counting.** 2034–2036 states "**`SurfaceCrossingWitness` is a
  second `bvhcast`-native traversal**"; 4075 states "`ContainmentModeQuery`'s second composition term added a
  **third traversal** to the design"; and Round 30's own edits now speak of "`ProperCrossingQuery`'s
  `bvhcast` traversal **and `SurfaceIntersectionQuery`'s**" as two (2118–2119, 2169, 2194–2196). Under Round
  30's own framing there are three named `bvhcast`-native traversals, so "second" at 2034 is off by one.
  Mitigating reading: 1787 calls `SurfaceIntersectionQuery` "the *same* `bvhcast` traversal
  `ProperCrossingQuery` uses", i.e. one implementation used twice — but 2118–2132 costs the two separately as
  distinct addends, which the same-traversal reading does not support.
- **3.7.9** Term ordering is cheapest-first (2565–2569). `[AMBIGUOUS]` (carried, v7 L-Q3): "the second term
  (`SurfaceCrossingWitness`) is what now **establishes** the antecedent instead of assuming it" (2568–2569)
  overclaims for the case where the second term itself fails by abort or unproducible probe — those cases are
  correctly *diagnosed* (2535–2541, 3790–3793), not silently wrong, but "establishes" is unqualified.
- **3.7.10** Name split: `ContainmentQuery` is the internal component; `ContainmentModeQuery` is the public
  composition. "They are not the same layer, and conflating them is what let earlier drafts treat a
  containment *witness* as a volume-overlap *proof*" (2578–2583).

## 3.8 Mode dependency matrix

| | needs weld | needs connectivity | needs BVH | parity operands |
|---|---|---|---|---|
| `surface-intersection` | yes | **no** | yes | none |
| `containment` | yes | **yes** (both operands' records) | yes | target only |
| `volume-overlap` | yes | **yes** (both operands' records) | yes | both (crossing path); container only (containment terms) |

Cited: 1321–1339, 1393–1402, 1959, 3009–3010, 4134–4136, 4558–4567. "Only `surface-intersection`, which never
calls `anyComponentInside` at all, is genuinely connectivity-free" (1333). The connectivity gate also builds
the *target*'s record for the parity-closure precondition, "not only the operand(s) `anyComponentInside`
samples" (1334–1339, 2334–2339).

## 3.9 Diagnostics (3566–3693, 3695–3793)

`FragmentDiagnosticReason` (3577–3580) — 3 members. `PairDiagnosticReason` (3582–3597) — 7 members:
`inconclusive-containment`, `incomplete-component-coverage`, `inconclusive-crossing`,
`crossing-budget-exhausted`, `non-manifold-component`, `unverified-open-component`,
`unverified-parity-operand`.

- **3.9.1** `role` requirement (3605–3610): "**`role` is required for reasons that indict one operand —
  `'unverified-parity-operand'` and `'unverified-open-component'` — and absent for reasons about the pair as a
  whole (budget exhaustion, coverage truncation, inconclusive results)**."
- **3.9.2** `unverified-parity-operand` role table (3621–3628) — four rows by deciding path. Mode scope
  (3630–3635): the crossing row, the containment-of-B-in-A row, the two-role negative row and the both-open
  case "apply only to `volume-overlap`"; a `containment` result "can indict `target` only".
- **3.9.3** `unverified-open-component` role table (3647–3655) — two rows, naming which operand the open
  component *belongs to*.
- **3.9.4** **`non-manifold-component`'s mode scope — Round 30's H-1 edits.** All six occurrences in the file
  (grep-confirmed) are now mutually consistent with "never emitted in `containment` mode":

  | Line | Text | Status |
  |---|---|---|
  | 2291 | round-5 historical narration | `[changelog]`-shaped prose, not a rule |
  | 2310 | "a **negative** result involving any flagged component emits `non-manifold-component`" | inside the block prefixed "So, **in `volume-overlap` mode**:" (2295–2296) |
  | 3082 | Public API `volume-overlap` comment | volume-overlap-scoped by position |
  | 3590–3591 | type-union comment, **Round 30 added** "`// (never emitted in 'containment' mode — see Query modes)`" | ✔ NEW |
  | 3762–3766 | Error Handling, **Round 30 rewrote**: the false "(the public source in `containment` mode…)" clause removed and "**Not emitted in `containment` mode**" added | ✔ NEW |
  | 3967–3970 | fixture, **Round 30 added** "(this exercises the shared `ContainmentQuery` primitive directly; a negative reaching `findClashes` through `containment` mode's source path never carries it — see **Query modes and their preconditions**)" | ✔ NEW |

- **3.9.5** `[AMBIGUOUS]` — **NEW, a residual of the H-1 fix.** The **claim** at 3591 and 3763 is blanket
  ("never emitted in `containment` mode"), while every **rationale** offered for it is source-scoped:
  2312–2315 says "neither rule applies **to the source** at all"; 3763–3766 says "whose contract covers open
  or non-manifold **sources** by construction". Nothing states what covers a non-manifold (as opposed to
  merely open) **target** in `containment` mode. The answer is derivable — `unverified-parity-operand` fires
  for any operand that "is not certified closed" (2326–2328, 3595–3597), which includes non-manifold — but it
  is derived, not stated, and the mode table's `containment`/open-target cell (1656) names only
  `unverified-parity-operand`, never non-manifold-ness.
- **3.9.6** `[SILENT]` (carried, v7 M-Q1). **`non-manifold-component` is absent from the
  completeness/soundness reconciliation** at 3662–3686, which presents itself as exhaustive. 3669–3675 names
  the four completeness diagnostics that "never attach to a positive" (`incomplete-component-coverage`,
  `inconclusive-containment`, `inconclusive-crossing`, `crossing-budget-exhausted`); 3677–3682 names "**exactly
  two**" soundness diagnostics (`unverified-parity-operand`, `unverified-open-component`); 3684–3686 closes
  "**This is the reconciliation:** *completeness* diagnostics are negative-only; *soundness* diagnostics apply
  in both directions." `non-manifold-component` is in neither list, in a passage that partitions the space.
- **3.9.7** `[SILENT]` (carried, v7 M-Q2, **Round-28-aggravated, untouched by Round 30**).
  **`non-manifold-component`'s `role` field is unspecified in both role-requirement enumerations.** It is
  absent from 3605–3610's "required" list; it is also not obviously one of the "reasons about the pair as a
  whole (budget exhaustion, coverage truncation, inconclusive results)". Meanwhile 3759–3761 makes it
  operand-specific in `volume-overlap` — "**either public operand** in `volume-overlap` mode, depending on
  which containment term is sampling it" — and no role table covers it (3621–3628 and 3647–3655 cover the
  other two).
- **3.9.8** Diagnostics attach to positives too (3657–3661); emitted for **partially**-unresolved negatives
  (3662–3667).
- **3.9.9** `findClashes` always resolves `{ pairs, statistics }`, never a bare `{ pairs: [] }` (3688–3693).

---

# 4. Synchronous-work / budget / scheduling

## 4.1 `frameBudgetMs` — what it is

- **4.1.1** `frameBudgetMs = 8`, "half the one-frame target, since a checkpoint can only fire *between*
  primitives, not preempt one" (3035–3037).
- **4.1.2** It is a **shared per-call wall-clock accumulator** — "one `performance.now()`-based accumulator for
  the call" (3027–3028) — checked at sites 1–11 of §1.5 and at the abort-only sites 14 (shared) but **not**
  12/13/15 (private clock).
- **4.1.3** What it bounds is explicitly **cooperative composition only**: "**A cooperative-composition
  ceiling**, which is what `frameBudgetMs` actually bounds: the accumulated cost of many small atomic
  operations run back-to-back before a checkpoint gets a chance to fire" (2045–2047).
- **4.1.4** "A checkpoint that finds the accumulator not yet due does not yield at all; it lets whatever
  non-preemptible or abort-only unit follows it run to completion in the same span" (2062–2064).

## 4.2 The scheduling-class taxonomy (1983–2073)

Four classes, in the order the text states them:

**(a) Enforceably-bounded, non-preemptible ("per-atomic-operation ceiling")** — 1988–2012. Members, per the
formula passage at 2091–2094: the three `maxSyncTriangleCount` build phases; the
`maxChildrenPerNode`-capped `enumNodeChildren` call; **and, new in Round 30, the
`maxCollisionInstancesPerEpoch`-bounded `CollisionInstance` capacity-admission recompute-and-commit**.
2095: "**Of this tier's five members, three are measured**" (was "four members … three are measured"
pre-Round-30).

**(b) Abort-only synchronous traversal** — 2013–2044. **Round 30 rewrote the membership and the uniqueness
claim** (2018–2029):

> "**this private-clock abort protocol is the one documented, deliberate exception to the shared-accumulator
> convention every other checkpoint in this design follows (Round 21's H-B7) — used by both
> `ProperCrossingQuery`'s traversal and `SurfaceIntersectionQuery`'s. `SurfaceIntersectionQuery` is built on
> 'the *same* `bvhcast` traversal `ProperCrossingQuery` uses… and the same abort protocol' (see
> `SurfaceIntersectionQuery`'s own definition), and the time-based trigger is checked at callback entry
> exactly as it is for a raw candidate pair that never reaches `ProperCrossingQuery`'s own probe loop … so it
> applies unchanged to a traversal with no probe loop at all. `SurfaceIntersectionQuery`'s own worst case is
> `frameBudgetMs` + one raw candidate callback's own cost (~0.3µs, measured…), smaller than
> `ProperCrossingQuery`'s addend, so admitting it here does not change this tier's own contribution to the
> formula.**"

The uniqueness claim is now **protocol-level** ("this private-clock abort protocol is the one … exception"),
not traversal-level. `SurfaceCrossingWitness` is explicitly **excluded** (2034–2040) — "is not a second
instance of this exception … its own passage states its time-based abort checks *the shared* elapsed-time
accumulator".

**(c) Cooperatively yieldable / resumable** — 2045–2073. Members: one raycast, one proximity check, one
`classifyPoint` call, one probe, one AABB test (2087–2088); `SurfaceCrossingWitness`'s traversal (2038–2040,
2120–2122); the chunked broad-phase scan (2054–2059); the extraction walk's between-node checkpoints
(2051–2054).

**(d) Accepted non-preemptible atomic risk (no ceiling)** — the two rows at 1964 and 1967, excluded from the
formula (2149–2164).

- **4.2.1** The exhaustiveness claim: "**Every checkpoint named in this document — the build-phase
  checkpoints and the `bvhcast`-entry checkpoints included — is this same mechanism**" (2060–2062).
- **4.2.2** The revalidation-is-never-skipped claim: 2064–2073 (quoted in full at §1.5).
- **4.2.3** `[AMBIGUOUS]` — the tier-membership criterion. Class (c)'s stated criterion is pausability
  ("It is a plain JS loop this library drives, so unlike the native traversals it can genuinely be paused
  rather than only aborted", 2058–2059), yet `SurfaceCrossingWitness` — explicitly non-pausable
  (2444–2446, 2558–2559) — is assigned to it on a *granularity* basis instead ("At that fine, per-probe
  granularity it belongs to the cooperative-composition tier below (bounded overshoot: one probe's own
  cost)", 2038–2040). See 3.7.7.

## 4.3 The atomic-operations table (1948–1981) — verbatim inventory

| # | Row | Cost basis | Value | Class |
|---|---|---|---|---|
| 1 | `maxSyncTriangleCount` — **compaction + welding phase** (1958) | **Measured** ~16.8ms @ ~19,800 tris (weld only); compaction unmeasured; **plus, new in Round 30, `ViewerGeometryAdapter`'s layout-normalization and range computation — "reasoned, not measured: one `getRenderProxy` call plus O(ranges) work, expected small but not itself ceilinged by this spec"** | `12_000` | (a) |
| 2 | `maxSyncTriangleCount` — **connectivity phase** (1959) | **Measured** ~6.9ms @ ~19,800 tris | `12_000` | (a) |
| 3 | `maxSyncTriangleCount` — **BVH phase** (1960) | **Measured** ~16ms @ 18k tris | `12_000` | (a) |
| 4 | `maxCandidatePairsExamined` (1961) | **Measured** ~0.3µs/raw candidate | `50_000` | (c) |
| 5 | one probe / one `classifyPoint` call (1962) | **Reasoned, not measured** | — | (c) |
| 6 | `maxFragmentsPerDbId` (1963) | **Reasoned, not measured** | `5_000` | bounds cumulative walk work only |
| 7 | one `enumNodeFragments(node, cb, false)` call (1964) | **Reasoned, flagged for re-derivation** | **— (no ceiling; accepted atomic risk)** | (d) |
| 8 | `maxChildrenPerNode` (1965) | **Reasoned, not measured**, deliberately not derived from any existing measurement | `10_000` | (a) |
| 9 | `maxBroadPhaseInstancePairs` (1966) | **Reasoned, not measured**; ceiling case ~1,000ms, "**~40× the gate's own ≈24ms worst-case-span bound**" | `1_000_000` | (c) since Round 18 |
| 10 | `releaseEpochScopedState`/`dispose()` per-epoch registry sweep (1967) | **Unmeasured** | **— (no ceiling; accepted atomic risk)** | (d) |
| 11 | `maxCollisionInstancesPerEpoch` capacity check (1968) | **Reasoned, not measured**; O(1) size comparison per affected epoch | **provisional, value not yet chosen** | (a) — the check itself |
| 12 | **`CollisionInstance` capacity-admission's recompute-and-commit (1969) — NEW ROW, Round 30** | **Reasoned, not measured**: `O(U)`, U = the call's complete unique fragment-id set | **bounded by `maxCollisionInstancesPerEpoch` … via the call-wide precheck** | (a) — "**Enforceably bounded, not an accepted atomic risk**" |

- **4.3.1** Row 12's soundness argument, verbatim: "the call-wide precheck under **Data Flow** step 3 rejects,
  before this step ever begins, any call whose complete unique fragment-id count `U` exceeds
  `maxCollisionInstancesPerEpoch` — since a bucket capped at that ceiling can never need more than that many
  instances constructed in one admission, every call that reaches this step already has
  `U ≤ maxCollisionInstancesPerEpoch`, so this step's own worst-case cost is capped at that same ceiling."
- **4.3.2** Row 10 explicitly covers **only** the `GeometryRegistry` half; the `CollisionInstance` half is
  accounted separately — `evictModel` is one `Map.delete(loadEpoch)`, **O(1)**; `dispose()` is one
  `Map.clear()` over every live epoch's bucket, "whether that scales with the number of live epochs … is
  unstated and unmeasured here" (1967).
- **4.3.3** `[CONTRADICTION]` — **NEW, Round-30-introduced.** Row 1 now carries, inside a row whose **Value**
  column reads `12_000` and whose tier membership is "enforceably bounded" (2091–2094), an explicit admission
  that one of its own sub-steps is **not** bounded by that value:

  > "one `getRenderProxy` call plus O(ranges) work, expected small but **not itself ceilinged by this spec**"
  > (1958; the same disclosure at 1469–1475: "its own cost is **reasoned, not measured** … the range-count
  > summation itself, which is `O(ranges)` and … **not itself ceilinged by this spec** — a residual, disclosed
  > gap, not a claimed bound").

  Three consequences the current text does not reconcile:
  1. **The ≈24ms/24.8ms derivation** takes this tier's addend to be "that unit's own worst-case cost"
     (2091–2094) and computes it from welding's measured ~16.8ms (2095–2100) — a figure that by construction
     excludes the normalization sub-step now folded into the same phase.
  2. **Gate criterion 1** (4518–4537) excludes exactly two spans (rows 7 and 10) from the 24.8ms line and
     states that "a measurement above the corrected bound on any other synchronous task **is** a gate
     failure", with one named provisional exception (row 8 / criterion 7). The normalization sub-step is
     neither excluded nor named as provisional, yet is stated to have no ceiling.
  3. `getRenderProxy` is an internal, undocumented Viewer API for which the spec explicitly declines to claim
     a cost (1469–1471, cross-referenced to the Viewer-API-drift risk at 4660–4663), so no ceiling is
     available to it.

  This is structurally the same "unceilinged synchronous unit inside a taxonomy that asserts its own
  exhaustiveness" shape v7 recorded for the capacity-admission span — relocated, not removed, by Round 30's
  H-4 edit.
- **4.3.4** `[SILENT]` — **NEW.** **No gate criterion measures the `ViewerGeometryAdapter` sub-step.**
  Criterion 5 (4558–4567) measures "each of the three `GeometryRecord`-build phases — welding, connectivity,
  BVH construction — … individually, at `maxSyncTriangleCount`"; it names neither the normalization nor the
  `getRenderProxy` call. The formula's own measurement-gap list (2172–2178) names "the three build phases,
  extraction's aggregate walk, one `enumNodeFragments` call on its own, one `enumNodeChildren` call at the
  fanout ceiling, the `CollisionInstance` capacity-admission recompute-and-commit … and the broad-phase scan's
  longest uninterrupted span" — again, not this.

## 4.4 The `bvhcast` traversal-local clock exception (1885–1917, 2013–2044, 2192–2201)

- **4.4.1** The exception is **protocol-scoped** as of Round 30, and named at three sites:
  - 2018–2020: "**this private-clock abort protocol is the one documented, deliberate exception … used by both
    `ProperCrossingQuery`'s traversal and `SurfaceIntersectionQuery`'s**";
  - 2194–2196: "`ProperCrossingQuery`'s and `SurfaceIntersectionQuery`'s `bvhcast` abort-and-diagnose checks
    are the one documented exception — **the same private-clock protocol, used by both traversals**";
  - 2002 (unchanged by Round 30): "`bvhcast`'s clock-basis passage under `ProperCrossingQuery`'s budgets,
    **the one documented exception**" — singular, referring to the passage rather than to a traversal count;
    compatible with the protocol-level reading.
- **4.4.2** The rationale for admitting `SurfaceIntersectionQuery` without a probe loop: "the time-based
  trigger is checked at **callback entry** exactly as it is for a raw candidate pair that never reaches
  `ProperCrossingQuery`'s own probe loop … so it applies unchanged to a traversal with no probe loop at all"
  (2023–2026). Independently checkable against 1927–1930: "A raw candidate pair that never reaches probe
  classification is still checked at callback entry, as before — that path's per-candidate cost is already
  measured (~0.3µs) and small enough that entry-granularity is adequate there".
- **4.4.3** The exception's own worst case: `frameBudgetMs` + one probe (`ProperCrossingQuery`, 1897–1904) or
  `frameBudgetMs` + one raw candidate callback (`SurfaceIntersectionQuery`, 2026–2029, 2129–2132).
- **4.4.4** Admitting `SurfaceIntersectionQuery` "does not change this tier's own contribution to the formula"
  (2028–2029) because its addend is strictly smaller (2130–2132). Independently checkable: 0.3µs ≪ one
  probe's cost.

## 4.5 The worst-case-synchronous-span derivation (2075–2201)

- **4.5.1** The formula (2075–2079): "the worst-case single synchronous span is `frameBudgetMs + [worst-case
  cost of the one non-preemptible or abort-only atomic unit, if any, that immediately follows a checkpoint
  which found the accumulator not yet due]`".
- **4.5.2** Per-tier addends (2087–2132): (c) one small atomic op; (a) that unit's own worst case, controlling
  at welding's ~16.8ms → `8 + 16.8 = **24.8ms**`; (b) `ProperCrossingQuery` composes to ~16ms,
  `SurfaceIntersectionQuery` strictly smaller.
- **4.5.3** The structural prefix argument (2134–2147): "**Any number of checkpointed units may share a
  synchronous span — not only one.**" The bound "does not depend on how many units share a span, only on
  this: whichever unit is *last* in the span, the checkpoint immediately before it did not yield, so the
  aggregate cost of every unit that ran earlier in that same span is itself below `frameBudgetMs`". Sound as
  written; independently re-derived.
- **4.5.4** The exclusion list (2149–2164) — **two rows only**: "one non-recursive
  `enumNodeFragments(node, cb, false)` call, and `releaseEpochScopedState`/`dispose()`'s own per-epoch
  registry sweep … Both rows, and the `enumNodeFragments` atomic risk rounds 16 and 17 tracked more generally,
  are **explicitly excluded from the formula above and from any finite worst-case-span guarantee this spec
  makes**." Round 30 deliberately did not add the capacity-admission span here (it is now class (a)).
- **4.5.5** "What the formula *does* bound" (2166–2172) — **Round 30 rewrote this list**: "the three
  `maxSyncTriangleCount` build phases, the `maxChildrenPerNode`-capped `enumNodeChildren` call, **the
  `maxCollisionInstancesPerEpoch`-bounded `CollisionInstance` capacity-admission recompute-and-commit**,
  `ProperCrossingQuery`'s **and `SurfaceIntersectionQuery`'s** `bvhcast` traversals' own self-bounded worst
  cases (see the abort-only bullet above for why `SurfaceCrossingWitness`'s own traversal is covered by the
  cooperative-composition tier instead), the now-chunked broad-phase scan, and the per-primitive checkpoints
  above."
- **4.5.6** `[CONTRADICTION]` (carried, v7 M-SW3, **untouched by Round 30**). **The controlling-term
  identification does not survive the ceiling-normalization argument the same passage introduces.** 2095–2099:

  > "Of this tier's five members, three are measured — **welding is the largest, at ~16.8ms.** That figure was
  > measured at ~19,800 triangles …, not at the `12_000` sync-triangle ceiling itself; **scaled down to the
  > ceiling the true cost is smaller (~10.2ms)**, so using the as-measured ~16.8ms figure here is
  > conservative, not tight."

  Applying the identical as-measured→ceiling scaling to the BVH row's own measurement (1960: ~16ms at 18k
  triangles) gives ~10.7ms at `12_000` — larger than welding's ~10.2ms. At the ceiling BVH, not welding, is
  the controlling term. The ≈24ms/24.8ms headline is unaffected (unscaled figures remain conservative), but
  two other arguments lean on welding *specifically*: the clock-basis admission comparison (1904–1910: "the
  independently measured ~16.8ms weld phase remains larger than this traversal's own `frameBudgetMs` + one
  probe worst case") and the per-phase compounding argument (1353–1360: "welding (~16.8ms) alone already
  exceeds `frameBudgetMs`, so the checkpoint immediately following it always finds the accumulator overdue and
  yields").
- **4.5.7** `[AMBIGUOUS]` (carried). The formula's revision trigger is stated in **as-measured** units
  ("if either measurement exceeds ~16.8ms, this tier's addend … must be revised upward", 2114–2117) while
  criterion 5 measures "each of the three phases … **at `maxSyncTriangleCount`**" (4558–4563), i.e. in
  ceiling-normalized units. No reconciliation is stated.
- **4.5.8** **RESOLVED since v7** — the "gate's current pass criterion cited inside the broad-phase passage"
  contradiction (v7 4.5.7 / M-SW1). 2949–2954 now reads "about **~40× the gate's own ≈24ms worst-case-span
  bound** (Round 18's own comparison used this document's then-current ~16ms figure, superseded by Round 22's
  re-derivation to 24.8ms; the conclusion is unchanged either way)", mirroring row 1966's annotation. The
  stale present-tense "~60× the …~16ms pass criterion" is gone (grep-confirmed: no `~60×` anywhere in the
  file).

## 4.6 The broad-phase scan (2940–2990)

- **4.6.1** Pre-scan rejection via **overflow-safe division** (`sourceCount > ceiling / targetCount`), never
  multiplication (2940–2945, 4280–4285).
- **4.6.2** Per-pair inner checkpoint on the shared accumulator, resuming "from exactly the
  `(sourceIndex, targetIndex)` it left off at" (2958–2964). Per-pair rather than batched is deliberate
  (2964–2968); reintroducing batching requires a measured per-batch cost and a restated bound, "**never
  silently**" (2968–2971).
- **4.6.3** Three properties yielding does **not** change (2975–2990): never truncates;
  `maxBroadPhaseInstancePairs` remains a pre-scan rejection; the mid-scan suspension is safe only because
  placement state is per-call.
- **4.6.4** Fixture 4272–4279 pins that the total AABB test count equals `sourceCount × targetCount`, "never a
  truncated prefix".

## 4.7 Performance-gate criteria (4501–4650) — **eleven** bullets

| # | Line | Subject |
|---|---|---|
| 1 | 4518 | No single synchronous task exceeds **24.8ms** (`8 + 16.8`); "**this criterion's own pass/fail line is the literal 24.8ms, not the rounded-down ≈24ms shorthand**"; **two exclusions** (rows 7, 10) where an over-bound measurement is "a required recorded finding, not a gate failure"; **one provisional exception** (row 8 / criterion 7) |
| 2 | 4540 | Any budget that trips does so with the correct diagnostic |
| 3 | 4542 | Measured per-candidate/per-build costs recorded next to `measure.mjs` figures |
| 4 | 4544 | One `classifyPoint`, one crossing probe, **one `SurfaceCrossingWitness` in-triangle probe** measured directly |
| 5 | 4558 | Each of the three build phases measured individually at `maxSyncTriangleCount` |
| 6 | 4568 | Extraction cost for the largest dbId; broad-phase scan's **longest uninterrupted span**; clock-read vs. AABB-test cost; candidate-list size at the ceiling; extraction walk's longest inter-sibling-checkpoint span |
| 7 | 4588 | One `enumNodeChildren` call at the fanout ceiling **and an assertion that the abort actually fires** |
| **8** | **4601** | **NEW, Round 30**: the `CollisionInstance` capacity-admission recompute-and-commit measured **separately from its own precheck**, at a state where U sits at/just under the ceiling; plus an assertion that the precheck rejects "**before** any bucket lookup or `CollisionInstance` construction" |
| 9 | 4611 | One `enumNodeFragments(node, cb, false)` call on the widest-owning node |
| 10 | 4619 | `releaseEpochScopedState`/`dispose()` sweep, from **both** entry points, with `dispose()`'s measurement additionally varying the number of simultaneously live epochs |
| 11 | 4632 | The `CollisionInstance` identity cache's retained size per epoch across a realistic session |

- **4.7.1** Criterion-number cross-references remain internally consistent after the insertion: the only
  numbered references in the file are to "criterion 1" (4576, 4581) and "criterion 7" (2112, 4534, 4556,
  4577), and `enumNodeChildren` is still the seventh bullet. Grep-confirmed: no stale "criterion 8"/"criterion
  9" references exist.
- **4.7.2** `[SILENT]` (carried, v7 L-SW3). Unannotated `~16ms` narration survives inside the gate section
  itself: "the build-only yield rule made the cold run's **~16ms bound** plausible" (4514) — historical
  narration, but unannotated, unlike every other superseded `~16ms` in the document.
- **4.7.3** `[SILENT]` (carried, v7 L-SW1). A **third distinct sense of "~16ms"** coexists with the retired
  span-bound sense and the abort-only tier's composed-span sense: a per-phase cost allowance —
  "the accepted per-atomic-operation ceiling (**the same ~16ms a single BVH build was already allowed to
  cost**, see the atomic-operations table) now applies to each phase individually" (1339–1342). The doc's own
  measured weld figure (~16.8ms) exceeds it.
- **4.7.4** `[SILENT]` (carried, v7 L-SW4). Two `ProperCrossingQuery` fixtures assert only "a
  `frameBudgetMs`-scaled wall-clock bound" (3918) / "a wall-clock bound" (3878, 3915) without naming the
  Round-22-corrected figure, so a regression of the 24.8ms correction would not be caught by them.
- **4.7.5** `[SILENT]` (carried, v7 L-SW2). Both accepted-risk descriptions place themselves "**in the same
  category as**" the three ceilinged build phases (1964: "Non-preemptible, same category as the three
  `maxSyncTriangleCount` phases"; 1967: "same category as one `enumNodeFragments` call and the three
  `maxSyncTriangleCount` phases") — correct for "non-preemptible", misleading for "bounded", though each
  carries an adjacent "(no ceiling; accepted atomic risk)" annotation.

## 4.8 Accepted-unbounded vs. genuinely bounded — current summary

| Unit | Ceiling | Class | Excluded from formula? | Gate criterion |
|---|---|---|---|---|
| compaction + weld phase | `12_000` tris… | (a) | no | 5 |
| …its `ViewerGeometryAdapter` sub-step | **none stated** (1958, 1469–1475) | (a) by containment | **no** | **none** — see 4.3.3, 4.3.4 |
| connectivity phase | `12_000` | (a) | no | 5 |
| BVH phase | `12_000` | (a) | no | 5 |
| `enumNodeChildren` at fanout ceiling | `maxChildrenPerNode + 1` callbacks | (a) | no (provisional) | 7 |
| capacity-admission recompute-and-commit | `maxCollisionInstancesPerEpoch` **via precheck** | (a) | no | **8** |
| `ProperCrossingQuery` `bvhcast` | private clock, self-bounded | (b) | no | 4 (per-probe) |
| `SurfaceIntersectionQuery` `bvhcast` | private clock, self-bounded | (b) | no | — (addend measured via row 4) |
| `SurfaceCrossingWitness` `bvhcast` | shared accumulator | (c) | no | 4 |
| broad-phase scan | chunked, per-pair | (c) | no | 6 |
| one `enumNodeFragments(node, cb, false)` | **none** | (d) | **yes** | 9 |
| `releaseEpochScopedState`/`dispose()` sweep | **none** | (d) | **yes** | 10 |

---

# 5. Cache ownership / cleanup / concurrency

## 5.1 The `CollisionInstance` identity cache (1246–1306)

- **5.1.1** Keyed `(loadEpoch, fragmentId)`, "mirroring `GeometryRegistry`'s epoch-based keying for the same
  race-safety reason", so repeated calls receive "the **same object reference** for a given fragment"
  (1246–1250).
- **5.1.2** A `CollisionInstance` "contains only its `fragmentId` and an immutable
  `GeometryIdentity { loadEpoch, geometryIndex }`; both the instance and its nested identity value are frozen
  after construction. **It contains no `Model`, `GeometryRecord`, BLAS, world matrix, world bounds, or other
  call-varying or mutable state**" (1250–1253).
- **5.1.3** "**no `findClashes` call ever writes through a cached `CollisionInstance`**" (1258).
- **5.1.4** **Placement state is call-local, never cached** (1260–1268): `PlacedCollisionInstance =
  { instance, worldMatrix, worldBounds }`, newly owned per call. "concurrent calls may share the same
  immutable `instance` reference while each holds its own independent transform snapshot, and neither call can
  overwrite state the other resumes with." Fixture 4351–4359.
- **5.1.5** **Physical partitioning**: `Map<loadEpoch, Map<fragmentId, CollisionInstance>>`, "not one flat
  map" (1270–1272).
- **5.1.6** **Release is its own operation**, "**not** derived from a `GeometryRegistry` scan, a geometry
  reference count, a numeric `modelId`, or `liveModelByModelId`" (1273–1276) — because this cache's keyspace
  is "built from every collected fragment, **a strict superset of `GeometryRegistry`'s lazily-built
  candidate-pair keyspace**" (1278–1280). This is the superset argument §2.6.4 records as missing for
  `BlasCache`/connectivity.
- **5.1.7** Retention is bounded **per epoch, not in total**: "total retained instance count across all live
  epochs is `maxCollisionInstancesPerEpoch × (live epochs)`, **unceilinged**" (1282–1288).
- **5.1.8** Entries are "never individually evicted while their epoch remains live — doing so would break the
  stable-reference guarantee" (1303–1306).
- **5.1.9** `[SILENT]` (carried, v7 L-7C4). `maxCollisionInstancesPerEpoch` has **no chosen value**
  ("provisional, value not yet chosen", 1968, 1969; "provisional, unmeasured", 1282). Gate criterion 11
  (4632–4641) is what must set it. **Round 30 made this value load-bearing for a second, new purpose** — the
  precheck's cost bound (2109–2114 explicitly notes the ≈24ms figure is provisional for this member "until
  `maxCollisionInstancesPerEpoch` itself is given a chosen value").

## 5.2 Epoch-scoped capacity: the five-step admission sequence (2894–2939, 1289–1306)

**Round 30 restructured this from four steps to five.** Current text, verbatim structure:

- **Step 1** (2899–2902): "While walking, capture for each unique fragment not just its id but everything a
  canonical instance or a placement will need — `fragmentId`, `GeometryIdentity` …, and this call's own
  `worldMatrix`/`worldBounds` snapshot — so no later phase needs to call back into `fragList` or any other
  Viewer getter."
- **Step 2 — NEW** (2903–2911): "**Before touching any cache bucket**, check the walk's own complete unique
  fragment-id count against `maxCollisionInstancesPerEpoch`. If it is exceeded, reject the entire call now,
  without looking up or creating any bucket: a bucket capped at `maxCollisionInstancesPerEpoch` can never need
  more instances constructed in one admission than that ceiling allows, whatever the bucket's existing
  contents are, so **this rejection is never premature** — every call this precheck admits is guaranteed
  `U ≤ maxCollisionInstancesPerEpoch` for every later step in this sequence… **This is what makes step 4's
  recompute-and-commit an *enforceably bounded*, not merely non-preemptible, synchronous span**."
- **Step 3** (2912–2916): after the walk's last possible yield, look up the affected epoch's bucket **without
  creating it**, and **recompute** which of the call's unique fragment ids are still missing "against that
  bucket's *current* contents, not a count carried over from earlier in the walk. A concurrent call's commits
  during any of the walk's own yields can otherwise leave an earlier count stale."
- **Step 4** (2917–2928): "**In that same synchronous step — no intervening `await`, no call out to any
  external callback, getter, or other reentrant operation** — check the affected epoch's
  `maxCollisionInstancesPerEpoch` capacity (`currentBucketSize + uniqueMissingCount`). If it would be
  exceeded, reject the entire call now: no bucket is created, no canonical instance is constructed, and no
  `PlacedCollisionInstance` is constructed for any fragment in the query. **Step 2's precheck does not replace
  this check** — a call can pass step 2 … and still be rejected here, if the bucket's own pre-existing
  contents from other calls push the combined total over the ceiling; **step 2 only bounds this step's own
  *cost*, not its *outcome***. Otherwise create the bucket if it did not already exist and construct and
  publish a canonical `CollisionInstance` … for every missing fragment id, entirely from the inputs phase 1
  captured."
- **Step 5** (2929–2932): "**Only after that admission succeeds**", build this call's own
  `PlacedCollisionInstance` values.

- **5.2.1** "'Look up or create,' applied to this cache anywhere else in this document, means exactly this
  sequence — a lookup that finds nothing stages nothing on its own; the instance is only ever constructed
  during phase 4's admission, never earlier and never partially" (2934–2936).
- **5.2.2** The zero-mutation guarantee is scoped: "**specific to a capacity rejection (step 2's or step
  4's)**: a later failure in placement construction or in the broad-/narrow-phase work that follows can still
  leave a completed admission's committed instances resident" (2936–2939; also 1301–1303).
- **5.2.3** The atomicity requirement is what makes "two concurrent calls cannot both pass against the same
  stale capacity observation" true (1296–1299, 1968).
- **5.2.4** **Independent re-derivation of the precheck's soundness** (this model's own check, not the
  disposition's): let `B` be the bucket's current contents and `U` the call's unique fragment-id set. Step 4
  rejects iff `|B| + |U \ B| > ceiling`. Since `B` and `U \ B` are disjoint, `|B| + |U \ B| = |B ∪ U| ≥ |U|`.
  So `|U| > ceiling ⟹ |B ∪ U| > ceiling ⟹` step 4 would reject. **The precheck therefore admits no call step 4
  would reject and rejects no call step 4 would admit — sound in both directions, for any bucket contents,
  including an empty bucket.** Conversely `|U| ≤ ceiling` does not imply step 4 admits, which is exactly what
  2921–2925 states. The cost bound follows: step 3's recompute is `O(|U|)` and step 4 constructs at most
  `|U \ B| ≤ |U| ≤ ceiling` instances.
- **5.2.5** `[AMBIGUOUS]` (carried, v7 5.2.5). **"the affected epoch" (singular) vs. "any affected epoch"
  (plural).** Singular at 1290, 1296, 2912, 2918, 3745; plural at 1968 ("if publishing the call's missing
  instances would push **any affected epoch's** bucket over the limit"; "O(1) **per affected epoch**").
  Under Milestone 1's `source.model === target.model` restriction only one epoch can be affected, so the
  ambiguity is currently inert. **Round 30's precheck compares a *call-wide* count `U` against a *per-epoch*
  ceiling** (2903–2904, 2908), which is conservative under the plural reading (call-wide `U` ≥ any single
  epoch's missing count) but makes the singular/plural question load-bearing for a future cross-model
  milestone in a way it was not before.
- **5.2.6** `[AMBIGUOUS]` — **NEW, minor.** Step 2's own justification says it is "what makes **step 4's**
  recompute-and-commit" bounded (2909–2911), and table row 1969 calls the unit "the recompute-missing scan
  plus the construct-freeze-and-publish loop, run in the same synchronous step". But the recompute is
  **step 3** and the commit is **step 4**; the two are one synchronous span (step 4 opens "In that same
  synchronous step"), so the referent is recoverable, but "step 4's recompute-and-commit" names only half of
  what it bounds.
- **5.2.7** `[SILENT]` — **NEW.** **Step 1's capture set has no ceiling of its own, and the precheck does not
  give it one.** Step 1 materializes, for every unique fragment the walk collects, a `fragmentId`,
  `GeometryIdentity`, **and a `worldMatrix`/`worldBounds` snapshot** (2899–2902) — before step 2 ever runs.
  Its size is `U`, bounded only by `maxFragmentsPerDbId × |requested dbIds|`, and **nothing in the spec
  ceilings the number of requested dbIds** (grep-confirmed: no such constant exists). The precheck bounds
  step 3/4's *work* but is checked only after step 1 has already allocated for all of `U`. The
  atomic-operations table prices the recompute-and-commit (row 12) but nothing prices or ceilings step 1's
  capture. (The walk itself is cooperatively checkpointed between dbIds and between sibling nodes, so this is
  a **memory**/allocation gap, not a synchronous-span gap.)
- **5.2.8** `[SILENT]` (carried, v7 L-7C2). The bucket-creation step still states no liveness precondition at
  its own site; safety depends on composing 2064–2073's universal revalidation with step 4's no-`await` rule,
  neither cited at 2917–2928. **In tension with 1.5.4**: the universal claim L-7C2 relies on is exactly the
  one that is not honored at the abort-only `bvhcast` sites.
- **5.2.9** `[SILENT]` (carried, v7 L-7C3). A **synchronous throw inside the commit phase** is not covered by
  the zero-mutation guarantee (scoped to capacity *rejection*, 2936–2939) and would leave a partially
  populated, un-rollback-able bucket resident. Step 2's precheck does not address this.
- **5.2.10** `[SILENT]` (carried, v7 L-7C1). The Error Handling bullet still garbles its own predicate:
  "if committing the call's missing `CollisionInstance`s would push **`maxCollisionInstancesPerEpoch` over its
  limit**" (3745–3747) — it is the *bucket* that gets pushed over the ceiling, not the ceiling over a limit.
  Both sibling statements of the same rule get it right (1296–1297, 1968). Untouched by Round 30.
- **5.2.11** Fixtures: 4360–4365 (bucket at capacity, new fragment → reject before any bucket change; repeat
  call for resident fragments only → succeeds); **4366–4374 — NEW, Round 30** (walk's own unique set exceeds
  the ceiling against an **empty** bucket → the precheck rejects "**before** any bucket lookup or
  `CollisionInstance` construction"; explicitly distinguishes step 2 from step 4: "a design that only
  implements the bucket-capacity check passes the fixture above but fails this one, since an empty bucket
  never trips a combined-total check no matter how large the query's own unique set is").

## 5.3 Release completeness across all caches

| Cache | `evictModel` release | `dispose()` release | Keyspace argument |
|---|---|---|---|
| `GeometryRegistry` | per-epoch enumerative sweep, signal rejected, identity-guarded delete (3182–3200) | wholesale clear (3290–3293) | own keyspace, `(loadEpoch, geometryIndex)` (1222–1224) |
| `BlasCache` | **derived** — "together with its cached BLAS" (3183–3185) | named as one of four caches (3290–3292) | **none** — see 2.6.3, 2.6.4 |
| cached `GeometryConnectivity` | **derived** — "and cached connectivity where it has any" (3183–3185) | named as one of four caches (3290–3292) | **none** — see 2.6.4 |
| `CollisionInstance` cache | **independent** `Map.delete(loadEpoch)`, O(1) (3186–3190, 1967) | `Map.clear()` over every live epoch (1967, 3290–3292) | **explicit superset argument** (1276–1280) |
| extension-owned room cache | handler drops the entry unconditionally (3258–3260, 3554–3558) | **never touched by `dispose()`** (3258–3259) | — |

- **5.3.1** `[SILENT]` (carried, v7 M-7C2). **The release-path cost model covers 2 of the 4 caches
  `dispose()` clears.** Row 10 (1967) prices the `GeometryRegistry` sweep and the `CollisionInstance` cache's
  delete/clear explicitly; `BlasCache`'s and the connectivity cache's own clears are priced nowhere and
  measured by no gate criterion (criterion 10 at 4619–4631 names the registry sweep and the
  `CollisionInstance` clear only).
- **5.3.2** `[SILENT]` (carried, v7 M-7C4). **No fixture verifies release *completeness* for any cache.**
  Every eviction/disposal fixture (4137–4144, 4158–4195, 4417–4432) spies on whether a release call was
  invoked, or on whether a *lookup* misses, never on whether the caches' resulting state is empty.
- **5.3.3** `[SILENT]` (carried, v7 L-7C5 / 5.3.3). The extension-owned room cache has **no capacity ceiling
  or eviction policy** and sits outside `dispose()`'s four caches (2641–2647, 3258–3260). Its clear-on-
  `unload()` inherits 1.8.3's strandability.

## 5.4 Concurrency invariants

- **5.4.1** Single-flight per phase slot on a shared entry; a second caller awaits rather than duplicating
  (1378–1389, 1512–1521). Fixtures 4145–4157.
- **5.4.2** Entry-scoped cancellation broadcast to every waiter, rejected exactly once (2.3). Fixture
  4186–4195.
- **5.4.3** Per-call transform snapshot isolation (5.1.4). Fixture 4351–4359.
- **5.4.4** Capacity check-and-commit atomicity (5.2.3–5.2.4).
- **5.4.5** Identity-guarded deletes on every removal path — build-failure (1422–1424), release (3198–3200,
  3304–3305), room cache (2672–2677, 2702–2705).
- **5.4.6** `[AMBIGUOUS]` (carried, v7 5.4.6) — see 1.4.9.

---

# 6. Round-30 verification record (independent re-derivation)

Each of the five claimed fixes was re-derived from the live text. **The disposition doc was not treated as
evidence of anything.**

## (a) `containment` / `non-manifold-component` diagnostic scope — **HOLDS (fixed)**

All six occurrences enumerated at 3.9.4. The three canonical sites v7 identified (2312–2315 ≈ old 2269–2272;
1655–1657 ≈ old 1647; 3084–3092 ≈ old 3022–3023) are intact and untouched. The contradicting outlier is
**gone**: the Error Handling bullet's "(the public source in `containment` mode…)" clause was deleted and
replaced with "**Not emitted in `containment` mode**" plus the bathtub/14-open-components rationale
(3762–3766). Both downstream silent sites were closed — the type-union comment (3591) and the fixture
(3967–3970). **No site in the current text asserts that `containment` emits `non-manifold-component`.**
Residual: the blanket-claim/source-scoped-rationale mismatch at 3.9.5, and the two pre-existing Mediums
(3.9.6 M-Q1, 3.9.7 M-Q2) that Round 30 explicitly deferred.

## (b) "budgets bound the worst case" — **HOLDS (fixed), with one new defect**

The Risks bullet at 4720–4732 no longer asserts the bound present-tense. Current text: "the budgets bound the
worst case **for every span this document actually ceilings** — they do **not** bound the worst case for the
whole design", followed by the exclusion list and an in-place supersession annotation ("An earlier version of
this bullet asserted, present-tense, that the budgets now bound the worst case outright — that claim was made
in round 5 and was **false when written** … it is superseded here by Round 22's corrected formula and its
explicit exclusion list, which is the section that governs"). This is consistent with 2149–2164. The secondary
instance at 1781–1785 is narrowed to "for this traversal". Grep of every "bound the worst case" occurrence
(205, 1877, 1911, 1964, 1984, 4077, 4720–4721, 4726, 4729) finds no remaining live present-tense whole-design
assertion — the others are historical narration or fixture prose quoting the retired claim.

**New defect introduced by this fix:** both rewritten sites point at a section named "**Budget enforcement and
yield points**" that does not exist (0.6).

**Residual, unchanged:** the Risks bullet still opens "With `maxCandidatePairsExamined` added **this round**"
(4720) — round-5/6 narration left unannotated, against the document's own annotate-in-place convention, even
though the sentence it introduces was rewritten.

## (c) The geometry gate's input provenance / classification — **PARTIALLY HOLDS**

**Closed:** the unimplementability half. `ViewerGeometryAdapter`'s producer, cache position, and call
frequency are now stated normatively at three mutually consistent sites (1464–1468, 1958, 2991–3013), the
undefined "earlier layout-normalization pass" reference is gone, `getRenderProxy` now appears four times
rather than two, and the fixture at 4196–4205 was updated. The "three plausible call-frequency readings" v7
found are collapsed to one: once per unique `(loadEpoch, geometryIndex)`, on first registry touch, never per
candidate pair.

**Not closed:** the classification half. The sub-step is now *disclosed* as unceilinged rather than *silent*
about it (1469–1475, 1958), but it sits inside a table row whose Value column reads `12_000` and inside the
enforceably-bounded tier whose addend the ≈24ms figure is derived from; gate criterion 1 does not exclude it
and no gate criterion measures it. See **4.3.3** `[CONTRADICTION]` and **4.3.4** `[SILENT]`. Additionally,
Round 30's new "this same phase/checkpoint" anchor attaches to a sentence three lines above that says the
phase is "not gated by `frameBudgetMs`" — **2.4.7** `[AMBIGUOUS]`.

## (d) `CollisionInstance` capacity-admission span: classification + precheck soundness — **HOLDS (fixed)**

- Classification: new table row 1969 explicitly reads "**Enforceably bounded, not an accepted atomic risk**";
  tier prose at 2091–2095 updated from four to five members with the arithmetic ("Of this tier's five members,
  three are measured") consistent; formula-bound list at 2166–2172 includes it; measurement-gap list at
  2172–2178 includes it; new gate criterion 8 at 4601–4610; new fixture at 4366–4374. The exclusion list at
  2149–2164 correctly does **not** list it, and 2104–2117 correctly marks the ≈24ms figure provisional for
  this member pending both measurement and a chosen `maxCollisionInstancesPerEpoch` value.
- **Soundness independently re-derived at 5.2.4 and confirmed**: the precheck adds no rejection the
  bucket-capacity check would not already have produced, for any bucket contents including empty, and it does
  bound `U` for every admitted call. The document states the argument correctly at 2905–2909 and correctly
  preserves the outcome/cost distinction at 2921–2925.
- Residual, new: **5.2.6** (step-number referent), **5.2.7** (step 1's capture set unceilinged), **5.2.5**
  (call-wide count vs. per-epoch ceiling now load-bearing).

## (e) `SurfaceIntersectionQuery` in the taxonomy, and its distinctness from `SurfaceCrossingWitness` — **HOLDS (fixed)**

All four passages v7 found silent now name it: the abort-only tier (2018–2029), the span formula's addends
(2118–2119, 2129–2132), "what the formula does bound" (2169), and the clock-basis reconciliation (2194–2196).
Its own definition now states the private-clock inheritance explicitly (1795–1799), closing the ambiguity at
the definition site. The uniqueness claim is reframed protocol-level at both sites that made it (2018–2020,
2194–2196), so it is no longer falsified by a second traversal.

**Distinctness confirmed independently:** `SurfaceCrossingWitness` is stated to read the *shared* accumulator
at four sites (2036–2039, 2120–2122, 2170, 2193–2194) plus its own definition (2558–2562), and is explicitly
excluded from the abort-only tier ("is **not** a second instance of this exception"). No edit merged the two,
and no fifth taxonomy class or parallel taxonomy exists. **However**, the residual tier-assignment question
(3.7.7 / 4.2.3) is unchanged and the document still brackets its own verdict-determinism concern at 2040–2044;
and the traversal-count inconsistency at 3.7.8 is now more visible than before.

## Cross-cutting effects of Round 30 the disposition doc does not record

1. **M-L1's scope grew.** The abort-only tier now has two normative members, so 2060–2062's "every checkpoint
   … the `bvhcast`-entry checkpoints included" and 2064–2067's "never itself skipped" now quantify over a
   third traversal whose lifecycle behavior is unspecified and whose only stated exit is a diagnosed negative —
   the result shape 3449–3453 forbids for a lifecycle failure. See **1.5.4**.
2. **A fifth unnamed-error-class rejection path exists.** The step-2 precheck rejects the whole call
   (2903–2905) with no named error class; the self-labelled `[SILENT]` bullet at 3745–3751 still says "the
   same `[SILENT]` gap **those three** share". See **1.6.5**.
3. **The Risks section's dangling anchor.** See **0.6**.
4. **`maxCollisionInstancesPerEpoch` is now load-bearing for two independent purposes** (retention ceiling and
   synchronous-cost bound) while still having no chosen value. See **5.1.9**.

---

# 7. Stabilized-invariant re-verification (Rounds 19–29 table, re-derived from current text)

Every row below was re-checked against the live 4812-line text during this pass. **None was carried forward
on v7's authority.**

| Invariant | Verdict (v8) | Primary citations |
|---|---|---|
| Exact `Model`-object identity (never `modelId`) as the lifecycle key | **HOLDS** | 3335, 3159–3162, 3338–3353 |
| Monotonic, never-reset, never-reused `loadEpoch` | **HOLDS** | 3369–3374, 3419–3423 |
| Permanent eviction tombstones | **HOLDS** | 3179–3181, 3345–3349 |
| Disposed-first checkpoint behavior | **HOLDS**; gap at abort-only `bvhcast` checkpoints only, now covering three traversals | 3470–3488; **1.5.4** |
| Non-throwing Viewer unload-event path (`evictModel` no-op on disposed) | **HOLDS** | 3227–3257, 3286–3289, 4433–4440 |
| Settled `WorldDisposedError`/`ModelEvictedError` semantics | **HOLDS**; payload gaps only (1.6.3, 1.6.4) | 3278–3289, 3826–3842 |
| `(loadEpoch, geometryIndex)` geometry ownership | **HOLDS** | 1222–1224, 3204–3206, 3415–3429 |
| Entry-lifetime (not `buildState`-scoped) cancellation signal | **HOLDS** | 1425–1443, 3190–3200, 3298–3307 |
| Oversized-marker carve-out (no signal, removal is the whole cleanup) | **HOLDS** | 1444–1452, 3196–3197, 3305–3307, 4173–4185 |
| Gate → compaction → weld → connectivity-when-required → BVH sequencing | **HOLDS as an ordering claim**, and the gate's input now has a stated producer and call frequency; the input's **cost classification** does not hold — **4.3.3** | 1454–1494, 1958, 2991–3013 |
| Canonical query-mode contracts (surface-intersection / containment / volume-overlap) | **HOLD** | 1653–1699, 3074–3093 |
| Containment remains source-surface-only | **HOLDS** | 1659–1675, 2385–2405, 2497–2503 |
| Stage-3 constructed witness remains `volume-overlap`-only | **HOLDS** | 2356–2357, 2385–2393, 1583, 4078–4085 |
| `SurfaceCrossingWitness` core semantics | **HOLD**; tier assignment remains the open seam (3.7.7) | 2515–2563 |
| Parity/closure diagnostics and role mapping | **HOLD apart from `non-manifold-component`** (3.9.6, 3.9.7) | 3613–3655, 3757–3781 |
| Canonical four-class scheduling taxonomy | **Holds structurally**; exhaustiveness now broken at **one** site (the gate's input sub-step, 4.3.3) rather than three | 1983–2073, 2091–2132 |
| `frameBudgetMs` bounds cooperative composition only | **HOLDS** | 2045–2073, 3017–3041 |
| Traversal-local `bvhcast` clock exception, deliberate and scoped | **HOLDS**, now protocol-level over two named traversals | 1885–1917, 2018–2029, 2194–2196 |
| Accepted atomic risks not falsely described as bounded | **HOLDS** — the one violating site (Risks 4628–4630 pre-Round-30) is fixed | 4720–4732, 2149–2164, 4518–4537 |
| Worst-case-span derivation internally consistent | **Arithmetic holds** (`8 + 16.8 = 24.8`); the **controlling-term identification does not** (4.5.6); the structural prefix argument re-derived sound (4.5.3) | 2075–2147 |
| Performance-gate criteria match guarantees made elsewhere | **Mostly holds**; the M-SW1 mismatch is fixed (4.5.8); two gaps remain (4.3.4, 4.5.7) | 4501–4650 |
| Frozen `CollisionInstance` identity + call-local placement | **HOLDS** | 1246–1268, 2981–2990, 4351–4359 |
| Epoch-scoped capacity/check-and-commit ordering | **HOLDS**, and its cost is now classified and independently verified sound (5.2.4) | 2894–2939, 1969 |
| Eviction/disposal release completeness | **HOLDS for `GeometryRegistry` and `CollisionInstance`**; unproven-but-probably-sound for `BlasCache`/connectivity (2.6.3, 2.6.4); untested for all four (5.3.2) | 3182–3200, 3290–3312 |
| Round 25's cache-concurrency closures (`CollisionInstance` keyspace clause; non-throwing wholesale clear; four-caches count) | **HOLD** — re-derived, not assumed | 1276–1280, 3293–3298, 3290–3292 |
| Round 27's protected geometry invariants | **HOLD** — no regression from Rounds 28–30 found | §2 throughout |
| The `>` vs `>=` gate-threshold boundary | **HOLDS**, fixture-pinned | 4217–4221 |

---

## Appendix — marker index

**`[CONTRADICTION]` — 4**

| Ref | Subject | Sites | Provenance |
|---|---|---|---|
| 2.9.3 | `GeometryConnectivity` still defined as "restricted to the active triangle ranges" while it runs over the compacted-then-welded buffer whose numbering the original `ranges` no longer index | 1742–1744 **vs.** 1490–1494, 1496–1507 (and the retired BVH-side twin, 1507–1511) | PRE-EXISTING (v7 M7-G2) |
| 3.7.8 | How many `bvhcast`-native traversals exist — `SurfaceCrossingWitness` as "a second" vs. "a third" | 2034–2036 **vs.** 4075 **vs.** 2118–2119 / 2169 / 2194–2196 (Round-30 text) | PRE-EXISTING, **aggravated by Round 30** |
| 4.3.3 | The compaction+welding row's stated ceiling (`12_000`) and enforceably-bounded tier membership vs. its own newly-folded, admittedly unceilinged `ViewerGeometryAdapter` sub-step; and vs. gate criterion 1's two-exclusion list | 1958 + 1469–1475 **vs.** 2091–2099 **vs.** 4518–4537 | **NEW, Round-30-introduced** |
| 4.5.6 | "Welding is the largest, at ~16.8ms" vs. the same passage's own ceiling-normalization argument applied to the BVH row (~10.7ms > ~10.2ms at `12_000`) | 2095–2099 **vs.** 1960; downstream at 1904–1910, 1353–1360 | PRE-EXISTING (v7 M-SW3) |

**`[AMBIGUOUS]` — 8**

| Ref | Subject | Sites | Provenance |
|---|---|---|---|
| 1.4.9 / 5.4.6 | "rejects synchronously" for a `Promise`-returning method | 3797–3799 **vs.** 3066, 2754 | PRE-EXISTING |
| 2.4.7 | "active-range compaction … **not gated by `frameBudgetMs`**" vs. `ViewerGeometryAdapter` running "as the first sub-step of **this same phase/checkpoint**" | 1460–1462 **vs.** 1465, 1958, 1339–1341, 3001–3002 | PRE-EXISTING clause, **made load-bearing by Round 30** |
| 2.4.8 | Whether a `'building'` entry is ever inserted for a geometry that turns out oversized (insert-first vs. gate-first ordering) | 1378–1380 **vs.** 3006–3008, 1444–1452 | PRE-EXISTING, narrowed |
| 2.6.3 | Is `BlasCache` a distinct keyspace or the storage behind `accelerationPromise`? | 1512–1521, 1229–1231 **vs.** 3290–3293, 3495–3497 | PRE-EXISTING (v7 M-7C3) |
| 3.2.4 | "Certified closed manifold" as an operand-level predicate read off a per-component flag; no aggregation rule | 2326–2328, 2334–2339 **vs.** 1761–1765, 2287–2288 | PRE-EXISTING (v7 M-Q3) |
| 3.4.10 | Is `maxCrossingPairsExamined` traversal-local? (stated for `candidatePairsExamined`, not for the crossing counter, in either traversal) | 1868–1869, 2553–2554 **vs.** 1788–1789, 2551–2552 | PRE-EXISTING (v7 M-Q4) |
| 3.7.7 / 4.2.3 | `SurfaceCrossingWitness`'s scheduling class — a non-pausable native traversal assigned to a tier whose stated criterion is pausability; the doc brackets its own verdict-determinism question | 2036–2044, 2120–2122, 2170, 4552–4557 **vs.** 2444–2446, 2558–2563, 2045–2059 | PRE-EXISTING (v7 4.2.3), unchanged |
| 3.9.5 | Blanket "never emitted in `containment` mode" vs. an exclusively source-scoped rationale; what covers a non-manifold **target** in `containment` mode is never stated | 3591, 3763–3766 **vs.** 2312–2315, 1655–1657 | **NEW — residual of the H-1 fix** |
| 5.2.5 | "the affected epoch" (singular) vs. "any affected epoch" (plural); now load-bearing because the new precheck compares a call-wide count against a per-epoch ceiling | 1290, 1296, 2912, 2918, 3745 **vs.** 1968; new site 2903–2908 | PRE-EXISTING, **scope widened by Round 30** |
| 5.2.6 | "step 4's recompute-and-commit" names only half the span it bounds (the recompute is step 3) | 2909–2911, 1969 **vs.** 2912–2928 | **NEW, Round-30-introduced** |

*(Count note: 10 rows, of which 1.4.9/5.4.6 and 3.7.7/4.2.3 are each one marker recorded from two systems — **8 distinct ambiguities**.)*

**`[SILENT]` — 17**

| Ref | Subject | Nearest cited context | Provenance |
|---|---|---|---|
| 0.6 | Two normative cross-references to a section "**Budget enforcement and yield points**" that does not exist | 1784, 4724 | **NEW, Round-30-introduced** |
| 1.2.3 | `dispose()` never states that `liveModelByModelId` — the one world-owned structure holding strong `Model` refs — is cleared | 3290–3292, 3495–3497, 3307–3309 vs. 3350–3352 | PRE-EXISTING (v7 M-L2) |
| 1.5.4 | Whether the abort-only `bvhcast` checkpoints (#12, #13, #14, **#15**) perform the two-part revalidation the universal rule claims is never skipped; their one specified exit contradicts the required lifecycle-failure result shape | 1927–1936, 2558–2563, 1795–1799, 2021–2029 vs. 2060–2073, 3449–3453 | PRE-EXISTING (v7 M-L1), **scope widened by Round 30** |
| 1.6.3 | No constructor signature/payload for `WorldDisposedError` anywhere | 3278–3280, 3826–3842 | PRE-EXISTING (v7 L-L2) |
| 1.6.4 | `ModelEvictedError(model.id)`'s payload is the identifier the design itself proved insufficient | 3451, 3715 vs. 3159–3162 | PRE-EXISTING (v7 L-L3) |
| 1.6.5 | No named error class for the now-**five** call-level ceiling rejections; the self-labelled bullet still says "those three" | 3711–3751; new fifth at 2903–2905 | PRE-EXISTING, **count stale after Round 30** |
| 1.8.4 | Whether `unload()` can be invoked twice; per-step isolation; listener-removal ordering — all "remain open and are not settled here" | 3549–3553 | PRE-EXISTING (v7 M-L3) |
| 1.8.5 | Whether the app reloads the extension after `tearDown()` — "neither is decided here" | 2619–2625 | PRE-EXISTING |
| 1.8.7 | `BEFORE_MODEL_UNLOAD_EVENT` payload shape (`event.model`) unverified | 2651–2659, 4667–4673 | PRE-EXISTING |
| 2.1.4 | `referenceCount` — reserved, unused, no forward contract anywhere | 1225–1227 | PRE-EXISTING (v7 L-7C6) |
| 2.2.2 | Whether an oversized marking is ever re-evaluated within a live epoch | 1444–1452, 2991–2999 | PRE-EXISTING (v7 L7-G2) |
| 2.6.4 / 5.3 | No keyspace-relationship statement for `BlasCache`/connectivity vs. `GeometryRegistry` (the argument the `CollisionInstance` cache received) | 3183–3186 vs. 1276–1280 | PRE-EXISTING (v7 M-G1/M-7C1) |
| 2.7.7 | Instance-tree readiness at extraction time — no code path checks it | 4674–4682, 1112–1118 | PRE-EXISTING |
| 2.10.2 | Only the oversized fragment diagnostic has a dedup rule; the other two `FragmentDiagnosticReason` members share its justification and have none | 2993–2998 vs. 3697–3703 | PRE-EXISTING (v7 M7-G3) |
| 2.10.3 | Sort key names `geometryKey`/`instanceId` (nonexistent vocabulary) and includes `modelId` against the design's own statement | 1570–1571 vs. 1241–1243 | PRE-EXISTING (v7 L7-G1) |
| 3.3.5 | `crossing-budget-exhausted`'s three-trigger definition doesn't fit `surface-intersection` | 3588–3589 vs. 1791–1793, 1868–1869 | PRE-EXISTING (v7 L-Q1) |
| 3.9.6 | `non-manifold-component` absent from the completeness/soundness reconciliation that presents itself as exhaustive | 3662–3686 | PRE-EXISTING (v7 M-Q1) |
| 3.9.7 | `non-manifold-component`'s `role` unspecified in both role-requirement enumerations, though it is operand-specific in `volume-overlap` | 3605–3610, 3621–3628, 3647–3655 vs. 3759–3761 | PRE-EXISTING (v7 M-Q2) |
| 4.3.4 | No gate criterion measures the `ViewerGeometryAdapter` sub-step now folded into the compaction+welding phase; it is absent from the formula's own measurement-gap list too | 4558–4567, 2172–2178 vs. 1958 | **NEW, Round-30-introduced** |
| 4.7.2 / 4.7.3 / 4.7.4 / 4.7.5 | Unannotated `~16ms` narration in the gate (4514); a third distinct sense of `~16ms` as a per-phase allowance (1339–1342); two `ProperCrossingQuery` fixtures asserting a wall-clock bound without the corrected figure (3878, 3915, 3918); both accepted-risk rows described as "same category as" the ceilinged phases (1964, 1967) | as cited | PRE-EXISTING (v7 L-SW1–L-SW4) — **recorded as one clustered marker** |
| 5.1.9 | `maxCollisionInstancesPerEpoch` has no chosen value while five sites now depend on its behavior, two of them added by Round 30 | 1282, 1968, 1969, 2109–2114, 4601–4610, 4632–4641 | PRE-EXISTING (v7 L-7C4), **dependency count grown** |
| 5.2.7 | Step 1's per-fragment capture set (`fragmentId` + `GeometryIdentity` + matrix/bounds snapshot) is unceilinged and unpriced; the precheck runs only after it | 2899–2902 vs. 2903–2911, 1969 | **NEW, Round-30-introduced** |
| 5.2.8 | The bucket-creation step states no liveness precondition at its own site; safety composes two uncited rules, one of which 1.5.4 shows is not honored everywhere | 2917–2928 vs. 2064–2073 | PRE-EXISTING (v7 L-7C2) |
| 5.2.9 | A synchronous throw inside the commit phase is outside the zero-mutation guarantee | 2936–2939 | PRE-EXISTING (v7 L-7C3) |
| 5.2.10 | The Error Handling capacity bullet garbles its own predicate (ceiling pushed over a limit, rather than bucket over the ceiling) | 3745–3747 vs. 1296–1297, 1968 | PRE-EXISTING (v7 L-7C1) |
| 5.3.1 | Release-path cost model and gate criterion 10 cover 2 of the 4 caches `dispose()` clears | 1967, 4619–4631 vs. 3290–3292 | PRE-EXISTING (v7 M-7C2) |
| 5.3.2 | No fixture verifies release *completeness* for any cache — every one spies on invocation, never on resulting state | 4137–4144, 4158–4195, 4417–4432 | PRE-EXISTING (v7 M-7C4) |
| 5.3.3 | The extension-owned room cache has no capacity ceiling or eviction policy; outside `dispose()`'s four caches | 2641–2647, 3258–3260 | PRE-EXISTING (v7 L-7C5) |
| 0.5 | The literal `[SILENT]` audit marker still appears in normative Error Handling body text | 3751 | PRE-EXISTING (v7 L-marker) |

*(Count note: the 4.7.x cluster is four related budget-vocabulary silences recorded as one row; counted as one. **17 distinct silences.**)*

**Totals: 4 `[CONTRADICTION]`, 8 `[AMBIGUOUS]`, 17 `[SILENT]` — 29 markers.**

Of these, **5 are new in Round 30**: 0.6 (dangling section anchor), 3.9.5 (blanket claim / source-scoped
rationale), 4.3.3 (gate-input cost vs. tier membership), 4.3.4 (gate-input unmeasured), 5.2.6 (step-number
referent), 5.2.7 (unceilinged capture set) — six items across three markers-by-count categories; two further
markers (1.5.4, 5.2.5) had their **scope widened** by Round 30 without being newly created, and one (1.6.5)
had its **stated count go stale**.

---

## Method notes

- Complete sequential read of all 4812 lines of the current working-tree file (2026-09-03), in five contiguous
  passes, plus targeted grep verification of every claim that turns on an occurrence count
  (`non-manifold-component`, `getRenderProxy`, `bound the worst case`, `SurfaceIntersectionQuery`,
  `SurfaceCrossingWitness`, `maxCollisionInstancesPerEpoch`, `traversal-local`, `[SILENT]`, `criterion`,
  `four caches`, `affected epoch`, `Budget enforcement and yield points`).
- `git diff`/`git log -S` were used **only** to establish provenance of new text (which markers are
  Round-30-introduced vs. pre-existing), never as evidence that anything is correct. Round 30's edits are
  **uncommitted working-tree changes**; HEAD still holds the 4712-line post-Round-29 text.
- `round-30-high-only-fix-pass-disposition.md` was read once for orientation and trusted as evidence of
  nothing. All five of its claimed fixes were re-derived from the live text (§6); four hold as claimed, one
  ((c), the geometry gate) holds only in part.
- No `codex-advisor` or `codex-review` consult was run, per this pass's own scope — this is extraction, not
  adjudication.
- **No spec text was modified by this pass.**
