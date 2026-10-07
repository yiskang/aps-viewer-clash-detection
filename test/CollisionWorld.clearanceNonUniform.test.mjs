// test/CollisionWorld.clearanceNonUniform.test.mjs
//
// SVF2 non-uniform fragment clearance design (docs/superpowers/specs/
// 2026-10-07-svf2-nonuniform-fragment-clearance-design.md) §5.3 / §5.6 / §8 T4: CollisionWorld
// wiring of the clearance-only derived ("prescaled") geometry path.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { ClearanceDerivedGeometryCache } from '../collision/geometry/ClearanceDerivedGeometryCache.js';
import { WorldDisposedError, ModelEvictedError } from '../collision/errors.js';
import { setDiagnosticEventRecorder, clearDiagnosticEventRecorder } from '../collision/scheduler.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

// ---- fixture plumbing ----------------------------------------------------------------------------

function compose({ at = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...at),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function worldBoundsOf(geometry, matrix) {
  const g = geometry.clone().applyMatrix4(matrix);
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

function fragEntry(spec) {
  const matrix = spec.matrixArray ? new THREE.Matrix4().fromArray(spec.matrixArray) : compose(spec);
  return {
    geometryIndex: spec.geometryIndex,
    matrix: matrix.toArray(),
    bounds: spec.bounds || worldBoundsOf(spec.geometry, matrix),
  };
}

// One or two models; `fragmentGeometry` maps are the SAME live maps the fake FragmentLists read, so a
// test can move/rescale a fragment between calls. `proxyHook(model, fragId, callIndex)` can override
// a render-proxy read (callIndex counts reads per fragment).
function makeScene(parts, { proxyHook } = {}) {
  const built = parts.map(({ id, rootNodes, frags }) => {
    const fragmentGeometry = new Map();
    const raw = new Map();
    for (const [k, spec] of Object.entries(frags)) {
      fragmentGeometry.set(Number(k), fragEntry(spec));
      raw.set(Number(k), spec.geometry);
    }
    const { model: baseModel } = buildMockModel(rootNodes, fragmentGeometry);
    return { model: { ...baseModel, id, getUnitScale: () => 1 }, fragmentGeometry, raw };
  });
  const readCount = new Map();
  const viewer = {
    impl: {
      getRenderProxy(model, fragId) {
        const part = built.find((p) => p.model === model);
        const key = `${part.model.id}:${fragId}`;
        const callIndex = readCount.get(key) ?? 0;
        readCount.set(key, callIndex + 1);
        if (proxyHook) {
          const hooked = proxyHook(part.model, fragId, callIndex);
          if (hooked !== undefined) return hooked;
        }
        const geometry = part.raw.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  return { models: built.map((p) => p.model), fragmentGeometry: built.map((p) => p.fragmentGeometry), viewer, readCount };
}

const OPTIONS = { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone', now: () => 0 };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// Same-model scene: source dbId 10 (frag 100) vs target dbId 20 (frag 200).
function twoFragScene(sourceSpec, targetSpec, sceneOptions) {
  return makeScene([{
    id: 1,
    rootNodes: [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    frags: { 100: { geometryIndex: 0, ...sourceSpec }, 200: { geometryIndex: 1, ...targetSpec } },
  }], sceneOptions);
}

async function runPair(scene, clearance, extra = {}) {
  const world = await CollisionWorld.fromViewer(scene.viewer, OPTIONS);
  const [model] = scene.models;
  const result = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] },
    mode: 'clearance', clearance, groupBy: 'dbId', broadPhase: 'linear', ...extra,
  });
  return { world, model, ...result };
}

// Inside-or-on test of a world point against an operand's world-space solid box.
function onBoxSurface(point, geometry, matrix, eps = 1e-9) {
  const local = new THREE.Vector3(...point).applyMatrix4(matrix.clone().invert());
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const inside = ['x', 'y', 'z'].every((a) => local[a] >= min[a] - eps && local[a] <= max[a] + eps);
  const onFace = ['x', 'y', 'z'].some((a) => Math.abs(local[a] - min[a]) <= eps || Math.abs(local[a] - max[a]) <= eps);
  return inside && onFace;
}

const anisoDiagnostics = (statistics) => statistics.diagnostics.filter((d) => d.reason === 'clearance-anisotropic-scale-unsupported');

// ---- measured correctly ----------------------------------------------------------------------------

test('scale(1,2,1) target is now measured: world-truth distance, on-surface witnesses, no diagnostic', async () => {
  const targetMatrix = compose({ at: [2.5, 0, 0], scale: [1, 2, 1] });
  const scene = twoFragScene({ geometry: box(2, 2, 2) }, { geometry: box(2, 2, 2), matrixArray: targetMatrix.toArray() });
  const { pairs, statistics, world } = await runPair(scene, 1);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].distance, 0.5);
  assert.deepEqual(statistics.diagnostics, []);
  assert.equal(statistics.clearanceDistanceQueriesRun, 1);
  assert.ok(onBoxSurface(pairs[0].witness.sourcePoint, box(2, 2, 2), new THREE.Matrix4()));
  assert.ok(onBoxSurface(pairs[0].witness.targetPoint, box(2, 2, 2), targetMatrix));
  assert.equal(Math.hypot(...pairs[0].witness.sourcePoint.map((v, i) => v - pairs[0].witness.targetPoint[i])), 0.5);
  const d = world.getEpochClearanceDerivedGeometryDiagnostics(1);
  assert.equal(d.readyEntries, 1);
  assert.equal(d.builds, 1);
});

test('rotated anisotropic target -> world-truth distance (hand-computable gap 1.75)', async () => {
  // box(1,1,1) scaled (4, 0.5, 2) then rotated 90deg about z: world x half-extent 0.25 -> x in [2.75, 3.25].
  const targetMatrix = compose({ at: [3, 0, 0], rotation: [0, 0, Math.PI / 2], scale: [4, 0.5, 2] });
  const scene = twoFragScene({ geometry: box(2, 2, 2) }, { geometry: box(1, 1, 1), matrixArray: targetMatrix.toArray() });
  const { pairs, statistics } = await runPair(scene, 2);
  assert.equal(pairs.length, 1);
  assert.ok(Math.abs(pairs[0].distance - 1.75) < 1e-9, `distance ${pairs[0].distance}`);
  assert.ok(onBoxSurface(pairs[0].witness.targetPoint, box(1, 1, 1), targetMatrix, 1e-7));
  assert.ok(onBoxSurface(pairs[0].witness.sourcePoint, box(2, 2, 2), new THREE.Matrix4(), 1e-7));
  assert.deepEqual(anisoDiagnostics(statistics), []);
});

test('mixed uniform + derived pair, and derived + derived pair, both measure the world gap', async () => {
  const target = { geometry: box(2, 2, 2), matrixArray: compose({ at: [2.5, 0, 0], scale: [1, 2, 1] }).toArray() };
  const uniformSource = { geometry: box(1, 1, 1), scale: [2, 2, 2] }; // x in [-1, 1]
  const derivedSource = { geometry: box(1, 1, 1), scale: [2, 0.5, 3] }; // x in [-1, 1]
  for (const source of [uniformSource, derivedSource]) {
    const { pairs } = await runPair(twoFragScene(source, target), 1);
    assert.equal(pairs.length, 1);
    assert.ok(Math.abs(pairs[0].distance - 0.5) < 1e-12, `distance ${pairs[0].distance}`);
  }
  // Swapped roles: derived source, uniform target.
  const { pairs } = await runPair(twoFragScene(target, { geometry: box(1, 1, 1), at: [5, 0, 0], scale: [2, 2, 2] }), 1);
  assert.equal(pairs.length, 1);
  assert.ok(Math.abs(pairs[0].distance - 0.5) < 1e-12);
});

test('a derived pair that genuinely overlaps is excluded by the canonical Hard-Clash precheck; no derived build', async () => {
  const scene = twoFragScene(
    { geometry: box(1, 1, 1), scale: [2, 0.5, 3] },
    { geometry: box(2, 2, 2), matrixArray: compose({ at: [1.5, 0, 0], scale: [1, 2, 1] }).toArray() },
  );
  const { pairs, statistics, world } = await runPair(scene, 5);
  assert.equal(pairs.length, 0);
  assert.equal(statistics.clearanceHardClashExclusions, 1);
  assert.equal(statistics.clearanceDistanceQueriesRun, 0);
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).builds, 0, 'derived meshes are built lazily, only after proceed/skip-precheck');
});

