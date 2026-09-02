# Invariant-driven consistency audit — Round 1

Type: invariant-model audit (not a Codex review round — no `codex-review spec` pass was run on the
whole document per explicit instruction)
Input: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (3300 lines, post-round-17)
Method: one agent built a consolidated invariant model of five interlocking systems (model/world
lifecycle, geometry ownership/build pipeline, query mode dependencies, synchronous-work/budget model,
cache ownership/cleanup); five parallel agents then audited the full spec text against that model, one
system each, using the `viewer-extension-lifecycle-audit` and `aps-viewer-implementation-research`
skills where relevant, plus targeted `codex-advisor` consults on specific judgment calls (never a full
review pass). No spec edits were made in this pass.

The full invariant model these findings were checked against is reproduced in full at the end of this
file for reference.

---

# Critical

## C1. Stale "dispose() tombstones every model" paragraph contradicts round 15's own headline fix

**Location:** Error Handling, "Disposal mid-query" — **lines 2599–2601**.

**Found independently by both the lifecycle audit and the cache-ownership audit.**

Line 2599–2601 still reads: *"`unload()`/`world.dispose()` tombstones every model's lifecycle entry
(see above) and sets the world's own terminal `disposed` flag before releasing anything, so an in-flight
query rejects with `ModelEvictedError` through the same per-model mechanism, not a separate one."*

Every clause is now false, on three separate points, per round 15's own fix elsewhere in the same
document:
- `dispose()` explicitly no longer tombstones every model — "no longer needs to enumerate and tombstone
  every live model for correctness, and this spec no longer claims it does" (2357–2358); it only
  best-effort tombstones whatever `liveModelByModelId` currently references (2178–2182).
- The `disposed` flag is set **first, synchronously, before anything else** (2167–2168, 2338–2340), not
  "before releasing anything" as a consequence of a tombstone sweep.
- The resumed-query error is `WorldDisposedError`, not `ModelEvictedError` — fixture 3013–3020 revises
  this exact expectation and states outright: *"A test still expecting `ModelEvictedError` is itself the
  regression."*

**Why Critical:** this is the one place the spec tells an implementer what a suspended query observes on
disposal, and callers are explicitly told they may branch on which error class they got (3009–3012). An
implementer following this paragraph reintroduces the exact per-model enumeration completeness gap round
15 was raised to eliminate, and surfaces the wrong error class.

## C2. `evictModel` has no `disposed` guard in its own contract, and the throw two other places specify is verifiably destructive

**Location:** `world.evictModel`'s full doc block — **lines 2108–2152** (silent on disposal throughout);
contradicted by **lines 2170–2172** and **2602–2603**, which both list `evictModel` among methods that
throw `WorldDisposedError` after disposal.

**Found independently by both the lifecycle audit and the cache-ownership audit.** The lifecycle audit
additionally verified the consequence against the actual pinned Viewer 7.124.2 source (sha256
`12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e`, matching the Agent Kit's recorded
digest for that build).

`evictModel` is specified to be called **only** from the extension's `BEFORE_MODEL_UNLOAD_EVENT` handler
(2148–2152, 2375–2377). In the pinned bundle, `EventDispatcher.prototype.dispatchEvent`
(`viewer3D.js:13300-13340`) invokes each listener with **no try/catch**:
`typeListeners[i].callbackFn.call(this, event)`. A `WorldDisposedError` thrown from that handler
therefore propagates uncaught out of `dispatchEvent` → out of `Viewer3DImpl.unloadModel`
(`viewer3D.js:34052-34054`) → **aborts the `for` loop in `unloadCurrentModel`
(`viewer3D.js:34252-34254`) that unloads the remaining models** → up through `Viewer3D.tearDown`
(`viewer3D.js:26583`) into `loadDocumentNode`.

**Why Critical:** this is precisely the uncaught-exception-in-an-async-Viewer-callback shape
`isLeaseValid` was deliberately made non-throwing to avoid (2087–2094, 2999–3005) — except here the
victim is the Viewer's own multi-model teardown loop, not just one caller's promise. `evictModel`'s own
contract (2108–2152) gives it a complete four-line pseudocode body with no disposal check at all, so an
implementer reading that section alone builds the non-throwing version; an implementer reading the
disposal method list builds the throwing, destructive version. The spec specifies both.

## C3. The publication-atomicity rule contradicts `accelerationPromise`'s dedup guarantee and both release paths' promise-rejection guarantees

**Location:** publication rule — **lines 920–925**; contradicted by **lines 967–971** (`BlasCache`
dedup), **2130–2133** (`evictModel` rejects in-flight build promises), **2176–2178, 2358–2363**
(`dispose()` rejects every in-flight build promise).

**Found independently by both the geometry-pipeline audit and the cache-ownership audit.**

Line 920–921: a `GeometryRecord` is "only published to the shared cache — visible to other candidate
pairs, other `findClashes` calls — once every phase it needs has completed successfully." But the build
is explicitly non-atomic: a yield-and-revalidate checkpoint sits before each of the three phases
(897–919, 1374–1376), so control genuinely returns to the narrow phase mid-build. Under the literal
publication rule, nothing for that `(loadEpoch, geometryIndex)` exists in `GeometryRegistry` during that
window — so a second concurrent caller finds a cache miss and starts its own build, directly defeating
967–969's "`BlasCache` dedupes concurrent build requests via `accelerationPromise` so two simultaneous
queries never build the same BVH twice." It also breaks cleanup: both release paths promise to reject
"every in-flight build promise" (2130–2133, 2176–2178, "exactly once, on the same disposal call"), which
requires the in-flight build to be registered somewhere enumerable — i.e. published — which 920 forbids.

**Why Critical:** as specified, this is not merely underspecified — three normative statements are
mutually exclusive, and either reading an implementer picks makes another one of them false. The
concrete cost: duplicate concurrent builds (up to ~40ms of non-preemptible work each, by the spec's own
per-phase measurements) as the specified behavior, or an in-flight build that survives `dispose()`
unrejected. No dedup of any kind is named for compaction, weld, or connectivity — `accelerationPromise`
covers the BVH phase only and appears exactly twice in the document (876, 967).

## C4. `ViewerModelAdapter`'s own component contract still specifies the exact recursive extraction call rounds 16–17 declared Critical and removed

**Location:** `ViewerModelAdapter` — **lines 777–784**; contradicted by Data Flow step 3
(**lines 1917–1926**) and fixture **line 2918**.

**Found independently by both the geometry-pipeline audit and the sync-work-budget audit.**

