# Changelog

## v0.3.0 — Collision Library Milestone 3: Soft Clash / Clearance (recommended tag, not yet created)

Adds near-miss ("Soft Clash") detection to the Viewer-side collision-detection library
(`collision/`) — a fourth query mode, `mode: 'clearance'`, that reports the minimum surface-to-surface
distance between two elements that come within a caller-supplied world-unit threshold **without**
overlapping — plus a second, fully independent "Find Soft Clashes" context-menu action in the
existing reference sample, `wwwroot/extensions/ClashFinderExtension.js`. See `collision/README.md`'s
"M3: Soft Clash / Clearance" and "Reference sample: Find Soft Clashes" sections for full usage docs,
and `docs/superpowers/specs/2026-09-07-collision-library-milestone3-clearance-design.md` for the full
design.

### Capabilities

- `mode: 'clearance'` — a fourth query mode alongside `surface-intersection`/`containment`/
  `volume-overlap`, with a new **required** `query.clearance` parameter (finite, `> 0`, world units).
  A missing/invalid `clearance` on a clearance call, or a `clearance` supplied with any other mode,
  is rejected loudly at entry validation before any lease/epoch is consumed — never silently
  converted into an empty result. The library itself defines **no** default clearance;
  `DEFAULT_CLEARANCE = 0.05` is a Viewer-extension-layer default in `ClashFinderExtension.js`.
- **The contract is a three-way partition, not just a distance filter:**
  `NOT volume-overlap(A,B) AND distance > toleranceFloor AND distance <= clearance`. Hard Clash
  exclusion is **semantic**, not numeric — a dbId pair with any contributing fragment pair that is a
  real `volume-overlap` is excluded outright, via a **tri-state** precheck (`excluded` / `proceed` /
  `inconclusive`, plus a `skip-precheck` fast path for provably disjoint AABBs) that reads
  `volumeOverlapQuery`'s own authoritative `conclusive` field. The tri-state never collapses to a
  boolean: an inconclusive precheck drops the pair **with a diagnostic** rather than assuming
  "no overlap." Without this, a fully-enclosed component whose surfaces sit far from its container's
  would be misreported as a near miss.
- **A new `ClashPair` shape for clearance pairs**, additive and distinct from M2.1's Hard Clash
  witness: `{ …, type: 'clearance', distance: number, clearance: number, witness: { sourcePoint:
  [x,y,z], targetPoint: [x,y,z] } }`. **Two** points and no `kind`, versus `volume-overlap`'s single
  `witness.point` plus `kind` — consumers must branch on `pair.type` rather than assume one witness
  shape. `sourcePoint` always lies on the caller's own `source` operand and `targetPoint` on its
  `target`, regardless of which operand the query internally anchors its BVH traversal on.
- **Uniform-scale-only contract, diagnosed rather than approximated.** `validateUniformScale`
  structurally rejects non-finite/projective matrices, a non-finite or exactly-zero determinant
  (checked *before* trusting `Matrix4.decompose()`, which silently reports scale `(1,1,1)` for a
  degenerate matrix), reflected/negative scale, shear, and per-axis scales disagreeing by more than
  `clearanceUniformScaleRelativeTolerance` (`1e-4` relative). Accepted transforms carry a documented,
  bounded relative error of that same order — real, declared approximation, not silent exactness.
- **Tolerance floor in world units:** `surfaceEpsilonFactor × max(source.localDiagonal ×
  source.scaleFactor, target.localDiagonal × target.scaleFactor)` — each operand's local-frame
  diagonal converted through its own validated scale factor *before* the `max()`, so the floor is
  comparable to the world-space distance it gates.
- **Both broad phases supported.** `broadPhase: 'tlas' | 'linear'` with the same shape-dependent
  default the pre-existing modes use, proven to produce identical pairs and bit-identical distances.
  TLAS inflates each source instance's AABB by `clearance` on every axis; the exact per-candidate
  predicate is `aabbMinDistance(...) <= clearance` rather than AABB overlap.
- **7 new statistics fields** (`clearanceExpandedCandidatePairs`, `clearanceExactAabbSurvivors`,
  `clearanceOverlapPrechecksRun`, `clearanceHardClashExclusions`, `clearanceDistanceQueriesRun`,
  `clearanceHits`, `clearanceQueryMs`), always present and defaulting to `0`, with a definitive
  increment-point table in `collision/README.md`. Plus a new
  `reportSpan('clearance-distance-query', ms)` production span, which is what the M3 performance gate
  measures — no gate-side re-timing.
