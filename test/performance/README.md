# Performance-gate instrumentation harness (Task 23)

This directory builds the **measurement mechanism** for Milestone 1's twelve performance-gate
pass criteria (`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:4660-4796`).
Running the real gate itself is `run-gate.mjs` (Task 24) -- it HAS now run, against a real,
adequately-scaled model; see
`docs/superpowers/specs/milestone-1-performance-gate-disposition.md` for the full, criterion-by-
criterion writeup of that run's real numbers and verdicts. Everything else here (the instrumentation
mechanism itself: `checkpoint-recorder.mjs`, `browser-probes.mjs`, `measure-geometry-phases.mjs`) was
sanity-checked at the time it was built to run and produce a plausible, well-shaped answer, ahead of
`run-gate.mjs` existing to drive it against the real ceilings.

## What's here

- **`checkpoint-recorder.mjs`** -- a reusable `CheckpointRecorder` class: bracket a labeled span
  with `start(label)`/`end()` or `around(label, fn)`, or hand `asSpanRecorder()` to
  `collision/scheduler.js`'s `setSpanRecorder` to have every labeled checkpoint call site report
  into it automatically. `longestSpan(label?)` and `spansByLabel(label)` read the log back.
- **`measure-geometry-phases.mjs`** -- a Node-runnable script (`node
  test/performance/measure-geometry-phases.mjs`) that measures weld, connectivity, and BVH
  construction as three SEPARATE timed spans, against the real production `collision/geometry/`
  and `collision/blas/` modules, on a deterministic flat triangle grid asserted to have exactly
  `maxSyncTriangleCount` (12,000) triangles -- not approximated via a tessellator formula. This is
  the gap Round 15 found: the prior gate only ever measured a combined BVH build, which is how a
  ~16.8ms weld and a ~6.9ms connectivity build went undetected for four rounds. Kept side by side
  with, and never conflated with, `spike/measure.mjs`'s own earlier synthetic BVH-only figures.
- **`browser-probes.mjs`** -- a self-contained (no `import`s), plain (non-module) script exposing
  `window.__perfProbes`, meant to be injected into a live Viewer page via Playwright's
  `page.addScriptTag({ path: 'test/performance/browser-probes.mjs' })`. Answers every criterion
  that needs a live Viewer/DOM/model (see "The instrumentation surface" below for the full
  criterion-by-criterion mapping).
