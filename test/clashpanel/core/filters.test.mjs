// test/clashpanel/core/filters.test.mjs — Task 12 (spec §10.1, AC-P4)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FILTER_SPEC, FILTER_MASK_UNAVAILABLE_TEXT, isFilterActive, parseMaxGap, createRecordPredicate, runFilterPass } from '../../../clashpanel/core/filters.js';
import { buildResultIndex } from '../../../clashpanel/core/resultIndex.js';
import { LIST_CHUNK_SIZE } from '../../../clashpanel/core/constants.js';
import { createFakeScheduler } from '../support/fakeScheduler.mjs';
import { sealedSet } from '../../clashtest/support/resultSetFixtures.mjs';

const spec = (over = {}) => ({ ...EMPTY_FILTER_SPEC, ...over });
const rec = (i, { a = 'mA', b = 'mB', da = i, db = 1000 + i, distance = null, noLoc = false } = {}) => ({
  resultId: `r${i}`, pair: { first: { modelKey: a, dbId: da }, second: { modelKey: b, dbId: db } },
  mode: distance === null ? 'volume-overlap' : 'clearance',
  evidence: distance === null ? { witness: noLoc ? null : { kind: 'vertex', point: [0, 0, 0] } } : { distance, clearance: 5, closestPoints: { first: [0, 0, 0], second: [1, 0, 0] } },
  flags: noLoc ? { witnessUnavailable: true } : {}, unitId: 'u',
});
const NAMES = { mA: 'architecture', mB: 'mep ducts', mC: 'structure' };
const labelText = (ref) => `${NAMES[ref.modelKey] ?? ''} ${ref.dbId === 7 ? 'fire damper' : ''} #${ref.dbId}`.toLowerCase();
const indexOf = (results, definition = { mode: 'volume-overlap' }) => buildResultIndex({ results, definition, provenance: { models: [] } });
const run = (index, s, extra = {}) => runFilterPass({ index, spec: s, labelText, scheduler: createFakeScheduler(), ...extra });

test('isFilterActive: empty spec inactive; each filter alone activates', () => {
  assert.equal(isFilterActive(EMPTY_FILTER_SPEC), false);
  assert.equal(isFilterActive(spec({ text: '   ' })), false);
  for (const over of [{ text: 'x' }, { models: ['mA'] }, { elementOnly: { modelKey: 'mA', dbId: 1 } }, { maxGap: 0 }, { unverified: true }, { hasLocation: true }]) {
    assert.equal(isFilterActive(spec(over)), true, JSON.stringify(over));
  }
});

test('text: dbId digits (with or without #), model display name, element name when cached; case-insensitive', () => {
  const recs = [rec(0, { da: 1234 }), rec(1, { a: 'mC', da: 7 }), rec(2)];
  const p = (text) => recs.filter(createRecordPredicate(spec({ text }), { labelText })).map((r) => r.resultId);
  assert.deepEqual(p('123'), ['r0']);
  assert.deepEqual(p('#1234'), ['r0']);
  assert.deepEqual(p('STRUCTURE'), ['r1']);
  assert.deepEqual(p('fire damper'), ['r1'], 'element name only when the label cache has it');
  assert.deepEqual(p('mep'), ['r0', 'r1', 'r2'], 'second side matches too');
  assert.deepEqual(p('nothing-like-this'), []);
});

test('models (involves any), element exact, has location, caveated mask (no mask ⇒ programmer error)', () => {
  const recs = [rec(0), rec(1, { a: 'mC', b: 'mC' }), rec(2, { noLoc: true }), rec(3, { b: 'mC', db: 7 })];
  const ids = (s, ctx = {}) => recs.filter(createRecordPredicate(s, { labelText, ...ctx })).map((r) => r.resultId);
  assert.deepEqual(ids(spec({ models: ['mC'] })), ['r1', 'r3']);
  assert.deepEqual(ids(spec({ models: ['mA', 'mC'] })), ['r0', 'r1', 'r2', 'r3']);
  assert.deepEqual(ids(spec({ elementOnly: { modelKey: 'mC', dbId: 7 } })), ['r3']);
  assert.deepEqual(ids(spec({ elementOnly: { modelKey: 'mA', dbId: 7 } })), [], 'exact ref: model AND dbId');
  assert.deepEqual(ids(spec({ hasLocation: true })), ['r0', 'r1', 'r3']);
  assert.deepEqual(ids(spec({ unverified: true }), { caveatedIds: new Set(['r2', 'r3']) }), ['r2', 'r3']);
  assert.throws(() => createRecordPredicate(spec({ unverified: true }), { labelText, caveatedIds: null }), TypeError);
  assert.deepEqual(ids(spec({ models: ['mA'], hasLocation: true, unverified: true }), { caveatedIds: new Set(['r2', 'r3']) }), ['r3'], 'filters AND together');
});

