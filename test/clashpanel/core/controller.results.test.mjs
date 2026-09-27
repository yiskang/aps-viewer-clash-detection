// test/clashpanel/core/controller.results.test.mjs — Task 17: results pipeline (spec §7.3, §7.5, §8, §10, §12;
// AC-P2, AC-P4, AC-P15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { GroupingTooLargeError } from '../../../clashtest/index.js';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { PAGE_SIZE, FILTER_DEBOUNCE_MS } from '../../../clashpanel/core/constants.js';
import { runHeadline, STATEMENTS } from '../../../clashpanel/core/runReport.js';
import { GROUPING_UNAVAILABLE_TEXT, MULTI_VALUED_NOTE } from '../../../clashpanel/core/grouping.js';
import { buildRunDetails } from '../../../clashpanel/core/viewModel.js';
import { FILTER_MASK_UNAVAILABLE_TEXT } from '../../../clashpanel/core/filters.js';
import { makeHarness, makeSet, hardResults } from '../support/controllerHarness.mjs';

const allStrings = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out);
  return out;
};

async function doneWith(set, opts) {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(set, opts);
  return h;
}

test('after a sealed set: index, first page, counts, headline, axis badges; summarize runs before the mask', async () => {
  const set = makeSet({ runId: 'run-1', results: hardResults(120) });
  const h = await doneWith(set);
  const vm = h.vm();
  assert.equal(vm.results.state, 'list');
  assert.equal(vm.results.rows.length, PAGE_SIZE);
  assert.deepEqual(vm.results.page, { index: 0, count: 3, size: PAGE_SIZE });
  assert.deepEqual(vm.run.counts, { total: 120, filtered: 120 });
  assert.equal(vm.run.headline, runHeadline({ status: 'completed', total: 120, coverage: 'full', resultSet: set }));
  assert.deepEqual([vm.run.badges.coverage.value, vm.run.badges.integrity.value, vm.run.badges.freshness.value], ['full', 'clean', 'current']);
  assert.equal(vm.run.badges.freshness.pending, false);
  const row = vm.results.rows[0];
  assert.deepEqual([row.ordinal, row.side1.modelName, row.side1.label, row.side2.modelName, row.gap, row.liveness], [1, 'Architecture', 'A-1000', 'Structure', null, 'live']);
  assert.equal(vm.results.rows[3].badges.includes('caveated'), true);      // hardResults: i % 7 === 3 is caveated
  assert.equal(vm.results.rows[9].badges.includes('no location'), true);
  const firstSummarize = h.engine.control.summarize.args.length;
  assert.equal(firstSummarize, 1);
  assert.equal(h.engine.control.summarize.successes, 1);
  assert.equal(h.engine.control.filter.successes, 1);
  assert.equal(h.engine.control.groupBy.calls, 0);                         // grouping only on demand
});

test('AC-P4: 50 filter/sort/group/page interactions — no startRun, no Viewer call, no per-interaction derivation', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(300) }));
  const bridgeCalls = h.bridge.calls.length;
  const intents = [
    { type: INTENT.FILTER_UNVERIFIED, value: true }, { type: INTENT.FILTER_UNVERIFIED, value: false },
    { type: INTENT.FILTER_HAS_LOCATION, value: true }, { type: INTENT.FILTER_HAS_LOCATION, value: false },
    { type: INTENT.FILTER_MODEL, value: ['mA'] }, { type: INTENT.FILTER_MODEL, value: [] },
    { type: INTENT.GROUP_MODE, value: 'element' }, { type: INTENT.SORT_SET, value: 'group-count' },
    { type: INTENT.SORT_SET, value: 'group-label' }, { type: INTENT.GROUP_MODE, value: 'none' },
    { type: INTENT.NAV_PAGE, page: 2 }, { type: INTENT.NAV_PAGE, page: 0 },
    { type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mB', dbId: 2000 } }, { type: INTENT.FILTER_CLEAR },
  ];
  let n = 0;
  while (n < 50) {
    for (const intent of intents) { if (n >= 50) break; await h.dispatch(intent); n += 1; }
    await h.dispatch({ type: INTENT.FILTER_TEXT, value: `a-10${n % 10}` });
    await h.scheduler.advance(FILTER_DEBOUNCE_MS);
    await h.settle();
    n += 1;
  }
  assert.equal(h.engine.startCalls.length, 1);
  assert.equal(h.bridge.calls.length, bridgeCalls);                        // filters never touch the Viewer
  assert.equal(h.engine.control.summarize.successes, 1);
  assert.equal(h.engine.control.filter.successes, 1);                      // the one cached caveated mask
  assert.equal(h.engine.control.groupBy.successes, 1);                     // one groupBy per (generation, spec)
  assert.deepEqual(h.engine.forbidden, []);                                // no getPairStatus/getElementStatus
});

