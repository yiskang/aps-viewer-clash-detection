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
// Every variant runs the REAL engine (P2 capture -> P3 planning -> P6 run -> seal -> persist) at DEFAULT run options
// with a deterministic scripted executor (evaluation is not the point), then reads the set back by id after release.
//   (a) whole-model scope on a model with 10,001 roots                  -- default limits: REACHABLE
//   (b) two explicit selections on the SAME model, 10,000 + 1 dbIds     -- default limits: REACHABLE (the
//       per-selection budget, definition/validate.js:205, does not bound the per-model union)
//   (c) one explicit selection of 10,001 dbIds                           -- default limits: REFUSED by the definition
//       validator (definition/validate.js:186 `too-many-elements`); REACHABLE once maxExplicitElementsPerSelection
//       is raised (engine limit, ceiling 100,000; options.js:89)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_LIMIT_CEILINGS, ENGINE_LIMIT_DEFAULTS, resolveEngineLimits } from '../../../clashtest/options.js';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import { CorruptResultSetError, InvalidTestDefinitionError } from '../../../clashtest/errors.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { validateResultSet } from '../../../clashtest/results/validateResultSet.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';

const CAP = ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection;                     // 10,000: the schema's per-model root cap
const OVER = CAP + 1;
const range = (n, from = 1) => Array.from({ length: n }, (_, i) => from + i);
const frag = (fragId, ownerDbId) => ({ fragId, ownerDbId, geometryId: 1 });
/** A flat synthetic model: one-fragment roots `ids`, fragIds from `fragStart`. */
const flatModel = (modelKey, ids, fragStart = 0) => ({
  modelKey, roots: ids.map((dbId, i) => ({ dbId, owners: [dbId], fragments: [frag(fragStart + i, dbId)] })),
});
const OVERSIZED_PATHS = ['/ledger/rootOwners/0/owners', '/provenance/models/0/scopeDigests/roots'];

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
};
const memo = new Map();
const outcome = (key) => {
  if (!memo.has(key)) memo.set(key, sealAndReadBack(VARIANTS[key]));
  return memo.get(key);
};

test('D-10 preconditions: the schema cap is 10,000 per model; (a)/(b) use DEFAULT limits and pass the definition validator', () => {
  assert.equal(CAP, 10_000);
  assert.equal(ENGINE_LIMIT_DEFAULTS.maxExplicitElementsPerSelection, 10_000);   // per SELECTION, not per model
  assert.equal(ENGINE_LIMIT_CEILINGS.maxExplicitElementsPerSelection, 100_000);
});

for (const key of ['a', 'b', 'c']) {
  test(`D-10 ${VARIANTS[key].label}: the engine seals and persists a set its own reader rejects as corrupt (OPEN GATE D-10)`, async () => {
    const { summary, resident, stored, readBack, readerLimits } = await outcome(key);
    assert.equal(summary.status, 'completed');
    assert.ok(stored, 'the run persisted its sealed set');
    // the producer wrote one row per union root: 10,001 > the schema cap, in both capped arrays
    assert.equal(stored.provenance.models[0].scopeDigests.roots.length, OVER);
    assert.equal(stored.ledger.rootOwners[0].owners.length, OVER);
    // the same engine hands out its RESIDENT copy without complaint (never validated on this path)
    assert.ok(!(resident instanceof Error), String(resident));
    assert.equal(resident.runId, summary.runId);
    // OPEN GATE D-10: the reader's own validation names exactly the two capped arrays ...
    const v = validateResultSet(structuredClone(stored), { limits: readerLimits });
    assert.equal(v.ok, false);
    assert.deepEqual(v.issues.map((i) => [i.path, i.code]).sort(), OVERSIZED_PATHS.map((p) => [p, 'array-too-long']));
    // ... and the by-id read after release (store read-through) refuses it as CORRUPT, not merely too large
    assert.ok(readBack instanceof CorruptResultSetError, String(readBack));
    assert.deepEqual(readBack.issues.map((i) => [i.path, i.code]).sort(), OVERSIZED_PATHS.map((p) => [p, 'array-too-long']));
  });
}

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

// The standing producer/reader reproducer (precedent R-P7-24): it asserts the invariant "every set the engine seals is
// readable by the same engine" and FAILS today, for exactly D-10: CorruptResultSetError array-too-long on
// /ledger/rootOwners/0/owners and /provenance/models/0/scopeDigests/roots (10,001 > 10,000).
// Flip to test() when the owning phase (P3/P5/P6) fixes it; owner decision pending: derive caps from
// maxPlanReferences (schema change) vs producer-side plan-too-large guard.
test.todo('D-10 R21-2: every set the engine seals over a >10,000-root model scope is read back by the same engine', async () => {
  for (const key of ['a', 'b', 'c']) {
    const { stored, readBack, readerLimits } = await outcome(key);
    assert.deepEqual(validateResultSet(structuredClone(stored), { limits: readerLimits }), { ok: true, issues: [] }, VARIANTS[key].label);
    assert.ok(!(readBack instanceof Error), `${VARIANTS[key].label}: ${String(readBack)}`);
  }
});
