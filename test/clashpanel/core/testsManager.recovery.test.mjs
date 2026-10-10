// test/clashpanel/core/testsManager.recovery.test.mjs — independent Work review M1; spec §26.2a divergence recovery,
// §26.9 fault, AC-M16; Review Focus 4, 5 and 6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT, MANAGER_INTENT } from '../../../clashpanel/core/intents.js';
import { createDraft, draftReduce } from '../../../clashpanel/core/draft.js';
import { MANAGER_TEXT, lockedEditorVm } from '../../../clashpanel/core/managerViewModel.js';
import { FAULT_POLICY } from '../../../clashpanel/core/testsManager.js';
import { makeManagerHarness, defaultLoad, lastRunOf } from '../support/fakeEditor.mjs';
import { FAULT_CONTROLS, NON_USER_FACING, faultCases } from '../support/faultControls.mjs';

const loads = (h) => h.editor.dispatched.filter((i) => i.type === INTENT.TEST_LOAD);
const rogue = () => createDraft({ testId: 'rogue', testNumber: 99 });
const ok = (testId) => ({ ok: true, testId, version: 1, releaseStuck: false });
/** A manager driven into the terminal fault: a divergent Create load, then a refused compensation. */
async function faulted() {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => { editor.set({ testId: 'rogue', draft: rogue() }); return ok(intent.testId); });
  h.editor.scriptLoad((intent, editor) => ({ ok: false, testId: editor.test.testId, version: 2, releaseStuck: false, reason: 'unsaved-results' }));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.deepEqual(h.vm().fault, { text: MANAGER_TEXT.FAULT });
  return h;
}
// Work plan review M2: the expected allow-list, written out independently of the implementation's table.
const FAULT_ALLOWED = [
  INTENT.FILTER_TEXT, INTENT.FILTER_MODEL, INTENT.FILTER_MAX_GAP, INTENT.FILTER_UNVERIFIED, INTENT.FILTER_HAS_LOCATION,
  INTENT.FILTER_ELEMENT, INTENT.FILTER_CLEAR, INTENT.GROUP_MODE, INTENT.GROUP_TOGGLE, INTENT.SORT_SET, INTENT.NAV_PAGE,
  INTENT.SETUP_TOGGLE_COLLAPSED, INTENT.ACTION_FOCUS_ON_SELECT, INTENT.RUN_STOP, INTENT.RESULTS_CLEAR,
  INTENT.RESULTS_CLEAR_CONFIRMED, INTENT.CONFIRM_CANCEL, INTENT.PANEL_HIDDEN, INTENT.PANEL_SHOWN, INTENT.DIAGNOSTICS_COPY,
];

test('M1 notification-first: a mismatched notification during a load starts ONE recovery; the activation compensates once', async () => {
  const h = makeManagerHarness();
  const initial = h.editor.test.draft;
  h.editor.scriptLoad((intent, editor) => { editor.set({ testId: 'rogue', draft: rogue() }); return ok(intent.testId); });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  const l = loads(h);
  assert.equal(l.length, 2, 'the Create load + exactly one compensating load');
  assert.equal(l[1].testId, 'test-1');
  assert.equal(l[1].draft, initial, 'the committed source record\'s snapshotted draft');
  assert.equal(l[1].acknowledgeUnsaved, false);
  const vm = h.vm();
  assert.equal(vm.activeTestId, 'test-1');
  assert.equal(vm.fault, null);
  assert.equal(vm.notice, 'The test editor was restored to “Clash test 1”.');
  assert.equal(vm.count, 1, 'the Create record is rolled back');
  assert.equal(h.editor.test.testId, 'test-1');
});

test('M1 result-first: an ok result naming another testId (no notification) starts ONE compensation', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad(() => ok('rogue'));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 2);
  assert.equal(h.vm().activeTestId, 'test-1');
  assert.equal(h.vm().fault, null);
});

test('M1: a refusal naming another testId is a divergence, not a plain failure', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad(() => ({ ok: false, testId: 'rogue', version: 1, releaseStuck: false, reason: 'run-active' }));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 2);
});

