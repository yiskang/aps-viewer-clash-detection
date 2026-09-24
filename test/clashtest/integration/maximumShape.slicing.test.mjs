// test/clashtest/integration/maximumShape.slicing.test.mjs
//
// Task P7.9 Step 6 — AC-12(a) slicing STRUCTURE of every engine-observable sliced span, at the
// `scaled` maximum shape (support/maximumShape.mjs). Split from maximumShape.test.mjs only so the two
// halves run in parallel under `npm test` (each is several seconds of real work).
//
// What is asserted (R-P7-8; preflight scan row "P7.9 Step 6"):
//   1. occurrence — every label the ENGINE's `spanRecorder` can observe is recorded and yields: the
//      read path (`validate:shape|cross-field|linkage|order|digest`, `freeze`) and definition
//      preparation (`normalize`, `semanticDigest`). The plan's `plan`/`merge`/`digest`/`seal`/
//      `validate-result-set` labels do not exist, and Run.js's own slicer has no recorder (Run.js
//      ~l.1516), so run-internal spans are NOT observable here — the occurrence test makes that gap
//      visible (a run yields more often than the recorder sees) instead of asserting it away.
//   2. cadence — on a frozen clock only the item ceiling ends a slice, so a read yields EXACTLY
//      floor(items / aggregationSliceMaxItems) times (items counted independently of the slicer); on a
//      1-ms-per-read clock the clock is consulted at least every 64 items (spec §17.3).
//   3. size-dependence lives in the number of slices — a tenth-size input yields strictly fewer times,
//      per label.
//   4. absence of size-dependent unsliced work — a spy on native sort, Set insertion and SHA-256 update
//      during the SYNCHRONOUS prefix of startRun / getResultSet / rerun sees identical work at 1/10 the size
//      (and no sort or digest at all), while it does see the sliced work that follows.
// Nothing here compares a duration to anything (G-CAL): spans are fake-clock ms, recorded through
// `recordAc12` (emitted when CLASHTEST_AC12_LOG is set). Every §17.1 value is imported; the non-default
// test values are named constants. G-EC: `provenance.models[].elementCount` is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import { validateResultSetSteps, captureResultSet } from '../../../clashtest/results/validateResultSet.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { canonicalJson, Sha256 } from '../../../clashtest/util/canonical.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';
import {
  maximumShapeSet, PROVISIONAL_SHAPES, tenthOf, SHAPE_MODEL_A, SHAPE_MODEL_B, recordAc12, summarizeSpans,
} from '../support/maximumShape.mjs';

/** A slicer item ceiling small enough that even a label with a handful of items (`semanticDigest` ticks
 *  once per ~8 KiB of canonical text) must yield. */
const TINY_SLICE_ITEMS = 4;
/** A non-default item ceiling for the exact-cadence count. */
const CADENCE_SLICE_ITEMS = 500;
/** Spec §17.3: "a slice checks the injected `now` at least every 64 items" (a spec constant, not §17.1). */
const SPEC_CHECK_EVERY = 64;

const EPOCH = Date.UTC(2026, 8, 24);
const READ_LABELS = ['validate:shape', 'validate:cross-field', 'validate:linkage', 'validate:order', 'validate:digest', 'freeze'];
const DEFINITION_LABELS = ['normalize', 'semanticDigest'];

/** A direct definition whose selection A lists `n` explicit mA elements, descending (so normalization
 *  really sorts). Only the definition-preparation spans matter; the run enumerates what it can. */
const explicitDefinition = (n, testId = 'T-explicit') => makeDefinition({
  testId,
  selectionA: { entries: [{ kind: 'elements', modelKey: SHAPE_MODEL_A, dbIds: Array.from({ length: n }, (_, i) => n - i) }] },
  selectionB: { entries: [{ kind: 'model', modelKey: SHAPE_MODEL_B }] },
});

/** Items a store read-through ticks, counted WITHOUT the slicer: one per `validateResultSetSteps` step
 *  plus one per object `deepFreezeSliced` freezes (readResultSet's two sliced loops). */
function readTickCount(set, limits) {
  const captured = captureResultSet(JSON.parse(canonicalJson(set)), { limits });
  let steps = 0;
  const it = validateResultSetSteps(captured, { limits });
  for (let s = it.next(); !s.done; s = it.next()) steps += 1;
  let objects = 0;
  const stack = [captured];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    objects += 1;
    for (const k of Object.keys(v)) stack.push(v[k]);
  }
  return steps + objects;
}

/** An engine on a fake clock (every `now()` read costs `tickMs`), recording every span it can observe. */
function slicingEngine({ tickMs, limits = {} } = {}) {
  const clock = createFakeClock({ start: EPOCH, tickMs });
  const spans = [];
  let reads = 0;
  const store = createInMemoryResultStore();
  const engine = createClashTestEngine(createEngineWorld().config({
    now: () => { reads += 1; return clock.now(); },
    yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {},
    spanRecorder: (label, ms) => spans.push({ label, ms }), resultStore: store, limits,
  }));
  return { engine, clock, spans, store, clockReads: () => reads };
}