test('filters: debounced text, model, has-location, unverified mask, element-only, clear', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(100) }));
  await h.dispatch({ type: INTENT.FILTER_TEXT, value: '#1005' });
  assert.equal(h.vm().filters.text, '#1005');                              // the draft shows immediately
  assert.equal(h.vm().run.counts.filtered, 100);                           // not applied before the debounce
  await h.scheduler.advance(FILTER_DEBOUNCE_MS);
  await h.settle();
  assert.equal(h.vm().run.counts.filtered, 1);
  assert.equal(h.vm().filters.active, true);
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  assert.equal(h.vm().run.counts.filtered, 100);
  assert.equal(h.vm().filters.text, '');

  await h.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });
  assert.equal(h.vm().run.counts.filtered, 90);                            // every 10th has no witness
  await h.dispatch({ type: INTENT.FILTER_UNVERIFIED, value: true });
  assert.ok(h.vm().results.rows.every((r) => r.badges.includes('caveated') && !r.badges.includes('no location')));
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  await h.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mB', dbId: 2001 } });
  assert.deepEqual(h.vm().filters.elementOnly, { modelKey: 'mB', dbId: 2001, label: 'Structure · B-2001' });
  assert.ok(h.vm().results.rows.every((r) => r.side2.dbId === 2001));
  await h.dispatch({ type: INTENT.FILTER_MODEL, value: ['mZ'] });
  assert.equal(h.vm().results.state, 'empty-filtered');
  assert.equal(h.vm().results.message, 'No clashes match the current filters.');
});

test('text filter matches element names only after the sliced label index is built', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(30) }));
  await h.dispatch({ type: INTENT.FILTER_TEXT, value: 'a-1007' });
  await h.scheduler.advance(FILTER_DEBOUNCE_MS);
  await h.settle();
  assert.equal(h.vm().run.counts.filtered, 1);
  assert.equal(h.vm().results.rows[0].side1.label, 'A-1007');
});

test('Soft: gap column, gap-asc sort option, max-gap validation against the run clearance', async () => {
  const results = [{ a: ['mA', 1], b: ['mB', 10], distance: 0.04 }, { a: ['mA', 2], b: ['mB', 11], distance: 0.01 }, { a: ['mA', 3], b: ['mB', 12], distance: 0.02 }];
  const h = await doneWith(makeSet({ runId: 'run-1', mode: 'clearance', clearance: 0.05, results }));
  let vm = h.vm();
  assert.equal(vm.filters.maxGap.visible, true);
  assert.equal(vm.filters.maxGap.max, 0.05);
  assert.deepEqual(vm.filters.sortOptions.map((o) => o.value), ['default', 'gap-asc']);
  assert.deepEqual(vm.results.rows.map((r) => r.gap), ['0.040 scene units', '0.010 scene units', '0.020 scene units']);
  await h.dispatch({ type: INTENT.SORT_SET, value: 'gap-asc' });
  assert.deepEqual(h.vm().results.rows.map((r) => r.ordinal), [2, 3, 1]);
  await h.dispatch({ type: INTENT.FILTER_MAX_GAP, value: '0.2' });
  vm = h.vm();
  assert.ok(vm.filters.maxGap.error);                                       // above the run clearance: rerun needed
  assert.equal(vm.run.counts.filtered, 3);
  await h.dispatch({ type: INTENT.FILTER_MAX_GAP, value: '0.02' });
  assert.equal(h.vm().filters.maxGap.error, null);
  assert.equal(h.vm().run.counts.filtered, 2);
});