test('M1 duplicate signals: two mismatched notifications AND a mismatched result yield exactly one compensation', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => {
    editor.set({ testId: 'rogue', draft: rogue() });
    editor.set({ testId: 'rogue2', draft: rogue() });
    return ok('rogue');
  });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 2);
  assert.equal(h.vm().fault, null);
});

test('M1 spontaneous divergence: no activation in flight → one scheduled compensation; a disagreeing id never syncs', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });           // new-1, not active
  const hijack = draftReduce(createDraft({ testId: 'new-1' }), { type: 'name', value: 'Hijacked' });
  h.editor.set({ testId: 'new-1', draft: hijack });
  h.editor.set({ testId: 'new-1', draft: hijack });                                 // a second signal, same divergence
  assert.equal(h.row('new-1').name, 'Clash test 1 copy');
  await h.settle();
  assert.equal(loads(h).length, 1, 'one compensating load');
  assert.equal(h.vm().activeTestId, 'test-1');
  assert.equal(h.row('new-1').name, 'Clash test 1 copy');
  assert.equal(h.editor.test.testId, 'test-1');
});

test('M1 compensation failure → terminal fault: manager + editor run/edit actions disabled; Clear, Stop and views stay', async () => {
  const h = await faulted();
  const vm = h.vm();
  assert.deepEqual(vm.fault, { text: MANAGER_TEXT.FAULT });
  assert.ok(h.editor.dispatched.some((i) => i.type === INTENT.CONFIRM_CANCEL), 'M2: a pre-fault editor confirmation is dropped on entry');
  assert.deepEqual(vm.create, { enabled: false, reason: MANAGER_TEXT.FAULT });
  assert.ok(vm.tests.every((t) => Object.values(t.actions).every((a) => !a.enabled)));
  assert.deepEqual(vm.editorLock, { enabled: false, reason: MANAGER_TEXT.FAULT });
  const composite = h.manager.getViewModel().editor;
  assert.equal(composite.run.canRun, false, 'headless consumers see Run disabled (§26.9)');
  assert.deepEqual(composite.run.locked, { enabled: false, reason: MANAGER_TEXT.FAULT });
  const n = h.editor.dispatched.length;
  for (const type of [INTENT.SETUP_NAME, INTENT.SETUP_NEW_TEST, INTENT.RUN_START, INTENT.RUN_RELEASE_AND_RETRY]) await h.dispatch({ type, value: 'x' });
  assert.equal(h.editor.dispatched.length, n, 'run/edit intents blocked');
  for (const type of [INTENT.NAV_SELECT, INTENT.NAV_NEXT, INTENT.ACTION_FOCUS, INTENT.ACTION_ISOLATE, INTENT.ACTION_MARKERS, INTENT.ACTION_BACK_TO_ALL]) {
    await h.dispatch({ type, value: true, resultId: 'r0', groupId: null });
  }
  assert.equal(h.editor.dispatched.length, n, 'M2: Viewer-mutating result actions blocked');
  for (const type of [INTENT.RESULTS_CLEAR, INTENT.RUN_STOP, INTENT.PANEL_HIDDEN]) await h.dispatch({ type });
  assert.deepEqual(h.editor.dispatched.slice(n).map((i) => i.type), [INTENT.RESULTS_CLEAR, INTENT.RUN_STOP, INTENT.PANEL_HIDDEN]);
  await h.dispatch({ type: MANAGER_INTENT.VIEW_LIST });
  assert.equal(h.vm().view, 'list');
  h.editor.set({ draft: rogue() });
  assert.ok(h.vm().tests.every((t) => t.name !== 'Clash test 99'), 'no draft synced by a disagreeing id');
  assert.equal(loads(h).length, 2, 'no further compensation after the fault');
});

test('M2: FAULT_POLICY classifies EVERY editor INTENT exactly once — a new, unclassified intent fails this test', () => {
  assert.ok(Object.isFrozen(FAULT_POLICY));
  assert.deepEqual(Object.keys(FAULT_POLICY).sort(), Object.values(INTENT).sort(), 'exactly the INTENT values, no more, no fewer');
  for (const [type, policy] of Object.entries(FAULT_POLICY)) assert.ok(policy === 'allow' || policy === 'block', type);
  assert.deepEqual(Object.keys(FAULT_POLICY).filter((t) => FAULT_POLICY[t] === 'allow').sort(), [...FAULT_ALLOWED].sort());
});

