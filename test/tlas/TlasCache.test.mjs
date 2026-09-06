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

// === Batch 3 whole-batch review fix pass ==========================================================

test('Important #1: a build that rejects (checkpoint throws for a disposed/dead epoch) does not leave a permanently-stuck entry behind', async () => {
  let shouldThrow = true;
  const checkpointPort = { checkpoint: () => { if (shouldThrow) throw new Error('epoch is dead'); return undefined; } };
  let buildCount = 0;
  const buildPrimitives = async () => { buildCount++; return []; };
  const cache = new TlasCache({ buildPrimitives, checkpointPort });

  await assert.rejects(() => cache.getEntry(1, 1), /epoch is dead/);
  assert.equal(cache.getBuiltAtRevision(1), undefined, 'no lingering entry after the rejection');
  assert.equal(buildCount, 0, 'checkpoint threw before buildPrimitives ever ran');

  shouldThrow = false;
  const after = await cache.getEntry(1, 1);
  assert.equal(after.outcome, 'built', 'a later call builds fresh instead of re-rejecting off a stale entry');
  assert.equal(buildCount, 1);
});

// === Batch 3 boundary fix: Important finding #2 (real cancellation-signal parity) ================
//
// Every test below uses a buildPrimitives promise that is DELIBERATELY NEVER resolved or rejected.
// Before this fix, none of these could settle until that promise settled on its own -- there was no
// active cancellation signal racing the build, only a post-completion identity/`released` check. A
// regression here means the awaited call hangs and the test times out, not a clean assertion
// failure -- that hang IS the regression signal.

test('Important #2: releaseEntryForEpoch resolves an in-flight build to superseded immediately, without waiting for its buildPrimitives promise to ever settle', async () => {
  const buildPrimitives = () => new Promise(() => {}); // never resolves or rejects
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });

  const pending = cache.getEntry(1, 1);
  cache.releaseEntryForEpoch(1);
  const result = await pending;
  assert.equal(result.outcome, 'superseded');
  assert.equal(cache.getBuiltAtRevision(1), undefined);
});

test('Important #2: releaseAll resolves every in-flight build to superseded immediately, without waiting for their buildPrimitives promises to ever settle', async () => {
  const buildPrimitives = () => new Promise(() => {}); // never resolves or rejects
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });

  const pendingA = cache.getEntry(1, 1);
  const pendingB = cache.getEntry(2, 1);
  cache.releaseAll();
  const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
  assert.equal(resultA.outcome, 'superseded');
  assert.equal(resultB.outcome, 'superseded');
});

test('Important #2: a build superseded by a newer revision request resolves to superseded immediately, without waiting for its own buildPrimitives promise to ever settle', async () => {
  let buildCount = 0;
  const buildPrimitives = () => {
    buildCount++;
    if (buildCount === 1) return new Promise(() => {}); // the superseded build: never resolves
    return Promise.resolve([]);
  };
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });

  const stale = cache.getEntry(1, 1); // starts building for revision 1, never resolves on its own
  const fresh = await cache.getEntry(1, 2); // supersedes it before revision 1 ever settles
  assert.equal(fresh.outcome, 'built');
  assert.equal(fresh.builtAtRevision, 2);

  const staleResult = await stale; // must resolve now, not hang forever
  assert.equal(staleResult.outcome, 'superseded');
  assert.equal(cache.getBuiltAtRevision(1), 2, 'the newer build published correctly, untouched by the stale one\'s cancellation');
});

test('Important #2: single-flight sharers of a build cancelled mid-flight (via eviction) all resolve to superseded, none reject', async () => {
  const buildPrimitives = () => new Promise(() => {}); // never resolves or rejects
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });

  const p1 = cache.getEntry(1, 1);
  const p2 = cache.getEntry(1, 1); // shares the same in-flight build (single-flight)
  cache.releaseEntryForEpoch(1);
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.outcome, 'superseded');
  assert.equal(r2.outcome, 'superseded');
});

