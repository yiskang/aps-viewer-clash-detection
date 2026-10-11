// test/clashpanel/core/controller.groupPresent.test.mjs — Addendum B1 (spec §27.1, AC-GP1/GP2): the GROUP_PRESENT intent and
// the mutually exclusive `selectedGroupId` selection state; and Addendum B2 (§27.2, AC-GP3/GP4/GP7): the one aggregate
// membership path and the single bridge.presentGroup() call it makes (the real bridge operation is B3); and Addendum B4
// (§27.2 filter paragraph, §27.6, AC-GP9/GP10): refresh and lifecycle rows of the selected group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT, MANAGER_INTENT } from '../../../clashpanel/core/intents.js';
import { buildGroupHeaderRow } from '../../../clashpanel/core/rows.js';
import { createTestsManager } from '../../../clashpanel/core/testsManager.js';
import { FILTER_DEBOUNCE_MS } from '../../../clashpanel/core/constants.js';
import { makeHarness, makeSet, prop, hardResults } from '../support/controllerHarness.mjs';

const pairId = (a, b) => JSON.stringify(['pairModels', {}, [a, b]]);
const AB = pairId('mA', 'mB');
const AA = pairId('mA', 'mA');
const MIXED = [
  { a: ['mA', 1], b: ['mA', 2] },
  { a: ['mA', 3], b: ['mB', 10] },
  { a: ['mA', 4], b: ['mB', 11] },
  { a: ['mB', 12], b: ['mB', 13] },
];

async function grouped() {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(makeSet({ runId: 'run-1', results: MIXED }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  return h;
}
const group = (h, id) => h.vm().results.rows.find((r) => r.kind === 'group' && r.groupId === id);
const selectedGroups = (h) => h.vm().results.rows.filter((r) => r.kind === 'group' && r.selected).map((r) => r.groupId);
const selectedResults = (h) => h.vm().results.rows.filter((r) => r.kind === 'result' && r.selected).map((r) => r.resultId);

test('GROUP_PRESENT is a registered intent with its own value', () => {
  assert.equal(INTENT.GROUP_PRESENT, 'group/present');
  assert.notEqual(INTENT.GROUP_PRESENT, INTENT.GROUP_TOGGLE);
});

test('group header rows are unselected by default and buildGroupHeaderRow carries the selected flag', () => {
  const g = { groupId: 'g1', ref: null, count: 2, filteredCount: 2 };
  assert.equal(buildGroupHeaderRow({ group: g, label: 'L', labels: {}, expanded: false }).selected, false);
  assert.equal(buildGroupHeaderRow({ group: g, label: 'L', labels: {}, expanded: false, selected: true }).selected, true);
  assert.equal(buildGroupHeaderRow({ group: g, label: 'L', labels: {}, expanded: false, selected: 'yes' }).selected, false, 'strictly boolean');
});

test('GROUP_PRESENT selects the group row; it does not expand/collapse the group', async () => {
  const h = await grouped();
  assert.deepEqual(selectedGroups(h), []);
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.deepEqual(selectedGroups(h), [AB]);
  assert.equal(group(h, AB).expanded, false, 'presenting never alters expansion');
  assert.equal(group(h, AA).selected, false);
});

test('GROUP_PRESENT ignores a missing/unknown groupId and the flat view', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  for (const groupId of [undefined, null, 5, 'no-such-group']) {
    await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId });
    assert.deepEqual(selectedGroups(h), [AB], `${String(groupId)} leaves the current group selection alone`);
  }
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'none' });
  const before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.equal(h.vm().results.rows.some((r) => r.kind === 'group'), false);
  assert.equal(h.bridge.calls.length, before, 'the flat view makes no bridge call');
});

test('AC-GP2: GROUP_PRESENT clears the clash selection and its navScope; child selection clears the group', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: AB });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: AB });
  assert.deepEqual(selectedResults(h), ['r1']);
  assert.equal(h.vm().results.nav.scoped, true);
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.deepEqual(selectedResults(h), [], 'the child is no longer selected');
  assert.deepEqual(selectedGroups(h), [AB]);
  assert.equal(h.vm().results.nav.scoped, false, 'navScope cleared with the clash selection');
  assert.equal(h.vm().selected.kind, 'group', 'the group variant replaces the child detail');
  assert.equal(h.vm().selected.resultId, undefined, 'no stale child detail');
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r2', groupId: AB });
  assert.deepEqual(selectedGroups(h), [], 'child selection clears selectedGroupId');
  assert.deepEqual(selectedResults(h), ['r2']);
});

test('AC-GP2: Prev/Next selecting a clash also clears the group selection', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: AB });
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  await h.dispatch({ type: INTENT.NAV_NEXT });
  assert.deepEqual(selectedGroups(h), []);
  assert.equal(selectedResults(h).length, 1);
});

