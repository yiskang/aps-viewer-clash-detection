// test/clashpanel/core/grouping.test.mjs — Task 13 (spec §10.2, AC-P4)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeElementGroups, computeFacetGroups, filterGroups, sortGroups, matchIdsFrom, groupCountText, MULTI_VALUED_NOTE, GROUPING_UNAVAILABLE_TEXT } from '../../../clashpanel/core/grouping.js';
import { groupModeOf } from '../../../clashpanel/core/groupModes.js';
import { buildResultIndex } from '../../../clashpanel/core/resultIndex.js';
import { createDerivationQueue } from '../../../clashpanel/core/derivationQueue.js';
import { createGeneration } from '../../../clashpanel/core/generation.js';
import { DERIVATION_BUSY_MAX_RETRIES, DERIVATION_BUSY_RETRY_MS } from '../../../clashpanel/core/constants.js';
import { createFakeScheduler } from '../support/fakeScheduler.mjs';
import { createClashTestEngine, GroupingTooLargeError, DerivationBusyError } from '../../../clashtest/index.js';
import { createEngineWorld } from '../../clashtest/support/engineWorld.mjs';
import { createFakeClock } from '../../clashtest/support/fakeClock.mjs';
import { sealedSet } from '../../clashtest/support/resultSetFixtures.mjs';

// Hand-built multi-valued set: r0 (A1–B9), r1 (A2–B9), r2 (A1–B8). Element B9 holds r0+r1, A1 holds r0+r2.
const ref = (modelKey, dbId) => ({ modelKey, dbId });
const rec = (id, a, b) => ({ resultId: id, pair: { first: a, second: b }, mode: 'volume-overlap', evidence: { witness: null }, flags: {}, unitId: 'u' });
const SET = { runId: 'run-g', results: [rec('r0', ref('A', 1), ref('B', 9)), rec('r1', ref('A', 2), ref('B', 9)), rec('r2', ref('A', 1), ref('B', 8))], definition: { mode: 'volume-overlap' }, provenance: { models: [] } };
const coreGroups = () => ({ facets: [{ facetId: 'element', params: {}, multiValued: true }], unavailable: [], total: 3, memberships: 6, groups: [
  { groupId: 'gA1', path: ['gA1'], facetId: 'element', params: {}, value: ref('A', 1), count: 2, members: ['r0', 'r2'] },
  { groupId: 'gA2', path: ['gA2'], facetId: 'element', params: {}, value: ref('A', 2), count: 1, members: ['r1'] },
  { groupId: 'gB8', path: ['gB8'], facetId: 'element', params: {}, value: ref('B', 8), count: 1, members: ['r2'] },
  { groupId: 'gB9', path: ['gB9'], facetId: 'element', params: {}, value: ref('B', 9), count: 2, members: ['r0', 'r1'] },
] });
/** Drives the fake scheduler's retry timers (Task 7 busy back-off) until `p` settles; bounded. */
async function settleWithTimers(p, scheduler) {
  let done = false;
  p.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 10 * (DERIVATION_BUSY_MAX_RETRIES + 1) && !done; i += 1) {
    await new Promise((r) => setImmediate(r));
    if (!done) await scheduler.advance(DERIVATION_BUSY_RETRY_MS);
  }
  return p;
}
function world(groupBy) {
  const calls = [];
  const engine = { derivations: { groupBy: async (set, facets, opts) => { calls.push([set, facets, Object.keys(opts)]); return groupBy(calls.length); } } };
  const scheduler = createFakeScheduler();
  const generation = createGeneration();
  const queue = createDerivationQueue({ scheduler, generation });
  return { engine, calls, scheduler, generation, queue };
}

test('one groupBy(set, [\'element\'], {signal}) per (generation, spec); a second request is served from the queue cache', async () => {
  const w = world(() => coreGroups());
  const a = await computeElementGroups({ queue: w.queue, engine: w.engine, resultSet: SET });
  const b = await computeElementGroups({ queue: w.queue, engine: w.engine, resultSet: SET });
  assert.equal(a.status, 'ok');
  assert.deepEqual(b, a);
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0][0], SET);
  assert.deepEqual(w.calls[0][1], ['element']);
  assert.deepEqual(w.calls[0][2], ['signal'], 'closed options bag: signal only');
  w.generation.bump();
  await computeElementGroups({ queue: w.queue, engine: w.engine, resultSet: SET });
  assert.equal(w.calls.length, 2, 'a new generation computes again');
});

