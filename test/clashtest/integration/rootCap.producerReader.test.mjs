// test/clashtest/integration/rootCap.producerReader.test.mjs
//
// D-10 (P7 review-A incidental finding 3): the per-model root caps. The result-set schema caps each model's
// `provenance.models[].scopeDigests.roots` (clashtest/results/resultSetSchema.js:142) and `ledger.rootOwners[].owners`
// (:196) at ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection = 10,000, and the reader enforces that at capture as
// `array-too-long` (validateResultSet.js ARRAY_CEILINGS) => CorruptResultSetError. The producer
// (clashtest/planning/rootResolution.js step 6, :214-224) pushes one row per union root with no count guard, and the
// planner's record budget (maxPlanReferences default 500,000; ~3 plan records per root) does not stop 10,001 roots.
// Evidence record: docs/reviews/2026-09-24-federated-clash-test-core-p7-d10-root-cap-evidence.md.
//
// D-10 APPLIED (owner ruling #5, 2026-09-24): a PRODUCER-SIDE guard in rootResolution.js step 6 refuses any model whose
// union root count RU exceeds MAX_ROOTS_PER_MODEL (= ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection, the constant the
// schema caps both arrays with) as planning `plan-too-large` (overflowClass `root-table`), before any per-root row is
// built. The run seals `failed` and every set it persists reads back. Evidence §6.
//
// Every variant runs the REAL engine (P2 capture -> P3 planning -> P6 run -> seal -> persist) at DEFAULT run options
// with a deterministic scripted executor (evaluation is not the point), then reads the set back by id after release.
//   (a) whole-model scope on a model with 10,001 roots                  -- default limits: REFUSED plan-too-large
//   (b) two explicit selections on the SAME model, 10,000 + 1 dbIds     -- default limits: REFUSED plan-too-large (the
//       per-selection budget, definition/validate.js:205, does not bound the per-model union; the guard does)
//   (c) one explicit selection of 10,001 dbIds                           -- default limits: REFUSED by the definition
//       validator (definition/validate.js:186 `too-many-elements`); with maxExplicitElementsPerSelection raised
//       (engine limit, ceiling 100,000; options.js:89): REFUSED plan-too-large
//   exact 10,000 boundary (whole-model, and explicit union 9,999 + 1)   -- accepted, completes, reads back
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_LIMIT_CEILINGS, ENGINE_LIMIT_DEFAULTS, resolveEngineLimits } from '../../../clashtest/options.js';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import { InvalidTestDefinitionError } from '../../../clashtest/errors.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { validateResultSet } from '../../../clashtest/results/validateResultSet.js';
import { TYPES } from '../../../clashtest/results/resultSetSchema.js';
import { resolveSelectionRoots, MAX_ROOTS_PER_MODEL } from '../../../clashtest/planning/rootResolution.js';
import { createRecordBudget } from '../../../clashtest/planning/ledger.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';
import { makeSyntheticEnumerator, defOf, snapshotOf } from '../support/syntheticModels.mjs';

const CAP = ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection;                     // 10,000: the schema's per-model root cap
const OVER = CAP + 1;
const range = (n, from = 1) => Array.from({ length: n }, (_, i) => from + i);
const frag = (fragId, ownerDbId) => ({ fragId, ownerDbId, geometryId: 1 });
/** A flat synthetic model: one-fragment roots `ids`, fragIds from `fragStart`. */
const flatModel = (modelKey, ids, fragStart = 0) => ({
  modelKey, roots: ids.map((dbId, i) => ({ dbId, owners: [dbId], fragments: [frag(fragStart + i, dbId)] })),
});

