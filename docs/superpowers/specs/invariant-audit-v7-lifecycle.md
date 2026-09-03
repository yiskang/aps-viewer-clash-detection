# Invariant audit v7 — MODEL / WORLD LIFECYCLE system

**Target**: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (4712 lines),
read directly for this pass (2026-09-03). **Every line citation below was verified by reading the
current spec text in this session.** No prior disposition doc (`round-18-*` … `round-29-*`,
`invariant-audit-v1` … `v6*`) was treated as evidence that anything is presently fixed; prior docs
were consulted only to locate where a question was previously discussed and to attribute NEW vs.
PRE-EXISTING.

**Model used for extraction**: `invariant-audit-v7-model.md` §1 (with §2–§5 cross-references).

**Changelog vs. normative body.** Lines 40–799 are the `## Revision Notes (post-review)` changelog —
historical, past-tense, and **not** invariants. Findings below cite the normative body (801–4712)
and the Status header (1–38) except where explicitly marked `[changelog]`.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 4 |

Six core lifecycle invariants were re-verified against current text and **all six hold**:

| Invariant | Verdict | Cited (verified this pass) |
|---|---|---|
| `Model`-object identity (never `modelId`) as the lifecycle key | **HOLDS** | 3269–3273, 3093–3096, 3279–3283, 3349–3357, 2598–2603 |
| Monotonic `loadEpoch`, never reset, never reused across re-admission | **HOLDS** | 3303–3308, 3046–3047, 3140–3145, 3778–3793 |
| Permanent eviction tombstone (`'evicted'`, one-way, never cleared) | **HOLDS** | 3279–3283, 3110–3115, 3044–3045, 3750–3755, 4335–4344 |
| Disposed-first checkpoint behavior, everywhere | **HOLDS** (with the M-L1 wording gap below) | 3209–3211, 3404–3422, 3060–3064, 3197–3199, 3161–3163, 2723–2725, 2903–2905, 2383–2385, 1403–1406, 2982–2985 |
| Non-throwing Viewer unload-event path | **HOLDS** | 3161–3194, 3220–3223, 4351–4358 |
| Settled `WorldDisposedError` / `ModelEvictedError` semantics and order | **HOLDS** | 3041–3048, 3197–3199, 3212–3223, 3365–3390, 2666–2686, 3756–3772, 4303–4334 |

The flagged `[SILENT]` (abort-only `bvhcast` checkpoints) is **a real gap, not closed elsewhere** —
see M-L1. It is **not** a reachable correctness defect; the reasoning is set out in full there,
including an independently source-verified correction to my own first reading.

---

# Critical

None.

---

# High

None. M-L1 was carried at High through the first draft of this document and was moved down to Medium
after adjudication — see its severity rationale for the argument that defeated the High reading.

---

# Medium

## M-L1 (NEW — introduced by Round 26's own M-L1 fix; never previously recorded). The universal two-part revalidation rule now quantifies over abort-only `bvhcast` checkpoints, for which no lifecycle check, error precedence, or propagation mechanism is specified anywhere

**Status of the model's `[SILENT]` 1.5.2: confirmed real. The text does not close it anywhere.**

### The universal claim (verified verbatim in current text)

- **2034–2036** — "**Every checkpoint named in this document — the build-phase checkpoints and the
  `bvhcast`-entry checkpoints included — is this same mechanism**, except `bvhcast`'s own internal
  abort clock once a traversal is already under way."
- **2039–2041** — "The two-part lifecycle revalidation every checkpoint carries — `disposed` first,
  then the model's load epoch … runs whenever a checkpoint is reached, accumulator-due or not; **it is
  never itself skipped**."
- **2982–2985** — "**Every checkpoint, coarse or fine, checks `disposed` first, then re-validates the
  model's load epoch** … before resuming" — whose own antecedent at **2977–2981** names
  "`ProperCrossingQuery`'s `bvhcast` traversal and `ContainmentQuery`'s sampling loops" as the
  fine-grained checkpoints being quantified over.
