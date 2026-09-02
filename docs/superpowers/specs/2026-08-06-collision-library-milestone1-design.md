# Collision Library — Milestone 1: Core Slice + RoomLocatorExtension

Status: revised after seventeen rounds of codex review (see `review-coments.md`, `review-comments-v2.md`
… `review-comments-v17.md` in this directory). Between round 17 and the still-pending round-18 Codex
re-review, an invariant-driven consistency audit (`docs/superpowers/specs/invariant-audit-v1.md`) found
5 fresh Critical contradictions and further High findings by building a cross-system invariant model and
auditing the full spec text against it, rather than by another Codex pass. **This is "Round 18" below**
— an invariant-audit-driven system fix pass, not a Codex review round; the fixes are labelled "Round 18"
for cross-reference brevity and consistency with this changelog's own numbering, but no `review-comments-
v18.md` exists and the Codex round-18 re-review this Status line has referred to since round 17 is still
outstanding, now against the post-Round-18-fix-pass text. Rounds 10–17's combined High findings (stable
since round 10, one new in round 13) are recorded in `review-comments-v10.md` through
`review-comments-v17.md` and remain intentionally deferred, not yet applied, **except**: the one
stale-wording item round 17 named directly (`volume-overlap`'s performance-gate connectivity wording),
fixed alongside round 17's Critical; and four items the Round 18 fix pass applied because they directly
affected the same invariants it was fixing — H-G1 (triangle-count units), H-B1 (broad-phase synchronous
span), H-B2 (worst-case-span formula), and H-Q3 (`containment`'s Public API wording) from
`invariant-audit-v1.md`'s own High-severity list. See the Round 18 revision-notes entry below for the
full scope of this pass and `invariant-audit-v2.md` for the post-fix re-audit.
Date: 2026-08-06
Related: [`docs/ideas/aps-viewer-clash-detection-library-idea.md`](../../ideas/aps-viewer-clash-detection-library-idea.md)

## Revision Notes (post-review)

### Round 1 (4 P1, 3 P2 — all confirmed valid)

- Room discovery moved from extension `load()` (before any model exists) to a lazily-built,
  per-model cache.
- The containment algorithm was replaced: the old two-step "surface-intersection-then-bbox-center"
  approach was both non-symmetric and capable of false positives/negatives.
- The Viewer geometry adapter started normalizing primitive ranges (`groups`/`drawRange`).
- Cross-model queries are explicitly rejected in Milestone 1 rather than silently allowed with an
  undefined coordinate convention.
- `ClashResult.statistics` is always populated, and skipped fragments became a structured
  diagnostic instead of a console warning only.
- BLAS construction was called out as synchronous/blocking, with a yield-between-builds rule added.

### Round 2 (2 P1, 2 P2 — all confirmed valid)

Round 1's fix for the containment algorithm overcorrected: dropping the surface-crossing check
entirely (to fix its "touching gets promoted to overlap" bug) reintroduced a worse bug — pure
vertex-sampling misses genuine interpenetration when neither solid's vertices land inside the other
(e.g. a duct crossing through a beam mid-span, both thin enough that no corner of either lands
inside the other — precisely the idea doc's own first benchmark scenario, "MEP models with many
low-poly fragments"). This revision:

- Reinstates a real triangle-triangle crossing test as one of two `volume-overlap` conditions, OR'd
  with bidirectional containment sampling — fixing the false negative without reverting to the
  single-direction, non-symmetric original bug.
- Gives `surface-intersection` mode its own real, tested definition (it was listed but never
  designed) — it runs the same bounded `bvhcast` traversal `volume-overlap` uses for its crossing
  check, under a weaker predicate and the same budget.
- Specifies the ray-parity containment test in enough detail to actually be correct:
  `THREE.DoubleSide`, coincident-hit deduplication, a concrete retry rule, and defined epsilon units.
- Fixes three real bugs in geometry-range normalization (wrong index property path, missing
  `InterleavedBufferAttribute` support, `drawRange`/`groups` treated as either/or instead of
  intersected) and now explicitly rejects legacy `offsets` layouts instead of silently guessing.
- Restricts vertex sampling to vertices actually referenced by active ranges, and spreads the sample
  budget across ranges rather than blindly striding the raw buffer, to reduce (not fully eliminate)
  the risk of missing small disconnected sub-parts.
- Replaces per-fragment `skippedFragments: FragmentRef[]` with pair-scoped `ClashDiagnostic`s
  carrying a reason code.
- Commits to a concrete synchronous-build size threshold with a defined fallback, instead of leaving
  the blocking budget as an open question.

### Round 3 (3 P1, 3 P2 — all confirmed valid)

Round 2 fixed the false *negative* (duct-through-beam) by OR-ing in a raw surface-intersection test,
but resolved the resulting false *positive* — zero-volume contact counting as overlap — only by
documenting it. That wasn't good enough: the idea doc defines volume overlap as two solids **sharing
volume**, with touching as a separate mode
([idea:1061](../../ideas/aps-viewer-clash-detection-library-idea.md#L1061)), and the CSG code being
replaced already excluded touching (a BSP intersect of face-touching solids yields no polygons). So
"documented touching-inclusive `volume-overlap`" was a silent behavioral regression against the very
implementation this milestone replaces. This revision:

- **Classifies proper crossings** instead of accepting any surface hit: a new `ProperCrossingQuery`
  enumerates intersecting triangle pairs via `bvhcast` and tests whether the two solids actually
  share volume near the intersection curve. `volume-overlap` regains its idea-doc meaning;
  `surface-intersection` remains the (correctly-named) touching-inclusive mode.
- **Replaces capped vertex sampling with per-connected-component sampling**, which makes the
  containment step *exact* rather than approximate — see `ContainmentQuery` for why the component
  decomposition removes the false negative entirely rather than just making it less likely. This
  also resolves a real arithmetic contradiction in the previous draft ("up to 64 samples" vs. "at
  least 8 per range" with more than 8 ranges).
- **Splits the single mixed-unit epsilon** into a dimensionless barycentric tolerance and a
  scale-relative local-space distance tolerance, and pins ray direction/hit-sorting to the target
  BVH's own local frame.
- Uses `model.search(...)` rather than `viewer.search(...)` — the latter is declared without the
  `options` argument and isn't scoped to the model the cache is keyed by.
- Makes diagnostics role-aware, and emits them for *partially* inconclusive negatives, not only
  totally inconclusive ones.
- Drops `firstHitOnly` from the Milestone 1 API rather than shipping an undefined option.

### Round 4 (4 P1, 1 P2 — all confirmed valid)

Round 3 built the right *structure* (classify crossings, decompose into components) but several of its
geometric primitives don't survive contact with the actual `three-mesh-bvh` contract or with
adversarial geometry. Two findings independently defeat round 3's headline fix — touching must not
count as overlap — by different routes:

- **Boundary points read as "inside."** Ray parity from a point lying exactly *on* a target face
  produces a distance-zero hit that the barycentric edge/vertex rule doesn't reject, flipping parity
  to "inside." A box resting on another box has its whole bottom face on the target's boundary, so
  this turns pure face contact back into `volume-overlap` — undoing round 3. Fixed with an explicit
  three-valued `inside | outside | boundary` classification and a surface-proximity pre-check.
- **`interiorOffset` imposed a hidden minimum penetration depth.** Stepping a fixed
  `1e-4 × diagonal` off the intersection curve steps *clean through* any overlap thinner than that,
  yielding a false negative with no vertex witness either. Replaced with an adaptive offset ladder
  and an explicitly declared `minPenetrationDepth`, plus a symmetric definition of whose diagonal
  sets the scale (round 3 never said).
- **Coplanar pairs never had a valid segment.** Verified directly against upstream: the coplanar
  branch of `ExtendedTriangle.intersectsTriangle` warns and sets the output edge to `(0,0,0)`, so
  round 3's midpoint was the origin and the four-quadrant argument was vacuous for exactly the case
  it most needed to classify. Coplanar contact now has its own classification path that never asks
  for a segment.
- **The exactness proof was wrong.** Vertex-based union-find can merge two solids joined at a single
  vertex; one may sit inside the target and the other outside with no transverse crossing, so
  component representatives can miss the contained one. Round 3's rebuttal ("they touch, so the
  contact query decides it") confused A-touching-*itself* with A-touching-B. Fixed by switching to
  edge-connectivity, replacing the unconditional "exact" claim with a stated-precondition guarantee,
  and detecting the geometry that violates it.
- **Model removal leaked collision data.** The room cache was evicted per model but geometry
  records, BLASes, and connectivity — all keyed by `(modelId, geometryIndex)` — were only freed by a
  whole-world `dispose()`. Added `world.evictModel()`.

This round also pins exact dependency versions and corrects the vendor file layout, both of which
were wrong in a way that would have surfaced at first `npm install`.

### Round 5 (3 P1 accepted, 1 P1 rejected with evidence, 1 P2 accepted)

- **`bvhcast` does not hand you intersecting pairs — it hands you *candidates*.** Round 4 built the
  whole crossing classifier on the assumption that an `intersectsTriangles` callback meant an
  intersection had occurred. Verified against `MeshBVH.js` at tag `v0.9.14`: the wrapper is a plain
  nested loop over every triangle in the two overlapping leaf ranges, calling the callback for each
  pair with **no intersection test whatsoever** — testing is the callback's job. Round 4 would
  therefore have computed segments from non-intersecting pairs, where `intersectsTriangle` returns
  false and leaves `targetLine` holding a *previous* pair's data, fabricating crossings from stale
  state. `ProperCrossingQuery` now tests each candidate explicitly, and orders the coplanar check so
  the upstream warning path is never entered at all.
- **Four samples never guaranteed a conclusive one.** The containment guarantee said "one conclusive
  sample decides the component," but the algorithm stopped after 4 arbitrary vertices. A solid deep
  inside a room while sharing one coplanar face with it can have all 4 picks land on that shared
  face, all reading `boundary` — returning a diagnosed non-overlap for an overlap far deeper than
  `minPenetrationDepth`. Sampling now continues until conclusive and, if a component's vertices are
  exhausted inconclusively, falls back to a **constructed interior witness** rather than giving up.
- **Tolerances were declared in one frame and applied in another.** Round 4 scaled every tolerance by
  a characteristic length defined in the classification frame, but `classifyPoint` does its proximity
  and ray work in the *target* BVH's local frame — so `surfaceEpsilon`/`mergeDistance` were being
  compared against distances in a different space, and the `min(diagonal(A), diagonal(B→A))` formula
  wasn't even symmetric under swap. Tolerances are now **target-frame-local** by construction, and
  operand order is **canonicalized** so symmetry is structural rather than a property of a formula.
- **Interleaved stride/offset mapping** is now spelled out instead of implied.
- **Rejected: "`three-mesh-bvh@0.9.14` is not published."** It is. `https://registry.npmjs.org/three-mesh-bvh`
  lists `0.9.14` in `versions` with `dist-tags.latest = 0.9.14`, published `2026-08-01T04:33:04Z`,
  and its tarball returns HTTP 200. The npmjs.com web UI can lag the registry, which is the likely
  source of the discrepancy. The pin stays at `0.9.14` — downgrading to `0.9.13` on this basis would
  pin an *older* release for no reason. The finding's methodological point was fair, though, and has
  been acted on: every upstream claim in this spec is now verified against the exact `v0.9.14` tag
  rather than `master`.

### Round 6 (4 P1 — all confirmed valid)

Round 5's fixes held, but three of these findings expose the same underlying gap: **the spec
described point classification without ever declaring the solid model it implies.** Parity, "any
component," and "closed manifold" were each specified locally and never reconciled into one
statement of what geometry *means*. This revision adds that statement (see **Solid model**) and
fixes what it exposes:

- **Open components could produce a clean false-positive overlap.** A single open triangle inside a
  closed box has zero volume, yet one of its vertices classifies `inside`, so `anyComponentInside`
  returned true and `volume-overlap` reported an *undiagnosed* clash. Round 5 flagged non-manifold
  components only on **negative** results, which is exactly backwards for this case. Flagging now
  follows whichever component decided the outcome, in either direction.
- **Target-wide parity is XOR, not union — and the spec claimed neither.** A point inside two nested
  closed shells crosses two surfaces and reads `outside`. Round 5's composition ("any component
  inside") implied union semantics while the primitive implemented even-odd, so a source inside two
  concentric target shells was a clean false negative. Even-odd is now the **declared** model, with
  its real justification (it is what makes a pipe's bore correctly hollow) and its real limitation
  (genuinely nested independent solids in one geometry) both stated and pinned by fixtures.
- **The constructed witness reintroduced the frame bug round 5 had just fixed.** `offsetLadder` is
  scaled by `L_canonical`, but the witness construction applies it in the *source component's* frame.
  Round 5 established the per-frame principle and then missed an instance of it; there is now a
  separate `witnessLadder` scaled by `L_source`.
- **Raw `bvhcast` candidate work was unbounded.** The crossing budget counted only *confirmed*
  intersections, so two meshes with heavily overlapping leaves and no intersections at all could run
  a multi-million-pair synchronous loop while never consuming the budget — directly contradicting
  this spec's own claim that the budgets bound the worst case. A raw-candidate budget with an abort
  protocol now backs that claim up.

### Round 9 (4 P1 — all confirmed valid)

Rounds 7–8 shipped the mode split and the surface-crossing witness, but four gaps survived past both:

- **`containment`'s constructed witness stepped off the surface it was supposed to stay on.**
  `ContainmentModeQuery` reused `anyComponentInside` verbatim, including its stage-3 constructed
  interior witness — a point deliberately built inside the *source's own volume*, which is exactly
  what the mode's surface-only contract (see **Query modes**) says not to sample. Two coincident
  closed boxes are the counterexample: every source-surface point sits exactly on the target's
  boundary, so containment must read false, but the constructed witness lands inside both boxes and
  reads true. `containment` now uses `anyComponentInside`'s first two stages only — see **Query modes
  and their preconditions**.
- **`unverified-open-component` had no rule for which public operand it names.** `volume-overlap`
  evaluates containment in both directions (`anyComponentOf(A) inside B` and `anyComponentOf(B) inside
  A`), but the diagnostic was described only for an open **source** component deciding the first term.
  A closed public source containing an open-triangle public target decides via the second term, so the
  open component is the public *target* — a case the spec never named. `role` now follows the deciding
  term the same way `unverified-parity-operand`'s does.
- **`SurfaceCrossingWitness`'s probe ladder wasn't scaled to what it was probing.** It reused the
  canonical-frame `offsetLadder`, a length derived from the *pair's* bounding diagonal, with no
  relationship to the one source triangle it must stay inside. A small triangle on a geometry with a
  large overall diagonal can have every rung fall outside the triangle, rejecting every probe and
  silently resolving to "no witness." Probe distances are now derived from the triangle's own
  available in-plane width at the intersection segment, and a triangle too small for any valid offset
  is reported inconclusive rather than clean.
- **The one-frame budget bounded each stage, not the browser task built from them.** `volume-overlap`
  composes up to three independently-budgeted stages per candidate pair, and `findClashes` only
  yielded between *new* BLAS builds — not between those stages, and not between cache-warm pairs. A
  single negative pair, or a run of cached pairs, could still freeze the Viewer for several frames
  despite every individual budget being individually correct. A shared wall-clock checkpoint now
  governs yielding across the whole call — see **`CollisionWorld`**.

### Round 10 (3 Critical — all confirmed valid; 6 High deferred by explicit instruction)

A full re-review (not limited to round 9's own findings) found round 9's `frameBudgetMs` fix
incomplete, and surfaced two pre-existing gaps rounds 1–9 never reached: model-eviction race safety
and a missing runtime dependency in the vendor plan. All three are blockers, fixed here; the round's
six High findings (public API wording, cached-transform staleness, canonical-order determinism,
a diagnostic-mapping contradiction, invalid-dbId detection, and MEP-gate reproducibility) are recorded
in `review-comments-v10.md` and intentionally left for a later round.

- **`frameBudgetMs` bounded composition, not any one stage's own internal cost.** Round 9's checkpoint
  fires at pair and sub-query boundaries, but a single `ProperCrossingQuery` traversal rich in
  confirmed non-coplanar intersections (up to 64 pairs × 12 probes × 2 BVHs × up to 3 raycasts each) or
  a single 512-sample containment pass can itself run well past `frameBudgetMs` before returning to any
  boundary. `ProperCrossingQuery`'s `bvhcast` callback now also aborts on elapsed time, exactly like its
  existing count-based triggers; `ContainmentQuery`'s plain-JS sampling loops now genuinely yield and
  resume every `deadlineCheckInterval` samples instead of only aborting, since — unlike a native
  traversal — they can pause without losing progress. See the "Abort protocol" note under
  **`ProperCrossingQuery`** and the "Intra-loop checkpoint" note under **`ContainmentQuery`**.
- **`world.evictModel` dropped caches but specified no race-safety contract for work already in
  flight.** Nothing prevented a suspended `findClashes` call from resuming into a model that had been
  evicted while it was yielded, and the "listens for the Viewer's model-removal notification" text
  never named which of three plausible events that was. Fixed by choosing
  `Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT` explicitly, adding a per-model generation counter that
  every yield point — coarse and intra-stage alike — re-validates before touching cached state, and
  rejecting the whole call with a new `ModelEvictedError` on a stale generation rather than returning a
  result built on it. The room-search promise cache gets the same treatment: a rejected search is
  removed rather than replayed forever, and a late-completing search checks its own cache slot's
  identity before writing, so it can't resurrect an entry for a model that's already gone. See
  **`world.evictModel`**'s race-safety note and **Data Flow** step 1.
- **The mandatory weld step cited a file the vendor plan never copied.** `mergeVertices` lives in
  `three/examples/jsm/utils/BufferGeometryUtils.js`, not under the `three/build/**` /
  `three-mesh-bvh/src/**` the vendor tree specified — a 404 on first load, before any query could run.
  Fixed by vendoring that one self-contained file verbatim (it imports only bare `three`, calling
  nothing else in its own module) rather than hand-porting the algorithm, which would have needed its
  own re-verification against the tolerance analysis this spec already did on the real upstream source.
  See the "Welding's own vendor entry" note under **Architecture**.

### Round 11 (1 Critical — confirmed and fixed; 9 High deferred by explicit instruction, one of which
was a genuine bug in round 10's own fix and got fixed anyway)

A second full re-review found round 10's `frameBudgetMs` fix checked at the wrong granularity, and
separately caught a real ABA race in round 10's own eviction fix — accepted and fixed even though filed
as High, since it defeats the correctness property Critical #2 was built to establish. The round's other
8 High findings are recorded in `review-comments-v11.md` and intentionally left for a later round, per
explicit instruction.

- **The frame-budget checkpoint fired once per callback/batch, not once per atomic operation — so a
  single confirmed pair's 12-probe classification, or a single batch of 256 `classifyPoint` calls,
  could still run unchecked past `frameBudgetMs` before the next checkpoint had a chance to fire.**
  `ProperCrossingQuery`'s time-based abort now checks before each individual probe rather than once per
  `intersectsTriangles` invocation; `ContainmentQuery`'s sampling loops now check before each individual
  `classifyPoint` call rather than every `deadlineCheckInterval = 256` samples. This also forced an
  honest reframing of the "no synchronous step exceeds ~16ms" principle itself: a `MeshBVH` build is
  *already* a single non-preemptible atomic operation measured at ~16ms — a full frame on its own — so
  no sub-frame guarantee can hold for every synchronous span regardless of checkpoint placement. The
  spec now states two tiers explicitly (a per-atomic-operation ceiling, and the cooperative-composition
  ceiling `frameBudgetMs` actually bounds) and requires the performance gate to measure a single
  `classifyPoint`/probe's own cost, not just assume it's negligible. See the "Atomic operations and
  what remains non-preemptible" note under **`ProperCrossingQuery`**'s budgets.
- **Round 10's per-`modelId` generation counter reintroduced an ABA race on model-id reuse.** Deleting a
  `modelId`'s counter on eviction and letting a later reload restart it from the same initial value
  means a suspended query's captured "old" value can coincidentally equal a reloaded model's "fresh"
  value — the exact class of bug the mechanism existed to prevent. Replaced with a single
  `nextLoadEpoch` counter, global to the `CollisionWorld` instance and never scoped to or reset per
  `modelId`, so no two model loads can ever be stamped with the same epoch. See the "Race safety" note
  under **`world.evictModel`**.
- Reconciled a stale Risks entry that still called the unload event name itself unverified after round
  10's normative text had already selected `BEFORE_MODEL_UNLOAD_EVENT` — what remains genuinely
  unverified is narrower (the event payload's exact shape, since the installed typings type it as
  `any`), and the Risks entry now says that instead.

### Round 12 (1 Critical — confirmed and fixed; the same 9 High findings persist, deferred by explicit
instruction)

A third full re-review found round 11's `modelId`-keyed load epoch still left evicted models
resurrectable through a specific path round 9–11 hadn't covered: in-flight async work that completes
*after* eviction but was never itself yielded inside `findClashes`. Fixed by moving liveness identity
off `modelId` entirely and onto the exact `Model` object.

- **A late-completing room search could hand stale room dbIds to its original caller, which could then
  enter `findClashes` with an evicted model — the round-10/11 cache-write guard only ever protected the
  cache, not the caller.** `model.search`'s callback now checks `world.isModelLive(model)` before
  resolving anything; on a stale completion it rejects the *original* `locateElementByRoom` promise with
  `ModelEvictedError` instead of silently discarding a cache write while leaving that promise resolved
  (or, worse, permanently unsettled). See the "A `model.search` callback..." note under **Data Flow**
  step 1.
- **`findClashes` had no entry-point check at all — only the per-yield re-validation added in rounds
  9–11 — so a call that used an already-evicted `Model` object and happened to never yield (every needed
  BLAS already cached, or a query small enough to complete synchronously) could run to completion
  against dead geometry undetected.** `findClashes` now validates liveness for both operand models
  before doing anything else, in addition to (not instead of) the existing per-yield checks.
- **The underlying identity was keyed by `modelId` (a number) and *deleted* rather than tombstoned on
  eviction, so nothing distinguished "this exact object was evicted" from "nothing has loaded under
  this id yet."** Replaced with `modelLifecycle: WeakMap<Model, {epoch, state}>`, keyed by object
  identity and never deleted — only ever transitioned `'live' → 'evicted'`, permanently. `modelId` is
  now used only for the pre-existing BLAS/geometry cache keys and for `evictModel`'s bookkeeping of
  "which object is currently live for this id," not for liveness itself.
- **`world.dispose()` was described as evicting every model but had no stated terminal contract of its
  own** — a second call, or any other public method called after disposal, had undefined behavior.
  `dispose()` now sets a world-level terminal flag, checked ahead of any per-model state by every public
  method, which reject/throw `WorldDisposedError` (distinct from `ModelEvictedError`) once set. *(This
  entry's "every public method" was accurate at round 12 but is superseded by round 18, which added
  `evictModel` as a second deliberate non-throwing exception alongside `isLeaseValid` — see
  `world.dispose()`'s own pseudocode for the current, canonical two-exception statement.)*
- `world.evictModel`'s signature changed from `(modelId)` to `(model)` — the exact object — and a new
  minimal read-only accessor, `world.isModelLive(model)`, was added; both are what the room-search fix
  above needed and nothing beyond it. See **`world.evictModel`** for the full mechanism and
  **`RoomLocatorExtension`**'s class sketch for the updated unload-handler call site.

### Round 13 (1 Critical — confirmed and fixed, a regression introduced by the round-12 fix itself; the
same 9 High findings persist plus one new High, all deferred by explicit instruction)

A fourth full re-review found round 12's own fix broke the ordinary, common-case path it was meant to
protect, and separately surfaced a second, related gap in `evictModel`'s cleanup that the fixture set
hadn't exercised.

- **A model's first-ever room search always rejected with a spurious `ModelEvictedError`, because
  `world.isModelLive(model)` is defined to return `false` for a model that has never been admitted —
  and room discovery always runs before the first `findClashes` call, so no model had ever been admitted
  the first time its room search resolved.** This broke the room-locator's primary workflow outright,
  not an edge case. Fixed by decoupling "admit" from "the first thing that happens to touch this model":
  `world.admitModel(model)` is now a public, synchronous, idempotent operation returning a `ModelLease`;
  the room-search cache calls it *before* starting `model.search`, so the search's callbacks always
  validate a real, previously-captured lease (`world.isLeaseValid(lease)`) instead of inspecting
  `isModelLive`'s ambiguous "never seen" state after the fact. `isModelLive` itself is unchanged and
  still correct for general liveness queries; it is simply no longer the room-search guard. See
  **`world.admitModel`** and the "A `model.search` callback..." note under **Data Flow** step 1.
- **`evictModel`'s model.id-scoped cache/BLAS/geometry drop was unconditional, which meant a stale or
  duplicate eviction call for an old, already-superseded `Model` object could wipe a *different*, still-
  live object's state if both objects shared the same numeric `model.id`.** Every prior round's fixtures
  called `evictModel` exactly once, promptly, for the model actually occupying its id slot, so this
  never surfaced. Fixed by gating the id-scoped drop on `liveModelByModelId.get(model.id) === model` —
  the object being evicted must still be the current occupant of that id slot for its id-scoped state to
  be touched; the object-identity tombstone itself (always safe) is unconditional as before. See
  **`world.evictModel`**'s occupancy-guard note.
- Codex separately flagged, as a new High rather than part of the Critical, that post-weld degenerate
  (zero-area/collapsed) triangles are unaddressed for their effect on normals, manifold classification,
  and BVH behavior — deferred with the other 9 stable High findings per explicit instruction.

### Round 14 (2 Critical — confirmed and fixed, both self-inflicted gaps in the round-13 fix; the same
10 High findings persist, deferred by explicit instruction)

A fifth full re-review found the round-13 fix closed the room-search resurrection path but left two
other gaps: one it never touched (model-owned caches were still keyed by reusable `modelId`, never
addressed by any round's eviction-side fix), and one it introduced directly (a self-contradiction
between `isLeaseValid`'s own doc comment and `dispose()`'s method list).

- **Model-owned collision state — `GeometryRegistry`, `BlasCache`, `GeometryConnectivity` — was keyed
  by `(modelId, geometryIndex)`, a plain reusable number, even after `modelLifecycle` moved to object
  identity three rounds earlier.** A different `Model` object admitted under a reused `modelId` before
  the old object's own (possibly delayed) eviction ran could have its first geometry lookup silently
  find and reuse the old object's cached `GeometryRecord`/BLAS — a failure mode round 13's eviction-side
  occupancy guard could not touch, because nothing about eviction is involved: the bug happens at
  *admission*, while the old object is still nominally live. Root-cause fixed, not patched again: geometry
  identity is now keyed by `(loadEpoch, geometryIndex)` — the admitted object's own globally-unique,
  never-reused epoch — so two objects sharing a `modelId` are structurally guaranteed disjoint cache
  namespaces regardless of eviction timing. This also let round 13's `evictModel` occupancy guard on
  `liveModelByModelId` be demoted from a correctness requirement to what it always should have been —
  bookkeeping hygiene for `dispose()`'s enumeration sweep. See **`GeometryRegistry`**, the "Geometry
  dedup key" note under **`ViewerModelAdapter`**, and "Race safety" under **`world.evictModel`**.
- **`world.isLeaseValid`'s own doc comment ("does not throw on a disposed world") directly contradicted
  `world.dispose()`'s method list, which named `isLeaseValid` among the methods that throw
  `WorldDisposedError` after disposal** — a self-inflicted round-13 authoring error, not a design flaw
  either side got right. Resolved by making `isLeaseValid` the one deliberate, documented exception to
  "every public method throws once disposed": it stays strictly non-throwing and boolean always, and
  `dispose()`'s method list now says so explicitly instead of listing it alongside the throwing methods.
  *(This entry's "the one... exception" was accurate at round 14 but is superseded by round 18, which
  added `evictModel` as a second deliberate non-throwing exception — see `world.dispose()`'s own
  pseudocode for the current, canonical two-exception statement.)*
  A caller needing the specific reason a lease is invalid (evicted vs. disposed) calls `isModelLive`
  (unchanged, still throws `WorldDisposedError`) separately for that distinction. See
  **`world.isLeaseValid`** and **`world.dispose`**.

### Round 15 (3 Critical — confirmed and fixed; the same 10 High findings persist, deferred by explicit
instruction; the user asked this round's fixes to treat the lifecycle and preprocessing-budget
invariants as systems, not only patch the reported diff)

A sixth full re-review found round 14's fixes didn't fully close the lifecycle system they touched, and
separately found the frame-budget bound had a coverage gap no prior round had measured or checkpointed
at all — the round-9-through-11 scheduling work only ever named `MeshBVH` construction as a
non-preemptible atomic operation, never welding or connectivity, and a local measurement showed both can
individually cost as much or more.

- **`world.dispose()`'s per-model tombstone sweep cannot enumerate every live model when a `modelId` has
  been reused while its old occupant is still live** — exactly the state round 14's own epoch-keying fix
  made supported and tested. `modelLifecycle` is a `WeakMap` (deliberately non-enumerable); the only
  enumerable proxy, `liveModelByModelId`, holds one object per numeric id, so it can reach at most one of
  two simultaneously-live objects sharing an id. **Fixed at the root, not by trying to make the sweep
  complete**: `disposed` is now checked directly and first at every liveness site — `findClashes`'s
  entry (already true), every per-yield checkpoint (round 15 added this), `isLeaseValid`, `isModelLive`
  — instead of being inferred from whether a given model's own tombstone happened to get set. `dispose()`
  no longer needs to enumerate-and-tombstone every live model for correctness; it wholesale-clears
  `GeometryRegistry`/`BlasCache`/`GeometryConnectivity` instead of sweeping per model, and
  `liveModelByModelId` is now purely diagnostic bookkeeping, load-bearing for nothing. See "Race safety"
  under **`world.evictModel`** and **`world.isLeaseValid`**/**`world.isModelLive`**/**`world.dispose`**.
- **Evicting a `Model` object this world never admitted had no defined tombstone shape** —
  `BEFORE_MODEL_UNLOAD_EVENT` can fire for a model that was loaded but never touched `findClashes`/
  room-search, and the single-shape `{epoch, state}` value type never said what epoch such an entry
  should carry. Fixed by changing `modelLifecycle`'s value type to a two-variant discriminated union,
  `{state: 'live', epoch: number} | {state: 'evicted'}` — the evicted variant carries no epoch at all,
  since every check short-circuits on `state !== 'live'` before it would ever need one. `evictModel` now
  unconditionally writes `{state: 'evicted'}` regardless of whether a prior entry existed, releasing
  epoch-scoped cache state only when a prior `'live'` entry actually had one. See **`world.evictModel`**.
- **The frame-budget bound only ever named `MeshBVH` construction as a non-preemptible atomic
  operation.** A local measurement found welding costs ~16.8ms and connectivity construction ~6.9ms at
  ~19,800 triangles — before BVH construction even starts — so the true worst-case cost of a first
  `GeometryRecord` build was roughly 2–3× what the BVH-only framing implied, with no checkpoint of its
  own for either phase. Recursive per-dbId extraction and the broad-phase `O(sourceCount×targetCount)`
  scan had no checkpoint or size ceiling at all. Fixed by treating welding, connectivity, and BVH
  construction as three separately-checkpointed atomic phases (connectivity remains independently lazy);
  revising `maxSyncTriangleCount` down to a reasoned, provisional `12_000` pending re-measurement of all
  three phases; and adding two new reasoned, provisional ceilings — `maxFragmentsPerDbId` and
  `maxBroadPhaseInstancePairs` — that reject the whole `findClashes` call up front rather than leaving
  extraction and the broad-phase scan unbounded. See **`ThreeMeshBvhBackend`/`BlasCache`**, the
  atomic-operations table under **`ProperCrossingQuery`**'s budgets, and **Data Flow** step 3.

### Round 16 (3 Critical — confirmed and fixed, 2 self-inflicted gaps in the round-15 fix, 1 new; the
same 10 High findings persist, deferred by explicit instruction; fixes reviewed as one invariant —
Viewer geometry → active-range compaction → size gate → weld → connectivity when required → BVH — per
explicit instruction, not only patched against the reported diff)

A seventh full re-review found two of round 15's own three fixes were themselves incomplete or wrong,
and surfaced one new gap in how `maxSyncTriangleCount` related to active-range normalization — all three
in the same extraction/build pipeline round 15 had just touched.

- **`volume-overlap` also requires connectivity, and round 15's own wording — plus a regression fixture
  it shipped — said the opposite.** `VolumeOverlapQuery` composes `anyComponentInside` through its own
  containment term (run after `ProperCrossingQuery` returns false), and `anyComponentInside` samples per
  connected component regardless of which public mode is asking, independent of either mode's stage-3
  usage. *(This entry originally went on to attribute stage 3 between the two modes here; that
  attribution was backwards — see the note after stage 3 under `anyComponentInside` for the correct,
  canonical statement of which mode runs it. The connectivity finding above is unaffected.)* Only
  `surface-intersection` is genuinely connectivity-free. Fixed by correcting the dependency description
  under **`ThreeMeshBvhBackend`/`BlasCache`** and the atomic-operations table, and replacing the wrong
  round-15 fixture (which asserted *no* connectivity checkpoint for `volume-overlap`) with one asserting
  it fires for `volume-overlap` and is absent only for `surface-intersection`.
- **`maxFragmentsPerDbId` was checked only after the unbounded operation it claimed to bound.** Round 15
  added the ceiling but kept the single recursive `enumNodeFragments(dbId, cb, true)` call underneath it
  — a 100,000-fragment subtree still enumerates all 100,000, synchronously, before that after-the-fact
  check ever runs. Fixed by replacing the recursive call with a self-driven, abortable walk using
  `InstanceTree`'s non-recursive primitives (`enumNodeChildren`/`getChildCount`/non-recursive
  `enumNodeFragments`, confirmed present in the installed typings) — the walk stops the moment its
  running tally crosses the ceiling, rather than after full enumeration, and checkpoints against
  `frameBudgetMs` between sibling nodes as a composition safeguard on top of the hard bound. *(This
  primitive list named `getChildCount` as part of round 16's walk; a later invariant-audit fix, C-1,
  found it unsound as a fanout preflight and removed it from the walk entirely — see the canonical
  statement under* **Components** *that `getChildCount` is not one of the walk's primitives.)* See **Data
  Flow** step 3.
- **`maxSyncTriangleCount` was never defined against a specific triangle set, and the raw geometry —
  not the normalized active ranges — was what welding actually walked.** A fragment with a huge total
  index but a tiny active draw range could pass an active-triangle ceiling check while `mergeVertices`
  still processed the full raw buffer underneath it. Fixed by inserting active-range compaction as a
  phase before the ceiling check and before welding: the active triangle count
  (`activeTriangleCount = Σ floor(ranges[].count / 3)` — the ranges' counts are index elements, not
  triangles — free to compute from already-normalized range metadata) gates first; only once that passes
  is a
  compacted, collision-owned position/index buffer materialized, bounded by the now-confirmed active
  count. Welding, connectivity, and BVH construction all run over this same compacted buffer — none ever
  sees an out-of-range triangle, which also retired the previous "set `groups`/`drawRange` on the BVH
  input" workaround as unnecessary. See **`ThreeMeshBvhBackend`/`BlasCache`**.

### Round 17 (1 Critical — round 16's own extraction fix still claimed an unverified bound; fixed by
narrowing the claim honestly rather than inventing a mechanism the API doesn't have; 1 directly related
stale-wording fix in the performance gate)

- **`maxFragmentsPerDbId` was still described as bounding a single node's own `enumNodeFragments` call,
  and it doesn't.** Round 16's node-by-node walk correctly stops *between* nodes once the running tally
  crosses the ceiling — but each node's own `enumNodeFragments(node, cb, /* recursive */ false)` call is
  one opaque native call, and a single pathological node that directly owns, say, 100,000 fragments still
  enumerates all of them synchronously before that node's contribution to the tally is even known. This is
  the same class of bug round 16 fixed, one level down: round 15 bounded "the whole subtree" only after
  the fact; round 16 bounded that down to "one node's contribution" only after the fact. Verified this
  round, via the `aps-viewer-implementation-research` skill against the official Reference Guide (not
  typings alone, per instruction) — `getChildCount(dbId)`/`getChildCount(node)` is documented on both the
  deprecated `InstanceTree` class and its replacement `Autodesk.Viewing.ObjectTree` as "Get number of
  children under the specified id," returned without enumerating those children. **No equivalent exists
  for fragments on either class.** `ObjectTree`'s documented enumeration method isn't even named
  `enumNodeFragments` — it's `enumNodeInstances(node, callback, recursive)` — and neither its
  documentation nor `InstanceTree`'s describes any way to learn a node's direct fragment/instance count
  without enumerating them. Per the standing instruction from the round-16 fix ("if no such mechanism
  exists, narrow the Milestone-1 contract honestly rather than inventing an unenforceable hard bound"),
  the fix narrows rather than invents:
  - `getChildCount(node)` (verified, both classes) is now the explicit, normative preflight before every
    `enumNodeChildren` call — not merely "useful where cheap" as round 16's wording had it — since it *is*
    a verified O(1)-shaped check the walk can and should perform before fanning out. *(Superseded: a later
    invariant-audit fix, C-1, found `getChildCount` is O(1) only for a fragment-free node and linearly
    scans the same slots `enumNodeChildren` walks for a mixed one, making it strictly worse than the call
    it was meant to gate — it was removed from the enforcement path entirely. See the
    `maxChildrenPerNode` row in the atomic-operations table and* **Components** *for the current, sole
    enforcement mechanism.)*
  - `maxFragmentsPerDbId` and the self-driven walk are re-described for what they actually bound: **total
    work across the walk, via early termination between nodes** — not the cost of any single node's own
    `enumNodeFragments` call.
  - One non-recursive `enumNodeFragments(node, cb, false)` call is now named explicitly as an accepted,
    non-preemptible atomic risk for Milestone 1 — the same category `maxSyncTriangleCount`'s three phases
    already occupy, with no known preflight, added to the atomic-operations table and the performance gate
    so its real worst-case cost gets measured rather than assumed away.
  - Noted, not acted on (out of this fix's scope): the official Reference Guide documents `InstanceTree`
    itself as deprecated in favor of `ObjectTree`, which doesn't expose `enumNodeFragments` at all. The
    installed typings this spec was written against still define `InstanceTree`/`enumNodeFragments`, so
    the extraction contract keeps using them; the deprecation is recorded here as a fact to revisit at
    implementation time, not a reason to redesign extraction against `ObjectTree` now.
  See **Data Flow** step 3, the atomic-operations table under **`ProperCrossingQuery`**'s budgets,
  **Error Handling & Edge Cases**, and the performance gate.
- **Stale wording in the performance gate still said `volume-overlap` excludes connectivity**, left over
  from before round 16's fix to the opposite fact (both `containment` and `volume-overlap` require
  connectivity; only `surface-intersection` doesn't). Corrected the gate's cold-run-distinction bullet to
  match.

### Round 18 (5 Critical — invariant-audit-driven system fix pass, not a Codex review round; see Status
above and `invariant-audit-v1.md`/`invariant-audit-v2.md`)

An invariant-driven consistency audit — one agent built a consolidated cross-system invariant model of
lifecycle, geometry ownership/build, query dependencies, sync-work budget, and cache ownership, then five
parallel agents audited the full post-round-17 spec against it — found 5 Critical contradictions no
single-pass Codex review had caught, because each pair of contradicting statements individually read as
correct in isolation. This pass fixed all 5, plus four directly-connected High findings, in three
system-level clusters (each drafted by a dedicated agent, applied and hand-merged by the coordinating
session where two clusters touched the same doc block):

- **Lifecycle/teardown (C1, C2, H-L5, H-L6).** C1: the "Disposal mid-query" paragraph still described
  pre-round-15 mechanics (`dispose()` tombstoning every model, a resumed query rejecting
  `ModelEvictedError`); rewritten to match round 15's actual mechanism (`disposed` set first,
  `WorldDisposedError` on resume). C2: `evictModel`'s own contract was silent on disposal while two other
  passages said it throws `WorldDisposedError` after disposal — verified against the pinned 7.124.2
  bundle that a throw there is uncaught inside the Viewer's own `BEFORE_MODEL_UNLOAD_EVENT` dispatch and
  aborts `unloadCurrentModel`'s teardown loop for every remaining model; fixed by making `evictModel` a
  second deliberate non-throwing exception (`isLeaseValid` was the first), a no-op on a disposed world.
  H-L5: `locateElementByRoom`'s two incompatible disposed-vs-evicted error mappings reconciled to one —
  the callback now derives the cause via `isModelLive` inside a `try`/`catch`. H-L6: `ContainmentQuery`'s
  local checkpoint wording restored to the universal `disposed`-first, then-epoch two-part protocol.
- **Geometry build / cache publication (C3, H-G1).** C3: the "publish only once every phase completes"
  rule was mutually exclusive with `BlasCache`'s claimed concurrent-build dedup and with `evictModel`/
  `dispose()`'s promise that "every in-flight build promise" is enumerable and rejectable. Fixed at the
  ownership-model level: a `GeometryRecord` is now published (`buildState: 'building'`) when its build
  *starts*, with one single-flight promise slot per phase (weld, connectivity, BVH); concurrent callers
  share the same entry instead of racing to build; `'ready'` (weld+BVH resolved) is mode-independent, and
  `containment`/`volume-overlap` separately await connectivity on the same entry, consistent with
  `surface-intersection` never needing it; a rejected phase removes the entry synchronously so no
  half-built record is ever observable. H-G1: `TriangleRange.count` was an unlabelled index-element count
  compared directly against `maxSyncTriangleCount` (a triangle count) with no `/3` conversion anywhere in
  the file — verified against `spike/measure.mjs`/`spike/geometry-core.mjs`, which do use `index.count/3`
  — fixed by defining `activeTriangleCount := Σ floor(ranges[i].count / 3)` and using it at every
  comparison site.
- **Extraction (C4, C5, H-B1, H-B2).** C4: `ViewerModelAdapter`'s own component contract still specified
  the recursive `enumNodeFragments(dbId, cb, true)` call rounds 16–17 declared Critical and removed
  elsewhere; replaced with the self-driven walk, plus an explicit argument (verified against the pinned
  bundle's `enumNodeInstances` implementation) for why the walk's per-node union is coverage-equivalent to
  the recursive form, conditioned on the walk completing without truncation and on a complete instance
  tree. C5: round 17's `getChildCount` preflight was credited with catching a pathological fanout but
  compared its result to nothing; fixed with a provisional `maxChildrenPerNode = 10_000`, enforced by an
  in-callback abort inside `enumNodeChildren` — re-verifying the pinned 7.124.2 bundle and the official
  Reference Guide for this fix found that round 17's own justification for *not* bounding one node's
  `enumNodeFragments` call was factually wrong (`ObjectTree.getInstanceCount`/`getFragmentCount` and a
  documented truthy-return enumeration interrupt both exist); the atomic-risk classification is retained
  as an explicit scope decision, flagged for a follow-up pass, not re-derived here. H-B1: the broad-phase
  `maxBroadPhaseInstancePairs = 1_000_000` ceiling bought ~1,000ms of uninterruptible work (~60× the
  gate's ~16ms criterion) with no inner checkpoint; fixed by chunking the scan with a per-pair
  `frameBudgetMs` checkpoint (round 11's granularity, not batched), rather than only shrinking the
  constant. H-B2: round 17's worst-case-span formula was restated as bounding only the ceilinged,
  cooperative-composition tier, explicitly excluding the accepted-unbounded `enumNodeFragments` atomic
  risk it had silently ranged over.

One node's direct `enumNodeFragments(node, cb, false)` call remains, unchanged, the accepted
non-preemptible atomic risk round 17 established. No new architecture was introduced beyond what these
five invariants required; several adjacent High/Medium/Low findings from `invariant-audit-v1.md` (M1's
connectivity eager/lazy question, H-L1–H-L4, H-G2–H-G4, H-Q1–H-Q2, H-B3–H-B4, H-C1, and the Medium/Low
list) were deliberately left untouched, per instruction, and are carried forward to
`invariant-audit-v2.md`.

### Round 19 (4 Critical — invariant-audit-driven, Critical-only fix pass, not a Codex review round; see
`invariant-audit-v2.md` and `round-19-critical-fix-pass-disposition.md`)

A second invariant-driven consistency audit, built fresh from the post-Round-18 text (not reused from
`invariant-audit-v1.md`, to avoid falsely flagging Round 18's own fixes as new deviations), found 4
Critical contradictions — two of them Round 18's own two flagship mechanisms reproducing the exact
"claimed vs. earned" defect pattern this audit lineage exists to catch, one call/one state-transition
deeper than the instance that pattern previously took three rounds to close. This pass fixed all four,
each independently re-verified (including two source-level re-checks against the pinned 7.124.2 bundle
and two independent `codex-advisor` consults) before being applied, and touched nothing else:

- **C-1 (extraction fanout enforcement).** Round 18's two-layer `maxChildrenPerNode` mechanism credited
  `getChildCount(node)` as a cheap early-reject layer ahead of the in-callback abort. Direct inspection of
  the pinned 7.124.2 bundle's `getNumChildren`/`enumNodeChildren` implementations found `getChildCount` is
  O(1) only for a fragment-free node; for a node that owns fragments (the ordinary "mixed" case) it
  linearly scans the identical `children[]` slots `enumNodeChildren` walks, with no early-exit hook of its
  own — strictly worse than the bounded call it was meant to gate. No public API (`getInstanceCount`/
  `getFragmentCount` included) offers an O(1) way to detect "is this node mixed" in advance. Fixed by
  removing `getChildCount` from the enforcement path entirely: the in-callback abort inside non-recursive
  `enumNodeChildren(node, cb, false)` is now the sole `maxChildrenPerNode` enforcement mechanism, for every
  node shape alike, capping any single call at `maxChildrenPerNode + 1` callbacks with no distinction in
  the enforcement logic between a fragment-free and a mixed node.
- **C-2 (`GeometryRecord` cancellation ownership).** Round 18's entry-scoped cancellation signal — the
  mechanism letting `evictModel`/`dispose()` find and reject in-flight builds — was scoped to `'building'`
  entries at every normative site, but Round 18's own `'ready'` semantics allow a record to reach
  `buildState: 'ready'` (weld+BVH resolved) while its connectivity slot is still unresolved, built lazily
  on demand by a later caller against that same entry. Both release paths' sweep text said they walk every
  entry regardless of build state, but only settled the cancellation signal for `'building'` ones — so a
  `'ready'` entry's in-flight connectivity build could have its registry entry deleted without its promise
  ever being rejected, reproducing the exact "clearing a map does not by itself settle a pending promise"
  failure the whole mechanism exists to close. Fixed by making the cancellation signal entry-lifetime-
  scoped rather than `buildState`-scoped: created once at entry insertion, unchanged across
  `'building' → 'ready'`, raced by every phase slot the entry ever hosts including a later lazy
  connectivity build, and settled unconditionally by both release paths regardless of the entry's current
  build state, in the same operation that removes the entry. Two new fixtures pin eviction and disposal
  while lazy connectivity is suspended on an otherwise-`'ready'` entry.
- **C-3 (`anyComponentInside` stage-scoping wording).** Two passages (one in Components, one a Round-16
  Revision Notes entry) predating Round 18 stated `volume-overlap` skips `anyComponentInside`'s stage 3
  and, by contrast, that `containment` runs it — the exact inverse of the rule established everywhere else
  in the document, including the algorithm section itself and Round 9's own fix. Fixed by removing the
  stage-attribution claim from both passages rather than re-deriving it a third/fourth place where it had
  already silently drifted twice; both now cross-reference the algorithm section as the single source of
  truth, with the historical Revision Notes entry annotated (not rewritten) to flag the superseded
  attribution, matching this document's existing pattern for correcting stale changelog claims.
- **C-4 (room-cache rejection semantics).** One passage said every room-search rejection deletes its cache
  entry unconditionally; the invalid-lease branch (and its extension to the error callback) said the
  opposite — "leave the cache untouched" — with a fixture pinning the untouched side for exactly the input
  (a lease-invalidity rejection) the unconditional rule also covered. Fixed by unifying to one rule: every
  rejection path applies an identity-guarded delete (`if (roomCache.get(model) === thisPromise)
  roomCache.delete(model)`), removing the "leave untouched" exception entirely; the fixture now pins
  deletion instead of untouched.

No other High/Medium/Low finding from `invariant-audit-v2.md` was touched, per instruction — including
`tearDown()`/`keepCurrentModels`, `SurfaceCrossingWitness`'s scheduling ambiguity, the compaction/gate
ordering transposition, `referenceCount`, and the `>=`/`>` boundary wording. See
`round-19-critical-fix-pass-disposition.md` for the fuller working record, and `invariant-audit-v3.md` for
the follow-up audit against this pass's own text.

### Round 21 (0 Critical — High-only invariant cleanup pass, not a Codex review round; see
`invariant-audit-v4.md` and `round-21-high-only-fix-pass-disposition.md`)

Round 20 (undocumented here — see `round-20-critical-fix-pass-disposition.md`) closed C-5, the last
Critical this audit lineage has found in two consecutive rounds. This pass fixed the confirmed-open High
findings from `invariant-audit-v4.md`, grouped by system, without reopening any of the six now-stabilized
Critical invariants (Model-object identity/`loadEpoch`, disposed-first checkpoint semantics,
`GeometryRecord` cancellation ownership, active-range gating/compaction/weld/connectivity/BVH ownership,
extraction's atomic-risk boundaries, the mode dependency matrix):

- **Lifecycle (H-L1/H-L2, H-L4, H-L7, H-L8).** Corrected a mischaracterization from this pass's own first
  draft, caught by `codex-advisor`: the extension does not get silently reconstructed after a model
  switch under this app's current wiring — it is unloaded once, permanently, since extensions are
  registered only once in `config.extensions` at `viewer.start()`. Documented that gap explicitly, scoped
  the `modelLifecycle`/`loadEpoch` identity apparatus to "while one instance is alive" (its actual,
  still-Critical-protected role), and narrowed the stale "every race-safety guarantee depends on the
  event firing" Open Question to exclude the `tearDown()`-driven path. Stated `load()`'s
  await/registration-ordering contract. Annotated two stale Revision Notes entries (rounds 12/14)
  describing a since-superseded single-exception disposal rule, matching the doc's existing
  superseded-annotation convention. Completed `unload()`'s ordering note with the second throw hazard —
  a repeated `dispose()` call — it previously omitted. The v5 follow-up audit found the ordering claim
  underlying the `tearDown()`-path paragraph (that the extension-unload loop completes before
  `BEFORE_MODEL_UNLOAD_EVENT` fires) had shipped uncited, unlike every neighboring Viewer claim in the
  same paragraph; verified against the pinned 7.124.2 bundle and cited (`viewer3D.js:26541-26560`,
  `:26583`, `:34052`, `:34054`) — true, undocumented internal ordering, not a public API guarantee.
- **Query semantics (H-Q1, H-Q2, H-Q4, H-B4, and the Public API "certified closed" wording deferred since
  Round 19).** Corrected `anyComponentInside`'s caller list at its two stale restatement sites (one
  omitted `ContainmentModeQuery`, one falsely claimed universal use). Restated the containment
  guarantee's precondition as the logical fact each mode independently establishes, rather than naming
  only `VolumeOverlapQuery`'s mechanism as if it were universal. Stated why `containment`'s connectivity
  gate also builds the target's connectivity record, not only the operand(s) `anyComponentInside`
  samples. Resolved `SurfaceCrossingWitness`'s scheduling-class contradiction — a first draft wrongly
  picked the plain-JS-loop side; the required v5 follow-up audit, backed by the executable spike
  (`spike/geometry-core.mjs`'s `surfaceCrossingInside` and `spike/fixtures.mjs`'s own "THIRD traversal"
  fixture), found it is in fact its own `bvhcast`-native traversal, non-resumable like
  `ProperCrossingQuery`'s and checkpointed the same way — corrected accordingly, along with the "all
  three are plain JS loops" statement it had wrongly extended to cover it. Rewrote the Public API's
  `volume-overlap`/`containment` mode comments from a hard
  "Requires... certified closed" precondition to the actual contract: soundest when certified closed,
  degrading gracefully via `unverified-parity-operand`/`unverified-open-component` diagnostics otherwise
  — matching the mechanism established at "The containment guarantee, and its preconditions" and the
  fixture at "asserted for direction."
- **Synchronous-work / budget model (H-B5 through H-B9, and the `getChildCount` changelog residue
  deferred since Round 19).** Annotated the two stale Round-16/17 Revision Notes entries asserting
  `getChildCount` is still a normative fanout preflight, matching the doc's existing superseded-annotation
  convention (the primitive was removed from the enforcement path by Round 19's C-1). Named the
  broad-phase scan's own per-pair checkpoint in the canonical checkpoint enumeration. Resolved `bvhcast`'s
  time-based-abort clock-basis ambiguity (H-B7) in favor of a private, traversal-local clock, explicitly
  named as the deliberate exception to every other checkpoint's shared-accumulator convention — a first
  draft of this fix chose the shared accumulator instead, which the required v5 follow-up audit found
  makes a `bvhcast` traversal's permanent, result-altering abort depend on scheduling position rather than
  the traversal's own cost (since `bvhcast` cannot yield-and-resume the way every other checkpoint can);
  reverted to the private clock, whose own worst case sits within, not beyond, the performance gate's
  ~16ms tolerance band. Classified
  `releaseEpochScopedState`/`dispose()`'s per-epoch registry sweep in the atomic-operations table for the
  first time — as a second accepted, unmeasured non-preemptible atomic risk alongside
  `enumNodeFragments` — and threaded that classification through the worst-case-span formula's exclusion
  list, the performance gate's pass criterion, and a new gate measurement bullet. Gave the two dangling
  "(see Risks)" instance-tree-readiness forward references a real target: an honest, non-invented
  statement that instance-tree completeness at extraction time is unverified and deferred to
  implementation.
- **Cache ownership (H-2/H-3).** Declared the previously-undocumented `CollisionInstance` cache — keyed
  per `(loadEpoch, fragmentId)`, mirroring `GeometryRegistry`'s epoch-based keying. A first draft
  threaded its release subordinate to `GeometryRegistry`'s own sweep and made it cross-call-mutable;
  the required v5 follow-up audit (two independent auditors, converged) found this both leaked most of
  the cache on `evictModel` (its keyspace is a strict superset of the registry's) and broke the
  per-call transform-snapshot guarantee under concurrent `findClashes` calls. Redesigned: the cached
  `CollisionInstance` is now a frozen, transform-free identity object (`fragmentId` +
  `GeometryIdentity`), released as its own independent epoch-scoped sweep in both `evictModel` and
  `dispose()`, exactly matching the pre-existing stale-eviction fixture's "same object references, no
  rebuild triggered" requirement; per-call world-matrix/world-bounds state moved to a new call-local
  `PlacedCollisionInstance`, never cached, never mutated on the shared object — eliminating the
  concurrency hazard structurally rather than by documentation. Added an explicit
  `maxCollisionInstancesPerEpoch` capacity check, since strict cross-call reference stability rules out
  individual-entry eviction as a way to bound retained memory.

Deliberately not touched: M-Q2/M-Q3 and the v2 audit-record gap note about them (left unresolved, flagged
only); the two Round-20 wording Mediums (byte-identical); every other Medium/Low finding from
`invariant-audit-v4.md`. See `round-21-high-only-fix-pass-disposition.md` for the fuller working record
and `invariant-audit-v5.md` for the follow-up audit against this pass's own text.

### Round 22 (0 Critical, 1 High — invariant-audit-driven, single-finding re-derivation pass, not a Codex
review round; closes `invariant-audit-v5.md`'s deferred H2)

`invariant-audit-v5.md` found the worst-case-synchronous-span formula unsound: it computed a build
phase's contribution as `max(frameBudgetMs + one small op, one build-phase's own cost)`, silently
treating the checkpoint before a build phase as an unconditional yield, when every checkpoint in this
design — `bvhcast`'s own private clock being the sole, already-documented exception — is the same
conditional, shared-`frameBudgetMs`-accumulator check: it yields only when the accumulator is already
due. A phase (or a `bvhcast` traversal) whose preceding checkpoint finds the accumulator not yet due
still runs to completion in the same span as whatever cooperative work already accumulated, adding its
own full non-preemptible/abort-only cost on top. Re-derived the formula as `frameBudgetMs + [that unit's
own worst-case cost]` — **≈24ms** at the measured weld figure or at `bvhcast`'s own self-bound
(~2×`frameBudgetMs`), not the ≈16ms this document stated through Round 21, a ~1.5× understatement.
Corrected the `ThreeMeshBvhBackend`/`BlasCache` per-phase-checkpoint claim, the
atomic-operations-and-composition section under `ProperCrossingQuery`'s budgets, and the performance
gate's pass-criterion tolerance to match; explicitly retained, unchanged, the pre-existing exclusion of
the two ceiling-less accepted atomic risks (one `enumNodeFragments` call, `releaseEpochScopedState`/
`dispose()`'s sweep) from any finite worst-case-span claim, since this design still cannot prove a global
bound. No behavior, fixture, query/lifecycle/cache/extraction mechanism, or other finding touched — see
`invariant-audit-v6.md` for the follow-up audit against this pass's own text.

## Spike Findings (executable, `spike/`)

After six review rounds, the remaining questions were ones no amount of reading could
settle. `spike/geometry-core.mjs` implements the primitives below against real
`three@0.185.1` / `three-mesh-bvh@0.9.14`; `spike/fixtures.mjs` runs every regression case the
review rounds produced, plus the round-7 mode-split and the round-8 surface-crossing and diagnostic-role rules (`node spike/fixtures.mjs` — 55/55 pass); `spike/measure.mjs` replaces the
guessed constants with measured ones. It found two defects that no review round caught, and settled
three open questions:

1. **Local-axis ray directions are pathological for BIM geometry.** The spec said "local +X first,
   local +Y on retry." A ray along a local axis from a symmetric point inside an axis-aligned box
   strikes the exact *centre* of a face — which is precisely where `BoxGeometry` splits its two
   triangles — so every hit grazes a diagonal, both retries graze, and the point returns `boundary`.
   The centre of a box classified as boundary. Axis-aligned boxes being most of what BIM contains,
   this would have failed pervasively and silently. **Fixed:** generic non-axis-aligned directions.
2. **Vertex welding is mandatory, not the optional future "repair" the spec deferred.** Unwelded,
   index-based connectivity splits a plain `BoxGeometry` into **6 components** with every edge a
   boundary edge; a cylinder into **49**. `closedManifold` is false for the simplest solid there is,
   so the containment guarantee would never once have held. Welding rescues every closed primitive
   tested (box, sphere, cylinder, cone, torus → 1 component, closed manifold). **Fixed:** welding is
   now a required normalization step.
   - The reason `mergeVertices` appears not to work is that it compares *all* attributes, and
     per-face normals/uvs make every vertex unique. Stripping to position-only first is what makes
     welding possible — so the spec's "don't copy rendering attributes" rule, written for memory,
     turns out to be **load-bearing for correctness**.
   - This invalidates the zero-copy position strategy (see `ThreeMeshBvhBackend`) — but welding
     *shrinks* geometry by ~23% on average (box 24→8 vertices, cylinder 148→50), so an owned welded
     buffer costs less than the shared one would have, not more.
3. **Measured budgets replace guessed ones** (see Tolerances/budgets): BVH build is ~16ms at 18k
   triangles, validating `maxSyncTriangleCount = 20_000` as roughly a one-frame ceiling **at the time —
   round 15 found this measured only the BVH-build phase, not welding or connectivity, and revised the
   ceiling down to `12_000`; see `ThreeMeshBvhBackend`/`BlasCache`**; raw candidate pairs cost ~0.3µs
   each, making the guessed `maxCandidatePairsExamined = 200_000` a ~53ms stall, so it drops to `50_000`.

**Part B ran the same questions against the live acceptance model** (`racbasicsampleproject.rvt`,
classic SVF) via Playwright. Full detail in `spike/FINDINGS.md`; the load-bearing results:

4. **The acceptance criterion is met.** `Bathtub-TOTO-Nexus-FBF794S` resolves to **Master Bath 207**
   — 907 of its 1003 world vertices classify inside that room, and **all 13 other rooms score
   exactly 0**. No ambiguity.
5. **`Autodesk.Viewing.Private.THREE` does not exist** — Viewer's THREE is the global `window.THREE`
   at **r71**. The spec said otherwise throughout; see Architecture for the corrected (and
   strengthened) isolation argument.
6. **The bracketed number in a display name is a Revit ElementId, not a dbId** — `[420270]` is
   dbId **2530**, and querying 420270 returns nothing. See `ViewerModelAdapter`.
7. **Rooms weld into perfect closed manifolds** (1 component, 0 boundary edges, 0 non-manifold
   edges). The precondition ray-parity containment depends on **holds for real room geometry** — the
   spec's biggest risk, resolved favourably.
8. **Source geometry does not, and that broke a round-6 rule.** The bathtub welds to 14 components
   with 441 boundary edges, so "flag any positive decided by an open component" would have fired on
   essentially every query. Corrected in `anyComponentInside`.
9. **Real SVF exercises none of the fallback machinery**: 100% of fragments took the `vb`/`vbstride`
   branch with `ib` indices; `groups`, `drawRange`, and `offsets` were absent everywhere. The
   primitive-range rules two review rounds were spent on are defensive code that reality never
   reaches in this format.

10. **The acceptance query needs no acceleration structure at all** (B7). Brute-force point-in-mesh —
    no BVH, no TLAS, no caching, plain Möller–Trumbore over raw triangle arrays — resolved 1003
    bathtub vertices against all 14 rooms in **10.2ms**, because Revit rooms here are 12–64
    triangles and there is nothing meaningful for a tree to prune.

**B7 is settled: the BVH stays.** Milestone 1 builds the general clash-detection library the idea doc
describes; the room-locator is its first *consumer*, not its design target, and sizing the
architecture to its cheapest consumer would defeat the milestone's stated purpose.

The measurement still changes something, though, and the spec would be dishonest to keep it as a
footnote: **it tells us what the acceptance test does not prove.** Passing the room-locator at 64
triangles per room exercises correctness and nothing else. Every performance claim here —
`maxSyncTriangleCount`, `maxCandidatePairsExamined`, lazy BLAS building, cache eviction, the
one-frame budget rule they all derive from — rests on `measure.mjs`'s synthetic geometry, and the one
real model available exercises none of it. The MEP-scale benchmark is therefore **load-bearing rather
than optional polish**: it is the only thing that will exercise the machinery this decision keeps.
See Risks.

## Purpose

**The deliverable is the general-purpose client-side clash-detection library** described in the idea
doc. This is **Milestone 1**: the smallest slice of that library that is architecturally real rather
than a bespoke hack.

**Migrating [`RoomLocatorExtension.js`](https://gist.githubusercontent.com/yiskang/c568db634e48c917d258716982eb89ba/raw/0c2920e75c2bfb5d39a82ce2ccfbddeeac5f709c/RoomLocatorExtension.js)
off `ThreeCSG`/BSP is how that slice gets verified**, not a second deliverable competing with it. The
extension is the worked example: an existing, working, CSG-based implementation with a known-correct
answer on a real model, which the library must reproduce without CSG. That makes it a far better
acceptance test than any fixture — it was written against real Revit geometry by someone who wasn't
designing this library, so it cannot have been shaped to fit.

The direction of the dependency matters and is easy to get backwards. **The library is not sized to
the extension.** Room geometry is small (12–64 triangles), and treating the extension as the design
target would argue away the acceleration structures the library exists to provide — see the B7
discussion above, where exactly that argument was raised and rejected. The extension proves the
engine is *correct*; separate MEP-scale work proves it is *fast*.

The extension keeps **zero collision logic of its own** — that is what makes it a valid test. All
broad-phase filtering, geometry normalization, BVH construction, and containment semantics live in
the library, so a passing room-locator exercises library code paths rather than extension-local
workarounds. Both of the original's collision stages are replaced: the coarse
`THREE.Box3.containsBox()` filter becomes the library's broad phase, and the CSG fine check becomes a
`containment` query. The extension is left holding only Viewer concerns — context menu, selection,
room lookup, highlighting.

## Background

The original extension does two-phase detection: a `THREE.Box3.containsBox()` coarse bbox check,
then a fine check that builds a `ThreeCSG`/`ThreeBSP` mesh for the element and each candidate room
and calls `bsp.intersect(bsp)`, treating a non-empty polygon result as "room contains element."
That CSG intersect is expensive (BSP tree construction, polygon splitting) to answer what is
functionally a boolean containment question, and it's dynamically loaded from an uncontrolled CDN
(`cdn.jsdelivr.net`).

Revit Room geometry, as tessellated by Model Derivative, represents the enclosed air volume of the
room (an extrusion of the room boundary polygon from floor to ceiling). Furniture/fixtures placed
in a room normally sit **fully inside** that volume without their surfaces ever crossing the room's
own solid boundary. So what the original CSG intersect is actually testing is **volume overlap**,
not surface crossing — this shapes the containment algorithm below.

Two properties of that CSG predicate are worth naming explicitly, because the replacement has to
match both and earlier drafts of this spec broke each in turn:
1. It is **symmetric** — `intersect` doesn't privilege one operand.
2. It **excludes zero-volume contact** — two solids meeting exactly at a face produce no polygons,
   so touching is not overlap.

## Milestone Scope

This spec covers a deliberately bounded slice of the idea doc's full architecture:

**Included:**
- Viewer geometry adapter with capability detection (not a hard-coded layout assumption)
- Unique-geometry deduplication (model-local)
- `three-mesh-bvh`-backed BLAS, one per unique geometry, lazily built
- Runtime isolation: separate `three`/`three-mesh-bvh` from Viewer's bundled THREE, via import map,
  self-hosted vendor files
- Single-pair and small-batch queries: `surface-intersection`, `containment`, `volume-overlap`
- `RoomLocatorExtension` rewritten as a thin `CollisionWorld` consumer

**Excluded (future milestones):**
- TLAS-vs-TLAS scene-wide broad-phase (this milestone uses a plain linear bbox scan — room counts
  are small, tens not thousands)
- Worker offloading
- Serialization / persistent BLAS caching
- `touching` / `clearance` query modes
- A full benchmark suite — **but not the single MEP-scale performance gate**, which is *included*
  (see Testing). Settling B7 in favour of keeping the BVH made that gate the only thing that
  exercises the acceleration machinery this milestone builds; excluding it wholesale, as an earlier
  draft did, left the spec calling an MEP model a milestone dependency while defining no milestone
  test that used one.
- Cross-model geometry deduplication
- Cross-model queries of any kind — `findClashes` requires `source.model === target.model` in
  Milestone 1 and rejects otherwise. Placement-transform/global-offset/unit normalization across
  models is real work the idea doc explicitly calls out ([idea:1130-1136]) and is undefined until a
  later milestone designs it.

The public `CollisionWorld` API is designed to be forward-compatible with these — later milestones
extend the same method signatures rather than replacing them.

## Architecture

**Runtime split.** Two isolated THREE.js worlds, per the idea doc.

**Viewer's THREE is the global `window.THREE`, at revision 71.** Earlier drafts said
`Autodesk.Viewing.Private.THREE` throughout; the spike proved that path does not exist in Viewer
7.124.2 — reading it returns `undefined`. The correction makes isolation *more* critical, not less,
and for a sharper reason than the original text gave:

- The global is **already occupied by Viewer**. The rule is not "don't pollute a free global," it is
  "**don't clobber Viewer's r71 and break rendering**." A UMD/classic-script build of modern three
  would do exactly that, which is why only ESM is acceptable here.
- r71 against the pinned r185 is a ~114-revision gap, and `three-mesh-bvh@0.9.14` requires
  `three >= 0.159.0`. Sharing one runtime is not merely inadvisable — it is impossible. The
  two-runtime design is vindicated rather than merely cautious.

So: the collision library uses its own modern `three` + `three-mesh-bvh` loaded via import map, never
assigns to `window.THREE` / `globalThis.THREE`, and never patches Viewer THREE prototypes. The two
sides exchange only TypedArrays, plain numeric matrices, and packed bounds — never shared class
instances (`Mesh`, `Vector3`, `Matrix4`, `Box3`), which across a 114-revision gap would be
incompatible even where the class names match.

The acceptance test the idea doc proposed is still exactly right, with one correction: assert
`window.THREE.REVISION === '71'` before and after loading the collision runtime — *unchanged*, not
*absent*.

**Repo layout** (this is a single-app sandbox with no bundler — plain `<script type="module">`,
no monorepo):

```text
wwwroot/
├─ vendor/                          # self-hosted, npm-installed, copied here
│  ├─ three/build/three.module.js   #  + three.core.js, which it imports
│  ├─ three/examples/jsm/utils/
│  │  └─ BufferGeometryUtils.js     #  mergeVertices — see "welding's own vendor entry" below
│  └─ three-mesh-bvh/src/**         #  whole src tree — see note below
├─ collision/                       # the CollisionWorld library (Milestone 1 slice)
│  ├─ viewer/
│  │  ├─ ViewerModelAdapter.js
│  │  └─ ViewerGeometryAdapter.js
│  ├─ geometry/
│  │  ├─ GeometryRegistry.js
│  │  ├─ GeometryIdentity.js
│  │  └─ GeometryConnectivity.js    # connected-component decomposition, cached per geometry
│  ├─ blas/
│  │  ├─ ThreeMeshBvhBackend.js
│  │  └─ BlasCache.js
│  ├─ query/
│  │  ├─ SurfaceIntersectionQuery.js  # any triangle contact, touching included
│  │  ├─ ProperCrossingQuery.js       # contact that actually shares volume
│  │  ├─ ContainmentQuery.js          # per-component point-in-mesh sampling (internal)
│  │  ├─ ContainmentModeQuery.js      # public 'containment' mode; directed, target-closed only
│  │  └─ VolumeOverlapQuery.js        # ProperCrossing OR Containment (either direction)
│  ├─ CollisionWorld.js
│  └─ index.js
├─ extensions/
│  └─ RoomLocatorExtension.js       # thin consumer, registered in viewer.js
├─ viewer.js                        # adds RoomLocatorExtension to extensions list
└─ index.html                       # gains a <script type="importmap">
```

**Exact dependency pins** (a review pass asked for real versions rather than "pinned"; these were
checked against the npm registry rather than assumed):

| Package | Pin | Note |
|---|---|---|
| `three` | `0.185.1` | ESM entry `./build/three.module.js` |
| `three-mesh-bvh` | `0.9.14` | `peerDependencies: { three: ">= 0.159.0" }` — satisfied |

`0.9.14` was confirmed published against the registry directly (present in `versions`,
`dist-tags.latest`, published `2026-08-01`, tarball returns HTTP 200) after a review pass reported it
missing — the npmjs.com web UI can lag `registry.npmjs.org`. **Every upstream behavioral claim in
this spec is verified against the `v0.9.14` git tag specifically**, not `master`, since the two can
diverge and a spec that cites the wrong revision is worse than one that cites none.

**The vendor copy is not two files.** The earlier draft's `three-mesh-bvh/build/index.module.js`
does not exist: that package's `exports.import` is **`./src/index.js`**, a multi-file source tree
whose modules import each other by relative path and import `three` by bare specifier. `three`'s own
`build/three.module.js` likewise imports `./three.core.js`. So `scripts/sync-vendor.mjs`
(`npm run build:vendor`, no bundler — still just a copy step) must copy **directory trees**, not
single files, and the import map resolves the bare specifiers:

```json
{ "imports": {
  "three": "/vendor/three/build/three.module.js",
  "three-mesh-bvh": "/vendor/three-mesh-bvh/src/index.js",
  "three/addons/utils/BufferGeometryUtils.js": "/vendor/three/examples/jsm/utils/BufferGeometryUtils.js"
} }
```

The bare `three` specifier inside three-mesh-bvh's own sources resolves through that same map — which
is exactly the mechanism that keeps it bound to the *collision* THREE and never to Viewer's.

**Welding's own vendor entry, and why it was missing.** Round 10 found that **Solid model**'s mandatory
weld step specifies `mergeVertices` and cites `three@0.185.1`'s `BufferGeometryUtils.js` for its exact
grid-quantization behavior (see **Solid model** below), but the vendor tree above never copied that
file — only `three/build/**` and `three-mesh-bvh/src/**`. `mergeVertices` lives at
`three/examples/jsm/utils/BufferGeometryUtils.js`, not under `three/build/`, so `ViewerGeometryAdapter`
would import a module `sync-vendor.mjs` never placed, 404ing on first load before any query could run.

The fix vendors that one file rather than writing a local weld implementation: `mergeVertices` is
self-contained (verified directly against the `three@0.185.1` source — it imports only bare `three`
and calls no other function defined in its own module), so copying it verbatim keeps the tolerance
analysis under **Solid model** exactly true (it cites the actual shipped source, not a hand-ported
copy that would need its own re-verification) while adding a single ~40KB file to the vendor payload,
not the whole `examples/jsm` tree — `sync-vendor.mjs` copies this one file explicitly, by path, the
same way it copies the two directory trees above. The import-map key uses the same bare specifier
`three`'s own JSDoc documents (`three/addons/utils/BufferGeometryUtils.js`), so `ViewerGeometryAdapter`
imports it exactly as upstream code and documentation both would.

**Acceptance check for this fix**: after `npm run build:vendor`, load the sandbox app and confirm the
Network panel shows no failed module request under `/vendor/`, and specifically that
`BufferGeometryUtils.js` resolves — a fixture that stubs `fetch`/module resolution and asserts
`ViewerGeometryAdapter`'s weld step imports successfully covers this without a real browser.

## Components

**`ViewerModelAdapter`** — turns a `(model, dbId)` into the raw ingredients for a
`CollisionInstance`:
- **Fragments for a dbId — via the self-driven walk, never a recursive enumeration.** The recursive
  form `model.getInstanceTree().enumNodeFragments(dbId, cb, true)` is the real Viewer API
  (`getLeafFragIds`, used by the original gist, is not a built-in method — it's a community convention
  wrapping this call), and it was this component's stated contract through round 15. **Round 16 removed
  it from this design entirely, and this section is no longer an exception**: one recursive call is a
  single uninterruptible native traversal of a whole subtree, with no ceiling to check before it, so a
  ceiling checked after it returns only detects the freeze it was meant to prevent. The normative
  extraction path is the **self-driven, depth-first node-by-node walk specified in Data Flow step 3**,
  built from the non-recursive primitives this component supplies: `enumNodeChildren(node, cb, /*
  recursive */ false)` and `enumNodeFragments(node, cb, /* recursive */ false)`. No code path in this
  design may call the recursive form. **`getChildCount` is not one of the walk's primitives** — see the
  fanout-ceiling correction in **Data Flow** step 3.
- **Why the walk covers exactly what `recursive: true` covered — verified, not assumed.** The
  acceptance-model evidence that originally motivated the recursive form is real and still stands: the
  family node (dbId 2527) owns no fragments *directly*, and yields its child instance's fragment only
  when the enumeration descends — so an extraction that calls non-recursive `enumNodeFragments` on the
  requested dbId **alone** returns empty and silently reports no geometry for a perfectly ordinary
  assembly/parent dbId. That is the failure the recursive form existed to avoid, and round 16 removed
  the recursive form without ever stating why the replacement does not reintroduce it. It doesn't, and
  round 18 verified why by direct inspection of the pinned 7.124.2 bundle rather than by argument: the
  recursive form delegates to `enumNodeInstances`, whose traversal enumerates **each visited node's own
  direct fragments** and then recurses through a **non-recursive** `enumNodeChildren` — so it visits
  every node in the subtree, root and interior nodes included, not only the leaves, exactly once. That
  is structurally the same traversal the walk performs, with the recursion moved out of the native call
  and under this library's own control. **The union of the walk's per-node
  `enumNodeFragments(node, cb, false)` results is therefore the same fragment set one
  `enumNodeFragments(dbId, cb, true)` call produces** — same set, not merely a superset; order is not
  guaranteed to match and is not relied on, and the walk dedupes by fragment id so one Viewer fragment
  never becomes two `CollisionInstance`s if traversal reports it under more than one node.
- **Two conditions that equivalence rests on, and only one of them is this design's to guarantee.**
  1. *No truncation.* The walk has exactly two early-exit paths — the `maxFragmentsPerDbId` tally and
     the `maxChildrenPerNode` fanout ceiling (both in Data Flow step 3) — and either firing means the
     walk stopped short of the full union. That is precisely why both **reject the entire `findClashes`
     call** rather than returning a truncated fragment set: a completed walk is coverage-equivalent to
     the recursive call it replaced, and a truncated walk produces no result at all, so no result this
     design returns is ever built on a knowingly partial subtree.
  2. *A complete tree to walk.* Equivalence is between two traversals of **the same instance-tree
     snapshot**. It says nothing about whether the Viewer has finished building that snapshot. An
     instance tree that under-reports a node's children yields a walk that finishes **normally**, with a
     silently short union and no budget trip to catch it — and the recursive form would have been just
     as wrong, so this is not a regression introduced by the walk, but it is not closed by it either.
     The two conditions are independent and the rejection paths above cover only the first. See
     **Risks**; this spec does not claim to have closed the second.
- **The bracketed number in a display name is a Revit ElementId, not a dbId.** The acceptance
  element `Bathtub-TOTO-Nexus-FBF794S [420270]` has **dbId 2530**; the spike found that
  `enumNodeFragments(420270, …)` returned an empty array, and the walk above rooted at `420270` finds
  nothing either — the identifier simply names no node. The number users read off the Model
  Browser — and the one in this spec's own acceptance criterion — is not addressable by the fragment
  APIs. Any code path that accepts an element identifier from a human must resolve it (by name
  search or property lookup) rather than passing it straight through, or it will silently find
  nothing. This spike hit exactly that.
- World matrix: `fragList.getWorldMatrix(fragId, matrix)`.
- World bounds: `fragList.getWorldBounds(fragId, box)` (available directly on `FragmentList`, no
  need to go through the render proxy).
- Geometry dedup key: `fragList.getGeometryId(fragId)` combined with the model's **admitted load
  epoch** (`modelLifecycle.get(model).epoch`, from `world.admitModel`/`findClashes`'s entry-point
  admission — see `world.admitModel` and "Race safety"), **not** `modelId`. Confirmed (via direct
  inspection of the shipped Viewer source) that `fragList.getGeometryId(fragId)` alone is **model-local
  only** — round 14 found combining it with the reusable numeric `modelId`, as every prior round did,
  let a different `Model` object that reused a `modelId` before the old object's eviction ran alias the
  old object's `GeometryRecord`/BLAS. Since `loadEpoch` is global, monotonic, and assigned exactly once
  per admitted object, the key must always be `(loadEpoch, geometryIndex)` — never `(modelId,
  geometryIndex)`, and never the bare index. See **`GeometryRegistry`** below and **`world.evictModel`**'s
  "Race safety" note for why this closes the aliasing hole structurally rather than by timing.

**`ViewerGeometryAdapter`** — normalizes `viewer.impl.getRenderProxy(model, fragId).geometry` into
the idea doc's `TriangleGeometryView`, **including its `ranges: TriangleRange[]` field** — the
earlier version of this spec described position/index handling but silently dropped ranges, which
the idea doc requires ([idea:198](../../ideas/aps-viewer-clash-detection-library-idea.md#L198),
[idea:266](../../ideas/aps-viewer-clash-detection-library-idea.md#L266)).

- Positions — checked in this order:
  1. `geometry.vb` + `geometry.vbstride` + `geometry.vblayout.position.offset` (Viewer-internal
     interleaved) — confirmed universal across SVF/SVF2/OTG in Viewer 7.124.2, wrapped zero-copy
     into a library-side `InterleavedBuffer`/`InterleavedBufferAttribute` over the *same* TypedArray.
  2. `geometry.attributes.position.data.array` (a real, standard three.js
     `InterleavedBufferAttribute`) — a review pass correctly pointed out the previous draft omitted
     this genuine three.js layout, which the research agent's "no evidence in 7.124.2" finding never
     ruled out for non-LMV geometry the fallback path might legitimately receive.
  3. `geometry.attributes.position.array` (a standard, non-interleaved `BufferAttribute`), stride 3.

  Each source maps onto `TriangleGeometryView`'s `positionStride`/`positionOffset` explicitly —
  spelled out because a review pass noted the previous draft named the interleaved *array* without
  ever saying where the stride and offset came from, which is precisely the part that goes silently
  wrong (a plausible-looking wrong mapping yields garbage vertices, not an error):

  | Source | `positions` | `positionStride` | `positionOffset` |
  |---|---|---|---|
  | Viewer interleaved | `geometry.vb` | `geometry.vbstride` | `geometry.vblayout.position.offset` |
  | `InterleavedBufferAttribute` | `position.data.array` | `position.data.stride` | `position.offset` |
  | `BufferAttribute` | `position.array` | `position.itemSize` (3) | `0` |

  All three are in **float elements, not bytes** — matching Viewer's own `vbstride` convention — so a
  vertex `i`'s x-coordinate is always `positions[i * positionStride + positionOffset]`, whichever
  branch produced it. That single uniform accessor is the whole point of normalizing.
- Index — `geometry.ib` (Viewer-internal), then `geometry.index?.array`. **Not**
  `geometry.attributes.index.array`, which the previous draft used — standard three.js
  `BufferGeometry` stores its index as a top-level `geometry.index` property, never inside
  `attributes` (which holds only per-vertex attributes like position/normal/uv). That was a real bug,
  carried over uncritically from the original gist's own (non-standard) fallback code. If neither is
  present, treat as non-indexed (`vertexCount / 3` triangles).
- Ranges — normalized into `TriangleRange[]`, matching how `WebGLRenderer` actually resolves what
  gets drawn (per its source, group and draw ranges are **intersected**, not treated as either/or):
  - **`TriangleRange.start`/`.count` are index-element counts, not triangle counts.** They carry
    `groups[].count`, `drawRange.count` and `indices.length` through verbatim, and three.js states all
    three in index elements — 3 per triangle for the indexed, non-strip triangle lists this pipeline
    assumes; for the non-indexed fallback above they are position elements, 3 per triangle, the same
    factor either way. Ranges are **triangle-aligned** by this normalization: a clipped range whose
    `count` is not a multiple of 3 contributes only its whole triangles (`floor(count / 3)`), never a
    partial one — which is also all compaction can copy. Nothing downstream may compare such a count
    against a triangle ceiling without converting first: the conversion is
    `activeTriangleCount := Σ floor(ranges[i].count / 3)`, defined under **`ThreeMeshBvhBackend`/
    `BlasCache`**, and it — not the raw sum — is what `maxSyncTriangleCount`, a triangle count, is
    compared against.
  - **The branch condition is `groups.length > 0`, not "`groups` is present."** This is not
    pedantry: standard `BufferGeometry` initializes `this.groups = []` in its constructor (verified in
    `three@0.185.1`), so *every* fallback-path geometry has the property, and a literal implementation
    of "if `groups` is present" takes the groups branch, iterates zero groups, and emits **zero
    triangle ranges**. The fragment would then contribute no geometry at all — silently, with no
    diagnostic, since nothing failed. That is a false negative that looks exactly like a verified
    no-clash, which is the specific failure class this spec's diagnostics exist to make impossible.
  - If `groups.length > 0`, each group's `{start, count}` is clipped to
    `geometry.drawRange` when a draw range is also present (`effectiveRange = intersect(group,
    drawRange)`; a group with an empty intersection contributes zero triangles, not an error). The
    previous draft only applied `drawRange` when `groups` was *absent*, which silently produced
    wrong ranges whenever a real fallback-path geometry had both.
  - If `groups` is absent **or empty**, synthesize a single range covering the full index/vertex count
    (clipped to `drawRange` if present) — the `geometry.groups || [{start: 0, count: indices.length,
    index: 0}]` fallback pattern was directly observed in the shipped Viewer 7.124.2 source's own
    vertex-enumeration utilities, so it's a grounded default for the no-groups case. Note that the
    observed pattern uses `||`, which has the same empty-array bug; the spec deliberately does not
    copy it.
  - No `drawRange` field was observed on the Viewer's internal `LeanBufferGeometry` class itself in
    this version — the intersection logic above only matters for the fallback (non-LMV) path.
  - **Legacy `offsets` layouts are explicitly rejected**, not silently normalized. The previous draft
    defaulted `baseVertex: 0` for every range regardless of layout, which a review pass correctly
    flagged as guessing rather than normalizing — there's no confirmed rule for what `offsets`'
    `index`/base-vertex field should map to, and no evidence this layout appears in Viewer 7.124.2 in
    the first place, so a fragment using it is treated as an unsupported geometry layout (skipped,
    recorded as a diagnostic — see Public API) rather than risking a silently wrong triangle range
    that could produce false clashes.

The adapter still does runtime capability detection rather than hard-coding any of the above as the
only possible layout — the research just tells us which branch fires in practice for this Viewer
version.

**`GeometryRegistry` / `GeometryIdentity`** — one `GeometryRecord` per unique `(loadEpoch,
geometryIndex)` — **keyed by the owning `Model` object's admitted load epoch, not its numeric
`modelId`** (round 14; see the "Geometry dedup key" note under `ViewerModelAdapter` and "Race safety"
under **`world.evictModel`**) — with a `referenceCount`, an explicit `buildState: 'building' | 'ready'`,
and one lazily-created promise per build phase: a `weldPromise` (active-range compaction + weld,
resolving to the collision-owned compacted/welded position+index pair), an `accelerationPromise` (the
BLAS), and the promise behind a lazy `connectivity` (the `GeometryConnectivity` component
decomposition). **The record is inserted into the registry in `buildState: 'building'` when its build
*starts*, and that entry — not a promise held by whichever caller built first — is what concurrent
callers observe and share;** `'ready'` means compaction+weld and the BVH have both resolved, which is
everything `surface-intersection` needs, while `containment`/`volume-overlap` additionally await the
connectivity phase on that same entry. See **"A `GeometryRecord` is published when its build starts"**
under **`ThreeMeshBvhBackend`/`BlasCache`** for the full rule — single-flight phase slots, what a caller
may read off a `'building'` record, which liveness a build-phase checkpoint validates, and what happens
to the entry when a phase rejects. Each phase promise is created at most once per unique geometry and
its product reused by every fragment instancing it — the same amortization argument that motivates
per-geometry BLAS applies unchanged to weld and connectivity. `modelId`
remains attached to a record only as display/diagnostic metadata (e.g. for error messages naming which
model a `geometry-too-large-for-sync-build` diagnostic belongs to); it plays no role in cache identity.
Cross-model geometry sharing is out of scope for this milestone.

**`CollisionInstance` identity cache.** `CollisionInstance`s are canonical, immutable identity objects
cached per `(loadEpoch, fragmentId)` — mirroring `GeometryRegistry`'s epoch-based keying for the same
race-safety reason (see "Race safety" under **`world.evictModel`**) — so repeated `findClashes` calls
against the same admitted `Model` object receive the **same object reference** for a given fragment,
which the stale-eviction fixture under **`world.evictModel`** depends on. A `CollisionInstance` contains
only its `fragmentId` and an immutable `GeometryIdentity { loadEpoch, geometryIndex }`; both the instance
and its nested identity value are frozen after construction. **It contains no `Model`, `GeometryRecord`,
BLAS, world matrix, world bounds, or other call-varying or mutable state** — geometry is resolved lazily
through `GeometryRegistry` from the instance's `GeometryIdentity`, after the caller's normal
disposed/epoch liveness check. The fragment-id dedup already stated under **`ViewerModelAdapter`** and
**Data Flow** step 3 governs identity within one build; after that walk completes, extraction looks up or
creates the epoch's canonical instance for each unique fragment. A cache hit returns the existing object
unchanged — **no `findClashes` call ever writes through a cached `CollisionInstance`.**

**Placement state is call-local, never cached.** Each `findClashes` call builds fresh
`PlacedCollisionInstance` values — `{ instance, worldMatrix, worldBounds }` — with newly owned matrix and
bounds objects copied from `fragList.getWorldMatrix`/`getWorldBounds` during that call's extraction (see
**Data Flow** step 3). Broad and narrow phases consume these placement values, never matrix or bounds
fields off the canonical `CollisionInstance` (which has none). Source and target placement arrays are
owned solely by their call and remain unchanged across its yields — this is what preserves the per-call
snapshot guarantee under **Broad phase** unchanged: concurrent calls may share the same immutable
`instance` reference while each holds its own independent transform snapshot, and neither call can
overwrite state the other resumes with.

**Ownership and release are epoch-scoped, independent of `GeometryRegistry`.** The cache is physically
partitioned as `Map<loadEpoch, Map<fragmentId, CollisionInstance>>`, not one flat map. A canonical
instance remains strongly resident for its admitted epoch, so reference identity is stable across calls.
**`world.evictModel`**'s `releaseEpochScopedState` and **`world.dispose`**'s wholesale clear each release
this cache as an operation of their own — deleting exactly the outgoing epoch's bucket (`evictModel`) or
every bucket (`dispose`) — **not** derived from a `GeometryRegistry` scan, a geometry reference count, a
numeric `modelId`, or `liveModelByModelId`; see both methods' own contracts for the exact mechanics. A
delayed `evictModel(oldModel)` therefore cannot touch a newer object's different epoch bucket, satisfying
the stale-eviction fixture without a `GeometryRegistry`-keyspace dependency this cache's own keyspace
(built from every collected fragment, a strict superset of `GeometryRegistry`'s lazily-built
candidate-pair keyspace) cannot honor.

**Retention is explicitly bounded.** `maxCollisionInstancesPerEpoch` (provisional, unmeasured — see the
atomic-operations table and the performance gate) limits the number of canonical instances retained for
one live epoch. After every requested dbId's extraction walk completes — not per dbId, per node, or per
fragment — and after the walk's last possible yield, `findClashes` looks up the affected epoch's bucket
**without creating it** if absent, and recomputes which ids from the call's complete unique fragment-id set
are still missing against that bucket's *current* contents — never a count carried over from earlier in the
walk, since a concurrent call's commits during any of the walk's own yields can otherwise leave it stale.
It then, in that same synchronous step — no intervening `await`, no call out to any external callback,
getter, or other reentrant operation — checks `currentBucketSize + uniqueMissingCount` against the limit
for the affected epoch. Exceeding it rejects the entire call: no bucket is created, no canonical instance
is constructed, and no call-local placement is constructed for any fragment in the query. Otherwise the
bucket is created if it did not already exist and every missing instance is constructed and committed into
it in that same step, so two concurrent calls cannot both pass against the same stale capacity observation;
only after that commit succeeds does the call construct its `PlacedCollisionInstance` values (see **Data
Flow** step 3). This zero-mutation guarantee is specific to a capacity rejection — a later failure in
placement construction or in the broad-/narrow-phase work that follows can still leave already-admitted
canonical instances resident, and is not covered by it. Entries are never individually evicted while their
epoch remains live — doing so would break the stable-reference guarantee above — so capacity is recovered
only by epoch eviction or whole-world disposal, the same two release paths every other epoch-scoped cache in
this design uses.

**`ThreeMeshBvhBackend` / `BlasCache`** — builds one `MeshBVH` per `GeometryRecord`, lazily, on
first use, over the **welded** collision geometry.

**Round 15 found that building a `GeometryRecord` for the first time is not one atomic operation with
a single checkpoint before it — it is up to three, each independently capable of costing a full frame,
and only one of the three (the BVH build) had ever been named, measured, or checkpointed as such.** A
local measurement on this repo's actual dependencies found ~16.8ms to weld and ~6.9ms to build the
connectivity/edge-map at ~19,800 triangles — *before* `MeshBVH` construction even starts — meaning the
true worst-case non-preemptible cost of a first build (extract → weld → [connectivity] → BVH) at
anything near the sync-triangle ceiling was roughly 2–3× what this spec's BVH-only framing implied. See
the "Atomic operations and what remains non-preemptible" table under **`ProperCrossingQuery`**'s budgets
for the corrected accounting.

**The fix treats welding, connectivity, and BVH construction as three separately-checkpointed atomic
phases, not one.** Welding and BVH construction always run together the first time any mode touches a
geometry — every mode needs a built BVH, and welding is a prerequisite the BVH is built over. Connectivity
remains independently lazy exactly as before (computed "at most once per unique geometry," only the
first time a mode that actually consumes it touches this `GeometryRecord`) — **but round 16 found the
round-15 wording of "which modes actually consume it" was wrong.** Both `containment` and
`volume-overlap` call `anyComponentInside` (`ContainmentModeQuery` directly; `VolumeOverlapQuery`
through its own containment term, run *after* `ProperCrossingQuery` returns false — see
`anyComponentInside`), and `anyComponentInside` samples per connected component, which requires
`GeometryConnectivity`'s decomposition regardless of which of the two modes is asking — the component
decomposition (stages 1–2) runs for both modes equally, independent of which one does or doesn't also
reach stage 3 (see the note after stage 3 under `anyComponentInside` for which mode that is). Only
`surface-intersection`, which never calls `anyComponentInside` at all, is genuinely connectivity-free.
This same mode gate also builds connectivity for an operand `anyComponentInside` never itself
decomposes: `containment`'s parity-closure precondition (see **the containment guarantee, and its
preconditions** below) reads a cached manifold-classification flag off the *target*'s
`GeometryConnectivity`, independent of the source-side component decomposition — so both operands'
records go through this same connectivity gate in `containment`/`volume-overlap` mode, not only the
operand(s) `anyComponentInside` samples. Each phase,
whichever ones run, gets its own checkpoint immediately **before** it starts — not partway through, since
none of the three can be paused mid-call — so the accepted per-atomic-operation ceiling (the same ~16ms
a single BVH build was already allowed to cost, see the atomic-operations table) now applies to each
phase individually, rather than to however many of them happen to run back-to-back in one span. A build
that needs all three phases (first-ever use of a geometry in `containment` mode) therefore still costs
up to roughly 3× that ceiling in wall-clock time, same as before. **Round 22 correction:** each phase's
checkpoint (disposed, then model epoch — see "Race safety") is the same conditional,
shared-`frameBudgetMs`-accumulator check every other checkpoint in this design uses — the same discipline
`ProperCrossingQuery`'s probes and `ContainmentQuery`'s samples already follow at finer grain, and it
yields only when the accumulator is already due, not unconditionally (see the worst-case-span formula
under `ProperCrossingQuery`'s budgets). Each build phase's checkpoint prevents *another* phase from
starting once the shared accumulator is already due — it does not guarantee one build phase per
synchronous span, and does not guarantee only the *first* phase in a build can share a span with prior
work. **This corrects an earlier draft of this passage, which claimed the three phases "never compound
with each other in one span" — false at the doc's own measured figures.** At those figures, welding
(~16.8ms) alone already exceeds `frameBudgetMs`, so the checkpoint immediately following it always finds
the accumulator overdue and yields — welding does not share that measured span with connectivity or the
BVH. But after that yield, connectivity's own smaller measured cost (~6.9ms) does *not* carry the same
guarantee: the checkpoint immediately after connectivity can still find the accumulator not yet due
(6.9ms < `frameBudgetMs`), so connectivity and the BVH build *can* share one span — up to ~6.9ms + ~16ms
≈ 22.9ms in the worst case at these figures, still within the corrected formula's ≈24ms bound (below).
This is about the *measured* figures, not a structural guarantee that welding specifically can never
compound with what follows it: a smaller geometry whose welding cost itself falls under `frameBudgetMs`
could let welding share a span with connectivity, or all three phases with each other and with prior
work, subject only to the same corrected bound. See the corrected formula under `ProperCrossingQuery`'s
budgets for what any of this composes to (≈24ms, not the ≈16ms a per-phase-only reading of "own
checkpoint" implied through Round 21).
**A `GeometryRecord` is published when its build *starts*, not when it finishes: the registry entry
carries an explicit `buildState: 'building' | 'ready'`, and that entry — not a promise handed back to
whichever caller happened to build first — is what concurrent callers share.** The earlier rule here
("only published … once every phase it needs has completed successfully") could not hold, because this
build is deliberately *not* atomic: a yield-and-revalidate checkpoint sits before each phase, so control
genuinely returns to the narrow phase mid-build. Under publish-only-when-complete, nothing for that
`(loadEpoch, geometryIndex)` exists in `GeometryRegistry` during that window — a second concurrent
caller sees a cache miss and starts a duplicate build of every phase (defeating the dedup guarantee
below), and neither `evictModel` nor `dispose()` can find the in-flight build promises both are
specified to reject. The rule is therefore:
- **Insert first, then build.** The caller whose lookup misses inserts the `GeometryRecord` for that
  `(loadEpoch, geometryIndex)` with `buildState: 'building'` **before** the first phase's checkpoint —
  that is, before any yield. Each phase is a **single-flight slot** on that entry: `weldPromise`
  (compaction+weld), `connectivity`'s own promise, `accelerationPromise` (the BVH). Each slot is created
  at most once, on demand, and awaits its prerequisites rather than being launched in parallel — weld
  first, then connectivity if it is needed, then the BVH — preserving the phase order the narrow phase
  and the atomic-operations table already specify.
- **A caller that finds an existing entry never starts a duplicate build.** It awaits the phase slots
  its own query needs off that entry. This single registry-level mechanism is what makes concurrent
  build requests dedupe, and it covers compaction/weld and connectivity exactly as it covers the BVH —
  see `BlasCache` below, which owns no dedup mechanism of its own.
- **Nothing reads a phase's product off a `'building'` record.** The compacted/welded buffers, the
  `MeshBVH`, and the `GeometryConnectivity` decomposition are only ever the resolved values of their own
  phase slots, never fields read straight off the record.
- **`buildState: 'ready'` is record-level and mode-independent: it means compaction+weld and the BVH
  have both resolved** — the phases every mode needs. What varies by mode is what a *query* requires of
  a record: a `'ready'` record is everything `surface-intersection` needs, and it is `'ready'` whether
  or not the connectivity slot was ever created; `containment` and `volume-overlap` additionally await
  connectivity's slot on that same entry, created on demand at whichever point this spec's
  connectivity-trigger rule fires (see the narrow phase in **Data Flow** step 3 and "Connectivity
  remains independently lazy" above — this state model does not by itself decide that trigger point).
  Connectivity is never what makes a record un-`'ready'`.
- **A build-phase checkpoint validates the record's *owner*, not the building caller's whole query.** A
  between-phases checkpoint on a shared build checks `disposed` first, then the liveness/epoch of the
  one model that owns this geometry — the operand whose `loadEpoch` is in the record's key — and nothing
  else. It must not reject because the initiating query's *other* operand was evicted. The dependency is
  intentionally owner-scoped: under Milestone 1's `source.model === target.model` restriction, eviction of
  a distinct non-owner operand is unreachable, so this distinction is not yet behaviorally observable, and
  every sharer of this entry necessarily shares its owning `(model, epoch)`, since epochs are globally
  unique and the key carries one. The scoping is retained for a future cross-model milestone, where callers
  sharing the record may hold different counterpart models. Each caller separately re-validates both of
  its own operands at its own checkpoints, before and after
  awaiting a shared phase slot. For the same reason, a caller whose own query aborts for an unrelated
  reason does not cancel a phase already in flight: every phase slot runs to settlement, so a
  `'building'` entry is never left permanently unsettled with other callers awaiting it.
- **There is no `'failed'` state.** If a build-phase checkpoint finds the owning model evicted or the
  world disposed, the phase slot rejects with the same `ModelEvictedError`/`WorldDisposedError` any
  other checkpoint failure would produce, and **the entry is removed from `GeometryRegistry`
  synchronously as part of that rejection**, discarding whichever intermediate buffers exist. No later
  caller can then observe a half-built record — neither a lingering `'building'` entry nor a
  `'ready'`-looking one whose later phases never ran — and a later, valid attempt starts the whole
  pipeline fresh rather than resuming a half-built record. Removal is identity-guarded (delete only if
  the registry still holds this exact entry for that key), so a late rejection can never drop a newer
  entry filed under a different epoch.
- **`evictModel` and `dispose()` reject in-flight builds through this same entry.** Every registry entry
  carries one entry-scoped cancellation signal, created once when the entry is first inserted in
  `buildState: 'building'` and kept alive, unchanged, for the entry's entire lifetime — the signal is
  *not* discarded or replaced when the entry transitions to `'ready'`. Every unresolved phase slot the
  entry ever hosts races that same signal, including a lazy connectivity build started later against an
  already-`'ready'` entry (see "connectivity's slot on that same entry" above): the signal is scoped to
  the entry's lifetime, not to its `buildState`. The release paths reject that signal exactly once and
  drop the entry in the same step (see **`world.evictModel`**'s `releaseEpochScopedState` and
  **`world.dispose()`**), unconditionally, for every entry they remove regardless of whether its
  `buildState` is `'building'` or `'ready'`. Clearing a map does not by itself settle a pending promise,
  which is what both of those guarantees require. Because phases are strictly sequential and
  single-flight per entry — weld, then connectivity if needed, then the BVH, with at most one phase ever
  unresolved on a given entry at a time — one signal per entry suffices; there is no per-phase-slot set
  or map of signals to keep in sync. Removal is identity-guarded the same way the build-failure removal
  path above already is: the release step deletes the entry only if the registry still holds this exact
  entry for that key, so a late-resolving continuation from a just-cancelled phase (weld, BVH, or a
  lazily-started connectivity build) can never republish its result or otherwise mutate state once the
  entry is gone. This entry-lifetime signal is defined only for `'building'`/`'ready'` entries — an
  *oversized marking* (see below) never has one, because no phase is ever started for it and it carries
  no `buildState` to begin with.
- **An oversized geometry (below) is a distinct kind of entry, not a build state.** A registry lookup
  yields one of three things: an *oversized marking* (no phase is ever started for it, it carries no
  `buildState`, and every pair needing it is skipped), a `'building'` record, or a `'ready'` one. Because
  an oversized marking is rejected *before* any build or derived phase ever starts, it has no unresolved
  phase work and therefore never has the entry-scoped cancellation signal described above created for it
  at all — that signal is created exactly once, at insertion, for a `'building'` entry, a trigger an
  oversized marking never undergoes. `evictModel`'s `releaseEpochScopedState` and `dispose()`'s wholesale
  clear (below) still enumerate and remove oversized markings in the same sweep as `'building'`/`'ready'`
  entries, but there is no signal on them to reject — removal is the entire cleanup.

**Round 16 found `maxSyncTriangleCount` was never defined against a specific triangle set — the raw
index buffer, or only the normalized active ranges — and that ambiguity was live, not academic: the
geometry actually handed to `mergeVertices` was the full raw buffer, with `ranges`/`groups` only ever
used afterward to tell `MeshBVH` which triangles to traverse.** A fragment with a huge total index but a
tiny active draw range could pass a ceiling check counted against the active set while still making
welding walk the entire oversized raw index — the exact gap the ceiling exists to close, just moved one
step earlier in the pipeline. **The fix inserts one more phase before the three above, not gated by
`frameBudgetMs` but by the ceiling itself: active-range compaction.** Before welding, before the
ceiling check, and before anything is handed to `mergeVertices`, `ViewerGeometryAdapter`'s already-
normalized `ranges: TriangleRange[]` (computed during the earlier layout-normalization pass — free, no
per-triangle work) are used to materialize a **collision-owned, compacted position/index pair containing
only the triangles those ranges cover**. The total active triangle count is
**`activeTriangleCount := Σ floor(ranges[i].count / 3)`** — `TriangleRange.count` is an *index-element*
count, not a triangle count (see the ranges bullet under **`ViewerGeometryAdapter`**, which also
triangle-aligns each range), while `maxSyncTriangleCount` is a triangle count, so the conversion has to
happen before the two are compared. Comparing the raw `sum(ranges[].count)` would enforce a ceiling
roughly 3× stricter than the one this spec states and measured — about 4,000 real triangles, not
`12_000` — and the measurements the ceiling is derived from are unambiguously in triangles: the spike
sizes every geometry as `index.count / 3` (`spike/measure.mjs`) and counts triangles as
`index.length / 3` (`spike/geometry-core.mjs`'s `connectivity`). The conversion is still free to
compute, proportional to the number of ranges/groups (typically a handful), never to triangle count — so
**`maxSyncTriangleCount` is checked against `activeTriangleCount` before any copying happens**: a
fragment whose active set alone exceeds the ceiling is marked oversized and diagnosed exactly as before,
without ever materializing a compacted buffer for it. Only once that check passes does
compaction actually copy triangle data, so its own cost is bounded by the now-confirmed-under-ceiling
active count — never by the size of whatever "inactive" portion of the raw buffer happens to exist,
however large. Welding, connectivity, and BVH construction (below) then all run over this **same**
compacted buffer; none of the three ever sees a triangle outside the active ranges. This is what
`maxSyncTriangleCount` unambiguously means from round 16 onward: the compacted geometry's own triangle
count, full stop — not the raw index's, whichever normalization state a given implementation happened
to check it in.

**Position is an owned, compacted-then-welded buffer, not a zero-copy view of Viewer's.** This reverses
the idea doc's "prefer sharing the original Viewer position buffer / target: zero-copy" guidance for two
compounding reasons: welding necessarily produces a new, deduplicated vertex array — and welding is what
makes connectivity, manifold classification, and therefore the containment guarantee work at all (see
above) — and, as of round 16, active-range compaction produces an owned buffer even *before* welding
touches it. The memory argument that motivated zero-copy does not survive measurement either: welding
*shrinks* geometry by ~23% on average across the primitives tested (box 24→8 vertices, cylinder
148→50), so an owned welded buffer is typically **smaller** than the shared one it replaces. Index is
likewise owned, produced first by compaction and then by the weld. `indexOwnership: 'clone'` remains the
only supported value, and `'indirect'` is now not merely unimplemented but inapplicable — indirect mode
exists to avoid reordering a *shared* index, and there is no longer a shared index to protect at any
stage of this pipeline. **Round 16 also retired the previous "set `groups`/`drawRange` on the BVH input"
workaround**: because compaction already discards everything outside the active ranges before welding
ever runs, the geometry `MeshBVH` builds over contains only active triangles to begin with — there is no
out-of-range material left for a missing `groups`/`drawRange` configuration to fail to exclude, so
`ThreeMeshBvhBackend` no longer needs to set either on the collision `BufferGeometry` it builds from.
Two simultaneous queries never build the same BVH twice — but that dedup is **not** a mechanism
`BlasCache` owns. It is the registry-level rule above applied to one phase: what a concurrent caller
observes is the published `GeometryRegistry` entry, and `accelerationPromise` is one of that entry's
single-flight phase slots, which a second caller awaits instead of starting its own BVH build (the
compaction+weld and connectivity phases dedupe identically, through their own slots on the same entry).
And **that promise does not make the underlying `MeshBVH` constructor non-blocking**: it's synchronous,
and dedup alone doesn't prevent one `findClashes` call from freezing the Viewer while it builds several
room BLASes back to back. `CollisionWorld`'s narrow phase (below) is responsible for yielding between
builds; `BlasCache` owns building the `MeshBVH` and caching it behind that phase slot — not the
not-building-it-twice rule, which the registry entry provides for every phase alike.

Yielding between *separate* builds doesn't help if a single build is itself large enough to freeze
the Viewer, and a review pass correctly pointed out the earlier draft deferred that risk entirely
rather than bounding it. Milestone 1 commits to a concrete (if provisional) limit:
`maxSyncTriangleCount = 12_000`. A geometry at or above that triangle count is **not** built
synchronously — `GeometryRegistry` marks the record oversized and emits one fragment-scoped
`geometry-too-large-for-sync-build` diagnostic (see Public API) rather than risking a
multi-hundred-millisecond freeze; every pair that would have needed that geometry is skipped. This is a deliberate scope boundary, not a
solved problem — true incremental (multi-frame) or Worker-based construction for large geometries is
explicitly out of scope for Milestone 1 (see Milestone Scope), so oversized geometries degrade to
"can't verify this pair" rather than "block the UI."

**`20_000` (this ceiling's value through round 14) does not survive round 15.** It was reasoned, then
the spike measured the BVH build alone and it survived unchanged at ~16ms for 18k triangles — but round
15 found that measurement answered the wrong question: it never measured welding or connectivity, the
two phases that (per the "Round 15 found..." note under **`ThreeMeshBvhBackend`/`BlasCache`** above) now
also each need to fit under the same per-atomic-operation ceiling individually, and a local measurement
found welding alone costs ~16.8ms at ~19,800 triangles — already over that ceiling at essentially the old
limit, on its own, before the BVH build even starts. `12_000` is a **reasoned, provisional** revision —
scaled down from the welding measurement with headroom for slower hardware and measurement variance — not
a new measured figure; it is exactly as provisional today as `20_000` was before the spike first measured
it. **The performance gate below is now required to measure each of the three phases (weld, connectivity,
BVH) individually, at this ceiling, on this repo's own geometry** — the same standard `20_000` was
originally held to — before `12_000` can be called "measured" rather than "reasoned," and the gate may
revise it again if any single phase still doesn't clear the ceiling with margin.

### Tolerances

Three separate tolerances, because the previous draft used one world-space `coplanarEpsilon` for
quantities living in different spaces and different units — a review pass correctly flagged that
`MeshBVH` raycast distances are in the **target BVH's local space** (not Viewer world space) and
that barycentric coordinates are **dimensionless** and cannot take a distance tolerance at all:

**Every tolerance is defined in the frame it is applied in.** Round 4 defined one characteristic
length in "the classification frame" and then used it inside `classifyPoint`, which does its
proximity and ray work in the *target BVH's* local frame — comparing a length from one space against
distances in another. A review pass also showed the formula `min(diagonal(A), diagonal(B→A))` isn't
symmetric under swapping the operands, since `B→A` and `A→B` differ under non-uniform scale. Both
problems come from trying to make one scalar serve two frames, so this revision stops doing that:

- **Per-BVH tolerance scale.** Each `GeometryRecord` carries `L_X := diagonal(localBounds(X))`,
  computed once in X's own local space and cached with the BLAS. Any tolerance applied against X's
  BVH is scaled by `L_X`. `classifyPoint(point, targetBvh)` therefore uses the *target's* scale — the
  frame it is actually working in — with no conversion anywhere.
- **Canonical operand order.** `ProperCrossingQuery`'s probes and its `offsetLadder` necessarily live
  in one shared frame (the one `bvhcast` traverses). Rather than derive a "symmetric" scalar, the
  pair is **canonically ordered before evaluation** — sorted by `(modelId, geometryKey,
  instanceId)` — so the classification frame is a deterministic function of the pair, not of
  argument order. Swapping the caller's arguments now runs the identical computation, making
  symmetry structural rather than a property to be argued about. `L_canonical` is then simply
  `L_X` of whichever instance sorts first, and `minPenetrationDepth` is well-defined per pair.

| Tolerance | Units | Milestone 1 default | Applied in |
|---|---|---|---|
| `barycentricEpsilon` | dimensionless (0-1) | `1e-6` | Ray-hit edge/vertex rejection (frame-free) |
| `coplanarAngleEpsilon` | dimensionless (`1−\|n·n\|`) | `1e-6` | Coplanar pair detection (frame-free) |
| `mergeDistance` | distance in target frame | `1e-6 × L_target` | Collapsing coincident ray hits |
| `surfaceEpsilon` | distance in target frame | `1e-6 × L_target` | `boundary` classification |
| `offsetLadder` | distance in canonical frame | `[1e-3, 1e-4, 1e-5] × L_canonical` | `ProperCrossingQuery` probe steps |
| `witnessLadder` | distance in **source** frame | `[1e-3, 1e-4, 1e-5] × L_source` | Constructed interior witness (`anyComponentInside` stage 3, `volume-overlap` only) |
| `crossingProbeFractions` | dimensionless (0-1), scaled per-candidate by that triangle's own available in-plane distance | `[0.5, 0.1, 0.01]` | `SurfaceCrossingWitness` in-triangle probe steps (`containment` only) |
| `minPenetrationDepth` | distance in canonical frame | `1e-5 × L_canonical` | **Declared** detection limit |

**Anisotropic scale remains a stated limitation, not a solved problem.** When the relative transform
between two instances is anisotropic, no direction-independent scalar converts a length between the
frames — so `minPenetrationDepth`, defined in the canonical frame, corresponds to a *direction-
dependent* world-space depth, bounded by the smallest and largest singular values of the transform's
3×3 linear part. Milestone 1 declares this rather than pretending a single number covers it, and
pins the behavior with a swapped-operand anisotropic-scale test fixture. Absolute world-space
tolerances, model units, and global offsets remain an open question inherited from the idea doc's
"Tolerance" section.

`minPenetrationDepth` deserves emphasis because it is a **semantic** limit, not an implementation
detail: `volume-overlap` detects overlaps deeper than it, and may classify shallower ones as mere
touching. The previous draft had exactly this limit at a *thousand times coarser* value and did not
declare it at all — a review pass correctly identified that a fixed offset steps clean through any
overlap thinner than itself, producing a false negative in precisely the thin-geometry case
(perpendicular thin boxes) where no vertex-containment witness exists either. Making the offset
adaptive shrinks the blind spot; declaring `minPenetrationDepth` makes what remains of it honest.

### Solid model

Everything below depends on what a triangle soup is taken to *mean* as a solid. Six review rounds
specified parity, "any component," and "closed manifold" separately without ever reconciling them,
and a review pass showed the pieces disagreed: the composition implied one model, the primitive
implemented another. Milestone 1 declares the model once, here.

**A target geometry's interior is defined by even-odd (parity) over its entire triangle set.** A ray
from a point crosses an odd number of surfaces iff the point is inside. This is a deliberate choice,
not an accident of using `MeshBVH.raycast`:

- It is what makes **hollow solids correct**. A pipe is an outer cylinder plus an inner cylinder;
  its bore is not material. Under even-odd a point in the bore crosses both shells, reads `outside`,
  and the pipe is correctly hollow. Under union-of-components semantics the bore would fill with
  phantom material — and pipes are not an edge case in the MEP models this library exists to serve.
- The same argument covers containers, ducts, and any Revit family whose tessellation encodes a
  cavity as an inner shell.

**Its limitation, stated rather than discovered later:** two genuinely *nested independent solids*
inside one geometry (a small box floating inside a larger closed box, both material) read the inner
region as cavity, so a source there is classified `outside`. Even-odd cannot distinguish that from a
hollow container — no parity scheme can, because the two configurations have identical triangle
sets. Distinguishing them requires per-component classification plus an orientation/nesting analysis
that Milestone 1 does not attempt. In practice Model Derivative emits separate solids as separate
fragments far more often than as nested shells within one geometry, so this trades a common
correctness win (pipes) for a rare loss. A fixture pins the behavior so it can't drift silently.

**A source geometry contributes as the union of its components.** `anyComponentInside` returns true
if *any* component has material inside the target: distinct components are distinct pieces of the
same element, and one piece inside the target is an overlap. This is union semantics on the source
side and even-odd on the target side, and that asymmetry is intentional — the source is being asked
"is any of you in there," the target is being asked "what is your interior."

**Only closed components can establish positive volume.** An open shell encloses no *certified*
volume, so its vertices reading `inside` a target proves **containment**, not **overlap**.

Round 6 stated that rule and round 7 tried to soften it — "diagnose only genuinely degenerate open
components" — which a review pass correctly rejected as unimplementable: nothing in this design
distinguishes a nearly-closed bathtub from a zero-volume sheet, and inventing a volumetric
degeneracy metric is a research task, not a milestone. It also left the spec self-contradictory (the
solid-model section said only closed components count, the API section said any open positive is
diagnosed, and a third paragraph said positives need no diagnostic at all).

The resolution is not a better metric. It is that **the room-locator was never asking a
volume-overlap question**, and squeezing it through that contract is what forced the contract to
bend. So the line is drawn at the **mode boundary** instead.

### Query modes and their preconditions

| mode | question answered | parity evaluated against | open **source** | open **target** |
|---|---|---|---|---|
| `surface-intersection` | do their surfaces meet anywhere, touching included? | nothing — no parity at all | fine, never diagnosed | fine, never diagnosed |
| `containment` | does any point **on the source's surface** lie inside the target's interior? | **target only** | fine, never diagnosed | `unverified-parity-operand` (`role: 'target'`) |
| `volume-overlap` | do the two solids share positive volume? | **both** | `unverified-parity-operand` and/or `unverified-open-component`, both `role: 'source'` — which one depends on the deciding path | `unverified-parity-operand` and/or `unverified-open-component`, both `role: 'target'` — which one depends on the deciding path |

**`containment` treats the source as a point set and the target as a solid, and that asymmetry is the
whole definition.** Round 8 caught the looser wording — "any part of the source inside the target" —
being both wrong and self-defeating: for two closed solids, "some part of A is inside B" and "some
part of B is inside A" are *the same predicate*, because if A lies within B then the region A occupies
belongs to both. Under that reading `containment` is symmetric, which makes it just `volume-overlap`
with extra steps, and the spec's own directedness fixture (`containment(room, element)` is false)
contradicts it.

Reading the source as its **surface** fixes both problems at once and is what the room-locator
actually wants:

- `containment(element, room)` — the element's surface lies within the room's interior → **true**.
- `containment(room, element)` — the room's walls do not pass through the element → **false**.
- `containment(bathtub, room)` — an open shell has a surface even though it has no certified
  interior, so the mode is well-posed for exactly the geometry that motivated it.

Directed, meaningful for open sources, and dependent only on the target being a solid.

Two consequences worth stating explicitly, because both were previously implicit and one was wrong:

- **`volume-overlap` needs *both* operands closed, including on the crossing path.** Earlier drafts
  treated `ProperCrossingQuery` as closure-free — a transverse surface crossing looks like direct
  evidence of shared volume. It isn't self-contained: step 4 decides a crossing by classifying probe
  points as `inside` **both** A and B, and that classification is ray parity. Parity against an open
  operand is unreliable whichever operand it is. So both the crossing path and the containment path
  of `volume-overlap` carry the same precondition, which is what makes the strict contract coherent
  rather than a rule with an exemption.
- **`containment` needs only the target closed.** The source is *sampled* for points; it is never
  parity-tested. Its openness therefore cannot affect soundness. That is the structural form of the
  spike's B5 insight — *which side is open matters* — expressed as a contract rather than as a
  diagnostic heuristic.

Measured on the acceptance model, this lands where it should: every room welds to a perfect closed
manifold, and the bathtub welds to 14 open components with 441 boundary edges. `containment` answers
the room-locator's question cleanly, with **no diagnostic**, because nothing unsound happened. A
caller who asks the same pair for `volume-overlap` gets `unverified-open-component` — correctly, since
a 441-boundary-edge shell is not a certified solid and this design cannot prove otherwise.

**The room-locator therefore queries `containment`, not `volume-overlap`.** Round 6's diagnostic
would have fired on essentially every real query; the mode split makes that noise disappear without
weakening any contract, because the honest answer was that the caller was in the wrong mode.

**Vertex welding is a required normalization step, not an optional repair.** Earlier drafts deferred
"welding coincident vertices" to a future milestone as a possible improvement. The spike showed it is
a precondition for the design working at all: tessellators emit per-face vertices (a `BoxGeometry`
has 24 vertices for 8 corners, because each face carries its own normals and uvs), so index-based
connectivity on raw geometry splits **a plain box into 6 components with every edge a boundary
edge** — and a cylinder into 49. `closedManifold` would be false for every solid, and the containment
guarantee would never hold once. After welding, every closed primitive tested collapses to one closed
manifold component.

So `ViewerGeometryAdapter`'s output is welded before connectivity or BVH construction:
strip to **position + index only**, then merge vertices coincident within `weldEpsilon`. The
strip must come first — `mergeVertices` compares all attributes, and per-face normals make every
vertex unique, so welding a full-attribute geometry silently does nothing. That makes the idea doc's
"do not copy rendering attributes" rule (written to save memory) **load-bearing for correctness**.

**`weldEpsilon` is a defined tolerance, not `mergeVertices`'s default.** Earlier drafts left it
unspecified and listed it as "unexamined," which a review pass correctly flagged as a gap in the one
parameter the whole design rests on. Two properties of the upstream implementation determine how it
must be specified — both verified in `three@0.185.1`'s `BufferGeometryUtils.js`:

- The signature is `mergeVertices(geometry, tolerance = 1e-4)`, and `tolerance` is an **absolute
  length in the geometry's own local units** — not relative, not normalized. A default that is
  correct for a model in feet is 1000× wrong for the same model in millimetres.
- It is implemented as a **grid quantization, not an epsilon-ball**: the vertex hash is
  `~~(v * 10^log10(1/tolerance) + tolerance/2 * …)`, i.e. truncation onto a lattice of cell size
  `tolerance` shifted by half a cell. Two vertices closer than `tolerance` still fail to merge if
  they straddle a lattice boundary. The half-cell shift makes the common case — coordinates that are
  bit-identical or differ only in the last float ulp — merge reliably, which is exactly the case SVF
  seams present, but the guarantee is "identical coordinates always merge," not "anything within
  `tolerance` merges."

`weldEpsilon` is therefore specified as a **fixed physical length converted into model units**:
`weldEpsilon = 1e-4 m / model.getUnitScale()` (0.1 mm — well below any real BIM feature, well above
float noise at building coordinates). Falls back to `1e-4` if the unit scale is unavailable.

Empirically this is not a coin flip: the spike welded the acceptance model at the `1e-4` default in
that model's own units and got **1 component, 0 boundary edges, 0 non-manifold edges for every
room** — so SVF seams there are exactly coincident, not merely near-coincident, and the grid-snap
caveat above never bites. The unit-derived value exists so that result survives a model authored in
different units, not because the default was observed to fail.

**`GeometryConnectivity`** (new) — decomposes the welded geometry into connected components by
union-find over triangles that share an **edge** (two vertex indices), restricted to the active
triangle ranges. Computed **once per unique `GeometryRecord`** and cached alongside the BLAS (not per
query, not per pair), so its cost amortizes exactly like BVH construction does. Building the edge map
also yields, for free, the manifold classification below.

Round 3 used *vertex*-sharing, which a review pass broke with a clean counterexample: two solids
joined at a single shared vertex merge into one component; if one sits inside the target and the
other outside — with only that measure-zero self-contact and no transverse crossing of the target's
boundary anywhere — then representatives drawn from the outside solid miss the contained one
entirely. Round 3's rebuttal ("they touch, so the contact query decides it") confused A touching
*itself* with A touching B; `ProperCrossingQuery(A, B)` never fires on A's internal self-contact.
Edge-connectivity does not merge vertex-joined solids, which removes that counterexample.

- Tessellated output often duplicates vertices at seams, so index-based connectivity can
  *over*-segment a visually-connected mesh. Conservative — more components means more sampling, never
  less correctness — but it inflates sample counts, which `maxContainmentSamples` caps.
- **Edge-connectivity narrows the under-segmentation hole but does not close it.** Two solids joined
  along a shared *edge* still merge, and the same construction defeats them. Rather than claim
  otherwise, `GeometryConnectivity` classifies each component while building the edge map:
  a component is **manifold** if every one of its edges is shared by exactly two triangles.
  Components with boundary edges (used once — an open shell) or non-manifold edges (used by three or
  more — the junction geometry that makes the counterexample possible) are flagged. That flag is what
  the containment guarantee below is conditioned on, and what gets reported when it doesn't hold.

**`SurfaceIntersectionQuery`** — **true iff any triangle pair from A and B has a non-empty geometric
intersection**, including zero-volume coincident contact (face-face, edge-edge, vertex-face). This
mode is *correctly named* for that behavior — it reports surface intersection, which is what touching
is. It's the right primitive for "do these two things touch at all," and it is deliberately **not**
what `volume-overlap` returns.

**It is built on `bvhcast`, not on `MeshBVH.intersectsGeometry`** — a change forced by a review pass
that found the last unbounded synchronous path in the design. Every earlier draft defined this mode
as "precisely `MeshBVH.intersectsGeometry(otherGeometry, relativeMatrix)`," and the budgets added in
rounds 5–6 bound only `ProperCrossingQuery`'s `bvhcast` callback. `intersectsGeometry` accepts no
budget, exposes no per-candidate callback, and offers no abort hook: verified in
`three-mesh-bvh@0.9.14`, its `shapecast`/`intersectsTriangle` path runs a nested loop over both leaf
ranges and returns only on the first hit or on full exhaustion. So the very failure mode
`maxCandidatePairsExamined` exists to prevent — heavily overlapping BVHs with **no** triangle
contact — freezes the Viewer through this mode instead, while the spec claimed its budgets bound the
worst case. That claim is only true once both modes traverse the same way.

The rewrite is a simplification rather than new machinery: `SurfaceIntersectionQuery` is the *same*
`bvhcast` traversal `ProperCrossingQuery` uses, sharing `maxCandidatePairsExamined`, the same
per-candidate `intersectsTriangle` test, and the same abort protocol — with a weaker predicate. It
returns `true` on the first candidate pair that intersects **at all**, so it needs neither the
coplanar split (coplanar contact *is* touching here, so it counts rather than being skipped) nor the
probe ladder (no interior classification, hence no parity, hence no closure precondition). Both modes
then have one traversal, one budget, and one abort path, and `crossing-budget-exhausted` means the
same thing in both.

**`ProperCrossingQuery`** (new) — answers "do these two solids share positive volume near their
contact," which is what `volume-overlap` actually needs and what round 2's draft wrongly conflated
with any surface hit. A review pass correctly refused the "document the conflation" response: the
idea doc defines volume overlap as solids *sharing volume* with touching as a separate mode, and the
CSG implementation being replaced already excluded touching (a BSP intersect of face-touching solids
produces no polygons), so accepting contact-as-overlap was a regression against the code this
milestone replaces, not merely an imprecision.

1. Traverse with `MeshBVH.bvhcast(otherBvh, relativeMatrix, { intersectsTriangles(triA, triB) { … } })`.
   Returning `true` from the callback early-exits the traversal.

   **The callback receives *candidate* pairs, not intersecting ones.** Round 4 assumed otherwise and
   was wrong. Verified against `MeshBVH.js` at `v0.9.14`: the `intersectsTriangles` wrapper is a
   plain nested loop over every triangle in the two overlapping leaf ranges —

   ```js
   for ( let i2 = offset2, l2 = offset2 + count2; i2 < l2; i2 ++ ) { …
     for ( let i1 = offset1, l1 = offset1 + count1; i1 < l1; i1 ++ ) { …
       if ( intersectsTriangles( triangle1, triangle2, i1, i2, … ) ) return true;
   ```

   — with no intersection test anywhere. BVH traversal narrows to overlapping *leaf bounds*; deciding
   whether two triangles actually meet is the callback's job. Round 4 would have fed non-intersecting
   pairs into segment computation, where `intersectsTriangle` returns false and leaves `targetLine`
   holding the *previous* pair's endpoints — fabricating a crossing from stale state, which is both a
   false positive and a nondeterministic one.
2. **Classify the candidate before doing anything else**, ordered so the upstream coplanar warning
   path is never entered:
   - Compute the cheap coplanarity predicate from the triangles' own planes: coplanar iff
     `|nA · nB| ≥ 1 − coplanarAngleEpsilon` **and** the planes coincide within the target-frame
     `surfaceEpsilon`.
   - **Coplanar candidate** → call `triA.intersectsTriangle(triB)` **without** a target line. If it
     reports intersection, record a *touching contribution*; either way, continue to the next
     candidate. Omitting the target argument is what avoids the warning — upstream only warns when
     asked for an output edge it cannot produce.
   - **Non-coplanar candidate** → call `triA.intersectsTriangle(triB, targetLine)`. If it returns
     false, this pair simply doesn't intersect: continue, and **do not read `targetLine`**.

   Skipping coplanar pairs is the *correct* answer, not merely the safe one: if two solids' only
   contact is coplanar face overlap, that contact has zero volume and is touching by definition. If
   they also genuinely interpenetrate, the interpenetration necessarily produces non-coplanar
   intersecting pairs elsewhere, which this loop still examines. (Verified at `v0.9.14`: the coplanar
   branch of `ExtendedTriangle.intersectsTriangle` warns and sets `target.start`/`target.end` to the
   origin, so a coplanar pair could never have yielded a usable segment anyway.)
3. For a confirmed non-coplanar intersection, take the midpoint `M` of the now-valid `targetLine`.
4. Classify by stepping off the intersection curve into the four quadrants the two surfaces locally
   divide space into. For each sign combination `(s₁, s₂) ∈ {+1,−1}²` with `d = s₁·nA + s₂·nB`
   non-degenerate, and **for each rung `δ` of `offsetLadder` from coarsest to finest**, form a
   **probe point** `P = M + δ × normalize(d)`. (Called a *probe* rather than a candidate to keep it
   distinct from the candidate *pairs* of step 1.) The pair is a proper crossing iff some probe
   classifies as `inside` **both** A and B.
   - **The ladder is what makes thin overlaps detectable.** A single fixed offset steps clean through
     any overlap thinner than itself and reports a false negative — a review pass identified this,
     and it bites hardest on thin perpendicular geometry, where there is no vertex-containment
     witness to fall back on either. Trying successively finer rungs finds the overlap as long as it
     is deeper than the last rung, which is precisely the declared `minPenetrationDepth`.
   - Winding-independent: it never assumes outward-facing normals, only that the two normals span the
     local quadrants.
   - For a genuine transversal crossing (the duct-through-beam case), the surfaces divide space into
     four quadrants, one interior to both — classified as a crossing.
5. **Inconclusive probes propagate.** A probe whose classification against either solid is `boundary`
   (see `ContainmentQuery`) proves nothing — it can neither confirm nor refute a crossing. If a
   pair's probes are exhausted with no `inside`/`inside` result but at least one `boundary` result,
   that pair is **inconclusive**, not "touching." A negative overall result that had any inconclusive
   pair carries an `inconclusive-crossing` diagnostic, so it is never reported as verified.
6. Early-exit `true` on the first proper crossing. **Two independent budgets** bound the work, because
   the expensive failure mode isn't the one round 5 bounded:
   - `maxCrossingPairsExamined = 64` counts **confirmed intersecting non-coplanar pairs** — the ones
     that reach probe classification. Coplanar pairs don't consume it; they're decided, not deferred.
   - `maxCandidatePairsExamined = 50_000` counts **raw candidate pairs** entering the callback.
     Round 5 explicitly exempted these on the grounds that each costs "only a triangle-triangle
     test," which a review pass correctly rejected: two sub-`maxSyncTriangleCount` meshes with
     heavily overlapping leaves and **no intersections at all** never consume the confirmed-pair
     budget, so nothing bounded them. With `three-mesh-bvh`'s default leaf size, a dense overlap
     between two ~20k-triangle meshes reaches millions of pairs in one synchronous, uninterruptible
     `bvhcast` — seconds of frozen Viewer, and a direct contradiction of this spec's own claim that
     the budgets bound the worst case.

   **Abort protocol.** Exceeding either budget sets an `aborted` flag and returns `true` from
   `intersectsTriangles` — the only way to stop a `bvhcast` traversal early. `bvhcast` therefore
   returns `true`, which **must not be read as "crossing found"**: the caller checks the flag first
   and, when set, reports the pair as inconclusive with `crossing-budget-exhausted` rather than as a
   crossing. Getting this backwards would turn a timeout into a fabricated clash.

   **A third, time-based trigger sets the same `aborted` flag: elapsed synchronous time since the
   traversal's own start exceeding `frameBudgetMs`.** This traversal is `bvhcast`-native and cannot
   yield or resume mid-call (see the abort protocol above — the only way to stop it early is the
   `aborted` flag), so unlike every other checkpoint in this design, which only yields when the shared
   per-call accumulator is already due and never changes
   how much work happens, a time-based abort here is destructive: it permanently ends the traversal and
   turns a would-be result into a diagnosed `crossing-budget-exhausted` negative. Reading the *shared*
   accumulator instead — as a prior draft of this passage did — would make that permanent, result-altering
   abort a function of the traversal's arrival time relative to the rest of the call's already-spent
   budget, not of this traversal's own work: two calls presented with the identical pair could reach
   opposite verdicts depending on what else ran first in the same `findClashes` call, which is exactly the
   nondeterminism-in-its-own-inputs hazard this design treats as a defect elsewhere (see round 10's own
   count-based-budget rationale below). A private, traversal-local clock avoids that: its own worst case is
   bounded by one `frameBudgetMs` span starting fresh at this traversal's own entry — at most
   ~2×`frameBudgetMs`, which sits within, not beyond, the performance gate's own tolerance band (**Round
   22: ≈24ms** — `frameBudgetMs` plus one non-preemptible/abort-only unit's own worst case, of which this
   traversal's own ~2×`frameBudgetMs` is itself one instance — see the worst-case-span formula below and
   the performance gate) — and the verdict depends only on this traversal's own cost, not on scheduling
   position. Round 10 found the two count-based budgets alone
   don't bound this stage to one frame — they bound it to ~15ms of *raw candidate rejection*, but say
   nothing about the cost of *confirmed-pair probe classification*: up to 64 confirmed pairs, each
   running up to 12 probes (4 quadrants × 3 `offsetLadder` rungs), each probe calling `classifyPoint`
   against **both** solids, and each `classifyPoint` call performing a proximity check plus up to three
   full raycasts. That cost was never measured or bounded by either existing budget, so a candidate
   pair rich in confirmed non-coplanar intersections can synchronously exceed `frameBudgetMs` while
   both counts stay under their caps.

   **Round 11 found the round-10 fix still checked at the wrong granularity: once per
   `intersectsTriangles` invocation, when one invocation for a *confirmed* pair runs its entire
   12-probe classification internally before returning.** Checking only at callback entry lets a
   single confirmed pair's full probe loop run to completion — up to 24 `classifyPoint` calls, each up
   to a proximity check plus three raycasts — before the next checkpoint has any chance to fire, which
   is exactly the unbounded span the round-10 fix was meant to close. The check therefore moves inside
   the probe loop itself: `performance.now()` is read **before each individual probe** (before forming
   `P` and calling `classifyPoint` against either solid), not once per callback and not once per
   confirmed pair. A raw candidate pair that never reaches probe classification is still checked at
   callback entry, as before — that path's per-candidate cost is already measured (~0.3µs) and small
   enough that entry-granularity is adequate there; it's specifically the probe loop inside a
   *confirmed* pair's branch that needed tightening. The moment elapsed time crosses `frameBudgetMs`
   at either checkpoint, `aborted` is set exactly as the count-based triggers do. `bvhcast` cannot be
   paused and resumed mid-traversal — there is no way to `await` inside a synchronous native callback
   — so a time-triggered abort ends this candidate pair's crossing evaluation for good, same as a
   count-triggered one, whether it fires between candidates or mid-probe-loop; the pair is reported via
   `crossing-budget-exhausted` and `findClashes` returns to an `await`-capable context, where the
   checkpoints in **`CollisionWorld`** below can actually yield to the browser.

   **This bounds the overshoot to one probe's cost (up to two `classifyPoint` calls), not one
   confirmed pair's cost (up to 24).** Whether that remaining overshoot is actually negligible depends
   on a single `classifyPoint` call's own cost, which is reasoned but not yet measured — see "Atomic
   operations and what remains non-preemptible" below for why that matters and what the performance
   gate is now required to confirm.

   Chunked or off-thread traversal is the real fix for large overlaps and is deliberately out of
   scope here (Workers are excluded from this milestone); the budget converts an unbounded freeze
   into a bounded one plus an honest diagnostic.

   **The budgets share one principle, stated in two tiers because round 11 found one flat "~16ms for
   every synchronous step" claim doesn't survive contact with the design's own non-preemptible
   primitives.** `MeshBVH` construction (`maxSyncTriangleCount`) is *already* measured at ~16ms — a
   full frame, not a fraction of one — for a single atomic operation with no internal hook to check a
   clock against. A guarantee that every synchronous span stays under, say, half a frame is simply
   false the moment a BVH build is on the critical path; the honest claim has to say what's actually
   true about each kind of primitive:

   | Budget or ceiling | Measured / reasoned cost | Value | What it bounds |
   |---|---|---|---|
   | `maxSyncTriangleCount` — **compaction + welding phase** | **Measured** (round 15, weld only): ~16.8ms to weld ~19,800 triangles. Round 16 folded active-range compaction into this same phase/checkpoint — compaction's own cost is unmeasured but bounded by the same ceiling and expected small relative to welding | `12_000` | Non-preemptible; runs whenever a `GeometryRecord` is first built, against the compacted active-range triangle set only (round 16 — see `ThreeMeshBvhBackend`/`BlasCache`), not the raw index. Own checkpoint, before it starts. |
   | `maxSyncTriangleCount` — **connectivity phase** | **Measured** (round 15): ~6.9ms to build the edge-map at ~19,800 triangles | `12_000` | Non-preemptible; independently lazy — runs the first time a mode that calls `anyComponentInside` (`containment` **or** `volume-overlap` — round 16 corrected this from "`containment`-only," see `ThreeMeshBvhBackend`/`BlasCache`) touches this record. Never runs for `surface-intersection`-only sessions. Own checkpoint, before it starts. |
   | `maxSyncTriangleCount` — **BVH phase** | **Measured** (Spike Findings): ~16ms to build a BVH at 18k triangles | `12_000` | Non-preemptible; the one phase every mode needs. Own checkpoint, before it starts. |
   | `maxCandidatePairsExamined` | **Measured**: ~0.3µs per raw candidate pair | `50_000` | Raw `bvhcast` candidate rejection — checked at callback entry, adequate at that granularity since the cost itself is tiny. |
   | one probe / one `classifyPoint` call | **Reasoned, not yet measured**: a BVH raycast against a ≤`maxSyncTriangleCount`-triangle mesh is `O(log n)` traversal, expected sub-millisecond — orders of magnitude below a frame | — | Checked before every occurrence (see the round-11 fixes below); the *composition* of many such calls is what `frameBudgetMs` bounds, not any single call's own cost. |
   | `maxFragmentsPerDbId` | **Reasoned, not yet measured**: extraction walks the node tree itself via in-callback-bounded `enumNodeChildren`/non-recursive `enumNodeFragments` (round 16 mechanism; a later invariant-audit fix, C-1, removed `getChildCount` from this walk entirely — see the `maxChildrenPerNode` row below) | `5_000` (provisional) | Bounds **cumulative work across the walk only** — aborts one dbId's extraction walk, between nodes, **as soon as** its running fragment tally crosses this, rather than after a full recursive enumeration completes. Round 17: does **not** bound any single node's own `enumNodeFragments` call — see the row below. See **Data Flow** step 3. |
   | one `enumNodeFragments(node, cb, false)` call (one node's own direct fragments) | **Round 17, reasoned, not yet measured. Round 18 correction: round 17's stated justification for treating this as unboundable is factually wrong; the classification itself is retained only because re-deriving it was outside this pass's scope.** Round 17 recorded, from the Reference Guide, that no fragment/instance-count equivalent to `getChildCount` exists and that neither class documents a way to interrupt an enumeration. Direct inspection of the pinned 7.124.2 bundle refutes both: `ObjectTree.getInstanceCount(dbId)` — "Get number of instances under the specified id" — is documented, with `getFragmentCount(dbId)` as its deprecated alias, and the Reference Guide documents for `enumNodeInstances` (the method `enumNodeFragments` aliases) that *"if the callback function returns a truthy value, a loop over the instances and child nodes will be interrupted"* — the same mechanism round 18 used to give `maxChildrenPerNode` a real bound one call over | — (no ceiling; accepted atomic risk — **flagged for re-derivation**) | **Non-preemptible, same category as the three `maxSyncTriangleCount` phases** — `maxFragmentsPerDbId`'s tally check only runs *between* nodes, never inside this call, so a single node with a pathologically large direct fragment count is an accepted Milestone-1 risk, not a bounded one. Its real worst-case cost must be measured by the performance gate rather than assumed negligible. **As of round 18 this row is unbounded by choice of scope, not by API limitation**, and a follow-up pass is required either to bound it with the two mechanisms named opposite or to state why it should not be. See **Data Flow** step 3. |
   | `maxChildrenPerNode` | **Round 18, reasoned, not yet measured — and deliberately not derived from any existing measurement.** No row of this table measures a callback-driven native enumeration, and the ~0.3µs `bvhcast` candidate figure is a different API boundary (it excludes native enumeration overhead, callback dispatch, and list growth), so it is **not** borrowed as a proxy. `10_000` is a provisional total-work and compatibility limit, set far above any ordinary node's fanout and far below a pathological one, pending the gate | `10_000` (provisional) | **Enforced, and the enforcement is the point — by exactly one mechanism, not two.** Round 18 credited `getChildCount(node)` as a cheap early-reject layer ahead of the in-callback abort; a subsequent invariant audit (finding C-1) found that credit false for the ordinary case — for a node that owns fragments (a "mixed" node), `getChildCount` is not O(1), it linearly scans the same child slots `enumNodeChildren` would walk, with no early-exit hook of its own, so calling it first is strictly worse than the call it was meant to gate. **`getChildCount` is removed from this enforcement path entirely — it is never called here, for any node shape.** The **in-callback abort inside non-recursive `enumNodeChildren(node, cb, false)`** is the sole enforcement mechanism: the callback counts its own invocations and returns truthy the moment the count would exceed `maxChildrenPerNode`, which the Reference Guide documents as interrupting the enumeration, so one call costs at most `maxChildrenPerNode + 1` callbacks regardless of the node's real fanout — for a fragment-free node exactly as for a mixed one, with no distinction in the enforcement logic. The abort tripping rejects the whole `findClashes` call, naming the node, its observed (partial) child count, and the dbId — the same plain rejection `maxFragmentsPerDbId` uses, not a `ClashDiagnostic`. **This spec does not claim `10_000` callbacks fit inside `frameBudgetMs`**; that remains unmeasured, and the gate is required to measure it. See **Data Flow** step 3. |
   | `maxBroadPhaseInstancePairs` | **Reasoned, not yet measured**: one AABB-overlap test is O(µs); the scan itself is the O(sourceCount×targetCount) concern, not any single comparison | `1_000_000` (provisional) | Rejects the whole `findClashes` call, before the nested AABB scan begins, if `sourceInstances.length × targetInstances.length` would exceed this — checked via overflow-safe division (`sourceCount > ceiling / targetCount`), not multiplication. **Round 18: this ceiling bounds how many pairs are tested, not how long the scan blocks for** — at O(µs)/test the ceiling case is ~1,000ms, ~60× the gate's own ~16ms criterion — so the scan is no longer one synchronous span. It now checks the shared `frameBudgetMs` accumulator **before each individual instance pair**, yielding and resuming mid-scan (see **Data Flow** step 3), which moves it from non-preemptible to **cooperatively yieldable** and keeps overshoot bounded by one AABB test, per round 11's rule. The ceiling is retained, unlowered: with an inner checkpoint it bounds total *work* — and, separately, candidate-list memory and the narrow-phase work the scan hands downstream, neither of which chunking reduces. Its value still needs measurement. |
   | `releaseEpochScopedState`'s (and `dispose()`'s equivalent) per-epoch registry sweep | **Unmeasured, uncategorized in this table until this pass.** Grew from "drop some map entries" (round 15) into a real per-entry enumerative pass with per-entry cancellation-signal rejection (round 18's C3) and an oversized-marking carve-out (round 20), with no prior round classifying it here | — (no ceiling; accepted atomic risk) | **Non-preemptible, same category as one `enumNodeFragments` call and the three `maxSyncTriangleCount` phases.** Runs entirely inside the Viewer's own uncaught-throw-sensitive `BEFORE_MODEL_UNLOAD_EVENT`/`dispose()` call frames (see **`world.evictModel`**'s "Race safety" note), enumerating every `GeometryRegistry` entry filed under one epoch and settling each `'building'`/`'ready'` entry's cancellation signal in the same synchronous step; cost scales with the number of live entries under that epoch, which nothing in this design ceilings. No checkpoint exists inside it — it is required to be non-throwing (see **`world.evictModel`**), not preemptible. Its real worst-case cost must be measured by the performance gate rather than assumed negligible. |
   | `maxCollisionInstancesPerEpoch` (the `CollisionInstance` identity cache's per-epoch capacity check, see **`GeometryRegistry`**) | **Reasoned, not yet measured.** A synchronous size comparison against a bucket's current count is O(1) per affected epoch; the check itself is cheap. What is unmeasured is the retention this ceiling accepts: unlike every other bounded structure in this table, a resident canonical instance is never individually evicted while its epoch stays live (evicting one would break the stable-object-reference guarantee the stale-eviction fixture under **`world.evictModel`** depends on), so retained memory for a long-lived epoch grows monotonically toward this ceiling and stays there | provisional, value not yet chosen | Rejects the whole `findClashes` call, before any cache bucket changes or broad-/narrow-phase work starts, if publishing the call's missing instances would push any affected epoch's bucket over the limit — checked once per call, synchronously, with no intervening `await` between the check and committing every missing instance, so two concurrent calls cannot both pass against the same stale capacity observation. This bounds worst-case retained *count*, not retained *bytes* — a `CollisionInstance`'s own footprint (`fragmentId` + `GeometryIdentity`) is small and fixed-shape, but the product with a long-lived epoch's total unique fragment count is what the performance gate must actually measure. |

   The previously-guessed `200_000` for `maxCandidatePairsExamined` corresponds to ~53ms — three-plus
   dropped frames — which is why it drops to `50_000`. `maxSyncTriangleCount`'s three rows share one
   value (`12_000`, provisional pending round 15's required re-measurement — see `ThreeMeshBvhBackend`/
   `BlasCache`) because they gate the same underlying build pipeline at the same triangle count; they are
   split into three rows because round 15 found each phase is its own non-preemptible atomic operation
   with its own checkpoint, not one operation with one cost. `maxFragmentsPerDbId` and
   `maxBroadPhaseInstancePairs` are new in round 15 (see below) and, unlike every other row in this
   table, have not been measured at all yet — they exist to close the "no checkpoint or ceiling"
   gap Codex's round-15 review identified for extraction and the broad-phase scan, using the same
   "reject the excess rather than silently degrade" pattern `maxSyncTriangleCount` already established,
   pending real measurement.

   **Atomic operations and what remains non-preemptible.** Two genuinely different claims were being
   conflated under "the budgets bound the worst case," and round 11 was the second time that conflation
   produced a real gap (round 10 closed the cross-stage/cross-pair composition gap; round 11 closed the
   within-stage checkpoint-granularity gap; round 15 closed a *coverage* gap — see below):

   - **A per-atomic-operation ceiling.** Round 11 through 14 described exactly one primitive in this
     design as costing a full frame on its own with no internal checkpoint possible: a `MeshBVH` build.
     **Round 15 found that framing incomplete, not wrong** — the BVH build genuinely is one such
     primitive, but welding and connectivity construction are two more, previously undeclared and
     unmeasured, each capable of costing as much or more (see the table above). All three now get the
     same treatment: the yield-and-revalidate-before-each-phase rule under **`ThreeMeshBvhBackend`/
     `BlasCache`** gives each phase its own hard ceiling on *its own* cost, so no phase ever compounds
     with another build phase in the same span. **Round 22 correction:** that per-phase checkpoint is
     not a guaranteed yield — it is the same conditional, shared-`frameBudgetMs`-accumulator check every
     other checkpoint in this design uses (see the cooperative-composition bullet immediately below and
     `bvhcast`'s clock-basis passage under `ProperCrossingQuery`'s budgets, the one documented exception).
     It yields only when the accumulator is already due. A phase whose checkpoint finds the accumulator
     not yet due runs immediately, in the same span as whatever cooperative work already accumulated —
     see the corrected worst-case-span formula below for what that composes to. Through Round 21 this
     passage read "each phase either *is* the whole span … or doesn't share a span with meaningful other
     work," which stated the opposite of the conditional rule this document states explicitly elsewhere.
     Every other atomic primitive that participates in a synchronous span — one raycast, one proximity
     check, one `classifyPoint` call, one probe — is expected to be a small fraction of a frame, but that
     expectation is **reasoned, not measured**, unlike the three build-phase rows. This spec does not
     claim it as fact; the performance gate below is now required to measure it before this guarantee can
     be called verified rather than designed.
   - **An abort-only ceiling**, for `ProperCrossingQuery`'s `bvhcast`-native `intersectsTriangles`
     traversal (see `ProperCrossingQuery`'s budgets above for the full derivation). It cannot pause and
     resume once started, so its ceiling is enforced by permanently aborting it rather than by a
     checkpoint inside it, and its **own** duration is self-bounded independent of what ran before it —
     a private, traversal-local clock, deliberately not the shared accumulator (see the clock-basis
     passage), worst case ~2×`frameBudgetMs`; this is the one documented, deliberate exception to the
     shared-accumulator convention every other checkpoint in this design follows (Round 21's H-B7). But
     the checkpoint that decides *whether to start* that traversal at all — the ordinary pair/stage
     checkpoint under **`CollisionWorld`** — is the same conditional, shared-accumulator check as the
     build-phase bullet above, not a guaranteed yield. This traversal's self-bound describes its own
     cost once started, not the full span it can end up part of — the same composition gap as the build
     phases, folded into the same corrected formula below. **`SurfaceCrossingWitness` is a second
     `bvhcast`-native traversal (see `ProperCrossingQuery`'s budgets, "the contrast with
     `ProperCrossingQuery`'s four-quadrant probe") but is not a second instance of this exception**: its
     own passage states its time-based abort checks *the shared* elapsed-time accumulator, at callback
     entry and before every probe — not a private clock. At that fine, per-probe granularity it belongs
     to the cooperative-composition tier below (bounded overshoot: one probe's own cost) rather than to
     this one, and contributes nothing beyond that tier's existing addend to the formula. (Whether
     reading the shared accumulator inside a permanent, result-altering `bvhcast` abort — the same
     scheduling-position-dependent-verdict shape Round 21's H-B7 fix moved `ProperCrossingQuery` away
     from — is itself sound is a pre-existing question this re-derivation does not resolve; it is a
     verdict-determinism concern, not a worst-case-span-bound one, and is out of this pass's scope.)
   - **A cooperative-composition ceiling**, which is what `frameBudgetMs` actually bounds: the
     accumulated cost of many small atomic operations run back-to-back before a checkpoint gets a
     chance to fire. Round 10 added the checkpoints at pair/stage boundaries; round 11 moved them to
     fire before each individual probe (**`ProperCrossingQuery`**) and each individual `classifyPoint`
     call (**`ContainmentQuery`**, below) rather than once per callback or every 256 samples — so the
     *overshoot* past `frameBudgetMs` at any one checkpoint is bounded by one atomic operation's own
     cost, not by a batch of them. Round 15 extended this coverage further still: a checkpoint now also
     fires before extraction begins for each requested dbId and before the broad-phase scan starts (see
     **Data Flow** step 3) — the two synchronous spans Codex's round-15 review found had no checkpoint
     of their own at all, composition or otherwise. **Round 18 extended it once more, inside the
     broad-phase scan.** A checkpoint *before* the scan bounds only what runs before it, and the scan's
     own ceiling permits ~1,000ms of work behind that single checkpoint, so the scan now checks the same
     accumulator before each instance pair and yields and resumes mid-scan — at round 11's granularity,
     not a batched one, so the overshoot claim above continues to hold for it. It is a plain JS loop
     this library drives, so unlike the native traversals it can genuinely be paused rather than only
     aborted. **Every checkpoint named in this document — the build-phase checkpoints and the
     `bvhcast`-entry checkpoints included — is this same mechanism**, except `bvhcast`'s own internal
     abort clock once a traversal is already under way. A checkpoint that finds the accumulator not yet
     due does not yield at all; it lets whatever non-preemptible or abort-only unit follows it run to
     completion in the same span.

   **Round 22 re-derivation (closing `invariant-audit-v5.md`'s H2): the worst-case single synchronous
   span is `frameBudgetMs + [worst-case cost of the one non-preemptible or abort-only atomic unit, if
   any, that immediately follows a checkpoint which found the accumulator not yet due]`, not the
   two-term `max(frameBudgetMs + one small atomic operation's cost, one build-phase's own cost)` this
   section stated through Round 21.** That prior formula's second term treated entering a build phase (or
   a `bvhcast` traversal) as if it always started a fresh span — the same "checkpoint always yields"
   premise the two bullets above now name as false for every checkpoint in this design. Once a
   checkpoint's yield is understood as conditional, a build phase or a `bvhcast` traversal can begin
   after up to `frameBudgetMs` of already-accumulated, not-yet-discharged cooperative work in the same
   span and — being non-preemptible or abort-only once started — adds its own full worst-case cost on
   top before the *next* checkpoint gets a chance to run at all:
   - For the cooperatively-yieldable tier (one raycast, one proximity check, one `classifyPoint` call,
     one probe, one AABB test), the addend is unchanged from round 18: one small atomic operation's own
     cost, sub-millisecond and negligible relative to `frameBudgetMs`. This part of the prior formula's
     first term was correct and stays.
   - For the enforceably-bounded, non-preemptible tier (the three `maxSyncTriangleCount` build phases;
     the `maxChildrenPerNode`-capped `enumNodeChildren` call), the addend is that unit's own worst-case
     cost. Of this tier's four members, three are measured — welding is the largest, at ~16.8ms, at the
     sync-triangle ceiling — and `frameBudgetMs` (`8`) plus that is **≈24ms**, not the ≈16ms this section
     stated through Round 21, about 1.5× larger, because the prior figure silently dropped the
     `frameBudgetMs` prefix. **The fourth member, one `enumNodeChildren` call at the `maxChildrenPerNode`
     ceiling, is not one of the three measured costs this ≈24ms is computed from** — its own cost is
     "reasoned, not measured — and deliberately not derived from any existing measurement" (see the
     atomic-operations table). It is enforced (capped at `maxChildrenPerNode + 1` callbacks), not
     ceiling-less like the two excluded accepted-risk rows below, so it belongs in this tier and this
     formula in principle — but **≈24ms is provisional for it specifically until the performance gate
     measures it** (gate criterion 7, below): if that measurement exceeds ~16.8ms, this tier's addend,
     and the ≈24ms figure everywhere it's cited, must be revised upward to match, the same way
     `maxSyncTriangleCount`'s own value stayed provisional until its three phases were measured.
   - For the abort-only tier (`ProperCrossingQuery`'s `bvhcast` traversal — the one with the private,
     traversal-local clock; `SurfaceCrossingWitness`'s own `bvhcast` traversal reads the shared
     accumulator instead and falls under the cooperatively-yieldable tier above, not this one — see the
     abort-only bullet), the addend is that traversal's own self-bounded worst case, ~2×`frameBudgetMs`
     (~16ms, independently derived under `ProperCrossingQuery`'s budgets and unchanged by this
     re-derivation), giving the same `frameBudgetMs` + ~2×`frameBudgetMs` ≈ **~24ms** composed span.

   **Any number of checkpointed units may share a synchronous span — not only one.** An earlier draft of
   this passage claimed only one non-preemptible/abort-only unit could ever be the one absorbing prior
   undischarged work in a given span, reasoning that any such unit at or near this ceiling already costs
   more than `frameBudgetMs` on its own. That is false at the doc's own measured figures: connectivity
   (~6.9ms) is *itself* below `frameBudgetMs` (`8`), so a checkpoint immediately following it does not
   necessarily find the accumulator overdue — see **`ThreeMeshBvhBackend`/`BlasCache`**'s corrected
   per-phase discussion for the concrete counterexample (connectivity then BVH sharing one ~22.9ms span).
   The bound does not depend on how many units share a span, only on this: whichever unit is *last* in
   the span, the checkpoint immediately before it did not yield, so the aggregate cost of every unit that
   ran earlier in that same span is itself below `frameBudgetMs` — that is exactly the condition that let
   the checkpoint before the last unit proceed. The span's total is therefore that sub-`frameBudgetMs`
   prefix plus the last unit's own cost, which is at most `frameBudgetMs` + `Cmax`, where `Cmax` is the
   greatest worst-case cost of any covered atomic unit — regardless of how many earlier units, or which
   ones, contributed to the prefix.

   **This corrected formula is still not a finite worst-case-span guarantee for the whole design, and
   Round 22 does not claim it is one** — for the same reason this section already gave through Round 21:
   the table above deliberately contains rows with no ceiling at all — one non-recursive
   `enumNodeFragments(node, cb, false)` call, and `releaseEpochScopedState`/`dispose()`'s own per-epoch
   registry sweep (see the atomic-operations table), for which **this spec claims no bound and accepts
   the cost as a Milestone-1 risk**. Both rows, and the `enumNodeFragments` atomic risk rounds 16 and 17
   tracked more generally, are **explicitly excluded from the formula above and from any finite
   worst-case-span guarantee this spec makes.** A model in which one node directly owns a pathological
   fragment count, or one epoch accumulates a pathological number of live `GeometryRegistry` entries,
   can produce a single synchronous span longer than the formula's value by a margin this spec does not
   state, because it does not know it; the performance gate is required to measure
   it rather than assume it away.

   What the formula *does* bound is every span composed out of primitives that are actually ceilinged:
   the three `maxSyncTriangleCount` build phases, the `maxChildrenPerNode`-capped `enumNodeChildren`
   call, `ProperCrossingQuery`'s `bvhcast` traversal's own self-bounded worst case (see the abort-only
   bullet above for why `SurfaceCrossingWitness`'s own traversal is covered by the
   cooperative-composition tier instead), the now-chunked broad-phase scan, and the per-primitive
   checkpoints above. Even over those it
   is only as good as the table's unmeasured rows — which is why closing the measurement gap (the three
   build phases, extraction's aggregate walk, one `enumNodeFragments` call on its own, one
   `enumNodeChildren` call at the fanout ceiling, and the broad-phase scan's longest uninterrupted span)
   is a required part of the performance gate rather than an assumption this spec quietly relies on.
   This is also the concrete reason for the standing warning under **Risks**: treat "the budgets bound
   it" as a property to re-verify whenever a new traversal is added, not as a standing invariant.

   **These count-based budgets (`maxCandidatePairsExamined`, `maxCrossingPairsExamined`,
   `maxContainmentSamples`) still bound each stage's total *work* — how much can happen at all — which
   the time-based checkpoints don't replace.** Composition across stages and pairs is a further,
   distinct concern: round 9 found that `volume-overlap` runs `ProperCrossingQuery` and up to two
   `ContainmentQuery` component-sampling passes per candidate pair, each individually bounded as above,
   with nothing yielding *between* them — so a single pair, or a run of pairs whose BLASes are already
   cached, could still block for several such spans back to back. See **`CollisionWorld`**'s
   `frameBudgetMs` checkpoint for that mechanism; it wraps these budgets and the per-primitive
   checkpoints above rather than replacing either.

   Both mechanisms key off the same constant and the same clock; they differ only in *where* the check
   runs and *what happens* when it trips — abort-and-diagnose inside a synchronous native traversal
   that cannot pause, versus genuinely yield-and-resume in plain JS loops that can (see
   **`ContainmentQuery`**'s sampling stages below, and **`CollisionWorld`** for the pair/stage
   boundaries).

**`ContainmentQuery`** — point classification against a mesh. It exposes **two layers**, and keeping
them distinct is what stops the design from being circular:

- `classifyPoint(point, targetBvh) → 'inside' | 'outside' | 'boundary'` — the low-level primitive.
  `ProperCrossingQuery` uses only this, on its own synthesized candidate points.
- `anyComponentInside(source, target)` — the per-component sampling wrapper below. Called by
  `VolumeOverlapQuery` (only *after* `ProperCrossingQuery` has returned false) and by
  `ContainmentModeQuery` directly, with no `ProperCrossingQuery` term ahead of it — see
  **`ThreeMeshBvhBackend`/`BlasCache`** above for the full caller list and **`ContainmentModeQuery`**
  below for why containment has nothing ahead of it.

So the guarantee below (which assumes no proper crossing) never depends on a result that depends on
it: the primitive has no such precondition, and only the wrapper does.

**`classifyPoint` is three-valued, and the `boundary` case is load-bearing.** Round 3's boolean
`isPointInside` had a defect a review pass correctly identified as undoing round 3's entire headline
fix: a point lying exactly *on* a target face produces a hit at distance ≈ 0 (raycasting starts at
`near = 0`), that hit sits in a face's *interior* so the barycentric edge/vertex rule doesn't reject
it, and parity therefore counts it — classifying a boundary point as `inside`. A box resting on
another box has its entire bottom face on the target's boundary, so pure face contact would have
come back out as `volume-overlap`, exactly the behavior round 3 existed to eliminate.

1. **Surface-proximity pre-check.** `MeshBVH.closestPointToPoint(point)`; if the distance is
   ≤ `surfaceEpsilon`, return `boundary` immediately. This both fixes the misclassification and
   guarantees the parity ray below cannot encounter a near-zero hit — the point is now known to be
   strictly off the surface, so the degenerate case simply cannot arise rather than needing to be
   special-cased after the fact.
2. **Parity test**, in the target BVH's own local space throughout:
   - Cast with `THREE.DoubleSide` explicitly. `MeshBVH.raycast` defaults to front-face-only, which
     silently breaks parity counting — a back-facing crossing wouldn't register.
   - Ray directions are **generic (non-axis-aligned) directions in the target BVH's local frame** —
     three of them, tried in order, e.g. `normalize(1, 0.3178, 0.1234)`, `normalize(0.2189, 1,
     0.4567)`, `normalize(0.4321, 0.1357, 1)`. Local-frame (not world) because a world axis would
     need transforming into the target's frame under any rotated or scaled instance transform.
     **Non-axis-aligned because the spike proved axis directions are pathological here**: a ray
     along local +X from a symmetric interior point of an axis-aligned box hits the exact centre of a
     face, which is exactly where the two triangles of that face meet, so the hit grazes their shared
     diagonal; +Y then does the same; both retries graze and the box's own centre returns `boundary`.
     BIM is largely axis-aligned boxes, so this failed on the very first fixture and would have
     failed pervasively in production. Directions with no rational relationship to each other or to
     the axes don't systematically align with mesh features.
   - **Sort hits by distance, then** collapse runs closer together than `mergeDistance` into a single
     crossing before counting parity. This handles genuinely coincident *surfaces* — duplicated
     triangles, double-sided wall geometry — where two distinct triangles are hit at the same
     distance. Sorting must precede merging; `MeshBVH.raycast` does not guarantee ordered hits.
   - A hit whose barycentric coordinates put it within `barycentricEpsilon` of a triangle edge or
     vertex is inconclusive *for that ray*: the ray has grazed a seam where the crossing count is
     unreliable. **Retry along the next direction in the list above**, up to all three. If every
     direction grazes, return `boundary` — the point is unresolved, and `boundary` is exactly the
     "cannot say" value. (Earlier drafts said "retry along the alternate local *axis*," left over from
     when the directions were the local axes. A review pass caught that the wording survived the fix
     and would have reintroduced spike defect A1 — retrying along an axis is precisely what makes a
     box's own centre classify `boundary`.)
   - Otherwise return `inside` for odd parity, `outside` for even — **even-odd across the target's
     entire triangle set**, which is the declared solid model (see **Solid model**), not an
     incidental consequence of how `MeshBVH.raycast` reports hits. A point inside two nested shells
     reads `outside`, which is correct for a hollow pipe and is the stated limitation for genuinely
     nested independent solids.

**`anyComponentInside` samples per connected component, not against a global cap.** Round 2's flat
"up to 64 points" had a false negative: an unsampled component of A could be contained in B while
every sampled component sits outside, with no diagnostic emitted. The fix isn't a bigger cap — it's
sampling the right decomposition:

> **The containment guarantee, and its preconditions.** `anyComponentInside` only decides the outcome
> once no proper crossing exists between source and target — established by `ProperCrossingQuery`
> returning false for `VolumeOverlapQuery`, and by `ContainmentModeQuery`'s own two-stage negative for
> `containment`, which has no `ProperCrossingQuery` term ahead of it (see **Stage ordering is
> cheapest-first**, under `ContainmentModeQuery` below). For a component
> that is a **closed manifold solid**, passing from B's interior to its exterior would require
> transversally crossing B's boundary, which *is* a proper crossing. So such a component is wholly
> inside or wholly outside (possibly with zero-volume boundary contact), and **one conclusive sample
> determines it exactly.** Covering every component then makes the containment step exact.
>
> **That guarantee is conditional, and round 3 stated it unconditionally — which was wrong.** A
> review pass supplied the counterexample: a component that is *not* a single manifold solid — two
> solids joined at a shared vertex or edge — can have one part inside B and the other outside, with
> no transverse crossing anywhere, so representatives drawn from the outside part miss the contained
> one. Edge-connectivity (see `GeometryConnectivity`) removes the shared-vertex form of this, but not
> the shared-edge form. The honest statement is therefore:
>
> - **closed manifold component** → the guarantee holds, exactly as argued above;
> - **non-manifold or open component** → sampling is best-effort, and the component is flagged.
>
> **Flagging follows whichever component decided the outcome, in either direction.** Round 5 emitted
> `non-manifold-component` only on *negative* results, which a review pass showed is backwards for
> the case that matters most: a single open triangle sitting inside a closed box has **zero volume**,
> so it cannot overlap anything — yet one of its vertices classifies `inside`, `anyComponentInside`
> returns true, and round 5 reported a *clean* clash with no diagnostic at all. Containment can
> establish positive volume only for a component certified closed (see **Solid model**). So, **in
> `volume-overlap` mode**:
>
> - a **positive** result whose deciding component is not a certified closed manifold emits
>   `unverified-open-component` — the containment is real, the *volume* overlap is not certified.
>   **`role` names whichever public operand supplied that component, and round 9 found the spec never
>   said so.** `volume-overlap`'s composition (see below) evaluates containment in *both* directions —
>   `anyComponentOf(A) inside B` and `anyComponentOf(B) inside A` — and either term can decide the
>   positive. When the first term decides, the sampled (and possibly open) component belongs to the
>   public **source**; when the second term decides, it belongs to the public **target**. A closed
>   public source containing an open-triangle public target decides via the second term, so the
>   diagnostic must read `role: 'target'` — a case the previous wording ("decided by an open SOURCE
>   component") had no way to express and the spike consequently under-reported. The role follows the
>   deciding term exactly as `unverified-parity-operand`'s does (see the role table under Public API),
>   just for the containment terms rather than the crossing and containment-parity ones;
> - a **negative** result involving any flagged component emits `non-manifold-component`.
>
> In **`containment`** mode neither rule applies to the source at all: that mode's contract is
> containment, which open sources answer soundly, so an open source is not a caveat and is never
> diagnosed. See **Query modes and their preconditions** for why this is a contract split rather than
> the "genuinely degenerate component" test round 7 attempted and could not define.
>
> **The target side is a separate precondition, and rounds 6–7 omitted it entirely.** Both rounds
> observed that target openness is what actually breaks parity, then wrote flagging rules that only
> ever inspect the *sampled source component*. A review pass caught the consequence: a perfectly
> closed source classified against an **open target** returns a **clean** result — positive or
> negative, no diagnostic — even though every parity read behind it is meaningless. That is the
> unsound-but-clean case the diagnostics exist to prevent, arrived at from the other side.
>
> So parity carries an explicit closure precondition, checked once per pair before any sampling:
>
> - **every operand that parity is evaluated against must be a certified closed manifold.** If one is
>   not, each result depending on that parity — positive *and* negative — carries
>   `unverified-parity-operand` naming that operand's role.
> - **Which operands those are depends on the deciding path, not on the mode alone.** Round 7 wrote
>   this rule as target-only, which is right for `containment` and wrong for `volume-overlap`'s
>   crossing path, where probes are classified against *both* solids. See the role table under Public
>   API for the per-path rules; the short version is that a crossing can indict either side, while a
>   containment term indicts only the container.
> - The check is free: `GeometryConnectivity` already computes manifold classification per geometry
>   and caches it alongside the BLAS, so this reads a cached flag rather than adding a pass.
>
> Measured on the acceptance model: **every room welds to a perfect closed manifold** (1 component,
> 0 boundary edges, 0 non-manifold edges), so the side that must be closed is closed and
> `unverified-parity-operand` never fires for the room-locator. It exists for the federated and
> MEP-heavy models where it will.
>
> Positives are reported as true rather than suppressed throughout. For the room-locator that is the
> useful answer — an open-shell fixture inside a room should be located in that room — and the
> diagnostics are what keep each mode's contract honest about what was actually proven.

**Finding a conclusive sample is the algorithm's job, not luck.** Round 4 stopped after 4 arbitrary
vertices, which a review pass showed does not deliver what the guarantee promises: a solid sitting
deep inside a room while sharing one coplanar face with it has no proper crossing, so it falls
through to containment — and if all 4 picks land on that shared face they all read `boundary`, and a
deep, unambiguous overlap comes back as a (diagnosed) non-overlap. "One conclusive sample decides the
component" is only a guarantee if the search actually pursues one. Three escalating stages, per
component — **the third is scoped to `volume-overlap` only; see the note after stage 3 for why
`containment` stops after the second:**

1. **Spatially-spread vertex sampling.** Walk the component's referenced vertices on a stride
   (`ceil(n / samplesPerComponent)`, `samplesPerComponent = 8`) rather than taking the first few, so
   the initial picks can't all come from one face of a mesh whose vertices are stored face-by-face —
   the exact storage order that makes the counterexample above likely rather than exotic. Stop at the
   first `inside` or `outside`.
2. **Continue through the component.** If every strided pick reads `boundary`, keep walking the
   component's remaining vertices until one is conclusive or the component is exhausted. On a
   manifold component this is where the guarantee is actually discharged: `boundary` reads mean the
   sample sat on shared surface, and any vertex off that shared surface resolves it.
3. **Constructed interior witness.** If *every* vertex of the component reads `boundary` — possible
   when the component's entire surface is coincident with the target's — synthesize a point in the
   component's own interior instead of relying on its surface: take a triangle of the component, and
   from its centroid step along ±normal by each **`witnessLadder`** rung, keeping the first probe
   that `classifyPoint` puts `inside` **the component's own geometry**. That probe is interior to the
   source by construction, so classifying it against the target decides the component. Try up to
   `maxWitnessTriangles = 8` triangles before giving up.

   **`witnessLadder` is scaled by `L_source`, not `L_canonical`.** This stage constructs and
   validates points entirely in the *source component's* own local frame — the centroid, the normal
   step, and the `classifyPoint` call against the source's own BVH all live there. Round 5 reused
   `offsetLadder`, which is scaled by the canonical operand's `L`; when the source sorts second and
   the two local scales differ, its rungs are wrong in that frame — too coarse and the step exits the
   source entirely, too fine and it lands within the source's own `surfaceEpsilon` and reads
   `boundary` forever. Round 5 established the per-frame tolerance principle and then missed this
   instance of it; `witnessLadder = [1e-3, 1e-4, 1e-5] × L_source` applies it consistently.

   **This stage is scoped to `volume-overlap`; `containment` never runs it, and round 9 was the
   correction of an earlier draft that ran it in both.** The witness is deliberately constructed
   *inside the source's own volume* — a point off the surface entirely — which is exactly right for
   `volume-overlap`'s question ("do the two solids share volume") but wrong for `containment`'s, whose
   contract is restricted to points **on the source's surface** (see **Query modes and their
   preconditions**). Two coincident closed boxes are the counterexample: every source-surface point
   sits exactly on the target's boundary, so surface containment must read false, but a witness
   constructed just inside the shared surface lands inside both boxes and reads true — the mode
   answering a question it explicitly declined to ask.

   `containment`'s use of `anyComponentInside` (in `ContainmentModeQuery` below) therefore stops after
   stage 2. **This is not the same as asserting the component is clean-false** — "every vertex reads
   `boundary`" does not *prove* the component's whole surface coincides with the target's, only that
   the vertices sampled do; a component whose faces genuinely bulge into the interior between
   boundary-reading vertices is not ruled out by this stage alone. So a component left unresolved after
   stage 2 stays unresolved for this term, on the same "unresolved component → diagnosed negative" rule
   as every other stage-exhaustion case (see below), rather than being asserted false. What discharges
   the genuine "surface dips inside without any vertex inside" case is `SurfaceCrossingWitness`'s
   independent triangle-level search, which finds it if it exists regardless of how any vertex
   classified; if that search also finds nothing, the pair is a **diagnosed** negative, not a silently
   clean one — see **`ContainmentModeQuery`**.

Only if all three stages fail (`volume-overlap`) or the first two fail (`containment`) is the
component unresolved, and a negative result with any unresolved component emits
`inconclusive-containment`. On a non-manifold-flagged component the same stages run, but no guarantee
attaches to their result.

A global `maxContainmentSamples = 512` bounds pathologically over-segmented geometry; hitting it
emits `incomplete-component-coverage` so an unsampled-component negative is never reported as clean.

**Intra-loop checkpoint: unlike `ProperCrossingQuery`'s `bvhcast` callback, this sampling loop is
plain JS under `findClashes`'s own control, so it can genuinely yield and resume instead of only
aborting.** Round 10 found the composed-stage checkpoints added under **`CollisionWorld`** don't
bound *this* stage's own internal cost either — up to 512 samples, each a `classifyPoint` call, can
themselves run well past `frameBudgetMs` before the stage returns and the next checkpoint is reached.

**Round 11 found round 10's own fix too coarse: checking every `deadlineCheckInterval = 256` samples
still lets up to 256 `classifyPoint` calls run unchecked before a checkpoint fires — the same
granularity mistake as `ProperCrossingQuery`'s round-10 fix, just at a different batch size.** The
check moves to **before every individual `classifyPoint` call**, not batched at all: elapsed time is
read immediately before each sample's classification. If it exceeds `frameBudgetMs`, the loop `await`s
the same scheduling yield as the pair/stage boundaries, **then runs the same two-part revalidation
every other checkpoint runs — `disposed` first and directly, then the model's load epoch** (see "Race
safety" under **`world.evictModel`**) before resuming sampling from where it left off. A disposed world
aborts the whole `findClashes` call with `WorldDisposedError`; a stale epoch aborts it with
`ModelEvictedError`, exactly as a boundary-level checkpoint would. This
bounds the overshoot past `frameBudgetMs` to at most one `classifyPoint` call's own cost — see "Atomic
operations and what remains non-preemptible" under **`ProperCrossingQuery`**'s budget table for why
that cost is reasoned small but not yet measured, and what the performance gate must confirm.
Checking every call rather than batching does add `performance.now()` overhead per sample rather than
amortizing it over 256 — accepted deliberately, since correctness (bounding the actual overshoot) is
the point of this fix, and `performance.now()`'s own cost is itself far below a `classifyPoint` call's.

Unlike the `bvhcast` case, this does **not** truncate the search — sampling resumes exactly where it
paused, so `maxContainmentSamples` alone still decides whether the component is eventually unresolved;
the time check only decides how the work is *scheduled* across frames, not how much of it happens. The
same per-call-checked, yield-and-resume pattern — including that same two-part revalidation on resume
(`disposed` first, then the model's load epoch) — applies to stage 3's witness-triangle loop
(`maxWitnessTriangles = 8`, checked before each witness-triangle attempt): both this sampling loop and
stage 3's are plain JS loops with no native traversal in the way. `SurfaceCrossingWitness`, below, is
**not** a third instance of this pattern — it is its own `bvhcast`-native traversal, non-resumable like
`ProperCrossingQuery`'s, and is checkpointed accordingly (see its own abort protocol below).

**`VolumeOverlapQuery`** — the direct replacement for `ThreeBSP.intersect()`, composed from the
above. Three review rounds shaped it; the two rejected shapes are worth keeping in view because each
fixed the other's bug and reintroduced its own:

- **Round 1**: surface-intersection, then a single bbox-center point test. A bbox center isn't even
  guaranteed to lie inside its own solid (a torus's center sits in its hole) — false negatives on
  off-center containment, false positives elsewhere, and non-symmetric.
- **Round 2**: dropped the surface test entirely, bidirectional vertex sampling only. This lost
  genuine interpenetration where neither solid has a *vertex* inside the other — a duct crossing a
  beam mid-span shares real volume, but the overlap region is bounded by edges crossing faces, far
  from any vertex. No amount of vertex sampling finds it.
- **Round 3 (current)**: keep a real triangle-level test for the crossing case, but *classify* it
  instead of accepting any contact, and make the containment case exact via components:

```text
volume-overlap(A, B) :=
      ProperCrossingQuery(A, B)              // shares volume through a surface crossing
   OR ContainmentQuery(anyComponentOf(A) inside B)
   OR ContainmentQuery(anyComponentOf(B) inside A)
```

Evaluated in that order with early exit. The containment terms are *any component*, not "the whole
of A" — a two-part fixture with one part inside the room overlaps that room, and requiring total
containment would miss it.

Both directions are required for symmetry: a small fixture inside a large room and a large room
enclosing a small fixture are the same predicate viewed from either side, but only one direction has
a witness point to find. Pure touching correctly returns **false** — it yields no proper crossing
(coplanar contact is classified, not crossed), and a solid resting on another's face classifies as
`boundary`/`outside`, never `inside`. Any unresolved component, inconclusive candidate, or truncated
examination turns a negative into a *diagnosed* negative rather than a clean one.

**Known limits, stated rather than implied.** `volume-overlap` is exact for closed manifold geometry
with overlaps deeper than `minPenetrationDepth`. It is best-effort, and says so via diagnostics, for:
non-manifold or open components on either side; overlaps shallower than `minPenetrationDepth`; and
geometry that exhausts the examination budgets. Every one of these was a silent failure in an earlier
draft; the point of this milestone's diagnostics is that none of them is silent now.

**`ContainmentModeQuery`** — the public `containment` mode:

```text
containment(A, B) :=
      ContainmentQuery(anyComponentOf(A) inside B)   // a source VERTEX inside B
   OR SurfaceCrossingWitness(A, B)                   // a point on a source TRIANGLE inside B
```

One direction only, and no bidirectional evaluation — `volume-overlap` is a symmetric predicate about
two solids, `containment` is a directed question about a source surface and a target solid.

**The first term uses only `anyComponentInside`'s stages 1–2 (vertex sampling), never its stage-3
constructed interior witness — round 9's fix for the mode's surface-only contract being violated by an
off-surface sample.** See the note under **the containment guarantee** above for why: stage 3
constructs a point inside the source's own volume, which answers `volume-overlap`'s question, not this
mode's. A component left unresolved by stages 1–2 alone contributes no witness here and, if the second
term below also finds nothing, the pair is a diagnosed negative (`inconclusive-containment`), never a
witness manufactured by stepping off the surface.

**The second term is not optional, and round 7 shipped without it.** That draft defined the mode as
bare `anyComponentInside`, which samples *vertices* and stops at the first conclusive one. A source
straddling the target's boundary with no vertex inside therefore returned a **clean false**: a duct
passing through a beam, or a single large triangle passing through a room with all three corners
outside. This is precisely the failure round 2 found for `volume-overlap` — vertex sampling cannot
see an overlap bounded by edges crossing faces, at any sample count — reintroduced by splitting the
mode and dropping the crossing term along with it. `volume-overlap` never had the bug because
`ProperCrossingQuery` runs ahead of its containment terms; this mode has nothing ahead of it, so it
must find those points itself.

**`SurfaceCrossingWitness` probes within the source triangle's own plane and classifies against the
target only.** Given a source triangle properly (non-coplanarly) intersecting the target surface
along segment `L`, take `L`'s midpoint `M`, form the in-plane direction `u = normalize(nA × dir(L))`
— perpendicular to `L`, inside the source triangle's plane — and compute `dAvail`, the distance from
`M` to the triangle's own edge along `u` (the nearest point where the ray `M + t·u`, `t > 0`, exits the
triangle; `-u` is handled symmetrically and can have a different `dAvail`). Probe `P = M ± δ·u` for
`δ` in **`crossingProbeFractions × dAvail`** (`[0.5, 0.1, 0.01]`, dimensionless fractions of the
available in-triangle distance, coarsest first) rather than the canonical-frame `offsetLadder`. The
witness holds when some `P` classifies `inside` the target.

**Round 9 found that reusing `offsetLadder` here silently failed on any triangle whose own size
diverged from the pair's canonical scale.** `offsetLadder` is `[1e-3, 1e-4, 1e-5] × L_canonical`, a
length derived from the *pair's* bounding diagonal, with no relationship to any one triangle's own
size — a small triangle on a geometry with a large overall diagonal (or a source with a small triangle
alongside a distant, larger component) can have every rung fall outside the triangle, so every probe
is rejected and the candidate silently resolves to "no witness," the same clean false this stage
exists to eliminate. Scaling by the triangle's own available in-plane distance at `M`, recomputed per
candidate rather than looked up from a per-geometry cache, ties the ladder to the one quantity that
actually bounds it.

**If no rung produces a probe that both stays inside the triangle and clears `surfaceEpsilon` against
the target, the candidate is inconclusive, not a rejected witness.** This mirrors
`ProperCrossingQuery`'s step 5: a probe that can't be evaluated proves nothing, and folding it into a
clean "no witness" would silently reproduce the false negative this stage exists to close. A negative
`containment` result with any such candidate carries `inconclusive-crossing` — redefined below to cover
an unproducible in-triangle probe alongside its original boundary-classification case.

The contrast with `ProperCrossingQuery`'s four-quadrant probe is the point rather than an
implementation detail. That test steps off the intersection curve into space and demands `inside`
**both** solids, because it must prove *shared volume* — which is why it parity-tests both operands
and inherits both closure preconditions. This one stays **on the source surface** and demands
`inside` the target only, because it need only exhibit a point that is simultaneously on A and within
B. It therefore never parity-tests the source, which is exactly what lets `containment` accept open
sources while `volume-overlap` cannot. `SurfaceCrossingWitness` performs its own `bvhcast` over the
source and target BVHs — a real traversal, not the plain-JS sampling loop `anyComponentInside` uses (see
above): each `intersectsTriangles` callback is one raw candidate pair and increments a traversal-local
`candidatePairsExamined` counter before any coplanarity or intersection test, aborting the traversal past
`maxCandidatePairsExamined = 50_000`; a confirmed non-coplanar intersection that enters the probe ladder
also consumes `maxCrossingPairsExamined = 64`. At most six probes per confirmed pair — both in-plane
directions times the three `crossingProbeFractions` — each classifying against the target BVH only (at
most twelve for `ProperCrossingQuery`'s own two-classification probes, so at most half the *classification*
count per confirmed pair, though total runtime still needs measurement, not the "roughly half" this
passage previously overclaimed). Being `bvhcast`-native, this traversal cannot `await`, yield, or resume:
the shared elapsed-time accumulator is checked at callback entry and immediately before every probe, and
exceeding either count ceiling or `frameBudgetMs` sets a traversal-local `aborted` flag and returns `true`
from the callback — inspected after `bvhcast` returns, exactly as `ProperCrossingQuery`'s own abort
protocol works, producing a diagnosed negative with `crossing-budget-exhausted` rather than a witness. The
outer `CollisionWorld` checkpoint may still yield afterward.

Stage ordering is cheapest-first: vertex sampling resolves the common case (a fixture inside a room)
without any traversal at all. A negative now requires *both* stages to fail, which strictly
strengthens `anyComponentInside`'s guarantee rather than weakening it — that guarantee was stated
under "no proper crossing exists," and stage 2 is what now establishes the antecedent instead of
assuming it.

It shares `classifyPoint` verbatim with `VolumeOverlapQuery`, and `anyComponentInside` through its
first two stages — the point classification and the vertex-sampling search are identical; only the
constructed-interior-witness stage (`volume-overlap` only, see above) and the probe scaling inside
`SurfaceCrossingWitness` differ. The modes differ in what they *compose* and what they *promise*, not
in how a point is classified. See **Query modes and their preconditions** for why this exists as its
own mode rather than as a relaxation of `volume-overlap`.

Note the deliberate name split: **`ContainmentQuery`** is the internal point-classification component
(`classifyPoint` + `anyComponentInside`), used by `containment` and `volume-overlap` — never by
`surface-intersection` (see **`ThreeMeshBvhBackend`/`BlasCache`** above for the full caller list) —
`ContainmentModeQuery` is the thin
public composition above. They are not the same layer, and conflating them is what let earlier drafts
treat a containment *witness* as a volume-overlap *proof*.

**`CollisionWorld`** — the facade. Broad phase is a plain linear AABB scan over
`PlacedCollisionInstance.worldBounds` (no TLAS yet — candidate counts are small; see
"`CollisionInstance` identity cache" under `GeometryRegistry` for why bounds live on the call-local
placement, not the cached instance). Narrow phase calls
`VolumeOverlapQuery`, `ContainmentModeQuery`, or `SurfaceIntersectionQuery` per candidate pair
depending on `query.mode`, threading through the shared `frameBudgetMs = 8` wall-clock checkpoint
described under **Data Flow** below — the mechanism that bounds what the per-stage budgets in
`ProperCrossingQuery` and `ContainmentQuery` compose into across one `findClashes` call.

## Data Flow — Room Locate Query

1. On `load()`, the extension only calls `CollisionWorld.fromViewer(viewer, options)` — this just
   constructs the world, it does not resolve rooms, build `CollisionInstance`s, or build any BLAS.
   **Room discovery does not happen here.** The original version of this spec resolved room dbIds
   during `load()` and cached them for the extension's lifetime, but in this app extensions start
   with the Viewer itself (`wwwroot/viewer.js`), well before any model is loaded — `wwwroot/main.js`
   only calls `loadModel()` after later async user interaction (URN entry, translation-status
   polling), and the user can load a different model afterward. A `load()`-time cache would either
   run against no model at all or go stale the moment a new model loads.

   **Scope of the model-identity apparatus, and a known M1 gap it does not cover.** The
   `modelLifecycle`/`loadEpoch` tombstone-and-epoch scheme below (`world.evictModel`/`world.admitModel`)
   is the load-bearing correctness mechanism for as long as one `RoomLocatorExtension` instance and its
   `CollisionWorld` stay alive — including multiple admitted models, explicit eviction, delayed eviction,
   and in-flight work racing an eviction. It does not, by itself, make the *instance* survive a model
   switch, and this app's own wiring does not either: extensions are registered once, in
   `config.extensions` at `viewer.start()` (`wwwroot/viewer.js:15-24`), and `loadModel()`'s own call site
   passes `viewer.loadDocumentNode(doc, defaultGeometry)` with no options object
   (`wwwroot/viewer.js:31-41`), so `keepCurrentModels` is never set. Loading a second model therefore
   invokes `Viewer3D.tearDown()` before the new model loads, which unloads every currently-registered
   extension — this one included, via its own `unload()` — and nothing in this app re-registers it
   afterward: confirmed against the pinned 7.124.2 bundle's `Viewer3D.prototype.loadDocumentNode`
   (`keepCurrentModels`/`hasModels()` guard, `viewer3D.js:27710`, recurring in the `loadModel` path at
   `viewer3D.js:88293`), a real Viewer side effect undocumented by either method's own Reference Guide
   entry. **So on this app's current wiring, Room Locator does not survive a second model load at all —
   it is unloaded once and never comes back, a Milestone-1 application-wiring gap, not a defect in the
   identity apparatus itself.** This spec leaves the resolution open rather than papering over it: either
   the application must explicitly reload the extension (or restructure model replacement around
   `keepCurrentModels`/explicit unload+admit, keeping the extension registered and exercising
   `evictModel` normally) after each `loadModel()` call, or Milestone 1 is understood to support Room
   Locator only up to the first model replacement — neither is decided here. On the `tearDown()`-driven
   path specifically — **provided `unload()` itself completes all three of its steps** (see
   `RoomLocatorExtension.unload()`'s per-step-isolation caveat; the same proviso `unload()`'s own
   ordering note applies to the sibling case where `BEFORE_MODEL_UNLOAD_EVENT` fires into an
   already-disposed world) — `BEFORE_MODEL_UNLOAD_EVENT` fires only after `tearDown()`'s own
   extension-unload loop already ran, so this extension's listener is already deregistered and
   `world.evictModel` is never invoked for the outgoing model that way; `world.dispose()`'s wholesale
   clear and the room-cache clear already release everything a per-model `evictModel` call would have.
   *Confirmed against the pinned 7.124.2 bundle: `tearDown()`'s extension-unload loop
   (`viewer3D.js:26541-26560`) runs, and `loadedExtensions` is cleared, before `tearDown()` calls
   `this.impl.unloadCurrentModel()` (`viewer3D.js:26583`), which is the sole caller of
   `Viewer3DImpl.prototype.unloadModel` (`viewer3D.js:34052`) — the function that dispatches
   `BEFORE_MODEL_UNLOAD_EVENT` as its first statement (`viewer3D.js:34054`). This ordering is an
   internal implementation detail, not documented or guaranteed by Autodesk — revalidate on any Viewer
   upgrade.*

   - Instead, room dbIds are resolved **lazily, keyed by the exact `Model` object**, in a
     `Map<Model, Promise<number[]>>` owned by the extension — **not by `model.id`**, per round 12
     below. The first `locateElementByRoom` call for the extension's current model triggers
     `model.search(roomCategoryName, onSuccess, onError, ['Category'], { searchHidden: true })` and
     caches the resulting promise against that model object; later calls for the same object reuse it.
     This is an internal cache-keying change only — `locateElementByRoom(dbId)`'s own public signature
     is unchanged and still resolves "the current model" however it already does; see **`RoomLocatorExtension`
     does not satisfy the Viewer lifecycle or model-selection contract** in `review-comments-v12.md` for
     the deferred, separate question of whether that signature itself should take a model argument.

     **The unload hook is `Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT` (`"beforeModelUnload"`,
     `index.d.ts:324`), not left as an unnamed "model-removal notification."** Round 10 found the
     spec never picked one of the three plausible candidates the installed typings expose
     (`BEFORE_MODEL_UNLOAD_EVENT`, `MODEL_REMOVED_EVENT`, `MODEL_UNLOADED_EVENT`) — those typings
     declare the listener payload as `event: any` (no payload interface is shipped), so the handler
     must confirm `event.model` once during implementation before relying on it; Autodesk's public
     event reference documents that field, but the installed `.d.ts` alone doesn't verify it, in
     keeping with this spec's practice of citing exactly what was checked. `BEFORE_MODEL_UNLOAD_EVENT`
     specifically (not the two events named for *after* removal) is what makes the eviction below
     race-safe: it fires while `model` is still valid to read, and — because the handler runs
     synchronously within that event dispatch — invalidating this model's state inside it closes the
     race window as early as the Viewer offers any hook to close it. **That same handler calls
     `world.evictModel(event.model)` — the exact object, not `model.id`, per round 12 — before
     deleting that object's room-cache entry** — the room cache is not the only model-scoped state, and
     the previous draft evicted only it. See **`world.evictModel`** below for what "evicting" now
     guarantees under concurrent in-flight work, including why it takes the object rather than the id.

     **A room-search promise that *rejects* is removed from the cache, not left cached.** Round 10
     found the previous wording ("caches the resulting promise") didn't say what happens after a
     rejection: leaving a rejected promise in the map would replay the same failure on every later
     `locateElementByRoom` call for that model forever, even for a transient `model.search` error. On
     rejection, the handler deletes that model object's cache entry — guarded by identity, `if
     (roomCache.get(model) === thisPromise) roomCache.delete(model)`, so a bare delete can't clobber a
     newer promise a later call has since installed into the same slot — in addition to still rejecting
     the caller's in-flight call, so the next call retries `model.search` fresh rather than replaying a
     stale failure. This identity-guarded delete is unconditional: every rejection path in this
     mechanism uses it, with no special-cased exception (see the invalid-lease branches below).

     **A `model.search` callback that completes after its model was evicted must reject its original
     caller, not merely skip the cache write.** Round 12 found the round-10/11 guard only prevented a
     late callback from *writing* a stale entry — it didn't stop the callback from calling `resolve`,
     so the caller already awaiting that promise (typically still inside `locateElementByRoom`, on its
     way into `findClashes`) could receive stale room dbIds and proceed to query against an unloaded
     model, exactly the resurrection round 12 found. `model.search`'s callbacks fire asynchronously and
     are not cancellable, so a search started just before `beforeModelUnload` can still complete
     afterward.

     **Round 13 found the round-12 fix for this — checking `world.isModelLive(model)` inside the
     callback — broke the ordinary case instead: a model's very *first* room search always runs before
     that model has ever been touched by `findClashes`, so `isModelLive` (whose contract is "never seen
     before → false," see **`world.isModelLive`**) returned `false` for a perfectly live, just-loaded
     model and rejected every first lookup with a spurious `ModelEvictedError`.** The fix is to admit
     the model *before* starting the search, not to inspect its ambiguous liveness state *after* the
     search resolves:
     - Before calling `model.search`, the cache-miss path synchronously calls `const lease =
       world.admitModel(model)` and captures the returned `ModelLease` in the closure that builds this
       cache entry's promise. `admitModel` throws immediately (never starting the search) if `model` is
       already tombstoned evicted, or if the world is disposed — both surface as the promise this call
       returns being rejected with `ModelEvictedError`/`WorldDisposedError` respectively, without ever
       calling `model.search` at all.
     - The success callback now checks `world.isLeaseValid(lease)` **before** doing anything else:
       - **invalid** (the model was evicted, or the world disposed, sometime between admission and the
         callback firing) → reject, and apply the same identity-guarded delete every rejection path in
         this mechanism uses (`if (roomCache.get(model) === thisPromise) roomCache.delete(model)`) — no
         special-cased "leave the cache untouched" exception for this branch. The caller's
         `await locateElementByRoom(dbId)` now rejects instead of resolving with stale data or hanging
         silently — either of which earlier wording could produce, since a guard that only skips
         `resolve()` without calling `reject()` leaves the promise permanently unsettled. **Which error
         it rejects with follows the same disposed-first ordering every other site in this design uses.**
         `isLeaseValid` deliberately cannot say *which* of the two causes applied (see
         **`world.isLeaseValid`**), so the callback derives that outside the predicate, exactly as that
         method's own contract anticipates: it calls `world.isModelLive(model)` inside a `try`/`catch` —
         a caught `WorldDisposedError` **is** the rejection reason (the world itself is gone, and the
         callback rejects with it and returns); otherwise the lease was invalidated by eviction and the
         rejection is `new ModelEvictedError(model.id)`. Nothing can interleave between the two calls —
         both are synchronous and there is no `await` between them — so the pair reads one consistent
         world state. The `try`/`catch` is load-bearing rather than defensive habit: `isModelLive` throws
         by contract and this frame is an async Viewer callback, so the throw must be converted into
         *this* promise's rejection rather than allowed to escape uncaught — the exact failure mode
         `isLeaseValid`'s non-throwing contract exists to prevent, and the reason the common path never
         wraps anything. A disposed world therefore surfaces as `WorldDisposedError` here, consistent
         with what `admitModel` already throws synchronously on this same path when the world was
         disposed *before* the search started, and with what `findClashes` rejects with downstream;
         `ModelEvictedError` is reserved for what actually happened — this exact `Model` object was
         evicted. An earlier round had this callback collapse both causes to `ModelEvictedError`; that
         collapse is retired because it made one logical event — the world was disposed — surface as two
         different error classes depending only on whether disposal landed before or after
         `model.search`'s callback fired, while callers are explicitly told they may branch on which
         error class they got (see **Testing**).
       - **valid** → also check `roomCache.get(model) === thisCall's own promise` (guards against a
         *different* load of the same object having somehow superseded this entry, which object-keying
         makes structurally impossible for a *different* `Model` object but is still checked for the
         same-object, reused-promise-slot case) before writing the result and resolving normally.
     - The error callback (a genuine `model.search` failure, not eviction) follows the same shape: check
       `isLeaseValid(lease)` first, and on `false` apply the identical disposed-first mapping above, so a
       failure that arrives after eviction or disposal surfaces as `ModelEvictedError`/
       `WorldDisposedError` rather than the underlying search error — the lifecycle event is the more
       accurate explanation for why the caller should stop waiting. Both callbacks use one mapping, and
       both apply the identical identity-guarded delete-on-rejection rule described above — there is no
       "leave the cache untouched" exception for either callback's invalid-lease branch. A design in
       which the two callbacks classify the same invalid lease differently, or delete the cache entry in
       one but not the other, is a bug.
     Because admission is now synchronous and up front, `isLeaseValid` never has to answer for a model
     that was "never seen" — a lease only exists for a model this call itself admitted, so the callback
     always finds either a still-valid lease or one invalidated by a real eviction/disposal in between.
     This needs no new public surface beyond `admitModel`/`isLeaseValid` — everything else is state the
     extension's own object-keyed cache already has.
   - **`model.search`, not `viewer.search`** — a review pass correctly caught the previous draft
     using the latter. Per the installed typings, `Viewer3D.search` is declared with four arguments
     and no `options` parameter (`index.d.ts:1247`), so the `{ searchHidden: true }` argument would
     have been silently dropped; `Model.search` is the five-argument form that actually honors it
     (`index.d.ts:835`). It also scopes results to one model, which a cache keyed by `model.id`
     requires to be correct in the first place.
2. On a locate request: `world.findClashes({ source: { model, dbIds: [dbId] }, target: { model,
   dbIds: roomDbIds }, mode: 'containment', groupBy: 'dbId' })`, where `roomDbIds` comes from the
   per-model cache above (resolving it first if this is the first call for that model).

   **`containment`, not `volume-overlap`** — "which room is this element in" is a containment
   question, and the acceptance model shows why the distinction is load-bearing rather than
   pedantic: the bathtub welds to 14 open components, so `volume-overlap` would answer correctly but
   attach `unverified-open-component` to every result, and the extension's own rule (surface a caveat
   whenever diagnostics are non-empty) would then warn the user on every successful lookup. Asking
   the question the caller actually has produces a clean answer. See **Query modes and their
   preconditions**.
3. Inside `CollisionWorld.findClashes`:
   - Reject immediately if `source.model !== target.model` (cross-model queries are out of scope —
     see Milestone Scope).
   - **Extraction** (round 15 added the first checkpoint/ceiling this step ever had; round 16 found that
     ceiling didn't actually bound anything and fixed the mechanism, not just the number): for each
     requested dbId (source, then every target dbId), before beginning that dbId's own extraction, check
     the accumulated `frameBudgetMs` accumulator (below) and yield if due — this bounds *composition*
     across dbIds, the same way the existing pair/stage checkpoint bounds composition across pairs.

     **Round 16 found the round-15 design didn't bound one dbId's own enumeration, only claimed to.**
     `enumNodeFragments(dbId, cb, true)` (`recursive: true`) is a single, uninterruptible native call — a
     large assembly's subtree is enumerated in one synchronous burst no matter how it's checkpointed from
     outside, so a `maxFragmentsPerDbId` check performed *after* that call returns only detects an overrun
     once the freeze it was meant to prevent has already happened. The fix does not use the recursive
     form at all: `InstanceTree` also exposes `enumNodeChildren(node, cb, recursive?)`
     (confirmed present in the installed `@types/forge-viewer` typings — `index.d.ts:667-669`, alongside
     `enumNodeFragments`'s own non-recursive form, `enumNodeFragments(node, cb, false)`). Extraction walks
     the node tree itself, depth-first, using these non-recursive primitives:
     - at each node, run the **fanout ceiling**, `maxChildrenPerNode` (`10_000`, provisional — see the
       atomic-operations table), by calling non-recursive `enumNodeChildren(node, cb, false)` with an
       in-callback counting abort — **the sole enforcement mechanism, for every node shape.** Round 17
       specified `getChildCount(node)` as a normative preflight for this ceiling and round 18 kept it as
       a first layer ahead of the abort; **a later invariant audit (finding C-1) found that preflight
       layer unsound and removed it.** Round 18 re-verified `getChildCount` against the pinned 7.124.2
       bundle and credited it as a cheap early reject — O(1), it said, only for a node that owns no
       fragments, where the child count is precomputed, but degrading to Θ(direct children) for a node
       that owns fragments (a "mixed" node — the ordinary case), where the count is stored negated and
       the implementation **linearly scans the same child slots `enumNodeChildren` would walk** to
       recover it, with no early-exit hook of its own. What round 18 did not draw out: on a mixed node
       that scan is strictly *worse* than the `enumNodeChildren` call it was meant to gate — identical
       linear cost, but with zero interrupt capability — so calling it first cannot bound the mixed-node
       case and cannot even be cut short trying. No public O(1) alternative exists to fall back on either:
       `getInstanceCount`/`getFragmentCount` have the same negated/linear-scan shape. **`getChildCount`
       is therefore removed from this enforcement path entirely — it is not called here, as a preflight
       or otherwise, for any node shape.** What remains is:
       - **the bound is earned entirely inside the enumeration.** The official Reference Guide documents,
         for `enumNodeChildren` and `enumNodeInstances` alike, that *"if the callback function returns a
         truthy value, a loop over the child nodes will be interrupted and the callback result will be
         forwarded back to the caller"* — confirmed in the pinned bundle at both traversal layers. The
         walk's `enumNodeChildren` callback **counts its own invocations and returns literal `true` the
         moment the count would exceed `maxChildrenPerNode`**, so a pathological node costs at most
         `maxChildrenPerNode + 1` callbacks however many children it really has — for a fragment-free
         node exactly as for a mixed one, since the abort never inspects which shape the node is — and
         the walk then rejects the entire `findClashes` call, naming the node, its observed (partial)
         child count, and the requested dbId — the same plain call-level rejection `maxFragmentsPerDbId`
         uses, not a `ClashDiagnostic`. Three implementation constraints come with that and are normative:
         the callback records the abort in a **local flag** rather than relying on the enumeration's
         return value (the truthy result is forwarded as a dbId, and dbId `0` is falsy, so the return
         value alone silently fails to propagate); the callback **only collects child ids**, never
         descends inline (descending inside the callback would process earlier subtrees before the
         parent's own ceiling was known, and there is no way to `await` the sibling checkpoint inside a
         synchronous native callback — the same constraint `ProperCrossingQuery`'s abort protocol
         states for `bvhcast`); and the installed `@types/forge-viewer` typings declare both the
         callback and the enumeration's return as `void` (`index.d.ts:667-668`), contradicting the
         documented contract, so the abort must be pinned by a test rather than trusted to the type
         surface;
     - call `enumNodeFragments(node, cb, /* recursive */ false)` to collect *that node's own* fragments
       (not its descendants') and add the count to a running per-dbId tally. **The tally counts callback
       invocations, not distinct fragment ids** — it bounds work done, and a fragment id reported under
       more than one node costs the walk twice regardless of how many `CollisionInstance`s come out the
       other end. `CollisionInstance` construction separately dedupes by fragment id, so one Viewer
       fragment never becomes two collision instances merely because traversal reported it twice;
     - check the tally against `maxFragmentsPerDbId` (`5_000`, provisional) after every node's
       contribution — **the moment it's exceeded, the walk stops immediately** (no further
       `enumNodeChildren`/`enumNodeFragments` calls for that dbId's remaining subtree) and the entire
       `findClashes` call rejects, naming the offending dbId;
     - otherwise — the fanout ceiling having passed for this node — take the child ids the
       `enumNodeChildren(node, cb, /* recursive */ false)` call collected and descend into them one at a
       time **after that call has returned**, recursing the same way and applying the same
       `maxChildrenPerNode` in-callback-abort treatment at every node.
     This bounds the walk's *cumulative* work across nodes — a subtree with 100,000 fragments spread
     across many nodes stops enumerating once the tally crosses `5_000`, rather than enumerating all
     100,000 before rejecting. A **wide-but-fragment-empty** tree is a different failure and needs a
     different mechanism: it contributes `0` to the fragment tally at every node, so it can never trip
     `maxFragmentsPerDbId` at all, and the `frameBudgetMs` sibling checkpoint fires *between* nodes,
     never inside the one `enumNodeChildren` call that would block on a million-child node. It is caught
     by `maxChildrenPerNode`'s **in-callback abort alone**, which caps the call at
     `maxChildrenPerNode + 1` callbacks whatever the node's true fanout — the same mechanism and the
     same bound as the mixed-node case above, since this design draws no distinction between the two
     shapes in the enforcement logic. **Round 18 added the constant, the abort, and the rejection, but
     also retained a `getChildCount` preflight it credited with catching this wide-but-fragment-empty
     shape cheaply.** The invariant-audit fix (finding C-1) removed that preflight: the in-callback abort
     was already sufficient on its own to cap this case at `maxChildrenPerNode + 1` callbacks, so the
     preflight was never load-bearing here either, and removing it costs this spec nothing it relies on.
     Round 17, before either layer existed, asserted this case was already "caught by the `getChildCount`
     preflight" while specifying a preflight that only read a number nothing compared against — a
     verified cheap observation credited as an enforced ceiling, the exact "claimed vs. earned" shape
     rounds 15→16→17 spent three passes removing from `maxFragmentsPerDbId`, reproduced one native call
     over by the round-17 fix meant to close it out.
     A checkpoint against `frameBudgetMs` also fires between sibling nodes at the same depth, so
     composition across a large-but-under-ceiling subtree's many nodes is bounded the same way
     composition across dbIds already is.

     **Round 17 found this still doesn't bound one node's *own* `enumNodeFragments` call, and left it
     unbounded on the grounds that nothing could. Round 18 found that ground false, and did not have the
     scope to redesign the row.** Round 17 recorded, from the official Reference Guide, that
     `getChildCount` has no fragment-count equivalent and that neither `InstanceTree` nor `ObjectTree`
     documents a way to learn a node's direct fragment/instance count without enumerating them, or to
     interrupt one enumeration. Direct inspection of the pinned 7.124.2 bundle refutes both halves:
     `ObjectTree.getInstanceCount(dbId)` is documented ("Get number of instances under the specified
     id"), with `getFragmentCount(dbId)` as its deprecated alias, and the truthy-return interrupt round
     18 used to bound `enumNodeChildren` above is documented for `enumNodeInstances` — the method
     `enumNodeFragments` is itself an alias for.
     **The classification is nonetheless retained unchanged here, and restated as scope rather than as
     necessity.** A single pathological node that directly owns, say, 100,000 fragments still enumerates
     all of them synchronously in that one `enumNodeFragments(node, cb, false)` call before the walk's
     own tally check ever runs — the walk's per-node checkpointing cannot reach inside one native call —
     so **one non-recursive `enumNodeFragments(node, cb, false)` call remains an accepted,
     non-preemptible Milestone-1 atomic risk**, in the same category as the three `maxSyncTriangleCount`
     phases (welding, connectivity, BVH construction). `maxFragmentsPerDbId` bounds how many such calls
     the walk makes and how much cumulative tally they can reach before rejecting; it does not bound any
     one of those calls' own cost. What has changed is *why*: round 17 said no mechanism existed, which
     was wrong; round 18 says two mechanisms are available — a `getInstanceCount` preflight and an
     in-callback abort — with only the latter matching the enforcement mechanism now used for
     `maxChildrenPerNode` (the invariant-audit fix, finding C-1, found `getChildCount` unsound as a
     preflight and removed it from that row; whether `getInstanceCount` fares any better as a fragment
     preflight is unverified and belongs to this row's own re-derivation, not to that fix) — and that
     applying both mechanisms here is a required follow-up this pass did not carry out. Round 16's
     standing instruction ("if no such mechanism exists, narrow
     the Milestone-1 contract honestly rather than inventing an unenforceable hard bound") no longer
     applies to this row on its own terms, and nothing in this spec should be read as claiming it does.
     See the atomic-operations table and the performance gate, which require this risk to be measured
     rather than assumed away in the meantime.

     Capacity admission into the epoch's canonical `CollisionInstance` cache (see "`CollisionInstance`
     identity cache" under `GeometryRegistry`) happens once per call, after every requested dbId's walk
     above has completed — never per dbId, per node, or per fragment — over the walk's complete, call-wide
     unique fragment-id set (one entry per fragment; either side may have more than one):

     1. While walking, capture for each unique fragment not just its id but everything a canonical
        instance or a placement will need — `fragmentId`, `GeometryIdentity` (`loadEpoch` +
        `geometryIndex`), and this call's own `worldMatrix`/`worldBounds` snapshot — so no later phase
        needs to call back into `fragList` or any other Viewer getter.
     2. After the walk's last possible yield, look up the affected epoch's bucket **without creating it**
        if it does not yet exist, and recompute — against that bucket's *current* contents, not a count
        carried over from earlier in the walk — which of the call's unique fragment ids are still missing.
        A concurrent call's commits during any of the walk's own yields can otherwise leave an earlier
        count stale.
     3. In that same synchronous step — no intervening `await`, no call out to any external callback,
        getter, or other reentrant operation — check the affected epoch's `maxCollisionInstancesPerEpoch`
        capacity (`currentBucketSize + uniqueMissingCount`). If it would be exceeded, reject the entire
        call now: no bucket is created, no canonical instance is constructed, and no
        `PlacedCollisionInstance` is constructed for any fragment in the query. Otherwise create the
        bucket if it did not already exist and construct and publish a canonical `CollisionInstance`
        (frozen, `fragmentId` + `GeometryIdentity`, no transform state) for every missing fragment id,
        entirely from the inputs phase 1 captured.
     4. **Only after that admission succeeds**, build this call's own `PlacedCollisionInstance` values —
        pairing each canonical `CollisionInstance` (existing or just-published) with this call's own
        `worldMatrix`/`worldBounds` snapshot from phase 1 (see **Broad phase**, below, for why those must
        be call-local).

     "Look up or create," applied to this cache anywhere else in this document, means exactly this
     sequence — a lookup that finds nothing stages nothing on its own; the instance is only ever
     constructed during phase 3's admission, never earlier and never partially. This zero-mutation
     guarantee is specific to a capacity rejection: a later failure in placement construction or in the
     broad-/narrow-phase work that follows can still leave phase 3's committed instances resident, and is
     not covered by it.
   - **Broad phase**: before the nested scan, check `sourceInstances.length × targetInstances.length`
     against **`maxBroadPhaseInstancePairs`** (`1_000_000`, provisional — same table), using
     overflow-safe division (`sourceInstances.length > maxBroadPhaseInstancePairs /
     targetInstances.length`) rather than computing the product directly. Over the ceiling, the entire
     call rejects before the scan runs, rather than letting an unbounded `O(N×M)` AABB scan execute with
     no checkpoint of its own — the second synchronous span round 15 found had neither a checkpoint nor
     a size limit. Under the ceiling: linear AABB scan of source instances against target instances —
     **but not in one synchronous burst.**

     **Round 18 found the ceiling bounds the scan's total work and says nothing about its span.** At
     this table's own stated O(µs) per AABB-overlap test, `1_000_000` pairs is roughly **1,000ms** of
     uninterruptible synchronous work — the largest single span in this design, about **60× the
     performance gate's own ~16ms pass criterion** — reached while the surrounding prose claimed
     frame-scale bounds. The spec had already done exactly this arithmetic once, for
     `maxCandidatePairsExamined` (`200_000` → `50_000`, because `200_000` costs ~53ms); it was never
     applied here. The fix is not a smaller ceiling — that only narrows how bad the ceiling case is
     while leaving a genuinely large scene uninterruptible — but an **inner checkpoint, at the same
     granularity round 11 already established for every other cheap inner loop in this design**: the
     scan checks the shared `frameBudgetMs` accumulator **before each individual instance pair it
     tests**, and when the budget is due it `await`s the same scheduling yield, re-validates the way
     every other checkpoint does (`disposed` first, then the model's load epoch — see
     **`world.evictModel`**'s "Race safety" note), and **resumes from exactly the `(sourceIndex,
     targetIndex)` it left off at**. Per-pair rather than batched is deliberate: round 11 rejected a
     batched `deadlineCheckInterval = 256` for `ContainmentQuery`'s sampling specifically so overshoot
     past `frameBudgetMs` stays bounded by **one** atomic operation's own cost, and a batch of `K` AABB
     tests would replace that with `K` of them — re-opening, in a new loop, the exact hole round 11
     closed. The cost of a `performance.now()` read relative to one AABB-overlap test is **unmeasured**;
     if the gate finds the clock read materially dominates, batching may be reintroduced **only** with a
     measured per-batch cost and the composition bound restated as `frameBudgetMs + one full batch`,
     never silently. This is available here, and not for `bvhcast` or `enumNodeFragments`, because the
     broad-phase scan is a plain JS loop this library drives itself: it can be paused, not merely
     aborted.

     Three properties this does **not** change, stated because each is load-bearing. Yielding never
     truncates the scan — the checkpoint decides scheduling only, never how many pairs are examined,
     the same rule `ContainmentQuery`'s sampling states explicitly; a time check used as a cutoff here
     would silently drop candidate pairs, which is a false negative, not a budget.
     `maxBroadPhaseInstancePairs` remains a **pre-scan rejection**, computed once by overflow-safe
     division against instance-array lengths captured before the scan begins, never a mid-scan cutoff.
     And the mid-scan suspension is safe only because **each `PlacedCollisionInstance`'s world matrix and
     world bounds are per-call, call-owned snapshots** — never fields on the shared, immutable
     `CollisionInstance` itself, which carries no transform state at all (see "`CollisionInstance`
     identity cache" under `GeometryRegistry`) — copied out of `fragList.getWorldMatrix`/`getWorldBounds`
     during extraction (see **`ViewerModelAdapter`**), and the candidate list is call-local — so a scan
     resuming after a yield cannot mix pre-yield and post-yield scene state, and two concurrent calls
     sharing the same canonical `CollisionInstance` reference never observe or mutate each other's
     placement snapshots. The lifecycle checkpoint
     catches eviction and disposal; it does **not** catch a transform, explode, or visibility change
     mid-scan, and the snapshot is what makes that harmless rather than a torn read.
   - **Narrow phase**: for each candidate pair, check both geometries' **active-range triangle counts**
     (`activeTriangleCount = Σ floor(ranges[].count / 3)` — the ranges' counts are index elements, not
     triangles; round 16: never the raw index's own count, see `ThreeMeshBvhBackend`/
     `BlasCache`) against `maxSyncTriangleCount` (`12_000` — revised in round 15) first — if either
     exceeds it, skip the pair and record a `geometry-too-large-for-sync-build` diagnostic against the
     offending fragment. That diagnostic is **fragment-scoped and deduplicated**: being oversized is a
     property of the geometry alone, not of the pairing, so one entry is emitted per oversized fragment
     no matter how many candidate pairs it appears in. Otherwise lazily get/build the `GeometryRecord` via
     `GeometryRegistry`/`BlasCache` — active-range compaction and welding together, then (only for a mode
     that calls `anyComponentInside` — `containment` or `volume-overlap`, not `surface-intersection`)
     connectivity, then the BVH, each its own checkpointed phase, see `ThreeMeshBvhBackend`/`BlasCache`
     — then run the query for `query.mode` — `ContainmentModeQuery` for the room-locator's `containment`,
     or `VolumeOverlapQuery` / `SurfaceIntersectionQuery` — with the pair's relative matrix.

     **Yielding is governed by one shared wall-clock budget for the entire `findClashes` call, not
     only by new build-phase starts.** Welding, connectivity construction, and `MeshBVH` construction are
     each synchronous, so each was always its own yield checkpoint (see the "Round 15 found..." note
     under `ThreeMeshBvhBackend`/`BlasCache` for why all three, not just the BVH build, get this
     treatment) — but round 9 found checkpointing build-phase starts alone isn't what the one-frame
     guarantee actually needs: a `volume-overlap` pair composes up to three independently-budgeted
     stages (`ProperCrossingQuery`, then `ContainmentQuery(source in target)`, then
     `ContainmentQuery(target in source)`), each sized to roughly one frame on its own, with nothing
     yielding *between* them; and once every candidate's `GeometryRecord` is cached, a run of pairs could
     execute back to back with no checkpoint between them at all. Either alone can freeze the Viewer for
     several frames despite the per-stage budgets above all being individually correct. The narrow phase
     therefore tracks one `performance.now()`-based accumulator for the call and checks it — not only
     before each new build phase, but also before starting each candidate pair (cached or not), before
     each dbId's extraction (above), before the broad-phase scan starts and again before each individual
     instance pair within it (round 18's own per-pair checkpoint — above), and between each of a pair's
     composed sub-queries. Whenever accumulated synchronous time since the last yield exceeds
     `frameBudgetMs` (`8` — half the one-frame target, since a checkpoint can only fire *between*
     primitives, not preempt one), it `await`s the same scheduling yield
     (`requestAnimationFrame`/`setTimeout(0)`) before continuing. The count-based budgets
     (`maxCandidatePairsExamined`, `maxCrossingPairsExamined`, `maxContainmentSamples`) are unchanged and
     still bound each stage individually as a backstop; `frameBudgetMs` is what now bounds their
     *composition*, which no fixed count can do without knowing the other stages' cost in advance.

     **This is the coarse, pair/stage-boundary layer only — round 10 found it insufficient by itself,
     since a single stage's own internal loop can exceed `frameBudgetMs` before ever reaching one of
     these boundaries.** `ProperCrossingQuery`'s `bvhcast` traversal and `ContainmentQuery`'s sampling
     loops each carry their own intra-stage checkpoint at a finer granularity — see the "Abort
     protocol" note under **`ProperCrossingQuery`** and the "Intra-loop checkpoint" note under
     **`ContainmentQuery`**. Every checkpoint, coarse or fine, checks `disposed` first, then re-validates
     the model's load epoch (see **`world.evictModel`**'s "Race safety" note) before resuming — round 15
     added the `disposed` half of that ordering; a model evicted, or a world disposed, while any yield
     was in flight is never operated on after the fact.
   - Aggregate fragment-pair hits into dbId-level `ClashPair`s (`groupBy: 'dbId'`), deduping so a
     room with multiple fragments isn't reported twice.
4. The extension maps `result.pairs[].target.dbId` back to room dbIds and returns them — the same
   return contract as the original `locateElementByRoom(dbId)`.

## Public API

```ts
CollisionWorld.fromViewer(viewer, options): Promise<CollisionWorld>
// options: { model?, narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' }
// narrowPhase/indexOwnership are accepted for forward compatibility with the idea doc's
// eventual multi-backend API, but only one value each is implemented in Milestone 1 —
// passing any other value throws.

world.findClashes(query): Promise<ClashResult>
// Rejects immediately, before any geometry extraction, if the world is disposed or if
// query.source.model/query.target.model is a Model object already tombstoned as evicted — see "Race
// safety" below. Otherwise admits both operand models via the same internal admission path
// world.admitModel exposes publicly (assigns a fresh epoch on first use, idempotent on a model already
// live) — a model object never seen before is a legitimate first use and is admitted normally; only an
// object this exact world has already evicted is rejected.
// query.source.model must === query.target.model — cross-model queries reject in Milestone 1
// query.mode: 'volume-overlap' | 'containment' | 'surface-intersection'
//   'volume-overlap'       — solids share positive volume; pure touching is NOT overlap.
//                            Soundest when BOTH operands are certified closed; an operand that isn't
//                            degrades gracefully rather than rejecting — every result depending on
//                            that operand's parity carries `unverified-parity-operand` naming its
//                            role, and a positive whose deciding component isn't a certified closed
//                            manifold also carries `unverified-open-component` (see "The containment
//                            guarantee, and its preconditions" and the role table below).
//   'containment'          — any point on the source's SURFACE lies inside the target's
//                            interior (see fixture at "asserted for direction" in Testing:
//                            the looser "any part of the source" wording was round-8-rejected
//                            because it makes the directedness fixture false).
//                            Soundest when the TARGET is certified closed; open sources are sound
//                            here by construction and are never diagnosed. An open TARGET degrades
//                            gracefully rather than rejecting — the result still runs and carries
//                            `unverified-parity-operand` (role: 'target').
//                            This is the mode the room-locator uses.
//   'surface-intersection' — any triangle contact, touching included. No closure precondition.
//   ('touching' / 'clearance' deferred to a later milestone)
// query.groupBy: 'dbId'
//   ('fragment' / 'externalId' deferred)
//
// No firstHitOnly in Milestone 1. It sat in this API from the first draft with no defined
// semantics — stop at the first fragment pair? the first aggregated dbId pair? the first pair
// per source? — and no story for how truncated statistics/diagnostics would be reported. The
// room-locator wants every matching room, so nothing in this milestone needs it. Deferred to
// whichever milestone has a caller that can pin down its meaning.

world.admitModel(model): ModelLease
// Synchronous. Returns { model, epoch } — an opaque capture of this exact object's current lifecycle
// state, valid until the object is evicted or the world is disposed. Idempotent: calling it again for
// an already-live object returns a lease with that same epoch (does not re-admit or reassign). Three
// outcomes, checked in this order:
//   - world disposed → throws WorldDisposedError
//   - modelLifecycle has this exact object tombstoned 'evicted' → throws ModelEvictedError, immediately,
//     without assigning a new epoch (a model that was ever evicted can never be re-leased)
//   - otherwise → admits if not already admitted (assigns epoch = nextLoadEpoch++, records
//     liveModelByModelId, same lazy-admission path findClashes's entry check uses — see below) and
//     returns the (possibly pre-existing) lease
// Round 13 found the previous design had no way for a caller to distinguish "not yet admitted, safe to
// proceed" from "evicted, must reject" *before* starting async work: world.isModelLive(model) answers
// false for both, by design (see isModelLive below), which is correct for a general liveness query but
// wrong as a pre-flight gate for a caller — like the room-search cache — that needs to admit the model
// up front and then validate that exact admission later. admitModel makes admission an explicit,
// synchronous step a caller can perform before starting async work, and hands back a token
// (ModelLease) that later validates against exactly that admission, not against whatever the model's
// state happens to be when the check runs. See "Race safety" below and Data Flow step 1.

world.isLeaseValid(lease): boolean
// Strictly non-throwing and total: for any lease ever returned by admitModel, always returns a plain
// boolean, never throws. Checks `disposed` FIRST, directly — not by inferring it from lease.model's own
// modelLifecycle entry — and returns false immediately if set:
//   if (disposed) return false;
//   const entry = modelLifecycle.get(lease.model);
//   return entry?.state === 'live' && entry.epoch === lease.epoch;
// Round 14 found the previous wording of this method ("does not throw on a disposed world") directly
// contradicted dispose()'s own contract, which listed isLeaseValid among the public methods that
// "reject or throw WorldDisposedError" after disposal — two irreconcilable behaviors for one method, and
// one of them (throwing) would exit an async Viewer callback as an uncaught exception rather than a
// rejection, leaving whichever promise the caller was building permanently unsettled. isLeaseValid is
// the resolution: it is one of the two deliberate exceptions to "every public method throws
// WorldDisposedError once disposed" (world.evictModel is the other, for a structurally identical reason
// at a different call site — see both, and world.dispose() below), precisely because it exists to be
// called from contexts — like an async model.search callback — that need a plain answer they can branch
// on, not a throw they'd have to wrap in try/catch on the common path. Round 15 found the
// *implementation* of that resolution mattered too: a
// version that answers "disposed" by checking whether dispose() has gotten around to tombstoning
// lease.model specifically is only as complete as dispose()'s own model sweep — which round 15 also
// found is not guaranteed to reach every live model under `modelId` reuse (see "Race safety" below).
// Checking `disposed` directly, first, sidesteps that entirely: this method's correctness never depended
// on enumeration completeness to begin with. A caller that needs to distinguish *why* a lease went
// invalid (evicted vs. disposed vs. never valid to begin with) does that mapping itself, outside this
// predicate, by calling world.isModelLive(model) (still throws WorldDisposedError, per its own unchanged
// contract) after seeing isLeaseValid return false — inside a try/catch, so the throw becomes that
// caller's own rejection instead of an uncaught exception in whatever async frame it is running in.
// The room-search callbacks are exactly that caller: they reject WorldDisposedError when the world is
// gone and ModelEvictedError(model.id) when this exact object was evicted, which is what keeps
// locateElementByRoom's error classes consistent with the disposed-first ordering every other site uses
// (see Data Flow step 1). An earlier round had those callbacks collapse both causes to
// ModelEvictedError; that collapse was retired because it made the same logical event — the world was
// disposed — surface as two different error classes depending only on when disposal landed. The
// predicate itself is unchanged: it still answers only "is this lease still valid," never why.

world.evictModel(model): void
// Takes the exact Viewer Model OBJECT, not modelId — round 12 found modelId-keyed eviction can't
// permanently distinguish "this exact load was evicted" from "nothing has loaded under this id yet,"
// which is what let a stale caller re-admit an evicted object as if it were a fresh one.
//
// Round 15 found the round-12-through-14 wording ("tombstones that object's lifecycle entry FIRST")
// never actually specified what a tombstone looks like for a `model` this world has never admitted —
// BEFORE_MODEL_UNLOAD_EVENT fires for any unloaded model, including one that was loaded but never
// touched findClashes/room-search, so evictModel must handle "no prior modelLifecycle entry at all,"
// not only "was live." modelLifecycle's value type is now the two-variant discriminated union
// { state: 'live', epoch: number } | { state: 'evicted' } — the evicted variant carries no epoch at
// all, because nothing ever needs to compare one: every liveness/lease check short-circuits on
// `state !== 'live'` before it would ever read `.epoch`. This makes "evict something never admitted"
// representable without fabricating an epoch that would falsely imply the object was ever live:
//   if (disposed) return;                                     // no-op on a disposed world — see below
//   const previous = modelLifecycle.get(model);
//   if (previous?.state === 'evicted') return;               // idempotent no-op
//   modelLifecycle.set(model, { state: 'evicted' });          // unconditional — handles both
//                                                              // "was live" and "never seen" identically
//   if (previous?.state === 'live') releaseEpochScopedState(previous.epoch);
// The tombstone write happens before the (conditional) state release, and is permanent either way: this
// exact object can never become live again in this world, even if model.id is later reused by a
// different object (see "Race safety" below).
// `releaseEpochScopedState` sweeps GeometryRegistry for every entry filed under the object's own
// admitted epoch — in whichever build state, 'building' or 'ready', plus any oversized marking — and
// drops each one together with its cached BLAS and cached connectivity. It also, as an independent
// operation over a different keyspace (not derived from this GeometryRegistry sweep — the
// CollisionInstance cache is keyed by every collected fragment, a strict superset of the registry's
// lazily-built candidate-pair keyspace), deletes the outgoing epoch's own `CollisionInstance` bucket —
// see "`CollisionInstance` identity cache" under `GeometryRegistry`. For every 'building' or 'ready'
// entry it removes, it first rejects that entry's cancellation signal — the same signal created
// once when the entry was first inserted and carried unchanged across its 'building' -> 'ready'
// transition, never scoped to 'building' alone — which every unresolved phase slot the entry hosts
// races, including a lazy connectivity build in flight against an already-'ready' entry; this settles
// each in-flight build (or in-flight lazy connectivity build) promise exactly once (clearing a map does
// not by itself settle a pending promise). An oversized marking carries no such signal — no phase is
// ever started for it — and is removed directly in the same sweep, with nothing to reject. Each removed
// entry is then deleted identity-guarded — deleted only if the registry still holds this exact entry for
// that key — in the same step, so a late-resolving continuation from a just-rejected phase can never
// republish or mutate state after the entry is gone.
// This sweep can reach in-flight builds at all only because a record is
// published to the registry when its build STARTS rather than when it completes (see
// ThreeMeshBvhBackend/BlasCache); an in-flight build living only inside the building caller's closure
// would be unreachable from here. GeometryRegistry keys records by (loadEpoch, geometryIndex), not
// (modelId, geometryIndex), specifically so this step can never touch another object's state (see
// "Race safety" below). Because the key space is
// partitioned by epoch rather than by the reusable `modelId`, this release needs no occupancy check
// against `liveModelByModelId` the way round 13's interim fix did — a stale, delayed, or duplicate
// evictModel(oldModel) call can only ever release records filed under oldModel's own epoch, which no
// other object's records are ever filed under, regardless of model.id reuse or call timing. **This step
// must be non-throwing** (a synchronous map/set removal and promise rejection, nothing that can itself
// fail) — round 15 flagged that a version which could throw partway through would leave the tombstone
// written (correct, permanent) but the release incomplete and unretriable, since the now-`'evicted'`
// entry no longer carries the epoch a second attempt would need to find those records again. This is a
// state-release/cleanup completeness concern, not a liveness-correctness one — the object is correctly
// dead either way — but it is required for the design to actually reclaim what it claims to.
// If this object is still `liveModelByModelId`'s current entry for its `model.id`, that entry is also
// deleted, freeing the id for a future different object; this is diagnostic/bookkeeping only (see
// "Race safety" below for why nothing correctness-relevant depends on it, including world.dispose(),
// which wholesale-clears caches rather than sweeping this map).
// Required because BLAS/geometry state must not outlive the load that produced it — a review pass
// caught that the previous draft evicted only the extension's room-dbId cache on model removal, leaving
// the unloaded model's geometry and BVHs resident. Must be called from the extension's
// Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT handler with event.model (see Data Flow step 1), alongside
// dropping that object's room-cache entry.
//
// **evictModel checks `disposed` FIRST and, on a disposed world, returns immediately as a no-op — it
// does NOT throw WorldDisposedError.** `disposed` is still authoritative and still consulted before
// anything else; what differs from the throwing methods is only the action taken on it. This is the
// design's SECOND deliberate exception to "every public method throws WorldDisposedError once disposed"
// (isLeaseValid is the first, for a structurally identical reason at a different call site — see
// world.isLeaseValid and world.dispose). Three things justify it, in descending order of force:
//   1. A throw here is verifiably destructive to the VIEWER, not merely to this library's caller.
//      evictModel is called ONLY from the extension's BEFORE_MODEL_UNLOAD_EVENT handler, and in the
//      pinned 7.124.2 bundle EventDispatcher.prototype.dispatchEvent (viewer3D.js:13300-13341) invokes
//      each listener as a bare `typeListeners[i].callbackFn.call(this, event)` with no try/catch. That
//      event is dispatched as the FIRST statement of Viewer3DImpl.unloadModel (viewer3D.js:34052-34054),
//      which is called from the unguarded loop in Viewer3DImpl.unloadCurrentModel
//      (viewer3D.js:34253-34258): `for (var i = models.length-1; i>=0; i--) this.unloadModel(models[i]);
//      this.model = null;`. An uncaught throw from this handler therefore aborts the Viewer's own
//      multi-model teardown — the remaining models are never unloaded, `this.model` is never nulled, and
//      even the model that raised it is not removed from the render scene, since the dispatch precedes
//      removeModel — and propagates up through Viewer3D.tearDown (viewer3D.js:26583, which wraps
//      extension unloads in try/catch but NOT unloadCurrentModel) into loadDocumentNode. This is the
//      same uncaught-exception-in-an-async-Viewer-callback shape isLeaseValid was made non-throwing to
//      avoid, one blast radius larger: there the victim was one caller's promise, here it is the
//      Viewer's teardown of every other model.
//   2. There is nothing left for it to do. dispose() has already released the world-owned collision
//      state unconditionally, for every epoch rather than per model, so the epoch-scoped release this
//      method would otherwise perform has no remaining target. Writing a tombstone into modelLifecycle
//      after disposal is likewise inert: nothing consults per-model state on a disposed world, because
//      every site checks `disposed` first and stops there.
//   3. It is the branch this method already had. evictModel was already total-by-no-op for "this object
//      is past being evictable" (the 'evicted' case); a disposed world is the world-level instance of
//      exactly that condition, so it takes the same shape rather than a new one.
// Disposal is an ordinary teardown state here, not caller misuse, so this no-op is silent — a
// diagnostic on it would fire on every normal teardown. (Debug-only instrumentation is non-normative.)
// The extension-owned room-dbId cache is NOT covered by this no-op: world.dispose() never touches it
// (see RoomLocatorExtension.unload()). The handler must therefore drop that object's room-cache entry
// unconditionally, independent of what evictModel does, so a disposed world cannot skip it.

world.isModelLive(model): boolean
// Checks `disposed` FIRST, directly (same ordering as isLeaseValid, see above) — throws
// WorldDisposedError immediately if set, before consulting modelLifecycle at all. Otherwise: true iff
// this exact Model object has a { state: 'live' } lifecycle entry. Never seen before → false (not yet
// admitted; findClashes would admit it fresh, this accessor does not). General-purpose liveness query,
// retained for callers (tests, diagnostics) that need to distinguish *why* a model isn't usable — a
// throw here specifically means "the world itself is gone," which isLeaseValid's plain-boolean contract
// cannot express. Round 13 found this "never seen → false" contract is *wrong* for a pre-admission gate
// — a caller that needs to tell "not yet admitted, proceed" apart from "evicted, reject" before starting
// async work should call admitModel + isLeaseValid instead (see above), which is what the room-search
// cache now does; nothing public still depends on isModelLive for that purpose.

world.dispose(): void
// Terminal. Sets the world-level `disposed` flag FIRST, synchronously, before anything else — this
// single write is what every public method and every per-yield checkpoint now checks directly (see
// "Race safety" below for why round 15 made this the authoritative signal instead of a per-model
// tombstone sweep). After dispose() returns, every public method on this world instance — findClashes,
// admitModel, isModelLive, a second dispose() — rejects or throws WorldDisposedError rather than doing
// anything, including admitting a new model object or rebuilding any collision state.
// Two methods are deliberate exceptions, and both still check `disposed` directly and first, the same
// way every other method now does — they differ only in what they do about it:
//   - isLeaseValid stays a plain, non-throwing boolean predicate even after disposal (returns false),
//     because it is called from async Viewer callbacks that need an answer to branch on, not a throw
//     (see world.isLeaseValid above).
//   - evictModel returns immediately as a no-op after disposal rather than throwing, because it is
//     called only from a BEFORE_MODEL_UNLOAD_EVENT handler whose throw the Viewer does not catch and
//     which would abort the Viewer's own multi-model teardown loop, and because dispose() has already
//     released everything evictModel would have released (see world.evictModel above).
// dispose() also wholesale-clears GeometryRegistry, BlasCache, every cached GeometryConnectivity, and the
// `CollisionInstance` identity cache (see "`CollisionInstance` identity cache" under `GeometryRegistry`)
// — the entire cache, in one operation, not a per-model sweep over liveModelByModelId — and rejects every
// in-flight build promise: an entry still in 'building' is reachable because a record is published to
// the registry when its build starts (see ThreeMeshBvhBackend/BlasCache), and a 'ready' entry currently
// hosting an in-flight lazy connectivity build is reachable the same way, because that same entry-scoped
// cancellation signal is carried unchanged across the entry's 'building' -> 'ready' transition rather
// than discarded at it. For every 'building' or 'ready' entry it removes, the clear rejects that entry's
// cancellation signal — which every unresolved phase slot on it races, whether that slot is weld, BVH,
// or a later lazy connectivity build — exactly once, in the same pass that drops the entry,
// identity-guarded so a late-resolving continuation cannot act on an entry already gone. An oversized
// marking carries no cancellation signal at all — no phase is ever started for it — so the clear removes
// it directly in the same wholesale pass, with nothing to reject. It best-effort tombstones whatever
// `liveModelByModelId` currently references,
// for diagnostic bookkeeping, but this is no longer load-bearing for correctness: round 15 found
// `liveModelByModelId` cannot enumerate every live model when a `modelId` has been reused while its old
// occupant is still live (exactly the state round 14's own fix made supported), so nothing correctness-
// relevant may depend on that sweep reaching every model — see "Race safety" below.
// A query already suspended at a yield checkpoint when dispose() runs fails at its next checkpoint
// because that checkpoint now checks `disposed` directly, independent of whether this specific model was
// ever individually tombstoned — not because dispose()'s sweep happened to reach it.
```

**Race safety: object-identity lifecycle state, permanently tombstoned on eviction, checked at every
yield point and at `findClashes`'s own entry — not only at `evictModel`'s own callers.** Round 10 found
the eviction contract was silent on the case that actually matters for correctness: a `findClashes`
call holds `CollisionInstance`/BLAS/geometry references across the yields described under **Data
Flow** and the intra-stage checkpoints below, and nothing prevented one of those yields from resuming
into a model that was evicted while the call was suspended. Round 10's own fix (a **per-`modelId`
generation counter that restarts at its first use**) round 11 found reintroduces exactly that race on
`modelId` reuse — a suspended query's captured "old" value could coincidentally equal a reloaded
model's "fresh" one. Round 11's fix (a single global, never-reset `nextLoadEpoch` counter) closed the
reuse race but round 12 found it still keyed liveness by `modelId`, a number — which meant *deleting*
a `modelId`'s entry on eviction, rather than tombstoning it, left no permanent record that **this exact
`Model` object** had already been evicted. A caller that obtained that same object through some other
path (most concretely: a `model.search` promise that was already in flight when eviction happened,
still holding the original `Model` reference) could hand it to `findClashes` afterward and have it
treated as an unremarkable first-time admission, since nothing about the (now-empty) `modelId` slot
said otherwise.

**The fix keys liveness by the exact `Model` object, not `modelId`, and never deletes a tombstone.**
`CollisionWorld` maintains:

- **`modelLifecycle: WeakMap<Model, { state: 'live'; epoch: number } | { state: 'evicted' }>`** — one
  entry per `Model` object this world has ever admitted *or* evicted, keyed by object identity. Round 15
  changed the value type from a single `{ epoch, state }` shape to this two-variant discriminated union:
  the `'evicted'` variant carries no `epoch` at all, because — as established below — nothing ever needs
  to read one for an evicted entry. This closes a gap round 12–14 left implicit: `evictModel` must be
  able to tombstone a `Model` object that was **never admitted in the first place** (see
  **`world.evictModel`**), and the old single-shape type had no well-defined value for "evicted, but no
  epoch was ever assigned." `evictModel` sets `{ state: 'evicted' }` **in place**; it never deletes this
  entry, whether the previous entry was `'live'` or absent entirely. A `Model` object with no entry at
  all has simply never been admitted *or* evicted — a legitimate first use, the only case `findClashes`
  treats as "admit fresh." A `Model` object with an `'evicted'` entry is permanently dead in this world:
  nothing re-admits it, ever, because nothing ever clears or overwrites it back to `'live'`. (Using a
  `WeakMap` is what makes "permanent" free rather than a leak — if every other reference to an evicted
  `Model` object is eventually dropped, its entry is reclaimed by the GC along with it; nothing needs to
  enumerate and prune tombstones by hand — which is also exactly why nothing in this design may depend on
  being able to *enumerate* `modelLifecycle`; see `disposed`, below.)
- **`liveModelByModelId: Map<modelId, Model>`** — the *current* live object for a given `modelId`.
  Round 14 narrowed what this map is actually for: bookkeeping for diagnostics (resolving a raw `modelId`
  back to its live `Model` object) and a best-effort assist for `world.dispose()`'s cleanup. Round 15
  found even that assist role cannot be relied on for *correctness*: because this map holds only one
  object per numeric id, it structurally cannot represent "two `Model` objects sharing a reused `modelId`
  are both currently live" — a state round 14's own epoch-keying fix made supported and tested — so a
  sweep built on this map can miss one of the two. See `disposed`, below, for the fix: no correctness
  property in this design depends on this map's completeness anymore, only on it being reasonably
  accurate for bookkeeping/diagnostic purposes. `admitModel` sets this entry; `evictModel` deletes it,
  but only when the object being evicted is still the current entry for its id — a stale/delayed
  eviction of an already-superseded object leaves whichever object actually holds the slot today
  untouched, without needing to guard anything else `evictModel` does.
- **`disposed: boolean`** — world-level terminal flag, unchanged in spirit since round 12 but now the
  system's single authoritative liveness signal rather than one input among several. See **`world.dispose()`
  is terminal**, further below, for what round 15 changed and why.
- **`nextLoadEpoch`** — unchanged from round 11: a single counter, global to the `CollisionWorld`
  instance, that only ever increments. A `Model` object is stamped with `epoch = nextLoadEpoch++` the
  first time it's admitted. Because the counter is global and never reset, **a different `Model` object
  reusing a `modelId` still gets a strictly greater epoch than anything issued before it** — the
  round-11 property is preserved, now layered under object-identity tombstoning rather than instead of
  it.

**Round 13 found object-identity tombstoning alone still left two gaps: admission was only ever lazy
(triggered by the first thing that happens to touch the model), and eviction's model.id-scoped cleanup
was unconditional.** Both are fixed the same way — by making the two operations symmetric and explicit
rather than inferring them from whatever code path happens to run first:

- **Admission is now also available explicitly and synchronously, via `world.admitModel(model)`.**
  Every previous round assumed the first `CollisionInstance` use (inside `findClashes`) was always where
  a model first became live — true for `findClashes` callers, but not for the room-search cache, which
  needs to know a model's admission state *before* starting an uncancellable async `model.search` call,
  not after it resolves. `admitModel` performs the exact same "no entry → assign epoch, mark live;
  tombstoned → reject" logic `findClashes`'s entry check already performed internally, but exposes it as
  a public, synchronous, idempotent operation that returns a `ModelLease` (`{ model, epoch }`) the caller
  can hold onto and validate later with `world.isLeaseValid(lease)`. This is what closes the round-13
  Critical: because admission now happens *before* `model.search` starts (see Data Flow step 1), the
  room-search success callback always has a real lease to validate by the time it fires — it is never in
  the "never seen this model" state `isModelLive` used to conflate with "evicted." `isModelLive` itself
  is unchanged and still correct for what it always claimed: a general liveness query, not a
  pre-admission gate.
- **`evictModel`'s model-scoped cache drop was still, at the end of round 13, gated on
  `liveModelByModelId.get(model.id) === model` before touching any state "keyed by model.id."** That
  guard fixed round 13's own bug (a stale eviction wiping a newer same-id object's state) but round 14
  found it was a symptom fix, not a root-cause one: the underlying `GeometryRegistry`/`BlasCache` state
  was still keyed by the reusable numeric `modelId` in the first place, so the guard only protected the
  *cleanup* direction. It did nothing for the *admission* direction — see the round-14 paragraph below.

**Round 14 found the remaining gap wasn't in eviction at all: `GeometryRegistry`, `BlasCache`, and
`GeometryConnectivity` caches were keyed by `(modelId, geometryIndex)` — plain numeric `modelId` — while
`modelLifecycle` had already moved to object identity three rounds earlier.** Two different `Model`
objects sharing a reused `modelId` therefore still shared one `GeometryRecord` namespace, regardless of
which one was "live" in `modelLifecycle` at any given moment. Concretely: if a model's own unload event
is delayed and a different `Model` object is admitted under the same `modelId` before that eviction
runs, the new object's very first geometry lookup can find — and reuse — the **old** object's cached
`GeometryRecord`/BLAS, computing clashes against dead geometry with no eviction, no stale lease, and no
epoch mismatch anywhere in the picture: the identity check that would have caught this (per-yield
liveness re-validation) only ever runs against the *model* object passed into `findClashes`, never
against the geometry cache's own key. Round 13's occupancy guard on `evictModel` could not fix this,
because the bug doesn't happen during eviction — it happens during the new object's admission, before
any eviction of the old object occurs at all.

**The fix keys model-owned collision state by the admitted load identity (`loadEpoch`), not `modelId`,
closing the hole structurally rather than by adding another timing-sensitive check.** `GeometryRegistry`
now keys every `GeometryRecord` by `(loadEpoch, geometryIndex)` (see **`GeometryRegistry`** and the
"Geometry dedup key" note under **`ViewerModelAdapter`**), where `loadEpoch` is the exact value
`modelLifecycle.get(model).epoch` assigned at that object's own admission. Because `nextLoadEpoch` is
global, monotonic, and never reused (round 11's property, unchanged), **a different `Model` object
admitted under a reused `modelId` is structurally guaranteed a disjoint epoch, and therefore a disjoint
`GeometryRecord` namespace, before its first geometry lookup ever runs** — there is no ordering between
admission and eviction that can make the two objects' state collide, because their state was never filed
under the same key to begin with. This is also why `evictModel`'s cache-scoped release (see
**`world.evictModel`**) no longer needs round 13's `liveModelByModelId` occupancy guard to be safe: it
releases records filed under the evicted object's own `epoch`, which — by the same disjointness
guarantee — no other object's records are ever filed under, regardless of `modelId` reuse or how late
the eviction call arrives. The guard remains in `liveModelByModelId` bookkeeping (previous bullet) for
enumeration hygiene, but nothing about state-release correctness depends on it anymore.

**`findClashes` validates liveness at its own entry, before any geometry extraction or lazy
admission** — not only relying on callers to have checked first. First, `disposed` (below); then, for
each of `query.source.model` and `query.target.model`: a `modelLifecycle` entry with `state: 'evicted'`
rejects immediately with `ModelEvictedError`; no entry at all proceeds to lazy admission (assigns a
fresh epoch, sets `state: 'live'`, records it in `liveModelByModelId`) exactly as before. This is what
stops `findClashes(evictedModel, …)` from ever creating a fresh lifecycle entry for an object the world
has already tombstoned — the defense round 12 found missing — and it composes with, rather than
replaces, the existing per-yield re-validation: every yield point inside `findClashes` (the pair/stage
boundaries in **Data Flow**, and the intra-stage checkpoints in **`ProperCrossingQuery`**/
**`ContainmentQuery`** below) **checks `disposed` first** — see round 15's fix directly below, which
closes a gap this ordering used to have — and only then re-checks
`modelLifecycle.get(model)?.state === 'live' && modelLifecycle.get(model).epoch === epoch`, before
touching any cached BLAS, `GeometryRecord`, or `CollisionInstance` for that model — catching eviction
or disposal that happens *after* a query has already validly started, which the entry-point check alone
cannot. A failure at either the entry check or any yield checkpoint aborts the **entire** `findClashes`
call: `disposed` rejects with `WorldDisposedError`, an evicted/mismatched-epoch model rejects with
`ModelEvictedError` naming the evicted `modelId` — neither returns a partial or diagnosed `ClashResult`.
This is a different failure than anything the diagnostic system answers — the query's premise (this
world, or this model's geometry, still exists) no longer holds, so there is no partial answer worth
returning. This is also why eviction already rejects in-flight BLAS build promises (existing rule,
above): `ModelEvictedError` is that same failure surfaced at whichever checkpoint notices it first,
entry or yield.

**`world.dispose()` is terminal. Round 15 found the previous mechanism for making that true —
tombstoning every currently-live model so each one's own per-model check would independently catch a
resumed query — could not actually reach every live model, and fixed the invariant at its root instead
of trying to make the sweep complete.** `modelLifecycle` is a `WeakMap`, which is deliberately
non-enumerable (see its own entry below); the only enumerable proxy, `liveModelByModelId`, holds one
`Model` object *per numeric `modelId`* — but round 14's own fix made "an old object is still `'live'`
while a different object has already been admitted under the same reused `modelId`" a supported,
tested state, and in exactly that state `liveModelByModelId` can only ever point at one of the two
objects. A sweep built on it therefore cannot guarantee it reaches every live model, and nothing about
epoch-keyed geometry state (round 14) helps here either — that fix makes two objects' *caches* disjoint,
it says nothing about whether disposal's *sweep* finds both objects to tombstone in the first place.

**The fix makes `disposed` itself the authoritative, directly-checked signal everywhere — not
something every model's own tombstone has to be made to imply.** `dispose()` sets the world-level
`disposed` flag **first, synchronously, before anything else** — this single write is now sufficient
correctness-wise, on its own, for every check anywhere in the system, because every check now consults
it directly instead of inferring it from per-model state:

- `findClashes`'s entry check, above, already checked `disposed` first.
- **Every per-yield checkpoint now checks `disposed` first too** — this is the round-15 change: the
  pair/stage-boundary checkpoints in **Data Flow**, and the intra-stage checkpoints in
  **`ProperCrossingQuery`**/**`ContainmentQuery`**, all check `disposed` (reject `WorldDisposedError`)
  *before* re-validating `modelLifecycle`'s per-model `state`/`epoch` (reject `ModelEvictedError`).
  Previously these checkpoints only ever consulted per-model state, which is exactly the gap round 15
  found: a query suspended against a model `dispose()`'s sweep failed to reach would pass its resumed
  checkpoint clean, because nothing at that checkpoint ever asked the world itself whether it was still
  usable.
- `isLeaseValid`, `isModelLive`, and `evictModel` check `disposed` first too — see their own entries
  below for the exact, deliberately different response each makes to it: `isLeaseValid` returns `false`,
  `isModelLive` throws, `evictModel` returns as a no-op. What is uniform is that all three consult the
  flag directly and ahead of anything else; only the reaction is tailored to the call site.

Because every checkpoint now has its own direct, independent answer to "is the world disposed," none of
them depend on `dispose()` having successfully reached and tombstoned the specific model they're
holding — the property that used to require a complete sweep now falls out of a single boolean write,
checked everywhere, with no enumeration involved at all. **`dispose()` no longer needs to enumerate and
tombstone every live model for correctness**, and this spec no longer claims it does. What `dispose()`
still does, for memory hygiene rather than correctness: it wholesale-clears `GeometryRegistry`,
`BlasCache`, every cached `GeometryConnectivity`, and the `CollisionInstance` identity cache (see
"`CollisionInstance` identity cache" under `GeometryRegistry`) — the entire cache, not a per-model sweep
over `liveModelByModelId` — and rejects every in-flight build promise, exactly once, on the same disposal
call. "Every in-flight build promise" is enumerable at all only because a `GeometryRecord` is published
in `buildState: 'building'` when its build starts (see **`ThreeMeshBvhBackend`/`BlasCache`**): the
unresolved phase slots hanging off the registry's entries — whether the entry is still `'building'` or
has already reached `'ready'` and is now hosting a later, lazily-started connectivity build — *are* the
in-flight builds, because the entry-scoped cancellation signal created when the entry was first inserted
stays live across that transition rather than being scoped to `'building'` alone, and the clear rejects
each entry's cancellation signal as it drops the entry. A wholesale clear cannot
suffer the same enumeration gap a per-model sweep can, because it never needs to identify *which* models
were live in the first place; it discards everything unconditionally.
`liveModelByModelId` itself is best-effort updated for diagnostic/bookkeeping purposes only (as round 14
already established) — no correctness property, cache-release completeness included, is layered on top
of it anymore.

```ts
class RoomLocatorExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options)      // options.roomCategoryName default 'Revit Rooms'
  async load()                      // awaits CollisionWorld.fromViewer(viewer, options) to completion
                                     // before returning; no room resolution here (see Data Flow step 1)
                                     // and no eager BLAS building. The BEFORE_MODEL_UNLOAD_EVENT listener
                                     // and the context-menu item are registered only after fromViewer()
                                     // resolves, inside this same call — loadExtension() treats this
                                     // extension as ready the moment load()'s returned promise resolves,
                                     // and nothing downstream is guaranteed to wait further, so no
                                     // consumer can observe a registered listener referencing a
                                     // not-yet-constructed world. If fromViewer() rejects, load()'s
                                     // returned promise rejects with the same error before either
                                     // registration runs — neither exists without the other.
  unload()                          // world.dispose(), unregisters context menu + BEFORE_MODEL_UNLOAD
                                     // listener, clears the per-model room cache. The stated order —
                                     // dispose() first, listener removal second — leaves a window in
                                     // which BEFORE_MODEL_UNLOAD_EVENT can still fire into this
                                     // extension's handler on an already-disposed world, and the
                                     // window can outlive unload() itself, since Viewer3D.tearDown
                                     // catches a throw from unload() while leaving the listener
                                     // registered. That window is benign, but only because
                                     // world.evictModel is a no-op on a disposed world rather than a
                                     // throw (see world.evictModel) — it is the method's totality that
                                     // makes this ordering safe, not the ordering itself. A second throw
                                     // hazard exists at step 1 itself: a repeated unload() call
                                     // re-invokes world.dispose(), and a second/repeated dispose() call
                                     // is guaranteed to throw WorldDisposedError (see "Disposal
                                     // mid-query" and world.dispose()), synchronously, before steps 2/3
                                     // ever run — stranding listener removal, context-menu removal, and
                                     // the room-cache clear for that invocation. Viewer3D.tearDown wraps
                                     // each extension's own unload() call in try/catch (see
                                     // world.evictModel's race-safety note, viewer3D.js:26583), so this
                                     // throw is swallowed rather than propagating — the same "benign only
                                     // because something else catches it" shape as the first hazard, not
                                     // a resolution of it. Whether the Viewer or app code can invoke
                                     // unload() a second time on one instance is unstated. Per-step
                                     // isolation of unload()'s three steps, and whether the listener
                                     // should be removed before dispose() rather than after, remain
                                     // open and are not settled here.
  // on Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT: world.evictModel(event.model) — the exact
  // object, not model.id — AND drop that object's room-cache entry (see Data Flow step 1 and
  // world.evictModel's race-safety note). The room-cache deletion is unconditional and independent of
  // the evictModel call: world.dispose() never touches the extension-owned room cache, so the handler
  // must still drop the entry when evictModel no-ops on a disposed world.
  async locateElementByRoom(dbId): Promise<number[]>  // rejects with ModelEvictedError if its
                                     // model is evicted mid-query, or with WorldDisposedError if
                                     // the world was disposed (see world.evictModel/world.dispose)
  onContextMenu(menu, status)       // adds "Locate Room" item, same UX as the original extension
}
```

`ClashPair`, `ClashResult`, `ClashStatistics`, `ElementRef`, `FragmentRef` reuse the shapes already
defined in the idea doc's "Proposed Types" section, with one addition for this milestone:
`ClashStatistics` gains `diagnostics: ClashDiagnostic[]`.

Two earlier shapes were rejected in review. A flat `skippedFragments: FragmentRef[]` couldn't say
*why* a fragment was skipped. Replacing it with a required `sourceFragment` plus optional
`targetFragment` fixed that but introduced a new gap a review pass caught: a normalization failure on
a **target room's** fragment had nowhere to go — it would have to masquerade as a `sourceFragment`,
misreporting which side of the query actually failed. Milestone 1 uses a role-tagged union instead:

```ts
type FragmentDiagnosticReason =
  | 'unsupported-geometry-layout'        // no usable position/index source
  | 'rejected-primitive-range'           // legacy `offsets` layout, not normalized on a guess
  | 'geometry-too-large-for-sync-build'; // over maxSyncTriangleCount

type PairDiagnosticReason =
  | 'inconclusive-containment'        // unresolved (all-`boundary`) component(s) under a negative
  | 'incomplete-component-coverage'   // maxContainmentSamples hit before covering all components
  | 'inconclusive-crossing'           // a probe classified `boundary`, OR no offset both stayed inside
                                      //   the source triangle and cleared `surfaceEpsilon` (containment
                                      //   mode's SurfaceCrossingWitness) — either way, not provable
  | 'crossing-budget-exhausted'       // maxCandidatePairs/maxCrossingPairs hit; traversal aborted
  | 'non-manifold-component'          // NEGATIVE result involving a component the guarantee misses
  | 'unverified-open-component'       // volume-overlap POSITIVE decided by an open component. Carries
                                      //   `role` naming WHICH public operand supplied that component
                                      //   (never emitted in 'containment' mode — see Query modes)
  | 'unverified-parity-operand';      // ray parity ran against an operand that is not certified
                                      //   closed. Carries `role` naming WHICH operand; emitted once
                                      //   per offending operand. Attaches to positives AND negatives.

type ClashDiagnostic =
  // Discovered during geometry normalization or the size check, independent of any pairing.
  // `role` says which side of the query the fragment was playing — a target room fragment that
  // fails to normalize is reported as such, not disguised as a source.
  | { scope: 'fragment'; reason: FragmentDiagnosticReason; role: 'source' | 'target';
      fragment: FragmentRef }
  // Discovered while evaluating one specific pair; both sides are always known here.
  // `role` is required for reasons that indict one operand — 'unverified-parity-operand' and
  // 'unverified-open-component' — and absent for reasons about the pair as a whole
  // (budget exhaustion, coverage truncation, inconclusive results).
  | { scope: 'pair'; reason: PairDiagnosticReason; role?: 'source' | 'target';
      sourceFragment: FragmentRef; targetFragment: FragmentRef };
```

**`unverified-parity-operand` carries a role because the old flag pointed at the wrong geometry.**
The previous draft had `unverified-target`, which named the *only* operand that can be at fault in
`containment` mode — and is simply wrong on `volume-overlap`'s crossing path, where probe
classification parity-tests **both** operands. A single unroled flag there either misses an open
source entirely or reports it as an open target, sending the reader to inspect geometry that is fine.
Which roles are implicated depends on which path decided, and the rules follow directly from which
operand each path parity-tests:

| decided by | parity ran against | roles that can be indicted |
|---|---|---|
| proper crossing | both operands | `source` and/or `target` |
| containment of A in B | B only | `target` |
| containment of B in A | A only | `source` |
| a negative | every path ran | `source` and/or `target` |

One diagnostic is emitted per offending operand, so a pair with both open produces two.

Note what is *not* covered by this: an open component on a containment-decided **`volume-overlap`**
positive is not a parity fault at all — it was sampled, never parity-tested — and is reported by
`unverified-open-component` instead. The two diagnostics answer different questions ("was `inside`
well-defined?" versus "does containment establish volume?") and a fixture asserts they don't collapse
into each other.

**`unverified-open-component`'s `role` follows the same "which path decided" logic, but names which
operand the open component *belongs to*, not which operand parity ran against — round 9 found the
spec stated this only for one of the two containment terms:**

| decided by | open component belongs to | `role` |
|---|---|---|
| containment of A in B (A sampled, B is the target) | A | `source` |
| containment of B in A (B sampled, A is the target) | B | `target` |

`volume-overlap` tries both terms with early exit (see **`VolumeOverlapQuery`** below), so which row
applies is a property of which term actually produced the positive, not of the pair in the abstract —
the same pair can decide via either term depending on which solid's components happen to resolve
first.

**Diagnostics attach to positive results too, not only negatives.** Every earlier draft treated a
diagnostic as a caveat on "we found nothing," which left the one case where a *positive* is the
unsound answer — an open, zero-volume component classifying `inside` — reported as a clean clash.
A diagnostic marks any result whose soundness wasn't established, in whichever direction.

**Diagnostics are emitted for partially-unresolved negatives, not only totally-unresolved ones.** The
previous draft emitted `inconclusive-containment` only when *every* sample was inconclusive, which a
review pass correctly identified as still losing completeness information: a pair with some
conclusive "outside" samples and some unresolved components produces a negative that is not a
verified negative. The rule is now: **any unresolved component or truncated examination that could
have changed a negative result emits a pair diagnostic.**

**Positives are diagnosed only where their *soundness* is in question, which is narrower than
negatives but not empty.** A witness point inside the other solid settles *completeness* — nothing
else going unresolved can take that away — so truncation and coverage diagnostics
(`incomplete-component-coverage`, `inconclusive-containment`, `inconclusive-crossing`,
`crossing-budget-exhausted`) never attach to a positive. What can still undermine a positive is the
witness itself being unsound, and there are exactly two such cases, both preconditions rather than
budgets:

- `unverified-parity-operand` — the parity that produced the witness ran against an operand that
  isn't a certified closed manifold, so "inside" was never well-defined. Applies in `containment` and
  `volume-overlap`, with `role` naming the operand.
- `unverified-open-component` — `volume-overlap` only: the witness proves containment of an
  uncertified-open component (`role` naming whichever public operand it belongs to), which is not the
  same as shared volume.

An earlier draft stated flatly that positives need no diagnostic, directly contradicting the
`unverified-open-component` rule two sections above it. This is the reconciliation: *completeness*
diagnostics are negative-only; *soundness* diagnostics apply in both directions.

**`findClashes` always resolves `{ pairs: ClashPair[], statistics: ClashStatistics }`**, never a
bare `{ pairs: [] }` — the earlier draft of this spec returned a statistics-less empty result for
the no-candidate-rooms case, which is inconsistent with the idea doc's `ClashResult` type (where
`statistics` is required) and would make it impossible to tell "zero rooms existed to check" apart
from "the query itself never ran." When there are no candidates, `statistics` is still returned with
its counters zeroed (`broadPhasePairs: 0`, etc.) rather than the field being omitted.

## Error Handling & Edge Cases

- **Unsupported geometry layout**: if the adapter can't detect a position/index source on a
  fragment, or the fragment uses a legacy `offsets` layout (explicitly rejected — see
  `ViewerGeometryAdapter`), skip that fragment and record a `scope: 'fragment'` diagnostic with the
  appropriate `role` — not just a console warning, which would make an incomplete result
  indistinguishable from a verified no-clash one. The extension should surface a visible caveat (not
  silently report "no room found") when `statistics.diagnostics` is non-empty for the queried
  element.
- **Geometry too large to build synchronously**: a candidate pair whose **active-range** triangle count
  (`activeTriangleCount = Σ floor(ranges[].count / 3)` — the ranges' counts are index elements, not
  triangles — never the raw index's own count, round 16, see `ThreeMeshBvhBackend`/
  `BlasCache`) exceeds `maxSyncTriangleCount` (`12_000` triangles, revised in round 15) is skipped with a
  `geometry-too-large-for-sync-build` diagnostic rather than blocking the Viewer. A fragment with a huge
  raw index but a small active draw range is judged on the active range alone, and never has that raw
  index materialized or handed to welding at all.
- **One requested dbId's subtree is too large to enumerate**: extraction's own node-by-node walk (round
  16 — see **Data Flow** step 3) aborts as soon as a single requested dbId's running fragment tally
  crosses `maxFragmentsPerDbId` (`5_000`, provisional), without enumerating the rest of that subtree,
  and the entire `findClashes` call rejects. Round 15 added a ceiling here but checked it only after a
  single recursive `enumNodeFragments` call had already run to completion, which didn't actually bound
  the burst it claimed to; round 16 replaced the mechanism, not just the number. Round 17: this bounds
  cumulative work across nodes only — one node's own `enumNodeFragments(node, cb, false)` call is a
  separate, accepted non-preemptible atomic risk with no verified bound (see **Data Flow** step 3 and the
  atomic-operations table); a model where a single node directly owns an oversized fragment count can
  still stall before this rejection path is reached.
- **One node in a requested dbId's subtree has too many direct children to enumerate**: extraction's
  walk applies `maxChildrenPerNode` (`10_000`, provisional) at every node via a single mechanism — an
  in-callback abort inside non-recursive `enumNodeChildren` — for every node shape, fragment-free or
  mixed alike (see **Data Flow** step 3). Round 18 additionally ran a `getChildCount` preflight ahead of
  the abort; an invariant-audit fix (finding C-1) removed it, because it is not actually cheap for a
  mixed node (one that owns fragments) — it linearly scans the same slots `enumNodeChildren` walks, with
  no early-exit of its own — so it could not bound anything the abort didn't already bound, and was
  never load-bearing. Tripping the abort means the entire `findClashes` call rejects, naming the
  offending node, its observed (partial) child count, and the requested dbId — the same rejection
  contract and mechanism as the `maxFragmentsPerDbId` case above. **This rejects rather than skipping
  the node and diagnosing it**, and
  the distinction from the two diagnostic cases above is deliberate: a `geometry-too-large-for-sync-build`
  or `unsupported-geometry-layout` diagnostic names the *specific* fragment whose geometry was omitted,
  so a caller can see exactly what the result does not cover, whereas skipping a fanout silently voids
  the completeness of an **entire requested dbId** — an unbounded, unnamed subtree — and `findClashes`
  would return a clean `pairs: []` for geometry it never looked at. It is also what keeps
  `ViewerModelAdapter`'s coverage-equivalence claim honest: a completed walk's fragment set is the set
  one recursive `enumNodeFragments(dbId, cb, true)` call would have produced, and a truncated walk
  returns no result at all.
- **Too many broad-phase candidate instances**: if `sourceInstances.length × targetInstances.length`
  would exceed `maxBroadPhaseInstancePairs` (`1_000_000`, provisional), the entire `findClashes` call
  rejects before the nested AABB scan runs — round 15 found the same gap for the broad-phase scan (see
  **Data Flow** step 3). Round 18: under the ceiling, the scan itself now yields and resumes between
  instance pairs rather than running as one uninterruptible span (see **Data Flow** step 3).
- **Non-watertight geometry**: ray-parity containment assumes a closed target surface, so the parity
  modes are only strongly guaranteed for closed/manifold targets — mitigated with the
  `surfaceEpsilon` boundary pre-check, `THREE.DoubleSide` raycasting, distance-sorted coincident-hit
  merging, `barycentricEpsilon` edge/vertex rejection, and bounded retries along the remaining
  generic ray directions (see `ContainmentQuery`). Unresolved components under a negative produce
  `inconclusive-containment` rather than a silent guess; a parity operand that isn't certified closed
  at all produces `unverified-parity-operand` on every result.
- **Non-manifold or open source components**: the containment guarantee doesn't cover them (see
  `anyComponentInside`), so a negative result involving one emits `non-manifold-component`. Sampling
  still runs — this degrades a verified negative to an unverified one, it doesn't skip work.
- **A `volume-overlap` positive decided by an open component, on either side**: emits
  `unverified-open-component` with `role` naming whichever public operand supplied the deciding
  component — `source` when `anyComponentOf(source) inside target` decided it, `target` when
  `anyComponentOf(target) inside source` did (see the role table under Public API). An open shell
  encloses no certified volume, but its vertices can classify `inside`; the result is still reported as
  a clash with its soundness explicitly qualified. **Not emitted in `containment` mode**, whose
  contract covers open sources by construction — that mode split is what keeps this diagnostic
  meaningful instead of firing on nearly every real query (the acceptance-model bathtub welds to 14
  open components; see **Query modes and their preconditions**).
- **An open parity operand**: emits `unverified-parity-operand` (with `role`) on *every* result of a
  parity mode, positive and negative alike. An uncertified operand makes `inside` undefined against
  it, regardless of how sound the other side is — the one case where an otherwise-perfect query
  returns a meaningless answer. In `containment` the operand is always the target; on
  `volume-overlap`'s crossing path it can be either or both, since probes are classified against both
  solids. The pair is still reported rather than skipped; the caveat is what makes it honest.
- **Traversal budget exhausted**: `crossing-budget-exhausted`, with the pair reported as inconclusive
  rather than as a crossing — the abort path returns `true` from `bvhcast` purely as a stop signal
  and must never be mistaken for a hit (see `ProperCrossingQuery`).
- **Overlaps shallower than `minPenetrationDepth`**: may classify as touching rather than overlap.
  This is a declared semantic limit of the mode (see Tolerances), not a diagnosed failure.
- **Truncated examination**: hitting `maxContainmentSamples` before covering every component, or
  `maxCrossingPairsExamined` before deciding, produces `incomplete-component-coverage` /
  `inconclusive-crossing` — a bounded search that finds nothing has not proven a negative.
- **No candidate rooms** (empty search result, or wrong category name): `findClashes` still returns
  a full `ClashResult` with `pairs: []` and zeroed `statistics`; the extension surfaces "No rooms
  found" rather than throwing.
- **Cross-model query attempted**: `findClashes` rejects synchronously rather than silently
  computing a meaningless result — Milestone 1 has no defined coordinate normalization across models
  (see Milestone Scope).
- **Element with no fragments** (fully hidden/suppressed dbId): `findClashes` returns early with
  `pairs: []` and zeroed `statistics` (same contract as the no-candidate-rooms case above), no BLAS
  work attempted.
- **Invalid dbId**: reject with a clear error rather than silently returning empty.
- **Stacked/overlapping-bbox rooms** (e.g. double-height spaces): handled correctly by
  construction — broad phase may pass multiple bbox candidates through, but the narrow-phase
  `containment` query resolves the true containing room via actual triangle-level testing. (This is
  the mode the room-locator runs; earlier drafts said `volume-overlap` here, from before the mode
  split.)
- **A model is evicted mid-query** (`world.evictModel` — e.g. the user loads a different model into
  the same slot while a `locateElementByRoom` call is still awaiting a yield): the in-flight
  `findClashes` call rejects with `ModelEvictedError` at whichever yield checkpoint next re-checks the
  model object's tombstone state (see **`world.evictModel`**'s race-safety note); it never resumes into
  the evicted model's BLAS/geometry state, and never returns a `ClashResult` built on it. Full
  cancellation tokens (stopping the work *before* its next checkpoint) are still out of scope for this
  milestone — only correctness (never reusing stale state) is guaranteed, not immediate abort. This
  holds even if a *different* `Model` object reloads under the same `modelId` before the suspended call
  resumes: the suspended call holds a reference to the *old* object, whose tombstone (once set) is
  permanent and keyed by that object's own identity, not by `modelId` — the new object's lifecycle
  entry is unrelated state the old call's check never even looks at.
- **A `findClashes` call is made directly against an already-evicted `Model` object** (not via a
  suspended yield, but as the call's very first argument — e.g. a caller held onto a `Model` reference
  past its `beforeModelUnload` event): rejects immediately with `ModelEvictedError`, before any
  geometry extraction or BLAS work, via the same entry-point check described in **`world.evictModel`**'s
  race-safety note. This does not require the call to have started before eviction — the tombstone is
  permanent, so any later call using that exact object fails identically.
- **Disposal mid-query**: `unload()`/`world.dispose()` sets the world's own terminal `disposed` flag
  **first, synchronously, before it releases anything** — and that single write is the entire mechanism.
  An in-flight query rejects with **`WorldDisposedError`** at its next yield checkpoint, because every
  checkpoint checks `disposed` directly and first, ahead of any per-model `state`/`epoch` re-check. It
  does **not** reject `ModelEvictedError`, and it does not depend on this model having been individually
  tombstoned: since round 15, `dispose()` no longer enumerates and tombstones every live model, and this
  spec no longer claims it does — it best-effort tombstones only whatever `liveModelByModelId` happens to
  reference, for diagnostic bookkeeping (see **`world.dispose()` is terminal**). That is exactly why the
  flag, rather than a per-model mechanism, is what a resumed query observes: a sweep can miss a live
  model, a directly-checked boolean cannot. A *new* call made against an already-disposed world —
  `findClashes`, `admitModel`, `isModelLive`, or a repeated `dispose()` — rejects or throws
  `WorldDisposedError` instead, checked ahead of any per-model state. Two methods deliberately answer
  that same first-checked flag differently rather than throwing: `isLeaseValid` stays a plain,
  non-throwing boolean and simply returns `false` for any lease on a disposed world (see
  **`world.isLeaseValid`**), and `evictModel` returns immediately as a no-op — it runs inside a Viewer
  event dispatch the Viewer does not guard, and `dispose()` has already released everything it would
  release (see **`world.evictModel`**). Full cancellation tokens remain out of scope, as above.
- **A model's very first room search, before that model has ever been touched by `findClashes`**: this
  is the ordinary case, not an edge case, but round 13 found the round-12 design mishandled it — see
  **`world.admitModel`**. `locateElementByRoom`'s cache-miss path admits the model synchronously before
  starting `model.search`, so the search's own callbacks always validate a real lease rather than an
  ambiguous "never seen" state; the lookup succeeds normally.
- **A stale or duplicate `world.evictModel(oldModel)` call arrives after a different `Model` object has
  already reused the same `model.id` and been admitted** (the old object's own unload event was missed,
  delayed, or fired twice): the old object is still permanently tombstoned by this call — correct, since
  nothing should ever treat it as live again. The new object's live `GeometryRecord`/BLAS/connectivity
  state was never at risk in the first place: since round 14, that state is keyed by the new object's own
  `loadEpoch`, disjoint from the old object's, so there is nothing for a stale eviction of the old object
  to accidentally touch. (`liveModelByModelId.get(model.id)` also stops pointing at the old object once
  the new one is admitted, so the map itself stays accurate — see **`world.evictModel`** — but that is
  bookkeeping hygiene, not what makes the new object's state safe.)
- **A different `Model` object is admitted under a reused `model.id` and queried *before* the old
  object's own eviction ever runs** (the old object is still `'live'` in `modelLifecycle` throughout):
  the new object's first geometry lookup builds fresh state under its own `loadEpoch` rather than
  finding the old object's cached `GeometryRecord`/BLAS, so its `findClashes` results are computed
  against its own geometry, never the old object's. This is the round-14 Critical's exact scenario — see
  the "Race safety" note under **`world.evictModel`** for the epoch-keying mechanism that makes it
  impossible for the two objects' state to collide regardless of eviction timing.

## Testing & Verification

**Unit tests** (pure geometry, no Viewer needed):
Each of the three rejected algorithm shapes has a named regression fixture below, so a future
refactor can't silently reintroduce a bug an earlier round already found.

- `SurfaceIntersectionQuery`:
  - two clearly separated boxes — no intersection
  - two boxes with genuine interpenetration — intersects
  - **flush/coplanar touching faces only** (a box resting exactly on another box's top face) —
    **intersects**. Correct for *this* mode: touching is surface intersection. The point of the
    fixture is to pin the contrast with `volume-overlap`, which must return false on the same input.
  - **the same heavily-overlapping-leaves / zero-intersection pair used for `ProperCrossingQuery`'s
    budget fixture** — must abort with `crossing-budget-exhausted` and complete within a wall-clock
    bound. Regression test for round 7's finding that this mode was the last unbounded synchronous
    path in the design: while it was defined as `MeshBVH.intersectsGeometry`, which takes no budget
    and offers no abort hook, the *same* input that `ProperCrossingQuery` bounded to ~15ms would
    freeze the Viewer here. Sharing the fixture between the two modes is deliberate — it fails the
    moment they stop sharing a traversal.
  - an **open source and an open target** — intersects, with **no diagnostic**. This mode performs no
    parity, so neither closure precondition applies; asserting the absence pins that.
- `ProperCrossingQuery` — tested directly rather than only through its caller:
  - **flush/coplanar touching faces only** — **not a crossing**, and the run must produce **no
    `console.warn` from `ExtendedTriangle`**. That warning is the tell that the coplanar branch was
    reached and a zeroed segment consumed; asserting on its absence is how this fixture proves the
    coplanar pre-split actually happens rather than the classification merely appearing to work.
  - edge-edge and vertex-face contact with no shared volume — not a crossing
  - **two long, thin boxes crossing perpendicularly mid-span** (a duct through a beam), thin enough
    that no vertex of either lies inside the other — **is a crossing**. Regression test for round 2's
    counterexample, which pure vertex sampling cannot detect at any sample count.
  - **a crossing whose overlap is thinner than the coarsest ladder rung but deeper than the finest**
    — must be detected. Regression test for round 3's fixed-offset blind spot, which stepped clean
    through thin overlaps; it is the fixture that justifies the ladder existing at all.
  - a crossing shallower than `minPenetrationDepth` — documented as *not* detected, pinning the
    declared limit so it can't silently drift.
  - a crossing between meshes with **inconsistent/inward-facing winding** — still a crossing,
    verifying the four-quadrant probe test doesn't depend on outward normals.
  - **two geometries whose BVH leaves overlap but whose triangles do not intersect** (e.g. two combs
    interleaved without touching) — must report no crossing. Regression test for round 4's assumption
    that a `bvhcast` callback implies an intersection; without the explicit per-candidate test this
    reads a stale `targetLine` and can fabricate a crossing. Run it *after* a fixture that populates
    `targetLine` with a real segment, so stale state would actually be present to be caught.
  - **swapped operand order under an anisotropic instance scale** — `crossing(A,B)` must equal
    `crossing(B,A)`. Verifies the canonical ordering makes symmetry structural, and is the fixture
    that would have caught round 4's non-symmetric `min(diagonal(A), diagonal(B→A))` scale.
  - **two meshes with heavily overlapping BVH leaves and zero triangle intersections**, sized so the
    candidate count exceeds `maxCandidatePairsExamined` — must abort and report
    `crossing-budget-exhausted`, **not** a crossing. Regression test for round 5's unbounded raw
    candidate loop, and specifically for the abort protocol: `bvhcast` returns `true` on abort, so a
    caller that reads that as a hit turns a timeout into a fabricated clash. Assert the query
    completes within a wall-clock bound as well as returning the right verdict.
  - **a pair with many confirmed non-coplanar intersections, each requiring a full 12-probe
    classification, sized so the *time* budget trips before either count budget does** — must abort
    with `crossing-budget-exhausted` and complete within a `frameBudgetMs`-scaled wall-clock bound.
    Round 10's regression test: the two count-based budgets alone measure only raw candidate rejection
    (~0.3µs/pair) and confirmed-pair *counting*, never the cost of the probe-classification loop those
    confirmed pairs feed into, so a candidate rich in confirmed intersections could previously run
    unbounded while staying under both counts. This fixture is the one that actually forces the
    confirmed-intersection path to consume the time budget, not just the raw-candidate path the
    existing budget fixture above already covers.
  - **the same fixture, but asserting the abort fires mid-probe-loop, not only at the next confirmed
    pair's callback entry** — with a mocked clock, arrange for the deadline to cross partway through
    one confirmed pair's 12-probe classification, and assert the traversal aborts having evaluated
    strictly fewer than 12 probes for that pair. Round 11's regression test for round 10's own
    too-coarse fix: checking `performance.now()` only at callback entry (once per confirmed pair) still
    let a single pair's full probe loop — up to 24 `classifyPoint` calls — run unchecked once entered.
    This is the fixture that would fail against the round-10 version of the check and pass only once
    the checkpoint moves inside the probe loop itself.
- `ContainmentQuery.classifyPoint` — the three-valued primitive, tested on its own:
  - a point demonstrably inside / demonstrably outside — `inside` / `outside`
  - **a point lying exactly on the interior of a target face** — must return `boundary`, **not**
    `inside`. Direct regression test for the round-3 defect that would have re-promoted face contact
    to `volume-overlap`; assert it for several ray directions, since the old failure was
    direction-dependent.
  - a point on a target edge, and one on a target vertex — `boundary`
  - a mesh where the answer is only correct with `THREE.DoubleSide` (a thin shell whose back-facing
    crossings a front-face-only raycast would miss)
  - **two coincident duplicate triangles** with a ray through them — verifies hits are distance-sorted
    *then* merged so the duplicated surface counts as one crossing. (Note this fixture tests
    *coincident surfaces*, not a shared edge: a ray grazing a shared edge is rejected by
    `barycentricEpsilon` and retried on the next generic direction, so it never reaches the merge
    logic. An
    earlier draft asserted merge behavior on a shared-edge ray, which the algorithm can't reach —
    a genuine contradiction between spec and test.)
  - a target under a **non-uniform scale** instance transform — verifies scale-relative tolerances
    and local-frame ray directions behave, since this is exactly where a world-space epsilon or a
    world-axis ray direction would have gone wrong
  - **a point inside two nested closed shells** (concentric boxes) — must return `outside`, pinning
    the declared even-odd model. Pair it with a **pipe fixture** (annulus, point in the bore →
    `outside`) so the test suite records *why* even-odd was chosen, not merely that it was; and with
    a **nested independent solids** fixture asserting the same `outside` result as the documented
    limitation, so the tradeoff is visible in the tests rather than only in prose.
- `ContainmentQuery.anyComponentInside` — the sampling wrapper:
  - **a two-component geometry where only the smaller, second component lies inside the target** —
    must report contained. Regression test for the capped-sampling false negative: a
    connectivity-blind sampler can miss the small component, per-component coverage cannot.
  - **two solids joined at a single shared vertex, one inside the target and one outside** — must
    report contained. Regression test for round 3's broken exactness proof; with vertex-based
    union-find these merge into one component and the contained solid can be missed, with
    edge-connectivity they are separate components and it cannot.
  - **two solids joined along a shared edge, one inside and one outside** — the case
    edge-connectivity does *not* separate. Whatever the sampled result, the component must be flagged
    non-manifold and a negative must carry `non-manifold-component`. This fixture pins the honest
    limit rather than asserting a guarantee that doesn't hold.
  - **a closed solid deep inside the target while sharing one coplanar face with it** — must report
    contained. Regression test for round 4's fixed 4-sample cap: there is no proper crossing, so the
    result rests entirely on containment, and if sampling gives up while its picks sit on the shared
    face a deep overlap is reported as a diagnosed non-overlap. Build the fixture with its shared-face
    vertices **first in index order**, so a naive "first N vertices" pick provably fails it.
  - **a component every one of whose vertices lies on the target's surface** — exercises the
    constructed-interior-witness stage, which is the only stage that can resolve it.
  - **the same witness case with source and target at markedly different local scales, arranged so
    the source sorts second** in canonical order — must still resolve. Regression test for round 5's
    witness stage borrowing `offsetLadder`'s canonical-frame scale instead of `witnessLadder`'s
    source-frame one; with the wrong scale the ladder either exits the source or never leaves its
    `surfaceEpsilon`, and the case silently degrades to unresolved.
  - **a single open triangle placed entirely inside a closed box** — must report the containment as
    positive in both modes, and carry `unverified-open-component` **in `volume-overlap` mode only**.
    Regression test for round 5's clean false-positive (a zero-volume component cannot overlap
    anything, so an undiagnosed `true` in `volume-overlap` is the one case where a positive result is
    the unsound one) *and* for the round-7 mode split: asserting the **absence** of the diagnostic in
    `containment` mode is what pins that the split actually happened, rather than the diagnostic being
    emitted everywhere and merely looking harmless.
  - **the same single-open-triangle fixture with the roles reversed** — a closed box (public source)
    containing an open triangle (public target) — must report `volume-overlap` positive via
    `anyComponentOf(target) inside source`, carrying `unverified-open-component` with **`role:
    'target'`**, not `'source'`. Round 9's regression test: the previous wording named only an open
    *source* component, so this pair — decided by the second containment term, where the open
    component belongs to the public target — had no defined diagnostic at all, and the spike under
    this exact input reported `openComponent: true` with no parity fault and nothing pinning what
    `role` it should carry.
  - **a nearly-closed open source** — an open-bottomed box, ~all edges shared, a handful of boundary
    edges — inside a closed target. Same expectations as above. This is the acceptance-model bathtub
    in miniature, and it is the fixture that proves the rule is *mode*-scoped rather than
    *degeneracy*-scoped: round 7 tried to distinguish this case from the single triangle by measuring
    volume, and no threshold in the spec could do it. Both fixtures now take the same path.
  - **a closed source classified against an OPEN target** (a box with one face removed) — every
    result, positive and negative, must carry `unverified-parity-operand` with `role: 'target'`.
    Regression test for the round-6/7 blind spot: both rounds identified target openness as the thing
    that actually breaks parity, then wrote flagging rules that only ever inspected the source, so
    this pair returned a clean answer built on meaningless parity reads. Assert on **both** a
    positive and a negative arrangement — a rule that only fires on negatives reproduces exactly the
    asymmetry round 5 was corrected for.
  - **role accuracy, one case per path**, since which operand is indicted depends on which path
    decided (see the table under Public API): an open source producing a **proper crossing** must
    emit `role: 'source'` — round 7 emitted nothing at all on that path, and the spike papered over
    it by reporting an open source as an open *target*, which sends the reader to inspect geometry
    that is fine. A containment-decided positive with an open source must emit **no**
    parity diagnostic (it was sampled, not parity-tested) but **must** emit
    `unverified-open-component`. Asserting that pair together is what stops the two diagnostics
    collapsing into one.
  - a geometry with **more than 8 active ranges** — verifies sample budgeting is coherent (an earlier
    draft's "up to 64 total" and "at least 8 per range" were arithmetically contradictory here)
  - a geometry that exhausts `maxContainmentSamples` — verifies `incomplete-component-coverage` is
    emitted rather than a clean negative
  - **a single component with many vertices, timed (via a mocked clock) so `classifyPoint`'s
    per-call checkpoint crosses `frameBudgetMs` mid-component** — with the scheduling primitive
    mocked, must yield at least once *and* still resolve the component correctly afterward, resuming
    from exactly the next unsampled vertex rather than restarting or skipping samples. Regression test
    for intra-loop yield-and-resume: unlike `ProperCrossingQuery`'s time-abort, this must not degrade
    the result, since correctness (not just responsiveness) depends on the loop actually resuming
    rather than truncating. Also assert the checkpoint fires **before** the sample whose elapsed time
    crosses the deadline is classified, not after — round 11's regression for round 10's own
    too-coarse (`every 256 samples`) checkpoint.
  - **the same fixture, but the model is evicted (mocked) during the mid-loop yield** — sampling must
    not resume; the enclosing `findClashes` call rejects with `ModelEvictedError` rather than returning
    a result computed from a partially-stale sample set.
  - **the same fixture again, but `world.dispose()` runs during the mid-loop yield instead** — must
    reject with `WorldDisposedError`, not `ModelEvictedError`: the resumed intra-loop checkpoint runs the
    same two-part protocol every boundary checkpoint runs, `disposed` first. A design whose intra-stage
    checkpoints re-check only the load epoch passes the eviction fixture above and fails this one.
- `GeometryConnectivity`:
  - a mesh with duplicated seam vertices — over-segments into multiple components (conservative,
    accepted) rather than failing
  - closed manifold, open shell, and non-manifold (three-triangle edge) inputs — verifies the
    manifold flag that the containment guarantee is conditioned on
- `VolumeOverlapQuery` (composition-level):
  - box fully inside box; separated boxes — baseline sanity
  - **flush touching only — must report NO overlap.** The headline round-3 behavior change, and the
    behavior the original CSG implementation had.
  - an **L-shaped (non-convex) room** with an element in the concave notch
  - a **torus with a small element centered in its hole** — no overlap (round 1's false positive)
  - an element **fully embedded off-center** in a large room — overlap (round 1's false negative)
  - a **door-like element straddling two room volumes** through a wall opening — overlap with both
  - a pair whose only unresolved components sit under a negative result — verifies the negative
    carries `inconclusive-containment` rather than being reported as verified
- `ContainmentModeQuery` (composition-level):
  - **a source straddling the target boundary with no vertex inside it** — the round-8 regression,
    tested in two forms: a **duct through a beam**, and a **single large triangle passing through a
    room with all three corners outside**. Both must report contained. The round-7 draft returned a
    *clean false* on both, because it sampled only vertices; this is the fixture set that forces
    `SurfaceCrossingWitness` to exist. The lone-triangle form is the sharper one — no sampling
    strategy over vertices can pass it at any budget, so it cannot be fixed by raising a cap.
  - **the same room/element pairs as above, asserted for direction**: `containment(element, room)` is
    true and `containment(room, element)` is false. `volume-overlap` must return the *same* answer
    for both orderings on both inputs. This pins that `containment` is directed while
    `volume-overlap` is symmetric — the one behavioral difference between the modes beyond their
    diagnostics, and the one a shared `anyComponentInside` implementation could silently erase.
    Note this assertion is only correct under the **surface** reading of the source (see Query
    modes): under the looser "any part of the source" wording a review pass correctly showed it is
    false, since the room volume the element occupies lies inside the element. The fixture and the
    contract were fixed together.
  - **flush touching only** — false, matching `volume-overlap`: boundary contact yields no `inside`
    classification in either mode. Specifically verifies `SurfaceCrossingWitness` rejects coplanar
    candidate pairs, since a face-to-face pair produces an intersection segment but no interior
    point.
  - **budget exhaustion in the surface-crossing stage** — shares the interleaved-comb input with the
    other two modes, and must abort with `crossing-budget-exhausted` rather than run unbounded. Stage
    2 added a third traversal to the design; the round-7 lesson was that each new traversal needs its
    own bounding proof rather than inheriting the claim that "the budgets bound the worst case."
  - **two exactly coincident closed boxes (identical geometry, identical transform)** — round 9's
    counterexample: `containment(A, B)` must be **false**, and — because every vertex reads `boundary`
    and every triangle-triangle contact is coplanar (so `SurfaceCrossingWitness` never gets a target
    line either) — the result carries `inconclusive-containment`, not a silent clean false. Regression
    test for the stage-3 constructed witness having been reachable from `containment` mode at all: with
    stage 3 still in the composition this fixture reads `true` (a witness built just inside the shared
    surface lands inside both boxes), which is precisely the surface-only contract violation round 9
    found.
  - **a source triangle much smaller than the pair's canonical diagonal, arranged so every
    `offsetLadder`-scaled rung would fall outside the triangle** (e.g. a small triangle on a geometry
    sharing a BLAS with a much larger, distant component) — must still find the witness via
    `crossingProbeFractions`' per-triangle scaling. Regression test for round 9's finding that the
    canonical-frame ladder is the wrong quantity to scale a single triangle's probe by; the spike's own
    implementation used `min(src.L, target.L)` rather than the spec's `L_canonical`, which this fixture
    would have caught either version failing.
  - **the same small-triangle case shrunk further, so no offset can both stay inside the triangle and
    clear `surfaceEpsilon`** — must report `inconclusive-crossing` on a negative result, not a silent
    "no witness." Regression test for the failure mode itself: an unproducible probe folded into a
    clean negative would reproduce the exact bug this stage exists to close, just relocated from "wrong
    scale" to "no valid scale at all."
- `CollisionWorld.findClashes` — cross-pair/cross-stage yielding, tested with the scheduling primitive
  mocked so the assertion is on *whether* a yield happened, not on wall-clock:
  - **many cache-warm candidate pairs (every BLAS pre-built), each individually cheap but summing past
    `frameBudgetMs`** — must yield at least once before completing. Regression test for round 9's
    finding that "cached BLAS hits don't yield" left an unbounded run of cheap pairs with no checkpoint
    at all; asserting the mock was called is what pins that the cross-pair checkpoint exists
    independently of any BLAS build.
  - **a single pair whose composed stages (`ProperCrossingQuery` then both `ContainmentQuery`
    directions) individually stay under budget but sum past `frameBudgetMs`** — must yield between
    stages, not only between pairs. Regression test for round 9's core counterexample: three
    per-stage-correct budgets composed with no checkpoint between them.
  - **a query cheap enough overall to never cross `frameBudgetMs`** — must complete with **zero**
    yields. Pins that the checkpoint is time-triggered, not inserted unconditionally at every stage or
    pair boundary, so the common small-query case (e.g. the room-locator's actual acceptance input)
    isn't paying scheduling overhead it doesn't need.
  - **Round 15's core regression test for the preprocessing-budget Critical: a first-time
    `GeometryRecord` build, mocked so welding, connectivity, and BVH construction each report a distinct
    non-trivial synthetic cost individually under `frameBudgetMs` but summing well past a single
    checkpoint's tolerance** — spy on the budget-checkpoint helper itself (not on the scheduling yield) and
    assert it is **evaluated** exactly three times, immediately before welding, connectivity, and BVH
    construction respectively, distinguishing via the spy which phase was about to run at each evaluation.
    **Round 22 correction: do not assert the scheduling primitive itself — the actual `await` yield —
    fires three times.** It fires only when a given checkpoint finds the accumulator already due, which
    depends on the specific mocked costs (see the corrected worst-case-span formula and
    `ThreeMeshBvhBackend`/`BlasCache`'s per-phase discussion); with all three costs individually under
    `frameBudgetMs`, the real yield count here is at most one, not three. What this fixture actually
    guards against — one opaque checkpoint call before "get/build BLAS" covering all three phases' summed
    cost, reintroducing exactly the coverage gap round 15 found — is caught by the checkpoint-evaluation
    count alone (three, not one), independent of how many of those evaluations go on to yield.
  - **the same first-time build, but a `volume-overlap` query runs instead of `containment`** — the
    connectivity-phase checkpoint must **still be evaluated** (asserted via the same spy), pinning that
    `volume-overlap` also consumes connectivity via `anyComponentInside`. Round 16's core regression test
    for the connectivity-dependency Critical: round 15 shipped this exact fixture asserting the *opposite*
    (no connectivity checkpoint for `volume-overlap`), which round 16 found directly contradicts
    `VolumeOverlapQuery`'s own established algorithm — a fixture testing for the wrong behavior is itself
    the bug.
  - **the same first-time build, but a `surface-intersection` query runs instead** — the connectivity-phase
    checkpoint must **not be reached** (asserted via the same spy). `surface-intersection` is the only mode
    that never calls `anyComponentInside`, so it's the only one this fixture now applies to.
  - **a checkpoint between build phases finds the model evicted (or the world disposed) before the next
    phase starts** — the in-flight phase slot must reject, and the record's `GeometryRegistry` entry
    (published in `buildState: 'building'` when the build started) must be **removed synchronously as
    part of that rejection**, taking whatever intermediate buffers exist with it: a subsequent lookup for
    that `(loadEpoch, geometryIndex)` must miss — never a lingering `'building'` entry, never a partial
    record observable as reusable or `'ready'`. A later, valid `findClashes` call for the same geometry
    must start the pipeline fresh (asserted via a spy: welding runs again, not resumed from a cached
    partial record).
  - **two concurrent `findClashes` calls whose candidate pairs need the same `(loadEpoch,
    geometryIndex)`, interleaved so the second call's lookup lands while the first is suspended at a
    between-phases checkpoint** — the second must find the first's `'building'` registry entry and await
    its phase slots; spies on compaction, `mergeVertices`, the connectivity build and the `MeshBVH`
    constructor must each show **exactly one** call. Regression test for the pre-`buildState`
    publication rule, under which the in-flight build was invisible and the second caller duplicated
    every phase — the dedup `accelerationPromise` was credited with never actually held, for any phase.
  - **the same interleaving with one `surface-intersection` call and one `containment` call** — the
    `containment` caller must reuse the `'ready'` record's compaction/weld and BVH (spies: one call
    each) and drive the connectivity phase itself against that same entry, while the
    `surface-intersection` caller completes without ever awaiting connectivity. Pins that `'ready'` is
    record-level (weld + BVH) and that connectivity is an additional per-query requirement, not a fourth
    thing a record must have before anyone can use it.
  - **`world.evictModel(model)` called while a lazy connectivity build is suspended at its own
    between-phases checkpoint, against an entry that is already `buildState: 'ready'`** (weld and BVH
    already resolved; a `containment`/`volume-overlap` caller triggered connectivity afterward, per the
    fixture immediately above) — the caller awaiting that connectivity promise must have it **reject**,
    not hang, and the registry entry must be removed, identity-guarded, in that same step. Regression
    test for C-2: a design that only rejects the entry's cancellation signal when its `buildState` is
    `'building'` leaves this caller's promise permanently unsettled, because `releaseEpochScopedState`
    still deletes the (already-`'ready'`) entry without ever settling the signal the lazy connectivity
    build races.
  - **the same fixture, but `world.dispose()` runs instead of `evictModel`** — the suspended connectivity
    promise must likewise **reject**, with `WorldDisposedError`, not hang, even though the entry hosting
    it is `'ready'` rather than `'building'`. Regression test for the identical gap in `dispose()`'s
    wholesale clear: "every entry still in buildState 'building' is reachable" is not the same claim as
    "every entry with an unresolved phase slot is reachable," and this fixture is what distinguishes
    them.
  - **`world.evictModel(model)` called against an epoch that contains an *oversized marking* (no phase
    ever started, no `buildState`) alongside ordinary `'building'`/`'ready'` entries filed under the same
    epoch** — eviction must complete without throwing, and the oversized marking must be removed from
    `GeometryRegistry` in the same sweep as the others; a spy on whatever mechanism rejects a cancellation
    signal must show **zero** calls attributable to the oversized marking's entry, while the genuine
    `'building'`/`'ready'` entries' signals are still rejected exactly once each. Regression test for C-5:
    wording that settles "every entry, regardless of `buildState`" by rejecting a cancellation signal
    cannot be satisfied for an oversized marking, which never has one — this fixture pins that removal
    alone, with no signal-rejection attempt, is what happens to it.
  - **the same fixture, but `world.dispose()` runs instead of `evictModel`** — the wholesale clear must
    likewise remove the oversized marking without throwing and without attempting to reject any
    cancellation signal for it, while still rejecting the genuine `'building'`/`'ready'` entries' signals
    in the same pass. Regression test for the identical C-5 gap in `dispose()`'s wholesale-clear wording.
  - **two concurrent `findClashes` calls against the same admitted model, interleaved until both await
    the same unresolved phase slot, followed by `world.evictModel(model)`** — the entry-scoped
    cancellation signal must be rejected exactly once; both `findClashes` promises must reject with
    `ModelEvictedError`, neither may remain pending, and the evicted entry must no longer be present in
    `GeometryRegistry`. Build spies must show the shared phase was started only once. Regression test for
    broadcasting entry-scoped cancellation to every waiter on a single-flight build — not a test of the
    owner-vs-counterpart scoping distinction stated in "A build-phase checkpoint validates the record's
    *owner*, not the building caller's whole query" above, which Milestone 1's same-model restriction
    makes unreachable (a distinct non-owner counterpart cannot exist to evict; see that rationale for why
    the distinction is retained anyway, for a future cross-model milestone).
  - **Round 16's core regression test for the active-range-compaction Critical: a fragment whose raw
    index buffer encodes far more triangles than `maxSyncTriangleCount`, but whose `ranges: TriangleRange[]`
    (from normalization) cover a small active subset well under the ceiling** — the pair must **not** be
    skipped as `geometry-too-large-for-sync-build` (the active count is what's checked, not the raw
    count), and a spy on the weld step (`mergeVertices` or its call site) must show it was invoked with a
    geometry sized to the *active* triangle count, never the raw one. A design that checks
    `maxSyncTriangleCount` against the raw index (or against the active count but still hands the raw,
    uncompacted buffer to welding) fails this fixture — passing the size gate is not the same as never
    touching the excluded triangles.
  - **the inverse: a fragment whose active-range triangle count alone already exceeds
    `maxSyncTriangleCount`** — must be skipped as `geometry-too-large-for-sync-build` **without** ever
    materializing a compacted buffer (asserted via a spy on the compaction step itself: zero calls),
    pinning that the ceiling is checked against the cheap
    `activeTriangleCount = Σ floor(ranges[].count / 3)` before any copying, not after.
  - **the unit boundary, both sides: a fragment whose ranges sum to `39_000` index elements (13,000
    triangles) must be skipped, and one whose ranges sum to `33_000` index elements (11,000 triangles)
    must be built** — pinning that the comparison converts index elements to triangles instead of
    comparing `sum(ranges[].count)` against `maxSyncTriangleCount` directly. An implementation that
    omits the `/ 3` fails the second case: it enforces a ceiling of ~4,000 real triangles, which is the
    3×-too-strict gate this conversion exists to prevent.
  - **a single requested dbId whose node tree (mocked via `enumNodeChildren`/non-recursive
    `enumNodeFragments`) would yield far more fragments than `maxFragmentsPerDbId` if fully walked** —
    `findClashes` must reject the entire call before any broad-phase or narrow-phase work runs, naming the
    offending dbId, asserted via a spy that no `CollisionInstance` was built for *any* dbId in the query,
    not only the oversized one. Round 15's regression test for extraction having no ceiling at all: a
    design that only checkpoints *between* dbIds (composition) passes an unbounded single dbId straight
    through.
  - **Round 16's core regression test for the extraction Critical: the same oversized-subtree mock,
    but asserting the walk itself stops early** — mock the subtree so it would take, say, 100 node visits
    to fully enumerate but crosses `maxFragmentsPerDbId` by node visit 10; assert via a spy that
    `enumNodeChildren`/`enumNodeFragments` were called roughly 10 times, not 100, before `findClashes`
    rejects. A design that still performs one recursive `enumNodeFragments(dbId, cb, true)` call and only
    checks the ceiling on the total afterward passes the fixture above (it does reject) but fails this
    one — it enumerated the full 100-node subtree first, which is the exact "detects the overrun after
    the freeze already happened" bug round 16 found in round 15's own mechanism.
  - **Round 18's coverage-equivalence fixture for the extraction walk — the thing that actually earns
    the claim `ViewerModelAdapter` now makes**: on the pinned acceptance model, for representative
    **parent, interior, and leaf** dbIds — including the family node `2527`, whose child instance's
    fragment is the original reason the recursive form was specified — assert that the set of unique
    fragment ids the self-driven walk collects **equals** the set `enumNodeFragments(dbId, cb, true)`
    returns for the same dbId. Compared as sets: order is not asserted. Assert separately that the walk
    built exactly one `CollisionInstance` per unique fragment id, so a fragment reported under two nodes
    does not become two collision instances. This fixture is what establishes that the two traversals
    agree on a real build; the argument under `ViewerModelAdapter` establishes only that they agree
    *given a complete instance tree*, which is a Viewer readiness property this fixture cannot prove
    (see **Risks**).
  - **The invariant-audit fix's regression test for the fanout ceiling (finding C-1): a requested dbId
    whose subtree contains one node with more than `maxChildrenPerNode` direct children** — run the case
    twice, once with that node owning **zero** fragments directly (fragment-free, making
    `maxFragmentsPerDbId` structurally incapable of firing) and once with it owning fragments (mixed).
    In both runs `findClashes` must reject the entire call, naming that node, and a spy on the
    `enumNodeChildren` callback must show **exactly `maxChildrenPerNode + 1` invocations, never more,
    regardless of node shape** — the only thing that distinguishes an enforced ceiling from an observed
    one, and the thing that pins down that the mixed and fragment-free cases are bounded identically.
    Assert separately, in both runs, that **`getChildCount` is never called** by the walk: round 18's
    design called it as a preflight and credited it with resolving the fragment-free case cheaply and
    reliably; the invariant audit found that credit false — for a mixed node the same read is an
    unbounded linear scan with no early exit, strictly worse than the `enumNodeChildren` call it was
    meant to gate — and removed the preflight from the enforcement path entirely, so a fixture that still
    exercises a `getChildCount` mock, or that special-cases "the node is mixed," is pinning a call this
    design no longer makes. Include a node whose first child dbId is `0`, pinning that the abort is
    carried by a local flag rather than by the enumeration's forwarded return value, which would be
    falsy for that dbId.
  - **A companion fixture pinning the non-abort path: a node with exactly `maxChildrenPerNode` direct
    children (at the ceiling, not over it)**, run once fragment-free and once mixed. The walk must
    enumerate the node **completely** with no early abort and no rejection: a spy on the
    `enumNodeChildren` callback must show all `maxChildrenPerNode` invocations ran (not
    `maxChildrenPerNode + 1`), and `findClashes` must proceed normally past this node in both runs. This
    is what distinguishes a ceiling that only ever fires from one that fires precisely at the boundary
    the spec states.
  - **Round 18's regression test for the chunked broad phase: mocked instance counts whose product is
    comfortably under `maxBroadPhaseInstancePairs` but large enough to exceed `frameBudgetMs`** (with a
    mocked clock) — the scan must `await` a scheduling yield mid-scan and then examine **every remaining
    pair**, asserted by counting AABB tests: the total must equal `sourceCount × targetCount`, never a
    truncated prefix. A design that treats the time check as a cutoff rather than a yield produces a
    silently incomplete candidate set, which is a false negative dressed as a budget. Pair it with an
    eviction case — evict one operand while that mid-scan yield is suspended, and assert the resumed
    scan rejects with `ModelEvictedError` rather than continuing against stale instances.
  - **`sourceInstances.length × targetInstances.length` exceeding `maxBroadPhaseInstancePairs`** (mocked
    instance counts, not real geometry) — `findClashes` must reject before the nested AABB scan begins,
    asserted via a spy that the broad-phase scan function was never invoked. Include a case where
    `sourceInstances.length` and `targetInstances.length` are both large enough that their product would
    lose precision or behave unexpectedly under naive multiplication, confirming the implementation uses
    the overflow-safe division form specified under **Data Flow** step 3, not direct multiplication.
  - **`world.evictModel(model)` called (mocked as synchronous) while a pair/stage-boundary yield for
    that same object is suspended** — the resumed call must reject with `ModelEvictedError` and must
    not touch any cached BLAS/instance/geometry state for that model afterward. Round 10's core
    regression test: the liveness check is what makes this true, not the mere existence of
    `evictModel`'s cache-clearing.
  - **`world.dispose()` mid-query** — must reject with `WorldDisposedError`, checked directly by the
    resumed checkpoint (see the round-15 `isLeaseValid`/`isModelLive` fixtures above for why this is no
    longer routed through a per-model tombstone). Regression test for the previous "in-flight promises
    reject cleanly" wording, which named an outcome without a mechanism.
  - **a query against a `modelId` that is evicted and then reloaded (a *different* `Model` object under
    the same id) before the suspended call resumes** — the resumed call, which holds a reference to the
    *original* (now-evicted) object, still rejects with `ModelEvictedError` rather than silently
    completing against the new object's geometry. Round 11's regression test for round 10's own ABA
    bug, still valid under round 12's redesign: assert it against a mocked `nextLoadEpoch` sequence
    where the reloaded model's epoch differs from the evicted model's, so a design that accidentally
    reused the same numeric value can't pass by coincidence.
  - **`findClashes` called directly with an already-evicted `Model` object as `source.model`/
    `target.model` — no suspended yield involved, eviction happened before the call started** — must
    reject with `ModelEvictedError` immediately, asserted via a spy that no BLAS build, geometry
    extraction, or `CollisionInstance` construction was attempted. Round 12's core regression test: the
    round-11 design only checked liveness at yield points, so a call that never yields before hitting
    the evicted state (a small query, or one where every needed BLAS happens to already be cached)
    could complete against dead geometry undetected. This is the fixture that specifically requires an
    entry-point check, not just yield-point re-validation.
  - **a room-search promise that rejects, followed by a second `locateElementByRoom` call for the same
    model** — the second call must trigger a fresh `model.search`, not replay the cached rejection.
    Regression test for the previous "caches the resulting promise" wording never specifying what
    happens after rejection.
  - **room search starts → model evicted → the search callback fires late (mocked) with a successful
    result** — `locateElementByRoom`'s original returned promise must **reject** with
    `ModelEvictedError`, and `findClashes` must never be called (assert via a spy). Round 12's core
    regression test for the resurrection bug itself: the round-10/11 guard only suppressed the *cache
    write* on a late success, leaving the caller's own promise either resolved with stale data or
    (worse) permanently unsettled; this fixture is the one that would have caught either failure mode,
    since it asserts on what the *original caller* observes, not on the cache's internal state.
  - **the same sequence, but a *new* `Model` object then loads under the same numeric `modelId` before
    the stale search callback fires** — the stale search must still reject its original caller exactly
    as above, **and** a fresh `locateElementByRoom` call against the *new* object must succeed
    independently, proving the two loads' room caches (keyed by object identity, not `modelId`) never
    alias each other.
  - **a model's first-ever room search — no prior `findClashes` call for that object, so no lifecycle
    entry exists before `locateElementByRoom` runs** — must succeed and resolve room dbIds normally.
    Round 13's core regression test for the resurrection *fix's own* regression: a design that checks
    `isModelLive`/an equivalent "have I seen this before" liveness query, instead of admitting the model
    up front and validating a captured lease, fails this fixture by rejecting with `ModelEvictedError`
    on a model that was never evicted at all.
  - **`world.admitModel(model)` called twice on the same still-live object** — must return leases with
    the same `epoch` both times (idempotent, does not re-admit or bump the epoch), asserted via a spy
    that `nextLoadEpoch` was only consumed once.
  - **`world.admitModel(model)` called on an already-evicted object** — must throw `ModelEvictedError`
    synchronously, immediately, without consuming a new epoch (asserted via the same spy as above),
    proving admission cannot resurrect a tombstoned object even when called directly rather than through
    `findClashes`.
  - **`world.evictModel(oldModel)` called (mocked as a stale/delayed call) after a *different* `Model`
    object has already been admitted under the same numeric `modelId` and has live `CollisionInstance`/
    BLAS state** — `oldModel`'s own lifecycle entry must end up tombstoned `'evicted'`, but the new
    object's canonical `CollisionInstance`/BLAS/`GeometryRecord` cache entries must be asserted unchanged
    afterward — **same canonical object references** (per `(loadEpoch, fragmentId)` for
    `CollisionInstance`, per `(loadEpoch, geometryIndex)` for the registry), no rebuild triggered — and a
    `findClashes` call against the new object immediately after must succeed without a fresh BLAS build
    **and constructs a fresh, call-local `PlacedCollisionInstance` for each fragment as normal** (the
    canonical-instance identity is what's asserted stable, not the per-call placement, which is never
    cached and is expected fresh on every call). Regression test for round 13's `liveModelByModelId`
    bookkeeping guard: a stale eviction must not delete the map's entry for the object that currently
    holds it.
  - **Two interleaved `findClashes` calls against the same fragment, with a transform mutation between
    them** — call A begins, its broad phase captures a `PlacedCollisionInstance` for fragment F and
    yields; before A resumes, call B starts, looks up the *same* canonical `CollisionInstance` for F
    (assert same object reference as A's), builds its own fresh placement with F's now-mutated transform,
    and completes; A then resumes and completes. Assert A's own placement snapshot for F is unchanged
    from what it captured before B ran (A's result reflects the pre-mutation transform, B's reflects the
    post-mutation one) — regression test for the redesigned cache's core correctness property: sharing
    one canonical `CollisionInstance` reference across concurrent calls must never let one call's
    placement construction affect another's.
  - **`findClashes` called against a model whose epoch's `CollisionInstance` bucket is already at
    `maxCollisionInstancesPerEpoch` capacity, querying at least one fragment not yet in that bucket** —
    the entire call must reject before any bucket changes or broad-/narrow-phase work starts (asserted
    via a spy: no `PlacedCollisionInstance` is constructed for any fragment in the query). A repeat call
    querying only fragments already resident in the bucket must succeed normally, since it creates no new
    entries and cannot itself exceed the ceiling.
  - **A *different* `Model` object is admitted under a reused `modelId` and queried *before* the old
    object under that same id is ever evicted** — i.e. the old object's `modelLifecycle` entry is still
    `'live'` throughout. The new object's first `findClashes` call must build a **fresh** `GeometryRecord`
    and BLAS (asserted via a spy: the BLAS-build path runs, it is not a cache hit) and must return clash
    results computed against the *new* object's own geometry, not the old object's. Round 14's core
    regression test for the model-ID-reuse Critical: a design that keys `GeometryRegistry` by bare
    `modelId` fails this fixture by silently reusing the old object's cached `GeometryRecord`/BLAS,
    since nothing about the old object's eviction status is involved in this failure mode at all — the
    `(loadEpoch, geometryIndex)` keying fix is what a design must actually implement to pass it, not any
    eviction-side guard.
  - **`world.isLeaseValid(lease)` called after `world.dispose()`, from inside a mocked async callback
    (mirroring the room-search success callback's own calling context)** — must return `false`
    synchronously and must **not** throw. Round 14's regression test for the disposal-contract
    contradiction: a design in which `isLeaseValid` throws `WorldDisposedError` (matching the literal
    pre-round-14 wording of `world.dispose()`'s method list) fails this fixture with an uncaught
    exception from the mocked callback, which is exactly the "the caller's promise is left unsettled"
    failure mode the fixture exists to catch.
  - **`world.isModelLive(model)` called after `world.dispose()`** — must throw `WorldDisposedError`,
    distinguishing it from `isLeaseValid`'s non-throwing contract above; a test asserting the wrong
    behavior for either method is a regression in its own right, since they are deliberately different.
  - **`world.dispose()` called, followed by a new `findClashes` call** — must reject immediately with
    `WorldDisposedError`, before any per-model check, asserted via a spy that no geometry work was
    attempted. Distinguish this from the `ModelEvictedError` fixtures above: a test asserting the wrong
    error type here is a regression in its own right, since callers may branch on which one they got.
  - **a query suspended at a yield checkpoint, then `world.dispose()` runs, then the query resumes** —
    must reject with **`WorldDisposedError`** and must touch no BLAS/instance/geometry state released by
    disposal. Round 15 revised this fixture's own expected error: rounds 12–14 expected `ModelEvictedError`
    here, reasoning that dispose()'s per-model tombstone sweep was what the resumed checkpoint would see.
    Round 15 found that sweep isn't guaranteed to reach every live model (see the next fixture) and fixed
    the checkpoint to test `disposed` directly, first — so the resumed checkpoint now fails on `disposed`
    before it ever reaches the per-model check, and a correct implementation surfaces `WorldDisposedError`
    here, not `ModelEvictedError`. A test still expecting `ModelEvictedError` is itself the regression.
  - **Round 15's core regression test for the disposal-enumeration Critical: two distinct `Model` objects
    admitted under the same reused numeric `modelId`, both left live (the old object's own eviction never
    runs), each with its own query suspended at a yield checkpoint — then `world.dispose()` runs.** Both
    suspended queries must reject with `WorldDisposedError` on resume, including the *old* object's query
    — the one `liveModelByModelId` cannot reach, since it holds only the new object for that id slot. A
    design that makes `dispose()`'s per-model tombstone sweep (walking `liveModelByModelId`) the sole
    mechanism for this fails the old object's query, which resumes seeing a stale `{state: 'live'}` entry
    the sweep never reached and incorrectly completes. This is exactly the scenario Codex's round-15
    review identified; it is also why `isLeaseValid`/`isModelLive` fixtures above must check `disposed`
    is consulted directly rather than inferred from per-model state.
  - **`world.evictModel(model)` called for a `Model` object with no prior `modelLifecycle` entry at all**
    (mocked as `BEFORE_MODEL_UNLOAD_EVENT` firing for a model that was loaded but never touched
    `findClashes`/room-search) — Round 15's core regression test for the evict-before-admit Critical:
    `modelLifecycle.get(model)` must read `{ state: 'evicted' }` afterward (no `epoch` field), a
    subsequent `world.admitModel(model)` or `findClashes(model, …)` must reject permanently with
    `ModelEvictedError`, and no epoch-scoped cache release is attempted (asserted via a spy — there is
    nothing to release, since this object was never admitted). A design that requires an `epoch` on every
    `modelLifecycle` entry (the pre-round-15 single-shape type) cannot represent this state at all and
    either throws constructing the tombstone or silently skips it, letting the object be admitted later
    as if it were a legitimate first use.
  - **`world.evictModel(model)` called twice on a `Model` object that was live with cached
    `GeometryRecord`/BLAS state at the time of the first call** — the first call must tombstone the entry
    and release the epoch-scoped state (asserted via a spy); the second call must be a no-op (asserted via
    a spy that no further release is attempted, since the evicted entry no longer carries an epoch to
    release against). Regression test for the idempotent-double-eviction edge case: a second eviction
    must never throw or attempt to re-derive a released epoch it no longer has access to.
  - **`world.evictModel(model)` called after `world.dispose()`, from inside a mocked
    `BEFORE_MODEL_UNLOAD_EVENT` dispatch** — must return normally and must **not** throw (asserted by
    letting the mocked dispatch loop continue to a second model and asserting it was reached), and must
    attempt no epoch-scoped release (spy). Regression test for the Critical the round-18 pass fixed: in
    the pinned 7.124.2 bundle `EventDispatcher.dispatchEvent` invokes listeners with no try/catch and
    `unloadCurrentModel` unloads models in an unguarded loop, so a design in which `evictModel` throws
    `WorldDisposedError` here aborts the Viewer's teardown of every remaining model. A test asserting
    that `evictModel` throws after disposal is itself the regression.
  - **the world disposed while a `locateElementByRoom` room search is in flight, then the mocked
    `model.search` success callback fires** — the original caller's promise must reject with
    **`WorldDisposedError`**, not `ModelEvictedError`, and the cache slot for this promise must be
    deleted (identity-guarded: assert `roomCache.get(model)` no longer holds this promise, not merely
    that some entry exists), not left cached. Paired with the eviction fixture above (which must still
    reject `ModelEvictedError`), this pins that `isLeaseValid`'s single `false` is mapped to the *cause*
    by the callback, not collapsed. **Assert the same for the error callback**, so the two callbacks
    cannot classify one invalid lease differently, including the delete. A follow-up
    `locateElementByRoom` call for the same model afterward must trigger a fresh `model.search`, not
    replay the rejection or any stale state — the same retry guarantee the round-10 rejection fixture
    above pins for the general case, now confirmed for the invalid-lease branch specifically.
- `ViewerGeometryAdapter` against fixtures covering:
  - the confirmed primary `vb`/`vbstride`/`vblayout` layout
  - standard `attributes.position.array` (non-interleaved `BufferAttribute`)
  - standard `attributes.position.data.array` (real three.js `InterleavedBufferAttribute`) — the
    layout the previous draft omitted entirely. Use a **stride greater than 3 with a nonzero position
    offset** (e.g. position+normal+uv interleaved, position at offset 3), so a mapping that ignores
    either field produces visibly wrong vertices instead of accidentally passing on a stride-3,
    offset-0 buffer where every plausible mapping agrees.
  - index via `geometry.index.array` (the correct standard three.js location) — verifying the fixed
    fallback, since the previous draft incorrectly checked `attributes.index.array`
  - `geometry.groups` populated vs. absent (verifying the single-synthesized-range fallback)
  - **`geometry.groups === []`** — the empty-but-present case, which must synthesize the full range
    and yield the *same* triangle count as the absent case. This is the one that actually bites:
    standard `BufferGeometry` initializes `groups = []` in its constructor, so **every** fallback-path
    geometry hits it, and a `groups ? … : …` test emits zero ranges — a fragment that silently
    contributes nothing, indistinguishable in the result from a verified no-clash. Assert on the
    triangle count, not just on "no error thrown," since not throwing is precisely the failure mode.
  - `geometry.groups` **and** `geometry.drawRange` both present, with a group whose range only
    partially overlaps the draw range — verifying the two are intersected, not treated as either/or
  - a fixture using a legacy `offsets` layout — verifying it's explicitly rejected (recorded as
    `rejected-primitive-range`), not silently normalized with a guessed `baseVertex`
  - **welding**: a geometry carrying per-face normals and uvs must weld to the vertex count of its
    *distinct positions* (a box: 24 → 8) and to one closed manifold component. Assert the count, not
    just that welding ran — the failure this pins is silent: `mergeVertices` compares all attributes,
    so welding before stripping merges **nothing** and returns a geometry that looks fine and has
    every edge a boundary edge.
  - **welding under a non-default unit scale** — the same geometry authored in millimetres and in
    metres must produce the same component count, verifying `weldEpsilon` is derived from
    `model.getUnitScale()` rather than left at the unit-blind `1e-4` default
  - **clean-install module resolution**: after `npm run build:vendor`, load the sandbox app and import
    every module under `collision/`, `wwwroot/vendor/three/`, and
    `wwwroot/vendor/three/examples/jsm/utils/BufferGeometryUtils.js` — no unresolved module request.
    Round 10's regression test for the welding vendor gap: `mergeVertices`'s import would 404 without
    this file present, and nothing in the existing fixture set (which calls `mergeVertices` directly
    against an already-resolved module, not through the app's own import map) would have caught it.

**Integration test (acceptance criterion for this milestone)**: load URN
`dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL3JhY2Jhc2ljc2FtcGxlcHJvamVjdC5ydnQ`
in the sandbox app, select `Bathtub-TOTO-Nexus-FBF794S [420270]`, trigger "Locate Room" from the
context menu, and confirm the reported/highlighted room visually matches the bathroom it's actually
in. Manual verification for this milestone — no parallel run against the old CSG extension for
cross-checking, since maintaining two implementations to compare adds scope this milestone doesn't
need.

The spike has already run this query end to end against the live model and it resolves to **Master
Bath 207 [857194]** (907 of the bathtub's 1003 world-space vertices inside; all 13 other rooms scored
exactly 0). So the acceptance answer is known in advance — which makes this a regression check on the
implementation, not an open question about the algorithm.

**Performance gate (also an acceptance criterion for this milestone)**: run one `volume-overlap`
query against an **MEP-scale model** — fragment geometries in the thousands of triangles, not the
dozens — and record BLAS build times, candidate-pair counts, and total query wall-clock. **Run it
twice**: once cold (no BLAS cached — exercises the build-boundary yield) and once immediately after,
cache-warm (every BLAS already built — exercises the `frameBudgetMs` cross-pair/cross-stage
checkpoint, since nothing in the query touches a new build the second time).

This is one gate, not the excluded benchmark suite, and it exists because of what B7 established:
the room-locator acceptance test above exercises **correctness only**. Rooms are 12–64 triangles, so
brute force resolves the whole query in 10.2ms and the BLAS cache, the lazy-build yield,
`maxSyncTriangleCount`, `maxCandidatePairsExamined`, and eviction are all untouched by it. A
milestone that keeps that machinery (as decided) and ships with no test that runs it would be
claiming performance properties on synthetic evidence alone. **Round 9 added the cache-warm run
specifically**: the build-only yield rule made the cold run's ~16ms bound plausible without ever
exercising the composed-stage/cross-pair case that only shows up once every candidate's BLAS is
already resident, which is exactly the scenario the earlier gate left unmeasured. Pass criteria:

- no single synchronous task exceeds the corrected worst-case-span bound established under
  `ProperCrossingQuery`'s budgets — `frameBudgetMs` plus one non-preemptible or abort-only atomic unit's
  own worst-case cost, **≈24ms** at the measured weld/`bvhcast` figures, not the ≈16ms this criterion
  stated through Round 21 (which omitted the `frameBudgetMs` prefix a conditional checkpoint can let a
  phase or traversal inherit — see the Round 22 re-derivation) — measured on **both** runs, **except the
  two synchronous spans this spec explicitly excludes from any worst-case-span guarantee** — one
  `enumNodeFragments(node, cb, false)` call and `releaseEpochScopedState`/`dispose()`'s own per-epoch
  registry sweep (see the worst-case-span formula's explicit exclusion, above, and the
  atomic-operations table) — for which a measurement above the band is a required recorded finding, not
  a gate failure; a measurement above the corrected bound on any other synchronous task **is** a gate
  failure, **with one provisional exception**: one `enumNodeChildren` call at the `maxChildrenPerNode`
  ceiling (criterion 7, below) is the fourth, still-unmeasured member of the ≈24ms figure's own
  enforceably-bounded tier, not one of the three costs it was computed from — if its measured cost pushes
  the true bound above ≈24ms, that is this criterion's own tolerance being corrected by measurement, not
  a failure of this criterion; every other synchronous task's ≈24ms tolerance is not provisional in the
  same way. Record the browser's longest task across each (the Long Tasks API where available,
  or `performance.now()` deltas bracketing every yield point otherwise);
- any budget that trips does so with the correct diagnostic (`geometry-too-large-for-sync-build`,
  `crossing-budget-exhausted`) rather than a freeze or a fabricated clash;
- the measured per-candidate and per-build costs are recorded next to `measure.mjs`'s synthetic
  figures, so the two can be compared rather than conflated;
- **the worst-case cost of one `classifyPoint` call and one crossing probe are measured directly and
  recorded, not merely reasoned about.** Round 11 found the per-primitive checkpoints under
  **`ProperCrossingQuery`** and **`ContainmentQuery`** bound the *overshoot* past `frameBudgetMs` to
  "one atomic operation's own cost" — a claim this spec makes but, unlike `maxSyncTriangleCount`'s
  measured ~16ms, had never actually measured for a single `classifyPoint` call or probe. This model,
  with its actual triangle density and BVH depth, is what confirms that overshoot is the negligible
  fraction of a frame this spec assumes rather than an unmeasured risk; a run whose measured per-call
  cost turns out non-negligible is itself an acceptance finding, not a pass.
- **each of the three `GeometryRecord`-build phases — welding, connectivity, BVH construction — is
  measured individually, at `maxSyncTriangleCount`, not only in combination.** Round 15 found the prior
  version of this gate only ever measured the BVH build (folded into "BLAS build times" above), which is
  exactly how a ~16.8ms weld and a ~6.9ms connectivity build at ~19,800 triangles went undetected for
  four rounds. Record each phase's own wall-clock span separately; each must individually clear its
  share of the accepted per-atomic-operation ceiling with margin, not just sum to something plausible.
  A cold run that measures connectivity — which round 16 corrected to mean **either** `containment`
  **or** `volume-overlap` (both call `anyComponentInside`), not `containment` alone — must also be
  distinguished from a `surface-intersection`-only run that doesn't touch connectivity at all, so the one
  mode that's genuinely connectivity-free isn't accidentally conflated with the two that aren't.
- **extraction cost for the largest single requested dbId, and the broad-phase scan's own cost at the
  model's actual instance counts, are measured and recorded**, confirming or revising the provisional
  `maxFragmentsPerDbId` (`5_000`) and `maxBroadPhaseInstancePairs` (`1_000_000`) ceilings — round 15
  added both ceilings reasoned, not measured, and this gate is what promotes them to measured (see the
  atomic-operations table under `ProperCrossingQuery`'s budgets). **Round 18 changed what "the
  broad-phase scan's own cost" has to mean here.** Since round 18 the scan yields and resumes mid-scan,
  so it is no longer one atomic span and a total wall-clock figure says nothing about the tolerance
  criterion above: record its **longest uninterrupted span** between two consecutive yields, alongside the
  total. Record two further numbers with it — the cost of one `performance.now()` read relative to one
  AABB-overlap test (the scan now performs one read per pair, and whether that is negligible or
  dominant decides whether the per-pair granularity survives or must be batched with a measured
  per-batch bound), and the candidate-list size the scan produces at the ceiling, since
  `maxBroadPhaseInstancePairs` also bounds memory and downstream narrow-phase work that chunking does
  not reduce.
- **Round 18: one `enumNodeChildren(node, cb, false)` call at the fanout ceiling is measured and
  recorded separately from the walk's aggregate extraction cost.** `maxChildrenPerNode` (`10_000`) is a
  provisional limit on how many callbacks one such call may cost, not a figure derived from any
  measurement — no row of the atomic-operations table measures a callback-driven native enumeration,
  and this spec deliberately declines to borrow the `bvhcast` candidate-pair figure as a proxy for a
  different API boundary. Measure two things: `maxChildrenPerNode + 1` callback invocations on the
  widest node the model offers, and — since the in-callback abort is what makes the ceiling a bound —
  **an assertion that the abort actually fires**, i.e. that no more than `maxChildrenPerNode + 1`
  callbacks run on a node with more children than that. The installed typings declare the callback's
  return as `void`, contradicting the Reference Guide's documented truthy-return interrupt, so this is
  a behaviour the gate must observe rather than trust. As with the `enumNodeFragments` row above, a
  model whose widest node has far fewer children than the ceiling cannot exercise this at all —
  recording that limitation is itself a gate finding, not a pass.
- **Round 17: the worst-case cost of one `enumNodeFragments(node, cb, false)` call, on a node chosen to
  directly own as many fragments as the model actually allows, is measured and recorded separately from
  the walk's aggregate extraction cost above.** This is the accepted non-preemptible atomic risk round 17
  found `maxFragmentsPerDbId` cannot bound (see the atomic-operations table) — the gate is what turns "an
  accepted, unmeasured risk" into a known number, the same way it already does for the three
  `maxSyncTriangleCount` phases. A model where no single node owns more than a small fraction of
  `maxFragmentsPerDbId` directly cannot exercise this risk at all; recording that limitation is itself a
  gate finding, not a pass.
- **`releaseEpochScopedState`/`dispose()`'s own per-epoch registry sweep is measured and recorded, at a
  `GeometryRegistry` populated with as many live entries under one epoch as the model actually
  produces.** This is the second accepted non-preemptible atomic risk in the atomic-operations table (see
  above) — no prior round classified or measured it, despite it growing into a real per-entry enumerative
  pass with per-entry cancellation-signal rejection. Measure the sweep triggered from both
  `world.evictModel` (mid-session eviction) and `world.dispose()` (whole-world teardown), since both run
  this operation over a potentially different entry count. A model whose epoch never accumulates more
  than a handful of `GeometryRegistry` entries cannot exercise this risk at scale; recording that
  limitation is itself a gate finding, not a pass.
- **The `CollisionInstance` identity cache's retained size, per epoch, is measured across a realistic
  session — repeated `findClashes` calls against a long-lived model, not a single call.** Unlike every
  other bounded structure this gate measures, this cache's resident count only grows while its epoch
  stays live (entries are never individually evicted — see "`CollisionInstance` identity cache" under
  `GeometryRegistry`), so the number that matters is the *steady-state ceiling* a realistic query pattern
  reaches over a session, not one call's marginal cost. Record both the bucket size after the MEP model's
  full unique-fragment population has been queried at least once, and whether `maxCollisionInstancesPerEpoch`
  needs to be set meaningfully above that population to avoid spurious rejections. A session that never
  queries more than a small fraction of the model's fragments cannot exercise this risk at scale;
  recording that limitation is itself a gate finding, not a pass.

Whatever the MEP model's actual numbers turn out to be, they replace the "reasoned, not yet measured"
qualifier on every still-unmeasured row of the atomic-operations table under **`ProperCrossingQuery`**'s
budgets — this milestone cannot claim that table's unmeasured rows as verified until this gate has run
once, and `maxSyncTriangleCount`'s `12_000` value specifically remains provisional until it has.

Acquiring a suitable model is a milestone dependency (see Risks). If none is available at
implementation time, that is a finding to report, not a step to skip silently — the alternative is
shipping the acceleration structures untested and calling the milestone verified.

## Risks (carried and refined from the idea doc)

- **Geometry identity is model-local**: confirmed via direct inspection of the shipped Viewer
  source (`FragmentList.getGeometryId`) — no cross-model dedup in this milestone, and no evidence
  of a portable geometry hash for classic SVF (only OTG/SVF2 expose `getGeometryHash`, and it's
  undocumented).
- **Non-watertight tessellation**: Viewer geometry isn't guaranteed closed/manifold; volume-overlap
  strong guarantees are limited to well-formed room geometry, as in the idea doc.
- **Viewer private API drift**: `getRenderProxy`, `vb`/`vbstride`/`vblayout`, and `getGeometryId`
  are all untyped/internal APIs, confirmed only by reading the shipped 7.124.2 source, not by
  official prose documentation. A future Viewer version could change this layout — isolate all of
  it inside the two adapters, as designed.
- **Import map registration order**: the import map must be present in `index.html` before the
  first module import that resolves `three`/`three-mesh-bvh`, per the idea doc's deployment
  guidance.
- **Model-unload event payload shape unverified**: round 10 selected
  `Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT` (confirmed present at `index.d.ts:324`) as the
  authoritative hook for invalidating the per-model room-dbId cache and calling `world.evictModel`
  (see Data Flow step 1). What remains genuinely unverified is narrower: the installed typings declare
  the listener payload as `event: any`, so `event.model` — assumed per Autodesk's public event
  reference — needs a one-time confirmation against the 7.124.2 source or a live console check during
  implementation, not the choice of event itself.
- **Instance-tree completeness at extraction time is unverified.** The extraction walk's
  coverage-equivalence argument (see **`ViewerModelAdapter`**) holds only *given a complete instance-tree
  snapshot* — it says nothing about whether the Viewer has actually finished building that snapshot for
  the model being walked. An instance tree that under-reports a node's children at walk time yields a
  walk that finishes normally, with a silently short union and no budget trip to catch it; this spec does
  not claim to have closed this gap, and no code path in this milestone checks Viewer-side tree-readiness
  before extraction begins. What readiness signal (if any) the installed Viewer version exposes for
  this, and whether `findClashes`/`world.admitModel` should check it, is deferred to implementation —
  confirm against the official Reference Guide before relying on any specific API, not assumed here.
- **`ProperCrossingQuery` is the most intricate piece of new geometry code in this milestone**: the
  four-quadrant candidate test is standard technique, but it is the one component with no simpler
  fallback if it proves fragile against real tessellation (thin slivers, near-degenerate triangles at
  the intersection curve). It's covered by direct unit fixtures rather than only through
  `VolumeOverlapQuery`, precisely so a failure here is diagnosable in isolation. If it does prove
  unworkable during implementation, the fallback is *not* to silently revert to touching-inclusive
  overlap (round 2's rejected behavior) but to raise it as a scope question.
- **Component decomposition is only as good as the weld**: `GeometryConnectivity` runs on welded
  geometry (welding is mandatory — see `ViewerGeometryAdapter`), but any seam the weld misses still
  over-segments the mesh. An earlier draft described this risk as "depends on index sharing, **not**
  geometric welding," which was written before welding became a required normalization step and now
  states the opposite of the design. Over-segmentation remains conservative for correctness but
  inflates sample counts, and is the most likely trigger for `incomplete-component-coverage` on real
  models — worth measuring early, since it determines whether `maxContainmentSamples = 512` is
  comfortable or tight. On the acceptance model welding left nothing over-segmented (every room: one
  component), so this risk is currently unexercised rather than disproven.
- ~~**How often is real Viewer geometry weldable into closed manifolds?**~~ **Answered by spike
  Part B, favourably for the side that matters.** Real SVF arrives as fully unwelded triangle soup
  (raw component count *equals* triangle count), and welding rescues it: every room tested welds to
  1 component with 0 boundary and 0 non-manifold edges. Since ray parity is evaluated against the
  *target*, and targets here are rooms, the precondition holds. Source geometry (the bathtub: 14
  components, 441 boundary edges) does not weld closed, but does not need to — see
  `anyComponentInside`. Residual risk is that this is **one model**; a federated or MEP-heavy model
  could differ, so the check is worth repeating rather than assuming settled.
- **Welding tolerance is now specified, but only validated on one model.** Earlier drafts listed the
  epsilon as unexamined; it is now defined as a fixed physical length converted into model units
  (`weldEpsilon = 1e-4 m / model.getUnitScale()`) with the upstream grid-snap semantics documented —
  see `ViewerGeometryAdapter`. What remains open is empirical, not definitional: the acceptance
  model's seams turned out to be *exactly* coincident, so welding succeeded there for a reason
  stronger than tolerance choice. A model whose tessellation emits near-coincident rather than
  identical seam coordinates would exercise the grid-snap boundary case that this one never reached.
- **Correctness work has accumulated real, unmeasured cost.** `closestPointToPoint` on every sample
  point, an offset ladder multiplying probe tests by up to 3×, a connectivity pass per geometry, a
  triangle-triangle test on every `bvhcast` candidate pair (not just intersecting ones — now known to
  be every pair in overlapping leaves), and containment sampling that may walk a whole component's
  vertices before falling back to constructed witnesses. Each was added to fix a real correctness
  defect and none is obviously expensive, but they compound, and there is still no benchmark suite.
  With `maxCandidatePairsExamined` added this round, the budgets do now bound the worst case — but
  note that claim was made in round 5 and was **false when written**: nothing capped the raw
  candidate loop, so a dense leaf overlap could run for seconds. Treat "the budgets bound it" as a
  property to re-verify whenever a new traversal is added, not as a standing invariant. The residual
  risk is *latency on realistic input*; measure before tuning any budget down.
- **The acceptance model cannot validate any of the acceleration machinery** (B7). This is the
  sharpest consequence of settling B7 in favour of keeping the BVH, and it deserves stating as a risk
  rather than as a footnote to that decision. Rooms here are 12–64 triangles; brute force resolved
  the entire query in 10.2ms. So a green acceptance test says the algorithm is *correct* and says
  nothing whatever about the BLAS cache, the lazy-build yield, `maxSyncTriangleCount`,
  `maxCandidatePairsExamined`, or eviction — all of which were designed and twice revised against
  geometry no available model exercises. The specific hazard is mistaking a passing milestone for a
  validated one, and then tuning budgets on synthetic evidence. **An MEP-scale model is the missing
  input**, and acquiring one should be treated as a milestone dependency, not as follow-up work: it
  is the only thing that will exercise what this milestone deliberately chose to build.
- **`InterleavedBufferAttribute` and `drawRange`/`groups`-intersection fixtures are unverified
  against real Viewer output**: the adapter fixes in this revision (index path, interleaved
  fallback, range intersection, `offsets` rejection) are grounded in correct three.js semantics and
  the reviewer's citations, but — unlike the `vb`/`vbstride` primary path — none of them have been
  confirmed to actually occur in real geometry from the given URN. They're defensive-but-currently
  theoretical branches; implementation should log when any fallback path actually fires against real
  models, to confirm whether this generality is load-bearing or dead code for Viewer 7.124.2 in
  practice.

## Open Questions Deferred to Future Milestones

- Should the small-geometry brute-force fallback (from the idea doc) be added in this milestone or
  the next? The spike measured the triangle counts this question was waiting on — rooms are 12–64
  triangles, and brute force beats a BVH outright at that size (B7). So the fallback is *justified*,
  not merely plausible. It stays deferred only because the threshold at which it stops winning is
  unmeasured, and picking one by reasoning is exactly what rounds 5–6 had to undo for the other
  budgets. The MEP benchmark that makes the retained BVH meaningful is the same benchmark that would
  set this threshold.
- ~~Should `indexOwnership: 'indirect'` become the default once a benchmark suite exists?~~
  **Settled by the spike:** welding produces an owned index, so there is no shared Viewer index for
  indirect mode to protect. The option is inapplicable, not merely deferred.
- ~~Should non-manifold components attempt repair (welding coincident vertices)?~~ **Settled by the
  spike:** not optional — nothing works without it. Promoted to a required normalization step.
- Does cross-model geometry deduplication matter enough to prioritize once multi-model clash
  detection (a later milestone) is designed?
- Is even-odd the right solid model for real Viewer geometry? It is chosen for pipes/containers and
  costs correctness on nested independent solids (see **Solid model**). The assumption that Model
  Derivative emits separate solids as separate fragments rather than nested shells within one
  geometry is **reasoned, not measured** — check it against the acceptance URN, since if nested
  independent solids turn out to be common the tradeoff inverts.
- `maxCandidatePairsExamined = 50_000` is **measured** against the one-frame principle (see
  `ProperCrossingQuery`), not guessed. `maxSyncTriangleCount` was too, at `20_000`, through round 14 —
  round 15 found that measurement covered only the BVH-build phase, not welding or connectivity, and
  revised it down to `12_000` (**reasoned, not yet measured** at the new value — see
  `ThreeMeshBvhBackend`/`BlasCache`); the performance gate below must confirm or further revise it
  before it can be called measured again. `maxFragmentsPerDbId` and `maxBroadPhaseInstancePairs` are new
  in round 15 and are reasoned, not measured, from the start. Remaining question is whether real
  rooms/fixtures routinely exceed the (now three, not one) triangle ceilings, or the two new count
  ceilings — if they do, incremental or Worker construction becomes near-term rather than a
  future-milestone nicety.
- `samplesPerComponent = 8` (a stride divisor, not a cap — sampling continues past it),
  `maxWitnessTriangles = 8`, and `maxContainmentSamples = 512` remain provisional. None affects
  *coverage* correctness (component decomposition handles that) — they only bound pathological
  cases, and every truncation is observable via a diagnostic, so they're tunable from telemetry.
- Now that `ProperCrossingQuery` exists, a `touching` mode is nearly free (it's
  `SurfaceIntersectionQuery AND NOT ProperCrossingQuery`, both already implemented). Should the
  deferred `touching` mode be pulled forward into this milestone, or does adding a third public mode
  outweigh the small implementation cost? Deliberately left deferred here to hold the milestone
  boundary, but it's now a cheap increment rather than new machinery.
- The idea doc's open question on coplanar semantics
  ([idea:1709](../../ideas/aps-viewer-clash-detection-library-idea.md#L1709)) is now answered *for
  these two modes* (touching is surface intersection, not volume overlap) but not at the architecture
  level for `clearance`/`touching` tolerances. Should that answer be promoted into the idea doc as a
  library-wide convention?
- **Resolved by round 12**: the per-model room cache (and `CollisionWorld`'s own liveness tracking) is
  now keyed by the exact `Model` object rather than `model.id`, so a reload under a reused id can never
  alias the previous load's cache entry regardless of whether `model.id` reuse is actually possible in
  this Viewer version — the design no longer depends on knowing the answer. What remains genuinely
  open: whether `BEFORE_MODEL_UNLOAD_EVENT` can ever fail to fire for some model-removal path this spec
  hasn't identified. If it can, `evictModel`/the tombstone never runs for that model, and every
  race-safety guarantee for a model evicted *while the extension/world remain alive* is conditioned on
  the event firing at least once per removal — this is a Viewer-behavior question implementation should
  confirm, not a gap in the eviction design itself. This conditioning does not extend to the
  `tearDown()`-driven wholesale-unload path (see **Data Flow** step 1): there, `world.dispose()`'s own
  terminal, disposed-first flag — not the per-model event — is what makes any in-flight work safe,
  independent of whether `BEFORE_MODEL_UNLOAD_EVENT` ever fires for the outgoing model.
- Beyond welding, should components that are *still* non-manifold after it attempt further repair
  (hole filling, seam stitching)? Welding is now mandatory and handles the per-face-vertex case,
  which the spike showed is the dominant one; genuinely open shells are a separate and much smaller
  problem, deliberately left to the diagnostics for this milestone.
