// test/clashtest/integration/libraryExclusions.test.mjs
//
// Owner ruling M1 (P7 independent-review adjudication §M1): `provenance.libraryExclusions` is the library's
// own record of the declared exclusions the planner derived (spec §6.6 item 3, §6.2, §13.2) — the
// `'hierarchy-internal'` code iff the run's hierarchy-internal table is non-empty, `'tree-unreachable-population'`
// iff any model has an unreachable population. Before the fix the engine sealed a static `[]` there while
// `ledger.exclusions` held the codes; the two disagreed on every whole-model self-test of a nested model.
//
// `Run.provenanceOf` now carries the exclusions from the FINAL ledger (single source of truth). These tests
// drive the REAL engine (createClashTestEngine + the P7 engine world + an in-memory result store), so the
// value is proven through seal -> persist -> release -> by-id read-back, and through `assessNoClashClaim`, the
// only consumer that copies it (claim.js never reads it for eligibility).
//
// Owner did NOT authorise a read-time cross-field validator tying provenance to the ledger: nothing here
// asserts one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createRun } from '../../../clashtest/run/Run.js';
import { createRunFixture } from '../support/runFixture.mjs';
import { makeSyntheticEnumerator, defOf } from '../support/syntheticModels.mjs';
import { createPlan, materializeUnit, rootsForRanges } from '../../../clashtest/planning/planner.js';
import { splitUnit } from '../../../clashtest/planning/splitting.js';
import { createRecordBudget, createLedger } from '../../../clashtest/planning/ledger.js';
import { computeSemanticDigest } from '../../../clashtest/definition/normalize.js';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';

const frag = (fragId, ownerDbId, geometryId = 1) => ({ fragId, ownerDbId, geometryId });

/** `nested`: root 20's subtree holds fragments of TWO owners (20, 21) => hierarchy-internal under a
 *  whole-model self-test (§5.6.3). `flat`: two single-owner roots, nothing to declare.
 *  `orphan`: single-owner root plus one not-loaded unreachable fragment => tree-unreachable population.
 *  `both`: a nested root AND an unreachable fragment. */
const MODEL_SPECS = [
  { modelKey: 'nested', roots: [
    { dbId: 20, owners: [20, 21], fragments: [frag(0, 20), frag(1, 21)] },
    { dbId: 30, owners: [30], fragments: [frag(2, 30)] },
  ] },
  { modelKey: 'flat', roots: [
    { dbId: 1, owners: [1], fragments: [frag(0, 1)] },
    { dbId: 2, owners: [2], fragments: [frag(1, 2)] },
  ] },
  { modelKey: 'orphan', roots: [{ dbId: 1, owners: [1], fragments: [frag(0, 1)] }],
    unreachable: [{ fragId: 50, cls: 'N' }] },
  { modelKey: 'both', roots: [
    { dbId: 20, owners: [20, 21], fragments: [frag(0, 20), frag(1, 21)] },
  ], unreachable: [{ fragId: 50, cls: 'N' }] },
];

const selfTestDef = (modelKey) => makeDefinition({
  testId: `S-${modelKey}`,
  selectionA: { entries: [{ kind: 'model', modelKey }] },
  selectionB: { entries: [{ kind: 'model', modelKey }] },
});

function setup() {
  const world = createEngineWorld({ modelSpecs: MODEL_SPECS });
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 25) });
  const resultStore = createInMemoryResultStore();
  const engine = createClashTestEngine(world.config({
    now: clock.now, yieldToScheduler: clock.yieldToScheduler, resultStore,
  }));
  return { engine };
}

/** Run a whole-model self-test of `modelKey`, wait until the set is durable, and return the sealed set. */
async function sealedSelfTest(engine, modelKey) {
  const h = engine.startRun(selfTestDef(modelKey));
  const summary = await h.done;
  assert.equal((await h.persisted).state, 'saved', 'the set is durable');
  return { h, set: summary.resultSet };
}

// ---- the four cases ---------------------------------------------------------------------------------

test('hierarchy-internal only: provenance.libraryExclusions states it, equals ledger.exclusions, survives read-back', async () => {
  const { engine } = setup();
  const { h, set } = await sealedSelfTest(engine, 'nested');
  assert.equal(set.ledger.hierarchyInternal.length, 1, 'precondition: the run has a hierarchy-internal table');
  assert.deepEqual(set.ledger.unreachablePopulation, []);
  assert.deepEqual(set.ledger.exclusions, ['hierarchy-internal']);
  assert.deepEqual(set.provenance.libraryExclusions, ['hierarchy-internal']);
  assert.deepEqual(set.provenance.libraryExclusions, set.ledger.exclusions);

  const before = await engine.assessNoClashClaim(h.runId);
  assert.deepEqual(before.exclusions, ['hierarchy-internal']);

  // seal -> persist -> release the resident copy -> by-id read-back from the store.
  engine.releaseResultSet(h.runId);
  const back = await engine.getResultSet(h.runId);
  assert.notEqual(back, null);
  assert.deepEqual(back.provenance.libraryExclusions, ['hierarchy-internal']);
  assert.deepEqual(back.ledger.exclusions, ['hierarchy-internal']);
  assert.deepEqual((await engine.assessNoClashClaim(h.runId)).exclusions, ['hierarchy-internal']);
});