test('AC-GP2: disclosure toggle preserves the group selection (expand and collapse)', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: AB });
  assert.equal(group(h, AB).expanded, true);
  assert.deepEqual(selectedGroups(h), [AB]);
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: AB });
  assert.equal(group(h, AB).expanded, false);
  assert.deepEqual(selectedGroups(h), [AB]);
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: AA });
  assert.deepEqual(selectedGroups(h), [AB], 'toggling a different group preserves it too');
});

test('Back to all and a new results view clear the group selection', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  await h.dispatch({ type: INTENT.ACTION_BACK_TO_ALL });
  assert.deepEqual(selectedGroups(h), []);
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  await h.dispatch({ type: INTENT.RESULTS_CLEAR_CONFIRMED });
  assert.equal(h.vm().results.rows.length, 0);
  await h.runToDone(makeSet({ runId: 'run-2', results: MIXED }));          // a new results view starts with no group selected
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  assert.equal(h.vm().results.rows.some((r) => r.kind === 'group'), true);
  assert.deepEqual(selectedGroups(h), [], 'RESULTS_CLEAR ended the group selection');
});

test('B1 boundary: GROUP_PRESENT is selection state plus exactly one aggregate presentation (never present())', async () => {
  const h = await grouped();
  const before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  const made = h.bridge.calls.slice(before);
  assert.deepEqual(made.map((c) => c.op), ['presentGroup'], 'one aggregate call, no present()/clear()/dispose()');
});

// ── B2: one aggregate membership path (spec §27.2, AC-GP3/GP4/GP7) ─────────────────────────────────────────────────

const elementId = (modelKey, dbId) => JSON.stringify(['element', {}, { dbId, modelKey }]);
const levelOf = { mA: { 1: 'L1', 2: 'L1', 3: 'L1' }, mB: { 10: 'L1', 11: 'L1' } };
const catOf = { mA: { 1: 'Revit Walls', 2: 'Revit Walls', 3: 'Revit Walls' }, mB: { 10: 'Revit Ducts', 11: 'Revit Ducts' } };
const metaProps = (m) => (dbId) => (catOf[m][dbId] === undefined ? undefined
  : { name: `e${dbId}`, properties: [prop.category(catOf[m][dbId]), prop.constraintsLevel(levelOf[m][dbId])] });
const reqs = (h) => h.bridge.groupPresents.map((c) => c.req);
const asKeys = (h, req) => req.participants.map((x) => [x.model === h.modelA ? 'mA' : x.model === h.modelB ? 'mB' : 'other', x.dbId]);

const SHARED = [
  { a: ['mA', 1], b: ['mB', 10] },
  { a: ['mA', 2], b: ['mB', 10] },
  { a: ['mA', 1], b: ['mB', 11] },
];

async function metaHarness(results, options = {}) {
  const h = makeHarness({ props: { mA: metaProps('mA'), mB: metaProps('mB') }, ...options });
  await h.readyHard();
  await h.runToDone(makeSet({ runId: 'run-1', results, ...(options.set ?? {}) }));
  return h;
}
const groupRowByLabel = (h, label) => h.vm().results.rows.find((r) => r.kind === 'group' && r.label === label);

test('B2 Element: multi-child group presents both sides of every child, de-duplicated by {modelKey,dbId}', async () => {
  const h = await metaHarness(SHARED);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: elementId('mB', 10) });   // children r0 (mA1,mB10) + r1 (mA2,mB10)
  assert.equal(reqs(h).length, 1);
  assert.deepEqual(asKeys(h, reqs(h)[0]), [['mA', 1], ['mB', 10], ['mA', 2]], 'mB:10 appears once, first-seen order');
  assert.deepEqual(Object.keys(reqs(h)[0]).sort(), ['options', 'participants']);
  assert.deepEqual(Object.keys(reqs(h)[0].participants[0]).sort(), ['dbId', 'model'], 'ephemeral {model,dbId} only');
});

test('B2 Category: multi-child group goes through the same path', async () => {
  const h = await metaHarness(SHARED);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  const row = groupRowByLabel(h, 'Ducts ↔ Walls');
  assert.ok(row, 'category group exists');
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: row.groupId });
  assert.deepEqual(asKeys(h, reqs(h)[0]), [['mA', 1], ['mB', 10], ['mA', 2], ['mB', 11]]);
});

test('B2 Level: shares the path (every side of every child)', async () => {
  const h = await metaHarness(SHARED);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'level' });
  const row = h.vm().results.rows.find((r) => r.kind === 'group');
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: row.groupId });
  assert.equal(reqs(h).length, 1);
  assert.deepEqual(asKeys(h, reqs(h)[0]).sort(), [['mA', 1], ['mA', 2], ['mB', 10], ['mB', 11]]);
});

test('B2 Model Pair: both sides of both children; same-model pair group carries one model', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.deepEqual(asKeys(h, reqs(h)[0]), [['mA', 3], ['mB', 10], ['mA', 4], ['mB', 11]]);
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: pairId('mA', 'mA') });
  assert.deepEqual(asKeys(h, reqs(h)[1]), [['mA', 1], ['mA', 2]]);
});

