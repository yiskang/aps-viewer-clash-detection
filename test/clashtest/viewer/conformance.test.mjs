// test/clashtest/viewer/conformance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnumeratorConformance } from '../../../clashtest/planning/ElementEnumerator.js';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { rootedModel, bindingOf } from './support/models.mjs';

const TREE = [
  { dbId: 10, fragments: [0, 1], children: [{ dbId: 11, fragments: [2] }] },
  { dbId: 20, children: [{ dbId: 21, fragments: [3] }] },
  { dbId: 30 },
];
const binding = bindingOf('k', rootedModel(TREE).model);

test('the adapter passes the core conformance helper for whole and explicit scopes', async () => {
  const { failures } = await checkEnumeratorConformance({
    enumerator: createViewerElementEnumerator(), binding,
    cases: { scopes: [
      { name: 'whole', scope: 'whole' },
      { name: 'one-root', scope: { dbIds: [10] } },
      { name: 'two-roots', scope: { dbIds: [10, 21] } },
      { name: 'unresolved', scope: { dbIds: [999, 20] } },
      { name: 'ancestor-descendant', scope: { dbIds: [10, 11] } },     // Codex C1: digestScope must normalize like resolveRoots
      { name: 'no-fragments', scope: { dbIds: [30] } },
      { name: 'unsorted-duplicated', scope: { dbIds: [21, 10, 21] } },
    ] },
    checkpoint: () => {},
  });
  assert.deepEqual(failures, []);
});