test('Important #2: a checkpoint failure for an epoch that was never explicitly released through this cache still rejects (unchanged from Important #1) -- cancellation-via-signal and checkpoint liveness failure remain distinct', async () => {
  // Guards against the fix collapsing the two failure paths into one: a checkpoint validation
  // failure (the real production port's own dead-epoch/disposed-world detection) is NOT routed
  // through the new CANCELLED signal and must keep rejecting exactly as Important #1 established.
  const checkpointPort = { checkpoint: () => { throw new Error('epoch is dead'); } };
  const cache = new TlasCache({ buildPrimitives: async () => [], checkpointPort });
  await assert.rejects(() => cache.getEntry(1, 1), /epoch is dead/);
  assert.equal(cache.getBuiltAtRevision(1), undefined);
});

test('Important #1/#2: a build superseded by a newer one resolves to superseded immediately (via the active cancellation signal, Important #2), and its own eventual late rejection is discarded without clobbering the newer entry (Important #1\'s original identity-guard intent)', async () => {
  // Updated for Important #2 (Batch 3 boundary fix): before that fix, the superseded build had no
  // active cancellation signal, so it stayed pending until its OWN buildPrimitives promise settled
  // on its own -- here, that meant `first` eventually REJECTED with 'late rejection' once
  // `rejectFirst` was called. With the fix, `first` is actively cancelled the moment `second`'s
  // build starts and resolves to {outcome:'superseded'} immediately, well before `rejectFirst` is
  // ever invoked -- preserving this test's original intent (the second build's entry must survive
  // untouched) while reflecting the new, earlier-settling contract.
  let call = 0;
  let rejectFirst;
  const buildPrimitives = () => {
    call++;
    if (call === 1) return new Promise((_resolve, reject) => { rejectFirst = reject; });
    return Promise.resolve([]);
  };
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });

  const first = cache.getEntry(1, 1); // starts building, will be actively cancelled below
  const second = await cache.getEntry(1, 2); // supersedes it with a successful higher-revision build
  assert.equal(second.outcome, 'built');

  const firstResult = await first;
  assert.equal(firstResult.outcome, 'superseded', 'cancelled via the active signal, never reaches its own rejection');

  // The abandoned build's own late, orphaned rejection must not clobber the newer entry.
  rejectFirst(new Error('late rejection'));
  await new Promise((resolve) => setImmediate(resolve)); // let the orphaned rejection's handlers flush
  assert.equal(cache.getBuiltAtRevision(1), 2, 'the second build\'s entry survives the first build\'s late, orphaned rejection untouched');
});

// === codex-review pass on the Important #2 fix itself (targeted review, Batch 3 boundary) ========
//
// codex-review (medium effort, request 20260906-220339-4318-25760) found that the active
// cancellation added above had no revision-monotonicity guard: a delayed caller requesting an
// OLDER revision than what is already ready or building could itself cancel/replace the NEWER
// entry -- exactly the class of bug the active-cancellation fix was supposed to prevent, not cause.
// It also flagged that Promise.race alone does not stop `attempt`'s own execution, so cancellation
// arriving after buildPrimitives resolves but before BVH construction still paid for that
// construction. Both are fixed in getEntry/_startBuild above; these tests cover the concrete
// failure scenarios codex-review described.

test('codex-review finding #1: a stale request for an OLDER revision cannot replace an already-READY newer revision', async () => {
  let buildCount = 0;
  const buildPrimitives = async () => { buildCount++; return []; };
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });
  await cache.getEntry(1, 2); // build revision 2, now ready
  assert.equal(buildCount, 1);

  const stale = await cache.getEntry(1, 1); // a delayed caller for an OLDER revision
  assert.equal(stale.outcome, 'superseded', 'must not rebuild/replace the newer ready entry');
  assert.equal(buildCount, 1, 'no rebuild triggered by the stale request');
  assert.equal(cache.getBuiltAtRevision(1), 2, 'revision 2 entry is untouched');
});

