import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelPlacementChangedError } from '../collision/index.js';

test('ModelPlacementChangedError carries modelId/loadEpoch/expectedRevision/actualRevision', () => {
  const err = new ModelPlacementChangedError({
    modelId: 7, loadEpoch: 3, expectedRevision: 2, actualRevision: 4,
  });
  assert.equal(err.name, 'ModelPlacementChangedError');
  assert.equal(err.modelId, 7);
  assert.equal(err.loadEpoch, 3);
  assert.equal(err.expectedRevision, 2);
  assert.equal(err.actualRevision, 4);
  assert.ok(err instanceof Error);
});
