// test/geometry/ClearanceDerivedGeometryCache.test.mjs
//
// SVF2 non-uniform fragment clearance design §5.2 / §8 T3: the clearance-private derived
// ("prescaled") geometry cache and its lifecycle state machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ClearanceDerivedGeometryCache, DerivedGeometryUnavailableError, derivedGeometryKey,
} from '../../collision/geometry/ClearanceDerivedGeometryCache.js';
import { WorldDisposedError, ModelEvictedError, RenderProxyUnavailableError } from '../../collision/errors.js';
import { adaptViewerGeometry } from '../../collision/viewer/ViewerGeometryAdapter.js';
import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';

const EPOCH = 1;

function boxView(w = 1, h = 1, d = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  return adaptViewerGeometry({
    attributes: { position: { array: g.attributes.position.array.slice(), itemSize: 3 } },
    index: { array: g.index.array.slice() },
  });
}

// resolveGeometryView spy: one fresh box view per call unless overridden per geometryIndex.
function makeHarness({ controllableYield = false, views = {}, ...cacheOptions } = {}) {
  const { port, controls } = makeFakeCheckpointPort({ controllableYield });
  controls.setEpochLive(EPOCH, true);
  controls.setEpochLive(2, true);
  const reads = [];
  const order = [];
  const resolveGeometryView = (loadEpoch, geometryIndex) => {
    order.push('read');
    reads.push({ loadEpoch, geometryIndex });
    const v = views[geometryIndex];
    if (typeof v === 'function') return v(loadEpoch, geometryIndex);
    return { triangleGeometryView: v ?? boxView(), weldEpsilon: 1e-4 };
  };
  const checkpointPort = { checkpoint: (args) => { order.push('checkpoint'); return port.checkpoint(args); } };
  const cache = new ClearanceDerivedGeometryCache({ resolveGeometryView, checkpointPort, ...cacheOptions });
  return { cache, controls, reads, order };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('derivedGeometryKey uses exact float64 bits: distinct scales never collide, identical scales share', () => {
  assert.equal(derivedGeometryKey(3, [1, 2, 3]), derivedGeometryKey(3, [1, 2, 3]));
  assert.notEqual(derivedGeometryKey(3, [1, 2, 3]), derivedGeometryKey(3, [1, 2, 3 + 2 ** -51]));
  assert.notEqual(derivedGeometryKey(3, [1, 2, 3]), derivedGeometryKey(4, [1, 2, 3]));
  assert.notEqual(derivedGeometryKey(1, [12, 3, 4]), derivedGeometryKey(11, [2, 3, 4]));
});

test('a ready entry holds the prescaled, world-unit-welded mesh with a BVH (boundsTree attached)', async () => {
  const { cache } = makeHarness();
  const entry = await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  assert.equal(entry.state, 'ready');
  assert.equal(entry.triangleCount, 12);
  entry.geometry.computeBoundingBox();
  assert.deepEqual(entry.geometry.boundingBox.min.toArray(), [-1, -1.5, -2]);
  assert.deepEqual(entry.geometry.boundingBox.max.toArray(), [1, 1.5, 2]);
  assert.equal(entry.geometry.boundsTree, entry.bvh);
  assert.ok(Math.abs(entry.localDiagonal - Math.hypot(2, 3, 4)) < 1e-12);
});

test('exact-bits keying: identical S -> one build (hit), distinct S -> distinct entries', async () => {
  const { cache, reads } = makeHarness();
  const a = await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  const b = await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  const c = await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4.000001] });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(reads.length, 2);
  const d = cache.getEpochDiagnostics(EPOCH);
  assert.equal(d.builds, 2);
  assert.equal(d.hits, 1);
  assert.equal(d.sharedWaits, 0);
  assert.equal(d.readyEntries, 2);
});

test('concurrent miss -> one build, one shared promise (single flight)', async () => {
  const { cache, reads, controls } = makeHarness({ controllableYield: true });
  controls.forceYieldDue();
  const p1 = cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  const p2 = cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  assert.equal(p1, p2, 'the second caller shares the in-flight placeholder promise');
  assert.equal(cache.getEpochDiagnostics(EPOCH).buildingEntries, 1);
  controls.resolveNextYield();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, r2);
  assert.equal(reads.length, 1);
  const d = cache.getEpochDiagnostics(EPOCH);
  assert.equal(d.builds, 1);
  assert.equal(d.sharedWaits, 1);
  assert.equal(d.builds + d.hits + d.sharedWaits, 2);
});