// ---- Hard isolation ---------------------------------------------------------------------------------

test('Hard isolation: derived BVHs only ever serve the distance query; canonical registry state untouched', async () => {
  const scene = twoFragScene(
    { geometry: box(1, 1, 1), scale: [2, 0.5, 3] },
    { geometry: box(2, 2, 2), matrixArray: compose({ at: [2.5, 0.2, 0], scale: [1, 2, 1] }).toArray() },
  );
  const world = await CollisionWorld.fromViewer(scene.viewer, OPTIONS);
  const [model] = scene.models;
  const query = {
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  };
  // Record every method touched on any derived BVH handed out by the derived cache, and snapshot the
  // canonical registry state at the first derived resolution (both canonical records exist by then:
  // derived resolution happens only after both sides' canonical records and the precheck).
  const touched = [];
  let before = null;
  const cache = world._clearanceDerivedCache;
  const realGet = cache.get.bind(cache);
  cache.get = async (args) => {
    if (before === null) before = world.getEpochGeometryDiagnostics(1);
    const entry = await realGet(args);
    if (entry.state !== 'ready' || !entry.bvh) return entry;
    const bvh = entry.bvh;
    const proxy = new Proxy(bvh, {
      get(targetObj, prop) {
        const value = Reflect.get(targetObj, prop, targetObj);
        if (typeof value === 'function') {
          touched.push(String(prop));
          return value.bind(targetObj);
        }
        return value;
      },
    });
    return { ...entry, bvh: proxy };
  };
  const { pairs } = await world.findClashes(query);
  assert.equal(pairs.length, 1);
  assert.ok(touched.length > 0);
  assert.deepEqual([...new Set(touched)].sort().filter((m) => !['closestPointToGeometry', 'resolveTriangleIndex'].includes(m)), [],
    `derived BVH used outside the distance query: ${[...new Set(touched)]}`);
  assert.equal(before.length, 2);
  assert.ok(before.every((e) => e.buildState === 'ready'));
  assert.deepEqual(world.getEpochGeometryDiagnostics(1), before, 'canonical registry entries unchanged by a derived build');
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).readyEntries, 2);
});

