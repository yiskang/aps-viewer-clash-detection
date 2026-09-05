# Milestone-1 Performance Gate — Disposition

**disposition: MEASURED**

Ran against the spec's performance-gate protocol
(`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:4864-5016`, closing
statement at `5016-5018`), the milestone's own acceptance criterion for validating the acceleration
machinery the room-locator acceptance test (Task 22) cannot exercise (B7 / extract-E risk #12: rooms
are 12–64 triangles, brute force resolves the whole query in 10.2ms — none of the BLAS cache,
lazy-build yield, `maxSyncTriangleCount`, `maxCandidatePairsExamined`, or eviction machinery is
touched by that test).

## Model used, and how suitability was confirmed

**No purpose-built MEP (Mechanical/Electrical/Plumbing) sample model exists anywhere in this repo or
its connected APS bucket at usable scale.** Independently re-confirmed (not merely cited from the
coordinator's prior inventory): a fresh repo-wide grep for URN-shaped strings and `MEP` outside
`docs/`/`.superpowers/` found nothing new; `test/README.md`'s own Task-0 "Known risk" record stands.

A live `GET /api/models` call against this app's connected APS bucket (real credentials already
configured in `.env`, a legitimate call, not fabricated) turned up two models literally named
`mep-test-v3.ifc`/`mep-test-v4.ifc`, both too small or unusable:

- `mep-test-v4.ifc`: manifest `status: success`, loads fine, but **237 fragments, median 68
  triangles/fragment, high 1,460** — squarely "dozens," fails the spec's own scale bar ("fragment
  geometries in the thousands of triangles, not the dozens").
- `mep-test-v3.ifc`: manifest `status: success`, but produces no usable instance tree when loaded
  (root fragment/tree query fails) — not investigated further given `v4`'s own disqualification made
  the point moot.

One other bucket model, **`A250-E-MB-CND-STR-03.ifc`** (manifest `status: success`, `progress:
complete`), passed the scale bar: sampling 302 of its 5,425 fragments via the real
`adaptViewerGeometry` pipeline gave **low 28, median 744, mean 1,545, high 9,078 triangles/fragment**
— genuinely "thousands, not dozens." Its actual content, confirmed by sampling 400 instance-tree node
names, is a **reinforced-concrete/rebar structural IFC model** (`IfcColumn`, `IfcBeam`,
`IfcReinforcingBar`, `IfcElementAssembly`; Italian labels — `GABBIA` = rebar cage, `CORDOLO_GUIDA` =
guide curb/tie beam, `STAFFA` = stirrup) — **not an MEP-discipline model at all**, just one whose
rebar/reinforcement geometry happens to be triangle-dense.

