// test/tlas/TlasCache.test.mjs
//
// Task 10 (Batch 3): TlasCache -- lazy build, revision-aware single-flight, release lifecycle.
// Mirrors GeometryRegistry.test.mjs's own stub-builder test style. The revision-aware
// mid-build-supersession behavior (codex-review Critical #1 fix, already resolved in the plan's
// own text) is the one genuinely new mechanism this module adds beyond GeometryRegistry's
// existing insert-first-then-build / cancellation-race pattern: getEntry must NEVER retry
// internally with a caller's own stale expectedRevision -- it returns {outcome: 'superseded'} and
// leaves re-derivation to the caller (Task 13).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TlasCache } from '../../collision/tlas/TlasCache.js';

function stubCheckpointPort() {
  return { checkpoint: () => undefined }; // always-fast-path stub, mirrors GeometryRegistry's own tests
}

test('TlasCache requires a buildPrimitives function', () => {
  assert.throws(() => new TlasCache({ checkpointPort: stubCheckpointPort() }), TypeError);
});

test('first getEntry for an epoch builds, outcome "built"', async () => {
  const buildPrimitives = async () => [
    { loadEpoch: 1, fragmentId: 1, ownerDbId: 1, modelId: 'm', worldBounds: { min: [0, 0, 0], max: [1, 1, 1] } },
  ];
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });
  const { outcome, builtAtRevision } = await cache.getEntry(1, 1);
  assert.equal(outcome, 'built');
  assert.equal(builtAtRevision, 1);
});

test('a second getEntry at the SAME revision hits the cache, outcome "hit", no rebuild', async () => {
  let buildCount = 0;
  const buildPrimitives = async () => { buildCount++; return []; };
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });
  await cache.getEntry(1, 1);
  const second = await cache.getEntry(1, 1);
  assert.equal(second.outcome, 'hit');
  assert.equal(buildCount, 1);
});

test('a getEntry at a HIGHER revision than the cached entry rebuilds (growth staleness)', async () => {
  let buildCount = 0;
  const buildPrimitives = async () => { buildCount++; return []; };
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });
  await cache.getEntry(1, 1);
  const second = await cache.getEntry(1, 2);
  assert.equal(second.outcome, 'built');
  assert.equal(buildCount, 2);
});

test('two concurrent getEntry calls for the same NEW epoch share one build (single-flight)', async () => {
  let buildCount = 0;
  let resolveBuild;
  const buildPrimitives = () => { buildCount++; return new Promise((resolve) => { resolveBuild = resolve; }); };
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });
  const p1 = cache.getEntry(1, 1);
  const p2 = cache.getEntry(1, 1);
  resolveBuild([]);
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(buildCount, 1);
  assert.deepEqual([r1.outcome, r2.outcome].sort(), ['built', 'shared-wait']);
});

test('a build superseded by a NEWER revision arriving mid-build returns {outcome:"superseded"}, never published, and the caller\'s stale expectedRevision is never internally retried', async () => {
  let buildCount = 0;
  const resolvers = [];
  const buildPrimitives = () => {
    buildCount++;
    return new Promise((resolve) => { resolvers.push(resolve); });
  };
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });

  const slowBuild = cache.getEntry(1, 1); // starts building for revision 1, resolves LAST
  assert.equal(buildCount, 1);

  const fastBuild = cache.getEntry(1, 2); // a second, concurrent call for revision 2
  assert.equal(buildCount, 2);
  resolvers[1]([]); // let revision 2's build resolve and publish first
  const fastResult = await fastBuild;
  assert.equal(fastResult.outcome, 'built');
  assert.equal(fastResult.builtAtRevision, 2);

  resolvers[0]([]); // now let revision 1's slow build resolve
  const slowResult = await slowBuild;
  assert.equal(slowResult.outcome, 'superseded');
  assert.equal(buildCount, 2, 'no internal retry -- the cache never starts a third build for the stale revision 1');

  // The caller (simulating Task 13's own retry contract) re-derives current state and asks again --
  // must observe the already-published revision-2 entry directly, proving no regression occurred.
  const retried = await cache.getEntry(1, 2);
  assert.equal(retried.outcome, 'hit');
  assert.equal(retried.builtAtRevision, 2);
  assert.equal(buildCount, 2, 'still no extra build triggered by the retry -- it was already cached');
});

