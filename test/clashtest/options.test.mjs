// test/clashtest/options.test.mjs
//
// Behaviour of option validation / resolution. Every number comes from clashtest/options.js
// (spec 17.1 is the single source of defaults; tests never restate them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_OPTION_SPECS, ENGINE_LIMIT_SPECS, RUN_OPTION_KEYS, RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS, SCHEMA_MAX_NODES,
  resolveRunOptions, resolveEngineLimits, assertProducerReaderInvariant, producerReaderIssues, worstCaseCapturedNodes,
} from '../../clashtest/options.js';
import { InvalidOptionsError } from '../../clashtest/errors.js';
import { isDeepFrozen } from '../../clashtest/util/capture.js';

const issuesOf = (fn) => {
  try { fn(); } catch (e) { assert.ok(e instanceof InvalidOptionsError, String(e)); return e; }
  assert.fail('expected InvalidOptionsError');
};
const codes = (e) => e.issues.map((i) => `${i.code}@${i.path}`);

test('omitted options resolve to the provisional defaults; result is frozen and fully populated', () => {
  const r = resolveRunOptions(undefined);
  assert.deepEqual(r, RUN_OPTION_DEFAULTS);
  assert.ok(Object.isFrozen(r));
  assert.deepEqual(resolveRunOptions({}), RUN_OPTION_DEFAULTS);
  assert.deepEqual(resolveEngineLimits(undefined), ENGINE_LIMIT_DEFAULTS);
  assert.deepEqual(resolveEngineLimits({}), ENGINE_LIMIT_DEFAULTS);
});

test('supplied values override defaults; derived defaults follow the resolved earlier key', () => {
  const r = resolveRunOptions({ maxResultsPerRun: 50, broadPhase: 'linear', persist: false, interUnitYield: 'macrotask' });
  assert.equal(r.maxResultsPerRun, 50);
  assert.equal(r.maxPairsPerOutcome, 50);            // default = maxResultsPerRun
  assert.equal(r.broadPhase, 'linear'); assert.equal(r.persist, false); assert.equal(r.interUnitYield, 'macrotask');
  const l = resolveEngineLimits({ maxResidentResultSets: 1 });
  assert.equal(l.maxQueuedRuns, 0);                  // default = maxResidentResultSets - 1
});

test('unknown keys are rejected, and a key in the wrong set says so', () => {
  const e = issuesOf(() => resolveRunOptions({ nope: 1, maxResidentResultSets: 2 }));
  assert.deepEqual(codes(e), ['unknown-key@/nope', 'unknown-key@/maxResidentResultSets']);
  assert.match(e.issues[1].message, /other option set/);
  assert.deepEqual(codes(issuesOf(() => resolveEngineLimits({ maxUnitsPerRun: 5 }))), ['unknown-key@/maxUnitsPerRun']);
  assert.deepEqual(codes(issuesOf(() => resolveRunOptions({ pairSemantics: 'x' }))), ['unknown-key@/pairSemantics']);
});

test('no coercion: integers must be finite safe integers, enums exact, booleans real booleans', () => {
  for (const bad of ['5', 5.5, NaN, Infinity, -Infinity, true, null, [], {}]) {
    issuesOf(() => resolveRunOptions({ maxUnitsPerRun: bad })); // each is refused, never coerced
  }
  assert.equal(issuesOf(() => resolveRunOptions({ maxUnitsPerRun: '5' })).issues[0].code, 'not-an-integer');
  assert.equal(issuesOf(() => resolveRunOptions({ maxUnitsPerRun: 5.5 })).issues[0].code, 'not-an-integer');
  assert.equal(issuesOf(() => resolveRunOptions({ maxUnitsPerRun: NaN })).issues[0].code, 'bad-shape'); // capture rejects non-finite
  assert.equal(issuesOf(() => resolveRunOptions({ broadPhase: 'TLAS' })).issues[0].code, 'bad-enum');
  assert.equal(issuesOf(() => resolveRunOptions({ persist: 1 })).issues[0].code, 'not-a-boolean');
  assert.equal(issuesOf(() => resolveRunOptions({ persist: undefined })).issues[0].code, 'bad-shape');
});

