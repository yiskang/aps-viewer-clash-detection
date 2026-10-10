// test/clashpanel/core/managerViewModel.test.mjs — spec §26.9 ViewModel, §26.3/§26.7 gates, §26.10 copy, AC-M3/M5/M18.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, draftReduce, buildDefinition, definitionKey } from '../../../clashpanel/core/draft.js';
import { buildManagerViewModel, actionGate, lockedEditorVm, MANAGER_TEXT } from '../../../clashpanel/core/managerViewModel.js';
import { DISCARD_TEXT } from '../../../clashpanel/core/viewModel.js';
import { INTENT } from '../../../clashpanel/core/intents.js';

const reduce = (d, ...a) => a.reduce(draftReduce, d);
const abDraft = (id, n = 1) => reduce(createDraft({ testId: id, testNumber: n }),
  { type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'toggleModel', side: 'B', modelKey: 'mB' });
const keyOf = (d) => definitionKey(buildDefinition(d, { verifiedBasis: true }).definition);
const summaryOf = (d, over = {}) => ({ runId: 'run-1', status: 'completed', resultCount: 3, coverage: 'full', integrity: 'clean',
  freshnessAtSeal: 'current', caveatCount: 0, models: [], definitionKey: keyOf(d), startedAt: 0, sealedAt: 1, ...over });
const COMPLETE = { state: 'setup-complete', text: 'Setup complete — readiness to run is checked when opened', models: [] };
const ALLOW = { enabled: true, reason: null };

function state({ records, activeTestId = records[0].testId, test = {}, run = { state: 'idle', progress: null }, ...over }) {
  const active = records.find((r) => r.testId === activeTestId);
  return {
    view: 'list', activeTestId, records,
    editorVm: { version: 1, test: { testId: activeTestId, draft: active.draft, runActive: false, heldUnsaved: false, pendingConfirm: false, lastRun: null, ...test }, run },
    pending: null, fault: null, busy: false, notice: null, live: '',
    scopeName: (k) => ({ mA: 'Architecture', mB: 'Structure' })[k] ?? `Model ${k} (not loaded)`,
    readiness: new Map(records.map((r) => [r.testId, COMPLETE])),
    modelsChanged: new Map(records.map((r) => [r.testId, false])),
    ...over,
  };
}
const X = () => ({ testId: 'X', draft: abDraft('X'), summary: null });
const Y = () => ({ testId: 'Y', draft: abDraft('Y', 2), summary: null });

test('row shape (§26.9): one deep-frozen row per record in creation order, the active row marked', () => {
  const vm = buildManagerViewModel(state({ records: [X(), Y()] }));
  assert.ok(Object.isFrozen(vm) && Object.isFrozen(vm.tests[0]) && Object.isFrozen(vm.tests[0].actions.open));
  assert.deepEqual(vm.tests.map((t) => [t.testId, t.active]), [['X', true], ['Y', false]]);
  assert.deepEqual(Object.keys(vm.tests[0]).sort(), ['actions', 'active', 'modeText', 'modelsChanged', 'modelsChangedText', 'name',
    'readiness', 'resultCount', 'resultsText', 'setA', 'setB', 'setupChangedSinceRun', 'status', 'testId']);
  assert.equal(vm.count, 2);
  assert.equal(vm.activeName, 'Clash test 1');
  assert.deepEqual(vm.tests[1].status, { kind: 'not-run', text: 'Not run' });
  assert.equal(vm.tests[0].setA, 'Architecture');
  assert.equal(vm.tests[0].setB, 'Structure');
});

