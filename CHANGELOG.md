# Changelog

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