test('Group by Element: one groupBy, group headers with n of m, multi-valued note, expand/collapse keeps the page', async () => {
  const results = [{ a: ['mA', 1], b: ['mB', 10] }, { a: ['mA', 2], b: ['mB', 10] }, { a: ['mA', 3], b: ['mB', 11] }];
  const h = await doneWith(makeSet({ runId: 'run-1', results }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  let vm = h.vm();
  assert.equal(vm.results.view, 'grouped');
  assert.equal(vm.results.multiValuedNote, MULTI_VALUED_NOTE);
  assert.deepEqual(vm.results.rows.map((r) => [r.kind, r.label, r.count]), [
    ['group', 'Architecture · A-1', 1], ['group', 'Architecture · A-2', 1], ['group', 'Architecture · A-3', 1],
    ['group', 'Structure · B-10', 2], ['group', 'Structure · B-11', 1]]);
  const b10 = vm.results.rows[3].groupId;
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: b10 });
  vm = h.vm();
  assert.deepEqual(vm.results.rows.slice(3, 6).map((r) => [r.kind, r.resultId ?? null, r.groupId]), [['group', null, b10], ['result', 'r0', b10], ['result', 'r1', b10]]);
  assert.equal(vm.results.rows[4].key, `${b10}|r0`);
  await h.dispatch({ type: INTENT.FILTER_MODEL, value: ['mB'] });
  await h.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'none' });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  assert.equal(h.engine.control.groupBy.successes, 1);
  assert.deepEqual(h.vm().filters.sortOptions.map((o) => o.value), ['default', 'group-count', 'group-label']);
});