/** Run `definition` to seal on the real engine (default run options), then read the set back by id after release. */
async function sealAndReadBack({ modelSpecs, definition, limits }) {
  const store = createInMemoryResultStore();
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24) });
  const engine = createClashTestEngine(createEngineWorld({ modelSpecs }).config({
    now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {}, resultStore: store,
    ...(limits ? { limits } : {}),
  }));
  const summary = await engine.startRun(makeDefinition(definition)).done;
  const resident = await engine.getResultSet(summary.runId).then((v) => v, (err) => err);
  const stored = await store.get(summary.runId);
  engine.releaseResultSet(summary.runId);
  const readBack = await engine.getResultSet(summary.runId).then((v) => v, (err) => err);
  return { summary, resident, stored, readBack, readerLimits: limits ?? resolveEngineLimits(undefined) };
}

const VARIANTS = {
  a: { label: '(a) whole-model scope, 10,001 roots', modelSpecs: [flatModel('mA', range(OVER)), flatModel('mB', [100_000], OVER)],
    definition: { testId: 'T-D10a',
      selectionA: { entries: [{ kind: 'model', modelKey: 'mA' }] },
      selectionB: { entries: [{ kind: 'model', modelKey: 'mB' }] } } },
  b: { label: '(b) two explicit selections on one model, 10,000 + 1 dbIds', modelSpecs: [flatModel('mA', range(OVER))],
    definition: { testId: 'T-D10b',
      selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: range(CAP) }] },
      selectionB: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [OVER] }] } } },
  c: { label: '(c) one explicit selection of 10,001 dbIds, maxExplicitElementsPerSelection raised to 10,001',
    modelSpecs: [flatModel('mA', range(OVER)), flatModel('mB', [100_000], OVER)],
    limits: resolveEngineLimits({ maxExplicitElementsPerSelection: OVER }),
    definition: { testId: 'T-D10c',
      selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: range(OVER) }] },
      selectionB: { entries: [{ kind: 'model', modelKey: 'mB' }] } } },
  // The exact boundary: RU = 10,000 on one model is representable and must still complete.
  wholeAtCap: { label: 'whole-model scope, exactly 10,000 roots', modelSpecs: [flatModel('mA', range(CAP)), flatModel('mB', [100_000], CAP)],
    definition: { testId: 'T-D10w',
      selectionA: { entries: [{ kind: 'model', modelKey: 'mA' }] },
      selectionB: { entries: [{ kind: 'model', modelKey: 'mB' }] } } },
  unionAtCap: { label: 'two explicit selections on one model, 9,999 + 1 = 10,000 union roots', modelSpecs: [flatModel('mA', range(CAP))],
    definition: { testId: 'T-D10u',
      selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: range(CAP - 1) }] },
      selectionB: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [CAP] }] } } },
};
const memo = new Map();
const outcome = (key) => {
  if (!memo.has(key)) memo.set(key, sealAndReadBack(VARIANTS[key]));
  return memo.get(key);
};
/** Every set the engine seals must be read back by the same engine (R21-2): valid AND readable after release. */
const assertReadsBack = ({ summary, stored, readBack, readerLimits }, label) => {
  assert.ok(stored, `${label}: the run persisted its sealed set`);
  assert.deepEqual(validateResultSet(structuredClone(stored), { limits: readerLimits }), { ok: true, issues: [] }, label);
  assert.ok(!(readBack instanceof Error), `${label}: ${String(readBack)}`);
  assert.equal(readBack.runId, summary.runId);
};

test('D-10 preconditions: the schema cap is 10,000 per model; (a)/(b) use DEFAULT limits and pass the definition validator', () => {
  assert.equal(CAP, 10_000);
  assert.equal(ENGINE_LIMIT_DEFAULTS.maxExplicitElementsPerSelection, 10_000);   // per SELECTION, not per model
  assert.equal(ENGINE_LIMIT_CEILINGS.maxExplicitElementsPerSelection, 100_000);
});

test('D-10 guard cap IS the schema\'s own array max for scopeDigests.roots and rootOwners[].owners (no drift)', () => {
  assert.equal(TYPES.get('ScopeDigests').fields.roots.max, MAX_ROOTS_PER_MODEL);
  assert.equal(TYPES.get('RootOwners').fields.owners.max, MAX_ROOTS_PER_MODEL);
  assert.equal(MAX_ROOTS_PER_MODEL, ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection);
});