// ---- §5.6 failure rows ------------------------------------------------------------------------------

test('§5.6 unsupported classifications (shear / reflected / numeric-domain) -> fragment diagnostic before the precheck', async () => {
  const shear = new THREE.Matrix4().set(1, 0.25, 0, 2.5, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const cases = [
    { name: 'shear', matrixArray: shear.toArray() },
    { name: 'reflected uniform', matrixArray: compose({ at: [2.5, 0, 0], scale: [-1, 1, 1] }).toArray() },
    { name: 'reflected anisotropic', matrixArray: compose({ at: [2.5, 0, 0], scale: [1, -2, 1] }).toArray() },
    { name: 'numeric-domain', matrixArray: compose({ at: [2.5, 0, 0], scale: [1e39, 1, 1] }).toArray(), bounds: { min: [1.5, -1, -1], max: [3.5, 1, 1] } },
  ];
  for (const c of cases) {
    const scene = twoFragScene({ geometry: box(2, 2, 2) }, { geometry: box(2, 2, 2), matrixArray: c.matrixArray, bounds: c.bounds });
    const { pairs, statistics, world } = await runPair(scene, 1);
    assert.equal(pairs.length, 0, c.name);
    const diags = anisoDiagnostics(statistics);
    assert.equal(diags.length, 1, c.name);
    assert.equal(diags[0].scope, 'fragment');
    assert.equal(diags[0].role, 'target');
    assert.equal(diags[0].fragment.fragId, 200);
    assert.equal(statistics.clearanceOverlapPrechecksRun, 0, `${c.name}: precheck never ran`);
    assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).builds, 0, c.name);
  }
});

test('§5.6 RenderProxyUnavailable on the second (derived) read -> geometry-not-yet-available; next call retries', async () => {
  let failSecondRead = true;
  const scene = twoFragScene(
    { geometry: box(2, 2, 2) },
    { geometry: box(2, 2, 2), matrixArray: compose({ at: [2.5, 0, 0], scale: [1, 2, 1] }).toArray() },
    { proxyHook: (model, fragId, callIndex) => (failSecondRead && fragId === 200 && callIndex === 1 ? null : undefined) },
  );
  const world = await CollisionWorld.fromViewer(scene.viewer, OPTIONS);
  const [model] = scene.models;
  const query = { source: { model, dbIds: [10] }, target: { model, dbIds: [20] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear' };
  const first = await world.findClashes(query);
  assert.equal(first.pairs.length, 0);
  assert.deepEqual(first.statistics.diagnostics.map((d) => [d.scope, d.reason, d.role, d.fragment.fragId]),
    [['fragment', 'geometry-not-yet-available', 'target', 200]]);
  assert.equal(first.statistics.clearanceDistanceQueriesRun, 0);
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).readyEntries, 0, 'transient failure not cached');
  failSecondRead = false;
  const second = await world.findClashes(query);
  assert.equal(second.pairs.length, 1);
  assert.equal(second.pairs[0].distance, 0.5);
});

test('§5.6 unsupported layout on the second read -> geometry-not-yet-available, not cached', async () => {
  const scene = twoFragScene(
    { geometry: box(2, 2, 2) },
    { geometry: box(2, 2, 2), matrixArray: compose({ at: [2.5, 0, 0], scale: [1, 2, 1] }).toArray() },
    { proxyHook: (model, fragId, callIndex) => (fragId === 200 && callIndex === 1 ? { geometry: { attributes: {} } } : undefined) },
  );
  const { pairs, statistics, world } = await runPair(scene, 1);
  assert.equal(pairs.length, 0);
  assert.deepEqual(statistics.diagnostics.map((d) => d.reason), ['geometry-not-yet-available']);
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).readyEntries, 0);
});

