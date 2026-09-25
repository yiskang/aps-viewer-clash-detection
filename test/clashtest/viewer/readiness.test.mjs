// test/clashtest/viewer/readiness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awaitObjectTree } from '../../../clashtest/viewer/readiness.js';
import { rootedModel, liveCtx, cancellingCtx } from './support/models.mjs';

const named = (e, name) => e && e.name === name;

test('ready fast path: returns the tree, calls no getObjectTree callback wait', async () => {
  const { model, stats } = rootedModel([{ dbId: 10, fragments: [0] }]);
  const { ctx, calls } = liveCtx();
  const { tree, fragList } = await awaitObjectTree(model, ctx);
  assert.equal(typeof tree.enumNodeChildren, 'function');
  assert.equal(typeof fragList.getCount, 'function');
  assert.equal(stats.getObjectTreeWithCallbacksCalls, 0);
  assert.ok(calls.n >= 1, 'a checkpoint runs BEFORE the model is read');
});

test('checkpoint runs before the first model read (liveness discipline)', async () => {
  const { model } = rootedModel([]);
  const order = [];
  const probe = { ...model, isObjectTreeCreated() { order.push('read'); return true; } };
  await awaitObjectTree(probe, { checkpoint() { order.push('cp'); } });
  assert.deepEqual(order.slice(0, 2), ['cp', 'read']);
});

test('not ready: waits for getObjectTree success, then returns the tree', async () => {
  let fire;
  const { model } = rootedModel([{ dbId: 10, fragments: [0] }], {
    objectTreeReady: false,
    settleObjectTree: (ok) => { fire = ok; },
  });
  const p = awaitObjectTree(model, liveCtx().ctx, { scheduleTimeout: () => 0, clearScheduled: () => {} });
  fire();
  const { tree } = await p;
  assert.equal(tree.getRootId(), 1);
});

test('getObjectTree onError => ObjectTreeUnavailableError carrying the Viewer cause', async () => {
  const cause = new Error('boom');
  const { model } = rootedModel([], { objectTreeReady: false, settleObjectTree: (_ok, err) => err(cause) });
  await assert.rejects(
    awaitObjectTree(model, liveCtx().ctx, { scheduleTimeout: () => 0, clearScheduled: () => {} }),
    (e) => named(e, 'ObjectTreeUnavailableError') && e.cause === cause);
});

test('ready-but-absent tree, and a model with no tree accessor, both fail (never a partial list)', async () => {
  const { model } = rootedModel([]);
  const noTree = { ...model, getObjectTree: () => null };
  await assert.rejects(awaitObjectTree(noTree, liveCtx().ctx), (e) => named(e, 'ObjectTreeUnavailableError'));
  const bare = { id: 'x', isObjectTreeCreated: () => false };
  await assert.rejects(awaitObjectTree(bare, liveCtx().ctx), (e) => named(e, 'ObjectTreeUnavailableError'));
  const notATree = { ...model, getObjectTree: () => ({}) };
  await assert.rejects(awaitObjectTree(notATree, liveCtx().ctx), (e) => named(e, 'ObjectTreeUnavailableError'));
});

test('cancellation while waiting is honored by polling ctx.checkpoint (no hang)', async () => {
  const { model } = rootedModel([], { objectTreeReady: false, settleObjectTree: () => {} }); // never settles
  const timers = [];
  const scheduleTimeout = (fn) => { timers.push(fn); return timers.length; };
  const p = awaitObjectTree(model, cancellingCtx(1), { scheduleTimeout, clearScheduled: () => {} });
  // first poll: checkpoint #2 throws
  while (timers.length === 0) await new Promise((r) => setImmediate(r));
  timers.shift()();
  await assert.rejects(p, (e) => named(e, 'EnumerationCancelledError'));
});

test('a synchronous checkpoint throw before any read propagates unwrapped', async () => {
  const { model } = rootedModel([]);
  await assert.rejects(awaitObjectTree(model, cancellingCtx(0)), (e) => named(e, 'EnumerationCancelledError'));
});

test('Review Focus 9 (C2): an undefined-returning checkpoint is followed by EVERY model read (readiness, tree, fragment list) IN THE SAME TICK', async () => {
  const { model } = rootedModel([{ dbId: 10, fragments: [0] }]);
  const order = [];
  queueMicrotask(() => order.push('microtask'));               // an unload could land here if a microtask boundary existed
  const probe = {
    ...model,
    isObjectTreeCreated() { order.push('ready?'); return true; },
    getObjectTree: (...a) => { order.push('tree'); return model.getObjectTree(...a); },
    getFragmentList: () => { order.push('frags'); return model.getFragmentList(); },
  };
  await awaitObjectTree(probe, { checkpoint() { order.push('cp'); } });        // checkpoint returns undefined synchronously
  assert.deepEqual(order.slice(0, 5), ['cp', 'ready?', 'tree', 'frags', 'microtask']);
});

test('Review Focus 9 (I1): a fresh checkpoint runs between readiness success and the final tree read', async () => {
  // readiness succeeds immediately; the run is cancelled at the SECOND checkpoint (entry = 1st, post-wait = 2nd)
  const { model } = rootedModel([], { objectTreeReady: false });      // default settle: onSuccess synchronously
  const reads = [];
  const probe = { ...model, getObjectTree: (ok, err) => { reads.push(ok ? 'wait' : 'final-read'); return model.getObjectTree(ok, err); } };
  await assert.rejects(
    awaitObjectTree(probe, cancellingCtx(1), { scheduleTimeout: () => 0, clearScheduled: () => {} }),
    (e) => named(e, 'EnumerationCancelledError'));
  assert.deepEqual(reads, ['wait']);                                  // the final no-arg getObjectTree() never ran
});
