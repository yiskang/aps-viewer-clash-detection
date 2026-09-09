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

test('noBoundaryScreenFailed is true only when tA fails and the screen residual exceeds 50ms on any repetition', () => {
  const base = { tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'cold' }, boundaries: [] };
  const failingScreen = buildEvidenceVector(
    [{ ...base, targets: { tA: false, tB1: true, tB2: true, tC: true }, screenResidualMs: [10, 10, 10, 10, 55] }],
    passingGlobalPreconditions(),
  );
  assert.equal(failingScreen.tuples[0].noBoundaryScreenFailed, true);

  const passingScreen = buildEvidenceVector(
    [{ ...base, targets: { tA: false, tB1: true, tB2: true, tC: true }, screenResidualMs: [10, 10, 10, 10, 50] }],
    passingGlobalPreconditions(),
  );
  assert.equal(passingScreen.tuples[0].noBoundaryScreenFailed, false); // 50 exactly passes (<=)

  const tAPassing = buildEvidenceVector(
    [{ ...base, targets: { tA: true, tB1: false, tB2: true, tC: true }, screenResidualMs: null }],
    passingGlobalPreconditions(),
  );
  assert.equal(tAPassing.tuples[0].noBoundaryScreenFailed, false); // §1.1 only applies at a T-a-failing tuple
});

test('throws when tA fails but screenResidualMs is missing or not exactly 5 numbers', () => {
  const base = { tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'cold' }, targets: { tA: false, tB1: true, tB2: true, tC: true }, boundaries: [] };
  assert.throws(() => buildEvidenceVector([{ ...base, screenResidualMs: null }], passingGlobalPreconditions()), /screenResidualMs/);
  assert.throws(() => buildEvidenceVector([{ ...base, screenResidualMs: [1, 2, 3] }], passingGlobalPreconditions()), /screenResidualMs/);
});