test('M2: while faulted exactly the allow-listed intents reach the editor; every other intent is dropped', async () => {
  const h = await faulted();
  for (const type of Object.values(INTENT)) {
    const n = h.editor.dispatched.length;
    await h.dispatch({ type, value: false, resultId: 'r0', groupId: null, page: 0 });
    assert.equal(h.editor.dispatched.length === n + 1, FAULT_ALLOWED.includes(type), `${type} (${FAULT_POLICY[type]})`);
  }
  assert.equal(loads(h).length, 2, 'no load and no compensation is reachable from the fault');
});

test('re-review M1 guard: every INTENT is mapped to a control in FAULT_CONTROLS or declared in NON_USER_FACING — exactly once', () => {
  const mapped = Object.keys(FAULT_CONTROLS);
  const declared = Object.keys(NON_USER_FACING);
  assert.deepEqual([...mapped, ...declared].sort(), Object.values(INTENT).sort(), 'a new INTENT fails until it is mapped or declared');
  assert.equal(new Set([...mapped, ...declared]).size, mapped.length + declared.length, 'no intent is both mapped and declared');
  for (const [type, c] of Object.entries(FAULT_CONTROLS)) {
    assert.ok(typeof c.gate === 'function' && c.dom.length > 0, type);
    if (c.variant) assert.ok(typeof c.variant.gate === 'function' && c.variant.dom.length > 0, `${type} variant`);
  }
});

test('re-review M1 (VM): the fault overlay disables with the fault reason EXACTLY the user-facing controls FAULT_POLICY blocks; allowed ones are unchanged', () => {
  const blocked = Object.keys(FAULT_CONTROLS).filter((t) => FAULT_POLICY[t] !== 'allow');
  assert.deepEqual(blocked.sort(), [INTENT.SETUP_NAME, INTENT.SETUP_MODE, INTENT.SETUP_CLEARANCE, INTENT.SETUP_BASIS, INTENT.SETUP_TOGGLE_MODEL,
    INTENT.SETUP_USE_SELECTION, INTENT.SETUP_SELF_CLASH, INTENT.SETUP_NEW_TEST, INTENT.RUN_START, INTENT.RUN_RELEASE_AND_RETRY,
    INTENT.NAV_SELECT, INTENT.NAV_PREV, INTENT.NAV_NEXT, INTENT.ACTION_FOCUS, INTENT.ACTION_ISOLATE, INTENT.ACTION_MARKERS,
    INTENT.ACTION_BACK_TO_ALL].sort(), 'the 17 user-facing blocked intents (19 blocked − TEST_LOAD − TEST_LABEL_SCOPE)');
  for (const { name, vm: ed, controls } of faultCases()) {
    const before = JSON.stringify(ed);
    const locked = lockedEditorVm(ed, MANAGER_TEXT.FAULT, FAULT_POLICY);
    for (const [type, c] of Object.entries(controls)) {
      if (FAULT_POLICY[type] === 'allow') {
        assert.deepEqual(c.gate(locked), c.gate(ed), `${name} ${type}: allowed — the overlay leaves its control unchanged`);
      } else {
        assert.notEqual(c.gate(ed)?.enabled, false, `${name} ${type}: enabled in the fixture before the fault (non-vacuous)`);
        assert.equal(c.gate(locked)?.enabled, false, `${name} ${type}: blocked — disabled while faulted`);
        assert.equal(c.gate(locked).reason, MANAGER_TEXT.FAULT, `${name} ${type}: exposes the terminal-fault reason`);
      }
    }
    assert.equal(JSON.stringify(ed), before, `${name}: the editor ViewModel is never written (copy/overlay only)`);
  }
});