test('codex-review finding #1: a stale request for an OLDER revision cannot cancel an in-flight NEWER build', async () => {
  let buildCount = 0;
  let resolveNewer;
  const buildPrimitives = () => {
    buildCount++;
    if (buildCount === 1) return new Promise((resolve) => { resolveNewer = resolve; });
    throw new Error('a stale request must never trigger a second build');
  };
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });

  const newer = cache.getEntry(1, 2); // starts building revision 2
  assert.equal(buildCount, 1);

  const stale = await cache.getEntry(1, 1); // a delayed caller for an OLDER revision, arriving mid-build
  assert.equal(stale.outcome, 'superseded', 'the stale caller itself is the superseded party, not the newer build');
  assert.equal(buildCount, 1, 'the newer in-flight build was never cancelled or replaced');

  resolveNewer([]);
  const newerResult = await newer;
  assert.equal(newerResult.outcome, 'built', 'the newer build completes normally, unaffected by the stale request');
  assert.equal(cache.getBuiltAtRevision(1), 2);
});

test('codex-review finding #2: a build cancelled after buildPrimitives resolves skips BVH construction entirely -- the abandoned records are never even read', async () => {
  // A getter with a side effect stands in for "was CollisionInstanceBVH construction actually
  // attempted" -- CollisionInstanceBVH.init() reads every record's worldBounds while building the
  // tree, so if construction is ever reached, this getter fires. No dependency injection needed.
  let recordsAccessed = false;
  const record = {
    fragmentId: 1,
    get worldBounds() { recordsAccessed = true; return { min: [0, 0, 0], max: [1, 1, 1] }; },
  };
  let resolveBuild;
  const buildPrimitives = () => new Promise((resolve) => { resolveBuild = resolve; });
  const cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });

  const pending = cache.getEntry(1, 1);
  cache.releaseEntryForEpoch(1); // cancel FIRST, well before buildPrimitives ever resolves
  resolveBuild([record]); // now let buildPrimitives resolve -- the continuation must bail before touching `record`
  const result = await pending;
  assert.equal(result.outcome, 'superseded');

  // Give any (buggy, unfixed) orphaned continuation a further chance to run before asserting.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recordsAccessed, false, 'BVH construction must never run once cancelled -- proves the WORK, not just the publish, was skipped');
});

test('codex-review (third pass): entry.promise exists before any synchronous re-entrant getEntry call, even one triggered from inside buildPrimitives', async () => {
  // Regression for a real bug codex-review reproduced (request 20260906-221118-19299-12386):
  // `_entries.set(loadEpoch, entry)` used to run before `entry.promise` was ever assigned (the
  // IIFE's own call expression doesn't produce a value until it hits its first await), so a
  // synchronously re-entrant call into getEntry() for the SAME loadEpoch+revision -- triggered from
  // inside buildPrimitives itself, which runs synchronously before its own returned promise is
  // awaited -- saw `existing.promise === undefined` and crashed on `undefined.outcome`.
  let cache;
  let reentrantResult;
  let reentered = false;
  const buildPrimitives = (loadEpoch) => {
    if (!reentered) {
      reentered = true;
      // Still inside the OUTER getEntry(1, 1) call's synchronous execution window -- must see a
      // real, awaitable entry.promise, not undefined.
      reentrantResult = cache.getEntry(loadEpoch, 1);
    }
    return Promise.resolve([]);
  };
  cache = new TlasCache({ buildPrimitives, checkpointPort: stubCheckpointPort() });

  const outerResult = await cache.getEntry(1, 1);
  const innerResult = await reentrantResult;
  assert.equal(outerResult.outcome, 'built');
  assert.equal(innerResult.outcome, 'shared-wait', 'the re-entrant call shares the same in-flight build via single-flight, no crash');
});