test('B2 same dbId in different models stays two participants', async () => {
  const h = await metaHarness([{ a: ['mA', 7], b: ['mB', 7] }, { a: ['mA', 7], b: ['mB', 7] }]);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.deepEqual(asKeys(h, reqs(h)[0]), [['mA', 7], ['mB', 7]]);
});

test('B2 more than two models: an Element group spanning three models presents all of them', async () => {
  const h = makeHarness({ extraModels: [{ modelKey: 'mC', displayName: 'MEP' }] });
  await h.readyHard();
  const models = ['mA', 'mB', 'mC'].map((modelKey) => ({ modelKey, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 }));
  await h.runToDone(makeSet({ runId: 'run-1', models, results: [{ a: ['mA', 1], b: ['mB', 5] }, { a: ['mC', 9], b: ['mB', 5] }] }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: elementId('mB', 5) });
  const [req] = reqs(h);
  assert.deepEqual(req.participants.map((x) => x.dbId), [1, 5, 9]);
  assert.equal(req.participants[2].model, h.extraModels.mC);
  assert.equal(new Set(req.participants.map((x) => x.model)).size, 3);
});

test('B2 single-child group presents that child\'s two sides', async () => {
  const h = await metaHarness([{ a: ['mA', 1], b: ['mB', 10] }]);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.deepEqual(asKeys(h, reqs(h)[0]), [['mA', 1], ['mB', 10]]);
});

test('B2 a collapsed group presents without expanding; membership is the CURRENT FILTERED one', async () => {
  const h = await metaHarness(SHARED);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  assert.equal(group(h, AB).expanded, false);
  await h.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mA', dbId: 2 } });   // only r1 (mA2,mB10) survives
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.deepEqual(asKeys(h, reqs(h)[0]), [['mA', 2], ['mB', 10]]);
  assert.equal(group(h, AB).expanded, false);
});

test('B2 a group filtered out of the current list cannot be presented (unknown groupId guard)', async () => {
  const h = await metaHarness(SHARED);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  await h.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mA', dbId: 2 } });   // mB:11's only child r2 is filtered away
  const before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: elementId('mB', 11) });
  assert.equal(h.bridge.calls.length, before);
  assert.deepEqual(selectedGroups(h), []);
});

test('B2 unavailable participants are omitted from the request (provenance-aware resolver); none live ⇒ no call, stale Viewer cleared', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: AB });        // a clash is shown
  h.catalog.removeModel('mB');                                                       // mB left the scene (no model-left event)
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.deepEqual(asKeys(h, reqs(h)[0]), [['mA', 3], ['mA', 4]], 'mB participants omitted');
  h.catalog.removeModel('mA');
  const before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.deepEqual(h.bridge.calls.slice(before).map((c) => c.op), ['clear'], 'nothing live: no presentGroup, the stale presentation is cleared');
  assert.deepEqual(selectedGroups(h), [AB], 'selected-group state stays truthful');
  assert.equal(h.vm().selected.kind, 'group');
  assert.equal(h.vm().selected.shown, 0);
});

test('B2 empty/no-live with nothing shown makes no Viewer call at all', async () => {
  const h = await grouped();
  h.catalog.removeModel('mA');
  h.catalog.removeModel('mB');
  const before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.equal(h.bridge.calls.length, before);
  assert.deepEqual(selectedGroups(h), [AB]);
});

test('B2 options: Focus-on-select drives focus; Focus always fits; Isolate follows the guarded prerequisite', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.deepEqual(reqs(h)[0].options, { focus: true, isolate: false });
  await h.dispatch({ type: INTENT.ACTION_FOCUS_ON_SELECT, value: false });
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.deepEqual(reqs(h)[1].options, { focus: false, isolate: false });
  await h.dispatch({ type: INTENT.ACTION_FOCUS });
  assert.deepEqual(reqs(h)[2].options, { focus: true, isolate: false });
  await h.dispatch({ type: INTENT.ACTION_ISOLATE, value: true });
  assert.deepEqual(reqs(h)[3].options, { focus: false, isolate: true });
  h.bridge.setIsolationPrerequisite({ available: false, reason: 'x' });
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.equal(reqs(h)[4].options.isolate, false);
  assert.equal(h.bridge.presents.length, 0, 'present() is never used for a group');
});

test('B2 no Viewer Model is retained in the ViewModel or rows', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  const seen = new Set();
  const walk = (v) => {
    if (v === h.modelA || v === h.modelB) assert.fail('a Viewer Model leaked into the ViewModel');
    if (v !== null && typeof v === 'object' && !seen.has(v)) { seen.add(v); Object.values(v).forEach(walk); }
  };
  walk(h.vm());
});

