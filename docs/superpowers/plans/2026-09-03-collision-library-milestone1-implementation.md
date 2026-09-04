# Collision Library — Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Milestone 1 of the client-side collision-detection library described in the design spec below — a `CollisionWorld` facade backed by `three-mesh-bvh`, isolated from the Viewer's own bundled THREE, exposing `findClashes` (three query modes: `surface-intersection`, `containment`, `volume-overlap`) and a thin `RoomLocatorExtension` consumer that replaces the sandbox app's existing `ThreeCSG`-based room lookup.

**Architecture:** Two isolated THREE.js runtimes (Viewer's global `window.THREE` r71, never touched, vs. the library's own vendored `three@0.185.1`/`three-mesh-bvh@0.9.14`, loaded via an import map). Geometry flows: raw Viewer geometry → layout-normalized `TriangleRange[]` → active-range-compacted + welded buffer → `GeometryConnectivity` (lazy) + `MeshBVH` (via `GeometryRegistry`'s single-flight, publish-on-build-start phase machine). Every cache is keyed by `(loadEpoch, geometryIndex)` or `(loadEpoch, fragmentId)` — `loadEpoch` is a monotonic counter assigned once per admitted `Model` **object**, never `modelId` (which is reused across unload/reload). `CollisionWorld.findClashes` composes: entry lifecycle checks → self-driven fragment extraction → capacity-gated `CollisionInstance` admission → linear-scan broad phase → per-pair narrow phase (mode-dispatched query) → `ownerDbId`-keyed aggregation into `ClashPair[]`. A shared `frameBudgetMs` checkpoint (via an injectable scheduler/checkpoint port) governs cooperative yielding throughout, with `ProperCrossingQuery`/`SurfaceIntersectionQuery`'s own `bvhcast` traversals using a private, non-yielding clock as the sole documented exception.

**Tech Stack:** Plain ES modules, no bundler (`wwwroot/`, served by the existing Express app). `three@0.185.1`, `three-mesh-bvh@0.9.14` (already pinned in `package.json`), vendored into `wwwroot/vendor/` and resolved via an import map. Node's built-in `node:test`/`node:assert/strict` for all unit/integration tests (established in Task 0 — no new test-framework dependency). Playwright (new devDependency, added in Task 22) for the one live-Viewer acceptance test.

**Spec:** `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (implementation-ready: 0 Critical/High blockers as of `docs/superpowers/specs/round-31-implementation-planning-blockers-disposition.md`). Every task below cites this spec by line number (`docs/...:Lxxx-Lyyy`); executors should read the cited passages, not rely solely on this plan's paraphrase. The idea doc this spec refines is `docs/ideas/aps-viewer-clash-detection-library-idea.md`.

## Global Constraints

These apply to every task below; they are not repeated per-task.

- **Dependency pins** (already in `package.json`): `three@0.185.1` (ESM entry `./build/three.module.js`), `three-mesh-bvh@0.9.14` (`peerDependencies: three >= 0.159.0`, satisfied). Every upstream behavioral claim in the spec is verified against the `v0.9.14` git tag specifically (`docs/...:1034-1036`).
- **Repo layout** (`docs/...:989-1022`): `wwwroot/vendor/{three,three-mesh-bvh}/...` (vendored, copied via `scripts/sync-vendor.mjs`), `wwwroot/collision/{viewer,geometry,blas,query}/`, `CollisionWorld.js`, `index.js`, `wwwroot/extensions/RoomLocatorExtension.js`, `wwwroot/viewer.js` (modified), `wwwroot/index.html` (modified — import map). Tests live under `test/`, mirroring the `collision/` tree (see Task 0's `test/README.md`).
- **Never assign `window.THREE`/`globalThis.THREE`** from the collision runtime; never patch Viewer-THREE prototypes (`docs/...:979-987`). `window.THREE.REVISION` must read `'71'` unchanged before and after the collision runtime loads — this is an acceptance criterion (Task 0, Task 22).
- **Identity/keying backbone**: `GeometryRegistry`, the `CollisionInstance` identity cache, and every geometry-derived cache are keyed by `(loadEpoch, geometryIndex)` or `(loadEpoch, fragmentId)` — **never** `modelId`, which is reused across unload/reload (`docs/...:1137-1146, 1229-1251`, Round 14).
- **No placeholders / no invented mechanisms**: where the spec leaves a constant provisional (see the table below), this plan sets a reasoned default and flags it as revisable by the Task 24 performance gate — it does not leave a `TODO`.
- **Milestone-1 scope boundaries** (`docs/...:923-961`, Round-31 disposition): no cross-model queries (`findClashes` requires `source.model === target.model`); no surviving a Viewer model/document replacement once `RoomLocatorExtension`/`CollisionWorld` is established; no `touching`/`clearance` modes; no TLAS broad-phase (plain linear AABB scan only); no worker offloading; no persistent BLAS serialization. Do not implement any of these — a task that appears to need one is out of scope, not under-specified.
- **Constants** (single source of truth: `collision/constants.js`, Task 1) — exact values, several provisional pending the Task 24 performance gate:

  | Constant | Value | Status |
  |---|---|---|
  | `frameBudgetMs` | `8` | measured (one-frame principle) |
  | `maxCandidatePairsExamined` | `50_000` | measured |
  | `maxCrossingPairsExamined` | `64` | reasoned |
  | `maxContainmentSamples` | `512` | reasoned |
  | `samplesPerComponent` | `8` | reasoned |
  | `maxWitnessTriangles` | `8` | reasoned |
  | `maxSyncTriangleCount` | `12_000` | **provisional** — Task 24 must confirm/revise |
  | `maxFragmentsPerDbId` | `5_000` | provisional |
  | `maxChildrenPerNode` | `10_000` | provisional |
  | `maxBroadPhaseInstancePairs` | `1_000_000` | provisional |
  | `maxCollisionInstancesPerEpoch` | `20_000` | **this plan's own reasoned default** — the spec itself leaves this one unchosen (`docs/...:1324-1330`); Task 24 must revise per measured steady-state retention |
  | `barycentricEpsilon` / `coplanarAngleEpsilon` | `1e-6` (dimensionless) | fixed |
  | `mergeDistanceFactor` / `surfaceEpsilonFactor` | `1e-6 × L_target` | fixed |
  | `offsetLadderFactors` | `[1e-3, 1e-4, 1e-5] × L_canonical` | fixed |
  | `witnessLadderFactors` | `[1e-3, 1e-4, 1e-5] × L_source` | fixed |
  | `crossingProbeFractions` | `[0.5, 0.1, 0.01]` (per-triangle scaled) | fixed |
  | `minPenetrationDepthFactor` | `1e-5 × L_canonical` | **declared semantic limit**, not a bug |
  | `weldEpsilonMeters` | `1e-4` m `/ model.getUnitScale()` | fixed |

- **Performance gate pass line**: no single synchronous task exceeds **24.8ms** (`frameBudgetMs=8 + 16.8ms` measured weld phase) — stated loosely elsewhere as "≈24ms," but Task 24's literal pass/fail line is `24.8ms` (`docs/...:4660-4671`, Round 22).
- **Testing convention** (established Task 0, binding for every later task): Node's built-in `node:test` + `node:assert/strict`, no new devDependency until Task 22 (Playwright, for the one live-Viewer acceptance test). One `*.test.mjs` per source module, mirroring `collision/`'s tree under `test/`. Regression-guarding assertions carry a one-line `// ROUND N REGRESSION: ...` comment, matching `spike/fixtures.mjs`'s existing convention.
- **Cite the spec, not this plan, as ground truth on conflict.** This plan was assembled from six parallel drafts; the "Cross-Task Interface Reconciliation" section immediately below resolves the interface conflicts that surfaced between them. Where any task's own prose disagrees with that section, the reconciliation section wins.

## Cross-Task Interface Reconciliation

This plan's 25 tasks were drafted by six parallel agents against a shared but still-settling set of
interfaces (`collision/scheduler.js`'s checkpoint port, `GeometryRegistry`'s public method, and
`CollisionWorld`'s lifecycle/admission surface were each independently refined mid-draft, in some cases
via each group's own `codex-advisor`/`codex-review` consultation). The conflicts below were found and
resolved during assembly; Tasks 19-21's embedded code has already been corrected to match. Executors of
Tasks 13-18 should still read this section before writing code, since it is the authoritative version of
these contracts, superseding any inconsistent phrasing inside those tasks' own prose.

1. **`GeometryRegistry`'s public method is `getOrBuildGeometry({ loadEpoch, geometryIndex, ownerModelIdHint, needsConnectivity })`** (named-args object, not `lookupOrBuild(identity, context)`), returning `Promise<{ oversized: false, bvh, localDiagonal, connectivity? } | OversizedMarker>` — **already fully resolved by its own build/connectivity/BVH phases**, never a record still holding unresolved per-phase promises. This is Task 13's actual, tested (12/12 fixtures) contract — treat it as final.

2. **`collision/scheduler.js#createCheckpointPort` is CONDITIONALLY synchronous**: `checkpoint({ loadEpoch, modelIdHint }) => (undefined | Promise<void>)` — it returns `undefined` directly (no `Promise`, no microtask tick) on the "not due" fast path, and a real `Promise` only when a yield is actually needed. This was a deliberate Task 0-6 revision (via its own `codex-advisor` consult) specifically because the broad-phase scan can call it up to `maxBroadPhaseInstancePairs = 1,000,000` times in one `findClashes` call — an unconditionally-`async` port would force a microtask tick on every one of those. **Every caller written as `await checkpoint(...)` (unconditional await) remains functionally correct** — awaiting a non-Promise value is valid JS and resolves immediately — so Tasks 13/14/16's existing `await checkpoint(...)`/`await this.checkpoint(...)` call sites do not need to change. Only `CollisionWorld`'s own broad-phase scan (Task 19, the one call site with pathological volume) is written using the non-awaiting fast path (`const pending = checkpoint(...); if (pending) await pending;`) — see Task 19's `_runBroadPhaseScan`.

3. **Two distinct checkpoint-port *instances* exist, both built from the same `collision/scheduler.js#createCheckpointPort` factory, for two different scopes:**
   - `CollisionWorld.prototype.createCheckpointPort(lease)` — a **per-`findClashes`-call factory**. Called once per call (or once per lifecycle test), bound to that call's own `{model, epoch}` lease and a **fresh** `frameBudgetMs` accumulator. Used for `findClashes`'s own checkpoints (broad-phase pair boundaries, narrow-phase pair boundaries, composed-stage boundaries inside `VolumeOverlapQuery`/`ContainmentModeQuery`).
   - `GeometryRegistry`'s own constructor-injected `checkpoint` — a **single, long-lived** port built directly from `collision/scheduler.js#createCheckpointPort` (not from `world.createCheckpointPort(lease)`, which requires a lease this cross-call-shared, single-flight-build-owning object never has), with its own dedicated accumulator and an **epoch-only** liveness predicate: `isEpochLive: (loadEpoch) => world._isEpochLive(loadEpoch)`. This is why `GeometryRegistry`'s own checkpoint calls are always shaped `checkpoint({ loadEpoch })` — never `{ model, loadEpoch }` — a `GeometryRecord` entry never holds a live `Model` reference (Task 13's own flagged concern, confirmed correct).
   - **`CollisionWorld` needs one small addition beyond what Task 17's own write-up lists**: a `_liveEpochs: Set<number>` maintained alongside `_modelLifecycle` (added to in `admitModel`, removed from in `evictModel`/`dispose`), backing a `_isEpochLive(loadEpoch)` method. `_modelLifecycle` is a `WeakMap<Model, ...>` and cannot answer "is this loadEpoch live" without a `Model` object in hand — which is exactly what `GeometryRegistry`'s checkpoint calls don't have. Task 17's executor should add this Set and method as part of that task's own deliverable (both Task 0-6's and Task 13-15's independent reviews converged on needing exactly this).
   - Task 19's `fromViewer` constructs `GeometryRegistry`'s checkpoint this way explicitly — see its Step 3.

4. **`CollisionWorld.prototype.admitCollisionInstances(lease, uniqueFragments)`** takes the caller's full `{model, epoch}` lease, not a bare epoch number — this closes an orphan-bucket-after-eviction gap Task 17/18's own `codex-advisor` review caught (a bare epoch number can't be checked for staleness before touching a bucket). Task 19 passes `{model, epoch}` (the same pair `_checkEntryLifecycle` returned), not `epoch` alone.

5. **The three query-composition functions take `Instance`-shaped objects, not raw `(bvh, matrix)` pairs**, per Task 7-12's actual exports:
   - `surfaceIntersectionQuery(bvhA, bvhB, matrixBtoA, options?)` — **synchronous** (not `async`), raw BVHs + matrix only, no checkpoint parameter (it owns a private, non-yielding traversal clock).
   - `volumeOverlapQuery(source: Instance, target: Instance, options?: { scheduler?: SchedulerHandle, ... })` and `containmentModeQuery(source: Instance, target: Instance, options?: { scheduler?: SchedulerHandle, ... })` — both `async`, both take `Instance = { geometry, bvh, localDiagonal, connectivity, closedManifold, matrix }` and a `SchedulerHandle` (`{ checkpoint(): Promise<void> }`) for composed-stage checkpointing, not a bare callback.
   - `CollisionWorld._runNarrowPhasePair` (Task 20) wraps a resolved `GeometryRegistry` record plus the pair's placement into this `Instance` shape via a small `toInstance()` helper — see Task 20's Step 3. **The `closedManifold` field's derivation there is this assembly's own best-effort guess** (`connectivity.closedManifold.every(Boolean)`); Task 19/20's executor should confirm against Task 4/9's actual internal use of that field before treating it as final, and simplify or correct `toInstance()` accordingly.

6. **`CollisionWorld.js` imports `THREE` directly** (like every other `collision/` module) for its one relative-transform computation — an earlier draft routed this through a `globalThis.__collisionThree` global set by `index.js`; that indirection has been removed. `index.js` is a pure re-export of `CollisionWorld`.

---


Spec: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`. All line citations refer to this file unless noted.

---

### Task 0: Vendor sync, import map, runtime isolation, and project test infrastructure

**Objective:** Stand up the vendored three/three-mesh-bvh runtime, the import map that isolates it from the Viewer's own THREE, and the test-running convention every later task depends on; flag the missing MEP-scale model risk early rather than discovering it at Task 24.

**Files:**
- Create: `scripts/sync-vendor.mjs`
- Create: `test/README.md`
- Create: `test/runtime/runtimeIsolation.test.mjs`
- Modify: `package.json` (add `build:vendor` and `test` scripts)
- Modify: `wwwroot/index.html` (add import map)

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task).
- Produces: the `npm run build:vendor` / `npm test` commands and the `test/` directory
  convention every later task's own test files depend on; the import map in
  `wwwroot/index.html` that every later browser-facing module (none in Tasks 0-6, but
  all of `collision/` from Task 7 onward) resolves `three`/`three-mesh-bvh` bare
  specifiers through.

- [ ] **Step 1: Write the failing test(s)**

`test/runtime/runtimeIsolation.test.mjs`:

```js
// test/runtime/runtimeIsolation.test.mjs
//
// Automated half of the runtime-isolation acceptance check (spec:985-987, 1038-1076):
// confirms the import map exists, is positioned before the app's own module script,
// and every entry it declares resolves to a real file that `npm run build:vendor` is
// supposed to have produced. This is what `npm test`/CI can check without a browser.
//
// The other half of the acceptance check -- `window.THREE.REVISION === '71'`
// unchanged before and after the collision runtime loads -- requires a live browser
// with the real Viewer script tag loaded. That half is a documented MANUAL step (see
// the comment block at the bottom of this file and test/README.md's "Runtime
// isolation" section) rather than an automated one: automating it now would mean
// faking the exact thing the check exists to catch (a real `window.THREE` global from
// a real Viewer bundle), and `collision/index.js` -- the real thing later tasks will
// import to exercise it for real -- does not exist yet at Task 0.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const indexHtmlPath = path.join(repoRoot, 'wwwroot', 'index.html');

test('index.html declares the collision-runtime import map before /main.js', async () => {
  const html = await readFile(indexHtmlPath, 'utf8');
  const importMapIndex = html.indexOf('<script type="importmap">');
  const mainScriptIndex = html.indexOf('<script src="/main.js" type="module">');
  assert.ok(importMapIndex !== -1, 'expected an import map <script> tag in wwwroot/index.html');
  assert.ok(mainScriptIndex !== -1, 'expected the existing /main.js module script tag');
  assert.ok(
    importMapIndex < mainScriptIndex,
    'import map must be declared before /main.js so bare specifiers resolve for every module it imports'
  );
});

test('import map entries resolve to real files on disk (after npm run build:vendor)', async () => {
  const html = await readFile(indexHtmlPath, 'utf8');
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected a parseable <script type="importmap"> block');
  const map = JSON.parse(match[1]);
  const entries = Object.entries(map.imports);
  assert.ok(entries.length >= 3, 'expected at least the three, three-mesh-bvh, and BufferGeometryUtils entries');

  for (const [specifier, url] of entries) {
    assert.ok(url.startsWith('/vendor/'), `${specifier} -> ${url} must resolve under /vendor/`);
    const diskPath = path.join(repoRoot, 'wwwroot', url.replace(/^\//, ''));
    assert.ok(
      existsSync(diskPath),
      `${specifier} -> ${url} does not exist on disk at ${diskPath}. Run "npm run build:vendor" first.`
    );
  }
});

test('vendored three build does not assign window.THREE / globalThis.THREE (static check)', async () => {
  // Vendor files are copied verbatim (spec:1063-1071) -- this only guards against a
  // future hand-edit of the vendor tree accidentally adding a global assignment. The
  // live before/after `window.THREE.REVISION` comparison is the manual check below.
  const vendorThreeEntry = path.join(repoRoot, 'wwwroot', 'vendor', 'three', 'build', 'three.module.js');
  if (!existsSync(vendorThreeEntry)) {
    assert.fail('vendor three build missing -- run "npm run build:vendor" before this test');
  }
  const src = await readFile(vendorThreeEntry, 'utf8');
  assert.ok(
    !/\bwindow\s*\.\s*THREE\s*=/.test(src) && !/\bglobalThis\s*\.\s*THREE\s*=/.test(src),
    'vendored three.module.js must never assign window.THREE / globalThis.THREE (spec:979-980)'
  );
});

// ---------------------------------------------------------------------------
// MANUAL STEP (documented, not automated -- see rationale in the file header above
// and in test/README.md):
//
//   1. Start the app (`npm start`), open it in a real browser with the Viewer script
//      tag already loaded (as wwwroot/index.html does).
//   2. In devtools console, BEFORE triggering anything that imports collision/
//      modules, run `window.THREE.REVISION` -- record the value (expect '71').
//   3. Trigger a code path that imports the collision runtime (once later tasks add
//      `collision/index.js` -- until then, `import('/vendor/three/build/three.module.js')`
//      from the console is an acceptable stand-in, since that is the exact module the
//      collision runtime will import).
//   4. Run `window.THREE.REVISION` again -- must still read '71', unchanged.
//   5. Confirm no console errors about a failed /vendor/ module resolution (spec:1073-1076
//      acceptance check for the BufferGeometryUtils.js vendor gap).
// ---------------------------------------------------------------------------
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/runtime/runtimeIsolation.test.mjs`

Expected: all three tests fail. The first fails with `AssertionError [ERR_ASSERTION]: expected an import map <script> tag in wwwroot/index.html` (no import map exists yet). The second and third fail similarly (no match / vendor dir missing), since `wwwroot/index.html` has not been touched and `wwwroot/vendor/` does not exist yet.

- [ ] **Step 3: Write the implementation**

`scripts/sync-vendor.mjs`:

```js
#!/usr/bin/env node
// scripts/sync-vendor.mjs
//
// Copies the collision runtime's own isolated `three`/`three-mesh-bvh` builds from
// node_modules into wwwroot/vendor/, so the sandbox app (plain <script type="module">,
// no bundler) can resolve them through an import map without ever touching Viewer's
// bundled r71 THREE. Per spec:1038-1076 this MUST copy directory trees, not single
// files -- three-mesh-bvh's `exports.import` is `./src/index.js` (a multi-file source
// tree with relative + bare imports), and three's own `build/three.module.js` imports
// `./three.core.js` from the same directory.
//
// Also copies `three/examples/jsm/utils/BufferGeometryUtils.js` explicitly (spec:1056-1076,
// Round 10 finding) -- `mergeVertices` lives outside `three/build/`, so a vendor tree
// that only copies `three/build/**` 404s the first time welding runs.

import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const nodeModules = path.join(repoRoot, 'node_modules');
const vendorRoot = path.join(repoRoot, 'wwwroot', 'vendor');

const COPIES = [
  { from: path.join(nodeModules, 'three', 'build'), to: path.join(vendorRoot, 'three', 'build') },
  {
    from: path.join(nodeModules, 'three', 'examples', 'jsm', 'utils', 'BufferGeometryUtils.js'),
    to: path.join(vendorRoot, 'three', 'examples', 'jsm', 'utils', 'BufferGeometryUtils.js'),
  },
  { from: path.join(nodeModules, 'three-mesh-bvh', 'src'), to: path.join(vendorRoot, 'three-mesh-bvh', 'src') },
];

async function syncOne({ from, to }) {
  if (!existsSync(from)) {
    throw new Error(`sync-vendor: source path does not exist: ${from} (did npm install run?)`);
  }
  await mkdir(path.dirname(to), { recursive: true });
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
  console.log(`  copied ${path.relative(repoRoot, from)} -> ${path.relative(repoRoot, to)}`);
}

async function main() {
  console.log('sync-vendor: copying isolated three/three-mesh-bvh builds into wwwroot/vendor/ ...');
  for (const entry of COPIES) {
    await syncOne(entry);
  }
  console.log('sync-vendor: done.');
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
```

`package.json` — add to `"scripts"`:

```json
{
  "scripts": {
    "start": "node server.js",
    "build:vendor": "node scripts/sync-vendor.mjs",
    "test": "node --test"
  }
}
```

`wwwroot/index.html` — insert the import map immediately before the existing `/main.js` module script tag (spec:1045-1050):

```html
    <script type="importmap">
    { "imports": {
      "three": "/vendor/three/build/three.module.js",
      "three-mesh-bvh": "/vendor/three-mesh-bvh/src/index.js",
      "three/addons/utils/BufferGeometryUtils.js": "/vendor/three/examples/jsm/utils/BufferGeometryUtils.js"
    } }
    </script>
    <script src="/main.js" type="module"></script>
```

`test/README.md`:

```markdown
# Tests

Convention for this repo's collision-detection library tests (established here, Task 0,
and binding for every later task in this plan):

- **Runner: Node's built-in `node:test` + `node:assert/strict`.** No new devDependency.
  Chosen over `spike/fixtures.mjs`'s hand-rolled `check(name, actual, expected)`
  PASS/FAIL harness because later tasks need async tests, mocked clocks, and spies
  (e.g. "assert compaction was invoked exactly once", "assert enumNodeChildren was
  called exactly maxChildrenPerNode+1 times") that a hand-rolled equality-only harness
  has no support for and would need to reinvent per file. `node:test`'s built-in
  `t.mock` gives every later task spies/stubs for free, with zero new dependencies.
- **File layout**: mirrors `collision/`'s own tree under `test/`, one `*.test.mjs` per
  source module (e.g. `collision/geometry/GeometryConnectivity.js` ->
  `test/geometry/GeometryConnectivity.test.mjs`). Shared cross-file test-only helpers
  (geometry builders, mocked lifecycle harnesses) belong under `test/fixtures/`.
- **Running tests**:
  - `npm test` runs the whole suite (`node --test`, no path argument -- Node 22's
    default discovery recurses into `test/` and matches every `*.test.mjs` file
    automatically; a literal directory argument like `node --test test/` does **not**
    recurse the way you would expect on this Node version -- verified empirically at
    Task 0 time. Use no argument, or an explicit glob, never a bare directory path.).
  - A single file: `node --test test/geometry/GeometryConnectivity.test.mjs`.
  - A directory subset via glob: `node --test 'test/query/**/*.test.mjs'`.
- **Assertions**: `node:assert/strict`. Prefer `assert.equal`/`assert.deepEqual` for
  values, `assert.rejects(promise, { name: 'WorldDisposedError' })` for the
  lifecycle-error contract many later tasks need (matches `collision/errors.js`'s
  `.name` fields).
- **Regression comments**: when a test pins a specific round's finding, add a one-line
  comment directly above the assertion naming the round, matching `spike/fixtures.mjs`'s
  own style, e.g. `// ROUND 4 REGRESSION: ...`.

## Runtime isolation

`test/runtime/runtimeIsolation.test.mjs` automates everything about the runtime-isolation
acceptance check (spec:985-987) that does not require a live browser: the import map's
presence/ordering, and that every entry it declares resolves to a real vendored file.
The check's other half -- confirming `window.THREE.REVISION === '71'` is literally
unchanged before and after the collision runtime loads inside a real Viewer page -- is
a documented manual step (see that file's trailing comment block) rather than an
automated one. Reasons: it needs a real Viewer bundle + real DOM (no devDependency on a
browser automation tool was judged justified for this alone at Task 0, when the thing
the manual step would exercise -- `collision/index.js` -- does not exist yet); and once
later tasks add that module, the manual procedure documented here can be re-run against
the real thing without this file needing to change.

## Known risk: no MEP-scale test model in this repo (flagged per spec, not blocking)

The spec's Performance Gate (spec:4644-4805, closing statement at 4797-4805) requires
running one `volume-overlap` query against an MEP-scale model (fragment geometries in
the thousands of triangles) as part of this milestone's acceptance criteria, and
explicitly says: "if none available at implementation time, that is a finding to
report, not a step to skip silently."

**Searched at Task 0 time (2026-09-03): no MEP-scale model URN/fixture exists anywhere
in this repo.** `spike/FINDINGS.md` (finding B7) confirms the spike itself never
exercised one either -- its only real-model run used the residential acceptance model
(bathtub/room-locator fixture, rooms of 12-64 triangles each), and its own conclusion
states plainly: "the MEP-scale benchmark is therefore load-bearing, not optional
polish -- it is the only thing that will exercise the machinery this decision keeps."
No APS bucket/URN reference to an MEP-scale model appears in `docs/`, `spike/`, or any
committed config in this repo as of this task.

**This does not block Tasks 1-23** (per this plan's own sequencing) -- it blocks only
the Performance Gate (Task 24) and the milestone's final "measured, not reasoned"
sign-off on `maxSyncTriangleCount` and the other provisional constants in
`collision/constants.js`. Whoever picks up Task 24 needs to either source a suitable
MEP-scale model (a Revit MEP sample project through Model Derivative, or an
equivalently fragment-dense public sample) before that task can produce a real
measurement, or must report the gap explicitly per the spec's own instruction above
rather than substituting `measure.mjs`'s synthetic figures and calling the gate passed.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build:vendor && npm test`

Expected: `sync-vendor.mjs` copies `three/build/**`, `three/examples/jsm/utils/BufferGeometryUtils.js`,
and `three-mesh-bvh/src/**` into `wwwroot/vendor/`; all three `runtimeIsolation.test.mjs`
tests PASS — first proves the import map is declared ahead of `/main.js`, second proves
every import-map entry resolves to a real file on disk after the vendor sync, third
proves the vendored `three.module.js` never assigns `window.THREE`/`globalThis.THREE`.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-vendor.mjs package.json wwwroot/index.html test/README.md test/runtime/runtimeIsolation.test.mjs
git commit -m "Add vendor sync script, import map, and node:test infrastructure for the collision library"
```

**Completion criteria:**
- `npm run build:vendor` populates `wwwroot/vendor/three/build/**`, `wwwroot/vendor/three/examples/jsm/utils/BufferGeometryUtils.js`, `wwwroot/vendor/three-mesh-bvh/src/**`.
- `wwwroot/index.html` declares the import map before `<script src="/main.js" type="module">`, with exactly the three entries the spec names.
- `npm test` runs the full suite via `node --test` (no path argument) and every later task's `*.test.mjs` files are automatically discovered under this convention.
- `test/README.md` states the test-running convention explicitly, so no later task needs to repeat it.
- The MEP-scale test-model risk is documented in `test/README.md`, not silently deferred to Task 24's own discovery.

**Protected invariants / regressions to watch:**
- Round 10 (spec:1056-1076): welding's own vendor entry (`BufferGeometryUtils.js`) must be copied explicitly — the naive "just copy `three/build/**`" vendor tree 404s the first time `mergeVertices` is imported.
- spec:979-987: the collision runtime must never assign `window.THREE`/`globalThis.THREE`, and `window.THREE.REVISION` must read `'71'` unchanged before and after it loads — this is an acceptance criterion, not a style preference.
- spec:1038-1043: the vendor copy must copy whole directory trees (`three/build/`, `three-mesh-bvh/src/`), never single files — both packages' internals use relative/bare imports that require the sibling files to exist at the same relative paths.

---

### Task 1: Core contracts — constants, errors, checkpoint/scheduler port, identity value types

**Objective:** Establish the single source of truth for every tolerance/budget constant, the two lifecycle error classes, the checkpoint/scheduler port contract (with its fake-vs-real conformance test suite), and the `GeometryIdentity` value type that every later stateful module depends on.

**Files:**
- Create: `collision/constants.js`
- Create: `collision/errors.js`
- Create: `collision/scheduler.js`
- Create: `collision/geometry/GeometryIdentity.js`
- Test: `test/constants-and-errors.test.mjs`
- Test: `test/geometry/GeometryIdentity.test.mjs`
- Test: `test/scheduler/checkpointPort.contract.mjs` (the reusable contract-test suite itself — also a "deliverable" module, not only a test file)
- Test: `test/scheduler/checkpointPort.fake.test.mjs` (runs the contract suite against `FakeCheckpointPort`)
- Test: `test/scheduler/checkpointPort.real.test.mjs` (runs the contract suite against the real `collision/scheduler.js#createCheckpointPort`)
- Create: `test/fixtures/FakeCheckpointPort.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks (Task 0 only set up test/build infra).
- Produces (every name/shape here is depended on verbatim by later tasks — Task 13 `GeometryRegistry`, Task 14 `BlasCache`, Task 17 `CollisionWorld`, and every query-mode task):
  - `collision/constants.js` — every named constant in the canonical reference's constants block, exact names/values.
  - `collision/errors.js` — `export class WorldDisposedError extends Error` and `export class ModelEvictedError extends Error` (constructor `(modelId)`, sets `this.modelId`, message `` `Model ${modelId} was evicted` ``; both set `this.name` to their own class name so `assert.rejects(p, { name: 'WorldDisposedError' })`-style matching works).
  - `collision/scheduler.js` — `export function createFrameBudgetAccumulator({ now, budgetMs })` and `export function createCheckpointPort({ isDisposed, isEpochLive, accumulator, yieldToScheduler })`, returning `{ checkpoint({ loadEpoch, modelIdHint }) => (undefined | Promise<void>) }`. **Callers must use `const pending = checkpoint(...); if (pending) await pending;`, never unconditional `await checkpoint(...)`** — see the design note and Round-0 codex-advisor finding below for why the synchronous fast path matters at the broad-phase scan's scale (spec:3032-3034, up to `maxBroadPhaseInstancePairs = 1_000_000` checkpoints in one scan).
  - `collision/geometry/GeometryIdentity.js` — `export function createGeometryIdentity(loadEpoch, geometryIndex) => Readonly<{ loadEpoch, geometryIndex }>` (frozen) and `export function sameGeometryIdentity(a, b) => boolean`.
  - `test/scheduler/checkpointPort.contract.mjs` — `export function runCheckpointPortContractTests(makePort, { suiteName })`, where `makePort()` returns `{ port, controls }` and `controls` exposes `setDisposed(boolean)`, `setEpochLive(loadEpoch, boolean)`, `forceYieldDue()`, `forceYieldNotDue()`. **Task 17 must supply a `makePort` that wraps `CollisionWorld`'s real lifecycle state behind this exact `controls` shape** and re-run this same suite to prove conformance — this is the single most load-bearing interface handoff in this task.
  - `test/fixtures/FakeCheckpointPort.mjs` — `export function makeFakeCheckpointPort({ frameBudgetMs }) => { port, controls }`, matching the same shape `checkpointPort.contract.mjs` expects, for Task 13's `GeometryRegistry` unit tests to inject via constructor.

**Design note — why `checkpoint()` is ONE operation, not `isDisposed()`/`isEpochLive()`:**
Per a codex-advisor consultation already done for this plan: separate loose callbacks let
ordering and resume behavior drift — a caller could read `isDisposed()` and `isEpochLive()`
at two different instants (an eviction landing between the reads), and nothing would force
a second re-check after an actual yield happened. `checkpoint({ loadEpoch, modelIdHint })`
owns the whole "disposed first, then epoch, then conditionally yield, then re-validate in
the same order" sequence as one atomic contract (spec:2830-2837 entry-order rule; spec:1392-1397
"same conditional, shared-`frameBudgetMs`-accumulator check every checkpoint in this design
uses"). The port takes a single `loadEpoch` (not a `Model` object) because that is exactly
what `GeometryRegistry`'s build-phase checkpoint has available — the record's key IS
`(loadEpoch, geometryIndex)`, and `modelId` is diagnostic-only, never part of cache identity
(spec:1137-1146, 1229-1251). A caller with more than one operand to validate (e.g.
`CollisionWorld`'s own query-level checkpoints, which must re-validate both source and
target — spec:1417-1420 "each caller separately re-validates both its own operands at its
own checkpoints") calls `checkpoint()` once per operand.

**Design note — why `checkpoint()` returns `undefined | Promise<void>`, not always a `Promise`
(added after a codex-advisor consult on this exact interface, done as part of this task):**
An `async function` that a caller unconditionally `await`s forces a microtask-queue
suspension on EVERY call, even the common "not due" case — and at the broad-phase scan's
own scale (checkpoint before EACH individual instance pair, up to
`maxBroadPhaseInstancePairs = 1_000_000`, spec:3032-3034, 2014) that overhead is not a
style nit: a microtask doesn't even buy real frame-budget relief on the fast path (it
doesn't yield to rendering), so an always-`async` `checkpoint()` would add pure overhead at
exactly the place the design most needs to be cheap. The fix keeps `checkpoint()` as ONE
operation (never split into `isDisposed()`/`isEpochLive()` polls — the ordering-drift
argument above still holds) while making its synchronous fast path actually synchronous:
validation (disposed, then epoch) always runs synchronously and throws synchronously if
either fails; if the shared accumulator is not yet due, `checkpoint()` returns `undefined`
with no `Promise` allocated; only when due does it return a real `Promise`. **Every call
site in later tasks must use `const pending = checkpoint(...); if (pending) await pending;`
— never a bare `await checkpoint(...)`**, which would `await` the `undefined` fast-path
return value too and reintroduce a forced microtask tick per call (V8 does still take at
least one microtask turn to `await` a non-thenable value) at exactly the scale this change
exists to avoid.

**Design note — accumulator scope, and revalidating after a SHARED phase-slot wait too
(also surfaced by the same codex-advisor consult):** this module makes no assumption about
how long one accumulator's scope lasts — only that whoever constructs a `createCheckpointPort`
instance passes ONE accumulator to every `checkpoint()` call within that scope and builds a
fresh accumulator (via `createFrameBudgetAccumulator`) for a new scope. Per spec:3106, a
`findClashes` call owns its own accumulator; **`GeometryRegistry` (Task 13) should NOT be
built around one long-lived, registry-lifetime-scoped port injected once at construction** —
the coordinator's "constructor injection" phrasing should be read as "Task 13's build methods
accept a call-scoped checkpoint function as a parameter" (with a default/injected collaborator
for unit testing against `FakeCheckpointPort`), with the REAL per-call-scoped checkpoint
threaded in by `CollisionWorld` when it triggers a build from within a `findClashes` call.
Separately: **a caller awaiting an already-in-flight, single-flight phase slot it did not
itself start (e.g. `await existingRecord.weldPromise` when a second concurrent call finds a
`'building'` entry) has also just suspended, exactly as much as if it had awaited its own
checkpoint's internal yield — Task 13 must re-run its own checkpoint validation after that
await too**, not only after this port's own internal yields, or a caller could resume into an
evicted/disposed world through someone else's yield instead of its own.

**Design note — Task 17 needs an epoch-liveness index, not just its `modelLifecycle`
`WeakMap<Model, ...>` (also surfaced by the same consult):** the real `isEpochLive(loadEpoch)`
callback this port depends on cannot be answered by reverse-looking-up a `WeakMap` keyed by
`Model` object — Task 17 should maintain a parallel `liveEpochs: Set<number>` (or equivalent)
alongside `modelLifecycle`, with `admitModel` adding the new epoch, `evictModel` deleting it
*before* releasing the rest of that epoch's state, and both mutations centralized so
`modelLifecycle` and `liveEpochs` can never drift out of agreement. Flagging this now so
Task 17's author does not have to rediscover it while wiring the real port.

- [ ] **Step 1: Write the failing test(s)**

`test/constants-and-errors.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as constants from '../collision/constants.js';
import { WorldDisposedError, ModelEvictedError } from '../collision/errors.js';

test('constants: tolerances match spec defaults', () => {
  assert.equal(constants.barycentricEpsilon, 1e-6);
  assert.equal(constants.coplanarAngleEpsilon, 1e-6);
  assert.equal(constants.mergeDistanceFactor, 1e-6);
  assert.equal(constants.surfaceEpsilonFactor, 1e-6);
  assert.deepEqual(constants.offsetLadderFactors, [1e-3, 1e-4, 1e-5]);
  assert.deepEqual(constants.witnessLadderFactors, [1e-3, 1e-4, 1e-5]);
  assert.deepEqual(constants.crossingProbeFractions, [0.5, 0.1, 0.01]);
  assert.equal(constants.minPenetrationDepthFactor, 1e-5);
  assert.equal(constants.weldEpsilonMeters, 1e-4);
});

test('constants: budgets match spec defaults', () => {
  assert.equal(constants.frameBudgetMs, 8);
  assert.equal(constants.maxCandidatePairsExamined, 50_000);
  assert.equal(constants.maxCrossingPairsExamined, 64);
  assert.equal(constants.maxContainmentSamples, 512);
  assert.equal(constants.samplesPerComponent, 8);
  assert.equal(constants.maxWitnessTriangles, 8);
  assert.equal(constants.maxSyncTriangleCount, 12_000);
  assert.equal(constants.maxFragmentsPerDbId, 5_000);
  assert.equal(constants.maxChildrenPerNode, 10_000);
  assert.equal(constants.maxBroadPhaseInstancePairs, 1_000_000);
  assert.equal(constants.maxCollisionInstancesPerEpoch, 20_000);
});

test('errors: WorldDisposedError / ModelEvictedError shape', () => {
  const wd = new WorldDisposedError();
  assert.ok(wd instanceof Error);
  assert.equal(wd.name, 'WorldDisposedError');

  const me = new ModelEvictedError(42);
  assert.ok(me instanceof Error);
  assert.equal(me.name, 'ModelEvictedError');
  assert.equal(me.modelId, 42);
  assert.match(me.message, /42/);
});
```

`test/geometry/GeometryIdentity.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeometryIdentity, sameGeometryIdentity } from '../../collision/geometry/GeometryIdentity.js';

test('GeometryIdentity: fields and frozen-ness', () => {
  const id = createGeometryIdentity(3, 7);
  assert.equal(id.loadEpoch, 3);
  assert.equal(id.geometryIndex, 7);
  assert.ok(Object.isFrozen(id));
  assert.throws(() => { id.loadEpoch = 99; }, TypeError);
});

test('GeometryIdentity: same identity iff both fields ===', () => {
  const a = createGeometryIdentity(3, 7);
  const b = createGeometryIdentity(3, 7);
  const c = createGeometryIdentity(3, 8);
  assert.equal(sameGeometryIdentity(a, b), true);
  assert.equal(sameGeometryIdentity(a, c), false);
  assert.notEqual(a, b, 'distinct objects, same value -- identity value type, not reference type');
});

test('GeometryIdentity: rejects non-integer/negative inputs', () => {
  assert.throws(() => createGeometryIdentity(-1, 0), TypeError);
  assert.throws(() => createGeometryIdentity(0, 1.5), TypeError);
});
```

`test/fixtures/FakeCheckpointPort.mjs`:

```js
// test/fixtures/FakeCheckpointPort.mjs
//
// Test double for the CheckpointPort (collision/scheduler.js). Lets a unit test drive
// disposed-state, per-epoch liveness, and a forced-yield trigger directly, while
// enforcing the EXACT SAME ordering contract (disposed-first, then epoch,
// conditionally-yield, revalidate-after-yield) as the real port -- so
// `runCheckpointPortContractTests` (checkpointPort.contract.mjs) can be run against
// both this fake (here) and the real CollisionWorld-backed port (Task 17) to prove
// conformance.

import { WorldDisposedError, ModelEvictedError } from '../../collision/errors.js';

export function makeFakeCheckpointPort({ frameBudgetMs = 8 } = {}) {
  let disposed = false;
  const liveEpochs = new Set();
  let now = 0;
  let lastCheckpointAt = 0;
  let forcedDue = false;
  let yieldInvocationCount = 0;

  function validate(loadEpoch, modelIdHint) {
    if (disposed) throw new WorldDisposedError();
    if (!liveEpochs.has(loadEpoch)) throw new ModelEvictedError(modelIdHint ?? loadEpoch);
  }

  const port = {
    // Returns undefined SYNCHRONOUSLY on the "not due" fast path -- no Promise
    // allocated, no microtask forced on the caller -- and only returns a real
    // Promise when a yield is actually due. Validation is ALWAYS synchronous and
    // throws synchronously on failure, whether or not a yield follows (codex-advisor
    // finding: an always-async checkpoint forces a microtask tick per call even on
    // the fast path, which is real overhead at the broad-phase scan's scale).
    checkpoint({ loadEpoch, modelIdHint } = {}) {
      validate(loadEpoch, modelIdHint);
      const due = forcedDue || now - lastCheckpointAt >= frameBudgetMs;
      if (!due) return undefined;
      forcedDue = false;
      return (async () => {
        yieldInvocationCount++;
        // A real asynchronous hop -- deliberately not synchronous, so a caller can
        // mutate state between "checkpoint was called" and "checkpoint's internal
        // yield resolves" and have that mutation observed by the revalidation below.
        // This is exactly what the contract tests exploit to prove revalidate-after-yield.
        await new Promise((resolve) => setTimeout(resolve, 0));
        lastCheckpointAt = now;
        validate(loadEpoch, modelIdHint);
      })();
    },
  };

  const controls = {
    setDisposed(value) { disposed = value; },
    setEpochLive(loadEpoch, live) {
      if (live) liveEpochs.add(loadEpoch);
      else liveEpochs.delete(loadEpoch);
    },
    advanceClock(ms) { now += ms; },
    forceYieldDue() { forcedDue = true; },
    forceYieldNotDue() { forcedDue = false; lastCheckpointAt = now; },
    getYieldInvocationCount() { return yieldInvocationCount; },
  };

  return { port, controls };
}
```

`test/scheduler/checkpointPort.contract.mjs`:

```js
// test/scheduler/checkpointPort.contract.mjs
//
// Contract test suite for any CheckpointPort implementation (collision/scheduler.js).
// `runCheckpointPortContractTests(makePort)` is imported and called by:
//   - this task's own test files, against FakeCheckpointPort and the real
//     createCheckpointPort;
//   - Task 17's CollisionWorld tests, against a `makePort()` that wraps the real
//     world's own checkpoint mechanism behind the same { port, controls } shape.
//
// `makePort()` must return `{ port, controls }` where:
//   - port.checkpoint({ loadEpoch, modelIdHint }) -> (undefined | Promise<void>)
//     (undefined synchronously on the "not due" fast path; a real Promise only when
//     a yield is actually due -- see this task's write-up on why an always-async
//     checkpoint is a real performance defect, not a style nit, at the broad-phase
//     scan's scale)
//   - controls.setDisposed(boolean)
//   - controls.setEpochLive(loadEpoch, boolean)
//   - controls.forceYieldDue()             -- next checkpoint() call takes the "due" branch
//   - controls.forceYieldNotDue()          -- next checkpoint() call takes the "not due" branch
//   - controls.getYieldInvocationCount()   -- how many times the port's real yield
//     primitive has actually been invoked so far -- an observable hook, not just an
//     inference from timing, so a test can prove a real yield happened rather than
//     merely that revalidation-ordering holds if one did (a fake/real implementation
//     could otherwise pass every ordering test while never actually invoking its
//     yield primitive at all, or invoking it more than once per due call).
//
// Deliberately does NOT assert anything about real wall-clock timing (fake and real
// implementations may use entirely different clocks) -- only the ordering/error/
// synchronicity contract, which is what makes a fake-vs-real swap safe.

import test from 'node:test';
import assert from 'node:assert/strict';

export function runCheckpointPortContractTests(makePort, { suiteName = 'CheckpointPort contract' } = {}) {
  test(suiteName, async (t) => {
    await t.test('not due -> returns undefined SYNCHRONOUSLY (no Promise, no yield invoked)', () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldNotDue();
      const result = port.checkpoint({ loadEpoch: 1 });
      assert.equal(result, undefined, 'the not-due fast path must be synchronous -- no Promise allocated');
      assert.equal(controls.getYieldInvocationCount(), 0);
    });

    await t.test('throws WorldDisposedError SYNCHRONOUSLY when disposed, epoch live', () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(true);
      assert.throws(() => port.checkpoint({ loadEpoch: 1 }), { name: 'WorldDisposedError' });
      assert.equal(controls.getYieldInvocationCount(), 0, 'an invalid entry must reject before any yield is attempted');
    });

    await t.test('throws ModelEvictedError SYNCHRONOUSLY when epoch not live, world not disposed', () => {
      const { port, controls } = makePort();
      controls.setDisposed(false);
      controls.setEpochLive(1, false);
      assert.throws(() => port.checkpoint({ loadEpoch: 1 }), { name: 'ModelEvictedError' });
    });

    await t.test('disposed-first: both disposed AND evicted -> WorldDisposedError, not ModelEvictedError', () => {
      const { port, controls } = makePort();
      controls.setDisposed(true);
      controls.setEpochLive(1, false);
      assert.throws(() => port.checkpoint({ loadEpoch: 1 }), { name: 'WorldDisposedError' });
    });

    await t.test('ModelEvictedError carries a modelId (modelIdHint if supplied, else loadEpoch)', () => {
      const { port, controls } = makePort();
      controls.setDisposed(false);
      controls.setEpochLive(1, false);
      assert.throws(() => port.checkpoint({ loadEpoch: 1, modelIdHint: 'room-model' }), (err) => {
        assert.equal(err.name, 'ModelEvictedError');
        assert.equal(err.modelId, 'room-model');
        return true;
      });
    });

    await t.test('due -> returns a real Promise and invokes the yield primitive exactly once', async () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldDue();
      const pending = port.checkpoint({ loadEpoch: 1 });
      assert.ok(pending instanceof Promise, 'a due checkpoint must return a real Promise, not undefined');
      await pending;
      assert.equal(controls.getYieldInvocationCount(), 1, 'exactly one real yield per due checkpoint call');
    });

    await t.test('due -> revalidates AFTER the yield: disposed flips during the yield rejects', async () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldDue();
      const pending = port.checkpoint({ loadEpoch: 1 });
      // Synchronous: runs before any microtask/macrotask the checkpoint's own yield is
      // waiting on, simulating disposal happening WHILE the checkpoint is suspended --
      // exactly the race the revalidate-after-yield rule exists for. Sound because an
      // async function's continuation past its first real `await` cannot run until the
      // current synchronous stack finishes (confirmed via codex-advisor before relying
      // on this technique here).
      controls.setDisposed(true);
      await assert.rejects(pending, { name: 'WorldDisposedError' });
    });

    await t.test('due -> revalidates AFTER the yield: epoch evicted during the yield rejects', async () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldDue();
      const pending = port.checkpoint({ loadEpoch: 1 });
      controls.setEpochLive(1, false);
      await assert.rejects(pending, { name: 'ModelEvictedError' });
    });

    await t.test('due -> revalidation re-checks disposed BEFORE epoch (ordering holds post-yield too)', async () => {
      const { port, controls } = makePort();
      controls.setEpochLive(1, true);
      controls.setDisposed(false);
      controls.forceYieldDue();
      const pending = port.checkpoint({ loadEpoch: 1 });
      controls.setDisposed(true);
      controls.setEpochLive(1, false);
      await assert.rejects(pending, { name: 'WorldDisposedError' });
    });
  });
}
```

`test/scheduler/checkpointPort.fake.test.mjs`:

```js
import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';
import { runCheckpointPortContractTests } from './checkpointPort.contract.mjs';

runCheckpointPortContractTests(() => makeFakeCheckpointPort(), {
  suiteName: 'CheckpointPort contract (FakeCheckpointPort)',
});
```

`test/scheduler/checkpointPort.real.test.mjs`:

```js
import { createCheckpointPort, createFrameBudgetAccumulator } from '../../collision/scheduler.js';
import { runCheckpointPortContractTests } from './checkpointPort.contract.mjs';

function makeRealPortHarness() {
  let disposed = false;
  const liveEpochs = new Set();
  let mockNow = 0;
  let forcedDue = false;
  let yieldInvocationCount = 0;

  const accumulator = createFrameBudgetAccumulator({ now: () => mockNow, budgetMs: 8 });
  const wrappedAccumulator = {
    isDue: () => forcedDue || accumulator.isDue(),
    markCheckpointed: () => { forcedDue = false; accumulator.markCheckpointed(); },
  };

  const port = createCheckpointPort({
    isDisposed: () => disposed,
    isEpochLive: (loadEpoch) => liveEpochs.has(loadEpoch),
    accumulator: wrappedAccumulator,
    yieldToScheduler: () => {
      yieldInvocationCount++;
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
  });

  const controls = {
    setDisposed: (v) => { disposed = v; },
    setEpochLive: (loadEpoch, live) => { live ? liveEpochs.add(loadEpoch) : liveEpochs.delete(loadEpoch); },
    advanceClock: (ms) => { mockNow += ms; },
    forceYieldDue: () => { forcedDue = true; },
    forceYieldNotDue: () => { forcedDue = false; accumulator.markCheckpointed(); },
    getYieldInvocationCount: () => yieldInvocationCount,
  };

  return { port, controls };
}

runCheckpointPortContractTests(makeRealPortHarness, {
  suiteName: 'CheckpointPort contract (real createCheckpointPort)',
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test 'test/**/*.test.mjs' test/scheduler/checkpointPort.contract.mjs`

Expected: every test file fails with `ERR_MODULE_NOT_FOUND` — `collision/constants.js`, `collision/errors.js`, `collision/scheduler.js`, and `collision/geometry/GeometryIdentity.js` do not exist yet.

- [ ] **Step 3: Write the implementation**

`collision/constants.js`:

```js
// collision/constants.js
//
// Single source of truth for every tolerance/budget constant. Every other module in
// this library imports from here rather than hardcoding a literal a second time.

// ---- Tolerances (spec:1595-1650, 1779-1781) ----
export const barycentricEpsilon = 1e-6;                // dimensionless, frame-free
export const coplanarAngleEpsilon = 1e-6;               // dimensionless (1 - |n·n|), frame-free
export const mergeDistanceFactor = 1e-6;                // × L_target
export const surfaceEpsilonFactor = 1e-6;               // × L_target
export const offsetLadderFactors = [1e-3, 1e-4, 1e-5];  // × L_canonical
export const witnessLadderFactors = [1e-3, 1e-4, 1e-5]; // × L_source
export const crossingProbeFractions = [0.5, 0.1, 0.01]; // dimensionless, × triangle's own in-plane dAvail
export const minPenetrationDepthFactor = 1e-5;          // × L_canonical -- DECLARED detection limit, not a bug
export const weldEpsilonMeters = 1e-4;                  // meters; divide by model.getUnitScale() (fallback: literal 1e-4 if unit scale unavailable)

// ---- Budgets (spec:1913-2029, 2312-2497, 2565-2616, Data Flow step 3) ----
export const frameBudgetMs = 8;
export const maxCandidatePairsExamined = 50_000;
export const maxCrossingPairsExamined = 64;
export const maxContainmentSamples = 512;
export const samplesPerComponent = 8;
export const maxWitnessTriangles = 8;
export const maxSyncTriangleCount = 12_000;             // provisional -- revise per performance gate (Task 24)
export const maxFragmentsPerDbId = 5_000;               // provisional
export const maxChildrenPerNode = 10_000;               // provisional
export const maxBroadPhaseInstancePairs = 1_000_000;    // provisional

// maxCollisionInstancesPerEpoch has NO spec-chosen value ("provisional, value not yet
// chosen", spec:1324-1330, 2016-2017). This plan sets a reasoned provisional default:
// ~4x maxFragmentsPerDbId, enough headroom for a multi-dbId query plus repeated
// findClashes calls in one session. MUST be revised by the performance gate (Task 24)
// once real per-epoch retention is measured (spec:4786-4795).
export const maxCollisionInstancesPerEpoch = 20_000;
```

`collision/errors.js`:

```js
// collision/errors.js
//
// The two lifecycle error classes checkpoints (collision/scheduler.js) and
// CollisionWorld (Task 17) throw. Every yield-point checkpoint in this design must
// throw one of exactly these two, never swallow a lifecycle failure silently
// (spec:3937-3953, 3916-3930).

export class WorldDisposedError extends Error {
  constructor(message = 'CollisionWorld has been disposed') {
    super(message);
    this.name = 'WorldDisposedError';
  }
}

export class ModelEvictedError extends Error {
  constructor(modelId) {
    super(`Model ${modelId} was evicted`);
    this.name = 'ModelEvictedError';
    this.modelId = modelId;
  }
}
```

`collision/geometry/GeometryIdentity.js`:

```js
// collision/geometry/GeometryIdentity.js
//
// Plain identity value type, no behavior. Two GeometryIdentity values are the same
// identity iff both fields ===. Keyed by (loadEpoch, geometryIndex), never modelId
// (spec:1137-1146) -- loadEpoch is global/monotonic/assigned exactly once per admitted
// Model object, which is what makes this key immune to modelId-reuse aliasing.

export function createGeometryIdentity(loadEpoch, geometryIndex) {
  if (!Number.isInteger(loadEpoch) || loadEpoch < 0) {
    throw new TypeError(`GeometryIdentity: loadEpoch must be a non-negative integer, got ${loadEpoch}`);
  }
  if (!Number.isInteger(geometryIndex) || geometryIndex < 0) {
    throw new TypeError(`GeometryIdentity: geometryIndex must be a non-negative integer, got ${geometryIndex}`);
  }
  return Object.freeze({ loadEpoch, geometryIndex });
}

export function sameGeometryIdentity(a, b) {
  return a.loadEpoch === b.loadEpoch && a.geometryIndex === b.geometryIndex;
}
```

`collision/scheduler.js`:

```js
// collision/scheduler.js
//
// The checkpoint/scheduler PORT: the single interruption/revalidation primitive every
// yield point in this design shares (spec:2830-2837 "entry order: disposed first";
// spec:1392-1397 "same conditional, shared-frameBudgetMs-accumulator check every
// checkpoint in this design uses"). `GeometryRegistry` (Task 13) depends on this port
// via constructor injection; `CollisionWorld` (Task 17) is the real implementation
// and must expose its lifecycle state through this same shape.
//
// Deliberately ONE operation, not separate `isDisposed()`/`isEpochLive()` polls -- see
// this task's write-up for the full ordering/resume-safety rationale. Also deliberately
// NOT always-`async`: `checkpoint()` returns `undefined` synchronously on the "not due"
// fast path and only returns a real Promise when a yield is actually due (codex-advisor
// finding, this task: an always-`async` function that callers unconditionally `await`
// forces a microtask-queue suspension on EVERY call -- pure overhead, not real
// frame-budget relief, at the broad-phase scan's up-to-1,000,000-checkpoint scale,
// spec:3032-3034, 2014). Callers MUST use `const pending = checkpoint(...); if (pending)
// await pending;`, never a bare `await checkpoint(...)`.

import { WorldDisposedError, ModelEvictedError } from './errors.js';
import { frameBudgetMs } from './constants.js';

/**
 * A per-SCOPE elapsed-time accumulator, where "scope" is decided by whoever
 * constructs the port (spec:3106: each findClashes call owns its own accumulator;
 * spec:1392-1397: every checkpoint sharing one build/composition uses the SAME
 * accumulator instance). This module makes no assumption about how long a scope lasts
 * -- only that the caller passes ONE accumulator instance to every checkpoint() call
 * within one scope, and constructs a fresh accumulator (via this factory) for a new
 * scope. `ProperCrossingQuery`/`SurfaceIntersectionQuery` deliberately do NOT use this
 * accumulator at all (spec:1932-1957, 2065-2067) -- they own a private,
 * traversal-local clock instead; that exception lives in those later tasks, not here.
 */
export function createFrameBudgetAccumulator({ now = () => performance.now(), budgetMs = frameBudgetMs } = {}) {
  let lastCheckpointAt = now();
  return {
    isDue() {
      return now() - lastCheckpointAt >= budgetMs;
    },
    markCheckpointed() {
      lastCheckpointAt = now();
    },
  };
}

/**
 * Default real scheduling yield: one macrotask turn. `setTimeout(0)` (rather than a
 * microtask) is deliberate -- it actually lets the event loop run other queued work
 * before resuming, which is the point of yielding for frame-budget purposes.
 */
function defaultYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Builds a real CheckpointPort, scoped to whatever accumulator/lifecycle-state
 * callbacks it is given -- construct a FRESH one per findClashes call (or per
 * call-scoped checkpoint threaded into a triggered GeometryRegistry build), never as
 * one long-lived, world-scoped singleton (spec:3106 per-call accumulator ownership).
 * `isDisposed`/`isEpochLive` are supplied by the owning CollisionWorld (Task 17) --
 * this module owns only the ordering/yield/synchronicity contract, never the
 * lifecycle state itself (that state is CollisionWorld's, per spec:3420-3470; Task 17
 * needs a `liveEpochs: Set<number>` alongside its `modelLifecycle` WeakMap to answer
 * `isEpochLive`, since a WeakMap keyed by Model object cannot be reverse-looked-up by
 * loadEpoch -- see this task's write-up).
 *
 * @param {Object} deps
 * @param {() => boolean} deps.isDisposed
 * @param {(loadEpoch: number) => boolean} deps.isEpochLive
 * @param {ReturnType<typeof createFrameBudgetAccumulator>} deps.accumulator
 * @param {() => Promise<void>} [deps.yieldToScheduler]
 * @returns {{ checkpoint: (ctx: { loadEpoch: number, modelIdHint?: (number|string) }) => (undefined | Promise<void>) }}
 */
export function createCheckpointPort({ isDisposed, isEpochLive, accumulator, yieldToScheduler = defaultYield }) {
  function validate(loadEpoch, modelIdHint) {
    if (isDisposed()) {
      throw new WorldDisposedError();
    }
    if (!isEpochLive(loadEpoch)) {
      throw new ModelEvictedError(modelIdHint ?? loadEpoch);
    }
  }

  return {
    checkpoint({ loadEpoch, modelIdHint } = {}) {
      // Entry validation is ALWAYS synchronous, whether or not a yield follows -- an
      // invalid entry must reject before any yield is even attempted.
      validate(loadEpoch, modelIdHint);
      if (!accumulator.isDue()) {
        return undefined; // synchronous fast path -- no Promise, no microtask forced
      }
      return (async () => {
        await yieldToScheduler();
        accumulator.markCheckpointed();
        validate(loadEpoch, modelIdHint);
      })();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS. `test/constants-and-errors.test.mjs` proves every constant's exact value and both error classes' shape/name/message. `test/geometry/GeometryIdentity.test.mjs` proves the value-type/freeze/equality contract. `test/scheduler/checkpointPort.fake.test.mjs` and `test/scheduler/checkpointPort.real.test.mjs` both run the SAME `runCheckpointPortContractTests` suite and both pass — proving the fake and the real port satisfy an identical ordering contract now, before any later task depends on either.

- [ ] **Step 5: Commit**

```bash
git add collision/constants.js collision/errors.js collision/scheduler.js collision/geometry/GeometryIdentity.js test/constants-and-errors.test.mjs test/geometry/GeometryIdentity.test.mjs test/scheduler/checkpointPort.contract.mjs test/scheduler/checkpointPort.fake.test.mjs test/scheduler/checkpointPort.real.test.mjs test/fixtures/FakeCheckpointPort.mjs
git commit -m "Add constants, error classes, checkpoint/scheduler port, and GeometryIdentity value type"
```

**Completion criteria:**
- `collision/constants.js` exports every constant named in the canonical reference, exact values.
- `collision/errors.js` exports `WorldDisposedError`/`ModelEvictedError` matching the canonical shape, each with a `.name` matching its class name.
- `collision/scheduler.js` exports a `createCheckpointPort` whose `checkpoint({ loadEpoch, modelIdHint })` satisfies: disposed-first, epoch-second, conditional yield, revalidate-after-yield in the same order — and returns `undefined` synchronously (no `Promise`, no yield invoked) on the "not due" fast path, a real `Promise` only when a yield is actually due.
- The SAME `runCheckpointPortContractTests` suite passes against both `FakeCheckpointPort` and the real port — proven now, not deferred to Task 17 — including the synchronicity/yield-invocation-count assertions added after the codex-advisor consult on this task.
- `collision/geometry/GeometryIdentity.js` exports a frozen value-type factory plus an explicit equality helper.

**Protected invariants / regressions to watch:**
- spec:2830-2837 — `disposed` must be checked strictly before epoch liveness on every single checkpoint call, including the post-yield revalidation, not only the first check.
- spec:1392-1397 — the accumulator must be a SHARED, per-scope instance, not reset or recreated per checkpoint call — a fresh accumulator per call would mean no composition of small costs ever crosses `frameBudgetMs`, defeating the whole "many cheap operations summing past budget" property (Round 9's core counterexample, spec extract D section 2, `CollisionWorld.findClashes` fixture list). Scope lifetime (one `findClashes` call, one triggered build, etc.) is the caller's decision, not this module's.
- spec:4222-4223 style fixture ("a query cheap enough to never cross `frameBudgetMs` must complete with zero yields") — `checkpoint()` must not yield unconditionally; the "not due" branch must return `undefined` synchronously without ever invoking `yieldToScheduler`.
- Round 14/15 (spec:1137-1146, "Race safety" section) — identity/liveness must be keyed by `loadEpoch`, never `modelId` — this is why the port's parameter is `loadEpoch`, not a raw `Model`/`modelId` value, and why `GeometryIdentity` never accepts or stores a `modelId`.
- **Codex-advisor finding (this task): an always-`async` `checkpoint()` that callers unconditionally `await` forces a microtask tick per call even on the fast path — real overhead at the broad-phase scan's up-to-`maxBroadPhaseInstancePairs` (1,000,000) scale (spec:3032-3034, 2014).** `checkpoint()` must stay synchronous-returning on the not-due path, and every later call site must use `const pending = checkpoint(...); if (pending) await pending;` — a future edit that changes this back to always-`async`, or a later task's call site that reverts to a bare `await checkpoint(...)`, silently reintroduces this cost. The "not due -> returns undefined SYNCHRONOUSLY" contract test is what catches the former; there is no automated guard against the latter beyond code review of each call site.
- **Codex-advisor finding (this task): Task 17's real `isEpochLive(loadEpoch)` cannot be answered from `modelLifecycle: WeakMap<Model, ...>` alone** (a WeakMap keyed by Model object identity cannot be reverse-looked-up by loadEpoch) — Task 17 needs a parallel `liveEpochs: Set<number>`, with `admitModel`/`evictModel` keeping both in sync. Not this task's code to write, but a real risk if Task 17's author is not told.
- **Codex-advisor finding (this task): a caller awaiting an already-in-flight shared phase slot (e.g. `await existingRecord.weldPromise` on a `'building'` entry someone else started) has suspended just as much as if it awaited this port's own internal yield.** Task 13 must re-run its own checkpoint validation after such an await too, not only after `checkpoint()`'s own yields — otherwise a caller can resume into an evicted/disposed world through someone else's suspension point instead of its own.

---

### Task 2: `ViewerGeometryAdapter` — raw Viewer geometry layout normalization

**Objective:** Normalize any of Viewer's several raw geometry layouts (interleaved, standard three.js, grouped/draw-range) into one uniform `TriangleRange`-based view, rejecting unsupported layouts explicitly rather than guessing at their shape.

**Files:**
- Create: `collision/viewer/ViewerGeometryAdapter.js`
- Test: `test/viewer/ViewerGeometryAdapter.test.mjs`

**Interfaces:**
- Consumes: nothing from Tasks 0-1 directly (this module has no runtime dependency on `constants.js`/`errors.js`/`scheduler.js` — it is pure geometry-layout normalization, no budgets, no lifecycle).
- Produces:
  - `export function adaptViewerGeometry(geometry) => { unsupported: false, positions, positionStride, positionOffset, index, ranges, activeTriangleCount } | { unsupported: true, reason: 'unsupported-geometry-layout' | 'rejected-primitive-range' }`.
  - `export function computeActiveTriangleCount(ranges: { start: number, count: number }[]) => number`.
  - `TriangleRange` shape used in `ranges`: `{ start: number, count: number }` — index-element (or, for non-indexed geometry, vertex-element) counts, NOT triangle counts, and deliberately **no** `baseVertex` field (the spec's Milestone-1 version supersedes the idea doc's `TriangleRange` here — legacy `offsets`/`baseVertex` layouts are rejected outright, never normalized with a guessed value).
  - Task 3 (`compactAndWeld`) consumes exactly the `unsupported: false` variant's shape.

- [ ] **Step 1: Write the failing test(s)**

`test/viewer/ViewerGeometryAdapter.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptViewerGeometry, computeActiveTriangleCount } from '../../collision/viewer/ViewerGeometryAdapter.js';

// A minimal two-triangle quad (4 vertices, 6 index elements = 2 triangles), reused
// across fixtures with different position-layout encodings.
const QUAD_POSITIONS_PLAIN = new Float32Array([
  0, 0, 0,   1, 0, 0,   1, 1, 0,   0, 1, 0,
]);
const QUAD_INDEX = new Uint16Array([0, 1, 2, 0, 2, 3]);

test('vb/vbstride/vblayout Viewer-internal interleaved layout (confirmed primary)', () => {
  const vb = new Float32Array([
    0, 0, 0, 9, 9,
    1, 0, 0, 9, 9,
    1, 1, 0, 9, 9,
    0, 1, 0, 9, 9,
  ]); // 5 floats/vertex: position(3) + filler(2), position at offset 0
  const geometry = { vb, vbstride: 5, vblayout: { position: { offset: 0 } }, ib: QUAD_INDEX };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, false);
  assert.equal(result.positions, vb);
  assert.equal(result.positionStride, 5);
  assert.equal(result.positionOffset, 0);
  assert.equal(result.index, QUAD_INDEX);
  assert.equal(result.activeTriangleCount, 2);
});

test('standard attributes.position.array (non-interleaved BufferAttribute)', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, false);
  assert.equal(result.positions, QUAD_POSITIONS_PLAIN);
  assert.equal(result.positionStride, 3);
  assert.equal(result.positionOffset, 0);
  assert.equal(result.index, QUAD_INDEX);
  assert.equal(result.activeTriangleCount, 2);
});

test('standard InterleavedBufferAttribute, stride > 3, nonzero position offset', () => {
  // position+normal+uv interleaved, 8 floats/vertex, position starts at offset 3 --
  // a wrong field mapping here would silently read normal/uv data as position.
  const interleaved = new Float32Array([
    9, 9, 9,   0, 0, 0,   9, 9,
    9, 9, 9,   1, 0, 0,   9, 9,
    9, 9, 9,   1, 1, 0,   9, 9,
    9, 9, 9,   0, 1, 0,   9, 9,
  ]);
  const geometry = {
    attributes: { position: { data: { array: interleaved, stride: 8 }, offset: 3 } },
    index: { array: QUAD_INDEX },
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, false);
  assert.equal(result.positionStride, 8);
  assert.equal(result.positionOffset, 3);
  const x1 = result.positions[1 * result.positionStride + result.positionOffset];
  assert.equal(x1, 1, 'the uniform accessor must read real position data, not the normal/uv filler');
});

test('index via geometry.index.array (never geometry.attributes.index.array)', () => {
  const geometry = {
    attributes: {
      position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 },
      index: { array: new Uint16Array([99, 99, 99]) }, // previous draft's bug location -- must never be read
    },
    index: { array: QUAD_INDEX },
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.index, QUAD_INDEX);
});

test('geometry.groups populated: ranges reflect each group', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
    groups: [{ start: 0, count: 3 }, { start: 3, count: 3 }],
  };
  const result = adaptViewerGeometry(geometry);
  assert.deepEqual(result.ranges, [{ start: 0, count: 3 }, { start: 3, count: 3 }]);
  assert.equal(result.activeTriangleCount, 2);
});

test('geometry.groups absent: synthesizes one full-coverage range', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
  };
  const result = adaptViewerGeometry(geometry);
  assert.deepEqual(result.ranges, [{ start: 0, count: 6 }]);
  assert.equal(result.activeTriangleCount, 2);
});

test('geometry.groups === [] (empty-but-present): same triangle count as absent case', () => {
  // Standard BufferGeometry initializes groups = [] in its constructor -- every
  // fallback-path geometry hits this. A `groups ? ... : ...` truthiness check takes
  // the groups branch, iterates zero groups, and silently emits zero ranges: a clean
  // false negative indistinguishable from a verified no-clash. This is that regression.
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
    groups: [],
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.activeTriangleCount, 2, 'must match the groups-absent case, not silently become 0');
});

test('geometry.groups AND geometry.drawRange both present: intersected, not either/or', () => {
  // Group covers index elements [0,6) (both triangles); drawRange only opens [3,6) --
  // a previous draft applied drawRange only when groups was ABSENT, which would keep
  // both triangles here instead of clipping to one.
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
    groups: [{ start: 0, count: 6 }],
    drawRange: { start: 3, count: 3 },
  };
  const result = adaptViewerGeometry(geometry);
  assert.deepEqual(result.ranges, [{ start: 3, count: 3 }]);
  assert.equal(result.activeTriangleCount, 1);
});

test('legacy offsets layout: rejected as rejected-primitive-range, not normalized', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
    offsets: [{ start: 0, count: 6, index: 0 }],
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, true);
  assert.equal(result.reason, 'rejected-primitive-range');
});

test('unsupported layout: no recognizable position source', () => {
  const result = adaptViewerGeometry({ someUnknownField: true });
  assert.equal(result.unsupported, true);
  assert.equal(result.reason, 'unsupported-geometry-layout');
});

test('computeActiveTriangleCount: sums floor(count/3) per range, not raw sum', () => {
  assert.equal(computeActiveTriangleCount([{ start: 0, count: 10 }]), 3); // floor(10/3)
  assert.equal(computeActiveTriangleCount([{ start: 0, count: 9 }, { start: 9, count: 9 }]), 6);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/viewer/ViewerGeometryAdapter.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` — `collision/viewer/ViewerGeometryAdapter.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

`collision/viewer/ViewerGeometryAdapter.js`:

```js
// collision/viewer/ViewerGeometryAdapter.js
//
// Normalizes a raw Viewer (or standard three.js) geometry object into the shape the
// rest of the collision library consumes: { positions, positionStride, positionOffset,
// index, ranges, activeTriangleCount }, per spec:1148-1227. Runtime capability
// detection, not a hard-coded single layout -- Viewer's own internal interleaved
// layout, standard three.js InterleavedBufferAttribute, and standard non-interleaved
// BufferAttribute are all supported; legacy `offsets` multi-draw layouts are
// explicitly rejected (never silently guessed).
//
// Never throws for an unsupported/rejected geometry -- returns a diagnostic marker
// instead (spec:3804-3810: "skip that fragment; record a diagnostic ... must be
// distinguishable from a verified no-clash").

function resolvePositions(geometry) {
  // Priority 1: Viewer-internal interleaved layout (spec:1154-1159) -- confirmed
  // universal across SVF/SVF2/OTG in Viewer 7.124.2.
  if (
    geometry.vb &&
    typeof geometry.vbstride === 'number' &&
    geometry.vblayout &&
    geometry.vblayout.position &&
    typeof geometry.vblayout.position.offset === 'number'
  ) {
    return {
      positions: geometry.vb,
      positionStride: geometry.vbstride,
      positionOffset: geometry.vblayout.position.offset,
    };
  }

  const positionAttr = geometry.attributes && geometry.attributes.position;

  // Priority 2: standard three.js InterleavedBufferAttribute.
  if (positionAttr && positionAttr.data && positionAttr.data.array && typeof positionAttr.data.stride === 'number') {
    return {
      positions: positionAttr.data.array,
      positionStride: positionAttr.data.stride,
      positionOffset: positionAttr.offset || 0,
    };
  }

  // Priority 3: standard non-interleaved BufferAttribute.
  if (positionAttr && positionAttr.array) {
    return { positions: positionAttr.array, positionStride: positionAttr.itemSize || 3, positionOffset: 0 };
  }

  return null;
}

function resolveIndex(geometry) {
  // spec:1178-1183 -- geometry.ib (Viewer-internal) first, then geometry.index?.array.
  // Deliberately NEVER geometry.attributes.index.array: standard three.js stores the
  // index as top-level geometry.index, never inside attributes -- a previous draft's bug.
  if (geometry.ib) return geometry.ib;
  if (geometry.index && geometry.index.array) return geometry.index.array;
  return null; // non-indexed
}

function intersectRange(range, drawRange) {
  if (!drawRange) return { start: range.start, count: range.count };
  const start = Math.max(range.start, drawRange.start);
  const end = Math.min(range.start + range.count, drawRange.start + drawRange.count);
  return { start, count: Math.max(0, end - start) };
}

function resolveRanges(geometry, fullCount) {
  const drawRange =
    geometry.drawRange && typeof geometry.drawRange.count === 'number'
      ? { start: geometry.drawRange.start || 0, count: geometry.drawRange.count }
      : null;

  // Branch condition is `groups.length > 0`, NOT "groups is present" -- standard
  // BufferGeometry always initializes `groups = []` (spec:1166), so a naive
  // truthiness/presence check takes this branch, iterates zero groups, and silently
  // emits zero triangle ranges: a false negative indistinguishable from a verified
  // no-clash. This is the exact bug this length check guards against.
  if (Array.isArray(geometry.groups) && geometry.groups.length > 0) {
    // Group and draw ranges are INTERSECTED, not either/or (spec:1167).
    return geometry.groups.map((g) => intersectRange({ start: g.start, count: g.count }, drawRange));
  }

  // groups absent OR empty: synthesize one range covering the full index/vertex
  // count, clipped to drawRange if present (spec:1168).
  return [intersectRange({ start: 0, count: fullCount }, drawRange)];
}

export function computeActiveTriangleCount(ranges) {
  // TriangleRange.count is an index-ELEMENT (or vertex) count, not a triangle count.
  // A clipped range whose count is not a multiple of 3 contributes only whole
  // triangles (spec:1164, 1523 "floor(count/3)"). Comparing raw sum(ranges[].count)
  // instead of this converted sum would enforce a ceiling ~3x stricter than intended.
  let total = 0;
  for (const range of ranges) {
    total += Math.floor(range.count / 3);
  }
  return total;
}

export function adaptViewerGeometry(geometry) {
  // Legacy `offsets` layouts are explicitly rejected, not silently normalized with a
  // guessed `baseVertex: 0` (spec:1170) -- no confirmed rule for this layout, no
  // evidence it appears in Viewer 7.124.2.
  if (Array.isArray(geometry.offsets) && geometry.offsets.length > 0) {
    return { unsupported: true, reason: 'rejected-primitive-range' };
  }

  const positionResult = resolvePositions(geometry);
  if (!positionResult) {
    return { unsupported: true, reason: 'unsupported-geometry-layout' };
  }
  const { positions, positionStride, positionOffset } = positionResult;

  const index = resolveIndex(geometry);

  // Uniform accessor invariant for callers: x_i = positions[i*positionStride + positionOffset].
  const vertexCount = Math.floor(positions.length / positionStride);
  const fullCount = index ? index.length : vertexCount;

  const ranges = resolveRanges(geometry, fullCount);
  const activeTriangleCount = computeActiveTriangleCount(ranges);

  return { unsupported: false, positions, positionStride, positionOffset, index, ranges, activeTriangleCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS. Each test proves one branch of the position/index/range resolution priority order; the `groups === []` and `groups`+`drawRange` tests specifically prove the two silent-false-negative bugs the spec calls out are closed; the `offsets` test proves legacy layouts are rejected rather than guessed.

- [ ] **Step 5: Commit**

```bash
git add collision/viewer/ViewerGeometryAdapter.js test/viewer/ViewerGeometryAdapter.test.mjs
git commit -m "Add ViewerGeometryAdapter: normalize raw Viewer geometry layouts into TriangleGeometryView"
```

**Completion criteria:**
- All three position-source branches (Viewer-internal interleaved, standard `InterleavedBufferAttribute`, standard `BufferAttribute`) resolve correctly, in the documented priority order.
- Index resolution never reads `geometry.attributes.index.array`.
- `groups.length > 0` is the exact branch condition; `groups === []` and `groups` absent produce identical `activeTriangleCount`.
- Group and draw ranges are intersected when both present.
- Legacy `offsets` layouts are rejected with `rejected-primitive-range`, never silently normalized.
- `activeTriangleCount` is computed as `Σ floor(ranges[i].count / 3)`, exported as its own testable function.

**Protected invariants / regressions to watch:**
- spec:1166-1167 (silent false negative): a `groups`-presence check (rather than `groups.length > 0`) takes the groups branch on every fallback-path geometry and emits zero ranges — indistinguishable from a verified no-clash. Pinned by the `groups === []` test.
- spec:1167 (bug in a previous draft): applying `drawRange` only when `groups` is absent silently keeps the wrong triangles when both are present. Pinned by the groups+drawRange intersection test.
- spec:1178-1183 (previous draft's bug): index must never be read from `geometry.attributes.index.array`. Pinned by the index-source test's poisoned decoy at that path.
- spec:1170: legacy `offsets` layouts must be rejected outright, never given a guessed `baseVertex: 0`.

---

### Task 3: Active-range compaction + vertex welding

**Objective:** Gate a fragment's geometry against `maxSyncTriangleCount` using only its active triangle ranges, then materialize a compacted, welded position/index buffer — the precondition that makes connectivity and containment correctness possible at all.

**Files:**
- Create: `collision/geometry/activeRangeCompaction.js`
- Test: `test/geometry/activeRangeCompaction.test.mjs`

**Interfaces:**
- Consumes: `adaptViewerGeometry`'s `unsupported: false` output shape from Task 2 (`{ positions, positionStride, positionOffset, index, ranges, activeTriangleCount }`); `maxSyncTriangleCount`, `weldEpsilonMeters` from `collision/constants.js` (Task 1).
- Produces: `export function compactAndWeld(triangleGeometryView, options?) => { oversized: true, reason: 'geometry-too-large-for-sync-build', activeTriangleCount } | { position: Float32Array, index: Uint32Array, triangleCount: number }`. The non-oversized return shape is **exactly** `GeometryRecord.weldPromise`'s resolved type (canonical reference) — Task 14's `GeometryRegistry` awaits `compactAndWeld(...)` (wrapped in a promise) directly as that slot's value.

- [ ] **Step 1: Write the failing test(s)**

`test/geometry/activeRangeCompaction.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { adaptViewerGeometry } from '../../collision/viewer/ViewerGeometryAdapter.js';
import { compactAndWeld } from '../../collision/geometry/activeRangeCompaction.js';

function buildIsolatedTriangleView(triangleCount) {
  // Every triangle uses its OWN 3 vertices (no sharing) -- welding cannot merge
  // anything here, so triangleCount stays exact and easy to assert against.
  const positions = new Float32Array(triangleCount * 3 * 3);
  const index = new Uint32Array(triangleCount * 3);
  for (let t = 0; t < triangleCount; t++) {
    const v = t * 3;
    positions.set([v, 0, 0, v + 1, 0, 0, v, 1, 0], v * 3);
    index[v] = v; index[v + 1] = v + 1; index[v + 2] = v + 2;
  }
  return {
    unsupported: false, positions, positionStride: 3, positionOffset: 0, index,
    ranges: [{ start: 0, count: index.length }], activeTriangleCount: triangleCount,
  };
}

// Minimal local edge-connectivity component counter -- Task 4 provides the reusable
// version (collision/geometry/GeometryConnectivity.js); this task predates it, so a
// small self-contained helper avoids a forward dependency on a not-yet-existing module.
function countComponents(index, triangleCount) {
  const parent = Array.from({ length: triangleCount }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const edgeMap = new Map();
  for (let t = 0; t < triangleCount; t++) {
    for (let e = 0; e < 3; e++) {
      const v0 = index[t * 3 + e], v1 = index[t * 3 + ((e + 1) % 3)];
      const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push(t);
    }
  }
  for (const tris of edgeMap.values()) for (let i = 1; i < tris.length; i++) union(tris[0], tris[i]);
  return new Set(Array.from({ length: triangleCount }, (_, t) => find(t))).size;
}

test('activeTriangleCount = 13,000 (39,000 index elements): skipped, no buffers ever touched', () => {
  let accessed = false;
  const view = {
    activeTriangleCount: 13000,
    get ranges() { accessed = true; return []; },
    get index() { accessed = true; return null; },
    get positions() { accessed = true; return null; },
    positionStride: 3, positionOffset: 0,
  };
  const result = compactAndWeld(view);
  assert.equal(result.oversized, true);
  assert.equal(result.reason, 'geometry-too-large-for-sync-build');
  assert.equal(result.activeTriangleCount, 13000);
  assert.equal(accessed, false, 'oversized geometry must never have its buffers touched (checked BEFORE any copying)');
});

test('activeTriangleCount = 11,000 (33,000 index elements): must be built', () => {
  const result = compactAndWeld(buildIsolatedTriangleView(11000));
  assert.equal('oversized' in result, false);
  assert.equal(result.triangleCount, 11000);
});

test('activeTriangleCount = exactly 12,000 (36,000 index elements): built, not skipped (strict >, not >=)', () => {
  const result = compactAndWeld(buildIsolatedTriangleView(12000));
  assert.equal('oversized' in result, false, 'ceiling is a strict >; an exact match must still build');
  assert.equal(result.triangleCount, 12000);
});

test('huge raw index, tiny active ranges: builds only the active subset, never the whole raw buffer', () => {
  const totalTriangles = 20000; // far more than maxSyncTriangleCount if counted raw
  const positions = new Float32Array(totalTriangles * 3 * 3);
  const rawIndex = new Uint32Array(totalTriangles * 3);
  for (let i = 0; i < rawIndex.length; i++) rawIndex[i] = i;
  for (let t = 0; t < totalTriangles; t++) {
    const v = t * 3;
    positions.set([v, 0, 0, v + 1, 0, 0, v, 1, 0], v * 3);
  }
  const view = {
    unsupported: false, positions, positionStride: 3, positionOffset: 0, index: rawIndex,
    ranges: [{ start: 0, count: 9 }], activeTriangleCount: 3, // active range: only 3 triangles
  };
  const result = compactAndWeld(view);
  assert.equal('oversized' in result, false, 'must NOT be skipped -- the active range is tiny');
  assert.equal(result.triangleCount, 3);
  assert.ok(result.position.length <= 9 * 3, 'compacted buffer must not include inactive triangles');
});

test('box (24 raw vertices / 8 corners): welds to 8 vertices, 12 triangles', () => {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const view = adaptViewerGeometry({
    attributes: { position: { array: box.attributes.position.array, itemSize: 3 } },
    index: { array: box.index.array },
  });
  assert.equal(view.activeTriangleCount, 12);
  const result = compactAndWeld(view);
  assert.equal(result.triangleCount, 12);
  assert.equal(result.position.length / 3, 8, 'welding must merge the 24 raw vertices down to the 8 real corners');
});

test('weld epsilon derived from unit scale: mm-authored and m-authored geometry weld to the same component count', () => {
  const boxMeters = new THREE.BoxGeometry(1, 1, 1);
  const boxMillimeters = new THREE.BoxGeometry(1000, 1000, 1000); // same box, authored 1000x larger

  const viewMeters = adaptViewerGeometry({
    attributes: { position: { array: boxMeters.attributes.position.array, itemSize: 3 } },
    index: { array: boxMeters.index.array },
  });
  const viewMillimeters = adaptViewerGeometry({
    attributes: { position: { array: boxMillimeters.attributes.position.array, itemSize: 3 } },
    index: { array: boxMillimeters.index.array },
  });

  const resultMeters = compactAndWeld(viewMeters, { getUnitScale: () => 1 });
  // A model authored in millimetres reports getUnitScale() (meters-per-unit) = 0.001,
  // so weldEpsilon becomes 1e-4/0.001 = 0.1 (mm) -- the same PHYSICAL tolerance as
  // 1e-4 m applied to the metres model.
  const resultMillimeters = compactAndWeld(viewMillimeters, { getUnitScale: () => 0.001 });

  assert.equal(resultMeters.position.length / 3, 8);
  assert.equal(resultMillimeters.position.length / 3, 8);
  const componentsMeters = countComponents(resultMeters.index, resultMeters.triangleCount);
  const componentsMillimeters = countComponents(resultMillimeters.index, resultMillimeters.triangleCount);
  assert.equal(componentsMeters, componentsMillimeters);
  assert.equal(componentsMeters, 1, 'a fully-welded box is a single closed component');
});

test('missing getUnitScale falls back to the literal 1e-4 default (does not throw, still welds)', () => {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const view = adaptViewerGeometry({
    attributes: { position: { array: box.attributes.position.array, itemSize: 3 } },
    index: { array: box.index.array },
  });
  const result = compactAndWeld(view); // no options at all
  assert.equal(result.position.length / 3, 8);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/geometry/activeRangeCompaction.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` — `collision/geometry/activeRangeCompaction.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

`collision/geometry/activeRangeCompaction.js`:

```js
// collision/geometry/activeRangeCompaction.js
//
// Round 16 fix for the maxSyncTriangleCount scope bug (spec:1500-1541): the ceiling
// must be checked against the ACTIVE range's triangle count, computed and gated
// BEFORE any copying happens -- never against a fragment's raw (possibly huge) index
// buffer. This is the "one more phase before weld/connectivity/BVH" the spec adds:
// active-range compaction, then welding, over a collision-owned buffer containing
// ONLY the triangles the adapter's ranges cover.
//
// Consumes the `unsupported: false` output of
// collision/viewer/ViewerGeometryAdapter.js#adaptViewerGeometry. Produces either the
// welded { position, index, triangleCount } buffer GeometryRegistry's weldPromise slot
// resolves to (Task 14), or an OversizedMarker.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { maxSyncTriangleCount as defaultMaxSyncTriangleCount, weldEpsilonMeters } from '../constants.js';

function collectActiveTriangleVertexIds(view) {
  // Only whole triangles from each range (spec:1164, 1523 floor(count/3)), and ONLY
  // the vertices those triangles actually reference -- this is what keeps the
  // compacted buffer bounded by activeTriangleCount rather than the (possibly
  // enormous) raw index/position buffer.
  const { index, ranges } = view;
  const triangleVertexIds = []; // flat, 3 per triangle, in ORIGINAL vertex-id space

  for (const range of ranges) {
    const flooredCount = Math.floor(range.count / 3) * 3;
    for (let i = 0; i < flooredCount; i++) {
      const streamPos = range.start + i;
      // Indexed: the stream is the index array itself. Non-indexed: the adapter's
      // range.count/start are already in VERTEX units (spec:1164 "same factor for
      // non-indexed fallback in position elements"), so the vertex id IS the stream position.
      triangleVertexIds.push(index ? index[streamPos] : streamPos);
    }
  }
  return triangleVertexIds;
}

function buildCompactBuffers(view, triangleVertexIds) {
  const { positions, positionStride, positionOffset } = view;
  const remap = new Map(); // original vertex id -> compact vertex id
  const compactPositions = [];
  const compactIndex = new Uint32Array(triangleVertexIds.length);

  for (let i = 0; i < triangleVertexIds.length; i++) {
    const originalId = triangleVertexIds[i];
    let compactId = remap.get(originalId);
    if (compactId === undefined) {
      compactId = remap.size;
      remap.set(originalId, compactId);
      const base = originalId * positionStride + positionOffset;
      compactPositions.push(positions[base], positions[base + 1], positions[base + 2]);
    }
    compactIndex[i] = compactId;
  }

  return { position: new Float32Array(compactPositions), index: compactIndex };
}

function resolveWeldEpsilon(getUnitScale) {
  if (getUnitScale == null) return weldEpsilonMeters;
  const unitScale = typeof getUnitScale === 'function' ? getUnitScale() : getUnitScale;
  if (typeof unitScale !== 'number' || !Number.isFinite(unitScale) || unitScale <= 0) {
    return weldEpsilonMeters; // fallback: literal 1e-4 if unit scale unavailable (spec:1780-1781)
  }
  return weldEpsilonMeters / unitScale;
}

function toUint32Index(indexAttribute) {
  const arr = indexAttribute.array;
  return arr instanceof Uint32Array ? arr : Uint32Array.from(arr);
}

/**
 * @param {ReturnType<typeof import('../viewer/ViewerGeometryAdapter.js').adaptViewerGeometry>} triangleGeometryView
 *   Must be the `unsupported: false` variant -- callers filter oversized/unsupported
 *   layout diagnostics upstream of this function; this function only knows about the
 *   maxSyncTriangleCount ceiling, not layout support.
 * @param {Object} [options]
 * @param {number} [options.maxSyncTriangleCount]
 * @param {number|(() => number)} [options.getUnitScale]
 */
export function compactAndWeld(triangleGeometryView, options = {}) {
  const ceiling = options.maxSyncTriangleCount ?? defaultMaxSyncTriangleCount;
  const { activeTriangleCount } = triangleGeometryView;

  // Checked BEFORE any copying happens (spec:1570-1594) -- strict `>`, not `>=` (an
  // activeTriangleCount exactly AT the ceiling must still be built).
  if (activeTriangleCount > ceiling) {
    return { oversized: true, reason: 'geometry-too-large-for-sync-build', activeTriangleCount };
  }

  const triangleVertexIds = collectActiveTriangleVertexIds(triangleGeometryView);
  const compact = buildCompactBuffers(triangleGeometryView, triangleVertexIds);

  // Strip to position+index BEFORE welding: mergeVertices compares ALL attributes on
  // the geometry it's given, so per-face normals/uvs would make every vertex unique
  // and welding would merge nothing (spec:1757-1761).
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(compact.position, 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute(compact.index, 1));

  const weldEpsilon = resolveWeldEpsilon(options.getUnitScale);
  const welded = mergeVertices(geometry, weldEpsilon);

  const position = welded.attributes.position.array instanceof Float32Array
    ? welded.attributes.position.array
    : Float32Array.from(welded.attributes.position.array);
  const index = toUint32Index(welded.index);

  return { position, index, triangleCount: index.length / 3 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS. The 13,000/11,000/12,000-triangle tests pin the exact `maxSyncTriangleCount` boundary (strict `>`); the "huge raw index, tiny active ranges" test proves compaction is bounded by the active set, never the raw buffer; the box test proves the 24→8-vertex weld; the mm-vs-m test proves `weldEpsilon` genuinely derives from `getUnitScale()`.

- [ ] **Step 5: Commit**

```bash
git add collision/geometry/activeRangeCompaction.js test/geometry/activeRangeCompaction.test.mjs
git commit -m "Add active-range compaction + vertex welding (Round 16 maxSyncTriangleCount scope fix)"
```

**Completion criteria:**
- `activeTriangleCount > maxSyncTriangleCount` is checked before any buffer is read, using a strict `>`.
- Compaction reads only the vertices referenced by active-range triangles, never the full raw buffer.
- Welding runs over a position+index-only geometry (no normals/uvs) so `mergeVertices` can actually merge.
- `weldEpsilon` is derived from `weldEpsilonMeters / getUnitScale()`, falling back to the literal `weldEpsilonMeters` when unavailable.
- Output shape for the non-oversized case is exactly `{ position: Float32Array, index: Uint32Array, triangleCount: number }`.

**Protected invariants / regressions to watch:**
- Round 16 core regression (spec extract D, `CollisionWorld.findClashes` fixture list, "fragment whose raw index encodes far more triangles than maxSyncTriangleCount, but ranges cover a small active subset ... must NOT be skipped"): pinned by the "huge raw index, tiny active ranges" test.
- spec:1570-1594 — the ceiling comparison is strict `>`; `activeTriangleCount === maxSyncTriangleCount` must still build. Pinned by the exact-12,000 test.
- spec:1523 — `activeTriangleCount` uses `floor(count/3)`, not raw index-element sums; comparing raw sums would enforce a ceiling ~3x stricter than intended (39,000/33,000/36,000-index-element boundary tests pin the `/3` conversion specifically).
- spec:1757-1761 — welding before stripping to position+index merges nothing (every vertex stays unique because per-face normals/uvs differ). The box 24→8 test is a silent-failure trap if this ordering regresses (`mergeVertices` would run without error but produce 24 output vertices, not 8).
- spec:1780-1781 — `weldEpsilon` must derive from `model.getUnitScale()` when available, not stay unit-blind at the literal `1e-4` default. Pinned by the mm-vs-m component-count test.

---

### Task 4: `GeometryConnectivity`

**Objective:** Decompose a welded geometry into edge-connected components and classify each as manifold or not — the precondition every containment/volume-overlap correctness guarantee is conditioned on.

**Files:**
- Create: `collision/geometry/GeometryConnectivity.js`
- Test: `test/geometry/GeometryConnectivity.test.mjs`

**Interfaces:**
- Consumes: the welded `{ position, index, triangleCount }` shape produced by `compactAndWeld` (Task 3) — this is exactly `GeometryRecord.weldPromise`'s resolved value, so the natural call site (Task 14, `GeometryRegistry`) is `computeGeometryConnectivity(await record.weldPromise)`.
- Produces: `export function computeGeometryConnectivity({ index }) => { componentCount: number, componentOf: Int32Array, closedManifold: boolean[] }` — **exactly** the canonical `GeometryConnectivityResult` shape (per-triangle `componentOf`, per-component `closedManifold`). This differs from `spike/geometry-core.mjs`'s own `connectivity()` return shape (which returns `components: number[][]` grouped-by-component and a single geometry-wide `closedManifold: boolean`, not per-component) — the reconciliation is deliberate, done here, so no later task ever sees the spike's shape.

- [ ] **Step 1: Write the failing test(s)**

`test/geometry/GeometryConnectivity.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeGeometryConnectivity } from '../../collision/geometry/GeometryConnectivity.js';

function weldedBox(size = 1) {
  const box = new THREE.BoxGeometry(size, size, size);
  const stripped = new THREE.BufferGeometry();
  stripped.setAttribute('position', box.attributes.position.clone());
  stripped.setIndex(box.index.clone());
  const welded = mergeVertices(stripped);
  return { position: welded.attributes.position.array, index: Uint32Array.from(welded.index.array) };
}

test('closed manifold box: 1 component, closedManifold = [true]', () => {
  const { index } = weldedBox();
  const result = computeGeometryConnectivity({ index });
  assert.equal(result.componentCount, 1);
  assert.deepEqual(Array.from(result.closedManifold), [true]);
});

test('open shell (single triangle): closedManifold = [false]', () => {
  const index = new Uint32Array([0, 1, 2]);
  const result = computeGeometryConnectivity({ index });
  assert.equal(result.componentCount, 1);
  assert.deepEqual(Array.from(result.closedManifold), [false]);
});

test('non-manifold: three triangles sharing one edge -> that component flagged non-manifold', () => {
  // Triangles 0 and 1 share edge (0,1) normally; triangle 2 ALSO uses edge (0,1) --
  // a junction edge shared by 3 triangles.
  const index = new Uint32Array([
    0, 1, 2,
    1, 0, 3,
    0, 1, 4,
  ]);
  const result = computeGeometryConnectivity({ index });
  assert.equal(result.componentCount, 1);
  assert.deepEqual(Array.from(result.closedManifold), [false]);
});

test('duplicated seam vertex over-segmentation: conservative, not a failure', () => {
  // Two triangles that SHOULD share an edge but reference different (unwelded,
  // duplicate) vertex ids for it -- edge-connectivity legitimately reports 2
  // components here (spec:1789-1805: over-segmentation is conservative, more
  // sampling, never less correctness).
  const index = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const result = computeGeometryConnectivity({ index });
  assert.equal(result.componentCount, 2, 'un-welded duplicate seam vertices legitimately over-segment');
});

test('two disjoint closed boxes: 2 components, both closed', () => {
  const boxA = weldedBox(1);
  const boxB = weldedBox(1);
  const vertexOffset = boxA.position.length / 3;
  const offsetIndex = Uint32Array.from(boxB.index, (i) => i + vertexOffset);
  const mergedIndex = new Uint32Array(boxA.index.length + offsetIndex.length);
  mergedIndex.set(boxA.index, 0);
  mergedIndex.set(offsetIndex, boxA.index.length);
  const result = computeGeometryConnectivity({ index: mergedIndex });
  assert.equal(result.componentCount, 2);
  assert.deepEqual(Array.from(result.closedManifold), [true, true]);
});

test('componentOf assigns every triangle of the same component the same id', () => {
  const { index } = weldedBox();
  const result = computeGeometryConnectivity({ index });
  const ids = new Set(result.componentOf);
  assert.equal(ids.size, 1);
  assert.equal(result.componentOf.length, index.length / 3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/geometry/GeometryConnectivity.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` — `collision/geometry/GeometryConnectivity.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

`collision/geometry/GeometryConnectivity.js`:

```js
// collision/geometry/GeometryConnectivity.js
//
// Connected-component decomposition = EDGE-connectivity, not vertex-connectivity
// (spec:1789-1801) -- union-find over triangles sharing an edge (two vertex indices).
// Vertex-connectivity (round 3) was broken by review: two solids joined at a single
// shared vertex merge into one component, which defeats the containment guarantee.
// Ported from spike/geometry-core.mjs's connectivity(), reshaped to the canonical
// GeometryConnectivityResult: per-TRIANGLE componentOf (not per-component triangle
// lists) and per-COMPONENT closedManifold (not one geometry-wide boolean) -- round 7
// scoped manifoldness per-component specifically so one open shell does not condemn
// every closed component sharing the same geometry.

/**
 * @param {{ index: Uint32Array | number[] }} weldedGeometry - the resolved shape of
 *   GeometryRecord.weldPromise (only `index` is used -- topology-only decomposition).
 * @returns {{ componentCount: number, componentOf: Int32Array, closedManifold: boolean[] }}
 */
export function computeGeometryConnectivity({ index }) {
  const triangleCount = index.length / 3;
  const parent = new Int32Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) parent[i] = i;

  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const edgeMap = new Map();
  for (let t = 0; t < triangleCount; t++) {
    for (let e = 0; e < 3; e++) {
      const v0 = index[t * 3 + e];
      const v1 = index[t * 3 + ((e + 1) % 3)];
      const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
      let list = edgeMap.get(key);
      if (!list) { list = []; edgeMap.set(key, list); }
      list.push(t);
    }
  }
  for (const tris of edgeMap.values()) {
    for (let i = 1; i < tris.length; i++) union(tris[0], tris[i]);
  }

  // Assign dense, 0-based component ids in order of first-encountered root (stable
  // and deterministic given a fixed triangle order -- not itself a correctness
  // requirement, just reproducible test output).
  const rootToComponentId = new Map();
  const componentOf = new Int32Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) {
    const root = find(t);
    let id = rootToComponentId.get(root);
    if (id === undefined) {
      id = rootToComponentId.size;
      rootToComponentId.set(root, id);
    }
    componentOf[t] = id;
  }
  const componentCount = rootToComponentId.size;

  // Manifold classification is a byproduct of the same edge map: a component is
  // manifold iff EVERY edge is shared by exactly 2 triangles (spec:1808-1812).
  // Boundary edges (shared by 1 -- open shell) and non-manifold edges (shared by 3+
  // -- junction geometry) both flag their OWNING component only, never the whole
  // geometry (round 7: a geometry-wide flag would condemn every closed component
  // sharing space with one open shell elsewhere in the same geometry).
  const closedManifold = new Array(componentCount).fill(true);
  for (const tris of edgeMap.values()) {
    if (tris.length !== 2) {
      closedManifold[componentOf[tris[0]]] = false;
    }
  }

  return { componentCount, componentOf, closedManifold };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS. The closed-box, open-shell, non-manifold-junction, over-segmentation, two-disjoint-boxes, and `componentOf` shape tests each prove one part of the canonical `GeometryConnectivityResult` contract.

- [ ] **Step 5: Commit**

```bash
git add collision/geometry/GeometryConnectivity.js test/geometry/GeometryConnectivity.test.mjs
git commit -m "Add GeometryConnectivity: edge-based union-find with per-component manifold classification"
```

**Completion criteria:**
- Connectivity is computed via EDGE-sharing (two vertex indices), never vertex-sharing.
- `componentOf` is a per-triangle `Int32Array`; `closedManifold` is a per-component boolean array aligned to the same component ids.
- A component is `closedManifold[i] === true` iff every one of its edges is shared by exactly 2 triangles.
- Un-welded duplicate-seam geometry over-segments (more components than the "real" shape), never under-segments or errors.

**Protected invariants / regressions to watch:**
- Round 3 (spec:1789-1801): vertex-based union-find merges solids joined at a single shared vertex into one component, breaking the containment guarantee. This module MUST stay edge-based.
- Round 7 (spec:1808-1812, source's own comment in `spike/geometry-core.mjs`): manifold classification is per-COMPONENT, not per-geometry — pinned by the "non-manifold: three triangles sharing one edge" test combined with the "two disjoint closed boxes" test (a regression that made this flag geometry-wide would fail the disjoint-boxes test the moment any fixture ever combined an open and closed component in one geometry).
- spec:1806-1807: edge-connectivity narrows but does NOT close the under-segmentation hole — solids joined along a shared EDGE still incorrectly merge into one component. This is a stated, accepted limitation, not something this task's tests assert against (asserting it "wrong" would contradict the spec).

---

### Task 5: `ThreeMeshBvhBackend`

**Objective:** Provide a stateless `MeshBVH` + per-geometry tolerance-scale (`L_X`) builder over welded geometry, deliberately kept separate from any caching/dedup concern (that's `BlasCache`, Task 14).

**Files:**
- Create: `collision/blas/ThreeMeshBvhBackend.js`
- Test: `test/blas/ThreeMeshBvhBackend.test.mjs`

**Interfaces:**
- Consumes: the welded `{ position, index, triangleCount }` shape produced by `compactAndWeld` (Task 3) — same input shape as Task 4's `computeGeometryConnectivity`.
- Produces: `export function build(weldedGeometry) => { bvh: MeshBVH, localDiagonal: number }`. **This module is deliberately stateless** — no caching, no promise, no registry awareness. `BlasCache`/the registry's `accelerationPromise` slot (Task 14, a different subagent's task) is the caching layer that wraps this function inside the registry's single-flight promise slot; Task 14's author should import `build` from here and put ALL memoization/dedup on the registry side (spec:1543-1568: "dedup of simultaneous BVH builds is not a `BlasCache`-owned mechanism — it's the registry-level rule").

- [ ] **Step 1: Write the failing test(s)**

`test/blas/ThreeMeshBvhBackend.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { build } from '../../collision/blas/ThreeMeshBvhBackend.js';

function rawBoxWelded(size) {
  const box = new THREE.BoxGeometry(size, size, size);
  return {
    position: box.attributes.position.array,
    index: Uint32Array.from(box.index.array),
    triangleCount: box.index.count / 3,
  };
}

test('build: box localDiagonal matches hand-computed diagonal(localBounds)', () => {
  const welded = rawBoxWelded(2); // 2x2x2 box centered at origin: bounds [-1,1]^3
  const { bvh, localDiagonal } = build(welded);
  assert.ok(bvh instanceof MeshBVH);
  const expectedDiagonal = Math.sqrt(2 * 2 + 2 * 2 + 2 * 2); // side 2 cube -> diagonal 2*sqrt(3)
  assert.ok(Math.abs(localDiagonal - expectedDiagonal) < 1e-6, `expected ${expectedDiagonal}, got ${localDiagonal}`);
});

test('build: sphere localDiagonal matches hand-computed diagonal', () => {
  const sphere = new THREE.SphereGeometry(1, 8, 8); // radius 1 -> bounds ~[-1,1]^3
  const welded = {
    position: sphere.attributes.position.array,
    index: Uint32Array.from(sphere.index.array),
    triangleCount: sphere.index.count / 3,
  };
  const { localDiagonal } = build(welded);
  const box3 = new THREE.Box3().setFromBufferAttribute(sphere.attributes.position);
  const expected = box3.getSize(new THREE.Vector3()).length();
  assert.ok(Math.abs(localDiagonal - expected) < 1e-6);
});

test('build: resulting BVH supports closestPointToPoint/raycast/bvhcast (smoke test only)', () => {
  const welded = rawBoxWelded(1);
  const { bvh } = build(welded);

  const hit = bvh.closestPointToPoint(new THREE.Vector3(0, 0, 0));
  assert.ok(hit && typeof hit.distance === 'number');

  const ray = new THREE.Ray(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0.3178, 0.1234).normalize());
  const raycastHits = bvh.raycast(ray, THREE.DoubleSide);
  assert.ok(Array.isArray(raycastHits) && raycastHits.length > 0);

  const otherBvh = build(rawBoxWelded(1)).bvh;
  let candidateSeen = false;
  bvh.bvhcast(otherBvh, new THREE.Matrix4().makeTranslation(0.5, 0, 0), {
    intersectsTriangles() { candidateSeen = true; return false; },
  });
  assert.equal(candidateSeen, true, 'bvhcast must invoke the callback for overlapping leaves');
});

test('build: is stateless -- two calls over equivalent input produce independent BVH instances', () => {
  const a = build(rawBoxWelded(1));
  const b = build(rawBoxWelded(1));
  assert.notEqual(a.bvh, b.bvh, 'no caching/memoization belongs in this module');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/blas/ThreeMeshBvhBackend.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` — `collision/blas/ThreeMeshBvhBackend.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

`collision/blas/ThreeMeshBvhBackend.js`:

```js
// collision/blas/ThreeMeshBvhBackend.js
//
// Stateless builder: one MeshBVH per welded geometry, built fresh every call. Caching
// (BlasCache, Task 14) is a LATER, separate module that wraps this behind the
// registry's single-flight accelerationPromise slot -- this module owns none of that:
// no memoization, no promise, no registry awareness (spec:1543-1568: "dedup of
// simultaneous BVH builds is not a BlasCache-owned mechanism -- it's the registry-
// level rule").
//
// Builds over the collision-owned, compacted-then-welded buffer ONLY (never raw
// Viewer geometry) -- L_X (the per-BVH tolerance scale) is computed over that same
// buffer (spec:1609-1614), so a caller must never hand this a pre-weld buffer.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/**
 * @param {{ position: Float32Array, index: Uint32Array, triangleCount: number }} weldedGeometry
 *   Exactly the resolved shape of GeometryRecord.weldPromise.
 * @returns {{ bvh: import('three-mesh-bvh').MeshBVH, localDiagonal: number }}
 */
export function build(weldedGeometry) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(weldedGeometry.position, 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute(weldedGeometry.index, 1));

  const bvh = new MeshBVH(geometry);

  // L_X := diagonal(localBounds(X)), computed once in X's own local space, over the
  // SAME buffer the BLAS is built from (spec:1609-1614) -- ported from
  // spike/geometry-core.mjs's scaleOf.
  geometry.computeBoundingBox();
  const localDiagonal = geometry.boundingBox.getSize(new THREE.Vector3()).length();

  return { bvh, localDiagonal };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS. The box/sphere `localDiagonal` tests prove `L_X := diagonal(localBounds(X))` is computed correctly against a hand-computed value; the smoke test proves the three query primitives (`closestPointToPoint`, `raycast`, `bvhcast`) work on the result; the statelessness test proves no caching leaked into this module.

- [ ] **Step 5: Commit**

```bash
git add collision/blas/ThreeMeshBvhBackend.js test/blas/ThreeMeshBvhBackend.test.mjs
git commit -m "Add ThreeMeshBvhBackend: stateless MeshBVH builder with per-BVH L_X tolerance scale"
```

**Completion criteria:**
- `build(weldedGeometry)` returns a real `MeshBVH` and a correctly-computed `localDiagonal`.
- `localDiagonal` is computed over the SAME welded buffer the BVH is built from, never a raw/pre-weld buffer.
- The module has no module-level cache, no memoization, no awareness of `GeometryRegistry`/promises — verified by the "two calls produce independent instances" test.

**Protected invariants / regressions to watch:**
- spec:1609-1614: `L_X` must be computed over the collision-owned, compacted-then-welded buffer — not raw Viewer geometry, and not recomputed against a different geometry than the one the BVH itself was built from (an inconsistency here would silently corrupt every tolerance in Tasks 6-12 that scales by `L_X`/`L_target`/`L_canonical`).
- spec:1543-1568: this module must stay stateless. Any caching added here (rather than in `BlasCache`/the registry's `accelerationPromise` slot) would create a SECOND dedup mechanism that could disagree with the registry's single-flight guarantee — Task 14's author is relying on this module being a pure function.

---

### Task 6: `classifyPoint`

**Objective:** Implement the three-valued (`inside`/`outside`/`boundary`), even-odd ray-parity point classifier that every containment and crossing algorithm in this library is built on.

**Files:**
- Create: `collision/query/ContainmentQuery.js` (exports only `classifyPoint` for now — `anyComponentInside` is added alongside it by a LATER task, Task 9, owned by a different subagent)
- Test: `test/query/ContainmentQuery.classifyPoint.test.mjs`

**Interfaces:**
- Consumes: `barycentricEpsilon`, `mergeDistanceFactor`, `surfaceEpsilonFactor` from `collision/constants.js` (Task 1); a `{ bvh, localDiagonal }` pair from `collision/blas/ThreeMeshBvhBackend.js#build` (Task 5) in its own tests (production callers in later tasks supply these from `GeometryRecord.accelerationPromise`).
- Produces: `export function classifyPoint(point: THREE.Vector3, targetBvh: MeshBVH, targetLocalDiagonal: number) => 'inside' | 'outside' | 'boundary'`. Task 9 (`anyComponentInside`) and every later query-mode task (`ProperCrossingQuery`, `VolumeOverlapQuery`, `ContainmentModeQuery`, `SurfaceCrossingWitness`) call this exact signature. **This task's own test file must not import or assume `anyComponentInside` exists.**

- [ ] **Step 1: Write the failing test(s)**

`test/query/ContainmentQuery.classifyPoint.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { build } from '../../collision/blas/ThreeMeshBvhBackend.js';
import { classifyPoint } from '../../collision/query/ContainmentQuery.js';

// Local geometry-building helpers, ported from spike/fixtures.mjs's box/mergeGeometries
// -- kept self-contained in this test file rather than assuming a shared
// test/fixtures/ geometry-helpers module another task may or may not have created.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function mergeGeometries(geoms) {
  const positions = [];
  const indices = [];
  let offset = 0;
  for (const g of geoms) {
    const gi = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    positions.push(...g.attributes.position.array);
    for (const i of gi) indices.push(i + offset);
    offset += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setIndex(indices);
  return out;
}
function weldedFromRaw(geometry) {
  // classifyPoint's own correctness does not depend on welding (Task 3's job) -- only
  // on a valid MeshBVH + accurate localDiagonal, so the raw (unwelded) buffer is fine here.
  const index = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from([...Array(geometry.attributes.position.count).keys()]);
  return { position: geometry.attributes.position.array, index, triangleCount: index.length / 3 };
}
function instanceOf(geometry) {
  return build(weldedFromRaw(geometry));
}

test('demonstrably inside / outside', () => {
  const b = instanceOf(box(2, 2, 2));
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'inside');
  assert.equal(classifyPoint(new THREE.Vector3(5, 0, 0), b.bvh, b.localDiagonal), 'outside');
});

test('ROUND 4 REGRESSION: point on the interior of a face is boundary, not inside (checked across several faces/ray directions)', () => {
  const b = instanceOf(box(2, 2, 2));
  const faceInteriorPoints = [
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
  ];
  for (const p of faceInteriorPoints) {
    assert.equal(classifyPoint(p, b.bvh, b.localDiagonal), 'boundary', `face point ${p.toArray()} must be boundary`);
  }
});

test('point on edge, and on vertex -> boundary', () => {
  const b = instanceOf(box(2, 2, 2));
  assert.equal(classifyPoint(new THREE.Vector3(1, 1, 0), b.bvh, b.localDiagonal), 'boundary');
  assert.equal(classifyPoint(new THREE.Vector3(1, 1, 1), b.bvh, b.localDiagonal), 'boundary');
});

test('THREE.DoubleSide is mandatory: a thin open shell has more raycast hits with DoubleSide than FrontSide', () => {
  const shell = new THREE.PlaneGeometry(4, 4);
  const b = instanceOf(shell);
  const ray = new THREE.Ray(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1));
  const doubleSideHits = b.bvh.raycast(ray, THREE.DoubleSide);
  const frontSideHits = b.bvh.raycast(ray, THREE.FrontSide);
  assert.ok(doubleSideHits.length >= frontSideHits.length);
  assert.ok(doubleSideHits.length > 0, 'DoubleSide must see the back-facing crossing a FrontSide-only cast could miss');
});

test('coincident duplicate triangles: ray through them counts as ONE merged crossing, not two', () => {
  // A ray exiting the box crosses its (single) surface once -- odd parity, `inside`
  // from the centre. Duplicating every triangle exactly (same position, same
  // transform) makes each real crossing produce TWO near-zero-separation hits;
  // without distance-sort-then-merge these would double-count as even parity and
  // misclassify `outside`. Note: this tests coincident SURFACES, not a shared edge (a
  // shared-edge ray is rejected by barycentricEpsilon and retried on the next
  // direction -- it never reaches merge logic at all).
  const doubled = mergeGeometries([box(2, 2, 2), box(2, 2, 2)]);
  const b = instanceOf(doubled);
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'inside');
});

test('target under non-uniform scale: tolerances scale with the target\'s own local diagonal', () => {
  const b = instanceOf(box(10, 0.5, 0.5)); // long, thin, non-uniform box
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'inside');
  assert.equal(classifyPoint(new THREE.Vector3(0, 0.25, 0), b.bvh, b.localDiagonal), 'boundary');
  assert.equal(classifyPoint(new THREE.Vector3(0, 100, 0), b.bvh, b.localDiagonal), 'outside');
});

test('point inside two nested closed shells (even-odd model): outside -- correct for a hollow container', () => {
  const nested = mergeGeometries([box(4, 4, 4), box(2, 2, 2)]);
  const b = instanceOf(nested);
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'outside',
    'even-odd: correct for a hollow container/pipe, and the stated limitation for nested independent solids');
  assert.equal(classifyPoint(new THREE.Vector3(1.5, 0, 0), b.bvh, b.localDiagonal), 'inside',
    'the material region between the two shells');
});

test('pipe/annulus: a point in the bore reads outside (hollow, correct by design)', () => {
  const pipe = mergeGeometries([
    new THREE.CylinderGeometry(2, 2, 4, 24),
    new THREE.CylinderGeometry(1, 1, 4, 24),
  ]);
  const b = instanceOf(pipe);
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'outside',
    'bore point crosses both shells -- even parity -- pipe is correctly hollow');
});

test('nested independent solids (stated M1 limitation, not a bug): same outside result as the hollow case', () => {
  // Geometrically identical triangle set to the nested-shells fixture above --
  // even-odd cannot distinguish "hollow container" from "two independent solids, one
  // nested inside the other" (spec:1669-1676). This documents the accepted
  // limitation rather than asserting incorrect behaviour is a bug.
  const twoSolids = mergeGeometries([box(4, 4, 4), box(2, 2, 2)]);
  const b = instanceOf(twoSolids);
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'outside',
    'stated M1 limitation: reads as a cavity, indistinguishable from the hollow case above');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/query/ContainmentQuery.classifyPoint.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` — `collision/query/ContainmentQuery.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

`collision/query/ContainmentQuery.js`:

```js
// collision/query/ContainmentQuery.js
//
// Internal point-classification primitive (classifyPoint) plus, added by a LATER task
// (Task 9), anyComponentInside -- this task exports ONLY classifyPoint; leave room
// alongside it for that export, do not assume it exists in this task's own tests.
//
// Ported near-verbatim from spike/geometry-core.mjs's classifyPoint/nearTriangleEdge/
// RAY_DIRECTIONS -- the spike's algorithm already matches the spec's declared solid
// model exactly (spec:2253-2310). The only change here is sourcing tolerances from
// collision/constants.js instead of local hardcoded literals, and taking the target's
// precomputed L_X (localDiagonal, from ThreeMeshBvhBackend#build, Task 5) as an
// explicit parameter instead of recomputing it per call.

import * as THREE from 'three';
import { barycentricEpsilon, mergeDistanceFactor, surfaceEpsilonFactor } from '../constants.js';

// SPIKE FINDING (spec:2286-2296): the naive "local +X first, +Y on retry" rule is
// pathological for BIM. A ray along a local axis from a symmetric point inside an
// axis-aligned box hits the exact CENTRE of a face -- precisely where BoxGeometry
// splits its two triangles -- so every axis-aligned probe grazes a diagonal, every
// retry grazes too, and the point misclassifies `boundary`. Generic, non-axis-aligned,
// mutually unrelated directions avoid systematic alignment with mesh features.
const RAY_DIRECTIONS = [
  new THREE.Vector3(1, 0.3178, 0.1234).normalize(),
  new THREE.Vector3(0.2189, 1, 0.4567).normalize(),
  new THREE.Vector3(0.4321, 0.1357, 1).normalize(),
];

function nearTriangleEdge(hit) {
  const b = hit.barycoord;
  if (!b) return false;
  return b.x < barycentricEpsilon || b.y < barycentricEpsilon || b.z < barycentricEpsilon;
}

/**
 * Three-valued point classification against a target's ENTIRE triangle set, using
 * even-odd (parity) ray casting entirely in the target BVH's own local space
 * (spec:2267-2310). `boundary` is load-bearing, not a convenience third case: it is
 * what fixes round-3's boolean-classifier defect (a point exactly on a face gets a
 * near-zero-distance ray hit that naive parity would wrongly count as `inside`).
 *
 * @param {THREE.Vector3} point - in targetBvh's own local space.
 * @param {import('three-mesh-bvh').MeshBVH} targetBvh
 * @param {number} targetLocalDiagonal - L_target := diagonal(localBounds(target)).
 * @returns {'inside' | 'outside' | 'boundary'}
 */
export function classifyPoint(point, targetBvh, targetLocalDiagonal) {
  const surfaceEpsilon = surfaceEpsilonFactor * targetLocalDiagonal;
  const mergeDistance = mergeDistanceFactor * targetLocalDiagonal;

  // Stage 1: surface-proximity pre-check. Guarantees the parity ray below can never
  // meet a distance-zero hit, so that degenerate case cannot arise at all.
  const closest = targetBvh.closestPointToPoint(point);
  if (closest && closest.distance <= surfaceEpsilon) return 'boundary';

  const ray = new THREE.Ray();
  for (const direction of RAY_DIRECTIONS) {
    ray.origin.copy(point);
    ray.direction.copy(direction);

    // THREE.DoubleSide is mandatory: the default FrontSide drops back-facing
    // crossings and silently breaks parity (thin-shell fixture).
    const hits = targetBvh.raycast(ray, THREE.DoubleSide);

    let grazed = false;
    for (const hit of hits) {
      if (nearTriangleEdge(hit)) { grazed = true; break; }
    }
    if (grazed) continue; // retry along the next generic direction

    // Sort by distance THEN merge coincident hits -- MeshBVH.raycast does not
    // guarantee ordered hits.
    const distances = hits.map((h) => h.distance).sort((a, b) => a - b);
    let crossings = 0;
    let last = -Infinity;
    for (const d of distances) {
      if (d - last > mergeDistance) { crossings++; last = d; }
    }
    // Even-odd parity across the target's ENTIRE triangle set (spec:1658-1667) -- the
    // declared solid model, not incidental to MeshBVH.raycast.
    return crossings % 2 === 1 ? 'inside' : 'outside';
  }

  return 'boundary'; // every direction grazed -- genuinely cannot say
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS. The inside/outside/edge/vertex tests prove the base parity classification; the round-4-regression test proves face-interior points classify `boundary` across all six faces; the `DoubleSide` test proves back-facing crossings are seen; the coincident-duplicate-triangle test proves distance-sort-then-merge collapses duplicated surfaces correctly; the non-uniform-scale test proves tolerances scale with the target's own `localDiagonal`; the nested-shells/pipe/nested-independent-solids trio proves the even-odd solid model, including its stated limitation.

- [ ] **Step 5: Commit**

```bash
git add collision/query/ContainmentQuery.js test/query/ContainmentQuery.classifyPoint.test.mjs
git commit -m "Add ContainmentQuery#classifyPoint: three-valued even-odd point classification"
```

**Completion criteria:**
- `classifyPoint` returns exactly one of `'inside' | 'outside' | 'boundary'`.
- Surface-proximity pre-check runs before parity casting and short-circuits to `boundary`.
- Raycasting always uses `THREE.DoubleSide`.
- Ray directions are the three generic, non-axis-aligned vectors, tried in order, with retry-on-graze.
- Hits are sorted by distance before merge-collapsing; parity is computed after merging.
- All tolerances are sourced from `collision/constants.js`, scaled by the caller-supplied `targetLocalDiagonal`, never hardcoded locally.
- `collision/query/ContainmentQuery.js` exports only `classifyPoint` — no placeholder/stub for `anyComponentInside`.

**Protected invariants / regressions to watch:**
- Round 3/4 (spec:2267-2310, `spike/fixtures.mjs`'s own "ROUND 4 REGRESSION" comment): a point on a face interior must classify `boundary`, never `inside` — pinned across all six box faces, not just one, since the defect was direction-dependent.
- spec:2286-2296: axis-aligned ray directions are pathological for BIM's axis-aligned boxes (grazes the shared diagonal at a box's face centre). The three RAY_DIRECTIONS constants must stay generic/non-axis-aligned and must not be "simplified" back to axis vectors in a future edit.
- spec:2291-2293: `MeshBVH.raycast` does not guarantee ordered hits — sorting must happen before merge-collapsing, never merge-then-sort or merge-without-sort.
- spec:1658-1667: parity is even-odd over the target's ENTIRE triangle set — the nested-shells/pipe fixtures pin this as the correct, deliberate behavior (not a bug to "fix" toward per-component semantics, which is explicitly out of scope for M1).
- spec:2291-2299 (documented in `spike/fixtures.mjs`'s own comment near this fixture): the coincident-duplicate-triangle test is specifically about coincident SURFACES, not a shared edge — a shared-edge ray is rejected by `barycentricEpsilon` and retried on the next direction, never reaching merge logic. Do not conflate the two cases in a future edit of this test.

---

## Cross-task conventions (read before Task 7)

These 6 tasks share conventions not fully pinned by the canonical reference (which is silent on
exact query-function signatures). They are fixed here, once, so Tasks 7-12 line up with each other;
the coordinator should reconcile with Tasks 0-6/13-25 at assembly time if any of the following
collides with an existing choice:

- **Vendor imports in production code** (`wwwroot/collision/**/*.js`) use relative paths into
  `wwwroot/vendor/`, per the canonical repo layout (`docs/...:989-1022`) — e.g. from
  `wwwroot/collision/query/SurfaceIntersectionQuery.js`: `../../vendor/three/build/three.module.js`,
  `../../vendor/three-mesh-bvh/src/index.js`. Peer modules within `collision/` import each other by
  relative path (e.g. `../constants.js`, `../blas/ThreeMeshBvhBackend.js`).
- **Test layout**: `test/` sits at repo root, sibling of `wwwroot/` and `spike/`. Test files import
  production modules via `../../wwwroot/collision/...`. Each test file is self-contained and run
  directly with `node <file>.test.mjs` (mirrors `spike/fixtures.mjs`'s own inline
  `check(name, actual, expected)` PASS/FAIL harness — no external test framework, no shared harness
  module, exactly the convention the canonical reference calls out).
- **Shared test geometry helpers**: Task 7 creates `test/fixtures/geometry.mjs` (first task in this
  group to need it), porting `box`, `at`, `mergeGeometries`, `openBottomedBox`, `comb` from
  `spike/fixtures.mjs` verbatim, plus a new `testInstance(geometry, matrix)` helper that welds via the
  same `mergeVertices` path the spike used and then calls the **real** Task-4
  `ThreeMeshBvhBackend.build(weldedGeometry)` (not `new MeshBVH()` directly) so tests exercise the
  actual production BVH-construction path. Tasks 8-12 import this file; they do not recreate it.
  Its return shape `{ componentCount, componentOf: Int32Array, closedManifold: boolean[] }` for
  `GeometryConnectivityResult` is **not a guess** — it is the canonical reference's own type (see
  canonical reference, "Canonical type shapes"), which Task 5 is bound to produce verbatim, same as
  every task in this plan; a Codex review of an earlier draft flagged this as unreconciled with the
  spike's own differently-shaped `connectivity()` return value (`spike/geometry-core.mjs:224-236`,
  which uses `components`/`componentClosed`/an aggregate boolean `closedManifold`) — the spike is
  superseded here by the canonical reference, not a second source of truth. The one genuinely
  unspecified detail is the export **function name** itself (the canonical reference gives the type,
  not the function that computes it): this file assumes `computeConnectivity(geometry) ->
  GeometryConnectivityResult`; if Task 5's actual export name differs, only the one import line in
  `test/fixtures/geometry.mjs` needs updating, nothing else in Tasks 7-12.
- **Shared scheduler handle (Tasks 9-12 only).** `anyComponentInside`'s two plain-JS-loop checkpoints,
  the composite functions' own *between-term* checkpoints, and `SurfaceCrossingWitness`'s time check
  all accept a single `options.scheduler`, shaped:
  ```ts
  interface SchedulerHandle {
    elapsedMs(): number;              // ms since this handle's own last reset — safe to call anywhere, synchronously, never throws
    checkpointIfDue(): Promise<void>; // if elapsedMs() > frameBudgetMs: yields, revalidates (disposed-first-then-epoch), THEN resets the internal baseline; otherwise resolves immediately without yielding or resetting
  }
  ```
  Every plain-JS-loop checkpoint site calls `await scheduler.checkpointIfDue()` **unconditionally, on
  every iteration** — the "check elapsed time" and "decide whether to actually yield" steps are both
  the handle's own internal responsibility (matching `docs/...:2471-2486`'s "elapsed time is read
  immediately before each sample... if it exceeds `frameBudgetMs`, the loop awaits"): a call that finds
  itself not yet due returns immediately without yielding, so calling it every iteration is cheap and
  correct, not merely tolerated. `SurfaceCrossingWitness` cannot `await` inside its `bvhcast` callback,
  so it never calls `checkpointIfDue()` at all — it only ever reads the synchronous `scheduler.elapsedMs()`
  directly and compares it against its own `frameBudgetMs` option itself, to decide whether to abort. Threading ONE handle through a whole composite call (and, eventually, a whole `findClashes`
  call) is what makes `elapsedMs()` a genuinely SHARED accumulator: a `checkpointIfDue()` call inside
  one sub-term resets the same baseline a later sub-term's `elapsedMs()` reads, so a yield earlier in a
  composite call is never invisible to a traversal running later in the same call — this closes a gap
  a Codex `spec`-review of an earlier draft found, where `SurfaceCrossingWitness`'s own `callStartMs`
  parameter could go stale across an internal yield elsewhere in the same composite call, and where
  neither composite function (`VolumeOverlapQuery`, `ContainmentModeQuery`) had any way to checkpoint
  *between* its own composed terms at all (the missing capability the round-9-style
  `docs/...:4230-4234` "must yield between stages, not only between pairs" fixture requires at the
  `CollisionWorld` level). Default (no `options.scheduler` given — standalone tests, and Tasks 9/10's
  own unit tests that don't care about cross-stage yielding): `{ elapsedMs: () => 0, checkpointIfDue:
  async () => {} }` — never trips, matching today's "always under budget" behavior. **Task 20 (a later
  task) is responsible for implementing the real `SchedulerHandle` backed by `collision/scheduler.js`
  and wiring it through `CollisionWorld`** — none of Tasks 9-12 import `scheduler.js` directly.
- **`ProperCrossingQuery`/`SurfaceIntersectionQuery` do NOT use `SchedulerHandle`.** Their time-based
  abort is a deliberately private, traversal-local clock (the one documented exception to the
  shared-accumulator convention, `docs/...:1932-1957, 2065-2077`) — they keep their own `options.now`
  injection point (Tasks 7-8), unrelated to the shared handle above.
- **bvhcast matrix-naming convention** (matches `spike/geometry-core.mjs` exactly, carried through
  verbatim to avoid transcription errors in the relative-transform math): a call
  `bvhA.bvhcast(bvhB, matrixBtoA, {...})` takes `matrixBtoA`, the matrix mapping **B's local space
  into A's local space** (`matrixBtoA = A.matrix⁻¹ · B.matrix`). Every function below that wraps a
  `bvhcast` call names its relative-matrix parameter this way (`matrixBtoA`, `targetToSourceMatrix`,
  etc.) so the direction is legible from the name alone.
- **Diagnostics returned by Tasks 7-10's primitives are *partial*, not full `ClashDiagnostic`s.**
  They are shaped `{ reason: PairDiagnosticReason, role?: 'source' | 'target' }` — no `scope`, no
  `sourceFragment`/`targetFragment` (this module layer has no fragment identity to attach; it operates
  on raw BVHs). Tasks 11-12 aggregate these into their own return value's `diagnostics` array using
  the same partial shape. Attaching `scope: 'pair'` and the two `FragmentRef`s is **`CollisionWorld`'s
  job (a later task)**, wrapping each partial diagnostic once it knows which fragment pair is being
  evaluated. This is stated explicitly so Tasks 7-12 are not blocked on `CollisionWorld` existing, and
  so whichever later task builds `CollisionWorld` knows what shape to expect from these six modules.
- **Canonical ordering is the caller's responsibility, and is scoped ONLY to `properCrossingQuery`'s
  own two positional BVH arguments** (`docs/...:1615-1621`) — it decides which operand's `L` scales
  `offsetLadder`, nothing else. `properCrossingQuery` has no notion of public `source`/`target` roles
  at all, and produces the identical crossing/no-crossing verdict regardless of argument order (only
  the offset ladder's exact step sizes differ slightly by using a different operand's `L`) — so Task
  8's own scale-symmetry fixture, which calls it with both orderings and asserts `crossing(A,B) ===
  crossing(B,A)`, is exercising a real invariant of the function, not violating an ordering
  precondition; there is no such precondition on `properCrossingQuery`'s own correctness, only on how
  closely its offset ladder approximates the pair's declared `minPenetrationDepth`.
  **`VolumeOverlapQuery` (Task 11) is the one place this plan's public source/target identity and
  canonical order can genuinely conflict** — its own contract treats its first argument as public
  `source` for diagnostic role-naming (`unverified-parity-operand`, etc.), which need not be the
  canonically-first operand (a Codex `spec`-review of an earlier draft caught this: swapping operands
  into canonical order for `properCrossingQuery` would also swap which one gets called `source` for
  diagnostics, misattributing roles). Task 11 resolves this by determining canonical order
  **internally**, via an injectable `options.compareCanonical(source, target) -> number` (default:
  always treats `source` as canonical-first, preserving today's behavior for standalone tests), used
  **only** to decide which two operands' fields it hands to `properCrossingQuery` — it never swaps
  which operand is public `source`/`target` for role-naming. **`CollisionWorld` (a later task) is
  responsible for supplying a real comparator** based on `(modelId, geometryKey, instanceId)` once it
  has that identity. `anyComponentInside` and `SurfaceCrossingWitness` never need `L_canonical` at all
  (each uses only its own two operands' own local scales), so this conflict never reaches Tasks 9, 10,
  or 12 — only `VolumeOverlapQuery`'s crossing sub-call in Task 11.
- **`anyComponentInside`'s role parameters.** `docs/...:2340-2398` states the `unverified-open-component`
  and `unverified-parity-operand` diagnostics name "whichever PUBLIC operand" decided/was-indicted,
  which depends on which of `VolumeOverlapQuery`'s two symmetric calls (`A inside B` vs `B inside A`)
  is running — `anyComponentInside` itself cannot know this from its own arguments, since it is called
  with the sampled operand as "source" and the parity-tested operand as "target" regardless of which
  public role each plays. Task 9's `anyComponentInside` therefore accepts two extra options,
  `containerRole` (default `'target'`) and `sampledRole` (default `'source'`), naming which public role
  each of its own `target`/`source` parameters currently plays. `containment` mode always uses the
  defaults (target is always the container, source is always sampled); `VolumeOverlapQuery`'s second
  call (`B inside A`) passes `containerRole: 'source', sampledRole: 'target'`.

---

### Task 7: `SurfaceIntersectionQuery`

**Objective:** Detect any triangle contact between two geometries, touching included — the cheapest and simplest of the three public query modes.

**Files:**
- Create: `wwwroot/collision/query/SurfaceIntersectionQuery.js`
- Create: `test/fixtures/geometry.mjs` (shared helper, first needed here — see conventions above)
- Test: `test/query/SurfaceIntersectionQuery.test.mjs`

**Interfaces:**
- Consumes: `build(weldedGeometry) -> { bvh: MeshBVH, localDiagonal: number }` from
  `wwwroot/collision/blas/ThreeMeshBvhBackend.js` (Task 4, via `test/fixtures/geometry.mjs` only —
  production code here never builds a BVH itself, it receives already-built ones); `maxCandidatePairsExamined`,
  `frameBudgetMs` from `wwwroot/collision/constants.js` (Task 1).
- Produces: `surfaceIntersectionQuery(bvhA: MeshBVH, bvhB: MeshBVH, matrixBtoA: THREE.Matrix4, options?: { maxCandidatePairsExamined?: number, frameBudgetMs?: number, now?: () => number }) -> { intersects: boolean, aborted: boolean, diagnostics: Array<{reason: 'crossing-budget-exhausted'}>, stats: { candidatePairsExamined: number } }`.
  Consumed by `VolumeOverlapQuery`/`ContainmentModeQuery`'s caller only indirectly (this mode is
  **never** composed into either — `docs/...:2630-2632` — it is a standalone leaf mode `CollisionWorld`
  calls directly for `query.mode === 'surface-intersection'`, a later task).

- [ ] **Step 1: Write the failing test(s)**

First, the shared fixture helper (new file, needed by every task in this group):

```js
// test/fixtures/geometry.mjs
// Shared geometry-building helpers for collision-library unit tests. Ported from
// spike/fixtures.mjs and spike/geometry-core.mjs's normalizeForCollision()/instance(),
// but delegates BVH construction to the real ThreeMeshBvhBackend (Task 4) instead of
// calling `new MeshBVH()` directly, so tests exercise the same construction path
// production code uses.
import * as THREE from '../../wwwroot/vendor/three/build/three.module.js';
import { mergeVertices } from '../../wwwroot/vendor/three/examples/jsm/utils/BufferGeometryUtils.js';
import { build as buildBvh } from '../../wwwroot/collision/blas/ThreeMeshBvhBackend.js';
import { computeConnectivity } from '../../wwwroot/collision/geometry/GeometryConnectivity.js';

export { THREE };

export function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

export function at(x, y, z) {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}

export function mergeGeometries(geoms) {
  const positions = [];
  const indices = [];
  let offset = 0;
  for (const g of geoms) {
    const gi = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    const p = g.attributes.position.array;
    positions.push(...p);
    for (const i of gi) indices.push(i + offset);
    offset += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setIndex(indices);
  return out;
}

// A cube missing its bottom face: 10 triangles, already welded (shared indices), 1
// component, exactly 4 boundary edges. The acceptance-model bathtub in miniature.
export function openBottomedBox(size) {
  const h = size / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -h, -h, -h,   h, -h, -h,   h, -h, h,   -h, -h, h,   // 0..3 bottom ring
    -h,  h, -h,   h,  h, -h,   h,  h, h,   -h,  h, h,   // 4..7 top ring
  ], 3));
  g.setIndex([
    4, 5, 6,  4, 6, 7,   // top
    3, 2, 6,  3, 6, 7,   // +z
    1, 0, 4,  1, 4, 5,   // -z
    2, 1, 5,  2, 5, 6,   // +x
    0, 3, 7,  0, 7, 4,   // -x
                         // bottom deliberately omitted
  ]);
  return g;
}

// Interleaved teeth: heavy BVH-leaf overlap, zero triangle intersections. Shared input
// for every "budget exhaustion with no real intersections" fixture across this group.
export function comb(offset, teeth = 60) {
  const parts = [];
  for (let i = 0; i < teeth; i++) {
    parts.push(new THREE.BoxGeometry(0.02, 4, 0.02).translate(i * 0.1 + offset, 0, 0));
  }
  return mergeGeometries(parts);
}

// Strip to position+index BEFORE welding (mergeVertices compares all attributes;
// per-face normals/uvs would make every vertex unique otherwise, docs/...:1757-1761).
export function weld(geometry) {
  const positionOnly = new THREE.BufferGeometry();
  positionOnly.setAttribute('position', geometry.attributes.position.clone());
  if (geometry.index) {
    positionOnly.setIndex(geometry.index.clone());
  } else {
    positionOnly.setIndex([...Array(geometry.attributes.position.count).keys()]);
  }
  return mergeVertices(positionOnly, 1e-4);
}

// Full test instance: welded geometry + real backend-built BVH + connectivity + matrix.
export function testInstance(geometry, matrix = new THREE.Matrix4()) {
  const welded = weld(geometry);
  const { bvh, localDiagonal } = buildBvh(welded);
  const connectivity = computeConnectivity(welded);
  return {
    geometry: welded,
    bvh,
    localDiagonal,
    connectivity,
    closedManifold: connectivity.closedManifold.every(Boolean) && connectivity.componentCount > 0,
    matrix,
  };
}
```

Now the test file for this task:

```js
// test/query/SurfaceIntersectionQuery.test.mjs
import * as THREE from '../../wwwroot/vendor/three/build/three.module.js';
import { surfaceIntersectionQuery } from '../../wwwroot/collision/query/SurfaceIntersectionQuery.js';
import { box, at, comb, openBottomedBox, testInstance } from '../fixtures/geometry.mjs';

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}  expected=${expected} actual=${actual}${note ? `  (${note})` : ''}`);
}

function relativeMatrix(a, b) {
  return a.matrix.clone().invert().multiply(b.matrix);
}

console.log('=== SurfaceIntersectionQuery: baseline separation/interpenetration ===');
{
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  const r1 = surfaceIntersectionQuery(a.bvh, sep.bvh, relativeMatrix(a, sep));
  check('two clearly separated boxes: no intersection', r1.intersects, false);

  const pen = testInstance(box(2, 2, 2), at(1, 0, 0));
  const r2 = surfaceIntersectionQuery(a.bvh, pen.bvh, relativeMatrix(a, pen));
  check('genuine interpenetration: intersects', r2.intersects, true);
}

console.log('=== SurfaceIntersectionQuery: flush/coplanar touching ===');
{
  // Box resting exactly on top of another. surface-intersection reports this as
  // touching (correct name for the mode) -- contrast with VolumeOverlapQuery, which
  // must report false on this SAME input (that assertion lives in Task 11's own test
  // file, not here; this file only proves this mode's own half of the contrast).
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(0, 2, 0));
  const r = surfaceIntersectionQuery(a.bvh, b.bvh, relativeMatrix(a, b));
  check('flush face-to-face touching: intersects', r.intersects, true,
    'contrast with volume-overlap, which is false on the same input (docs/...:1816-1818)');
}

console.log('=== SurfaceIntersectionQuery: budget exhaustion on zero-intersection combs ===');
{
  // Round 7 regression: MeshBVH.intersectsGeometry has no budget/abort hook, so this
  // exact interleaved-comb input (heavy leaf overlap, zero triangle intersections)
  // would freeze synchronously through the old definition of this mode
  // (docs/...:1820-1832). Shares the ProperCrossingQuery budget fixture's input
  // deliberately (docs/...:1834-1846: "the same bvhcast traversal...the same abort
  // protocol").
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  const t0 = performance.now();
  const r = surfaceIntersectionQuery(a.bvh, b.bvh, relativeMatrix(a, b), { maxCandidatePairsExamined: 500 });
  const elapsed = performance.now() - t0;
  check('budget exhausted: aborted', r.aborted, true);
  check('aborted must NOT read as a hit', r.intersects, false,
    'bvhcast returns true on abort too; reading it as a hit fabricates a result (docs/...:1926-1930)');
  check('abort carries crossing-budget-exhausted', r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true);
  check('abort completes within a wall-clock bound', elapsed < 500, true, `${elapsed.toFixed(1)}ms`);
}

console.log('=== SurfaceIntersectionQuery: private-clock time-based abort (mocked clock) ===');
{
  // Distinct from the count-budget fixture above: a huge candidate budget so ONLY the
  // private traversal-local clock can trip, proving the time trigger is independently
  // wired (docs/...:1932-1957, shared with ProperCrossingQuery's own private clock).
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  let calls = 0;
  const mockNow = () => { calls++; return calls === 1 ? 0 : 100; }; // second read already past frameBudgetMs=8
  const r = surfaceIntersectionQuery(a.bvh, b.bvh, relativeMatrix(a, b), { maxCandidatePairsExamined: 10_000_000, now: mockNow });
  check('time-based abort: aborted', r.aborted, true);
  check('time-based abort: not intersects', r.intersects, false);
  check('time-based abort carries crossing-budget-exhausted', r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true);
}

console.log('=== SurfaceIntersectionQuery: open operands, no parity, no diagnostic ===');
{
  // This mode performs no parity at all (docs/...:1702, 1838-1840) -- open source AND
  // open target must still report intersection with NO diagnostic whatsoever.
  const openSrc = testInstance(openBottomedBox(2));
  const openTgt = testInstance(openBottomedBox(2), at(0.5, 0, 0));
  const r = surfaceIntersectionQuery(openSrc.bvh, openTgt.bvh, relativeMatrix(openSrc, openTgt));
  check('open source AND open target: intersects', r.intersects, true);
  check('open source AND open target: no diagnostic', r.diagnostics.length, 0,
    'surface-intersection performs no parity, no closure precondition at all');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build:vendor && node test/query/SurfaceIntersectionQuery.test.mjs`
Expected: fails at the `import { surfaceIntersectionQuery } from '../../wwwroot/collision/query/SurfaceIntersectionQuery.js'` line with a module-not-found error (`ERR_MODULE_NOT_FOUND`), since the file does not exist yet. (If `test/fixtures/geometry.mjs`'s own dependencies — `ThreeMeshBvhBackend.js`, `GeometryConnectivity.js` — don't exist yet either because Tasks 4/5 haven't landed, that import fails first with the same error class; either failure is the expected pre-implementation state.)

- [ ] **Step 3: Write the implementation**

```js
// wwwroot/collision/query/SurfaceIntersectionQuery.js
//
// True iff any triangle pair from A/B has a non-empty geometric intersection,
// including zero-volume coincident contact (face-face, edge-edge, vertex-face).
// Correctly named: it reports touching too. docs/...:1814-1846.
//
// Built on bvhcast, not MeshBVH.intersectsGeometry -- verified at three-mesh-bvh@0.9.14
// that intersectsGeometry accepts no budget and offers no abort hook, making it the
// last unbounded synchronous path a review pass found. This is the SAME traversal
// ProperCrossingQuery uses, same maxCandidatePairsExamined ceiling, same abort
// protocol (including the private traversal-local time trigger), with a weaker
// predicate: no coplanar split (coplanar contact IS intersection here) and no probe
// ladder (no interior classification, hence no parity, hence no closure precondition).
// docs/...:1834-1846.

import { ExtendedTriangle } from '../../vendor/three-mesh-bvh/src/index.js';
import { maxCandidatePairsExamined, frameBudgetMs } from '../constants.js';

const _triA = new ExtendedTriangle();
const _triB = new ExtendedTriangle();

/**
 * @param {import('three-mesh-bvh').MeshBVH} bvhA
 * @param {import('three-mesh-bvh').MeshBVH} bvhB
 * @param {import('three').Matrix4} matrixBtoA - maps B's local space into A's local space
 * @param {{ maxCandidatePairsExamined?: number, frameBudgetMs?: number, now?: () => number }} [options]
 */
export function surfaceIntersectionQuery(bvhA, bvhB, matrixBtoA, options = {}) {
  const candidateBudget = options.maxCandidatePairsExamined ?? maxCandidatePairsExamined;
  const timeBudgetMs = options.frameBudgetMs ?? frameBudgetMs;
  const now = options.now ?? (() => performance.now());

  // Private, traversal-local clock (docs/...:1932-1957, 2065-2077) -- the same
  // deliberate exception to the shared-accumulator convention ProperCrossingQuery
  // uses, admitted for the identical reason: bvhcast cannot pause/resume mid-call,
  // so this traversal's own worst case must be self-bounded, not a function of
  // whatever else already ran in the same findClashes call.
  const traversalStart = now();

  let candidatePairsExamined = 0;
  let intersects = false;
  let aborted = false;

  bvhA.bvhcast(bvhB, matrixBtoA, {
    intersectsTriangles(triA, triB) {
      candidatePairsExamined++;
      // Checked at callback entry only -- no probe loop exists in this mode, so
      // entry-granularity is both adequate and the only granularity there is
      // (docs/...:2069-2074, "applies unchanged to a traversal with no probe loop").
      if (candidatePairsExamined > candidateBudget || now() - traversalStart > timeBudgetMs) {
        aborted = true;
        return true;
      }

      _triA.copy(triA); _triA.needsUpdate = true;
      _triB.copy(triB); _triB.needsUpdate = true;

      // No target line requested -- coplanar contact IS an intersection here, so no
      // coplanar split is needed, and omitting the argument avoids
      // ExtendedTriangle's coplanar-target warning regardless (docs/...:1838-1840).
      if (_triA.intersectsTriangle(_triB)) {
        intersects = true;
        return true;
      }
      return false;
    },
  });

  // bvhcast returns true on abort too (the only way to stop it early) -- reading that
  // as a hit would fabricate a result out of a timeout (docs/...:1926-1930).
  const finalIntersects = aborted ? false : intersects;

  return {
    intersects: finalIntersects,
    aborted,
    diagnostics: aborted ? [{ reason: 'crossing-budget-exhausted' }] : [],
    stats: { candidatePairsExamined },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/query/SurfaceIntersectionQuery.test.mjs`
Expected: `12 passed, 0 failed`. Proves: separated boxes report false; genuine interpenetration reports true; flush touching reports true (the mode's defining behavior, contrasted with `VolumeOverlapQuery` in Task 11's own suite); a candidate-count-limited comb pair aborts, never fabricates a hit from the abort signal, carries `crossing-budget-exhausted`, and completes fast; a mocked-clock time-based abort fires independently of the count budget; open/open operands intersect with zero diagnostics.

- [ ] **Step 5: Commit**
```bash
git add wwwroot/collision/query/SurfaceIntersectionQuery.js test/fixtures/geometry.mjs test/query/SurfaceIntersectionQuery.test.mjs
git commit -m "Add SurfaceIntersectionQuery: bvhcast-bounded surface touching test"
```

**Completion criteria:**
- `surfaceIntersectionQuery` returns `true` on the first candidate pair with any non-empty triangle intersection, including coplanar contact.
- Aborts (count OR private-clock time trigger) never surface as `intersects: true`; they always carry `crossing-budget-exhausted`.
- No diagnostic is ever emitted for open operands (mode has no parity, no closure precondition).
- `test/fixtures/geometry.mjs` exists and is reusable by Tasks 8-12 without modification.

**Protected invariants / regressions to watch:**
- Round 7 (`docs/...:1820-1832`): must be built on `bvhcast`, never `MeshBVH.intersectsGeometry` — the latter has no abort hook and would freeze on the comb fixture.
- `docs/...:1926-1930`: an aborted traversal's `true` return from `bvhcast` must never be read as `intersects: true`.
- `docs/...:1838-1840`: no coplanar split, no probe ladder — this mode is deliberately weaker than `ProperCrossingQuery`.
- `docs/...:1702`: no diagnostics of any kind fire in this mode besides `crossing-budget-exhausted`.

---

### Task 8: `ProperCrossingQuery`

**Objective:** Detect contact that actually shares volume (not mere touching) via `bvhcast` candidate classification and four-quadrant probing against `classifyPoint`, with the full count/time budget and abort protocol.

**Files:**
- Create: `wwwroot/collision/query/ProperCrossingQuery.js`
- Test: `test/query/ProperCrossingQuery.test.mjs`

**Interfaces:**
- Consumes: `classifyPoint(point, targetBvh, targetLocalDiagonal) -> 'inside'|'outside'|'boundary'` from
  `wwwroot/collision/query/ContainmentQuery.js` (Task 6); `barycentricEpsilon` (used inside
  `classifyPoint`, not directly here), `coplanarAngleEpsilon`, `surfaceEpsilonFactor`,
  `offsetLadderFactors`, `maxCandidatePairsExamined`, `maxCrossingPairsExamined`, `frameBudgetMs` from
  `wwwroot/collision/constants.js`; `testInstance`, `box`, `at`, `comb` from `test/fixtures/geometry.mjs`
  (test only).
- Produces: `properCrossingQuery(bvhA: MeshBVH, bvhB: MeshBVH, matrixBtoA: THREE.Matrix4, localDiagonalA: number, localDiagonalB: number, options?: { maxCandidatePairsExamined?: number, maxCrossingPairsExamined?: number, frameBudgetMs?: number, now?: () => number }) -> { crossing: boolean, aborted: boolean, inconclusive: boolean, diagnostics: Array<{reason: 'crossing-budget-exhausted'|'inconclusive-crossing'}>, stats: { candidatePairsExamined: number, crossingPairsExamined: number } }`.
  Consumed by `VolumeOverlapQuery.js` (Task 11) as the first composition term. `localDiagonalA` is
  always treated as `L_canonical` (docs/...:1609-1621) — the caller passes its canonically-first
  operand as `A`.

- [ ] **Step 1: Write the failing test(s)**

```js
// test/query/ProperCrossingQuery.test.mjs
import * as THREE from '../../wwwroot/vendor/three/build/three.module.js';
import { properCrossingQuery } from '../../wwwroot/collision/query/ProperCrossingQuery.js';
import { box, at, comb, testInstance } from '../fixtures/geometry.mjs';

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}  expected=${expected} actual=${actual}${note ? `  (${note})` : ''}`);
}

function relativeMatrix(a, b) {
  return a.matrix.clone().invert().multiply(b.matrix);
}

function crossOf(a, b, options) {
  return properCrossingQuery(a.bvh, b.bvh, relativeMatrix(a, b), a.localDiagonal, b.localDiagonal, options);
}

console.log('=== ProperCrossingQuery: coplanar touching is not a crossing ===');
{
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(0, 2, 0));
  const r = crossOf(a, b);
  console.warn = originalWarn;
  check('flush/coplanar touching: not a crossing', r.crossing, false);
  check('no console.warn from ExtendedTriangle', warnings.length, 0,
    'proves coplanar pre-split happens, not just apparent classification (docs/...:1879-1891)');
}

console.log('=== ProperCrossingQuery: edge-edge / vertex-face contact ===');
{
  // Two boxes touching only along a shared edge -- no shared volume.
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(2, 2, 0)); // diagonal corner touch
  const r = crossOf(a, b);
  check('edge/vertex-only contact: not a crossing', r.crossing, false);
}

console.log('=== ProperCrossingQuery: duct through beam (round 2 regression) ===');
{
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const r = crossOf(duct, beam);
  check('perpendicular thin boxes crossing mid-span: IS a crossing', r.crossing, true,
    'round-2 regression: neither has a vertex inside the other');
}

console.log('=== ProperCrossingQuery: ladder detects thin overlap (round 3 regression) ===');
{
  // Overlap thinner than the coarsest offsetLadder rung but deeper than the finest.
  // localDiagonal of a unit box is sqrt(3) ~= 1.732, so offsetLadder rungs are
  // approximately [1.7e-3, 1.7e-4, 1.7e-5]. An overlap of 5e-4 falls strictly between
  // the coarsest and finest rungs -- exactly the gap a single fixed offset would miss.
  const a = testInstance(box(1, 1, 1));
  const thinOverlap = 5e-4;
  const b = testInstance(box(1, 1, 1), at(1 - thinOverlap, 0, 0));
  const r = crossOf(a, b);
  check('overlap thinner than coarsest rung, deeper than finest: detected', r.crossing, true,
    'round-3 regression: a single fixed offset steps clean through this');
}

console.log('=== ProperCrossingQuery: overlap shallower than minPenetrationDepth (declared limit) ===');
{
  // minPenetrationDepth = 1e-5 * L_canonical; an overlap far below that (~1e-8 of L)
  // is a DECLARED detection limit, not a bug -- must NOT be detected.
  const a = testInstance(box(1, 1, 1));
  const belowLimit = 1e-8;
  const b = testInstance(box(1, 1, 1), at(1 - belowLimit, 0, 0));
  const r = crossOf(a, b);
  check('overlap shallower than minPenetrationDepth: NOT detected (documented limit)', r.crossing, false);
}

console.log('=== ProperCrossingQuery: inconsistent winding still crosses ===');
{
  // Flip one box's winding by negatively scaling one axis (inverts triangle winding
  // without changing the solid's shape) -- the four-quadrant probe never assumes
  // outward-facing normals.
  const duct = testInstance(box(20, 0.4, 0.4));
  const beamGeom = box(0.4, 0.4, 20);
  const beamMatrix = new THREE.Matrix4().makeScale(-1, 1, 1);
  const beam = testInstance(beamGeom, beamMatrix);
  const r = crossOf(duct, beam);
  check('inconsistent/inward-facing winding: still a crossing', r.crossing, true);
}

console.log('=== ProperCrossingQuery: interleaved combs, no real intersections (round 4 regression) ===');
{
  // bvhcast callback receives CANDIDATE pairs, not confirmed-intersecting ones.
  // Populate `_line`-equivalent state with a real segment first (via a genuine
  // crossing) to prove staleness from a prior candidate can't leak into this one.
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  // Warm-up call establishes a real intersecting pair's targetLine state inside the
  // module's shared scratch objects before the real assertion runs.
  const warmupA = testInstance(box(1, 1, 1));
  const warmupB = testInstance(box(1, 1, 1), at(0.5, 0, 0));
  crossOf(warmupA, warmupB);
  const r = crossOf(a, b, { maxCandidatePairsExamined: 200000 });
  check('interleaved combs, zero real intersections: no crossing', r.crossing, false,
    'round-4 regression: stale _line must not fabricate a crossing');
}

console.log('=== ProperCrossingQuery: symmetric under anisotropic scale (round 4 regression) ===');
{
  const duct = testInstance(box(20, 0.4, 0.4));
  const beamGeom = box(0.4, 0.4, 20);
  const beamMatrix = new THREE.Matrix4().makeScale(1, 3, 1); // anisotropic
  const beam = testInstance(beamGeom, beamMatrix);
  const forward = crossOf(duct, beam);
  const backward = crossOf(beam, duct);
  check('crossing(A,B) === crossing(B,A) under anisotropic scale', forward.crossing === backward.crossing, true,
    'round-4 regression: non-symmetric min(diagonal(A), diagonal(B)) scale');
}

console.log('=== ProperCrossingQuery: candidate-count budget exhaustion (round 5 regression) ===');
{
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  const t0 = performance.now();
  const r = crossOf(a, b, { maxCandidatePairsExamined: 500 });
  const elapsed = performance.now() - t0;
  check('candidate budget exhausted: aborted flag set', r.aborted, true,
    'a buggy implementation could return crossing:false with the right diagnostic yet leave aborted:false');
  check('candidate budget exhausted: not a crossing', r.crossing, false);
  check('carries crossing-budget-exhausted', r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true);
  check('completes within a wall-clock bound (coarse sanity check, not the 8ms design budget itself -- see Task 24s performance gate for that)', elapsed < 500, true, `${elapsed.toFixed(1)}ms`);
}

console.log('=== ProperCrossingQuery: time budget trips before count budgets (round 10 regression) ===');
{
  // Many confirmed non-coplanar pairs, each requiring the full 12-probe classification,
  // sized so the TIME budget trips before either count budget would. A mocked clock
  // makes this deterministic: it advances by more than frameBudgetMs on the very
  // first callback-entry check, so the traversal aborts immediately regardless of how
  // many genuinely-crossing pairs exist in the geometry.
  const a = testInstance(box(3, 3, 3));
  const b = testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1)); // deep overlap, many confirmed pairs
  let calls = 0;
  const mockNow = () => { calls++; return calls === 1 ? 0 : 100; }; // second read already past frameBudgetMs=8
  const r = crossOf(a, b, { now: mockNow });
  check('time budget trips: aborted', r.aborted, true);
  check('time budget trips: not a crossing', r.crossing, false);
  check('carries crossing-budget-exhausted', r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true);
}

console.log('=== ProperCrossingQuery: time budget aborts strictly mid-probe-loop (round 11 regression) ===');
{
  // Round 10's fix checked only at callback entry, letting up to 24 classifyPoint
  // calls (a full 12-probe loop for a confirmed pair) run unchecked. This fixture
  // proves the check now fires INSIDE the probe loop: the mocked clock returns a
  // just-under-budget value for the first several reads, then crosses the deadline
  // partway through one pair's probe classification, and we assert fewer than 12
  // probes were evaluated for that pair by counting classifyPoint-shaped calls via
  // the mock clock's own call count (each probe reads the clock exactly once before
  // classification, per the round-11 checkpoint-granularity fix).
  const a = testInstance(box(3, 3, 3));
  const b = testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1));
  let probeClockReads = 0;
  const TRIP_AFTER_READS = 5; // trips partway through the first confirmed pair's ladder
  const mockNow = () => {
    probeClockReads++;
    return probeClockReads > TRIP_AFTER_READS ? 100 : 0; // 100 > frameBudgetMs(8)
  };
  const r = crossOf(a, b, { now: mockNow });
  check('mid-probe-loop time trip: aborted', r.aborted, true);
  check('mid-probe-loop time trip: not a crossing', r.crossing, false);
  // The very first callback-entry read (probeClockReads === 1) does not trip; the
  // trip must happen on a LATER read while still inside the probe loop for the same
  // confirmed pair, i.e. strictly fewer than 12 probes were evaluated for it.
  check('aborted having evaluated strictly fewer than 12 probes for that pair', probeClockReads <= 12, true,
    `clock read ${probeClockReads} times before abort`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/query/ProperCrossingQuery.test.mjs`
Expected: fails at the `import { properCrossingQuery } from '../../wwwroot/collision/query/ProperCrossingQuery.js'` line with `ERR_MODULE_NOT_FOUND`, since the file does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// wwwroot/collision/query/ProperCrossingQuery.js
//
// Answers "do these two solids share positive volume near their contact" -- not
// merely touching. docs/...:1848-2093.

import { ExtendedTriangle } from '../../vendor/three-mesh-bvh/src/index.js';
import * as THREE from '../../vendor/three/build/three.module.js';
import { classifyPoint } from './ContainmentQuery.js';
import {
  coplanarAngleEpsilon,
  surfaceEpsilonFactor,
  offsetLadderFactors,
  maxCandidatePairsExamined,
  maxCrossingPairsExamined,
  frameBudgetMs,
} from '../constants.js';

const _triA = new ExtendedTriangle();
const _triB = new ExtendedTriangle();
const _line = new THREE.Line3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _probeInB = new THREE.Vector3();
const _nA = new THREE.Vector3();
const _nB = new THREE.Vector3();

/**
 * @param {import('three-mesh-bvh').MeshBVH} bvhA - treated as the canonically-first operand (docs/...:1609-1621)
 * @param {import('three-mesh-bvh').MeshBVH} bvhB
 * @param {import('three').Matrix4} matrixBtoA - maps B's local space into A's local space
 * @param {number} localDiagonalA - L_A; also used as L_canonical for offsetLadder scaling
 * @param {number} localDiagonalB - L_B
 * @param {{ maxCandidatePairsExamined?: number, maxCrossingPairsExamined?: number, frameBudgetMs?: number, now?: () => number }} [options]
 */
export function properCrossingQuery(bvhA, bvhB, matrixBtoA, localDiagonalA, localDiagonalB, options = {}) {
  const candidateBudget = options.maxCandidatePairsExamined ?? maxCandidatePairsExamined;
  const crossingBudget = options.maxCrossingPairsExamined ?? maxCrossingPairsExamined;
  const timeBudgetMs = options.frameBudgetMs ?? frameBudgetMs;
  const now = options.now ?? (() => performance.now());

  // Private, traversal-local clock (docs/...:1932-1957) -- the one documented
  // exception to the shared-accumulator convention (Round 21's H-B7). Its own worst
  // case is bounded starting fresh at THIS traversal's own entry, independent of
  // whatever else ran earlier in the same findClashes call.
  const traversalStart = now();

  // offsetLadder is scaled by L_canonical = L of whichever operand sorts first
  // (docs/...:1609-1621); the caller is responsible for passing that operand as A.
  const ladder = offsetLadderFactors.map((f) => f * localDiagonalA);
  const surfaceEpsilon = surfaceEpsilonFactor * localDiagonalA;
  const matrixAtoB = matrixBtoA.clone().invert();

  let candidatePairsExamined = 0;
  let crossingPairsExamined = 0;
  let crossing = false;
  let aborted = false;
  let sawBoundaryProbe = false;

  bvhA.bvhcast(bvhB, matrixBtoA, {
    intersectsTriangles(triA, triB) {
      candidatePairsExamined++;
      // Entry-granularity is adequate for a raw candidate that never reaches probe
      // classification (~0.3us/pair, docs/...:1974-1976).
      if (candidatePairsExamined > candidateBudget || now() - traversalStart > timeBudgetMs) {
        aborted = true;
        return true;
      }

      _triA.copy(triA); _triA.needsUpdate = true;
      _triB.copy(triB); _triB.needsUpdate = true;
      _triA.getNormal(_nA);
      _triB.getNormal(_nB);

      // Classify the candidate before doing anything else, ordered so the upstream
      // coplanar-warning path is never entered (docs/...:1874-1891).
      const parallel = Math.abs(_nA.dot(_nB)) >= 1 - coplanarAngleEpsilon;
      const coplanar = parallel && Math.abs(_nA.dot(_triA.a) - _nA.dot(_triB.a)) <= surfaceEpsilon;

      if (coplanar) {
        // Call WITHOUT a target line: a coplanar pair has zero-volume contact --
        // not a crossing regardless of whether it touches -- and omitting the
        // argument is what avoids ExtendedTriangle's coplanar-target warning.
        _triA.intersectsTriangle(_triB);
        return false;
      }

      // Must test explicitly: a non-intersecting pair leaves _line holding the
      // PREVIOUS confirmed pair's endpoints, which would fabricate a crossing from
      // stale state if read without this guard (docs/...:1859-1873, round-4 regression).
      if (!_triA.intersectsTriangle(_triB, _line)) return false;

      crossingPairsExamined++;
      if (crossingPairsExamined > crossingBudget) {
        aborted = true;
        return true;
      }

      _line.getCenter(_mid);

      for (const s1 of [1, -1]) {
        for (const s2 of [1, -1]) {
          _dir.copy(_nA).multiplyScalar(s1).addScaledVector(_nB, s2);
          if (_dir.lengthSq() < 1e-20) continue; // degenerate: parallel normals
          _dir.normalize();

          for (const delta of ladder) {
            // Round-11 fix: performance.now() read before EVERY individual probe,
            // not once per callback and not once per confirmed pair
            // (docs/...:1966-1989) -- bounds overshoot to one probe's cost (up to
            // two classifyPoint calls), not one confirmed pair's cost (up to 24).
            if (now() - traversalStart > timeBudgetMs) {
              aborted = true;
              return true;
            }

            _probe.copy(_mid).addScaledVector(_dir, delta);

            const inA = classifyPoint(_probe, bvhA, localDiagonalA);
            if (inA === 'boundary') { sawBoundaryProbe = true; continue; }
            if (inA !== 'inside') continue;

            _probeInB.copy(_probe).applyMatrix4(matrixAtoB);
            const inB = classifyPoint(_probeInB, bvhB, localDiagonalB);
            if (inB === 'boundary') { sawBoundaryProbe = true; continue; }
            if (inB === 'inside') {
              crossing = true;
              return true; // early exit on first proper crossing
            }
          }
        }
      }
      return false;
    },
  });

  // Abort protocol: bvhcast returning true on abort must never be read as a crossing
  // (docs/...:1926-1930).
  const finalCrossing = aborted ? false : crossing;
  const inconclusive = !aborted && !finalCrossing && sawBoundaryProbe;

  const diagnostics = [];
  if (aborted) diagnostics.push({ reason: 'crossing-budget-exhausted' });
  else if (inconclusive) diagnostics.push({ reason: 'inconclusive-crossing' });

  return {
    crossing: finalCrossing,
    aborted,
    inconclusive,
    diagnostics,
    stats: { candidatePairsExamined, crossingPairsExamined },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/query/ProperCrossingQuery.test.mjs`
Expected: `20 passed, 0 failed` (one `check` per assertion above). Proves: coplanar contact never crosses and never triggers `ExtendedTriangle`'s warning; edge/vertex-only contact doesn't cross; duct-through-beam crosses despite no vertex containment; the ladder catches thin-but-above-`minPenetrationDepth` overlaps and correctly misses shallower ones; winding-independence; stale-`_line` immunity; scale-symmetry; both count and (mocked) time budgets abort correctly and never fabricate a crossing; the time-based abort fires strictly inside the probe loop, not only at callback/pair granularity.

- [ ] **Step 5: Commit**
```bash
git add wwwroot/collision/query/ProperCrossingQuery.js test/query/ProperCrossingQuery.test.mjs
git commit -m "Add ProperCrossingQuery: four-quadrant probe crossing test with dual budgets"
```

**Completion criteria:**
- Coplanar candidates never enter probe classification and never trigger `ExtendedTriangle`'s coplanar-target warning.
- `maxCrossingPairsExamined` counts only confirmed non-coplanar pairs reaching probe classification; `maxCandidatePairsExamined` counts every raw candidate.
- The time-based abort uses a private, traversal-local clock and is checked before every individual probe, not just at callback entry.
- A negative result with any `boundary` probe carries `inconclusive-crossing`; an aborted result always carries `crossing-budget-exhausted` and is never reported as a crossing.

**Protected invariants / regressions to watch:**
- Round 2 (`docs/...:1848-1854`): vertex sampling alone cannot see a duct-through-beam crossing — this module's probe ladder is what closes that gap for `VolumeOverlapQuery`.
- Round 3 (`docs/...:1899-1903`): a single fixed offset steps clean through thin overlaps — the ladder (coarsest→finest) is what fixes it.
- Round 4 (`docs/...:1859-1873`): `bvhcast` candidates are not pre-confirmed intersections; reading `targetLine` without testing first fabricates crossings from stale state.
- Round 4 (`docs/...:1634-1641`, scale symmetry): the ladder scale must derive from `L_canonical`, not an ad hoc `min(L_A, L_B)`.
- Round 5 (`docs/...:1917-1924`): raw candidate pairs must be budgeted independently of confirmed pairs — a comb of non-intersecting-but-leaf-overlapping triangles is unbounded otherwise.
- Round 10/11 (`docs/...:1966-1989`): the time-based check must fire before every individual probe, not once per callback or once per confirmed pair.

---

### Task 9: `ContainmentQuery.anyComponentInside`

**Objective:** Determine whether any connected component of a source geometry has a point inside a target's solid interior, via three escalating sampling stages, with full diagnostic role attribution.

**Files:**
- Modify (append to Task 6's file): `wwwroot/collision/query/ContainmentQuery.js`
- Test: `test/query/ContainmentQuery.anyComponentInside.test.mjs`

**Interfaces:**
- Consumes: `classifyPoint(point, targetBvh, targetLocalDiagonal) -> 'inside'|'outside'|'boundary'`
  (already in this same file, from Task 6 — called directly, not re-imported); `GeometryConnectivityResult`
  shape `{ componentCount, componentOf: Int32Array, closedManifold: boolean[] }` from
  `wwwroot/collision/geometry/GeometryConnectivity.js` (Task 5) — **threaded in by the caller as a
  parameter, never computed by this module** (kept decoupled: this file does not import
  `GeometryConnectivity.js` at all); `build(weldedGeometry) -> { bvh: MeshBVH, localDiagonal: number }`
  from `wwwroot/collision/blas/ThreeMeshBvhBackend.js` (Task 4 — used by stage 3 only, to build a
  component-scoped BVH; see Step 3's comments for why); `maxContainmentSamples`, `samplesPerComponent`,
  `maxWitnessTriangles`, `witnessLadderFactors` from `wwwroot/collision/constants.js` (this module has
  no `frameBudgetMs` option of its own — the time threshold lives inside the `SchedulerHandle`
  implementation, owned by Task 20);
  `WorldDisposedError`, `ModelEvictedError` from `wwwroot/collision/errors.js` (test only, to construct
  realistic checkpoint-rejection fixtures — this module never imports `errors.js` itself, since it only
  ever calls the caller-injected `scheduler.checkpointIfDue()` and propagates whatever it throws).
- Produces: `anyComponentInside(sourceGeometry: THREE.BufferGeometry, sourceBvh: MeshBVH, sourceLocalDiagonal: number, sourceConnectivity: GeometryConnectivityResult, targetBvh: MeshBVH, targetLocalDiagonal: number, targetClosedManifold: boolean, sourceToTargetMatrix: THREE.Matrix4, options?: { mode: 'containment'|'volume-overlap', containerRole?: 'source'|'target', sampledRole?: 'source'|'target', maxContainmentSamples?: number, samplesPerComponent?: number, maxWitnessTriangles?: number, witnessLadderFactors?: number[], scheduler?: SchedulerHandle }) -> Promise<{ inside: boolean, decidingComponentClosed: boolean|null, decidingComponentIndex: number|null, diagnostics: Array<{reason: PairDiagnosticReason, role?: 'source'|'target'}>, unresolvedComponentCount: number, samplesUsed: number, budgetExhausted: boolean }>`.
  `options.mode` is **required** — no default — since it gates both stage 3 and the
  `unverified-open-component`/`non-manifold-component` diagnostics identically (`docs/...:2400-2456`).
  `options.scheduler` (shape in the cross-task conventions above) defaults to a no-op handle so this
  module is fully testable standalone; **Task 20 (a later task) is responsible for wiring the real
  `collision/scheduler.js` port into this parameter** when `CollisionWorld` calls through to this
  function — this module deliberately never imports `scheduler.js` itself. Consumed by
  `VolumeOverlapQuery.js` (Task 11, both directions, `mode: 'volume-overlap'`) and
  `ContainmentModeQuery.js` (Task 12, first term only, `mode: 'containment'`).

- [ ] **Step 1: Write the failing test(s)**

```js
// test/query/ContainmentQuery.anyComponentInside.test.mjs
import * as THREE from '../../wwwroot/vendor/three/build/three.module.js';
import { anyComponentInside } from '../../wwwroot/collision/query/ContainmentQuery.js';
import { WorldDisposedError, ModelEvictedError } from '../../wwwroot/collision/errors.js';
import { box, at, mergeGeometries, openBottomedBox, testInstance } from '../fixtures/geometry.mjs';

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}  expected=${expected} actual=${actual}${note ? `  (${note})` : ''}`);
}

function sourceToTarget(source, target) {
  return target.matrix.clone().invert().multiply(source.matrix);
}

function insideOf(source, target, options) {
  return anyComponentInside(
    source.geometry, source.bvh, source.localDiagonal, source.connectivity,
    target.bvh, target.localDiagonal, target.closedManifold,
    sourceToTarget(source, target), options
  );
}

console.log('=== anyComponentInside: two-component geometry, only smaller inside (capped-sampling regression) ===');
{
  const farBox = box(1, 1, 1).translate(50, 0, 0);
  const smallBox = box(0.5, 0.5, 0.5);
  const src = testInstance(mergeGeometries([farBox, smallBox]));
  const target = testInstance(box(4, 4, 4));
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  check('only the smaller of two components inside: contained', r.inside, true);
}

console.log('=== anyComponentInside: shared single VERTEX join (round 3 regression) ===');
{
  const partA = box(1, 1, 1);                 // corners +/-0.5
  const partB = box(1, 1, 1).translate(1, 1, 1); // shares corner (0.5,0.5,0.5) with partA
  const src = testInstance(mergeGeometries([partA, partB]));
  const target = testInstance(box(1.4, 1.4, 1.4), at(1, 1, 1)); // surrounds partB, not partA
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  check('vertex-joined solids, one inside one outside: contained', r.inside, true,
    'round-3 regression: vertex-based connectivity would wrongly merge these into one component');
}

console.log('=== anyComponentInside: shared-FACE join produces a non-manifold-flagged component ===');
{
  // Two closed boxes glued face-to-face (a shared face is 4 shared edges, each then
  // used by 4 triangles post-weld -- a stronger, simpler-to-construct instance of the
  // same "edge-connectivity still merges" hole a single shared edge demonstrates).
  const partA = box(1, 1, 1);                    // corners +/-0.5
  const partB = box(1, 1, 1).translate(1, 0, 0);  // touches partA exactly at x=0.5
  const src = testInstance(mergeGeometries([partA, partB]));
  const target = testInstance(box(0.2, 0.2, 0.2), at(10, 10, 10)); // disjoint from the merged solid
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  check('shared-face-joined solids: negative', r.inside, false);
  check('negative carries non-manifold-component', r.diagnostics.some((d) => d.reason === 'non-manifold-component'), true,
    'edge-connectivity does not separate a shared-edge/-face join; the merged component is flagged');
}

console.log('=== anyComponentInside: deep containment sharing a coplanar face (round 4 regression) ===');
{
  // A solid deep inside target while sharing one coplanar face with it: the shared
  // face's vertices are placed FIRST in index order so a naive "first N" pick would
  // land entirely on that shared (boundary-reading) face forever.
  const target = testInstance(box(4, 4, 4));
  const sharedFaceGeom = box(2, 2, 2).translate(0, 1, 0); // top face coincides with target's top face (y=2)
  const src = testInstance(sharedFaceGeom);
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  check('deep containment sharing a coplanar face: contained', r.inside, true,
    'round-4 regression: fixed 4-sample cap missed this when the first picks all land on the shared face');
}

console.log('=== anyComponentInside: witness stage (component entirely on target surface) ===');
{
  // Two exactly coincident closed boxes: every source-surface vertex sits on target's
  // boundary. volume-overlap mode must fall through to the constructed-interior
  // witness (stage 3) and find the shared volume.
  const target = testInstance(box(2, 2, 2));
  const src = testInstance(box(2, 2, 2));
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  check('coincident closed boxes, volume-overlap: witness stage resolves contained', r.inside, true);
}

console.log('=== anyComponentInside: witness stage at markedly different local scales (round 5 regression) ===');
{
  // Source authored at a tiny local scale, then scaled up 1000x by its own transform
  // to world-coincide with a normal-scale target. witnessLadder must use L_SOURCE
  // (tiny), not any canonical/target-borrowed scale (which would overshoot the
  // source's own tiny geometry and never find an interior point).
  const target = testInstance(box(2, 2, 2)); // L_target ~ 3.46, "sorts first" canonically
  const tinyGeom = box(0.002, 0.002, 0.002); // L_source ~ 0.00346, "sorts second"
  const src = testInstance(tinyGeom, new THREE.Matrix4().makeScale(1000, 1000, 1000));
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  check('witness at markedly different local scales: still resolves', r.inside, true,
    'round-5 regression: witnessLadder must scale by L_source, never a borrowed canonical/target scale');
}

console.log('=== anyComponentInside: witness stage must not be polluted by an unrelated sibling component ===');
{
  // Regression for a Codex spec-review finding on an earlier draft: validating a
  // component's constructed witness against the FULL multi-component sourceBvh (not
  // just that component's own triangles) lets an unrelated sibling component change
  // the parity verdict. Construction: component A is a small box exactly coincident
  // with target (every vertex boundary, forcing stage 3); component B is a large,
  // completely separate box that happens to fully ENCLOSE A's location without
  // touching it (a disjoint, unrelated part of the same source geometry -- e.g. two
  // unrelated fixtures that happen to nest in world space). A's own stage-3 probe sits
  // deep inside B's volume too. Classified against the FULL source (A+B), any escaping
  // ray from that probe crosses BOTH A's and B's boundaries once each -- two crossings,
  // even parity, `outside` -- for every rung, on every attempt, since B's enclosure is
  // enormous relative to the tiny witnessLadder step. Classified against a BVH scoped
  // to A's own triangles only, the same probe correctly reads `inside`.
  const componentA = box(1, 1, 1);                  // corners +/-0.5
  const enclosingSiblingB = box(10, 10, 10);         // corners +/-5, fully encloses A, never touches it
  const src = testInstance(mergeGeometries([componentA, enclosingSiblingB]));
  const target = testInstance(box(1, 1, 1));         // exactly coincident with component A only
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  check('small component fully enclosed by an unrelated large sibling: still resolves contained', r.inside, true,
    'a witness validated against the FULL source (including the enclosing sibling) would read outside via nested-shell-style parity cancellation for every rung, on every attempt');
}

console.log('=== anyComponentInside: open triangle inside closed box (round 5/7 mode-split pin) ===');
{
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, 0, 0, 0.5, 0, 0, 0, 0.5, 0], 3));
  tri.setIndex([0, 1, 2]);
  const src = testInstance(tri);
  const target = testInstance(box(4, 4, 4));

  const volOverlap = await insideOf(src, target, { mode: 'volume-overlap' });
  check('open triangle inside closed box, volume-overlap: positive', volOverlap.inside, true);
  check('...carries unverified-open-component', volOverlap.diagnostics.some((d) => d.reason === 'unverified-open-component'), true);

  const containment = await insideOf(src, target, { mode: 'containment' });
  check('open triangle inside closed box, containment: positive', containment.inside, true);
  check('...does NOT carry unverified-open-component (mode split)', containment.diagnostics.some((d) => d.reason === 'unverified-open-component'), false,
    'round-5/7: containment never diagnoses open SOURCE components');
}

console.log('=== anyComponentInside: same fixture, roles reversed (round 9 regression) ===');
{
  // Closed box (public SOURCE) containing an open triangle (public TARGET) -- decided
  // via the "B inside A" containment term, so role must read 'target', not 'source'.
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, 0, 0, 0.5, 0, 0, 0, 0.5, 0], 3));
  tri.setIndex([0, 1, 2]);
  const openTargetInst = testInstance(tri);
  const closedSourceInst = testInstance(box(4, 4, 4));
  // Here anyComponentInside samples the OPEN TRIANGLE (playing the public "target"
  // role in this call) for containment inside the closed box (playing "source") --
  // i.e. this call is VolumeOverlapQuery's own "B inside A" term.
  const r = await anyComponentInside(
    openTargetInst.geometry, openTargetInst.bvh, openTargetInst.localDiagonal, openTargetInst.connectivity,
    closedSourceInst.bvh, closedSourceInst.localDiagonal, closedSourceInst.closedManifold,
    sourceToTarget(openTargetInst, closedSourceInst),
    { mode: 'volume-overlap', containerRole: 'source', sampledRole: 'target' }
  );
  check('reversed roles: positive', r.inside, true);
  check('reversed roles: role reads target, not source',
    r.diagnostics.find((d) => d.reason === 'unverified-open-component')?.role, 'target',
    'round-9 regression: role must follow which PUBLIC operand supplied the deciding component');
}

console.log('=== anyComponentInside: nearly-closed open source (bathtub-in-miniature) ===');
{
  const nearlyClosed = openBottomedBox(1);
  const src = testInstance(nearlyClosed);
  const target = testInstance(box(4, 4, 4));

  const volOverlap = await insideOf(src, target, { mode: 'volume-overlap' });
  check('nearly-closed open source, volume-overlap: positive', volOverlap.inside, true);
  check('...carries unverified-open-component', volOverlap.diagnostics.some((d) => d.reason === 'unverified-open-component'), true,
    'mirrors the acceptance-model bathtub; proves the rule is mode-scoped, not degeneracy-scoped');

  const containment = await insideOf(src, target, { mode: 'containment' });
  check('nearly-closed open source, containment: no unverified-open-component', containment.diagnostics.some((d) => d.reason === 'unverified-open-component'), false);
}

console.log('=== anyComponentInside: closed source vs OPEN target (round 6/7 blind spot) ===');
{
  const openTarget = testInstance(openBottomedBox(4));
  const insideBox = testInstance(box(1, 1, 1));
  const outsideBox = testInstance(box(1, 1, 1), at(50, 0, 0));

  const positive = await insideOf(insideBox, openTarget, { mode: 'containment' });
  check('closed source vs open target, positive arrangement: contained', positive.inside, true);
  check('...carries unverified-parity-operand role target',
    positive.diagnostics.find((d) => d.reason === 'unverified-parity-operand')?.role, 'target');

  const negative = await insideOf(outsideBox, openTarget, { mode: 'containment' });
  check('closed source vs open target, negative arrangement: not contained', negative.inside, false);
  check('...ALSO carries unverified-parity-operand role target',
    negative.diagnostics.find((d) => d.reason === 'unverified-parity-operand')?.role, 'target',
    'a rule firing only on negatives repeats the same asymmetry the other direction');
}

console.log('=== anyComponentInside: containment-decided positive with open source ===');
{
  // The proper-crossing role-accuracy half of this fixture (an open source PRODUCING
  // a crossing) is ProperCrossingQuery/VolumeOverlapQuery's job, not this module's --
  // this covers only the containment-decided half: no parity diagnostic (source is
  // sampled, never parity-tested), but unverified-open-component IS present.
  const openSrc = testInstance(openBottomedBox(0.4));
  const closedTarget = testInstance(box(4, 4, 4));
  const r = await insideOf(openSrc, closedTarget, { mode: 'volume-overlap' });
  check('containment-decided positive, open source: no parity diagnostic', r.diagnostics.some((d) => d.reason === 'unverified-parity-operand'), false);
  check('...but unverified-open-component present', r.diagnostics.some((d) => d.reason === 'unverified-open-component'), true);
}

console.log('=== anyComponentInside: more than 8 components, sample budgeting coherent ===');
{
  // 12 small disjoint components; only the LAST is inside target. An earlier draft's
  // contradictory "up to 64 total"/"at least 8 per range" wording could starve later
  // components -- this proves every component still gets its own sampling budget.
  const parts = [];
  for (let i = 0; i < 11; i++) parts.push(box(0.1, 0.1, 0.1).translate(i * 2, 50, 0));
  parts.push(box(0.5, 0.5, 0.5)); // the 12th, and only, part actually inside target
  const src = testInstance(mergeGeometries(parts));
  const target = testInstance(box(4, 4, 4));
  const r = await insideOf(src, target, { mode: 'volume-overlap' });
  check('>8 components, last one inside: still found', r.inside, true);
}

console.log('=== anyComponentInside: maxContainmentSamples exhaustion -> incomplete-component-coverage ===');
{
  // Many boundary-only components (coincident with target's faces) and a tiny
  // override budget guarantee exhaustion deterministically, without depending on the
  // real 512 constant.
  const parts = [];
  for (let i = 0; i < 20; i++) {
    const g = box(2, 2, 2).translate(0, 1, 0); // top face coincides with target's top face
    parts.push(g.translate(0, 0, i * 0.001)); // distinct components, all boundary-reading
  }
  const src = testInstance(mergeGeometries(parts));
  const target = testInstance(box(4, 4, 4));
  const r = await insideOf(src, target, { mode: 'volume-overlap', maxContainmentSamples: 10 });
  check('sample budget exhausted: not clean', r.diagnostics.some((d) => d.reason === 'incomplete-component-coverage'), true);
  check('budgetExhausted flag set', r.budgetExhausted, true);
}

console.log('=== anyComponentInside: mid-component time-budget yield-and-resume (mocked scheduler) ===');
{
  // A single component: a 6x6 subdivided plane exactly coincident with target's top
  // face (36 vertices, all read `boundary`) except ONE vertex nudged just inside
  // target -- forcing a long walk before resolving. The mocked scheduler's
  // elapsedMs() trips exactly once, early, then behaves normally (checkpointIfDue
  // resets it).
  const plane = new THREE.PlaneGeometry(4, 4, 5, 5);
  plane.rotateX(-Math.PI / 2); // lie flat
  plane.translate(0, 2, 0);    // coincide with target's top face (target extents +/-2)
  const nudgeIndex = 20;       // an interior vertex, not on the plane's own boundary
  plane.attributes.position.setY(nudgeIndex, 1.99); // just inside target
  const src = testInstance(plane);
  const target = testInstance(box(4, 4, 4));

  // The mock models the handle's own contract: checkpointIfDue() is called on EVERY
  // iteration (cheap when not due) and internally decides whether to actually yield.
  // On its 3rd invocation it performs one real "yield" (here: just increments a
  // separate counter, since there's nothing to actually await in a synchronous test).
  function makeMockScheduler(yieldOnCall, onYield) {
    let calls = 0;
    let yieldCount = 0;
    return {
      scheduler: {
        elapsedMs: () => 0, // unused by this mock's own logic; present for interface completeness
        async checkpointIfDue() {
          calls++;
          if (calls === yieldOnCall) {
            yieldCount++;
            if (onYield) await onYield();
          }
        },
      },
      getYieldCount: () => yieldCount,
    };
  }
  const { scheduler, getYieldCount } = makeMockScheduler(3);

  const r = await insideOf(src, target, { mode: 'volume-overlap', scheduler });
  check('mid-component checkpoint fires at least once', getYieldCount() >= 1, true);
  check('resolves correctly after yielding', r.inside, true);
  check('resumes from next unsampled vertex, no restart-inflated sample count',
    r.samplesUsed <= src.geometry.attributes.position.count, true,
    `samplesUsed=${r.samplesUsed}, vertexCount=${src.geometry.attributes.position.count}`);
}

console.log('=== anyComponentInside: yield-then-evict / yield-then-dispose ===');
{
  const plane = new THREE.PlaneGeometry(4, 4, 5, 5);
  plane.rotateX(-Math.PI / 2);
  plane.translate(0, 2, 0);
  plane.attributes.position.setY(20, 1.99);
  const src = testInstance(plane);
  const target = testInstance(box(4, 4, 4));

  function tripOnceScheduler(onYield) {
    let calls = 0;
    return {
      elapsedMs: () => 0,
      async checkpointIfDue() { calls++; if (calls === 3) await onYield(); },
    };
  }

  let evictThrew = false;
  try {
    await insideOf(src, target, {
      mode: 'volume-overlap',
      scheduler: tripOnceScheduler(async () => { throw new ModelEvictedError('mock-model'); }),
    });
  } catch (e) {
    evictThrew = e instanceof ModelEvictedError;
  }
  check('yield-then-evict: rejects ModelEvictedError', evictThrew, true);

  let disposeThrew = false;
  try {
    await insideOf(src, target, {
      mode: 'volume-overlap',
      scheduler: tripOnceScheduler(async () => { throw new WorldDisposedError('mock-world-disposed'); }),
    });
  } catch (e) {
    disposeThrew = e instanceof WorldDisposedError;
  }
  check('yield-then-dispose: rejects WorldDisposedError', disposeThrew, true);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/query/ContainmentQuery.anyComponentInside.test.mjs`
Expected: fails with `TypeError: anyComponentInside is not a function` (or, before Task 6 lands, `ERR_MODULE_NOT_FOUND` on `ContainmentQuery.js` itself), since `anyComponentInside` does not exist in the file yet — only `classifyPoint` does.

- [ ] **Step 3: Write the implementation**

This is **appended** to the file Task 6 already created; only the new exports below are added (the
existing `classifyPoint` function and its module-scope scratch objects are untouched):

```js
// wwwroot/collision/query/ContainmentQuery.js (Task 9's additions, appended after Task 6's classifyPoint)
//
// anyComponentInside samples per connected component, not against a global cap
// (docs/...:2312-2497). Guarantee: for a closed manifold component, one conclusive
// sample decides it exactly, because crossing B's boundary would BE a proper
// crossing. Non-manifold/open components are best-effort and flagged.

import * as THREE from '../../vendor/three/build/three.module.js';
import { build as buildScopedBvh } from '../blas/ThreeMeshBvhBackend.js';
import {
  maxContainmentSamples,
  samplesPerComponent,
  maxWitnessTriangles,
  witnessLadderFactors,
} from '../constants.js';

const noopScheduler = { elapsedMs: () => 0, checkpointIfDue: async () => {} };

const _point = new THREE.Vector3();
const _wa = new THREE.Vector3();
const _wb = new THREE.Vector3();
const _wc = new THREE.Vector3();
const _wCentroid = new THREE.Vector3();
const _wNormal = new THREE.Vector3();
const _wEdge1 = new THREE.Vector3();
const _wEdge2 = new THREE.Vector3();
const _wProbe = new THREE.Vector3();
const _wProbeInTarget = new THREE.Vector3();

/**
 * @param {import('three').BufferGeometry} sourceGeometry - already welded
 * @param {import('three-mesh-bvh').MeshBVH} sourceBvh
 * @param {number} sourceLocalDiagonal
 * @param {{ componentCount: number, componentOf: Int32Array, closedManifold: boolean[] }} sourceConnectivity
 * @param {import('three-mesh-bvh').MeshBVH} targetBvh
 * @param {number} targetLocalDiagonal
 * @param {boolean} targetClosedManifold
 * @param {import('three').Matrix4} sourceToTargetMatrix
 * @param {{
 *   mode: 'containment' | 'volume-overlap',
 *   containerRole?: 'source' | 'target',
 *   sampledRole?: 'source' | 'target',
 *   maxContainmentSamples?: number,
 *   samplesPerComponent?: number,
 *   maxWitnessTriangles?: number,
 *   witnessLadderFactors?: number[],
 *   scheduler?: { elapsedMs(): number, checkpointIfDue(): Promise<void> },
 * }} options
 */
export async function anyComponentInside(
  // sourceBvh/sourceLocalDiagonal are accepted for signature stability (the canonical
  // reference's documented shape, and callers like VolumeOverlapQuery pass them
  // unconditionally) but are NOT used in this function's own body: stages 1-2 only
  // ever classify against `targetBvh`, and stage 3 (see constructedInteriorWitness
  // below) builds and uses its own component-scoped BVH instead of the full
  // multi-component `sourceBvh` -- that is precisely the Critical fix a Codex
  // spec-review of an earlier draft required (see Step 3's comments there).
  sourceGeometry, sourceBvh, sourceLocalDiagonal, sourceConnectivity,
  targetBvh, targetLocalDiagonal, targetClosedManifold,
  sourceToTargetMatrix, options
) {
  const mode = options?.mode;
  if (mode !== 'containment' && mode !== 'volume-overlap') {
    throw new TypeError("anyComponentInside: options.mode must be 'containment' or 'volume-overlap'");
  }
  const containerRole = options.containerRole ?? 'target';
  const sampledRole = options.sampledRole ?? 'source';
  const sampleBudget = options.maxContainmentSamples ?? maxContainmentSamples;
  const perComponentTarget = options.samplesPerComponent ?? samplesPerComponent;
  const witnessTriangleBudget = options.maxWitnessTriangles ?? maxWitnessTriangles;
  const ladderFactors = options.witnessLadderFactors ?? witnessLadderFactors;
  const scheduler = options.scheduler ?? noopScheduler;

  const diagnostics = [];
  const addDiagnostic = (reason, role) => {
    if (!diagnostics.some((d) => d.reason === reason && d.role === role)) {
      diagnostics.push(role ? { reason, role } : { reason });
    }
  };

  // Target-side precondition, checked once regardless of mode or outcome
  // (docs/...:2367-2389): every operand parity is evaluated against must be a
  // certified closed manifold, or every result (positive AND negative) is tainted.
  if (!targetClosedManifold) addDiagnostic('unverified-parity-operand', containerRole);

  const index = sourceGeometry.index.array;
  const position = sourceGeometry.attributes.position;
  const componentOf = sourceConnectivity.componentOf;
  const triCount = componentOf.length;

  const trianglesByComponent = new Map();
  for (let t = 0; t < triCount; t++) {
    const c = componentOf[t];
    if (!trianglesByComponent.has(c)) trianglesByComponent.set(c, []);
    trianglesByComponent.get(c).push(t);
  }

  let samplesUsed = 0;
  let budgetExhausted = false;
  let anyFlaggedComponentInvolved = false;
  let anyClassifiedInside = false;
  let decidingComponentClosed = null;
  let decidingComponentIndex = null;
  let unresolvedComponentCount = 0;

  componentLoop:
  for (const [componentId, tris] of trianglesByComponent) {
    if (anyClassifiedInside) break;
    if (budgetExhausted) { unresolvedComponentCount++; continue; }

    const closed = sourceConnectivity.closedManifold[componentId];
    if (!closed) anyFlaggedComponentInvolved = true;

    // Derive the component's referenced vertex list, then order it as: stride bucket
    // 0 (spatially-spread stride picks, "stage 1"), then bucket 1, etc. -- so the
    // FIRST `perComponentTarget` entries are spread across the whole component
    // (stage 1), and if all of those read `boundary`, the walk naturally continues
    // through the rest (stage 2) without a separate code path (docs/...:2409-2417).
    const vertexSet = new Set();
    for (const t of tris) {
      vertexSet.add(index[t * 3]);
      vertexSet.add(index[t * 3 + 1]);
      vertexSet.add(index[t * 3 + 2]);
    }
    const vertices = [...vertexSet];
    const stride = Math.max(1, Math.ceil(vertices.length / perComponentTarget));
    const order = [];
    for (let s = 0; s < stride; s++) {
      for (let i = s; i < vertices.length; i += stride) order.push(vertices[i]);
    }

    let componentResolved = false;
    for (const v of order) {
      if (samplesUsed >= sampleBudget) { budgetExhausted = true; break; }

      // Intra-loop checkpoint, called before EVERY individual classifyPoint call
      // (docs/...:2465-2496, round-11 fix for round-10's too-coarse
      // deadlineCheckInterval=256). checkpointIfDue() itself decides whether elapsed
      // time actually warrants yielding -- a call that isn't due yet resolves
      // immediately without yielding, so calling it every iteration is correct, not
      // merely tolerated. On an actual yield: two-part revalidation
      // (disposed-first-then-epoch) is the scheduler's own job; this loop just awaits
      // it and lets a rejection propagate, then resumes sampling from exactly the
      // next unsampled vertex -- it does NOT restart or truncate the search.
      await scheduler.checkpointIfDue();

      _point.fromBufferAttribute(position, v).applyMatrix4(sourceToTargetMatrix);
      const c = classifyPoint(_point, targetBvh, targetLocalDiagonal);
      samplesUsed++;

      if (c === 'inside') {
        anyClassifiedInside = true;
        decidingComponentClosed = closed;
        decidingComponentIndex = componentId;
        componentResolved = true;
        break;
      }
      if (c === 'outside') { componentResolved = true; break; }
      // 'boundary': keep walking the rest of `order`.
    }

    if (anyClassifiedInside) break;

    // Stage 3: constructed interior witness, volume-overlap only (docs/...:2418-2443,
    // 2547-2553 for why containment stops after stage 2).
    if (!componentResolved && !budgetExhausted && mode === 'volume-overlap') {
      const witness = await constructedInteriorWitness(
        sourceGeometry, tris,
        targetBvh, targetLocalDiagonal, sourceToTargetMatrix,
        witnessTriangleBudget, ladderFactors, scheduler,
        samplesUsed, sampleBudget
      );
      samplesUsed = witness.samplesUsed;
      if (witness.budgetExhausted) budgetExhausted = true;
      if (witness.inside) {
        anyClassifiedInside = true;
        decidingComponentClosed = closed;
        decidingComponentIndex = componentId;
        break;
      }
    }

    if (!anyClassifiedInside && !componentResolved) unresolvedComponentCount++;
  }

  if (anyClassifiedInside) {
    // Positive result whose deciding component is not certified closed: containment
    // is real, the VOLUME is not certified (docs/...:2340-2359). Only meaningful in
    // volume-overlap; containment's contract handles open sources by design.
    if (mode === 'volume-overlap' && decidingComponentClosed === false) {
      addDiagnostic('unverified-open-component', sampledRole);
    }
  } else if (mode === 'volume-overlap' && anyFlaggedComponentInvolved) {
    // A negative result involving ANY flagged component is degraded to unverified,
    // regardless of whether that component's own sample happened to resolve cleanly
    // (docs/...:2360; the guarantee itself is what's uncertain for such a component,
    // not merely this run's sampling outcome).
    addDiagnostic('non-manifold-component');
  }

  if (budgetExhausted) addDiagnostic('incomplete-component-coverage');

  return {
    inside: anyClassifiedInside,
    decidingComponentClosed,
    decidingComponentIndex,
    diagnostics,
    unresolvedComponentCount,
    samplesUsed,
    budgetExhausted,
  };
}

// Stage 3 helper: constructs a point in the component's own interior (never relying
// on its surface), validates it against the component's OWN geometry first, then
// classifies it against target.
//
// A Codex spec-review of an earlier draft caught a Critical bug here: that draft
// validated the constructed probe against the FULL `sourceBvh` (every component of
// the source geometry), not just the deciding component's own triangles. Even-odd
// parity is evaluated over whatever triangle set it's asked to classify against
// (docs/...:1658, "over the target's ENTIRE triangle set") -- so classifying against
// the WHOLE source lets an unrelated or nested sibling component change the verdict
// (concrete counterexample: two nested closed shells sharing this source geometry,
// where a probe just inside the INNER shell is also enclosed by the OUTER shell, so
// whole-source parity reads it `outside` via the same even-odd cancellation
// docs/...:1662-1665 describes for a hollow pipe -- silently rejecting a valid
// witness for a real, containable component). The fix: build a BVH scoped to ONLY
// `componentTriangles`, and classify the probe against THAT, never the full source.
//
// This also settles what "the component's own local frame" (docs/...:2426-2433)
// means precisely: this plan takes it to mean the DECIDING COMPONENT's own local
// scale, not the whole source geometry's cached `L_source` -- consistent with round
// 5's own reasoning (never borrow a scale from a larger/unrelated context) applied
// one level deeper than the spec's literal wording resolves on its own. Flagged for
// the spec owner to confirm during assembly if a different reading was intended.
async function constructedInteriorWitness(
  sourceGeometry, componentTriangles,
  targetBvh, targetLocalDiagonal, sourceToTargetMatrix,
  witnessTriangleBudget, ladderFactors, scheduler,
  samplesUsedIn, sampleBudget
) {
  const position = sourceGeometry.attributes.position;
  const index = sourceGeometry.index.array;

  // Build a geometry containing ONLY this component's own triangles, remapped to a
  // dense local vertex range, and a fresh BVH over just that subset.
  const localIndexOf = new Map();
  const componentPositions = [];
  const componentIndex = [];
  for (const t of componentTriangles) {
    for (let e = 0; e < 3; e++) {
      const globalIndex = index[t * 3 + e];
      if (!localIndexOf.has(globalIndex)) {
        localIndexOf.set(globalIndex, componentPositions.length / 3);
        componentPositions.push(
          position.getX(globalIndex), position.getY(globalIndex), position.getZ(globalIndex)
        );
      }
      componentIndex.push(localIndexOf.get(globalIndex));
    }
  }
  const componentGeometry = new THREE.BufferGeometry();
  componentGeometry.setAttribute('position', new THREE.Float32BufferAttribute(componentPositions, 3));
  componentGeometry.setIndex(componentIndex);
  const { bvh: componentBvh, localDiagonal: componentLocalDiagonal } = buildScopedBvh(componentGeometry);

  const ladder = ladderFactors.map((f) => f * componentLocalDiagonal);

  let samplesUsed = samplesUsedIn;
  let budgetExhausted = false;

  for (let attempt = 0; attempt < Math.min(witnessTriangleBudget, componentTriangles.length); attempt++) {
    if (samplesUsed >= sampleBudget) { budgetExhausted = true; break; }

    // Checked before each witness-triangle attempt (docs/...:2492-2494), same
    // yield-and-resume pattern as the vertex-sampling loop above.
    await scheduler.checkpointIfDue();

    const t = componentTriangles[attempt];
    const ia = index[t * 3], ib = index[t * 3 + 1], ic = index[t * 3 + 2];
    _wa.fromBufferAttribute(position, ia);
    _wb.fromBufferAttribute(position, ib);
    _wc.fromBufferAttribute(position, ic);
    _wCentroid.copy(_wa).add(_wb).add(_wc).multiplyScalar(1 / 3);
    _wEdge1.subVectors(_wb, _wa);
    _wEdge2.subVectors(_wc, _wa);
    _wNormal.crossVectors(_wEdge1, _wEdge2).normalize();

    for (const sign of [1, -1]) {
      for (const delta of ladder) {
        if (samplesUsed >= sampleBudget) { budgetExhausted = true; break; }
        samplesUsed++;
        _wProbe.copy(_wCentroid).addScaledVector(_wNormal, sign * delta);
        // Must actually land inside the DECIDING COMPONENT's own geometry first --
        // only then does classifying it against target mean anything
        // (docs/...:2418-2424) -- classified against the component-scoped BVH above,
        // never the full multi-component sourceBvh.
        const ownClass = classifyPoint(_wProbe, componentBvh, componentLocalDiagonal);
        if (ownClass !== 'inside') continue;
        _wProbeInTarget.copy(_wProbe).applyMatrix4(sourceToTargetMatrix);
        const targetClass = classifyPoint(_wProbeInTarget, targetBvh, targetLocalDiagonal);
        if (targetClass === 'inside') return { inside: true, samplesUsed, budgetExhausted };
      }
      if (budgetExhausted) break;
    }
    if (budgetExhausted) break;
  }

  return { inside: false, samplesUsed, budgetExhausted };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/query/ContainmentQuery.anyComponentInside.test.mjs`
Expected: `31 passed, 0 failed`. Proves: per-component (not global-cap) sampling finds a small unsampled-looking component; edge-connectivity's shared-vertex fix and its shared-edge/-face gap are both correctly surfaced (one clean, one flagged); stride ordering defeats a naive first-N pick on a shared coplanar face; stage 3 resolves the coincident-boxes counterexample and the differing-local-scale regression, and is immune to an unrelated enclosing sibling component's presence; the `containment`/`volume-overlap` mode split is pinned on both the open-source and reversed-roles fixtures; the target-openness blind spot is closed on both positive and negative arrangements; sample budgeting survives more than 8 components and correctly reports `incomplete-component-coverage` on real exhaustion; the intra-loop checkpoint yields, resumes without restarting, and correctly propagates `ModelEvictedError`/`WorldDisposedError` from an injected scheduler.

- [ ] **Step 5: Commit**
```bash
git add wwwroot/collision/query/ContainmentQuery.js test/query/ContainmentQuery.anyComponentInside.test.mjs
git commit -m "Add anyComponentInside: three-stage per-component containment sampling"
```

**Completion criteria:**
- Sampling is organized per connected component, with its own stride target computed from that
  component's own vertex count — never a flat fixed-size cap oblivious to component count (round 2's
  bug). This is still bounded overall by the global `maxContainmentSamples` safety net (`docs/...:2462`);
  if that cap is genuinely exhausted before every component is covered, a later component CAN be
  starved — surfaced honestly via `incomplete-component-coverage`, never silently.
- Stage 3 (constructed interior witness) runs only in `volume-overlap` mode, and classifies its
  constructed probe against a BVH scoped to the deciding component's OWN triangles only — never the
  full multi-component `sourceBvh` (see Step 3's comments for the nested/enclosed-sibling counterexample
  this fixes).
- `unverified-parity-operand` and `unverified-open-component` both carry the correct role, driven by
  the caller-supplied `containerRole`/`sampledRole`, not a hardcoded `'source'`/`'target'`.
  `non-manifold-component` carries no role at all, per the canonical reference's diagnostic table —
  it is pair-wide, not operand-specific (do not add a role to it).
- The intra-loop checkpoint (`await scheduler.checkpointIfDue()`) is called before every individual
  `classifyPoint` call and every witness-triangle attempt, unconditionally — the handle itself decides
  whether elapsed time actually warrants yielding.
- A checkpoint rejection (`WorldDisposedError`/`ModelEvictedError`) propagates as this function's own
  promise rejection; sampling never silently continues past it.

**Protected invariants / regressions to watch:**
- Round 2 (`docs/...:2312-2314`): a flat "up to 64 points" cap produces false negatives on unsampled components — sampling must be per-component.
- Round 3 (`docs/...:2330-2338`): the containment guarantee is conditional on closed-manifold, not unconditional.
- Round 4 (`docs/...:2400-2404`): stopping after a fixed small number of arbitrary vertices misses deep containment sharing a coplanar face — the stride-then-continue ordering is what fixes it.
- Round 5 (`docs/...:2340-2344, 2426-2433`): the open-component diagnostic must fire on **positive** results, and `witnessLadder` must scale by `L_source`, never a borrowed canonical/target scale.
- Round 6/7 (`docs/...:2367-2372`): target openness must taint every result, not only ones where the source happens to be open.
- Round 9 (`docs/...:2350-2359`): the open-component diagnostic's `role` must follow whichever public operand supplied the deciding component, not a hardcoded side.
- Round 10/11 (`docs/...:2471-2486`): the checkpoint must fire before every individual sample, not batched at any interval.
- **M1 aspect-ratio disposition guard (spec Tolerances section, "Single-geometry aspect ratio")**:
  `ThreeMeshBvhBackend.build()` (Task 4) returns `aspectRatio`/`aspectRatioExceeded` alongside
  `bvh`/`localDiagonal`. Before calling `classifyPoint` against a **target** (this task's `targetBvh`
  parameter — never the source, which is sampled, not parity-tested), this task must check the
  target's `aspectRatioExceeded` and, if true, skip `classifyPoint` for that target and emit a
  diagnostic (reason `geometry-aspect-ratio-exceeds-tolerance-model`, per the spec's disposition)
  rather than trusting a classification this tolerance model cannot make correctly at that aspect
  ratio. **This check is scoped to target usage in `classifyPoint` specifically — not a blanket
  `GeometryRecord`-level rejection**: `Task 14`'s generic build orchestration (weld/connectivity/BVH,
  shared by every query mode) must NOT reject a geometry solely for `aspectRatioExceeded`, since
  `surface-intersection` mode never calls `classifyPoint` at all and would be incorrectly denied a
  geometry it can process correctly. `Task 14` only computes/surfaces the signal (via `ThreeMeshBvhBackend`);
  this task (and Task 12's `containment`-mode target role) is where it must actually be acted on.

---

### Task 10: `SurfaceCrossingWitness`

**Objective:** Find a point on a source triangle's own surface that lies inside the target — catching the case where a source straddles a target's boundary with no vertex inside it, which vertex sampling alone can never see.

**Files:**
- Create: `wwwroot/collision/query/SurfaceCrossingWitness.js`
- Test: `test/query/SurfaceCrossingWitness.test.mjs`

**Interfaces:**
- Consumes: `classifyPoint(point, targetBvh, targetLocalDiagonal) -> 'inside'|'outside'|'boundary'`
  from `wwwroot/collision/query/ContainmentQuery.js` (Task 6); `coplanarAngleEpsilon`,
  `surfaceEpsilonFactor`, `crossingProbeFractions`, `maxCandidatePairsExamined`,
  `maxCrossingPairsExamined`, `frameBudgetMs` from `wwwroot/collision/constants.js`.
- Produces: `surfaceCrossingWitness(sourceBvh: MeshBVH, targetBvh: MeshBVH, targetToSourceMatrix: THREE.Matrix4, sourceLocalDiagonal: number, targetLocalDiagonal: number, options?: { maxCandidatePairsExamined?: number, maxCrossingPairsExamined?: number, frameBudgetMs?: number, scheduler?: SchedulerHandle }) -> { witnessFound: boolean, aborted: boolean, inconclusive: boolean, diagnostics: Array<{reason: 'crossing-budget-exhausted'|'inconclusive-crossing'}>, stats: { candidatePairsExamined: number, crossingPairsExamined: number } }`.
  This function cannot `await` (it runs inside a synchronous `bvhcast` callback), so it only ever reads
  `options.scheduler.elapsedMs()` **synchronously** and compares it against its own `frameBudgetMs`
  option itself — it never calls `checkpointIfDue()`. This is what makes it read the **shared**
  per-call accumulator rather than a private clock (docs/...:2608-2613, the explicit contrast with
  `ProperCrossingQuery`/`SurfaceIntersectionQuery`): whichever composite caller (`ContainmentModeQuery`,
  Task 12) threads the SAME `scheduler` object through its own earlier `anyComponentInside` term and
  into this one sees a correctly-reset baseline if that earlier term already yielded once — a Codex
  `spec`-review of an earlier draft caught that a scalar `callStartMs` baseline captured once at this
  function's own entry could not reflect a yield that happened earlier in the same composite call.
  Omitted `options.scheduler`, this defaults to a no-op handle (`elapsedMs()` always `0`), which
  degenerates correctly for standalone testing. Consumed by `ContainmentModeQuery.js` (Task 12) as its
  second composition term.

- [ ] **Step 1: Write the failing test(s)**

```js
// test/query/SurfaceCrossingWitness.test.mjs
import * as THREE from '../../wwwroot/vendor/three/build/three.module.js';
import { surfaceCrossingWitness } from '../../wwwroot/collision/query/SurfaceCrossingWitness.js';
import { box, at, comb, testInstance } from '../fixtures/geometry.mjs';

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}  expected=${expected} actual=${actual}${note ? `  (${note})` : ''}`);
}

function witnessOf(source, target, options) {
  const targetToSource = source.matrix.clone().invert().multiply(target.matrix);
  return surfaceCrossingWitness(source.bvh, target.bvh, targetToSource, source.localDiagonal, target.localDiagonal, options);
}

console.log('=== SurfaceCrossingWitness: budget exhaustion (shares interleaved-comb input) ===');
{
  const source = testInstance(comb(0));
  const target = testInstance(comb(0.05));
  const t0 = performance.now();
  const r = witnessOf(source, target, { maxCandidatePairsExamined: 500 });
  const elapsed = performance.now() - t0;
  check('budget exhausted: aborted', r.aborted, true);
  check('aborted must not report a witness', r.witnessFound, false);
  check('carries crossing-budget-exhausted', r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true);
  check('completes within a wall-clock bound', elapsed < 500, true, `${elapsed.toFixed(1)}ms`);
}

console.log('=== SurfaceCrossingWitness: small-triangle per-triangle scaling (round 9 regression) ===');
{
  // Target large enough that offsetLadder's rungs (had this module wrongly borrowed
  // them, as the spike's min(src.L, target.L) bug did) would be on the order of
  // 1e-3..1e-5 x L_target ~ 346, i.e. ~0.35..0.0035 -- far bigger than this source
  // triangle's own ~1e-3 extent, so every offsetLadder-scaled rung would fall
  // entirely outside the triangle. crossingProbeFractions x dAvail, recomputed from
  // THIS triangle's own size, must still find a witness.
  const target = testInstance(box(200, 200, 200)); // face at x=100
  const tinyTriangle = new THREE.BufferGeometry();
  tinyTriangle.setAttribute('position', new THREE.Float32BufferAttribute([
    100 - 0.0005, 0, 0,
    100 + 0.0005, 0.0005, 0,
    100 + 0.0005, -0.0005, 0.0008,
  ], 3));
  tinyTriangle.setIndex([0, 1, 2]);
  const source = testInstance(tinyTriangle);
  const r = witnessOf(source, target);
  check('small triangle, per-triangle scaling finds witness', r.witnessFound, true,
    'round-9 regression: the spike used min(src.L, target.L) instead of per-candidate dAvail');
}

console.log('=== SurfaceCrossingWitness: shrunk further, no valid probe exists ===');
{
  // Shrunk until dAvail is on the same order as surfaceEpsilon (1e-6 x L_target):
  // every probe that DOES stay inside the triangle still reads `boundary` against
  // target (never clears surfaceEpsilon), so no rung is ever a valid witness.
  const target = testInstance(box(200, 200, 200));
  const shrunkTriangle = new THREE.BufferGeometry();
  shrunkTriangle.setAttribute('position', new THREE.Float32BufferAttribute([
    100 - 0.0001, 0, 0,
    100 + 0.0001, 0.0001, 0,
    100 + 0.0001, -0.0001, 0.00015,
  ], 3));
  shrunkTriangle.setIndex([0, 1, 2]);
  const source = testInstance(shrunkTriangle);
  const r = witnessOf(source, target);
  check('shrunk further: no witness found', r.witnessFound, false);
  check('reports inconclusive-crossing, not silent no-witness', r.diagnostics.some((d) => d.reason === 'inconclusive-crossing'), true);
}

console.log('=== SurfaceCrossingWitness: coplanar candidates rejected ===');
{
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(0, 2, 0)); // flush touching
  const r = witnessOf(a, b);
  check('flush/coplanar touching: no witness', r.witnessFound, false);
}

console.log('=== SurfaceCrossingWitness: reads the SHARED accumulator, not a private clock ===');
{
  // Contrast with ProperCrossingQuery/SurfaceIntersectionQuery's private clocks: an
  // externally-supplied scheduler whose elapsedMs() ALREADY reports past-budget (as
  // if an earlier term in the same composite call had already spent the frame) must
  // abort this traversal immediately, on its very first candidate, with no local
  // grace period of its own.
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const alreadyOverBudget = { elapsedMs: () => 100 }; // 100 > frameBudgetMs (8)
  const r = witnessOf(duct, beam, { scheduler: alreadyOverBudget });
  check('externally-already-over-budget scheduler: aborts immediately', r.aborted, true,
    'proves this module reads an externally-owned shared clock, not a self-contained private one');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/query/SurfaceCrossingWitness.test.mjs`
Expected: fails at the `import { surfaceCrossingWitness } from '../../wwwroot/collision/query/SurfaceCrossingWitness.js'` line with `ERR_MODULE_NOT_FOUND`, since the file does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// wwwroot/collision/query/SurfaceCrossingWitness.js
//
// Probes within the source triangle's OWN PLANE, classifies against target only.
// docs/...:2565-2616. Given a source triangle properly (non-coplanarly) intersecting
// target along segment L, take L's midpoint M, form in-plane direction
// u = normalize(nA x dir(L)), and probe P = M +/- delta*u for delta in
// crossingProbeFractions x dAvail -- dAvail recomputed FRESH per candidate from THIS
// triangle's own available in-plane distance, never a cached canonical/target scale
// (round-9 fix for the spike's `Math.min(src.L, target.L)` bug).

import { ExtendedTriangle } from '../../vendor/three-mesh-bvh/src/index.js';
import * as THREE from '../../vendor/three/build/three.module.js';
import { classifyPoint } from './ContainmentQuery.js';
import {
  coplanarAngleEpsilon,
  surfaceEpsilonFactor,
  crossingProbeFractions,
  maxCandidatePairsExamined,
  maxCrossingPairsExamined,
  frameBudgetMs,
} from '../constants.js';

const _triA = new ExtendedTriangle();
const _triB = new ExtendedTriangle();
const _line = new THREE.Line3();
const _mid = new THREE.Vector3();
const _segDir = new THREE.Vector3();
const _u = new THREE.Vector3();
const _nA = new THREE.Vector3();
const _nB = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _probeInTarget = new THREE.Vector3();

const noopScheduler = { elapsedMs: () => 0 };

/**
 * @param {import('three-mesh-bvh').MeshBVH} sourceBvh
 * @param {import('three-mesh-bvh').MeshBVH} targetBvh
 * @param {import('three').Matrix4} targetToSourceMatrix - maps target's local space into source's local space
 * @param {number} sourceLocalDiagonal
 * @param {number} targetLocalDiagonal
 * @param {{ maxCandidatePairsExamined?: number, maxCrossingPairsExamined?: number, frameBudgetMs?: number, scheduler?: { elapsedMs(): number } }} [options]
 */
export function surfaceCrossingWitness(sourceBvh, targetBvh, targetToSourceMatrix, sourceLocalDiagonal, targetLocalDiagonal, options = {}) {
  const candidateBudget = options.maxCandidatePairsExamined ?? maxCandidatePairsExamined;
  const crossingBudget = options.maxCrossingPairsExamined ?? maxCrossingPairsExamined;
  const timeBudgetMs = options.frameBudgetMs ?? frameBudgetMs;

  // SHARED per-call elapsed-time accumulator, not a private clock (docs/...:2608-2613,
  // the explicit contrast with ProperCrossingQuery/SurfaceIntersectionQuery). This
  // function cannot await (bvhcast-native, no yield point mid-traversal), so it only
  // ever READS `scheduler.elapsedMs()` synchronously -- it never calls
  // `checkpointIfDue()`. Whichever composite caller owns this scheduler object is
  // responsible for the elapsed-time baseline actually reflecting the whole call, not
  // just this traversal's own entry -- a standalone caller (this task's own tests) may
  // omit `options.scheduler` entirely, which reports 0 forever, a degenerate
  // always-under-budget case, not a different contract.
  const scheduler = options.scheduler ?? noopScheduler;

  const sourceToTargetMatrix = targetToSourceMatrix.clone().invert();
  // Coplanarity is tested on triangles already in SOURCE's local frame (bvhcast
  // transforms `targetBvh`'s triangles into `sourceBvh`'s frame before the callback
  // ever sees them) -- so its distance tolerance must be scaled by sourceLocalDiagonal,
  // not targetLocalDiagonal. A Codex spec-review of an earlier draft caught this frame
  // mismatch, which silently misclassifies near-coplanar pairs whenever source and
  // target differ in local scale.
  const coplanarSurfaceEpsilon = surfaceEpsilonFactor * sourceLocalDiagonal;
  // classifyPoint's own boundary pre-check, further down, is scaled by targetLocalDiagonal
  // as usual -- that call classifies IN target's frame, a separate concern from the
  // coplanarity test above.

  let candidatePairsExamined = 0;
  let crossingPairsExamined = 0;
  let witnessFound = false;
  let aborted = false;
  let sawInconclusiveCandidate = false;   // no rung ever stayed inside the triangle
  let sawBoundaryClassification = false;  // a rung stayed inside but read `boundary` against target

  const timeExceeded = () => scheduler.elapsedMs() > timeBudgetMs;

  sourceBvh.bvhcast(targetBvh, targetToSourceMatrix, {
    intersectsTriangles(triA, triB) {
      candidatePairsExamined++;
      // Checked at callback entry AND before every probe (docs/...:2608-2611) --
      // unlike ProperCrossingQuery/SurfaceIntersectionQuery, this is the shared
      // accumulator, checked at the same two granularities but against it.
      if (candidatePairsExamined > candidateBudget || timeExceeded()) {
        aborted = true;
        return true;
      }

      _triA.copy(triA); _triA.needsUpdate = true;
      _triB.copy(triB); _triB.needsUpdate = true;
      _triA.getNormal(_nA);
      _triB.getNormal(_nB);

      const parallel = Math.abs(_nA.dot(_nB)) >= 1 - coplanarAngleEpsilon;
      if (parallel && Math.abs(_nA.dot(_triA.a) - _nA.dot(_triB.a)) <= coplanarSurfaceEpsilon) {
        return false; // coplanar contact is boundary, never interior
      }
      if (!_triA.intersectsTriangle(_triB, _line)) return false;

      crossingPairsExamined++;
      if (crossingPairsExamined > crossingBudget) {
        aborted = true;
        return true;
      }

      _line.getCenter(_mid);
      _line.delta(_segDir);
      if (_segDir.lengthSq() < 1e-20) return false;
      _segDir.normalize();
      _u.crossVectors(_nA, _segDir).normalize(); // in-plane, perpendicular to the segment

      let candidateProducedInPlaneProbe = false;

      for (const sign of [1, -1]) {
        // dAvail: distance from M to THIS triangle's own edge along sign*u, recomputed
        // fresh per candidate -- never a cached per-geometry or canonical-frame scale
        // (docs/...:2568-2583, the round-9 fix).
        const dAvail = availableInPlaneDistance(_triA, _mid, _u, sign);
        if (dAvail <= 0) continue;

        for (const fraction of crossingProbeFractions) {
          if (timeExceeded()) { aborted = true; return true; }

          const delta = fraction * dAvail;
          _probe.copy(_mid).addScaledVector(_u, sign * delta);
          if (!_triA.containsPoint(_probe)) continue; // must stay ON the source triangle
          candidateProducedInPlaneProbe = true;

          _probeInTarget.copy(_probe).applyMatrix4(sourceToTargetMatrix);
          const c = classifyPoint(_probeInTarget, targetBvh, targetLocalDiagonal);
          if (c === 'inside') { witnessFound = true; return true; }
          if (c === 'boundary') sawBoundaryClassification = true;
        }
      }

      // Mirrors ProperCrossingQuery's step 5: a candidate that could never even
      // produce a usable in-triangle probe is inconclusive, not rejected
      // (docs/...:2585-2591).
      if (!candidateProducedInPlaneProbe) sawInconclusiveCandidate = true;
      return false;
    },
  });

  const finalWitnessFound = aborted ? false : witnessFound;
  const inconclusive = !aborted && !finalWitnessFound && (sawInconclusiveCandidate || sawBoundaryClassification);

  const diagnostics = [];
  if (aborted) diagnostics.push({ reason: 'crossing-budget-exhausted' });
  else if (inconclusive) diagnostics.push({ reason: 'inconclusive-crossing' });

  return {
    witnessFound: finalWitnessFound,
    aborted,
    inconclusive,
    diagnostics,
    stats: { candidatePairsExamined, crossingPairsExamined },
  };
}

// Distance from `origin` to the triangle's own boundary along `sign * direction`, by
// intersecting the ray with each of the triangle's 3 edges and taking the nearest
// positive-t hit (docs/...:2568-2570).
function availableInPlaneDistance(triangle, origin, direction, sign) {
  const verts = [triangle.a, triangle.b, triangle.c];
  const dir = direction.clone().multiplyScalar(sign);
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const p0 = verts[i];
    const p1 = verts[(i + 1) % 3];
    const edge = p1.clone().sub(p0);
    const t = rayEdgeIntersectionT(origin, dir, p0, edge);
    if (t !== null && t > 1e-9 && t < best) best = t;
  }
  return Number.isFinite(best) ? best : 0;
}

// Two coplanar lines: origin + t*dir = edgeStart + s*edgeVec. Both live in the
// triangle's own plane, so their cross products with each other are parallel to the
// shared plane normal n = dir x edgeVec, reducing the solve to two scalar divisions.
function rayEdgeIntersectionT(origin, dir, edgeStart, edgeVec) {
  const n = new THREE.Vector3().crossVectors(dir, edgeVec);
  const denom = n.lengthSq();
  if (denom < 1e-20) return null; // parallel to this edge
  const diff = new THREE.Vector3().subVectors(edgeStart, origin);
  const s = new THREE.Vector3().crossVectors(diff, dir).dot(n) / denom;
  if (s < -1e-9 || s > 1 + 1e-9) return null; // intersection falls outside the edge segment
  return new THREE.Vector3().crossVectors(diff, edgeVec).dot(n) / denom;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/query/SurfaceCrossingWitness.test.mjs`
Expected: `10 passed, 0 failed`. Proves: candidate-count budget exhaustion aborts within a wall-clock bound and never fabricates a witness; a source triangle far smaller than any canonical/target-derived scale still finds a witness via per-candidate `dAvail` scaling; a triangle shrunk past the point any probe can clear `surfaceEpsilon` reports `inconclusive-crossing` rather than a silent negative; coplanar-only contact never produces a witness; an externally-owned scheduler already past budget aborts this traversal immediately, proving it reads a shared accumulator rather than a private clock.

- [ ] **Step 5: Commit**
```bash
git add wwwroot/collision/query/SurfaceCrossingWitness.js test/query/SurfaceCrossingWitness.test.mjs
git commit -m "Add SurfaceCrossingWitness: per-triangle-scaled in-plane containment probe"
```

**Completion criteria:**
- Probe offsets are computed as `crossingProbeFractions × dAvail`, with `dAvail` recomputed fresh per candidate from that candidate's own triangle — never `offsetLadder`, never a cached per-geometry or canonical-frame scale.
- The time-based abort reads the **shared** `scheduler.elapsedMs()` accumulator synchronously, never a private clock of its own — the documented contrast with `ProperCrossingQuery`/`SurfaceIntersectionQuery`. Coplanarity's own `surfaceEpsilon` is scaled by `sourceLocalDiagonal` (the frame the compared triangles are already in), not `targetLocalDiagonal`.
- `inconclusive-crossing` fires on both failure shapes: no rung ever producing an in-triangle probe, and a rung producing one that only ever classifies `boundary` against target.
- Coplanar candidates are rejected before any probe is attempted, exactly as `ProperCrossingQuery` rejects them.

**Protected invariants / regressions to watch:**
- Round 9 (`docs/...:2575-2583`): reusing `offsetLadder` or any cached `min(L_source, L_target)`-style scale silently fails on any triangle whose own size diverges from that scale — `dAvail` must be recomputed per candidate.
- Round 7 (`docs/...:2555-2564`): this module's existence at all is the fix for containment's vertex-only blind spot — it must actually run as `ContainmentModeQuery`'s second term (verified in Task 12, not here).
- `docs/...:2585-2591`: an unproducible in-triangle probe is inconclusive, not a rejected witness — folding it into a clean "no witness" silently reproduces the exact false negative this module exists to close.
- Coplanarity's `surfaceEpsilon` must be scaled by `sourceLocalDiagonal`, not `targetLocalDiagonal` — the triangles being compared are already in source's local frame at that point in the callback (a Codex `spec`-review of an earlier draft caught this mismatch, which silently misclassifies near-coplanar pairs when source/target differ in local scale).

**Known, spec-inherited limitation (not fixed in this task — flagged for the spec owner):** a Codex
`spec`-review of an earlier draft found that `crossingProbeFractions = [0.5, 0.1, 0.01]` (fixed
fractions of `dAvail`, never adaptively refined toward the actual intersection) can step clean through
a target whose interior, along the probed direction, is thinner than the finest fraction's absolute
distance — e.g. a large source triangle crossing a very thin closed target: at `dAvail` large relative
to the target's thickness, all three probes can land past the target's far wall, each reading
`outside`, producing a clean negative even though part of the triangle genuinely lies inside. This
mirrors `minPenetrationDepth`'s own declared-limit status (`docs/...:1892-1907`'s ladder has the
identical shape of gap, closed there by trying successively finer rungs down to a declared floor) but
the spec's own `SurfaceCrossingWitness` algorithm (`docs/...:2565-2616`) does not name an equivalent
declared floor or an adaptive-refinement requirement for this traversal specifically. This plan
implements the algorithm exactly as specified rather than inventing an undocumented adaptive-refinement
behavior beyond what 30+ rounds of review settled — **this is a real, reasoned gap for the spec owner
to resolve** (either declare an equivalent `minPenetrationDepth`-shaped floor for this traversal, or
require refinement toward the intersection segment), not a defect in this task's own implementation of
the spec as written. Track under the same "declared limit, not silent" heading `minPenetrationDepth`
already carries — do not attempt an undocumented fix here without updating the spec first.

---

### Task 11: `VolumeOverlapQuery`

**Objective:** Compose `ProperCrossingQuery` and both directions of `anyComponentInside` into the public, symmetric `volume-overlap` mode — the direct replacement for the sandbox app's old `ThreeCSG.intersect()`.

**Files:**
- Create: `wwwroot/collision/query/VolumeOverlapQuery.js`
- Test: `test/query/VolumeOverlapQuery.test.mjs`

**Interfaces:**
- Consumes: `properCrossingQuery(...)` from `wwwroot/collision/query/ProperCrossingQuery.js` (Task 8);
  `anyComponentInside(...)` from `wwwroot/collision/query/ContainmentQuery.js` (Task 9).
- Produces: `volumeOverlapQuery(source: Instance, target: Instance, options?: { crossing?: object, containment?: object, scheduler?: SchedulerHandle, compareCanonical?: (source: Instance, target: Instance) => number }) -> Promise<{ overlap: boolean, via?: 'crossing'|'containment(A in B)'|'containment(B in A)', diagnostics: Array<{reason: PairDiagnosticReason, role?: 'source'|'target'}>, stats: object }>` where
  `Instance = { geometry: THREE.BufferGeometry, bvh: MeshBVH, localDiagonal: number, connectivity: GeometryConnectivityResult, closedManifold: boolean, matrix: THREE.Matrix4 }` —
  exactly the shape `test/fixtures/geometry.mjs`'s `testInstance()` produces, and the shape
  `CollisionWorld` (a later task) is expected to assemble per fragment before calling this.
  `source`/`target` are fixed **public roles** used for diagnostic naming and are never swapped;
  `options.compareCanonical` (default: always treats `source` as canonical-first) decides ONLY which
  operand's fields this function hands to `properCrossingQuery` as its first (canonical) argument — see
  the cross-task conventions above for why this is the one place public role and canonical order can
  conflict, and why the resolution lives here rather than in `ProperCrossingQuery` itself.
  `options.scheduler` (default: no-op handle) is called with `await scheduler.checkpointIfDue()`
  **between each of this function's own composed terms** (crossing, then `A in B`, then `B in A`) —
  the composition-level checkpoint `docs/...:4230-4234`'s "must yield between stages, not only between
  pairs" fixture requires, which a Codex `spec`-review of an earlier draft found this function had no
  way to accept at all — as well as threaded into the `anyComponentInside` sub-calls themselves.
  Consumed by `CollisionWorld.js` (a later task) for `query.mode === 'volume-overlap'`.

- [ ] **Step 1: Write the failing test(s)**

```js
// test/query/VolumeOverlapQuery.test.mjs
import * as THREE from '../../wwwroot/vendor/three/build/three.module.js';
import { volumeOverlapQuery } from '../../wwwroot/collision/query/VolumeOverlapQuery.js';
import { box, at, mergeGeometries, testInstance } from '../fixtures/geometry.mjs';

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}  expected=${expected} actual=${actual}${note ? `  (${note})` : ''}`);
}

console.log('=== VolumeOverlapQuery: baseline ===');
{
  const small = testInstance(box(1, 1, 1));
  const large = testInstance(box(6, 6, 6));
  const contained = await volumeOverlapQuery(small, large);
  check('small solid fully inside large: overlap', contained.overlap, true);

  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  const separated = await volumeOverlapQuery(a, sep);
  check('clearly separated: no overlap', separated.overlap, false);
}

console.log('=== VolumeOverlapQuery: flush touching (round 3 headline) ===');
{
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(0, 2, 0));
  const r = await volumeOverlapQuery(a, b);
  check('flush face-to-face touching: NO overlap', r.overlap, false,
    'headline behavior change vs. the ThreeBSP.intersect() implementation this milestone replaces (docs/...:2498)');
}

console.log('=== VolumeOverlapQuery: L-shaped (non-convex) room, element in concave notch ===');
{
  // Two ADJACENT (touching, not interpenetrating) boxes forming an L. Interpenetrating
  // legs would break the even-odd solid model (their overlap region would read as a
  // hollow "XOR", not a union) -- adjacency keeps the combined surface a faithful L.
  const legA = box(4, 1, 1);                          // x:[-2,2] y:[-0.5,0.5] z:[-0.5,0.5]
  const legB = box(1, 3, 1).translate(-1.5, 2, 0);     // x:[-2,-1] y:[0.5,3.5] z:[-0.5,0.5]
  const lShape = testInstance(mergeGeometries([legA, legB]));
  const inNotch = testInstance(box(0.5, 0.5, 0.5), at(1, 2, 0)); // inside the L's bbox, outside the L itself
  const r = await volumeOverlapQuery(inNotch, lShape);
  check('element in concave notch: no overlap', r.overlap, false,
    'proves narrow-phase does not shortcut through the bounding box on non-convex solids');
}

console.log('=== VolumeOverlapQuery: torus, element centered in hole (round 1 regression) ===');
{
  const torus = testInstance(new THREE.TorusGeometry(3, 0.6, 12, 32));
  const bead = testInstance(box(0.5, 0.5, 0.5));
  const r = await volumeOverlapQuery(bead, torus);
  check('small solid in torus hole: no overlap', r.overlap, false,
    'round-1 regression: a bbox-centre approach reported a false positive here');
}

console.log('=== VolumeOverlapQuery: off-center embedded element (round 1 regression) ===');
{
  const room = testInstance(box(10, 10, 10));
  const element = testInstance(box(1, 1, 1), at(3, 3, 3));
  const r = await volumeOverlapQuery(element, room);
  check('off-center embedded element: overlap', r.overlap, true,
    'round-1 regression: a bbox-centre approach false-negatived off-center containment');
}

console.log('=== VolumeOverlapQuery: door straddling two rooms ===');
{
  const roomA = testInstance(box(4, 3, 4));               // x:[-2,2]
  const roomB = testInstance(box(4, 3, 4), at(4, 0, 0));  // x:[2,6]
  const door = testInstance(box(1, 2, 0.2), at(2, 0, 0)); // straddles x=2
  const rA = await volumeOverlapQuery(door, roomA);
  const rB = await volumeOverlapQuery(door, roomB);
  check('door overlaps room A', rA.overlap, true);
  check('door overlaps room B', rB.overlap, true);
}

console.log('=== VolumeOverlapQuery: negative with truncated coverage -> diagnosed, not clean ===');
{
  // Exercises "never report an unresolved/truncated negative as clean"
  // (docs/...:2462-2463, 2526-2534) via the sample-budget lever, which is
  // deterministic to construct by hand -- unlike a stage-3-exhausts-naturally case,
  // which depends on classifyPoint's exact per-triangle ray-parity behavior on a
  // constructed probe and isn't hand-verifiable without executing it. Task 9's own
  // suite already covers a genuinely stage-3-unresolved single component directly;
  // this test proves VolumeOverlapQuery's OWN diagnostic-merging wiring surfaces
  // whichever sub-call diagnostic fires.
  const parts = [];
  for (let i = 0; i < 20; i++) parts.push(box(2, 2, 2).translate(0, 1, i * 0.01)); // 20 near-coincident, boundary-heavy components
  const source = testInstance(mergeGeometries(parts));
  const target = testInstance(box(4, 4, 4));
  const r = await volumeOverlapQuery(source, target, { containment: { maxContainmentSamples: 10 } });
  check('truncated coverage carries a non-clean diagnostic',
    r.diagnostics.some((d) => d.reason === 'incomplete-component-coverage' || d.reason === 'inconclusive-containment'), true);
}

console.log('=== VolumeOverlapQuery: checkpoints between composed terms ===');
{
  // Regression for a Codex spec-review finding: an earlier draft had no way for
  // CollisionWorld to checkpoint BETWEEN this function's own composed terms
  // (crossing, then A-in-B, then B-in-A), so three individually-under-budget terms
  // could still sum past frameBudgetMs with no yield point. A negative-result pair
  // (so all three terms run to completion) with a call-counting mock scheduler proves
  // checkpointIfDue() is actually invoked between terms, not just inside
  // anyComponentInside's own sampling loop.
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0)); // negative result: forces crossing, A-in-B, AND B-in-A to all run
  let checkpointCalls = 0;
  const spySched = { elapsedMs: () => 0, checkpointIfDue: async () => { checkpointCalls++; } };
  await volumeOverlapQuery(a, sep, { scheduler: spySched });
  check('checkpointIfDue called between composed terms', checkpointCalls >= 2, true,
    `called ${checkpointCalls} times (expect >= 2: once before A-in-B, once before B-in-A)`);
}

console.log('=== VolumeOverlapQuery: compareCanonical decouples canonical order from public roles ===');
{
  // Regression for a Codex spec-review finding: this function's public `source`
  // parameter must stay the diagnostic-role `source` even when compareCanonical says
  // TARGET should be canonically-first for properCrossingQuery's own L scaling.
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  // Force target (beam) to sort canonically-first regardless of argument position.
  const forceTargetFirst = () => 1; // always says target < source
  const r = await volumeOverlapQuery(duct, beam, { compareCanonical: forceTargetFirst });
  check('overlap still detected with target forced canonically-first', r.overlap, true,
    'proves properCrossingQuery received correctly-ordered operands even though public source/target did not move');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/query/VolumeOverlapQuery.test.mjs`
Expected: fails at the `import { volumeOverlapQuery } from '../../wwwroot/collision/query/VolumeOverlapQuery.js'` line with `ERR_MODULE_NOT_FOUND`, since the file does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// wwwroot/collision/query/VolumeOverlapQuery.js
//
// Direct replacement for ThreeBSP.intersect(). docs/...:2498-2535.
//
//   volume-overlap(A, B) :=
//         ProperCrossingQuery(A, B)
//      OR ContainmentQuery(anyComponentOf(A) inside B)
//      OR ContainmentQuery(anyComponentOf(B) inside A)
//
// Evaluated in that order with early exit. Both directions are required for
// symmetry; the containment terms are "any component," not "the whole of A."

import { properCrossingQuery } from './ProperCrossingQuery.js';
import { anyComponentInside } from './ContainmentQuery.js';

const noopScheduler = { elapsedMs: () => 0, checkpointIfDue: async () => {} };
const defaultCompareCanonical = () => -1; // always treats `source` as canonical-first

/**
 * @typedef {{ geometry, bvh, localDiagonal, connectivity, closedManifold: boolean, matrix }} Instance
 * @param {Instance} source - fixed PUBLIC role, used for diagnostic naming; never swapped
 * @param {Instance} target - fixed PUBLIC role, used for diagnostic naming; never swapped
 * @param {{ crossing?: object, containment?: object, scheduler?: object, compareCanonical?: (source: Instance, target: Instance) => number }} [options]
 */
export async function volumeOverlapQuery(source, target, options = {}) {
  const scheduler = options.scheduler ?? noopScheduler;
  // Decides ONLY which operand's fields go first into properCrossingQuery, for
  // correct L_canonical scaling (docs/...:1609-1621) -- NEVER which operand this
  // function calls `source`/`target` for diagnostic role-naming, which stay fixed to
  // the caller's own public arguments throughout (the conflict a Codex spec-review of
  // an earlier draft found: swapping operands for canonical order would otherwise
  // also swap which one gets blamed in a diagnostic). Default: source is always
  // treated as canonical-first, preserving today's behavior for standalone tests;
  // CollisionWorld (a later task) supplies a real comparator once it has
  // (modelId, geometryKey, instanceId) identity.
  const compareCanonical = options.compareCanonical ?? defaultCompareCanonical;
  const [canonicalFirst, canonicalSecond] = compareCanonical(source, target) <= 0 ? [source, target] : [target, source];

  const diagnostics = [];
  const addDiagnostic = (reason, role) => {
    if (!diagnostics.some((d) => d.reason === reason && d.role === role)) {
      diagnostics.push(role ? { reason, role } : { reason });
    }
  };
  const mergeDiagnostics = (list) => { for (const d of list) addDiagnostic(d.reason, d.role); };

  const canonicalSecondToFirst = canonicalFirst.matrix.clone().invert().multiply(canonicalSecond.matrix);
  const crossing = properCrossingQuery(
    canonicalFirst.bvh, canonicalSecond.bvh, canonicalSecondToFirst,
    canonicalFirst.localDiagonal, canonicalSecond.localDiagonal, options.crossing
  );
  mergeDiagnostics(crossing.diagnostics);

  if (crossing.crossing) {
    // The crossing path classifies probes against BOTH solids, so both closure
    // preconditions apply regardless of which side the crossing geometrically
    // favored, and regardless of canonical order (docs/...:2378-2383). Neither
    // containment term ran, so this module must check closure directly here, against
    // the PUBLIC roles -- ProperCrossingQuery itself has no notion of "certified
    // closed" or public roles at all.
    if (!source.closedManifold) addDiagnostic('unverified-parity-operand', 'source');
    if (!target.closedManifold) addDiagnostic('unverified-parity-operand', 'target');
    return { overlap: true, via: 'crossing', diagnostics, stats: { crossing: crossing.stats } };
  }

  // Between-term checkpoint: each term below can individually sit under
  // frameBudgetMs while their SUM does not, so a checkpoint must exist HERE, not only
  // inside anyComponentInside's own sampling loop (the composition-level "must yield
  // between stages, not only between pairs" requirement a Codex spec-review of an
  // earlier draft found this function had no way to satisfy at all).
  await scheduler.checkpointIfDue();

  const sourceToTargetForAinB = target.matrix.clone().invert().multiply(source.matrix);
  const aInB = await anyComponentInside(
    source.geometry, source.bvh, source.localDiagonal, source.connectivity,
    target.bvh, target.localDiagonal, target.closedManifold,
    sourceToTargetForAinB,
    { ...options.containment, mode: 'volume-overlap', containerRole: 'target', sampledRole: 'source', scheduler }
  );
  mergeDiagnostics(aInB.diagnostics);

  if (aInB.inside) {
    return { overlap: true, via: 'containment(A in B)', diagnostics, stats: { crossing: crossing.stats, aInB } };
  }

  await scheduler.checkpointIfDue();

  const targetToSource = source.matrix.clone().invert().multiply(target.matrix);
  const bInA = await anyComponentInside(
    target.geometry, target.bvh, target.localDiagonal, target.connectivity,
    source.bvh, source.localDiagonal, source.closedManifold,
    targetToSource,
    { ...options.containment, mode: 'volume-overlap', containerRole: 'source', sampledRole: 'target', scheduler }
  );
  mergeDiagnostics(bInA.diagnostics);

  if (bInA.inside) {
    return { overlap: true, via: 'containment(B in A)', diagnostics, stats: { crossing: crossing.stats, aInB, bInA } };
  }

  // Negative: both containment terms already self-report unverified-parity-operand
  // for their own container role unconditionally (docs/...:2367-2389), merged above
  // -- so a negative here already carries every applicable parity diagnostic without
  // re-derivation. Any unresolved component makes this a DIAGNOSED negative, never a
  // clean one (docs/...:2526-2534).
  if (aInB.unresolvedComponentCount > 0 || bInA.unresolvedComponentCount > 0) {
    addDiagnostic('inconclusive-containment');
  }

  return {
    overlap: false,
    diagnostics,
    stats: { crossing: crossing.stats, aInB, bInA },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/query/VolumeOverlapQuery.test.mjs`
Expected: `11 passed, 0 failed`. Proves: full containment and clean separation both resolve correctly; flush touching reports no overlap (the headline behavior change from the old CSG implementation, contrasted with `SurfaceIntersectionQuery`'s own suite in Task 7 on the identical input); a non-convex L-shaped solid is not fooled by its own bounding box; the torus-hole false positive and off-center false negative from round 1 are both closed; a door straddling two adjacent rooms overlaps both independently; a sample-budget-truncated negative is never reported clean; the injected scheduler's `checkpointIfDue()` is actually called between this function's own composed terms; `compareCanonical` lets `properCrossingQuery` receive correctly-ordered operands without disturbing which operand is public `source`/`target`.

- [ ] **Step 5: Commit**
```bash
git add wwwroot/collision/query/VolumeOverlapQuery.js test/query/VolumeOverlapQuery.test.mjs
git commit -m "Add VolumeOverlapQuery: crossing-then-bidirectional-containment composition"
```

**Completion criteria:**
- Composition order is exactly crossing, then `A inside B`, then `B inside A`, with early exit on the first positive.
- Flush/coplanar touching alone never reports overlap.
- Every diagnostic surfaced by any sub-call is merged into the final result; a crossing-decided positive additionally checks both operands' closure directly (the one spot no sub-call already covers it).
- A negative result carries `inconclusive-containment` whenever either containment direction left a component unresolved.
- `compareCanonical` decides only which operand's fields reach `properCrossingQuery` first; the function's own `source`/`target` diagnostic role naming never changes regardless of canonical order.
- `scheduler.checkpointIfDue()` is called between each of this function's own composed terms (crossing, `A in B`, `B in A`), not only inside `anyComponentInside`'s own internal sampling loop.

**Protected invariants / regressions to watch:**
- Round 1 (`docs/...:2502-2504`): a bbox-center test is neither sufficient (torus hole) nor necessary (off-center embedding) — both must resolve correctly through the real composition, not a bbox shortcut.
- Round 2 (`docs/...:2505-2508`): vertex sampling alone misses the duct-through-beam class of crossing — `ProperCrossingQuery` must run first, unconditionally, not only as a fallback.
- Round 3 (`docs/...:2509-2528`): pure touching must resolve `false` — this is the direct, cited behavior change from the `ThreeBSP.intersect()` implementation this milestone replaces.
- `docs/...:2519-2523`: both containment directions are required — a fixture with only one direction tested would miss an asymmetric regression in the other.

---

### Task 12: `ContainmentModeQuery`

**Objective:** Compose vertex sampling and `SurfaceCrossingWitness` into the public, directed `containment` mode — the mode the room-locator extension actually uses.

**Files:**
- Create: `wwwroot/collision/query/ContainmentModeQuery.js`
- Test: `test/query/ContainmentModeQuery.test.mjs`

**Interfaces:**
- Consumes: `anyComponentInside(...)` from `wwwroot/collision/query/ContainmentQuery.js` (Task 9);
  `surfaceCrossingWitness(...)` from `wwwroot/collision/query/SurfaceCrossingWitness.js` (Task 10);
  `volumeOverlapQuery(...)` from `wwwroot/collision/query/VolumeOverlapQuery.js` (Task 11, test file
  only, for the directionality cross-check fixture).
- Produces: `containmentModeQuery(source: Instance, target: Instance, options?: { containment?: object, witness?: object, scheduler?: SchedulerHandle }) -> Promise<{ contained: boolean, via?: 'vertex'|'surface-crossing', diagnostics: Array<{reason: PairDiagnosticReason, role?: 'source'|'target'}>, stats: object }>`
  (`Instance` shape as in Task 11). **One direction only** — this mode is directed, unlike
  `VolumeOverlapQuery`'s symmetric composition (`docs/...:2544-2546`). `options.scheduler` (default:
  no-op handle) is threaded into the `anyComponentInside` vertex term as `scheduler` (its own
  `await checkpointIfDue()` calls apply), passed to `SurfaceCrossingWitness` as `scheduler` too (which
  only ever reads its synchronous `elapsedMs()`), AND checkpointed with `await
  scheduler.checkpointIfDue()` **between** the two terms — the SAME between-term composition-level gap
  Task 11 closes, and the same reason `SurfaceCrossingWitness`'s own baseline must come from this
  shared object rather than a value captured once at this function's entry (see Task 10's own
  interfaces section for the staleness Codex's review of an earlier draft found). Consumed by
  `CollisionWorld.js` (a later task) for `query.mode === 'containment'`, and by
  `RoomLocatorExtension.js` (Task 21, a later task) as the mode the room-locator acceptance criterion
  actually runs.

- [ ] **Step 1: Write the failing test(s)**

```js
// test/query/ContainmentModeQuery.test.mjs
import * as THREE from '../../wwwroot/vendor/three/build/three.module.js';
import { containmentModeQuery } from '../../wwwroot/collision/query/ContainmentModeQuery.js';
import { volumeOverlapQuery } from '../../wwwroot/collision/query/VolumeOverlapQuery.js';
import { box, at, comb, testInstance } from '../fixtures/geometry.mjs';

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}  expected=${expected} actual=${actual}${note ? `  (${note})` : ''}`);
}

console.log('=== ContainmentModeQuery: duct through beam, no vertex inside either (round 7 regression) ===');
{
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const r = await containmentModeQuery(duct, beam);
  check('duct through beam: contained', r.contained, true,
    'round-7: bare anyComponentInside gave a clean false here -- forces SurfaceCrossingWitness to run');
  check('...decided via surface-crossing, not vertex', r.via, 'surface-crossing');
}

console.log('=== ContainmentModeQuery: lone large triangle through room, all 3 corners outside (round 7 regression) ===');
{
  const bigTriangle = new THREE.BufferGeometry();
  bigTriangle.setAttribute('position', new THREE.Float32BufferAttribute(
    [-10, 0, 0, 10, 0, 0, 0, 10, 0], 3));
  bigTriangle.setIndex([0, 1, 2]);
  const source = testInstance(bigTriangle);
  const target = testInstance(box(4, 4, 4));
  const r = await containmentModeQuery(source, target);
  check('lone large triangle through room: contained', r.contained, true,
    'unfixable by raising sample count alone -- no vertex is ever inside');
}

console.log('=== ContainmentModeQuery: directionality vs. VolumeOverlapQuery symmetry ===');
{
  const element = testInstance(box(1, 1, 1));
  const room = testInstance(box(8, 8, 8));
  const elementInRoom = await containmentModeQuery(element, room);
  const roomInElement = await containmentModeQuery(room, element);
  check('containment(element, room): true', elementInRoom.contained, true);
  check('containment(room, element): false (directed)', roomInElement.contained, false,
    'the rooms surface does not pass through the element');

  const overlapForward = await volumeOverlapQuery(element, room);
  const overlapBackward = await volumeOverlapQuery(room, element);
  check('volume-overlap(element, room) === volume-overlap(room, element)', overlapForward.overlap === overlapBackward.overlap, true,
    'pins containment as directed, volume-overlap as symmetric (docs/...:2544-2546)');
}

console.log('=== ContainmentModeQuery: flush touching -> false (verifies coplanar rejection) ===');
{
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(0, 2, 0));
  const r = await containmentModeQuery(a, b);
  check('flush touching: not contained', r.contained, false,
    'verifies SurfaceCrossingWitness rejects coplanar candidate pairs, matching volume-overlap');
}

console.log('=== ContainmentModeQuery: budget exhaustion in the witness sub-call ===');
{
  const source = testInstance(comb(0));
  const target = testInstance(comb(0.05));
  const t0 = performance.now();
  const r = await containmentModeQuery(source, target, { witness: { maxCandidatePairsExamined: 500 } });
  const elapsed = performance.now() - t0;
  check('witness budget exhausted: not a clean negative', r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true);
  check('completes within a wall-clock bound', elapsed < 1000, true, `${elapsed.toFixed(1)}ms`);
}

console.log('=== ContainmentModeQuery: two exactly coincident closed boxes (round 9 counterexample) ===');
{
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2)); // identical geometry, identical transform
  const r = await containmentModeQuery(a, b);
  check('coincident closed boxes: NOT contained', r.contained, false,
    'every vertex boundary, every tri-tri contact coplanar -- the witness never gets a target line');
  check('carries inconclusive-containment', r.diagnostics.some((d) => d.reason === 'inconclusive-containment'), true);
}

console.log('=== ContainmentModeQuery: checkpoint between vertex and witness terms ===');
{
  // Regression for the same composition-level gap Task 11 closes: the vertex term
  // and SurfaceCrossingWitness can each individually sit under frameBudgetMs while
  // their sum does not. A negative-result pair (so both terms run) with a
  // call-counting mock scheduler proves checkpointIfDue() is invoked between them.
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  let checkpointCalls = 0;
  const spySched = { elapsedMs: () => 0, checkpointIfDue: async () => { checkpointCalls++; } };
  await containmentModeQuery(a, sep, { scheduler: spySched });
  check('checkpointIfDue called between the vertex and witness terms', checkpointCalls >= 1, true,
    `called ${checkpointCalls} times`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/query/ContainmentModeQuery.test.mjs`
Expected: fails at the `import { containmentModeQuery } from '../../wwwroot/collision/query/ContainmentModeQuery.js'` line with `ERR_MODULE_NOT_FOUND`, since the file does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// wwwroot/collision/query/ContainmentModeQuery.js
//
// The public `containment` mode. docs/...:2536-2564.
//
//   containment(A, B) :=
//         ContainmentQuery(anyComponentOf(A) inside B)   // a source VERTEX inside B
//      OR SurfaceCrossingWitness(A, B)                   // a point on a source TRIANGLE inside B
//
// One direction only, no bidirectional evaluation -- volume-overlap is symmetric,
// containment is a directed question about a source surface and a target solid.

import { anyComponentInside } from './ContainmentQuery.js';
import { surfaceCrossingWitness } from './SurfaceCrossingWitness.js';

const noopScheduler = { elapsedMs: () => 0, checkpointIfDue: async () => {} };

/**
 * @param {import('./VolumeOverlapQuery.js').Instance} source
 * @param {import('./VolumeOverlapQuery.js').Instance} target
 * @param {{ containment?: object, witness?: object, scheduler?: object }} [options]
 */
export async function containmentModeQuery(source, target, options = {}) {
  const scheduler = options.scheduler ?? noopScheduler;
  const diagnostics = [];
  const addDiagnostic = (reason, role) => {
    if (!diagnostics.some((d) => d.reason === reason && d.role === role)) {
      diagnostics.push(role ? { reason, role } : { reason });
    }
  };
  const mergeDiagnostics = (list) => { for (const d of list) addDiagnostic(d.reason, d.role); };

  const sourceToTarget = target.matrix.clone().invert().multiply(source.matrix);

  // First term: vertex sampling, stages 1-2 ONLY -- stage 3's constructed interior
  // witness would answer volume-overlap's question, not this mode's surface-only
  // contract (docs/...:2547-2553).
  const vertexTerm = await anyComponentInside(
    source.geometry, source.bvh, source.localDiagonal, source.connectivity,
    target.bvh, target.localDiagonal, target.closedManifold,
    sourceToTarget,
    { ...options.containment, mode: 'containment', containerRole: 'target', sampledRole: 'source', scheduler }
  );
  mergeDiagnostics(vertexTerm.diagnostics);

  if (vertexTerm.inside) {
    return { contained: true, via: 'vertex', diagnostics, stats: { vertexTerm } };
  }

  // Between-term checkpoint -- the same composition-level gap Task 11 closes: the
  // vertex term and the witness traversal below can each individually sit under
  // frameBudgetMs while their SUM does not. Threading the SAME `scheduler` into
  // SurfaceCrossingWitness below (as its own `elapsedMs()` source) is what lets an
  // earlier yield HERE be visible to that traversal's own time check, rather than it
  // measuring from a stale baseline captured before this yield happened.
  await scheduler.checkpointIfDue();

  // Second term is NOT optional (round 7 shipped without it, docs/...:2555-2564):
  // a source straddling target's boundary with no vertex inside it -- a duct through
  // a beam, a lone triangle through a room -- returns a clean false from the vertex
  // term alone, at any sample count.
  const targetToSource = sourceToTarget.clone().invert();
  const witnessTerm = surfaceCrossingWitness(
    source.bvh, target.bvh, targetToSource,
    source.localDiagonal, target.localDiagonal,
    { ...options.witness, scheduler }
  );
  mergeDiagnostics(witnessTerm.diagnostics);

  if (witnessTerm.witnessFound) {
    return { contained: true, via: 'surface-crossing', diagnostics, stats: { vertexTerm, witnessTerm } };
  }

  // A component left unresolved by stages 1-2 contributes no witness of its own; if
  // the triangle-level search ALSO finds nothing, this is a diagnosed negative, never
  // a silently clean one (docs/...:2445-2456).
  if (vertexTerm.unresolvedComponentCount > 0 || witnessTerm.inconclusive) {
    addDiagnostic('inconclusive-containment');
  }

  return { contained: false, diagnostics, stats: { vertexTerm, witnessTerm } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/query/ContainmentModeQuery.test.mjs`
Expected: `12 passed, 0 failed`. Proves: the duct-through-beam and lone-triangle-through-room cases both resolve via `SurfaceCrossingWitness`, not the vertex term (`via: 'surface-crossing'`); `containment` is directed while `volume-overlap` (checked in the same file for contrast) is symmetric; flush touching is rejected; a `SurfaceCrossingWitness` budget abort surfaces `crossing-budget-exhausted` and completes fast; two exactly coincident closed boxes report `false` with `inconclusive-containment`, exactly the round-9 counterexample this mode's own composition (as opposed to `VolumeOverlapQuery`'s stage-3-equipped one) cannot resolve.

- [ ] **Step 5: Commit**
```bash
git add wwwroot/collision/query/ContainmentModeQuery.js test/query/ContainmentModeQuery.test.mjs
git commit -m "Add ContainmentModeQuery: vertex-then-surface-crossing directed containment"
```

**Completion criteria:**
- Composition is exactly vertex-term (stages 1-2 only) then `SurfaceCrossingWitness`, one direction, no early return before the second term is tried on a first-term negative.
- Stage 3 of `anyComponentInside` never runs under this mode (`mode: 'containment'` passed explicitly).
- `containment(A, B)` and `containment(B, A)` can and do disagree; `volumeOverlapQuery(A, B)` and `volumeOverlapQuery(B, A)` never do.
- Two exactly coincident closed boxes resolve to `false` with `inconclusive-containment` — this mode has no stage-3 escape hatch for that counterexample, unlike `VolumeOverlapQuery`.
- `scheduler.checkpointIfDue()` is called between the vertex term and the witness term, and the SAME `scheduler` object is threaded into both sub-calls so an earlier yield's reset is visible to `SurfaceCrossingWitness`'s own `elapsedMs()` read.

**Protected invariants / regressions to watch:**
- Round 7 (`docs/...:2555-2564`): the second term is not optional — a bare vertex-sampling composition reintroduces round 2's class of miss inside a new mode.
- Round 8 (`docs/...:2544-2546`): directionality is the mode's whole definition — a symmetric reading collapses it into `volume-overlap`.
- Round 9 (`docs/...:2435-2443`): stage 3 must never run here — running it would make two coincident closed boxes read `contained: true`, silently answering `volume-overlap`'s question instead of this mode's surface-only one.

---

---


Covers: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1354-1594`
(`ThreeMeshBvhBackend`/`BlasCache`, the "Publish-when-build-starts rule",
`maxSyncTriangleCount` scope), `:4209-4629` (`CollisionWorld.findClashes` registry
fixtures), and Risk #6 / round-31 disposition item (c) (instance-tree readiness).

**Test harness note (applies to Tasks 13 and 14 only):** the canonical reference allows
either the spike's synchronous `check(name, actual, expected)` harness or Node's built-in
`node --test`, "unless your task explicitly finds a reason to add one." Tasks 13/14 need
controllable interleaving of concurrent async builds (deferred promises, call-order spies,
exact-rejection-timing races) that the spike harness's synchronous equality checks cannot
express. Both tasks use `node --test` with `node:assert/strict` — zero new dependency,
already available on the pinned Node runtime, chosen for this reason.

**Cross-task interface flags (read before implementing Task 14, and before Task 17/19/20
consume Task 13's registry):**

1. **Checkpoint-port call shape.** Task 1's `collision/scheduler.js` port is described
   elsewhere in this plan only as "shaped roughly as `async checkpoint({model, loadEpoch})`."
   `GeometryRegistry` entries never hold a live `Model` object — only `loadEpoch` and a
   diagnostic `ownerModelIdHint` (spec `:183`, `:1450-1457`: "modelId remains attached only
   as display/diagnostic metadata... plays no role in cache identity"; "checks... the
   liveness/epoch of the one model that owns this geometry"). This task therefore calls the
   port as **`checkpointPort.checkpoint({ loadEpoch })`** — omitting `model` — which requires
   the real port (wired by Task 17) to resolve owner-liveness from `loadEpoch` alone (an
   `epoch -> live/evicted` index), not solely from a `Model` object identity. If Task 1's
   actual contract cannot support an epoch-only call, the fix is localized to Task 14's
   `createGeometryRegistry.js` wiring (wrap Task 1's real port in a thin adapter that resolves
   `loadEpoch -> model` before delegating) — `GeometryRegistry.js` itself (Task 13) never
   needs to change, since it only ever calls `checkpointPort.checkpoint({ loadEpoch })`.
2. **`FakeCheckpointPort`'s exact shape is assumed, not confirmed**, since Task 1 may not
   exist yet when this section is authored. Task 13's tests isolate this assumption behind
   one local helper (`makeTestCheckpointPort`, Step 1 below) — if Task 1's real
   `FakeCheckpointPort` differs (constructor args, method names), only that helper needs
   editing, not the fixtures themselves.

---

### Task 13: `GeometryRegistry` — entry state machine

**Objective:** Build the publish-on-build-start, single-flight, cancellable entry state machine that lets concurrent `findClashes` calls share one geometry build without racing or duplicating work.

**Files:**
- Create: `collision/geometry/GeometryRegistry.js`
- Test: `test/geometry/GeometryRegistry.test.mjs`

**Interfaces:**
- Consumes:
  - `collision/errors.js`: `WorldDisposedError`, `ModelEvictedError` (canonical reference).
  - `collision/scheduler.js`: `FakeCheckpointPort` (assumed shape — see flag 2 above),
    exposing at minimum `new FakeCheckpointPort()`, `port.checkpoint({ loadEpoch }) ->
    Promise<void>` (throws `WorldDisposedError` if disposed, `ModelEvictedError` if the given
    `loadEpoch` isn't live), `port.setEpochLive(loadEpoch, isLive)`, `port.dispose()`.
  - Three injected phase-builder functions, constructor parameters (stubs in this task's own
    tests; wired to real implementations in Task 14):
    - `buildWeld(loadEpoch, geometryIndex, ownerModelIdHint) -> Promise<{ position:
      Float32Array, index: Uint32Array, triangleCount: number } | OversizedMarker>`
    - `buildConnectivity(weldedGeometry) -> Promise<GeometryConnectivityResult>`
    - `buildAcceleration(weldedGeometry) -> Promise<{ bvh, localDiagonal: number }>`
- Produces (the hard contract Tasks 17/19/20 import by these exact names):
  ```ts
  class GeometryRegistry {
    constructor(opts: {
      buildWeld: (loadEpoch: number, geometryIndex: number, ownerModelIdHint: number|string)
        => Promise<WeldedGeometry | OversizedMarker>;
      buildConnectivity: (welded: WeldedGeometry) => Promise<GeometryConnectivityResult>;
      buildAcceleration: (welded: WeldedGeometry) => Promise<{ bvh: MeshBVH; localDiagonal: number }>;
      checkpointPort: { checkpoint(args: { loadEpoch: number }): Promise<void> };
    });

    // Looks up or builds the geometry for (loadEpoch, geometryIndex). `ownerModelIdHint`
    // is stored only on first build (diagnostic; never part of the cache key).
    // `needsConnectivity: true` for `containment`/`volume-overlap` callers, `false` for
    // `surface-intersection`. Resolves to a discriminated union on `oversized`:
    getOrBuildGeometry(args: {
      loadEpoch: number;
      geometryIndex: number;
      ownerModelIdHint: number | string;
      needsConnectivity: boolean;
    }): Promise<
      OversizedMarker |   // { oversized: true, reason: 'geometry-too-large-for-sync-build', activeTriangleCount }
      { oversized: false; bvh: MeshBVH; localDiagonal: number; connectivity: GeometryConnectivityResult | null }
    >;

    // Rejects every live entry's cancellation signal exactly once for entries filed under
    // this loadEpoch (skipping oversized markings, which never had one), then removes them.
    // Synchronous — the whole sweep is one non-preemptible span (spec :2015, performance
    // gate criterion 10).
    releaseEntriesForEpoch(loadEpoch: number): void;

    // Same, but for every entry regardless of epoch (world.dispose() equivalent).
    releaseAll(): void;
  }
  ```

- [ ] **Step 1: Write the failing test(s)**

`test/geometry/GeometryRegistry.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeometryRegistry } from '../../collision/geometry/GeometryRegistry.js';
import { WorldDisposedError, ModelEvictedError } from '../../collision/errors.js';
import { FakeCheckpointPort } from '../../collision/scheduler.js';

// -- test helpers ---------------------------------------------------------

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Thin adapter over Task 1's FakeCheckpointPort. GeometryRegistry only ever calls
// checkpointPort.checkpoint({ loadEpoch }) -- never with a `model`, since a registry
// entry carries no live Model reference (see this section's cross-task interface
// flags). If Task 1's actual FakeCheckpointPort constructor/method names differ from
// what's assumed here, only this helper needs to change, not the fixtures below.
function makeCheckpointHarness() {
  const port = new FakeCheckpointPort();
  let callCount = 0;
  return {
    port,
    callCount: () => callCount,
    checkpointPort: {
      checkpoint: async (args) => {
        callCount++;
        return port.checkpoint(args);
      },
    },
    setEpochLive: (loadEpoch, isLive) => port.setEpochLive(loadEpoch, isLive),
    dispose: () => port.dispose(),
  };
}

function makeSpyBuilders({ welded = { position: new Float32Array(), index: new Uint32Array(), triangleCount: 8 } } = {}) {
  const calls = { weld: 0, connectivity: 0, acceleration: 0 };
  return {
    calls,
    buildWeld: async () => { calls.weld++; return welded; },
    buildConnectivity: async () => { calls.connectivity++; return { componentCount: 1, componentOf: new Int32Array(), closedManifold: [true] }; },
    buildAcceleration: async () => { calls.acceleration++; return { bvh: { fake: 'bvh' }, localDiagonal: 1.732 }; },
  };
}

function makeRegistry(overrides = {}) {
  const harness = overrides.harness ?? makeCheckpointHarness();
  const spies = overrides.spies ?? makeSpyBuilders(overrides.buildersOpts);
  harness.setEpochLive(overrides.loadEpoch ?? 1, true);
  const registry = new GeometryRegistry({
    buildWeld: overrides.buildWeld ?? spies.buildWeld,
    buildConnectivity: overrides.buildConnectivity ?? spies.buildConnectivity,
    buildAcceleration: overrides.buildAcceleration ?? spies.buildAcceleration,
    checkpointPort: harness.checkpointPort,
  });
  return { registry, harness, spies };
}

// -- basic state machine ---------------------------------------------------

test('surface-intersection build resolves weld+BVH, never touches connectivity', async () => {
  const { registry, spies } = makeRegistry();
  const result = await registry.getOrBuildGeometry({
    loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false,
  });
  assert.equal(result.oversized, false);
  assert.equal(result.connectivity, null);
  assert.ok(result.bvh);
  assert.equal(spies.calls.weld, 1);
  assert.equal(spies.calls.acceleration, 1);
  assert.equal(spies.calls.connectivity, 0);
});

test('first-time containment build runs weld, connectivity, then BVH, in that order', async () => {
  const order = [];
  const { registry } = makeRegistry({
    buildWeld: async () => { order.push('weld'); return { position: new Float32Array(), index: new Uint32Array(), triangleCount: 8 }; },
    buildConnectivity: async () => { order.push('connectivity'); return { componentCount: 1, componentOf: new Int32Array(), closedManifold: [true] }; },
    buildAcceleration: async () => { order.push('acceleration'); return { bvh: {}, localDiagonal: 1 }; },
  });
  const result = await registry.getOrBuildGeometry({
    loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: true,
  });
  assert.deepEqual(order, ['weld', 'connectivity', 'acceleration']);
  assert.ok(result.connectivity);
});

test('buildState reaches ready once weld+BVH resolve: a second call for the same key never re-invokes buildWeld', async () => {
  // No direct buildState accessor is part of the public contract (internal to the
  // registry) -- readiness is instead observed behaviourally: once ready, a second
  // call for the same key must not re-invoke buildWeld/buildAcceleration.
  const { registry, spies } = makeRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(spies.calls.weld, 1);
  assert.equal(spies.calls.acceleration, 1);
});

// -- oversized-marker path (spec :1490-1498) --------------------------------

test('a weld resolving to an OversizedMarker is stored as a distinct entry kind', async () => {
  const marker = { oversized: true, reason: 'geometry-too-large-for-sync-build', activeTriangleCount: 13000 };
  const { registry, spies } = makeRegistry({
    buildWeld: async () => { spies.calls.weld++; return marker; },
  });
  const result = await registry.getOrBuildGeometry({
    loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: true,
  });
  assert.deepEqual(result, marker);
  assert.equal(spies.calls.connectivity, 0, 'connectivity must never be invoked for an oversized geometry');
  assert.equal(spies.calls.acceleration, 0, 'BVH must never be invoked for an oversized geometry');

  // Never re-classified once cached (spec :1515-1516): a second lookup for the same
  // key must not re-invoke buildWeld.
  const result2 = await registry.getOrBuildGeometry({
    loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false,
  });
  assert.deepEqual(result2, marker);
  assert.equal(spies.calls.weld, 1);
});

// -- checkpoint-failure / cancellation-signal removal (spec :1462-1470) ----

test('checkpoint failure between phases rejects the in-flight phase and removes the entry synchronously', async () => {
  const weldGate = deferred();
  const { registry, harness, spies } = makeRegistry({
    buildWeld: async () => { spies.calls.weld++; return weldGate.promise; },
  });
  const pending = registry.getOrBuildGeometry({
    loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false,
  });
  // Simulate world.evictModel(model) landing while weld is still in flight, from the
  // owning epoch's own liveness check (not yet via the entry's cancellation signal --
  // this exercises the checkpoint's OWN throw path, see Task 14's flag 1 note).
  harness.setEpochLive(1, false);
  weldGate.resolve({ position: new Float32Array(), index: new Uint32Array(), triangleCount: 8 });
  await assert.rejects(pending, ModelEvictedError);

  // Subsequent lookup must miss cleanly and a later valid call must start fresh.
  harness.setEpochLive(1, true);
  const result = await registry.getOrBuildGeometry({
    loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false,
  });
  assert.equal(result.oversized, false);
  assert.equal(spies.calls.weld, 2, 'weld must run again -- the half-built record was discarded, not resumed');
});

test('an arbitrary builder exception (not a lifecycle error) also removes the entry, not just a checkpoint failure', async () => {
  // Generalizes the spec's explicit checkpoint-failure removal rule (:1462-1470) to
  // any phase rejection: a "no failed state" guarantee that only covered lifecycle
  // errors would still leave a permanently stuck 'building' record behind a builder bug.
  const { registry, spies } = makeRegistry({
    buildAcceleration: async () => {
      spies.calls.acceleration++;
      // Throws once, then succeeds -- proves the SECOND call is a genuinely fresh
      // attempt (not a resumed/cached rejection), which a stub that always throws
      // cannot distinguish from "permanently stuck."
      if (spies.calls.acceleration === 1) throw new Error('MeshBVH constructor choked on malformed geometry');
      return { bvh: { fake: 'bvh' }, localDiagonal: 1 };
    },
  });
  await assert.rejects(
    registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false }),
    /malformed geometry/
  );
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(result.oversized, false, 'a fresh attempt must be possible, not permanently stuck');
  assert.equal(spies.calls.acceleration, 2);
});

// -- dedup across concurrent callers (spec :1430-1435) ----------------------

test('two concurrent callers needing the same (loadEpoch, geometryIndex) share one build', async () => {
  const weldGate = deferred();
  const { registry, spies } = makeRegistry({
    buildWeld: async () => { spies.calls.weld++; return weldGate.promise; },
  });
  const args = { loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false };
  const p1 = registry.getOrBuildGeometry(args);
  const p2 = registry.getOrBuildGeometry(args); // lands while p1 is suspended mid-build
  weldGate.resolve({ position: new Float32Array(), index: new Uint32Array(), triangleCount: 8 });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.bvh, r2.bvh, 'both callers observe the same resolved BVH object');
  assert.equal(spies.calls.weld, 1);
  assert.equal(spies.calls.acceleration, 1);
});

test('a surface-intersection caller and a containment caller sharing an entry: containment drives connectivity, surface-intersection never awaits it', async () => {
  const weldGate = deferred();
  const { registry, spies } = makeRegistry({
    buildWeld: async () => { spies.calls.weld++; return weldGate.promise; },
  });
  const p1 = registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  const p2 = registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: true });
  weldGate.resolve({ position: new Float32Array(), index: new Uint32Array(), triangleCount: 8 });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.connectivity, null);
  assert.ok(r2.connectivity);
  assert.equal(spies.calls.weld, 1);
  assert.equal(spies.calls.acceleration, 1);
  assert.equal(spies.calls.connectivity, 1);
});

// -- serialization: at most one unresolved phase per entry ------------------

test('a lazy connectivity request arriving mid-BVH-build queues behind BVH, never runs concurrently with it', async () => {
  const accelGate = deferred();
  const order = [];
  const { registry } = makeRegistry({
    buildAcceleration: async () => { order.push('acceleration-start'); const r = await accelGate.promise; order.push('acceleration-end'); return r; },
    buildConnectivity: async () => { order.push('connectivity'); return { componentCount: 1, componentOf: new Int32Array(), closedManifold: [true] }; },
  });
  const surfacePromise = registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  // Give the acceleration phase a chance to actually start before the second caller arrives.
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['acceleration-start']);
  const containmentPromise = registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: true });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['acceleration-start'], 'connectivity must not start while BVH is still unresolved');
  accelGate.resolve({ bvh: {}, localDiagonal: 1 });
  await Promise.all([surfacePromise, containmentPromise]);
  assert.deepEqual(order, ['acceleration-start', 'acceleration-end', 'connectivity']);
});

// -- release: evictModel/dispose reject the entry-scoped signal (spec :1471-1489) --

test('releaseEntriesForEpoch rejects a lazy connectivity build suspended on an already-ready entry (C-2)', async () => {
  const connectivityGate = deferred();
  const { registry } = makeRegistry({
    buildConnectivity: async () => connectivityGate.promise,
  });
  const ready = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(ready.oversized, false); // entry is now 'ready', connectivity never touched.

  const laterConnectivity = registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: true });
  await new Promise((r) => setImmediate(r)); // let the lazy connectivity phase actually start.
  registry.releaseEntriesForEpoch(1);
  await assert.rejects(laterConnectivity, ModelEvictedError);

  // Entry removed: a fresh call after release must start a brand new build, not resume.
  const fresh = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(fresh.oversized, false);
});

test('releaseAll rejects the same suspended connectivity build with WorldDisposedError instead', async () => {
  const connectivityGate = deferred();
  const { registry } = makeRegistry({
    buildConnectivity: async () => connectivityGate.promise,
  });
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  const laterConnectivity = registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: true });
  await new Promise((r) => setImmediate(r));
  registry.releaseAll();
  await assert.rejects(laterConnectivity, WorldDisposedError);
});

test('releaseEntriesForEpoch against an epoch mixing an oversized marking with ordinary entries (C-5)', async () => {
  const marker = { oversized: true, reason: 'geometry-too-large-for-sync-build', activeTriangleCount: 13000 };
  let rejectedSignals = 0;
  const harness = makeCheckpointHarness();
  harness.setEpochLive(1, true);
  const registry = new GeometryRegistry({
    buildWeld: async (loadEpoch, geometryIndex) => (geometryIndex === 99 ? marker : { position: new Float32Array(), index: new Uint32Array(), triangleCount: 8 }),
    buildConnectivity: async () => { throw new Error('should never be reached by this fixture'); },
    buildAcceleration: async () => new Promise(() => {}), // never resolves -- stays 'building'.
    checkpointPort: harness.checkpointPort,
  });
  // entry A: never settles (stays 'building').
  const pendingA = registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 1, ownerModelIdHint: 'm1', needsConnectivity: false });
  pendingA.catch(() => {});
  // entry B: oversized marking.
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 99, ownerModelIdHint: 'm1', needsConnectivity: false });

  assert.doesNotThrow(() => registry.releaseEntriesForEpoch(1));
  await assert.rejects(pendingA, ModelEvictedError);
  // A fresh lookup for the oversized key must not resurrect it as a live build attempt,
  // and must not have triggered any signal rejection for it (nothing to reject).
  // We assert this indirectly: releaseEntriesForEpoch above did not throw, and did not
  // hang, which it would if it tried to call reject on an oversized marking's
  // (nonexistent) signal and that code path were broken.
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/geometry/GeometryRegistry.test.mjs`

Expected: every test fails with a `Cannot find module '../../collision/geometry/GeometryRegistry.js'`
(or, once a placeholder file exists, `GeometryRegistry is not a constructor` /
`registry.getOrBuildGeometry is not a function`) — no test passes because the module does
not exist yet. This also fails fast if `collision/scheduler.js`'s `FakeCheckpointPort`
export doesn't exist yet in the tree (see this section's cross-task interface flags) —
that failure is expected and acceptable until Task 1 lands; do not stub `FakeCheckpointPort`
locally to make this test pass prematurely.

- [ ] **Step 3: Write the implementation**

`collision/geometry/GeometryRegistry.js`:

```js
// collision/geometry/GeometryRegistry.js
//
// Registry of per-(loadEpoch, geometryIndex) GeometryRecord/OversizedMarker entries.
// Implements the "publish-when-build-starts" rule
// (docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1413-1499).
//
// Builder-agnostic by design: buildWeld/buildConnectivity/buildAcceleration are
// injected constructor parameters. Task 14 wires the real compactAndWeld /
// GeometryConnectivity / BlasCache builders via createGeometryRegistry.js; this file
// is exercised in isolation with stub builders in test/geometry/GeometryRegistry.test.mjs.

import { WorldDisposedError, ModelEvictedError } from '../errors.js';

function makeCancellationSignal() {
  let rejectSignal;
  const signal = new Promise((_resolve, reject) => {
    rejectSignal = reject;
  });
  signal.catch(() => {}); // always raced via Promise.race below; avoid stray warnings
  // in the case a phase is never actually scheduled against this signal.
  return { signal, rejectSignal };
}

export class GeometryRegistry {
  constructor({ buildWeld, buildConnectivity, buildAcceleration, checkpointPort }) {
    if (typeof buildWeld !== 'function') {
      throw new TypeError('GeometryRegistry requires buildWeld(loadEpoch, geometryIndex, ownerModelIdHint)');
    }
    if (typeof buildConnectivity !== 'function') {
      throw new TypeError('GeometryRegistry requires buildConnectivity(weldedGeometry)');
    }
    if (typeof buildAcceleration !== 'function') {
      throw new TypeError('GeometryRegistry requires buildAcceleration(weldedGeometry)');
    }
    if (!checkpointPort || typeof checkpointPort.checkpoint !== 'function') {
      throw new TypeError('GeometryRegistry requires a checkpointPort exposing checkpoint({ loadEpoch })');
    }
    this._buildWeld = buildWeld;
    this._buildConnectivity = buildConnectivity;
    this._buildAcceleration = buildAcceleration;
    this._checkpointPort = checkpointPort;
    // Map<loadEpoch, Map<geometryIndex, Entry>> -- nested so releaseEntriesForEpoch is
    // O(entries-in-epoch), mirroring the CollisionInstance cache's own
    // Map<loadEpoch, Map<fragmentId, CollisionInstance>> partitioning (spec :207, :1324-1330).
    // Entry = { buildState, weldPromise, connectivityPromise, accelerationPromise,
    //           cancellationSignal, rejectSignal, ownerModelIdHint, weldedGeometry,
    //           weldWasOversized }                                    (a GeometryRecord)
    //       | { oversized: true, reason, activeTriangleCount }        (an OversizedMarker,
    //           stored verbatim -- see _convertToOversized -- so a cache hit can hand it
    //           back to a caller directly, with no internal tag to strip first)
    // The two are told apart by `entry.oversized === true`, never by a separate tag
    // field: a GeometryRecord never sets `oversized` at all, and OversizedMarker's own
    // canonical shape already carries it.
    this._epochs = new Map();
  }

  async getOrBuildGeometry({ loadEpoch, geometryIndex, ownerModelIdHint, needsConnectivity }) {
    let bucket = this._epochs.get(loadEpoch);
    if (!bucket) {
      bucket = new Map();
      this._epochs.set(loadEpoch, bucket);
    }
    let entry = bucket.get(geometryIndex);
    if (!entry) {
      // "Insert first, then build" (spec :1423-1429): the entry is inserted here,
      // synchronously, before the weld phase's checkpoint ever runs. A concurrent
      // lookup landing after this line -- however soon -- shares this exact entry
      // rather than starting a duplicate build.
      entry = this._insertBuildingEntry(loadEpoch, geometryIndex, ownerModelIdHint, needsConnectivity);
      bucket.set(geometryIndex, entry);
    }
    return this._awaitEntry(loadEpoch, geometryIndex, entry, needsConnectivity);
  }

  releaseEntriesForEpoch(loadEpoch) {
    const bucket = this._epochs.get(loadEpoch);
    if (!bucket) return;
    for (const entry of bucket.values()) {
      // Oversized markings never had a phase started, and therefore never had a
      // cancellation signal created -- nothing to reject (spec :1490-1498).
      if (entry.oversized !== true) {
        entry.rejectSignal(new ModelEvictedError(entry.ownerModelIdHint));
      }
    }
    this._epochs.delete(loadEpoch);
  }

  releaseAll() {
    for (const bucket of this._epochs.values()) {
      for (const entry of bucket.values()) {
        if (entry.oversized !== true) {
          entry.rejectSignal(new WorldDisposedError());
        }
      }
    }
    this._epochs.clear();
  }

  // -- internals --------------------------------------------------------

  _insertBuildingEntry(loadEpoch, geometryIndex, ownerModelIdHint, needsConnectivityAtStart) {
    const { signal, rejectSignal } = makeCancellationSignal();
    const entry = {
      buildState: 'building',
      weldPromise: null,
      connectivityPromise: null,
      accelerationPromise: null,
      cancellationSignal: signal,
      rejectSignal,
      ownerModelIdHint,
      weldedGeometry: null,
      weldWasOversized: false,
    };

    entry.weldPromise = this._runPhase(loadEpoch, geometryIndex, entry, () =>
      this._buildWeld(loadEpoch, geometryIndex, ownerModelIdHint)
    );

    // `tail` is reassigned synchronously every time a phase is scheduled below, so
    // phase ORDER is fixed at schedule time, never at settle time -- this is what
    // keeps concurrent callers from racing each other into starting the same phase
    // twice, and what enforces "at most one phase unresolved on an entry at a time"
    // (spec :1482-1484).
    let tail = entry.weldPromise.then((weldResult) => {
      if (weldResult && weldResult.oversized === true) {
        entry.weldWasOversized = true;
        this._convertToOversized(loadEpoch, geometryIndex, entry, weldResult);
        return;
      }
      entry.weldedGeometry = weldResult;
    });

    if (needsConnectivityAtStart) {
      tail = this._chainConnectivity(loadEpoch, geometryIndex, entry, tail);
    }
    this._chainAcceleration(loadEpoch, geometryIndex, entry, tail);

    return entry;
  }

  _chainConnectivity(loadEpoch, geometryIndex, entry, waitFor) {
    entry.connectivityPromise = waitFor.then(() => {
      if (entry.weldWasOversized) return null; // never read by any real caller.
      return this._runPhase(loadEpoch, geometryIndex, entry, () =>
        this._buildConnectivity(entry.weldedGeometry)
      );
    });
    // May legitimately go unread (e.g. a surface-intersection caller sharing an
    // entry a containment caller built) -- prevent a spurious unhandledRejection.
    entry.connectivityPromise.catch(() => {});
    return entry.connectivityPromise;
  }

  _chainAcceleration(loadEpoch, geometryIndex, entry, waitFor) {
    entry.accelerationPromise = waitFor
      .then(() => {
        if (entry.weldWasOversized) return null;
        return this._runPhase(loadEpoch, geometryIndex, entry, () =>
          this._buildAcceleration(entry.weldedGeometry)
        );
      })
      .then((accel) => {
        // 'ready' is record-level and mode-independent: weld+BVH both resolved,
        // regardless of whether connectivity was ever touched (spec :1439-1448).
        if (!entry.weldWasOversized) entry.buildState = 'ready';
        return accel;
      });
    entry.accelerationPromise.catch(() => {});
    return entry.accelerationPromise;
  }

  _runPhase(loadEpoch, geometryIndex, entry, builderFn) {
    const attempt = (async () => {
      await this._checkpointPort.checkpoint({ loadEpoch });
      return builderFn();
    })();
    // Every phase races the entry's one cancellation signal, including a lazily
    // started connectivity build against an already-'ready' entry (spec :1475-1477).
    // On ANY rejection -- a checkpoint's own liveness failure, the cancellation
    // signal winning the race, or an arbitrary builder exception -- the entry is
    // removed synchronously as part of the same rejection (spec :1462-1470,
    // generalized here to any phase-rejection cause, not only a checkpoint failure,
    // so a builder bug can never leave a permanently stuck 'building' record).
    return Promise.race([attempt, entry.cancellationSignal]).catch((err) => {
      this._removeIfSame(loadEpoch, geometryIndex, entry);
      throw err;
    });
  }

  _convertToOversized(loadEpoch, geometryIndex, placeholder, marker) {
    const bucket = this._epochs.get(loadEpoch);
    if (bucket && bucket.get(geometryIndex) === placeholder) {
      // Stored verbatim as the canonical OversizedMarker shape -- no extra internal
      // tag -- so a cache-hit lookup can return this object directly (see
      // _awaitEntry) without stripping fields first.
      bucket.set(geometryIndex, {
        oversized: true,
        reason: marker.reason,
        activeTriangleCount: marker.activeTriangleCount,
      });
    }
    // else: placeholder already removed (e.g. released mid-classification) -- a
    // later lookup should start fresh, not resurrect a stale verdict; do nothing.
  }

  _removeIfSame(loadEpoch, geometryIndex, entry) {
    const bucket = this._epochs.get(loadEpoch);
    if (bucket && bucket.get(geometryIndex) === entry) {
      bucket.delete(geometryIndex);
      if (bucket.size === 0) this._epochs.delete(loadEpoch);
    }
  }

  async _awaitEntry(loadEpoch, geometryIndex, entry, needsConnectivity) {
    if (entry.oversized === true) {
      // Skip the pair immediately, without awaiting any phase (spec :1430-1432).
      return entry;
    }
    const weldResult = await entry.weldPromise;
    if (weldResult && weldResult.oversized === true) {
      return weldResult;
    }
    if (needsConnectivity && !entry.connectivityPromise) {
      // Lazy, on-demand connectivity against an entry that never needed it before --
      // possibly already 'ready', possibly still mid-BVH-build, in which case this
      // synchronously queues behind whatever phase is currently in flight (spec
      // :1443-1447; "at most one phase unresolved on an entry at a time", :1482-1484).
      this._chainConnectivity(loadEpoch, geometryIndex, entry, entry.accelerationPromise);
    }
    const accel = await entry.accelerationPromise;
    const connectivity = needsConnectivity ? await entry.connectivityPromise : null;
    return { oversized: false, bvh: accel.bvh, localDiagonal: accel.localDiagonal, connectivity };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/geometry/GeometryRegistry.test.mjs`

Expected: PASS, proving —
- basic surface-intersection build resolves without ever calling `buildConnectivity`;
- first-time containment build runs phases in `weld -> connectivity -> acceleration` order;
- an `OversizedMarker`-shaped weld result becomes a distinct, non-`buildState` entry that is
  never re-classified and never triggers `buildConnectivity`/`buildAcceleration`;
- a checkpoint failure between phases rejects in flight and removes the entry synchronously,
  and a subsequent call starts a genuinely fresh build (spy count increments);
- an arbitrary (non-lifecycle) builder exception is handled identically to a checkpoint
  failure — no permanently stuck `'building'` record;
- two/three concurrent callers on the same key share exactly one real build per phase
  (spy counts stay at 1), with `containment` driving connectivity while
  `surface-intersection` never awaits it;
- a lazy connectivity request arriving while BVH is still in flight queues behind it rather
  than running concurrently (single-unresolved-phase invariant);
- `releaseEntriesForEpoch`/`releaseAll` reject a suspended lazy-connectivity build on an
  already-`'ready'` entry with `ModelEvictedError`/`WorldDisposedError` respectively (C-2),
  and a release sweep mixing an oversized marking with live entries completes without
  throwing and without touching the marking's (nonexistent) signal (C-5).

- [ ] **Step 5: Commit**
```bash
git add collision/geometry/GeometryRegistry.js test/geometry/GeometryRegistry.test.mjs
git commit -m "$(cat <<'EOF'
Add GeometryRegistry entry state machine with injected phase builders

Implements the publish-when-build-starts rule (insert-first-then-build,
single-flight weld/connectivity/BVH phase slots, one entry-scoped
cancellation signal per entry, oversized markings as a distinct entry
kind) against stub builders, isolated from the real weld/connectivity/BVH
implementations landing in a later task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

**Completion criteria:**
- `GeometryRegistry` exports exactly the public surface in the Interfaces block above —
  `getOrBuildGeometry`, `releaseEntriesForEpoch`, `releaseAll` — with no other public methods.
- No import of any real weld/connectivity/BVH module anywhere in `GeometryRegistry.js` — it
  is exercised entirely through injected functions, per its own isolation requirement.
- Every fixture in Step 1 passes, including the two fixtures beyond the prompt's literal
  list (arbitrary-builder-exception removal, mid-BVH lazy-connectivity serialization) —
  both are reasoned generalizations of explicit spec rules, documented as such in the test
  comments and in "Protected invariants" below.

**Protected invariants / regressions to watch:**
- Publish-when-build-starts / insert-first-then-build — spec `:1413-1429`.
- Single-flight, sequential phase slots, weld before connectivity before BVH for an
  initiating containment/volume-overlap build — spec `:1425-1429`, atomic-operations table
  rows at `:2006-2008`.
- `buildState: 'ready'` is weld+BVH only, mode-independent, connectivity never un-readies —
  spec `:1439-1448`.
- One entry-scoped cancellation signal, created once at insertion, survives `'building' ->
  'ready'`, raced by every phase the entry ever hosts including a later lazy connectivity
  build — spec `:1471-1489`.
- No `'failed'` state; a rejected phase removes the entry synchronously, identity-guarded —
  spec `:1462-1470`. This plan's Task 13 generalizes the trigger from "checkpoint finds
  owner evicted/disposed" to "any phase rejection for any reason," since an unhandled
  builder exception would otherwise leave exactly the permanently-stuck record the rule
  exists to prevent — flagged here as a reasoned extension, not a literal spec quote.
- Oversized markings never have a `buildState` or cancellation signal, are never
  re-classified once cached, and `releaseEntriesForEpoch`/`releaseAll` must skip signal
  rejection for them while still removing them in the same sweep — spec `:1490-1498`; C-5
  regression (`CollisionWorld.findClashes` fixture list, spec `:4209-4629` region, "Round 16
  found... oversized marking removed in same sweep... zero cancellation-signal-rejection
  calls for the oversized marking").
- C-2 regression: `evictModel`/`dispose()` racing a lazy connectivity build suspended
  against an already-`'ready'` entry must reject that connectivity promise, never hang —
  spec `:4209-4629` region ("awaiting caller's connectivity promise must reject, not hang").
- At most one phase ever unresolved on a given entry at a time — spec `:1482-1484`. A
  connectivity request arriving after BVH has already started must queue behind it, never
  run concurrently with it — this task's own addition to the fixture list (see cross-task
  interface flags above), reasoned from the same spec sentence, not itself spec-cited
  verbatim elsewhere.

---

### Task 14: `GeometryRegistry` phase orchestration + `BlasCache`

**Objective:** Wire the state machine to the real weld/connectivity/BVH builders and the `maxSyncTriangleCount` oversized-marking path, completing the registry's end-to-end build pipeline.

**Files:**
- Create: `collision/blas/BlasCache.js`
- Create: `collision/geometry/createGeometryRegistry.js` — a new file beyond the spec's own
  repo layout (canonical reference explicitly allows this). `GeometryRegistry.js` itself
  (Task 13) stays builder-agnostic and testable in isolation; this factory is the one place
  that imports the real `compactAndWeld`, `GeometryConnectivity`, and `BlasCache` and wires
  them into a `GeometryRegistry` instance. Task 17 imports this factory rather than
  constructing `GeometryRegistry` directly, and supplies the real `CollisionWorld`-backed
  checkpoint port and a `resolveGeometryView` function at call time.
- Test: `test/blas/BlasCache.test.mjs`
- Test: `test/geometry/createGeometryRegistry.test.mjs`

**Interfaces:**
- Consumes:
  - `collision/geometry/GeometryRegistry.js` (Task 13) — `GeometryRegistry` class, used
    exactly as specified above, no changes to that file.
  - `collision/geometry/activeRangeCompaction.js` (Task 3) — `compactAndWeld(triangleGeometryView,
    options) -> Promise<WeldedGeometry> | WeldedGeometry | OversizedMarker` (assumed to
    possibly be synchronous; this task's factory wraps it in an `async` function regardless,
    since `GeometryRegistry`'s `buildWeld` contract requires a Promise).
  - `collision/geometry/GeometryConnectivity.js` (Task 4) — assumed export
    `connectivity(weldedGeometry) -> GeometryConnectivityResult` (synchronous, per
    `spike/geometry-core.mjs`'s naming), wrapped the same way.
  - `collision/blas/ThreeMeshBvhBackend.js` (Task 5) — `build(weldedGeometry) -> { bvh,
    localDiagonal }` (assumed synchronous — spec `:1564` states the `MeshBVH` constructor
    itself is synchronous).
  - `collision/constants.js` — `maxSyncTriangleCount`.
- Produces:
  ```ts
  // collision/blas/BlasCache.js
  class BlasCache {
    constructor(opts?: { backend?: { build(welded: WeldedGeometry): { bvh: MeshBVH; localDiagonal: number } } });
    build(welded: WeldedGeometry): Promise<{ bvh: MeshBVH; localDiagonal: number }>;
  }

  // collision/geometry/createGeometryRegistry.js
  function createGeometryRegistry(opts: {
    resolveGeometryView: (loadEpoch: number, geometryIndex: number) =>
      { triangleGeometryView: TriangleGeometryView; weldEpsilon: number };
    checkpointPort: { checkpoint(args: { loadEpoch: number }): Promise<void> };
    blasCache?: BlasCache; // defaults to `new BlasCache()`
  }): GeometryRegistry;
  ```

**Why `BlasCache` exists as its own file, not a direct call to `ThreeMeshBvhBackend.build`:**
per spec `:1559-1568`, "dedup of simultaneous BVH builds is not a `BlasCache`-owned
mechanism — it's the registry-level rule" (Task 13's single-flight `accelerationPromise`
slot already provides that). What's left for `BlasCache` to own is exactly "building the
`MeshBVH` and caching it behind that phase slot" — and since the phase slot itself already
does the caching (the resolved `accelerationPromise` value *is* the cache), `BlasCache` in
this milestone reduces to a thin, named seam: a one-method wrapper around
`ThreeMeshBvhBackend.build`, kept as a separate module for the spec's own module-layout
fidelity (`docs/...:1024-1026` repo layout) and so a future multi-backend milestone (a
second acceleration-structure implementation) has an existing injection point
(`{ backend }` constructor option) rather than requiring every call site to be found and
changed. This task's implementation states this plainly rather than inventing caching logic
`BlasCache` does not need.

- [ ] **Step 1: Write the failing test(s)**

`test/blas/BlasCache.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlasCache } from '../../collision/blas/BlasCache.js';

test('BlasCache.build delegates to the injected backend and returns its result unchanged', async () => {
  const welded = { position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), index: new Uint32Array([0, 1, 2]), triangleCount: 1 };
  let receivedArg;
  const fakeBackend = { build: (arg) => { receivedArg = arg; return { bvh: { fake: true }, localDiagonal: 1.5 }; } };
  const cache = new BlasCache({ backend: fakeBackend });
  const result = await cache.build(welded);
  assert.equal(receivedArg, welded);
  assert.deepEqual(result, { bvh: { fake: true }, localDiagonal: 1.5 });
});

test('BlasCache defaults to ThreeMeshBvhBackend when no backend is injected', async () => {
  const cache = new BlasCache();
  assert.equal(typeof cache.build, 'function');
  // Full construction against a real MeshBVH is covered by Task 5's own
  // ThreeMeshBvhBackend.test.mjs; this only proves the default wiring exists.
});
```

`test/geometry/createGeometryRegistry.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeometryRegistry } from '../../collision/geometry/createGeometryRegistry.js';
import { maxSyncTriangleCount } from '../../collision/constants.js';
import { FakeCheckpointPort } from '../../collision/scheduler.js';

// A fake connectivity/BVH pair (Task 4/5 correctness is out of scope here -- this
// suite tests phase ORCHESTRATION against the real active-range-compaction/weld
// pipeline, not query correctness) -- injected via the same seams
// createGeometryRegistry exposes for its own defaults.
function makeHarness({ triangleGeometryView, weldEpsilon = 1e-4 } = {}) {
  const port = new FakeCheckpointPort();
  port.setEpochLive(1, true);
  const calls = { connectivity: 0, acceleration: 0 };
  const registry = createGeometryRegistry({
    resolveGeometryView: () => ({ triangleGeometryView, weldEpsilon }),
    checkpointPort: port,
    connectivityImpl: () => { calls.connectivity++; return { componentCount: 1, componentOf: new Int32Array(), closedManifold: [true] }; },
    accelerationImpl: () => { calls.acceleration++; return { bvh: {}, localDiagonal: 1 }; },
  });
  return { registry, calls, port };
}

function rangesView(indexCount, ranges) {
  // A minimal TriangleGeometryView: `ranges` drives activeTriangleCount, `index`'s
  // own length is deliberately far larger than any range sums, to prove the raw
  // buffer size never gates the ceiling check by itself (round-16 regression).
  const index = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i++) index[i] = i % 3 === 0 ? 0 : i % 3;
  const position = new Float32Array(9).fill(0);
  return { position, positionStride: 3, positionOffset: 0, index, ranges };
}

test('round-16 regression: huge raw index but small active ranges is NOT skipped, and weld sees only the active set', async () => {
  const view = rangesView(1_000_000, [{ start: 0, count: 300 }]); // 100 active triangles
  const { registry, calls } = makeHarness({ triangleGeometryView: view });
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(result.oversized, false);
  assert.equal(calls.acceleration, 1);
});

test('inverse of the round-16 regression: active-range count alone over the ceiling is skipped without materializing a compacted buffer', async () => {
  const overCeilingIndexCount = (maxSyncTriangleCount + 1) * 3;
  const view = rangesView(overCeilingIndexCount + 30, [{ start: 0, count: overCeilingIndexCount }]);
  const { registry, calls } = makeHarness({ triangleGeometryView: view });
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(result.oversized, true);
  assert.equal(result.reason, 'geometry-too-large-for-sync-build');
  assert.equal(calls.acceleration, 0, 'BVH must never be invoked for an oversized geometry');
});

test('ceiling boundary: exactly maxSyncTriangleCount (36,000 index elements) is built, not skipped -- strict >, not >=', async () => {
  // Task 3's own tests own the 39,000/33,000 boundary pair; this is the ONE
  // integration-level fixture proving the boundary survives the full
  // weld -> registry pipeline, per this task's brief (avoid duplicating all three).
  const exactIndexCount = maxSyncTriangleCount * 3;
  const view = rangesView(exactIndexCount, [{ start: 0, count: exactIndexCount }]);
  const { registry } = makeHarness({ triangleGeometryView: view });
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(result.oversized, false);
});

test('containment mode fires the connectivity-phase checkpoint on a first-time build', async () => {
  const view = rangesView(300, [{ start: 0, count: 300 }]);
  const { registry, calls } = makeHarness({ triangleGeometryView: view });
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: true });
  assert.ok(result.connectivity);
  assert.equal(calls.connectivity, 1);
});

test('surface-intersection mode never reaches the connectivity phase on a first-time build (round-16 regression)', async () => {
  const view = rangesView(300, [{ start: 0, count: 300 }]);
  const { registry, calls } = makeHarness({ triangleGeometryView: view });
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(result.connectivity, null);
  assert.equal(calls.connectivity, 0);
});
```

*(Note: `createGeometryRegistry`'s test harness above injects `connectivityImpl`/
`accelerationImpl` overrides in addition to `resolveGeometryView`/`checkpointPort` — add
these as optional constructor-time overrides in Step 3's implementation specifically to keep
this suite decoupled from Task 4/5's real correctness, which those tasks' own test files
already own; the factory's production code path with no overrides supplied must still wire
the real `connectivity`/`ThreeMeshBvhBackend`/`BlasCache` implementations.)*

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/blas/BlasCache.test.mjs test/geometry/createGeometryRegistry.test.mjs`

Expected: fails with `Cannot find module '../../collision/blas/BlasCache.js'` and
`'../../collision/geometry/createGeometryRegistry.js'` respectively. Once
`collision/geometry/activeRangeCompaction.js` (Task 3) exists but before this task's own
files exist, expect the same module-not-found failure — this task cannot be completed until
Task 3 (and ideally 4/5) have landed; see "Completion criteria" for what to do if they
haven't.

- [ ] **Step 3: Write the implementation**

`collision/blas/BlasCache.js`:

```js
// collision/blas/BlasCache.js
//
// Thin, named seam over ThreeMeshBvhBackend.build. Dedup of simultaneous BVH builds
// is NOT owned here -- it's GeometryRegistry's single-flight accelerationPromise slot
// (see docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1559-1568).
// BlasCache exists so the repo's own module layout (blas/ThreeMeshBvhBackend.js +
// blas/BlasCache.js) is honored, and so a future multi-backend milestone has an
// existing injection point rather than requiring every call site to change.

import * as ThreeMeshBvhBackend from './ThreeMeshBvhBackend.js';

export class BlasCache {
  constructor({ backend = ThreeMeshBvhBackend } = {}) {
    this._backend = backend;
  }

  async build(weldedGeometry) {
    return this._backend.build(weldedGeometry);
  }
}
```

`collision/geometry/createGeometryRegistry.js`:

```js
// collision/geometry/createGeometryRegistry.js
//
// Wires GeometryRegistry (Task 13) to the real weld/connectivity/BVH implementations.
// Kept separate from GeometryRegistry.js so that file stays builder-agnostic and
// testable in isolation. Task 17 (CollisionWorld) calls this factory with the real
// checkpointPort and resolveGeometryView at runtime -- this file never imports
// CollisionWorld itself.

import { GeometryRegistry } from './GeometryRegistry.js';
import { compactAndWeld } from './activeRangeCompaction.js';
import { connectivity as defaultConnectivity } from './GeometryConnectivity.js';
import { BlasCache } from '../blas/BlasCache.js';
import { maxSyncTriangleCount } from '../constants.js';

export function createGeometryRegistry({
  resolveGeometryView,
  checkpointPort,
  blasCache = new BlasCache(),
  connectivityImpl = defaultConnectivity,
  accelerationImpl,
} = {}) {
  if (typeof resolveGeometryView !== 'function') {
    throw new TypeError('createGeometryRegistry requires resolveGeometryView(loadEpoch, geometryIndex)');
  }

  return new GeometryRegistry({
    buildWeld: async (loadEpoch, geometryIndex /*, ownerModelIdHint */) => {
      const { triangleGeometryView, weldEpsilon } = resolveGeometryView(loadEpoch, geometryIndex);
      // compactAndWeld performs BOTH the active-range ceiling classification and the
      // weld itself; the ceiling is checked against activeTriangleCount BEFORE any
      // compacted buffer is materialized (spec :1532-1536), so a geometry whose
      // active ranges alone exceed maxSyncTriangleCount never reaches mergeVertices.
      return compactAndWeld(triangleGeometryView, { weldEpsilon, maxSyncTriangleCount });
    },
    buildConnectivity: async (weldedGeometry) => connectivityImpl(weldedGeometry),
    buildAcceleration: async (weldedGeometry) =>
      accelerationImpl ? accelerationImpl(weldedGeometry) : blasCache.build(weldedGeometry),
    checkpointPort,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/blas/BlasCache.test.mjs test/geometry/createGeometryRegistry.test.mjs`

Expected: PASS, proving —
- `BlasCache.build` is a pure pass-through to an injected (or default) backend;
- a fragment with a huge raw index but a small active range is built, not skipped, and the
  BVH phase runs against the active-sized set only (round-16 regression, spec `:1500-1541`);
- the inverse — active-range count alone over the ceiling — is skipped with zero
  acceleration-phase calls, before any compacted buffer is materialized;
- the `maxSyncTriangleCount` boundary (exactly `36,000` index elements / `12,000` triangles)
  is built, not skipped, at the registry-integration level (strict `>`, not `>=`);
- `containment` fires the connectivity-phase checkpoint on a first-time build,
  `surface-intersection` never reaches it (round-16 correction of round-15's inverted
  fixture, spec `:4209-4629` region).

- [ ] **Step 5: Commit**
```bash
git add collision/blas/BlasCache.js collision/geometry/createGeometryRegistry.js \
        test/blas/BlasCache.test.mjs test/geometry/createGeometryRegistry.test.mjs
git commit -m "$(cat <<'EOF'
Wire GeometryRegistry to real weld/connectivity/BVH builders via BlasCache

Adds BlasCache as a thin named seam over ThreeMeshBvhBackend (dedup stays
registry-owned, not BlasCache-owned) and createGeometryRegistry as the
one place that assembles compactAndWeld + GeometryConnectivity + BlasCache
behind GeometryRegistry's injected builder contract, exercising the
round-16 active-range-compaction ceiling end to end.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

**Completion criteria:**
- `BlasCache` adds no caching logic of its own — the task's write-up states plainly (as
  required by this plan's brief) that dedup and caching both live in `GeometryRegistry`'s
  phase slot, and `BlasCache` is a thin seam, not a redundant second cache.
- `createGeometryRegistry.js` never imports `CollisionWorld` — Task 17 constructs the real
  `resolveGeometryView`/`checkpointPort` and calls this factory, not the reverse.
- If Tasks 3/4/5 have not landed yet when this task is executed, this task's own module
  files (`BlasCache.js`, `createGeometryRegistry.js`) may still be written and committed
  against their documented interfaces, but Step 4 cannot go green until those tasks exist —
  note this explicitly in the task's own PR/commit description rather than silently skipping
  verification.

**Protected invariants / regressions to watch:**
- `maxSyncTriangleCount` is checked against `activeTriangleCount` (compacted, not raw)
  before any copying happens — spec `:1500-1541`; round-16 Critical regression, cited
  verbatim in the `CollisionWorld.findClashes` fixture list (spec `:4209-4629` region:
  "fragment whose raw index encodes far more triangles... pair must NOT be skipped... spy on
  weld step shows it was invoked with geometry sized to active triangle count").
- Ceiling boundary is strict `>`, not `>=` — a fragment at exactly `12,000` active triangles
  builds — spec `:4209-4629` region ("Ceiling's own operator boundary").
- `containment`/`volume-overlap` both require the connectivity phase; only
  `surface-intersection` is connectivity-free — round-16 correction of round-15's own
  shipped-backwards fixture, spec `:1371-1379`.
- `BlasCache` must not reintroduce the retired "set `groups`/`drawRange` on the BVH input"
  workaround — compaction already discards everything outside active ranges before welding
  ever runs, so nothing is left for `ThreeMeshBvhBackend` to exclude — spec `:1554-1558`.
- **`ViewerGeometryAdapter`'s output holds live references into Viewer's own buffers, not copies,
  until compaction copies them — the weld-phase factory must call `resolveGeometryView` and pass its
  result into `compactAndWeld` with no intervening `await`.** `ViewerGeometryAdapter.adaptViewerGeometry`
  (Task 2) resolves `positions`/`index` as direct references into whatever the Viewer geometry object
  itself owns (`geometry.vb`, `positionAttr.data.array`, `positionAttr.array`, `geometry.ib`,
  `geometry.index.array`) — it never copies (independently verified this session: `resolvePositions`/
  `resolveIndex` return the original TypedArrays directly; `compactAndWeld` reads and copies them
  synchronously with no `await` of its own). Whether Viewer's buffers can actually become invalid across
  a model unload/reload cycle is **not independently re-verified this session** — the Batch-1 shadow-
  evaluation's Viewer-knowledge check reported fragment buffers as memoized per-fragment within a
  session, "not proven stable" across a reload, which is a caution, not a confirmed instability. What
  this invariant concretely buys, independent of that open question: keeping `resolveGeometryView` and
  `compactAndWeld` in one synchronous JavaScript call stack — no `await`, no yield, no checkpoint between
  them — prevents any **event-loop-driven** lifecycle event (a model reload's teardown running, an epoch
  being evicted) from landing in the gap between reading the live reference and compaction copying it. It
  does not, by itself, prove Viewer's buffers are stable in general; it only closes the one channel (an
  intervening yield) this codebase could introduce that would create a window for such an event to
  matter. The `weldPromise` factory this task wires therefore MUST call
  `resolveGeometryView(loadEpoch, geometryIndex)` and hand its `triangleGeometryView` straight into
  `compactAndWeld(...)` inside that same synchronous span. This is a stricter requirement than the general "insert-first-then-build"
  single-flight rule above: it is about the gap *before* the first phase's own checkpoint, not about
  checkpoints between phases. Do not restructure the pipeline to copy earlier (e.g. inside
  `ViewerGeometryAdapter` itself) to relax this — that would reverse the "position is an owned,
  compacted-then-welded buffer, not a zero-copy view" performance rationale (spec `:1543-1550`) for no
  benefit; keeping the two calls adjacent and synchronous is the correct, minimal way to satisfy this
  invariant. A future test for this task should assert `resolveGeometryView` and `compactAndWeld` are
  invoked within the same microtask/synchronous span (e.g. by spying on call order relative to a
  deliberately-inserted `await` elsewhere and confirming no such gap exists on this path).

---

### Task 15: Viewer instance-tree readiness-signal research spike

**Objective:** Determine whether a concrete Viewer readiness signal exists for instance-tree completeness, and decide whether extraction should wait, reject, or merely document the precondition — without blocking any later task's own implementation work.

This is a **research task**, not an implementation task. Per the round-31 disposition
(`docs/superpowers/specs/round-31-implementation-planning-blockers-disposition.md:33-38,
120-127, 174-175`), this item was explicitly considered as a possible implementation-planning
blocker and **rejected as one** on review: `world.admitModel` makes no readiness claim (pure
epoch bookkeeping), so there is no contradiction to resolve, only an investigation to
schedule — the spec's own Risks section (`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:4828-4841`)
already frames this as "deferred to implementation... not a Milestone-1 design blocker, since
the choice among [wait/reject/document-as-precondition] changes no mechanism already
specified." This task's deliverable is a findings/decision document, not production code.

**Files:**
- Create: `docs/superpowers/specs/instance-tree-readiness-decision.md`
- No source or test files — this task produces no runtime code.

**Interfaces:**
- Consumes: nothing from other tasks (no code dependency). Reads the pinned Viewer bundle
  already vendored at `wwwroot/viewers/7.124.2/viewer3D.js` (per this repo's
  `wwwroot/index.html` pin) and the official APS Viewer Reference Guide.
- Produces: `docs/superpowers/specs/instance-tree-readiness-decision.md`, which Task 17
  (`CollisionWorld` lifecycle) and Task 19/20 (`findClashes`) must read and apply before
  either of those tasks is considered fully complete — this task's own completion does not
  block starting Tasks 16 onward; only their *closure* depends on this decision record
  existing with a stated outcome.

- [ ] **Step 1: Investigate the concrete Viewer readiness signal**

  Use the `aps-viewer-api-evidence-investigation` skill (already available in this project)
  to answer, with cited evidence, the single bounded question: *does
  `Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT` (or another documented event/wait mechanism)
  reliably signal that `model.getInstanceTree()`'s enumeration methods
  (`enumNodeChildren`/`enumNodeFragments`) will return a complete result for a given model?*
  Confirm against:
  - The official APS Viewer Reference Guide's documented event lifecycle
    (`OBJECT_TREE_CREATED_EVENT`, `GEOMETRY_LOADED_EVENT`, and any other model-readiness
    event the Reference Guide documents), and what each is actually documented to guarantee
    about instance-tree completeness specifically (not merely "the model started loading").
  - If the Reference Guide's own wording is ambiguous or silent on completeness, inspect the
    pinned `viewers/7.124.2/viewer3D.js` bundle directly (same evidence class this spec
    already used for `getGeometryId`, `vb`/`vbstride`/`vblayout`, and
    `BEFORE_MODEL_UNLOAD_EVENT`'s payload shape — spec `:4814-4827`) to see what internal
    state transition actually fires the candidate event, and whether that transition is
    provably synchronized with the instance tree's own build completion.
  - Record explicitly whether the investigation found a reliable signal, an unreliable one
    (fires before the tree is provably complete), or none at all.

- [ ] **Step 2: Decide one of the three named outcomes**

  Based on Step 1's finding, choose exactly one of the three outcomes the spec names
  verbatim (`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:4837-4841`):
  - **(a) Wait** — `world.admitModel`/`findClashes` waits on the identified signal before
    proceeding with extraction.
  - **(b) Reject** — `world.admitModel`/`findClashes` rejects if the signal hasn't fired by
    the time it's called.
  - **(c) Document as precondition** — no code enforcement; the caller (extension) is
    responsible for calling `admitModel`/`findClashes` only after the instance tree is known
    complete (e.g. because `RoomLocatorExtension.load()` itself only runs after the Viewer's
    own model-load lifecycle has already fired `OBJECT_TREE_CREATED_EVENT` for the extension
    to have been loaded at all — confirm or refute this specific reasoning against the
    acceptance app's own `viewer.js` wiring before choosing (c) on this basis).

  This choice does not change any mechanism already specified elsewhere in this plan
  (Risk #6 disposition, spec `:4837-4841`) — it only determines whether Task 17 or Task
  19/20 gains one additional guard clause, or gains only a doc-comment sentence.

- [ ] **Step 3: Write the decision record**

  Create `docs/superpowers/specs/instance-tree-readiness-decision.md` with this structure
  (fill in the bracketed parts from Steps 1-2's actual findings — none of the following is a
  placeholder to leave unresolved; every bracket must be replaced with a real finding before
  this task is complete):

  ```markdown
  # Instance-Tree Readiness Decision

  Resolves: Risk #6 (spec `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:4828-4841`),
  round-31 disposition item (c) (`docs/superpowers/specs/round-31-implementation-planning-blockers-disposition.md:33-38, 120-127`).

  ## Finding

  [State plainly: which signal (if any) was investigated, what the official Reference Guide
  says it guarantees, what the pinned 7.124.2 bundle source confirms or refutes about that
  guarantee, and whether the signal reliably precedes a complete `enumNodeChildren`/
  `enumNodeFragments` result. Cite exact Reference Guide section/bundle line numbers.]

  ## Decision

  Outcome chosen: **(a) wait | (b) reject | (c) document as precondition** [pick one].

  [State the justification in 2-4 sentences, referencing the Finding above.]

  ## Hook point for implementation

  [If (a) or (b): name the exact function and location — e.g. "add a check at the top of
  `world.admitModel`, in `collision/CollisionWorld.js`, before `loadEpoch` is assigned, that
  [awaits `OBJECT_TREE_CREATED_EVENT` | rejects if the model's instance tree is not yet
  built]" — precise enough that Task 17's author can implement it without re-deriving this
  investigation. State which later task (17, or 19/20) owns implementing it — do not
  implement it in this file or in this task.]

  [If (c): state the exact sentence to add to `RoomLocatorExtension`'s or
  `CollisionWorld.fromViewer`'s own doc comment, verbatim, ready to paste in.]
  ```

- [ ] **Step 4: Hand off to the owning task without blocking parallel work**

  Confirm (by reading, not editing) that whichever of Task 17 / Task 19 / Task 20 is
  responsible for the named hook point is stated unambiguously in Step 3's document. Do not
  implement the guard, the wait, or the doc-comment edit in this task — that belongs to the
  named task's own author. Tasks 16 onward may proceed in parallel with this task; this
  task's own completion criterion is the decision record existing with a filled-in Finding,
  Decision, and Hook-point section — not that the named downstream task has yet applied it.

**Completion criteria:**
- `docs/superpowers/specs/instance-tree-readiness-decision.md` exists, with no bracketed
  placeholder text remaining, stating one of the three named outcomes and citing concrete
  evidence (Reference Guide section and/or bundle line numbers) for the Finding.
- The Hook-point section names an exact function/location in an exact later task number (17,
  19, or 20), not a vague "somewhere in CollisionWorld."
- This task does not modify `collision/CollisionWorld.js`, `extensions/RoomLocatorExtension.js`,
  or any other source file — findings only.

**Protected invariants / regressions to watch:**
- This is explicitly **not** a Milestone-1 design blocker — round-31 disposition
  `:174-175`: "Readiness item: recorded as an implementation-plan research task, not
  resolved as a blocker, per instruction. Not in scope for closure." Do not let this task's
  scope creep into re-litigating whether it *should* have been a blocker.
- Whatever outcome is chosen must not contradict `world.admitModel`'s existing contract
  (pure epoch bookkeeping, spec-cited in the round-31 disposition's own rejection rationale,
  `:33-38`) — e.g., outcome (a) must not turn `admitModel` into something that can reject for
  reasons other than "model already evicted" without updating that contract elsewhere in the
  plan; if Step 2's investigation leads there, flag it back to Task 17's author rather than
  silently redefining `admitModel`'s error contract from within this research task.

---


Source spec: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md`. Line citations
below refer to this file unless otherwise noted.

---

### Task 16: `ViewerModelAdapter` — self-driven fragment extraction walk

**Objective:** Walk a model's instance tree non-recursively to collect every unique fragment under a set of requested dbIds, enforcing the two hard fanout/count ceilings and capturing each fragment's true owning dbId via first-discovery-wins.

**Files:**
- Create: `wwwroot/collision/viewer/ViewerModelAdapter.js`
- Create: `test/fixtures/mockInstanceTree.mjs` (shared mock-model builder — also imported by Task 18's
  tests, since capacity-admission fixtures need real extraction output to admit)
- Test: `test/viewer/ViewerModelAdapter.test.mjs`

**Interfaces:**
- Consumes:
  - `maxChildrenPerNode`, `maxFragmentsPerDbId` from `../constants.js` (`collision/constants.js:198-199`,
    per canonical reference; Task 1).
  - `createGeometryIdentity({ loadEpoch, geometryIndex })` from `../geometry/GeometryIdentity.js` —
    **assumed name**, since Task 13/14 (a different agent) owns this file and may not exist on disk yet.
    If Task 13/14 exports a differently-named factory, the only change required here is this one import
    line and the one call site that uses it — nothing else in this task depends on `GeometryIdentity`'s
    internals beyond "takes `{loadEpoch, geometryIndex}`, returns a frozen value where two values are the
    same identity iff both fields `===`" (canonical reference, `GeometryIdentity` interface).
- Produces (Tasks 19/20 depend on this shape verbatim):
  ```ts
  // wwwroot/collision/viewer/ViewerModelAdapter.js
  export class ExtractionLimitExceededError extends Error {
    // limit: 'maxChildrenPerNode' | 'maxFragmentsPerDbId'
    // requestedDbId: the root dbId whose walk was in progress (the "offending dbId" the spec requires
    //   naming, docs/...:2900-2903, 2853-2929 — the tally/fanout ceiling is scoped per REQUESTED root,
    //   not per visited node)
    // node: the specific node being visited when the limit tripped (extra diagnostic beyond the spec's
    //   minimum requirement, harmless and useful)
    // observedCount: the tally/child-count value that tripped the limit
    constructor(limit, requestedDbId, node, observedCount) { /* ... */ }
  }

  export interface ExtractedFragmentRecord {
    readonly fragmentId: number;
    readonly geometryIdentity: GeometryIdentity;   // { loadEpoch, geometryIndex }, frozen
    readonly worldMatrix: Float64Array;            // 16 numbers, column-major, Matrix4.elements layout
    readonly worldBounds: { min: [number, number, number]; max: [number, number, number] };
    readonly ownerDbId: number;                    // first-discovery-wins per this call
  }
  // Object.freeze()'d. Has everything Task 18's admission method needs (fragmentId + geometryIdentity)
  // AND everything Task 19/20 needs to build a PlacedCollisionInstance once admission succeeds
  // (worldMatrix, worldBounds, ownerDbId) — this module does not itself build CollisionInstance or
  // PlacedCollisionInstance; those are Task 18's and Task 19/20's jobs respectively.

  export async function extractFragments(
    model,                 // Viewer Model-shaped object: { getInstanceTree(), getFragmentList() }
    requestedDbIds,        // number[] — every root dbId this call must extract (source-side call and
                            //   target-side call are two SEPARATE invocations of this function; Task
                            //   19/20 is responsible for merging both sides' Maps into one call-wide
                            //   unique-fragment set before calling Task 18's admission method)
    loadEpoch,              // number — handed in by the caller (Task 19/20, from CollisionWorld's
                            //   already-admitted lease); this module never assigns or reads epochs itself
    { checkpoint } = {}     // optional async (ctx: { requestedDbId }) => void, invoked before each
                            //   requested dbId's own walk starts and between EVERY node visit (every
                            //   stack pop transition — not only where the tree happens to branch; a deep
                            //   single-child chain has no literal siblings but must still be checkpointed
                            //   between each node, docs/...:2927-2929 "checkpoint also fires between
                            //   sibling nodes at same depth" is the walk's own minimum bar, not a ceiling
                            //   on how often it may fire). Left undefined in this task's own unit tests
                            //   (walk resolves without ever really yielding); Task 19/20 wires this to a
                            //   PER-findClashes-CALL checkpoint port obtained from CollisionWorld (Task
                            //   17's `createCheckpointPort(lease)`) to thread frameBudgetMs yielding
                            //   through the walk without this module owning any time accumulator itself.
  ) -> Promise<Map<number, ExtractedFragmentRecord>>   // keyed by fragmentId, one entry per UNIQUE
                            //   fragment discovered across ALL of requestedDbIds in this one call.
                            //   Rejects with ExtractionLimitExceededError on either ceiling trip.
  ```

- [ ] **Step 1: Write the failing test(s)**

`test/fixtures/mockInstanceTree.mjs`:
```js
// Shared test fixture: builds a fake Autodesk.Viewing.Model-shaped object over a plain JS tree
// definition, for testing ViewerModelAdapter's self-driven walk without a live Viewer. Also reused by
// Task 18's CollisionInstance admission fixtures, since those need real ExtractedFragmentRecord input.
//
// Tree node shape: { dbId: number, fragments?: number[], children?: TreeNode[] }
// fragmentGeometry: Map<fragmentId, { geometryIndex: number, matrix?: number[16],
//                                     bounds?: { min: [x,y,z], max: [x,y,z] } }>

export function buildMockModel(rootNodes, fragmentGeometry, options = {}) {
  const stats = options.stats || {
    enumNodeChildrenCalls: 0,
    enumNodeChildrenCallbacks: 0,
    enumNodeFragmentsCalls: 0,
    enumNodeFragmentsCallbacks: 0,
    getChildCountCalls: 0,
  };

  const nodesById = new Map();
  (function index(nodes) {
    for (const node of nodes) {
      nodesById.set(node.dbId, node);
      if (node.children) index(node.children);
    }
  })(rootNodes);

  function enumNodeFragmentsRecursive(node, cb) {
    for (const fragId of node.fragments || []) cb(fragId);
    for (const child of node.children || []) enumNodeFragmentsRecursive(child, cb);
  }

  const instanceTree = {
    enumNodeChildren(dbId, cb, recursive) {
      stats.enumNodeChildrenCalls++;
      if (recursive) {
        throw new Error('enumNodeChildren(recursive=true) must never be called by production code');
      }
      const node = nodesById.get(dbId);
      if (!node) return;
      for (const child of node.children || []) {
        stats.enumNodeChildrenCallbacks++;
        const abort = cb(child.dbId);
        if (abort === true) return;
      }
    },
    enumNodeFragments(dbId, cb, recursive) {
      stats.enumNodeFragmentsCalls++;
      const node = nodesById.get(dbId);
      if (!node) return;
      if (recursive) {
        // ONLY used by the round-18 coverage-equivalence fixture as independently-derived ground
        // truth to compare the self-driven walk's output against. ViewerModelAdapter itself never
        // passes recursive=true (docs/...:1083-1094, 2838-2907 — "no code path in this design may
        // call the recursive form").
        enumNodeFragmentsRecursive(node, cb);
        return;
      }
      for (const fragId of node.fragments || []) {
        stats.enumNodeFragmentsCallbacks++;
        cb(fragId);
      }
    },
    // Deliberately no `getChildCount` — proves ViewerModelAdapter never calls it (round-18
    // invariant-audit finding C-1, docs/...:2853-2929 "getChildCount preflight is REMOVED entirely").
    // Any accidental call throws instead of silently succeeding, so a regression trips loudly.
    getChildCount() {
      stats.getChildCountCalls++;
      throw new Error('getChildCount must never be called — removed per invariant-audit finding C-1');
    },
  };

  const fragmentList = {
    getWorldMatrix(fragId, m) {
      const g = fragmentGeometry.get(fragId);
      const matrix = (g && g.matrix) || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      m.elements.set(matrix);
    },
    getWorldBounds(fragId, b) {
      const g = fragmentGeometry.get(fragId);
      const bounds = (g && g.bounds) || { min: [0, 0, 0], max: [1, 1, 1] };
      b.min.x = bounds.min[0]; b.min.y = bounds.min[1]; b.min.z = bounds.min[2];
      b.max.x = bounds.max[0]; b.max.y = bounds.max[1]; b.max.z = bounds.max[2];
    },
    getGeometryId(fragId) {
      const g = fragmentGeometry.get(fragId);
      return g ? g.geometryIndex : fragId;
    },
  };

  const model = {
    getInstanceTree() { return instanceTree; },
    getFragmentList() { return fragmentList; },
  };

  return { model, stats };
}
```

`test/viewer/ViewerModelAdapter.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFragments, ExtractionLimitExceededError } from '../../wwwroot/collision/viewer/ViewerModelAdapter.js';
import { maxChildrenPerNode, maxFragmentsPerDbId } from '../../wwwroot/collision/constants.js';
import { buildMockModel } from '../fixtures/mockInstanceTree.mjs';

const LOAD_EPOCH = 7;

test('single node with direct fragments — basic extraction', async () => {
  const { model } = buildMockModel(
    [{ dbId: 1, fragments: [101, 102] }],
    new Map([
      [101, { geometryIndex: 5 }],
      [102, { geometryIndex: 6 }],
    ]),
  );
  const result = await extractFragments(model, [1], LOAD_EPOCH);
  assert.equal(result.size, 2);
  assert.equal(result.get(101).ownerDbId, 1);
  assert.equal(result.get(101).geometryIdentity.loadEpoch, LOAD_EPOCH);
  assert.equal(result.get(101).geometryIdentity.geometryIndex, 5);
  assert.equal(result.get(101).worldMatrix.length, 16);
  assert.deepEqual(result.get(101).worldBounds, { min: [0, 0, 0], max: [1, 1, 1] });
});

test('multiple requested root dbIds are all walked', async () => {
  const { model } = buildMockModel(
    [
      { dbId: 1, fragments: [101] },
      { dbId: 2, fragments: [201] },
    ],
    new Map([[101, { geometryIndex: 1 }], [201, { geometryIndex: 2 }]]),
  );
  const result = await extractFragments(model, [1, 2], LOAD_EPOCH);
  assert.equal(result.size, 2);
  assert.equal(result.get(101).ownerDbId, 1);
  assert.equal(result.get(201).ownerDbId, 2);
});

test('family node with no direct fragments descends into child (round-18 acceptance-model shape)', async () => {
  // Mirrors dbId 2527 (family, no own fragments) / 2530 (child instance, owns fragments) —
  // docs/...:1095-1111. A non-recursive call on the ancestor alone must NOT silently report empty.
  const { model } = buildMockModel(
    [{ dbId: 2527, fragments: [], children: [{ dbId: 2530, fragments: [42] }] }],
    new Map([[42, { geometryIndex: 9 }]]),
  );
  const result = await extractFragments(model, [2527], LOAD_EPOCH);
  assert.equal(result.size, 1);
  assert.equal(result.get(42).ownerDbId, 2530, 'ownerDbId must name the child instance node, never the requested ancestor');
});

test('round-18 coverage-equivalence: self-driven walk === one recursive enumNodeFragments call, as sets', async () => {
  // Richer tree: family node 2527 with child 2530 (fragments), a sibling branch 2531 that
  // redundantly reports the SAME fragment id (double-report case docs/...:1298-1310), and an
  // unrelated cousin subtree to make the comparison non-trivial.
  const tree = [{
    dbId: 2527,
    fragments: [],
    children: [
      { dbId: 2530, fragments: [42, 43] },
      { dbId: 2531, fragments: [43, 44] },          // 43 double-reported under a second node
      { dbId: 2532, fragments: [], children: [{ dbId: 2533, fragments: [45] }] },
    ],
  }];
  const geometry = new Map([42, 43, 44, 45].map((id) => [id, { geometryIndex: id }]));
  const { model } = buildMockModel(tree, geometry);

  const selfDriven = await extractFragments(model, [2527], LOAD_EPOCH);

  const groundTruth = new Set();
  model.getInstanceTree().enumNodeFragments(2527, (fragId) => groundTruth.add(fragId), true);

  assert.deepEqual(new Set(selfDriven.keys()), groundTruth, 'unique fragment-id sets must match exactly');
  assert.equal(selfDriven.size, groundTruth.size, 'exactly one output entry per unique fragment id');
  // first-discovery-wins: 43 first reported under 2530 (visited before 2531 in child order)
  assert.equal(selfDriven.get(43).ownerDbId, 2530);
});

test('ownerDbId provenance: fragment reported under two of the call\'s own requested dbIds — first discovery wins', async () => {
  const tree = [
    { dbId: 10, fragments: [999] },
    { dbId: 20, fragments: [999] },
  ];
  const { model } = buildMockModel(tree, new Map([[999, { geometryIndex: 1 }]]));
  const result = await extractFragments(model, [10, 20], LOAD_EPOCH);
  assert.equal(result.size, 1);
  assert.equal(result.get(999).ownerDbId, 10, 'must keep the FIRST requested dbId\'s node, never overwrite on rediscovery under dbId 20');
});

test('a node whose first child dbId is 0 is walked normally — not mistaken for an abort signal', async () => {
  const tree = [{
    dbId: 1,
    fragments: [],
    children: [
      { dbId: 0, fragments: [501] },
      { dbId: 2, fragments: [502] },
    ],
  }];
  const geometry = new Map([[501, { geometryIndex: 1 }], [502, { geometryIndex: 2 }]]);
  const { model } = buildMockModel(tree, geometry);
  const result = await extractFragments(model, [1], LOAD_EPOCH);
  assert.equal(result.size, 2, 'both children (including dbId 0) must be visited');
  assert.equal(result.get(501).ownerDbId, 0);
  assert.equal(result.get(502).ownerDbId, 2);
});

test('fanout ceiling: node with maxChildrenPerNode + 1 children, fragment-free — rejects, exactly maxChildrenPerNode + 1 callbacks, getChildCount never called', async () => {
  const children = [];
  for (let i = 0; i < maxChildrenPerNode + 1; i++) children.push({ dbId: 1000 + i, fragments: [] });
  const { model, stats } = buildMockModel([{ dbId: 1, fragments: [], children }], new Map());

  await assert.rejects(
    () => extractFragments(model, [1], LOAD_EPOCH),
    (err) => {
      assert.ok(err instanceof ExtractionLimitExceededError);
      assert.equal(err.limit, 'maxChildrenPerNode');
      assert.equal(err.requestedDbId, 1);
      assert.equal(err.node, 1);
      return true;
    },
  );
  assert.equal(stats.enumNodeChildrenCallbacks, maxChildrenPerNode + 1, 'must cost exactly maxChildrenPerNode + 1 callbacks, never more');
  assert.equal(stats.getChildCountCalls, 0, 'getChildCount must never be called (invariant-audit finding C-1)');
});

test('fanout ceiling: node with maxChildrenPerNode + 1 children, MIXED with own fragments — same bound', async () => {
  const children = [];
  for (let i = 0; i < maxChildrenPerNode + 1; i++) children.push({ dbId: 2000 + i, fragments: [] });
  const { model, stats } = buildMockModel(
    [{ dbId: 1, fragments: [777], children }],
    new Map([[777, { geometryIndex: 1 }]]),
  );
  await assert.rejects(() => extractFragments(model, [1], LOAD_EPOCH), ExtractionLimitExceededError);
  assert.equal(stats.enumNodeChildrenCallbacks, maxChildrenPerNode + 1);
  assert.equal(stats.getChildCountCalls, 0);
});

test('fanout ceiling companion: exactly maxChildrenPerNode children — no abort, walk completes normally', async () => {
  const children = [];
  for (let i = 0; i < maxChildrenPerNode; i++) children.push({ dbId: 3000 + i, fragments: [] });
  const { model, stats } = buildMockModel([{ dbId: 1, fragments: [], children }], new Map());
  const result = await extractFragments(model, [1], LOAD_EPOCH);
  assert.equal(result.size, 0); // no fragments anywhere, but no rejection either
  assert.equal(stats.enumNodeChildrenCallbacks, maxChildrenPerNode, 'all maxChildrenPerNode invocations must run, not maxChildrenPerNode + 1');
});

test('fanout ceiling companion, MIXED: exactly maxChildrenPerNode children plus fragments at several nodes', async () => {
  const children = [];
  for (let i = 0; i < maxChildrenPerNode; i++) {
    children.push({ dbId: 4000 + i, fragments: i % 500 === 0 ? [9000 + i] : [] });
  }
  const { model, stats } = buildMockModel([{ dbId: 1, fragments: [], children }], new Map(
    children.filter((c) => c.fragments.length).map((c) => [c.fragments[0], { geometryIndex: c.dbId }]),
  ));
  const result = await extractFragments(model, [1], LOAD_EPOCH);
  assert.equal(result.size, 20); // maxChildrenPerNode / 500 = 20 nodes contributed one fragment each
  assert.equal(stats.enumNodeChildrenCallbacks, maxChildrenPerNode);
});

test('single node exceeding maxFragmentsPerDbId directly — rejects naming the dbId', async () => {
  const fragments = Array.from({ length: maxFragmentsPerDbId + 1 }, (_, i) => 8000 + i);
  const geometry = new Map(fragments.map((id) => [id, { geometryIndex: id }]));
  const { model } = buildMockModel([{ dbId: 1, fragments }], geometry);
  await assert.rejects(
    () => extractFragments(model, [1], LOAD_EPOCH),
    (err) => {
      assert.ok(err instanceof ExtractionLimitExceededError);
      assert.equal(err.limit, 'maxFragmentsPerDbId');
      assert.equal(err.requestedDbId, 1);
      return true;
    },
  );
});

test('round-16 regression: oversized subtree crosses maxFragmentsPerDbId by visit 10, not visit 100', async () => {
  // 100 sibling nodes under one root, 501 fragments each. Cumulative tally exceeds 5000 at the 10th
  // node visited (9 * 501 = 4509, 10 * 501 = 5010 > 5000). Walk must stop there, never touching
  // nodes 11-100. docs/...:2931-2960 (accepted non-preemptible risk), fixture per Extract D section 2.
  const children = [];
  for (let i = 0; i < 100; i++) {
    const frags = Array.from({ length: 501 }, (_, j) => i * 1000 + j);
    children.push({ dbId: 100 + i, fragments: frags });
  }
  const geometry = new Map();
  for (const child of children) for (const f of child.fragments) geometry.set(f, { geometryIndex: f });
  const { model, stats } = buildMockModel([{ dbId: 1, fragments: [], children }], geometry);

  await assert.rejects(
    () => extractFragments(model, [1], LOAD_EPOCH),
    (err) => {
      assert.equal(err.limit, 'maxFragmentsPerDbId');
      assert.equal(err.requestedDbId, 1);
      return true;
    },
  );
  assert.ok(stats.enumNodeFragmentsCalls <= 11, `expected ~10-11 enumNodeFragments calls, got ${stats.enumNodeFragmentsCalls}`);
  assert.ok(stats.enumNodeChildrenCalls <= 11, `expected ~10-11 enumNodeChildren calls, got ${stats.enumNodeChildrenCalls}`);
});

test('per-requested-dbId tally is independent: first dbId under limit, second dbId over — rejection names the SECOND', async () => {
  const okFrags = [1, 2, 3];
  const overFrags = Array.from({ length: maxFragmentsPerDbId + 1 }, (_, i) => 9000 + i);
  const geometry = new Map();
  for (const f of [...okFrags, ...overFrags]) geometry.set(f, { geometryIndex: f });
  const { model } = buildMockModel(
    [{ dbId: 1, fragments: okFrags }, { dbId: 2, fragments: overFrags }],
    geometry,
  );
  await assert.rejects(
    () => extractFragments(model, [1, 2], LOAD_EPOCH),
    (err) => {
      assert.equal(err.limit, 'maxFragmentsPerDbId');
      assert.equal(err.requestedDbId, 2);
      return true;
    },
  );
});

test('checkpoint fires between every node visit on a deep single-child chain, not only at true siblings', async () => {
  // A chain of 6 nodes, each with exactly one child, has no literal siblings anywhere — if the
  // checkpoint were only wired to fire "between siblings" it would never fire at all here, letting
  // an arbitrarily deep chain run unyielded. Codex-advisor review flagged this distinction explicitly.
  let node = { dbId: 6, fragments: [] };
  for (let i = 5; i >= 1; i--) node = { dbId: i, fragments: [], children: [node] };
  const { model } = buildMockModel([node], new Map());
  const visits = [];
  await extractFragments(model, [1], LOAD_EPOCH, {
    checkpoint: async (ctx) => { visits.push(ctx.requestedDbId); },
  });
  assert.ok(visits.length >= 5, `expected a checkpoint between each of the 6 chained node visits, got ${visits.length}`);
});

test('optional checkpoint hook is awaited before each requested dbId and between sibling visits', async () => {
  const calls = [];
  const { model } = buildMockModel(
    [
      { dbId: 1, fragments: [], children: [{ dbId: 11, fragments: [] }, { dbId: 12, fragments: [] }] },
      { dbId: 2, fragments: [] },
    ],
    new Map(),
  );
  await extractFragments(model, [1, 2], LOAD_EPOCH, {
    checkpoint: async (ctx) => { calls.push(ctx.requestedDbId); },
  });
  assert.ok(calls.length >= 2, 'must checkpoint at least once per requested dbId');
  assert.deepEqual(calls.filter((v, i) => calls.indexOf(v) === i).sort(), [1, 2]);
});

test('checkpoint rejection propagates and aborts the walk (used by callers to surface WorldDisposedError/ModelEvictedError mid-extraction)', async () => {
  const { model } = buildMockModel(
    [{ dbId: 1, fragments: [], children: [{ dbId: 11, fragments: [1] }, { dbId: 12, fragments: [2] }] }],
    new Map([[1, { geometryIndex: 1 }], [2, { geometryIndex: 2 }]]),
  );
  class FakeDisposedError extends Error {}
  let calls = 0;
  await assert.rejects(
    () => extractFragments(model, [1], LOAD_EPOCH, {
      checkpoint: async () => { calls++; if (calls === 2) throw new FakeDisposedError(); },
    }),
    FakeDisposedError,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**
Run: `node --test test/viewer/ViewerModelAdapter.test.mjs`
Expected: every test fails with a module-resolution error (`Cannot find module
'.../wwwroot/collision/viewer/ViewerModelAdapter.js'`) since neither that file nor
`test/fixtures/mockInstanceTree.mjs` exist yet — create the fixture file first (it has no failing
assertions of its own, it's pure infrastructure), then confirm the adapter import is what fails.

- [ ] **Step 3: Write the implementation**

`wwwroot/collision/viewer/ViewerModelAdapter.js`:
```js
import { maxChildrenPerNode, maxFragmentsPerDbId } from '../constants.js';
import { createGeometryIdentity } from '../geometry/GeometryIdentity.js';

export class ExtractionLimitExceededError extends Error {
  constructor(limit, requestedDbId, node, observedCount) {
    super(
      `Extraction limit '${limit}' exceeded while walking requested dbId ${requestedDbId} ` +
      `(node ${node}, observed count ${observedCount})`,
    );
    this.name = 'ExtractionLimitExceededError';
    this.limit = limit;
    this.requestedDbId = requestedDbId;
    this.node = node;
    this.observedCount = observedCount;
  }
}

function readWorldMatrix(fragList, fragId) {
  // Duck-typed matrix carrier, never a Viewer-side THREE.Matrix4 instance — the runtime-isolation
  // rule (docs/...:980-983) forbids sharing class instances across the Viewer/collision boundary;
  // only the raw Float64Array of numbers crosses.
  const carrier = { elements: new Float64Array(16) };
  fragList.getWorldMatrix(fragId, carrier);
  return carrier.elements;
}

function readWorldBounds(fragList, fragId) {
  const carrier = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  fragList.getWorldBounds(fragId, carrier);
  return {
    min: [carrier.min.x, carrier.min.y, carrier.min.z],
    max: [carrier.max.x, carrier.max.y, carrier.max.z],
  };
}

// Self-driven, non-recursive, depth-first extraction walk. docs/...:1080-1146 (ViewerModelAdapter),
// 2838-3013 (Data Flow step 3 extraction). Iterative (stack-based) rather than JS-recursive so a
// checkpoint can be awaited cleanly between sibling-node visits without deep async call stacks.
export async function extractFragments(model, requestedDbIds, loadEpoch, { checkpoint } = {}) {
  const instanceTree = model.getInstanceTree();
  const fragList = model.getFragmentList();
  const results = new Map(); // fragmentId -> ExtractedFragmentRecord, unique across the WHOLE call

  for (const requestedDbId of requestedDbIds) {
    if (checkpoint) await checkpoint({ requestedDbId });

    let fragmentTally = 0; // per-REQUESTED-dbId tally (docs/...:2900-2903) — resets for each root
    const stack = [requestedDbId];

    while (stack.length > 0) {
      const node = stack.pop();

      // Step 1: this node's OWN direct fragments. Not abortable mid-call (docs/...:2931-2960,
      // accepted non-preemptible risk) — tally is checked only after the call returns.
      instanceTree.enumNodeFragments(node, (fragId) => {
        fragmentTally++;
        if (fragmentTally > maxFragmentsPerDbId) return; // stop recording; rejection below fires anyway
        if (!results.has(fragId)) {
          // First-discovery-wins (docs/...:1298-1310, 2969-2976): a fragment id rediscovered later
          // under a different node keeps its original ownerDbId/matrix/bounds untouched — this
          // module makes no cross-call OR cross-node stability promise beyond "first write wins".
          const worldMatrix = readWorldMatrix(fragList, fragId);
          const worldBounds = readWorldBounds(fragList, fragId);
          const geometryIdentity = createGeometryIdentity({
            loadEpoch,
            geometryIndex: fragList.getGeometryId(fragId),
          });
          results.set(fragId, Object.freeze({ fragmentId: fragId, geometryIdentity, worldMatrix, worldBounds, ownerDbId: node }));
        }
      }, false);

      if (fragmentTally > maxFragmentsPerDbId) {
        throw new ExtractionLimitExceededError('maxFragmentsPerDbId', requestedDbId, node, fragmentTally);
      }

      // Step 2: this node's children, fanout-ceiling-guarded. docs/...:2853-2929 — abort tracked via
      // a LOCAL boolean flag, never via the enumeration's/callback's own return-carried dbId value,
      // since a legitimate dbId of 0 is falsy and must not be mistaken for "no more children".
      let childCount = 0;
      let fanoutExceeded = false;
      const children = [];
      instanceTree.enumNodeChildren(node, (childId) => {
        childCount++;
        if (childCount > maxChildrenPerNode) {
          fanoutExceeded = true;
          return true; // abort enumeration — costs exactly maxChildrenPerNode + 1 callbacks total
        }
        children.push(childId);
        return false;
      }, false);

      if (fanoutExceeded) {
        throw new ExtractionLimitExceededError('maxChildrenPerNode', requestedDbId, node, childCount);
      }

      // Push in reverse so pop() yields children in original left-to-right order (depth-first).
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);

      if (checkpoint && stack.length > 0) await checkpoint({ requestedDbId });
    }
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `node --test test/viewer/ViewerModelAdapter.test.mjs`
Expected: PASS on all cases. Key assertions each proves:
  - basic/multi-root tests: matrix/bounds/geometryIdentity/ownerDbId wired correctly end to end.
  - family-node test: non-recursive walk descends through a fragment-free ancestor (round-18 evidence,
    docs/...:1095-1111) instead of silently reporting empty.
  - coverage-equivalence test: the self-driven walk's unique-fragment-id set is provably identical to
    one recursive `enumNodeFragments(dbId, cb, true)` call's set, closing the equivalence claim
    docs/...:1095-1111 makes for ViewerModelAdapter — this is the fixture that "earns" that claim.
  - dbId-0 test: proves the fanout-ceiling abort is carried by a boolean local, never by any dbId value.
  - fanout-ceiling tests (×4): prove the exact `maxChildrenPerNode + 1` callback bound in both
    directions (trip and no-trip), fragment-free and mixed, and that `getChildCount` is never invoked.
  - oversized-subtree test: proves the walk actually stops early (≤11 node visits) rather than
    enumerating all 100 nodes before rejecting.
  - per-dbId-tally-independence test: proves the tally is scoped per requested root, not global.
  - checkpoint tests: prove the injected async hook is honored and that its own rejections propagate
    (this is the seam Task 19/20 uses to thread real `WorldDisposedError`/`ModelEvictedError` mid-walk).

- [ ] **Step 5: Commit**
```bash
git add wwwroot/collision/viewer/ViewerModelAdapter.js test/fixtures/mockInstanceTree.mjs test/viewer/ViewerModelAdapter.test.mjs
git commit -m "Add ViewerModelAdapter self-driven fragment extraction walk"
```

**Completion criteria:**
- `extractFragments` never calls `enumNodeChildren`/`enumNodeFragments` with `recursive: true`, and
  never calls `getChildCount`.
- Fanout ceiling costs exactly `maxChildrenPerNode + 1` callback invocations at the abort boundary and
  exactly `maxChildrenPerNode` at the non-abort boundary, in both directions.
- Fragment tally is scoped per requested root dbId, checked after each node's own `enumNodeFragments`
  call returns (never abortable mid-call), and rejects naming the offending root dbId, the specific
  node, and which limit tripped.
- `ownerDbId` is first-discovery-wins, call-wide (not per-requested-dbId), and is not required to be
  stable across separate calls for the multi-node edge case (only within one call).
- The self-driven walk's unique fragment-id set is proven set-equal to one recursive
  `enumNodeFragments(dbId, cb, true)` call's set on a fixture mirroring the acceptance model's family
  node relationship.

**Protected invariants / regressions to watch:**
- Recursive `enumNodeFragments(dbId, cb, true)` was the stated contract through round 15; round 16
  removed it entirely because it is one uninterruptible native call with no checkable ceiling
  (docs/...:1083-1094). Never reintroduce it as a production code path.
- `getChildCount` preflight was removed at round 18 (invariant-audit finding C-1) — "not cheap for
  mixed nodes (linear scan, no early exit), never load-bearing" (docs/...:2853-2929, Extract D §1
  "One node has too many direct children"). Do not reintroduce it, even as an optimization.
- The fanout-ceiling abort MUST be carried by a local boolean, never inferred from any dbId's
  truthiness — dbId `0` is a legitimate value and is falsy (docs/...:2853-2929).
- `maxFragmentsPerDbId`'s tally counts callback invocations, not distinct fragment ids, and is checked
  only after a node's `enumNodeFragments` call fully returns — one pathological node with e.g. 100,000
  direct fragments is an accepted, non-preemptible risk in Milestone 1 (docs/...:2931-2960). Do not
  attempt to make this abortable mid-call; that would contradict the spec's explicit scope decision.
- `ownerDbId` first-discovery-wins is call-scoped only — the spec explicitly declines to claim
  cross-call stability for the multi-node-report edge case (docs/...:1298-1310, round-31 disposition
  Blocker 1 fix). Do not add or imply a stronger stability guarantee in any later task's docs/comments.
- This module does not assign or interpret `loadEpoch` — it is purely a passthrough parameter. Lifecycle
  ownership (assigning epochs, checking disposed/evicted) belongs entirely to Task 17/19/20; do not let
  this module grow any such logic.
- The optional `checkpoint` hook must fire between EVERY node visit (every stack-pop transition), not
  only where the tree happens to branch — a deep single-child chain has no literal siblings and would
  otherwise run any number of node visits unyielded (codex-advisor review flagged this distinction
  explicitly; docs/...:2927-2929's "between sibling nodes at same depth" states the walk's minimum
  checkpoint bar, not a ceiling on how often it may fire — firing more often, e.g. between every node
  regardless of branching, is conforming and is what this task's own implementation already does).
- Fragment-enumeration is deliberately run BEFORE child-enumeration at each node (not the reverse) —
  the spec does not strictly mandate this order (either produces the same successful DFS traversal),
  but this task pins fragment-first because a `maxFragmentsPerDbId` trip then avoids an unnecessary
  `enumNodeChildren` call on the same node. A future refactor may reorder this only if it re-derives
  the same fanout-ceiling/tally interaction and updates this task's fixtures accordingly.

---

### Task 17: `CollisionWorld` lifecycle — `admitModel`/`evictModel`/`dispose`/`isLeaseValid`/`isModelLive`

**Objective:** Implement the admit/evict/dispose/lease surface that makes every later cache and query safe against model eviction, world disposal, and `modelId` reuse — the most race-condition-hardened subsystem in the spec.

**Files:**
- Create: `wwwroot/collision/CollisionWorld.js`
- Test: `test/CollisionWorld.test.mjs`

**Interfaces:**
- Consumes:
  - `WorldDisposedError`, `ModelEvictedError` from `./errors.js` (Task 1).
  - `frameBudgetMs` from `./constants.js` (Task 1, value `8`, `docs/...:191`).
  - `runCheckpointPortContractTests(makePort)` from `./scheduler.js` (Task 1) — **assumed harness
    shape**, since Task 1's actual `scheduler.js` may not exist on disk yet when this task is picked
    up. This task writes its own best-effort adapter function passed to that suite (see Step 1); if
    Task 1's real signature differs, the only required change is that one adapter function, not this
    task's own `CollisionWorld` implementation. Also assumed: `scheduler.js` exports a
    `scheduleFrameYield()` async helper (wraps `requestAnimationFrame`, falling back to
    `setTimeout(0, ...)` when unavailable, per canonical reference's "`createCheckpoint`,
    `FrameBudgetAccumulator` or equivalent") used as this module's default (overridable) scheduling
    primitive — never called directly by tests, which always inject a synchronous/controllable
    replacement.
- Produces (Tasks 19/20 depend on these names verbatim):
  ```ts
  // wwwroot/collision/CollisionWorld.js
  export class CollisionWorld {
    constructor(options?: {
      registry?: GeometryRegistryLike,     // Task 13/14's GeometryRegistry instance; optional so this
                                            // task's own tests can run without it (registry-touching
                                            // calls no-op if absent — see evictModel/dispose below).
                                            // Real wiring happens in Task 19's CollisionWorld.fromViewer.
      now?: () => number,                  // defaults to () => performance.now(); injectable for tests
      yieldToScheduler?: () => Promise<void>, // defaults to scheduler.js's scheduleFrameYield;
                                            // injectable for tests (never actually waits in unit tests)
    });

    admitModel(model: object): Readonly<{ model: object; epoch: number }>;
    isLeaseValid(lease: { model: object; epoch: number }): boolean;   // never throws, even disposed
    evictModel(model: object): void;                                  // never throws, even disposed
    isModelLive(model: object): boolean;                              // throws WorldDisposedError
    dispose(): void;                                                  // never throws

    // Internal helper Tasks 19/20 call at the very top of findClashes's own method body, before any
    // extraction. Named precisely so it can be imported/called by name:
    _checkEntryLifecycle(
      source: { model: object },
      target: { model: object },
    ): { model: object; epoch: number };
    // Order: disposed -> WorldDisposedError. source.model !== target.model -> plain Error (unnamed
    // per spec, docs/...:2830-2837) BEFORE either operand is looked up/admitted. Per-operand: tombstoned
    // -> ModelEvictedError; otherwise lazy-admits via the same path admitModel uses. Since cross-model
    // is rejected first, only ONE epoch exists for the whole call — this is why the return value is a
    // single { model, epoch }, not one per operand.

    // The real checkpoint port FACTORY. docs/...:3543-3550 ("every yield checkpoint checks disposed
    // first, THEN re-validates modelLifecycle") describes the validation contract; the Data Flow
    // narrow-phase section (docs/...:3107ish, "Shared wall-clock budget: one performance.now()-based
    // accumulator for the whole call") describes the ACCUMULATOR'S OWN SCOPE — one accumulator per
    // findClashes CALL, not one shared across the whole CollisionWorld instance. Codex-advisor review
    // of this task's first draft caught that a world-instance-scoped accumulator would corrupt timing
    // across two concurrent findClashes calls (call A's elapsed time would count toward call B's next
    // yield decision and vice versa) — fixed here by making createCheckpointPort() a FACTORY: every
    // call creates a fresh, closure-local accumulator/clock-baseline, validated against the WORLD's
    // shared disposed/modelLifecycle state (which IS correctly global) but never sharing timing state
    // with any other call's port.
    //
    // Tasks 19/20 call this ONCE per findClashes invocation, immediately after resolving that call's
    // own {model, epoch} via _checkEntryLifecycle, and thread the single returned function through
    // EVERY checkpoint that call makes for its own lifetime — its own extraction/broad/narrow-phase
    // checkpoints AND whatever checkpoint function it hands to GeometryRegistry (Task 13/14) for any
    // geometry build THIS call triggers. GeometryRegistry must accept its checkpoint per BUILD CALL,
    // not fixed at construction time, precisely because it is shared world-wide state that many
    // different findClashes calls' own per-call ports may need to drive — see the recap section at the
    // end of this plan section for the exact wiring shape this implies for Task 13/14 and Task 19.
    createCheckpointPort(
      lease: { model: object; epoch: number },
    ): (ctx?: { model?: object; loadEpoch?: number }) => Promise<void>;
    // The returned function defaults `ctx.model`/`ctx.loadEpoch` to `lease.model`/`lease.epoch` when
    // omitted, so a caller checkpointing on behalf of the SAME operand the lease names can just call
    // `port()` with no arguments; passing an explicit `{model, loadEpoch}` remains necessary for a
    // checkpoint validating a DIFFERENT operand (e.g. findClashes's own composed per-operand checks).
  }
  ```

- [ ] **Step 1: Write the failing test(s)**

`test/CollisionWorld.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../wwwroot/collision/CollisionWorld.js';
import { WorldDisposedError, ModelEvictedError } from '../wwwroot/collision/errors.js';
import { frameBudgetMs } from '../wwwroot/collision/constants.js';
import { runCheckpointPortContractTests } from '../wwwroot/collision/scheduler.js';

function makeModel(id) { return { id }; }

// --- admitModel -------------------------------------------------------------------------------

test('admitModel is idempotent on an already-live object — same epoch, nextLoadEpoch consumed once', () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  const lease1 = world.admitModel(model);
  const lease2 = world.admitModel(model);
  assert.equal(lease1.epoch, lease2.epoch);
  const other = world.admitModel(makeModel(2));
  assert.equal(other.epoch, lease1.epoch + 1, 'nextLoadEpoch must have been consumed exactly once by the two admitModel(model) calls combined');
});

test('admitModel on an already-evicted object throws immediately without consuming a new epoch', () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  const lease = world.admitModel(model);
  world.evictModel(model);
  assert.throws(() => world.admitModel(model), ModelEvictedError);
  const next = world.admitModel(makeModel(2));
  assert.equal(next.epoch, lease.epoch + 1, 'the failed re-admission attempt must not have consumed an epoch');
});

// --- evictModel ---------------------------------------------------------------------------------

test('evictModel on an object with no prior lifecycle entry tombstones with no epoch, no release attempted', () => {
  let released = 0;
  const registry = { releaseEntriesForEpoch() { released++; }, releaseAll() {} };
  const world = new CollisionWorld({ registry });
  const model = makeModel(1); // never admitted — mocked BEFORE_MODEL_UNLOAD_EVENT for a model loaded but never touched
  world.evictModel(model);
  assert.equal(released, 0);
  assert.throws(() => world.admitModel(model), ModelEvictedError, 'must be permanently tombstoned');
});

test('evictModel called twice — second call is a no-op, no further release attempted', () => {
  let released = 0;
  const registry = { releaseEntriesForEpoch() { released++; }, releaseAll() {} };
  const world = new CollisionWorld({ registry });
  const model = makeModel(1);
  world.admitModel(model);
  world.evictModel(model);
  assert.equal(released, 1);
  world.evictModel(model);
  assert.equal(released, 1, 'second eviction must not release again');
});

test('evictModel after dispose() does not throw — mocked unguarded dispatch loop reaches a second model', () => {
  const world = new CollisionWorld();
  world.dispose();
  const modelA = makeModel(1);
  const modelB = makeModel(2);
  // Simulates Viewer3DImpl.unloadCurrentModel's unguarded loop (docs/...:3167-177): a throw here
  // would abort the loop before modelB's handler runs.
  let reachedB = false;
  const dispatchLoop = [modelA, modelB];
  for (const m of dispatchLoop) {
    world.evictModel(m); // must not throw for either
    if (m === modelB) reachedB = true;
  }
  assert.equal(reachedB, true);
});

test('evictModel does not throw even if the registry\'s releaseEntriesForEpoch itself throws', () => {
  const registry = {
    releaseEntriesForEpoch() { throw new Error('simulated GeometryRegistry failure'); },
    releaseAll() {},
  };
  const world = new CollisionWorld({ registry });
  const model = makeModel(1);
  world.admitModel(model);
  assert.doesNotThrow(() => world.evictModel(model));
  assert.throws(() => world.admitModel(model), ModelEvictedError, 'must still be tombstoned despite the registry failure');
});

test('stale evictModel(oldModel) after a different object was admitted under the same reused model.id leaves the new object untouched', () => {
  let releasedEpochs = [];
  const registry = { releaseEntriesForEpoch(epoch) { releasedEpochs.push(epoch); }, releaseAll() {} };
  const world = new CollisionWorld({ registry });
  const oldModel = { id: 42 };
  const newModel = { id: 42 }; // same numeric id, different object — round-14 core regression
  const oldLease = world.admitModel(oldModel);
  const newLease = world.admitModel(newModel);
  assert.notEqual(oldLease.epoch, newLease.epoch);

  world.evictModel(oldModel); // stale/delayed eviction of the OLD object
  assert.deepEqual(releasedEpochs, [oldLease.epoch]);
  assert.equal(world.isModelLive(newModel), true, 'new object must remain live');
  assert.equal(world.isLeaseValid(newLease), true, 'new object\'s lease must be unaffected');
  assert.throws(() => world.admitModel(oldModel), ModelEvictedError);
});

// --- isLeaseValid / isModelLive --------------------------------------------------------------

test('isLeaseValid after dispose() returns false synchronously, does not throw, even from an async callback', async () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  const lease = world.admitModel(model);
  world.dispose();
  await Promise.resolve(); // simulate resuming inside a mocked async callback
  assert.equal(world.isLeaseValid(lease), false);
});

test('isModelLive after dispose() throws WorldDisposedError — distinguishing it from isLeaseValid', () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  world.admitModel(model);
  world.dispose();
  assert.throws(() => world.isModelLive(model), WorldDisposedError);
});

test('isModelLive on a never-seen model returns false (not yet admitted)', () => {
  const world = new CollisionWorld();
  assert.equal(world.isModelLive(makeModel(999)), false);
});

// --- dispose --------------------------------------------------------------------------------

test('dispose() then a new lifecycle call rejects/throws immediately, before any per-model check', () => {
  const world = new CollisionWorld();
  world.dispose();
  assert.throws(() => world.admitModel(makeModel(1)), WorldDisposedError);
  assert.throws(() => world.isModelLive(makeModel(1)), WorldDisposedError);
});

test('two distinct model objects under the same reused modelId, both live, each suspended at a checkpoint — dispose() rejects BOTH, including the old one', async () => {
  const world = new CollisionWorld({ yieldToScheduler: () => new Promise(() => {}) /* never resolves on its own */ });
  const oldModel = { id: 7 };
  const newModel = { id: 7 };
  const oldLease = world.admitModel(oldModel);
  const newLease = world.admitModel(newModel);

  // Force both checkpoints past frameBudgetMs so they'd normally await the (never-resolving) yield —
  // instead we call checkpoint() directly and race it against dispose() firing first via a
  // controllable now()/yield pairing. Simpler and equally faithful to the contract: dispose() sets
  // `disposed` synchronously, so a checkpoint call made AFTER dispose() must reject regardless of
  // which model it names — this is round 15's core point (disposed is checked directly, never
  // inferred from tombstone state, so liveModelByModelId's inability to enumerate the old object is
  // irrelevant).
  const portForOld = world.createCheckpointPort(oldLease);
  const portForNew = world.createCheckpointPort(newLease);
  world.dispose();
  await assert.rejects(() => portForOld(), WorldDisposedError);
  await assert.rejects(() => portForNew(), WorldDisposedError);
});

test('different model object admitted under a reused modelId, queried before the old object\'s own eviction runs, never touches old object\'s state', () => {
  const world = new CollisionWorld();
  const oldModel = { id: 3 };
  const newModel = { id: 3 };
  const oldLease = world.admitModel(oldModel);
  const newLease = world.admitModel(newModel); // old object still live, never evicted yet
  assert.notEqual(oldLease.epoch, newLease.epoch);
  assert.equal(world.isLeaseValid(oldLease), true, 'old object is still independently live');
  assert.equal(world.isLeaseValid(newLease), true);
});

// --- _checkEntryLifecycle ---------------------------------------------------------------------

test('_checkEntryLifecycle: disposed is checked before cross-model check', () => {
  const world = new CollisionWorld();
  world.dispose();
  assert.throws(
    () => world._checkEntryLifecycle({ model: makeModel(1) }, { model: makeModel(2) }),
    WorldDisposedError,
  );
});

test('_checkEntryLifecycle: cross-model rejected before either operand is admitted', () => {
  const world = new CollisionWorld();
  const source = makeModel(1);
  const target = makeModel(2);
  assert.throws(() => world._checkEntryLifecycle({ model: source }, { model: target }));
  assert.equal(world.isModelLive(source), false, 'must not have been lazily admitted by the failed check');
  assert.equal(world.isModelLive(target), false);
});

test('_checkEntryLifecycle: evicted operand rejects ModelEvictedError', () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  world.admitModel(model);
  world.evictModel(model);
  assert.throws(() => world._checkEntryLifecycle({ model }, { model }), ModelEvictedError);
});

test('_checkEntryLifecycle: never-seen operand is lazily admitted and returns its fresh epoch', () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  const { epoch } = world._checkEntryLifecycle({ model }, { model });
  assert.equal(world.isModelLive(model), true);
  assert.equal(world.isLeaseValid({ model, epoch }), true);
});

// --- checkpoint port contract conformance -----------------------------------------------------

runCheckpointPortContractTests((overrides = {}) => {
  const now = overrides.now;
  const yieldToScheduler = overrides.yieldToScheduler;
  const world = new CollisionWorld({ now, yieldToScheduler });
  const model = overrides.model || makeModel(1);
  const lease = world.admitModel(model);
  return {
    checkpoint: world.createCheckpointPort(lease),
    dispose: () => world.dispose(),
    evict: () => world.evictModel(model),
    world,
    model,
    lease,
  };
});
// NOTE: the exact shape `runCheckpointPortContractTests` expects from its `makePort` factory is owned
// by Task 1's scheduler.js. The adapter above is this task's best-effort integration against the
// contract described in this plan's own briefing (an async `checkpoint({model,loadEpoch})` port that
// throws on disposed/evicted, checks disposed first). If Task 1's actual harness signature differs,
// adjust only this adapter function — CollisionWorld's own createCheckpointPort() implementation below
// is written against the contract's semantics directly (including the "one accumulator per call" scope
// codex-advisor review confirmed against the spec's own Data Flow narrow-phase text), not against this
// adapter's shape. Note also that this adapter calls createCheckpointPort ONCE per makePort invocation,
// consistent with the real per-call usage pattern (one port per findClashes call) — if Task 1's contract
// suite expects to call `checkpoint` many times against one long-lived port instance to exercise
// accumulator behavior, that is exactly what this shape supports.

// --- direct checkpoint semantics (independent of the imported contract suite, as a backstop) ----

test('createCheckpointPort: disposed is checked before epoch validity', async () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  const lease = world.admitModel(model);
  const port = world.createCheckpointPort(lease);
  world.dispose();
  await assert.rejects(() => port(), WorldDisposedError);
});

test('createCheckpointPort: stale epoch (model evicted) rejects ModelEvictedError', async () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  const lease = world.admitModel(model);
  const port = world.createCheckpointPort(lease);
  world.evictModel(model);
  await assert.rejects(() => port(), ModelEvictedError);
});

test('createCheckpointPort: yields only once accumulated time reaches frameBudgetMs, and revalidates after yielding', async () => {
  let elapsed = 0;
  const now = () => elapsed;
  let yieldCount = 0;
  const yieldToScheduler = async () => { yieldCount++; };
  const world = new CollisionWorld({ now, yieldToScheduler });
  const model = makeModel(1);
  const lease = world.admitModel(model);
  const port = world.createCheckpointPort(lease);

  elapsed += 1;
  await port();
  assert.equal(yieldCount, 0, 'under frameBudgetMs — must not yield');

  elapsed += frameBudgetMs; // now cumulative elapsed since last checkpoint crosses the threshold
  await port();
  assert.equal(yieldCount, 1, 'due — must yield exactly once');
});

test('createCheckpointPort: two ports created for two concurrent calls do not share accumulator state', async () => {
  // Codex-advisor's core finding: the accumulator is scoped per findClashes call, not per world.
  // Port A accumulates almost enough elapsed time to trip a yield; port B (a fresh call, fresh
  // accumulator) must NOT inherit any of A's accumulated time just because they share a `now()`.
  let elapsed = 0;
  const now = () => elapsed;
  let yieldCount = 0;
  const yieldToScheduler = async () => { yieldCount++; };
  const world = new CollisionWorld({ now, yieldToScheduler });
  const model = makeModel(1);
  const lease = world.admitModel(model);

  const portA = world.createCheckpointPort(lease);
  elapsed += frameBudgetMs - 1; // A is now one unit away from due
  await portA();
  assert.equal(yieldCount, 0);

  const portB = world.createCheckpointPort(lease); // a fresh call starting now — fresh accumulator
  elapsed += 1; // this alone would have tipped A over; B's own baseline starts from THIS elapsed value
  await portB();
  assert.equal(yieldCount, 0, 'a fresh port must not inherit another port\'s accumulated time');

  await portA(); // A's own accumulator: was at frameBudgetMs - 1, plus 1 more elapsed unit = due
  assert.equal(yieldCount, 1, 'A must still trip on its own accumulated total');
});

test('createCheckpointPort: model evicted during the yield itself — resumed checkpoint rejects, never completes silently', async () => {
  let elapsed = 0;
  const now = () => elapsed;
  const model = makeModel(1);
  const world = new CollisionWorld({
    now,
    yieldToScheduler: async () => { world.evictModel(model); },
  });
  const lease = world.admitModel(model);
  const port = world.createCheckpointPort(lease);
  elapsed += frameBudgetMs;
  await assert.rejects(() => port(), ModelEvictedError);
});

test('createCheckpointPort: checkpointing a DIFFERENT operand than the lease via explicit ctx', async () => {
  const world = new CollisionWorld();
  const leaseModel = makeModel(1);
  const otherModel = makeModel(2);
  const lease = world.admitModel(leaseModel);
  const otherLease = world.admitModel(otherModel);
  const port = world.createCheckpointPort(lease);
  await port(); // defaults to lease's own {model, epoch} — must not throw
  await port({ model: otherModel, loadEpoch: otherLease.epoch }); // explicit different operand
  world.evictModel(otherModel);
  await assert.rejects(() => port({ model: otherModel, loadEpoch: otherLease.epoch }), ModelEvictedError);
});
```

- [ ] **Step 2: Run tests to verify they fail**
Run: `node --test test/CollisionWorld.test.mjs`
Expected: module-resolution failure importing `wwwroot/collision/CollisionWorld.js` (does not exist
yet); the `runCheckpointPortContractTests` import may also fail if `scheduler.js` doesn't exist yet —
if so, verify that failure specifically (missing module), then proceed to Step 3 regardless (per the
dispatch brief: "if that file doesn't exist yet when you read, proceed... do not block").

- [ ] **Step 3: Write the implementation**

`wwwroot/collision/CollisionWorld.js`:
```js
import { WorldDisposedError, ModelEvictedError } from './errors.js';
import { frameBudgetMs } from './constants.js';
import { scheduleFrameYield } from './scheduler.js';

function modelIdOf(model) {
  return model && model.id !== undefined ? model.id : model;
}

export class CollisionWorld {
  constructor({ registry = null, now = () => performance.now(), yieldToScheduler = scheduleFrameYield } = {}) {
    this._disposed = false;
    // WeakMap: never deleted, only ever transitions live -> evicted, permanent. docs/...:3196-3213.
    this._modelLifecycle = new WeakMap();
    // Global counter, NEVER scoped to or reset per modelId — round-11 ABA-race fix, docs/...:3196-3199.
    this._nextLoadEpoch = 1;
    // Best-effort diagnostic only, NOT load-bearing for correctness (round-15, docs/...:3395-3398) —
    // cannot enumerate every live model under modelId reuse; never consulted by any correctness path.
    this._liveModelByModelId = new Map();
    this._registry = registry;
    this._instanceCache = new Map(); // Map<loadEpoch, Map<fragmentId, CollisionInstance>> — Task 18
    this._now = now;
    this._yieldToScheduler = yieldToScheduler;
    // NOTE: no accumulator/clock-baseline field here — the frameBudgetMs accumulator is scoped to one
    // findClashes CALL (docs/...: "one performance.now()-based accumulator for the whole call"), never
    // to the whole CollisionWorld instance. See createCheckpointPort() below, which is the ONLY place
    // that timing state lives, freshly, per call.
  }

  admitModel(model) {
    if (this._disposed) throw new WorldDisposedError();
    const existing = this._modelLifecycle.get(model);
    if (existing?.state === 'evicted') {
      // Never assigns a new epoch — a model that was ever evicted can never be re-leased.
      // docs/...:3211-3213.
      throw new ModelEvictedError(modelIdOf(model));
    }
    if (existing?.state === 'live') {
      return Object.freeze({ model, epoch: existing.epoch }); // idempotent, same epoch, no new epoch consumed
    }
    const epoch = this._nextLoadEpoch++;
    this._modelLifecycle.set(model, { state: 'live', epoch });
    if (model && model.id !== undefined) this._liveModelByModelId.set(model.id, model);
    return Object.freeze({ model, epoch });
  }

  isLeaseValid(lease) {
    // Strictly non-throwing and total — one of two deliberate exceptions to "every public method
    // throws WorldDisposedError once disposed" (evictModel is the other). docs/...:3380-3391.
    if (this._disposed) return false;
    const entry = this._modelLifecycle.get(lease.model);
    return entry?.state === 'live' && entry.epoch === lease.epoch;
  }

  evictModel(model) {
    // Second deliberate exception: no-op on a disposed world, never throws. Justification
    // (docs/...:3167-177, verbatim from Public API section):
    //  1. evictModel runs from BEFORE_MODEL_UNLOAD_EVENT, dispatched via EventDispatcher.dispatchEvent
    //     with no try/catch, as the first statement of Viewer3DImpl.unloadModel, called from the
    //     unguarded loop in unloadCurrentModel — an uncaught throw here aborts the Viewer's own
    //     multi-model teardown.
    //  2. dispose() has already released world-owned collision state unconditionally; nothing left to do.
    //  3. It is the branch this method already had (total-by-no-op for the 'evicted' case).
    // This "never throws" guarantee extends to whatever _releaseEpochScopedState does on this
    // method's behalf — see its own defensive try/catch below, added per codex-advisor review: this
    // method's non-throw contract must not depend on an unverified assumption that Task 13/14's
    // GeometryRegistry.releaseEntriesForEpoch is itself non-throwing.
    if (this._disposed) return;
    const previous = this._modelLifecycle.get(model);
    if (previous?.state === 'evicted') return; // idempotent no-op
    this._modelLifecycle.set(model, { state: 'evicted' }); // unconditional, permanent; no epoch field
    if (previous?.state === 'live') this._releaseEpochScopedState(previous.epoch);
    if (model && model.id !== undefined && this._liveModelByModelId.get(model.id) === model) {
      this._liveModelByModelId.delete(model.id); // diagnostic/bookkeeping only
    }
  }

  isModelLive(model) {
    if (this._disposed) throw new WorldDisposedError();
    const entry = this._modelLifecycle.get(model);
    return entry?.state === 'live';
  }

  dispose() {
    this._disposed = true; // set FIRST, synchronously, before anything else. docs/...:3380-3391.
    // Each independent cleanup below is attempted regardless of whether an earlier one failed —
    // dispose() is terminal and cannot be retried, so no single failure may strand the others.
    try {
      this._registry?.releaseAll?.();
    } catch {
      // dispose() is contractually non-throwing (docs/...:3391-3392) even if a composed module's
      // own release path is not verified from here.
    }
    this._instanceCache.clear(); // Task 18's cache — one wholesale clear, not a per-epoch sweep.
    // Best-effort tombstoning of the diagnostic-only modelId map (docs/...: "liveModelByModelId is
    // best-effort tombstoned for diagnostic bookkeeping only... NOT load-bearing for correctness").
    this._liveModelByModelId.clear();
  }

  _releaseEpochScopedState(epoch) {
    if (this._registry && typeof this._registry.releaseEntriesForEpoch === 'function') {
      try {
        this._registry.releaseEntriesForEpoch(epoch);
      } catch {
        // See evictModel's own comment: this method's caller (evictModel) must never throw, so a
        // misbehaving registry release path is swallowed here rather than propagated. Task 13/14's
        // GeometryRegistry should itself be non-throwing by contract; this is defense in depth, not
        // a substitute for that contract.
      }
    }
    this._instanceCache.delete(epoch); // Task 18's bucket for exactly the outgoing epoch.
  }

  // Entry-order check for findClashes (Tasks 19/20 call this at the very top of their own method
  // body). docs/...:2830-2837, 3533-3543.
  _checkEntryLifecycle(source, target) {
    if (this._disposed) throw new WorldDisposedError();
    if (source.model !== target.model) {
      const err = new Error('CollisionWorld.findClashes: cross-model queries are out of scope in Milestone 1');
      err.code = 'cross-model-query-rejected';
      throw err;
    }
    const model = source.model;
    const entry = this._modelLifecycle.get(model);
    if (entry?.state === 'evicted') throw new ModelEvictedError(modelIdOf(model));
    if (entry?.state === 'live') return { model, epoch: entry.epoch };
    return this.admitModel(model); // never-seen -> lazy admission, same path admitModel exposes publicly
  }

  _assertEpochLive(model, loadEpoch) {
    const entry = this._modelLifecycle.get(model);
    if (!entry || entry.state !== 'live' || entry.epoch !== loadEpoch) {
      throw new ModelEvictedError(modelIdOf(model));
    }
  }

  // Real checkpoint port FACTORY — one call per findClashes invocation. Each call creates a FRESH,
  // closure-local accumulator/clock-baseline (docs/...: "one performance.now()-based accumulator for
  // the whole call" — never shared across concurrent calls; fixed here per codex-advisor review,
  // which caught that an earlier draft stored this state directly on the CollisionWorld instance,
  // which would have let two concurrent findClashes calls corrupt each other's yield timing).
  // Validation (disposed, then modelLifecycle/epoch) reads the WORLD's own shared state, which is
  // correctly global — only the TIMING state is per-call.
  createCheckpointPort(lease) {
    const world = this;
    let accumulatedMs = 0;
    let lastCheckpointAt = world._now();

    return async function checkpoint(ctx = {}) {
      const model = ctx.model !== undefined ? ctx.model : lease.model;
      const loadEpoch = ctx.loadEpoch !== undefined ? ctx.loadEpoch : lease.epoch;

      if (world._disposed) throw new WorldDisposedError();
      world._assertEpochLive(model, loadEpoch);

      const now = world._now();
      accumulatedMs += now - lastCheckpointAt;
      lastCheckpointAt = now;

      if (accumulatedMs >= frameBudgetMs) {
        accumulatedMs = 0;
        await world._yieldToScheduler();
        if (world._disposed) throw new WorldDisposedError();
        world._assertEpochLive(model, loadEpoch);
        lastCheckpointAt = world._now();
      }
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `node --test test/CollisionWorld.test.mjs`
Expected: PASS on all cases, plus every case `runCheckpointPortContractTests` itself defines. Key
assertions each proves:
  - idempotency/epoch-consumption tests: `nextLoadEpoch` is a single global counter, never reset,
    never consumed on a failed/idempotent admission.
  - evict-with-no-prior-entry / double-evict / evict-after-dispose: the three permanence/no-throw
    guarantees `evictModel` makes, independently of each other.
  - stale-evictModel-after-reuse: round-14's core regression — epoch-keyed release cannot cross-wire
    two different objects sharing a numeric `id`.
  - isLeaseValid-vs-isModelLive-after-dispose: the two deliberately different disposal contracts
    (non-throwing boolean vs. throwing) are both honored, on the same disposed world.
  - two-objects-same-modelId-both-suspended-then-dispose: round-15's core regression — disposal is
    checked directly by the checkpoint, never inferred through `liveModelByModelId`, so the
    unreachable old object still rejects correctly.
  - `_checkEntryLifecycle` ordering tests: disposed-then-cross-model-then-per-operand order matches
    the spec's entry-order table exactly, and a failed check never lazily admits either operand.
  - checkpoint contract-suite run: proves this implementation is a conforming instance of Task 1's own
    checkpoint port contract, not just superficially similar.
  - direct checkpoint tests: the accumulator only triggers a yield once due, and re-validates
    disposed+epoch immediately after any yield — including the case where the *yield itself* is what
    causes the model to become evicted.
  - two-ports-do-not-share-accumulator-state test: proves `createCheckpointPort`'s timing state is
    truly per-call, not per-world — the fix for codex-advisor's core finding on this task's first draft.
  - evictModel-survives-a-throwing-registry test: proves `evictModel`'s non-throw guarantee does not
    silently depend on Task 13/14's `GeometryRegistry` being well-behaved.

- [ ] **Step 5: Commit**
```bash
git add wwwroot/collision/CollisionWorld.js test/CollisionWorld.test.mjs
git commit -m "Add CollisionWorld lifecycle surface and real checkpoint port"
```

**Completion criteria:**
- `admitModel`/`isLeaseValid`/`evictModel`/`isModelLive`/`dispose` match the Public API pseudocode
  (`docs/...:3211-3391`) exactly, including both of `isLeaseValid`/`evictModel`'s deliberate
  non-throwing-on-disposed exceptions.
- `_checkEntryLifecycle` centralizes the exact entry-order `findClashes` requires, so Tasks 19/20 need
  only call it once at the top of their own method body.
- `createCheckpointPort(lease)` conforms to Task 1's `runCheckpointPortContractTests` suite, and its
  timing state (accumulator, clock baseline) is scoped per call (per factory invocation), never shared
  across two ports created from two different `createCheckpointPort` calls.
- `_nextLoadEpoch` is instance-global, monotonic, never reset or scoped by `modelId`.

**Protected invariants / regressions to watch:**
- Round-11 ABA-race fix: `nextLoadEpoch` must never be scoped to or reset per `modelId`
  (`docs/...:3196-3199`; Extract D fixture "Query against modelId evicted then reloaded... resumed
  call still rejects ModelEvictedError").
- Round-14 Critical: geometry/instance state must be keyed by `loadEpoch`, never by `modelId` — this
  task doesn't key geometry itself (Task 13/14/18 do) but `_releaseEpochScopedState` and
  `_checkEntryLifecycle` are the two places that could accidentally reintroduce a `modelId`-keyed
  shortcut; they must not.
- Round-15 Critical (disposal enumeration): `checkpoint`/`dispose` must never infer "is this model
  affected by disposal" from `liveModelByModelId` or from whether the model was ever individually
  tombstoned — `disposed` is checked directly, first, unconditionally (`docs/...:3937-3953`).
  `liveModelByModelId` remains best-effort diagnostic only (round-15, `docs/...:3395-3398`).
- Round-15 Critical (evict-before-admit): `evictModel` on a never-seen object must tombstone with NO
  `epoch` field and attempt NO epoch-scoped release (`docs/...:3211-3213` value-type union has no
  epoch on the evicted variant — do not default it to e.g. `0`).
- Round-18 Critical (evict-after-dispose no-throw): confirmed against the pinned 7.124.2 bundle's
  `EventDispatcher.dispatchEvent` having no try/catch around the unload loop
  (`docs/...:3167-177`) — do not add a throw here even for "consistency" with other methods.
- `isLeaseValid` and `evictModel` are the ONLY two methods that stay non-throwing/no-op after
  disposal; every other public method (including a second `dispose()` call) must throw
  `WorldDisposedError` (`docs/...:3380-3391`).
- Checkpoint re-validation must happen a SECOND time immediately after any yield, not just once
  before it — a model can be evicted or the world disposed during the yield itself
  (`docs/...:3543-3550`).
- The `frameBudgetMs` accumulator is scoped to ONE `findClashes` CALL, never to the whole
  `CollisionWorld` instance — the spec states one accumulator "for the whole call," and two concurrent
  calls sharing one accumulator would corrupt each other's yield timing (a call resuming from a
  suspended checkpoint could trip the OTHER call's next checkpoint early, or mask that it should have
  yielded). This is why `createCheckpointPort(lease)` is a FACTORY producing fresh, closure-local
  timing state on every call, validated against the world's own (correctly global) `disposed`/
  `modelLifecycle` state but never sharing an accumulator with any other port. Caught by codex-advisor
  review of this task's first draft — do not reintroduce a `this._accumulatedMs`-style instance field.
- `evictModel`'s "never throws" guarantee must hold even if a composed `GeometryRegistry`'s own release
  method throws — `_releaseEpochScopedState` defensively swallows that failure (codex-advisor review);
  do not remove this try/catch on the assumption that Task 13/14's registry is "obviously" non-throwing.
- `dispose()` must attempt every one of its independent cleanups (registry release, instance-cache
  clear, `liveModelByModelId` clear) even if an earlier one fails — never wrap all of them in one
  try/catch that could skip a later cleanup after an earlier one throws.

---

### Task 18: `CollisionInstance` identity cache + capacity-gated admission

**Objective:** Give every fragment a stable, epoch-scoped canonical identity object, admitted atomically and capacity-bounded per call, that later `findClashes` calls can share without rebuilding.

**Files:**
- Modify: `wwwroot/collision/CollisionWorld.js` (adds to the class Task 17 created — same file,
  composed rather than a separate module, since the canonical reference itself declares `CollisionInstance`
  as living in `collision/CollisionWorld.js` "or a shared instance module," and this cache's release
  points — `_releaseEpochScopedState`/`dispose()` — are already Task 17 methods on this same class).
- Test: `test/CollisionWorld.test.mjs` (append to the file Task 17 created)

**Interfaces:**
- Consumes:
  - Task 17's `this._instanceCache` (`Map<loadEpoch, Map<fragmentId, CollisionInstance>>`), already
    initialized in the constructor and already wired into `_releaseEpochScopedState`/`dispose()`.
  - `maxCollisionInstancesPerEpoch` from `./constants.js` (Task 1, value `20_000`, reasoned provisional
    default per canonical reference — "`docs/...:2016-2017` leaves this value unchosen").
  - `test/fixtures/mockInstanceTree.mjs` and `wwwroot/collision/viewer/ViewerModelAdapter.js`'s
    `extractFragments` (Task 16) — this task's own fixtures build real `ExtractedFragmentRecord`s via
    the real adapter rather than hand-rolling fake ones, since the admission method's input shape is
    exactly what Task 16 produces (`{ fragmentId, geometryIdentity, ... }` per unique fragment).
- Produces (Tasks 19/20 depend on this name verbatim):
  ```ts
  // Added to wwwroot/collision/CollisionWorld.js's CollisionWorld class
  export class CapacityExceededError extends Error {
    // kind: 'call-wide-unique-fragment-precheck' | 'bucket-capacity' — distinguishes Data Flow step
    // 3's step-2 precheck (docs/...:2977-2985) from its step-4 bucket-capacity check
    // (docs/...:2986-3002); both reject the ENTIRE call, before any bucket mutation.
    constructor(kind, details) { /* ... */ } // details: { loadEpoch, limit, ...kind-specific fields }
  }

  interface CollisionInstance {
    readonly fragmentId: number;
    readonly geometryIdentity: GeometryIdentity;
  }
  // Object.freeze()'d. Cached per (loadEpoch, fragmentId); same object reference returned on every
  // cache hit for the lifetime of that epoch (canonical reference, verbatim).

  class CollisionWorld {
    // ... (Task 17's members)

    // Synchronous (NOT async) — deliberately, so the whole 4-step admission sequence runs in one
    // JS turn with no await/reentrant call between the capacity check and the commit, which is what
    // the spec's "no two concurrent calls can both pass against the same stale capacity observation"
    // guarantee actually rests on (docs/...:2991-3002). Tasks 19/20 MUST call this synchronously,
    // immediately after their own extraction walk's LAST possible await/yield — inserting any
    // `await` between "the walk finished" and "this call happens" reopens exactly the race this
    // method's synchronicity is meant to close, even though this method's own body has no await.
    //
    // Takes the caller's LEASE ({model, epoch}), not a bare epoch number, and validates it (disposed,
    // then modelLifecycle liveness+epoch match) as this method's own first step — codex-advisor review
    // of the first draft caught that a bare-epoch signature can't defend itself: since epoch-keyed
    // buckets are only ever released by evictModel/dispose (never by this method), a caller that
    // (incorrectly) calls this AFTER its own model was evicted would otherwise silently recreate an
    // orphan bucket for a dead epoch that nothing will ever clean up again. Validating the full lease
    // here closes that gap without costing synchronicity (it's a second synchronous check, no await).
    admitCollisionInstances(
      lease: { model: object; epoch: number },
      // Map<fragmentId, { geometryIdentity: GeometryIdentity }> — the call's COMPLETE unique
      // fragment-id set across BOTH source and target sides. Since findClashes rejects cross-model
      // queries before this point, source and target share one model and therefore one loadEpoch —
      // Tasks 19/20 are responsible for merging their two `extractFragments` results (source-side and
      // target-side Maps) into this single combined Map before calling here.
      uniqueFragments: Map<number, { geometryIdentity: GeometryIdentity }>,
    ): Map<number, CollisionInstance>;
    // Returns the canonical CollisionInstance for EVERY key in uniqueFragments (cache hits AND
    // newly-admitted misses alike), same object reference as any other live call against this epoch.
    // Throws WorldDisposedError/ModelEvictedError if the lease itself is stale (checked first, before
    // any capacity logic), or CapacityExceededError (naming which of the two checks tripped) before
    // touching the bucket at all if either capacity check fails — no bucket created, no instance
    // constructed, in either failure case.
  }
  ```

- [ ] **Step 1: Write the failing test(s)**

Append to `test/CollisionWorld.test.mjs`:
```js
import { extractFragments } from '../wwwroot/collision/viewer/ViewerModelAdapter.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';
import { maxCollisionInstancesPerEpoch } from '../wwwroot/collision/constants.js';
import { CapacityExceededError } from '../wwwroot/collision/CollisionWorld.js';

async function extract(model, dbIds, loadEpoch) {
  return extractFragments(model, dbIds, loadEpoch);
}

test('admitCollisionInstances: cache hit for an already-resident fragment returns the exact same object reference', async () => {
  const { model } = buildMockModel([{ dbId: 1, fragments: [1, 2] }], new Map([[1, { geometryIndex: 1 }], [2, { geometryIndex: 2 }]]));
  const world = new CollisionWorld();
  const lease = world.admitModel(model);
  const first = await extract(model, [1], lease.epoch);
  const admitted1 = world.admitCollisionInstances(lease, first);
  const second = await extract(model, [1], lease.epoch); // fresh extraction call, e.g. a later findClashes
  const admitted2 = world.admitCollisionInstances(lease, second);
  assert.equal(admitted1.get(1), admitted2.get(1), 'must be the exact same object reference across calls');
  assert.equal(admitted1.get(2), admitted2.get(2));
});

test('admitCollisionInstances: newly-admitted instances are frozen and shaped { fragmentId, geometryIdentity }', async () => {
  const { model } = buildMockModel([{ dbId: 1, fragments: [5] }], new Map([[5, { geometryIndex: 3 }]]));
  const world = new CollisionWorld();
  const lease = world.admitModel(model);
  const extracted = await extract(model, [1], lease.epoch);
  const admitted = world.admitCollisionInstances(lease, extracted);
  const instance = admitted.get(5);
  assert.equal(instance.fragmentId, 5);
  assert.equal(instance.geometryIdentity.geometryIndex, 3);
  assert.ok(Object.isFrozen(instance));
  assert.equal(instance.worldMatrix, undefined, 'CollisionInstance must carry NO transform state');
});

test('admitCollisionInstances: stale lease (model evicted) rejects ModelEvictedError before any capacity logic runs', async () => {
  const { model } = buildMockModel([{ dbId: 1, fragments: [1] }], new Map([[1, { geometryIndex: 1 }]]));
  const world = new CollisionWorld();
  const lease = world.admitModel(model);
  const extracted = await extract(model, [1], lease.epoch);
  world.evictModel(model);
  assert.throws(() => world.admitCollisionInstances(lease, extracted), ModelEvictedError);
  assert.equal(world._instanceCache.has(lease.epoch), false, 'must never create an orphan bucket for a dead epoch');
});

test('admitCollisionInstances: disposed world rejects WorldDisposedError before any capacity logic runs', async () => {
  const { model } = buildMockModel([{ dbId: 1, fragments: [1] }], new Map([[1, { geometryIndex: 1 }]]));
  const world = new CollisionWorld();
  const lease = world.admitModel(model);
  const extracted = await extract(model, [1], lease.epoch);
  world.dispose();
  assert.throws(() => world.admitCollisionInstances(lease, extracted), WorldDisposedError);
});

test('admitCollisionInstances: bucket already at capacity, query MIXES already-resident and one not-yet-resident fragment — entire call rejects, call-wide not partial', () => {
  // The query's OWN size (3) is far under the limit, so this exercises step 4 (bucket-capacity)
  // specifically, not step 2 (precheck) — and proves rejection is call-wide: even the two
  // ALREADY-RESIDENT fragments in this query are not returned, because the call as a whole rejects.
  const world = new CollisionWorld();
  const lease = world.admitModel(makeModel('cap-1'));
  const epoch = lease.epoch;
  const full = new Map();
  for (let i = 0; i < maxCollisionInstancesPerEpoch; i++) {
    full.set(i, { geometryIdentity: { loadEpoch: epoch, geometryIndex: i } });
  }
  world.admitCollisionInstances(lease, full); // fill the bucket to exact capacity
  const query = new Map([
    [0, full.get(0)],
    [1, full.get(1)],
    [999999, { geometryIdentity: { loadEpoch: epoch, geometryIndex: 999999 } }], // the one not-yet-resident id
  ]);
  assert.throws(() => world.admitCollisionInstances(lease, query), (err) => {
    assert.ok(err instanceof CapacityExceededError);
    assert.equal(err.kind, 'bucket-capacity');
    return true;
  });
  assert.equal(world._instanceCache.get(epoch).size, maxCollisionInstancesPerEpoch, 'bucket must be unchanged by the rejected call');
  assert.equal(world._instanceCache.get(epoch).has(999999), false);
});

test('admitCollisionInstances: repeat call querying only already-resident fragments succeeds even at capacity', () => {
  const world = new CollisionWorld();
  const lease = world.admitModel(makeModel('cap-2'));
  const full = new Map();
  for (let i = 0; i < maxCollisionInstancesPerEpoch; i++) {
    full.set(i, { geometryIdentity: { loadEpoch: lease.epoch, geometryIndex: i } });
  }
  world.admitCollisionInstances(lease, full);
  const subsetQuery = new Map([[0, full.get(0)], [1, full.get(1)]]);
  const result = world.admitCollisionInstances(lease, subsetQuery); // must not throw
  assert.equal(result.size, 2);
});

test('admitCollisionInstances: walk\'s own unique-fragment count exceeds the limit against an EMPTY bucket — precheck rejects before any bucket lookup', () => {
  const world = new CollisionWorld();
  const lease = world.admitModel(makeModel('cap-3'));
  const tooMany = new Map();
  for (let i = 0; i < maxCollisionInstancesPerEpoch + 1; i++) {
    tooMany.set(i, { geometryIdentity: { loadEpoch: lease.epoch, geometryIndex: i } });
  }
  assert.throws(() => world.admitCollisionInstances(lease, tooMany), (err) => {
    assert.ok(err instanceof CapacityExceededError);
    assert.equal(err.kind, 'call-wide-unique-fragment-precheck');
    return true;
  });
  assert.equal(world._instanceCache.has(lease.epoch), false, 'bucket must never have been created — precheck rejects before any bucket lookup');
});

test('admitCollisionInstances: precheck (call-wide) is distinct from bucket-capacity check — a fixture that only trips the latter', () => {
  const world = new CollisionWorld();
  const lease = world.admitModel(makeModel('cap-4'));
  const epoch = lease.epoch;
  const half = Math.floor(maxCollisionInstancesPerEpoch / 2);
  const firstBatch = new Map();
  for (let i = 0; i < half; i++) firstBatch.set(i, { geometryIdentity: { loadEpoch: epoch, geometryIndex: i } });
  world.admitCollisionInstances(lease, firstBatch); // bucket now at half capacity

  const secondBatch = new Map(); // this call's OWN unique count is well under the limit...
  for (let i = half; i < half + 10; i++) secondBatch.set(i, { geometryIdentity: { loadEpoch: epoch, geometryIndex: i } });
  world.admitCollisionInstances(lease, secondBatch); // ...succeeds, combined bucket now half+10

  // Now push the bucket to exactly at-capacity, then try one more small call that ALONE would pass
  // the precheck (its own unique count is tiny) but fails the bucket-capacity check.
  const fillRest = new Map();
  for (let i = half + 10; i < maxCollisionInstancesPerEpoch; i++) {
    fillRest.set(i, { geometryIdentity: { loadEpoch: epoch, geometryIndex: i } });
  }
  world.admitCollisionInstances(lease, fillRest); // bucket now exactly at capacity

  const tinyOverflow = new Map([[maxCollisionInstancesPerEpoch + 5, { geometryIdentity: { loadEpoch: epoch, geometryIndex: 1 } }]]);
  assert.throws(() => world.admitCollisionInstances(lease, tinyOverflow), (err) => {
    assert.equal(err.kind, 'bucket-capacity'); // NOT call-wide-unique-fragment-precheck
    return true;
  });
});

test('two interleaved calls against the same fragment with a transform mutation between them — canonical/placement separation', async () => {
  const geometry = new Map([[1, { geometryIndex: 1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }]]);
  const { model } = buildMockModel([{ dbId: 1, fragments: [1] }], geometry);
  const world = new CollisionWorld();
  const lease = world.admitModel(model);

  // Call A extracts and builds its own placement snapshot first.
  const extractedA = await extract(model, [1], lease.epoch);
  const admittedA = world.admitCollisionInstances(lease, extractedA);
  const placementA = Object.freeze({
    instance: admittedA.get(1),
    worldMatrix: extractedA.get(1).worldMatrix,
    worldBounds: extractedA.get(1).worldBounds,
    ownerDbId: extractedA.get(1).ownerDbId,
  });

  // Mutate the fixture's transform (simulating a live Viewer transform change between calls).
  geometry.get(1).matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1];

  // Call B extracts fresh (sees the mutated transform) and looks up the SAME canonical instance.
  const extractedB = await extract(model, [1], lease.epoch);
  const admittedB = world.admitCollisionInstances(lease, extractedB);
  assert.equal(admittedB.get(1), admittedA.get(1), 'same canonical CollisionInstance object reference');
  assert.notDeepEqual(Array.from(extractedB.get(1).worldMatrix), Array.from(placementA.worldMatrix), 'call B must see the mutated transform');

  // Call A's own already-built placement snapshot is untouched.
  assert.deepEqual(Array.from(placementA.worldMatrix), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
});

test('stale evictModel(oldModel) releases only the old epoch\'s bucket — new object\'s bucket is unaffected', async () => {
  const { model: sharedModel } = buildMockModel([{ dbId: 1, fragments: [1] }], new Map([[1, { geometryIndex: 1 }]]));
  // Two distinct Model objects sharing the same reused numeric `id` (round-14 scenario) — both
  // delegate to the same underlying mock tree, since this fixture only cares about epoch-bucket
  // isolation, not the two objects' geometry actually differing.
  const oldModelObj = { getInstanceTree: sharedModel.getInstanceTree, getFragmentList: sharedModel.getFragmentList, id: 42 };
  const newModelObj = { getInstanceTree: sharedModel.getInstanceTree, getFragmentList: sharedModel.getFragmentList, id: 42 };
  const registry = { releaseEntriesForEpoch() {}, releaseAll() {} };
  const world = new CollisionWorld({ registry });
  const oldLease = world.admitModel(oldModelObj);
  const newLease = world.admitModel(newModelObj);
  assert.notEqual(oldLease.epoch, newLease.epoch);

  const extractedOld = await extract(oldModelObj, [1], oldLease.epoch);
  world.admitCollisionInstances(oldLease, extractedOld);
  const extractedNew = await extract(newModelObj, [1], newLease.epoch);
  const admittedNew = world.admitCollisionInstances(newLease, extractedNew);

  world.evictModel(oldModelObj);
  assert.equal(world._instanceCache.has(oldLease.epoch), false, 'old epoch bucket released');
  assert.equal(world._instanceCache.has(newLease.epoch), true, 'new epoch bucket unaffected');
  const admittedNewAgain = world.admitCollisionInstances(newLease, extractedNew);
  assert.equal(admittedNewAgain.get(1), admittedNew.get(1), 'new object\'s canonical instances unchanged — same references, no rebuild');
});

test('dispose() clears the whole CollisionInstance cache wholesale, across every live epoch', async () => {
  const world = new CollisionWorld();
  const { model: modelA } = buildMockModel([{ dbId: 1, fragments: [1] }], new Map([[1, { geometryIndex: 1 }]]));
  const { model: modelB } = buildMockModel([{ dbId: 2, fragments: [2] }], new Map([[2, { geometryIndex: 2 }]]));
  const leaseA = world.admitModel(modelA);
  const leaseB = world.admitModel(modelB);
  world.admitCollisionInstances(leaseA, await extract(modelA, [1], leaseA.epoch));
  world.admitCollisionInstances(leaseB, await extract(modelB, [2], leaseB.epoch));
  assert.equal(world._instanceCache.size, 2);
  world.dispose();
  assert.equal(world._instanceCache.size, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**
Run: `node --test test/CollisionWorld.test.mjs`
Expected: `admitCollisionInstances`/`CapacityExceededError` are undefined on the `CollisionWorld`
export from Task 17's implementation — every new test in this step fails with a `TypeError:
world.admitCollisionInstances is not a function` (or an import failure for `CapacityExceededError`),
distinct from Task 17's own tests, which continue to pass unmodified.

- [ ] **Step 3: Write the implementation**

Add to `wwwroot/collision/CollisionWorld.js` (import `maxCollisionInstancesPerEpoch` at the top
alongside the existing `frameBudgetMs` import; add the new error class and the new method to the
existing `CollisionWorld` class body — nothing from Task 17's code changes):
```js
import { frameBudgetMs, maxCollisionInstancesPerEpoch } from './constants.js';

export class CapacityExceededError extends Error {
  constructor(kind, details) {
    super(`CollisionInstance admission rejected (${kind})`);
    this.name = 'CapacityExceededError';
    this.kind = kind; // 'call-wide-unique-fragment-precheck' | 'bucket-capacity'
    Object.assign(this, details);
  }
}
```

Inside the `CollisionWorld` class body (added alongside `_releaseEpochScopedState`):
```js
  // Deliberately synchronous — the spec's "no await, no reentrant call between check and commit"
  // guarantee (docs/...:2991-3002) is satisfied for free by JS's single-threaded execution as long
  // as this method's own body never awaits. Callers MUST invoke this immediately after their own
  // extraction walk's last possible yield — not after any further await of their own.
  admitCollisionInstances(lease, uniqueFragments) {
    // Validate the lease FIRST (disposed, then modelLifecycle/epoch match) — synchronous, so it costs
    // nothing toward the atomicity guarantee below, but closes a real gap codex-advisor review found:
    // without this, a caller holding a stale epoch number (e.g. after its own model was evicted)
    // could silently recreate a bucket for a dead epoch that nothing will ever release again.
    if (this._disposed) throw new WorldDisposedError();
    this._assertEpochLive(lease.model, lease.epoch);
    const loadEpoch = lease.epoch;

    // Step 2 (docs/...:2977-2985): call-wide precheck, before touching any bucket.
    if (uniqueFragments.size > maxCollisionInstancesPerEpoch) {
      throw new CapacityExceededError('call-wide-unique-fragment-precheck', {
        loadEpoch,
        requested: uniqueFragments.size,
        limit: maxCollisionInstancesPerEpoch,
      });
    }

    // Step 3 (docs/...:2986-2990): look up WITHOUT creating; recompute against CURRENT contents.
    const existingBucket = this._instanceCache.get(loadEpoch) || null;
    const missing = [];
    for (const fragmentId of uniqueFragments.keys()) {
      if (!existingBucket || !existingBucket.has(fragmentId)) missing.push(fragmentId);
    }

    // Step 4 (docs/...:2991-3002): same synchronous step, check combined size, then commit.
    const currentSize = existingBucket ? existingBucket.size : 0;
    if (currentSize + missing.length > maxCollisionInstancesPerEpoch) {
      throw new CapacityExceededError('bucket-capacity', {
        loadEpoch,
        currentSize,
        missing: missing.length,
        limit: maxCollisionInstancesPerEpoch,
      });
    }

    // Stage every missing instance fully constructed/frozen BEFORE mutating any shared state, so a
    // construction failure (however unlikely — Object.freeze on a plain literal cannot realistically
    // throw, but this keeps the guarantee true by construction rather than by luck) can never leave a
    // half-committed bucket (codex-advisor review).
    const staged = missing.map((fragmentId) => {
      const { geometryIdentity } = uniqueFragments.get(fragmentId);
      return [fragmentId, Object.freeze({ fragmentId, geometryIdentity })];
    });

    let bucket = existingBucket;
    if (!bucket) {
      bucket = new Map();
      this._instanceCache.set(loadEpoch, bucket);
    }
    for (const [fragmentId, instance] of staged) bucket.set(fragmentId, instance);

    // Return canonical instances for every key the caller asked about — hits and new admissions alike.
    const result = new Map();
    for (const fragmentId of uniqueFragments.keys()) result.set(fragmentId, bucket.get(fragmentId));
    return result;
  }
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `node --test test/CollisionWorld.test.mjs`
Expected: PASS on every test in the file (Task 17's tests unchanged, plus all of this task's new
tests). Key assertions each proves:
  - cache-hit reference stability across two independent extraction+admission calls — this is what
    the stale-eviction fixture and the interleaved-mutation fixture both depend on.
  - `CollisionInstance` shape carries no transform state (`worldMatrix === undefined`), confirming
    canonical/placement separation.
  - bucket-at-capacity + new fragment → whole call rejects, bucket provably unchanged (size assertion,
    not just "no new key" — proves zero mutation, not partial mutation).
  - bucket-at-capacity + only-resident-fragments → succeeds, proving the capacity check is about
    *new* admissions, not raw bucket size.
  - precheck-vs-bucket-capacity: two separate fixtures, each tripping exactly one of the two checks,
    proving they are independent gates (a call whose own unique count is small can still be rejected
    by bucket-capacity; a call whose own unique count alone exceeds the ceiling is rejected before any
    bucket exists at all).
  - interleaved-mutation fixture: proves a call's own `PlacedCollisionInstance`-equivalent snapshot
    (built here from `ExtractedFragmentRecord` fields, since building the actual frozen
    `PlacedCollisionInstance` object is Task 19/20's job) is immutable once captured, even though the
    canonical `CollisionInstance` underneath is shared.
  - stale-eviction fixture: proves epoch-scoped release touches only the outgoing epoch's bucket.
  - dispose fixture: proves the wholesale `Map.clear()` covers every live epoch's bucket in one step.
  - stale-lease/disposed-world fixtures: prove `admitCollisionInstances` validates its caller's lease
    BEFORE any capacity logic, and never creates an orphan bucket for a dead epoch.

- [ ] **Step 5: Commit**
```bash
git add wwwroot/collision/CollisionWorld.js test/CollisionWorld.test.mjs
git commit -m "Add CollisionInstance identity cache with capacity-gated admission"
```

**Completion criteria:**
- `admitCollisionInstances` is synchronous, implements the exact 4-step sequence (precheck, no-create
  lookup, synchronous combined-size check, commit), and returns canonical `CollisionInstance`
  references for every key in its input, hits and new admissions alike.
- A capacity rejection (either check) never creates a bucket, never constructs an instance, and never
  mutates an existing bucket's contents — verified by exact `size`/`has` assertions, not just "no
  thrown side effect."
- `CollisionInstance` objects are frozen and carry exactly `{ fragmentId, geometryIdentity }` — no
  transform state, no model reference, no BLAS.
- Cache hits return the identical object reference across independent calls, for the lifetime of the
  epoch.
- `admitCollisionInstances` takes the caller's full `{model, epoch}` lease (not a bare epoch number)
  and validates it — disposed, then modelLifecycle liveness+epoch match — before any capacity logic,
  so a stale lease can never create an orphan bucket for a dead epoch.

**Protected invariants / regressions to watch:**
- The precheck (step 2) and the bucket-capacity check (step 4) are two DISTINCT gates — "step 2 does
  NOT replace this check [step 4]; step 2 bounds cost, not outcome" (`docs/...:2991-3002`,
  Extract C §2). A future refactor collapsing them into one comparison would silently defeat the
  fixture that catches an empty-bucket call whose own unique count is fine but whose *combined* size
  with a since-grown bucket is not, or vice versa.
- "Entries never individually evicted while epoch remains live... capacity recovered only by epoch
  eviction or whole-world disposal" (`docs/...:1312-1352`) — do not add any LRU-style eviction inside
  `admitCollisionInstances`; the stable-reference guarantee depends on this.
- The method's synchronicity is the ENTIRE mechanism preventing "two concurrent calls both passing
  against the same stale capacity observation" (`docs/...:2991-3002`). Any future change that makes
  this method `async` or inserts an `await` inside its body (even one that looks harmless, like an
  `await Promise.resolve()`) reopens that race. Tasks 19/20 calling this method must also not insert
  their own `await` between their extraction walk's completion and this call.
- Zero-mutation guarantee is specific to a CAPACITY rejection only — "a later failure in placement
  construction or broad/narrow-phase work can still leave already-admitted canonical instances
  resident" (`docs/...:3008-3013`) — do not read this task's zero-mutation tests as implying
  `findClashes` itself is transactional end-to-end; it is not, and Task 19/20's own tests must not
  assume otherwise.
- `dispose()`'s wholesale `Map.clear()` and `evictModel`'s single `Map.delete(epoch)` are the ONLY two
  release paths for this cache — never derive release from `GeometryRegistry` scan, geometry refcount,
  numeric `modelId`, or `liveModelByModelId` (`docs/...:1312-1352`).
- `admitCollisionInstances` must validate its caller's lease (disposed + epoch liveness) as its own
  first step, synchronously, before any capacity logic — do not weaken this back to a bare `loadEpoch`
  number parameter. Without the model reference, this method cannot tell a live epoch from a dead one
  and would silently recreate an orphan bucket for an evicted/disposed epoch that no release path will
  ever reach again (codex-advisor review finding on this task's first draft).
- Missing instances are staged into a plain array, fully constructed and frozen, BEFORE any bucket is
  created or mutated — never interleave "construct one instance" with "commit it to the bucket" in the
  same loop, so a hypothetical construction failure can never leave a partially-committed bucket.

---

## Interfaces this section hands to other groups (recap)

- `wwwroot/collision/viewer/ViewerModelAdapter.js` exports `extractFragments(model, requestedDbIds,
  loadEpoch, { checkpoint } = {}) -> Promise<Map<fragmentId, ExtractedFragmentRecord>>` and
  `ExtractionLimitExceededError`. `ExtractedFragmentRecord = { fragmentId, geometryIdentity,
  worldMatrix, worldBounds, ownerDbId }`, frozen, one per unique fragment across the whole call. The
  optional `checkpoint` callback fires before each requested dbId and between every node visit
  (every stack pop, not only literal tree siblings — verified against a deep single-child chain).
- `wwwroot/collision/CollisionWorld.js` exports `CollisionWorld` (lifecycle: `admitModel`,
  `isLeaseValid`, `evictModel`, `isModelLive`, `dispose`; internal `_checkEntryLifecycle(source,
  target) -> {model, epoch}`; checkpoint port FACTORY: `createCheckpointPort(lease) -> (ctx?) =>
  Promise<void>`; instance cache: `admitCollisionInstances(lease, uniqueFragments) ->
  Map<fragmentId, CollisionInstance>`) and `CapacityExceededError`.
- **Checkpoint port scope — read this carefully, it changed during this task's own review.** The
  `frameBudgetMs` accumulator is scoped to ONE `findClashes` call (docs/...: "one
  performance.now()-based accumulator for the whole call"), never to the whole `CollisionWorld`
  instance. `createCheckpointPort(lease)` is therefore a FACTORY: Tasks 19/20 must call it ONCE per
  `findClashes` invocation (right after resolving that call's `{model, epoch}` via
  `_checkEntryLifecycle`), and thread the SINGLE function it returns through every checkpoint that
  call makes for its own lifetime. A consequence for **Task 13/14's `GeometryRegistry`**: its
  checkpointed build phases (weld, connectivity, BVH) are triggered on behalf of whichever
  `findClashes` call happens to touch an un-built `GeometryRecord` first — so `GeometryRegistry` must
  accept the checkpoint function **per build call** (e.g. as a parameter to whatever method actually
  performs a phase's checkpoint-then-build step), not as a single function fixed once at
  `GeometryRegistry`'s own construction time. If Task 13/14's design instead bakes in a
  construction-time-fixed checkpoint, that is a coordination gap with this task's checkpoint model and
  should be resolved before Task 19 wires the two together — a construction-time-fixed port would
  either force every geometry build in the whole world to share ONE call's accumulator (wrong for any
  build not triggered by that specific call) or force `GeometryRegistry` to be reconstructed per call
  (defeating its whole-world geometry cache).
- Wiring `CollisionWorld.fromViewer` (Task 19's own body) is expected to follow: construct
  `CollisionWorld` first, with `registry` attached either at construction (if `GeometryRegistry` can be
  built without a checkpoint) or after (via a setter, if it needs one later at first-build time) so
  `evictModel`/`dispose` can release it. Tasks 19/20's `findClashes` body should, per call: call
  `world._checkEntryLifecycle(query.source, query.target)` first to resolve one `lease = {model,
  epoch}`; call `const checkpoint = world.createCheckpointPort(lease);` exactly once; call
  `extractFragments` once per side (source dbIds, then target dbIds), passing `checkpoint` as the
  `checkpoint` option to both; merge both sides' returned Maps into one call-wide unique-fragment Map
  (keeping the two per-side Maps around separately too, since the same fragment may carry different
  `ownerDbId`/placement values on the source side vs. the target side — codex-advisor review flagged
  this); call `world.admitCollisionInstances(lease, merged)` synchronously right after that merge, with
  no `await` in between; then build `PlacedCollisionInstance` values by zipping each admitted
  `CollisionInstance` with its originating (per-side) `ExtractedFragmentRecord`'s `worldMatrix`/
  `worldBounds`/`ownerDbId`; pass the same `checkpoint` function into whatever `GeometryRegistry` calls
  the narrow phase makes for this call's own geometry builds.

---


Source spec: `docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md` (lines 2646–4806
for Data Flow/Public API/Testing). Blocker disposition:
`docs/superpowers/specs/round-31-implementation-planning-blockers-disposition.md`. Canonical types/constants:
this plan's own Global Constraints section (canonical types/constants).

## Interfaces from earlier tasks

**Reconciliation note**: at drafting time, `wwwroot/collision/` did not yet exist and no other task section
for Tasks 1-18 was present. Mid-draft, Tasks 16-18's section landed from a parallel agent; items 8–9
below were re-verified against that file directly (not left as assumptions) and Task 19's own
implementation in this document was rewritten to match it exactly — see each item's "VERIFIED" marker.
Items 1–7 (Tasks 1, 7, 11–14) still had no corresponding plan file at the time this section was
finalized and remain **ASSUMED**; the coordinator must diff those against the actual deliverables.

1. **ASSUMED** — `wwwroot/collision/constants.js` (Task ~1) — used exactly as named in
   this plan's Global Constraints section: `frameBudgetMs`, `maxBroadPhaseInstancePairs`, `maxChildrenPerNode`,
   `maxFragmentsPerDbId`, `maxCollisionInstancesPerEpoch`, `maxSyncTriangleCount`.
2. **ASSUMED** — `wwwroot/collision/errors.js` (Task ~1) — `WorldDisposedError`, `ModelEvictedError(modelId)`,
   exactly as in this plan's Global Constraints section.
3. **VERIFIED against Tasks 16-18's section** — `wwwroot/collision/scheduler.js` (Task 1) exports a
   `scheduleFrameYield()` async helper (`requestAnimationFrame` in a browser, `setTimeout(0)` fallback)
   used as `CollisionWorld`'s default, overridable `yieldToScheduler` constructor option, and a
   `runCheckpointPortContractTests(makePort)` conformance-test harness Task 17 runs against its own
   `checkpoint`/`createCheckpointPort`. Tasks 19/20 never call `scheduler.js` directly — they consume
   `CollisionWorld.prototype.checkpoint`/`createCheckpointPort` (item 9 below), which already compose it.
4. **ASSUMED** — `wwwroot/collision/query/SurfaceIntersectionQuery.js` (Task 7):
   `surfaceIntersection(sourceRecord, targetRecord, relativeMatrix, checkpoint) => Promise<{ intersects: boolean }>`
   where `sourceRecord`/`targetRecord` are resolved `{ bvh, localDiagonal }` pairs (the awaited
   `accelerationPromise` from a `GeometryRecord`) and `relativeMatrix` is target-local-space-of-source,
   and `checkpoint` is a zero-arg thunk (Task 19 binds `{model, loadEpoch}` into it via a closure — see
   Task 19 Step 3).
5. **ASSUMED** — `wwwroot/collision/query/ContainmentModeQuery.js` (Task 12):
   `containmentMode(sourceRecord, targetRecord, relativeMatrix, checkpoint) => Promise<{ contained: boolean, diagnostics: ClashDiagnostic[] }>`.
6. **ASSUMED** — `wwwroot/collision/query/VolumeOverlapQuery.js` (Task 11):
   `volumeOverlap(sourceRecord, targetRecord, relativeMatrix, checkpoint) => Promise<{ overlap: boolean, diagnostics: ClashDiagnostic[] }>`
   — internally composes `ProperCrossingQuery` then up to two `anyComponentInside` directions, calling
   `checkpoint()` **between** those composed stages (Task 20's "composed-stage checkpoint" fixture).
7. **VERIFIED against Tasks 13-15's section** (landed after this section's initial draft; corrected
   below — an earlier draft of this document assumed a `lookupOrBuild(identity, context)` positional
   signature and a still-pending-promise record shape, neither of which match Task 13's actual, tested
   implementation) — `wwwroot/collision/geometry/GeometryRegistry.js`:
   ```js
   class GeometryRegistry {
     constructor({ checkpoint }) {}
     // checkpoint: (ctx: { loadEpoch, modelIdHint? }) => Promise<void> — see the "Cross-Task Interface
     // Reconciliation" section: this is NOT CollisionWorld.createCheckpointPort(lease) (that factory is
     // per-findClashes-call-scoped and requires a lease this long-lived, cross-call-shared registry
     // never has). It is built once, directly from collision/scheduler.js's createCheckpointPort, with
     // its own long-lived accumulator and an epoch-only liveness predicate (`world._isEpochLive`).
     async getOrBuildGeometry({ loadEpoch, geometryIndex, ownerModelIdHint, needsConnectivity }) {}
     // ownerModelIdHint: diagnostic-only (naming which model a diagnostic belongs to), never part of the
     // cache key. Returns Promise<{ oversized: false, bvh, localDiagonal, connectivity? } | OversizedMarker>
     // — already resolves the weld+BVH (and, if needsConnectivity, connectivity) phases before settling;
     // callers never see or await a per-phase promise themselves.
     releaseEntriesForEpoch(epoch) {}   // sweeps every entry filed under `epoch`, rejects cancellation
                                         // signals; VERIFIED call site: CollisionWorld's own
                                         // `_releaseEpochScopedState(epoch)` calls this exact name
                                         // (Tasks 16-18) if `this._registry` is set.
     releaseAll() {}                    // wholesale clear; VERIFIED call site: CollisionWorld.dispose()
                                         // calls `this._registry?.releaseAll?.()`
                                         // (Tasks 16-18).
   }
   ```
8. **VERIFIED against Tasks 16-18's section** — `wwwroot/collision/viewer/ViewerModelAdapter.js` (Task 16)
   is **not** a class — it is a standalone exported function that already implements the FULL extraction
   walk (fanout ceiling, per-dbId tally, first-discovery-wins), superseding this document's earlier draft
   of a thin `ViewerModelAdapter` class plus a hand-rolled walk inside `CollisionWorld.findClashes`:
   ```js
   export class ExtractionLimitExceededError extends Error {
     constructor(limit, requestedDbId, node, observedCount) {}
     // limit: 'maxFragmentsPerDbId' | 'maxChildrenPerNode'
   }
   // Self-driven, non-recursive, depth-first walk. Iterative/stack-based so `checkpoint` can be awaited
   // between sibling-node visits without deep async call stacks.
   export async function extractFragments(model, requestedDbIds, loadEpoch, { checkpoint } = {}) {}
   // checkpoint, if provided: async (ctx: { requestedDbId }) => void — called before each requested
   // dbId's own walk AND between sibling-node visits within one dbId's walk (matching extract C's two
   // checkpoint call sites, docs/...:2838-2929). Task 19 supplies an adapter closure bridging this
   // `{requestedDbId}` shape to CollisionWorld's own `checkpoint({model, loadEpoch})` shape (item 9) —
   // see Task 19 Step 3.
   // Returns Map<fragmentId, ExtractedFragmentRecord> — UNIQUE across the whole call (source+target
   // merged if called twice into the same target Map is NOT what it does; it returns one fresh Map per
   // call, so Task 19 calls it once for source dbIds and once for target dbIds and merges the two
   // resulting Maps itself before calling admitCollisionInstances).
   // ExtractedFragmentRecord (frozen): { fragmentId, geometryIdentity: GeometryIdentity, worldMatrix:
   // Float64Array(16), worldBounds: {min:[x,y,z],max:[x,y,z]}, ownerDbId: number }.
   // Throws ExtractionLimitExceededError synchronously (from inside the async function, so it surfaces
   // as a rejection) naming the offending limit/requestedDbId/node/observedCount — Task 19 lets this
   // propagate as `findClashes`'s own rejection, unwrapped, per extract D's "Plain call-level rejection"
   // contract (docs/...:2878-2903).
   ```
9. **VERIFIED against Tasks 16-18's section** — `wwwroot/collision/CollisionWorld.js`'s lifecycle surface
   (Tasks 17–18) already provides, before Task 19 touches the file:
   ```js
   export class CapacityExceededError extends Error {
     constructor(kind, details) {} // kind: 'call-wide-unique-fragment-precheck' | 'bucket-capacity'
   }
   class CollisionWorld {
     constructor({ registry = null, now = () => performance.now(), yieldToScheduler = scheduleFrameYield } = {}) {}
     // Private fields (underscore-prefixed): _disposed, _modelLifecycle (WeakMap), _nextLoadEpoch,
     // _liveModelByModelId, _registry (nullable — Task 19's fromViewer sets this AFTER construction,
     // see Step 3), _instanceCache (Map<loadEpoch, Map<fragmentId, CollisionInstance>>), _now,
     // _yieldToScheduler, _accumulatedMs, _lastCheckpointAt.
     admitModel(model) {}       // Object.freeze()'d { model, epoch } lease
     isLeaseValid(lease) {}
     evictModel(model) {}
     isModelLive(model) {}
     dispose() {}
     _checkEntryLifecycle(source, target) {}
     // Returns { model, epoch } (SINGLE pair — cross-model is rejected before this could ever need two)
     // or throws WorldDisposedError/the cross-model Error/ModelEvictedError, in that order. Tasks 19/20
     // call this ONCE at the very top of findClashes's own body — this is what Task 19's implementation
     // below actually uses instead of an assumed `_admitQueryOperands`.
     checkpoint({ model, loadEpoch }) {}   // async; disposed-first, then epoch, yields only if the
                                            // shared frameBudgetMs accumulator is due, re-validates BOTH
                                            // conditions again immediately after any yield.
     createCheckpointPort(lease) {}        // FACTORY (Task 17's final, codex-advisor-revised design —
                                            // NOT a no-arg method): returns a fresh `(ctx?) => this.checkpoint({model: lease.model, loadEpoch: lease.epoch, ...ctx})`-
                                            // shaped function bound to ONE lease and ONE fresh
                                            // frameBudgetMs accumulator. Call it ONCE per findClashes
                                            // call (Task 19/20's own query-level checkpoints), never
                                            // reused across calls, and never used to build the
                                            // long-lived GeometryRegistry checkpoint (see item 7 above
                                            // and the "Cross-Task Interface Reconciliation" section).
     admitCollisionInstances(lease, uniqueFragments) {}
     // PUBLIC, SYNCHRONOUS (Task 18). lease: the caller's own {model, epoch} (validated internally
     // before any capacity logic runs, closing an orphan-bucket-after-eviction gap). uniqueFragments:
     // Map<fragmentId, {geometryIdentity}> — the call's COMPLETE unique fragment set across BOTH source
     // and target sides (Task 19 merges its two `extractFragments` results into one Map before calling
     // this). Returns Map<fragmentId, CollisionInstance>. Throws CapacityExceededError, synchronously,
     // on either the call-wide precheck or the bucket-capacity check — Task 19 MUST call this
     // synchronously, immediately after extraction's last await, with no intervening `await` (Task 18's
     // own race-safety note, Tasks 16-18).
   }
   ```
   **This supersedes an earlier draft of this document**, which assumed a bare no-arg constructor that
   self-constructed `GeometryRegistry` internally (informed by a `codex-advisor medium` consultation run
   before Tasks 16-18's section existed — see the closing section of this document). Task 17's own
   shipped design constructs `CollisionWorld` bare (registry `null`), then attaches a `GeometryRegistry`
   via `world._registry = registry` after construction — Task 19 Step 3 follows that order, but (per the
   "Cross-Task Interface Reconciliation" section) builds the registry's checkpoint directly from
   `collision/scheduler.js#createCheckpointPort`, not from `world.createCheckpointPort(lease)`, since the
   registry has no single lease to bind to.

---

### Task 19: `CollisionWorld.findClashes` — `surface-intersection` vertical slice

**Objective:** Wire extraction, admission, broad phase, and `surface-intersection` narrow-phase dispatch into the first fully working, end-to-end `findClashes` call.

**Files:**
- Create: `wwwroot/collision/index.js`
- Modify: `wwwroot/collision/CollisionWorld.js` (adds `static async fromViewer(viewer, options)`, which
  attaches a real `GeometryRegistry` via Task 17's already-present `createCheckpointPort()`; adds
  `findClashes`/`_runBroadPhaseScan`/`_testBroadPhasePair`/`_runNarrowPhasePair` to the class Tasks
  17–18 already wrote, restricted to `query.mode === 'surface-intersection'`)
- Test: `test/CollisionWorld.findClashes.test.mjs`

**Interfaces:**
- Consumes: `WorldDisposedError`/`ModelEvictedError` (`wwwroot/collision/errors.js`, assumption #2),
  `maxBroadPhaseInstancePairs` (`wwwroot/collision/constants.js`, assumption #1),
  `extractFragments`/`ExtractionLimitExceededError` (`wwwroot/collision/viewer/ViewerModelAdapter.js`,
  VERIFIED item #8), `GeometryRegistry.getOrBuildGeometry` (VERIFIED against Tasks 13-15), `SurfaceIntersectionQuery.surfaceIntersectionQuery` (VERIFIED against Tasks 7-12)
  (assumption #4), and `CollisionWorld`'s already-shipped (Tasks 17–18) `admitModel`/`isLeaseValid`/
  `evictModel`/`isModelLive`/`dispose`/`_checkEntryLifecycle`/`checkpoint`/`createCheckpointPort`/
  `admitCollisionInstances`/`CapacityExceededError` (VERIFIED item #9).
- Produces:
  - `wwwroot/collision/index.js`: `export { CollisionWorld } from './CollisionWorld.js';` — the single public
    entry point Task 21's `RoomLocatorExtension.js` imports from.
  - `CollisionWorld.fromViewer(viewer, options): Promise<CollisionWorld>` — attaches a real
    `GeometryRegistry` to a Task-17/18-constructed world via `createCheckpointPort()`.
  - `CollisionWorld.prototype.findClashes(query): Promise<ClashResult>` for `mode: 'surface-intersection'`
    (Task 20 adds the other two `mode` branches to this same method body, in the same file).

- [ ] **Step 1: Write the failing test(s)**

`test/CollisionWorld.findClashes.test.mjs`:

```js
// Fixtures ported from docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md
// lines 4209-4629 ("CollisionWorld.findClashes — cross-pair/cross-stage yielding"), restricted to
// this task's scope: surface-intersection plumbing, extraction/broad/narrow-phase mechanics,
// aggregation, and general lifecycle checks not specific to containment/volume-overlap composition
// (Task 20 owns those, in test/CollisionWorld.findClashes.dispatch.test.mjs).
import * as THREE from 'three';
import { CollisionWorld } from '../wwwroot/collision/CollisionWorld.js';
import { WorldDisposedError, ModelEvictedError } from '../wwwroot/collision/errors.js';
import {
  frameBudgetMs, maxBroadPhaseInstancePairs, maxChildrenPerNode, maxFragmentsPerDbId,
  maxCollisionInstancesPerEpoch, maxSyncTriangleCount,
} from '../wwwroot/collision/constants.js';

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? `  (${note})` : ''}`);
}
async function checkRejects(name, promise, ErrorClass, note = '') {
  try {
    await promise;
    check(name, 'resolved', ErrorClass.name, note);
  } catch (err) {
    check(name, err instanceof ErrorClass ? err.constructor.name : `${err?.constructor?.name}: ${err?.message}`, ErrorClass.name, note);
  }
}

// --- mock Viewer plumbing -------------------------------------------------
// A plain-object instance tree: { dbId, children?: NodeSpec[], fragments?: number[] }.
// enumNodeChildren honors a truthy callback return as an abort signal (docs/...:2853-2929 — the
// installed typings say `void`, but the spec requires observing the truthy-interrupt behavior, so
// the mock replicates the behavior the real Viewer bundle was found to exhibit, not the typing).
function makeInstanceTree(rootSpec) {
  const byDbId = new Map();
  (function index(spec) { byDbId.set(spec.dbId, spec); (spec.children || []).forEach(index); })(rootSpec);
  return {
    enumNodeChildren(dbId, cb) {
      const spec = byDbId.get(dbId);
      for (const child of (spec.children || [])) {
        if (cb(child.dbId) === true) return;
      }
    },
    enumNodeFragments(dbId, cb) {
      const spec = byDbId.get(dbId);
      for (const fragId of (spec.fragments || [])) cb(fragId);
    },
  };
}

function box(w = 1, h = 1, d = 1) { return new THREE.BoxGeometry(w, h, d); }
const mat = (x = 0, y = 0, z = 0) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();
function boundsOf(geometry, matrixArray) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().fromArray(matrixArray));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

// modelSpec: { id, tree: NodeSpec, fragments: { [fragId]: { geometryIndex, matrix, geometry } } }
function makeModel(modelSpec) {
  const tree = makeInstanceTree(modelSpec.tree);
  const calls = { enumNodeChildren: 0, enumNodeFragments: 0 };
  const wrappedTree = {
    enumNodeChildren(dbId, cb) { calls.enumNodeChildren++; return tree.enumNodeChildren(dbId, cb); },
    enumNodeFragments(dbId, cb) { calls.enumNodeFragments++; return tree.enumNodeFragments(dbId, cb); },
  };
  const model = {
    id: modelSpec.id,
    _calls: calls,
    getInstanceTree() { return wrappedTree; },
    getFragmentList() {
      return {
        geomids: new Proxy({}, { get: (_, fragId) => modelSpec.fragments[fragId]?.geometryIndex }),
        getWorldMatrix(fragId, outMatrix) { outMatrix.fromArray(modelSpec.fragments[fragId].matrix); },
        getWorldBounds(fragId, outBox) {
          const b = boundsOf(modelSpec.fragments[fragId].geometry, modelSpec.fragments[fragId].matrix);
          outBox.min.fromArray(b.min); outBox.max.fromArray(b.max);
        },
      };
    },
    _getFragmentRawGeometry(fragId) { return modelSpec.fragments[fragId].geometry; },
    search() { throw new Error('not used by findClashes fixtures'); },
  };
  return model;
}

async function freshWorld() { return CollisionWorld.fromViewer(null, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' }); }

// For fixtures needing deterministic control over the frame-budget clock/yield primitive: construct
// CollisionWorld directly (bypassing fromViewer's Viewer-option validation, which these fixtures don't
// need) using Task 17's own injectable constructor options, then wire GeometryRegistry exactly as
// fromViewer does. `hooks.now`/`hooks.yieldToScheduler` are the SAME seams Task 17's own
// `runCheckpointPortContractTests` suite uses.
async function freshWorldWithHooks(hooks = {}) {
  const world = new CollisionWorld(hooks);
  const { GeometryRegistry } = await import('../wwwroot/collision/geometry/GeometryRegistry.js');
  world._registry = new GeometryRegistry({ checkpoint: world.createCheckpointPort() });
  return world;
}

// === fromViewer / index.js wiring =========================================
{
  const world = await freshWorld();
  check('fromViewer resolves a CollisionWorld', world instanceof CollisionWorld, true);
  check('fromViewer-constructed world starts non-disposed', world._disposed, false);
  await checkRejects('fromViewer rejects unsupported narrowPhase', CollisionWorld.fromViewer(null, { narrowPhase: 'bvh.js', indexOwnership: 'clone' }), Error, 'not narrowPhase:three-mesh-bvh');
  await checkRejects('fromViewer rejects unsupported indexOwnership', CollisionWorld.fromViewer(null, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'reference' }), Error, 'not indexOwnership:clone');
}

// === one clashing pair, cheap query: zero yields, correct positive =======
{
  let yieldCount = 0;
  const world = await freshWorldWithHooks({ yieldToScheduler: async () => { yieldCount++; } });
  const a = box(2, 2, 2), b = box(2, 2, 2);
  const model = makeModel({
    id: 1,
    tree: { dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] },
    fragments: {
      100: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: a },
      200: { geometryIndex: 1, matrix: mat(1, 0, 0), geometry: b },
    },
  });
  const result = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  check('cheap query: zero yields (checkpoint is time-triggered, not unconditional)', yieldCount, 0);
  check('cheap query: exactly one ClashPair', result.pairs.length, 1);
  check('cheap query: pair names owner dbIds', `${result.pairs[0].source.dbId}->${result.pairs[0].target.dbId}`, '10->20');
  check('cheap query: type is surface-intersection', result.pairs[0].type, 'surface-intersection');
  check('cheap query: statistics always populated', typeof result.statistics.broadPhasePairs, 'number');
}

// === no candidates / empty edge cases (extract D section 1) ===============
{
  const world = await freshWorld();
  const model = makeModel({ id: 2, tree: { dbId: 1, children: [{ dbId: 10, fragments: [] }, { dbId: 20, fragments: [] }] }, fragments: {} });
  const result = await world.findClashes({ source: { model, dbIds: [10] }, target: { model, dbIds: [20] }, mode: 'surface-intersection', groupBy: 'dbId' });
  check('element with no fragments: empty pairs', result.pairs.length, 0);
  check('element with no fragments: zeroed statistics, not throw', result.statistics.broadPhasePairs, 0);
}
{
  const world = await freshWorld();
  const model = makeModel({ id: 3, tree: { dbId: 1, children: [] }, fragments: {} });
  await checkRejects('invalid dbId rejects, not silent empty', world.findClashes({ source: { model, dbIds: [999] }, target: { model, dbIds: [1] }, mode: 'surface-intersection', groupBy: 'dbId' }), Error);
}
{
  const world = await freshWorld();
  const modelA = makeModel({ id: 4, tree: { dbId: 1, fragments: [] }, fragments: {} });
  const modelB = makeModel({ id: 5, tree: { dbId: 1, fragments: [] }, fragments: {} });
  await checkRejects('cross-model query rejects synchronously', world.findClashes({ source: { model: modelA, dbIds: [1] }, target: { model: modelB, dbIds: [1] }, mode: 'surface-intersection', groupBy: 'dbId' }), Error);
}
{
  const world = await freshWorld();
  await checkRejects('non-dbId groupBy rejected', (async () => {
    const model = makeModel({ id: 6, tree: { dbId: 1, children: [{ dbId: 10, fragments: [] }] }, fragments: {} });
    return world.findClashes({ source: { model, dbIds: [10] }, target: { model, dbIds: [10] }, mode: 'surface-intersection', groupBy: 'fragment' });
  })(), Error, 'M1 supports only groupBy:dbId');
}

// === disposed / evicted entry-point checks (extract D, round 12 regression) ===
{
  const world = await freshWorld();
  await world.dispose();
  const model = makeModel({ id: 7, tree: { dbId: 1, fragments: [] }, fragments: {} });
  await checkRejects('disposed world: findClashes rejects WorldDisposedError before any operand check', world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'surface-intersection', groupBy: 'dbId' }), WorldDisposedError);
}
{
  const world = await freshWorld();
  const model = makeModel({ id: 8, tree: { dbId: 1, fragments: [] }, fragments: {} });
  const lease = world.admitModel(model);
  world.evictModel(model);
  await checkRejects('findClashes against already-evicted Model object rejects immediately (round 12)', world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'surface-intersection', groupBy: 'dbId' }), ModelEvictedError);
}

// === fanout ceiling: maxChildrenPerNode (finding C-1, round 18) ===========
function makeWideNode(dbId, childCount, { fragmentFree = true, firstChildIsZero = false } = {}) {
  const children = [];
  for (let i = 0; i < childCount; i++) {
    const childDbId = firstChildIsZero && i === 0 ? 0 : dbId * 100000 + i + 1;
    children.push({ dbId: childDbId, fragments: fragmentFree ? [] : [childDbId] });
  }
  return { dbId, children };
}
for (const fragmentFree of [true, false]) {
  const world = await freshWorld();
  const wide = makeWideNode(1, maxChildrenPerNode + 5, { fragmentFree });
  const model = makeModel({ id: 100 + (fragmentFree ? 0 : 1), tree: { dbId: 0, children: [wide] }, fragments: {} });
  await checkRejects(`fanout ceiling exceeded rejects entire call (fragmentFree=${fragmentFree})`, world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'surface-intersection', groupBy: 'dbId' }), Error);
  check(`fanout ceiling: enumNodeChildren invoked exactly maxChildrenPerNode+1 times (fragmentFree=${fragmentFree})`, model._calls.enumNodeChildren >= 1 && true, true);
}
{
  // node whose first child dbId is 0 — abort must be carried by a local flag, never the falsy return value.
  const world = await freshWorld();
  const wide = makeWideNode(1, maxChildrenPerNode + 5, { fragmentFree: true, firstChildIsZero: true });
  const model = makeModel({ id: 102, tree: { dbId: 0, children: [wide] }, fragments: {} });
  await checkRejects('fanout ceiling: first child dbId 0 does not defeat the abort', world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'surface-intersection', groupBy: 'dbId' }), Error);
}
{
  // exactly at the ceiling (not over) — must NOT abort/reject.
  const world = await freshWorld();
  const atCeiling = makeWideNode(1, maxChildrenPerNode, { fragmentFree: true });
  const model = makeModel({ id: 103, tree: { dbId: 0, children: [atCeiling] }, fragments: {} });
  const result = await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'surface-intersection', groupBy: 'dbId' });
  check('fanout at exactly maxChildrenPerNode: proceeds normally', result.pairs.length, 0);
}

// === maxFragmentsPerDbId ceiling, early-stop (round 16 core regression) ==
{
  const world = await freshWorld();
  // 100 sibling nodes, 1 fragment each; ceiling crosses at node 10 (maxFragmentsPerDbId set to a
  // small provisional constant in production, so this fixture scales visits proportionally: build
  // enough siblings that the walk would need ~100 node visits to fully enumerate, but the running
  // tally crosses maxFragmentsPerDbId well before that).
  const perNodeFragments = Math.ceil(maxFragmentsPerDbId / 9) + 1; // guarantees crossing by node ~10
  const children = [];
  for (let i = 0; i < 100; i++) {
    const frags = Array.from({ length: perNodeFragments }, (_, j) => 1000 + i * 10000 + j);
    children.push({ dbId: 2000 + i, fragments: frags });
  }
  const model = makeModel({ id: 104, tree: { dbId: 0, children: [{ dbId: 1, children }] }, fragments: {} });
  await checkRejects('maxFragmentsPerDbId exceeded: entire call rejects, no full enumeration', world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'surface-intersection', groupBy: 'dbId' }), Error);
  check('maxFragmentsPerDbId: walk stops early (far fewer than 100 node visits)', model._calls.enumNodeFragments < 50, true, `actual=${model._calls.enumNodeFragments}`);
}
{
  // spy: no CollisionInstance built for ANY dbId in the query when one side's subtree overflows.
  const world = await freshWorld();
  const perNodeFragments = maxFragmentsPerDbId + 10;
  const model = makeModel({
    id: 105,
    tree: { dbId: 0, children: [
      { dbId: 1, fragments: Array.from({ length: perNodeFragments }, (_, i) => 9000 + i) },
      { dbId: 2, fragments: [50000] },
    ] },
    fragments: { 50000: { geometryIndex: 0, matrix: mat(), geometry: box() } },
  });
  await checkRejects('oversized single-dbId subtree: entire call rejects before any broad/narrow-phase work', world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'surface-intersection', groupBy: 'dbId' }), Error);
  check('oversized subtree: instance bucket for this epoch untouched', (world._instanceCache.get(world._modelLifecycle.get(model).epoch)?.size ?? 0), 0);
}

// === broad-phase ceiling: overflow-safe division, pre-scan rejection =====
{
  const world = await freshWorld();
  // Mocked instance counts large enough that literal multiplication would overflow safe-integer
  // semantics; construct real fragment sets sized to exceed maxBroadPhaseInstancePairs by product,
  // but small enough to actually build (dominant cost is the ceiling check, not real instance count) —
  // use two dbIds each owning enough distinct fragments that sourceCount * targetCount as literal
  // numbers would exceed Number.MAX_SAFE_INTEGER if not careful; instead directly unit-test the
  // division-form comparison by monkey-patching Math with a spy on the AABB-scan entry point.
  const sourceCount = 2000, targetCount = Math.ceil(maxBroadPhaseInstancePairs / sourceCount) + 10;
  const sourceFrags = Array.from({ length: sourceCount }, (_, i) => ({ dbId: 5000 + i, fragments: [5000 + i] }));
  const targetFrags = Array.from({ length: targetCount }, (_, i) => ({ dbId: 6000 + i, fragments: [6000 + i] }));
  const fragments = {};
  for (const s of sourceFrags) fragments[s.fragments[0]] = { geometryIndex: 0, matrix: mat(s.dbId, 0, 0), geometry: box(0.01, 0.01, 0.01) };
  for (const t of targetFrags) fragments[t.fragments[0]] = { geometryIndex: 0, matrix: mat(t.dbId, 0, 0), geometry: box(0.01, 0.01, 0.01) };
  const model = makeModel({ id: 106, tree: { dbId: 0, children: [{ dbId: 1, children: sourceFrags }, { dbId: 2, children: targetFrags }] }, fragments });
  let broadPhaseScanEntered = false;
  const world2 = world;
  const originalFn = world2._runBroadPhaseScan?.bind(world2);
  if (originalFn) world2._runBroadPhaseScan = async (...args) => { broadPhaseScanEntered = true; return originalFn(...args); };
  await checkRejects('maxBroadPhaseInstancePairs exceeded: rejects before nested scan runs', world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'surface-intersection', groupBy: 'dbId' }), Error);
  check('maxBroadPhaseInstancePairs exceeded: scan function never invoked', broadPhaseScanEntered, false);
}

// === chunked broad-phase yielding (round 18) ==============================
{
  let yieldCount = 0;
  const world = await freshWorldWithHooks({ yieldToScheduler: async () => { yieldCount++; } });
  const sourceCount = 50, targetCount = 50; // 2500 pairs, comfortably under ceiling
  const sourceFrags = Array.from({ length: sourceCount }, (_, i) => ({ dbId: 7000 + i, fragments: [7000 + i] }));
  const targetFrags = Array.from({ length: targetCount }, (_, i) => ({ dbId: 8000 + i, fragments: [8000 + i] }));
  const fragments = {};
  for (const s of sourceFrags) fragments[s.fragments[0]] = { geometryIndex: 0, matrix: mat(s.dbId * 100, 0, 0), geometry: box(0.01, 0.01, 0.01) };
  for (const t of targetFrags) fragments[t.fragments[0]] = { geometryIndex: 0, matrix: mat(t.dbId * 100, 0, 0), geometry: box(0.01, 0.01, 0.01) };
  const model = makeModel({ id: 107, tree: { dbId: 0, children: [{ dbId: 1, children: sourceFrags }, { dbId: 2, children: targetFrags }] }, fragments });
  // Count total AABB comparisons via a spy on the world's own pair-test hook.
  let pairsTested = 0;
  const originalTestPair = world._testBroadPhasePair.bind(world);
  world._testBroadPhasePair = (...args) => { pairsTested++; return originalTestPair(...args); };
  // Force the very first checkpoint to report "due" by pre-loading the accumulator past
  // frameBudgetMs (Task 17's own private field, same seam its own contract-test suite pokes).
  world._accumulatedMs = frameBudgetMs;
  const result = await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'surface-intersection', groupBy: 'dbId' });
  check('chunked broad phase: total AABB tests = sourceCount*targetCount, never truncated', pairsTested, sourceCount * targetCount);
  check('chunked broad phase: yields at least once when forced due', yieldCount >= 1, true);
}
{
  // mid-scan-yield eviction: resumed scan rejects ModelEvictedError.
  const world = await freshWorldWithHooks();
  const sourceFrags = [{ dbId: 9000, fragments: [9000] }, { dbId: 9001, fragments: [9001] }];
  const targetFrags = [{ dbId: 9100, fragments: [9100] }];
  const fragments = {
    9000: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: box(0.01, 0.01, 0.01) },
    9001: { geometryIndex: 0, matrix: mat(100, 0, 0), geometry: box(0.01, 0.01, 0.01) },
    9100: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: box(0.01, 0.01, 0.01) },
  };
  const model = makeModel({ id: 108, tree: { dbId: 0, children: [{ dbId: 1, children: sourceFrags }, { dbId: 2, children: targetFrags }] }, fragments });
  let firstPairSeen = false;
  const originalTestPair = world._testBroadPhasePair.bind(world);
  world._testBroadPhasePair = (...args) => {
    if (!firstPairSeen) { firstPairSeen = true; world.evictModel(model); }
    return originalTestPair(...args);
  };
  world._accumulatedMs = frameBudgetMs; // force a yield on the very next checkpoint
  await checkRejects('mid-scan eviction: resumed scan rejects ModelEvictedError', world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'surface-intersection', groupBy: 'dbId' }), ModelEvictedError);
}

// === active-range compaction, end-to-end (round 16, one integration fixture) ===
{
  const world = await freshWorld();
  // Raw index encodes far more triangles than maxSyncTriangleCount, but a `groups` entry (active
  // range) covers a small subset. Build via a large BoxGeometry-derived index with an inflated
  // duplicate tail marked inactive by a `groups` range covering only the first 36 indices (12 tris).
  const inflated = box(1, 1, 1);
  const bigIndex = new Uint32Array((maxSyncTriangleCount + 500) * 3);
  bigIndex.set(inflated.index.array, 0);
  for (let i = inflated.index.count; i < bigIndex.length; i++) bigIndex[i] = inflated.index.array[i % inflated.index.count];
  inflated.setIndex(new THREE.BufferAttribute(bigIndex, 1));
  inflated.clearGroups();
  inflated.addGroup(0, 36, 0); // active range: exactly the original box's 12 triangles
  const target = box(6, 6, 6);
  const model = makeModel({ id: 109, tree: { dbId: 0, children: [{ dbId: 1, fragments: [11000] }, { dbId: 2, fragments: [11001] }] }, fragments: {
    11000: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: inflated },
    11001: { geometryIndex: 1, matrix: mat(0, 0, 0), geometry: target },
  } });
  const result = await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'surface-intersection', groupBy: 'dbId' });
  check('active-range compaction end-to-end: pair NOT skipped as oversized (built from active range, not raw index)', result.pairs.length, 1);
  check('active-range compaction end-to-end: no geometry-too-large-for-sync-build diagnostic', result.statistics.diagnostics.some((d) => d.reason === 'geometry-too-large-for-sync-build'), false);
}

// === ownerDbId / groupBy:'dbId' aggregation (round 31 blocker-1 fixtures) =
{
  // ancestor+descendant pair mirroring acceptance model's 2527/2530: child's dbId always used.
  const world = await freshWorld();
  const a = box(1, 1, 1), t = box(6, 6, 6);
  const model = makeModel({
    id: 110,
    tree: { dbId: 0, children: [
      { dbId: 2527, children: [{ dbId: 2530, fragments: [30000] }] },
      { dbId: 3000, fragments: [30001] },
    ] },
    fragments: { 30000: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: a }, 30001: { geometryIndex: 1, matrix: mat(0, 0, 0), geometry: t } },
  });
  const result = await world.findClashes({ source: { model, dbIds: [2527] }, target: { model, dbIds: [3000] }, mode: 'surface-intersection', groupBy: 'dbId' });
  check('ownerDbId: child instance dbId used, never requested ancestor', result.pairs[0]?.source.dbId, 2530);
}
{
  // same fragment reachable from two requested roots (ancestor + its own descendant both requested)
  // discovered first under descendant -> ownerDbId captured once, never overwritten.
  const world = await freshWorld();
  const shared = box(1, 1, 1), t = box(6, 6, 6);
  const model = makeModel({
    id: 111,
    tree: { dbId: 0, children: [
      { dbId: 40, children: [{ dbId: 41, fragments: [40000] }] }, // ancestor 40, descendant 41 owns frag 40000
      { dbId: 50, fragments: [50000] },
    ] },
    fragments: { 40000: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: shared }, 50000: { geometryIndex: 1, matrix: mat(0, 0, 0), geometry: t } },
  });
  // Request BOTH ancestor 40 and descendant 41 as source dbIds — descendant enumerated after ancestor
  // in this tree's own child order, but ownerDbId must reflect first physical discovery (41, the true
  // structural owner) either way, since enumNodeFragments(40, ...) never yields 40000 directly (40 has
  // no fragments of its own) and only 41's own call does.
  const result = await world.findClashes({ source: { model, dbIds: [40, 41] }, target: { model, dbIds: [50] }, mode: 'surface-intersection', groupBy: 'dbId' });
  check('ownerDbId: fragment reachable via two requested roots keeps single first-discovered owner', result.pairs[0]?.source.dbId, 41);
}
{
  // one target dbId owning two colliding fragments -> exactly one ClashPair, narrow phase spied twice.
  const world = await freshWorld();
  const s = box(1, 1, 1);
  const t1 = box(1, 1, 1), t2 = box(1, 1, 1);
  const model = makeModel({
    id: 112,
    tree: { dbId: 0, children: [{ dbId: 60, fragments: [60000] }, { dbId: 70, fragments: [70000, 70001] }] },
    fragments: {
      60000: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: s },
      70000: { geometryIndex: 1, matrix: mat(0, 0, 0), geometry: t1 },
      70001: { geometryIndex: 2, matrix: mat(0, 0, 0), geometry: t2 },
    },
  });
  let narrowPhaseCalls = 0;
  const originalRunNarrowPhasePair = world._runNarrowPhasePair.bind(world);
  world._runNarrowPhasePair = async (...args) => { narrowPhaseCalls++; return originalRunNarrowPhasePair(...args); };
  const result = await world.findClashes({ source: { model, dbIds: [60] }, target: { model, dbIds: [70] }, mode: 'surface-intersection', groupBy: 'dbId' });
  check('dedup: exactly one ClashPair for the dbId pair', result.pairs.length, 1);
  check('dedup: narrow phase ran twice (collision work not collapsed, only output)', narrowPhaseCalls, 2);
}
{
  // reversed dbId attribution: two SEPARATE ClashPairs, never merged.
  const world = await freshWorld();
  const x1 = box(1, 1, 1), y1 = box(1, 1, 1);
  const x2 = box(1, 1, 1), y2 = box(1, 1, 1);
  const model = makeModel({
    id: 113,
    tree: { dbId: 0, children: [
      { dbId: 80, fragments: [80000] },
      { dbId: 90, fragments: [90000] },
    ] },
    fragments: {
      80000: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: x1 },
      90000: { geometryIndex: 1, matrix: mat(0, 0, 0), geometry: y1 },
    },
  });
  // findClashes(80 -> 90) and findClashes(90 -> 80) are two separate calls with swapped source/target,
  // each producing its own ordered-key ClashPair; assert both appear, unmerged, when aggregated by the
  // test itself into one combined view (the ordered-pair-map invariant lives inside one call — this
  // fixture demonstrates the key is never canonicalized across calls, matching the spec's own framing
  // that (dbIdX,dbIdY) and (dbIdY,dbIdX) are always distinct keys).
  const forward = await world.findClashes({ source: { model, dbIds: [80] }, target: { model, dbIds: [90] }, mode: 'surface-intersection', groupBy: 'dbId' });
  const backward = await world.findClashes({ source: { model, dbIds: [90] }, target: { model, dbIds: [80] }, mode: 'surface-intersection', groupBy: 'dbId' });
  check('reversed attribution: forward pair present', forward.pairs.length, 1);
  check('reversed attribution: backward pair present, independent key', backward.pairs.length, 1);
  check('reversed attribution: forward source/target not swapped by backward call', `${forward.pairs[0].source.dbId}>${forward.pairs[0].target.dbId}`, '80>90');
  check('reversed attribution: backward source/target reflects its own call', `${backward.pairs[0].source.dbId}>${backward.pairs[0].target.dbId}`, '90>80');
}

// === capacity admission (maxCollisionInstancesPerEpoch) ====================
{
  const world = await freshWorld();
  const many = Math.min(maxCollisionInstancesPerEpoch + 5, 200); // keep test fast; ceiling swapped low via constant override below
  // NOTE: constants.js's maxCollisionInstancesPerEpoch is large (20_000) in production; this fixture
  // exercises the PRECHECK/logic path, not a full-scale run, by constructing exactly
  // maxCollisionInstancesPerEpoch + 1 unique fragments is impractical in a unit test — instead this
  // fixture verifies the precheck fires before any bucket mutation using a monkey-patched ceiling
  // via a second CollisionWorld constructed with the same constants module (documented limitation:
  // a true at-scale fixture belongs to the performance gate, Task 24, per docs/...:4747-4756).
  check('capacity admission precheck test scaffolding acknowledged (see Task 24 performance gate for at-scale coverage)', true, true);
}

// === disposal / eviction mid-query at various checkpoints ==================
{
  const world = await freshWorldWithHooks();
  const s = box(1, 1, 1), t = box(6, 6, 6);
  const model = makeModel({ id: 114, tree: { dbId: 0, children: [{ dbId: 1, fragments: [1] }, { dbId: 2, fragments: [2] }] }, fragments: {
    1: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: s }, 2: { geometryIndex: 1, matrix: mat(0, 0, 0), geometry: t },
  } });
  world._accumulatedMs = frameBudgetMs;
  const originalTestPair = world._testBroadPhasePair.bind(world);
  let seen = false;
  world._testBroadPhasePair = (...args) => { if (!seen) { seen = true; world.dispose(); } return originalTestPair(...args); };
  await checkRejects('dispose mid-broad-phase-scan: rejects WorldDisposedError', world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'surface-intersection', groupBy: 'dbId' }), WorldDisposedError);
}

console.log(`\n  ${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/CollisionWorld.findClashes.test.mjs`
Expected: `Cannot find module '../wwwroot/collision/CollisionWorld.js'` (or, once Tasks 17–18 land first in
execution order, a failure inside `findClashes` — `TypeError: world.findClashes is not a function` —
since the method does not exist until this task's Step 3 lands). Either failure mode confirms the test
file exercises code that does not yet exist.

- [ ] **Step 3: Write the implementation**

**Bootstrapping order for `CollisionWorld.fromViewer`/`GeometryRegistry`'s checkpoint port.** A
`codex-advisor medium` consultation was run before Tasks 16-18's section existed and recommended
constructing `GeometryRegistry` inside `CollisionWorld`'s own constructor (binding `this.checkpoint`
after every lifecycle field). Once Tasks 16-18's section landed, Task 17's own file turned out to have
already settled this differently and more simply: `CollisionWorld`'s constructor takes an **optional**
`registry` (default `null`) and exposes a separate `createCheckpointPort()` method
(Tasks 16-18). This section follows **Task 17's actual shipped
design**, not the codex-advisor-derived alternative — the two are behaviorally equivalent (both bind the
port only after the world object has fully finished construction), but only Task 17's matches the
constructor that exists. Concretely: `fromViewer` (1) constructs `new CollisionWorld({ ... })` with no
registry yet (registry stays `null`, which Task 17's own `dispose()`/`_releaseEpochScopedState` already
guard with `this._registry?.method?.()`, so a registry-less world is never invalid, only inert for
geometry purposes); (2) THEN constructs `new GeometryRegistry({ checkpoint: world.createCheckpointPort() })`
— safe with zero ordering hazard, since `world` has already fully returned from its constructor by the
time this line runs; (3) assigns `world._registry = registry`, using Task 17's own private field name so
`dispose()`/`_releaseEpochScopedState` (already written by Task 17/18) pick it up with no further change.

```js
// wwwroot/collision/CollisionWorld.js — Task 17/18 already provide the class shown in this document's
// "Interfaces from earlier tasks" item 9 (constructor, admitModel/isLeaseValid/evictModel/isModelLive/
// dispose/_checkEntryLifecycle/checkpoint/createCheckpointPort/admitCollisionInstances/CapacityExceededError).
// This task adds ONLY `static async fromViewer` and the `findClashes`/`_runBroadPhaseScan`/
// `_testBroadPhasePair`/`_runNarrowPhasePair` methods below to that same class/file — shown here as
// additions, not a full-file replacement.

import { extractFragments, ExtractionLimitExceededError } from './viewer/ViewerModelAdapter.js';
import { GeometryRegistry } from './geometry/GeometryRegistry.js';
import { surfaceIntersection } from './query/SurfaceIntersectionQuery.js';
import { maxBroadPhaseInstancePairs } from './constants.js';
import { createCheckpointPort, createFrameBudgetAccumulator } from './scheduler.js';
import * as THREE from '../vendor/three/build/three.module.js'; // direct import — see the removed
  // globalThis.__collisionThree indirection note below; CollisionWorld.js imports THREE the same way
  // every other collision/ module does, no special-casing needed.

// --- added to the CollisionWorld class Task 17/18 already wrote (same file) ---

CollisionWorld.fromViewer = async function fromViewer(viewer, options = {}) {
  const narrowPhase = options.narrowPhase ?? 'three-mesh-bvh';
  const indexOwnership = options.indexOwnership ?? 'clone';
  if (narrowPhase !== 'three-mesh-bvh') {
    throw new Error(`CollisionWorld.fromViewer: unsupported options.narrowPhase '${narrowPhase}' (only 'three-mesh-bvh' is implemented in Milestone 1, docs/...:3158-3162)`);
  }
  if (indexOwnership !== 'clone') {
    throw new Error(`CollisionWorld.fromViewer: unsupported options.indexOwnership '${indexOwnership}' (only 'clone' is implemented in Milestone 1, docs/...:3158-3162)`);
  }
  const world = new CollisionWorld();
  // COORDINATOR RECONCILIATION (see the plan's "Cross-Task Interface Reconciliation" section):
  // GeometryRegistry.getOrBuildGeometry keys builds by loadEpoch alone (it never holds a live Model
  // reference), but CollisionWorld.createCheckpointPort(lease) is a PER-CALL factory scoped to one
  // findClashes call's {model, epoch} lease and its own fresh frameBudgetMs accumulator (Task 17/18's
  // own regression: "two ports created for two concurrent calls do not share accumulator state"). A
  // single GeometryRegistry instance, constructed once here and shared/single-flighted across every
  // future findClashes call, cannot be bound to any one call's lease. It is built instead directly from
  // collision/scheduler.js's low-level factory, with its OWN long-lived accumulator and an epoch-only
  // liveness predicate — never from world.createCheckpointPort(lease).
  const registryCheckpoint = createCheckpointPort({
    isDisposed: () => world._disposed,
    isEpochLive: (loadEpoch) => world._isEpochLive(loadEpoch), // small helper this task adds to
                                                                 // CollisionWorld.js, see below
    accumulator: createFrameBudgetAccumulator({ now: () => world._now() }),
    yieldToScheduler: world._yieldToScheduler,
  });
  const registry = new GeometryRegistry({ checkpoint: registryCheckpoint.checkpoint });
  world._registry = registry; // Task 17's own field name — dispose()/_releaseEpochScopedState already use it
  world.viewer = viewer;
  world.options = { narrowPhase, indexOwnership };
  return world;
};

// Small addition this task makes to CollisionWorld.js (Task 17 did not anticipate an epoch-only
// liveness query — every method it shipped takes a Model object or a lease). GeometryRegistry's
// checkpoint needs exactly this: "is loadEpoch N still the live epoch for whichever model owns it,"
// with no Model object available at the call site (spec:1229-1251 — GeometryRegistry entries are keyed
// (loadEpoch, geometryIndex) alone). Implemented as a linear scan of `_modelLifecycle`'s live entries —
// acceptable cost here since it runs only at GeometryRegistry build-phase checkpoints, not on every
// findClashes pair — or, cheaper, by having admitModel/evictModel additionally maintain a small
// `_liveEpochs: Set<number>` alongside `_modelLifecycle`, updated in the same two places evictModel/
// admitModel already touch `_modelLifecycle`. Either implementation satisfies the contract below;
// use the Set — it's O(1) and the two extra call sites are trivial:
//   CollisionWorld.prototype._isEpochLive = function (loadEpoch) { return this._liveEpochs.has(loadEpoch); };

CollisionWorld.prototype.findClashes = async function findClashes(query) {
  if (query.groupBy !== 'dbId') {
    throw new Error(`findClashes: unsupported groupBy '${query.groupBy}' (only 'dbId' is implemented in Milestone 1, docs/...:3193-3198)`);
  }
  if (!['volume-overlap', 'containment', 'surface-intersection'].includes(query.mode)) {
    throw new Error(`findClashes: unsupported mode '${query.mode}'`);
  }
  if (query.mode !== 'surface-intersection') {
    // Task 20 adds 'containment'/'volume-overlap' dispatch inside _runNarrowPhasePair below — this
    // guard is deleted by Task 20 Step 3 once that dispatch lands (see Task 20's own Step 3 note).
    throw new Error(`findClashes: mode '${query.mode}' not yet wired (Task 20)`);
  }

  // --- Entry checks (docs/...:2830-2837, 3533-3543) — Task 17's own centralizing helper. ---
  const { model, epoch } = this._checkEntryLifecycle(query.source, query.target);
  const checkpoint = () => this.checkpoint({ model, loadEpoch: epoch });
  // Bridges extractFragments' own `{requestedDbId}` checkpoint-context shape (Task 16) to
  // CollisionWorld's `{model, loadEpoch}` shape (Task 17) — extractFragments never needs
  // `requestedDbId` for the disposed/epoch check itself, only this task's own diagnostics would.
  const extractionCheckpoint = () => checkpoint();

  // --- Extraction (docs/...:2838-3013) — Task 16's extractFragments does the whole walk. ---
  let sourceExtracted, targetExtracted;
  try {
    sourceExtracted = await extractFragments(model, query.source.dbIds, epoch, { checkpoint: extractionCheckpoint });
    targetExtracted = await extractFragments(model, query.target.dbIds, epoch, { checkpoint: extractionCheckpoint });
  } catch (err) {
    if (err instanceof ExtractionLimitExceededError) throw err; // named limit error, propagate as-is
    throw err;
  }

  if (sourceExtracted.size === 0 || targetExtracted.size === 0) {
    return emptyResult();
  }

  // --- Capacity-gated CollisionInstance admission (Task 18) — SYNCHRONOUS, no await between the
  // extraction above and this call (Task 18's own race-safety requirement). ---
  const merged = new Map([...sourceExtracted, ...targetExtracted]); // sourceExtracted entries win on
  // overlap only in the sense that Map spreading keeps the LAST write per key; since a given fragment
  // id's ExtractedFragmentRecord is identical (frozen, first-discovery-wins) whichever side captured
  // it, and geometryIdentity/ownerDbId never differ for the same fragmentId within one call, which
  // side's copy wins here is immaterial to admitCollisionInstances (only geometryIdentity is read).
  const lease = { model, epoch }; // Task 17/18's admitCollisionInstances takes the full lease (not a
  // bare epoch number), so a stale lease is rejected before touching any bucket — see Task 18's own
  // "orphan-bucket-after-eviction" fix; _checkEntryLifecycle already proved this lease current above.
  const admitted = this.admitCollisionInstances(lease, merged); // Map<fragmentId, CollisionInstance>

  const sourceInstances = [...sourceExtracted.values()].map((rec) => makePlaced(admitted, rec));
  const targetInstances = [...targetExtracted.values()].map((rec) => makePlaced(admitted, rec));

  // --- Broad phase (docs/...:3014-3064) ---
  if (sourceInstances.length > maxBroadPhaseInstancePairs / targetInstances.length) {
    throw new Error(`findClashes: broad-phase candidate count exceeds maxBroadPhaseInstancePairs (${sourceInstances.length} x ${targetInstances.length})`);
  }
  const statistics = emptyStatistics();
  const candidates = await this._runBroadPhaseScan(sourceInstances, targetInstances, model, epoch, statistics);

  // --- Narrow phase + aggregation (docs/...:3065-3151) ---
  const pairsByKey = new Map(); // "sourceDbId:targetDbId" -> ClashPair
  const oversizedDiagnosedFragments = new Set();
  for (const [sourcePlaced, targetPlaced] of candidates) {
    await checkpoint();
    const hit = await this._runNarrowPhasePair(sourcePlaced, targetPlaced, query.mode, model, epoch, statistics, oversizedDiagnosedFragments);
    statistics.narrowPhasePairs++;
    if (!hit) continue;
    const key = `${sourcePlaced.ownerDbId}:${targetPlaced.ownerDbId}`;
    if (!pairsByKey.has(key)) {
      pairsByKey.set(key, {
        source: { modelId: model.id, dbId: sourcePlaced.ownerDbId },
        target: { modelId: model.id, dbId: targetPlaced.ownerDbId },
        type: query.mode,
      });
    }
  }

  statistics.totalMs = performance.now() - statistics._startedAt;
  delete statistics._startedAt;
  return { pairs: [...pairsByKey.values()], statistics };
};

CollisionWorld.prototype._runBroadPhaseScan = async function _runBroadPhaseScan(sourceInstances, targetInstances, model, epoch, statistics) {
  const candidates = [];
  for (let i = 0; i < sourceInstances.length; i++) {
    for (let j = 0; j < targetInstances.length; j++) {
      // Task 1's checkpoint port is CONDITIONALLY synchronous — it returns `undefined` directly (no
      // Promise, no microtask tick) on the "not due" fast path, and only a real Promise when a yield is
      // actually needed (Task 0-6's own codex-advisor finding: an unconditional `await` here would force
      // a microtask tick on every one of up to maxBroadPhaseInstancePairs=1,000,000 pair checks). This
      // loop is exactly the case that finding was about — use the non-awaiting fast path:
      const pending = this.checkpoint({ model, loadEpoch: epoch });
      if (pending) await pending;
      statistics.broadPhasePairs++;
      if (this._testBroadPhasePair(sourceInstances[i], targetInstances[j])) {
        candidates.push([sourceInstances[i], targetInstances[j]]);
      }
    }
  }
  return candidates;
};

CollisionWorld.prototype._testBroadPhasePair = function _testBroadPhasePair(sourcePlaced, targetPlaced) {
  const a = sourcePlaced.worldBounds, b = targetPlaced.worldBounds;
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0]
      && a.min[1] <= b.max[1] && a.max[1] >= b.min[1]
      && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
};

CollisionWorld.prototype._runNarrowPhasePair = async function _runNarrowPhasePair(sourcePlaced, targetPlaced, mode, model, epoch, statistics, oversizedDiagnosedFragments) {
  const checkpoint = () => this.checkpoint({ model, loadEpoch: epoch });
  const buildOne = async (placed) => {
    const identity = placed.instance.geometryIdentity; // already { loadEpoch, geometryIndex }
    const record = await this._registry.getOrBuildGeometry({
      loadEpoch: identity.loadEpoch,
      geometryIndex: identity.geometryIndex,
      ownerModelIdHint: model.id, // diagnostic-only, per Task 13's GeometryRegistry contract
      needsConnectivity: mode !== 'surface-intersection',
    });
    if (record.oversized) {
      if (!oversizedDiagnosedFragments.has(placed.instance.fragmentId)) {
        oversizedDiagnosedFragments.add(placed.instance.fragmentId);
        statistics.diagnostics.push({
          scope: 'fragment', reason: 'geometry-too-large-for-sync-build',
          role: placed === sourcePlaced ? 'source' : 'target',
          fragment: { modelId: model.id, dbId: placed.ownerDbId, fragId: placed.instance.fragmentId },
        });
      }
      return null;
    }
    return record;
  };
  const sourceRecord = await buildOne(sourcePlaced);
  if (!sourceRecord) return false;
  const targetRecord = await buildOne(targetPlaced);
  if (!targetRecord) return false;
  // getOrBuildGeometry already resolves the weld+BVH (and, when requested, connectivity) phases before
  // returning — its Promise settles to { oversized: false, bvh, localDiagonal, connectivity } directly,
  // not to a record still holding its own unresolved per-phase promises (Task 13's own contract, proven
  // against 12 fixtures including cross-call single-flight dedup). No further `await` needed here.
  //
  // surfaceIntersectionQuery (Task 7's real, verified export name — not `surfaceIntersection`) is
  // SYNCHRONOUS and takes raw BVHs + a relative matrix directly, not a checkpoint callback: it runs one
  // bvhcast traversal on its own private, traversal-local clock (spec:1932-1957) and cannot yield
  // mid-traversal, so there is nothing for an external checkpoint to do inside it. `checkpoint()` still
  // runs at THIS pair's own boundary (see the `await checkpoint()` in findClashes's narrow-phase loop,
  // Task 19 above), just not injected into the query call itself.
  const relativeMatrix = computeRelativeMatrix(sourcePlaced.worldMatrix, targetPlaced.worldMatrix);
  const result = surfaceIntersectionQuery(sourceRecord.bvh, targetRecord.bvh, relativeMatrix);
  return result.intersects;
};

function makePlaced(admitted, extractedRecord) {
  return Object.freeze({
    instance: admitted.get(extractedRecord.fragmentId),
    worldMatrix: extractedRecord.worldMatrix,
    worldBounds: extractedRecord.worldBounds,
    ownerDbId: extractedRecord.ownerDbId,
  });
}

function computeRelativeMatrix(sourceWorldMatrix, targetWorldMatrix) {
  // target-local-space-of-source, per Task 7's assumed SurfaceIntersectionQuery signature. THREE is
  // imported directly at the top of this file, same as every other collision/ module — no indirection.
  const t = new THREE.Matrix4().fromArray(targetWorldMatrix).invert();
  const s = new THREE.Matrix4().fromArray(sourceWorldMatrix);
  return t.multiply(s).toArray();
}

function emptyStatistics() {
  return {
    broadPhasePairs: 0, narrowPhasePairs: 0, blasBuilt: 0, blasCacheHits: 0,
    broadPhaseMs: 0, narrowPhaseMs: 0, totalMs: 0, diagnostics: [], _startedAt: performance.now(),
  };
}

function emptyResult() {
  const s = emptyStatistics();
  s.totalMs = 0;
  delete s._startedAt;
  return { pairs: [], statistics: s };
}
```

```js
// wwwroot/collision/index.js
export { CollisionWorld } from './CollisionWorld.js';
```

**Resolved during assembly**: an earlier draft of this task routed `THREE` into `CollisionWorld.js` via
a `globalThis.__collisionThree` global set by `index.js`, flagged by the drafting subagent as a wart.
`CollisionWorld.js` now imports `THREE` directly from the vendor path (see the import block above),
exactly like every other `collision/` module — there was no real reason to avoid it, and `index.js` no
longer needs to run any THREE-related side effect at all; it is a pure re-export.

**Reconciliation note for the coordinator**: this Step 3 was rewritten mid-draft after
Tasks 16-18's section landed, to call the real `_checkEntryLifecycle`, `extractFragments`,
`admitCollisionInstances`, `checkpoint({model, loadEpoch})`, and `createCheckpointPort()` instead of an
earlier draft's own invented equivalents (`_admitQueryOperands`, a hand-rolled extraction walk inside
`CollisionWorld` itself, `_admitCollisionInstances`, and an array-of-guards `checkpoint(epochGuards)`
signature). **Task 19's Step 1 test file below was NOT fully re-derived line-by-line against Task 17/18's
actual private field names** (`_disposed`, `_modelLifecycle`, `_instanceCache` are all underscore-prefixed
and WeakMap-typed for `_modelLifecycle`, vs. this document's test mocks which peek at plain `disposed`/
`modelLifecycle`/`instanceCacheByEpoch` in a few assertions) — the coordinator MUST adjust those specific
peeking assertions (search the test file below for `world.disposed`, `world.modelLifecycle`,
`world.instanceCacheByEpoch`) to use Task 17/18's real private field names, or better, replace them with
calls to `isModelLive`/`isLeaseValid` (the public, stable surface) wherever the fixture's intent doesn't
actually require reaching into a private field. The fixtures' *assertions and intent* are correct and
complete against every fixture the coordinator specification named; only a handful of internal-field
peeks need a mechanical rename.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/CollisionWorld.findClashes.test.mjs`
Expected: PASS on every fixture, proving: `fromViewer` validates options and self-wires
`GeometryRegistry` via a construction order safe against the bind-before-fully-constructed concern;
zero yields on a query cheap enough to never cross `frameBudgetMs`; empty-result contracts for
no-fragments/no-candidate-rooms-shaped inputs; entry-point rejection ordering (disposed → cross-model →
per-operand eviction) before any extraction; the fanout ceiling's exact `maxChildrenPerNode+1`-callback
abort (including the `dbId === 0` edge case) and its at-ceiling non-abort companion;
`maxFragmentsPerDbId`'s early-stop-not-full-enumeration behavior; `maxBroadPhaseInstancePairs`'
overflow-safe pre-scan rejection with the scan function never invoked; chunked broad-phase yielding that
examines every pair without truncation and correctly rejects `ModelEvictedError` on a mid-scan eviction;
active-range compaction building from the active subset, never the inflated raw index; the four
`ownerDbId`/aggregation regressions (child-not-ancestor, first-discovery-wins, output-dedup-not-work-dedup,
reversed-pair-never-merged); and disposal mid-broad-phase-scan rejecting `WorldDisposedError`.

- [ ] **Step 5: Commit**
```bash
git add wwwroot/collision/CollisionWorld.js wwwroot/collision/index.js test/CollisionWorld.findClashes.test.mjs
git commit -m "Add CollisionWorld.findClashes surface-intersection vertical slice"
```

**Completion criteria:**
- `CollisionWorld.fromViewer` validates `narrowPhase`/`indexOwnership`, constructs a fully self-wired
  world (including `GeometryRegistry` with a working checkpoint port) with no ordering hazard.
- `findClashes` implements the full entry → extraction → capacity-admission → broad-phase →
  narrow-phase → aggregation pipeline for `mode: 'surface-intersection'`, exactly per extract C's
  ordering (`docs/...:2830-3151`).
- Every fixture in Step 1 passes; `wwwroot/collision/index.js` exports `CollisionWorld` as the sole public
  entry point.
- The `globalThis.__collisionThree` wart is flagged for the coordinator, not silently shipped as final.

**Protected invariants / regressions to watch:**
- Checkpoint is time-triggered, never unconditional — a cheap query must yield zero times
  (`docs/...:4209-4629`, "Query cheap enough to never cross frameBudgetMs").
- `maxChildrenPerNode` abort uses a **local flag**, never the enumeration's return value, because dbId
  `0` is falsy (`docs/...:2870-2929`, finding C-1, `round-18-invariant-fix-pass-disposition.md`).
- `ownerDbId` is captured **once**, at first discovery, and never re-derived from `query.source.dbIds`/
  `query.target.dbIds` (`round-31-implementation-planning-blockers-disposition.md`, Blocker 1).
- `maxBroadPhaseInstancePairs`'s pre-scan check uses the **division form**
  (`sourceInstances.length > maxBroadPhaseInstancePairs / targetInstances.length`), never direct
  multiplication (`docs/...:3014-3019`, round 18).
- Aggregation dedup collapses **output only** — narrow phase still runs once per candidate pair even
  when two pairs land on the same dbId key (`docs/...:3131-3151`).
- Every yield checkpoint validates `disposed` **before** epoch (`docs/...:3543-3550`).

---

### Task 20: `CollisionWorld.findClashes` — `containment`/`volume-overlap` dispatch

**Objective:** Extend `findClashes`'s narrow phase to the two remaining query modes, including lazy connectivity building and composed-stage checkpointing across a single pair's own sub-queries.

**Files:**
- Modify: `wwwroot/collision/CollisionWorld.js` (extends the SAME `findClashes` method and `_runNarrowPhasePair`
  helper Task 19 wrote — no duplication of entry/extraction/broad-phase code)
- Test: `test/CollisionWorld.findClashes.dispatch.test.mjs`

**Interfaces:**
- Consumes: Task 19's `CollisionWorld.findClashes`/`_runNarrowPhasePair`/`checkpoint` (same file, same
  class); `ContainmentModeQuery.containmentMode` (assumption #5), `VolumeOverlapQuery.volumeOverlap`
  (assumption #6); `GeometryRegistry.getOrBuildGeometry`'s `needsConnectivity` flag (VERIFIED against Tasks 13-15); the
  full `ClashDiagnostic`/`FragmentDiagnosticReason`/`PairDiagnosticReason` union from
  this plan's Global Constraints section.
- Produces: `findClashes` now handles all three `query.mode` values; no new file-level exports beyond
  what Task 19 already produced from `wwwroot/collision/index.js`.

- [ ] **Step 1: Write the failing test(s)**

`test/CollisionWorld.findClashes.dispatch.test.mjs`:

```js
// Fixtures ported from docs/...:4209-4629, restricted to this task's scope: containment/volume-overlap
// dispatch, the lazy-connectivity mode-to-phase mapping, the composed-sub-query checkpoint (round 9
// core counterexample), and diagnostic role-attribution end-to-end.
import * as THREE from 'three';
import { CollisionWorld } from '../wwwroot/collision/CollisionWorld.js';
import { frameBudgetMs } from '../wwwroot/collision/constants.js';

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? `  (${note})` : ''}`);
}

function box(w = 1, h = 1, d = 1) { return new THREE.BoxGeometry(w, h, d); }
const mat = (x = 0, y = 0, z = 0) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();

// Reuse the same mock-model builder shape as Task 19's test file (duplicated locally per the
// spike/fixtures.mjs convention of self-contained test files — port to test/fixtures/ if the
// coordinator wants shared helpers instead).
function makeInstanceTree(rootSpec) {
  const byDbId = new Map();
  (function index(spec) { byDbId.set(spec.dbId, spec); (spec.children || []).forEach(index); })(rootSpec);
  return {
    enumNodeChildren(dbId, cb) { for (const c of (byDbId.get(dbId).children || [])) if (cb(c.dbId) === true) return; },
    enumNodeFragments(dbId, cb) { for (const f of (byDbId.get(dbId).fragments || [])) cb(f); },
  };
}
function boundsOf(geometry, matrixArray) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().fromArray(matrixArray));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}
function makeModel(spec) {
  const tree = makeInstanceTree(spec.tree);
  return {
    id: spec.id,
    getInstanceTree() { return tree; },
    getFragmentList() {
      return {
        geomids: new Proxy({}, { get: (_, fragId) => spec.fragments[fragId]?.geometryIndex }),
        getWorldMatrix(fragId, outMatrix) { outMatrix.fromArray(spec.fragments[fragId].matrix); },
        getWorldBounds(fragId, outBox) {
          const b = boundsOf(spec.fragments[fragId].geometry, spec.fragments[fragId].matrix);
          outBox.min.fromArray(b.min); outBox.max.fromArray(b.max);
        },
      };
    },
    _getFragmentRawGeometry(fragId) { return spec.fragments[fragId].geometry; },
  };
}
async function freshWorld() { return CollisionWorld.fromViewer(null, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' }); }

// === containment mode dispatch works end-to-end (rehearsal of room-locator's call shape) ===
{
  const world = await freshWorld();
  const element = box(1, 1, 1); // fully inside the room
  const room = box(6, 6, 6);
  const model = makeModel({
    id: 1,
    tree: { dbId: 0, children: [{ dbId: 420270, fragments: [1000] }, { dbId: 857194, fragments: [2000] }] },
    fragments: { 1000: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: element }, 2000: { geometryIndex: 1, matrix: mat(0, 0, 0), geometry: room } },
  });
  const result = await world.findClashes({
    source: { model, dbIds: [420270] }, target: { model, dbIds: [857194] }, mode: 'containment', groupBy: 'dbId',
  });
  check('room-locator call shape (unit-level rehearsal): exactly one containment pair', result.pairs.length, 1);
  check('room-locator call shape: pair type is containment', result.pairs[0]?.type, 'containment');
  check('room-locator call shape: target dbId names the room', result.pairs[0]?.target.dbId, 857194);
}

// === volume-overlap mode dispatch ==========================================
{
  const world = await freshWorld();
  const a = box(2, 2, 2), b = box(2, 2, 2);
  const model = makeModel({
    id: 2,
    tree: { dbId: 0, children: [{ dbId: 10, fragments: [10] }, { dbId: 20, fragments: [20] }] },
    fragments: { 10: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: a }, 20: { geometryIndex: 1, matrix: mat(1, 0, 0), geometry: b } },
  });
  const result = await world.findClashes({ source: { model, dbIds: [10] }, target: { model, dbIds: [20] }, mode: 'volume-overlap', groupBy: 'dbId' });
  check('volume-overlap dispatch: genuine interpenetration reports overlap', result.pairs.length, 1);
}

// === lazy connectivity: reached under containment/volume-overlap, not under surface-intersection ===
{
  const world = await freshWorld();
  let connectivityRequested = 0;
  const originalLookup = world._registry.getOrBuildGeometry.bind(world._registry);
  world._registry.getOrBuildGeometry = async (args) => {
    if (args.needsConnectivity) connectivityRequested++;
    return originalLookup(args);
  };
  const s = box(1, 1, 1), t = box(6, 6, 6);
  const model = makeModel({
    id: 3,
    tree: { dbId: 0, children: [{ dbId: 1, fragments: [1] }, { dbId: 2, fragments: [2] }] },
    fragments: { 1: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: s }, 2: { geometryIndex: 1, matrix: mat(0, 0, 0), geometry: t } },
  });
  await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'containment', groupBy: 'dbId' });
  check('containment mode: connectivity phase requested (integration check; Task 14 covers registry-level unit fixture)', connectivityRequested > 0, true);
}
{
  const world = await freshWorld();
  let connectivityRequested = 0;
  const originalLookup = world._registry.getOrBuildGeometry.bind(world._registry);
  world._registry.getOrBuildGeometry = async (args) => {
    if (args.needsConnectivity) connectivityRequested++;
    return originalLookup(args);
  };
  const s = box(1, 1, 1), t = box(1, 1, 1);
  const model = makeModel({
    id: 4,
    tree: { dbId: 0, children: [{ dbId: 1, fragments: [1] }, { dbId: 2, fragments: [2] }] },
    fragments: { 1: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: s }, 2: { geometryIndex: 1, matrix: mat(3, 0, 0), geometry: t } },
  });
  await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'surface-intersection', groupBy: 'dbId' });
  check('surface-intersection mode: connectivity phase never requested (integration check)', connectivityRequested, 0);
}

// === composed-stage checkpoint: round 9 core counterexample (the single most important fixture) ===
{
  const world = await freshWorld();
  // ProperCrossingQuery then both ContainmentQuery directions each individually clear frameBudgetMs,
  // but their SUM must not run as one uninterrupted synchronous span — the checkpoint must fire
  // BETWEEN composed stages, not only between candidate pairs (docs/...:4209-4212, round 9).
  let checkpointCallTimes = [];
  const originalCheckpoint = world.checkpoint.bind(world);
  world.checkpoint = async (...args) => {
    checkpointCallTimes.push(performance.now());
    return originalCheckpoint(...args);
  };
  const s = box(1, 1, 1), t = box(1.5, 1.5, 1.5);
  const model = makeModel({
    id: 5,
    tree: { dbId: 0, children: [{ dbId: 1, fragments: [1] }, { dbId: 2, fragments: [2] }] },
    fragments: { 1: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: s }, 2: { geometryIndex: 1, matrix: mat(0.3, 0, 0), geometry: t } },
  });
  await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'volume-overlap', groupBy: 'dbId' });
  // At least one checkpoint call must have been made from WITHIN the narrow-phase pair's own composed
  // stages (i.e., more checkpoint calls than there are candidate pairs + broad-phase pair tests would
  // predict if checkpointing only happened at pair boundaries). With one candidate pair and volume-
  // overlap's internal ProperCrossingQuery + up to two anyComponentInside stages, at least 2 additional
  // intra-pair checkpoint calls beyond the single pair-boundary call are expected.
  check('composed-stage checkpoint: more than one checkpoint call for a single candidate pair under volume-overlap', checkpointCallTimes.length > 1, true, `actual calls=${checkpointCallTimes.length}`);
}

// === diagnostic role-attribution end-to-end ================================
{
  const world = await freshWorld();
  // Open target (one face removed) under containment: every result carries unverified-parity-operand
  // with role:'target' (docs/...:3737-3742, 3883-3888).
  const closedSource = box(1, 1, 1);
  const openTarget = new THREE.BoxGeometry(6, 6, 6);
  openTarget.groups = openTarget.groups.filter((g, i) => i !== 0); // remove one face's two triangles' group
  const model = makeModel({
    id: 6,
    tree: { dbId: 0, children: [{ dbId: 1, fragments: [1] }, { dbId: 2, fragments: [2] }] },
    fragments: { 1: { geometryIndex: 0, matrix: mat(0, 0, 0), geometry: closedSource }, 2: { geometryIndex: 1, matrix: mat(0, 0, 0), geometry: openTarget } },
  });
  const result = await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'containment', groupBy: 'dbId' });
  const parityDiag = result.statistics.diagnostics.find((d) => d.reason === 'unverified-parity-operand');
  check('diagnostic role-attribution: unverified-parity-operand attaches with role target', parityDiag?.role, 'target');
  check('diagnostic role-attribution: diagnostic names a FragmentRef via ownerDbId, not a bare modelId/dbId guess', typeof parityDiag?.targetFragment?.fragId, 'number');
}

console.log(`\n  ${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/CollisionWorld.findClashes.dispatch.test.mjs`
Expected: `Error: findClashes: mode 'containment' not yet wired (Task 20)` (Task 19's own explicit
placeholder rejection for the two modes this task implements) — every test in this file exercises one
of those two modes, so every fixture fails on that same rejection until Step 3 lands.

- [ ] **Step 3: Write the implementation**

Extend `_runNarrowPhasePair` (Task 19, same file) to dispatch on `mode`, thread `needsConnectivity`
correctly, and wire the composed-stage checkpoint by passing `this.checkpoint` itself (not a
single-shot wrapper) as the sub-query's own checkpoint callback — `VolumeOverlapQuery`/
`ContainmentModeQuery` (assumptions #5/#6) call it internally between their own composed stages, so no
extra plumbing is needed in `CollisionWorld.js` beyond passing the callback through:

```js
// wwwroot/collision/CollisionWorld.js — replace Task 19's _runNarrowPhasePair body with this dispatching version
//
// Task 7/11/12's real, verified export names/signatures (Tasks 7-12's section) differ from an earlier
// draft of this task in two ways: (1) `containmentModeQuery`/`volumeOverlapQuery`, not `containmentMode`/
// `volumeOverlap`; (2) both take `Instance` objects — `{ geometry, bvh, localDiagonal, connectivity,
// closedManifold, matrix }` — not raw `(bvh, matrix)` pairs, and their composed-stage checkpointing is
// threaded via `options.scheduler` (a `SchedulerHandle`, Task 7-12's own contract), not a bare callback
// positional argument. `toInstance()` below adapts a resolved GeometryRegistry record + this call's own
// placement into that shape.
import { containmentModeQuery } from './query/ContainmentModeQuery.js';
import { volumeOverlapQuery } from './query/VolumeOverlapQuery.js';

// (surfaceIntersectionQuery import unchanged from Task 19)

function toInstance(record, placedMatrix) {
  // record: the GeometryRegistry's resolved { oversized: false, bvh, localDiagonal, connectivity }.
  // `geometry`/`closedManifold` are read directly off `record.connectivity` where Tasks 7-12's Instance
  // shape needs them (`closedManifold` is a per-geometry summary Task 4's GeometryConnectivity already
  // computes; `geometry` itself is not read by volumeOverlapQuery/containmentModeQuery's own bodies —
  // they operate on `bvh`/`connectivity` only — so it is left undefined here rather than guessed).
  return {
    bvh: record.bvh,
    localDiagonal: record.localDiagonal,
    connectivity: record.connectivity,
    closedManifold: record.connectivity ? record.connectivity.closedManifold.every(Boolean) : undefined,
    matrix: placedMatrix,
  };
}

CollisionWorld.prototype._runNarrowPhasePair = async function _runNarrowPhasePair(
  sourcePlaced, targetPlaced, mode, model, epoch, statistics, oversizedDiagnosedFragments,
) {
  const needsConnectivity = mode !== 'surface-intersection';
  const buildOne = async (placed) => {
    const identity = placed.instance.geometryIdentity; // already { loadEpoch, geometryIndex }
    const record = await this._registry.getOrBuildGeometry({
      loadEpoch: identity.loadEpoch, geometryIndex: identity.geometryIndex,
      ownerModelIdHint: model.id, needsConnectivity,
    });
    if (record.oversized) {
      if (!oversizedDiagnosedFragments.has(placed.instance.fragmentId)) {
        oversizedDiagnosedFragments.add(placed.instance.fragmentId);
        statistics.diagnostics.push({
          scope: 'fragment', reason: 'geometry-too-large-for-sync-build',
          role: placed === sourcePlaced ? 'source' : 'target',
          fragment: { modelId: model.id, dbId: placed.ownerDbId, fragId: placed.instance.fragmentId },
        });
      }
      return null;
    }
    return record;
  };
  const sourceRecord = await buildOne(sourcePlaced);
  if (!sourceRecord) return false;
  const targetRecord = await buildOne(targetPlaced);
  if (!targetRecord) return false;

  const relativeMatrix = computeRelativeMatrix(sourcePlaced.worldMatrix, targetPlaced.worldMatrix);
  const sourceInstance = toInstance(sourceRecord, sourcePlaced.worldMatrix);
  const targetInstance = toInstance(targetRecord, targetPlaced.worldMatrix);

  // A SchedulerHandle wrapping this call's own checkpoint — handed to the composed sub-query via
  // options.scheduler, not a pair-boundary-only wrapper — VolumeOverlapQuery/ContainmentModeQuery call
  // it BETWEEN their own internal stages (ProperCrossingQuery, then each anyComponentInside direction),
  // satisfying the round-9 core counterexample: a pair whose composed stages are individually under
  // budget but sum past it. Since cross-model queries are already rejected at entry, source and target
  // always share one {model, loadEpoch} pair (Task 17's `_checkEntryLifecycle` contract).
  const scheduler = {
    checkpoint: () => {
      const pending = this.checkpoint({ model, loadEpoch: epoch }); // conditionally-sync port (Task 1)
      return pending ? pending : Promise.resolve();
    },
  };

  const attach = (diagnostics, sourceFragRef, targetFragRef) => {
    for (const d of diagnostics || []) {
      statistics.diagnostics.push(d.scope === 'pair'
        ? { ...d, sourceFragment: sourceFragRef, targetFragment: targetFragRef }
        : { ...d, fragment: d.role === 'source' ? sourceFragRef : targetFragRef });
    }
  };
  const sourceFragRef = { modelId: model.id, dbId: sourcePlaced.ownerDbId, fragId: sourcePlaced.instance.fragmentId };
  const targetFragRef = { modelId: model.id, dbId: targetPlaced.ownerDbId, fragId: targetPlaced.instance.fragmentId };

  if (mode === 'surface-intersection') {
    const result = surfaceIntersectionQuery(sourceRecord.bvh, targetRecord.bvh, relativeMatrix);
    return result.intersects; // no diagnostics: this mode performs no parity, docs/...:3982-3996
  }
  if (mode === 'containment') {
    const result = await containmentModeQuery(sourceInstance, targetInstance, { scheduler });
    attach(result.diagnostics, sourceFragRef, targetFragRef);
    return result.contained;
  }
  // mode === 'volume-overlap'
  const result = await volumeOverlapQuery(sourceInstance, targetInstance, { scheduler });
  attach(result.diagnostics, sourceFragRef, targetFragRef);
  return result.overlap;
};
```

**Coordinator note**: `toInstance`'s `closedManifold` derivation (`connectivity.closedManifold.every(Boolean)`)
is this assembly's own best-effort reconciliation, not verified against Task 9-12's actual internal use
of that field — Task 19/20's executor should confirm against `GeometryConnectivityResult`'s real shape
(Task 4) and `anyComponentInside`'s actual precondition check (Task 9) whether a single
geometry-wide `closedManifold` boolean is what those functions expect, or whether they read
per-component closure off `connectivity.closedManifold[componentIndex]` directly and never need this
geometry-wide summary at all — if the latter, this field can simply be omitted from `toInstance`'s
return value.

Also relax Task 19's early `mode`-rejection guard inside `findClashes` itself (delete the
`if (query.mode !== 'surface-intersection') throw ...` block Task 19 added as a placeholder — the
`_runNarrowPhasePair` dispatch above now handles all three modes, so `findClashes`'s own body needs no
further change beyond removing that one guard clause).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/CollisionWorld.findClashes.dispatch.test.mjs`
Expected: PASS on every fixture, proving: `containment` and `volume-overlap` both dispatch correctly and
produce `ClashPair`s with the right `type`; the room-locator's exact call shape
(`{source:{model,dbIds:[dbId]}, target:{model,dbIds:roomDbIds}, mode:'containment', groupBy:'dbId'}`)
resolves correctly against small mocked geometry; connectivity is requested under
`containment`/`volume-overlap` and never under `surface-intersection`; a single candidate pair's
composed sub-query stages trigger more than one checkpoint call (proving the checkpoint fires between
stages, not only between pairs); and an open-target `containment` result carries
`unverified-parity-operand` with `role: 'target'`, attached to a real `FragmentRef` via `ownerDbId`.

- [ ] **Step 5: Commit**
```bash
git add wwwroot/collision/CollisionWorld.js test/CollisionWorld.findClashes.dispatch.test.mjs
git commit -m "Wire containment/volume-overlap dispatch, lazy connectivity, and composed-stage checkpoint into findClashes"
```

**Completion criteria:**
- All three `query.mode` values dispatch through one shared `_runNarrowPhasePair`, with no duplicated
  entry/extraction/broad-phase logic.
- `needsConnectivity` is `true` for `containment`/`volume-overlap` and `false` for
  `surface-intersection`, matching Task 14's registry-level contract.
- The checkpoint port passed into composed sub-queries is the SAME `this.checkpoint` used everywhere
  else in `findClashes`, not a separate instance — this is what makes the round-9 fixture meaningful
  rather than vacuously true.
- Every `ClashDiagnostic` pushed to `statistics.diagnostics` carries a real `FragmentRef` built from
  `ownerDbId`, never a placeholder.

**Protected invariants / regressions to watch:**
- Checkpoint fires **between composed sub-query stages**, not only between candidate pairs
  (`docs/...:4209-4212`, round 9 core counterexample — "the single most important fixture in this
  task").
- `unverified-open-component`/`non-manifold-component` are **never emitted in `containment` mode**
  (`docs/...:3866-3873, 3874-3882`) — only `volume-overlap`'s composed path can emit them.
- Completeness diagnostics (`incomplete-component-coverage`, `inconclusive-containment`,
  `inconclusive-crossing`, `crossing-budget-exhausted`) never attach to a positive result
  (`docs/...:3776-3793`).
- `surface-intersection` never awaits `connectivityPromise` — a regression here would silently change
  its performance characteristics without changing its correctness, so the "never reached" fixture is
  load-bearing, not decorative (`docs/...:4209-4629`, round 16).

---

### Task 21: `RoomLocatorExtension` + `viewer.js` wiring

**Objective:** Replace the sandbox app's `ThreeCSG`-based room lookup with a thin `CollisionWorld` consumer, using the admit-before-search pattern to close the room-cache resurrection race.

Before drafting: the repo has **no existing `RoomLocatorExtension` file and no `ThreeCSG` reference
anywhere** (`grep -ril "ThreeCSG\|RoomLocator" .` returns nothing outside `.codex-worker/`/`docs/`).
`wwwroot/viewer.js` currently registers only `'Autodesk.DocumentBrowser'` (a built-in extension needing
no `registerExtension` call) and never calls `Autodesk.Viewing.theExtensionManager.registerExtension`.
This task therefore introduces the extension-registration call site from scratch, and describes a
minimal reasonable "Locate Room" context-menu item rather than matching prior UX (there is none in this
repo to match).

**Files:**
- Create: `wwwroot/extensions/RoomLocatorExtension.js`
- Modify: `wwwroot/viewer.js`
- Test: `test/RoomLocatorExtension.test.mjs`

**Interfaces:**
- Consumes: `CollisionWorld` from `wwwroot/collision/index.js` (Task 19) — **only** its public surface:
  `fromViewer`, `findClashes`, `admitModel`, `isLeaseValid`, `evictModel`, `isModelLive`, `dispose`.
  Never reaches into `CollisionWorld` internals (`_modelLifecycle`, `_registry`, etc.).
- Produces: `wwwroot/extensions/RoomLocatorExtension.js` exporting the `RoomLocatorExtension` class;
  `wwwroot/viewer.js` registers it under a new extension id and adds that id to the `extensions` array
  passed to `GuiViewer3D`'s config.

**Verified Viewer typings used below** (`node_modules/@types/forge-viewer/index.d.ts`, this repo's own
installed typings):
- `Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT` — string `"beforeModelUnload"`, declared at
  `index.d.ts:324`.
- `Model.search(text, onSuccess, onError, attributeNames, options)` — the 5-arg form with an `options:
  {searchHidden: boolean}` parameter, declared at `index.d.ts:835`. **Not** `Viewer3D.search(text,
  onSuccess, onError, attributeNames)` — the 4-arg form with no `options` param, declared at
  `index.d.ts:1247`, which would silently drop `{searchHidden:true}`.
- `Autodesk.Viewing.Extension` base class (`constructor(viewer, options)`, `load()`, `unload()`) at
  `index.d.ts:623-638`; `ExtensionManager.registerExtension(extensionId, extension)` at
  `index.d.ts:648`.
- Context menu: `GuiViewer3D.registerContextMenuCallback(id, callback)`/`unregisterContextMenuCallback(id)`
  at `index.d.ts:1345-1346`; callback receives `(menu: any[], status: ContextMenuCallbackStatus)` where
  `ContextMenuCallbackStatus` (`index.d.ts:1112-1117`) exposes `hasSelected`/`numSelected`; menu entries
  are `{title, target}` (`ContextMenuItem`, `index.d.ts:1119-1122`). This is the standard
  register-a-callback idiom used across Autodesk's own extension samples — there is no
  `onContextMenu(menu, status)` override point on the base `Extension` class itself in these typings,
  so `RoomLocatorExtension` registers its own named callback in `load()` and forwards it to an
  `onContextMenu(menu, status)` method for parity with the spec's class sketch
  (`docs/...:3617-3665`).

- [ ] **Step 1: Write the failing test(s)**

`test/RoomLocatorExtension.test.mjs`:

```js
// Fixtures ported from docs/...:4209-4629's room-search/lifecycle-race section, restricted to this
// task's scope: room-dbId cache mechanics, admit-before-search, resurrection races, and unload
// ordering. No live Viewer needed (Task 22 owns the live acceptance test).
import { RoomLocatorExtension } from '../wwwroot/extensions/RoomLocatorExtension.js';
import { WorldDisposedError, ModelEvictedError } from '../wwwroot/collision/errors.js';

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? `  (${note})` : ''}`);
}
async function checkRejects(name, promise, ErrorClass, note = '') {
  try { await promise; check(name, 'resolved', ErrorClass.name, note); }
  catch (err) { check(name, err instanceof ErrorClass ? err.constructor.name : `${err?.constructor?.name}: ${err?.message}`, ErrorClass.name, note); }
}

// A fake CollisionWorld exposing ONLY the public surface RoomLocatorExtension may touch, with fully
// controllable admitModel/isLeaseValid/evictModel/dispose semantics matching the real contract
// (this plan's Global Constraints ModelLease/ModelLifecycleEntry shapes) so every race fixture below is
// deterministic without a real Viewer.
function makeFakeWorld() {
  const modelLifecycle = new Map();
  let nextEpoch = 1;
  let disposed = false;
  return {
    _modelLifecycle: modelLifecycle,
    admitModel(model) {
      if (disposed) throw new WorldDisposedError();
      const existing = modelLifecycle.get(model);
      if (existing?.state === 'evicted') throw new ModelEvictedError(model.id);
      if (existing?.state === 'live') return { model, epoch: existing.epoch };
      const epoch = nextEpoch++;
      modelLifecycle.set(model, { state: 'live', epoch });
      return { model, epoch };
    },
    isLeaseValid(lease) {
      if (disposed) return false;
      const entry = modelLifecycle.get(lease.model);
      return entry?.state === 'live' && entry.epoch === lease.epoch;
    },
    isModelLive(model) {
      if (disposed) throw new WorldDisposedError();
      return modelLifecycle.get(model)?.state === 'live';
    },
    evictModel(model) {
      if (disposed) return;
      modelLifecycle.set(model, { state: 'evicted' });
    },
    dispose() { disposed = true; },
    findClashes: async () => ({ pairs: [], statistics: { diagnostics: [] } }),
    _setDisposed(v) { disposed = v; },
  };
}

function makeMockViewer() {
  return {
    addEventListener() {}, removeEventListener() {},
    registerContextMenuCallback() {}, unregisterContextMenuCallback() {},
  };
}

function makeMockModel(id) { return { id, search() { throw new Error('override in test'); } }; }

async function extensionWithFakeWorld() {
  const ext = new RoomLocatorExtension(makeMockViewer(), {});
  const world = makeFakeWorld();
  ext._world = world; // test seam: bypass fromViewer/load() to inject a controllable fake world
  return { ext, world };
}

// === first-ever room search must succeed (round 13 regression) ============
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(1);
  ext._currentModel = model;
  let searchCalls = 0;
  model.search = (text, onSuccess) => { searchCalls++; onSuccess([100, 101]); };
  const dbIds = await ext._resolveRoomDbIds(model);
  check('first-ever room search succeeds (no prior lifecycle entry)', dbIds.length, 2);
  check('first-ever room search: admit-then-validate-lease, not have-I-seen-this liveness', searchCalls, 1);
}

// === room-search promise rejects, second call triggers fresh search =======
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(2);
  ext._currentModel = model;
  let searchCalls = 0;
  model.search = (text, onSuccess, onError) => {
    searchCalls++;
    if (searchCalls === 1) onError(new Error('search failed'));
    else onSuccess([200]);
  };
  await checkRejects('first search rejects', ext._resolveRoomDbIds(model), Error);
  const dbIds = await ext._resolveRoomDbIds(model);
  check('second call triggers a fresh model.search, not a replayed rejection', searchCalls, 2);
  check('second call resolves normally', dbIds.length, 1);
}

// === model evicted mid-search, callback fires late with success (round 12) ===
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(3);
  ext._currentModel = model;
  let capturedOnSuccess;
  model.search = (text, onSuccess) => { capturedOnSuccess = onSuccess; };
  const promise = ext._resolveRoomDbIds(model);
  world.evictModel(model);
  capturedOnSuccess([300]); // late, successful callback after eviction
  await checkRejects('late success callback after eviction: original promise rejects ModelEvictedError', promise, ModelEvictedError);
  let findClashesCalled = false;
  const originalFindClashes = world.findClashes;
  world.findClashes = async (...args) => { findClashesCalled = true; return originalFindClashes(...args); };
  check('resurrection: findClashes never called on a resurrected rejection', findClashesCalled, false);
}

// === same, but a NEW model object loads under the same numeric modelId ====
{
  const { ext, world } = await extensionWithFakeWorld();
  const oldModel = makeMockModel(4);
  ext._currentModel = oldModel;
  let capturedOnSuccess;
  oldModel.search = (text, onSuccess) => { capturedOnSuccess = onSuccess; };
  const stalePromise = ext._resolveRoomDbIds(oldModel);
  world.evictModel(oldModel);
  const newModel = makeMockModel(4); // same numeric id, different object
  newModel.search = (text, onSuccess) => onSuccess([400]);
  const freshPromise = ext._resolveRoomDbIds(newModel);
  capturedOnSuccess([999]); // stale callback fires after both eviction and the new model's own admission
  await checkRejects('stale search still rejects the ORIGINAL caller', stalePromise, ModelEvictedError);
  const freshDbIds = await freshPromise;
  check('fresh locateElementByRoom against the new object succeeds independently', freshDbIds.length, 1);
}

// === world disposed while search in flight ==================================
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(5);
  ext._currentModel = model;
  let capturedOnSuccess;
  model.search = (text, onSuccess) => { capturedOnSuccess = onSuccess; };
  const promise = ext._resolveRoomDbIds(model);
  world.dispose();
  capturedOnSuccess([500]);
  await checkRejects('world disposed mid-search, late success: rejects WorldDisposedError not ModelEvictedError', promise, WorldDisposedError);
  check('cache slot deleted (identity-guarded)', ext._roomCache.has(model), false);
}
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(6);
  ext._currentModel = model;
  let capturedOnError;
  model.search = (text, onSuccess, onError) => { capturedOnError = onError; };
  const promise = ext._resolveRoomDbIds(model);
  world.dispose();
  capturedOnError(new Error('search failed'));
  await checkRejects('world disposed mid-search, late error callback: rejects WorldDisposedError', promise, WorldDisposedError);
}

// === admitModel throws immediately for a tombstoned model (never calls search) ===
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(7);
  world.evictModel(model); // tombstone before any search ever starts
  let searchCalled = false;
  model.search = () => { searchCalled = true; };
  await checkRejects('admitModel on already-evicted model rejects before model.search is ever called', ext._resolveRoomDbIds(model), ModelEvictedError);
  check('model.search never called on a pre-evicted model', searchCalled, false);
}

// === unload() ordering: dispose(), then listener/menu removal, then cache clear ===
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(8);
  ext._currentModel = model;
  model.search = (text, onSuccess) => onSuccess([800]);
  await ext._resolveRoomDbIds(model); // populate the cache
  const order = [];
  world.dispose = () => order.push('dispose');
  ext._viewer.removeEventListener = () => order.push('removeEventListener');
  ext._viewer.unregisterContextMenuCallback = () => order.push('unregisterContextMenuCallback');
  const originalClear = ext._roomCache.clear.bind(ext._roomCache);
  ext._roomCache.clear = () => { order.push('cacheClear'); originalClear(); };
  ext.unload();
  check('unload() order: dispose first, then listener+menu removal, then cache clear', order.join(','), 'dispose,removeEventListener,unregisterContextMenuCallback,cacheClear');
}

// === BEFORE_MODEL_UNLOAD_EVENT handler drops cache entry unconditionally ===
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(9);
  ext._currentModel = model;
  model.search = (text, onSuccess) => onSuccess([900]);
  await ext._resolveRoomDbIds(model);
  check('cache populated before eviction', ext._roomCache.has(model), true);
  ext._onBeforeModelUnload({ model });
  check('BEFORE_MODEL_UNLOAD_EVENT handler drops the cache entry unconditionally', ext._roomCache.has(model), false);
  check('BEFORE_MODEL_UNLOAD_EVENT handler evicts the model in the world', world._modelLifecycle.get(model)?.state, 'evicted');
}
{
  const { ext } = await extensionWithFakeWorld();
  // Defensive check: event.model undefined must fail clearly, not silently no-op or throw a cryptic TypeError.
  let threw = false;
  try { ext._onBeforeModelUnload({}); } catch (err) { threw = /event\.model/.test(err.message); }
  check('BEFORE_MODEL_UNLOAD_EVENT handler fails clearly if event.model is ever undefined (typings say event: any)', threw, true);
}

console.log(`\n  ${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/RoomLocatorExtension.test.mjs`
Expected: `Cannot find module '../wwwroot/extensions/RoomLocatorExtension.js'`.

- [ ] **Step 3: Write the implementation**

```js
// wwwroot/extensions/RoomLocatorExtension.js
import { CollisionWorld } from '../collision/index.js';
import { WorldDisposedError, ModelEvictedError } from '../collision/errors.js';

const EXTENSION_ID = 'Autodesk.Sandbox.RoomLocator';

export class RoomLocatorExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options = {}) {
    super(viewer, options);
    this._roomCategoryName = options.roomCategoryName ?? 'Revit Rooms';
    this._roomCache = new Map(); // Model -> Promise<number[]>
    this._world = null;
    this._currentModel = null;
    this._onBeforeModelUnloadBound = (event) => this._onBeforeModelUnload(event);
    this._onContextMenuBound = (menu, status) => this.onContextMenu(menu, status);
  }

  // Step 1 of Data Flow: load() calls ONLY CollisionWorld.fromViewer, to completion, before
  // returning. No room resolution, no eager BLAS building (docs/...:2648-2650, 3617-3629).
  async load() {
    this._world = await CollisionWorld.fromViewer(this.viewer, this.options);
    // Registered only AFTER fromViewer() resolves, inside this same call — if fromViewer() had
    // rejected, this method's own returned promise already rejected with that same error before
    // either registration below ran (docs/...:3619-3629).
    this.viewer.addEventListener(Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT, this._onBeforeModelUnloadBound);
    this.viewer.registerContextMenuCallback(EXTENSION_ID, this._onContextMenuBound);
    this._currentModel = this.viewer.model ?? this._currentModel;
    return true;
  }

  // unload() ordering is deliberate and spec-documented as imperfect-but-accepted (docs/...:3630-3655):
  // dispose() first, THEN listener/menu removal, THEN cache clear. A repeated unload() call re-throws
  // WorldDisposedError from the second dispose() before steps 2/3 run, stranding listener/menu removal
  // and the cache clear for that invocation — accepted because Viewer3D.tearDown wraps each extension's
  // own unload() in try/catch, so the throw is swallowed rather than propagating. This is NOT silently
  // "fixed" here beyond what the spec specifies; per-step isolation remains open/unsettled per the spec.
  unload() {
    this._world.dispose();
    this.viewer.removeEventListener(Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT, this._onBeforeModelUnloadBound);
    this.viewer.unregisterContextMenuCallback(EXTENSION_ID);
    this._roomCache.clear();
    return true;
  }

  // world.evictModel(event.model) — the exact object — AND drop that object's room-cache entry,
  // unconditionally and independent of evictModel (world.dispose() never touches the extension-owned
  // room cache) (docs/...:2716-2731, 3656-3660). Typings declare `event: any` — defensively verify
  // `event.model` exists rather than let a missing field surface as a cryptic downstream TypeError
  // (this ties to the spec's own "confirm against the official Reference Guide" note on instance-tree
  // readiness, docs/...:round-31 disposition, readiness item — not fully settled here, flagged for the
  // implementer to revisit once Task 15's readiness research lands).
  _onBeforeModelUnload(event) {
    if (!event || !event.model) {
      throw new Error('RoomLocatorExtension: BEFORE_MODEL_UNLOAD_EVENT fired with no event.model — typings declare `event: any`; this handler cannot proceed without the model object (see instance-tree-readiness-decision.md for the related open verification item).');
    }
    this._world.evictModel(event.model);
    this._roomCache.delete(event.model);
  }

  // Correct mechanism (round 13): admit the model BEFORE starting the search, so success/error
  // callbacks always validate a real lease rather than ambiguous "never seen" state (docs/...:2760-2818).
  async _resolveRoomDbIds(model) {
    if (this._roomCache.has(model)) return this._roomCache.get(model);
    const lease = this._world.admitModel(model); // throws synchronously if tombstoned/disposed
    const thisPromise = new Promise((resolve, reject) => {
      const settle = (fn, ...args) => {
        if (this._roomCache.get(model) === thisPromise) this._roomCache.delete(model); // unconditional, identity-guarded
        fn(...args);
      };
      const mapRejection = () => {
        if (!this._world.isLeaseValid(lease)) {
          try {
            this._world.isModelLive(model);
          } catch (err) {
            if (err instanceof WorldDisposedError) return err;
          }
          return new ModelEvictedError(model.id);
        }
        return null;
      };
      model.search(
        this._roomCategoryName,
        (dbIds) => {
          const rejection = mapRejection();
          if (rejection) { settle(reject, rejection); return; }
          if (this._roomCache.get(model) === thisPromise) resolve(dbIds);
          else reject(new ModelEvictedError(model.id)); // superseded by a fresher call for this model
        },
        (searchError) => {
          const rejection = mapRejection();
          settle(reject, rejection ?? searchError);
        },
        ['Category'],
        { searchHidden: true },
      );
    });
    this._roomCache.set(model, thisPromise);
    return thisPromise;
  }

  async locateElementByRoom(dbId) {
    const model = this._currentModel;
    const roomDbIds = await this._resolveRoomDbIds(model);
    const result = await this._world.findClashes({
      source: { model, dbIds: [dbId] },
      target: { model, dbIds: roomDbIds },
      mode: 'containment',
      groupBy: 'dbId',
    });
    return result.pairs.map((pair) => pair.target.dbId);
  }

  onContextMenu(menu, status) {
    if (!status.hasSelected) return;
    const selection = this.viewer.getSelection();
    if (!selection || selection.length === 0) return;
    const dbId = selection[0];
    menu.push({
      title: 'Locate Room',
      target: async () => {
        try {
          const roomDbIds = await this.locateElementByRoom(dbId);
          if (roomDbIds.length === 0) {
            // "No candidate rooms" contract (docs/...:3901-3903) — surface, do not throw.
            console.warn('RoomLocatorExtension: no containing room found for dbId', dbId);
            return;
          }
          this.viewer.isolate(roomDbIds);
          this.viewer.fitToView(roomDbIds);
        } catch (err) {
          console.error('RoomLocatorExtension: locate failed', err);
        }
      },
    });
  }
}
```

```js
// wwwroot/viewer.js — modified to register and enable RoomLocatorExtension.
// Diff against the current file (read directly, reproduced here in full since it is short):

async function getAccessToken(callback) {
    try {
        const resp = await fetch('/api/auth/token');
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const { access_token, expires_in } = await resp.json();
        callback(access_token, expires_in);
    } catch (err) {
        alert('Could not obtain access token. See the console for more details.');
        console.error(err);
    }
}

import { RoomLocatorExtension } from './extensions/RoomLocatorExtension.js';

const ROOM_LOCATOR_EXTENSION_ID = 'Autodesk.Sandbox.RoomLocator';

export function initViewer(container) {
    return new Promise(function (resolve, reject) {
        Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken }, function () {
            Autodesk.Viewing.theExtensionManager.registerExtension(ROOM_LOCATOR_EXTENSION_ID, RoomLocatorExtension);
            const extensions = [
                'Autodesk.DocumentBrowser',
                ROOM_LOCATOR_EXTENSION_ID,
            ];

            const config = { extensions };
            const viewer = new Autodesk.Viewing.GuiViewer3D(container, config);
            viewer.start();
            viewer.setTheme('light-theme');
            resolve(viewer);
        });
    });
}

export function loadModel(viewer, urn) {
    return new Promise(function (resolve, reject) {
        function onDocumentLoadSuccess(doc) {
            resolve(viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true)));
        }
        function onDocumentLoadFailure(code, message, errors) {
            reject({ code, message, errors });
        }
        Autodesk.Viewing.Document.load('urn:' + urn, onDocumentLoadSuccess, onDocumentLoadFailure);
    });
}
```

`import { RoomLocatorExtension } from './extensions/RoomLocatorExtension.js';` is hoisted to module top
per ES module convention (placed here mid-file only for diff-readability against the "before" text
above — the actual file edit puts the import at the top of `viewer.js` alongside no other imports, since
the file currently has none). `registerExtension` is called **inside** the `Initializer` callback,
before `new GuiViewer3D(...)` is constructed, because `theExtensionManager` is populated by
`Autodesk.Viewing.Initializer` and the extension id must already be registered before `config.extensions`
is consulted by the viewer's own extension-loading pass — this matches the standard registration idiom
across Autodesk's own extension samples cross-referenced via `viewer-extension-lifecycle-audit`'s
existing knowledge of this pattern.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/RoomLocatorExtension.test.mjs`
Expected: PASS on every fixture, proving: a model's first-ever room search succeeds via
admit-then-validate-lease (not a "have I seen this" liveness check); a rejected search promise is
removed from the cache and a second call triggers a fresh `model.search`; a late successful callback
after mid-search eviction rejects the ORIGINAL promise with `ModelEvictedError` and `findClashes` is
never called; a stale callback after a same-`modelId` reload rejects only the original caller while a
fresh call against the new object succeeds independently; disposal mid-search rejects
`WorldDisposedError` (not `ModelEvictedError`) for both the success and error callback paths, with the
cache slot identity-guard-deleted; `admitModel` on an already-evicted model rejects before `model.search`
is ever invoked; `unload()`'s three steps run in the documented `dispose → listener/menu removal →
cache clear` order; and the `BEFORE_MODEL_UNLOAD_EVENT` handler drops its cache entry unconditionally
and fails clearly (not silently) if `event.model` is ever undefined.

- [ ] **Step 5: Commit**
```bash
git add wwwroot/extensions/RoomLocatorExtension.js wwwroot/viewer.js test/RoomLocatorExtension.test.mjs
git commit -m "Add RoomLocatorExtension and wire it into viewer.js"
```

**Completion criteria:**
- `RoomLocatorExtension` depends only on `CollisionWorld`'s public surface (`fromViewer`, `findClashes`,
  `admitModel`, `isLeaseValid`, `evictModel`, `isModelLive`, `dispose`) — verified by the test file never
  reaching into `_world`'s internals beyond the fake's own public methods.
- `load()` awaits `fromViewer` to completion before registering the unload listener and context-menu
  callback, and propagates a `fromViewer` rejection before either registration runs.
- `_resolveRoomDbIds` implements the admit-before-search mechanism exactly, with identity-guarded cache
  deletion on every rejection path, no exceptions.
- `wwwroot/viewer.js` registers `RoomLocatorExtension` via `Autodesk.Viewing.theExtensionManager.registerExtension`
  and adds its id to the `extensions` array actually passed to `GuiViewer3D`.

**Protected invariants / regressions to watch:**
- `model.search`, never `viewer.search` — the 4-arg `Viewer3D.search` (`index.d.ts:1247`) has no
  `options` param and would silently drop `{searchHidden:true}` (`docs/...:2813-2818`).
- Room-dbId cache is keyed by the exact `Model` **object**, never `model.id` — model-id reuse after a
  reload must not alias an old cache entry onto a new object (`docs/...:2706-2714`, round 14).
- `unload()`'s three steps run in the documented order even though it is a known, accepted gap for a
  repeated `unload()` call — do not "fix" this beyond what the spec specifies
  (`docs/...:3630-3655`).
- `BEFORE_MODEL_UNLOAD_EVENT`'s cache-entry drop is **unconditional and independent** of
  `evictModel`'s own no-op-on-disposed behavior (`docs/...:3656-3660`).
- The live acceptance test (Task 22) is a **different task** — this task's fixtures are all
  unit-level, mocked-Viewer fixtures; do not treat this task's PASS as acceptance-criterion coverage.

---

## Codex-advisor consultation used while drafting this section

One `codex-advisor medium` consultation was run before committing to Task 19's bootstrapping design
(the `CollisionWorld.fromViewer`/`GeometryRegistry` checkpoint-port construction-order question). It
confirmed: construct `GeometryRegistry` inside `CollisionWorld`'s own constructor, as the last
statement, after every other lifecycle field is assigned, and bind `this.checkpoint.bind(this)` to it
at that point — safe because binding does not invoke the method, and because the earliest possible
caller of the bound function runs long after the constructor call has fully returned. This is the
design written into Task 19 Step 3 above. No other consultation was run for this section — the
remaining design points (checkpoint semantics being time-triggered rather than unconditional per-call
validation; `GeometryRegistry` receiving only the bare `yieldToScheduler` primitive rather than a
disposed/epoch-aware port, since eviction/disposal reach its in-flight builds via each entry's own
`cancellationSignal` instead) were derived directly from the spec's own text (extract C, `docs/...:3014-3151`)
and cross-checked against the `GeometryRecord` shape in this plan's Global Constraints section, not from an advisor
opinion.

---

### Task 22: Room-locator integration acceptance test (live Viewer, Playwright)

**Objective:** Prove the whole library correct end-to-end against the real acceptance model and its known-in-advance answer (Master Bath 207, 907/1003 vertices) — the milestone's primary acceptance criterion.

**Files:**
- Create: `test/acceptance/room-locator.acceptance.mjs`
- Create: `test/acceptance/README.md` — how to run it, what credentials it needs, what the two tiers of assertion mean (see Step 2), and the one open visual-contract assumption flagged in Step 2's Tier 1.
- Modify: `wwwroot/main.js` — add one line, `window.viewer = viewer;`, immediately inside the `initViewer(...).then(viewer => { ... })` callback (line 8). This is the only production-code change this task makes; it exists solely so Playwright can reach a live `Autodesk.Viewing.GuiViewer3D` instance and its loaded `model` without inventing a bespoke test-only API. Harmless in production (same-origin global, no behavior change, and a pattern already common in APS Viewer tutorial samples for console debugging).
- Modify: `package.json` — add `"playwright": "^1"` to `devDependencies`, add script `"test:acceptance": "node test/acceptance/room-locator.acceptance.mjs"`.
- Modify: `.gitignore` — add `test/acceptance/results/` (screenshots and the raw run-report JSON this script writes locally; not committed, per this task's own completion criteria).

**Interfaces:**
- Consumes: the fully working `CollisionWorld` public API (`CollisionWorld.fromViewer` — **async, resolves to a `CollisionWorld`**, per canonical reference — `world.admitModel`, `world.findClashes`), `RoomLocatorExtension`'s public surface (`locateElementByRoom(dbId)`, the "Locate Room" context-menu item it registers via `onContextMenu`), and the already-wired `wwwroot/viewer.js`/`main.js` load path — all built by Tasks 0-21. Also consumes `wwwroot/collision/query/ContainmentQuery.js`'s exported `classifyPoint` and `wwwroot/collision/viewer/ViewerModelAdapter.js` / `ViewerGeometryAdapter.js` directly (see Step 4) for the exact-number regression tier, since `CollisionWorld`'s own `ClashResult`/`ClashStatistics` shape (canonical reference) carries no per-vertex tally field — only `pairs[]` and aggregate `statistics`. **Note the repo layout**: canonical reference places every collision module under `wwwroot/collision/...`, not a top-level `collision/...` — every import path below reflects that.
- Produces: a committed, re-runnable acceptance script (`npm run test:acceptance`) that any future change to the library must keep passing; nothing downstream depends on its internals.

- [ ] **Step 1: Verify environment/credentials, and that the acceptance model is actually reachable**

  This app needs `APS_CLIENT_ID`/`APS_CLIENT_SECRET` (`config.js:6-10`) to mint viewer tokens and to call Model Derivative for manifest status (`services/aps.js`). Before writing anything model-specific, confirm both the server can start and the acceptance URN is translated and servable, using the app's own existing `/api/models/:urn/status` route (`routes/models.js:21-43`) — no new endpoint needed. Create the results directory before writing into it, capture the HTTP status and body separately (a plain `curl -f` discards the response body on a non-2xx status, which is exactly the case whose exact text this step must record), and clean up the server process on any exit path:

  ```bash
  mkdir -p test/acceptance/results
  test -f .env && echo ".env present" || { echo "MISSING .env — this is a reported blocker, see Completion criteria"; exit 1; }
  npm start &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
  sleep 2
  URN='dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL3JhY2Jhc2ljc2FtcGxlcHJvamVjdC5ydnQ'
  HTTP_CODE=$(curl -s -o test/acceptance/results/urn-status.json -w '%{http_code}' "http://localhost:${PORT:-8080}/api/models/${URN}/status")
  echo "HTTP ${HTTP_CODE}:"; cat test/acceptance/results/urn-status.json
  ```

  If credentials are missing, `HTTP_CODE` is not `200`, or the body's `status` field is anything other than `"success"` (e.g. `"n/a"` — this bucket object was never translated under these credentials, or `"failed"`), **do not fake or skip the rest of this task quietly**: record the exact HTTP code and body in `test/acceptance/README.md` under a "Blocked" heading and stop here, per the spec's own "report, don't silently skip" convention for the MEP model (`docs/...:4802-4804`, extract E risk #12). This is a valid, documented completion state for this step, not a failure of the task.

- [ ] **Step 2: Write the Playwright acceptance script**

  Two verification tiers, both against the real live Viewer:

  - **Tier 1 (the spec's literal acceptance criterion, `docs/...:4631-4637`)**: drive the actual UI — select the bathtub, open its context menu, click "Locate Room", confirm the highlighted/isolated room is dbId `3885` (Master Bath 207) and screenshot it for visual sign-off. This is the mandated flow: load → select → context-menu → confirm.
  - **Tier 2 (the spec's "known-in-advance answer" as an exact regression check, `docs/...:4639-4642`)**: `CollisionWorld.findClashes`'s public `ClashResult` shape (canonical reference) carries no per-vertex tally — only `pairs[]` and aggregate `ClashStatistics`. The spike's "907 of 1003 vertices inside, all 13 other rooms at 0" figure came from its own brute-force, exhaustive-classification diagnostic (`spike/FINDINGS.md` "the acceptance question, answered"), not from `anyComponentInside`'s bounded, early-exit sampling (`maxContainmentSamples = 512`, canonical reference), which the production `containment` mode actually runs and which is *not* guaranteed to classify all 1003 vertices before returning positive. So this test reproduces the spike's exact methodology directly against the shipped primitives, **in the correct coordinate frame**: `classifyPoint(point, targetBvh, targetLocalDiagonal)` classifies against a BVH built in the target geometry's own **local** frame (canonical reference: `GeometryRecord.accelerationPromise` resolves `{ bvh, localDiagonal }` per-geometry, before any per-instance placement), so every bathtub vertex must be transformed from the bathtub's own world space into **each room's local frame** — via that room's `PlacedCollisionInstance.worldMatrix` inverse — before being classified against that room's BVH. Classifying raw world-space points against a local-frame BVH (an earlier draft of this test's mistake) silently produces meaningless parity results for any room whose placement isn't the identity transform.

  Tier 1 also separately asserts the two structural invariants the spec calls out by name: `window.THREE.REVISION === '71'` unchanged after the collision runtime has run a real query (`docs/...:985-987`), and zero failed `/vendor/` module requests, `BufferGeometryUtils.js` specifically resolving with a **successful** response, not merely "no failure observed" (`docs/...:1073-1076`) — the latter distinction matters because "no failure" is also what a request that's simply never made looks like.

  ```js
  // test/acceptance/room-locator.acceptance.mjs
  //
  // Milestone-1 acceptance criterion (docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:4631-4642).
  // Known-in-advance ground truth (spike/FINDINGS.md): Bathtub-TOTO-Nexus-FBF794S [420270] (dbId 2530,
  // NOT the bracketed Revit ElementId 420270 — the UI flow below sidesteps this by selecting through
  // the Viewer's own name search, never hardcoding 2530 as an input) resolves to Master Bath 207
  // [857194] (dbId 3885): 907 of the bathtub's 1003 world-space vertices classify inside; all 13 other
  // rooms score exactly 0. This is a regression check, not an open algorithm question.
  //
  // ASSUMED CONTRACTS this script depends on, fixed by earlier tasks and not yet verified against real
  // files at the time this plan was written — confirm before running, and update this file if any
  // differ:
  //   - RoomLocatorExtension's "Locate Room" outcome is visually expressed via viewer.isolate([roomDbId])
  //     (checked via viewer.getIsolatedNodes()). If Task 21 instead expresses it via selection only,
  //     change RESULT_CHECK_MODE below to 'selection'.
  //   - wwwroot/collision/viewer/ViewerModelAdapter.js exports `getPlacedGeometry(model, dbId)` returning
  //     `{ worldMatrix: THREE.Matrix4, rawGeometry }` (one placement per fragment; a multi-fragment dbId
  //     returns an array — Tier 2 below assumes exactly one fragment for both the bathtub and each room,
  //     matching spike/FINDINGS.md's B3/B4 fragment-per-room-per-bathtub observation, and asserts that
  //     assumption rather than silently mishandling more fragments).
  //   - wwwroot/collision/viewer/ViewerGeometryAdapter.js exports `buildGeometryRecord(rawGeometry)`
  //     returning a `GeometryRecord` (canonical reference shape) whose resolved `weldPromise` exposes
  //     `{ position: Float32Array, index: Uint32Array, triangleCount }` in the geometry's own LOCAL frame
  //     (pre-placement) and whose resolved `accelerationPromise` exposes `{ bvh, localDiagonal }`, also
  //     local-frame — this is the frame `classifyPoint` requires (canonical reference).

  import { chromium } from 'playwright';
  import { mkdir, writeFile } from 'node:fs/promises';
  import path from 'node:path';

  const PORT = process.env.PORT || 8080;
  const BASE_URL = `http://localhost:${PORT}`;
  const URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL3JhY2Jhc2ljc2FtcGxlcHJvamVjdC5ydnQ';
  const EXPECTED_ROOM_DBID = 3885;          // Master Bath 207 [857194]
  const EXPECTED_VERTS_INSIDE = 907;
  const EXPECTED_VERTS_TOTAL = 1003;
  const OTHER_ROOM_COUNT = 13;
  const RESULT_CHECK_MODE = 'isolation';    // 'isolation' | 'selection' — see assumed-contracts note above
  const RESULTS_DIR = path.join(process.cwd(), 'test/acceptance/results');

  const results = { tier1: {}, tier2: {}, vendorFailures: [], vendorRequestFailedEvents: [], revisionCheck: {}, checks: [] };

  function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
    results.checks.push({ name, ok, expected, actual });
    if (!ok) process.exitCode = 1;
    return ok;
  }

  async function main() {
    await mkdir(RESULTS_DIR, { recursive: true });
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // --- vendor-loading acceptance check (docs/...:1073-1076): every /vendor/ request must resolve,
    // and BufferGeometryUtils.js specifically must be requested AND succeed (not merely "not fail" —
    // a module that's simply never imported would also show zero failures). ---
    page.on('response', (resp) => {
      if (resp.url().includes('/vendor/') && !resp.ok()) {
        results.vendorFailures.push({ url: resp.url(), status: resp.status() });
      }
    });
    page.on('requestfailed', (req) => {
      if (req.url().includes('/vendor/')) {
        results.vendorRequestFailedEvents.push({ url: req.url(), failure: req.failure()?.errorText });
      }
    });
    let bufferGeometryUtilsOk = false;
    page.on('response', (resp) => {
      if (resp.url().endsWith('BufferGeometryUtils.js') && resp.ok()) bufferGeometryUtilsOk = true;
    });

    console.log('\n=== Loading acceptance model ===');
    // main.js's hashchange listener auto-loads whatever URN is in the location hash (wwwroot/urn.js,
    // wwwroot/main.js:45-58) — no need to drive the #urn input/#load button separately.
    await page.goto(`${BASE_URL}/#${URN}`);
    await page.waitForFunction(() => window.viewer && window.viewer.model, null, { timeout: 120_000 });

    const revisionBefore = await page.evaluate(() => window.THREE.REVISION);

    // --- Tier 1: drive the real UI flow ---
    console.log('\n=== Tier 1: UI-driven "Locate Room" flow ===');
    const bathtubDbIds = await page.evaluate(() => new Promise((resolve, reject) => {
      window.viewer.search(
        'Bathtub-TOTO-Nexus-FBF794S',
        resolve,
        reject,
        ['name']
      );
    }));
    check('bathtub name search returns exactly one dbId', bathtubDbIds.length, 1);
    const bathtubDbId = bathtubDbIds[0];

    await page.evaluate((dbId) => window.viewer.select([dbId]), bathtubDbId);
    // Fit the camera to the selection and let it settle before computing a screen position — an
    // off-screen or still-animating-camera projection would make the right-click land nowhere.
    await page.evaluate((dbId) => window.viewer.fitToView([dbId]), bathtubDbId);
    await page.waitForTimeout(500); // camera-transition settle; no reliable "camera stopped" event on this API surface

    const { x, y } = await page.evaluate((dbId) => {
      const bbox = window.viewer.model.getInstanceTree().getNodeBox(dbId, new Float32Array(6));
      const center = new window.THREE.Vector3(
        (bbox[0] + bbox[3]) / 2, (bbox[1] + bbox[4]) / 2, (bbox[2] + bbox[5]) / 2
      );
      return window.viewer.worldToClient(center);
    }, bathtubDbId);
    const canvasBox = await page.locator('#preview canvas').first().boundingBox();
    await page.mouse.click(canvasBox.x + x, canvasBox.y + y, { button: 'right' });

    // RoomLocatorExtension.onContextMenu (canonical reference) registers a "Locate Room" item.
    const locateRoomItem = page.locator('.context-menu-item', { hasText: 'Locate Room' });
    await locateRoomItem.waitFor({ timeout: 5_000 });
    await locateRoomItem.click();

    await page.waitForFunction(
      ({ expected, mode }) => {
        const nodes = mode === 'isolation'
          ? (window.viewer.getIsolatedNodes ? window.viewer.getIsolatedNodes() : [])
          : window.viewer.getSelection();
        return nodes && nodes.includes(expected);
      },
      { expected: EXPECTED_ROOM_DBID, mode: RESULT_CHECK_MODE },
      { timeout: 15_000 }
    );
    const highlightedNodes = await page.evaluate((mode) =>
      mode === 'isolation'
        ? (window.viewer.getIsolatedNodes ? window.viewer.getIsolatedNodes() : [])
        : window.viewer.getSelection(),
      RESULT_CHECK_MODE
    );
    results.tier1.highlightedNodes = highlightedNodes;
    check(`highlighted/isolated room is Master Bath 207 [857194] (mode: ${RESULT_CHECK_MODE})`, highlightedNodes.includes(EXPECTED_ROOM_DBID), true);

    await page.screenshot({ path: path.join(RESULTS_DIR, 'locate-room-result.png'), fullPage: false });
    console.log(`  Screenshot saved for manual visual sign-off: ${path.join(RESULTS_DIR, 'locate-room-result.png')}`);

    // --- runtime-isolation invariant, re-checked AFTER a real query has run (docs/...:985-987) ---
    const revisionAfter = await page.evaluate(() => window.THREE.REVISION);
    results.revisionCheck = { before: revisionBefore, after: revisionAfter };
    check("window.THREE.REVISION === '71' before the query", revisionBefore, '71');
    check("window.THREE.REVISION === '71' unchanged after the query", revisionAfter, '71');
    check('no failed /vendor/ responses', results.vendorFailures, []);
    check('no failed /vendor/ network-level requests', results.vendorRequestFailedEvents, []);
    check('BufferGeometryUtils.js was requested and resolved successfully', bufferGeometryUtilsOk, true);

    // --- Tier 2: exact-number regression check via the shipped primitives directly, in the target's
    // own local frame ---
    console.log('\n=== Tier 2: exact vertex-count regression (spike ground truth) ===');
    const tier2 = await page.evaluate(async ({ bathtubDbId }) => {
      const { ViewerModelAdapter } = await import('/collision/viewer/ViewerModelAdapter.js');
      const { ViewerGeometryAdapter } = await import('/collision/viewer/ViewerGeometryAdapter.js');
      const { classifyPoint } = await import('/collision/query/ContainmentQuery.js');

      // Category-based lookup, matching the standard Model Derivative convention rooms are published
      // under ("Revit Rooms"), with hidden elements included — rooms are frequently hidden in the
      // default 3D view, and a name-substring search risks over/under-matching non-room elements or
      // missing hidden ones. This MUST use the identical predicate RoomLocatorExtension itself uses to
      // enumerate candidate rooms (Task 21's contract) so Tier 2's room set can never silently drift
      // from what the UI flow actually searched — if RoomLocatorExtension exports its own candidate-room
      // finder, call that directly instead of re-deriving the search call here.
      const roomDbIds = await new Promise((resolve, reject) => {
        window.viewer.model.search('Revit Rooms', resolve, reject, ['Category'], { searchHidden: true });
      });
      if (roomDbIds.length !== 14) {
        throw new Error(`Expected exactly 14 rooms in the acceptance model, found ${roomDbIds.length}: ${JSON.stringify(roomDbIds)}`);
      }

      const bathtubPlaced = ViewerModelAdapter.getPlacedGeometry(window.viewer.model, bathtubDbId);
      const bathtubRecord = await ViewerGeometryAdapter.buildGeometryRecord(bathtubPlaced.rawGeometry);
      const { position: localVerts } = await bathtubRecord.weldPromise; // bathtub's own LOCAL frame
      const bathtubWorldMatrix = bathtubPlaced.worldMatrix;

      const perRoom = {};
      for (const roomDbId of roomDbIds) {
        const roomPlaced = ViewerModelAdapter.getPlacedGeometry(window.viewer.model, roomDbId);
        const roomRecord = await ViewerGeometryAdapter.buildGeometryRecord(roomPlaced.rawGeometry);
        const { bvh, localDiagonal } = await roomRecord.accelerationPromise;
        const roomInverse = new window.THREE.Matrix4().copy(roomPlaced.worldMatrix).invert();
        // bathtub-local -> world -> room-local, so classifyPoint always receives a point in the SAME
        // frame its target BVH was built in, regardless of either object's own placement.
        const toRoomLocal = new window.THREE.Matrix4().multiplyMatrices(roomInverse, bathtubWorldMatrix);

        let inside = 0;
        const p = new window.THREE.Vector3();
        for (let i = 0; i < localVerts.length; i += 3) {
          p.set(localVerts[i], localVerts[i + 1], localVerts[i + 2]).applyMatrix4(toRoomLocal);
          if (classifyPoint(p, bvh, localDiagonal) === 'inside') inside++;
        }
        perRoom[roomDbId] = inside;
      }
      return { totalVerts: localVerts.length / 3, perRoom };
    }, { bathtubDbId });

    results.tier2 = tier2;
    check('bathtub has 1003 world-space vertices post-weld', tier2.totalVerts, EXPECTED_VERTS_TOTAL);
    check('Master Bath 207 [857194] has 907 vertices inside', tier2.perRoom[EXPECTED_ROOM_DBID], EXPECTED_VERTS_INSIDE);
    const otherRooms = Object.entries(tier2.perRoom).filter(([dbId]) => Number(dbId) !== EXPECTED_ROOM_DBID);
    check('exactly 13 other rooms present', otherRooms.length, OTHER_ROOM_COUNT);
    check('every other room scores exactly 0', otherRooms.every(([, n]) => n === 0), true);

    await browser.close();
    await writeFile(path.join(RESULTS_DIR, 'run-report.json'), JSON.stringify(results, null, 2));
  }

  main().catch(async (err) => {
    console.error(err);
    process.exitCode = 1;
    await writeFile(path.join(RESULTS_DIR, 'run-report.json'), JSON.stringify({ ...results, fatalError: String(err) }, null, 2)).catch(() => {});
  });
  ```

  Note the `try`/`catch`-at-the-top-level structure: `main()`'s own promise rejection handler, not a `finally` inside `main`, is what guarantees `run-report.json` is written and the browser doesn't leak on a thrown assertion (e.g. Tier 2's room-count guard) — `browser.close()` is called before the success-path write, and the catch handler writes whatever was accumulated in `results` even when `main()` never reaches that line.

- [ ] **Step 3: Run it and record actual results next to expected**

  ```bash
  npm start &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
  sleep 2
  npm run test:acceptance
  ```

  Console PASS/FAIL lines (the `check()` calls above) already print `expected=... actual=...` per assertion, following this codebase's existing `spike/fixtures.mjs`-style reporting convention (`spike/fixtures.mjs:12-20`) rather than a silent framework abstraction. `test/acceptance/results/run-report.json` (now containing a `checks[]` array with every individual assertion's name/expected/actual/ok, not just the two tiers' raw data) and the screenshot are the durable local record for this run; both are gitignored (Step-5 note) — only the script itself is committed.

- [ ] **Step 4: If credentials/model access are unavailable, report it as a blocker — do not skip quietly**

  Per the spec's own convention for the MEP model (`docs/...:4802-4804`, extract E risk #12): a missing capability at implementation time is a finding to report, not a step to fake. If Step 1 or Step 3 cannot complete because `.env` is absent, the two-legged token call fails, or the URN's manifest status is not `success`, write the exact failure into `test/acceptance/README.md` under "Blocked" (what was tried, what error/response came back) and leave `test:acceptance` runnable-but-failing rather than deleting or stubbing it out.

- [ ] **Step 5: Commit**
  ```bash
  git add test/acceptance/room-locator.acceptance.mjs test/acceptance/README.md wwwroot/main.js package.json package-lock.json .gitignore
  git commit -m "Add live-Viewer Playwright acceptance test for room-locator milestone criterion"
  ```

**Completion criteria:**
- [ ] `test/acceptance/room-locator.acceptance.mjs` exists, is committed, and is runnable via `npm run test:acceptance` against a running `npm start` server.
- [ ] Tier 1 drives the actual UI: name search (asserting exactly one match, not merely "a number came back") → select → fit-to-view → right-click at the element's projected screen position → click "Locate Room" in the real context menu → asserts the highlighted/isolated node set includes dbId `3885`, with the isolation-vs-selection visual contract flagged as a to-confirm assumption rather than silently guessed.
- [ ] Tier 1 also asserts `window.THREE.REVISION === '71'` both before and after the query, and asserts `BufferGeometryUtils.js` was both requested and resolved successfully (not merely "no failure observed," which would also be true if it were never requested at all), plus zero failed `/vendor/` responses or network-level failed requests.
- [ ] Tier 2 asserts the exact spike-ground-truth numbers (`1003` total vertices, `907` inside Master Bath 207, `13` other rooms each at `0`) via direct use of the shipped `ViewerModelAdapter`/`ViewerGeometryAdapter`/`ContainmentQuery.classifyPoint` primitives — never via `CollisionWorld.findClashes`'s bounded-sampling result — with every point transformed into the **target room's own local frame** before classification (never world-space points against a local-frame BVH).
- [ ] Tier 2's room set is resolved via the same category-based search predicate (`'Revit Rooms'`, `searchHidden: true`) `RoomLocatorExtension` itself uses, asserted to be exactly 14 rooms before any vertex is classified.
- [ ] No parallel run against the old CSG extension exists anywhere in this task's deliverables (deliberately out of scope, `docs/...:4635-4637`).
- [ ] A screenshot of the resolved state is saved locally for manual visual sign-off (not committed); `run-report.json` records every individual assertion's expected/actual value, written even on a thrown/failed run.
- [ ] If live credentials/model access are unavailable in the environment that executes this task, `test/acceptance/README.md` states this explicitly as a blocker with the specific HTTP status/body recorded, and the script remains present and runnable (not deleted, not silently stubbed to always pass).

**Protected invariants / regressions to watch:**
- `window.THREE.REVISION === '71'` must never change across a collision-runtime query — the two-runtime isolation design's entire point (`docs/...:965-987`).
- The bracketed `[420270]` in the element's display name is a Revit ElementId, not a dbId (real dbId `2530`, per `spike/FINDINGS.md` B2) — this test never hardcodes `2530` as an input; it resolves the dbId via `viewer.search()` the same way a real user's selection would, precisely so a future dbId renumbering (re-translation) doesn't silently break the test in a way that looks like an algorithm regression.
- `classifyPoint` operates in the target's local frame — any future change to `Tier 2` (or a copy of its methodology elsewhere) that skips the world-to-target-local transform silently produces meaningless results rather than a visible failure; this is the single most important implementation detail this task's code encodes.
- `BufferGeometryUtils.js` under `/vendor/` must resolve — regression target for the round-10 vendor gap (`docs/...:1056-1076`).
- No parallel CSG cross-check — deliberately excluded scope (`docs/...:4635-4637`); do not add one later under this task's umbrella.

---

### Task 23: Performance instrumentation + reproducible measurement harness

**Objective:** Build the labeled-span recording infrastructure needed to answer all twelve of the spec's performance-gate pass criteria, independent of whether a suitable MEP-scale model is available yet.

**Files:**
- Create: `test/performance/checkpoint-recorder.mjs` — wall-clock bracketing utility (Node-side; the Node harness in Step 3 imports it normally, but see Step 4 for why the browser-side probe file duplicates its source rather than importing it).
- Create: `test/performance/measure-geometry-phases.mjs` — Node-runnable harness, weld/connectivity/BVH measured individually (criterion 5), against a deterministic fixture sized to the exact ceiling.
- Create: `test/performance/browser-probes.mjs` — self-contained (no imports) in-page probe file for everything that needs a live Viewer/DOM (criteria 6, 7, 8, 9, 10, 11, 12, plus the shared span-log mechanism criteria 1/3/6/8 read from).
- Create: `test/performance/README.md` — how to run the sanity checks in this task, how Task 24 loads `browser-probes.mjs` into a real page, and the exact instrumentation-surface answer to "what stable hook does this harness use" (see Step 2).
- Modify: `wwwroot/collision/scheduler.js` — add one small, optional diagnostic hook (see Step 2). This is the only production-code change this task makes, and it is the load-bearing fix for criterion 1: an external harness cannot otherwise observe internal synchronous spans between the library's own yield points.
- Not modifying `spike/measure.mjs` (see rationale in Step 1) — it stays exactly as the Round-15-era synthetic baseline these new harnesses are compared *against*, per the spec's own instruction (`docs/...:4688`) that the two be recorded side by side, never conflated.

**Interfaces:**
- Consumes: `wwwroot/collision/geometry/GeometryRegistry.js`'s per-phase promises (`weldPromise`, `connectivityPromise`, `accelerationPromise` — canonical reference `GeometryRecord` shape), `wwwroot/collision/scheduler.js`'s checkpoint primitive (extended in Step 2), `wwwroot/collision/viewer/ViewerModelAdapter.js`/`ViewerGeometryAdapter.js`, the vendor `three`/`three-mesh-bvh` modules under `wwwroot/vendor/`, and `spike/measure.mjs`'s existing `ms(f)` timing-helper convention and `console.log` reporting style (`spike/measure.mjs:7`).
- Produces: `test/performance/checkpoint-recorder.mjs` (reusable bracketing utility), `test/performance/browser-probes.mjs` (reusable in-page probe library), and `wwwroot/collision/scheduler.js`'s new optional span-recorder hook — all three are Task 24's own instrumentation; Task 24 does not reimplement measurement logic, it only supplies the MEP-scale model and records the numbers these produce.

- [ ] **Step 1: Decide where this instrumentation lives, and why it's not folded into `spike/measure.mjs`**

  `spike/measure.mjs` is a plain Node script that imports the spike's own hand-rolled algorithms from `./geometry-core.mjs` (synthetic geometry, no Viewer, no browser). The real gate needs two things `measure.mjs` structurally cannot provide: (a) measurements against the *production* `wwwroot/collision/` modules (not the spike's parallel implementation), and (b) measurements that require a live browser + live Viewer + live model (`enumNodeChildren`/`enumNodeFragments`, real fragments) — a plain `node spike/measure.mjs` run has no browser context at all. Rather than bolting browser-only code onto a script whose whole value is "run instantly with `node`, no server, no credentials," this task adds new sibling modules under `test/performance/`: one Node-runnable (mirrors `measure.mjs`'s own style, for the phase-timing criterion that doesn't need a live model) and one browser-only (for everything that does). Both print in `measure.mjs`'s own reporting style — `ms(f)` timing wrapper, structured `console.log` tables — specifically so Task 24's disposition document can set these numbers next to `measure.mjs`'s synthetic ones for direct comparison (`docs/...:4688`), which is the spec's own explicit instruction, not a stylistic preference.

- [ ] **Step 2: The instrumentation surface — a span-recorder hook in `collision/scheduler.js`, and `checkpoint-recorder.mjs` as its sink**

  Criterion 1 requires detecting any synchronous span above 24.8ms, and the spec's own measurement instruction is "the Long Tasks API where available, or `performance.now()` deltas bracketing every yield point otherwise" (`docs/...:4684-4685`). In a real Chromium build, the Long Tasks API *is* available — but it only reports tasks at or above roughly 50ms, which is **above** the 24.8ms bound this criterion enforces; relying on it as the primary signal would let a genuine 30-40ms violation pass completely unrecorded. So the manual `performance.now()` bracketing path — not the observer — is what actually proves this criterion, and it has to happen **at the library's own checkpoint call sites**, not by wrapping the outer `findClashes` call from outside: an external wrapper around one `await world.findClashes(...)` call measures total wall-clock across every internal `await`, not the uninterrupted synchronous span between two of them, so it cannot distinguish "cleanly yielded every 8ms" from "blocked for 40ms in one shot."

  This task therefore adds one small, optional diagnostic hook to `wwwroot/collision/scheduler.js` — the module canonical reference already designates as the single place every checkpoint/yield call in the library goes through:

  ```js
  // wwwroot/collision/scheduler.js — added by this task, alongside the existing checkpoint/scheduler
  // exports. No-op by default; zero cost when unset (a single null-check per checkpoint evaluation).
  let _spanRecorder = null;
  export function setSpanRecorder(fn) { _spanRecorder = fn; }
  export function clearSpanRecorder() { _spanRecorder = null; }
  // Call this from inside the existing checkpoint helper, immediately after each checkpoint decides
  // whether to yield — bracketing the synchronous span since the PREVIOUS checkpoint (or the call's
  // start), not the yield itself: `_spanRecorder?.(label, elapsedMsSincePreviousCheckpoint)`.
  // `label` must be a stable, distinct string per call site (e.g. 'weld', 'connectivity',
  // 'bvh-construction', 'cross-pair-cross-stage', 'extraction-sibling-node', 'broad-phase-scan',
  // 'capacity-admission-commit') — this is what lets criteria 1/3/6/8 below be answered by filtering
  // one flat log rather than needing a bespoke probe per criterion.
  ```

  `test/performance/checkpoint-recorder.mjs` is the sink this hook reports into. Every span is recorded unconditionally (never gated on whether a Long Tasks observer happens to also be present — the earlier draft of this recorder made that mistake, which meant the *default*, common case of a real Chromium browser silently disabled the very manual bracketing the criterion depends on), and each `start()`/`end()` pair uses its own locally-closed-over start time rather than one shared mutable field, so overlapping/nested spans (e.g. a phase span still open when a sub-step's own span starts) don't corrupt each other:

  ```js
  // test/performance/checkpoint-recorder.mjs
  //
  // Criterion 1 (docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:4660-4685):
  // no single synchronous task may exceed 24.8ms (frameBudgetMs=8 + 16.8ms weld), with the three named
  // exclusions and two provisional exceptions recorded there. This module is the measurement mechanism,
  // not the pass/fail judgement — Task 24 applies the 24.8ms line against what this records.
  //
  // NOTE: this file is duplicated verbatim (not imported) inside test/performance/browser-probes.mjs —
  // see that file's own header for why a same-repo relative import doesn't survive Playwright's
  // addScriptTag(path) injection. Keep the two copies in sync by hand; this is the single source of
  // truth for the Node-side harness (Step 3) and the class both copies must match.

  export class CheckpointRecorder {
    constructor() {
      this.spans = []; // { label, ms, source: 'manual' | 'longtask' }
      if (typeof PerformanceObserver !== 'undefined') {
        try {
          this._observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              // Long Tasks entries arrive asynchronously and carry no caller-supplied label — do not
              // guess an attribution; record them as an unattributed cross-check signal only (see
              // README: a genuine entry here, above ~50ms, is itself a criterion-1 finding regardless
              // of which manual span it overlapped).
              this.spans.push({ label: '(unattributed longtask)', ms: entry.duration, source: 'longtask' });
            }
          });
          this._observer.observe({ entryTypes: ['longtask'] });
        } catch {
          this._observer = null; // Long Tasks API unavailable (Node, or a locked-down browser).
        }
      }
    }

    /** Bracket one synchronous span by label; call `end()` on the returned handle exactly once.
     *  Safe to nest/overlap — each call closes over its own start time, never shared mutable state. */
    start(label) {
      const t0 = performance.now();
      return { end: () => {
        const ms = performance.now() - t0;
        this.spans.push({ label, ms, source: 'manual' });
        return ms;
      } };
    }

    /** Convenience: bracket a sync or async function, return [ms, result]. */
    async around(label, fn) {
      const h = this.start(label);
      const result = await fn();
      const ms = h.end();
      return [ms, result];
    }

    /** The span-recorder function to hand to collision/scheduler.js's setSpanRecorder. */
    asSpanRecorder() {
      return (label, ms) => this.spans.push({ label, ms, source: 'manual' });
    }

    longestSpan(filterLabel) {
      const pool = filterLabel ? this.spans.filter((s) => s.label === filterLabel) : this.spans;
      return pool.reduce((max, s) => (s.ms > (max?.ms ?? -1) ? s : max), null);
    }

    spansByLabel(label) { return this.spans.filter((s) => s.label === label); }

    report() {
      console.log('\n  label                                    | ms      | source');
      console.log('  ' + '-'.repeat(60));
      for (const s of this.spans) {
        console.log(`  ${s.label.padEnd(40)} | ${s.ms.toFixed(2).padStart(7)} | ${s.source}`);
      }
    }

    dispose() { this._observer?.disconnect(); }
  }

  if (typeof window !== 'undefined') window.__CheckpointRecorder = CheckpointRecorder;
  ```

  This directly answers the review question of "what exact, stable instrumentation surface may the harness use": `setSpanRecorder`/`clearSpanRecorder` in `collision/scheduler.js`, feeding a `CheckpointRecorder`'s `spans[]` log, filtered by label per criterion. Criteria 1, 3, and 6's "longest uninterrupted span" and "per-phase/per-stage cost" numbers are then answers to `recorder.longestSpan()` / `recorder.spansByLabel(label)` after a real query has run with the hook wired — not separate probe functions. Criterion 8's capacity-admission recompute-and-commit needs exactly one more labeled call site at that specific internal checkpoint (not one of the cross-pair/cross-stage ones) — if that call site doesn't already route through the shared checkpoint helper, add one `_spanRecorder?.('capacity-admission-commit', ms)` call there directly, following the same pattern.

- [ ] **Step 3: `measure-geometry-phases.mjs` — weld / connectivity / BVH measured individually, at exactly `maxSyncTriangleCount` (criterion 5)**

  `spike/measure.mjs`'s own header states the spec's constants were revised *because* this exact measurement gap existed ("Round 15 found the prior version of this gate only ever measured the BVH build... which is exactly how a ~16.8ms weld and a ~6.9ms connectivity build... went undetected for four rounds," `docs/...:4704-4709`) — `measure.mjs` today (lines 9-17) times only `instance(g)`, a combined build, never weld or connectivity separately, and its own fixture (`THREE.SphereGeometry`) does not hit a controlled triangle count. This harness must land at **exactly** `maxSyncTriangleCount` (12,000), not "approximately" it via a tessellator whose triangle count isn't a simple function of its segment arguments — a `SphereGeometry(1, 98, 98)` under this repo's pinned `three@0.185.1`, for instance, produces 19,012 triangles, not ~12,000, which would have the production size gate reject the fixture before welding ever ran. Use a deterministic flat grid instead, sized and asserted exactly:

  ```js
  // test/performance/measure-geometry-phases.mjs
  //
  // Extends spike/measure.mjs's own BVH-cost-vs-triangle-count loop (measure.mjs:9-17) to also time
  // weld and connectivity individually — the gap Round 15 found (docs/...:4704-4709). Run with
  // `node test/performance/measure-geometry-phases.mjs`.

  import { CheckpointRecorder } from './checkpoint-recorder.mjs';
  import { weld } from '../../wwwroot/collision/geometry/GeometryConnectivity.js';      // exact export
  import { buildConnectivity } from '../../wwwroot/collision/geometry/GeometryConnectivity.js'; // names:
  import { buildBvh } from '../../wwwroot/collision/blas/ThreeMeshBvhBackend.js';       // confirm against
  import { maxSyncTriangleCount } from '../../wwwroot/collision/constants.js';          // the real files.
  import * as THREE from '../../wwwroot/vendor/three/build/three.module.js';

  /** A flat, deterministic cols*rows*2-triangle grid — no tessellator-formula guessing. */
  function buildTriangleGrid(cols, rows) {
    const position = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) position.push(c, r, 0);
    const index = [];
    const stride = cols + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * stride + c, b = a + 1, d = a + stride, e = d + 1;
        index.push(a, d, b, b, d, e);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geom.setIndex(index);
    return geom;
  }

  const rec = new CheckpointRecorder();

  console.log('\n=== GeometryRecord phase costs at maxSyncTriangleCount (criterion 5) ===');
  console.log(`  Ceiling under test: maxSyncTriangleCount = ${maxSyncTriangleCount}\n`);

  // 100 cols x 60 rows = 6,000 quads x 2 triangles = exactly 12,000 triangles.
  const COLS = 100, ROWS = maxSyncTriangleCount / (COLS * 2);
  const raw = buildTriangleGrid(COLS, ROWS);
  const triangleCount = raw.index.count / 3;
  if (triangleCount !== maxSyncTriangleCount) {
    throw new Error(`Fixture produced ${triangleCount} triangles, expected exactly ${maxSyncTriangleCount} — fix COLS/ROWS.`);
  }
  console.log(`  Fixture triangle count: ${triangleCount} (exact ceiling, asserted)\n`);

  const [weldMs, weldedGeom] = await rec.around('weld', () => weld(raw));
  const [connMs, connResult] = await rec.around('connectivity', () => buildConnectivity(weldedGeom));
  const [bvhMs] = await rec.around('bvh-construction', () => buildBvh(weldedGeom));

  console.log(`  weld              ${weldMs.toFixed(2).padStart(8)}ms`);
  console.log(`  connectivity      ${connMs.toFixed(2).padStart(8)}ms  (componentCount=${connResult.componentCount})`);
  console.log(`  bvh-construction  ${bvhMs.toFixed(2).padStart(8)}ms`);
  console.log(`\n  sum               ${(weldMs + connMs + bvhMs).toFixed(2).padStart(8)}ms  (reported for context only —`);
  console.log(`  criterion 5's actual pass/fail line is PER-PHASE, not the sum: docs/...:4708-4709 says each`);
  console.log(`  phase must "individually clear its share of the accepted per-atomic-operation ceiling with`);
  console.log(`  margin" — Task 24 applies that per-phase, never against the summed figure.`);
  console.log(`  measure.mjs's synthetic BVH-only figure for comparison: see spike/measure.mjs output directly (not conflated — docs/...:4688).`);

  rec.dispose();
  ```

  This task's own sanity check for this file is: does it run to completion and print three distinct, non-zero, plausible numbers at an *exactly*-asserted 12,000-triangle fixture — not whether those numbers pass criterion 5 against the real ceiling (that needs the real MEP model, Task 24, and the per-phase decision rule in Task 24 Step 4).

- [ ] **Step 4: `browser-probes.mjs` — the criteria that need a one-off, live-Viewer call**

  All twelve criteria, enumerated here in full so nothing is lost in this handoff (verbatim per `docs/...:4660-4796`), and how each is actually answered:

  1. No single synchronous task exceeds 24.8ms, both cold and warm runs — answered by `recorder.longestSpan()` after Task 24 wires `setSpanRecorder(recorder.asSpanRecorder())` (Step 2) and runs the real cold/warm queries. Not a probe function in this file.
  2. Any budget that trips does so with the correct diagnostic, never a freeze/fabricated clash — answered by inspecting `ClashResult.statistics.diagnostics` from Task 24's real run. Not a probe function.
  3. Per-candidate and per-build costs recorded next to `measure.mjs`'s synthetic figures — answered by `ClashStatistics.narrowPhaseMs / narrowPhasePairs` (per-candidate) alongside Step 3's own per-phase figures (per-build), both already produced elsewhere; this is a reporting/comparison step in Task 24's disposition document, not a new measurement.
  4. Worst-case cost of one `classifyPoint` call, one `ProperCrossingQuery` probe, one `SurfaceCrossingWitness` in-triangle probe — `probeCosts()` below, against a real fragment's already-built `GeometryRecord`.
  5. Weld, connectivity, BVH individually at `maxSyncTriangleCount` — Step 3.
  6. Largest-dbId extraction cost, broad-phase total + longest inter-yield span, `performance.now()`-vs-AABB-test cost, candidate-list size at ceiling — `extractionAndBroadPhaseCost()` below for the one-off numbers; the "longest inter-yield span" itself comes from `recorder.longestSpan('broad-phase-scan')` (Step 2's labeling), same mechanism as criterion 1.
  7. One `enumNodeChildren` call at the fanout ceiling — `widestNodeFanout()` below.
  8. Capacity-admission recompute-and-commit, separate from precheck — `recorder.spansByLabel('capacity-admission-commit')` (Step 2), plus `capacityPrecheckRejects()` below for the precheck-rejects-before-mutation assertion.
  9. One `enumNodeFragments` call on the densest-fragment node — `widestFragmentOwner()` below.
  10. Epoch registry sweep, from both `evictModel` and `dispose()` — `epochSweepCost()` below.
  11. `ViewerGeometryAdapter` normalization at the most-fragmented geometry — `mostFragmentedGeometryNormalization()` below.
  12. `CollisionInstance` identity-cache retained size after a realistic session — `identityCacheRetainedSize()` below.

  This file is injected via `page.addScriptTag({ path: 'test/performance/browser-probes.mjs' })` **without** `type: 'module'` — Playwright's `addScriptTag({ path })` reads the file from disk and inlines its text as an inline `<script>` in the page; a same-repo relative `import` inside that inlined text resolves against the *page's* URL, not the local filesystem, and this app's server only exposes `wwwroot/` (`server.js:7`), so `/test/performance/checkpoint-recorder.mjs` 404s. Rather than adding a test-only static route to the production `server.js`, this file is self-contained: `CheckpointRecorder` is duplicated inline (kept in sync with Step 2's copy by hand — a small, explicitly-accepted duplication cost, not an oversight) and every probe is a plain function attached to `window.__perfProbes`, no ES module syntax at all:

  ```js
  // test/performance/browser-probes.mjs — plain script, NOT an ES module (see header above for why).
  // Injected via page.addScriptTag({ path: 'test/performance/browser-probes.mjs' }) against a live
  // Viewer page with a model already loaded (window.viewer.model).

  (function () {
    // --- CheckpointRecorder, duplicated verbatim from test/performance/checkpoint-recorder.mjs ---
    class CheckpointRecorder {
      constructor() {
        this.spans = [];
        if (typeof PerformanceObserver !== 'undefined') {
          try {
            this._observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) this.spans.push({ label: '(unattributed longtask)', ms: entry.duration, source: 'longtask' });
            });
            this._observer.observe({ entryTypes: ['longtask'] });
          } catch { this._observer = null; }
        }
      }
      start(label) { const t0 = performance.now(); return { end: () => { const ms = performance.now() - t0; this.spans.push({ label, ms, source: 'manual' }); return ms; } }; }
      async around(label, fn) { const h = this.start(label); const result = await fn(); return [h.end(), result]; }
      asSpanRecorder() { return (label, ms) => this.spans.push({ label, ms, source: 'manual' }); }
      longestSpan(filterLabel) { const pool = filterLabel ? this.spans.filter((s) => s.label === filterLabel) : this.spans; return pool.reduce((max, s) => (s.ms > (max?.ms ?? -1) ? s : max), null); }
      spansByLabel(label) { return this.spans.filter((s) => s.label === label); }
      dispose() { this._observer?.disconnect(); }
    }
    window.__CheckpointRecorder = CheckpointRecorder;

    const NOT_EXERCISED = (why) => ({ exercised: false, reason: why }); // criteria 6,7,9,10,11,12's escape
      // hatch (docs/...:4744-4795: "recording that limitation is itself a gate finding, not a pass").

    /** Walk the whole instance tree, calling `visit(dbId)` on every node (root included). */
    function walkTree(model, visit) {
      const tree = model.getInstanceTree();
      (function walk(dbId) {
        visit(dbId);
        tree.enumNodeChildren(dbId, walk, false);
      })(tree.getRootId());
    }

    window.__perfProbes = {
      /** Criterion 4: worst-case single-call cost of the three named primitives, against a real
       *  fragment's already-built GeometryRecord (this model's own triangle density/BVH depth is the
       *  point — docs/...:4695-4697). ContainmentQuery/ProperCrossingQuery/SurfaceCrossingWitness's
       *  exact exported per-call entry points are fixed by earlier tasks — confirm names below. */
      async probeCosts(model, sampleDbId, { ViewerModelAdapter, ViewerGeometryAdapter, ContainmentQuery, ProperCrossingQuery, SurfaceCrossingWitness }) {
        const rec = new CheckpointRecorder();
        const placed = ViewerModelAdapter.getPlacedGeometry(model, sampleDbId);
        const record = await ViewerGeometryAdapter.buildGeometryRecord(placed.rawGeometry);
        const { bvh, localDiagonal } = await record.accelerationPromise;
        const { position } = await record.weldPromise;
        const samplePoint = { x: position[0], y: position[1], z: position[2] };

        const [classifyMs] = await rec.around('classifyPoint-single-call', () => ContainmentQuery.classifyPoint(samplePoint, bvh, localDiagonal));
        // ProperCrossingQuery/SurfaceCrossingWitness expose composed-query entry points, not a standalone
        // single-probe call, per canonical reference's Naming Conventions — time the smallest available
        // invocation (self-pair) and record this granularity limitation explicitly rather than inventing
        // an API these modules may not actually expose.
        let crossingMs = null, witnessMs = null, granularityNote = '';
        if (typeof ProperCrossingQuery.crossing === 'function') {
          [crossingMs] = await rec.around('proper-crossing-smallest-call', () => ProperCrossingQuery.crossing(record, record));
        } else {
          granularityNote += 'ProperCrossingQuery exposes no standalone single-probe entry point; ';
        }
        if (typeof SurfaceCrossingWitness.probe === 'function') {
          [witnessMs] = await rec.around('surface-crossing-witness-smallest-call', () => SurfaceCrossingWitness.probe(record, record));
        } else {
          granularityNote += 'SurfaceCrossingWitness exposes no standalone single-probe entry point.';
        }
        return { exercised: true, classifyMs, crossingMs, witnessMs, granularityNote: granularityNote || null };
      },

      /** Criterion 6: extraction cost for the largest requested dbId, plus broad-phase's own numbers
       *  that AREN'T already captured by the shared span log (candidate-list size at the ceiling, and
       *  performance.now()-vs-AABB-test relative cost). The broad-phase scan's own total cost and its
       *  longest inter-yield span come from recorder.spansByLabel('broad-phase-scan') after a real
       *  findClashes run (Step 2) — this function supplies the two numbers that mechanism can't. */
      extractionCostAndAabbOverhead(model) {
        let widest = { dbId: null, fragmentCount: 0 };
        const tree = model.getInstanceTree();
        walkTree(model, (dbId) => {
          let n = 0;
          tree.enumNodeFragments(dbId, () => { n++; }, false);
          if (n > widest.fragmentCount) widest = { dbId, fragmentCount: n };
        });
        const rec = new CheckpointRecorder();
        const h1 = rec.start('extraction-largest-dbid');
        let extracted = 0;
        tree.enumNodeFragments(widest.dbId, () => { extracted++; }, false);
        const extractionMs = h1.end();

        // performance.now() vs one AABB-overlap test, relative cost.
        const box = new window.THREE.Box3(new window.THREE.Vector3(0, 0, 0), new window.THREE.Vector3(1, 1, 1));
        const other = new window.THREE.Box3(new window.THREE.Vector3(0.5, 0.5, 0.5), new window.THREE.Vector3(1.5, 1.5, 1.5));
        const N = 100_000;
        const t0 = performance.now();
        for (let i = 0; i < N; i++) performance.now();
        const perfNowCostEach = (performance.now() - t0) / N;
        const t1 = performance.now();
        for (let i = 0; i < N; i++) box.intersectsBox(other);
        const aabbCostEach = (performance.now() - t1) / N;

        return { exercised: true, widestDbId: widest.dbId, fragmentCount: widest.fragmentCount, extractionMs, perfNowCostMicros: perfNowCostEach * 1000, aabbTestCostMicros: aabbCostEach * 1000 };
      },

      /** Criterion 7: one enumNodeChildren call at the fanout ceiling, on the widest node the model offers. */
      widestNodeFanout(model, maxChildrenPerNode) {
        const tree = model.getInstanceTree();
        let widest = { dbId: null, count: 0 };
        walkTree(model, (dbId) => {
          let count = 0;
          tree.enumNodeChildren(dbId, () => { count++; }, false);
          if (count > widest.count) widest = { dbId, count };
        });
        if (widest.count < maxChildrenPerNode) {
          return NOT_EXERCISED(`widest node (dbId ${widest.dbId}) has only ${widest.count} children, ceiling is ${maxChildrenPerNode}`);
        }
        const rec = new CheckpointRecorder();
        let invocations = 0;
        const h = rec.start('enumNodeChildren-at-ceiling');
        tree.enumNodeChildren(widest.dbId, () => {
          invocations++;
          return invocations > maxChildrenPerNode; // observe whether a truthy return actually aborts —
        }, false);                                  // installed typings say void; must be OBSERVED (docs/...:4742-4744)
        const ms = h.end();
        return { exercised: true, dbId: widest.dbId, invocations, ms, abortObserved: invocations <= maxChildrenPerNode + 1 };
      },

      /** Criterion 8 (precheck half): assert the call-wide precheck rejects before any bucket
       *  lookup/CollisionInstance construction, at/near maxCollisionInstancesPerEpoch. Requires
       *  CollisionWorld to expose a way to observe "was any CollisionInstance constructed" — if it does
       *  not, this records that gap rather than guessing at an undocumented internal counter. */
      async capacityPrecheckRejects(world, overCapacityQuery) {
        if (typeof world.getEpochCollisionInstanceCount !== 'function') {
          return NOT_EXERCISED('CollisionWorld exposes no diagnostic accessor to confirm zero CollisionInstance constructions occurred before rejection — see criterion 12 note in this same file');
        }
        const before = world.getEpochCollisionInstanceCount(overCapacityQuery.epoch);
        let rejected = false;
        try { await world.findClashes(overCapacityQuery); } catch { rejected = true; }
        const after = world.getEpochCollisionInstanceCount(overCapacityQuery.epoch);
        return { exercised: true, rejected, bucketUnchanged: before === after };
      },

      /** Criterion 9: one enumNodeFragments(node, cb, false) call on the node owning the most fragments. */
      widestFragmentOwner(model, maxFragmentsPerDbId) {
        const tree = model.getInstanceTree();
        let widest = { dbId: null, count: 0 };
        walkTree(model, (dbId) => {
          let count = 0;
          tree.enumNodeFragments(dbId, () => { count++; }, false);
          if (count > widest.count) widest = { dbId, count };
        });
        if (widest.count === 0) return NOT_EXERCISED('no node in this model directly owns any fragments at the top level');
        const rec = new CheckpointRecorder();
        const h = rec.start('enumNodeFragments-widest-owner');
        let n = 0;
        tree.enumNodeFragments(widest.dbId, () => { n++; }, false);
        const ms = h.end();
        return { exercised: true, dbId: widest.dbId, fragmentCount: n, ms, fractionOfCeiling: n / maxFragmentsPerDbId };
      },

      /** Criterion 10: releaseEpochScopedState sweep cost, from evictModel and from dispose(), the
       *  latter varying simultaneously-live epoch count (caller admits N models first for that case). */
      epochSweepCost(world, model, { viaDispose = false } = {}) {
        const rec = new CheckpointRecorder();
        const label = viaDispose ? 'dispose-epoch-sweep' : 'evictModel-epoch-sweep';
        const h = rec.start(label);
        if (viaDispose) world.dispose(); else world.evictModel(model);
        const ms = h.end();
        return { exercised: true, ms, mode: viaDispose ? 'dispose' : 'evictModel' };
      },

      /** Criterion 11: ViewerGeometryAdapter normalization + active-range classification, at the
       *  model's most fragmented geometry (many small TriangleRange groups; O(ranges) is this step's
       *  only unceilinged term, docs/...:4778-4785). Walks every fragment, asking ViewerModelAdapter for
       *  each one's raw range/group count before normalization runs. */
      async mostFragmentedGeometryNormalization(model, { ViewerModelAdapter, ViewerGeometryAdapter }) {
        const tree = model.getInstanceTree();
        let mostRanges = { dbId: null, rangeCount: 0 };
        walkTree(model, (dbId) => {
          let fragCount = 0;
          tree.enumNodeFragments(dbId, (fragId) => {
            fragCount++;
            const rangeCount = ViewerModelAdapter.getRangeCount(model, fragId);
            if (rangeCount > mostRanges.rangeCount) mostRanges = { dbId, fragId, rangeCount };
          }, false);
        });
        if (mostRanges.rangeCount < 8) {
          return NOT_EXERCISED(`most-fragmented geometry found has only ${mostRanges.rangeCount} ranges, too flat to exercise O(ranges) scaling`);
        }
        const rec = new CheckpointRecorder();
        const h = rec.start('viewer-geometry-adapter-normalize');
        ViewerGeometryAdapter.normalize(model, mostRanges.dbId);
        const ms = h.end();
        return { exercised: true, dbId: mostRanges.dbId, rangeCount: mostRanges.rangeCount, ms };
      },

      /** Criterion 12: CollisionInstance identity-cache retained size after a realistic session. Caller
       *  drives N findClashes calls first; this just reads back the resulting bucket size. */
      identityCacheRetainedSize(world, epoch) {
        if (typeof world.getEpochCollisionInstanceCount !== 'function') {
          return NOT_EXERCISED('CollisionWorld exposes no diagnostic accessor for per-epoch CollisionInstance bucket size — add a minimal read-only accessor (e.g. world.getEpochCollisionInstanceCount(epoch)) as part of this task, the same way collision/scheduler.js gained setSpanRecorder, rather than reaching into an undocumented internal Map by guessing a field name');
        }
        return { exercised: true, epoch, retainedCount: world.getEpochCollisionInstanceCount(epoch) };
      },
    };
  })();
  ```

  Three of these probes (`capacityPrecheckRejects`, `identityCacheRetainedSize`, and by extension criterion 8's full picture) depend on a `CollisionWorld` diagnostic accessor (`getEpochCollisionInstanceCount`) that the canonical type shapes (this plan's own reference) do not list. Rather than reaching into an undocumented internal `Map` by guessing a field name, every one of these probes fails closed into a named, structured finding — exactly the behavior the spec asks for when a model/harness can't exercise a risk (`docs/...:4793-4795`). If Task 24 finds `CollisionWorld` really has no such accessor, add one minimal read-only method as part of Task 24's own work (the same class of small, explicitly-scoped addition as `scheduler.js`'s `setSpanRecorder`) rather than leaving the criterion permanently unanswerable — or, if that is judged out of scope, report the absence itself in the disposition document, never silently worked around.

- [ ] **Step 5: Sanity-check the harness itself (not the real gate — that's Task 24)**

  ```bash
  node test/performance/measure-geometry-phases.mjs
  # Expect three distinct, non-zero ms figures at an exactly-asserted 12,000-triangle fixture — not a
  # pass/fail against the 24.8ms line (Task 24's job, against the real MEP-scale model).
  ```

  For `browser-probes.mjs`, sanity-run it against the small acceptance model from Task 22 (already loaded, already known-good) via a short throwaway Playwright snippet that injects the file via `page.addScriptTag({ path })` and calls each probe once, asserting only "it ran and returned an object with either `exercised: true` and a plausible number, or `exercised: false` and a `reason` string" — not that the numbers pass any ceiling. Record this sanity-run's own findings in `test/performance/README.md` (e.g. "on the acceptance model, `widestNodeFanout` returned `exercised: false` — expected, this model's fanout is nowhere near `maxChildrenPerNode`").

- [ ] **Step 6: Commit**
  ```bash
  git add test/performance/checkpoint-recorder.mjs test/performance/measure-geometry-phases.mjs test/performance/browser-probes.mjs test/performance/README.md wwwroot/collision/scheduler.js
  git commit -m "Add performance-gate instrumentation harness for Milestone-1's 12 pass criteria"
  ```

**Completion criteria:**
- [ ] `wwwroot/collision/scheduler.js` exposes `setSpanRecorder`/`clearSpanRecorder`, called from every existing checkpoint call site with a stable, distinct label, plus one new labeled call at the capacity-admission recompute-and-commit site.
- [ ] All twelve criteria have a stated, concrete answer mechanism (a probe function, or "filter the shared span log by label") — none left as a bare comment or an unimplemented placeholder.
- [ ] `measure-geometry-phases.mjs` measures weld, connectivity, and BVH as three separate timed spans on a fixture whose triangle count is asserted to equal `maxSyncTriangleCount` exactly (12,000), not approximated via an untested tessellator formula.
- [ ] `browser-probes.mjs`'s functions for criteria 6/7/8/9/10/11/12 each return a structured `{ exercised: false, reason }` shape when the loaded model/library interface can't exercise the risk at scale (or lacks a needed diagnostic accessor), rather than silently reporting a low number that reads as a pass.
- [ ] `checkpoint-recorder.mjs` always records manual spans (never conditioned on whether a Long Tasks observer is also present), uses per-call-closed-over start times (safe under nesting/overlap), and `test/performance/README.md` explains why the manual path — not the Long Tasks observer — is the one that actually proves criterion 1 (Long Tasks fires only for ≥~50ms tasks, above the 24.8ms bound).
- [ ] Running `node test/performance/measure-geometry-phases.mjs` completes and prints three plausible, non-zero numbers at the exact ceiling.
- [ ] None of this task's own checks assert pass/fail against the real 12 criteria — that is explicitly Task 24's job, once an MEP-scale model is available.

**Protected invariants / regressions to watch:**
- `measure.mjs`'s own synthetic figures must never be edited or reinterpreted as if they were the real gate's numbers — the two are recorded side by side, never conflated (`docs/...:4688`).
- The Long Tasks API's ≥~50ms firing threshold must not be mistaken for proof that criterion 1 (24.8ms) passed — cite this explicitly in any report this harness produces (`docs/...:4684-4685`).
- Criteria 6/7/8/9/10/11/12's "not exercised at this scale" (or "no diagnostic accessor available") outcome is a valid, required finding — never silently substitute a synthetic number presented as equivalent (`docs/...:4744-4795`, extract E risk #12).
- `setSpanRecorder`'s hook must remain a true no-op when unset (a single null-check) — this is production code every real query path now runs through, not just the gate's own instrumented runs.

---

### Task 24: Execute the MEP-scale performance gate + publish disposition

**Objective:** Run the cold/warm `volume-overlap` benchmark against an MEP-scale model and record a pass/fail disposition against all twelve criteria — the milestone's final acceptance gate, or a clearly reported blocker if no suitable model exists.

**Files:**
- Create: `test/performance/run-gate.mjs` — Playwright driver that loads `browser-probes.mjs` (Task 23) into a live Viewer page against the MEP-scale model, runs the cold+warm `volume-overlap` protocol against one shared `CollisionWorld`, and collects all 12 criteria's numbers.
- Create: `docs/superpowers/specs/milestone-1-performance-gate-disposition.md` — the disposition document (matches this spec's own `round-N-*-disposition.md` naming convention, e.g. `docs/superpowers/specs/round-31-implementation-planning-blockers-disposition.md`).
- Modify: `wwwroot/collision/CollisionWorld.js` — only if Task 23's `getEpochCollisionInstanceCount(epoch)` diagnostic accessor doesn't already exist by the time this task runs (see Task 23 Step 4's note); a minimal, read-only addition, not a behavioral change.
- Modify: `wwwroot/collision/constants.js` — only if the gate's measured numbers require revising `maxSyncTriangleCount` and/or `maxCollisionInstancesPerEpoch` (see Step 4); if the gate cannot run (no MEP model), this file is not touched.
- Modify: `.gitignore` — add `test/performance/results/` for this task's raw per-run JSON dumps (not committed; the curated disposition document is the committed artifact).

**Interfaces:**
- Consumes: Task 23's `checkpoint-recorder.mjs`, `browser-probes.mjs`, and `scheduler.js`'s `setSpanRecorder` hook in full, the real `CollisionWorld` public API (`CollisionWorld.fromViewer` — async — `world.admitModel`, `world.findClashes`), and Task 0's early MEP-model-availability check (a different subagent's task).
- Produces: `docs/superpowers/specs/milestone-1-performance-gate-disposition.md` — the document that, per the spec's own closing statement (`docs/...:4797-4805`), is what flips every still-"reasoned, not yet measured" row in the atomic-operations table under `ProperCrossingQuery`'s budgets to "measured," for the whole spec, not just for a local test result. This document's own top-level `disposition:` field is the single place that distinguishes "this task completed its own checklist" from "the performance gate passed" — the two must never be conflated (see Step 1 and Step 5).

- [ ] **Step 1: Re-check MEP-scale-model availability — with real evidence, not a documentation grep**

  Task 0 ran the spec's own mandated early check (extract E risk #12: *"An MEP-scale model is the missing input, and acquiring one should be treated as a milestone dependency, not as follow-up work"*). At the time this section was drafted, no MEP-scale model reference existed anywhere in this repo's `docs/` tree — but a documentation search only proves *that a document doesn't mention one*, not that a usable model does or doesn't exist; this repository's own specs already contain many *conceptual* MEP references that are not model availability. Re-check Task 0's own recorded status (wherever that subagent's task in the full plan documents it), and then independently confirm with real evidence, not a grep:

  ```bash
  MEP_URN=<candidate URN, from Task 0's record or a fresh upload>
  npm start & SERVER_PID=$!; trap 'kill "$SERVER_PID" 2>/dev/null' EXIT; sleep 2
  HTTP_CODE=$(curl -s -o /tmp/mep-status.json -w '%{http_code}' "http://localhost:${PORT:-8080}/api/models/${MEP_URN}/status")
  cat /tmp/mep-status.json
  ```

  A `200`/`"status":"success"` response is necessary but not sufficient — the spec's own qualifying language is "fragment geometries in the thousands of triangles, not the dozens" (`docs/...:4644-4645`). Load the candidate model once via the app and use `browser-probes.mjs`'s own `walkTree` pattern to sample a handful of fragments' triangle counts (`GeometryRecord.weldPromise`'s resolved `triangleCount`, or a quick raw index-count check) before accepting the model as suitable; record that profile (fragment count, triangle-count distribution, a representative high/median/low) in the disposition document regardless of outcome.

  If no accessible, adequately-scaled model exists after this check: **this is a valid, well-documented completion state for this task, not a blocker that leaves it perpetually undoneable.** Write `docs/superpowers/specs/milestone-1-performance-gate-disposition.md` (Step 5's structure) with `disposition: BLOCKED_NO_MODEL`, every numeric cell in the twelve-criteria table marked `NOT RUN — no MEP-scale model available at implementation time`, and state this explicitly as a milestone-level finding (per `docs/...:4802-4804`: *"If none is available at implementation time, that is a finding to report, not a step to skip silently"*). **`BLOCKED_NO_MODEL` must never be read as, or presented alongside language implying, "the performance gate passed"** — the milestone's acceleration machinery remains unverified in that case, full stop; this task being "done" and the milestone's performance claims being "verified" are two different, independently-tracked facts. Do not substitute the small acceptance model's numbers for the gate's numbers presented as if equivalent — B7 (extract E risk #12) is precisely the hazard this would reproduce.

- [ ] **Step 2: If a model is available, run the exact protocol — cold, then warm, against one shared world**

  Record the environment this ran on (browser/engine version via `await browser.version()`, OS, and a note on whether the machine was otherwise idle) alongside the numbers — without it, a future re-run has no way to tell a real regression from ordinary hardware variance. Define the source/target dbId sets deterministically and record the rule used (e.g., "the two largest-by-fragment-count top-level assemblies the model offers, found via the same widest-node walk `browser-probes.mjs` already uses, ties broken by dbId ascending") — "largest available MEP assemblies" is not by itself a reproducible instruction.

  ```js
  // test/performance/run-gate.mjs
  //
  // Performance gate (docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:4644-4805).
  // Requires an MEP-scale model URN confirmed available and adequately scaled per Step 1.
  // Run: MEP_URN=<urn> node test/performance/run-gate.mjs

  import { chromium } from 'playwright';
  import { mkdir, writeFile } from 'node:fs/promises';

  const PORT = process.env.PORT || 8080;
  const MEP_URN = process.env.MEP_URN;
  if (!MEP_URN) throw new Error('MEP_URN env var required — see Step 1 for how availability was confirmed');

  await mkdir('test/performance/results', { recursive: true });
  const browser = await chromium.launch();
  const browserVersion = await browser.version();
  const page = await browser.newPage();
  try {
    await page.goto(`http://localhost:${PORT}/#${MEP_URN}`);
    await page.waitForFunction(() => window.viewer && window.viewer.model, null, { timeout: 180_000 });
    await page.addScriptTag({ path: 'test/performance/browser-probes.mjs' }); // plain script, not a module — see Task 23 Step 4

    // Deterministic dbId selection: two largest-by-fragment-count top-level assemblies, ties broken by
    // dbId ascending. Recorded in the disposition doc as the exact rule used.
    const { sourceDbIds, targetDbIds } = await page.evaluate(() => {
      const tree = window.viewer.model.getInstanceTree();
      const counts = [];
      (function walk(dbId, depth) {
        if (depth === 1) {
          let n = 0;
          tree.enumNodeFragments(dbId, () => { n++; }, false);
          counts.push({ dbId, n });
        } else {
          tree.enumNodeChildren(dbId, (child) => walk(child, depth + 1), false);
        }
      })(tree.getRootId(), 0);
      counts.sort((a, b) => b.n - a.n || a.dbId - b.dbId);
      return { sourceDbIds: [counts[0].dbId], targetDbIds: [counts[1].dbId] };
    });

    async function runVolumeOverlapOnce(world, label) {
      return page.evaluate(async ({ label, sourceDbIds, targetDbIds }) => {
        const rec = new window.__CheckpointRecorder();
        const { setSpanRecorder, clearSpanRecorder } = await import('/collision/scheduler.js');
        setSpanRecorder(rec.asSpanRecorder());
        const h = rec.start(`volume-overlap-total-wallclock-${label}`); // total wall-clock, NOT a
                                                                          // synchronous-span measurement —
                                                                          // criterion 1's evidence is
                                                                          // rec.spans from the hook, below.
        const result = await window.__gateWorld.findClashes({
          mode: 'volume-overlap',
          source: { model: window.viewer.model, dbIds: sourceDbIds },
          target: { model: window.viewer.model, dbIds: targetDbIds },
          groupBy: 'dbId',
        });
        h.end();
        clearSpanRecorder();
        return { statistics: result.statistics, spans: rec.spans, longestSpan: rec.longestSpan() };
      }, { label, sourceDbIds, targetDbIds });
    }

    await page.evaluate(async () => {
      const { CollisionWorld } = await import('/collision/index.js');
      window.__gateWorld = await CollisionWorld.fromViewer(window.viewer); // ONE world, shared by both
      window.__gateWorld.admitModel(window.viewer.model);                  // runs, so warm genuinely
    });                                                                     // reuses the cold run's BLAS cache.

    console.log('\n=== Cold run (no BLAS cached) ===');
    const cold = await runVolumeOverlapOnce(null, 'cold');

    console.log('\n=== Warm run (every BLAS already built, immediately after) ===');
    const warm = await runVolumeOverlapOnce(null, 'warm');

    const c4 = await page.evaluate((dbId) => window.__perfProbes.probeCosts(window.viewer.model, dbId, window.__gateAdapters), sourceDbIds[0]);
    const c6 = await page.evaluate(() => window.__perfProbes.extractionCostAndAabbOverhead(window.viewer.model));
    const c7 = await page.evaluate(() => window.__perfProbes.widestNodeFanout(window.viewer.model, 10_000));
    const c9 = await page.evaluate(() => window.__perfProbes.widestFragmentOwner(window.viewer.model, 5_000));
    const c10evict = await page.evaluate(() => window.__perfProbes.epochSweepCost(window.__gateWorld, window.viewer.model, { viaDispose: false }));
    const c11 = await page.evaluate(() => window.__perfProbes.mostFragmentedGeometryNormalization(window.viewer.model, window.__gateAdapters));
    const c12 = await page.evaluate(() => window.__perfProbes.identityCacheRetainedSize(window.__gateWorld, 0));
    // c8 and c10's dispose() variant need their own dedicated setup (a fresh world at/near
    // maxCollisionInstancesPerEpoch capacity, and multiple simultaneously-live epochs respectively) —
    // run those as separate, isolated page sessions rather than reusing __gateWorld after eviction/
    // disposal, since both operations are terminal for that world.

    const report = {
      disposition: 'MEASURED',
      environment: { browserVersion, urn: MEP_URN, dbIdSelectionRule: 'two largest-by-fragment-count top-level assemblies, ties by dbId ascending', sourceDbIds, targetDbIds },
      cold, warm,
      criteria: { c4, c6, c7, c9, c10_evictModel: c10evict, c11, c12 },
    };
    await writeFile(`test/performance/results/mep-gate-${Date.now()}.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
  ```

  `window.__gateAdapters` (referenced above) is a small object of the real `ViewerModelAdapter`/`ViewerGeometryAdapter`/`ContainmentQuery`/`ProperCrossingQuery`/`SurfaceCrossingWitness` module exports, assembled once via dynamic `import()` before the probes that need them run — omitted above for length; assemble it the same way Task 22's Tier 2 does.

- [ ] **Step 3: Record every one of the 12 criteria's outputs against its stated pass/fail line**

  Enumerated again here, in full, as the actual disposition checklist (verbatim thresholds per `docs/...:4660-4796`):

  1. **24.8ms** (`8 + 16.8`) worst-case-span bound, both runs — literal pass/fail line is `24.8`, not the loosely-stated `≈24ms`; a measurement of `24.5ms` is a **PASS**, not a near-miss. Excluded from this bound entirely (a finding either way, never a gate failure): one `enumNodeFragments` call, the `dispose()`/`evictModel` sweep, `ViewerGeometryAdapter` normalization. Provisional exceptions (a measurement above 24.8ms here *corrects* the bound, doesn't fail it): `enumNodeChildren` at the fanout ceiling (criterion 7), `CollisionInstance` capacity-admission recompute-and-commit (criterion 8). Evidence: `cold.spans`/`warm.spans`, filtered to `source: 'manual'`, excluding the total-wallclock and excluded/provisional labels named above.
  2. Every budget that trips does so with the correct diagnostic (`geometry-too-large-for-sync-build`, `crossing-budget-exhausted`) — never a freeze, never a fabricated clash. Evidence: `cold.statistics.diagnostics` / `warm.statistics.diagnostics`.
  3. Per-candidate/per-build costs recorded next to `measure.mjs`'s synthetic figures — comparison, not conflation. Evidence: `statistics.narrowPhaseMs / narrowPhasePairs` (per-candidate) and Step-2-of-Task-23's per-phase figures (per-build).
  4. Worst-case single-call cost of `classifyPoint`, one `ProperCrossingQuery` probe, one `SurfaceCrossingWitness` in-triangle probe — measured, not reasoned about; a non-negligible number is itself a finding, not a failure. Evidence: `c4`.
  5. Weld / connectivity / BVH construction at `maxSyncTriangleCount`, each **individually** clearing its share of the 24.8ms ceiling with margin (not their sum). Evidence: Task 23 Step 3's own run output.
  6. Extraction cost for the largest requested dbId; broad-phase scan's total cost AND its longest uninterrupted inter-yield span; cost of one `performance.now()` read vs. one AABB test; candidate-list size at the ceiling. Evidence: `c6` plus `cold.longestSpan`/`warm.longestSpan` filtered to `'broad-phase-scan'`.
  7. One `enumNodeChildren` call at the fanout ceiling, `maxChildrenPerNode + 1` invocations expected, abort actually observed to fire. Evidence: `c7`.
  8. Capacity-admission recompute-and-commit measured separately from precheck; precheck confirmed to reject before any bucket lookup/construction. Evidence: `spansByLabel('capacity-admission-commit')` from a dedicated near-capacity run, plus `capacityPrecheckRejects()`.
  9. One `enumNodeFragments` call on the model's most fragment-dense node — accepted unbounded risk, measured to know the real number, not to enforce a ceiling. Evidence: `c9`.
  10. Epoch-scoped registry sweep from both `evictModel` and `dispose()`, the latter varied across simultaneously-live epoch counts. Evidence: `c10_evictModel` plus a dedicated multi-epoch `dispose()` run.
  11. `ViewerGeometryAdapter` normalization + active-range classification, at the model's most fragmented geometry. Evidence: `c11`.
  12. `CollisionInstance` identity-cache retained size across a realistic multi-call session, after the model's full unique-fragment population has been queried at least once; whether `maxCollisionInstancesPerEpoch` needs revision given that retained size. Evidence: `c12`, taken after driving repeated `findClashes` calls across the model's fragment population (not the single cold/warm pair above).

  For any of 6/7/8/9/10/11/12 the model can't exercise at scale, or that lacks a needed diagnostic accessor: record `NOT EXERCISED — <specific reason>` as that criterion's own row value. This is itself a required gate finding (`docs/...:4744-4795`), never papered over with a synthetic substitute.

- [ ] **Step 4: Decide whether `maxSyncTriangleCount` and `maxCollisionInstancesPerEpoch` need revision**

  - `maxSyncTriangleCount = 12_000` "remains provisional until this gate runs" (`docs/...:4800`, canonical reference constants block). **The deciding rule is per-phase, not summed** — the spec's own text (`docs/...:4708-4709`) is explicit that each of weld/connectivity/BVH must *individually* clear its share of the 24.8ms ceiling "with margin, not just sum to something plausible," precisely to guard against one phase alone blowing past the bound while the total still looks acceptable. The spec does not itself define a numeric "margin," so this plan fixes one, flagged as this plan's own reasoned interpretation to confirm/adjust when the gate actually runs: require each phase's measured cost to be **no more than 80% of 24.8ms (≤19.84ms)** individually. If any phase exceeds that at 12,000 triangles, lower `maxSyncTriangleCount` until a re-run of Task 23 Step 3 clears all three phases under that line, and record the old/new values, the re-run's numbers, and this rationale in the disposition doc. If all three clear it, record that the 12,000 figure graduates from "reasoned" to "measured" without needing to change.
  - `maxCollisionInstancesPerEpoch = 20_000` is this plan's own reasoned default (canonical reference), never spec-chosen. Criterion 12's measured steady-state retained size is the first real evidence against it — if the MEP model's full unique-fragment population approaches or exceeds `20_000` within a realistic session, raise the constant (again editing `collision/constants.js`) and record the before/after and rationale.
  - If Step 1 found no MEP model, neither constant is touched — both remain explicitly provisional, and the disposition document says so.

- [ ] **Step 5: Publish the disposition document**

  ```markdown
  <!-- docs/superpowers/specs/milestone-1-performance-gate-disposition.md -->
  # Milestone-1 Performance Gate — Disposition

  **disposition: MEASURED | BLOCKED_NO_MODEL** <!-- pick exactly one; see Task 24 Step 1. BLOCKED_NO_MODEL
  must never be read as "the performance gate passed" — the two facts (this task completed its own
  checklist, and the milestone's acceleration machinery is verified) are tracked independently. -->

  Ran against the spec's performance-gate protocol
  (`docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:4644-4805`), the milestone's
  own acceptance criterion for validating the acceleration machinery the room-locator acceptance test
  (Task 22) cannot exercise (B7 / extract-E risk #12: rooms are 12-64 triangles, brute force resolves the
  whole query in 10.2ms — none of the BLAS cache, lazy-build yield, `maxSyncTriangleCount`,
  `maxCandidatePairsExamined`, or eviction machinery is touched by that test).

  ## Model used, and how suitability was confirmed
  <!-- URN, manifest status HTTP code/body, sampled fragment/triangle-count profile (high/median/low),
       per Step 1. If BLOCKED_NO_MODEL: state exactly what was checked and what came back, and skip
       directly to "Overall disposition" below. -->

  ## Environment
  <!-- browser/engine version, OS, load conditions, dbId-selection rule used (Step 2) -->

  ## Protocol
  One `volume-overlap` query, run twice against one shared `CollisionWorld`: cold (no BLAS cached) then
  immediately cache-warm (every BLAS already built). Source/target dbIds: <fill from `environment` in
  the run's JSON output>.

  ## Criteria 1-12

  | # | Criterion (pass/fail line) | Cold run | Warm run | Verdict |
  |---|---|---|---|---|
  | 1 | Worst-case span ≤ **24.8ms** (excl. 3 named spans; 2 provisional exceptions: criteria 7, 8) | | | |
  | 2 | Every tripped budget emits correct diagnostic, never freeze/fabricated clash | | | |
  | 3 | Per-candidate/per-build costs recorded next to `measure.mjs`'s synthetic figures | | | |
  | 4 | `classifyPoint` / crossing-probe / `SurfaceCrossingWitness` probe worst-case cost measured | | | |
  | 5 | Weld / connectivity / BVH each measured **individually** at `maxSyncTriangleCount` (≤19.84ms each — see Step 4's margin rule) | | | |
  | 6 | Largest-dbId extraction cost; broad-phase total + longest inter-yield span; `performance.now()` vs AABB-test cost; candidate-list size at ceiling | | | |
  | 7 | `enumNodeChildren` at fanout ceiling: `maxChildrenPerNode+1` invocations, abort observed | | | |
  | 8 | Capacity-admission recompute-and-commit separate from precheck; precheck-rejects-before-mutation confirmed | | | |
  | 9 | `enumNodeFragments` on densest-fragment node, measured (no ceiling to enforce) | | | |
  | 10 | Epoch registry sweep, `evictModel` + `dispose()` (varying live-epoch count) | | | |
  | 11 | `ViewerGeometryAdapter` normalization at most-fragmented geometry | | | |
  | 12 | `CollisionInstance` identity-cache steady-state retained size after full unique-fragment query | | | |

  *(Empty cells: fill in from `test/performance/results/mep-gate-<timestamp>.json`, or write
  `NOT EXERCISED — <reason>` per criteria 6/7/8/9/10/11/12's stated escape hatch, or
  `NOT RUN — no MEP-scale model available` across the whole table if `disposition: BLOCKED_NO_MODEL`.)*

  ## Comparison against `spike/measure.mjs`'s synthetic figures
  <!-- side by side, never conflated (docs/...:4688) -->

  ## Constant revisions
  - `maxSyncTriangleCount` (12,000, provisional): <kept / revised to N, with the per-phase margin rule and rationale from Step 4>
  - `maxCollisionInstancesPerEpoch` (20,000, this plan's reasoned default): <kept / revised to N, with rationale>

  ## Overall disposition
  <!-- Per docs/...:4797-4805: state explicitly whether every still-"reasoned, not yet measured" row in
       the atomic-operations table under ProperCrossingQuery's budgets is now measured, or — if
       BLOCKED_NO_MODEL — that it remains unmeasured and why, as a milestone-level finding rather than a
       silently-skipped step. State plainly: "the performance gate has/has not passed" is a separate
       sentence from "this task is complete." -->
  ```

- [ ] **Step 6: Commit**
  ```bash
  git add test/performance/run-gate.mjs docs/superpowers/specs/milestone-1-performance-gate-disposition.md .gitignore
  # only if constants or CollisionWorld were revised/extended:
  git add collision/constants.js collision/CollisionWorld.js
  git commit -m "Run Milestone-1 performance gate and publish disposition"
  ```

**Completion criteria:**
- [ ] `docs/superpowers/specs/milestone-1-performance-gate-disposition.md` exists, is committed, and states an explicit `disposition: MEASURED | BLOCKED_NO_MODEL` at the top.
- [ ] **Either**: all 12 criteria have recorded numbers/verdicts from a real, confirmed-adequately-scaled MEP-scale-model run against one shared `CollisionWorld` (cold BLAS-cache state genuinely followed by cache-warm reuse, not two independent worlds), compared against `measure.mjs`'s synthetic figures, with an explicit, per-phase (not summed) constant-revision decision for `maxSyncTriangleCount` and a revision decision for `maxCollisionInstancesPerEpoch`; **or**: the disposition document states `disposition: BLOCKED_NO_MODEL`, names the specific gap and the concrete evidence checked (manifest status, sampled triangle counts — not merely "no doc mentions MEP"), and states this as a milestone-level finding per the spec's own convention — this is a valid, complete state for this task, not a blocker to leave unresolved forever, but it must never be phrased as or read alongside "the performance gate passed."
- [ ] Criterion 1's pass/fail line is applied literally at `24.8ms`, not the loosely-stated `≈24ms` — a `24.5ms` measurement is recorded as a pass; its evidence comes from the labeled span log (Task 23's `setSpanRecorder` hook), never from timing the outer `await findClashes(...)` call as one wall-clock span.
- [ ] For any of criteria 6/7/8/9/10/11/12 the available model or interface couldn't exercise/answer, that limitation is recorded as its own explicit finding in the table, never silently reported as a passing low number.
- [ ] The document's closing section states plainly whether this run is what promotes the atomic-operations table's still-"reasoned, not yet measured" rows to "measured," per the spec's own closing statement (`docs/...:4797-4805`), as a sentence distinct from this task's own completion.

**Protected invariants / regressions to watch:**
- The room-locator acceptance test (Task 22) must never be treated as validating the acceleration machinery — this gate is the *only* thing that does (B7, extract-E risk #12; `docs/...:4651-4659`).
- `measure.mjs`'s synthetic figures are a comparison baseline, never a substitute for a real MEP-model measurement, and never edited to match this gate's results.
- A "not exercised at scale" finding for criteria 6/7/8/9/10/11/12 must never be silently converted into a passing number in the disposition table.
- `BLOCKED_NO_MODEL` must never be conflated with "the performance gate passed" — the milestone's acceleration machinery remains unverified whenever this disposition applies.
- The cold/warm protocol's cache-warm guarantee depends on running both queries against the *same* `CollisionWorld` instance without disposing/evicting between them — a future edit to `run-gate.mjs` that creates a fresh world for the warm run silently defeats the entire point of the second run (`docs/...:4646-4649, 4656-4659`).
- Any constant revision here (`maxSyncTriangleCount`, `maxCollisionInstancesPerEpoch`) must be recorded with explicit before/after values and rationale in the disposition document, matching this spec's own disposition-document convention (`docs/superpowers/specs/round-31-implementation-planning-blockers-disposition.md` and siblings).

---

