// test/clashpanel/core/viewModel.test.mjs — Task 19: the pure ViewModel builder (AC-P2, AC-P3, AC-P11, AC-P21 shape).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildViewModel, describeStatusLive, EMPTY_FILTERED_TEXT } from '../../../clashpanel/core/viewModel.js';
import { createDraft } from '../../../clashpanel/core/draft.js';
import { initialRunState, reduceRun } from '../../../clashpanel/core/runMachine.js';
import { runHeadline, STATEMENTS } from '../../../clashpanel/core/runReport.js';
import { PAGE_SIZE } from '../../../clashpanel/core/constants.js';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { makeSet, makeHarness } from '../support/controllerHarness.mjs';

// ── input builders (the ViewInput documented at the top of viewModel.js) ──────────────────────────────────────

const snapshot = (over = {}) => ({ runId: 'run-1', status: 'queued', phase: 'queued', seq: 0, unitsTotal: 0, unitsEvaluated: 0, unitsFailedOrSkipped: 0, pairSpaceTotal: 0, pairSpaceEvaluated: 0, pairSpaceProcessed: 0, fractionEvaluated: null, fractionProcessed: null, resultsFound: 0, caveatCount: 0, caveatUnclassified: 0, currentUnitId: null, elapsedMs: 0, ...over });

function machineFor(phase, status) {
  const admitted = reduceRun(initialRunState(), { type: 'admitted', snapshot: snapshot(), atMs: 0 });
  if (phase === 'idle') return initialRunState();
  if (phase === 'preparing') return admitted;
  if (phase === 'running') return reduceRun(admitted, { type: 'core-event', event: { type: 'unit', seq: 1, status: 'running', phase: 'executing' }, snapshot: snapshot({ status: 'running', phase: 'executing', seq: 1 }) });
  return reduceRun(admitted, { type: 'done', summary: { status, resultSet: {}, persistence: { state: 'saved' } } });
}

function input({ phase = 'idle', set = null, list = null, freshness, claim = null, claimPending = false, selected = null, persistence = { state: 'saved', timedOut: false, attempt: 1 }, setupChanged = false } = {}) {
  const status = set?.outcome?.status ?? 'failed';
  return {
    version: 7,
    setup: {
      draft: createDraft({ testId: 't', testNumber: 1 }),
      validation: { state: 'blocked', findings: [{ control: 'setA', code: 'empty', text: 'Set A is empty' }], issuesTruncated: false, definition: null },
      soft: { available: false, pending: false, verdict: null, explanation: null },
      models: [{ modelKey: 'mA', displayName: 'Architecture', loaded: true, registered: true }],
      modelName: (k) => ({ mA: 'Architecture', mB: 'Structure' })[k] ?? `Model ${k}`,
      setupChangedSinceRun: setupChanged, collapsed: false, runActive: phase === 'running' || phase === 'preparing',
    },
    run: {
      machine: machineFor(phase, status), snapshot: phase === 'running' ? snapshot({ status: 'running', unitsTotal: 4, unitsEvaluated: 1, fractionProcessed: 0.25, resultsFound: 2 }) : null,
      elapsedMs: phase === 'running' ? 65000 : null, canRun: phase === 'idle' || phase === 'done', canStop: phase === 'running' || phase === 'preparing',
      admission: null, confirm: null, releaseErrors: [], residencyNotice: null, setupChanged, isolationNotice: null,
    },
    displayed: phase !== 'done' ? null : {
      runId: 'run-1', status, resultSet: set, persistence,
      freshness: freshness === undefined ? { state: set?.outcome?.freshness ?? 'current', reasons: [] } : freshness,
      freshnessPending: freshness === null, claim, claimPending, summary: null,
    },
    list, selected,
  };
}