test('B2 a newer group presentation supersedes a stale outcome', async () => {
  const h = await grouped();
  h.bridge.setManual(true);
  const first = h.controller.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  const second = h.controller.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: AB });   // child selection supersedes
  h.bridge.resolvePresent(undefined, 1);                                                // the child's present() resolves first…
  await second;
  h.bridge.resolvePresent({ superseded: false, fitted: true, isolated: false, notes: ['stale group note'] });   // …the stale group outcome LAST
  await first;
  await h.settle();
  assert.deepEqual(selectedGroups(h), []);
  assert.equal(h.vm().selected.notes.includes('stale group note'), false);
});

// ── B4: refresh and lifecycle (spec §27.2 filter paragraph, §27.6; AC-GP2/GP7/GP9/GP10) ────────────────────────────

const opsSince = (h, before) => h.bridge.calls.slice(before).map((c) => c.op);

test('B4 filter change re-presents the selected group\'s recomputed filtered membership; an unchanged membership makes no call', async () => {
  const h = await grouped();                                                        // AB = r1 (mA3,mB10) + r2 (mA4,mB11)
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  let before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mA', dbId: 3 } });    // AB keeps only r1
  assert.deepEqual(opsSince(h, before), ['presentGroup']);
  assert.deepEqual(asKeys(h, reqs(h).at(-1)), [['mA', 3], ['mB', 10]]);
  assert.deepEqual(reqs(h).at(-1).options, { focus: true, isolate: false }, 'Focus on select drives the re-presentation fit');
  assert.deepEqual(selectedGroups(h), [AB]);
  assert.equal(group(h, AB).expanded, false, 'refresh never alters expansion');
  before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mA', dbId: 3 } });    // same filter again: same membership
  assert.deepEqual(opsSince(h, before), [], 'no redundant Viewer work');
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  assert.deepEqual(opsSince(h, before), ['presentGroup']);
  assert.deepEqual(asKeys(h, reqs(h).at(-1)), [['mA', 3], ['mB', 10], ['mA', 4], ['mB', 11]]);
  assert.equal(h.bridge.presents.length, 0, 'never through present()');
});

test('B4 a filter that removes the selected group clears the group selection and the aggregate presentation (no resurrection)', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  const before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mA', dbId: 1 } });    // only AA's r0 survives
  assert.equal(group(h, AB), undefined);
  assert.deepEqual(selectedGroups(h), []);
  assert.deepEqual(opsSince(h, before), ['clear'], 'one guarded clear, no presentGroup');
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  assert.ok(group(h, AB), 'the group is back in the list…');
  assert.deepEqual(selectedGroups(h), [], '…but not re-selected');
  assert.deepEqual(opsSince(h, before), ['clear'], 'and nothing is presented');
});

test('B4 while nothing is shown (panel hidden) a filter neither re-presents nor clears; a removed group still ends the selection', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  await h.dispatch({ type: INTENT.PANEL_HIDDEN });
  const before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mA', dbId: 4 } });    // AB keeps only r2
  assert.deepEqual(opsSince(h, before), [], 'no silent Viewer mutation while hidden');
  assert.deepEqual(selectedGroups(h), [AB]);
  await h.dispatch({ type: INTENT.ACTION_FOCUS });                                  // a later action re-resolves current membership
  assert.deepEqual(asKeys(h, reqs(h).at(-1)), [['mA', 4], ['mB', 11]]);
  await h.dispatch({ type: INTENT.PANEL_HIDDEN });
  const mid = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mA', dbId: 1 } });    // AB disappears
  assert.deepEqual(opsSince(h, mid), [], 'nothing was shown, so nothing to clear');
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  assert.ok(group(h, AB), 'the group is back in the list…');
  assert.deepEqual(selectedGroups(h), [], '…but the disappearance ended its selection');
  await h.dispatch({ type: INTENT.ACTION_FOCUS });
  assert.deepEqual(opsSince(h, mid), [], 'Focus has no group to present');
});

test('B4 grouping-mode change clears the group selection and the aggregate presentation; re-selecting the same mode does not', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  let before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });                // same mode: no change
  assert.deepEqual(selectedGroups(h), [AB]);
  assert.deepEqual(opsSince(h, before), []);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  assert.deepEqual(opsSince(h, before), ['clear']);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  assert.deepEqual(selectedGroups(h), [], 'switching back does not resurrect it');
  assert.deepEqual(opsSince(h, before), ['clear']);
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'none' });                     // to the flat view
  assert.deepEqual(opsSince(h, before), ['clear']);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  assert.deepEqual(selectedGroups(h), []);
});

test('B4 a grouping-mode change keeps a child clash selection (single-clash behavior unchanged)', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: null });
  const before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  assert.equal(h.vm().selected.resultId, 'r1');
  assert.deepEqual(opsSince(h, before), []);
});

