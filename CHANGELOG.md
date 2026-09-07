# Changelog

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