test('grouping too large ⇒ flat list with the fixed note (state grouping-unavailable)', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(makeSet({ runId: 'run-1', results: hardResults(5) }));
  h.engine.control.groupBy.failNext.push(new GroupingTooLargeError({ limit: 4, observed: 10 }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  const vm = h.vm();
  assert.equal(vm.results.state, 'grouping-unavailable');
  assert.equal(vm.filters.groupingNote, GROUPING_UNAVAILABLE_TEXT['too-large']);
  assert.equal(vm.filters.groupingNote, 'Grouping unavailable for a set this large — showing the flat list.');
  assert.equal(vm.results.view, 'flat');
  assert.equal(vm.results.rows.length, 5);
});

test('pagination clamps; freshness is async ("checking" while pending) and re-checked on Panel show and catalog change', async () => {
  const h = makeHarness();
  await h.readyHard();
  h.engine.control.getFreshness.manual = true;
  await h.runToDone(makeSet({ runId: 'run-1', results: hardResults(120) }));
  let vm = h.vm();
  assert.equal(vm.run.badges.freshness.pending, true);
  h.engine.control.getFreshness.resolveNext({ state: 'stale', reasons: ['scope-drift'] });
  await h.settle();
  vm = h.vm();
  assert.equal(vm.run.badges.freshness.value, 'stale');
  assert.equal(vm.run.badges.freshness.pending, false);
  assert.ok(vm.run.banners.some((b) => b.id === 'stale'));
  await h.dispatch({ type: INTENT.PANEL_SHOWN });
  assert.equal(h.engine.control.getFreshness.calls, 2);
  assert.equal(h.vm().run.badges.freshness.pending, true);
  h.catalog.fire();
  await h.settle();
  assert.equal(h.engine.control.getFreshness.calls, 3);
  h.engine.control.getFreshness.resolveNext({ state: 'current', reasons: [] });   // superseded (older) check
  await h.settle();
  assert.equal(h.vm().run.badges.freshness.pending, true);
  h.engine.control.getFreshness.resolveAll({ state: 'current', reasons: [] });
  await h.settle();
  assert.equal(h.vm().run.badges.freshness.value, 'current');
  await h.dispatch({ type: INTENT.NAV_PAGE, page: 99 });
  assert.equal(h.vm().results.page.index, 2);
  await h.dispatch({ type: INTENT.NAV_PAGE, page: -3 });
  assert.equal(h.vm().results.page.index, 0);
});

test('AC-P2: empty completed/full/clean/current with an allowed claim ⇒ claim statement; otherwise a non-claim — never bare "No clashes"', async () => {
  const claimed = await doneWith(makeSet({ runId: 'run-1', results: [] }));
  let vm = claimed.vm();
  assert.equal(vm.results.state, 'empty-claim');
  assert.equal(vm.results.message, STATEMENTS.CLAIM);
  assert.equal(claimed.engine.control.assessNoClashClaim.calls, 1);

  const partial = await doneWith(makeSet({ runId: 'run-1', results: [], coverage: 'partial' }));
  vm = partial.vm();
  assert.equal(vm.results.state, 'empty-nonclaim');
  assert.ok(vm.results.lines.length > 0);
  for (const h of [claimed, partial]) {
    for (const s of allStrings(h.vm())) assert.notEqual(s.trim(), 'No clashes');
  }
  const withResults = await doneWith(makeSet({ runId: 'run-1', results: hardResults(2) }));
  assert.equal(withResults.engine.control.assessNoClashClaim.calls, 0);    // results ≠ ∅: no claim wording needed
});

test('H1 claim gate: an allowed claim is never worded while EITHER read is pending, whichever read lands first', async () => {
  const ALLOWED = { allowed: true, unqualified: true, qualifiers: [], exclusions: [], proofMethod: 'bracketed-digest' };
  const CURRENT = { state: 'current', reasons: [] };
  const held = async () => {
    const h = makeHarness();
    await h.readyHard();
    h.engine.control.getFreshness.manual = true;
    h.engine.control.assessNoClashClaim.manual = true;
    const seen = [];
    h.controller.subscribe((vm) => seen.push(vm.results.state));
    await h.runToDone(makeSet({ runId: 'run-1', results: [] }));
    assert.equal(h.engine.control.getFreshness.pending.length, 1);
    assert.equal(h.engine.control.assessNoClashClaim.pending.length, 1);
    return { h, seen };
  };
  // (1) claim lands first (freshness still pending): pending wording, badge still "checking", NOT the claim.
  const a = await held();
  a.h.engine.control.assessNoClashClaim.resolveNext(ALLOWED);
  await a.h.settle();
  assert.equal(a.h.vm().results.state, 'empty-nonclaim');
  assert.equal(a.h.vm().results.message, STATEMENTS.CLAIM_PENDING);
  assert.equal(a.h.vm().run.badges.freshness.pending, true);
  assert.ok(!a.seen.includes('empty-claim'), 'no claim was ever published while freshness was pending');
  a.h.engine.control.getFreshness.resolveNext(CURRENT);
  await a.h.settle();
  assert.equal(a.h.vm().results.state, 'empty-claim');                       // both complete ∧ allowed ∧ current
  assert.equal(a.h.vm().results.message, STATEMENTS.CLAIM);
  assert.equal(a.h.vm().run.badges.freshness.value, 'current');
  // (2) freshness lands first (claim still pending): the badge does not move until the pair lands, and no claim yet.
  const b = await held();
  b.h.engine.control.getFreshness.resolveNext(CURRENT);
  await b.h.settle();
  assert.equal(b.h.vm().results.message, STATEMENTS.CLAIM_PENDING);
  assert.equal(b.h.vm().run.badges.freshness.pending, true);
  assert.ok(!b.seen.includes('empty-claim'));
  b.h.engine.control.assessNoClashClaim.resolveNext(ALLOWED);
  await b.h.settle();
  assert.equal(b.h.vm().results.state, 'empty-claim');
  // (3) the claim read fails (Core error): fail closed even with a current freshness — never a clearance.
  const c = await held();
  c.h.engine.control.assessNoClashClaim.rejectNext(new Error('claim read failed'));
  c.h.engine.control.getFreshness.resolveNext(CURRENT);
  await c.h.settle();
  assert.equal(c.h.vm().results.state, 'empty-nonclaim');
  assert.deepEqual(c.h.vm().results.lines, [STATEMENTS.NO_CONFIRMATION]);
  assert.ok(!c.seen.includes('empty-claim'));
});

test('H1 claim gate (adverse ordering): claim allowed at t1 but freshness stale at t2 ⇒ stale wording, in either resolution order, never the claim', async () => {
  const ALLOWED = { allowed: true, unqualified: true, qualifiers: [], exclusions: [], proofMethod: 'bracketed-digest' };
  const STALE = { state: 'stale', reasons: ['scope-drift'] };
  for (const order of ['claim-then-freshness', 'freshness-then-claim']) {
    const h = makeHarness();
    await h.readyHard();
    h.engine.control.getFreshness.manual = true;
    h.engine.control.assessNoClashClaim.manual = true;
    const seen = [];
    h.controller.subscribe((vm) => seen.push([vm.results.state, vm.results.message]));
    await h.runToDone(makeSet({ runId: 'run-1', results: [] }));
    if (order === 'claim-then-freshness') {
      h.engine.control.assessNoClashClaim.resolveNext(ALLOWED);              // the earlier assessment: allowed
      h.engine.control.getFreshness.resolveNext(STALE);                      // the later read: the model moved in between
    } else {
      h.engine.control.getFreshness.resolveNext(STALE);
      h.engine.control.assessNoClashClaim.resolveNext(ALLOWED);
    }
    await h.settle();
    const vm = h.vm();
    assert.equal(vm.results.state, 'empty-nonclaim', order);
    assert.equal(vm.results.message, STATEMENTS.NON_CLAIM, order);
    assert.equal(vm.results.lines[0], STATEMENTS.STALE, order);
    assert.equal(vm.run.badges.freshness.value, 'stale', order);
    assert.ok(vm.run.banners.some((b) => b.id === 'stale'), order);
    assert.ok(!seen.some(([state, message]) => state === 'empty-claim' || message === STATEMENTS.CLAIM), `${order}: the claim was never published`);
    for (const str of allStrings(vm)) assert.notEqual(str.trim().replace(/[.!]$/, ''), 'No clashes');
  }
});

test('H1 claim gate: a held claim is withdrawn synchronously when a re-check starts, and a superseded pair never commits', async () => {
  const ALLOWED = { allowed: true, unqualified: true, qualifiers: [], exclusions: [], proofMethod: 'bracketed-digest' };
  const STALE = { state: 'stale', reasons: ['scope-drift'] };
  const h = await doneWith(makeSet({ runId: 'run-1', results: [] }));       // auto-resolving reads: allowed + current
  assert.equal(h.vm().results.state, 'empty-claim');
  h.engine.control.getFreshness.manual = true;
  h.engine.control.assessNoClashClaim.manual = true;
  const seen = [];
  h.controller.subscribe((vm) => seen.push(vm.results.state));
  h.catalog.fire();                                                           // a model change ⇒ re-check
  assert.equal(h.vm().results.state, 'empty-nonclaim');                       // BEFORE any read lands: the old claim is gone
  assert.equal(h.vm().results.message, STATEMENTS.CLAIM_PENDING);
  await h.settle();
  h.catalog.fire();                                                           // a second event supersedes the first check
  await h.settle();
  assert.equal(h.engine.control.getFreshness.pending.length, 2);              // (the first, aborted pair stays in the fake's list)
  h.engine.control.assessNoClashClaim.resolveAll(ALLOWED);                    // the aborted pair's late claim is a no-op
  h.engine.control.getFreshness.resolveAll(STALE);
  await h.settle();
  assert.equal(h.vm().results.state, 'empty-nonclaim');
  assert.equal(h.vm().results.lines[0], STATEMENTS.STALE);
  assert.ok(!seen.includes('empty-claim'), 'the invalidated claim was never shown again');
});

test('H1 claim gate: a FAILED freshness read is "unverifiable" — never current, never a clearance — even when the claim read says allowed', async () => {
  const ALLOWED = { allowed: true, unqualified: true, qualifiers: [], exclusions: [], proofMethod: 'bracketed-digest' };
  const h = makeHarness();
  await h.readyHard();
  h.engine.control.getFreshness.manual = true;
  h.engine.control.assessNoClashClaim.manual = true;
  const seen = [];
  h.controller.subscribe((vm) => seen.push(vm.results.state));
  await h.runToDone(makeSet({ runId: 'run-1', results: [] }));
  h.engine.control.assessNoClashClaim.resolveNext(ALLOWED);
  h.engine.control.getFreshness.rejectNext(new Error('freshness read failed'));
  await h.settle();
  const vm = h.vm();
  assert.equal(vm.results.state, 'empty-nonclaim');
  assert.equal(vm.results.message, STATEMENTS.NON_CLAIM);
  assert.equal(vm.results.lines[0], STATEMENTS.STALE);
  assert.deepEqual([vm.run.badges.freshness.value, vm.run.badges.freshness.pending], ['unverifiable', false]);
  assert.ok(!seen.includes('empty-claim'), 'no clearance was ever published');
  // A non-empty set needs no claim; a failed freshness read still lands as 'unverifiable' (not pending, not 'current').
  const nonEmpty = makeHarness();
  await nonEmpty.readyHard();
  nonEmpty.engine.control.getFreshness.failNext.push(new Error('freshness read failed'));
  await nonEmpty.runToDone(makeSet({ runId: 'run-1', results: hardResults(2) }));
  assert.deepEqual([nonEmpty.vm().run.badges.freshness.value, nonEmpty.vm().run.badges.freshness.pending], ['unverifiable', false]);
});

test('freshness re-checks never accumulate abort listeners on the generation signal (completed AND superseded checks)', async () => {
  const created = [];
  const RealAbortController = globalThis.AbortController;
  globalThis.AbortController = class extends RealAbortController { constructor() { super(); created.push(this); } };
  try {
    const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(2) }));
    const before = created.slice();                                          // every controller that exists before the burst
    const count = (ac) => getEventListeners(ac.signal, 'abort').length;
    const base = new Map(before.map((ac) => [ac, count(ac)]));
    // Net listener growth on the pre-burst signals that are still live (the generation signal is one of them; a
    // superseded check's own controller is aborted, so it is not counted).
    const growth = () => before.filter((ac) => !ac.signal.aborted).reduce((n, ac) => n + count(ac) - base.get(ac), 0);
    for (let i = 0; i < 40; i += 1) { h.catalog.fire(); await h.settle(); }   // 40 completed re-checks
    assert.equal(growth(), 0, 'completed checks leave no listener behind');
    h.engine.control.getFreshness.manual = true;                              // superseded (never-completing) checks
    for (let i = 0; i < 40; i += 1) { h.catalog.fire(); await h.settle(); }
    assert.ok(growth() <= 1, `only the newest pending check may listen (growth ${growth()})`);
    h.engine.control.getFreshness.resolveAll({ state: 'current', reasons: [] });
    await h.settle();
    assert.equal(growth(), 0, 'once the last check settles nothing is left');
  } finally {
    globalThis.AbortController = RealAbortController;
  }
});