test('max gap: Soft records only, distance ≤ X; parseMaxGap rejects > clearance and junk (no silent clamp)', async () => {
  const soft = (await sealedSet('schema-corpus')).results;            // real clearance records, distance 1.5, clearance 5
  assert.equal(soft.filter(createRecordPredicate(spec({ maxGap: 1.5 }), { labelText })).length, soft.length);
  assert.equal(soft.filter(createRecordPredicate(spec({ maxGap: 1.4 }), { labelText })).length, 0);
  const hard = [rec(0)];
  assert.equal(hard.filter(createRecordPredicate(spec({ maxGap: 0 }), { labelText })).length, 1, 'Hard has no magnitude');
  assert.deepEqual(parseMaxGap('2.5', 5), { value: 2.5, error: null });
  assert.deepEqual(parseMaxGap('', 5), { value: null, error: null });
  assert.equal(parseMaxGap('6', 5).value, null);
  assert.match(parseMaxGap('6', 5).error, /cannot exceed the run's clearance \(5\)/);
  assert.match(parseMaxGap('-1', 5).error, /0 or more/);
  assert.match(parseMaxGap('abc', 5).error, /0 or more/);
});

test('mask missing is distinct from zero matches: unverified + null mask ⇒ \'mask-missing\'; unverified off ignores the mask', async () => {
  const index = indexOf([rec(0), rec(1)]);
  assert.equal(await run(index, spec({ unverified: true }), { caveatedIds: null }), 'mask-missing');
  assert.equal(await run(index, spec({ unverified: true, models: ['mA'] }), { caveatedIds: undefined }), 'mask-missing');
  assert.deepEqual([...(await run(index, spec({ unverified: true }), { caveatedIds: new Set(['r1']) }))], [1]);
  assert.deepEqual([...(await run(index, spec({ unverified: true }), { caveatedIds: new Set() }))], [], 'a real empty mask IS zero matches');
  assert.deepEqual([...(await run(index, spec({ models: ['mA'] }), { caveatedIds: null }))], [0, 1], 'mask ignored when the filter is off');
  assert.doesNotMatch(FILTER_MASK_UNAVAILABLE_TEXT, /[<>]/);
  assert.match(FILTER_MASK_UNAVAILABLE_TEXT, /turn it off to continue/);
});

test('runFilterPass: empty spec fast path returns every canonical index; filtered pass is ascending and deterministic', async () => {
  const index = indexOf(Array.from({ length: 10 }, (_, i) => rec(i, { a: i % 2 ? 'mC' : 'mA' })));
  assert.deepEqual([...(await run(index, EMPTY_FILTER_SPEC))], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(await run(index, EMPTY_FILTER_SPEC, { isCurrent: () => false }), 'superseded', 'fast path honours supersession');
  const a = await run(index, spec({ models: ['mC'] }));
  assert.ok(a instanceof Uint32Array);
  assert.deepEqual([...a], [1, 3, 5, 7, 9]);
  assert.deepEqual([...(await run(index, spec({ models: ['mC'] })))], [...a], 'same input ⇒ same output');
});

test('runFilterPass is sliced: one yield between chunks; supersession checked per chunk', async () => {
  const N = LIST_CHUNK_SIZE * 3 + 5;
  const index = indexOf(Array.from({ length: N }, (_, i) => rec(i)));
  const scheduler = createFakeScheduler();
  const out = await runFilterPass({ index, spec: spec({ models: ['mA'] }), labelText, scheduler });
  assert.equal(out.length, N);
  assert.equal(scheduler.yieldCount, 3, 'yields between the 4 chunks, none after the last');
  let checks = 0;
  const superseded = await runFilterPass({ index, spec: spec({ models: ['mA'] }), labelText, scheduler: createFakeScheduler(), isCurrent: () => (checks += 1) < 4 });
  assert.equal(superseded, 'superseded');
  assert.equal(checks, 4, 'entry check + stopped at the third chunk boundary');
  assert.equal(await runFilterPass({ index, spec: spec({ text: 'x' }), labelText, scheduler: createFakeScheduler(), isCurrent: () => false }), 'superseded');
});

test('AC-P4: filter interactions never touch the engine (derivations spies unchanged after the one mask computation)', async () => {
  const calls = [];
  const spy = (name) => async () => { calls.push(name); return { matches: ['r1'], count: 1, total: 4, unavailable: [] }; };
  const engine = { derivations: { summarize: spy('summarize'), groupBy: spy('groupBy'), filter: spy('filter') }, startRun: () => calls.push('startRun') };
  const recs = Array.from({ length: 4 }, (_, i) => rec(i));
  const index = indexOf(recs);
  const mask = new Set((await engine.derivations.filter({ results: recs }, [{ facet: 'caveated', op: 'eq', value: true }])).matches);   // controller: once per run
  assert.deepEqual(calls, ['filter']);
  for (const s of [spec({ text: '1' }), spec({ unverified: true }), spec({ hasLocation: true }), spec({ models: ['mB'] }), EMPTY_FILTER_SPEC]) {
    await runFilterPass({ index, spec: s, caveatedIds: mask, labelText, scheduler: createFakeScheduler() });
  }
  assert.deepEqual(calls, ['filter'], 'no derivation and no startRun per interaction');
});