function listFor(set, over = {}) {
  const n = set.results.length;
  return {
    total: n, filtered: n, busy: false, spec: { text: '', models: [], elementOnly: null, maxGap: null, unverified: false, hasLocation: false },
    textDraft: '', maxGapText: '', maxGapError: null, groupBy: 'none', groupingState: 'idle', groupingReason: null, sort: 'default',
    isSoft: false, clearance: null, modelOptions: [{ modelKey: 'mA', label: 'Architecture' }], elementOnly: null, view: 'flat',
    page: { index: 0, count: n === 0 ? 0 : 1, size: PAGE_SIZE },
    rows: set.results.map((r, i) => ({ kind: 'result', key: `-|${r.resultId}`, resultId: r.resultId, groupId: null, ordinal: i + 1, side1: { modelKey: 'mA', modelName: 'Architecture', label: '#1', dbId: 1 }, side2: { modelKey: 'mB', modelName: 'Structure', label: '#10', dbId: 10 }, gap: null, badges: [], liveness: 'live', selected: false })),
    nav: { canPrev: false, canNext: n > 0, label: 'No clash selected' }, hiddenByFilters: false, ...over,
  };
}

const claimFor = (set) => {
  const o = set.outcome;
  const allowed = set.results.length === 0 && o.status === 'completed' && o.coverage === 'full' && o.integrity === 'clean' && o.freshness === 'current';
  return { allowed, unqualified: allowed, qualifiers: [], exclusions: [], proofMethod: 'bracketed-digest' };
};

const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (v !== null && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
};
// The two §7.5 claim statements and the §8.3 empty-after-filter line are the only sentences allowed to start so.
const SANCTIONED = new Set([STATEMENTS.CLAIM, STATEMENTS.QUALIFIED_CLAIM, EMPTY_FILTERED_TEXT]);
function assertNoBareNoClashes(vm) {
  for (const s of strings(vm)) {
    assert.notEqual(s.trim().replace(/[.!]$/, ''), 'No clashes', 'bare "No clashes"');
    if (/\bNo clashes\b/.test(s)) assert.ok(SANCTIONED.has(s), `"No clashes" outside the sanctioned sentences: ${s}`);
  }
}

const SHAPE = {
  top: ['filters', 'results', 'run', 'selected', 'setup', 'version'],
  setup: ['clearance', 'collapsed', 'mode', 'models', 'name', 'scope', 'selfClash', 'setupChangedSinceRun', 'softAvailability', 'summary', 'useSelectionEnabled', 'validation'],
  run: ['badges', 'banners', 'canRun', 'canStop', 'counts', 'details', 'diagnostics', 'doneKind', 'headline', 'progress', 'state', 'statusLive', 'waitingForOtherRun'],
  filters: ['active', 'busy', 'elementOnly', 'groupBy', 'groupingNote', 'hasLocation', 'maxGap', 'modelOptions', 'models', 'sort', 'sortOptions', 'text', 'unverified'],
  results: ['hiddenByFiltersNote', 'lines', 'message', 'multiValuedNote', 'nav', 'page', 'rows', 'state', 'view'],
  selected: ['actions', 'gap', 'hasLocation', 'hiddenByFilters', 'liveness', 'notes', 'ordinal', 'resultId', 'side1', 'side2'],
  actions: ['backToAll', 'focus', 'focusOnSelect', 'isolate', 'markers'],
};
const keys = (o) => Object.keys(o).sort();

// ── tests ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('every region has exactly the catalog shape and the whole ViewModel is deep-frozen', () => {
  const set = makeSet({ runId: 'run-1', results: [{ a: ['mA', 1], b: ['mB', 10] }] });
  const selected = {
    resultId: 'r0', ordinal: 1, side1: { modelKey: 'mA', modelName: 'Architecture', label: '#1', dbId: 1 }, side2: { modelKey: 'mB', modelName: 'Structure', label: '#10', dbId: 10 },
    gap: null, hasLocation: true, liveness: 'live', notes: [], hiddenByFilters: false, anyLive: true,
    isolation: { available: true, reason: null }, toggles: { focusOnSelect: true, isolate: false, markers: true },
  };
  for (const vm of [buildViewModel(input()), buildViewModel(input({ phase: 'running' })), buildViewModel(input({ phase: 'done', set, list: listFor(set), selected }))]) {
    assert.deepEqual(keys(vm), SHAPE.top);
    assert.deepEqual(keys(vm.setup), SHAPE.setup);
    assert.deepEqual(keys(vm.run), SHAPE.run);
    assert.deepEqual(keys(vm.filters), SHAPE.filters);
    assert.deepEqual(keys(vm.results), SHAPE.results);
    assert.deepEqual(keys(vm.results.nav), ['canNext', 'canPrev', 'label']);
    assert.deepEqual(keys(vm.results.page), ['count', 'index', 'size']);
    const walk = (v) => { if (v !== null && typeof v === 'object') { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(walk); } };
    walk(vm);
    assert.equal(vm.version, 7);
  }
  const vm = buildViewModel(input({ phase: 'done', set, list: listFor(set), selected }));
  assert.deepEqual(keys(vm.selected), SHAPE.selected);
  assert.deepEqual(keys(vm.selected.actions), SHAPE.actions);
  assert.equal(JSON.stringify(vm).includes('tolerance'), false);            // no Hard tolerance control (AC-P1)
  assert.equal(JSON.stringify(vm).includes('elementCount'), false);         // G-EC never displayed (AC-P12)
});