test('§5.6 non-finite prescaled coordinate (backstop) -> anisotropic diagnostic, cached unsupported marker', async () => {
  // The canonical record (box half-extent 1) passes the domain check at s = 1e38; a second read that
  // (in violation of the per-epoch immutability assumption) returns a 5x larger mesh overflows float32.
  const scene = twoFragScene(
    { geometry: box(2, 2, 2) },
    { geometry: box(2, 2, 2), matrixArray: compose({ at: [2.5, 0, 0], scale: [1e38, 1, 1] }).toArray(), bounds: { min: [1.5, -1, -1], max: [3.5, 1, 1] } },
    { proxyHook: (model, fragId, callIndex) => (fragId === 200 && callIndex >= 1 ? { geometry: box(10, 2, 2) } : undefined) },
  );
  const { pairs, statistics, world } = await runPair(scene, 1);
  assert.equal(pairs.length, 0);
  const diags = anisoDiagnostics(statistics);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].fragment.fragId, 200);
  assert.equal(statistics.clearanceDistanceQueriesRun, 0);
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).unsupportedEntries, 1);
});

test('§5.6 derived weld collapses every triangle -> anisotropic diagnostic, never a silent "beyond threshold"', async () => {
  const targetMatrix = compose({ at: [1.5, 0, 0], scale: [1e-9, 1e-9, 1] });
  const scene = twoFragScene({ geometry: box(2, 2, 2) }, { geometry: box(2, 2, 2), matrixArray: targetMatrix.toArray() });
  const { pairs, statistics } = await runPair(scene, 1);
  assert.equal(pairs.length, 0);
  assert.equal(anisoDiagnostics(statistics).length, 1);
  assert.equal(statistics.clearanceDistanceQueriesRun, 0);
});

test('§5.6 model eviction during a derived build -> the call aborts with ModelEvictedError', async () => {
  let world;
  const scene = twoFragScene(
    { geometry: box(2, 2, 2) },
    { geometry: box(2, 2, 2), matrixArray: compose({ at: [2.5, 0, 0], scale: [1, 2, 1] }).toArray() },
    { proxyHook: (model, fragId, callIndex) => { if (fragId === 200 && callIndex === 1) world.evictModel(model); return undefined; } },
  );
  world = await CollisionWorld.fromViewer(scene.viewer, OPTIONS);
  const [model] = scene.models;
  await assert.rejects(world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  }), ModelEvictedError);
  assert.equal(world._clearanceDerivedCache.hasEpoch(1), false);
});

test('§5.6 invalidateModelPlacement racing a derived build does NOT abort the query; the result is not cached', async () => {
  let world;
  const scene = twoFragScene(
    { geometry: box(2, 2, 2) },
    { geometry: box(2, 2, 2), matrixArray: compose({ at: [2.5, 0, 0], scale: [1, 2, 1] }).toArray() },
    { proxyHook: (model, fragId, callIndex) => { if (fragId === 200 && callIndex === 1) world.invalidateModelPlacement(model); return undefined; } },
  );
  world = await CollisionWorld.fromViewer(scene.viewer, OPTIONS);
  const [model] = scene.models;
  const { pairs } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].distance, 0.5);
  const d = world.getEpochClearanceDerivedGeometryDiagnostics(1);
  assert.equal(d.readyEntries, 0, 'built under a superseded placement bucket -> not published');
  assert.equal(d.builds, 1);
});

test('§5.6 any other exception during the derived build aborts the call', async () => {
  const scene = twoFragScene(
    { geometry: box(2, 2, 2) },
    { geometry: box(2, 2, 2), matrixArray: compose({ at: [2.5, 0, 0], scale: [1, 2, 1] }).toArray() },
    { proxyHook: (model, fragId, callIndex) => { if (fragId === 200 && callIndex === 1) throw new TypeError('viewer bug'); return undefined; } },
  );
  const world = await CollisionWorld.fromViewer(scene.viewer, OPTIONS);
  const [model] = scene.models;
  await assert.rejects(world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  }), TypeError);
});

// ---- cache invalidation / memory bound -----------------------------------------------------------

test('derived cache released on eviction and dispose; detached on invalidateModelPlacement', async () => {
  const scene = twoFragScene(
    { geometry: box(2, 2, 2) },
    { geometry: box(2, 2, 2), matrixArray: compose({ at: [2.5, 0, 0], scale: [1, 2, 1] }).toArray() },
  );
  const { world, model } = await runPair(scene, 1);
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).readyEntries, 1);
  world.invalidateModelPlacement(model);
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).readyEntries, 0);
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).builds, 1, 'counters survive a placement detach');
  await world.findClashes({ source: { model, dbIds: [10] }, target: { model, dbIds: [20] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear' });
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).readyEntries, 1);
  world.evictModel(model);
  assert.equal(world._clearanceDerivedCache.hasEpoch(1), false);
  world.dispose();
  assert.throws(() => world.getEpochClearanceDerivedGeometryDiagnostics(1), WorldDisposedError);
});