- **4 new diagnostic reasons:** `clearance-invalid-transform` and
  `clearance-anisotropic-scale-unsupported` (both **fragment**-scoped, deduped per
  `(epoch, fragmentId)` in independent namespaces), `clearance-hard-clash-precheck-inconclusive` and
  `clearance-distance-unavailable` (both **pair**-scoped). One caveat on that scope table:
  `clearance-anisotropic-scale-unsupported` is fragment-scoped on the ordinary
  `validateUniformScale`-rejection path, but is emitted **pair**-scoped (undeduped) in the extremely
  rare case where `clearanceQuery`'s own anchor-inverse guard aborts — an operand whose uniform scale
  `validateUniformScale` *accepts* yet is small enough that `Matrix4.invert()` overflows to `Infinity`
  (a subnormal but nonzero determinant, i.e. a uniform scale strictly between `≈1.36e-108` and
  `≈1.772e-103`). Plus a new
  `CapacityExceededError('clearance-narrow-phase-budget')` bounded by `maxClearanceNarrowPhasePairs`
  (20,000, provisional), checked as one upfront preflight on the assembled candidate list.
- **"Find Soft Clashes"** — a second, independent context-menu action in `ClashFinderExtension`, not a
  mode toggle on the existing one: its own action token (`_latestSoftClashActionToken`, so the two
  clash actions can never cancel each other), its own overlay scene
  (`SOFT_CLASH_OVERLAY_NAME = 'clash-finder-soft-markers'`) and blue `SOFT_CLASH_COLOR = 0x2b8fff`
  distinct from Hard Clash's orange, and its own visualization: two endpoint spheres plus one
  connecting `THREE.Line` per pair (a clearance result's point is the *gap*). Shared sphere geometry,
  sphere material and line material are reused across every object; only the per-pair line geometry
  is per-object and disposed individually. A zero-pair query leaves **no** trace — the overlay scene
  is never even registered and the shared geometry is never allocated. Isolation is applied as the
  **union** of the two actions' own contributions (so Soft Clash adds to, rather than clobbers, an
  existing Hard Clash isolation), while `fitToView` deliberately frames only what *this* action
  found. Full M2.1 lifecycle discipline applies, with Soft Clash teardown as a new outermost
  `finally` in both `unload()` and the `BEFORE_MODEL_UNLOAD_EVENT` handler.

### Compatibility notes

