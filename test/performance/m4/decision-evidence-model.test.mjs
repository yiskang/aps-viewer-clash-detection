import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceVector } from './decision-evidence-model.mjs';

function passingGlobalPreconditions() {
  return {
    noConfirmedResponsivenessTarget: false, noRepresentativeRuntime: false, capacityCensored: false,
    workloadValidityFailed: false, insufficientStatisticalConfidence: false, missingCausalAttribution: false,
    unconfirmedMemoryMultipliers: false, undeterminedDeviceScopeOrConcurrency: false,
  };
}

test('a fully-passing tuple with no boundaries yields targetsAllPass:true and no D triggers', () => {
  const raw = [{
    tuple: { runtime: 'multi-process', caseId: 'R1', broadPhase: 'linear', state: 'warm' },
    targets: { tA: true, tB1: true, tB2: true, tC: true },
    screenResidualMs: null,
    boundaries: [],
  }];
  const ev = buildEvidenceVector(raw, passingGlobalPreconditions());
  assert.equal(ev.globalMandatoryD.any, false);
  assert.equal(ev.tuples[0].targetsAllPass, true);
  assert.equal(ev.tuples[0].onlyQueryEvidenceFailing, false);
  assert.equal(ev.tuples[0].noBoundaryScreenFailed, false);
  assert.deepEqual(ev.tuples[0].boundaries, []);
});
