// test/clashtest/definition/capture-stability.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureAndValidate } from '../../../clashtest/definition/validate.js';
import { prepareDefinition, computeSemanticDigest, normalizeDefinition } from '../../../clashtest/definition/normalize.js';
import { isDeepFrozen } from '../../../clashtest/util/capture.js';
import { createFakeClock } from '../support/index.mjs';
import { makeDefinition } from '../support/definitions.mjs';

// Enough entries that the slicer (P0: it reads the clock every `checkEvery` = 64 ticks) checks the deadline
// several times. `tickMs: 1` makes every clock read cost 1 ms, so a 1 ms slice budget is always exhausted.
const MANY = 130;
const manyEntries = () => Array.from({ length: MANY }, (_, i) => ({ kind: 'elements', modelKey: `m${i}`, dbIds: [i, i + 1] }));
const seams = (clock) => ({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, sliceBudgetMs: 1 });
const idle = { now: () => 0, yieldToScheduler: async () => {}, sliceBudgetMs: 1000 };

test('mutating the caller object after capture cannot change the prepared definition', async () => {
  const def = makeDefinition();
  const { captured } = captureAndValidate(def);
  const control = computeSemanticDigest(normalizeDefinition(captureAndValidate(makeDefinition()).captured));

  def.selectionA.entries[0].dbIds.push(999);
  def.mode = 'containment';
  def.testId = 'HIJACKED';
  def.selectionB.entries.pop();

  const { definition, semanticDigest } = await prepareDefinition(captured, seams(createFakeClock({ tickMs: 1 })));
  assert.equal(semanticDigest, control);
  assert.equal(definition.testId, 'T1');
  assert.equal(definition.mode, 'volume-overlap');
  assert.deepEqual(definition.selectionA.entries[0].dbIds, [1, 2]);
  assert.equal(definition.selectionB.entries.length, 1);
});

test('mutating the caller object FROM a yield hook, mid-slice, changes nothing', async () => {
  const def = makeDefinition({ selectionA: { entries: manyEntries() } });
  const { captured } = captureAndValidate(def);
  const clock = createFakeClock({ tickMs: 1 });
  let mutations = 0;
  clock.onYield(() => {
    mutations += 1;
    def.selectionA.entries[0].dbIds[0] = 10 ** 6 + mutations;
    def.selectionA.entries[MANY - 1].dbIds[0] = 10 ** 6 + mutations;   // not yet read at the first yield
    def.selectionB.entries[0].modelKey = `hijacked${mutations}`;       // side B is normalized after side A
    def.mode = 'containment';
  });
  const control = await prepareDefinition(captureAndValidate(makeDefinition({ selectionA: { entries: manyEntries() } })).captured, idle);

  const out = await prepareDefinition(captured, seams(clock));
  assert.ok(mutations > 0, 'the hook must have run at least once');
  assert.equal(out.semanticDigest, control.semanticDigest);
  assert.deepEqual(out.definition, control.definition);
});

test('a getter is never invoked during capture and its object is still rejected', () => {
  let called = 0;
  const def = makeDefinition();
  Object.defineProperty(def, 'mode', { get() { called += 1; return 'volume-overlap'; }, enumerable: true, configurable: true });
  const r = captureAndValidate(def);
  assert.equal(called, 0);
  assert.deepEqual(r.issues.map((i) => `${i.path}:${i.code}`), ['/mode:accessor-property']);
});

test('a proxy that reports valid data is captured once; later target mutation is inert', async () => {
  const target = makeDefinition();
  let ownKeysCalls = 0;
  const proxy = new Proxy(target, { ownKeys(t) { ownKeysCalls += 1; return Reflect.ownKeys(t); } });
  const { captured } = captureAndValidate(proxy);
  assert.equal(ownKeysCalls, 1);                         // P0 reads the root's own keys exactly once
  target.selectionA.entries[0].dbIds.push(999);
  target.mode = 'containment';
  const { definition } = await prepareDefinition(captured, idle);
  assert.deepEqual(definition.selectionA.entries[0].dbIds, [1, 2]);
  assert.equal(definition.mode, 'volume-overlap');
});

