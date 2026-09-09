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