/** Runs `op` and returns what the engine's recorder and scheduler saw DURING it. */
async function observe(fx, op) {
  fx.spans.length = 0;
  const yields0 = fx.clock.yieldCount;
  const reads0 = fx.clockReads();
  const value = await op();
  return { value, spans: [...fx.spans], yields: fx.clock.yieldCount - yields0, clockReads: fx.clockReads() - reads0 };
}

/** Memoized per file: the scaled set and ONE ticking-clock (1 ms per `now()` read, provisional limits)
 *  observation of its store read-through, shared by the occurrence, cadence and size tests. */
let scaledSetPromise = null;
const scaledSet = () => (scaledSetPromise ??= maximumShapeSet(PROVISIONAL_SHAPES.scaled, { runId: 'run-ac12-slicing' }));
let scaledReadPromise = null;
const scaledTickingRead = () => (scaledReadPromise ??= (async () => {
  const set = await scaledSet();
  const fx = slicingEngine({ tickMs: 1 });
  await fx.store.put(set);
  return observe(fx, () => fx.engine.getResultSet(set.runId));
})());

const countBy = (spans) => {
  const m = new Map();
  for (const { label } of spans) m.set(label, (m.get(label) ?? 0) + 1);
  return m;
};

test('AC-12(a) occurrence: every engine-observable sliced label is recorded and yields', async (t) => {
  const set = await scaledSet();
  const read = await scaledTickingRead();
  assert.equal(canonicalJson(read.value), canonicalJson(set));
  const readLabels = countBy(read.spans);
  for (const label of READ_LABELS) assert.ok(readLabels.get(label) > 0, `${label} yielded (${readLabels.get(label) ?? 0})`);
  // Every yield of the operation went through a labelled slice: the recorder saw exactly the
  // scheduler's yields, so no yield (and no span) is unaccounted for.
  assert.equal(read.spans.length, read.yields);
  assert.ok(read.yields > 0);

  // Definition preparation at the cap-sized explicit list. `semanticDigest` ticks once per ~8 KiB of
  // canonical text (a handful of items), so a small item ceiling is what makes it yield at all.
  const prep = slicingEngine({ tickMs: 1, limits: { aggregationSliceMaxItems: TINY_SLICE_ITEMS } });
  const prepared = await observe(prep, () => prep.engine.startRun(explicitDefinition(ENGINE_LIMIT_DEFAULTS.maxExplicitElementsPerSelection)).done);
  const prepLabels = countBy(prepared.spans);
  for (const label of DEFINITION_LABELS) assert.ok(prepLabels.get(label) > 0, `${label} yielded (${prepLabels.get(label) ?? 0})`);
  // R-P7-8 gap, made visible: a RUN also yields through Run.js's own slicer and the inter-unit yield,
  // neither of which reports to the engine's recorder — so here the recorder sees at most the yields.
  assert.ok(prepared.spans.length <= prepared.yields);

  // Recorded, never gated (fake-clock ms: the STRUCTURE record; real-clock ms are in the round trips).
  recordAc12(t, 'slicing occurrence', {
    read: summarizeSpans(read.spans), prepare: summarizeSpans(prepared.spans),
    runYieldsUnobservedByRecorder: prepared.yields - prepared.spans.length,
  });
});

test('AC-12(a) cadence: at most aggregationSliceMaxItems items per slice, the clock read at least every 64', async (t) => {
  const set = await scaledSet();
  const items = readTickCount(set, ENGINE_LIMIT_DEFAULTS);

  // Frozen clock: only the item ceiling can end a slice, so the read yields EXACTLY once per full slice.
  const frozen = slicingEngine({ tickMs: 0, limits: { aggregationSliceMaxItems: CADENCE_SLICE_ITEMS } });
  await frozen.store.put(set);
  const f = await observe(frozen, () => frozen.engine.getResultSet(set.runId));
  assert.equal(f.yields, Math.floor(items / CADENCE_SLICE_ITEMS), `${items} items / ${CADENCE_SLICE_ITEMS} per slice`);
  assert.equal(f.spans.length, f.yields);

  // Ticking clock (1 ms per read) at the provisional limits: the clock is consulted at least every 64
  // items, so a slice ends after at most 64 x sliceBudgetMs items — far below the item ceiling.
  const k = await scaledTickingRead();
  assert.ok(k.clockReads >= Math.floor(items / SPEC_CHECK_EVERY), `${k.clockReads} clock reads for ${items} items`);
  assert.ok(k.yields >= Math.floor(items / (SPEC_CHECK_EVERY * ENGINE_LIMIT_DEFAULTS.sliceBudgetMs)), `${k.yields} yields for ${items} items`);
  assert.ok(k.yields >= Math.floor(items / ENGINE_LIMIT_DEFAULTS.aggregationSliceMaxItems));

  recordAc12(t, 'slicing cadence', { items, frozenYields: f.yields, tickingYields: k.yields, clockReads: k.clockReads });
});