test('the prepared definition is deep-frozen', async () => {
  const { captured } = captureAndValidate(makeDefinition());
  const { definition } = await prepareDefinition(captured, idle);
  assert.ok(isDeepFrozen(definition));
  assert.throws(() => { definition.selectionA.entries[0].dbIds.push(3); }, TypeError);
});

test('prepareDefinition actually yields when the slice budget is exhausted', async () => {
  const clock = createFakeClock({ tickMs: 1 });
  const { captured } = captureAndValidate(makeDefinition({
    selectionA: { entries: Array.from({ length: MANY }, (_, i) => ({ kind: 'model', modelKey: `m${i}` })) },
  }));
  await prepareDefinition(captured, seams(clock));
  assert.ok(clock.yieldCount > 0, 'expected at least one cooperative yield');
});

test('the normalization phase itself yields (not only digest and freeze)', async () => {
  const clock = createFakeClock();
  const { captured } = captureAndValidate(makeDefinition({
    selectionA: { entries: Array.from({ length: MANY }, (_, i) => ({ kind: 'model', modelKey: `m${i}` })) },
  }));
  // 2 ticks per entry across normalization (~260) at 50 items per slice => >= 5 yields; freeze alone gives ~2.
  await prepareDefinition(captured, { now: clock.now, yieldToScheduler: clock.yieldToScheduler, limits: { aggregationSliceMaxItems: 50 } });
  assert.ok(clock.yieldCount >= 5, `expected >= 5 yields, saw ${clock.yieldCount}`);
});

test('normalizeDefinition and prepareDefinition agree byte for byte (one shared body)', async () => {
  const captured = captureAndValidate(makeDefinition({ selectionA: { entries: [
    { kind: 'elements', modelKey: 'mB', dbIds: [5, 1, 5] }, { kind: 'elements', modelKey: 'mA', dbIds: [3] }] } })).captured;
  const sync = normalizeDefinition(captured);
  const sliced = await prepareDefinition(captured, { now: () => 0, yieldToScheduler: async () => {} });
  assert.deepEqual(sliced.definition, sync);
  assert.equal(sliced.semanticDigest, computeSemanticDigest(sync));   // digestCanonicalSliced === digestCanonical
});

// ---- P2 review remediation: dbId union/dedupe/sort are sliced (spec 5.3 "run in slices", 17.3) ---------

const CAP = 100_000;                                   // options.js hard ceiling of maxExplicitElementsPerSelection
const BIG_LIMITS = { maxExplicitElementsPerSelection: CAP, aggregationSliceMaxItems: 64 };
const mulberry = (seed) => () => {                     // small deterministic PRNG (no Math.random in tests)
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffledWithDuplicates = (n, distinct, seed) => {
  const rand = mulberry(seed);
  return Array.from({ length: n }, () => Math.floor(rand() * distinct));
};
const nativeSorted = (ids) => [...new Set(ids)].sort((a, b) => a - b);
const capturedWith = (dbIds) => captureAndValidate(
  makeDefinition({ selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds }] } }), { limits: BIG_LIMITS },
).captured;

test('a 100,000-id selection yields at least every 64 dbIds during union and sort (sliced prepare)', async () => {
  const ids = shuffledWithDuplicates(CAP, 70_000, 1);
  const unique = new Set(ids).size;
  assert.ok(unique < CAP && unique > 50_000, 'the input must contain duplicates');
  const captured = capturedWith(ids);
  const clock = createFakeClock();
  const { definition } = await prepareDefinition(captured, { now: clock.now, yieldToScheduler: clock.yieldToScheduler, limits: BIG_LIMITS });
  assert.deepEqual(definition.selectionA.entries[0].dbIds, nativeSorted(ids));
  const passes = Math.ceil(Math.log2(unique));
  const floor = Math.floor((CAP + unique * passes) / 64);           // one tick per id + one per element written per pass
  assert.ok(clock.yieldCount >= floor, `expected >= ${floor} yields, saw ${clock.yieldCount}`);
});