test('re-review M1 (wiring): no overlay unless faulted — the editor ViewModel itself; while faulted exactly lockedEditorVm(editor VM, FAULT, FAULT_POLICY)', async () => {
  const clean = makeManagerHarness();
  assert.equal(clean.manager.getViewModel().editor, clean.editor.getViewModel(), 'not faulted: identity, no copy, no change');
  const h = await faulted();
  const own = h.editor.getViewModel();
  const snapshot = JSON.stringify(own);
  const composite = h.manager.getViewModel().editor;
  assert.notEqual(composite, own);
  assert.deepEqual(composite, lockedEditorVm(own, MANAGER_TEXT.FAULT, FAULT_POLICY));
  assert.equal(h.editor.getViewModel(), own, 'the overlay makes the editor publish nothing');
  assert.equal(JSON.stringify(own), snapshot, 'and never writes the editor\'s ViewModel');
});

test('AC-M16: a Create whose activation fails or diverges leaves no record; the counter is never decremented', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => ({ ok: false, testId: editor.test.testId, version: 1, releaseStuck: false, reason: 'run-active' }));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  h.editor.scriptLoad(() => ok('rogue'));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.vm().count, 1);
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.vm().tests.at(-1).name, 'Clash test 4');
});

test('manager actions are disabled while a compensation is in flight', async () => {
  const h = makeManagerHarness();
  let release;
  h.editor.scriptLoad(() => ok('rogue'));
  h.editor.scriptLoad((intent, editor) => new Promise((resolve) => { release = () => resolve(defaultLoad(intent, editor)); }));
  const done = h.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.settle();
  assert.deepEqual(h.vm().create, { enabled: false, reason: MANAGER_TEXT.BUSY });
  release();
  await done;
  assert.deepEqual(h.vm().create, { enabled: true, reason: null });
});

test('Review Focus 4: a late same-target notification between the load result and the commit is not a divergence', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => { const r = defaultLoad(intent, editor); queueMicrotask(() => editor.set({})); return r; });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 1);
  assert.equal(h.vm().activeTestId, 'new-1');
  assert.equal(h.vm().notice, null);
});

test('Review Focus 5: disposing during an in-flight activation never commits, notifies or throws', async () => {
  const h = makeManagerHarness();
  let finish;
  h.editor.scriptLoad((intent, editor) => new Promise((resolve) => { finish = () => resolve(defaultLoad(intent, editor)); }));
  const seen = [];
  h.manager.subscribe((vm) => seen.push(vm));
  const pending = h.dispatch({ type: MANAGER_INTENT.CREATE });
  h.manager.dispose();
  const n = seen.length;
  finish();
  await pending;
  assert.equal(seen.length, n);
  assert.equal(h.vm().count, 0);
});

// ── Controller amendments to the Task 9 dispatch (additive to the plan's tests) ─────────────────────────────────────

const confirmOp = (h) => h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: h.vm().confirm.operationId });
/** Make the editor's getViewModel throw on its `nth` call from now (1-based), once; every other call is normal. */
function throwOnRead(h, nth) {
  const original = h.editor.getViewModel;
  let calls = 0;
  h.editor.getViewModel = () => {
    calls += 1;
    if (calls === nth) throw new Error(`editor read #${nth} failure`);
    return original();
  };
  return () => { h.editor.getViewModel = original; };
}

test('amendment 1: an unreadable post-load re-read is a divergence — ONE compensation, never a plain failure, never stuck', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => {
    const result = defaultLoad(intent, editor);                    // the editor really loaded new-1 …
    const original = editor.getViewModel;
    editor.getViewModel = () => { editor.getViewModel = original; throw new Error('editor re-read failure'); };   // … but cannot be read once
    return result;
  });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });                 // resolves; never rejects
  const l = loads(h);
  assert.equal(l.length, 2, 'the Create load + exactly one compensating load');
  assert.equal(l[1].testId, 'test-1');
  const vm = h.vm();
  assert.equal(vm.activeTestId, 'test-1');
  assert.equal(h.editor.test.testId, 'test-1', 'the editor is back on the committed test');
  assert.equal(vm.notice, 'The test editor was restored to “Clash test 1”.');
  assert.equal(vm.count, 1);
  assert.equal(vm.fault, null);
  assert.deepEqual(vm.create, { enabled: true, reason: null }, 'no activation or recovery left set');
});