- **3411–3414** — the disposal section independently names "the intra-stage checkpoints in
  **`ProperCrossingQuery`**/**`ContainmentQuery`**" as sites that "all check `disposed` (reject
  `WorldDisposedError`) *before* re-validating `modelLifecycle`'s per-model `state`/`epoch` (reject
  `ModelEvictedError`)". This is a third, independent site making the claim over `ProperCrossingQuery`.

### The abort-only sites (verified: neither passage mentions `disposed` or the epoch)

- **1908–1920** (`ProperCrossingQuery`) — "`performance.now()` is read **before each individual
  probe** … A raw candidate pair that never reaches probe classification is still checked at callback
  entry … The moment elapsed time crosses `frameBudgetMs` at either checkpoint, `aborted` is set
  exactly as the count-based triggers do. `bvhcast` cannot be paused and resumed mid-traversal."
  Elapsed time and the `aborted` flag are the entire content.
- **2515–2520** (`SurfaceCrossingWitness`) — "Being `bvhcast`-native, this traversal cannot `await`,
  yield, or resume: the shared elapsed-time accumulator is checked at callback entry and immediately
  before every probe, and exceeding either count ceiling or `frameBudgetMs` sets a traversal-local
  `aborted` flag and returns `true` from the callback."

Neither passage states a lifecycle check, a precedence between a lifecycle failure and a budget abort,
or any propagation mechanism for the former.

### Why it is a genuine inconsistency

1. **The result shapes are specified to be mutually exclusive, and the abort protocol produces the
   wrong one.** Returning `true` from the callback is "the only way to stop a `bvhcast` traversal
   early" (**1863–1867**), and it produces a **diagnosed** negative carrying
   `crossing-budget-exhausted` (1866–1867, 2517–2519, 3712–3714). **3383–3387** is explicit that a
   lifecycle failure "aborts the **entire** `findClashes` call … **neither returns a partial or
   diagnosed `ClashResult`**. This is a different failure than anything the diagnostic system answers."
   So the checkpoint class that 2982/3411 sweep in has exactly one specified exit, and that exit
   produces the result shape 3385 forbids for the failure 2982 asks it to detect.

2. **The carve-out at 2035 does not resolve it on either reading.** Read narrowly (only the *clock
   basis* is excepted — which is what 1869–1888 and 2008–2018 are actually about), the revalidation
   obligation still lands on these sites and (1) applies. Read broadly (the whole mechanism is excepted
   once a traversal is under way), it directly contradicts 2039–2041's "it is never itself skipped",
   2982's "every checkpoint, coarse or fine", and 3411–3414's naming of `ProperCrossingQuery`. The
   text does not choose, and the three later absolute statements defeat a confident harmonized reading.

3. **The argument that makes the gap operationally harmless is never made in the document.** A
   synchronous native traversal cannot observe a lifecycle transition, because `dispose()` (3209–3211)
   and `evictModel` (3107–3112) are both wholly synchronous and nothing can interleave inside one
   synchronous span, so the revalidation at these sites would be *redundant*, not merely omitted. The
   spec has this exact argument in its vocabulary and applies it to a different site — **2672–2674**,
   "Nothing can interleave between the two calls — both are synchronous and there is no `await`
   between them — so the pair reads one consistent world state" — and recognizes the enabling
   constraint at **2777–2779** ("there is no way to `await` the sibling checkpoint inside a
   synchronous native callback — the same constraint `ProperCrossingQuery`'s abort protocol states for
   `bvhcast`"). It never draws the lifecycle corollary. A grep of the whole file for
   `interleav`/`no \`await\`` finds the argument at 2672–2674 and on no other lifecycle claim.

4. **No fixture pins it either way.** The lifecycle fixture block (4253–4369) pins entry-check
   ordering, resumed-yield-checkpoint behavior (4317–4334), the `isLeaseValid`/`isModelLive` disposal
   contracts, and both room-search callbacks — but nothing exercises a checkpoint inside a `bvhcast`
   traversal.

### Severity rationale — and the correction that moved it

Carried at **High** in this document's first draft on the reasoning that the design offers *no*
mechanism to honor the rule. A `codex-advisor` (`medium`) consult defeated that reading with a
concrete counterexample, which I then re-derived and verified against the installed dependency
myself:

- **The propagation mechanism exists, it is just unstated.** The callback can record a
  lifecycle-failure reason and *also* return `true`; the caller, after `bvhcast` returns, checks the
  lifecycle reason **before** `aborted` and throws it — satisfying 3383–3387 exactly. That is
  under-determination, not impossibility, which is the Medium bar rather than the High bar.
- **Runtime unreachability is confirmed against the pinned dependency, not merely reasoned.**
  `package.json:27` pins `three-mesh-bvh` at `0.9.14`. `node_modules/three-mesh-bvh/src/core/cast/bvhcast.js`
  is a synchronous recursive traversal with no Promise, `await`, timer, event dispatch, or scheduler
  call, invoking the supplied callback directly inside synchronous nested loops. Microtasks, Viewer
  events, and timers cannot interleave until the stack unwinds, and a Worker cannot mutate an ordinary
  boolean or `WeakMap`. Reentrancy would require an adversarial condition (monkey-patched BVH methods,
  side-effecting Proxies/getters, or collision-library callback code itself calling `dispose()`) that
  this spec's threat model neither states nor is required to resist.
- **One additional hazard, verified directly in the pinned source, belongs with this finding.** The
  *obvious* implementation of an unstated lifecycle exit — throwing straight out of the callback — is
  **unsafe in 0.9.14**: `bvhcast` sets a module-level `let _active = false` guard to `true` on entry
  (`bvhcast.js:17,26`) and clears it only on the normal-return path (`bvhcast.js:81-82`), with **no
  `try`/`finally`**. A callback throw therefore leaves `_active === true` permanently, and every
  subsequent `bvhcast` in that page session throws `MeshBVH: Recursive calls to bvhcast not
  supported.` I read this file directly to confirm it. This is precisely why the missing propagation
  statement matters in practice even though the redundancy argument holds: the spec leaves an
  implementer to pick between a correct-but-unstated flag mechanism and an intuitive one that
  permanently breaks the traversal primitive.

**Framing.** This is best recorded as an **overclaim introduced by Round 26's general-rule text
(2034–2047), not as a defect in the abort-only passages.** 1908–1920 and 2515–2520 accurately describe
the installed dependency and form a coherent scheduling/result protocol on their own terms.
`round-26-lifecycle-medium-low-disposition.md` Cluster 1 closed `invariant-audit-v6-lifecycle.md`'s
**M-L1** (is the revalidation accumulator-conditional?) by universally quantifying over "every
checkpoint … the `bvhcast`-entry checkpoints included" — a class that had not previously carried the
claim. v6-lifecycle's own Round-22 regression table recorded the abort-only bullet as carrying "**No
lifecycle claim**" (v6-lifecycle line 252). The obligation was acquired as a side effect of a fix.
**NEW relative to Round 26 and Round 29; never recorded in this lineage.**

**Not a request to fix.** Two shapes would close it, neither authored here: scope the universal claim
to resumable checkpoints and state the redundancy argument explicitly for the abort-only class; or
state the record-a-reason-then-return-`true` propagation protocol and its precedence over `aborted`,
noting the 0.9.14 `_active` hazard that rules out a bare throw.

## M-L2 (NEW; never previously recorded). `dispose()`'s cleanup contract enumerates four caches and never clears `liveModelByModelId`, the one remaining world-owned structure holding strong `Model` references

`dispose()`'s remaining job after Round 15 is explicitly **memory hygiene rather than correctness**
(3427–3432). What it does is enumerated exhaustively, twice:

- **3224–3227** — "dispose() also wholesale-clears **all four caches** — `GeometryRegistry`,
  `BlasCache`, every cached `GeometryConnectivity`, and the `CollisionInstance` identity cache — each
  in its own single clear operation, **not a per-model sweep over `liveModelByModelId`**."
- **3429–3432** — the same four, restated.

What it does to `liveModelByModelId` is only: "It **best-effort tombstones whatever
`liveModelByModelId` currently references**, for diagnostic bookkeeping" (3241–3243). Writing a
tombstone into a `WeakMap` does not remove the strong reference the `Map` itself holds. I checked
every one of the 24 `liveModelByModelId` occurrences in the file (375, 401, 430, 437, 1276, 3047,
3142, 3151, 3227, 3242, 3244, 3288, 3329, 3359, 3362, 3373, 3396, 3399, 3432, 3444, 3762, 3784, 4275,
4329–4330): **no site anywhere says `dispose()` clears, empties, or drops this map.** The only
deletion specified is `evictModel`'s occupancy-guarded per-object delete (3151–3154, 3296–3299),
which by construction cannot run after disposal — `evictModel` returns as a no-op on a disposed world
(3107, 3161–3163).

**Why this is a defect and not a nitpick.** It weakens the load-bearing argument the `WeakMap` choice
rests on: **3284–3286** — "Using a `WeakMap` is what makes 'permanent' free rather than a leak — **if
every other reference to an evicted `Model` object is eventually dropped**, its entry is reclaimed by
the GC along with it." `liveModelByModelId` *is* one of those other references, is world-owned, and
survives the world's own terminal method. A disposed `CollisionWorld` retains strong references to
every `Model` object that was the current occupant of its `modelId` at disposal time, for as long as
anything references the world. That is exactly the release-completeness class of concern the spec
formalizes for the *other* release path at **3145–3150** ("a state-release/cleanup completeness
concern, not a liveness-correctness one — the object is correctly dead either way — **but it is
required for the design to actually reclaim what it claims to**"). The same standard is never applied
to `dispose()`.

Medium, not High: nothing reads `liveModelByModelId` after disposal (every reader checks `disposed`
first), so no correctness property breaks; and in the ordinary `RoomLocatorExtension.unload()` path
the extension instance — and with it the world — becomes unreachable shortly afterward, so the GC
resolves it in practice. No fixture covers it (4303–4334 pins disposal behavior; none pins map
release).

## M-L3 (PRE-EXISTING as an *open question* in the spec; NEW as a finding, and newly corroborated by formal Viewer knowledge). `unload()`'s three steps have no per-step isolation, step 1 can throw, and the tearDown-path release-completeness claim is explicitly conditioned on all three completing

Current text, verified:

- **3462–3487** — `unload()` is `world.dispose()` → unregister context menu + `BEFORE_MODEL_UNLOAD`
  listener → clear the per-model room cache, in that order. "**A repeated `unload()` call re-invokes
  `world.dispose()`, and a second/repeated `dispose()` call is guaranteed to throw
  `WorldDisposedError` … synchronously, before steps 2/3 ever run — stranding listener removal,
  context-menu removal, and the room-cache clear for that invocation.**" The spec calls this "the same
  'benign only because something else catches it' shape as the first hazard, **not a resolution of
  it**", then explicitly declines to settle it: "Whether the Viewer or app code can invoke `unload()`
  a second time on one instance is **unstated**. Per-step isolation of `unload()`'s three steps, and
  whether the listener should be removed before `dispose()` rather than after, **remain open and are
  not settled here**" (3483–3487).
- **3469–3472** — the first hazard (a `BEFORE_MODEL_UNLOAD_EVENT` firing into an already-disposed
  world) is "benign, but only because `world.evictModel` is a no-op on a disposed world rather than a
  throw — **it is the method's totality that makes this ordering safe, not the ordering itself**."
- **2583–2589** — the whole tearDown-path conclusion (that `evictModel` is never invoked for the
  outgoing model, and `dispose()`'s wholesale clear plus the room-cache clear "already release
  everything a per-model `evictModel` call would have") is stated "**provided `unload()` itself
  completes all three of its steps**". A normative release-completeness claim is therefore conditioned
  on a proviso the document's own 3473–3478 hazard shows may not hold, and the loop is never closed.

**Independent corroboration via the `viewer-extension-lifecycle-audit` skill** (Check C — Unload
Isolation; Check D — Teardown Ordering). The kit's formal Pattern
`viewer-tool-and-extension-lifecycle` (`status: active`, `last_reviewed: 2026-08-26`, evidence tier
*official-doc + official-autodesk-blog*) states directly: "In `unload()`, **wrap each
independently-disposable step in its own try/catch** (or an equivalent isolation helper). **One step
throwing must not strand the steps after it**" — recorded as reproduced across **two independent
architectures** (`aps-model-alignment` @ `beef92c`; `aps-viewer-visualization-kit` @ `d032de5`,
Viewer 7.124.2). The same Pattern adds that "**Teardown order is a correctness property, not merely
isolation**" once steps depend on shared, liveness-asserting collaborators — which is exactly the
dependence 3469–3472 describes. So the spec's explicitly-open item is open *against mature,
cross-project-verified formal guidance that already settles the general shape*, and the mitigation
the spec names (`Viewer3D.tearDown`'s try/catch at `viewer3D.js:26583` swallowing the throw) protects
the Viewer, not the extension's own stranded steps.

Medium, not High: on the *first* `unload()` the throw does not occur (the first `dispose()` succeeds),
so steps 2/3 do run; the stranding is reachable only on a repeated `unload()`, whose reachability the
spec itself records as unstated. No fixture covers repeated `unload()`.

---

# Low

## L-L1 (PRE-EXISTING — introduced by the Round-24 pass, commit `ccaa75e`; never recorded as a defect). An invariant-audit marker has leaked into normative body text

**3683–3684**, inside `## Error Handling & Edge Cases` (normative body, not changelog): "…the same
call-level, pre-mutation rejection contract as `maxFragmentsPerDbId`, `maxChildrenPerNode`, and
`maxBroadPhaseInstancePairs` above, and **carrying no named error class, the same `[SILENT]` gap those
three share**." The literal string `` `[SILENT]` `` is this audit lineage's own marker vocabulary, and
the spec is the only place it appears (verified: one occurrence in the entire 4712-line file).
Attributed by `git log -S` to `ccaa75e` ("Fix Round-24 cache-cluster Medium/Low findings"). The
*substance* — four call-level ceiling rejections with no named error class — is a genuine gap the spec
is right to record; the defect is that it is recorded in the audit's private vocabulary inside
normative prose, where a reader outside this lineage cannot resolve it.

## L-L2 (PRE-EXISTING; never recorded). No constructor signature or payload is stated for `WorldDisposedError` anywhere in the document

`ModelEvictedError` has exactly one payload literal — `new ModelEvictedError(model.id)` at **2672** —
plus the prose gloss "naming the evicted `modelId`" at **3385**. `WorldDisposedError` is raised at
3043, 3197–3198, 3213, 3366–3367, 3384, 3474–3476, 3493–3495, 2666–2680 and 3758–3759, and is never
once given a shape. Neither class is declared in the Public API TS block (2993–3250) or in the
diagnostics section (3500–3626). Low — implementable by inference — but the spec explicitly tells
callers they "may branch on which error class they got" (2685–2686, 3088–3091, 4315–4316), which makes
the error surface part of a public contract it never declares.

## L-L3 (NEW; never recorded). `ModelEvictedError` "naming the evicted `modelId`" is ambiguous under the design's own supported reused-`modelId` state

**3385** specifies the error as "naming the evicted `modelId`" and **2672** constructs it as
`new ModelEvictedError(model.id)`. But **3397–3399** makes "two `Model` objects sharing a reused
`modelId` are both currently live" a "**supported, tested state**" (pinned by 4293–4302 and
4325–4334), and **3113–3115** makes the tombstone explicitly per-object — "this exact object can never
become live again in this world, **even if `model.id` is later reused by a different object**." So the
single identifier the error carries is precisely the identifier the whole round-12→14 redesign
established is *not* sufficient to identify a load: `ModelEvictedError(7)` may name an id whose
current occupant is a different, perfectly live object. Low — diagnostic payload only — but it is a
direct composition tension between model §1.4.18 and §1.7.1, and the natural remedy (also naming the
epoch) is blocked by **3102–3106**, since the `'evicted'` variant deliberately carries no epoch.

## L-L4 (PRE-EXISTING; disclosed by the spec, recorded for the synthesis pass). The intra-`tearDown()` step-ordering claim is source-observed against a bundle absent from this repository and is covered by no formal Viewer knowledge

**2582–2596** conditions the §1.8.7 conclusion on an ordering claim cited to
`viewer3D.js:26541-26560`, `:26583`, `:34052`, `:34054`, and **2590–2596** discloses its tier: "This
ordering is an internal implementation detail, **not documented or guaranteed by Autodesk —
revalidate on any Viewer upgrade.**" The related claims at 3169–3178
(`EventDispatcher.dispatchEvent` invoking listeners with no try/catch, `viewer3D.js:13300-13341`; the
unguarded `unloadCurrentModel` loop, `:34253-34258`) are cited the same way.

**What the skill audit could and could not corroborate.** Kit root resolved to
`/Users/kangea/.shconfig/vendors/aps-viewer-agent-kit`; hard dependencies `viewer-model-lifecycle` and
`viewer-tool-and-extension-lifecycle` both read at `status: active`, `last_reviewed: 2026-08-26`.

- **Corroborated (Check F).** `knowledge/viewer-model-lifecycle.md` independently establishes, against
  a digest-pinned 7.124.2 bundle, that `loadDocumentNode`/`loadModel` invoke `tearDown()` when
  `keepCurrentModels` is falsy and `hasModels()` is true, and that `tearDown()` unloads every
  registered extension with nothing re-registering it — including the **same line locators the spec
  cites**, `viewer3D.js:27710` and `88293` (spec 2573–2575). The kit records this side effect as
  **undocumented** by either method's own Reference Guide entry, exactly as the spec says. §1.8.5's
  Viewer claim is therefore independently confirmed, not merely asserted.
- **Corroborated against this repository.** `wwwroot/viewer.js:18-24` registers extensions once in
  `config.extensions` before `viewer.start()`, and `wwwroot/viewer.js:31-41` (line 34) calls
  `viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true))` with **no options object**,
  so `keepCurrentModels` is never set. Both spec citations are accurate as to file and substance.
- **Check F intent classification — no finding.** Per the skill's intent-aware rule this is the
  *intent-unresolved* branch, never a default Critical: the spec declines to decide between "the
  application must explicitly reload the extension" and "Milestone 1 supports Room Locator only up to
  the first model replacement" (2578–2582), and characterizes it as "a Milestone-1 **application-wiring
  gap**, not a defect in the identity apparatus itself" (2576–2578). That matches the skill's
  prescribed treatment.
- **Not corroborated (evidence ceiling).** No kit dependency covers the *ordering of steps inside*
  `tearDown()` — that extensions are unloaded and `loadedExtensions` cleared **before**
  `impl.unloadCurrentModel()`, and therefore before `BEFORE_MODEL_UNLOAD_EVENT` is dispatched. The kit
  states only that `tearDown()` "unloads extensions in an order the calling application does not
  control". No `viewer3D.js` bundle exists in this repository (CDN-loaded; a `find` over the repo
  excluding `node_modules` returns nothing), so those four line locators could not be re-verified.
  Per the skill's §6 this resolves **`needs-runtime-validation`**, version-pinned to 7.124.2.

Low, because the spec already discloses the claim's tier and demands revalidation on upgrade — but
flagged because §1.8.7 (`evictModel` is never invoked on the tearDown path; `dispose()`'s wholesale
clear suffices) rests entirely on it *and* is separately conditioned on M-L3's unresolved proviso.
The two conditions compound.

---

# Historical-only / non-defect observations

1. **Status header staleness, self-disclosed.** Line 3 still reads "revised after seventeen rounds of
   codex review"; 21–22 declare the paragraph deliberately frozen at the Round 17→18 transition; 23–30
   enumerate post-Round-23 rounds only "at minimum Round 24 …, Round 25 …, Round 26 …, and Round 27 …
   as of this writing" — **Rounds 28 and 29 exist and are not named**. Lines 26–30 pre-empt this
   ("check `docs/superpowers/specs/round-*-disposition.md` for the full, current list rather than
   trusting this paragraph's enumeration"). Disclosed staleness, not a defect.
2. **No changelog entries for Rounds 24–29.** `## Revision Notes` (40–799) ends at Round 23 (786);
   Rounds 24–29 landed as disposition docs only. Consistent with the document's stated convention;
   noted so a future pass does not read the changelog's endpoint as the document's.
3. **Numbering gaps at Rounds 7, 8, 20** are disclosed at 30–32; Round 20 is reachable only via 679
   `[changelog]`.
4. **The `evictModel` non-throwing justification chain (3166–3189) is unchanged and internally
   consistent**, and is pinned by fixture **4351–4358**, which asserts the mocked dispatch loop reaches
   a *second* model — i.e. the fixture tests the Viewer-teardown blast radius, not merely the return
   value. Verified; no finding.
5. **Round-26's other lifecycle closures verified present in current text.** v6-lifecycle's **L-L1**
   (entry-check ordering between the cross-model rejection and the lifecycle checks) is now settled and
   consistent at **2723–2729** and **3365–3373** — `disposed` → cross-model → per-operand, in the same
   order at both sites. v6-lifecycle's **L-L2** (four-cache count) verified at 3224–3226 and 3429–3431;
   the "three caches" wording survives only in `[changelog]` at 414.
6. **v6-lifecycle's standing item "`world.dispose()`'s own contract lacking an explicit non-throwing
   requirement"** is now closed for the wholesale clear at **3228–3231** ("this wholesale clear is
   required to be non-throwing").
7. **`referenceCount` is still declared "reserved, unused in Milestone 1"** (1225–1227) with no
   semantics anywhere — carried over unchanged; a standing known item, not re-argued here.

---

# Cross-system composition concerns (for the synthesis pass)

1. **M-L1 straddles lifecycle and budget/scheduling, and neither lane owns the intersection.** The
   claim it violates lives in the scheduling-taxonomy passage (2034–2047), owned by the
   budget/scheduling lane; the obligation it creates is a lifecycle one; the conflicting result-shape
   rule (3383–3387) is a lifecycle rule. Round 26 (lifecycle) authored the universal clause and Round
   29 (budget) re-derived the tiers around it. **Treat 2034–2047 as jointly owned**, and check that any
   narrowing of the universal claim does not re-open v6-lifecycle's M-L1 (the
   accumulator-conditional-revalidation question) that clause was written to close.
2. **`SurfaceCrossingWitness`'s tier assignment (model §4.2.3) and M-L1 interact.** 2008–2018 assigns
   it to the *cooperative-composition* tier, whose stated membership criterion at 2032–2033 is
   pausability — while 2515 and 2401–2403 say it is `bvhcast`-native and "cannot `await`, yield, or
   resume". If the budget lane resolves that ambiguity by declaring tier membership to turn on clock
   basis rather than pausability, M-L1's scope moves with it (2035's carve-out is phrased in clock
   terms). The two should be adjudicated together, not separately.
3. **Round 29's M6-B2 fix landed at only one of two sites.** `round-29-*-disposition.md` records M6-B2
   as fixing the stale "~60× the gate's own ~16ms criterion" comparison. Line **1950** (the
   atomic-operations table row) *is* fixed and annotated ("~40× the gate's own ≈24ms worst-case-span
   bound … Round 18's own comparison used this document's then-current ~16ms figure, superseded by
   Round 22's re-derivation"). But **2893–2898** (Data Flow step 3, normative body, unannotated) still
   reads "about **60× the performance gate's own ~16ms pass criterion**", while the gate's actual
   pass/fail line is **24.8ms** (4436–4443). Budget/scheduling lane's item; recorded here because it
   was found while verifying the checkpoint enumeration, and because it is direct evidence for this
   pass's governing rule — a disposition doc's claimed fix must not be trusted without re-reading
   current text.
4. **The four call-level ceiling rejections have no named error class** (3678–3684) and the two
   lifecycle error classes have no declared shape (L-L2). These are one gap seen from two lanes
   (lifecycle error taxonomy; cache/budget rejection contracts) and should be closed once, together.
5. **Geometry lane coupling.** The owner-scoped build-phase checkpoint (1403–1412) is verified
   consistent with model §1.5 and is explicitly *vacuous* under Milestone 1 ("eviction of a distinct
   non-owner operand is unreachable, so this distinction is not yet behaviorally observable"), which is
   the same unreachability `invariant-audit-v6-lifecycle.md`'s C-L1 turned on. Any geometry-lane
   proposal touching 1403–1412's owner-scoping changes a lifecycle invariant.
6. **Cache lane coupling.** `evictModel`'s release of `BlasCache` and cached `GeometryConnectivity` is
   *derived* from the `GeometryRegistry` sweep ("together with its cached BLAS and cached connectivity
   where it has any", 3118–3120), with no keyspace-subset statement of the kind the `CollisionInstance`
   cache received (1276–1280, 3120–3124). If that derivation is incomplete, what fails is the
   completeness of a **lifecycle** guarantee (`releaseEpochScopedState` reclaims what eviction claims
   to, 3145–3150). Cache lane's finding; lifecycle-visible consequence.

---

# Method notes

- Read directly this pass: 1308–1460, 1860–2060, 2372–2410, 2440–2550, 2551–2740, 2745–2990,
  2991–3500, 3628–3795, 4250–4405, 4560–4712; plus targeted greps over the full file for
  `liveModelByModelId` (24 hits), `[SILENT]` (1 hit), `interleav`/`no await`, and
  `60×`/`40×`/`~16ms pass criterion`.
- Repository evidence read directly: `wwwroot/viewer.js` (full); `package.json:27`;
  `node_modules/three-mesh-bvh/src/core/cast/bvhcast.js` (the `_active` guard, lines 17/26/81-82,
  confirming no `try`/`finally`).
- `viewer-extension-lifecycle-audit` skill invoked; kit root
  `/Users/kangea/.shconfig/vendors/aps-viewer-agent-kit`; hard dependencies `viewer-model-lifecycle`
  and `viewer-tool-and-extension-lifecycle` read at `status: active`. **Discovery-coverage limit:** no
  `viewer3D.js` bundle exists in this repository, so every `viewer3D.js:NNNNN` citation in the spec
  other than `27710`/`88293` (independently corroborated by the kit) is `needs-runtime-validation`
  here, not verified.
- One `codex-advisor` consult (`medium`, request `20260903-132213-80717-19306`) was used solely for
  the M-L1 severity adjudication. It moved the finding High → Medium, supplying the
  record-a-reason-then-return-`true` counterexample and the `three-mesh-bvh` 0.9.14 source reading. I
  re-verified both against the installed dependency before accepting them; the outcome and the
  reasoning that moved it are recorded in M-L1's severity rationale.
- **No spec text was modified by this pass.**