test('B4 expand/collapse, pagination and sort never clear or re-present the selected group', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(makeSet({ runId: 'run-1', results: hardResults(120) }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  assert.ok(h.vm().results.page.count > 1, 'more than one page of groups');
  const first = h.vm().results.rows.find((r) => r.kind === 'group');
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: first.groupId });
  const before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: first.groupId });
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: first.groupId });
  await h.dispatch({ type: INTENT.NAV_PAGE, page: 1 });
  assert.equal(h.vm().results.page.index, 1);
  await h.dispatch({ type: INTENT.NAV_PAGE, page: 0 });
  await h.dispatch({ type: INTENT.SORT_SET, value: 'group-label' });
  await h.dispatch({ type: INTENT.SORT_SET, value: 'default' });
  assert.deepEqual(opsSince(h, before), []);
  assert.deepEqual(selectedGroups(h), [first.groupId]);
});

test('B4 group→child: selecting a child restores the unchanged single-clash present() request', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: AB });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: AB });
  const plain = h.bridge.presents.at(-1).req;
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  const before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: AB });
  assert.deepEqual(opsSince(h, before), ['present'], 'one single-clash presentation replaces the aggregate');
  assert.deepEqual(h.bridge.presents.at(-1).req, plain, 'sides, witness and {focus,isolate,marker} exactly as before');
  assert.equal(h.bridge.presents.at(-1).req.options.marker, true, 'markers come back for the child');
  assert.equal(h.vm().selected.resultId, 'r1');
});

test('AC-GP9 Back to all: one guarded clear, both selections cleared, filters/grouping/expansion/page preserved', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(makeSet({ runId: 'run-1', results: hardResults(120) }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  await h.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });
  await h.dispatch({ type: INTENT.NAV_PAGE, page: 1 });
  const target = h.vm().results.rows.find((r) => r.kind === 'group');
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: target.groupId });
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: target.groupId });
  const before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.ACTION_BACK_TO_ALL });
  assert.deepEqual(opsSince(h, before), ['clear']);
  const vm = h.vm();
  assert.deepEqual(selectedGroups(h), []);
  assert.equal(vm.selected, null);
  assert.equal(vm.filters.hasLocation, true);
  assert.equal(vm.filters.groupBy, 'element');
  assert.equal(vm.results.page.index, 1);
  assert.equal(group(h, target.groupId).expanded, true);
});

test('B4 panel hide clears the Viewer but keeps the group; panel show does not touch the Viewer; Focus re-resolves', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  const before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.PANEL_HIDDEN });
  assert.deepEqual(opsSince(h, before), ['clear']);
  assert.deepEqual(selectedGroups(h), [AB]);
  await h.dispatch({ type: INTENT.PANEL_SHOWN });
  assert.deepEqual(opsSince(h, before), ['clear'], 'show never silently mutates the Viewer');
  h.catalog.removeModel('mB');                                                      // liveness changed while hidden
  await h.dispatch({ type: INTENT.ACTION_FOCUS });
  assert.deepEqual(opsSince(h, before), ['clear', 'presentGroup']);
  assert.deepEqual(asKeys(h, reqs(h).at(-1)), [['mA', 3], ['mA', 4]], 'current live membership, resolved at action time');
  assert.equal(reqs(h).at(-1).options.focus, true);
});

test('B4 model departure: a participating model clears the aggregate at once and keeps the group; a non-participating one does not', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AA });                    // mA only
  let before = h.bridge.calls.length;
  h.catalog.removeModel('mB');
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  await h.settle();
  assert.deepEqual(opsSince(h, before), [], 'mB did not participate in the shown aggregate');
  assert.deepEqual(selectedGroups(h), [AA]);
  h.catalog.addModel({ modelKey: 'mB', displayName: 'Structure', model: h.modelB, loaded: true });
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });                    // mA + mB shown
  before = h.bridge.calls.length;
  h.catalog.removeModel('mB');
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'removed' });                   // the same unload's second event
  await h.settle();
  assert.deepEqual(opsSince(h, before), ['clear'], 'cleared immediately, once, no automatic re-presentation');
  assert.deepEqual(selectedGroups(h), [AB], 'truthful group context retained');
  await h.dispatch({ type: INTENT.ACTION_FOCUS });
  assert.deepEqual(asKeys(h, reqs(h).at(-1)), [['mA', 3], ['mA', 4]], 're-resolution omits the unavailable members');
  h.catalog.removeModel('mA');
  h.bridge.fireModelLeft({ model: h.modelA, reason: 'unload' });
  await h.settle();
  before = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.ACTION_FOCUS });
  assert.deepEqual(opsSince(h, before), [], 'no live participant: no presentation');
  assert.deepEqual(selectedGroups(h), [AB]);
});

test('B4 same-key re-entry goes through the catalog/binding lifecycle: the CURRENT Model is resolved, never a stored one', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  h.catalog.removeModel('mB');
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  await h.settle();
  const reloaded = { label: 'B again', getObjectTree: () => ({ getNodeName: (dbId) => `B-${dbId}` }) };
  h.engine.setBinding('mB', { modelKey: 'mB', model: reloaded, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 });
  h.catalog.addModel({ modelKey: 'mB', displayName: 'Structure', model: reloaded, loaded: true });
  h.catalog.fire();
  await h.settle();
  await h.dispatch({ type: INTENT.ACTION_FOCUS });
  const req = reqs(h).at(-1);
  assert.deepEqual(req.participants.map((x) => x.dbId), [3, 10, 4, 11]);
  assert.equal(req.participants[1].model, reloaded, 'the re-entered Model');
  assert.equal(req.participants.some((x) => x.model === h.modelB), false, 'the departed Model object is not reused');
});