test('amendment 3 (AC-M16): a Create whose outgoing snapshot read throws leaves no record and the dispatch resolves', async () => {
  const h = makeManagerHarness();
  throwOnRead(h, 2);                                                // #1 request()'s snapshot, #2 activate()'s snapshot
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.settle();
  const vm = h.vm();
  assert.deepEqual(vm.tests.map((t) => t.testId), ['test-1'], 'the fresh record is removed');
  assert.equal(vm.activeTestId, 'test-1');
  assert.equal(vm.pending, null);
  assert.equal(vm.fault, null);
  assert.deepEqual(vm.create, { enabled: true, reason: null });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.vm().tests.at(-1).name, 'Clash test 3', 'the counter is never decremented');
});

test('amendment 2: an unreadable editor at request time never rejects the caller and starts ONE recovery', async () => {
  const h = makeManagerHarness();
  throwOnRead(h, 1);
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.settle();
  const vm = h.vm();
  assert.equal(vm.count, 1);
  assert.equal(vm.pending, null);
  assert.equal(loads(h).length, 1, 'no Create load; exactly one compensating load of the committed test');
  assert.equal(loads(h)[0].testId, 'test-1');
  assert.equal(vm.fault, null);
});

test('amendment 2: an unreadable editor on CONFIRM drops the consent, recovers once and never rejects', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  const op = h.vm().confirm.operationId;
  throwOnRead(h, 1);
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op });
  await h.settle();
  assert.equal(h.vm().pending, null);
  assert.equal(h.vm().count, 2, 'nothing deleted on unverifiable consent');
  assert.equal(loads(h).length, 1, 'one compensating load');
  assert.equal(h.vm().fault, null);
});

test('amendment 2: a Reset whose editor Clear path throws keeps the summary, never rejects and recovers once', async () => {
  for (const mode of ['sync', 'reject']) {
    const h = makeManagerHarness();
    h.editor.set({ lastRun: lastRunOf('run-1', 2) }, { runPatch: { state: 'done' } });
    const original = h.editor.dispatch;
    h.editor.dispatch = (intent) => {
      if (intent.type === INTENT.RESULTS_CLEAR) {
        if (mode === 'sync') throw new Error('clear failure');
        return Promise.reject(new Error('clear failure'));
      }
      return original(intent);
    };
    await h.dispatch({ type: MANAGER_INTENT.RESET, testId: 'test-1' });
    await h.settle();
    assert.equal(h.row('test-1').status.text, 'Completed — 2 clashes reported', `${mode}: the summary is kept`);
    assert.equal(h.vm().pending, null, mode);
    assert.equal(loads(h).length, 1, `${mode}: one compensating load`);
  }
});

test('amendment 2: a compensation whose re-read throws is terminal (fault), never a rejection', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad(() => ok('rogue'));
  h.editor.scriptLoad((intent, editor) => {
    const result = defaultLoad(intent, editor);
    const original = editor.getViewModel;
    editor.getViewModel = () => { editor.getViewModel = original; throw new Error('compensation re-read failure'); };
    return result;
  });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.deepEqual(h.vm().fault, { text: MANAGER_TEXT.FAULT });
  assert.equal(h.vm().pending, null);
});

test('amendment 2: a synchronous throw inside a manager handler resolves undefined instead of throwing', async () => {
  const h = makeManagerHarness();
  const hostile = { type: MANAGER_INTENT.OPEN, get testId() { throw new Error('hostile intent'); } };
  let out;
  assert.doesNotThrow(() => { out = h.manager.dispatch(hostile); });
  assert.equal(await out, undefined);
});

test('amendment 4: the commit needs the editor to AGREE — an ok result for the target while the editor holds another id compensates', async () => {
  const h = makeManagerHarness();
  // No notification (notify:false) and an ok result naming the target: only the editor re-read disagrees.
  h.editor.scriptLoad((intent, editor) => { editor.set({ testId: 'rogue', draft: rogue() }, { notify: false }); return ok(intent.testId); });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 2, 'one compensating load');
  assert.equal(h.vm().activeTestId, 'test-1', 'never committed to an id the editor does not hold');
  assert.equal(h.vm().count, 1);
  assert.equal(h.editor.test.testId, 'test-1');
  assert.equal(h.vm().fault, null);
});