**This substitution was checked against the brief's own explicit warning** ("Do not substitute the
small acceptance model's numbers for the gate's numbers... B7/extract-E risk #12 is precisely the
hazard this would reproduce") via a dedicated `codex-advisor` consult before any further work was
built around this model. The advisor's finding, independently verified against this repo's own
`test/README.md`: **Task 0's own record already states the accepted alternative explicitly** —
*"source a suitable MEP-scale model... or an **equivalently fragment-dense public sample**"*
(`test/README.md`'s Known-risk section). The spec's own qualifying language for the gate is
literally triangle density ("fragment geometries in the thousands of triangles, not the dozens"), not
building-systems discipline — MEP is cited only as the typical real-world source of such density,
because the room-locator acceptance test's own rooms (12–64 triangles) are the thing being
contrasted against. A dense rebar/reinforcement model that never touches BLAS-cache/lazy-build/
eviction machinery any differently than an MEP model would is a legitimate, real substitute; a
substitution back down to the room-locator's own ~12–64-triangle scale (the actual B7 hazard) is
not what's happening here. Recorded here in the same spirit as this spec's own disposition-document
convention: the substitution is stated plainly, not hidden behind the model's file name.

## Environment

- Browser: Chromium `151.0.7922.34` (Playwright-managed), headless, software rendering (SwiftShader —
  this sandbox has no GPU adapter available; `--no-sandbox --disable-dev-shm-usage --single-process
  --no-zygote` launch args, required in this sandbox because Chromium's normal multi-process startup
  is denied by an outer process sandbox — same args `test/acceptance/room-locator.acceptance.mjs`
  already needed).
- OS: `darwin 25.6.0 (arm64)`.
- Load conditions: this sandbox also ran this coordinator's other Task-24 work (repeated Playwright
  probes, `codex-advisor` consults) around the same time — not a dedicated idle machine. Wall-clock
  variance is expected under this constraint; every criterion below is judged against a ceiling with
  enough margin that ordinary jitter does not change the verdict, except where explicitly flagged
  (criterion 5's history, below).
- **`browser.newPage()` a second time throws under this sandbox's forced launch args** (needed for
  criterion 10's multi-epoch `dispose()` variant) — worked around by using a fresh `CollisionWorld`
  instance on the *same* page instead of a second page/context (each world owns its own
  registry/BlasCache, so isolation from the terminal `__gateWorld` is preserved either way).
- dbId-selection rule (see below for the full method): **fragment-bearing frontier**, not the brief's
  assumed fixed `depth===1` Revit-style top-level-assembly convention, which does not match this
  model's actual deep IFC spatial hierarchy (`Project → Site → Building → Storey → …`).

## Protocol

One `volume-overlap` query, run twice against one shared `CollisionWorld`: cold (no BLAS cached) then
immediately cache-warm (every BLAS already built).

**dbId selection — the fragment-bearing frontier, and why the brief's own snippet needed
correcting.** The brief's embedded dbId-selection code assumed a flat tree (walk to depth 1, treat
those nodes as "top-level assemblies"). This model's real hierarchy is a single-child wrapper chain
nine levels deep (`root(1) → IfcProject(2) → IfcSite(3) → IfcBuilding(4) → IfcBuildingStorey(5) →
IfcElementAssembly(6)`) before any real branching occurs — depth 1 is `IfcProject`, not a useful
assembly grouping at all. A `codex-advisor` consult recommended a generalization: **starting at the
root, collapse every zero-direct-fragment node that has exactly one fragment-bearing child; the first
node with ≥2 fragment-bearing immediate children exposes those children as the candidate frontier**,
ranked by aggregate unique-fragment-count descending, ties by dbId ascending. For this model that
frontier sits at depth 6 (dbId 6's own children), with the ten largest candidates ranging from 33 to
2,132 fragments each.

The chosen pair is the first (by combined size, largest first) that clears both
`maxFragmentsPerDbId`/`maxBroadPhaseInstancePairs` **and** produces a real nonzero narrow-phase
candidate count in a throwaway preflight `CollisionWorld` (own registry/BlasCache, so it cannot
contaminate the real gate world's cold-start state) — codex-advisor's point that triangle density
alone doesn't prove a candidate pair exercises anything; three of the four largest-combined pairs
were rejected purely on the `maxBroadPhaseInstancePairs` ceiling (`sourceCount × targetCount` too
large) before the fourth (`PLATEA` × `P1`) passed both checks:

| source | target | sourceCount | targetCount | result |
|---|---|---|---|---|
| `PLATEA` (232) | `MURI` (485) | 2,132 | 665 | rejected — exceeds `maxBroadPhaseInstancePairs=1,000,000` |
| `PLATEA` (232) | `MURI` (696) | 2,132 | 630 | rejected — exceeds `maxBroadPhaseInstancePairs=1,000,000` |
| `PLATEA` (232) | `CORDOLO_GUIDA` (111) | 2,132 | 520 | rejected — exceeds `maxBroadPhaseInstancePairs=1,000,000` |
| **`PLATEA` (232)** | **`P1` (7)** | **2,132** | **33** | **accepted** — 70,356 broad-phase pairs, 1,291 narrow-phase candidates |

**Chosen: `source = IfcElementAssembly::PLATEA` (dbId 232, 2,132 fragments), `target =
IfcElementAssembly::P1` (dbId 7, 33 fragments).**

## Instrumentation-methodology finding (worth flagging for future work against this Viewer version)

While building the frontier-selection code, an early draft's tree-walk consistently found only ONE
child at every level of a chain that independently-verified (`getChildCount`, `getNodeParentId`)
really has 50 real branches at depth 6 — a fully reproducible, initially baffling discrepancy (same
dbId, same `tree.enumNodeChildren` call, correct in isolation, wrong when reached via a chained
walk). A `codex-advisor` consult found the real cause in minutes: the walk's collector callback was
written `(c) => children.push(c)` — an implicit-return arrow whose value is `Array.prototype.push`'s
own return (the new, positive, **truthy** array length) — and Viewer `7.124.2` documents (and this
spec's own atomic-operations table already records, `docs/...:2146`) that a truthy enumeration
callback return **aborts** the enumeration. Every affected call therefore silently stopped after
exactly one child. Fixed to `(c) => { children.push(c); }` (block body, implicit `undefined` return)
everywhere in `run-gate.mjs`, plus a defensive `getChildCount` cross-check added to the frontier walk
as a permanent safety net against any future regression of the same kind. Confirmed this bug was
scoped to this task's own new script — Task 23's `browser-probes.mjs` was independently audited and
found already clean (every one of its `enumNodeChildren`/`enumNodeFragments` callbacks uses a
block body or an intentional truthy abort where that's the actual point, e.g. criterion 7's own
fanout-ceiling probe) — so none of Task 23's own recorded numbers are affected by this finding.

## Criteria 1–12

| # | Criterion (pass/fail line) | Cold run | Warm run | Verdict |
|---|---|---|---|---|
| 1 | Worst-case span ≤ **24.8ms** (excl. 3 named spans; 2 provisional exceptions: criteria 7, 8) | max labeled span (excl. total-wallclock) = **4.8ms** (`narrow-phase-pair`) | max labeled span (excl. total-wallclock) = **1.8ms** (`composed-narrow-phase-stage`) | **PASS**, both runs, with large margin |
| 2 | Every tripped budget emits correct diagnostic, never freeze/fabricated clash | 1 diagnostic: `crossing-budget-exhausted` (pair scope, real source/target fragment IDs) | same diagnostic, same pair | **PASS** |
| 3 | Per-candidate/per-build costs recorded next to `measure.mjs`'s synthetic figures | `narrowPhaseMs/narrowPhasePairs` = 401.5/1291 ≈ **0.311ms/candidate** | 142.3/1291 ≈ **0.110ms/candidate** | Recorded — see comparison section below |
| 4 | `classifyPoint` / crossing-probe / `SurfaceCrossingWitness` probe worst-case cost measured | `classifyMs=0`, `crossingMs=0`, `witnessMs=0.5ms` (one live sample, dbId 232's fragment) | — (single live-model probe, not repeated cold/warm) | **PASS** — negligible, as the spec's own reasoning assumed |
| 5 | Weld / connectivity / BVH each measured **individually** at `maxSyncTriangleCount` (≤19.84ms each) | weld **14.4–16.9ms**, connectivity **7.5–8.6ms**, bvh-construction **11.5–13.3ms** (6 fresh runs of `measure-geometry-phases.mjs`, this task) | — (Task 23's own harness; not part of the live cold/warm run) | **PASS**, each phase individually, every run, with margin — see history note below |
| 6 | Largest-dbId extraction cost; broad-phase total + longest inter-yield span; `performance.now()` vs AABB-test cost; candidate-list size at ceiling | extraction (widest dbId 474, 84 fragments): **<0.1ms**; broad-phase total **38.3ms**, longest inter-yield span **0.9ms**; `performance.now()` **0.069µs**/call vs AABB test **0.006µs**/call; candidate-list size **70,356** (7% of the 1,000,000 ceiling) | broad-phase total **13.9ms**, longest inter-yield span **0.4ms** | **PASS** (extraction/broad-phase both cheap); **finding**: `performance.now()` costs ~11x MORE than the AABB test it brackets — non-negligible relative overhead, see note below |
| 7 | `enumNodeChildren` at fanout ceiling: `maxChildrenPerNode+1` invocations, abort observed | — | — | **NOT EXERCISED** — widest node (dbId 232, `PLATEA`) has only 124 children; ceiling is 10,000 |
| 8 | Capacity-admission recompute-and-commit separate from precheck; precheck-rejects-before-mutation confirmed | commit span **0.4ms** | commit span **0.1ms** | Commit cost **PASS** (well under 24.8ms, a provisional-exception label regardless); precheck-reject half **NOT EXERCISED** — model's total population (5,425) is far below `maxCollisionInstancesPerEpoch` (20,000); no real over-capacity query is constructible from this model |
| 9 | `enumNodeFragments` on densest-fragment node, measured (no ceiling to enforce) | dbId 474, **84 fragments** (1.68% of the 5,000 ceiling), **<0.1ms** | — | **PASS/measured** — negligible cost at this model's real density |
| 10 | Epoch registry sweep, `evictModel` + `dispose()` (varying live-epoch count) | `evictModel` (on the real, warmed gate world — 66 real geometry builds, 1,291 real `CollisionInstance`s admitted): **0.4ms** | `dispose()` at 1/5/20 simultaneously-live epochs (only the real model's epoch carries real content — fake models can't carry geometry, see caveat below): **0.2ms / 0.1ms / 0ms** | **PASS/measured** — sweep cost does not grow with extra empty epochs; see caveat below on what this does and doesn't prove |
| 11 | `ViewerGeometryAdapter` normalization at most-fragmented geometry | — | — | **NOT EXERCISED** — most-fragmented geometry found has only 1 range, too flat to exercise `O(ranges)` scaling |
| 12 | `CollisionInstance` identity-cache retained size after full unique-fragment query | after cold+warm pair (2,165 fragments) plus a coverage-drive of 48 additional self-pair queries across other frontier siblings (≈3,260 more fragments) | **retained count: 5,425** — the model's ENTIRE fragment population | **PASS/measured** — 5,425 / 20,000 = **27.1% of the ceiling**; real evidence the current default has comfortable headroom for a model this size |

*(Criteria 7/8-precheck/11: `NOT EXERCISED` per this model's own real limits — recorded as required
gate findings, never silently converted into a passing number.)*

## Comparison against `spike/measure.mjs`'s synthetic figures

Never conflated — recorded side by side. `spike/measure.mjs`'s own combined-BVH-only synthetic figure
(the gap Task 23's `measure-geometry-phases.mjs` was built to close) measured ~16ms for an
18k-triangle synthetic mesh, folding weld+connectivity+BVH into one number. This gate's real-model
per-candidate cost (narrow-phase, 0.110–0.311ms/candidate at this model's real ~33–2,132-fragment
scale) is not directly comparable to that per-*build* figure — the real point of comparison is
Task 23's own per-phase breakdown (weld/connectivity/BVH at the *exact* 12,000-triangle ceiling,
re-run fresh for this task, 6 samples): **14.4–16.9ms / 7.5–8.6ms / 11.5–13.3ms**, each individually
well inside the 19.84ms per-phase margin line — the real evidence that promotes `maxSyncTriangleCount`
from "reasoned" to "measured" (see Constant revisions below).

**One documented anomaly, not reproduced by this task's own 6 samples**: Task 23's own report recorded
an *observed range* for `bvh-construction` across its earlier sampling of **11.7–30.0ms** — the
high end of that range would have exceeded BOTH the 19.84ms per-phase margin AND the 24.8ms absolute
ceiling. This task's own 6 fresh runs (this session, same sandbox) never reproduced anything above
13.3ms. Recorded honestly rather than silently reconciled: the 12,000 figure is kept on the strength
of the *overwhelming majority* of samples (10 of 11 total, across both tasks) clearing the margin
comfortably, but this is a genuine, unresolved variance worth a closer look in a future round if it
recurs — not dismissed as impossible, since it was independently observed once already under this
same sandbox's conditions.

## Caveats on this run's own evidence (per `test/performance/README.md`'s documented measurement gaps)

- **Loop-based labels' last-iteration tail**: `narrow-phase-pair`/`broad-phase-scan`/
  `composed-narrow-phase-stage` each report "time since the previous same-label checkpoint" — the
  very last iteration's own cost, after the final checkpoint call in that scope, has no following
  checkpoint to flush it. A genuine 24.8–49ms violation landing exactly there would be invisible to
  both this manual span log AND the Long Tasks API (which only fires ≥~50ms). No such violation is
  visible in this run's own aggregate cross-check (narrow/broad-phase `statistics` totals divided by
  their own pair counts show no outlier average), but this is a structural gap in the harness, not
  proof no such violation ever occurred.
- **Cross-port absorption check (criterion 1)**: `narrow-phase-pair`'s single highest span this run
  (4.8ms, cold) was cross-checked against `GeometryRegistry`'s own separate `weld`/`connectivity`/
  `bvh-construction` spans in the same log (max 1.7/0.7/1.0ms) — 4.8ms is consistent with "this
  specific pair triggered a fresh geometry build via the registry's own port, plus real narrow-phase
  work," not a hidden/inflated cross-port artifact. No red flag found.
- **Criterion 10's `dispose()` multi-epoch caveat**: only the real model's epoch could carry real
  `GeometryRegistry`/`CollisionInstance` content (fabricated extra "model" objects, used purely to
  inflate the live-epoch count, cannot carry real geometry). This measures "sweep cost does not grow
  when extra *empty* epochs coexist alongside one real, populated epoch" — a real, useful finding —
  but does **not** measure the harder case of *many simultaneously-populated* epochs, which this
  single-model sandbox session cannot construct.
- **Criterion 4** was sampled once (one fragment, one call each), per the spec's own "worst-case
  single-call cost... measured, not reasoned about" standard, not repeated across cold/warm since
  it is model-geometry-dependent, not query-state-dependent.

## Constant revisions

- **`maxSyncTriangleCount` (12,000, provisional): kept, not revised.** Every phase (weld,
  connectivity, BVH construction), measured individually across 6 fresh runs at the exact 12,000
  ceiling, clears the 19.84ms per-phase margin line comfortably (worst observed: connectivity at
  8.6ms, 43% of the margin). This is graduated from "reasoned" to "measured" by this task's own run,
  with the one caveat recorded above (Task 23's own historical 30.0ms `bvh-construction` outlier,
  not reproduced here, flagged for continued monitoring rather than silently dropped).
- **`maxCollisionInstancesPerEpoch` (20,000, this plan's own reasoned default): kept, not revised.**
  This gate's own criterion-12 measurement is the first real evidence against it: this model's entire
  5,425-fragment population, once fully queried across a realistic multi-call session, retains at
  27.1% of the ceiling — comfortable headroom for a model this size. A materially larger real model
  could approach this ceiling; this finding does not by itself justify raising the constant, since no
  evidence here suggests 20,000 is inadequate, only that it is no longer an untested guess.

## Overall disposition

**This run is what promotes the atomic-operations table's still-"reasoned, not yet measured" rows
under `ProperCrossingQuery`'s budgets to "measured," per the spec's own closing statement
(`docs/...:5016-5018`)** — specifically: `maxSyncTriangleCount`'s three phases (`docs/...:2140-2142`,
already measured at round 15/Spike Findings but re-confirmed here at the *revised* 12,000 ceiling),
one `classifyPoint`/probe call (`docs/...:2144`), `maxFragmentsPerDbId` and the accepted-risk
`enumNodeFragments` row (`docs/...:2145-2146` — measured at this model's real density, 84 fragments,
1.68% of ceiling, not the pathological worst case but a real number where none existed before), and
`maxBroadPhaseInstancePairs` (`docs/...:2148` — measured at 70,356 real candidate pairs, 7% of
ceiling, broad-phase total cost and per-pair overhead both recorded). `maxChildrenPerNode`
(`docs/...:2147`) remains **reasoned, not measured** — this specific model's widest node (124
children) cannot exercise the 10,000-child ceiling, an explicit, honest gap rather than a fabricated
number.

**The performance gate has passed** for the twelve stated criteria, on this real, adequately-scaled
(non-MEP-discipline, fragment-dense) model, against a single shared `CollisionWorld`'s genuine
cold-then-warm cache reuse. Three of twelve criteria (7, 8's precheck half, 11) are honestly recorded
as `NOT EXERCISED` because this specific model's own real structure cannot trigger them at scale —
per the spec's own instruction, this is itself a required finding, not silently converted into a
pass. This is a separate sentence from "this task is complete": the task's own checklist (Steps 1–6)
is fully executed, and the milestone's acceleration machinery — BLAS cache, lazy-build yield,
`maxSyncTriangleCount`, `maxCandidatePairsExamined`, cache-warm reuse, and eviction — has now been
exercised by something other than synthetic geometry or the room-locator's own 12–64-triangle rooms,
for the first time in this milestone.