test('the union/dedupe loop never runs more than 64 dbId reads between yields', async () => {
  const ids = shuffledWithDuplicates(CAP, 70_000, 2);
  const captured = capturedWith(ids);
  let reads = 0;
  let maxSpan = 0;
  captured.selectionA.entries[0].dbIds = new Proxy(captured.selectionA.entries[0].dbIds, {
    get(t, k, r) { if (typeof k === 'string' && k !== 'length' && /^\d+$/.test(k)) reads += 1; return Reflect.get(t, k, r); },
  });
  const clock = createFakeClock();
  clock.onYield(() => { maxSpan = Math.max(maxSpan, reads); reads = 0; });
  await prepareDefinition(captured, { now: clock.now, yieldToScheduler: clock.yieldToScheduler, limits: BIG_LIMITS });
  assert.ok(clock.yieldCount > CAP / 64 - 1);
  assert.ok(maxSpan <= 64, `a synchronous span read ${maxSpan} dbIds (> 64)`);
});

test('the dedupe loop alone yields: 100,000 copies of one id still cost >= CAP/64 yields', async () => {
  const captured = capturedWith(new Array(CAP).fill(7));
  const clock = createFakeClock();
  const { definition } = await prepareDefinition(captured, { now: clock.now, yieldToScheduler: clock.yieldToScheduler, limits: BIG_LIMITS });
  assert.deepEqual(definition.selectionA.entries[0].dbIds, [7]);
  assert.ok(clock.yieldCount >= Math.floor(CAP / 64), `saw ${clock.yieldCount} yields`);
});

test('the sort alone yields: 100,000 distinct shuffled ids cost >= n*ceil(log2 n)/64 yields', async () => {
  const rand = mulberry(3);
  const ids = Array.from({ length: CAP }, (_, i) => i);
  for (let i = ids.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const clock = createFakeClock();
  const { definition } = await prepareDefinition(capturedWith(ids), { now: clock.now, yieldToScheduler: clock.yieldToScheduler, limits: BIG_LIMITS });
  assert.deepEqual(definition.selectionA.entries[0].dbIds, ids.slice().sort((a, b) => a - b));
  assert.ok(clock.yieldCount >= Math.floor((CAP + CAP * Math.ceil(Math.log2(CAP))) / 64), `saw ${clock.yieldCount} yields`);
});

test('sync normalizeDefinition and sliced prepareDefinition agree on the 100,000-id input, digest included', async () => {
  const captured = capturedWith(shuffledWithDuplicates(CAP, 70_000, 4));
  const sync = normalizeDefinition(captured);
  const sliced = await prepareDefinition(captured, { now: () => 0, yieldToScheduler: async () => {}, limits: BIG_LIMITS });
  assert.deepEqual(sliced.definition, sync);
  assert.equal(sliced.semanticDigest, computeSemanticDigest(sync));
});

test('the generator sort equals the native sort on random inputs, incl. duplicates across same-model entries', () => {
  const rand = mulberry(5);
  for (let round = 0; round < 300; round += 1) {
    const perModel = new Map();
    const entries = Array.from({ length: 1 + Math.floor(rand() * 6) }, () => {
      const modelKey = `m${Math.floor(rand() * 3)}`;
      const dbIds = Array.from({ length: 1 + Math.floor(rand() * 40) }, () => Math.floor(rand() * 60) * (rand() < 0.1 ? 1e9 : 1));
      perModel.set(modelKey, [...(perModel.get(modelKey) ?? []), ...dbIds]);
      return { kind: 'elements', modelKey, dbIds };
    });
    const captured = captureAndValidate(makeDefinition({ selectionA: { entries } })).captured;
    const got = normalizeDefinition(captured).selectionA.entries;
    const expected = [...perModel.keys()].sort().map((modelKey) => ({ kind: 'elements', modelKey, dbIds: nativeSorted(perModel.get(modelKey)) }));
    assert.deepEqual(got, expected);
  }
  // boundary sizes of the merge passes (0/1/2/3/odd/power-of-two +-1) sorted descending, the worst case
  for (const n of [1, 2, 3, 4, 5, 7, 8, 9, 63, 64, 65, 127, 128, 129]) {
    const ids = Array.from({ length: n }, (_, i) => n - i);
    const captured = captureAndValidate(makeDefinition({ selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: ids }] } })).captured;
    assert.deepEqual(normalizeDefinition(captured).selectionA.entries[0].dbIds, ids.slice().sort((a, b) => a - b));
  }
});