test('multi-valued: the same resultId appears under both of its elements; table references Core member arrays', async () => {
  const raw = coreGroups();
  const w = world(() => raw);
  const { table } = await computeElementGroups({ queue: w.queue, engine: w.engine, resultSet: SET });
  assert.deepEqual(table.groups.map((g) => [g.groupId, g.ref, g.count]), [['gA1', ref('A', 1), 2], ['gA2', ref('A', 2), 1], ['gB8', ref('B', 8), 1], ['gB9', ref('B', 9), 2]]);
  const holders = table.groups.filter((g) => g.memberIds.includes('r0')).map((g) => g.groupId);
  assert.deepEqual(holders, ['gA1', 'gB9']);
  assert.equal(table.groups[0].memberIds, raw.groups[0].members);
  assert.equal(table.memberships, 6);
  const sum = table.groups.reduce((n, g) => n + g.count, 0);
  assert.notEqual(sum, SET.results.length, 'group counts do not sum to the result count');
  assert.match(MULTI_VALUED_NOTE, /listed under both of its elements/);
});

test('GroupingTooLargeError ⇒ unavailable/too-large; persistent DerivationBusyError ⇒ unavailable/error after bounded retries; other ⇒ error', async () => {
  const big = world(() => { throw new GroupingTooLargeError({ limit: 10, observed: 12 }); });
  assert.deepEqual(await computeElementGroups({ queue: big.queue, engine: big.engine, resultSet: SET }), { status: 'unavailable', reason: 'too-large' });
  assert.match(GROUPING_UNAVAILABLE_TEXT['too-large'], /showing the flat list/);

  const busy = world(() => { throw new DerivationBusyError({ limit: 2 }); });
  const p = computeElementGroups({ queue: busy.queue, engine: busy.engine, resultSet: SET });
  assert.deepEqual(await settleWithTimers(p, busy.scheduler), { status: 'unavailable', reason: 'error' });
  assert.equal(busy.calls.length, DERIVATION_BUSY_MAX_RETRIES + 1, 'bounded retries of the same job');

  const boom = world(() => { throw new TypeError('bad'); });
  assert.deepEqual(await computeElementGroups({ queue: boom.queue, engine: boom.engine, resultSet: SET }), { status: 'unavailable', reason: 'error' });
});

test('a generation bump while grouping is in flight ⇒ superseded (never displayed)', async () => {
  let release;
  const w = world(() => new Promise((r) => { release = () => r(coreGroups()); }));
  const p = computeElementGroups({ queue: w.queue, engine: w.engine, resultSet: SET });
  await new Promise((r) => setImmediate(r));
  w.generation.bump();
  release();
  assert.deepEqual(await p, { status: 'superseded' });
});

test('filterGroups: mask intersection, n-of-m counts, empty groups dropped only when a filter is active', async () => {
  const w = world(() => coreGroups());
  const { table } = await computeElementGroups({ queue: w.queue, engine: w.engine, resultSet: SET });
  const index = buildResultIndex(SET);
  const all = filterGroups(table, { matchIds: null, index });
  assert.deepEqual(all.map((g) => [g.groupId, g.filteredCount, g.memberIndexes]), [['gA1', 2, [0, 2]], ['gA2', 1, [1]], ['gB8', 1, [2]], ['gB9', 2, [0, 1]]]);
  const matchIds = matchIdsFrom(Uint32Array.from([0, 1]), index);           // filter kept r0, r1
  assert.deepEqual([...matchIds], ['r0', 'r1']);
  const filtered = filterGroups(table, { matchIds, index });
  assert.deepEqual(filtered.map((g) => [g.groupId, g.filteredCount, g.count]), [['gA1', 1, 2], ['gA2', 1, 1], ['gB9', 2, 2]], 'gB8 dropped');
  assert.deepEqual(filtered.map(groupCountText), ['1 of 2', '1', '2']);
});

test('sortGroups: core order, count-desc (stable), label (stable); input untouched', () => {
  const gs = [{ groupId: 'a', ref: ref('A', 1), filteredCount: 1 }, { groupId: 'b', ref: ref('A', 2), filteredCount: 3 }, { groupId: 'c', ref: ref('B', 1), filteredCount: 1 }, { groupId: 'd', ref: ref('B', 2), filteredCount: 3 }];
  const labels = { 'A:1': 'Wall', 'A:2': 'duct', 'B:1': 'Beam', 'B:2': 'wall' };
  const labelOf = (r) => labels[`${r.modelKey}:${r.dbId}`];
  assert.deepEqual(sortGroups(gs, 'core', labelOf).map((g) => g.groupId), ['a', 'b', 'c', 'd']);
  assert.deepEqual(sortGroups(gs, 'count-desc', labelOf).map((g) => g.groupId), ['b', 'd', 'a', 'c']);
  assert.deepEqual(sortGroups(gs, 'label', labelOf).map((g) => g.groupId), ['c', 'b', 'a', 'd'], 'case-insensitive; Wall/wall tie keeps Core order');
  assert.deepEqual(gs.map((g) => g.groupId), ['a', 'b', 'c', 'd']);
});