test('modeText: Hard; Soft with the clearance text and the §23 basis label — never "verified"', () => {
  const soft = (basisUnit) => ({ testId: 'X', summary: null, draft: reduce(abDraft('X'), { type: 'mode', value: 'soft' },
    { type: 'clearance', value: '0.05' }, ...(basisUnit ? [{ type: 'basisUnit', value: basisUnit }] : [])) });
  const textOf = (rec) => buildManagerViewModel(state({ records: [rec] })).tests[0].modeText;
  assert.equal(textOf(X()), 'Hard');
  assert.equal(textOf(soft('')), 'Soft (clearance 0.05)');
  assert.equal(textOf(soft('mm')), 'Soft (clearance 0.05 mm, user-supplied, not verified)');
  assert.equal(textOf(soft('raw')), 'Soft (clearance 0.05, raw model units, not verified)');
  for (const u of ['', 'mm', 'raw']) assert.doesNotMatch(textOf(soft(u)), /(?<!not )verified/);
});

test('AC-M5: a summary row reads "<n> clashes reported" + "Results not held"; the active displayed run does not', () => {
  const x = { ...X(), summary: summaryOf(abDraft('X'), { resultCount: 0 }) };
  const y = { ...Y(), summary: summaryOf(abDraft('Y', 2), { runId: 'run-2' }) };
  const vm = buildManagerViewModel(state({ records: [x, y], run: { state: 'done', progress: null }, test: { lastRun: x.summary } }));
  assert.deepEqual(vm.tests[0].status, { kind: 'completed', text: 'Completed — 0 clashes reported' });
  assert.equal(vm.tests[0].resultsText, null);
  assert.equal(vm.tests[0].resultCount, 0);
  assert.equal(vm.tests[1].resultsText, MANAGER_TEXT.RESULTS_NOT_HELD);
  assert.equal(vm.tests[1].resultCount, 3);
  const cleared = buildManagerViewModel(state({ records: [x, y], test: { lastRun: x.summary } }));
  assert.equal(cleared.tests[0].resultsText, MANAGER_TEXT.RESULTS_NOT_HELD, 'after Clear results the summary stays');
  assert.doesNotMatch(JSON.stringify(vm), /no clashes/i);
});

test('the active running row reads the editor live status; "Stopping…" while stopping', () => {
  const running = buildManagerViewModel(state({ records: [X()], test: { runActive: true }, run: { state: 'running', progress: { resultsFound: 7 } } }));
  assert.deepEqual(running.tests[0].status, { kind: 'running', text: 'Running — 7 found' });
  const stopping = buildManagerViewModel(state({ records: [X()], test: { runActive: true }, run: { state: 'stopping', progress: null } }));
  assert.deepEqual(stopping.tests[0].status, { kind: 'stopping', text: 'Stopping…' });
});

test('setupChangedSinceRun compares the current definition key with the summary key (name included)', () => {
  const d = abDraft('X');
  assert.equal(buildManagerViewModel(state({ records: [{ testId: 'X', draft: d, summary: summaryOf(d) }] })).tests[0].setupChangedSinceRun, false);
  const renamed = reduce(d, { type: 'name', value: 'Renamed' });
  assert.equal(buildManagerViewModel(state({ records: [{ testId: 'X', draft: renamed, summary: summaryOf(d) }] })).tests[0].setupChangedSinceRun, true);
});

test('AC-M3 gates: during a run Create/Open-other/Delete-active/Reset-active are refused; Duplicate and non-active Delete/Reset are allowed', () => {
  const x = { ...X(), summary: summaryOf(abDraft('X')) };
  const y = { ...Y(), summary: summaryOf(abDraft('Y', 2)) };
  const s = state({ records: [x, y], test: { runActive: true }, run: { state: 'running', progress: null } });
  const vm = buildManagerViewModel(s);
  const STOP = { enabled: false, reason: MANAGER_TEXT.STOP_FIRST };
  assert.deepEqual(vm.create, STOP);
  assert.deepEqual(vm.tests[0].actions.delete, STOP);
  assert.deepEqual(vm.tests[0].actions.reset, STOP);
  assert.deepEqual(vm.tests[1].actions.open, STOP);
  assert.deepEqual(vm.tests[0].actions.open, ALLOW, 'opening the active test is a view switch');
  assert.deepEqual(vm.tests[0].actions.duplicate, ALLOW);
  assert.deepEqual(vm.tests[1].actions.delete, ALLOW);
  assert.deepEqual(vm.tests[1].actions.reset, ALLOW);
  assert.deepEqual(actionGate(s, 'open', 'Y'), STOP);
  assert.deepEqual(actionGate(s, 'open', 'nope'), { enabled: false, reason: MANAGER_TEXT.UNKNOWN });
});

