// test/clashtest/execution/plannedUnits.request.test.mjs
//
// FIX-D4 (P4, owner-authorized cross-phase defect): the REAL planner's work units carry P3's
// non-durable `targetWeight`, the run hands the planned unit to the executor unfiltered, and P4's
// closed unit key set rejected it (`request-unit-unknown-key:unit.targetWeight`) -- so every unit of
// every real run would have failed `internal-error`. P4's own tests all built units BY HAND (without
// the key), which is why nothing noticed. This drives REAL planner output into the REAL validator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, materializeUnit } from '../../../clashtest/planning/planner.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { makeSyntheticEnumerator, defOf, snapshotOf } from '../support/syntheticModels.mjs';
import { makeRequest } from '../support/executionRequests.mjs';
import { validateExecutionRequest } from '../../../clashtest/execution/UnitExecutor.js';

const frag = (fragId, ownerDbId) => ({ fragId, ownerDbId, geometryId: 1 });
const rootOf = (dbId, fragId) => ({ dbId, owners: [dbId], fragments: [frag(fragId, dbId)] });
const models = () => [
  { modelKey: 'arch', roots: [rootOf(1, 0), rootOf(2, 1), rootOf(3, 2)] },
  { modelKey: 'struct', roots: [rootOf(7, 0), rootOf(8, 1), rootOf(9, 2), rootOf(10, 3)] },
];

async function planUnits(options, B = [{ kind: 'model', modelKey: 'struct' }]) {
  const { enumerator, binding } = makeSyntheticEnumerator(models());
  const { plan } = await createPlan({
    definition: defOf({ A: [{ kind: 'model', modelKey: 'arch' }], B }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator, options, checkpoint: () => {},
  });
  return plan;
}

/** The request P6 builds for a planned unit: the unit ITSELF, unfiltered, plus its materialization. */
const requestFor = (plan, unit) => makeRequest({ unit, materialized: materializeUnit(plan, unit),
  snapshot: [{ modelKey: 'arch', modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 },
    { modelKey: 'struct', modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 }] });

test('every unit the REAL planner produces passes the executor\'s request validation (FIX-D4)', async () => {
  const plan = await planUnits(RUN_OPTION_DEFAULTS);
  assert.ok(plan.units.length >= 1);
  for (const unit of plan.units) {
    assert.equal(typeof unit.targetWeight, 'number', 'premise: the real planner really does attach targetWeight');
    assert.deepEqual(validateExecutionRequest(requestFor(plan, unit)).issues, [], unit.unitId);
  }
});

test('the same holds for SLICED units (a small target-fragment cap forces several units) (FIX-D4)', async () => {
  // Element targets (a whole-model target above the cap is a pre-planned GAP, never an executed unit).
  const plan = await planUnits({ ...RUN_OPTION_DEFAULTS, maxTargetFragmentsPerUnit: 2 },
    [{ kind: 'elements', modelKey: 'struct', dbIds: [7, 8, 9, 10] }]);
  assert.ok(plan.units.length > 1, 'premise: the cap really sliced the target into several units');
  for (const unit of plan.units) {
    assert.ok(unit.targetWeight <= 2);
    const result = validateExecutionRequest(requestFor(plan, unit));
    assert.deepEqual(result.issues, [], unit.unitId);
    assert.equal(result.ok, true);
  }
});
