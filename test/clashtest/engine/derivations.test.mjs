// test/clashtest/engine/derivations.test.mjs — Task P8.8: the public exports and the `engine.derivations` binding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import * as pkg from '../../../clashtest/index.js';
import * as p5Status from '../../../clashtest/results/status.js';
import { EngineDisposedError, DerivationBusyError } from '../../../clashtest/errors.js';
// `createExecutionWorld`, NOT P0's bare `createFakeWorld`: constructing an engine builds the
// world's registry (P1), which rejects a world without `admitModel`/`isLeaseValid` with
// `ModelBindingError{reason:'invalid-world'}`. P4's composed double has both surfaces.
import { createExecutionWorld, createFakeEnumerator } from '../support/index.mjs';
import { makeResultSet, U1 } from '../derive/support/makeResultSet.mjs';
import { makeHarness } from '../derive/support/harness.mjs';

const mkEngine = (h, limits = {}) => createClashTestEngine({ world: createExecutionWorld(), enumerator: createFakeEnumerator(), limits,
  now: h.now, yieldToScheduler: () => h.yieldToScheduler() });

test('public exports: the context factory plus the two status readers, which ARE P5\'s functions (no second copy)', () => {
  assert.equal(typeof pkg.createDerivationContext, 'function');
  assert.equal(pkg.getPairStatus, p5Status.getPairStatus);
  assert.equal(pkg.getElementStatus, p5Status.getElementStatus);
  for (const k of ['summarize', 'groupBy', 'filter', 'compareResultSets']) assert.equal(k in pkg, false);   // no free-standing derivation
});

test('engine.derivations uses the engine limits and scheduler and adds exactly one key', async () => {
  const h = makeHarness(); const engine = mkEngine(h, { maxConcurrentDerivations: 1, aggregationSliceMaxItems: 1 });
  assert.deepEqual(Object.keys(engine.derivations).sort(), ['compareResultSets', 'filter', 'groupBy', 'summarize']);
  for (const m of ['startRun', 'rerun', 'getRun', 'getResultSet', 'getFreshness', 'canClaimNoClashes', 'assessNoClashClaim', 'dispose']) assert.equal(typeof engine[m], 'function', m);  // P7's surface is intact
  const set = makeResultSet({ units: [U1], results: [{ pair: [['M', 100], ['M', 200]] }, { pair: [['M', 100], ['M', 300]] }] });
  h.hold();
  const first = engine.derivations.summarize(set);
  await assert.rejects(engine.derivations.summarize(set), (e) => e instanceof DerivationBusyError && e.limit === 1);   // engine limit honoured
  h.releaseAll(); assert.equal((await first).totalResults, 2);
  assert.ok(h.yields >= 1);                                                                                              // the engine's yieldToScheduler was used
});

test('after engine.dispose(), engine.derivations rejects EngineDisposedError; standalone helpers keep working', async () => {
  const engine = mkEngine(makeHarness()); const set = makeResultSet({ units: [U1] });
  await engine.dispose();
  await assert.rejects(engine.derivations.summarize(set), EngineDisposedError);
  assert.equal(pkg.getPairStatus(set, { first: { modelKey: 'M', dbId: 100 }, second: { modelKey: 'M', dbId: 200 } }).verdict, 'covered-clean');
});