test('failure (RenderProxyUnavailableError) removes the placeholder and the next call retries', async () => {
  let fail = true;
  const { cache, reads } = makeHarness({
    views: {
      0: (loadEpoch, geometryIndex) => {
        if (fail) throw new RenderProxyUnavailableError({ loadEpoch, geometryIndex, fragId: 7, modelId: 1 });
        return { triangleGeometryView: boxView(), weldEpsilon: 1e-4 };
      },
    },
  });
  await assert.rejects(cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] }), RenderProxyUnavailableError);
  assert.equal(cache.getEpochDiagnostics(EPOCH).buildingEntries, 0);
  assert.equal(cache.getEpochDiagnostics(EPOCH).readyEntries, 0);
  fail = false;
  const entry = await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  assert.equal(entry.state, 'ready');
  assert.equal(reads.length, 2);
});

test('a second read with an unsupported layout -> DerivedGeometryUnavailableError, nothing cached', async () => {
  let unsupported = true;
  const { cache } = makeHarness({
    views: {
      0: () => (unsupported
        ? { triangleGeometryView: { unsupported: true, reason: 'unsupported-geometry-layout' }, weldEpsilon: 1e-4 }
        : { triangleGeometryView: boxView(), weldEpsilon: 1e-4 }),
    },
  });
  await assert.rejects(cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] }), DerivedGeometryUnavailableError);
  assert.equal(cache.getEpochDiagnostics(EPOCH).unsupportedEntries, 0);
  unsupported = false;
  assert.equal((await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] })).state, 'ready');
});

test('any other builder exception propagates and caches nothing', async () => {
  const { cache } = makeHarness({ views: { 0: () => { throw new TypeError('builder bug'); } } });
  await assert.rejects(cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] }), TypeError);
  const d = cache.getEpochDiagnostics(EPOCH);
  assert.equal(d.readyEntries + d.buildingEntries + d.unsupportedEntries, 0);
});

test('eviction race: releaseEpoch during an in-flight build -> waiters get ModelEvictedError, no late publish, no bucket recreated', async () => {
  const { cache, controls } = makeHarness({ controllableYield: true });
  controls.forceYieldDue();
  const p = cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4], ownerModelIdHint: 42 });
  cache.releaseEpoch(EPOCH);
  await assert.rejects(p, (err) => err instanceof ModelEvictedError && err.modelId === 42);
  controls.resolveNextYield(); // let the abandoned attempt finish; it must not publish
  await flush();
  assert.equal(cache.hasEpoch(EPOCH), false, 'no bucket recreated for the released epoch');
  assert.deepEqual(cache.getEpochDiagnostics(EPOCH), {
    readyEntries: 0, buildingEntries: 0, unsupportedEntries: 0, builds: 0, hits: 0, sharedWaits: 0, evictions: 0,
    retainedPositionBytes: 0, retainedIndexBytes: 0, retainedBvhBytes: 0,
  });
});

test('late completion after release never publishes (attempt resolves after the signal won)', async () => {
  // The checkpoint yield resolves while the epoch is still live in the port, so the attempt itself
  // succeeds -- but releaseEpoch already rejected the waiters; the result must not be cached.
  const { cache, controls } = makeHarness({ controllableYield: true });
  controls.forceYieldDue();
  const p = cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  cache.releaseEpoch(EPOCH);
  await assert.rejects(p, ModelEvictedError);
  controls.resolveNextYield();
  await flush();
  assert.equal(cache.hasEpoch(EPOCH), false);
});

test('disposal race: releaseAll during an in-flight build -> WorldDisposedError', async () => {
  const { cache, controls } = makeHarness({ controllableYield: true });
  controls.forceYieldDue();
  const p = cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  cache.releaseAll();
  await assert.rejects(p, WorldDisposedError);
  controls.resolveNextYield();
  await flush();
  assert.equal(cache.hasEpoch(EPOCH), false);
});

test('a checkpoint liveness failure (epoch already dead) rejects and leaves no bucket behind', async () => {
  const { cache, controls } = makeHarness();
  controls.setEpochLive(EPOCH, false);
  await assert.rejects(cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] }), ModelEvictedError);
  assert.equal(cache.hasEpoch(EPOCH), false);
});

test('detachEpoch during an in-flight build -> waiters resolve normally, result NOT cached', async () => {
  const { cache, controls, reads } = makeHarness({ controllableYield: true });
  controls.forceYieldDue();
  const p = cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  cache.detachEpoch(EPOCH);
  controls.resolveNextYield();
  const entry = await p;
  assert.equal(entry.state, 'ready', 'a placement change never aborts a live query');
  const d = cache.getEpochDiagnostics(EPOCH);
  assert.equal(d.readyEntries, 0, 'the superseded build is not published into the fresh bucket');
  assert.equal(d.builds, 1, 'cumulative counters survive a detach');
  // The next call builds again (fresh bucket).
  await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  assert.equal(reads.length, 2);
  assert.equal(cache.getEpochDiagnostics(EPOCH).readyEntries, 1);
});

