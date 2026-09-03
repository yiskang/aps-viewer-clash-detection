# Invariant audit v8 — MODEL / WORLD LIFECYCLE system

**Target**: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (**4812 lines**,
Round 30's edits present as uncommitted working-tree changes), read directly for this pass (2026-09-03).
**Every line citation below was verified by reading the current spec text in this session.** No
disposition doc (`round-18-*` … `round-30-*`) and no prior audit (`invariant-audit-v1` … `v7*`) was
treated as evidence that anything is presently fixed; prior docs were consulted only to locate where a
question was previously discussed and to attribute NEW vs. PRE-EXISTING. `round-30-high-only-fix-pass-
disposition.md`'s five claimed fixes were re-derived from live text for the lifecycle-relevant parts
(§ *Round-30 regression check*, below).

**Model used for extraction**: `invariant-audit-v8-model.md` §1 (with §2, §4, §5 cross-references). The
model's summaries were treated as a map, not as evidence: every §1 claim this document relies on was
re-read at its cited lines, and two of the model's own citations were corrected (see Method notes).

**Changelog vs. normative body.** Lines 40–799 are the `## Revision Notes (post-review)` changelog —
historical, past-tense, and **not** invariants. Findings below cite the normative body (801–4812) and the
Status header (1–38) except where explicitly marked `[changelog]`. Round 30 added no `### Round 30`
changelog entry; the changelog still ends at Round 23 (786).

---

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 6 |

**No Critical or High regression was introduced by Round 30 in the lifecycle system.** Independently
confirmed by hunk-level diff inspection: Round 30's 25 hunks land at 1462, 1781, 1794, 1957, 1968, 2017,
2091, 2103, 2128, 2167, 2193, 2902–2990, 3590, 3758, 3966, 4197, 4365, 4600, 4719 — **none falls inside
3057–3565** (the Public API lifecycle block, the "Race safety" prose, and the `RoomLocatorExtension`
sketch) or inside 3809–3863 (the lifecycle Error-Handling bullets). The lifecycle core was not reopened.
Round 30's only lifecycle-visible effects are a **scope widening of the carried M-L1** and two new Lows.

Nine core lifecycle invariants were re-verified against current text and **all nine hold**:

| Invariant | Verdict | Cited (verified this pass) |
|---|---|---|
| Exact `Model`-object identity (never `modelId`) as the lifecycle key | **HOLDS** | 3159–3162, 3335, 3338–3349, 3401–3413, 3846–3856 |
| Monotonic `loadEpoch`, global, never reset, never reused | **HOLDS** | 3112, 3369–3374, 3415–3423 |
| Permanent eviction tombstone (`'evicted'`, one-way, never cleared) | **HOLDS** | 3176–3181, 3345–3349, 4335–4338, 4417–4426 |
| Disposed-first checkpoint behavior, everywhere | **HOLDS** (with M-L1's wording gap) | 3275–3277, 3470–3488, 3126–3130, 3227–3228, 3263–3264, 2766–2768, 2426–2430, 2961–2963, 3048–3051, 1403–1405 |
| Non-throwing Viewer unload-event path (`evictModel` no-op on disposed) | **HOLDS** | 3173, 3227–3260, 3286–3289, 4433–4440 |
| Settled `WorldDisposedError` / `ModelEvictedError` semantics and order | **HOLDS**; payload gaps only (L-L2, L-L3) | 3278–3289, 3449–3456, 2695–2742, 4392–4406 |
| `(loadEpoch, geometryIndex)` geometry ownership; `(loadEpoch, fragmentId)` instance ownership | **HOLDS** | 1222–1224, 1246–1250, 3204–3210, 3415–3429 |
| Entry-lifetime (not `buildState`-scoped) cancellation signal, rejected once, identity-guarded | **HOLDS** | 1425–1443, 3190–3200, 3298–3307 |
| `findClashes` entry order: `disposed` → cross-model → per-operand | **HOLDS**, stated identically at three sites | 2766–2772, 3067–3073, 3431–3439 |

The model's `[SILENT]` **1.5.4** (abort-only `bvhcast` checkpoints) is **confirmed real, not closed
anywhere, and now one traversal broader than v7 recorded** — see M-L1. The model's claim that M-L1's
scope now covers `SurfaceIntersectionQuery` is **accurate**; its severity is **unchanged** (Medium), and
the reason is set out in M-L1's severity rationale.

---

# Critical

None.

---

# High

None. M-L1 was adjudicated High → Medium in `invariant-audit-v7-lifecycle.md`, and the argument that
moved it is re-verified here as still holding against the widened scope. No Round-30 edit introduced a
present-tense normative contradiction in this system.

---

# Medium

## M-L1 (PRE-EXISTING, introduced by Round 26's own M-L1 fix; **scope widened by Round 30**, severity unchanged). The universal two-part revalidation rule now quantifies over *four* abort-only `bvhcast` checkpoint sites across *three* traversals, for none of which is any lifecycle check, error precedence, or propagation mechanism specified

**Status of the model's `[SILENT]` 1.5.4: confirmed real. The text does not close it anywhere.**

### The universal claim (verified verbatim in current text)

- **2060–2062** — "**Every checkpoint named in this document — the build-phase checkpoints and the
  `bvhcast`-entry checkpoints included — is this same mechanism**, except `bvhcast`'s own internal abort
  clock once a traversal is already under way."
- **2064–2067** — "**What is conditional here is only the scheduling yield.** The two-part lifecycle
  revalidation every checkpoint carries — `disposed` first, then the model's load epoch … runs whenever a
  checkpoint is reached, accumulator-due or not; **it is never itself skipped.**"
- **3048–3051** — "**Every checkpoint, coarse or fine, checks `disposed` first, then re-validates the
  model's load epoch** … before resuming", whose own antecedent at **3043–3047** names
  "`ProperCrossingQuery`'s `bvhcast` traversal and `ContainmentQuery`'s sampling loops" as the
  fine-grained sites being quantified over.
- **3477–3480** — the disposal section independently names "the intra-stage checkpoints in
  **`ProperCrossingQuery`**/**`ContainmentQuery`**" as sites that "all check `disposed` (reject
  `WorldDisposedError`) *before* re-validating `modelLifecycle`'s per-model `state`/`epoch` (reject
  `ModelEvictedError`)".

### The abort-only sites (verified: no passage mentions `disposed` or the epoch)

| # | Site | Cited | Clock |
|---|---|---|---|
| 12 | `ProperCrossingQuery`'s `bvhcast` callback entry | 1927–1936 | private |
| 13 | `ProperCrossingQuery`'s per-probe check inside a confirmed pair | 1919–1936 | private |
| 14 | `SurfaceCrossingWitness`'s callback entry and per-probe checks | 2558–2563 | **shared** accumulator |
| 15 | **`SurfaceIntersectionQuery`'s `bvhcast` callback entry — new in scope as of Round 30** | 1795–1799, 2018–2029 | private |

Verbatim, the four passages:

- **1930–1936** — "The moment elapsed time crosses `frameBudgetMs` at either checkpoint, `aborted` is set
  exactly as the count-based triggers do. `bvhcast` cannot be paused and resumed mid-traversal … the pair
  is reported via `crossing-budget-exhausted` and `findClashes` returns to an `await`-capable context."
- **2558–2562** — "Being `bvhcast`-native, this traversal cannot `await`, yield, or resume: the shared
  elapsed-time accumulator is checked at callback entry and immediately before every probe, and exceeding
  either count ceiling or `frameBudgetMs` sets a traversal-local `aborted` flag and returns `true` from
  the callback."
- **1795–1799** (Round 30) — "**'The same abort protocol' includes the private, traversal-local
  time-based trigger** … this traversal's own worst case is therefore `frameBudgetMs` + one raw candidate
  callback's own cost."
- **2023–2029** (Round 30) — "the time-based trigger is checked at callback entry exactly as it is for a
  raw candidate pair that never reaches `ProperCrossingQuery`'s own probe loop … so it applies unchanged
  to a traversal with no probe loop at all."

Elapsed time and the `aborted` flag are the entire content of all four. None states a lifecycle check, a
precedence between a lifecycle failure and a budget abort, or any propagation mechanism for the former.

### Why it is a genuine inconsistency (re-derived, not carried)

1. **The result shapes are specified to be mutually exclusive, and the only specified exit produces the
   wrong one.** Returning `true` from the callback is "the only way to stop a `bvhcast` traversal early"
   (**1879–1881**) and produces a **diagnosed** negative carrying `crossing-budget-exhausted`
   (1881–1883, 2560–2562, 3782–3784). **3449–3453** is explicit that a lifecycle failure "aborts the
   **entire** `findClashes` call … **neither returns a partial or diagnosed `ClashResult`**. This is a
   different failure than anything the diagnostic system answers." So the checkpoint class 2060/3048/3477
   sweep in has exactly one specified exit, and that exit produces the result shape 3451 forbids for the
   failure 2064–2067 says is never skipped.
2. **The carve-out at 2061–2062 does not resolve it on either reading.** Narrowly (only the *clock basis*
   is excepted — which is what 1885–1917 and 2013–2029 are actually about), the revalidation obligation
   still lands on these sites and (1) applies. Broadly (the whole mechanism is excepted once a traversal
   is under way), it directly contradicts 2064–2067's "never itself skipped", 3048's "every checkpoint,
   coarse or fine", and 3477–3480's naming of `ProperCrossingQuery`. The text does not choose.
3. **The argument that makes the gap operationally harmless is still never made in the document.** A
   synchronous native traversal cannot observe a lifecycle transition: `dispose()` (3275–3277) and
   `evictModel` (3173–3178) are both wholly synchronous, so nothing can interleave inside one synchronous
   span and the revalidation would be *redundant*, not merely omitted. The spec has this exact argument
   in its vocabulary and applies it to a different site — **2715–2717**, "Nothing can interleave between
   the two calls — both are synchronous and there is no `await` between them" — and recognises the
   enabling constraint at **1931–1933** ("there is no way to `await` inside a synchronous native
   callback"). It never draws the lifecycle corollary.
4. **No fixture pins it either way.** The lifecycle fixture block (**4286–4451**) pins entry-check
   ordering, resumed-yield-checkpoint behaviour (4031–4037), both `isLeaseValid`/`isModelLive` disposal
   contracts, the disposed-`evictModel` no-op (4433–4440), and both room-search callbacks — but nothing
   exercises a checkpoint inside any `bvhcast` traversal. Re-verified by reading 3865–4460 for this pass.

### What Round 30 changed, and why the severity does not move

**The model's claim is accurate.** Pre-Round-30, `SurfaceIntersectionQuery`'s traversal carried no named
checkpoint of its own; Round 30 admitted it to the abort-only tier normatively (2018–2029) and stated the
private-clock inheritance at its own definition site (1795–1799). The phrase "the `bvhcast`-entry
checkpoints" at 2060–2062 therefore now has **three** traversals and **four** sites as referents, up from
two and three. Scope grew; the defect's shape did not change.

**Severity remains Medium, on the same two grounds v7 established and this pass re-verified:**

- **The propagation mechanism exists, it is just unstated.** The callback can record a lifecycle-failure
  reason and *also* return `true`; the caller, after `bvhcast` returns, checks the lifecycle reason
  **before** `aborted` and throws it — satisfying 3449–3453 exactly. Under-determination, not
  impossibility.
- **Runtime unreachability re-confirmed against the pinned dependency, not merely reasoned.**
  `package.json:27` pins `three-mesh-bvh` at `0.9.14`. `node_modules/three-mesh-bvh/src/core/cast/bvhcast.js`
  is a synchronous recursive traversal with no Promise, `await`, timer, or scheduler call. The same
  reasoning applies unchanged to the third traversal, which is why the widened scope does not escalate
  the finding.
- **Milestone-1 reachability is, if anything, narrower than the site count suggests.**
  `SurfaceIntersectionQuery` is reachable only in `surface-intersection` mode; the room locator runs
  `containment` (2754–2758), whose composition reaches site 14 but never site 15. Sites 12/13 are
  `volume-overlap`-only via `ProperCrossingQuery`.

**The `_active` implementation hazard now spans three traversals.** Re-verified directly in the pinned
source this pass: `bvhcast.js` sets a module-level `let _active = false` to `true` on entry (lines 17,
26) and clears it only on the normal-return path (line 82), with **no `try`/`finally`**. A callback throw
therefore leaves `_active === true` permanently, and every subsequent `bvhcast` in that page session
throws `MeshBVH: Recursive calls to bvhcast not supported.` The intuitive implementation of an unstated
lifecycle exit — throwing straight out of the callback — is unsafe, and after Round 30 it is unsafe in
three places rather than two.

**Framing.** Still best recorded as an **overclaim in the general-rule text (2060–2073), not as a defect
in the abort-only passages**, which accurately describe the installed dependency. Round 26 acquired the
obligation as a side effect of closing a different M-L1; Round 30 extended the obligation's reach without
touching the obligation itself. **Not a request to fix.** Two shapes would close it, neither authored
here: scope the universal claim to resumable checkpoints and state the redundancy argument explicitly for
the abort-only class; or state the record-a-reason-then-return-`true` propagation protocol and its
precedence over `aborted`, noting the 0.9.14 `_active` hazard that rules out a bare throw.

## M-L2 (PRE-EXISTING, first recorded v7). `dispose()`'s cleanup contract enumerates four caches and never clears `liveModelByModelId`, the one remaining world-owned structure holding strong `Model` references

Re-verified independently this pass by reading all **25** `liveModelByModelId` occurrences (375, 401,
430, 437, 1276, 3113, 3208, 3217, 3293, 3308, 3310, 3354, 3395, 3425, 3428, 3439, 3462, 3465, 3498,
3510, 3832, 3854, 4348, 4411, 4412). **No site anywhere says `dispose()` clears, empties, or drops this
map.** (Count is 25, not v7's 24; the extra occurrence is a line-wrap change, not a new statement.)

What `dispose()` is specified to do is enumerated exhaustively, twice, and both enumerations omit it:

- **3290–3293** — "dispose() also wholesale-clears **all four caches** — GeometryRegistry, BlasCache,
  every cached GeometryConnectivity, and the `CollisionInstance` identity cache — each in its own single
  clear operation, **not a per-model sweep over liveModelByModelId**."
- **3495–3497** — the same four, restated.

What it does to the map is only "It **best-effort tombstones whatever `liveModelByModelId` currently
references**, for diagnostic bookkeeping" (**3307–3309**). Writing a tombstone into a `WeakMap` does not
remove the strong reference the `Map` itself holds. The only specified deletion is `evictModel`'s
occupancy-guarded per-object delete (**3217–3220**), which by construction cannot run after disposal —
`evictModel` returns as a no-op on a disposed world (**3173**, **3227–3228**).

**Why this is a defect and not a nitpick.** It weakens the load-bearing argument the `WeakMap` choice
rests on: **3350–3352** — "Using a `WeakMap` is what makes 'permanent' free rather than a leak — **if
every other reference to an evicted `Model` object is eventually dropped**, its entry is reclaimed by the
GC along with it." `liveModelByModelId` *is* one of those other references, is world-owned, and survives
the world's own terminal method. A disposed `CollisionWorld` retains strong references to every `Model`
object that was the current occupant of its `modelId` at disposal time, for as long as anything
references the world. That is exactly the release-completeness standard the spec formalises for the
*other* release path at **3214–3216** ("a state-release/cleanup completeness concern, not a
liveness-correctness one — the object is correctly dead either way — **but it is required for the design
to actually reclaim what it claims to**"). The same standard is never applied to `dispose()`.

Medium, not High: nothing reads `liveModelByModelId` after disposal (every reader checks `disposed`
first, 3470–3488), so no correctness property breaks; and in the ordinary `RoomLocatorExtension.unload()`
path the extension instance — and with it the world — becomes unreachable shortly afterwards. **Untouched
by Round 30** (no hunk falls in 3057–3565).

## M-L3 (PRE-EXISTING as an *open question* in the spec; recorded as a finding since v7). `unload()`'s three steps have no per-step isolation, step 1 can throw, and the tearDown-path release-completeness claim is explicitly conditioned on all three completing

Current text, re-verified:

- **3528–3553** — `unload()` is `world.dispose()` → unregister context menu + `BEFORE_MODEL_UNLOAD`
  listener → clear the per-model room cache, in that order. "**A repeated unload() call re-invokes
  world.dispose(), and a second/repeated dispose() call is guaranteed to throw WorldDisposedError …
  synchronously, before steps 2/3 ever run — stranding listener removal, context-menu removal, and the
  room-cache clear for that invocation.**" The spec calls this "the same 'benign only because something
  else catches it' shape as the first hazard, **not a resolution of it**", then declines to settle it:
  "Whether the Viewer or app code can invoke unload() a second time on one instance is **unstated**.
  Per-step isolation of unload()'s three steps, and whether the listener should be removed before
  dispose() rather than after, **remain open and are not settled here**" (3549–3553).
- **3529–3538** — the first hazard (a `BEFORE_MODEL_UNLOAD_EVENT` firing into an already-disposed world)
  is "benign, but only because world.evictModel is a no-op on a disposed world rather than a throw — **it
  is the method's totality that makes this ordering safe, not the ordering itself**."
- **2625–2632** — the whole tearDown-path conclusion (that `evictModel` is never invoked for the outgoing
  model, and `dispose()`'s wholesale clear plus the room-cache clear "already release everything a
  per-model `evictModel` call would have") is stated "**provided `unload()` itself completes all three of
  its steps**". A normative release-completeness claim is therefore conditioned on a proviso the
  document's own 3539–3548 hazard shows may not hold, and the loop is never closed.

**Corroboration carried from v7's `viewer-extension-lifecycle-audit` invocation** (not re-run this pass;
recorded as prior evidence, not as this pass's own verification): the Agent Kit's formal Pattern
`viewer-tool-and-extension-lifecycle` (`status: active`, `last_reviewed: 2026-08-26`) states directly
that in `unload()` each independently-disposable step must be wrapped in its own try/catch and that "one
step throwing must not strand the steps after it", reproduced across two independent architectures. So
the spec's explicitly-open item is open against mature, cross-project-verified formal guidance that
already settles the general shape.

Medium, not High: on the *first* `unload()` the throw does not occur, so steps 2/3 run; the stranding is
reachable only on a repeated `unload()`, whose reachability the spec itself records as unstated.
**Re-verified this pass: no fixture anywhere covers repeated `unload()`** (grep over 3865–4650 for
`unload` returns exactly one hit, 4438, inside the `evictModel`-after-`dispose()` fixture's Viewer-bundle
narration). **Untouched by Round 30.**

---

# Low

## L-L1 (PRE-EXISTING, introduced by the Round-24 pass; carried). An invariant-audit marker still leaks into normative body text

**3750–3751**, inside `## Error Handling & Edge Cases` (normative body, not changelog): "…the same
call-level, pre-mutation rejection contract as `maxFragmentsPerDbId`, `maxChildrenPerNode`, and
`maxBroadPhaseInstancePairs` above, and **carrying no named error class, the same `[SILENT]` gap those
three share**." Grep-confirmed this pass: **exactly one** occurrence of the literal `[SILENT]` in the
4812-line file. The *substance* — call-level ceiling rejections with no named error class — is a genuine
gap the spec is right to record; the defect is that it is recorded in this audit lineage's private
vocabulary inside normative prose, where a reader outside the lineage cannot resolve it. Untouched by
Round 30.

**One correction to the v8 model's 1.6.5.** The model records this bullet's "those three" as a *stale
count* after Round 30 added a fifth rejection path. Read against live text, "those three" is a back-
reference to the three siblings the same sentence just named (`maxFragmentsPerDbId`,
`maxChildrenPerNode`, `maxBroadPhaseInstancePairs`), not a claim about the design's total number of
unnamed-error-class rejections — so it is not stale as written. The real residual is L-L6 below.

## L-L2 (PRE-EXISTING; carried). No constructor signature or payload is stated for `WorldDisposedError` anywhere in the document

Re-verified by grep this pass: **zero** occurrences of `new WorldDisposedError` in the file.
`ModelEvictedError` has exactly one payload literal — `new ModelEvictedError(model.id)` at **2715** —
plus the prose gloss "naming the evicted `modelId`" at **3451**. `WorldDisposedError` is raised at 3068,
3109, 3148, 3264, 3279, 3297, 3433, 3450, 3479, 3541, 3560, 3828, 3836–3837, 2699, 2713, 2721, 2737, and
in nine fixtures (4035, 4168, 4291, 4388, 4392, 4396, 4400, 4405, 4410, 4439, 4443), and is never once
given a shape. Neither class is declared in the Public API TS block (3059–3316) or in the diagnostics
section (3566–3693). Low — implementable by inference — but the spec explicitly tells callers they "may
branch on which error class they got" (2728–2729, 4397–4398), which makes the error surface part of a
public contract it never declares.

## L-L3 (carried from v7). `ModelEvictedError` "naming the evicted `modelId`" is ambiguous under the design's own supported reused-`modelId` state

**3451** specifies the error as "naming the evicted `modelId`" and **2715** constructs it as
`new ModelEvictedError(model.id)`. But **3358–3360** makes "two `Model` objects sharing a reused
`modelId` are both currently live" a supported, tested state (pinned by 4339–4350, 4375–4384,
4407–4416), and **3179–3181** makes the tombstone explicitly per-object — "this exact object can never
become live again in this world, **even if `model.id` is later reused by a different object**." The
single identifier the error carries is therefore precisely the identifier the whole round-12→14 redesign
established is *not* sufficient to identify a load: `ModelEvictedError(7)` may name an id whose current
occupant is a different, perfectly live object. Low — diagnostic payload only — and the natural remedy
(also naming the epoch) is blocked by **3168–3172**, since the `'evicted'` variant deliberately carries
no epoch.

## L-L4 (PRE-EXISTING; disclosed by the spec). The intra-`tearDown()` step-ordering claim is source-observed against a bundle absent from this repository

**2625–2639** conditions the tearDown-path conclusion on an ordering claim cited to
`viewer3D.js:26541-26560`, `:26583`, `:34052`, `:34054`, and self-discloses its tier: "This ordering is
an internal implementation detail, **not documented or guaranteed by Autodesk — revalidate on any Viewer
upgrade.**" The related claims at **3233–3244** (`EventDispatcher.dispatchEvent` invoking listeners with
no try/catch, `viewer3D.js:13300-13341`; `unloadModel` at `:34052-34054`; the unguarded
`unloadCurrentModel` loop at `:34253-34258`; `tearDown` at `:26583` wrapping extension unloads but **not**
`unloadCurrentModel`) are cited the same way. Per v7's skill-based check, no `viewer3D.js` bundle exists
in this repository, so every such locator other than `27710`/`88293` (independently corroborated by the
Agent Kit's `viewer-model-lifecycle` knowledge) resolves `needs-runtime-validation`, version-pinned to
7.124.2. Low, because the spec already discloses the claim's tier — but flagged because the
release-completeness conclusion at 2629–2632 rests entirely on it *and* is separately conditioned on
M-L3's unresolved proviso. The two conditions compound.

## L-L5 (NEW — aggravated by Round 30; never previously recorded). The document's two *enumerative* statements of the fine-grained checkpoint inventory are now two traversals out of date, and neither names the site the room locator's own mode actually reaches

Two normative sites enumerate which fine-grained checkpoints the two-part revalidation covers, and both
name the same pair:

- **3043–3047** — "`ProperCrossingQuery`'s `bvhcast` traversal and `ContainmentQuery`'s sampling loops
  each carry their own intra-stage checkpoint at a finer granularity", followed at **3048–3051** by
  "Every checkpoint, coarse or fine, checks `disposed` first…".
- **3477–3480** — "the intra-stage checkpoints in **`ProperCrossingQuery`**/**`ContainmentQuery`**".

Neither names **`SurfaceCrossingWitness`** (a fine-grained, per-probe checkpoint site since Round 26,
2558–2563) nor **`SurfaceIntersectionQuery`** (admitted as a named `bvhcast`-entry checkpoint site by
Round 30, 1795–1799, 2018–2029). The omission of the former is load-bearing rather than cosmetic because
of the document's own deliberate name split at **2578–2583**: "`ContainmentQuery` is the internal
point-classification component (`classifyPoint` + `anyComponentInside`) … `ContainmentModeQuery` is the
thin public composition above. **They are not the same layer, and conflating them** is what let earlier
drafts treat a containment *witness* as a volume-overlap *proof*." Read with that split honoured,
"`ContainmentQuery`'s sampling loops" strictly excludes `ContainmentModeQuery`'s second term — so the
mode the room locator actually runs (**2754–2758**) has a checkpoint site that appears in *neither*
enumeration.

Low rather than Medium: neither enumeration claims exhaustiveness in so many words, and the universal
quantifier at 2060–2062 covers the missing sites in principle (which is exactly what M-L1 is about). But
the two sites are the only places a reader is given a *list*, and both lists are now stale — which is how
M-L1's gap stays invisible to anyone reading the lifecycle sections rather than the budget taxonomy.

## L-L6 (NEW — Round-30-introduced). The step-2 capacity precheck is a second, earlier call-level rejection point that the Error Handling taxonomy does not record

Round 30 inserted a new **step 2** into the capacity-admission sequence (**2903–2911**): "**Before
touching any cache bucket**, check the walk's own complete unique fragment-id count against
`maxCollisionInstancesPerEpoch`. If it is exceeded, reject the entire call now, without looking up or
creating any bucket". It is fixture-pinned as a distinct behaviour (**4366–4374**) and gate-criterion
pinned (**4601–4610**).

The document's only inventory of call-level rejection contracts — the Error Handling bullet at
**3745–3751** — was not updated. It states one predicate only ("if committing the call's missing
`CollisionInstance`s would push `maxCollisionInstancesPerEpoch` over its limit") and one rejection point.
Two consequences:

1. **The precheck's own rejection carries no named error class either**, and unlike step 4's it is not
   even mentioned in the section that catalogues the error surface — so the gap L-L1 records is now one
   site wider than the text acknowledges.
2. A reader working from Error Handling alone would implement only the step-4 check — precisely the
   design the new fixture at 4370–4374 exists to fail ("a design that only implements the bucket-capacity
   check passes the fixture above but fails this one").

Low, not Medium, and **not a correctness regression**: the precheck's *outcome set* is provably a subset
of step 4's. Independently re-derived here rather than taken from the model or the disposition doc — with
`B` the bucket's contents and `U` the call's unique fragment set, step 4 rejects iff
`|B| + |U \ B| > ceiling`; since `B` and `U \ B` are disjoint, `|B| + |U \ B| = |B ∪ U| ≥ |U|`, so
`|U| > ceiling ⟹` step 4 would reject anyway. The Error Handling bullet's stated predicate is therefore
satisfied whenever the precheck fires; what is missing is only the disclosure that rejection can now
occur at an earlier point, and the error-class gap that comes with it.

---

# Historical-only / non-defect observations

1. **Status-header staleness, self-disclosed and now one round worse.** Line 3 still reads "revised after
   seventeen rounds of codex review"; 21–22 declare the paragraph deliberately frozen at the Round 17→18
   transition; 23–30 enumerate post-Round-23 rounds only "at minimum Round 24 …, Round 25 …, Round 26 …,
   and Round 27 … as of this writing" — **Rounds 28, 29 and 30 exist and are not named.** Lines 26–30
   pre-empt this ("check `docs/superpowers/specs/round-*-disposition.md` for the full, current list rather
   than trusting this paragraph's enumeration"). Disclosed staleness, not a defect.
2. **No changelog entries for Rounds 24–30.** `## Revision Notes` (40–799) ends at Round 23 (786), per the
   convention Rounds 24–29 established and Round 30 followed. Noted so a future pass does not read the
   changelog's endpoint as the document's.
3. **Numbering gaps at Rounds 7, 8, 20** are disclosed at 30–32; Round 20 is reachable only via 679
   `[changelog]`.
4. **The `evictModel` non-throwing justification chain (3227–3257) is unchanged and internally
   consistent**, and is pinned by fixture **4433–4440**, which asserts the mocked dispatch loop reaches a
   *second* model — i.e. the fixture tests the Viewer-teardown blast radius, not merely the return value.
   Verified; no finding.
5. **The `evictModel` pseudocode's step order (3173–3178) is unchanged and correct**: `disposed` no-op →
   idempotent `'evicted'` no-op → unconditional tombstone write → conditional `releaseEpochScopedState`.
   The non-throwing requirement (3210–3216) and its unretriability rationale are intact.
6. **`dispose()`'s own non-throwing requirement (3293–3298) is intact**, with the same unretriability
   rationale ("a second dispose() call throws `WorldDisposedError` rather than retrying the clear").
7. **The oversized-marking carve-out (1444–1452, 3196–3197, 3305–3307) is intact** — no cancellation
   signal is ever created for it, both release paths still enumerate and remove it, removal is the entire
   cleanup. Fixture-pinned at 4173–4185.
8. **`referenceCount` is still declared "reserved, unused in Milestone 1"** (1225–1227) with no forward
   contract anywhere — a standing known item, not re-argued here.
9. **The room-cache rules are unchanged and internally consistent** (2668–2745): one identity-guarded
   delete on every rejection path, one disposed-first cause mapping shared by both callbacks, and the
   explicit statement that a design differing between the two callbacks "is a bug" (2740–2742). Fixture
   4441–4451.

---

# Round-30 regression check (lifecycle scope, independently re-derived)

`round-30-high-only-fix-pass-disposition.md` was read once for orientation and trusted as evidence of
nothing. Its five claimed fixes were checked against live text for their lifecycle-relevant halves only
(the geometry, query, budget and cache lanes own the rest):

| Claim | Lifecycle-relevant verdict | Evidence |
|---|---|---|
| "No stabilized lifecycle … architecture was reopened. None touch `Model`-object identity, `loadEpoch` monotonicity, disposed-first checkpoint semantics" (disposition 174–179) | **TRUE** — independently confirmed, not accepted | `git diff -U1` hunk headers: no hunk falls in 3057–3565 or 3809–3863; all nine core invariants re-read at their cited lines and hold |
| H-5 admits `SurfaceIntersectionQuery` to the abort-only tier | **TRUE, and it widens M-L1** | 1795–1799, 2018–2029 read directly; "the `bvhcast`-entry checkpoints" at 2060–2062 now has three traversals as referents |
| H-3 inserts a new step 2 with no new public API surface | **TRUE**, but see **L-L6** | 2903–2911, 4366–4374, 4601–4610 |
| "`SurfaceCrossingWitness` remains … in the cooperatively-yieldable tier — untouched" (disposition 158–159) | **TRUE** for the shared-accumulator statement | 2558–2563 unchanged; excluded from the tier at 2034–2040 |
| Round 30 introduced a Critical or High lifecycle regression | **NO** | see above |

**Round-30 side effects the disposition document does not record, in this lane:** M-L1's scope widening
(above), and L-L6.

---

# Cross-system composition concerns (for the synthesis pass)

1. **M-L1 straddles lifecycle and budget/scheduling, and neither lane owns the intersection.** The claim
   it violates lives in the scheduling-taxonomy passage (2045–2073), owned by the budget lane; the
   obligation it creates is a lifecycle one; the conflicting result-shape rule (3449–3453) is a lifecycle
   rule. Round 26 (lifecycle) authored the universal clause, Round 29 (budget) re-derived the tiers around
   it, and Round 30 (budget) enlarged the class it quantifies over. **Treat 2045–2073 as jointly owned**,
   and check that any narrowing of the universal claim does not re-open `invariant-audit-v6-lifecycle.md`'s
   M-L1 (the accumulator-conditional-revalidation question) that clause was written to close.
2. **`SurfaceCrossingWitness`'s tier assignment and M-L1 still interact.** 2034–2040 assigns it to the
   cooperative-composition tier on a *granularity* basis while its own passage (2558–2559, and 2444–2446)
   says it "cannot `await`, yield, or resume". If the budget lane resolves that by declaring tier
   membership to turn on clock basis rather than pausability, M-L1's scope moves with it (2061–2062's
   carve-out is phrased in clock terms). The document brackets its own verdict-determinism question at
   2040–2044 and Round 30 did not resolve it. Adjudicate together, not separately.
3. **Round 30's narrow-phase restructure puts insertion after a checkpoint that may yield — a
   *geometry/concurrency* question with a lifecycle-adjacent premise.** 1377–1380 states "**Insert first,
   then build.** The caller whose lookup misses inserts the `GeometryRecord` … with `buildState:
   'building'` **before** the first phase's checkpoint — that is, before any yield," and 1372–1376
   justifies it partly on a *lifecycle* ground: under publish-only-when-complete "neither `evictModel` nor
   `dispose()` can find the in-flight build promises both are specified to reject." Round 30's 3000–3008
   places `ViewerGeometryAdapter` normalization, the conversion, the ceiling check **and** the insertion
   *inside* the first-touch phase/checkpoint, i.e. after a checkpoint that 1339–1341/2060–2064 say may
   `await`. **The lifecycle half of that premise is not damaged**: nothing unsettled exists during that
   window (no phase has started, so there is no promise for a release path to miss), and a caller resuming
   from that yield runs the two-part revalidation per 2064–2069. **The dedup half may be**: two concurrent
   calls can both miss and both run normalization+insert. Recorded here because it was found while
   verifying the checkpoint enumeration; **severity is the geometry/cache lane's call** (the v8 model
   records the ordering conflict as its `[AMBIGUOUS]` 2.4.8).
4. **The unnamed-error-class gap is now five rejection sites across two lanes.** `maxFragmentsPerDbId`
   (3711–3720), `maxChildrenPerNode` (3721–3739), `maxBroadPhaseInstancePairs` (3740–3744), the step-4
   bucket-capacity check (3745–3751), and Round 30's step-2 precheck (2903–2911) all reject the whole
   call with no named error class; the two lifecycle error classes have no declared shape (L-L2). One gap
   seen from two lanes (lifecycle error taxonomy; cache/budget rejection contracts) — close once,
   together.
5. **Geometry lane coupling, unchanged.** The owner-scoped build-phase checkpoint (1403–1415) is
   consistent with the universal rule and is explicitly *vacuous* under Milestone 1's same-model
   restriction ("eviction of a distinct non-owner operand is unreachable, so this distinction is not yet
   behaviorally observable") — the same unreachability `invariant-audit-v6-lifecycle.md`'s C-L1 turned
   on. Any geometry-lane proposal touching 1403–1415's owner-scoping changes a lifecycle invariant.
6. **Cache lane coupling, unchanged.** `evictModel`'s release of `BlasCache` and cached
   `GeometryConnectivity` is *derived* from the `GeometryRegistry` sweep ("together with its cached BLAS
   and cached connectivity where it has any", 3183–3186), with no keyspace-subset statement of the kind
   the `CollisionInstance` cache received (1276–1280, 3186–3190). If that derivation is incomplete, what
   fails is the completeness of a **lifecycle** guarantee (3214–3216). Cache lane's finding;
   lifecycle-visible consequence.
7. **The dangling cross-reference "Budget enforcement and yield points" (1784, 4724)** — grep-confirmed
   this pass: the phrase occurs exactly twice, both as forward references, and **no section, sub-heading,
   or bolded anchor with that name exists** (full heading list checked). Round-30-introduced, budget
   lane's item; recorded here only because 1784 sits in a passage this lane read in full.

---

# Method notes

- Read directly this pass: 1222–1252, 1321–1460, 1767–1800, 1879–1940, 1983–2075, 2415–2447, 2543–2570,
  2594–2780, 2894–3055, 3057–3575, 3695–3865, 4025–4045, 4286–4460; plus targeted greps over the full
  file for `liveModelByModelId` (25 hits), `WorldDisposedError` / `new WorldDisposedError` (0 hits),
  `ModelEvictedError` / `new ModelEvictedError` (1 hit, line 2715), `[SILENT]` (1 hit),
  `Budget enforcement and yield points` (2 hits), `unload` within 3865–4650 (1 hit), and the file's full
  `^#{1,6} ` heading list.
- Provenance was established with `git diff -U1` hunk headers only — used to attribute NEW vs.
  PRE-EXISTING, never as evidence that anything is correct. Round 30's edits are uncommitted
  working-tree changes.
- Repository evidence read directly: `package.json:27` (`three-mesh-bvh` `0.9.14`);
  `node_modules/three-mesh-bvh/src/core/cast/bvhcast.js` (the module-level `_active` guard at lines 17
  and 26, cleared at 82, with no `try`/`finally` — re-confirmed for this pass, not carried from v7).
- **Two citation corrections to `invariant-audit-v8-model.md` §1**, for future passes: (a) its 1.6.2 and
  the `[SILENT]` table cite `new ModelEvictedError(model.id)` at **3715**; the live site is **2715**
  (3715 is inside the `maxFragmentsPerDbId` Error-Handling bullet). (b) its 1.6.5 describes the bullet at
  3750–3751 as carrying a *stale count*; read against live text "those three" is a back-reference to the
  three siblings just named, not a total — the real residual is recorded here as L-L6.
- **No `codex-advisor` or `codex-review` consult was run.** The one judgment call this pass faced —
  whether M-L1's widened scope moves its severity — was resolvable from spec text plus the pinned
  dependency: the unreachability and propagation arguments that moved it High → Medium in v7 apply
  unchanged to the third traversal, and re-consulting the same adjudicated question would add nothing.
  The native `advisor` tool was not used, per this task's constraint.
- **No spec text was modified by this pass.**