test('a pending operation, the editor confirmation, a busy activation and the fault each disable every manager action with a reason', () => {
  const recs = [X(), Y()];
  const pending = { operationId: 'op-1', kind: 'delete', sourceTestId: 'Y', targetTestId: null, state: 'awaiting', discardsUnsaved: false };
  const pend = buildManagerViewModel(state({ records: recs, busy: true, pending }));
  assert.deepEqual(pend.create, { enabled: false, reason: MANAGER_TEXT.PENDING });
  assert.ok(pend.tests.every((t) => Object.values(t.actions).every((a) => a.enabled === false && a.reason === MANAGER_TEXT.PENDING)));
  assert.deepEqual(buildManagerViewModel(state({ records: recs, test: { pendingConfirm: true } })).tests[1].actions.open,
    { enabled: false, reason: MANAGER_TEXT.ANSWER_CONFIRM });
  const fault = buildManagerViewModel(state({ records: recs, fault: { text: MANAGER_TEXT.FAULT } }));
  assert.deepEqual(fault.create, { enabled: false, reason: MANAGER_TEXT.FAULT });
  assert.deepEqual(fault.fault, { text: MANAGER_TEXT.FAULT });
  assert.deepEqual(fault.editorLock, { enabled: false, reason: MANAGER_TEXT.FAULT });
  assert.equal(buildManagerViewModel(state({ records: recs })).editorLock, null);
  assert.deepEqual(buildManagerViewModel(state({ records: recs, busy: true })).create, { enabled: false, reason: MANAGER_TEXT.BUSY });
});

test('Reset is enabled only with a summary or held results', () => {
  assert.deepEqual(buildManagerViewModel(state({ records: [X(), Y()] })).tests[1].actions.reset, { enabled: false, reason: MANAGER_TEXT.NOTHING_TO_RESET });
});

test('confirm is derived from the awaiting pending operation; its buttons carry the operationId (§26.2a, §26.7)', () => {
  const recs = [X(), { ...Y(), draft: reduce(abDraft('Y', 2), { type: 'name', value: 'Ducts' }) }];
  const at = (kind, over = {}) => buildManagerViewModel(state({ records: recs, busy: true,
    pending: { operationId: 'op-7', kind, sourceTestId: 'X', targetTestId: 'Y', state: 'awaiting', discardsUnsaved: true, ...over } })).confirm;
  assert.deepEqual(at('switch'), { operationId: 'op-7', enabled: true, disabledReason: null, cancelLabel: 'Cancel', confirmLabel: 'Discard and open',
    text: 'The results of “Clash test 1” are held in memory only. Opening another test discards them — discard and open?' });
  assert.equal(at('create').text, DISCARD_TEXT.newTest, '§23.5 New-test confirmation reused unchanged');
  assert.equal(at('create').confirmLabel, 'Discard unsaved results');
  assert.equal(at('delete', { sourceTestId: 'Y', discardsUnsaved: false }).text,
    'Delete “Ducts”? Its setup and results are discarded for this session and can\'t be recovered.');
  assert.equal(at('delete').text,
    'Delete “Clash test 1”? Its setup and results are discarded for this session and can\'t be recovered. Its unsaved results are discarded too.');
  assert.equal(at('delete').confirmLabel, 'Delete test');
  assert.equal(at('reset', { targetTestId: null }).text, 'The results of “Clash test 1” are held in memory only. Resetting discards them — discard?');
  const executing = buildManagerViewModel(state({ records: recs, busy: true,
    pending: { operationId: 'op-7', kind: 'switch', sourceTestId: 'X', targetTestId: 'Y', state: 'executing', discardsUnsaved: false } }));
  assert.equal(executing.confirm, null);
  assert.deepEqual(executing.pending, { operationId: 'op-7', kind: 'switch', sourceTestId: 'X', targetTestId: 'Y' });
  const blocked = buildManagerViewModel(state({ records: recs, busy: true, test: { pendingConfirm: true },
    pending: { operationId: 'op-7', kind: 'switch', sourceTestId: 'X', targetTestId: 'Y', state: 'awaiting', discardsUnsaved: true } }));
  assert.equal(blocked.confirm.enabled, false, 'disabled while the editor asks');
});

