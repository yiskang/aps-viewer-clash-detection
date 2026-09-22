// test/clashtest/execution/unitOutcome.validate.test.mjs
//
// Task P4.5, AC-3 rejection battery, verbatim from the plan
// (docs/superpowers/plans/federated-clash-test-core/p4-executor-diagnostics.md, Task P4.5 step 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUnitOutcome, validateExecutionRequest } from '../../../clashtest/execution/UnitExecutor.js';

const gen = (modelKey, b = 0, p = 0) => ({ modelKey, bindingGeneration: b, placementGeneration: p });
const request = Object.freeze({
  unit: { unitId: '1.0', cell: '1', sourceModelKey: 'mk-a', sourceRanges: [], targets: [], orientationRole: 'A->B', pairSpaceWeight: 4 },
  materialized: {
    sourceDbIds: [10, 11],
    targets: [{ modelKey: 'mk-b', scope: 'roots', dbIds: [20] }],
    scopeExpect: [
      { modelKey: 'mk-a', role: 'source', scope: 'roots', roots: [{ dbId: 10, subtreeDigest: 'sha256:a' }, { dbId: 11, subtreeDigest: 'sha256:b' }] },
      { modelKey: 'mk-b', role: 'target', scope: 'roots', roots: [{ dbId: 20, subtreeDigest: 'sha256:c' }] },
    ],
  },
  runId: 'run-1', attempt: 0, mode: 'volume-overlap', broadPhase: 'tlas',
  snapshot: [{ ...gen('mk-a'), modelVersion: 'v1' }, { ...gen('mk-b'), modelVersion: 'v1' }],
  limits: { maxPairsPerOutcome: 1_000, maxDiagnosticsPerOutcome: 2_000, maxDistinctReasons: 64 },
});

const gens = () => ({ start: [gen('mk-a'), gen('mk-b')], end: [gen('mk-a'), gen('mk-b')] });
const good = (over = {}) => ({
  unitId: '1.0', attempt: 0, outcome: 'evaluated', scopeProof: 'equal', failure: null,
  generations: gens(), pairs: [], diagnostics: [], statistics: { broadPhasePairs: 0 }, durationMs: 1, ...over,
});
/** A `failed` shell so a failure-field row does not also trip the evaluated/scopeProof invariant. */
const failed = (failure) => good({ outcome: 'failed', scopeProof: 'not-checked', failure });
const p = (over = {}) => ({ source: { modelKey: 'mk-a', dbId: 10 }, target: { modelKey: 'mk-b', dbId: 20 }, type: 'volume-overlap', witness: null, ...over });
const d = (over = {}) => ({ scope: 'fragment', reason: 'x', completenessAffecting: true, attribution: 'unit', fragment: { modelKey: null, dbId: null, fragId: 0 }, ...over });

test('the request schema is closed', () => {
  assert.equal(validateExecutionRequest(request).ok, true);
  assert.equal(validateExecutionRequest({ ...request, surprise: 1 }).ok, false);
  assert.equal(validateExecutionRequest({ ...request, mode: 'clearance' }).ok, false, 'clearance needs a clearance');
  assert.equal(validateExecutionRequest({ ...request, mode: 'clearance', clearance: 0.05 }).ok, true);
  assert.equal(validateExecutionRequest({ ...request, clearance: 0.05 }).ok, false, 'clearance only for clearance mode');
  assert.equal(validateExecutionRequest({ ...request, broadPhase: 'bvh' }).ok, false);
  assert.equal(validateExecutionRequest({ ...request, limits: { maxPairsPerOutcome: 1 } }).ok, false, 'limits is closed');
});

test('a well-formed evaluated outcome is accepted', () => {
  assert.deepEqual(validateUnitOutcome(request, good()).issues, []);
});