test('an epoch released (evicted/disposed) while its build is in flight never publishes; the resolved build is discarded, not replayed as a fresh build for the same epoch', async () => {
  let buildCount = 0;
  const buildPrimitives = () => {
    buildCount++;
    // Only the FIRST build is manually resolved (torn down while pending, below); a second,
    // genuinely fresh build after release must resolve on its own so this test can assert its
    // outcome without needing a second capture-and-resolve dance.
    return buildCount === 1 ? new Promise((resolve) => { firstBuildResolve = resolve; }) : Promise.resolve([]);
  };
  let firstBuildResolve;
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });

  const pending = cache.getEntry(1, 1);
  cache.releaseEntryForEpoch(1); // torn down while still building
  firstBuildResolve([]);
  const result = await pending;
  assert.equal(result.outcome, 'superseded');

  const after = await cache.getEntry(1, 1); // a fresh call for the SAME (never-reused) epoch
  assert.equal(after.outcome, 'built', 'a genuinely fresh build, not the discarded one silently resurrected');
  assert.equal(buildCount, 2);
});

test('releaseAll during an in-flight build has the same discard-not-publish effect as releaseEntryForEpoch', async () => {
  let resolveBuild;
  const buildPrimitives = () => new Promise((resolve) => { resolveBuild = resolve; });
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });

  const pending = cache.getEntry(1, 1);
  cache.releaseAll();
  resolveBuild([]);
  const result = await pending;
  assert.equal(result.outcome, 'superseded');
  assert.equal(cache.getBuiltAtRevision(1), undefined);
});

test('releaseEntryForEpoch removes the cached entry; a later getEntry rebuilds fresh', async () => {
  let buildCount = 0;
  const buildPrimitives = async () => { buildCount++; return []; };
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });
  await cache.getEntry(1, 1);
  cache.releaseEntryForEpoch(1);
  const second = await cache.getEntry(1, 1);
  assert.equal(second.outcome, 'built');
  assert.equal(buildCount, 2);
});

test('releaseAll clears every epoch\'s entry', async () => {
  let buildCount = 0;
  const buildPrimitives = async () => { buildCount++; return []; };
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });
  await cache.getEntry(1, 1);
  await cache.getEntry(2, 1);
  cache.releaseAll();
  assert.equal(cache.getBuiltAtRevision(1), undefined);
  assert.equal(cache.getBuiltAtRevision(2), undefined);
  const rebuilt1 = await cache.getEntry(1, 1);
  const rebuilt2 = await cache.getEntry(2, 1);
  assert.equal(rebuilt1.outcome, 'built');
  assert.equal(rebuilt2.outcome, 'built');
  assert.equal(buildCount, 4);
});

test('getBuiltAtRevision returns undefined for a never-built or still-building epoch, the built revision once ready', async () => {
  let resolveBuild;
  const buildPrimitives = () => new Promise((resolve) => { resolveBuild = resolve; });
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });
  assert.equal(cache.getBuiltAtRevision(1), undefined, 'never built');
  const pending = cache.getEntry(1, 5);
  assert.equal(cache.getBuiltAtRevision(1), undefined, 'still building');
  resolveBuild([]);
  await pending;
  assert.equal(cache.getBuiltAtRevision(1), 5);
});

test('the checkpoint port is consulted before buildPrimitives runs, using the requested loadEpoch', async () => {
  const seen = [];
  const buildPrimitives = async (loadEpoch) => { seen.push(loadEpoch); return []; };
  let checkpointCalls = 0;
  const checkpointPort = { checkpoint: (arg) => { checkpointCalls++; assert.deepEqual(arg, { loadEpoch: 7 }); return undefined; } };
  const cache = new TlasCache({ buildPrimitives, checkpointPort });
  await cache.getEntry(7, 1);
  assert.equal(checkpointCalls, 1);
  assert.deepEqual(seen, [7]);
});