test('dispose releases every epoch of the derived cache', async () => {
  const scene = twoFragScene(
    { geometry: box(2, 2, 2) },
    { geometry: box(2, 2, 2), matrixArray: compose({ at: [2.5, 0, 0], scale: [1, 2, 1] }).toArray() },
  );
  const { world } = await runPair(scene, 1);
  const cache = world._clearanceDerivedCache;
  assert.equal(cache.hasEpoch(1), true);
  world.dispose();
  assert.equal(cache.hasEpoch(1), false);
});

test('a successful placement-refresh publish (TLAS path) detaches the derived bucket', async () => {
  const scene = makeScene([
    { id: 1, rootNodes: [{ dbId: 1, fragments: [10] }], frags: { 10: { geometryIndex: 0, geometry: box(2, 2, 2) } } },
    { id: 2, rootNodes: [{ dbId: 1, fragments: [100] }], frags: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), matrixArray: compose({ at: [2.5, 0, 0], scale: [1, 2, 1] }).toArray() } } },
  ]);
  const world = await CollisionWorld.fromViewer(scene.viewer, OPTIONS);
  const [sourceModel, targetModel] = scene.models;
  const query = { source: { model: sourceModel, dbIds: [1] }, target: { targets: [{ model: targetModel }] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'tlas' };
  const before = await world.findClashes(query);
  assert.equal(before.pairs.length, 1);
  const targetEpoch = world.admitModel(targetModel).epoch;
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(targetEpoch).readyEntries, 1);
  // Move AND re-scale the fragment in the Viewer, then invalidate: the TLAS path refreshes placement.
  const moved = compose({ at: [3.5, 0, 0], scale: [2, 2.5, 1] }); // x in [1.5, 5.5]
  scene.fragmentGeometry[1].set(100, fragEntry({ geometryIndex: 0, geometry: box(2, 2, 2), matrixArray: moved.toArray() }));
  world.invalidateModelPlacement(targetModel);
  const realDetach = world._clearanceDerivedCache.detachEpoch.bind(world._clearanceDerivedCache);
  let detachCalls = 0;
  world._clearanceDerivedCache.detachEpoch = (epoch) => { detachCalls++; return realDetach(epoch); };
  const after = await world.findClashes(query);
  assert.ok(detachCalls >= 1, 'refresh publish detached the derived bucket');
  assert.equal(after.pairs.length, 1);
  assert.ok(Math.abs(after.pairs[0].distance - 0.5) < 1e-12, 'measured against the refreshed scale (2, 2.5, 1)');
});

