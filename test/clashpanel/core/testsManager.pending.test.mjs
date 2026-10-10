// test/clashpanel/core/testsManager.pending.test.mjs — spec §26.2a pending operation, §26.7 Delete/Reset, AC-M8/M9/M15/M18.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT, MANAGER_INTENT } from '../../../clashpanel/core/intents.js';
import { makeManagerHarness, lastRunOf } from '../support/fakeEditor.mjs';

const loads = (h) => h.editor.dispatched.filter((i) => i.type === INTENT.TEST_LOAD);
const held = (h, runId = 'run-1') => h.editor.set({ heldUnsaved: true, lastRun: lastRunOf(runId, 2) }, { runPatch: { state: 'done' } });
const confirm = (h) => h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: h.vm().confirm.operationId });

test('confirming a switch loads with acknowledgeUnsaved:true; cancelling changes nothing (AC-M2, AC-M15)', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  held(h);
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  await h.dispatch({ type: MANAGER_INTENT.CANCEL, operationId: h.vm().confirm.operationId });
  assert.equal(h.vm().pending, null);
  assert.equal(loads(h).length, 0);
  assert.equal(h.vm().activeTestId, 'test-1');
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  await confirm(h);
  assert.equal(loads(h).length, 1);
  assert.equal(loads(h)[0].acknowledgeUnsaved, true);
  assert.equal(h.vm().activeTestId, 'new-1');
  assert.equal(h.row('test-1').status.text, 'Completed — 2 clashes reported', 'outgoing summary captured before the retirement');
});

test('AC-M18: stale operationIds are ignored; a second action while one is pending is ignored', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  held(h);
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  const op1 = h.vm().confirm.operationId;
  await h.dispatch({ type: MANAGER_INTENT.CANCEL, operationId: op1 });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'new-1' });
  const op2 = h.vm().confirm.operationId;
  assert.notEqual(op2, op1);
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op1 });
  assert.equal(h.vm().pending.operationId, op2, 'stale confirm ignored');
  assert.equal(h.vm().count, 2);
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  await h.dispatch({ type: MANAGER_INTENT.CANCEL, operationId: 'op-999' });
  assert.equal(h.vm().pending.operationId, op2, 'other actions and unknown ids ignored while pending');
});

test('Review Focus 1: a double click (two identical actions in one tick) starts exactly one operation', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await Promise.all([h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' }), h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' })]);
  assert.equal(loads(h).length, 1);
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  const op = h.vm().confirm.operationId;
  await Promise.all([h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op }), h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op })]);
  assert.equal(h.vm().count, 1);
});

test('AC-M18: a confirm after the editor changed is re-checked — run started → refused; results became unsaved → re-prompted', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  const op = h.vm().confirm.operationId;
  h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: null } });
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op });
  assert.equal(h.vm().pending, null);
  assert.equal(h.vm().notice, 'Stop the running test first.');
  assert.equal(h.vm().count, 1);
  assert.equal(loads(h).length, 0);

  h.editor.set({ runActive: false }, { runPatch: { state: 'idle' } });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  const op2 = h.vm().confirm.operationId;
  assert.doesNotMatch(h.vm().confirm.text, /unsaved/);
  held(h);
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op2 });
  const vm = h.vm();
  assert.notEqual(vm.confirm.operationId, op2, 're-prompted as a new operation');
  assert.match(vm.confirm.text, /Its unsaved results are discarded too\.$/);
  assert.equal(vm.notice, 'The test changed while you were confirming — please confirm again.');
  assert.equal(loads(h).length, 0, 'never executed with outdated consent');
});

test('manager actions are disabled while the editor confirmation is pending; CONFIRM_CANCEL is forwarded', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  const op = h.vm().confirm.operationId;
  h.editor.set({ pendingConfirm: true });
  assert.equal(h.vm().confirm.enabled, false);
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op });
  assert.equal(h.vm().pending.operationId, op, 'not executed while the editor asks');
  await h.dispatch({ type: INTENT.CONFIRM_CANCEL });
  assert.equal(h.editor.test.pendingConfirm, false);
  await h.dispatch({ type: MANAGER_INTENT.CANCEL, operationId: op });
  h.editor.set({ pendingConfirm: true });
  assert.deepEqual(h.vm().create, { enabled: false, reason: 'Answer the pending confirmation in the test editor first.' });
});

