import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeometryRegistry } from '../../collision/geometry/GeometryRegistry.js';
import { WorldDisposedError, ModelEvictedError } from '../../collision/errors.js';
import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';

// -- test helpers ---------------------------------------------------------

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Thin adapter over the real FakeCheckpointPort fixture (test/fixtures/FakeCheckpointPort.mjs).
// GeometryRegistry only ever calls checkpointPort.checkpoint({ loadEpoch }) -- never with a
// `model`, since a registry entry carries no live Model reference (see this section's
// cross-task interface flags).
function makeCheckpointHarness() {
  const { port, controls } = makeFakeCheckpointPort();
  let callCount = 0;
  return {
    port,
    controls,
    callCount: () => callCount,
    checkpointPort: {
      // Deliberately NOT `async` -- must pass the real port's synchronous "not due"
      // fast path (undefined, no Promise) straight through, and let a synchronous
      // liveness-failure throw stay synchronous too, exactly like the real port's
      // documented contract (see scheduler.js). Wrapping this in `async` would mask
      // the very asymmetry GeometryRegistry._runPhase is required to respect.
      checkpoint: (args) => {
        callCount++;
        return port.checkpoint(args);
      },
    },
    setEpochLive: (loadEpoch, isLive) => controls.setEpochLive(loadEpoch, isLive),
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

test("buildState reaches ready once weld+BVH resolve: a second call for the same key never re-invokes buildWeld", async () => {
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