test('repeated legacy-shape linear queries with a CHANGING non-uniform scale: never stale, bounded by the entry cap', async () => {
  const targetSpec = (sx) => ({ geometry: box(2, 2, 2), matrixArray: compose({ at: [1.5 + sx, 0, 0], scale: [sx, 1.5, 1] }).toArray() });
  const scene = twoFragScene({ geometry: box(2, 2, 2) }, targetSpec(1));
  const world = await CollisionWorld.fromViewer(scene.viewer, OPTIONS);
  // Test seam: a tiny entry cap on the world-owned cache (same wiring fromViewer uses).
  world._clearanceDerivedCache = new ClearanceDerivedGeometryCache({
    resolveGeometryView: (e, g) => world._resolveGeometryView(e, g),
    checkpointPort: { checkpoint: () => undefined },
    maxEntriesPerEpoch: 3,
  });
  const [model] = scene.models;
  for (let i = 0; i < 10; i++) {
    const sx = 1 + i * 0.37;
    scene.fragmentGeometry[0].set(200, fragEntry({ geometryIndex: 1, ...targetSpec(sx) })); // no invalidate: linear reads fresh matrices
    const { pairs } = await world.findClashes({
      source: { model, dbIds: [10] }, target: { model, dbIds: [20] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
    });
    assert.equal(pairs.length, 1, `iteration ${i}`);
    // float32 storage of S*v bounds the error (design §3); a stale scale would be off by >= 0.37.
    assert.ok(Math.abs(pairs[0].distance - 0.5) < 1e-6, `iteration ${i}: distance ${pairs[0].distance} (stale scale would differ)`);
    const d = world.getEpochClearanceDerivedGeometryDiagnostics(1);
    assert.ok(d.readyEntries + d.unsupportedEntries <= 3, `iteration ${i}: entry cap holds`);
  }
  const d = world.getEpochClearanceDerivedGeometryDiagnostics(1);
  assert.equal(d.builds, 10, 'one build per distinct scale');
  assert.equal(d.evictions, 7);
});

test('derived cache byte budget holds across repeated changing-scale queries', async () => {
  const targetSpec = (sx) => ({ geometry: box(2, 2, 2), matrixArray: compose({ at: [1.5 + sx, 0, 0], scale: [sx, 1.5, 1] }).toArray() });
  const scene = twoFragScene({ geometry: box(2, 2, 2) }, targetSpec(1));
  const world = await CollisionWorld.fromViewer(scene.viewer, OPTIONS);
  const [model] = scene.models;
  const q = { source: { model, dbIds: [10] }, target: { model, dbIds: [20] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear' };
  await world.findClashes(q);
  const one = world.getEpochClearanceDerivedGeometryDiagnostics(1);
  const entryBytes = one.retainedPositionBytes + one.retainedIndexBytes + one.retainedBvhBytes;
  world._clearanceDerivedCache = new ClearanceDerivedGeometryCache({
    resolveGeometryView: (e, g) => world._resolveGeometryView(e, g),
    checkpointPort: { checkpoint: () => undefined },
    maxBytesPerEpoch: 2 * entryBytes,
  });
  for (let i = 0; i < 6; i++) {
    scene.fragmentGeometry[0].set(200, fragEntry({ geometryIndex: 1, ...targetSpec(1 + i * 0.5) }));
    const { pairs } = await world.findClashes(q);
    assert.ok(Math.abs(pairs[0].distance - 0.5) < 1e-6);
    const d = world.getEpochClearanceDerivedGeometryDiagnostics(1);
    assert.ok(d.retainedPositionBytes + d.retainedIndexBytes + d.retainedBvhBytes <= 2 * entryBytes);
  }
});

// ---- accessor + recorder covariates ---------------------------------------------------------------

test('getEpochClearanceDerivedGeometryDiagnostics: exhaustive shape, empty default, lifecycle-only world', async () => {
  const world = await CollisionWorld.fromViewer(null, OPTIONS);
  const empty = {
    readyEntries: 0, buildingEntries: 0, unsupportedEntries: 0, builds: 0, hits: 0, sharedWaits: 0, evictions: 0,
    retainedPositionBytes: 0, retainedIndexBytes: 0, retainedBvhBytes: 0, noSurfaceOperands: 0,
  };
  assert.deepEqual(world.getEpochClearanceDerivedGeometryDiagnostics(7), empty);
  const bare = new CollisionWorld();
  assert.deepEqual(bare.getEpochClearanceDerivedGeometryDiagnostics(1), empty);
  bare.dispose();
  assert.throws(() => bare.getEpochClearanceDerivedGeometryDiagnostics(1), WorldDisposedError);
});

test('builds + hits + sharedWaits equals the number of derived resolutions; builds <= distinct keys', async () => {
  // Two target fragments share one mesh AND one exact scale; a third shares the mesh with a different scale.
  const scene = makeScene([{
    id: 1,
    rootNodes: [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }, { dbId: 30, fragments: [300] }, { dbId: 40, fragments: [400] }] }],
    frags: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2) },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), matrixArray: compose({ at: [2.5, 0, 0], scale: [1, 2, 1] }).toArray() },
      300: { geometryIndex: 1, geometry: box(2, 2, 2), matrixArray: compose({ at: [-2.5, 0, 0], scale: [1, 2, 1] }).toArray() },
      400: { geometryIndex: 1, geometry: box(2, 2, 2), matrixArray: compose({ at: [0, 3, 0], scale: [1, 1.5, 1] }).toArray() },
    },
  }]);
  const world = await CollisionWorld.fromViewer(scene.viewer, OPTIONS);
  const [model] = scene.models;
  const { pairs } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20, 30, 40] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 3);
  for (const p of pairs) assert.ok(Math.abs(p.distance - 0.5) < 1e-12);
  const d = world.getEpochClearanceDerivedGeometryDiagnostics(1);
  assert.equal(d.builds, 2, 'two distinct (geometryIndex, S) keys');
  assert.equal(d.builds + d.hits + d.sharedWaits, 3, 'three derived resolutions');
});

test('recorder covariates: transform path and the TRAVERSED (derived) triangle counts', async () => {
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => { if (kind === 'clearance-distance-query') events.push(payload); });
  try {
    const scene = twoFragScene(
      { geometry: box(2, 2, 2) },
      { geometry: new THREE.BoxGeometry(2, 2, 2, 2, 1, 1), matrixArray: compose({ at: [2.5, 0, 0], scale: [1, 2, 1] }).toArray() },
    );
    await runPair(scene, 1);
  } finally {
    clearDiagnosticEventRecorder();
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].sourceTransformPath, 'uniform');
  assert.equal(events[0].targetTransformPath, 'derived');
  assert.equal(events[0].sourceTriangles, 12);
  assert.equal(events[0].targetTriangles, 20, 'derived mesh triangle count (2x1x1-segment box)');
  assert.equal(events[0].outcome, 'hit');
  assert.ok(Math.abs(events[0].targetScaleFactor - 1) < 1e-12, 'distance instance is rigid');
});

// ---- Amendment (owner-authorized, 2026-10-07): no-clearance-surface operands ------------------------
// Live SVF2 Audubon: 207 canonical records with 0 triangles / empty bbox and 5 two-vertex line fragments
// (canonical 0 triangles, non-empty bbox, derived weld 0 triangles) were reported as
// `clearance-anisotropic-scale-unsupported`. A canonical record with 0 triangles has no clearance
// surface: a conclusive negative before the precheck, no diagnostic (legacy parity), visible only through
// the accessor's `noSurfaceOperands` counter and a recorder-only precheck not-run event.