test('lockedEditorVm: every policy-blocked editor control reports {enabled:false, reason}; allowed ones and other regions are untouched (§26.9, Work plan re-review M1)', () => {
  const deepFrozen = (v) => { if (v !== null && typeof v === 'object') { Object.values(v).forEach(deepFrozen); Object.freeze(v); } return v; };
  const retry = { label: 'Release previous results and retry', intent: { type: INTENT.RUN_RELEASE_AND_RETRY } };
  const clear = { label: 'Clear results', intent: { type: INTENT.RESULTS_CLEAR } };
  const ed = deepFrozen({
    version: 3, test: { testId: 'X' },
    run: { state: 'done', canRun: true, canStop: false, banners: [{ id: 'a', action: retry }, { id: 'b', action: clear }, { id: 'c' }] },
    setup: { newTest: { enabled: true }, useSelectionEnabled: true },
    filters: { text: '' },
    results: { page: { index: 0 }, rows: [], nav: { canPrev: true, canNext: true, label: 'Clash 2 of 3', scoped: false } },
    selected: { resultId: 'r1', actions: { focus: { enabled: true, reason: null }, isolate: { enabled: true, checked: true, reason: null },
      markers: { enabled: true, checked: false, reason: null }, focusOnSelect: { checked: true }, backToAll: { enabled: true } } },
  });
  const before = JSON.stringify(ed);
  const policy = { [INTENT.RUN_RELEASE_AND_RETRY]: 'block', [INTENT.RESULTS_CLEAR]: 'allow' };
  const OFF = { enabled: false, reason: 'fault!' };
  const locked = lockedEditorVm(ed, 'fault!', policy);
  assert.equal(locked.run.canRun, false);
  assert.deepEqual(locked.run.locked, OFF);
  assert.deepEqual(locked.setup.newTest, OFF);
  assert.equal(locked.setup.useSelectionEnabled, false);
  assert.deepEqual(locked.setup.locked, OFF);
  assert.deepEqual(locked.run.banners[0].action, { ...retry, ...OFF }, 'Release and retry (blocked) is disabled with the reason');
  assert.equal(locked.run.banners[1], ed.run.banners[1], 'an allow-listed banner action (Clear results) is untouched');
  assert.equal(locked.run.banners[2], ed.run.banners[2]);
  assert.equal(lockedEditorVm(ed, 'fault!', {}).run.banners[1].action.enabled, false, 'an intent missing from the policy is locked (fail closed)');
  assert.deepEqual(locked.results.select, OFF, 'result-row selection');
  assert.deepEqual(locked.results.nav, { canPrev: false, canNext: false, label: 'Clash 2 of 3', scoped: false, locked: OFF });
  assert.deepEqual(locked.selected.actions.focus, OFF);
  assert.deepEqual(locked.selected.actions.isolate, { enabled: false, checked: true, reason: 'fault!' });
  assert.deepEqual(locked.selected.actions.markers, { enabled: false, checked: false, reason: 'fault!' });
  assert.deepEqual(locked.selected.actions.backToAll, OFF);
  assert.equal(locked.selected.actions.focusOnSelect, ed.selected.actions.focusOnSelect, 'Focus on select stays (allow-listed)');
  for (const k of ['filters', 'test']) assert.equal(locked[k], ed[k], `${k} carried over by reference`);
  assert.equal(locked.results.page, ed.results.page);
  assert.equal(locked.run.canStop, false, 'Stop keeps its own state');
  assert.equal(JSON.stringify(ed), before, 'the editor\'s own ViewModel is untouched (copy/overlay only)');
  assert.ok(Object.isFrozen(locked.run) && Object.isFrozen(locked.setup) && Object.isFrozen(locked.results.nav) && Object.isFrozen(locked.selected.actions.focus));
  const bare = lockedEditorVm(Object.freeze({ version: 1, run: Object.freeze({ state: 'idle', canRun: true }) }), 'x', policy);
  assert.deepEqual(Object.keys(bare).sort(), ['run', 'version'], 'absent regions stay absent');
  assert.equal('banners' in bare.run, false);
});