test('AC-P3: a running ViewModel offers progress counters and elapsed time, no list and no ETA-like field', () => {
  const vm = buildViewModel(input({ phase: 'running' }));
  assert.equal(vm.results.state, 'running');
  assert.deepEqual(vm.results.rows, []);
  assert.deepEqual(keys(vm.run.progress), ['caveatCount', 'elapsedText', 'fraction', 'resultsFound', 'unitsEvaluated', 'unitsTotal']);
  assert.equal(vm.run.progress.elapsedText, '1:05');
  assert.equal(vm.run.canStop, true);
  assert.equal(/\b(eta|remaining|throughput)\b/i.test(JSON.stringify(vm.run)), false);
});

test('AC-P2: every terminal status × coverage × integrity × freshness (empty and non-empty) has a matrix headline, never bare "No clashes"', () => {
  let combos = 0;
  for (const status of ['completed', 'cancelled', 'failed', 'invalidated']) {
    for (const coverage of ['full', 'partial']) {
      for (const integrity of ['clean', 'caveated']) {
        for (const freshness of ['current', 'stale', 'unverifiable']) {
          for (const n of [0, 2]) {
            const results = n === 0 ? [] : [{ a: ['mA', 1], b: ['mB', 10] }, { a: ['mA', 2], b: ['mB', 10] }];
            const reasons = status === 'failed' ? ['unit:extraction-limit'] : [];
            const set = makeSet({ runId: 'run-1', status, coverage, integrity, freshness, reasons, results });
            const vm = buildViewModel(input({ phase: 'done', set, list: listFor(set), freshness: { state: freshness, reasons: [] }, claim: claimFor(set) }));
            const expected = runHeadline({ status, total: n, coverage, resultSet: set });
            assert.equal(vm.run.headline, expected, `${status}/${coverage}/${integrity}/${freshness}/${n}`);
            assert.ok(vm.run.headline.length > 0);
            assert.equal(vm.run.doneKind, status);
            assert.deepEqual([vm.run.badges.coverage.value, vm.run.badges.integrity.value, vm.run.badges.freshness.value], [coverage, integrity, freshness]);
            if (n === 0) {
              const claimed = claimFor(set).allowed;
              assert.equal(vm.results.state, claimed ? 'empty-claim' : 'empty-nonclaim');
              if (!claimed) assert.ok(vm.results.lines.length > 0, 'a non-claim names at least one failed conjunct');
            } else {
              assert.equal(vm.results.state, 'list');
            }
            if (freshness !== 'current') assert.ok(vm.run.banners.some((b) => b.id === 'stale'));
            assertNoBareNoClashes(vm);
            combos += 1;
          }
        }
      }
    }
  }
  assert.equal(combos, 96);
});

