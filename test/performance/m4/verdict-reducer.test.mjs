import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceVerdict } from './verdict-reducer.mjs';
import { buildEvidenceVector } from './decision-evidence-model.mjs';

function passingGlobalPreconditions() {
  return {
    noConfirmedResponsivenessTarget: false, noRepresentativeRuntime: false, capacityCensored: false,
    workloadValidityFailed: false, insufficientStatisticalConfidence: false, missingCausalAttribution: false,
    unconfirmedMemoryMultipliers: false, undeterminedDeviceScopeOrConcurrency: false,
  };
}
function passingTuple(caseId) {
  return { tuple: { runtime: 'multi-process', caseId, broadPhase: 'linear', state: 'warm' }, targets: { tA: true, tB1: true, tB2: true, tC: true }, screenResidualMs: null, boundaries: [] };
}
const fiveReps = (v) => Array(5).fill(v);

test('§19.3 Verdict A: every verdict-bearing tuple passing every target', () => {
  const ev = buildEvidenceVector([passingTuple('R1'), passingTuple('R2')], passingGlobalPreconditions());
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'A');
  assert.equal(verdict.tupleFindings.every((f) => f.status === 'A'), true);
});

const GLOBAL_D_KEYS = [
  'noConfirmedResponsivenessTarget', 'noRepresentativeRuntime', 'capacityCensored', 'workloadValidityFailed',
  'insufficientStatisticalConfidence', 'missingCausalAttribution', 'unconfirmedMemoryMultipliers', 'undeterminedDeviceScopeOrConcurrency',
];

test('§7.5 conditions 1-8: any true global precondition forces D even when every tuple would otherwise pass (A)', () => {
  for (const key of GLOBAL_D_KEYS) {
    const globalPreconditions = { ...passingGlobalPreconditions(), [key]: true };
    const ev = buildEvidenceVector([passingTuple('R1')], globalPreconditions);
    const verdict = reduceVerdict(ev);
    assert.equal(verdict.verdict, 'D', `condition ${key} must force D`);
    assert.equal(verdict.causes.some((c) => c.scope === 'global'), true);
  }
});
