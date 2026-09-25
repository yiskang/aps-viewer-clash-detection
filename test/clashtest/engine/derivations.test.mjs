// test/clashtest/engine/derivations.test.mjs — Task P8.8: the public exports and the `engine.derivations` binding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import * as pkg from '../../../clashtest/index.js';
import * as p5Status from '../../../clashtest/results/status.js';
import { EngineDisposedError, DerivationBusyError, InvalidOptionsError } from '../../../clashtest/errors.js';
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

// ---- M2 refinement (owner ruling 2): filter operands are charged, by EXPANDED node count, against the ENGINE's resolved
// §17.1 `maxCapturedNodes` (propagated as an internal hook — not a derivation limit key, not a public option).
const tooLarge = (e) => e instanceof InvalidOptionsError && e.issues[0].code === 'operand-too-large' && e.issues[0].path === 'clauses[0].value';
const opSet = () => makeResultSet({ units: [U1], results: [{ pair: [['M', 100], ['M', 200]] }] });
const leaves = (n) => Array.from({ length: n }, (_, i) => i);                     // 1 + n nodes

test('engine.derivations.filter enforces the engine-configured maxCapturedNodes on operands: lower budget rejects, higher accepts', async () => {
  let ladder = 1; for (let i = 0; i < 10; i++) ladder = [ladder, ladder];          // 10 containers in memory, 2^11-1 = 2047 nodes expanded
  const low = mkEngine(makeHarness(), { maxCapturedNodes: 1000 }); const high = mkEngine(makeHarness(), { maxCapturedNodes: 100000 });
  await assert.rejects(low.derivations.filter(opSet(), [{ facet: 'elementSecond', op: 'eq', value: ladder }]), tooLarge);   // tiny in memory, over budget expanded
  assert.equal((await high.derivations.filter(opSet(), [{ facet: 'elementSecond', op: 'eq', value: ladder }])).count, 0);
  await assert.rejects(low.derivations.filter(opSet(), [{ facet: 'elementSecond', op: 'in', value: leaves(2000) }]), tooLarge);
  assert.equal((await high.derivations.filter(opSet(), [{ facet: 'elementSecond', op: 'in', value: leaves(2000) }])).count, 0);
});

test('engine.derivations.filter operand budget boundary: expanded size == engine maxCapturedNodes accepted, +1 rejected', async () => {
  const e = mkEngine(makeHarness(), { maxCapturedNodes: 1000 });
  assert.equal((await e.derivations.filter(opSet(), [{ facet: 'elementSecond', op: 'in', value: leaves(999) }])).count, 0);   // 1000 nodes
  await assert.rejects(e.derivations.filter(opSet(), [{ facet: 'elementSecond', op: 'in', value: leaves(1000) }]), tooLarge);  // 1001
  const r = [0, 0, 0, 0]; const dag = Array.from({ length: 199 }, () => r);         // one shared 5-node array, referenced 199 times
  assert.equal((await e.derivations.filter(opSet(), [{ facet: 'elementSecond', op: 'in', value: [...dag, 1, 2, 3] }])).count, 0);  // 1 + 199 x 5 + 3 = 999 nodes
  await assert.rejects(e.derivations.filter(opSet(), [{ facet: 'elementSecond', op: 'in', value: [...dag, r] }]), tooLarge);         // 1 + 200 x 5 = 1001
});