- **`run-gate.mjs`** (Task 24) -- the largest file in this directory, and the one that actually RUNS
  the gate: a Playwright driver that loads a real, adequately-scaled model (see the disposition
  document's "Model used" section), selects a real dbId pair via a fragment-bearing-frontier walk,
  injects `browser-probes.mjs`, drives the real cold-then-warm `volume-overlap` protocol against one
  shared `CollisionWorld`, and writes the full 12-criteria report to `test/performance/results/`
  (gitignored). Run it directly with `npm run test:performance:gate` (or `node
  test/performance/run-gate.mjs`; `MEP_URN=<urn>` overrides the model). See
  `docs/superpowers/specs/milestone-1-performance-gate-disposition.md` for the write-up of what it
  found.

## The instrumentation surface (what stable hook does this harness use?)

`collision/scheduler.js` exports two new module-level functions, added by this task:

```js
export function setSpanRecorder(fn) { ... }   // fn: (label: string, ms: number) => void
export function clearSpanRecorder() { ... }
```

`createCheckpointPort(...)`'s returned `checkpoint(ctx)` now accepts an optional `ctx.label`
(a stable, distinct string per call site). On every `checkpoint()` invocation -- whether or not a
real yield ends up happening -- it brackets the synchronous span since that same port's own
previous TRACKED checkpoint call and reports it via `setSpanRecorder`'s callback under that label.
"Tracked" matters: the port's `lastSpanAt` baseline is lazy (`null` until a span recorder is
actually installed and a checkpoint runs while it's present), NOT captured unconditionally at port
construction -- so the very first labeled span reported on a port (whether that's genuinely the
port's first checkpoint call, or a recorder was only installed partway through this port's life,
after some earlier checkpoints already ran untracked) is honestly reported as `0`, never an
inflated span reaching back to port construction or to some earlier untracked point. This is a true
no-op when `setSpanRecorder` was never called -- a single `_spanRecorder` truthiness check per
checkpoint evaluation gates BOTH the `performance.now()` read and the `lastSpanAt` bookkeeping, not
merely the recorder callback itself (fixed in the Batch-5 final review, finding I-5: an earlier
version of this code read `performance.now()` and wrote `lastSpanAt` unconditionally on every
checkpoint, whether or not a recorder was installed, contradicting this exact zero-cost claim) --
production code runs through this path on every real query, instrumented or not.

Every existing checkpoint call site in the library was given a stable, distinct label as part of
this task:

| File:line | Label | Mechanism | What it brackets |
|---|---|---|---|
| `collision/CollisionWorld.js` (`findClashes`'s main narrow-phase loop) | `narrow-phase-pair` | checkpoint `label` | one candidate pair boundary |
| `collision/CollisionWorld.js` (`_runBroadPhaseScan`) | `broad-phase-scan` | checkpoint `label` | one broad-phase instance-pair boundary |
| `collision/CollisionWorld.js` (`createComposedStageScheduler`, used by ContainmentModeQuery/VolumeOverlapQuery's composed sub-query stages) | `composed-narrow-phase-stage` | checkpoint `label` | one composed-query between-stage boundary |
| `collision/viewer/ViewerModelAdapter.js` (`extractFragments`, before a requested dbId's own fragments) | `extraction-node-visit` | checkpoint `label` | one node visit, before enumerating its own fragments |
| `collision/viewer/ViewerModelAdapter.js` (`extractFragments`, after pushing a node's children) | `extraction-node-descend` | checkpoint `label` | one node's children pushed, before continuing the walk |
| `collision/geometry/GeometryRegistry.js` (`_runPhase`, shared by all three phases) | `weld` / `connectivity` / `bvh-construction` | direct `reportSpan` bracket around `builderFn()` | one geometry-build phase, measured by its OWN local timer (see below -- NOT via the checkpoint's `label`) |
| `collision/CollisionWorld.js` (`findClashes`, around `admitCollisionInstances`) | `capacity-admission-commit` | direct `reportSpan` bracket | the capacity-admission recompute-and-commit, which has no checkpoint call to hook (100% synchronous, zero awaits) |

The "Mechanism" column matters: `weld`/`connectivity`/`bvh-construction`/`capacity-admission-commit`
are reported via a direct `performance.now()` bracket + `reportSpan(label, ms)` call, entirely
independent of the checkpoint port's own `lastSpanAt` baseline -- everything else in this table is
reported by passing `label` into a `checkpoint({ ..., label })` call, whose span is "time since that
SAME port's own previous checkpoint call." See "`weld`/`connectivity`/`bvh-construction` are
measured with a direct, per-build-local bracket" below for why the geometry-phase labels specifically
needed the former, not the latter.

Criteria 1, 3, 6, and 8's "longest uninterrupted span" / "per-phase cost" numbers are therefore
answered by filtering one flat span log (`recorder.longestSpan()` / `recorder.spansByLabel(label)`
after wiring `setSpanRecorder(recorder.asSpanRecorder())` and running a real query/build) -- not by
separate bespoke probe functions.

### Why the manual `performance.now()` bracketing path, not the Long Tasks API

Criterion 1 requires detecting any synchronous span above 24.8ms. In a real Chromium build, the
Long Tasks `PerformanceObserver` API IS available -- but it only reports tasks at or above roughly
**50ms**, which is *above* the 24.8ms bound this criterion enforces. Relying on it as the primary
signal would let a genuine 30-40ms violation pass completely unrecorded. `CheckpointRecorder`
therefore records every manual span **unconditionally**, never gated on whether a Long Tasks
observer also happens to be present -- gating on that would silently disable the very bracketing
this criterion depends on in the default, common case of a real Chromium browser. A Long Tasks
entry, when one does fire (source: `'longtask'`, label `'(unattributed longtask)'`), is recorded as
an unattributed cross-check signal only: a genuine entry there, above ~50ms, is itself a
criterion-1 finding regardless of which manual span it happened to overlap, but its *absence* is
never evidence that criterion 1 passed.

## Criterion-by-criterion answer mechanism

1. No single synchronous task exceeds 24.8ms, cold and warm -- `recorder.longestSpan()` after
   Task 24 wires `setSpanRecorder` and runs the real cold/warm queries. Not a probe function.
2. Any tripped budget carries the correct diagnostic, never a freeze/fabricated clash -- inspect
   `ClashResult.statistics.diagnostics` from Task 24's real run. Not a probe function.
3. Per-candidate/per-build costs next to `measure.mjs`'s synthetic figures -- `statistics.narrowPhaseMs
   / narrowPhasePairs` (per-candidate) alongside `measure-geometry-phases.mjs`'s own per-phase
   figures (per-build); a reporting/comparison step in Task 24's disposition document.
4. Worst-case cost of one `classifyPoint` / `properCrossingQuery` / `surfaceCrossingWitness` call --
   `window.__perfProbes.probeCosts(model, sampleDbId, modules)` (`modules` must include the real,
   modern `three` package as `THREE` -- see "Two THREE namespaces" below).
5. Weld/connectivity/BVH individually at `maxSyncTriangleCount` -- `measure-geometry-phases.mjs`.
6. Largest-dbId extraction cost + AABB-test overhead -- `window.__perfProbes.
   extractionCostAndAabbOverhead(model, THREE, extractFragments)` (`THREE` the real, modern `three`
   package -- see "Two THREE namespaces" below; `extractFragments` the real
   `collision/viewer/ViewerModelAdapter.js` export, imported by the caller the same way
   `probeCosts` above receives its own real `collision/` module references -- fixed in the
   Batch-5 final review, finding I-3: an earlier version of this probe never called
   `extractFragments` at all, making its number a byte-identical duplicate of criterion 9's own
   tree-enumeration walk); the broad-phase scan's own total cost and longest inter-yield span
   come from `recorder.spansByLabel('broad-phase-scan')` after a real `findClashes` run, same
   mechanism as criterion 1.
7. One `enumNodeChildren` call at the fanout ceiling -- `window.__perfProbes.
   widestNodeFanout(model, maxChildrenPerNode)`.
8. Capacity-admission recompute-and-commit, separate from precheck --
   `recorder.spansByLabel('capacity-admission-commit')`, plus `window.__perfProbes.
   capacityPrecheckRejects(world, overCapacityQuery)` for the precheck-rejects-before-mutation half.
9. One `enumNodeFragments` call on the densest-fragment node -- `window.__perfProbes.
   widestFragmentOwner(model, maxFragmentsPerDbId)`.
10. Epoch registry sweep, from `evictModel` and from `dispose()` -- `window.__perfProbes.
    epochSweepCost(world, model, { viaDispose })`.
11. `ViewerGeometryAdapter` normalization at the most-fragmented geometry -- `window.__perfProbes.
    mostFragmentedGeometryNormalization(model, { adaptViewerGeometry })`.
12. `CollisionInstance` identity-cache retained size after a realistic session -- `window.
    __perfProbes.identityCacheRetainedSize(world, epoch)`.

Criteria 6/7/8/9/10/11/12's probe functions each return either `{ exercised: true, ...numbers }` or
`{ exercised: false, reason: '...' }` -- the latter whenever the loaded model/library interface
can't exercise the risk at scale, or a needed diagnostic accessor doesn't exist. This is a valid,
required finding per the spec's own instruction (`docs/...:4744-4795`), never silently substituted
with a synthetic number presented as equivalent.

### Known gaps this task deliberately does NOT close

`CollisionWorld` exposed **no** `getEpochCollisionInstanceCount(epoch)` (or equivalent) diagnostic
accessor as of this task (Task 23) -- confirmed absent from the method list at the time, and the
expected gap the brief anticipated. **Task 24 has since added it** (`collision/CollisionWorld.js`),
the same class of small, explicitly-scoped addition as `scheduler.js`'s `setSpanRecorder`, so
`identityCacheRetainedSize` now exercises it directly rather than failing closed (see the disposition
document's criterion-12 row for the real, measured number this unlocked). `capacityPrecheckRejects`
is unaffected -- it remains unwired into `run-gate.mjs` (M-3, a separate, still-open finding, not
this gap) and its own `{ exercised: false, ... }` fail-closed guard is left in place regardless of
the accessor's availability, since nothing calls it with a real over-capacity query today.

Similarly, there is no `ViewerModelAdapter.getRangeCount(model, fragId)` accessor --
`mostFragmentedGeometryNormalization` derives an equivalent range count itself, by running the real
`adaptViewerGeometry` over each fragment's raw render-proxy geometry and reading back its `ranges`
field, rather than assuming a helper that does not exist. At MEP scale this means one full
synchronous walk of every fragment in the model before the timed span even starts (`adaptViewerGeometry`
is called once per fragment to find the widest one) -- expect this to take noticeably longer than
the probe's own reported `ms` on a large real model; Task 24 should not be surprised by that.

A cancelled/aborted `GeometryRegistry` build (its cancellation signal wins the `Promise.race` in
`_runPhase` -- e.g. the owning epoch is evicted mid-build) can still report a labeled span for
whichever phase was in flight: the `try`/`finally` bracket around `builderFn()` reports the span
once that abandoned async work eventually settles, regardless of whether the settlement is ever
actually consumed by anything. This is pre-existing behavior of the cancellation model this task's
fix built on top of (the race/cleanup semantics were not changed here), and is arguably correct --
real CPU time was genuinely spent on that phase's work even though the result was discarded -- but
Task 24 should be aware a span can appear in the log for a build whose own result was thrown away,
not only for builds that completed and were actually used.

### Two THREE namespaces -- do not conflate them

A live Viewer page always has TWO different `three` instances loaded: `window.THREE` is the
Viewer's own bundled r71 global (predates modern APIs like `Matrix4.invert()`/`Box3.intersectsBox()`
-- r71's equivalent is `.getInverse()`), and the page's own import map resolves plain `import
'three'` to this repo's pinned r185 (the same instance every `collision/` module itself imports).
`extractFragments`'s own contract requires a genuine Viewer-side scratch object for its
`getWorldMatrix`/`getWorldBounds` out-parameters, so `window.THREE` is used there and ONLY there.
Everywhere else a probe does its own THREE math (constructing an identity matrix for
`properCrossingQuery`/`surfaceCrossingWitness`, or a `Box3`/`Vector3` pair for the AABB-overhead
timing), it must be handed the real r185 `THREE` (via dynamic `import('three')` inside
`page.evaluate`, exactly like `test/acceptance/room-locator.acceptance.mjs`'s own Tier 2 does) --
`probeCosts(model, sampleDbId, modules)` takes this as `modules.THREE`, and
`extractionCostAndAabbOverhead(model, THREE, extractFragments)` takes it as its own second positional argument.

### `weld`/`connectivity`/`bvh-construction` are measured with a direct, per-build-local bracket
### -- NOT through the shared checkpoint port (fixed after a codex-advisor finding)

An earlier draft of this task threaded `label` through `GeometryRegistry._runPhase`'s own
`checkpointPort.checkpoint({ loadEpoch, label })` call, the same mechanism `narrow-phase-pair`/
`broad-phase-scan`/`extraction-node-visit`/`extraction-node-descend` use. A codex-advisor review
caught two real problems with that, both confirmed against the actual call sequence:

1. **Off-by-one attribution.** The checkpoint call in `_runPhase` fires BEFORE `builderFn()` ever
   runs, so a span reported there measures whatever happened SINCE THE PREVIOUS checkpoint call --
   the PRECEDING phase's own work (or, for the very first phase, idle time since world/port
   construction) -- never the phase named in its own label. Concretely: the `'weld'` checkpoint
   would report pre-build idle time, `'connectivity'` would silently receive WELD's actual
   duration, and `'bvh-construction'` would receive CONNECTIVITY's -- while BVH's own duration
   would never be reported at all (nothing calls checkpoint again afterward within one build).
   This is a fundamentally different failure mode than the loop-based labels above: those recur
   with the SAME label every iteration, so "off by one call" doesn't mislabel anything (see the
   "tails" section above for their own, narrower caveat); `_runPhase`'s three call sites each use
   a DIFFERENT label exactly once per build, so the off-by-one directly swaps each phase's number
   onto the WRONG label.
2. **Shared-port cross-attribution could hide a violation, not just inflate one.** `CollisionWorld.
   fromViewer` constructs ONE `checkpointPort` for the whole `GeometryRegistry` instance, shared
   across every geometry build for the life of that world (unlike the per-`findClashes`-call port
   `narrow-phase-pair`/`broad-phase-scan` spans come from). If two geometry builds are ever in
   flight concurrently, one build's checkpoint call resets the OTHER build's `lastSpanAt` baseline
   too -- a realistic sequence (build A yields, build B's own checkpoint resets the shared baseline
   before A's resumed synchronous work is ever measured against it) can make a genuine 40ms
   violation in build A disappear from the log entirely, not merely get inflated. An earlier draft
   of this README claimed cross-attribution "can only over-report, never hide a violation" -- that
   claim was wrong, per the advisor's concrete counter-example, and has been corrected here.

**The fix**: `_runPhase`'s checkpoint call is now unlabeled (its original liveness/yield purpose is
unchanged), and each phase's own `builderFn()` call is bracketed directly with a LOCAL
`performance.now()` timer (in a `try`/`finally`, so a phase that runs long and then throws is still
recorded, not silently discarded), reported via the exported `reportSpan(label, ms)` helper. This
is per-call-local, not shared through any port's baseline -- concurrent builds cannot cross-attribute
onto each other for these three labels, and each label now genuinely measures the phase it names.
See `test/scheduler/spanRecorder.test.mjs`'s dedicated regression test (widely-separated synthetic
phase durations, asserting each label stays close to its own target and far from the others') for
the automated proof, and `collision/geometry/GeometryRegistry.js`'s own `_runPhase` comment for the
full before/after reasoning. Criterion 5's real per-phase numbers still come from
`measure-geometry-phases.mjs`, which measures one isolated build directly via `CheckpointRecorder.
around()` and was never subject to either problem above.

### A SECOND cross-port hazard, in the opposite direction: `narrow-phase-pair` can silently absorb
### `GeometryRegistry`'s own yielded (not synchronous) wall-clock time

The codex-advisor-caught bug above was about `GeometryRegistry`'s three phase labels being wrongly
measured through a shared port. There is a mirror-image hazard the fix does NOT touch, found during
this task's own follow-up review: `_runNarrowPhasePair` (`CollisionWorld.js`) `await`s
`this._registry.getOrBuildGeometry(...)` BETWEEN two `narrow-phase-pair` checkpoint calls -- and
`GeometryRegistry`'s own `checkpointPort` (constructed once in `CollisionWorld.fromViewer`, around
lines 295-304) is a SEPARATE, world-scoped port instance from the per-`findClashes`-call port
`narrow-phase-pair`'s own `lastSpanAt` baseline belongs to. This measured task's own weld/
connectivity/bvh-construction figures (7-20ms per phase, see "Running the sanity checks" below)
already exceed `frameBudgetMs` (8ms), so a live query realistically DOES take a real yield through
the registry's own port while building a not-yet-cached geometry mid-narrow-phase.

That yield is a genuine pause -- real wall-clock time spent NOT running this library's own code,
waiting on `yieldToScheduler` (a macrotask turn) -- but the per-call port has no way to know it
happened: its own `lastSpanAt` was set at the PREVIOUS `narrow-phase-pair` checkpoint and is not
touched again until the NEXT one, so the entire elapsed duration -- genuine synchronous narrow-phase
work PLUS the registry's own yielded pause, indistinguishable from each other in this measurement
-- gets reported as one `narrow-phase-pair` span. This can make a perfectly well-behaved query (one
that yielded correctly, just via a DIFFERENT port) look like a criterion-1 violation under
`recorder.longestSpan('narrow-phase-pair')`, which is exactly the metric Task 24 reads for that
criterion. Unlike the `GeometryRegistry` bug above (which could hide a real violation), this hazard
runs the other way: it can manufacture a FALSE POSITIVE.

**Mitigation available today, no new code needed**: `CollisionWorld.findClashes`'s own return value
already carries `statistics.broadPhaseMs`/`narrowPhaseMs`/`totalMs` -- real wall-clock durations for
each stage, computed independently of the labeled-span mechanism (Task 19). If a `narrow-phase-pair`
span looks suspiciously long, cross-check it against `statistics.narrowPhaseMs` for that same call:
a genuine synchronous violation should show up as an outlier RELATIVE TO the narrow phase's own
total elapsed time and pair count, whereas a registry-yield artifact will correlate with however
long that specific pair's geometry build actually took (itself independently knowable from
`measure-geometry-phases.mjs`'s per-phase figures, or from `GeometryRegistry`'s own now-fixed
`weld`/`connectivity`/`bvh-construction` spans in the SAME log). Task 24 should read a `narrow-phase-
pair` outlier as "investigate," not "confirmed violation," until cross-checked this way.

### Loop-based labels' own narrower caveat: the last iteration's tail may go unflushed --
### and this gap is invisible to BOTH detection mechanisms this harness has

`narrow-phase-pair`/`broad-phase-scan`/`extraction-node-visit`/`extraction-node-descend`/
`composed-narrow-phase-stage` are each called at the TOP of a loop iteration (or composed-stage
step), before that iteration's own body runs, with the SAME label reused every time. This means
iteration N's checkpoint call correctly reports iteration N-1's own body duration under that
recurring label -- but the very LAST iteration's body, after the final checkpoint call, has no
following checkpoint call (of the same or any label) to flush it, so it may go unrecorded, or get
folded into whatever DIFFERENT checkpoint fires next elsewhere in the call (e.g. broad phase's
final pair's cost could be silently absorbed into `narrow-phase-pair`'s first span instead of
`broad-phase-scan`'s).

This is more consequential than "one iteration's cost might be misattributed": **a genuine
24.8-49ms criterion-1 violation landing on a loop's LAST iteration is invisible to BOTH of this
harness's detection mechanisms at once.** The manual span log has nothing to flush it, per the
above. The Long Tasks API cross-check (see "Why the manual `performance.now()` bracketing path"
above) only fires at or above roughly 50ms -- so a violation in the 24.8-49ms range sitting
specifically on an unflushed last iteration would clear NEITHER bar and simply not appear anywhere
in the recorded evidence, not even as an "unattributed longtask" entry. This is a real, bounded gap
(at most one iteration's cost per loop, per call) -- documented here rather than fixed by adding an
explicit final-flush bracket to each hot loop, which this task judged out of scope given the added
complexity/regression-risk to `CollisionWorld`'s narrow/broad-phase loops for a single-iteration
worst case. The same aggregate `statistics.broadPhaseMs`/`narrowPhaseMs`/`totalMs` cross-check
described above is a partial mitigation here too: dividing a stage's aggregate wall-clock time by
its own pair/iteration count gives an AVERAGE that a single unflushed 40ms outlier would still skew
upward, even though no individual span names it -- not a substitute for a real per-span reading, but
a signal that something in that stage is worth a closer look. Task 24 should be aware that a
criterion-1 violation landing exactly on a loop's last iteration could be missed entirely by this
mechanism, not merely misattributed.

The unlabeled `checkpoint()` call inside `createComposedStageScheduler` (used by ContainmentModeQuery/
VolumeOverlapQuery's own composed sub-query stages) has ALSO been given a label
(`'composed-narrow-phase-stage'`) as part of this fix round -- an earlier draft left it unlabeled,
which meant the real synchronous work a composed sub-query does BETWEEN its own internal stages
was silently discarded from the span log entirely (an unlabeled checkpoint call still resets the
shared per-call port's `lastSpanAt` baseline, so that work vanished without ever being reported
under any label). It is now subject to the same "last iteration's tail" caveat as the other
loop-based labels above, but is no longer silently dropped altogether.

## Running the sanity checks

```bash
node test/performance/measure-geometry-phases.mjs
```

Expect three distinct, non-zero ms figures at an exactly-asserted 12,000-triangle fixture -- not a
pass/fail against the 24.8ms line (Task 24's job, against the real MEP-scale model). Confirmed
output from a real run on this machine:

```
=== GeometryRecord phase costs at maxSyncTriangleCount (criterion 5) ===
  Ceiling under test: maxSyncTriangleCount = 12000

  Fixture triangle count: 12000 (exact ceiling, asserted)

  weld                 13.88ms  (triangleCount=12000)
  connectivity          7.52ms  (componentCount=1)
  bvh-construction     12.60ms
```

For `browser-probes.mjs`: sanity-run it against the small acceptance model from Task 22
(`test/acceptance/room-locator.acceptance.mjs`'s URN, already known-good) via a throwaway
Playwright script that injects the file via `page.addScriptTag({ path })`, imports the real
`collision/` modules with dynamic `import()` inside `page.evaluate` (both `window.THREE` for
`extractFragments` and the real r185 `THREE` for everything else -- see "Two THREE namespaces"
above), and calls each probe once, asserting only "it ran and returned an object with either
`exercised: true` and a plausible number, or `exercised: false` and a `reason` string" -- never
that the numbers pass any ceiling.

Real run performed for this task, against the Task 22 acceptance model (server already running on
port 8080 -- no server of this task's own was started or needed to be torn down). The console
logged two proxy warnings during page load (`407 Proxy Authentication Required` /
`net::ERR_TUNNEL_CONNECTION_FAILED` -- this sandbox's outer network egress requires a proxy that
one particular resource request didn't pick up), but `model.isLoadDone()` still went true and every
probe below ran to completion. Because of that partial-load warning, treat any `exercised: false`
result below as possibly an artifact of this one sandbox run's partial load, not necessarily a
property of the acceptance model itself -- re-verify on a clean run if it matters:

```
probeCosts: {"exercised":true,"classifyMs":0.30,"crossingMs":1.60,"witnessMs":0.90}
extractionCostAndAabbOverhead: {"exercised":true,"widestDbId":4069,"fragmentCount":17,"extractionMs":0,"perfNowCostMicros":0.071,"aabbTestCostMicros":0.005}
widestNodeFanout: {"exercised":false,"reason":"widest node (dbId 2580) has only 43 children, ceiling is 10000"}
widestFragmentOwner: {"exercised":true,"dbId":4069,"fragmentCount":17,"ms":0,"fractionOfCeiling":0.0034}
mostFragmentedGeometryNormalization: {"exercised":false,"reason":"most-fragmented geometry found has only 1 ranges, too flat to exercise O(ranges) scaling"}
epochSweepCost (evictModel): {"exercised":true,"ms":0.10,"mode":"evictModel"}
epochSweepCost (dispose): {"exercised":true,"ms":0,"mode":"dispose"}
identityCacheRetainedSize: {"exercised":false,"reason":"CollisionWorld exposes no diagnostic accessor..."}
capacityPrecheckRejects: {"exercised":false,"reason":"CollisionWorld exposes no diagnostic accessor..."}
```

Every probe returned a valid shape (`exercised: true` with plausible numbers, or `exercised: false`
with a `reason` string) -- `widestNodeFanout`/`mostFragmentedGeometryNormalization`/
`identityCacheRetainedSize`/`capacityPrecheckRejects` coming back `exercised: false` is EXPECTED and
correct here: this small acceptance model is nowhere near `maxChildrenPerNode`/has no
heavily-multi-range geometry, and the two accessor-dependent probes hit the confirmed-absent
`getEpochCollisionInstanceCount` gap documented above. `probeCosts` returning `exercised: false` on
a different `sampleDbId` would mean "pick a different dbId with a live render proxy," not "criterion
4 is unanswerable" -- criterion 4 is not on the spec's fail-closed list the way 6/7/8/9/10/11/12 are.

None of the above is a pass/fail against the real 24.8ms/etc. ceilings -- only confirmation the
harness itself runs correctly against a real live Viewer and produces a well-shaped answer for
every one of the twelve criteria.

## Confirming `setSpanRecorder` actually labels every real checkpoint call site

`measure-geometry-phases.mjs` above exercises weld/connectivity/BVH costs directly via
`rec.around(...)`, never through `collision/scheduler.js`'s `setSpanRecorder` hook -- so it does
NOT by itself prove the hook or its labels are wired correctly. That is confirmed by a committed
test, `test/scheduler/spanRecorder.test.mjs` (run automatically by `npm test`): it unit-tests
`createCheckpointPort`'s label-bracketing math directly (fast path vs. the real-yield path, and
that an unset/unlabeled call stays a true no-op), then constructs a real `CollisionWorld` against
the same fake-model scaffolding `test/CollisionWorld.findClashes.test.mjs` uses, wires
`setSpanRecorder`, runs one real `findClashes` call, and asserts the resulting label set includes
every one of `extraction-node-visit`, `extraction-node-descend`, `broad-phase-scan`,
`narrow-phase-pair`, `capacity-admission-commit`, `weld`, `connectivity`, and `bvh-construction`,
then confirms `clearSpanRecorder()` actually stops further recording. A further dedicated test
constructs a bare `GeometryRegistry` with synthetic, widely-separated (~20ms / ~2ms / ~1ms)
`buildWeld`/`buildConnectivity`/`buildAcceleration` durations and asserts each of the three
resulting spans stays close to its OWN target and far from the others' -- the regression guard for
the off-by-one phase-mislabeling bug described above.

## For Task 24

Load `browser-probes.mjs` into a real page the same way the sanity check above does
(`page.addScriptTag({ path: 'test/performance/browser-probes.mjs' })`), wire `setSpanRecorder` from
`/collision/scheduler.js` before running the real cold/warm queries against the MEP-scale model,
and drive each `window.__perfProbes` function once the model/world/query objects it needs are
available. This harness supplies the measurement; Task 24 supplies the MEP-scale model, drives the
real runs, and applies the 24.8ms/etc. pass/fail lines against what gets recorded.