test('the options bag itself must be a plain object of plain values (null, arrays, class instances, accessors)', () => {
  class Opts { constructor() { this.persist = true; } }
  const withGetter = {}; Object.defineProperty(withGetter, 'persist', { enumerable: true, get() { throw new Error('must not be invoked'); } });
  for (const bad of [null, [], 7, 'x', new Opts(), withGetter]) {
    assert.equal(issuesOf(() => resolveRunOptions(bad)).issues[0].code, 'bad-shape');
    assert.equal(issuesOf(() => resolveEngineLimits(bad)).issues[0].code, 'bad-shape');
  }
});

test('every issue is collected, not just the first', () => {
  const e = issuesOf(() => resolveRunOptions({ broadPhase: 'x', maxUnitsPerRun: 0, nope: 1, persist: 'yes' }));
  assert.deepEqual(codes(e).sort(), ['bad-enum@/broadPhase', 'below-minimum@/maxUnitsPerRun', 'not-a-boolean@/persist', 'unknown-key@/nope']);
});

test('minimum and hard ceiling are enforced for every integer option (table-driven from the specs)', () => {
  const check = (specs, resolve) => {
    for (const [key, spec] of Object.entries(specs)) {
      if (spec.kind !== 'int') continue;
      const lo = issuesOf(() => resolve({ [key]: spec.min - 1 })).issues.find((i) => i.path === `/${key}`);
      assert.equal(lo.code, 'below-minimum', key);
      if (spec.ceiling !== null) {
        const hi = issuesOf(() => resolve({ [key]: spec.ceiling + 1 })).issues.find((i) => i.path === `/${key}`);
        assert.equal(hi.code, 'above-ceiling', key);
        // exactly at the ceiling is never a PER-KEY issue (it may still trip a cross-field or reader rule)
        try { resolve({ [key]: spec.ceiling }); } catch (e) {
          assert.ok(e instanceof InvalidOptionsError, key);
          assert.ok(!e.issues.some((i) => i.path === `/${key}` && ['above-ceiling', 'below-minimum', 'not-an-integer'].includes(i.code)), key);
        }
      }
    }
  };
  check(RUN_OPTION_SPECS, (o) => resolveRunOptions(o));
  check(ENGINE_LIMIT_SPECS, (o) => resolveEngineLimits(o));
});

test('cross-field: maxLedgerRecords >= maxPlanReferences + 2 x maxUnitsPerRun', () => {
  const ok = { maxPlanReferences: 1_000, maxUnitsPerRun: 100, maxLedgerRecords: 1_200 };
  assert.equal(resolveRunOptions(ok).maxLedgerRecords, 1_200);
  assert.deepEqual(codes(issuesOf(() => resolveRunOptions({ ...ok, maxLedgerRecords: 1_199 }))), ['cross-field@/maxLedgerRecords']);
  // raising one operand alone can break the default of the other
  assert.deepEqual(codes(issuesOf(() => resolveRunOptions({ maxPlanReferences: RUN_OPTION_DEFAULTS.maxLedgerRecords }))), ['cross-field@/maxLedgerRecords']);
});

test('cross-field: maxPairsPerOutcome <= maxResultsPerRun; maxQueuedRuns <= maxResidentResultSets - 1', () => {
  assert.deepEqual(codes(issuesOf(() => resolveRunOptions({ maxResultsPerRun: 50, maxPairsPerOutcome: 51 }))), ['cross-field@/maxPairsPerOutcome']);
  assert.equal(resolveRunOptions({ maxResultsPerRun: 50, maxPairsPerOutcome: 50 }).maxPairsPerOutcome, 50);
  assert.deepEqual(codes(issuesOf(() => resolveEngineLimits({ maxResidentResultSets: 2, maxQueuedRuns: 2 }))), ['cross-field@/maxQueuedRuns']);
  assert.equal(resolveEngineLimits({ maxResidentResultSets: 2, maxQueuedRuns: 1 }).maxQueuedRuns, 1);
});

test('a bad key never cascades into a spurious cross-field issue', () => {
  assert.deepEqual(codes(issuesOf(() => resolveRunOptions({ maxUnitsPerRun: 'x' }))), ['not-an-integer@/maxUnitsPerRun']);
  assert.deepEqual(codes(issuesOf(() => resolveEngineLimits({ maxResidentResultSets: 0 }))), ['below-minimum@/maxResidentResultSets']);
});