// Empty position set: canonical record 0 triangles, empty bbox (the 207-fragment class).
function emptyGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  g.setIndex([]);
  return g;
}
// Two-vertex "line" whose only primitive is degenerate: canonical 0 triangles but 2 retained vertices and
// a non-empty bbox (the 5-fragment class: classified 'derived' before the amendment, derived weld 0).
function lineGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0], 3));
  g.setIndex([0, 1, 1]);
  return g;
}
const NEAR_BOUNDS = { min: [1.2, -0.1, -0.1], max: [1.8, 0.1, 0.1] };    // AABB-disjoint from box(2,2,2) at origin
const OVERLAP_BOUNDS = { min: [0.2, -0.1, -0.1], max: [0.8, 0.1, 0.1] }; // AABB-overlapping it

async function runRecorded(scene, clearance) {
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => {
    if (kind === 'hard-clash-precheck' || kind === 'clearance-distance-query') events.push([kind, payload.stage, payload.precheckNotRunReason ?? payload.outcome ?? null]);
  });
  try {
    const result = await runPair(scene, clearance);
    return { ...result, events };
  } finally {
    clearDiagnosticEventRecorder();
  }
}

test('no-surface: empty canonical and two-vertex line under an anisotropic transform -> no hit, NO diagnostic, counted', async () => {
  const observed = [];
  for (const [name, geometry] of [['empty', emptyGeometry], ['line', lineGeometry]]) {
    for (const [at, bounds] of [[[1.5, 0, 0], NEAR_BOUNDS], [[0.5, 0, 0], OVERLAP_BOUNDS]]) {
      const scene = twoFragScene({ geometry: box(2, 2, 2) }, { geometry: geometry(), at, scale: [1, 2.5, 1], bounds });
      const { pairs, statistics, world, events } = await runRecorded(scene, 1);
      const label = `${name} ${bounds === NEAR_BOUNDS ? 'disjoint' : 'overlap'}`;
      assert.equal(pairs.length, 0, label);
      assert.deepEqual(statistics.diagnostics, [], `${label}: no diagnostic at all`);
      assert.equal(statistics.clearanceOverlapPrechecksRun, 0, label);
      assert.equal(statistics.clearanceDistanceQueriesRun, 0, label);
      assert.equal(statistics.clearanceHardClashExclusions, 0, label);
      const d = world.getEpochClearanceDerivedGeometryDiagnostics(1);
      assert.equal(d.noSurfaceOperands, 1, label);
      assert.equal(d.builds, 0, `${label}: no derived build for a surface-less operand`);
      assert.deepEqual(events, [['hard-clash-precheck', 'not-run', 'no-clearance-surface-before-precheck']], label);
      observed.push(JSON.stringify({ diagnostics: statistics.diagnostics, events, d }));
    }
  }
  // The two classes are classified identically.
  assert.equal(observed[0], observed[2]);
  assert.equal(observed[1], observed[3]);
});

test('no-surface: on either side; both sides surface-less -> one pair evaluation counts both operands', async () => {
  const aniso = (geometry, at) => ({ geometry, at, scale: [1, 2.5, 1], bounds: { min: [at[0] - 0.3, -0.1, -0.1], max: [at[0] + 0.3, 0.1, 0.1] } });
  {
    const { pairs, statistics, world } = await runPair(twoFragScene(aniso(lineGeometry(), [-1.5, 0, 0]), { geometry: box(2, 2, 2), at: [0.5, 0, 0] }), 1);
    assert.equal(pairs.length, 0);
    assert.deepEqual(statistics.diagnostics, []);
    assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).noSurfaceOperands, 1, 'source side');
  }
  {
    const { pairs, statistics, world } = await runPair(twoFragScene(aniso(emptyGeometry(), [0, 0, 0]), aniso(lineGeometry(), [0.4, 0, 0])), 1);
    assert.equal(pairs.length, 0);
    assert.deepEqual(statistics.diagnostics, []);
    assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).noSurfaceOperands, 2, 'both sides');
  }
});

test('no-surface never masks a genuinely unsupported partner: the reflected/sheared side is still diagnosed', async () => {
  const shear = new THREE.Matrix4().set(1, 0.25, 0, 2.5, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  for (const partner of [
    { name: 'shear', matrixArray: shear.toArray() },
    { name: 'reflected', matrixArray: compose({ at: [2.5, 0, 0], scale: [1, -2, 1] }).toArray() },
  ]) {
    const scene = twoFragScene(
      { geometry: emptyGeometry(), at: [0, 0, 0], scale: [1, 2.5, 1], bounds: { min: [1, -0.1, -0.1], max: [1.2, 0.1, 0.1] } },
      { geometry: box(2, 2, 2), matrixArray: partner.matrixArray },
    );
    const { pairs, statistics, world } = await runPair(scene, 1);
    assert.equal(pairs.length, 0, partner.name);
    assert.deepEqual(statistics.diagnostics.map((d) => [d.scope, d.reason, d.role, d.fragment.fragId]),
      [['fragment', 'clearance-anisotropic-scale-unsupported', 'target', 200]], partner.name);
    // The counter measures no-surface SHORT-CIRCUITS: this pair was decided by the unsupported partner.
    assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).noSurfaceOperands, 0, partner.name);
  }
});