test('amendment 5a: a version-only editor change between DELETE and CONFIRM still confirms and executes normally', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  h.editor.set({});                                                 // version bump, no consent-relevant change
  await confirmOp(h);
  const vm = h.vm();
  assert.equal(vm.pending, null, 'executed, not re-prompted');
  assert.equal(vm.notice, null);
  assert.deepEqual(vm.tests.map((t) => t.testId), ['new-1']);
  assert.equal(vm.activeTestId, 'new-1');
});

test('amendment 5b: deleting the active MIDDLE test activates the next record, not the previous (AC-M8 order)', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });   // new-1
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });   // new-2
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  assert.equal(h.vm().activeTestId, 'new-1');
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'new-1' });
  await confirmOp(h);
  assert.equal(h.vm().activeTestId, 'new-2');
  assert.deepEqual(h.vm().tests.map((t) => t.testId), ['test-1', 'new-2']);
});

test('amendment 5c: a failed successor activation when deleting the last test leaves no fresh record behind', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  h.editor.scriptLoad((intent, editor) => ({ ok: false, testId: editor.test.testId, version: 1, releaseStuck: false, reason: 'run-active' }));
  await confirmOp(h);
  const vm = h.vm();
  assert.deepEqual(vm.tests.map((t) => t.testId), ['test-1'], 'the victim stays; the fresh successor is removed');
  assert.equal(vm.activeTestId, 'test-1');
  assert.equal(vm.notice, 'Could not delete “Clash test 1”: stop the running test first.');
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.vm().tests.at(-1).name, 'Clash test 3', 'the consumed number is never reused');
});

test('amendment 5d: a double CONFIRM of an ACTIVE-test Delete executes once and starts no spurious recovery', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  const op = h.vm().confirm.operationId;
  await Promise.all([h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op }), h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op })]);
  await h.settle();
  const vm = h.vm();
  assert.equal(loads(h).length, 1, 'exactly one activation, no compensation');
  assert.equal(vm.activeTestId, 'new-1');
  assert.equal(vm.notice, null);
  assert.equal(vm.fault, null);
  assert.deepEqual(vm.tests.map((t) => t.testId), ['new-1']);
});

test('amendment 6: a label scope the editor rejected is pushed again on the next records change', async () => {
  const h = makeManagerHarness();
  const original = h.editor.dispatch;
  let failNext = true;
  h.editor.dispatch = (intent) => {
    if (intent.type === INTENT.TEST_LABEL_SCOPE && failNext) { failNext = false; return Promise.reject(new Error('scope refused')); }
    return original(intent);
  };
  const toggle = (side, modelKey) => h.editor.set({ draft: draftReduce(h.editor.test.draft, { type: 'toggleModel', side, modelKey }) });
  toggle('A', 'mA');                                                // pushes ['mA'] — rejected
  await h.settle();
  assert.deepEqual(h.editor.labelScopes, []);
  // A records change that keeps the SAME scope ['mA']: had the rejected scope been remembered, nothing would be pushed.
  h.editor.set({ draft: draftReduce(h.editor.test.draft, { type: 'name', value: 'Renamed' }) });
  assert.deepEqual(h.editor.labelScopes, [['mA']], 'a rejected scope is never remembered as pushed');
});

test('Codex advisor finding: a TEST_LOAD that mutates the held source (same testId) and then throws is compensated, never a plain failure', async () => {
  const h = makeManagerHarness();
  const committed = h.editor.test.draft;
  h.editor.scriptLoad((intent, editor) => {
    editor.set({ draft: draftReduce(committed, { type: 'name', value: 'Half-loaded' }) }, { notify: false });   // same id, other state
    throw new Error('load failed after mutating');
  });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 2, 'one compensating load');
  assert.equal(h.editor.test.draft, committed, 'the editor holds the committed record\'s draft again');
  assert.equal(h.row('test-1').name, 'Clash test 1');
  assert.equal(h.vm().count, 1);
  assert.equal(h.vm().fault, null);
});