test('releaseEpoch still rejects a build that was detached first', async () => {
  const { cache, controls } = makeHarness({ controllableYield: true });
  controls.forceYieldDue();
  const p = cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  cache.detachEpoch(EPOCH);
  cache.releaseEpoch(EPOCH);
  await assert.rejects(p, ModelEvictedError);
  controls.resolveNextYield();
  await flush();
});

test('detachEpoch drops ready entries of that epoch only', async () => {
  const { cache } = makeHarness();
  await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  await cache.get({ loadEpoch: 2, geometryIndex: 0, scale: [2, 3, 4] });
  cache.detachEpoch(EPOCH);
  assert.equal(cache.getEpochDiagnostics(EPOCH).readyEntries, 0);
  assert.equal(cache.getEpochDiagnostics(EPOCH).retainedPositionBytes, 0);
  assert.equal(cache.getEpochDiagnostics(2).readyEntries, 1);
});

test('non-finite scaled coordinate -> cached unsupported marker (deterministic, no rebuild)', async () => {
  const { cache, reads } = makeHarness();
  const a = await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [1e39, 1, 1] });
  assert.deepEqual(a, { state: 'unsupported', cause: 'scaled-position-non-finite' });
  const b = await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [1e39, 1, 1] });
  assert.equal(b, a);
  assert.equal(reads.length, 1);
  const d = cache.getEpochDiagnostics(EPOCH);
  assert.equal(d.unsupportedEntries, 1);
  assert.equal(d.hits, 1);
});

test('a weld that collapses every triangle -> ready entry with triangleCount 0 (no BVH)', async () => {
  const { cache } = makeHarness();
  const entry = await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [1e-9, 1e-9, 3] });
  assert.equal(entry.state, 'ready');
  assert.equal(entry.triangleCount, 0);
  assert.equal(entry.bvh, null);
  assert.equal(entry.geometry, null);
  assert.equal(cache.getEpochDiagnostics(EPOCH).readyEntries, 1);
});

function bvhBytes(bvh) {
  return bvh._roots.reduce((sum, r) => sum + r.byteLength, 0) + (bvh._indirectBuffer ? bvh._indirectBuffer.byteLength : 0);
}

test('retained-byte accounting matches the ready entries actually held', async () => {
  const { cache } = makeHarness();
  const a = await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  const b = await cache.get({ loadEpoch: EPOCH, geometryIndex: 1, scale: [5, 3, 4] });
  const d = cache.getEpochDiagnostics(EPOCH);
  const pos = (e) => e.geometry.attributes.position.array.byteLength;
  const idx = (e) => e.geometry.index.array.byteLength;
  assert.equal(d.retainedPositionBytes, pos(a) + pos(b));
  assert.equal(d.retainedIndexBytes, idx(a) + idx(b));
  assert.equal(d.retainedBvhBytes, bvhBytes(a.bvh) + bvhBytes(b.bvh));
});

test('LRU byte budget exceeded by one entry -> exactly the least-recently-used ready entry evicted', async () => {
  const probe = makeHarness();
  const one = await probe.cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  const d1 = probe.cache.getEpochDiagnostics(EPOCH);
  const entryBytes = d1.retainedPositionBytes + d1.retainedIndexBytes + d1.retainedBvhBytes;
  assert.ok(one && entryBytes > 0);

  // Budget for exactly two box entries (every box entry has identical byte size).
  const { cache, reads } = makeHarness({ maxBytesPerEpoch: 2 * entryBytes });
  await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] }); // A
  await cache.get({ loadEpoch: EPOCH, geometryIndex: 1, scale: [2, 3, 4] }); // B
  await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] }); // touch A -> B is now LRU
  await cache.get({ loadEpoch: EPOCH, geometryIndex: 2, scale: [2, 3, 4] }); // C -> evicts B only
  const d = cache.getEpochDiagnostics(EPOCH);
  assert.equal(d.evictions, 1);
  assert.equal(d.readyEntries, 2);
  assert.equal(d.retainedPositionBytes + d.retainedIndexBytes + d.retainedBvhBytes, 2 * entryBytes);
  const readsBefore = reads.length;
  await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] }); // A still cached
  assert.equal(reads.length, readsBefore);
  await cache.get({ loadEpoch: EPOCH, geometryIndex: 1, scale: [2, 3, 4] }); // B was evicted -> rebuild
  assert.equal(reads.length, readsBefore + 1);
});

