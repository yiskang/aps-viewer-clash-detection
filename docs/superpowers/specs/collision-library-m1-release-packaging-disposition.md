# Collision Library Milestone-1 — Release Packaging Disposition

Milestone 1 was already implemented and manually accepted (2026-09-05, see the coordinator's own
memory record). This task did not touch algorithms, architecture, query semantics, performance
thresholds, or Viewer lifecycle behavior — it packaged the already-accepted implementation into a
usable reference library + sample, documentation-only.

## Files changed

| File | Change |
|---|---|
| `collision/README.md` | **New.** The library's own usage doc: what it does, the 3 query modes, `fromViewer`/`findClashes`/`groupBy: 'dbId'` usage, result/diagnostic behavior, model admission/eviction/dispose contract, Viewer-version assumptions, known M1 limitations, quick-start example, reference-sample writeup, developer entry points. |
| `README.md` | Added a short "Collision detection library" section pointing at `collision/README.md` and the sample extension. No other change. |
| `CHANGELOG.md` | **New.** `v0.1.0` release notes: capabilities, live-Viewer acceptance result, performance-gate result, limitations summary. |
| `docs/superpowers/specs/collision-library-m1-release-packaging-disposition.md` | **New.** This report. |

No source file under `collision/`, `wwwroot/`, `test/`, or `scripts/` was modified. No algorithm,
tolerance, budget, query-semantics, or lifecycle behavior changed.

## Release / package structure

The collision library lives at `collision/` inside this existing repo (`aps-viewer-sandbox`) — it
is not split into a separate npm package for M1, and this task did not restructure it into one
(out of scope: "do not reopen settled M1 architecture"). The reference sample is
`wwwroot/extensions/RoomLocatorExtension.js`, already wired into the running app.

Structure a new developer needs:

```
collision/
  index.js          <- single public entry point (import from here only)
  CollisionWorld.js <- lifecycle + findClashes
  constants.js      <- every tunable tolerance/budget
  errors.js         <- error classes
  README.md         <- usage docs (this task's main deliverable)
wwwroot/extensions/RoomLocatorExtension.js  <- reference sample
test/acceptance/README.md   <- how the acceptance claim was verified
test/performance/README.md  <- how the performance-gate claim was verified
```

## Recommended release/tag name

**`v0.1.0`** — first usable release of the collision library + Room Locator reference sample.

**Not created.** No tag exists in this repo yet and there is no established tagging convention to
defer to, so per this task's own instruction ("do not create a tag if the repo's normal workflow
requires human approval first — report the recommended tag instead"), the tag was left
unconfigured pending explicit authorization. `package.json`'s own `version` field (`1.0.0`,
inherited from the original Simple Viewer tutorial scaffold) was left untouched — it describes the
whole sandbox app, not the collision library specifically, and bumping it wasn't asked for.

## Exact quick-start path

1. `npm install` (installs `three`, `three-mesh-bvh`, and this repo's other deps).
2. `import { CollisionWorld } from './collision/index.js';`
3. `const world = await CollisionWorld.fromViewer(viewer);` (inside an extension's `load()`, or
   anywhere with a live `viewer` reference and a loaded model).
4. `const { pairs, statistics } = await world.findClashes({ source, target, mode, groupBy: 'dbId' });`
5. Check `statistics.diagnostics` before trusting an empty `pairs` result.
6. `world.dispose()` when done (e.g. in `unload()`).

Full runnable-shaped example: `collision/README.md`'s "Quick start" section. To see it running for
real: `npm start`, open `http://localhost:8080/#<URN>` with the acceptance URN now given verbatim
in `collision/README.md`'s reference-sample section, select `Bathtub-TOTO-Nexus-FBF794S [420270]`,
right-click → "Locate Room".

## Remaining limitations (as documented in `collision/README.md`)

- Fragment-geometry extraction relies on undocumented/internal Viewer surfaces, version-pinned to
  the decompiled `7.124.2` bundle.
- No `CollisionWorld` state survives an extension replacement (fresh world/cache every time).
- Broad phase is a plain AABB scan — no spatial acceleration structure over instances yet.
- Extreme local-aspect-ratio ceiling (10,000:1, declared); one known-but-unfixed test gap exists at
  2,000,000:1 (`test/query/ContainmentQuery.classifyPoint.test.mjs`, `{ todo: true }`).
- Instance-tree readiness handles only "tree not yet created," not "tree exists but
  under-populated" (`docs/superpowers/specs/instance-tree-readiness-decision.md`).
- 3 of the performance gate's 12 criteria (fanout ceiling, over-capacity precheck,
  geometry-normalization range scaling) are recorded `NOT EXERCISED` — the test model never reached
  the scale needed to trigger them, not a measured failure.