// ── Task 9 fix round 1: reviewer probes PA–PH (ported) + onConfirm/reevaluate minors ─────────────────────────────

test('fix PA (no compensation scheduled during an activation): a divergence notification during a DEFERRED load is compensated only after the load settles', async () => {
  const h = makeManagerHarness();
  let finish;
  h.editor.scriptLoad((intent, editor) => { editor.set({ testId: 'rogue', draft: rogue() }); return new Promise((r) => { finish = () => r(ok(intent.testId)); }); });
  const done = h.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.settle();
  assert.equal(loads(h).length, 1, 'no compensating load while the activation load is in flight');
  finish();
  await done;
  await h.settle();
  assert.equal(loads(h).length, 2, 'exactly one compensation, by the activation');
  assert.equal(h.vm().activeTestId, 'test-1');
});

test('fix PB (compensation needs result.testId === activeTestId): an ok compensation naming another id is terminal', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad(() => ok('rogue'));
  h.editor.scriptLoad((intent, editor) => { defaultLoad(intent, editor); return ok('other'); });   // editor IS on test-1
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.editor.test.testId, 'test-1', 'the editor agrees — only the result id disagrees');
  assert.deepEqual(h.vm().fault, { text: MANAGER_TEXT.FAULT });
});

test('fix PC (sync suspended while faulted): an editor reporting the AGREEING active id never syncs a record', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad(() => ok('rogue'));
  h.editor.scriptLoad(() => ({ ok: false, testId: 'test-1', version: 2, releaseStuck: false, reason: 'x' }));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.deepEqual(h.vm().fault, { text: MANAGER_TEXT.FAULT });
  assert.equal(h.editor.test.testId, 'test-1', 'the editor id agrees with activeTestId, so only the fault can stop the sync');
  h.editor.set({ draft: draftReduce(h.editor.test.draft, { type: 'name', value: 'Faulted edit' }) });
  assert.equal(h.row('test-1').name, 'Clash test 1');
});

test('fix PD (sync suspended while recovering): an active-id notification during a scheduled recovery never syncs; compensation restores the snapshot', async () => {
  const h = makeManagerHarness();
  const snap = h.editor.test.draft;
  h.editor.set({ testId: 'rogue', draft: rogue() });
  h.editor.set({ testId: 'test-1', draft: draftReduce(snap, { type: 'name', value: 'Hijacked' }) });
  assert.equal(h.row('test-1').name, 'Clash test 1');
  await h.settle();
  assert.equal(h.editor.test.draft, snap);
  assert.equal(loads(h).length, 1);
});

test('fix PE (refusal editor-agreement leg): a refusal naming the active id while the editor holds another id is a divergence', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => { editor.set({ testId: 'rogue', draft: rogue() }, { notify: false }); return { ok: false, testId: 'test-1', version: 1, releaseStuck: false, reason: 'run-active' }; });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 2, 'compensated, not a plain failure');
  assert.equal(h.editor.test.testId, 'test-1');
});

test('fix PF: entering the fault dispatches CONFIRM_CANCEL exactly once', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad(() => ok('rogue'));
  h.editor.scriptLoad(() => ({ ok: false, testId: 'rogue', version: 2, releaseStuck: false, reason: 'x' }));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.settle();
  assert.deepEqual(h.vm().fault, { text: MANAGER_TEXT.FAULT });
  assert.equal(h.editor.dispatched.filter((i) => i.type === INTENT.CONFIRM_CANCEL).length, 1);
});

test('fix PG (fault clears pending): a prompt awaiting before a spontaneous divergence is cleared when the fault is entered', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'new-1' });
  assert.notEqual(h.vm().confirm, null);
  h.editor.scriptLoad(() => ({ ok: false, testId: 'rogue', version: 2, releaseStuck: false, reason: 'x' }));
  h.editor.set({ testId: 'rogue', draft: rogue() });
  await h.settle();
  assert.deepEqual(h.vm().fault, { text: MANAGER_TEXT.FAULT });
  assert.equal(h.vm().pending, null);
});

