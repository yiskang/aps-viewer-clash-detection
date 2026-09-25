// test/clashtest/engine/realExecutor.plannedUnits.test.mjs
//
// FIX-D4 end-to-end companion of execution/plannedUnits.request.test.mjs: a run through the real P0-P6
// stack with the engine's DEFAULT executor (`createLocalUnitExecutor`, i.e. `unitExecutor` left
// undefined), so the REAL planner's units flow into the REAL executor's closed request schema.
// `engineWorld.mjs` injects a scripted executor by default only because of the defect this fixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';

test('a run through the engine\'s DEFAULT (real) executor completes: planned units are not rejected (FIX-D4)', async () => {
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24) });
  const world = createEngineWorld();
  const engine = createClashTestEngine(world.config({
    unitExecutor: undefined,                               // the real createLocalUnitExecutor
    now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {},
  }));
  const handle = engine.startRun(world.definition({ testId: 'T' }));
  const summary = await handle.done;
  const set = summary.resultSet;
  const rejected = JSON.stringify(set.ledger).includes('request-unit-unknown-key');
  assert.equal(rejected, false, 'no unit was rejected by the closed unit-key check');
  assert.equal(summary.status, 'completed', JSON.stringify(set.outcome));
  assert.ok(set.ledger.units.length > 0, 'premise: the run really planned and executed units');
});