test('B4 a new run clears both selection kinds (existing reset path; Viewer cleared)', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  const before = h.bridge.calls.length;
  await h.runToDone(makeSet({ runId: 'run-2', results: MIXED }));
  assert.ok(opsSince(h, before).includes('clear'));
  assert.equal(h.vm().filters.groupBy, 'modelPair', 'grouping mode survives a new run');
  assert.deepEqual(selectedGroups(h), []);
  assert.equal(h.vm().selected, null);
  assert.equal(opsSince(h, before).includes('presentGroup'), false);
});

test('B4 Clash Tests manager: switching or deleting the active test clears the group selection through the existing reset paths', async () => {
  const h = makeHarness();
  let n = 0;
  const manager = createTestsManager({ editor: h.controller, engine: h.engine, catalog: h.catalog, bridge: h.bridge, scheduler: h.scheduler,
    mintId: () => { n += 1; return `new-${n}`; } });
  const go = async (intent) => { const out = await manager.dispatch(intent); await h.settle(); return out; };
  const runSaved = async () => {
    await go({ type: INTENT.RUN_START });
    const handle = h.engine.lastHandle;
    handle.finish({ status: 'completed', resultSet: makeSet({ runId: handle.runId, results: MIXED }), persistence: { state: 'saved', timedOut: false, attempt: 1 } });
    await h.settle();
  };
  const X = manager.getViewModel().manager.activeTestId;
  await go({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });
  await go({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });
  await runSaved();
  await go({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  await go({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.deepEqual(selectedGroups(h), [AB]);
  let before = h.bridge.calls.length;
  await go({ type: MANAGER_INTENT.CREATE });                                       // switch away
  assert.ok(opsSince(h, before).includes('clear'));
  assert.deepEqual(selectedGroups(h), []);
  await go({ type: MANAGER_INTENT.OPEN, testId: X });                              // and back: nothing resurrected
  assert.deepEqual(selectedGroups(h), []);
  await runSaved();
  await go({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.deepEqual(selectedGroups(h), [AB]);
  before = h.bridge.calls.length;
  await go({ type: MANAGER_INTENT.DELETE, testId: X });
  await go({ type: MANAGER_INTENT.CONFIRM, operationId: manager.getViewModel().manager.confirm.operationId });
  assert.notEqual(manager.getViewModel().manager.activeTestId, X);
  assert.ok(opsSince(h, before).includes('clear'));
  assert.deepEqual(selectedGroups(h), []);
  assert.equal(h.vm().selected, null);
});

test('B4 a metadata regrouping in flight (model left) leaves the group selection dormant; it survives when the group lands again', async () => {
  const h = await metaHarness(SHARED);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  const row = groupRowByLabel(h, 'Ducts ↔ Walls');
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: row.groupId });
  const before = h.bridge.calls.length;
  h.bridge.fireModelLeft({ model: { unrelated: true }, reason: 'removed' });       // unknown model: conservative clear + regroup
  await h.settle();
  assert.deepEqual(opsSince(h, before), ['clear']);
  assert.ok(groupRowByLabel(h, 'Ducts ↔ Walls'), 'the regrouping landed with the same group');
  assert.deepEqual(selectedGroups(h), [row.groupId], 'the selection was not ended while the regrouping was pending');
  await h.dispatch({ type: INTENT.ACTION_FOCUS });
  assert.deepEqual(opsSince(h, before), ['clear', 'presentGroup']);
});

// ── Addendum B5 (spec §27.4/§27.5, AC-GP7/GP8/GP12): the bounded group-selected variant of the Selected region ──────────

const MARKERS_REASON = 'Markers are unavailable for a clash group.';
const walkForModels = (value, seen = new Set()) => {
  if (value === null || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (typeof value.getObjectTree === 'function' || typeof value.getInstanceTree === 'function') return true;
  return Object.values(value).some((v) => walkForModels(v, seen));
};

test('B5 group-selected variant: identity, filtered clash/participant counts and the exact Markers reason', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  const s = h.vm().selected;
  assert.equal(s.kind, 'group');
  assert.equal(s.groupId, AB);
  assert.equal(s.label, group(h, AB).label);
  assert.equal(s.clashCount, 2, 'the current filtered clash count of the group');
  assert.equal(s.participants, 4);
  assert.equal(s.shown, 4);
  assert.equal(s.unavailable, 0);
  assert.equal(s.unavailableNote, null);
  assert.deepEqual(s.actions.markers, { enabled: false, checked: false, reason: MARKERS_REASON });
  assert.deepEqual(s.actions.focus, { enabled: true, reason: null });
  assert.equal(s.actions.isolate.enabled, true);
  assert.equal(s.actions.focusOnSelect.checked, true);
  assert.deepEqual(s.actions.backToAll, { enabled: true });
  for (const k of ['ordinal', 'side1', 'side2', 'gap', 'hasLocation', 'witness', 'liveness', 'resultId', 'hiddenByFilters']) assert.equal(k in s, false, `no child field ${k}`);
});

test('B5 the clash count follows the CURRENT filters', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.equal(h.vm().selected.clashCount, 2);
  await h.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mA', dbId: 3 } });
  assert.equal(h.vm().selected.clashCount, 1);
  assert.equal(h.vm().selected.participants, 2);
});

test('B5 unavailable participants are reported truthfully and refresh after departure and same-key re-entry (built fresh, not retained)', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.equal(h.vm().selected.unavailable, 0);
  h.catalog.removeModel('mB');
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  await h.settle();
  let s = h.vm().selected;
  assert.equal(s.kind, 'group');
  assert.equal(s.shown, 2);
  assert.equal(s.unavailable, 2);
  assert.equal(s.participants, 4);
  assert.match(s.unavailableNote, /2 of 4 participants are not shown/);
  assert.equal(s.actions.focus.enabled, true);
  h.catalog.addModel({ modelKey: 'mB', displayName: 'Structure', model: h.modelB, loaded: true });
  h.catalog.fire();
  await h.settle();
  s = h.vm().selected;
  assert.equal(s.unavailable, 0, 'counts recover on re-entry');
  assert.equal(s.unavailableNote, null);
});

test('B5 no live participant: the live-only actions are disabled with a reason; Back to all stays enabled', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  h.catalog.removeModel('mA');
  h.catalog.removeModel('mB');
  h.bridge.fireModelLeft({ model: h.modelA, reason: 'unload' });
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  await h.settle();
  const s = h.vm().selected;
  assert.equal(s.shown, 0);
  assert.equal(s.actions.focus.enabled, false);
  assert.equal(typeof s.actions.focus.reason, 'string');
  assert.equal(s.actions.isolate.enabled, false);
  assert.equal(s.actions.isolate.checked, false);
  assert.equal(s.actions.markers.reason, MARKERS_REASON, 'the Markers reason stays the group one');
  assert.equal(s.actions.backToAll.enabled, true);
  assert.match(s.unavailableNote, /4 of 4 participants are not shown/);
});

test('B5 no Viewer Model enters the ViewModel (group-selected, including after departure)', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.equal(walkForModels(h.vm()), false);
  h.catalog.removeModel('mB');
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  await h.settle();
  assert.equal(walkForModels(h.vm()), false);
});