for (const key of ['a', 'b', 'c']) {
  test(`D-10 ${VARIANTS[key].label}: planning refuses it plan-too-large; the run seals failed and its set reads back`, async () => {
    const out = await outcome(key);
    const { summary, stored } = out;
    assert.equal(summary.status, 'failed');
    // the engine's existing failed-planning seal (as in nodeFactor.ledgerDiagnostic's D-8b reproducer): only plan-too-large gaps
    assert.ok(stored.ledger.planningGaps.length > 0 && stored.ledger.planningGaps.every((g) => g.cause === 'plan-too-large'));
    assert.equal(stored.ledger.planExists, false);
    assert.equal(stored.ledger.units.length, 0);
    assert.ok(stored.provenance.models.every((m) => m.scopeDigests.roots.length <= CAP));
    assert.ok(stored.ledger.rootOwners.every((r) => r.owners.length <= CAP));
    assertReadsBack(out, VARIANTS[key].label);
  });
}

for (const key of ['wholeAtCap', 'unionAtCap']) {
  test(`D-10 boundary ${VARIANTS[key].label}: accepted, completes, validates and reads back after release`, async () => {
    const out = await outcome(key);
    assert.equal(out.summary.status, 'completed');
    assert.equal(out.stored.provenance.models[0].scopeDigests.roots.length, CAP);
    assert.equal(out.stored.ledger.rootOwners[0].owners.length, CAP);
    assertReadsBack(out, VARIANTS[key].label);
  });
}

test('D-10 guard at the root-resolution stage: RU > cap is plan-too-large `root-table`, refused before any row is charged', async () => {
  const run = async (ids, budget) => {
    const { enumerator, bindings } = makeSyntheticEnumerator([flatModel('m', ids)]);
    return resolveSelectionRoots({
      definition: defOf({ A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] }),
      snapshot: snapshotOf(bindings, ['m']), enumerator, checkpoint: () => {}, budget,
    });
  };
  const budget = createRecordBudget({ maxPlanReferences: 500_000, maxLedgerRecords: 1_000_000, maxUnitsPerRun: 10 });
  assert.deepEqual(await run(range(OVER), budget), { ok: false, cause: 'plan-too-large', overflowClass: 'root-table' });
  assert.equal(budget.planRecords, 0);                                     // nothing was charged for the refused model
  // fails closed with no budget as well (the budget is optional for this stage)
  assert.deepEqual(await run(range(OVER), null), { ok: false, cause: 'plan-too-large', overflowClass: 'root-table' });
  const atCap = await run(range(CAP), null);
  assert.equal(atCap.ok, true);
  assert.equal(atCap.models.get('m').scopeDigests.roots.length, CAP);
});

test('D-10 (c) at DEFAULT limits: the definition validator refuses one selection of 10,001 dbIds (validate.js:186 too-many-elements)', async () => {
  const { modelSpecs, definition } = VARIANTS.c;
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24) });
  const engine = createClashTestEngine(createEngineWorld({ modelSpecs }).config({
    now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {},
  }));
  assert.throws(() => engine.startRun(makeDefinition(definition)), (err) => {
    assert.ok(err instanceof InvalidTestDefinitionError, String(err));
    assert.deepEqual(err.issues.map((i) => [i.path, i.code]), [['/selectionA/entries/0/dbIds', 'too-many-elements']]);
    return true;
  });
});

// The standing producer/reader reproducer (precedent R-P7-24), flipped from test.todo by the D-10 fix: it asserts the
// invariant "every set the engine seals is readable by the same engine" over every >10,000-root model scope.
test('D-10 R21-2: every set the engine seals over a >10,000-root model scope is read back by the same engine', async () => {
  for (const key of ['a', 'b', 'c']) assertReadsBack(await outcome(key), VARIANTS[key].label);
});