Lines 777–784 still open with: *"Leaf fragments: `model.getInstanceTree().enumNodeFragments(dbId, cb,
true)`. This is the real Viewer API … `recursive: true` **is required** to cover assembly/parent dbIds,
not just true leaf nodes — confirmed on the acceptance model, where the family node (dbId 2527) yields
its child instance's fragment only with the flag set."* Round 16 declared this exact call a Critical:
*"The fix does not use the recursive form at all"* (1922–1923), because it is a single uninterruptible
native call. Fixture 2918 fails any design that still performs it. Nothing in 777–784 was updated by
either round 16 or round 17.

**Why Critical:** the Components section is the normal first read for an implementer building this
system, ahead of Data Flow. As written, it specifies the identical unbounded call two full review rounds
spent fixing elsewhere in the same document — a reintroduction of an already-fixed Critical via a
different section, not a new bug class. It also orphans real evidence: the acceptance-model justification
for needing recursion (dbId 2527's fragments only surface with `recursive: true`) is never reconciled
with whether the round-16 node-by-node walk actually covers the same set — Data Flow just asserts the
walk collects "that node's own fragments" and descends, with no statement that this is coverage-
equivalent to the recursive form it replaced.

## C5. `getChildCount` is credited with catching a failure mode it does not actually bound — no threshold, ceiling, or action is ever defined

**Location:** round-17's own extraction fix — **lines 1927–1932, 1939–1947** (my own edit from the
previous fix in this conversation).

**Found by the sync-work-budget audit; verified by grep for `maxChild`/`childrenPerNode` across the
entire 3300-line file — zero hits.**

Round 17's text asserts `getChildCount(node)` is *"a normative preflight, required before every
`enumNodeChildren` call, not an optional cheap check — it's how the walk **avoids fanning out into a
node with a pathologically large direct-child count** before committing to enumerate them"*
(1930–1932), and separately that *"a wide-but-fragment-empty tree **is caught by** the `getChildCount`
preflight rather than blocking inside an unbounded `enumNodeChildren` call"* (1943–1944). Both are active
bound-claims. What is actually specified: `getChildCount` is called, and the number it returns is
**never compared to anything, never triggers an action, and has no named constant**. Tracing the other
two candidate safeguards confirms neither catches this either: `maxFragmentsPerDbId`'s tally can't move
(a fragment-empty tree contributes 0 at every node), and the `frameBudgetMs` sibling checkpoint fires
*between* nodes, not inside the one `enumNodeChildren` call that would block on a million-child node.

**Why Critical:** this is the identical "claimed vs. earned" pattern that took three rounds (15→16→17)
to actually fix for `maxFragmentsPerDbId` — a verified cheap *observation* credited as an *enforced
ceiling* — reproduced by the very round-17 fix that was supposed to close that pattern out, one native
call over. Unlike the historical instances, the current text asserts the failure mode is "caught," which
is a stronger and more specifically wrong claim than "bounded."

---

# High

Grouped by system; see the referenced agent transcript summaries in this conversation, or re-run
targeted verification, for full detail on any item. Deferred-High-finding connections use the round-17
numbering from `review-comments-v17.md`.

**Lifecycle**

- **H-L1. `tearDown()`/`keepCurrentModels` never appear in the spec (0 grep hits), and Data Flow's stated
  rationale for the per-model room cache is contradicted by verified Viewer behavior.** A model swap
  without `keepCurrentModels` calls `tearDown()`, which unloads every extension — verified against the
  pinned 7.124.2 bundle (`viewer3D.js:27709-27713`, `26536-26585`). The app's own `loadModel()`
  (`wwwroot/viewer.js:32-43`) passes no options. On the default load path, the extension is destroyed and
  re-instantiated on every model switch, and the spec's model-identity apparatus (permanent tombstones,
  global epochs) is designed for a world that outlives multiple loads, which never happens on that path.
  Connects to deferred High #2.
- **H-L2. `BEFORE_MODEL_UNLOAD_EVENT` fires after the extension's own listener is deregistered** during
  `tearDown()`'s extension-unload loop (which runs before `unloadCurrentModel`, the event's sole
  dispatcher) — so `evictModel` is never called for the outgoing model on the standard model-replacement
  path. Non-fatal only because `dispose()`'s wholesale clear happens to cover the collision caches; the
  extension's own room-dbId cache has no such backstop (see H-L5).
- **H-L3. `unload()`'s three teardown steps have no isolation/ordering discipline**, and the specified
  order (`dispose()` first, listener removal second) risks a throw in step 1 (e.g. C2's throw, or a
  `TypeError` if `load()`'s async world construction hasn't settled) stranding the listener and cache
  cleanup that never run.
- **H-L4. No contract for listener-registration timing, whether `load()` awaits `fromViewer()`, or
  rollback on failed construction.** A consumer can reach `locateElementByRoom`/`onContextMenu` before
  the world exists; no error path exists for a failed `fromViewer`. Connects to deferred High #1 (model
  readiness lacks a contract) at the extension-lifecycle level.
- **H-L5. `locateElementByRoom`'s disposed-mid-search error type is specified two incompatible ways** —
  `ModelEvictedError` (1873–1878, 2100–2104, deliberate collapse) vs. `WorldDisposedError` (2378–2380,
  class sketch). The same class of self-contradiction round 14 fixed for `isLeaseValid`, surviving in the
  extension's public contract.
- **H-L6. `ContainmentQuery`'s local checkpoint wording (1658–1661) only re-checks epoch, omitting the
  `disposed`-first half** of the universal two-part protocol (2343–2350) — and the same omission
  propagates to two more loop sites via cross-reference (1672–1676). The sibling site at line 917 was
  correctly updated by round 15's sweep, confirming this is a missed edit, not a deliberate abbreviation.

**Geometry pipeline**

- **H-G1. `sum(ranges[].count)` has no stated unit, and the spec's own fallback makes it an index count,
  not a triangle count.** `groups[].count`/`drawRange.count`/`indices.length` are index-element counts in
  three.js; the spec calls their sum "the active triangle count" and gates it against
  `maxSyncTriangleCount = 12_000` with no `/3` conversion anywhere in the file (grepped every
  `TriangleRange`/`ranges[]`/`sum(ranges` occurrence). A literal implementation applies a ceiling roughly
  **3× stricter** than intended. Independently confirmed via a targeted `codex-advisor` consult as "High,
  load-bearing unit ambiguity."
- **H-G2. Compaction-vs-size-gate ordering is stated three contradictory ways**, including twice within
  one paragraph — the round-16 header (line 424–425: compaction then gate) vs. the body (940–943: gate
  then compaction, "without ever materializing a compacted buffer") vs. the fixture (2902–2906: zero
  compaction calls for an oversized fragment, matching the body). The body+fixture is the operative pair,
  but the header the round-16 fix was reviewed against as "one invariant" says the opposite.
- **H-G3. A zero-triangle active range is explicitly permitted ("not an error," line 850) and produces a
  silent clean false negative** — the exact failure class lines 841–847 spend a full paragraph explaining
  must never happen. No diagnostic reason code covers "normalized to zero active triangles." Concrete
  instance of deferred High #1 (post-normalization validation undefined), showing that finding is wider
  than degenerate triangles.
- **H-G4. Extraction's correctness depends on complete instance-tree enumeration at every node, contradicted
  by runtime-observed Agent Kit knowledge on the same pinned Viewer build** (`viewer-fragment-geometry.md`
  §B): immediately after `GEOMETRY_LOADED_EVENT` with `isObjectTreeCreated() === true`, a traversal
  reported 1 direct child where the model actually has 28, and stayed wrong for a full 30-second idle
  window. Round 16's walk depends on `getChildCount`/`enumNodeChildren` accuracy at every node — more
  exposure to this hazard than the single opaque call it replaced. The spec maps under-enumeration to a
  clean `pairs: []` result with no diagnostic or retry policy (2573–2576).

**Query dependencies**

- **H-Q1. `anyComponentInside`'s caller list is stated three mutually incompatible ways**, two of them
  pre-round-16 stale text the round-16 sweep never reached — in the Components section that defines the
  API surface (1454–1455 names only `VolumeOverlapQuery`; 1795 says "used by every mode," which is false
  for `surface-intersection`). Only 903–909 is correct. Every downstream connectivity-dependency
  statement derives from "who calls `anyComponentInside`," so a stale caller list here is load-bearing.
- **H-Q2. The containment guarantee's stated precondition is unobtainable in `containment` mode.**
  `anyComponentInside`'s guarantee is conditioned on "`ProperCrossingQuery` has returned false"
  (1510–1511), but `ContainmentModeQuery`'s composition contains no `ProperCrossingQuery` term at all
  (1719–1722, confirmed at 1741–1743: "this mode has nothing ahead of it"). The stage-2 patch asserted to
  establish the antecedent instead (1781–1785) runs *after* stage 1 by the spec's own cheapest-first
  ordering, so at the moment stage 1 can stop on a conclusive sample, nothing has established what the
  guarantee requires. Concrete instance of deferred High #1.
- **H-Q3. The Public API's `containment` description (line 2045) restates verbatim the exact wording
  round 8 identified as wrong and self-defeating** ("any part of the source lies inside the target's
  interior") — the normative table (1104) and the directedness fixture (2823–2826) both use the correct
  surface-only reading. The surface an implementer actually codes against carries the rejected wording.

**Synchronous-work / budget model**

- **H-B1. `maxBroadPhaseInstancePairs = 1_000_000` buys roughly a full second of uninterruptible
  synchronous work by the spec's own stated per-unit cost** (O(µs) × 1e6 ≈ 1000ms), and the scan itself
  is never classified anywhere in the atomic-operations table — the single largest synchronous span in
  the design, failing the gate's own ~16ms pass criterion by roughly 60×, with no inner checkpoint and no
  remedy stated. The spec performs this exact arithmetic for `maxCandidatePairsExamined` (dropping
  200,000 → 50,000 because 200,000 costs ~53ms) but never applied it here.
- **H-B2. Round 17's own worst-case-span formula (1425–1431) was not updated for round 17's own new
  ceiling-less atomic-risk row** (1380) — `max(...)` over a term with no ceiling isn't a bound, and the
  sentence a reader takes away as "what this design guarantees" still reads as if it were one.
- **H-B3. Two contradictory diagnostic-reason mappings for exhausting `maxCrossingPairsExamined`** —
  `crossing-budget-exhausted` (three sites: 1319–1323, the type definition, 2559–2561) vs.
  `inconclusive-crossing` (2564–2566, a semantically distinct code per its own definition at 2404–2406).
  Plausibly the literal round-10 deferred diagnostic-mapping finding, still unresolved.
- **H-B4. `SurfaceCrossingWitness`'s scheduling class is genuinely undetermined** — "plain JS loop, no
  native traversal in the way" (1673–1676) vs. "same traversal and budget as the other two modes," i.e.
  an unpausable `bvhcast` (1778–1779). The two readings have different, both-unstated consequences,
  including a possible fabricated containment positive if probing runs inside an `async` `bvhcast`
  callback (which reads a returned Promise as truthy — the exact inversion the abort protocol exists to
  prevent). The performance gate never runs a `containment`-mode query at all, so this is the one stage
  the gate structurally cannot measure to settle the question empirically.

**Cache ownership**

- **H-C1. `GeometryConnectivity` and `BlasCache` are described both as fields embedded on
  `GeometryRecord` and as independently-keyed caches, and their post-round-14 key is never explicitly
  stated for either** — only `GeometryRegistry`'s key is ever spelled out (2287); the other two are
  inferred solely from the umbrella phrase "model-owned collision state" (2285). The only lines stating a
  key for these two caches specifically are the historical, superseded `(modelId, geometryIndex)`
  sentences (357, 2272).

---

# Medium

Several of these were found independently by 2–3 agents auditing different systems, converging on the
same gap from different angles — noted where that happened, since independent convergence is itself
signal.

- **M1. Connectivity's "independently lazy, built only on genuine consumption" description (900–902)
  conflicts with Data Flow's eager-per-mode build (1983–1985, fixture-pinned at 2878–2884), and there is
  no failure contract for connectivity failing on an already-published record.** Found from four separate
  angles (geometry pipeline, query dependencies, cache ownership, sync-work budget) — the most
  cross-corroborated Medium finding in this pass. A `volume-overlap` pair decided by `ProperCrossingQuery`'s
  early `true` never reaches `anyComponentInside` and, under the literal "actually consumes" wording,
  would never build connectivity — contradicting the fixture. The manifold-classification side-consumer
  (1571–1572, used by the parity closure precondition independent of `anyComponentInside`) is what
  actually justifies the eager build, and the spec never says so.
- **M2. Nothing specifies how `releaseEpochScopedState` finds records "filed under" an epoch** — described
  as "a synchronous map/set removal … nothing that can itself fail" (singular, O(1)-shaped), but could be
  an unbounded linear sweep across every record in the world, with no ceiling, checkpoint, or
  atomic-operations-table entry, running synchronously inside a `BEFORE_MODEL_UNLOAD` Viewer dispatch.
  Same gap applies to `dispose()`'s wholesale clear. Found by both cache-ownership and sync-work-budget
  audits.
- **M3. Compacted/welded buffers are never named as a `GeometryRecord` field** — the largest allocation
  the pipeline makes (the buffer round 16 made collision-owned specifically for memory reasons) has no
  stated release path.
- **M4. Oversized records violate the publication rule** (a record is registry-resident having completed
  zero build phases) and the size gate is enforced by two different actors — the registry (977) and the
  narrow phase (1976–1982) — in two places. Found by both geometry-pipeline and cache-ownership audits.
- **M5. Extension's room-dbId cache is the design's one strong-reference, model-keyed structure with no
  consistent reclamation path** — `modelLifecycle` is deliberately weak (2219–2223) precisely to avoid
  this shape, but the room cache reintroduces it; `dispose()` never touches it, and its two release
  triggers (the unload handler, `unload()`) can both fail to run per H-L2/H-L3. Found by both lifecycle
  and cache-ownership audits.
- **M6. `L_X` (local-bounds diagonal, scales `surfaceEpsilon`/`mergeDistance`/`minPenetrationDepth`) was
  never revisited after round 16's active-range compaction changed what "the geometry" means** — undefined
  which stage's bounds it's computed against.
- **M7. `frameBudgetMs = 8` and the unnamed "~16ms per-atomic-operation ceiling" are conflated in the
  gate's own pass criterion**, which cites "`frameBudgetMs`'s tolerance band around ~16ms" — an 8ms
  constant given a 16ms band with no stated tolerance value anywhere.
- **M8. Extraction's `frameBudgetMs` checkpoint fires only between siblings, never on descent** — a deep
  single-child chain has zero checkpoint sites for the whole walk, the same "wide vs. deep" failure shape
  as C5 one axis over.
- **M9. Performance gate's own pass criteria require a cold `surface-intersection` run to distinguish
  connectivity-touching from connectivity-free measurements (3134–3137), but the gate's setup (3096–3101)
  never specifies running one** — only one `volume-overlap` query, run twice.
- **M10. `dispose()` releases no extension-owned state, and it's never stated whether `dispose()` can be
  called independently of `unload()`** — if so, the room cache outlives the world it was scoped to.
- **M11. LMV fragment-geometry attribute descriptors are a known runtime trap** (Agent Kit
  `viewer-fragment-geometry.md` §A, runtime-observed on the pinned build) the spec's own fallback-detection
  branches don't fully account for; a throwing probe during detection has no defined handling path.
- **M12. Compaction has no owning component** in the spec's own module breakdown — attributed loosely to
  `ViewerGeometryAdapter`'s ranges but not claimed by that section, `GeometryRegistry`, or the repo layout.

---

# Low

- **L1. `>=` vs. `>` boundary inconsistency** for `maxSyncTriangleCount` — line 976 says "at or above,"
  three other sites (1978, 2516, 2903) say "exceeds." A geometry at exactly 12,000 triangles is skipped
  under one rule and built under the other.
- **L2. `referenceCount` is declared once (line 876) and never used again** anywhere in the document —
  no increment/decrement/consumer, in tension with the epoch-scoped wholesale release actually specified.
- **L3. Canonical ordering's sort key (1018–1019) still names bare `modelId` and an unreconciled
  `geometryKey`**, pre-round-14 wording the round-14 sweep didn't reach; `modelId` is invariant in this
  position anyway (cross-model queries are rejected) and `geometryKey` is never reconciled with
  `(loadEpoch, geometryIndex)`.
- **L4. `findClashes`'s error-delivery mode described inconsistently** — "rejects synchronously" (2570)
  vs. "rejects" (2035) vs. "rejects or throws" (2170) — a real distinction for a `Promise`-returning
  method the spec is careful about everywhere else.
- **L5. `liveModelByModelId` is never cleared on disposal**, keeping strong `Model` references alive after
  `dispose()` — the one cache in the set that isn't deliberately weak.
- **L6. Round-16 header vs. body transposition is duplicated in the "compaction's own cost is unmeasured"
  framing** — the atomic-operations table folds compaction into the weld-phase measurement (1374), but the
  performance gate's per-phase measurement requirement (3128–3133) only names the pre-round-16 three
  phases, so compaction's "expected small" status can never be promoted from reasoned to measured.
- **L7. `SurfaceCrossingWitness`/`containment`'s `bvhcast` traversal is nearly invisible** — it appears
  only at line 1778 and one fixture; the query-modes table and Public API's mode list never mention it,
  so `crossing-budget-exhausted` can be emitted by a mode whose documented surface never mentions a
  crossing search.

**Positive / resolvable this pass:** the `BEFORE_MODEL_UNLOAD_EVENT` payload-shape risk (3176–3182,
"`event: any`" in the typings) can be retired — verified this session against the pinned 7.124.2 bundle
that `event.model` is real (`viewer3D.js:34054`, JSDoc at `13617-13622`). Also, `InstanceTree.getInstanceTree()`
on 7.124.2 is a byte-identical forward to `getObjectTree()` (`warnOnce(...); return this.getObjectTree()`),
so round 17's `InstanceTree`/`ObjectTree` deferral rests on a weaker blocker than recorded — the
documented-method-name gap (`enumNodeFragments` vs. `enumNodeInstances`) is real, but both class names
resolve to the same runtime object.

---

# Notes on scope and what was NOT found

- The connectivity-dependency **matrix itself** (which mode needs weld/connectivity/BVH) is fully
  consistent everywhere it's stated normatively, post round 16/17 — verified across all ~60
  `connectivity`-adjacent occurrences by the query-dependency audit. The residual problems are all in the
  *rationale and caller wording* around that matrix (H-Q1, M1), not in the matrix.
- Round 14's epoch-keying fix and round 15's `liveModelByModelId` demotion are both applied consistently
  everywhere they're stated, with no further leftover instances found beyond what's listed above.
- `admitModel`, `isLeaseValid`, `isModelLive`'s own individual contracts, and the `modelId`-reuse
  handling (§1.4 of the invariant model) were specifically checked for further contradictions and found
  clean.

---

# Full invariant model (reference)

The complete five-system invariant model this audit was checked against follows, exactly as built,
including its own `[SILENT]`/`[AMBIGUOUS]`/`[CONTRADICTION]` markers and its appendix of items flagged
for this audit pass.

# Consolidated Invariant Model — Collision Library Milestone 1

**Source of truth:** `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`
(3300 lines, post-round-17). Every `line N` citation below refers to that file at that revision.

**Status of this document:** pure extraction. It records what the spec *says*, including where it says
two things. Where the spec is silent, ambiguous, or self-contradictory, that is marked
`[SILENT]`, `[AMBIGUOUS]`, or `[CONTRADICTION]` and left unresolved — resolution is the audit pass's job,
not this one's. Nothing here is a design proposal.

A short reading note on the spec's own structure: lines 12–501 are the **Revision Notes** (a
round-by-round changelog). Normative text lives in **Components** (773–1804), **Data Flow** (1806–2023),
**Public API** (2025–2428), **Error Handling & Edge Cases** (2505–2627), **Testing** (2629–3159),
**Risks** (3161–3242). Where changelog prose and normative text disagree, both are cited below.

---

## 1. Model / world lifecycle

### 1.1 State machine

Two independent axes, checked in a fixed order at every site.

**World axis:** `constructed → disposed`. One-way, terminal (line 2166–2167).

**Model axis (per exact `Model` *object*, never per numeric `modelId`):**

```
(no modelLifecycle entry)   -- "never admitted or evicted"; the ONLY state findClashes treats
                               as "admit fresh" (lines 2216-2218)
        │ admitModel(model) or findClashes entry-point lazy admission
        ▼
{ state: 'live', epoch: N } -- N = nextLoadEpoch++ , assigned exactly once (lines 2208, 2240-2241)
        │ evictModel(model)
        ▼
{ state: 'evicted' }        -- NO epoch field. Permanent. Never cleared, never overwritten
                               back to 'live' (lines 2208-2219)
```

`evictModel` on a model with **no prior entry** writes `{state:'evicted'}` unconditionally — this is the
round-15 fix for `BEFORE_MODEL_UNLOAD_EVENT` firing for a model that was loaded but never touched
`findClashes`/room-search (lines 401–408, 2113–2129, 2210–2215). Fixture: lines 3031–3040.

### 1.2 Data structures owned by `CollisionWorld`

| Structure | Type | Role | Cite |
|---|---|---|---|
| `modelLifecycle` | `WeakMap<Model, {state:'live'; epoch:number} \| {state:'evicted'}>` | **The** liveness authority. Keyed by object identity. Never deleted; tombstone is permanent. Deliberately **non-enumerable** — nothing may depend on enumerating it. | 2208–2223 |
| `liveModelByModelId` | `Map<modelId, Model>` | **Bookkeeping/diagnostics only.** Load-bearing for nothing since round 15. Structurally cannot represent two simultaneously-live objects sharing one `modelId`. | 2224–2235, 396–399 |
| `disposed` | `boolean` | World-level terminal flag. Since round 15, the **single authoritative** disposal signal, checked directly (never inferred from per-model tombstones) at every site. | 2236–2238, 2336–2356 |
| `nextLoadEpoch` | `number` | Single counter, global to the `CollisionWorld` instance, monotonic, **never reset and never scoped per `modelId`**. Guarantees no two loads ever share an epoch. | 2239–2244, 272–277 |

`ModelLease = { model, epoch }` (lines 2061, 2257). Described as "an opaque capture of this exact
object's current lifecycle state, valid until the object is evicted or the world is disposed"
(2061–2062).

### 1.3 Public method contracts

**`world.admitModel(model): ModelLease`** (lines 2060–2078)
- Synchronous. Idempotent: a second call on an already-live object returns a lease with the **same**
  epoch, does not re-admit, does not consume `nextLoadEpoch` (2062–2063; fixture 2974–2976).
- Three outcomes **in this order** (2064–2070):
  1. `disposed` → **throws** `WorldDisposedError`
  2. entry is `{state:'evicted'}` → **throws** `ModelEvictedError` immediately, without assigning an
     epoch. "A model that was ever evicted can never be re-leased" (2066–2067; fixture 2977–2980).
  3. otherwise → admit if not already (`epoch = nextLoadEpoch++`, record `liveModelByModelId`), return
     the (possibly pre-existing) lease.

**`world.isLeaseValid(lease): boolean`** (lines 2080–2106) — **the one deliberate non-throwing exception.**
- "Strictly non-throwing and total … always returns a plain boolean, never throws" (2081–2082).
- Exact stated implementation (2083–2086):
  ```js
  if (disposed) return false;
  const entry = modelLifecycle.get(lease.model);
  return entry?.state === 'live' && entry.epoch === lease.epoch;
  ```
- Checks `disposed` **directly and first**, not by asking whether `lease.model` happened to get
  tombstoned — round 15 made this explicit precisely because `dispose()`'s sweep is incomplete
  (2095–2100).
- Rationale for non-throwing: it is called from async Viewer callbacks (`model.search`'s success/error
  handlers); a throw there escapes as an uncaught exception and leaves the caller's promise permanently
  unsettled (2087–2094). Fixture: 2999–3005.
- Does **not** distinguish evicted-vs-disposed. A caller needing that calls `isModelLive` separately
  (2100–2106).

**`world.isModelLive(model): boolean`** (lines 2154–2164) — **throwing contract.**
- Checks `disposed` first, directly → **throws** `WorldDisposedError` before consulting `modelLifecycle`
  at all (2155–2157). Fixture: 3006–3008.
- Otherwise `true` iff this exact object has a `{state:'live'}` entry.
- **"Never seen before → `false`"** (2157–2158). This conflation of "not yet admitted" with "evicted" is
  what broke every first-ever room search in round 12 (lines 325–335, 1860–1866), and is why nothing
  public may still use it as a pre-admission gate (2161–2164).

**`world.evictModel(model): void`** (lines 2108–2152) — takes the exact object, never `modelId` (2109–2111).
- Stated body (2122–2126):
  ```js
  const previous = modelLifecycle.get(model);
  if (previous?.state === 'evicted') return;              // idempotent no-op
  modelLifecycle.set(model, { state: 'evicted' });        // unconditional
  if (previous?.state === 'live') releaseEpochScopedState(previous.epoch);
  ```
- Tombstone write precedes the (conditional) state release, and is permanent either way (2127–2129).
- `releaseEpochScopedState(epoch)` drops every `GeometryRecord`, cached BLAS, cached connectivity, and
  in-flight build promise (**which rejects**) filed under that epoch (2130–2133).
- **No occupancy guard is needed anymore.** Round 13 gated the id-scoped drop on
  `liveModelByModelId.get(model.id) === model`; round 14's epoch keying demoted that to bookkeeping —
  a stale/delayed/duplicate `evictModel(oldModel)` can only ever release records filed under
  `oldModel`'s own epoch (2133–2137, 2294–2299, 336–343, 356–368).
- **`releaseEpochScopedState` must be non-throwing** — if it threw partway, the tombstone would be
  written (correct, permanent) but the release incomplete and *unretriable*, since the now-`'evicted'`
  entry no longer carries the epoch a retry would need (2137–2143).
- `liveModelByModelId` entry deleted only if this object is still the current occupant of its id —
  explicitly labelled bookkeeping hygiene, not correctness (2144–2147, 2232–2235).
- **`evictModel` throws `WorldDisposedError` after disposal** (listed among the throwing methods, 2171).
  See §1.7 hazard note — this interacts badly with unload ordering.

**`world.dispose(): void`** (lines 2166–2185, expanded 2324–2366)
- Sets `disposed` **first, synchronously, before anything else** (2167–2168, 2338–2340). This single
  write is stated to be sufficient, on its own, for correctness everywhere (2338–2341).
- After it returns, **every** public method — `findClashes`, `evictModel`, `admitModel`, `isModelLive`,
  a second `dispose()` — rejects or throws `WorldDisposedError` (2170–2172). `isLeaseValid` is the one
  documented exception (2173–2175).
- **Wholesale-clears** `GeometryRegistry`, `BlasCache`, and every cached `GeometryConnectivity` — "the
  entire cache, in one operation, not a per-model sweep" — and rejects every in-flight build promise
  (2176–2178, 2358–2363).
- **Explicitly no longer needs to enumerate/tombstone every live model** (2357–2358). It "best-effort
  tombstones whatever `liveModelByModelId` currently references, for diagnostic bookkeeping" only
  (2178–2182). Round 15's Critical: `liveModelByModelId` cannot reach both of two simultaneously-live
  objects sharing a reused `modelId` (2327–2334); fixture 3021–3030.
- Does **not** clear `modelLifecycle` (a `WeakMap`, non-enumerable); tombstones are GC-reclaimed
  (2219–2223).

### 1.4 `modelId` reuse by a different `Model` object while the old one is still live

The spec treats this as a **supported, tested state**, not an error (lines 2330–2332, 2621–2627).

- Liveness: both objects can hold `{state:'live'}` entries simultaneously in `modelLifecycle`
  (2330–2332).
- Geometry caches: structurally disjoint, because every record is keyed by `(loadEpoch, geometryIndex)`
  and the two objects necessarily hold different epochs (2285–2293). This is the round-14 Critical;
  fixture 2989–2998.
- `liveModelByModelId` holds **only the newer** object for that id — the older live object is
  unreachable through that map (2224–2231). Everything correctness-relevant was moved off it as a result.
- A stale `evictModel(oldModel)` arriving after the new object was admitted: tombstones `oldModel`
  permanently (correct), touches nothing of the new object's (2612–2620; fixture 2981–2988).
- A suspended `findClashes` holding the *old* object still rejects `ModelEvictedError` on resume; the
  new object's entry is "unrelated state the old call's check never even looks at" (2586–2592;
  fixture 2937–2943).

### 1.5 Checkpoint / yield sites and what each revalidates

**Universal checkpoint protocol** (lines 2016–2019, 2308–2317, 2343–2350):
1. check `disposed` **first**, directly → reject `WorldDisposedError`;
2. then re-check `modelLifecycle.get(model)?.state === 'live' && .epoch === capturedEpoch` → else
   reject `ModelEvictedError` naming the evicted `modelId`;
3. only then touch any cached BLAS, `GeometryRecord`, or `CollisionInstance` for that model.

A failure at *any* checkpoint aborts the **entire** `findClashes` call. "Neither returns a partial or
diagnosed `ClashResult`" — this failure class is explicitly distinct from the diagnostic system
(2315–2322).

| # | Site | Kind | Cite |
|---|---|---|---|
| 1 | `findClashes` **entry** — before any extraction, for both operand models | validate + lazy-admit | 2036–2040, 2301–2307; fixture 2944–2951 |
| 2 | Before **each requested dbId's** extraction | yield + revalidate | 1912–1916, 1420–1423, 2002 |
| 3 | Between **sibling nodes** during the extraction walk | yield + revalidate | 1943–1947 |
| 4 | Before the **broad-phase scan** starts | yield + revalidate | 1421–1423, 2002 |
| 5 | Before **each candidate pair** (cached or not) | yield + revalidate | 2001–2002; fixture 2857–2861 |
| 6 | Between a pair's **composed sub-queries** | yield + revalidate | 2002–2003; fixture 2862–2865 |
| 7 | Before **each of the 3 build phases** (compaction+weld / connectivity / BVH) | yield + revalidate | 897–919, 1374–1376, 1983–1985; fixture 2870–2877 |
| 8 | Before **each individual `classifyPoint` call** in `anyComponentInside` sampling | yield **and resume** + revalidate | 1654–1667; fixture 2784–2795 |
| 9 | Before **each witness-triangle attempt** (stage 3) | yield and resume | 1672–1673 |
| 10 | Before **each candidate's probe** in `SurfaceCrossingWitness` | yield and resume | 1673–1676 |
| 11 | `bvhcast` callback entry (raw candidates) and **before each individual probe** in `ProperCrossingQuery` | **abort only, no yield, no revalidation** | 1335–1352 |

**Site 11 is categorically different and this matters.** It cannot pause (`bvhcast` is a synchronous
native traversal, "there is no way to `await` inside a synchronous native callback", 1348–1350). It
therefore performs **no** liveness/disposal revalidation and does **not** reject the call — it sets an
`aborted` flag, ends that pair's crossing evaluation for good, and reports
`crossing-budget-exhausted` as a **diagnostic** (1319–1323, 1349–1352). Control returns to an
`await`-capable context where sites 1–10 can act.

`[AMBIGUOUS]` Site 8's local text (lines 1660–1661) says the resumed loop "re-checks the model's load
epoch" and aborts with `ModelEvictedError`, without naming the `disposed` check. Lines 2343–2350 state
globally that *every* intra-stage checkpoint checks `disposed` first. The local wording is stale/partial
rather than contradictory, but a reader implementing from §`ContainmentQuery` alone would miss half the
protocol.

### 1.6 Error types

| Error | Thrown / rejected where | Never thrown where |
|---|---|---|
| `WorldDisposedError` | `admitModel` (2065), `isModelLive` (2155–2156), `evictModel`/`findClashes`/second `dispose()` (2170–2172), every yield checkpoint (2343–2350), a build-phase checkpoint discarding a partial record (923–925) | `isLeaseValid` — returns `false` instead (2080–2082, 2173–2175, 2604–2605) |
| `ModelEvictedError` | `admitModel` on a tombstoned object (2066–2067); `findClashes` entry on a tombstoned operand (2303–2304, 2593–2598); any yield checkpoint on `state!=='live'` or epoch mismatch (2311–2317); the room-search success/error callbacks on `!isLeaseValid(lease)` (1873–1886) — carries `model.id` | `isLeaseValid` |

`[CONTRADICTION — noted, not resolved]` **Error Handling, "Disposal mid-query" (lines 2599–2606)** states:
*"`unload()`/`world.dispose()` tombstones every model's lifecycle entry (see above) and sets the world's
own terminal `disposed` flag before releasing anything, so an in-flight query rejects with
`ModelEvictedError` through the same per-model mechanism, not a separate one."* This is stale
round-12/14 text and conflicts with round 15's fix on three points at once:
(a) `dispose()` explicitly **no longer** tombstones every model (2357–2358, 2178–2182);
(b) the flag is set **first**, not after tombstoning (2167–2168, 2338–2340);
(c) a suspended query resuming after `dispose()` must reject **`WorldDisposedError`**, not
`ModelEvictedError` — the fixture at 3013–3020 says so in terms, and adds *"A test still expecting
`ModelEvictedError` is itself the regression."*

### 1.7 Cross-check against the `viewer-extension-lifecycle-audit` hazard taxonomy

Taxonomy read from `~/.claude/skills/viewer-extension-lifecycle-audit/SKILL.md` §3 (checks A–J) plus its
hard dependencies `knowledge/viewer-model-lifecycle.md` and
`patterns/viewer-tool-and-extension-lifecycle.md` (kit root `/Users/kangea/.shconfig/vendors/aps-viewer-agent-kit`).
Listed here as *categories the spec does or does not speak to* — not as adjudicated findings.

| Check | Category | Spec coverage |
|---|---|---|
| **A** — init completeness | Does `load()` await everything a consumer might need? | **Partial.** `load()` is `async` and constructs the world only (1808–1810, 2371–2372); `fromViewer` returns a `Promise` (2028). Spec doesn't state that `load()` awaits it or what a consumer observes if it doesn't. |
| **B** — transactional load / partial init | Rollback if `load()` fails midway | **Not addressed.** No error path for a failed `fromViewer` is specified anywhere. |
| **C** — unload isolation | Each teardown step in its own try/catch so one throw doesn't strand the rest | **Not addressed.** `unload()` is listed as three steps (`world.dispose()`, unregister context menu + `BEFORE_MODEL_UNLOAD` listener, clear the per-model room cache — 2373–2374) with no isolation discipline stated. The pattern file treats per-step isolation as cross-project-verified mature guidance. |
| **D** — teardown ordering | A step depending on another resource still being alive | **Not addressed, and the stated order is the risky one.** `unload()` runs `world.dispose()` *before* unregistering the `BEFORE_MODEL_UNLOAD` listener (2373–2374). Between those two steps the event can fire, and `evictModel` on a disposed world is specified to **throw `WorldDisposedError`** (2171) — inside a Viewer event dispatch, i.e. exactly the uncaught-exception shape `isLeaseValid` was made non-throwing to avoid (2087–2094). The spec never discusses this window. |
| **E** — cross-extension reference lifetime | Cached `getExtension()` handles across a lifecycle boundary | **Not applicable** — the extension holds no cross-extension references (2369–2382). |
| **F** — model load / replacement (`tearDown()` trap) | A second `loadDocumentNode`/`loadModel` without `keepCurrentModels` implicitly calls `tearDown()`, unloading **every** extension (source-observed on 7.124.2 per `viewer-model-lifecycle`) | **Not addressed anywhere in 3300 lines.** The strings `keepCurrentModels` and `tearDown` do not appear. Yet Data Flow step 1 (1812–1815) reasons explicitly about "the user can load a different model afterward" and builds the whole lazy per-model room cache on the premise that **the extension survives a model switch**. If the app's `loadModel()` path omits `keepCurrentModels`, `tearDown()` → `RoomLocatorExtension.unload()` → `world.dispose()`, and the world is terminally dead with nothing re-running `load()`. This is the largest taxonomy category the spec is silent on. |
| **G** — lifecycle event timing | Listener attached after the event's fire point | **Partial.** The event is chosen and justified (`BEFORE_MODEL_UNLOAD_EVENT`, "fires while `model` is still valid to read", 1826–1841). Attach timing relative to model loads is `[SILENT]`. The payload shape (`event.model`) is flagged unverified — typings declare `event: any` (1829–1833, 3176–3182). Whether the event can ever *fail to fire* for some removal path is an acknowledged open question (3293–3296) — and every race-safety guarantee is conditioned on it firing at least once per removal. |
| **H** — model/extension identity across reloads | Caches spanning an unload/reload boundary | **Extensively addressed** — this is the spec's core (rounds 10–15). Object-identity keying, permanent tombstones, global epochs, epoch-keyed caches. |
| **I** — panel/toolbar cleanup | `DockingPanel.addVisibilityListener` has no removal counterpart | **Largely not applicable** — the extension's UI is a context menu, not a `DockingPanel` (2381). |
| **J** — internal/undocumented lifecycle deps | `viewer.impl.*`, `Private.*`, undocumented structures | **Addressed.** `getRenderProxy`, `vb`/`vbstride`/`vblayout`, `getGeometryId` named as untyped/internal (3169–3172); `Autodesk.Viewing.Private.THREE` proven non-existent, Viewer THREE is global `window.THREE` @ r71 (543–545, 663–682); `InstanceTree` documented deprecated in favour of `ObjectTree`, recorded as a fact to revisit at implementation time rather than acted on (491–495). |

---

## 2. Geometry ownership / build pipeline

### 2.1 Identity

`GeometryRecord` — one per unique **`(loadEpoch, geometryIndex)`** (lines 873–875, 2285–2293).

- `geometryIndex` = `fragList.getGeometryId(fragId)`, confirmed **model-local only** by direct
  inspection of the shipped Viewer source (793–797, 3163–3166).
- `loadEpoch` = `modelLifecycle.get(model).epoch`, from `admitModel`/`findClashes` entry admission
  (793–794).
- **Never** `(modelId, geometryIndex)`, never the bare index (798–801). `modelId` survives on a record
  only as display/diagnostic metadata (e.g. naming the model in a
  `geometry-too-large-for-sync-build` message); it plays no role in cache identity (879–881).
- Why: round-14's Critical is an **admission**-time bug, not an eviction-time one — a different `Model`
  object admitted under a reused `modelId` before the old object's eviction ran would have its first
  geometry lookup silently hit the old object's cached record (2271–2283).

`GeometryRecord` contents named by the spec: `referenceCount`, a lazy `accelerationPromise` (the BLAS),
a lazy `connectivity` (876–877), `L_X := diagonal(localBounds(X))` cached with the BLAS (1012–1015), and
an "oversized" marking (977–979).

`[SILENT]` `referenceCount` is named once (876) and never used again — nothing says who increments or
decrements it, or what reaching zero triggers. It is not part of any release path in §5.

### 2.2 Pipeline stages, in order

| # | Stage | Trigger | Keyed / cached by | Bound | Cite |
|---|---|---|---|---|---|
| 0 | **Extraction**: self-driven node-by-node walk per requested dbId; build one `CollisionInstance` per fragment | Each `findClashes` call, source dbId then every target dbId | `[SILENT]` — no cross-call cache for `CollisionInstance`s is specified | `maxFragmentsPerDbId = 5_000` (cumulative, between-nodes only) | 1912–1967 |
| 1 | **Layout normalization**: positions / index / `ranges: TriangleRange[]` | Per fragment, inside `ViewerGeometryAdapter` | — (feeds the record build) | Free — proportional to range count, not triangle count | 803–871 |
| 2 | **Active-range size gate**: `sum(ranges[].count)` vs `maxSyncTriangleCount` | Narrow phase, per candidate pair, **before** anything is materialized | Fragment-scoped, deduplicated diagnostic | Hard: `12_000` | 938–949, 1976–1981, 2514–2519 |
| 3 | **Compaction**: materialize a collision-owned, compacted position/index pair containing only active-range triangles | Only after stage 2 passes | Part of the `GeometryRecord` build | Bounded by the now-confirmed-under-ceiling active count | 934–949 |
| 4 | **Weld**: strip to position+index only, then `mergeVertices(geometry, weldEpsilon)` | Same phase/checkpoint as stage 3 | `GeometryRecord` | `maxSyncTriangleCount` | 1149–1188, 1374 |
| 5 | **Connectivity**: union-find over triangles sharing an **edge**, restricted to active ranges; also yields manifold classification for free | **Independently lazy** — first time a mode calling `anyComponentInside` touches this record | `GeometryRecord.connectivity`, cached alongside the BLAS | `maxSyncTriangleCount` | 1190–1213, 1375 |
| 6 | **BVH build**: one `MeshBVH` over the welded geometry | First use, every mode | `GeometryRecord.accelerationPromise` | `maxSyncTriangleCount` | 884–885, 1376 |
| 7 | **Publication** to the shared cache | Only once every phase it needs has completed **successfully** | `GeometryRegistry` | — | 920–925 |

Ordering statement, verbatim from the round-16 header (line 424–425): *"Viewer geometry → active-range
compaction → size gate → weld → connectivity when required → BVH."* Note the **normative body text
(938–943) puts the size gate before compaction**, not after: the sum is "checked against that sum before
any copying happens," so a fragment over the ceiling is diagnosed "without ever materializing a compacted
buffer for it," and fixture 2902–2906 asserts **zero** compaction calls in that case.
`[CONTRADICTION — minor, noted]` The round-16 header's stage ordering and the body's are transposed;
the body + fixture are the operative pair.

**What compaction retired:** the previous "set `groups`/`drawRange` on the BVH input" workaround is
explicitly unnecessary — nothing out-of-range survives compaction (962–966). And `indexOwnership:
'indirect'` is not merely unimplemented but **inapplicable**: there is no shared index left to protect
at any stage (958–961, 3253–3255).

**Why the weld strips attributes first:** `mergeVertices` compares *all* attributes, so per-face
normals/uvs make every vertex unique and welding a full-attribute geometry silently does nothing. The
idea doc's "don't copy rendering attributes" rule — written for memory — is therefore **load-bearing for
correctness** (523–527, 1158–1162). Fixture asserts the count (24→8 for a box), not merely that welding
ran (3068–3072).

`weldEpsilon = 1e-4 m / model.getUnitScale()`, falling back to `1e-4` if unit scale is unavailable
(1180–1182). Upstream `mergeVertices(geometry, tolerance = 1e-4)` is an **absolute length in local
units** implemented as **grid quantization, not an epsilon-ball** — the guarantee is "identical
coordinates always merge," not "anything within `tolerance` merges" (1167–1178).

### 2.3 Idempotence / re-entrancy

- `BlasCache` dedupes **concurrent** build requests via `accelerationPromise`, so two simultaneous
  queries never build the same BVH twice (967–969). That promise explicitly does **not** make the
  `MeshBVH` constructor non-blocking; yielding between builds is the narrow phase's job, not
  `BlasCache`'s (969–971).
- `[SILENT]` No equivalent concurrent-build dedup mechanism is named for **connectivity** or for the
  **weld/compaction** phase. Both are described as "computed at most once per unique geometry"
  (877–879, 1191–1193) without saying what happens if two `findClashes` calls interleave across a yield
  and both find the phase unbuilt.
- `[AMBIGUOUS]` "Publish only when every phase completed successfully" (920–925) versus "the
  `accelerationPromise` is what dedupes concurrent requests" (967–969) are in tension: a promise
  observable by a *second* caller is itself a form of publication. The spec doesn't say whether the
  in-flight promise lives in the cache during the build (needed for dedup) or only after (needed for
  the discard-on-failure rule). Note that `evictModel`/`dispose` both speak of rejecting **in-flight
  build promises** (2130–2133, 2177–2178), which implies the former.
- `[AMBIGUOUS]` Connectivity is "independently lazy," so a record can be published (weld+BVH) for a
  `surface-intersection` session and *later* gain connectivity when a `containment` query arrives. The
  discard-the-partial-record rule is written for a first build (923–925); what happens if the
  connectivity checkpoint fails on an **already-published** record is not stated.

### 2.4 Interaction with eviction / disposal

- **Checkpoint between phases finds the model evicted or the world disposed** → the partially-built
  record (whichever intermediate buffers exist) is **discarded, not cached**; the failure surfaces as
  the same `ModelEvictedError`/`WorldDisposedError`; a later valid attempt starts the **whole pipeline
  fresh** rather than resuming a half-built record (920–925). Fixture 2888–2892 asserts welding runs
  again, not resumed.
- **`evictModel`** releases everything under that one epoch, and rejects in-flight build promises filed
  under it (2130–2133).
- **`dispose()`** wholesale-clears all three caches and rejects **every** in-flight build promise
  (2176–2178, 2358–2363).
- **Oversized records:** a geometry at or above `maxSyncTriangleCount` is *not* built; `GeometryRegistry`
  "marks the record oversized" and every pair needing it is skipped (977–982). `[SILENT]` The spec never
  says whether that oversized marking is itself an epoch-keyed cache entry subject to the same release
  paths, or per-call state.

---

## 3. Query mode dependencies

Per the spec's **current (post-round-16, round-17-reconciled)** text. Round 15 shipped the opposite
claim for `volume-overlap` *and a fixture asserting it*; round 16 fixed both (lines 431–439); round 17
fixed the last stale sentence in the performance gate (498–501).

| Mode | Derived state required | `anyComponentInside`? | Parity operands needing closure | Pipeline stages executed |
|---|---|---|---|---|
| `surface-intersection` | **weld + BVH only** | **No — never calls it** (909) | none (1103, 2049) | 0,1,2,3,4,6,7 — **no connectivity** (1375, 2885–2887) |
| `containment` | weld + **connectivity** + BVH | **Yes — stages 1–2 only** (1727–1733) | **target only** (1104, 1134–1137) | 0,1,2,3,4,**5**,6,7 |
| `volume-overlap` | weld + **connectivity** + BVH | **Yes — stages 1–3** (1588–1590, 1618–1626) | **both** (1105, 1126–1133) | 0,1,2,3,4,**5**,6,7 |

**`anyComponentInside` and exactly who calls it** (lines 903–909, the round-16 correction):
`ContainmentModeQuery` calls it **directly**; `VolumeOverlapQuery` calls it **through its own
containment terms, run only after `ProperCrossingQuery` returns false**. It samples per connected
component *regardless of which public mode is asking*, which is what requires `GeometryConnectivity`.
`volume-overlap` skips only **stage 3** (the constructed interior witness), never the component
decomposition (stages 1–2). **Only `surface-intersection` is genuinely connectivity-free** (909).

**Compositions:**

```
volume-overlap(A, B) :=  ProperCrossingQuery(A, B)                    // shares volume via a crossing
                      OR ContainmentQuery(anyComponentOf(A) inside B)
                      OR ContainmentQuery(anyComponentOf(B) inside A)   [lines 1693-1697]
                         — evaluated in that order, early exit; both directions required for symmetry

containment(A, B)    :=  ContainmentQuery(anyComponentOf(A) inside B)   // a source VERTEX inside B
                      OR SurfaceCrossingWitness(A, B)                   // a point on a source TRIANGLE
                                                                        //   inside B   [lines 1719-1722]
                         — one direction only; directed, not symmetric

surface-intersection :=  first candidate pair from the shared bvhcast traversal that intersects at all
                         [lines 1215-1239]
```

**`ProperCrossingQuery` uses only `classifyPoint`, never `anyComponentInside`** (1452–1455) — which is
what keeps the containment guarantee non-circular (1456–1458).

`[AMBIGUOUS]` The build-time connectivity decision is **per mode**, not per pair outcome
(1983–1985: "only for a mode that calls `anyComponentInside` — `containment` or `volume-overlap`"),
and fixture 2878–2884 asserts the connectivity checkpoint fires for `volume-overlap`. But at runtime a
`volume-overlap` pair decided by `ProperCrossingQuery`'s early `true` never reaches a containment term
and never consumes connectivity. Whether connectivity is therefore built eagerly (per the fixture) or
on genuine first consumption (per "independently lazy … only the first time a mode that actually
consumes it touches this `GeometryRecord`", 900–902) is not reconciled.

`[SILENT]` `SurfaceCrossingWitness` is `containment`-only (per the `crossingProbeFractions` row at line
1032 and the composition at 1721), and requires a **non-coplanar source-triangle/target intersection
segment** to exist. It shares "the same traversal and budget as the other two modes" (1778–1779), i.e. a
`bvhcast`. That means `containment` also executes a `bvhcast` traversal, which the mode table (1101–1105)
does not mention. Its interaction with the "connectivity-free" classification is not in question — but
its scheduling classification is; see §4 row 14.

---

## 4. Synchronous-work / budget model

**The spec's own two-tier framing** (lines 1395–1431), which the categories below map onto:
1. a **per-atomic-operation ceiling** — primitives with no internal hook to check a clock against;
2. a **cooperative-composition ceiling** — what `frameBudgetMs = 8` actually bounds (2004–2006; `8` is
   half a frame "since a checkpoint can only fire *between* primitives, not preempt one").

Resulting stated bound (1425–1431): *"roughly `max(frameBudgetMs + one small atomic operation's cost,
one build-phase's own cost)`"* — explicitly *"only as good as the unmeasured rows"* of the
atomic-operations table.

Legend: **[Y]** cooperatively yieldable/resumable · **[B]** enforceably size/count bounded ·
**[A]** non-preemptible accepted atomic risk.

| # | Operation | Class | Mechanism | Earned? | Cite |
|---|---|---|---|---|---|
| 1 | Extraction walk (node-by-node, whole dbId) | **[Y]** | `frameBudgetMs` checkpoint fires **between sibling nodes at the same depth** and before each dbId | Yes — plain-JS walk under `findClashes`'s own control | 1912–1916, 1943–1947 |
| 2 | `maxFragmentsPerDbId = 5_000` as a ceiling | **[B]**, *narrowly* | Bounds "**total work across the walk, via early termination between nodes**" only. Round 17 re-described it for what it actually bounds after round 15 and round 16 each over-claimed | Yes, **for that narrow claim only** — round 17 narrowed rather than invented | 1379, 484–486, 1949–1965 |
| 3 | One `enumNodeFragments(node, cb, false)` call | **[A]** — **no bound at all, honestly stated** | None. Verified against the official Reference Guide that **no fragment-count equivalent of `getChildCount` exists** on `InstanceTree` *or* `ObjectTree`, and neither documents a way to interrupt one enumeration call | N/A — the spec declines to claim a bound | 1380, 1949–1965, 2525–2529 |
| 4 | Recursive `enumNodeFragments(dbId, cb, true)` | **not used** | Round 16 removed it entirely ("The fix does not use the recursive form at all") | — | 1924–1926 |
| 5 | `getChildCount(node)` preflight | **[B]** | Verified O(1)-shaped on both `InstanceTree` and `ObjectTree` against the official Reference Guide (not typings alone); now a **normative preflight before every `enumNodeChildren` call** | Yes, as an *API-existence* claim | 476–483, 1928–1932 |
| 6 | One `enumNodeChildren(node, cb, false)` call | **[A]** in effect — `[B]` **claimed but not earned** | The spec asserts *"a wide-but-fragment-empty tree is caught by the `getChildCount` preflight rather than blocking inside an unbounded `enumNodeChildren` call"* (1943–1944) and that the preflight is *"how the walk avoids fanning out into a node with a pathologically large direct-child count"* (1930–1932) — but **defines no threshold, no ceiling constant, and no reject/abort action** to take on a large count | **No.** This is structurally the same "claimed vs. earned" shape as `maxFragmentsPerDbId`'s rounds 15→16→17 history, one level over: a verified cheap *observation* is being credited as a *bound* with no stated enforcement | 1928–1932, 1939–1947 |
| 7 | Active-range compaction | **[A]** with a worst case genuinely bounded | Non-preemptible; folded into the weld phase's single checkpoint. Bounded because the gate at #8 runs **first**, on a free `sum(ranges[].count)` | Yes — the gate's input is already-normalized range metadata, "free to compute … never proportional to triangle count" (938–940) | 934–949, 1374 |
| 8 | `maxSyncTriangleCount = 12_000` gate | **[B]** | Checked against `sum(ranges[].count)` before any copying; oversized ⇒ pair skipped + fragment-scoped dedup'd diagnostic | Yes as a *mechanism*; **the value is "reasoned, provisional"**, not measured, since round 15 revised it down from `20_000` | 940–949, 977–996, 1976–1981 |
| 9 | Welding (`mergeVertices`) | **[A]** with size ceiling | Non-preemptible; own checkpoint immediately **before** it starts | Measured ~**16.8ms @ 19,800 tris** (round 15) — the measurement that killed `20_000` | 1374, 897–919, 986–996 |
| 10 | Connectivity construction | **[A]** with size ceiling | Non-preemptible; own checkpoint; independently lazy | Measured ~**6.9ms @ 19,800 tris** | 1375 |
| 11 | BVH build (`MeshBVH` ctor) | **[A]** with size ceiling | Non-preemptible; own checkpoint; the one phase every mode needs | Measured ~**16ms @ 18k tris** (spike) | 1376, 531–535 |
| 12 | Broad-phase `O(N×M)` AABB scan | **[B]** ceiling, **[A]** execution | `maxBroadPhaseInstancePairs = 1_000_000` checked **before** the scan, via **overflow-safe division** (`sourceCount > ceiling / targetCount`), never multiplication. One `frameBudgetMs` checkpoint fires before the scan; **none inside it** | Mechanism yes (pure arithmetic on lengths, no API dependency). But **"reasoned, not yet measured"** and the bound it buys is ~1e6 AABB tests at "O(µs)" each — i.e. it does not establish a frame-scale bound, only a finite one | 1381, 1968–1975, 2530–2533 |
| 13 | `bvhcast` traversal (shared by `ProperCrossingQuery` **and** `SurfaceIntersectionQuery`) | **[B]** — abort-only, **not** resumable | Three abort triggers, all setting the same `aborted` flag: `maxCandidatePairsExamined = 50_000` (raw candidates, checked at callback entry), `maxCrossingPairsExamined = 64` (confirmed non-coplanar pairs), and **elapsed time > `frameBudgetMs` checked before each individual probe**. `bvhcast` returns `true` on abort, which **must not be read as "crossing found"** | Mechanism yes and hard-won: round 7 moved `surface-intersection` off `MeshBVH.intersectsGeometry` specifically because that API "accepts no budget, exposes no per-candidate callback, and offers no abort hook" (1221–1230). `maxCandidatePairsExamined` is **measured** (~0.3µs/pair). **Taxonomy note:** this fits none of the three categories cleanly — it is interruptible but *not* resumable ("a time-triggered abort ends this candidate pair's crossing evaluation for good"), and it degrades to a diagnostic rather than rejecting | 1306–1352, 1377, 1319–1323, 1443–1447 |
| 14 | `SurfaceCrossingWitness` per-candidate probe loop | **[Y]** *as classified* — but see below | Line 1673–1676 groups it with the plain-JS yield-and-resume loops, "checked before each candidate's probe … all three are plain JS loops with **no native traversal in the way**" | **Questionable.** Line 1778–1779 says this stage uses the *"Same traversal and budget as the other two modes"* — i.e. `bvhcast`, a synchronous native traversal that by the spec's own repeated statement cannot be paused (1348–1350). Whether the probing happens *inside* the callback (⇒ **[A]**/abort-only, like #13) or after candidates are collected (⇒ **[Y]**) is **`[AMBIGUOUS]` — never stated** | 1673–1676, 1745–1779 |
| 15 | `anyComponentInside` stages 1–2 sampling | **[Y]** | `performance.now()` read **before every individual `classifyPoint` call** (not batched at all — round 11 rejected `deadlineCheckInterval = 256`). `await`s the same scheduling yield, re-validates, then **resumes from exactly where it left off**. Explicitly *"does not truncate the search"* — the time check decides scheduling only, never how much work happens | Yes — mechanism is stated and fixture-pinned (2784–2795), including "the checkpoint fires **before** the sample whose elapsed time crosses the deadline is classified" | 1648–1676 |
| 16 | `maxContainmentSamples = 512` | **[B]** | Global cap across components; hitting it emits `incomplete-component-coverage` so an unsampled-component negative is never reported clean | Mechanism yes; value explicitly **provisional** | 1645–1646, 3275–3278 |
| 17 | Stage-3 constructed-witness loop (`maxWitnessTriangles = 8`) | **[Y]** + **[B]** | Plain JS, checked before each witness-triangle attempt; `volume-overlap` only | Yes; value provisional | 1672–1673, 1607, 3275–3278 |
| 18 | One `classifyPoint` call (proximity check + up to 3 raycasts) | **[A]** — no ceiling of its own | "Checked before every occurrence; the ***composition*** of many such calls is what `frameBudgetMs` bounds, **not any single call's own cost**" | **No — explicitly "Reasoned, not yet measured."** The spec refuses to claim it: *"This spec does not claim it as fact; the performance gate below is now required to measure it"* (1411–1413). Gate requirement at 3120–3127 | 1378, 1400–1413 |
| 19 | One crossing probe (up to 2 `classifyPoint` calls) | **[A]** | Overshoot past `frameBudgetMs` is bounded to *one probe's* cost (round 11), down from one confirmed pair's 12 probes / 24 `classifyPoint` calls (round 10) | Same as #18 — reasoned, unmeasured | 1354–1358, 1378 |
| 20 | `releaseEpochScopedState(epoch)` | **[A]**, unbounded | "A synchronous map/set removal and promise rejection" that **must be non-throwing** | `[SILENT]` on cost — proportional to the number of records under that epoch; never given a ceiling or a checkpoint | 2130–2143 |
| 21 | `dispose()`'s wholesale cache clear | **[A]**, unbounded | Synchronous, "the entire cache, in one operation" | `[SILENT]` on cost | 2176–2178, 2358–2363 |

**Rows the performance gate must promote from reasoned to measured** (3096–3155): each of the three
build phases individually at the ceiling (3128–3137); one `classifyPoint` and one probe (3120–3127);
extraction for the largest single dbId and the broad-phase scan at real instance counts, confirming or
revising `maxFragmentsPerDbId` and `maxBroadPhaseInstancePairs` (3138–3142); and round 17's new
requirement, one `enumNodeFragments(node, cb, false)` call on a node chosen to directly own as many
fragments as the model allows (3143–3150) — with the honest rider that *"a model where no single node
owns more than a small fraction of `maxFragmentsPerDbId` directly cannot exercise this risk at all;
recording that limitation is itself a gate finding, not a pass."*

The spec's own standing warning about this whole section (3220–3224): *"note that claim was made in
round 5 and was **false when written** … Treat 'the budgets bound it' as a property to re-verify
whenever a new traversal is added, not as a standing invariant."*

---

## 5. Cache ownership and cleanup

### 5.1 Inventory

| Cache | Owner | Authoritative key | Contents |
|---|---|---|---|
| `GeometryRegistry` | `CollisionWorld` | **`(loadEpoch, geometryIndex)`** | one `GeometryRecord`: `referenceCount`, `accelerationPromise`, `connectivity`, `L_X`, oversized marking, `modelId` as metadata only (873–882) |
| `BlasCache` | `CollisionWorld` | per `GeometryRecord` ⇒ effectively `(loadEpoch, geometryIndex)`; the built `MeshBVH` lives behind `accelerationPromise` | one `MeshBVH` per record; dedupes concurrent builds (884, 967–971, 2271–2273) |
| `GeometryConnectivity` | `CollisionWorld` | per `GeometryRecord`, "cached alongside the BLAS" ⇒ same tuple | component decomposition + per-component manifold classification (1190–1213, 2271–2273) |
| `modelLifecycle` | `CollisionWorld` | `Model` **object identity** (`WeakMap`) | `{state:'live',epoch}` \| `{state:'evicted'}` (2208–2223) |
| `liveModelByModelId` | `CollisionWorld` | numeric `modelId` | current live `Model` for that id — **diagnostics/bookkeeping only** (2224–2235) |
| Room-dbId cache | **`RoomLocatorExtension`, not the world** | `Map<Model, Promise<number[]>>` — **exact object**, not `model.id` (1816–1821) | resolved room dbIds per model |

The three world caches are named together as "model-owned collision state" and all three moved from
`(modelId, geometryIndex)` to `(loadEpoch, geometryIndex)` in round 14 (356–368, 2271–2293).

### 5.2 What each release path does

| | `evictModel(model)` | `dispose()` |
|---|---|---|
| `GeometryRegistry` | drops **every record filed under that object's own `epoch`** (2130–2133) | **wholesale-clears the entire cache**, no per-model sweep (2176–2178, 2358–2363) |
| `BlasCache` | same, epoch-scoped | wholesale-clear |
| `GeometryConnectivity` | same, epoch-scoped | wholesale-clear ("every cached `GeometryConnectivity`") |
| In-flight build promises | rejects those under that epoch | rejects **every** one, "exactly once, on the same disposal call" |
| `modelLifecycle` | writes `{state:'evicted'}` unconditionally, **before** the release; never deletes | **does not clear it** — a `WeakMap` cannot be enumerated; tombstones are GC-reclaimed (2219–2223). Best-effort tombstones only what `liveModelByModelId` happens to reference (2178–2182) |
| `liveModelByModelId` | deletes this object's entry **only if** it is still the current occupant of its `model.id` — bookkeeping hygiene (2144–2147, 2232–2235) | `[SILENT]` — not stated to clear the map itself, only to best-effort tombstone what it references |
| `disposed` flag | untouched | set **first, synchronously, before anything else** (2167–2168, 2338–2340) |
| Room-dbId cache | **not touched** — the extension's `BEFORE_MODEL_UNLOAD` handler must separately delete that object's entry (1838–1841, 2375–2377) | **not touched** — the extension's `unload()` separately "clears the per-model room cache" (2373–2374) |
| Can throw? | **must not** — non-throwing is a stated requirement, since a partial release is unretriable once the epoch is gone (2137–2143) | `[SILENT]` |

### 5.3 Consistency between the two paths, and with §1

**Consistent:**
- Both release exactly the same three caches plus in-flight build promises. Round 15 deliberately
  replaced the per-model sweep in `dispose()` with a wholesale clear precisely because *"a wholesale
  clear cannot suffer the same enumeration gap a per-model sweep can, because it never needs to identify
  *which* models were live in the first place"* (2361–2363).
- Both are consistent with §1's model: after either, a suspended query fails at its next checkpoint —
  `evictModel` via the per-model epoch check, `dispose()` via the `disposed` flag checked first
  (2183–2185, 2343–2350).
- Epoch keying makes eviction's scoped release provably non-interfering: it *"can only ever release
  records filed under `oldModel`'s own epoch, which no other object's records are ever filed under,
  regardless of `modelId` reuse or call timing"* (2133–2137).

**Asymmetries the spec states deliberately:**
- `evictModel` tombstones; `dispose()` does **not** (and no longer needs to). Liveness after disposal is
  answered by the flag, not by per-model state.
- `evictModel` is epoch-scoped and therefore precise; `dispose()` is indiscriminate and therefore
  immune to the enumeration gap.

**Gaps / open points, flagged not resolved:**
- `[SILENT]` `dispose()` does not release the **extension-owned room cache**; only `unload()` does
  (2373–2374). Nothing states whether `dispose()` may be called independently of `unload()`. If it can,
  that cache outlives the world.
- `[SILENT]` Nothing releases `liveModelByModelId` wholesale on disposal. Harmless by design (it is
  bookkeeping), but it is a live `Map` holding strong `Model` references after the world is dead — the
  only strong-reference cache in the set (`modelLifecycle` is deliberately weak, 2219–2223).
- `[SILENT]` `GeometryRecord.referenceCount` participates in no release path and is never read anywhere
  in the spec (see §2.1).
- `[SILENT]` No release path covers the **oversized marking** (§2.4) or any per-call extraction state
  (`CollisionInstance`s), whose caching lifetime is unspecified (§2.2 row 0).
- `[AMBIGUOUS]` The epoch-scoped release must find records "filed under" an epoch. `GeometryRegistry`'s
  key is a *tuple*, and the spec never says whether it is indexed to support an epoch-prefix sweep or
  whether the release is a linear scan of all records. That determines row 20 of §4's cost.
- `[CONTRADICTION]` See §1.6: Error Handling's "Disposal mid-query" (2599–2601) still describes
  `dispose()` as tombstoning every model and rejecting in-flight queries with `ModelEvictedError`,
  contradicting the round-15 mechanism this section documents.

---

## Appendix — items flagged for the audit pass

Ordered roughly by how load-bearing they look; **none is adjudicated here.**

1. **`tearDown()` trap entirely absent** (§1.7 check F). Neither `keepCurrentModels` nor `tearDown`
   appears in 3300 lines, while Data Flow step 1 (1812–1815) is built on the extension surviving a
   model switch. Kit knowledge `viewer-model-lifecycle` (source-observed, 7.124.2) says a second
   `loadDocumentNode`/`loadModel` without `keepCurrentModels` unloads every extension.
2. **Stale `ModelEvictedError`-on-dispose paragraph** at 2599–2601, contradicted by 2357–2358,
   2167–2168 and fixture 3013–3020.
3. **`enumNodeChildren` bound claimed but not earned** (§4 row 6) — the same shape as
   `maxFragmentsPerDbId`'s own rounds 15→16→17 history.
4. **`unload()` teardown ordering** — `dispose()` before listener removal, with `evictModel` specified
   to throw `WorldDisposedError` inside a Viewer event dispatch (§1.7 check D).
5. **`SurfaceCrossingWitness`'s scheduling class** — "plain JS loop, no native traversal in the way"
   (1673–1676) vs. "same traversal … as the other two modes" (1778–1779) (§4 row 14).
6. **Connectivity: eager per mode, or lazy per genuine consumption?** (§3, last note.)
7. **Partial-record discard vs. `accelerationPromise` dedup** — whether an in-flight build is visible
   in the cache (§2.3).
8. **`referenceCount`** — declared once, never used (§2.1, §5.3).
9. **Round-16 header vs. body ordering of size-gate and compaction** (§2.2).
10. **Local checkpoint wording at 1660–1661** omits the `disposed` half of the protocol (§1.5).
11. **`BEFORE_MODEL_UNLOAD_EVENT` payload shape** still unverified (`event: any`, 1829–1833,
    3176–3182), and whether the event can ever fail to fire is an acknowledged open question
    (3293–3296) on which every race-safety guarantee is conditioned.
12. **`InstanceTree` is documented deprecated** in favour of `ObjectTree`, which exposes no
    `enumNodeFragments` at all (its enumeration method is `enumNodeInstances`) — recorded at 491–495 as
    a fact to revisit at implementation time, deliberately not acted on.