test('copy: no manager string claims persistence ("saved") or readiness ("ready")', () => {
  const vm = buildManagerViewModel(state({ records: [X(), Y()] }));
  const text = JSON.stringify(vm) + JSON.stringify(MANAGER_TEXT, (k, v) => (typeof v === 'function' ? v('n', 'm', 'run-active') : v));
  assert.doesNotMatch(text, /\bsaved\b/i);
  assert.doesNotMatch(text, /\bready\b/i);
});

test('M-a: pending confirm.enabled also requires !recovering (undefined = false); every other field is unchanged', () => {
  const recs = [X(), Y()];
  const at = (over) => buildManagerViewModel(state({ records: recs, busy: true,
    pending: { operationId: 'op-7', kind: 'switch', sourceTestId: 'X', targetTestId: 'Y', state: 'awaiting', discardsUnsaved: true }, ...over }));
  const idle = at({});
  const rec = at({ recovering: true });
  assert.equal(idle.confirm.enabled, true, 'undefined recovering counts as not recovering');
  assert.equal(at({ recovering: false }).confirm.enabled, true);
  assert.equal(rec.confirm.enabled, false);
  assert.deepEqual({ ...rec.confirm, enabled: true, disabledReason: null }, idle.confirm, 'only enabled (and its disabledReason) differ');
  assert.deepEqual({ ...rec, confirm: null }, { ...idle, confirm: null }, 'nothing else changes');
});

test('M1: a disabled pending confirm carries its specific reason (fault > recovering > editor confirmation); enabled carries null', () => {
  const at = (over, test = {}) => buildManagerViewModel(state({ records: [X(), Y()], busy: true, test,
    pending: { operationId: 'op-7', kind: 'switch', sourceTestId: 'X', targetTestId: 'Y', state: 'awaiting', discardsUnsaved: true }, ...over })).confirm;
  assert.deepEqual([at({}).enabled, at({}).disabledReason], [true, null]);
  assert.deepEqual([at({ recovering: true }).enabled, at({ recovering: true }).disabledReason], [false, MANAGER_TEXT.RECOVERING]);
  assert.deepEqual([at({}, { pendingConfirm: true }).enabled, at({}, { pendingConfirm: true }).disabledReason], [false, MANAGER_TEXT.ANSWER_CONFIRM]);
  const fault = { text: 'Custom fault text, distinct from the default.' };
  assert.notEqual(fault.text, MANAGER_TEXT.FAULT);
  assert.equal(at({ fault, recovering: true }, { pendingConfirm: true }).disabledReason, fault.text, 'fault wins, with the fault\'s own text');
  assert.equal(at({ recovering: true }, { pendingConfirm: true }).disabledReason, MANAGER_TEXT.RECOVERING, 'recovering beats the editor confirmation');
  assert.match(MANAGER_TEXT.RECOVERING, /re-syncing/);
});

test('M2/M1: manager VM exposes liveSeq (default 0) and the run-active reason for the managed New test', () => {
  assert.equal(buildManagerViewModel(state({ records: [X()] })).liveSeq, 0);
  assert.equal(buildManagerViewModel(state({ records: [X()], liveSeq: 7 })).liveSeq, 7);
  assert.equal(buildManagerViewModel(state({ records: [X()] })).runActiveReason, MANAGER_TEXT.STOP_FIRST);
});