test('AC-P15: late summarize / mask / freshness / claim / groupBy from a superseded generation never change the display', async () => {
  const h = makeHarness();
  await h.readyHard();
  for (const name of ['summarize', 'filter', 'getFreshness', 'assessNoClashClaim']) h.engine.control[name].manual = true;
  await h.runToDone(makeSet({ runId: 'run-1', results: [] }));
  assert.equal(h.vm().results.state, 'empty-nonclaim');                   // claim pending ⇒ never a claim yet
  h.engine.control.summarize.manual = false;
  h.engine.control.filter.manual = false;
  h.engine.control.getFreshness.manual = false;
  h.engine.control.assessNoClashClaim.manual = false;
  // Supersede: a new run is admitted while run-1's reads/derivations are still pending.
  const handle2 = await h.start();
  handle2.emitState({ status: 'planning', phase: 'enumerating' });
  await h.settle();
  const during = h.vm();
  h.engine.control.getFreshness.resolveAll({ state: 'stale', reasons: ['late'] });
  h.engine.control.assessNoClashClaim.resolveAll();
  await h.settle();
  assert.equal(h.vm(), during);                                            // nothing committed from generation 1
  assert.equal(h.engine.resident.has('run-1'), false);                     // run-1's set was still released
  handle2.finish({ status: 'completed', resultSet: makeSet({ runId: handle2.runId, results: hardResults(3) }) });
  await h.settle();
  assert.equal(h.vm().run.badges.freshness.value, 'current');
  assert.equal(h.vm().results.rows.length, 3);
});