test('AC-M8: Delete always confirms; a non-active delete removes only that record; the counter is never reused', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  const c = h.vm().confirm;
  assert.equal(c.text, 'Delete “Clash test 1”? Its setup and results are discarded for this session and can\'t be recovered.');
  assert.equal(c.confirmLabel, 'Delete test');
  await confirm(h);
  assert.deepEqual(h.vm().tests.map((t) => t.name), ['Clash test 2']);
  assert.equal(h.vm().live, 'Deleted “Clash test 1” for this session.');
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.vm().tests.at(-1).name, 'Clash test 3');
});

test('AC-M8: deleting the active test activates the next record, else the previous, and returns to the list', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  await confirm(h);
  assert.equal(h.vm().activeTestId, 'new-1');
  assert.equal(h.vm().view, 'list');
  assert.deepEqual(h.vm().tests.map((t) => t.testId), ['new-1', 'new-2']);
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-2' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'new-2' });
  await confirm(h);
  assert.equal(h.vm().activeTestId, 'new-1');
});

test('AC-M8 / CTM-5: deleting the last test leaves exactly one fresh active "Clash test <N>"', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  await confirm(h);
  const vm = h.vm();
  assert.equal(vm.count, 1);
  assert.equal(vm.activeTestId, 'new-1');
  assert.equal(vm.tests[0].name, 'Clash test 2');
});

test('deleting the active test with unsaved results: ONE prompt that states the discard and is the acknowledgement', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  held(h);
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  assert.match(h.vm().confirm.text, /Its unsaved results are discarded too\.$/);
  await confirm(h);
  assert.equal(loads(h).at(-1).acknowledgeUnsaved, true);
  assert.equal(h.vm().count, 1);
  assert.equal(h.vm().confirm, null, 'never a second prompt');
});

test('deleting the last test with a colliding minted id is refused: nothing is deleted (Codex plan review I3)', async () => {
  const h = makeManagerHarness({ mintId: () => 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  assert.equal(h.vm().pending, null);
  assert.equal(h.vm().count, 1);
  assert.equal(h.vm().notice, 'A new test id could not be created; nothing was changed.');
});

test('deleting a running test is impossible', async () => {
  const h = makeManagerHarness();
  h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: null } });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  assert.equal(h.vm().pending, null);
  assert.equal(h.vm().tests[0].actions.delete.enabled, false);
});

test('AC-M9: Reset of a non-active test drops only its summary, with no prompt, keeping testId and draft', async () => {
  const h = makeManagerHarness();
  h.editor.set({ lastRun: lastRunOf('run-1', 2) }, { runPatch: { state: 'done' } });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.row('test-1').resultsText, 'Results not held — open and re-run to view');
  await h.dispatch({ type: MANAGER_INTENT.RESET, testId: 'test-1' });
  assert.equal(h.vm().confirm, null);
  assert.deepEqual(h.row('test-1').status, { kind: 'not-run', text: 'Not run' });
  assert.equal(h.row('test-1').name, 'Clash test 1');
  assert.equal(h.vm().live, 'Reset the results of “Clash test 1”.');
});

test('AC-M9/AC-M15: Reset of the active test with unsaved results confirms once, uses the existing Clear path, stays reset', async () => {
  const h = makeManagerHarness();
  held(h);
  await h.dispatch({ type: MANAGER_INTENT.RESET, testId: 'test-1' });
  assert.match(h.vm().confirm.text, /Resetting discards them/);
  await confirm(h);
  assert.deepEqual(h.editor.dispatched.map((i) => i.type).slice(-2), [INTENT.RESULTS_CLEAR, INTENT.RESULTS_CLEAR_CONFIRMED]);
  assert.deepEqual(h.row('test-1').status, { kind: 'not-run', text: 'Not run' });
  h.editor.set({});
  assert.deepEqual(h.row('test-1').status, { kind: 'not-run', text: 'Not run' }, 'the reset run is never re-reduced');
});