test('NOT no-surface: a non-empty canonical whose DERIVED weld collapses to 0 triangles stays diagnosed (flat-axis 6e-6)', async () => {
  // box(2,2,2) scaled (6e-6, 6e-6, 1): canonical 12 triangles; prescaled x/y extents 1.2e-5 < weld 1e-4
  // -> every derived triangle collapses (numeric collapse, not an absent surface).
  const targetMatrix = compose({ at: [1.5, 0, 0], scale: [6e-6, 6e-6, 1] });
  const scene = twoFragScene({ geometry: box(2, 2, 2) }, { geometry: box(2, 2, 2), matrixArray: targetMatrix.toArray() });
  const { pairs, statistics, world, events } = await runRecorded(scene, 1);
  assert.equal(pairs.length, 0);
  assert.deepEqual(statistics.diagnostics.map((d) => [d.scope, d.reason, d.role, d.fragment.fragId]),
    [['fragment', 'clearance-anisotropic-scale-unsupported', 'target', 200]]);
  assert.equal(statistics.clearanceDistanceQueriesRun, 0);
  const d = world.getEpochClearanceDerivedGeometryDiagnostics(1);
  assert.equal(d.noSurfaceOperands, 0);
  assert.equal(d.builds, 1, 'the derived mesh was built and found empty');
  assert.equal(events.some((e) => e[2] === 'no-clearance-surface-before-precheck'), false);
});

test('UNIFORM zero-triangle operands keep the unchanged legacy path (disjoint: distance query, beyond threshold; overlap: precheck inconclusive)', async () => {
  for (const [name, geometry] of [['empty', emptyGeometry], ['line', lineGeometry]]) {
    for (const scale of [[1, 1, 1], [2, 2, 2]]) {
      const disjoint = await runRecorded(twoFragScene({ geometry: box(2, 2, 2) }, { geometry: geometry(), at: [1.5, 0, 0], scale, bounds: NEAR_BOUNDS }), 1);
      assert.equal(disjoint.pairs.length, 0, name);
      assert.deepEqual(disjoint.statistics.diagnostics, [], name);
      assert.equal(disjoint.statistics.clearanceOverlapPrechecksRun, 0, name);
      assert.equal(disjoint.statistics.clearanceDistanceQueriesRun, 1, `${name}: legacy still runs the distance query`);
      assert.deepEqual(disjoint.events, [
        ['hard-clash-precheck', 'not-run', 'aabb-disjoint'],
        ['clearance-distance-query', 'clearance-distance-query', 'beyond-threshold'],
      ], name);
      assert.equal(disjoint.world.getEpochClearanceDerivedGeometryDiagnostics(1).noSurfaceOperands, 0, `${name}: uniform path is not counted`);

      const overlap = await runPair(twoFragScene({ geometry: box(2, 2, 2) }, { geometry: geometry(), at: [0.5, 0, 0], scale, bounds: OVERLAP_BOUNDS }), 1);
      assert.equal(overlap.pairs.length, 0, name);
      assert.deepEqual(overlap.statistics.diagnostics.map((d) => [d.scope, d.reason]), [['pair', 'clearance-hard-clash-precheck-inconclusive']],
        `${name}: pre-existing legacy precheck behaviour on an empty mesh, preserved byte-for-byte`);
      assert.equal(overlap.statistics.clearanceOverlapPrechecksRun, 1, name);
      assert.equal(overlap.world.getEpochClearanceDerivedGeometryDiagnostics(1).noSurfaceOperands, 0, name);
    }
  }
});

test('noSurfaceOperands is cumulative per live epoch, survives invalidateModelPlacement, released on eviction', async () => {
  const scene = twoFragScene({ geometry: box(2, 2, 2) }, { geometry: emptyGeometry(), at: [1.5, 0, 0], scale: [1, 2.5, 1], bounds: NEAR_BOUNDS });
  const world = await CollisionWorld.fromViewer(scene.viewer, OPTIONS);
  const [model] = scene.models;
  const query = { source: { model, dbIds: [10] }, target: { model, dbIds: [20] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear' };
  await world.findClashes(query);
  await world.findClashes(query);
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).noSurfaceOperands, 2);
  world.invalidateModelPlacement(model);
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).noSurfaceOperands, 2, 'carried across a non-cancelling detach');
  world.evictModel(model);
  assert.equal(world.getEpochClearanceDerivedGeometryDiagnostics(1).noSurfaceOperands, 0, 'released with the epoch');
});