test('run details (§8.4): sealed-set facts + the basis verdict captured at run start; never elementCount; raw names', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const soft = makeSet({ runId: 'run-1', mode: 'clearance', clearance: 0.05, results: [] });
  const lines = buildRunDetails({ resultSet: soft, runRecord: { basisVerdict: { state: 'verified', basisKey: 'shared-m' } }, modelName: (k) => (k === 'mA' ? hostile : 'Structure') });
  assert.deepEqual(lines.map((l) => l.label), ['Test', 'Mode', 'Clearance', 'Started', 'Finished', 'Determinism', `Model ${hostile}`, 'Model Structure', 'Library exclusions', 'Measurement basis (at run start)']);
  assert.deepEqual(lines.slice(0, 3).map((l) => l.value), ['Clash test 1', 'Soft (clearance)', '0.05']);
  assert.equal(lines[6].value, 'key mA · version v1 · binding generation 1');
  assert.equal(lines.at(-1).value, 'verified (shared-m)');
  assert.ok(lines.every((l) => typeof l.label === 'string' && typeof l.value === 'string'));
  assert.equal(JSON.stringify(lines).includes('999999'), false);          // makeSet's provenance elementCount (G-EC)
  const hard = buildRunDetails({ resultSet: makeSet({ runId: 'run-2' }) });
  assert.equal(hard.some((l) => l.label === 'Clearance' || l.label.startsWith('Measurement basis')), false);
  assert.equal(buildRunDetails({ resultSet: soft, runRecord: { basisVerdict: null } }).at(-1).value, 'single model (no cross-model comparison)');
  assert.equal(buildRunDetails({ resultSet: soft, runRecord: { basisVerdict: { state: 'unverified', reason: 'units differ' } } }).at(-1).value, 'unverified: units differ');
});