test('results.state covers before-run, running, list, empty-claim, empty-nonclaim, empty-filtered, grouping-unavailable and error', () => {
  const two = makeSet({ runId: 'run-1', results: [{ a: ['mA', 1], b: ['mB', 10] }, { a: ['mA', 2], b: ['mB', 10] }] });
  const empty = makeSet({ runId: 'run-1', results: [] });
  const cases = [
    ['before-run', input()],
    ['running', input({ phase: 'running' })],
    ['list', input({ phase: 'done', set: two, list: listFor(two) })],
    ['empty-claim', input({ phase: 'done', set: empty, list: listFor(empty), claim: claimFor(empty) })],
    ['empty-nonclaim', input({ phase: 'done', set: empty, list: listFor(empty), claim: { ...claimFor(empty), allowed: false, unqualified: false } })],
    ['empty-filtered', input({ phase: 'done', set: two, list: listFor(two, { filtered: 0, rows: [] }) })],
    ['grouping-unavailable', input({ phase: 'done', set: two, list: listFor(two, { groupBy: 'element', groupingState: 'unavailable', groupingReason: 'too-large' }) })],
    ['error', input({ phase: 'done', set: null })],
  ];
  for (const [state, vmInput] of cases) {
    const vm = buildViewModel(vmInput);
    assert.equal(vm.results.state, state, state);
    if (state !== 'list') assert.ok(typeof vm.results.message === 'string' && vm.results.message.length > 0, `${state} has a message`);
    assertNoBareNoClashes(vm);
  }
  const pending = buildViewModel(input({ phase: 'done', set: empty, list: listFor(empty), claim: null }));
  assert.equal(pending.results.state, 'empty-nonclaim');                   // a pending claim is never worded as a claim
  const grouping = buildViewModel(cases[6][1]);
  assert.equal(grouping.filters.groupingNote, 'Grouping unavailable for a set this large — showing the flat list.');
  assert.equal(grouping.results.rows.length, 2);                           // the flat list is still shown
});

test('H1 (the view-model owns the claim/freshness pair): an allowed claim renders only from a settled pair whose freshness is current', () => {
  const empty = makeSet({ runId: 'run-1', results: [] });
  const allowed = claimFor(empty);
  assert.equal(allowed.allowed, true, 'control: Core would allow this claim');
  const vmOf = (over) => buildViewModel(input({ phase: 'done', set: empty, list: listFor(empty), ...over }));
  assert.deepEqual([vmOf({ claim: allowed }).results.state, vmOf({ claim: allowed }).results.message], ['empty-claim', STATEMENTS.CLAIM]);   // allowed + current
  for (const state of ['stale', 'unverifiable']) {                                                       // allowed + not current ⇒ forbidden
    const vm = vmOf({ claim: allowed, freshness: { state, reasons: ['scope-drift'] } });
    assert.deepEqual([vm.results.state, vm.results.message], ['empty-nonclaim', STATEMENTS.NON_CLAIM], state);
    assert.equal(vm.results.lines[0], STATEMENTS.STALE);
    assertNoBareNoClashes(vm);
  }
  const freshnessPending = vmOf({ claim: allowed, freshness: null });                                     // one half pending ⇒ "checking…"
  assert.deepEqual([freshnessPending.results.state, freshnessPending.results.message], ['empty-nonclaim', STATEMENTS.CLAIM_PENDING]);
  const claimPending = vmOf({ claim: allowed, claimPending: true });
  assert.deepEqual([claimPending.results.state, claimPending.results.message], ['empty-nonclaim', STATEMENTS.CLAIM_PENDING]);
  const denied = vmOf({ claim: { ...allowed, allowed: false, unqualified: false } });                     // disallowed + current ⇒ forbidden
  assert.equal(denied.results.state, 'empty-nonclaim');
  for (const vm of [freshnessPending, claimPending, denied]) assertNoBareNoClashes(vm);
});

test('selected actions: enable/disable reasons for no live side, isolation prerequisite and toggles', () => {
  const set = makeSet({ runId: 'run-1', results: [{ a: ['mA', 1], b: ['mB', 10] }] });
  const base = {
    resultId: 'r0', ordinal: 1, side1: { modelKey: 'mA', modelName: 'Architecture', label: '#1', dbId: 1 }, side2: { modelKey: 'mB', modelName: 'Structure', label: '#10', dbId: 10 },
    gap: null, hasLocation: false, liveness: 'model not loaded', notes: [], hiddenByFilters: true, anyLive: false,
    isolation: { available: false, reason: 'Some elements are hidden — show all to enable isolation' }, toggles: { focusOnSelect: false, isolate: true, markers: true },
  };
  let vm = buildViewModel(input({ phase: 'done', set, list: listFor(set), selected: base }));
  assert.deepEqual(vm.selected.actions.focus, { enabled: false, reason: 'Viewer actions are unavailable: model not loaded.' });
  assert.deepEqual(vm.selected.actions.isolate, { enabled: false, checked: false, reason: 'Viewer actions are unavailable: model not loaded.' });
  assert.deepEqual(vm.selected.actions.backToAll, { enabled: true });
  assert.equal(vm.selected.hiddenByFilters, true);
  vm = buildViewModel(input({ phase: 'done', set, list: listFor(set), selected: { ...base, anyLive: true, liveness: 'live' } }));
  assert.deepEqual(vm.selected.actions.focus, { enabled: true, reason: null });
  assert.deepEqual(vm.selected.actions.isolate, { enabled: false, checked: false, reason: 'Some elements are hidden — show all to enable isolation' });
  assert.deepEqual(vm.selected.actions.markers, { enabled: true, checked: true, reason: null });
  assert.deepEqual(vm.selected.actions.focusOnSelect, { checked: false });
});

