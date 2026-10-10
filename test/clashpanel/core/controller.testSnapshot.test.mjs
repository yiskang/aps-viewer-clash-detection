// test/clashpanel/core/controller.testSnapshot.test.mjs — spec §26.2 (b): the editor's read-only vm.test snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, makeSet, hardResults } from '../support/controllerHarness.mjs';
import { INTENT } from '../../../clashpanel/core/intents.js';

const PENDING = { state: 'pending', timedOut: true, attempt: 1 };

test('vm.test mirrors the editor: testId, frozen draft (identity), runActive, heldUnsaved, pendingConfirm, lastRun', async () => {
  const h = makeHarness();
  const t0 = h.vm().test;
  assert.deepEqual(Object.keys(t0).sort(), ['draft', 'heldUnsaved', 'lastRun', 'pendingConfirm', 'runActive', 'testId']);
  assert.equal(t0.testId, 'test-1');
  assert.equal(t0.draft.testId, 'test-1');
  assert.equal(t0.lastRun, null);
  await h.dispatch({ type: INTENT.SETUP_NAME, value: 'Walls' });
  assert.equal(h.vm().test.draft.name, 'Walls');
  assert.ok(Object.isFrozen(h.vm().test.draft));
  await h.readyHard();
  const handle = await h.start();
  assert.equal(h.vm().test.runActive, true);
  handle.finish({ status: 'completed', resultSet: makeSet({ runId: handle.runId, results: hardResults(2) }), persistence: PENDING });
  await h.settle();
  const t = h.vm().test;
  assert.equal(t.runActive, false);
  assert.equal(t.heldUnsaved, true);
  assert.equal(t.lastRun.runId, handle.runId);
  assert.equal(t.lastRun.status, 'completed');
  assert.equal(t.lastRun.resultCount, 2);
  assert.equal(t.lastRun.definitionKey, t.draft.lastRun.definitionKey);
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  assert.equal(h.vm().test.pendingConfirm, true);
});

test('the seal notification itself already carries lastRun (captured before any retirement, §26.2a step 2)', async () => {
  const h = makeHarness();
  await h.readyHard();
  const seen = [];
  h.controller.subscribe((vm) => { if (vm.run.state === 'done') seen.push(vm.test.lastRun); });
  const handle = await h.start();
  handle.finish({ status: 'completed', resultSet: makeSet({ runId: handle.runId, results: hardResults(1) }) });
  await h.settle();
  assert.ok(seen.length >= 1);
  assert.equal(seen[0].runId, handle.runId);
});

test('standalone New test clears lastRun: a fresh testId never reports the previous test\'s run (Codex plan review C2)', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(makeSet({ runId: 'run-1', results: hardResults(2) }), { status: 'completed' });
  assert.notEqual(h.vm().test.lastRun, null);
  await h.dispatch({ type: INTENT.SETUP_NEW_TEST });
  assert.equal(h.vm().test.testId, 'test-2');
  assert.equal(h.vm().test.lastRun, null);
});

test('lastRun survives Clear results and an admission failure (summary kept, §26.4/§26.7)', async () => {
  const h = makeHarness();
  await h.readyHard();
  const handle = await h.runToDone(makeSet({ runId: 'run-1', results: hardResults(2) }), { status: 'completed' });
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  assert.equal(h.vm().test.lastRun.runId, handle.runId);
  h.engine.failNextStart(new Error('admission refused'));
  await h.dispatch({ type: INTENT.RUN_START });
  assert.equal(h.vm().test.lastRun.runId, handle.runId);
});