test('B5 group <-> child switches atomically: no stale child fields in the group variant, no stale group fields in the child variant', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: AB });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: AB });
  const child = h.vm().selected;
  assert.equal('kind' in child, false, 'the child shape is unchanged');
  assert.equal(child.actions.markers.enabled, true);
  assert.equal(child.actions.markers.reason, null);
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  assert.equal(h.vm().selected.kind, 'group');
  assert.equal(h.vm().selected.resultId, undefined);
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: AB });
  const back = h.vm().selected;
  assert.equal(back.resultId, 'r1');
  assert.equal('kind' in back, false);
  assert.equal('groupId' in back, false);
  assert.deepEqual(back.actions.markers, { enabled: true, checked: true, reason: null }, 'single-clash Markers restored unchanged');
});

test('B5 Back to all from the group variant empties the region', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  await h.dispatch({ type: INTENT.ACTION_BACK_TO_ALL });
  assert.equal(h.vm().selected, null);
});

// ── B7 follow-ups: deferred review coverage ─────────────────────────────────────────────────────────────────────────

test('B7 Markers is unavailable for a group: a forged ACTION_MARKERS changes nothing and the prior toggle survives a child selection', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: AB });
  await h.dispatch({ type: INTENT.ACTION_MARKERS, value: true });
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  const before = h.bridge.calls.length;
  const vmBefore = JSON.stringify(h.vm().selected);
  await h.dispatch({ type: INTENT.ACTION_MARKERS, value: false });                  // forged: the UI disables it for a group
  assert.deepEqual(opsSince(h, before), [], 'no present, no clear');
  assert.equal(JSON.stringify(h.vm().selected), vmBefore, 'the group variant is unchanged');
  assert.deepEqual(selectedGroups(h), [AB]);
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r2', groupId: AB });
  assert.equal(h.bridge.presents.at(-1).req.options.marker, true, 'the child selection keeps the prior Markers toggle');
});