test('fix PH (coalescing guard): a second divergence signal during an IN-FLIGHT compensation starts no second load', async () => {
  // Reset's Clear step: the editor jumps to another id (notification → scheduled compensation, deferred load), then the
  // Clear step rejects (editorStep → beginRecovery) while that compensation is loading.
  const h = makeManagerHarness();
  h.editor.set({ lastRun: lastRunOf('run-1', 2) }, { runPatch: { state: 'done' } });
  let rejectClear;
  let finish;
  const original = h.editor.dispatch;
  h.editor.dispatch = (intent) => {
    if (intent.type === INTENT.RESULTS_CLEAR) {
      h.editor.set({ testId: 'rogue', draft: rogue() });
      return new Promise((_, reject) => { rejectClear = () => reject(new Error('clear failure')); });
    }
    return original(intent);
  };
  h.editor.scriptLoad((intent, editor) => new Promise((r) => { finish = () => r(defaultLoad(intent, editor)); }));
  const done = h.dispatch({ type: MANAGER_INTENT.RESET, testId: 'test-1' });
  await h.settle();
  assert.equal(loads(h).length, 1, 'the compensation is loading');
  rejectClear();
  await h.settle();
  assert.equal(loads(h).length, 1, 'coalesced into the in-flight token');
  finish();
  await done;
  await h.settle();
  assert.equal(loads(h).length, 1);
  assert.equal(h.vm().fault, null);
  assert.equal(h.editor.test.testId, 'test-1');
});

test('fix minor 1: CONFIRM while a compensation is in flight is refused — the prompt stays and executes only afterwards', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'new-1' });
  const op = h.vm().confirm.operationId;
  let finish;
  h.editor.scriptLoad((intent, editor) => new Promise((r) => { finish = () => r(defaultLoad(intent, editor)); }));
  h.editor.set({ testId: 'rogue', draft: rogue() });                  // spontaneous divergence → compensation loading
  await h.settle();
  assert.equal(loads(h).length, 1);
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op });
  assert.equal(h.vm().pending?.operationId, op, 'not executed while recovering');
  assert.equal(h.vm().count, 2, 'nothing deleted');
  finish();
  await h.settle();
  assert.equal(h.vm().fault, null);
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op });
  assert.deepEqual(h.vm().tests.map((t) => t.testId), ['test-1'], 'the same consent executes once recovered');
});

test('fix minor 2: a CONFIRM that finds the editor on another id (unobserved) refuses AND starts one recovery', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'new-1' });
  const op = h.vm().confirm.operationId;
  h.editor.set({ testId: 'rogue', draft: rogue() }, { notify: false });
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op });
  assert.equal(h.vm().count, 2, 'refused: nothing deleted');
  await h.settle();
  assert.equal(loads(h).length, 1, 'one compensating load');
  assert.equal(h.editor.test.testId, 'test-1');
  assert.equal(h.vm().fault, null);
});

test('M-a: the pending confirm is disabled in the manager VM while a compensation load is held open, and enabled again after it settles', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DELETE, testId: 'test-1' });
  assert.equal(h.vm().confirm.enabled, true);
  const op = h.vm().confirm.operationId;
  let release;
  h.editor.scriptLoad((intent, editor) => new Promise((resolve) => { release = () => resolve(defaultLoad(intent, editor)); }));
  h.editor.set({ testId: 'rogue', draft: rogue() });                // spontaneous divergence: ONE scheduled recovery
  await h.settle();
  assert.equal(loads(h).length, 1, 'the compensation load is held open');
  assert.equal(h.vm().confirm.enabled, false, 'the VM agrees with onConfirm, which refuses while recovering');
  await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op });
  assert.equal(h.vm().count, 2, 'the refused CONFIRM deleted nothing');
  assert.equal(h.vm().confirm.operationId, op, 'the prompt stays');
  release();
  await h.settle();
  assert.equal(h.vm().fault, null);
  assert.equal(h.vm().confirm.enabled, true, 'enabled again once the compensation settled');
});