test('tree-unreachable population only: provenance.libraryExclusions states it, equals ledger.exclusions, survives read-back', async () => {
  const { engine } = setup();
  const { h, set } = await sealedSelfTest(engine, 'orphan');
  assert.deepEqual(set.ledger.hierarchyInternal, []);
  assert.equal(set.ledger.unreachablePopulation.length, 1, 'precondition: the run has an unreachable population');
  assert.deepEqual(set.ledger.exclusions, ['tree-unreachable-population']);
  assert.deepEqual(set.provenance.libraryExclusions, ['tree-unreachable-population']);
  assert.deepEqual((await engine.assessNoClashClaim(h.runId)).exclusions, ['tree-unreachable-population']);

  engine.releaseResultSet(h.runId);
  const back = await engine.getResultSet(h.runId);
  assert.deepEqual(back.provenance.libraryExclusions, ['tree-unreachable-population']);
  assert.deepEqual((await engine.assessNoClashClaim(h.runId)).exclusions, ['tree-unreachable-population']);
});

test('both: provenance.libraryExclusions carries both codes in the ledger\'s code-unit order', async () => {
  const { engine } = setup();
  const { h, set } = await sealedSelfTest(engine, 'both');
  assert.equal(set.ledger.hierarchyInternal.length, 1);
  assert.equal(set.ledger.unreachablePopulation.length, 1);
  assert.deepEqual(set.ledger.exclusions, ['hierarchy-internal', 'tree-unreachable-population']);
  assert.deepEqual(set.provenance.libraryExclusions, ['hierarchy-internal', 'tree-unreachable-population']);
  assert.deepEqual((await engine.assessNoClashClaim(h.runId)).exclusions,
    ['hierarchy-internal', 'tree-unreachable-population']);

  engine.releaseResultSet(h.runId);
  const back = await engine.getResultSet(h.runId);
  assert.deepEqual(back.provenance.libraryExclusions, ['hierarchy-internal', 'tree-unreachable-population']);
});

test('neither: a run with no hierarchy-internal table and no unreachable population states no exclusion', async () => {
  const { engine } = setup();
  const { h, set } = await sealedSelfTest(engine, 'flat');
  assert.deepEqual(set.ledger.hierarchyInternal, []);
  assert.deepEqual(set.ledger.unreachablePopulation, []);
  assert.deepEqual(set.ledger.exclusions, []);
  assert.deepEqual(set.provenance.libraryExclusions, []);
  assert.deepEqual((await engine.assessNoClashClaim(h.runId)).exclusions, []);
});

// ---- the Run-level seams the engine cannot reach ------------------------------------------------------
//
// The engine cannot make the seal fall back (R10) or fail before a plan exists on demand, so these use
// P6's own run fixture over P3's REAL planner (the seam lifecycle.test.mjs uses): `createRun` + the real
// `createPlan`/`createLedger` + real P5 sealing (`realSealing`), on the same nested model.

function nestedRunFixture(opts = {}) {
  const { enumerator } = makeSyntheticEnumerator([MODEL_SPECS[0]]);
  const entries = [{ kind: 'model', modelKey: 'nested' }];
  const definition = defOf({ A: entries, B: entries, testId: 'test-1' });
  const testRef = { testId: 'test-1', revision: definition.revision, semanticDigest: computeSemanticDigest(definition) };
  return createRunFixture({
    realSealing: true,
    models: ['nested'],
    resolveDefinition: () => Promise.resolve({ definition, testRef }),
    ...opts,
    specOverrides: {
      enumerator,
      plannerPort: {
        planRun: createPlan, materializeUnit, splitUnit, rootsForRanges,
        createRecordBudget, createLedger, checkScopeBracket: null,
      },
      ...opts.specOverrides,
    },
  });
}

test('Run seam, normal seal: the real planner\'s exclusions reach provenance (control for the fallback below)', async () => {
  const fx = nestedRunFixture();
  const { handle, begin } = createRun(fx.spec);
  begin();
  const set = (await handle.done).resultSet;
  assert.equal(set.ledger.planExists, true);
  assert.deepEqual(set.ledger.exclusions, ['hierarchy-internal']);
  assert.deepEqual(set.provenance.libraryExclusions, ['hierarchy-internal']);
});

test('Run seam, R10 fallback: provenance follows the FALLBACK ledger (exclusions []), not the live run ledger', async () => {
  // The plan is healthy and `run.ledger` holds 'hierarchy-internal', but the seal fails once and the
  // fallback set is sealed over `emptyLedgerRecord` (planExists false, exclusions []). The single source
  // of truth is the ledger the set actually seals, so provenance must state [] here — a provenance that
  // named 'hierarchy-internal' beside a ledger that does not would be the very disagreement M1 removes.
  const fx = nestedRunFixture({ failSeal: 'sealResultSet' });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  const set = summary.resultSet;
  assert.notEqual(set, null);
  assert.equal(set.ledger.planExists, false, 'this IS the R10 fallback set');
  assert.deepEqual(set.ledger.exclusions, []);
  assert.deepEqual(set.provenance.libraryExclusions, set.ledger.exclusions);
});

test('Run seam, pre-plan seal: a cancelled-before-resolution set states no exclusion', async () => {
  const fx = nestedRunFixture({ resolveDefinition: () => new Promise(() => {}) });   // resolution never settles
  const { handle, begin } = createRun(fx.spec);
  begin();
  const set = (await handle.cancel('user')).resultSet;
  assert.equal(set.definition, null, 'pre-resolution');
  assert.equal(set.ledger.planExists, false);
  assert.deepEqual(set.ledger.exclusions, []);
  assert.deepEqual(set.provenance.libraryExclusions, []);
});

test('each sealed set owns its libraryExclusions array (no aliasing of the ledger or of a shared base)', async () => {
  const { engine } = setup();
  const a = (await sealedSelfTest(engine, 'nested')).set;
  const b = (await sealedSelfTest(engine, 'nested')).set;
  assert.notEqual(a.provenance.libraryExclusions, b.provenance.libraryExclusions);
  assert.notEqual(a.provenance.libraryExclusions, a.ledger.exclusions);
});
