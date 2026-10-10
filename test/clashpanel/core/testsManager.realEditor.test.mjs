// test/clashpanel/core/testsManager.realEditor.test.mjs — Task 7 check that the fake-editor contract (fakeEditor.mjs
// defaultLoad, vm.test shape, label-scope seam) matches the REAL Panel controller: the manager drives the real editor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT, MANAGER_INTENT } from '../../../clashpanel/core/intents.js';
import { createTestsManager } from '../../../clashpanel/core/testsManager.js';
import { makeHarness } from '../support/controllerHarness.mjs';

function managed() {
  const h = makeHarness();
  let ids = 0;
  const manager = createTestsManager({
    editor: h.controller, engine: h.engine, catalog: h.catalog, bridge: h.bridge, scheduler: h.scheduler,
    mintId: () => { ids += 1; return `new-${ids}`; },
  });
  return { h, manager, vm: () => manager.getViewModel().manager };
}

test('real editor: construction, Create, Open and Duplicate through the real TEST_LOAD seam', async () => {
  const { h, manager, vm } = managed();
  assert.equal(vm().activeTestId, 'test-1');
  assert.equal(manager.getViewModel().editor, h.controller.getViewModel());
  await manager.dispatch({ type: INTENT.SETUP_NAME, value: 'Walls' });
  await h.settle();
  assert.equal(vm().tests[0].name, 'Walls', 'draft sync by identity from the real vm.test');
  await manager.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.settle();
  assert.equal(vm().activeTestId, 'new-1');
  assert.equal(h.controller.getViewModel().test.testId, 'new-1');
  assert.equal(vm().live, 'Created “Clash test 2”.');
  await manager.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'test-1' });
  await h.settle();
  assert.equal(vm().activeTestId, 'test-1');
  assert.equal(h.controller.getViewModel().test.draft.name, 'Walls');
  await manager.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  assert.deepEqual(vm().tests.map((t) => t.name), ['Walls', 'Clash test 2', 'Walls copy']);
  assert.equal(h.engine.startCalls.length, 0);
  assert.deepEqual(h.engine.forbidden, []);
});

test('real editor: the label scope push is accepted, and the manager re-enters only once per scope change', async () => {
  const { h, manager, vm } = managed();
  const before = h.controller.getViewModel().version;
  await manager.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });
  await manager.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });
  await h.settle();
  assert.ok(h.controller.getViewModel().version > before);
  assert.equal(vm().tests[0].setA, 'Architecture');
  assert.equal(vm().tests[0].setB, 'Structure');
  manager.dispose();
  assert.equal(h.catalog.listenerCount(), 1, 'only the editor\'s own catalog listener remains');
});