test('REAL engine: derivations.groupBy over sealedSet(\'positives\') has the shape computeElementGroups maps', async () => {
  const w = createEngineWorld();
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 26) });
  const engine = createClashTestEngine(w.config({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {} }));
  const set = await sealedSet('positives');
  const scheduler = createFakeScheduler();
  const queue = createDerivationQueue({ scheduler, generation: createGeneration() });
  const out = await computeElementGroups({ queue, engine, resultSet: set });
  assert.equal(out.status, 'ok');
  const index = buildResultIndex(set);
  assert.equal(out.table.memberships, 2 * set.results.length, 'element = 2 memberships per result');
  for (const g of out.table.groups) {
    assert.equal(typeof g.groupId, 'string');
    assert.deepEqual(Object.keys(g.ref).sort(), ['dbId', 'modelKey']);
    assert.equal(g.count, g.memberIds.length);
    for (const id of g.memberIds) assert.ok(index.indexOfResultId(id) >= 0, 'members are real resultIds');
  }
  for (const r of set.results) {
    assert.equal(out.table.groups.filter((g) => g.memberIds.includes(r.resultId)).length, 2, 'multi-valued: under both elements');
  }
  for (const g of filterGroups(out.table, { matchIds: null, index })) {
    assert.deepEqual(g.memberIndexes, [...g.memberIndexes].sort((a, b) => a - b), 'Core member order is canonical (no Panel re-sort)');
  }
});

test('computeFacetGroups: a malformed facet value makes the grouping unavailable (never a mislabelled grouping)', async () => {
  const w = world(() => ({ facets: [], unavailable: [], total: 1, memberships: 1, groups: [{ groupId: 'x', value: 'not-a-pair', count: 1, members: ['r0'] }] }));
  const out = await computeFacetGroups({ queue: w.queue, engine: w.engine, resultSet: SET, facet: 'pairModels', isValue: (v) => Array.isArray(v) && v.length === 2 });
  assert.deepEqual(out, { status: 'unavailable', reason: 'error' });
  assert.deepEqual(w.calls[0][1], ['pairModels']);
});

test('REAL engine: the modelPair mode groups by the unordered modelKey pair; groupId is the Core facet key; single-valued', async () => {
  const w = createEngineWorld();
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 26) });
  const engine = createClashTestEngine(w.config({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {} }));
  const set = await sealedSet('positives');
  const queue = createDerivationQueue({ scheduler: createFakeScheduler(), generation: createGeneration() });
  const out = await groupModeOf('modelPair').compute({ queue, engine, resultSet: set });
  assert.equal(out.status, 'ok');
  assert.equal(out.table.memberships, set.results.length, 'single-valued: one membership per result');
  const index = buildResultIndex(set);
  for (const g of out.table.groups) {
    assert.ok(Array.isArray(g.ref) && g.ref.length === 2 && g.ref.every((k) => typeof k === 'string'));
    assert.ok(g.ref[0] <= g.ref[1], 'unordered pair: Core orders first <= second');
    assert.equal(g.groupId, JSON.stringify(['pairModels', {}, g.ref]), 'stable key = identity, not display text');
    for (const id of g.memberIds) {
      const r = index.at(index.indexOfResultId(id));
      assert.deepEqual([r.pair.first.modelKey, r.pair.second.modelKey], g.ref);
    }
  }
  for (const g of filterGroups(out.table, { matchIds: null, index })) {
    assert.deepEqual(g.memberIndexes, [...g.memberIndexes].sort((a, b) => a - b), 'canonical member order');
  }
  assert.equal(groupModeOf('modelPair').labelOf(['mA', 'mB'], { modelName: (k) => `<${k}>` }), '<mA> ↔ <mB>');
  assert.equal(groupModeOf('modelPair').labelOf(['mA', 'mA'], { modelName: (k) => `<${k}>` }), '<mA> ↔ <mA>', 'self-clash A ↔ A');
});
