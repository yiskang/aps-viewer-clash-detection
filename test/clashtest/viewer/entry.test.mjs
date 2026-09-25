// test/clashtest/viewer/entry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as viewer from '../../../clashtest/viewer/index.js';
import * as core from '../../../clashtest/index.js';

test('entry point exports exactly the adapter surface', () => {
  assert.deepEqual(Object.keys(viewer).sort(), ['createViewerElementEnumerator', 'wireModelUnload']);
});

test('the core barrel is unchanged: it exports nothing named after the viewer layer', () => {
  assert.ok(!Object.keys(core).some((k) => /viewer/i.test(k)));
});

test('the enumerator is frozen and has exactly the port methods', () => {
  const e = viewer.createViewerElementEnumerator();
  assert.deepEqual(Object.keys(e).sort(), ['digestScope', 'resolveRoots']);
  assert.ok(Object.isFrozen(e));
});