test('AC-12(a) size-dependence lives in the NUMBER of slices: a tenth-size input yields strictly fewer times', async () => {
  const counts = (read) => ({ total: read.yields, byLabel: countBy(read.spans) });
  const big = counts(await scaledTickingRead());
  const fx = slicingEngine({ tickMs: 1 });
  const tenth = await maximumShapeSet(tenthOf(PROVISIONAL_SHAPES.scaled), { runId: 'run-ac12-small' });
  await fx.store.put(tenth);
  const small = counts(await observe(fx, () => fx.engine.getResultSet(tenth.runId)));
  assert.ok(small.total < big.total, `${small.total} < ${big.total}`);
  for (const label of READ_LABELS) {
    const b = big.byLabel.get(label) ?? 0;
    const s = small.byLabel.get(label) ?? 0;
    assert.ok(b > 0 && s < b, `${label}: tenth ${s} < scaled ${b}`);
  }

  const prep = async (n) => {
    const fx = slicingEngine({ tickMs: 1 });
    const o = await observe(fx, () => fx.engine.startRun(explicitDefinition(n)).done);
    return countBy(o.spans).get('normalize') ?? 0;
  };
  const cap = ENGINE_LIMIT_DEFAULTS.maxExplicitElementsPerSelection;
  const bigNormalize = await prep(cap);
  const smallNormalize = await prep(Math.floor(cap / 10));
  assert.ok(smallNormalize < bigNormalize, `normalize: tenth ${smallNormalize} < cap-size ${bigNormalize}`);
});

/**
 * Counts, during ONE synchronous call only, every native sort, every Set insertion (de-duplication) and
 * every SHA-256 update (digesting). Restored before the call's Promise is awaited.
 */
function spySynchronous(call) {
  const originals = { sort: Array.prototype.sort, add: Set.prototype.add, update: Sha256.prototype.update };
  const counts = { sort: 0, add: 0, update: 0 };
  /* eslint-disable no-extend-native */
  Array.prototype.sort = function sort(...a) { counts.sort += 1; return originals.sort.apply(this, a); };
  Set.prototype.add = function add(...a) { counts.add += 1; return originals.add.apply(this, a); };
  Sha256.prototype.update = function update(...a) { counts.update += 1; return originals.update.apply(this, a); };
  let value;
  try {
    value = call();
  } finally {
    Array.prototype.sort = originals.sort;
    Set.prototype.add = originals.add;
    Sha256.prototype.update = originals.update;
  }
  /* eslint-enable no-extend-native */
  return { value, counts };
}

test('AC-12(a) the synchronous path does no size-dependent sort, de-duplication or digesting (spy)', async () => {
  const cap = ENGINE_LIMIT_DEFAULTS.maxExplicitElementsPerSelection;
  const syncStartRun = async (n) => {
    const fx = slicingEngine({ tickMs: 1 });
    const { value: handle, counts } = spySynchronous(() => fx.engine.startRun(explicitDefinition(n)));
    // The spy CAN see this work: after the synchronous prefix, preparation sorts, de-duplicates and digests.
    const after = { add: 0, update: 0 };
    const addOriginal = Set.prototype.add;
    const updateOriginal = Sha256.prototype.update;
    /* eslint-disable no-extend-native */
    Set.prototype.add = function add(...a) { after.add += 1; return addOriginal.apply(this, a); };
    Sha256.prototype.update = function update(...a) { after.update += 1; return updateOriginal.apply(this, a); };
    try { await handle.done; } finally { Set.prototype.add = addOriginal; Sha256.prototype.update = updateOriginal; }
    /* eslint-enable no-extend-native */
    return { counts, after };
  };
  const big = await syncStartRun(cap);
  const small = await syncStartRun(Math.floor(cap / 10));
  assert.deepEqual(big.counts, small.counts, 'the synchronous prefix of startRun does the same work at 1/10 the size');
  assert.equal(big.counts.sort, 0, 'no native sort in the synchronous prefix');
  assert.equal(big.counts.update, 0, 'no digesting in the synchronous prefix');
  assert.ok(big.after.add >= cap && big.after.update > small.after.update,
    `the spy observes the sliced work that follows (${big.after.add} inserts, ${big.after.update} digest updates)`);

  // The by-id read and rerun prefixes: nothing size-dependent before the first await either.
  const byId = async (set) => {
    const fx = slicingEngine({ tickMs: 1 });
    await fx.store.put(set);
    const read = spySynchronous(() => fx.engine.getResultSet(set.runId));
    await read.value;
    const again = spySynchronous(() => fx.engine.rerun(set.runId));
    await (await again.value).done;
    return { read: read.counts, rerun: again.counts };
  };
  const bigById = await byId(await scaledSet());
  const smallById = await byId(await maximumShapeSet(tenthOf(PROVISIONAL_SHAPES.scaled), { runId: 'run-ac12-sync-small' }));
  assert.deepEqual(bigById, smallById, 'getResultSet / rerun by id: identical synchronous work at 1/10 the size');
  for (const c of [bigById.read, bigById.rerun]) assert.equal(c.sort + c.update, 0);
});