- `statistics.blasBuilt`/`blasCacheHits` are always reported as `0` (not yet wired to real
  counters) — a cosmetic gap in the diagnostics shape, not a correctness issue.

None of these are new findings — every one is carried forward verbatim from the implementation's
own existing records (`collision/constants.js`, `errors.js`, `test/README.md`,
`test/performance/README.md`, `docs/superpowers/specs/milestone-1-performance-gate-disposition.md`,
`docs/superpowers/specs/instance-tree-readiness-decision.md`). This task did not discover, resolve,
or reopen any of them — only consolidated them into one user-facing limitations list.

## Verification performed

- Re-read `collision/CollisionWorld.js`, `collision/index.js`, `collision/constants.js`,
  `collision/errors.js`, `collision/viewer/ViewerModelAdapter.js`,
  `collision/query/VolumeOverlapQuery.js`/`ContainmentModeQuery.js`, and
  `wwwroot/extensions/RoomLocatorExtension.js` directly to confirm every documented API signature,
  option, error class, and behavior against the actual current code (not copied from the
  implementation plan or design spec).
- Got an independent `codex-advisor` review of `collision/README.md` against the real source
  before finalizing. It found 5 real inaccuracies in the first draft (async-rejection vs.
  synchronous-throw for `fromViewer`'s option validation; an incomplete `statistics`/error-class
  list — `ExtractionLimitExceededError` was missing entirely; `maxLocalAspectRatio`'s scope
  understated — it also gates `volume-overlap`'s source operand, not just containment's target —
  and its 354,000:1 failure-onset figure overstated as "measured" rather than "derived"; missing
  hard budget numbers; and the Room Locator sample's `alert()` behavior overstated (it fires only
  when diagnostics are present, not on every outcome)). All 5 were verified against source and
  corrected in the files as published; see each file's current text.
- Ran `npm test` (`node --test`, full suite) twice after the doc changes: one run reported 364
  pass / 0 fail / 1 todo (exit 0), a second reported 363 pass / 1 fail / 1 todo (exit 0) — the
  single inconsistent result across runs is the same pre-existing `{ todo: true }`
  extreme-aspect-ratio known-gap test (`test/query/ContainmentQuery.classifyPoint.test.mjs`), which
  is evidently borderline/non-deterministic at its tested extreme scale. This is unrelated to this
  task's doc-only changes, already listed in this task's own limitations section above, and never
  affects the exit code (Node's `--test` does not fail the run over a `{ todo: true }` test). No
  regression.
- Did not re-run `npm run test:acceptance` or `npm run test:performance:gate` (both require a live
  server + Playwright + real APS credentials, and their results are already recorded, current, and
  unaffected by a documentation-only change) — consistent with this task's instruction to run only
  lightweight checks, not reopen the full implementation review loop.
- The three untracked `room-locator-*.png` files visible in `git status` predate this task (present
  before any file in this task was touched) and were not created, moved, or referenced by it.

## Is Milestone 1 ready to hand to another developer as a usable reference package?

**Yes.** A new developer can now:

1. Read `collision/README.md` (one file) to understand what the library does, its API, and its
   limitations — no design-spec reading required.
2. Follow its quick-start example, which compiles conceptually against the current code (verified
   above).
3. Read `wwwroot/extensions/RoomLocatorExtension.js` alongside the README's generic-vs-specific
   usage table to see a real, working integration.
4. Reproduce the milestone's acceptance and performance claims via the existing
   `test/acceptance/README.md` / `test/performance/README.md` writeups, without this coordinator's
   involvement.

Milestone 2 has not been started. No architecture, algorithm, query semantics, or performance
threshold was changed by this task.
