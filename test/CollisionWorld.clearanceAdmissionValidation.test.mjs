import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../collision/CollisionWorld.js';

// Fixture 17: non-finite/invalid transform -> clearance-invalid-transform diagnostic, pair excluded,
// never silently dropped with zero diagnostics.
test('fixture 17: non-finite worldMatrix on a target instance -> clearance-invalid-transform diagnostic, no crash', { todo: true }, async () => {
  const world = new CollisionWorld();
  const sourceModel = /* well-formed single-fragment stub model */ null;
  const targetModel = /* single fragment with a NaN in its placement matrix -- construct via the same
    stub-model helper other CollisionWorld tests use, injecting a corrupted worldMatrix */ null;
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);

  const { pairs, statistics } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId',
  });

  assert.equal(pairs.length, 0);
  const diag = statistics.diagnostics.find((d) => d.reason === 'clearance-invalid-transform');
  assert.ok(diag, 'expected a clearance-invalid-transform diagnostic');
  assert.equal(diag.scope, 'fragment');
  assert.equal(diag.role, 'target');
});

test('singular (non-invertible) worldMatrix -> clearance-invalid-transform diagnostic', { todo: true }, async () => {
  const world = new CollisionWorld();
  const sourceModel = /* ... */ null;
  const targetModel = /* single fragment with a zero-determinant placement matrix */ null;
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);
  const { statistics } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId',
  });
  assert.ok(statistics.diagnostics.some((d) => d.reason === 'clearance-invalid-transform'));
});

test('an invalid instance is never admitted into shared placement state for a clearance call', { todo: true }, async () => {
  // Regression guard for the fix's own rationale: a subsequent, unrelated call against the same
  // models must not observe any lingering effect from the earlier invalid record (e.g. a corrupted
  // TLAS entry) -- run a second, valid clearance query against the same models afterward and assert
  // it behaves exactly as if the invalid fragment had never existed.
});
