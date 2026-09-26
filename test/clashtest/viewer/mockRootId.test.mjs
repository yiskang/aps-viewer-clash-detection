// test/clashtest/viewer/mockRootId.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockModel } from '../../fixtures/mockInstanceTree.mjs';
import { rootedModel, bindingOf, liveCtx, cancellingCtx } from './support/models.mjs';

test('getRootId: a single-rooted mock tree reports its root dbId', () => {
  const { model } = rootedModel([{ dbId: 10, fragments: [0] }]);
  assert.equal(model.getObjectTree().getRootId(), 1);
});

test('getRootId: a multi-root mock tree refuses (no invented virtual root)', () => {
  const { model } = buildMockModel([{ dbId: 1 }, { dbId: 2 }], new Map());
  assert.throws(() => model.getObjectTree().getRootId(), /single-rooted/);
});

test('builders: bindingOf carries the model and an epoch; liveCtx counts checkpoints', async () => {
  const { model } = rootedModel([]);
  const b = bindingOf('k', model, 7);
  assert.equal(b.model, model); assert.equal(b.lease.epoch, 7); assert.equal(b.modelKey, 'k');
  const { ctx, calls } = liveCtx();
  await ctx.checkpoint(); await ctx.checkpoint();
  assert.equal(calls.n, 2);
});

test('builders: cancellingCtx throws EnumerationCancelledError after N checkpoints', async () => {
  const ctx = cancellingCtx(1);
  await ctx.checkpoint();
  assert.throws(() => ctx.checkpoint(), (e) => e.name === 'EnumerationCancelledError');
});