const REJECTIONS = [
  ['unitId mismatch', good({ unitId: '1.1' })],
  ['attempt mismatch', good({ attempt: 1 })],
  ['evaluated with non-null failure', good({ failure: { code: 'capacity-exceeded' } })],
  ['evaluated with scopeProof drift', good({ scopeProof: 'drift' })],
  ['failed with null failure', good({ outcome: 'failed', failure: null })],
  ['unknown outcome kind', good({ outcome: 'retried' })],
  ['unknown scopeProof', good({ scopeProof: 'maybe' })],
  ['unknown failure.code', failed({ code: 'nope' })],
  ['unknown capacityKind', failed({ code: 'capacity-exceeded', capacityKind: 'nope' })],
  ['over-length failure.message', failed({ code: 'internal-error', message: 'm'.repeat(513) })],
  ['over-length errorName', failed({ code: 'internal-error', errorName: 'e'.repeat(129) })],
  ['duplicate modelKeys', failed({ code: 'model-evicted', modelKeys: ['mk-a', 'mk-a'] })],
  ['non-participant modelKey', failed({ code: 'model-evicted', modelKeys: ['mk-z'] })],
  ['1,000,000 duplicate modelKeys', failed({ code: 'model-evicted', modelKeys: new Array(1_000_000).fill('mk-a') })],
  ['generations missing a participant', good({ generations: { ...gens(), end: [gen('mk-a')] } })],
  ['generations with a duplicate', good({ generations: { ...gens(), start: [gen('mk-a'), gen('mk-a')] } })],
  ['generations with an extra model', good({ generations: { ...gens(), start: [gen('mk-a'), gen('mk-b'), gen('mk-z')] } })],
  ['negative generation', good({ generations: { ...gens(), start: [gen('mk-a', -1), gen('mk-b')] } })],
  ['pair naming a model outside the unit', good({ pairs: [p({ source: { modelKey: 'mk-z', dbId: 10 } })] })],
  ['pair type outside the mode enumeration', good({ pairs: [p({ type: 'clearance' })] })],
  ['evidence of the wrong mode shape', good({ pairs: [{ ...p(), witness: undefined, distance: 1 }] })],
  ['non-finite evidence value', good({ pairs: [p({ witness: { kind: 'containment', point: [0, NaN, 0] } })] })],
  ['pairs over cap', good({ pairs: new Array(1_001).fill(p()) })],
  ['overflow marker below cap', good({ pairs: [], pairsOverflowLength: 5 })],
  ['overflow marker with a non-empty array', good({ pairs: [p()], pairsOverflowLength: 2_000 })],
  ['overflow marker non-integer', good({ pairs: [], pairsOverflowLength: 1.5 })],
  ['overflow marker on a non-evaluated outcome', good({ outcome: 'skipped', scopeProof: 'drift', failure: { code: 'scope-drift' }, diagnosticOverflowLength: 3_000 })],
  ['diagnostics over cap with no marker', good({ diagnostics: new Array(2_001).fill(d()) })],
  ['diagnostic with engine-only occurrences field', good({ diagnostics: [d({ occurrences: 2 })] })],
  ['diagnostic with engine-only unitIds field', good({ diagnostics: [d({ unitIds: ['1.0'] })] })],
  ['diagnostic reason 129 code units', good({ diagnostics: [d({ reason: 'z'.repeat(129) })] })],
  ['unknown statistics key', good({ statistics: { surprise: 1 } })],
  ['a Map anywhere', good({ statistics: new Map() })],
  ['a function anywhere', good({ extra: () => {} })],
  ['negative durationMs', good({ durationMs: -1 })],
  ['non-finite durationMs', good({ durationMs: Infinity })],
];

for (const [label, outcome] of REJECTIONS) {
  test(`rejected: ${label}`, () => {
    const result = validateUnitOutcome(request, outcome);
    assert.equal(result.ok, false, label);
    assert.ok(result.issues.length > 0);
    for (const i of result.issues) assert.ok(i.detail.length <= 512, 'issue details are bounded');
  });
}

test('validateUnitOutcome never throws, whatever it is handed', () => {
  for (const outcome of [undefined, null, 0, 'x', [], { get unitId() { throw new Error('boom'); } }]) {
    assert.doesNotThrow(() => validateUnitOutcome(request, outcome));
    assert.equal(validateUnitOutcome(request, outcome).ok, false);
  }
});

test('the documented limit of validation: a semantically false but structurally valid outcome is ACCEPTED', () => {
  // §7.1 trust boundary. An executor that never called findClashes and returns a clean, empty,
  // scope-proven outcome is indistinguishable from an honest one. This test exists to pin that the
  // engine does NOT pretend to detect it.
  assert.equal(validateUnitOutcome(request, good()).ok, true);
});