test('RF-2: duplicate model names stay distinguishable in rows, model filter options and group labels', async () => {
  const h = makeHarness({ displayNames: { mA: 'Model', mB: 'Model' } });
  await h.readyHard();
  await h.runToDone(makeSet({ runId: 'run-1', results: [{ a: ['mA', 1], b: ['mB', 10] }] }));
  let vm = h.vm();
  assert.deepEqual([vm.results.rows[0].side1.modelName, vm.results.rows[0].side2.modelName], ['Model · …mA', 'Model · …mB']);
  assert.deepEqual(vm.filters.modelOptions.map((o) => o.label), ['Model · …mA', 'Model · …mB']);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  vm = h.vm();
  assert.deepEqual(vm.results.rows.map((r) => r.label), ['Model · …mA · A-1', 'Model · …mB · B-10']);
});

test('unverified filter: a PENDING mask keeps the committed list (busy) until it lands; an UNAVAILABLE mask is an explicit error, never an empty list', async () => {
  const h = makeHarness();
  await h.readyHard();
  h.engine.control.filter.manual = true;
  await h.runToDone(makeSet({ runId: 'run-1', results: hardResults(20) }));
  await h.dispatch({ type: INTENT.FILTER_UNVERIFIED, value: true });
  let vm = h.vm();
  assert.equal(vm.filters.busy, true);
  assert.equal(vm.run.counts.filtered, 20);                                 // previous list kept while pending
  assert.equal(vm.results.rows.length, 20);
  h.engine.control.filter.resolveNext();
  await h.settle();
  vm = h.vm();
  assert.equal(vm.filters.busy, false);
  assert.equal(vm.run.counts.filtered, 3);                                  // hardResults: i % 7 === 3 ⇒ r3, r10, r17
  assert.ok(vm.results.rows.every((r) => r.badges.includes('caveated')));

  const f = makeHarness();
  await f.readyHard();
  f.engine.control.filter.failNext.push(new Error('derivation failed'));    // the mask derivation rejects (not busy ⇒ no retry)
  await f.runToDone(makeSet({ runId: 'run-1', results: hardResults(20) }));
  await f.dispatch({ type: INTENT.FILTER_UNVERIFIED, value: true });
  vm = f.vm();
  assert.equal(vm.results.state, 'error');
  assert.equal(vm.results.message, FILTER_MASK_UNAVAILABLE_TEXT);
  assert.deepEqual(vm.results.rows, []);
  assert.equal(vm.filters.active, true);
  await f.dispatch({ type: INTENT.FILTER_CLEAR });                          // Clear filters recovers
  vm = f.vm();
  assert.equal(vm.results.state, 'list');
  assert.equal(vm.run.counts.filtered, 20);
  await f.dispatch({ type: INTENT.FILTER_UNVERIFIED, value: true });
  await f.dispatch({ type: INTENT.FILTER_UNVERIFIED, value: false });       // so does turning 'unverified' off
  assert.equal(f.vm().results.state, 'list');
});

test('a filter pass superseded by a newer one never commits', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(50) }));
  const p1 = h.controller.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });
  const p2 = h.controller.dispatch({ type: INTENT.FILTER_MODEL, value: ['mZ'] });
  await Promise.all([p1, p2]);
  await h.settle();
  assert.equal(h.vm().run.counts.filtered, 0);                             // the newer spec (hasLocation + mZ) wins
  assert.equal(h.vm().filters.hasLocation, true);
});