- Everything M3 adds is **additive**. `mode`'s three existing values, the `target` shapes, `groupBy`,
  `broadPhase`, and every M1/M2/M2.1 statistics and diagnostics field are unchanged. Every existing
  **library**-level test continues to pass unmodified; `test/ClashFinderExtension.test.mjs` (Hard
  Clash's own reference-sample test) was updated for two disclosed, non-regressive reasons:
  `menu.length` now reflects the second, intended "Find Soft Clashes" entry, and three pre-existing
  `MARKER_RADIUS_FRACTION` test constants were corrected to match the real production value (an
  M2.1-era test/production drift, unrelated to M3).
- **One real internal refactor, proven behavior-identical:** clearance's narrow phase resolves
  geometry through `resolveGeometryRecord`/`diagnoseFragmentOnce`, genuinely extracted out of
  `_runNarrowPhasePair`'s own private closures, with `_runNarrowPhasePair` rewritten to call the same
  functions. Clearance did **not** get a second, divergent geometry path. The full existing regression
  suite proves zero observable behavior change for `surface-intersection`/`containment`/
  `volume-overlap`. `volumeOverlapQuery` likewise gained one additive `conclusive: boolean` field
  and no behavior change.
- **The incompleteness partitioning is the OPPOSITE of M2.1's.** `clearance-distance-unavailable` and
  `clearance-hard-clash-precheck-inconclusive` **do** count toward "the result may be incomplete" —
  unlike M2.1's `witness-unavailable` carve-out, which does not. The M2.1 precedent deliberately does
  not transfer: for `volume-overlap` the boolean verdict is already fully determined by the time
  witness capture fails, so only the marker is missing; for `clearance` the **distance itself is the
  verdict**, so an unavailable distance (or an unresolvable Hard-Clash precheck) genuinely means an
  incomplete answer. `witness-unavailable` remains carved out, for Hard Clash pairs, exactly as
  before.
- **Clearance's TLAS broad phase is a deliberate structural twin, not a shared function.**
  `_runClearanceTlasBroadPhase` mirrors `_runTlasBroadPhase` rather than reusing it. The generic
  `tlas*` statistics fields mean exactly the same thing and are populated at the same points in the
  traversal for a clearance call — but by equivalent code, not one shared implementation, and the two
  must be kept in sync by hand. (The M3 design spec's §11 originally overclaimed "identically, by the
  same code"; corrected in this release.)

### Live Viewer acceptance result

`test/acceptance/clash-finder.acceptance.mjs` (Playwright, live Viewer, live 3-discipline federated
model), extended for M3: **PASS for everything M3 added.** Verified against the same real coordinated
building as M2 — Architecture host (`Audubon_Architecture_clash_test.rvt`, 5,435 fragments) plus
Structure (543 fragments) and Mechanical (1,496 fragments) links, ~7,474 total fragments. The script
now runs **257 checks**, up from 106 — **136 new check instances (121 uniquely-named), every one
passing**. Every remaining failure is **pre-existing and environment-specific** (see Known limitations
below): none is new, none changed PASS/FAIL status, and none is related to clash detection, verified
mechanically check-name by check-name against a baseline run of the unmodified script on the same
machine. Measured tallies: **251/257 with 6 such failures** on the implementer's environment (the same
6 that fail at the base commit), and **252/257 with 5** on the coordinator's independent re-runs — the
count varies by one because one of the six (a whole-run "zero console errors" check, failed by a
sandbox proxy blocking the Viewer's own `cdn.autodesk.io` branding image) depends on the sandbox
rather than on the code. The other five are identical in both.

A **bounded discovery spike** (hard-capped at 7 clearance values × 1 source dbId, with a further
capped 4-neighbour fallback that **never fired**) found a **real near-miss on its second call**:
Structure dbId `3965` — the same column that is Hard Clash's known diagnostic-free negative — sits
**0.04166616 world units** from Structure dbIds `3976` and `4135`, two HSS members that stop just
short of it. That measurement is independently corroborated against the `InstanceTree`'s own node
boxes (`0.041667938`, agreeing to Float32 quantization) using no part of the collision pipeline. The
positive branch therefore ran against real, unforced geometry; nothing was synthesized.

Three cases, all through the **real "Find Soft Clashes" menu action**:

1. **Known negative** — dbId `3965` at clearance `0.02`, less than half the measured gap: **0 pairs**,
   correctly negative, `clearanceHardClashExclusions === 0` (a genuine distance verdict, not an
   exclusion), and Hard Clash's own 2 markers, overlay scene and isolation all survive untouched.
   Non-vacuity is proven by pairing, not assertion: the same source through the same action finds
   exactly 2 pairs at `0.05`.
2. **A Hard Clash is never in a clearance result** — dbId `2734` at clearance `5`: **33 real
   clearance pairs** found, with the known Hard-Clash crossing target (Architecture `3686`) and
   containment target (Structure `3663`) both **provably absent**. Proven three ways rather than by
   absence alone: target scope is captured and asserted (so a regression that stopped querying the
   Architecture model couldn't pass vacuously); `clearanceHardClashExclusions` measured at **2**, a
   counter only the proven-overlap branch can increment; and a **target-specific companion query**
   scoped to Architecture `3686` alone, which returned `clearanceOverlapPrechecksRun: 2,
   clearanceHardClashExclusions: 1, clearanceDistanceQueriesRun: 0` — the pair never reached a
   distance query at all, so its absence cannot be attributed to the distance path even in principle.
   Genuine mechanism-specific proof, not aggregate inference.
3. **The discovered near-miss, positive** — dbId `3965` at the production **default** clearance
   (`0.05`, **no override of any kind**): the same 2 pairs, each pair's reported distance equal to
   the separation of its own two witness points, exactly 2 endpoint spheres + 1 connecting line per
   pair all confirmed present in the overlay via the public `viewer.overlays.hasMesh`, both overlay
   scenes coexisting with Hard Clash's markers still on screen, isolation applied as the real union
   `[2734, 3663, 3965, 3976, 4135]` while `fitToView` framed only `[3965, 3976, 4135]`. Alignment was
   then exercised for real (`viewer.impl.setPlacementTransform` + `invalidateModelPlacement`, +3 on
   X): the same pair set resolves, every distance is unchanged, and **both** witness points of every
   pair translate by exactly `(+3, 0, 0)` (asserted at `1e-6`; live max residual `2.8e-14`), with
   restore returning every point to its original world position. Model unload clears Soft Clash's
   overlay objects while leaving the scene registered — the same split Hard Clash documents.

The full unit suite is unaffected: 653 pass / 1 pre-existing unrelated fail / 1 pre-existing todo.

### Performance-gate result

`test/performance/run-gate-m3.mjs`, run against the same real 3-discipline federated fixture, driving
one single-fragment source (Structure dbId `3076`, `Floor [401326]`) at the production default
clearance `0.05`, in four measured runs (`tlas` cold/warm on a shared world, `linear` cold/warm on a
genuinely fresh one), with a sacrificial unmeasured warm-up whose spans cannot leak into the verdict.
Overall disposition **MEASURED**, exit code 0.

- **Single-call frame-budget disposition: GO — but on a thin margin, not a comfortable one.** Worst
  individual `clearanceQuery` span measured **6.10–6.50 ms** (varying slightly per run) against
  `frameBudgetMs = 8` — roughly **20–24% headroom**, i.e. 76–81% of budget consumed by the single
  hardest geometry pair. **Zero of ~500–520 real production spans exceeded the budget** (p50 0.20 ms,
  p95 2.0 ms, p99 ~4.8 ms), so the *distribution* is very healthy; the thin figure is one hard pair,
  not a systemic problem. Independently measured across 4 total live runs (2 by the implementer, 2 by
  the coordinator), consistently in that range. Spans come from the real production
  `reportSpan('clearance-distance-query', …)` instrumentation, and the gate asserts
  `clearanceDistanceQueriesRun === capturedSpanCount` on every run, so the population is provably
  exactly the set of calls the library itself counted. This is a **reported** finding, not an
  enforced cap — nothing in the library aborts a long-running distance query.
- **Candidate reduction: a genuine 3.78x.** TLAS examined **1,978** clearance candidates where linear
  examined **7,473** (`broadPhasePairs`) — bit-identical on every run, and the order-independent,
  reliably reproducible TLAS-vs-linear result. Linear's 7,473 is exactly `totalFragments − 1`, i.e.
  the full Cartesian product, as expected. Measured at `sourceFragmentCount = 1`, so it is a **lower
  bound** for a multi-instance selection.
- **End-to-end wall-clock: not reliably observed, exactly as in M2.** The gate's elapsed-time verdicts
  did **not** reproduce run to run (one run `OBSERVED`, two `NOT_OBSERVED`, with TLAS marginally
  *slower* in both of the latter). The honest statement is that end-to-end wall-clock differences
  between the two broad phases on this fixture are within run-to-run noise with no reproducible sign
  — unsurprising, since broad phase is only ~0.1–0.2% of total call time and narrow phase dominates
  both paths equally. Cite the candidate-count reduction, not the elapsed-time verdicts.
- **`clearanceQuery` is not the dominant cost — the Hard-Clash precheck is.** Of 1,978 candidates,
  **1,913 (96.7%)** reach the precheck while only **130 (6.6%)** ever reach an actual distance query.
  `clearanceQueryMs / totalMs` is **2.9% cold and 11.1% warm**, so roughly **89% of warm narrow-phase
  time** is geometry resolution plus the precheck. Any future clearance-performance work should target
  the precheck, not `ClearanceQuery`.
- **`maxClearanceNarrowPhasePairs` headroom (evidence only, nothing retuned):** the provisional 20,000
  was **9.89% used** (1,978 candidates) by a single source instance against the whole federated scene.
  **No constant in `collision/` was changed by this milestone's gate** — it implements the
  measurement, not the revision.
- **New, previously unquantified finding: ~24% of Hard-Clash prechecks return `inconclusive`**
  (464–465 of 1,913) rather than a definitive proven/disproven overlap, so about a quarter of the
  near-contact candidates on this fixture produce neither a Hard-Clash exclusion nor a clearance
  result. That is spec-sanctioned fail-safe behavior, correctly surfaced through the incompleteness
  caveat and not a defect — but the volume is worth flagging as a candidate for future investigation.
  Only one of those was timing-flaky between runs; the rest were structurally inconclusive.
- The gate also cross-checks correctness, and a correctness violation now **fails** the run
  (`disposition: 'FAILED_VALIDATION'`, exit 1) — proven live by fault injection, not just by reading
  the wiring. All four runs' pair signature sets agree, per-pair distances agree bit-identically
  across broad phases (`maxAbsoluteDelta = 0`), and the witness shape `{sourcePoint, targetPoint}` is
  confirmed on every pair of every run. The performance verdict is deliberately decoupled from that
  failure path in both directions: a passing GO cannot rescue a correctness violation, and a NO-GO
  would not fail the process.

### Known limitations

See `collision/README.md`'s "Known M3 limitations" section — in summary: uniform positive scale only
(anisotropic/sheared/reflected transforms are diagnosed unsupported, never approximated, with a
documented `1e-4` relative error bound even within the supported class); a narrow, deliberate dead
band around `toleranceFloor` that **no** mode reports; `maxClearanceNarrowPhasePairs` bounds candidate
*count* but nothing bounds a single `clearanceQuery` call's own *duration* (the gate's `frameBudgetMs`
disposition is a reported measurement, not an enforced cap); ~24% of near-contact candidates resolving
as `inconclusive`; and the residual circularity in the discovered near-miss's own threshold (found
with the implementation under test, corroborated against `InstanceTree` node boxes but not proven a
global minimum — an independent Viewer-owned world-bounds oracle remains future work).

`DEFAULT_CLEARANCE` (0.05), `maxClearanceNarrowPhasePairs` (20,000), and both `1e-4` tolerances
(`clearanceUniformScaleRelativeTolerance`, `clearanceDistanceCrossCheckRelativeTolerance`) are
explicitly **provisional** — reasoned, measured-for-headroom, and revisable; none is a tuned final
value.

**Disclosed, pre-existing, out of scope** (in the same spirit as v0.2.0's own out-of-scope
disclosures): the live acceptance script's remaining failures are **not** M3 regressions. Five are
headless-renderer marker-colour pixel-band calibration failures in the M2.1 `[enclosed]` Hard Clash
witness tests — the marker renders correctly, and the detach/reattach and `depthTest` differentials
both behave exactly as designed; this environment's compositor simply composites the 0.65-opacity
marker at `r = 150` where the band requires `r >= 200`. Fixing them means retuning a Hard Clash
colour band, outside this milestone. A sixth, seen on one of the two environments, is a whole-run
"zero console errors" check failed by the sandbox's filtering proxy blocking the Viewer's own
`cdn.autodesk.io` branding image (a 407 plus an `ERR_TUNNEL_CONNECTION_FAILED` during bootstrap) —
environmental, nothing to do with clash detection. All of these are confirmed present at the base
commit **before** M3 acceptance work touched anything, unchanged in identity and cause.

## v0.2.1 — Clash Witness Marker (recommended tag, not yet created)

Adds a "where to look" witness point and a Viewer-native marker to every positive `volume-overlap`
Hard Clash pair returned by the Viewer-side collision-detection library (`collision/`), plus the
lifecycle wiring in the reference sample, `wwwroot/extensions/ClashFinderExtension.js`, to render
and clear those markers. See `collision/README.md`'s `findClashes(query)` "Result shape" section and
`docs/superpowers/specs/2026-09-07-collision-library-m2.1-clash-witness-marker-design.md` for the
full design.

### Capabilities

- `ClashPair.witness` — an additive field, present only when `type === 'volume-overlap'`:
  `{ kind: 'surface-crossing' | 'containment', point: [x,y,z] } | null`. `point` is a plain
  `[x,y,z]` array of finite numbers (never a `THREE.Vector3` of either Three.js revision) in Viewer
  scene/render coordinates (see `collision/README.md`'s coordinate-space contract for the precise
  definition). For a complete, correctly-evaluated positive `volume-overlap` verdict a
  non-null witness is the ordinary, expected outcome; `witness: null` is strictly a fault-tolerance
  outcome, paired with a `statistics.diagnostics` entry (`reason: 'witness-unavailable'`) — a clash
  is never suppressed or downgraded because witness capture failed.
- Deterministic fragment-pair → dbId-pair witness aggregation: when multiple fragment-pairs roll
  into one dbId-level pair, the witness is selected by a total order (a valid witness always
  outranks a missing one, then `kind` `surface-crossing` before `containment`, then a canonical-
  placement tie-break) — the same witness is selected regardless of traversal order, and regardless
  of `broadPhase: 'tlas'` vs. `'linear'`.
- Viewer-native marker rendering: `ClashFinderExtension` draws one small sphere `Mesh` per
  witness-bearing `ClashPair`, via `viewer.overlays.addMesh`/`removeMesh` on a dedicated overlay
  scene, with `depthTest: false` so a marker sitting inside occluding geometry (e.g. inside a wall or
  duct) stays visible — the entire point of a "where to look" marker. One shared `SphereGeometry`/
  `MeshBasicMaterial` pair is reused per extension instance, not allocated per marker. Marker radius
  is `clamp(sceneBoundingSphereRadius * radiusFraction, MIN_MARKER_RADIUS, MAX_MARKER_RADIUS)`. All
  overlay-layer Three.js objects are constructed from the Viewer's own `window.THREE` (r71), never
  the collision library's imported `three` (r185), consistent with the existing r71/r185
  runtime-isolation boundary the library already documents.
- Marker lifecycle: markers clear and apply together with dbId isolation at the same call sites (so
  the two visualizations never visually disagree); the extension's `BEFORE_MODEL_UNLOAD_EVENT`
  handler fires on **any** model unload in the Viewer session (not filtered to models actually
  participating in the current result) and unconditionally clears the entire clash visualization —
  isolation and markers, for every model — rather than pruning only state tied to the unloading
  model, since a partial-preservation policy was shown unsound (a surviving model could be left
  isolated with a marker whose witness point no longer has any meaningful relationship to what's
  still on screen); extension `unload()` disposes every tracked marker mesh plus the shared
  geometry/material and the overlay scene, even if the collision world's own
  `dispose()` throws.

### Compatibility notes

- `witness` is a new, additive `ClashPair` key — `source`, `target`, and `type` are unchanged, and
  `containment`/`surface-intersection` pairs are unaffected (no `volume-overlap`-style witness is
  populated for them in M2.1). No M1/M2 public API changed incompatibly.
- The existing "the result may be incomplete" caveat (`collision/README.md`'s "Diagnostics — read
  this before trusting an empty result" section) is now partitioned: a `witness-unavailable`
  diagnostic no longer contributes to that caveat, since it describes a fully complete, correctly-
  evaluated pair that simply couldn't produce a marker. The existing developer-facing `console.warn`
  log remains unpartitioned and still logs every diagnostic, `witness-unavailable` included.

### Live Viewer acceptance result

`test/acceptance/clash-finder.acceptance.mjs` (Playwright, live Viewer, live 3-discipline federated
model — Architecture/Structure/Mechanical, `Audubon_*_clash_test.rvt`), extended for M2.1: **PASS,
106/106 live acceptance checks** (multiple consecutive clean runs). The existing known positive case
(`MIXED_CASE`, Structure dbId `2734`) exercises both witness kinds end-to-end in one selection: its
cross-model pair (Structure → Architecture, dbId `3686`) resolves via `surface-crossing`, and its
same-model pair (Structure → Structure, dbId `3663`) resolves via `containment`. The containment
witness was proven genuinely visible **through occluding geometry** via a 4-part live check: measured
occlusion depth exceeding the marker radius, a marker-colored pixel at the expected screen location,
a detach/reattach color differential, and confirmation that `depthTest: false` is load-bearing by
showing `depthTest: true` reproduces the occluded-away result byte-for-byte. Also verified live:
alignment-driven marker movement (via `viewer.impl.setPlacementTransform` +
`invalidateModelPlacement`), negative-case (`NEGATIVE_CASE`) marker clearing with no new markers
created, full clash-visualization clearing on model unload, and zero console/page errors throughout.
No production constant tuning was needed — Task 8's default `MIN_MARKER_RADIUS`/
`MAX_MARKER_RADIUS`/`MARKER_COLOR` rendered correctly against the real fixture (radius resolved
mid-clamp; marker color visually distinct from the Viewer's own selection highlight). The full unit
suite is unaffected: 553 pass / 0 fail / 1 todo.

### Known limitations

See `collision/README.md`'s "Known M2.1 limitations" section — in summary: one marker per
witness-bearing pair with no density cap on marker count for a source with many clashes; no
click-to-select/tooltip/dashboard interaction on markers (visual only); marker radius is computed
from local (pre-placement) `InstanceTree` bounds while the witness point itself is world-space (a
documented, accepted M2.1 simplification, not a bug).

## v0.2.0 — Collision Library Milestone 2: Federated Clash Finder (recommended tag, not yet created)

Adds cross-model ("federated") clash detection to the Viewer-side collision-detection library
(`collision/`) and a second reference integration sample,
`wwwroot/extensions/ClashFinderExtension.js`. See `collision/README.md`'s "M2:
`broadPhase` and the TLAS-accelerated path" and "Reference sample: Clash Finder" sections for full
usage docs, and `docs/superpowers/specs/2026-09-05-collision-library-milestone2-design.md` for the
full design.

### Capabilities

- `findClashes`'s `target` accepts a new `{ targets: [{model, dbIds?}, ...] }` shape alongside the
  existing legacy `{model, dbIds}` shape — a single call can now query multiple models, including
  the source's own model, in one federated sweep. An omitted `dbIds` on a `targets` entry is a
  whole-model-scope sentinel (query every fragment in that model).
- `mode: 'volume-overlap'` — a third query mode alongside M1's `surface-intersection`/`containment`.
- `broadPhase: 'tlas' | 'linear'`, with a shape-dependent default (`targets` defaults to `'tlas'`,
  legacy `{model, dbIds}` keeps M1's `'linear'` default): a per-epoch top-level acceleration
  structure (`TlasCache`/`CollisionInstanceBVH`) over cached placement, built lazily on first use as
  a target and rebuilt on growth/invalidation, bounded by an incremental `maxTlasCandidatePairs`
  budget during traversal. `'linear'` remains the M1-equivalent correctness oracle both fixtures and
  any doubt about the TLAS path fall back to.
- Multi-model entry-order/liveness: every distinct model a call touches (source and every `targets`
  entry) is snapshotted and leased at query entry; eviction of *any* captured model — not just the
  operand currently being processed — aborts the whole federated query rather than returning a
  silent partial result.
- New statistics fields for the TLAS path (`tlasBuilds`, `tlasBuildMs`, `tlasCacheHits`,
  `tlasSharedBuildWaits`, `tlasQueryMs`, `tlasPrimitiveCandidatePairs`, `tlasExactRetestSurvivors`,
  `tlasNarrowPhaseInputPairs`, `tlasLeafRangeEmissions`) plus a `'tlas-build'` scheduler/performance
  span (`reportSpan('tlas-build', ms)`, spec §9.1), reported the same way
  `GeometryRegistry._runPhase`'s weld/connectivity/bvh-construction phases already are.

### Compatibility notes

- **The legacy `{model, dbIds}` target shape is unchanged from M1, with one narrow, deliberate
  exception**: source self-exclusion (`isSourceOwnFragment`) now applies to it too, so an
  overlapping dbId on both `source` and `target` no longer double-counts a pathological self-pair.
  Describe `'linear'` as "M1-equivalent except for uniform source self-exclusion," not as
  byte-for-byte identical to M1 in every case.
- `maxBroadPhaseInstancePairs`'s upfront Cartesian precheck is **not applied at all** under
  `broadPhase: 'tlas'` — a TLAS call's real cost is not proportional to `sourceCount × targetCount`,
  so that precheck would reject queries the TLAS exists specifically to make cheap. The separate
  `maxTlasCandidatePairs` budget is what bounds a TLAS call's cost instead.
- `CollisionWorld`/`RoomLocatorExtension`'s M1 single-model public surface is unchanged; every M1
  test continues to pass unmodified. `ClashFinderExtension` is additive, sibling to
  `RoomLocatorExtension`, and does not alter Room Locator's own behavior.

### Live Viewer acceptance result

`test/acceptance/clash-finder.acceptance.mjs` (Playwright, live Viewer, live 3-discipline federated
model): **PASS.** Verified against a real coordinated building modeled by three disciplines —
Architecture host (`Audubon_Architecture_clash_test.rvt`, 5,435 fragments) plus Structure
(`Audubon_Structure_clash_test.rvt`, 543 fragments) and Mechanical
(`Audubon_Mechanical_clash_test.rvt`, 1,496 fragments) links, each independently translated and
loaded as additional models (~7,474 total fragments). Selecting a steel beam (dbId `2734`,
Structure model) and choosing "Find Clashes" finds 2 pairs (1 cross-model, 1 same-model) with 12
diagnostics; selecting a real column (dbId `3965`) finds 0 pairs, 0 diagnostics — a genuine,
diagnostic-free negative. Full write-up: `collision/README.md`'s "Reference sample: Clash Finder"
section.

### Performance-gate result

`test/performance/run-gate-m2.mjs`, run against the same real 3-discipline federated fixture: a
genuine **~3.9x reduction** in exact broad-phase retest candidates under `broadPhase: 'tlas'` vs.
`'linear'` (**1,913** vs. **7,473** `broadPhasePairs`, for the query measured) — but **no measurable
end-to-end wall-clock improvement** on this fixture's scale, because broad phase is under 0.3% of
total call time either way; narrow phase dominates both paths equally. The candidate-search benefit
question (spec §14.1) is answered **yes**; the end-to-end wall-clock picture is a wash at this
fixture's scale, expected to matter more as narrow-phase-per-candidate cost drops or source-instance
counts grow. The `'tlas-build'` span criterion, previously NOT EXERCISABLE (no span was ever
emitted — see Fixes below), is now instrumented and measured directly. `tlasSharedBuildWaits` was
NOT EXERCISED (no genuine concurrent caller races the same epoch's TLAS build in this gate's
single-page harness) — a structural gap in the gate's own concurrency, not a library defect. Full
write-up: `test/performance/README.md`.

### Fixes (closeout pass, after initial M2 completion)

- **`'tlas-build'` scheduler span was never emitted.** Spec §9.1 requires the TLAS build to report a
  `'tlas-build'` span via `reportSpan(label, ms)`; no such call existed anywhere in
  `CollisionWorld.js` or `TlasCache.js` despite `statistics.tlasBuilds` correctly counting real
  builds. Fixed in `TlasCache._startBuild` — a local `performance.now()` timer now brackets the
  actual build work (`buildPrimitives` + `CollisionInstanceBVH` construction) exactly once per real
  cold build or growth-triggered rebuild, and never on a warm cache hit or a single-flight shared
  wait.
- **`query.source.dbIds` was not defensively copied at `findClashes` entry.** Every target's dbIds
  were already `.slice()`d by `normalizeTargets` (M1 discipline, extended in M2), but the source
  side read `query.source.dbIds` directly at extraction time — a caller mutating that array during
  the call's own async gaps (most notably the instance-tree readiness wait) could change what got
  extracted, well after the call had already started. Fixed by snapshotting `query.source.dbIds`
  alongside `targetsEntries`, at the same "before any extraction begins" point normalization already
  uses.

### Known limitations

See `collision/README.md`'s "Known M2 limitations" section — in summary: no measurable end-to-end
wall-clock benefit from TLAS on the fixture measured so far (candidate-search benefit is real;
overall wall-clock is a wash at this scale); `tlasSharedBuildWaits` not exercised by the gate. Three
pre-existing, out-of-scope items remain tracked as follow-ups, not fixed by this release: a
`main.js` overlapping status-poll race, multi-model `fitToView` last-call-wins framing under
concurrent isolate/fit calls, and Room Locator/Clash Finder's independent `CollisionWorld` ownership
(each extension currently constructs its own).

## v0.1.0 — Collision Library Milestone 1 (recommended tag, not yet created)

First usable release of the Viewer-side collision-detection library (`collision/`) and its
reference integration sample, `wwwroot/extensions/RoomLocatorExtension.js`. See
`collision/README.md` for full usage docs and
`docs/superpowers/specs/collision-library-m1-release-packaging-disposition.md` for the full
packaging/release disposition.

### Capabilities

- `CollisionWorld.fromViewer(viewer, options?)` — construct a collision index over a Viewer
  model's fragment geometry (BVH-accelerated via `three-mesh-bvh`).
- `findClashes({ source, target, mode, groupBy: 'dbId' })` — three query modes:
  `surface-intersection`, `containment`, `volume-overlap`. Single-model queries only.
- Model lifecycle: `admitModel`/`evictModel`/`isModelLive`/`isLeaseValid`/`dispose`, all with an
  explicit, tested lease/epoch model (a model that's ever evicted can never be re-admitted).
- Result diagnostics (`statistics.diagnostics`, fragment-scoped and pair-scoped) so callers can
  tell an incomplete answer from a genuine negative.

### Live Viewer acceptance result

`test/acceptance/room-locator.acceptance.mjs` (Playwright, live Viewer + live acceptance model):
**PASS, 12/12 assertions.** Confirms the Room Locator sample correctly resolves
`Bathtub-TOTO-Nexus-FBF794S [420270]` to **Master Bath 207** (dbId 3885) via
`findClashes({ mode: 'containment' })`, matching `spike/FINDINGS.md`'s known-in-advance ground
truth (907/1003 bathtub vertices classify inside that room, all 13 other rooms score 0). Also
manually re-verified by the project owner against a live server and their own Chrome browser
(2026-09-05).

### Performance-gate result

`test/performance/run-gate.mjs` (Milestone 1's 12-criterion performance gate, run against a real
fragment-dense IFC model, `A250-E-MB-CND-STR-03.ifc`, 5,425 fragments, median 744
triangles/fragment): **disposition MEASURED — all 12 criteria addressed.** 9 of 12 criteria passed
with real measured numbers; the remaining 3 (fanout ceiling, over-capacity precheck,
geometry-normalization range scaling) are honestly recorded as **NOT EXERCISED** because this
model's real structure never reached the scale needed to trigger them — not silently converted
into a pass. One historical anomaly is on record and worth carrying forward: an earlier sampling
session recorded a single 30.0ms `bvh-construction` outlier (above the 19.84ms margin line) that a
dedicated 15-run re-test did not reproduce (stayed within 13.48–14.24ms) — treated as
environmental noise, not a constant-revision trigger, but flagged for continued monitoring. The
harness also has a documented structural blind spot (a loop's last iteration can go unflushed by
the span log) that this run's own aggregate cross-checks found no evidence of exploiting. Every
provisional constant in `collision/constants.js` that the gate could measure
(`maxSyncTriangleCount`, `maxFragmentsPerDbId`, `maxBroadPhaseInstancePairs`,
`maxCollisionInstancesPerEpoch`) was kept as-is, none required revision; `maxChildrenPerNode`
remains provisional and **unmeasured** — this model's widest node (124 children) never approached
its 10,000 ceiling. Full write-up: `docs/superpowers/specs/milestone-1-performance-gate-disposition.md`.

### Known limitations

See `collision/README.md`'s "Known Milestone-1 limitations" section — in summary: reliance on
undocumented internal Viewer geometry surfaces pinned to Viewer `7.124.2`; no state continuity
across extension replacement; broad phase is a plain AABB scan (no acceleration structure yet);
an extreme local-aspect-ratio ceiling (10,000:1) with one known, tracked-but-unfixed test gap at
2,000,000:1; and 3 performance-gate criteria not exercised at the scale needed to trigger them.