test('B7 a model-unavailable regrouping in Category mode that drops the selected group ends the group selection', async () => {
  const h = await metaHarness(SHARED);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  const row = groupRowByLabel(h, 'Ducts ↔ Walls');
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: row.groupId });
  const before = h.bridge.calls.length;
  h.catalog.removeModel('mB');                                                      // mB's properties are no longer readable
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  await h.settle();
  assert.equal(groupRowByLabel(h, 'Ducts ↔ Walls'), undefined, 'the group is gone after regrouping');
  assert.deepEqual(selectedGroups(h), [], 'the selection ended with it (accepted ruling)');
  assert.equal(h.vm().selected, null);
  assert.deepEqual(opsSince(h, before), ['clear']);
  const after = h.bridge.calls.length;
  await h.dispatch({ type: INTENT.ACTION_FOCUS });
  assert.deepEqual(opsSince(h, after), [], 'Focus has no group to present');
});

test('B7 a filter re-presentation arriving while a prior presentGroup is in flight drops the stale outcome', async () => {
  const h = await grouped();
  h.bridge.setManual(true);
  const first = h.controller.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  await h.settle();
  const second = h.controller.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mA', dbId: 3 } });   // AB keeps only r1 ⇒ re-present
  await h.settle();
  assert.equal(h.bridge.groupPresents.length, 2, 'the filter re-presented while the first call was pending');
  h.bridge.resolvePresent({ superseded: false, fitted: true, isolated: false, notes: ['fresh group note'] }, 1);
  await h.settle();
  h.bridge.resolvePresent({ superseded: false, fitted: true, isolated: false, notes: ['stale group note'] }, 0);   // the stale one LAST
  await Promise.all([first, second]);
  await h.settle();
  assert.deepEqual(selectedGroups(h), [AB]);
  assert.deepEqual(h.vm().selected.notes, ['fresh group note']);
  assert.equal(h.bridge.groupPresents.length, 2, 'no further re-presentation');
});

test('B7 a selection ending while presentGroup is in flight drops the stale outcome and never re-presents', async () => {
  for (const ending of [
    (h) => h.dispatch({ type: INTENT.ACTION_BACK_TO_ALL }),
    (h) => h.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mA', dbId: 1 } }),   // the group disappears
    (h) => h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' }),
  ]) {
    const h = await grouped();
    h.bridge.setManual(true);
    const first = h.controller.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
    await h.settle();
    await ending(h);
    const groupCalls = h.bridge.groupPresents.length;
    h.bridge.resolvePresent({ superseded: false, fitted: true, isolated: false, notes: ['stale group note'] }, 0);
    await first;
    await h.settle();
    assert.deepEqual(selectedGroups(h), [], 'the group selection stays ended');
    assert.equal(h.vm().selected?.notes?.includes('stale group note') ?? false, false, 'no stale note');
    assert.equal(h.bridge.groupPresents.length, groupCalls, 'the stale outcome did not trigger a re-presentation');
  }
});

// GP-F1 (headed finding; spec §27.2, AC-GP10): the FIRST text filter of a run runs one pass against a cold label index
// (element names not read yet) before ensureLabelIndex() commits. That provisional pass must not end the selected group.
test('GP-F1 a cold-label-index text pass leaves the group selection dormant; the warm pass re-presents the filtered membership', async () => {
  const h = await grouped();                                                        // AB = r1 (mA3,mB10) + r2 (mA4,mB11)
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  const before = h.bridge.calls.length;
  const hold = h.scheduler.holdYields();                                            // warm() cannot commit yet
  await h.controller.dispatch({ type: INTENT.FILTER_TEXT, value: 'a-3' });           // names only: element "A-3" of r1
  await h.scheduler.advance(FILTER_DEBOUNCE_MS);
  await h.settle();
  assert.equal(group(h, AB), undefined, 'the cold pass matched nothing (names not indexed yet)');
  assert.deepEqual(selectedGroups(h), [], 'no group row to mark while the pass is provisional');
  assert.deepEqual(opsSince(h, before), [], 'the provisional pass neither clears nor re-presents');
  hold.release();
  await h.settle();
  assert.deepEqual(selectedGroups(h), [AB], 'the group exists once labels load and stays selected');
  assert.deepEqual(opsSince(h, before), ['presentGroup'], 'one re-presentation, no clear');
  assert.deepEqual(asKeys(h, reqs(h).at(-1)), [['mA', 3], ['mB', 10]], 'the FILTERED membership');
});

test('GP-F1 a text filter that truly removes the group still ends the selection once labels load', async () => {
  const h = await grouped();
  await h.dispatch({ type: INTENT.GROUP_PRESENT, groupId: AB });
  const before = h.bridge.calls.length;
  const hold = h.scheduler.holdYields();
  await h.controller.dispatch({ type: INTENT.FILTER_TEXT, value: 'a-1' });           // only AA's r0 (mA1) matches
  await h.scheduler.advance(FILTER_DEBOUNCE_MS);
  await h.settle();
  assert.deepEqual(opsSince(h, before), [], 'nothing ends on the provisional pass');
  hold.release();
  await h.settle();
  assert.ok(group(h, AA), 'the warm pass landed');
  assert.equal(group(h, AB), undefined);
  assert.equal(h.vm().selected, null, 'the selection ended');
  assert.deepEqual(opsSince(h, before), ['clear'], 'one guarded clear, no presentGroup');
});