// Carry-forward (T16 review): a RETIRED run's late `persisted` never changes the display (Clear-confirmed and New test).
test('a retired run\'s late persisted outcome changes nothing (Clear confirmed / New test, then persisted resolves)', async () => {
  for (const retire of ['clear', 'newTest']) {
    const h = makeHarness();
    await h.readyHard();
    const handle = await h.runToDone(makeSet({ runId: 'run-1', results: hardResults(3) }), { persistence: { state: 'pending', timedOut: true, attempt: 1 } });
    await h.dispatch({ type: retire === 'clear' ? INTENT.RESULTS_CLEAR : INTENT.SETUP_NEW_TEST });
    assert.ok(h.vm().run.banners.some((b) => b.id === 'confirm-discard-unsaved'), retire);
    await h.dispatch({ type: INTENT.RESULTS_CLEAR_CONFIRMED });
    assert.equal(h.engine.resident.has('run-1'), false, retire);
    const before = h.vm();
    assert.equal(before.results.state, 'before-run', retire);
    handle.resolvePersisted({ state: 'saved' });
    await h.settle();
    assert.equal(h.vm(), before, `${retire}: nothing committed from the retired run`);
    assert.equal(h.engine.resident.has('run-1'), false, retire);
  }
});

// Fix round 1 (review Critical): a re-check must supersede the previous check SYNCHRONOUSLY — the previous check's
// already-queued commit must not re-land the pre-event pair after the invalidating event (k microtask hops apart).
const hops = async (k) => { for (let i = 0; i < k; i += 1) await Promise.resolve(); };

async function raceHarness({ empty }) {
  const h = makeHarness();
  await h.readyHard();
  h.engine.control.getFreshness.manual = true;
  h.engine.control.assessNoClashClaim.manual = true;
  await h.runToDone(makeSet({ runId: 'run-1', results: empty ? [] : hardResults(2) }));
  return h;
}

for (const trigger of ['catalog', 'panel-shown']) {
  test(`H1 claim gate race (${trigger}): the previous check's queued commit never re-publishes its claim after the re-check starts`, async () => {
    const ALLOWED = { allowed: true, unqualified: true, qualifiers: [], exclusions: [], proofMethod: 'bracketed-digest' };
    const CURRENT = { state: 'current', reasons: [] };
    for (let k = 0; k <= 4; k += 1) {
      const h = await raceHarness({ empty: true });
      h.engine.control.getFreshness.resolveNext(CURRENT);                  // check A: freshness lands (half pair)
      await h.settle();
      let fired = false;
      const after = [];
      h.controller.subscribe((vm) => { if (fired) after.push([vm.results.state, vm.results.message, vm.run.badges.freshness.pending]); });
      h.engine.control.assessNoClashClaim.resolveNext(ALLOWED);            // check A: claim resolves; its commit is queued
      await hops(k);
      fired = true;
      if (trigger === 'catalog') h.catalog.fire();
      else void h.controller.dispatch({ type: INTENT.PANEL_SHOWN });
      await h.settle();
      assert.equal(h.engine.control.getFreshness.pending.length, 1, `k=${k}`);   // re-check B is pending
      assert.ok(!after.some(([state, message]) => state === 'empty-claim' || message === STATEMENTS.CLAIM), `k=${k}: ${JSON.stringify(after)}`);
      assert.ok(after.every(([, , pending]) => pending === true), `k=${k}: the badge stays "checking" until B lands`);
      assert.equal(h.vm().results.message, STATEMENTS.CLAIM_PENDING, `k=${k}`);
      h.engine.control.getFreshness.resolveNext(CURRENT);                  // B's own pair lands ⇒ the claim is worded again
      h.engine.control.assessNoClashClaim.resolveNext(ALLOWED);
      await h.settle();
      assert.equal(h.vm().results.state, 'empty-claim', `k=${k}`);
    }
  });
}

test('freshness race (non-empty set): an old "current" never comes back after the re-check starts', async () => {
  for (let k = 0; k <= 4; k += 1) {
    const h = await raceHarness({ empty: false });
    let fired = false;
    const after = [];
    h.controller.subscribe((vm) => { if (fired) after.push([vm.run.badges.freshness.value, vm.run.badges.freshness.pending]); });
    h.engine.control.getFreshness.resolveNext({ state: 'current', reasons: [] });   // check A lands; its commit is queued
    await hops(k);
    fired = true;
    h.catalog.fire();
    await h.settle();
    assert.equal(h.engine.control.getFreshness.pending.length, 1, `k=${k}`);
    assert.ok(after.every(([, pending]) => pending === true), `k=${k}: ${JSON.stringify(after)}`);
    h.engine.control.getFreshness.resolveNext({ state: 'stale', reasons: ['scope-drift'] });
    await h.settle();
    assert.deepEqual([h.vm().run.badges.freshness.value, h.vm().run.badges.freshness.pending], ['stale', false], `k=${k}`);
  }
});