test('LRU entry cap (markers included) exceeded by one -> exactly the LRU entry evicted, never a building one', async () => {
  const { cache, controls } = makeHarness({ maxEntriesPerEpoch: 2, controllableYield: true });
  // A: an unsupported marker (counts toward the cap); no yield is due, so it completes at once.
  await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [1e39, 1, 1] });
  // B: hold in flight.
  controls.forceYieldDue();
  const b = cache.get({ loadEpoch: EPOCH, geometryIndex: 1, scale: [2, 3, 4] });
  // C: completes while B is building -> 3 entries > cap 2 -> evict the LRU NON-building one (A).
  controls.forceYieldNotDue();
  await cache.get({ loadEpoch: EPOCH, geometryIndex: 2, scale: [2, 3, 4] });
  let d = cache.getEpochDiagnostics(EPOCH);
  assert.equal(d.evictions, 1);
  assert.equal(d.unsupportedEntries, 0, 'the LRU marker was evicted');
  assert.equal(d.buildingEntries, 1, 'the building entry is never evicted');
  controls.resolveNextYield();
  await b;
  d = cache.getEpochDiagnostics(EPOCH);
  assert.equal(d.readyEntries, 2, 'B published in place of its own placeholder: B + C, at the cap');
  assert.equal(d.evictions, 1, 'publishing B did not exceed the cap (its placeholder already counted)');
  // One more distinct entry now exceeds the cap by one: exactly the LRU entry (C) goes.
  await cache.get({ loadEpoch: EPOCH, geometryIndex: 3, scale: [2, 3, 4] });
  d = cache.getEpochDiagnostics(EPOCH);
  assert.equal(d.evictions, 2);
  assert.equal(d.readyEntries, 2);
});

test('synchronous Viewer read + copy: no await between resolveGeometryView and the weld copy', async () => {
  // The view's positions are mutated on the very next microtask after the read. A build that
  // awaited anywhere between the read and the copy would observe the corrupted buffer.
  const { cache, order } = makeHarness({
    views: {
      0: () => {
        const view = boxView();
        queueMicrotask(() => view.positions.fill(1e6));
        return { triangleGeometryView: view, weldEpsilon: 1e-4 };
      },
    },
  });
  const entry = await cache.get({ loadEpoch: EPOCH, geometryIndex: 0, scale: [2, 3, 4] });
  entry.geometry.computeBoundingBox();
  assert.deepEqual(entry.geometry.boundingBox.max.toArray(), [1, 1.5, 2], 'the copy happened before any microtask ran');
  assert.deepEqual(order, ['checkpoint', 'read'], 'liveness checkpoint first, then the synchronous read');
});

test('getEpochDiagnostics returns the exhaustive empty default for an unknown epoch', () => {
  const { cache } = makeHarness();
  assert.deepEqual(cache.getEpochDiagnostics(99), {
    readyEntries: 0, buildingEntries: 0, unsupportedEntries: 0, builds: 0, hits: 0, sharedWaits: 0, evictions: 0,
    retainedPositionBytes: 0, retainedIndexBytes: 0, retainedBvhBytes: 0,
  });
});

test('all entries building: the cap never evicts or refuses an in-flight build; it is restored as builds publish', async () => {
  // In-flight placeholders hold no geometry (the build itself is synchronous after the checkpoint),
  // and CollisionWorld keeps at most one derived build in flight per findClashes call (pairs and
  // their two sides are resolved sequentially), so the cap governs SETTLED entries only.
  const { cache, controls } = makeHarness({ maxEntriesPerEpoch: 2, controllableYield: true });
  const pending = [];
  for (let g = 0; g < 3; g++) {
    controls.forceYieldDue();
    pending.push(cache.get({ loadEpoch: EPOCH, geometryIndex: g, scale: [2, 3, 4] }));
  }
  let d = cache.getEpochDiagnostics(EPOCH);
  assert.equal(d.buildingEntries, 3, 'three distinct in-flight builds, cap 2: none refused');
  assert.equal(d.evictions, 0, 'building entries are never evicted');
  for (let i = 0; i < 3; i++) controls.resolveNextYield();
  const results = await Promise.all(pending);
  assert.ok(results.every((r) => r.state === 'ready'), 'every waiter still gets its result');
  d = cache.getEpochDiagnostics(EPOCH);
  assert.equal(d.buildingEntries, 0);
  assert.equal(d.readyEntries, 2, 'cap restored once the builds settled');
  assert.equal(d.evictions, 1);
});
