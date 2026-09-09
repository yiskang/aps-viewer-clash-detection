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

test('throws when a global precondition field is missing or not boolean', () => {
  const raw = [{
    tuple: { runtime: 'multi-process', caseId: 'R1', broadPhase: 'linear', state: 'warm' },
    targets: { tA: true, tB1: true, tB2: true, tC: true }, screenResidualMs: null, boundaries: [],
  }];
  const bad = { ...passingGlobalPreconditions(), capacityCensored: 'no' };
  assert.throws(() => buildEvidenceVector(raw, bad), /capacityCensored must be a boolean/);
});

test('throws when a tuple is missing tuple.caseId', () => {
  const raw = [{ tuple: { runtime: 'multi-process' }, targets: { tA: true, tB1: true, tB2: true, tC: true }, screenResidualMs: null, boundaries: [] }];
  assert.throws(() => buildEvidenceVector(raw, passingGlobalPreconditions()), /tuple.runtime and tuple.caseId are required/);
});

test('throws when a target field is not boolean', () => {
  const raw = [{
    tuple: { runtime: 'multi-process', caseId: 'R1', broadPhase: 'linear', state: 'warm' },
    targets: { tA: 'yes', tB1: true, tB2: true, tC: true }, screenResidualMs: null, boundaries: [],
  }];
  assert.throws(() => buildEvidenceVector(raw, passingGlobalPreconditions()), /targets.tA/);
});