test('maxCapturedNodes: ceiling is SCHEMA_MAX_NODES', () => {
  assert.equal(resolveEngineLimits({ maxCapturedNodes: SCHEMA_MAX_NODES }).maxCapturedNodes, SCHEMA_MAX_NODES);
  assert.equal(issuesOf(() => resolveEngineLimits({ maxCapturedNodes: SCHEMA_MAX_NODES + 1 })).issues[0].code, 'above-ceiling');
});

test('-0 is normalised to 0', () => {
  assert.ok(Object.is(resolveRunOptions({ maxRetainedDiagnostics: -0 }).maxRetainedDiagnostics, 0));
});

test('producer/reader invariant: a run whose worst case does not fit this engine\'s reader limits is refused', () => {
  const limits = resolveEngineLimits({ maxCapturedNodes: 1_000_000 });
  const e = issuesOf(() => resolveRunOptions(undefined, limits));
  assert.equal(e.reason, 'result-unreadable');
  assert.deepEqual(codes(e), ['result-unreadable-nodes@/maxResultsPerRun']);
  // the same options are fine for an engine whose reader limit is large enough
  assert.doesNotThrow(() => resolveRunOptions(undefined, resolveEngineLimits({})));
});

test('producer/reader invariant is exact at the boundary (equal passes, one less fails)', () => {
  const opts = resolveRunOptions(undefined);
  const worst = worstCaseCapturedNodes(opts);
  assert.deepEqual(producerReaderIssues(opts, resolveEngineLimits({ maxCapturedNodes: worst })), []);
  assert.equal(producerReaderIssues(opts, resolveEngineLimits({ maxCapturedNodes: worst - 1 })).length, 1);
});

test('producer/reader invariant, byte half: maxCapturedNodes x bytesPerNode must fit maxStoredResultBytes', () => {
  const limits = resolveEngineLimits({ maxStoredResultBytes: 1_000 });
  const e = issuesOf(() => assertProducerReaderInvariant(resolveRunOptions(undefined), limits));
  assert.equal(e.reason, 'result-unreadable');
  assert.deepEqual(codes(e), ['result-unreadable-bytes@/maxCapturedNodes']);
});

test('option errors are thrown synchronously (not as a rejected promise)', () => {
  let threw = false;
  try { resolveRunOptions({ nope: 1 }); } catch { threw = true; }
  assert.equal(threw, true);
});

test('the spec tables are deeply frozen: a hard ceiling or enum cannot be mutated by an importer', () => {
  assert.equal(isDeepFrozen(RUN_OPTION_SPECS), true);
  assert.equal(isDeepFrozen(ENGINE_LIMIT_SPECS), true);
  assert.throws(() => { RUN_OPTION_SPECS.maxUnitsPerRun.ceiling = Number.MAX_SAFE_INTEGER; }, TypeError);
  assert.throws(() => RUN_OPTION_SPECS.broadPhase.values.push('x'), TypeError);
  const over = RUN_OPTION_SPECS.maxUnitsPerRun.ceiling + 1;
  assert.throws(() => resolveRunOptions({ maxUnitsPerRun: over }), InvalidOptionsError);
});

test('an inherited property named like an option is never mistaken for a resolved option', () => {
  Object.prototype.persist = false; // eslint-disable-line no-extend-native
  try {
    const r = resolveRunOptions({});
    assert.equal(Object.hasOwn(r, 'persist'), true);
    assert.deepEqual(Object.keys(r).sort(), [...RUN_OPTION_KEYS].sort());
  } finally { delete Object.prototype.persist; }
});

test('a supplied limits argument is validated: partial or malformed limits cannot make the producer/reader invariant vacuous', () => {
  assert.throws(() => resolveRunOptions(undefined, { maxCapturedNodes: 'x' }), InvalidOptionsError);
  assert.throws(() => resolveRunOptions(undefined, { bogus: 1 }), InvalidOptionsError);
  assert.deepEqual({ ...resolveRunOptions(undefined, {}) }, { ...resolveRunOptions(undefined) }); // {} = defaults, not "no limits"
  assert.deepEqual({ ...resolveRunOptions(undefined, resolveEngineLimits({})) }, { ...resolveRunOptions(undefined) }); // resolved limits re-resolve
});

test('unknown-key issue paths are JSON-pointer escaped', () => {
  const issues = (() => { try { resolveRunOptions({ 'a/b~c': 1 }); } catch (e) { return e.issues; } return []; })();
  assert.deepEqual(issues.map((i) => i.path), ['/a~1b~0c']);
});