test('run.details (§8.4): null before a set; plain-string lines from the sealed set; hostile names raw; no elementCount', () => {
  assert.equal(buildViewModel(input()).run.details, null);
  const hostile = '<img src=x onerror=alert(1)>';
  const set = makeSet({ runId: 'run-1', results: [{ a: ['mA', 1], b: ['mB', 10] }] });
  const vmInput = input({ phase: 'done', set, list: listFor(set) });
  vmInput.setup.modelName = (k) => (k === 'mA' ? hostile : 'Structure');
  const vm = buildViewModel(vmInput);
  assert.ok(vm.run.details.lines.some((l) => l.label === `Model ${hostile}`));
  assert.ok(vm.run.details.lines.every((l) => typeof l.label === 'string' && typeof l.value === 'string'));
  assert.equal(JSON.stringify(vm.run.details).includes('999999'), false);   // provenance.models[].elementCount (G-EC)
  assert.equal(vm.run.details.lines.some((l) => l.label.startsWith('Measurement basis')), false);   // Hard run
});

test('run.details shows the Soft basis verdict captured when the run was admitted, not the current one', async () => {
  const h = makeHarness({ basis: { state: 'verified', basisKey: 'shared-frame' } });
  await h.readyHard();
  await h.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  await h.runToDone(makeSet({ runId: 'run-1', mode: 'clearance', clearance: 0.05, results: [{ a: ['mA', 1], b: ['mB', 10], distance: 0.01 }] }));
  h.catalog.setBasis({ state: 'incompatible', reason: 'frames differ' });  // the verdict changes after the run
  h.catalog.fire();
  await h.settle();
  const basis = h.vm().run.details.lines.find((l) => l.label === 'Measurement basis (at run start)');
  assert.equal(basis.value, 'verified (shared-frame)');
  assert.equal(h.vm().setup.softAvailability.available, false);           // the live setup verdict did change
});

test('§6.2 step 4: while Soft is unavailable the hidden clearance field is not asked for; the explanation stays and Run stays blocked', async () => {
  const h = makeHarness({ basis: { state: 'incompatible', reason: 'frames differ' } });
  await h.readyHard();
  await h.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await h.settle();
  const setup = h.vm().setup;
  assert.equal(setup.softAvailability.available, false);
  assert.equal(setup.clearance.visible, false);
  assert.equal(setup.clearance.error, null);
  assert.equal(setup.validation.state, 'blocked');
  assert.equal(setup.validation.messages.some((m) => m.control === 'clearance'), false);
  assert.equal(setup.validation.messages.some((m) => m.control === 'mode' && m.text.includes('frames differ')), true);
  // Soft available (verified basis): an empty clearance is still asked for, next to its visible field.
  const v = makeHarness({ basis: { state: 'verified', basisKey: 'shared-frame' } });
  await v.readyHard();
  await v.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await v.settle();
  assert.equal(v.vm().setup.clearance.visible, true);
  assert.equal(v.vm().setup.validation.messages.some((m) => m.control === 'clearance'), true);
});

test('statusLive: headline + filtered count + pending freshness + an extra error; plain text for aria-live', () => {
  const run = {
    headline: 'Completed — 12 clashes', counts: { total: 12, filtered: 5 }, badges: { freshness: { pending: true } },
    banners: [{ id: 'x', kind: 'error', text: 'Something failed.' }, { id: 'y', kind: 'info', text: 'ignored' }],
  };
  assert.equal(describeStatusLive(run), 'Completed — 12 clashes. 5 of 12 clashes match the filters. Checking freshness. Something failed.');
  assert.equal(describeStatusLive({ headline: 'Planning…', counts: { total: null, filtered: null }, badges: null, banners: [] }), 'Planning.');
  const vm = buildViewModel(input({ phase: 'running' }));
  assert.equal(vm.run.statusLive, describeStatusLive(vm.run));
});
