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
  const base = { tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'cold' }, narrowPhaseFamilyWins: true, boundaries: [] };
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

function tAFailingTuple(boundaries) {
  return {
    tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'cold' },
    targets: { tA: false, tB1: true, tB2: true, tC: true },
    screenResidualMs: [10, 10, 10, 10, 10],
    narrowPhaseFamilyWins: true, // default for B-class-focused fixtures; C-eligibility tests override state/this explicitly
    boundaries: boundaries.map((b) => ({ memoryBudgetMet: true, lifecycleDemonstrated: true, moduleResolutionEstablished: true, ...b })),
  };
}
const fiveReps = (v) => Array(5).fill(v);

test('B-class boundary: SUFFICIENT when Rᵢ+Hᵢ stays <=50ms every repetition; INSUFFICIENT on one violating rep', () => {
  const sufficient = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  assert.equal(sufficient.tuples[0].boundaries[0].disposition, 'SUFFICIENT');
  assert.equal(sufficient.tuples[0].boundaries[0].class, 'B');
  assert.deepEqual(sufficient.tuples[0].boundaries[0].ownedStages, ['hardClashPrecheck']);

  const insufficient = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: [20, 20, 20, 20, 40], occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  assert.equal(insufficient.tuples[0].boundaries[0].disposition, 'INSUFFICIENT');
});

test('B-class boundary: UNEVALUABLE with reason "missing-vertical" when residual/occupancy is null; NOT_APPLICABLE when inapplicable', () => {
  const unevaluable = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-1a', applicable: true, residualMs: null, occupancyMs: null, deliveryTaskIdentified: null, derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  assert.equal(unevaluable.tuples[0].boundaries[0].disposition, 'UNEVALUABLE');
  assert.equal(unevaluable.tuples[0].boundaries[0].unevaluableReason, 'missing-vertical');

  const notApplicable = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-3', applicable: false, residualMs: null, occupancyMs: null, deliveryTaskIdentified: null, derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  assert.equal(notApplicable.tuples[0].boundaries[0].disposition, 'NOT_APPLICABLE');
  assert.equal(notApplicable.tuples[0].boundaries[0].unevaluableReason, null);
});

test('throws on an unknown boundary id', () => {
  assert.throws(
    () => buildEvidenceVector([tAFailingTuple([{ id: 'WB-99', applicable: true, residualMs: null, occupancyMs: null, deliveryTaskIdentified: null, derivedEvidenceBounded: null }])], passingGlobalPreconditions()),
    /unknown boundary id/,
  );
});

test('warmNarrowPhaseFailure is true only when state is warm AND narrowPhaseFamilyWins is true; false on a cold tuple regardless of narrowPhaseFamilyWins', () => {
  const warmAndWins = buildEvidenceVector(
    [{ ...tAFailingTuple([]), tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'warm' }, narrowPhaseFamilyWins: true }],
    passingGlobalPreconditions(),
  );
  assert.equal(warmAndWins.tuples[0].warmNarrowPhaseFailure, true);

  const coldButWins = buildEvidenceVector(
    [{ ...tAFailingTuple([]), narrowPhaseFamilyWins: true }], // tAFailingTuple defaults to state:'cold'
    passingGlobalPreconditions(),
  );
  assert.equal(coldButWins.tuples[0].warmNarrowPhaseFailure, false);

  const warmButGeometryWins = buildEvidenceVector(
    [{ ...tAFailingTuple([]), tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'warm' }, narrowPhaseFamilyWins: false }],
    passingGlobalPreconditions(),
  );
  assert.equal(warmButGeometryWins.tuples[0].warmNarrowPhaseFailure, false);
});

test('throws when tA fails but narrowPhaseFamilyWins is missing or not boolean', () => {
  const base = { ...tAFailingTuple([]) };
  delete base.narrowPhaseFamilyWins;
  assert.throws(() => buildEvidenceVector([base], passingGlobalPreconditions()), /narrowPhaseFamilyWins/);
});

test('B-class boundary: UNEVALUABLE with reason "undetermined-delivery-task" when any repetition can\'t identify a delivery task', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: [true, true, false, true, true], derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  assert.equal(ev.tuples[0].boundaries[0].disposition, 'UNEVALUABLE');
  assert.equal(ev.tuples[0].boundaries[0].unevaluableReason, 'undetermined-delivery-task');
});

test('C-class boundary: SUFFICIENT/INSUFFICIENT follow the same Rᵢ+Hᵢ<=50ms rule; UNEVALUABLE reason "unboundable-derived-evidence" when the wire-contract bound can\'t be assembled', () => {
  const sufficient = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true }])],
    passingGlobalPreconditions(),
  );
  assert.equal(sufficient.tuples[0].boundaries[0].disposition, 'SUFFICIENT');
  assert.equal(sufficient.tuples[0].boundaries[0].class, 'C');

  const unbounded = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: false }])],
    passingGlobalPreconditions(),
  );
  assert.equal(unbounded.tuples[0].boundaries[0].disposition, 'UNEVALUABLE');
  assert.equal(unbounded.tuples[0].boundaries[0].unevaluableReason, 'unboundable-derived-evidence');
});

test('a boundary whose numeric bound passes but §7.3 condition 6/7/8 evidence is missing is UNEVALUABLE, never SUFFICIENT', () => {
  const missingMemory = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null, memoryBudgetMet: null, lifecycleDemonstrated: true, moduleResolutionEstablished: true }])],
    passingGlobalPreconditions(),
  );
  assert.equal(missingMemory.tuples[0].boundaries[0].disposition, 'UNEVALUABLE');
  assert.equal(missingMemory.tuples[0].boundaries[0].unevaluableReason, 'missing-prerequisite-evidence');
});

test('a boundary whose numeric bound passes but the memory budget was measured and exceeded is INSUFFICIENT, not SUFFICIENT', () => {
  const overBudget = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null, memoryBudgetMet: false, lifecycleDemonstrated: true, moduleResolutionEstablished: true }])],
    passingGlobalPreconditions(),
  );
  assert.equal(overBudget.tuples[0].boundaries[0].disposition, 'INSUFFICIENT');
});

test('only true/true/true for memoryBudgetMet/lifecycleDemonstrated/moduleResolutionEstablished, plus the numeric bound, yields SUFFICIENT', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null, memoryBudgetMet: true, lifecycleDemonstrated: true, moduleResolutionEstablished: true }])],
    passingGlobalPreconditions(),
  );
  assert.equal(ev.tuples[0].boundaries[0].disposition, 'SUFFICIENT');
});

// --- whole-phase (cross-task) review fix round: a known numeric threshold failure is decisive and
// must never be overridden by a null (not-yet-gathered) prerequisite. §7.3's disposition order only
// lets missing PRIMARY threshold evidence (residualMs/occupancyMs null, or an unbounded C-class
// derived-evidence package) outrank conditions 6-8 -- it never says a null condition-6-8 input erases
// an already-proven threshold failure. UNEVALUABLE-via-null-prerequisite is legitimate ONLY when the
// numeric threshold itself already passed. ---

test('B-class: numeric threshold FAILS + a null prerequisite is INSUFFICIENT, never UNEVALUABLE', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: [20, 20, 20, 20, 40], occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null, memoryBudgetMet: null, lifecycleDemonstrated: true, moduleResolutionEstablished: true }])],
    passingGlobalPreconditions(),
  );
  assert.equal(ev.tuples[0].boundaries[0].disposition, 'INSUFFICIENT');
  assert.equal(ev.tuples[0].boundaries[0].unevaluableReason, null);
});

test('B-class: numeric threshold PASSES + a null prerequisite is still UNEVALUABLE (regression -- confirms the existing correct case was not broken by the fix)', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null, memoryBudgetMet: null, lifecycleDemonstrated: true, moduleResolutionEstablished: true }])],
    passingGlobalPreconditions(),
  );
  assert.equal(ev.tuples[0].boundaries[0].disposition, 'UNEVALUABLE');
  assert.equal(ev.tuples[0].boundaries[0].unevaluableReason, 'missing-prerequisite-evidence');
});

test('B-class: numeric threshold PASSES + mixed false/null prerequisites (one false, one null) is INSUFFICIENT -- a known failure is decisive over an unmeasured one', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null, memoryBudgetMet: false, lifecycleDemonstrated: null, moduleResolutionEstablished: true }])],
    passingGlobalPreconditions(),
  );
  assert.equal(ev.tuples[0].boundaries[0].disposition, 'INSUFFICIENT');
  assert.equal(ev.tuples[0].boundaries[0].unevaluableReason, null);
});

test('C-class: numeric threshold FAILS + a null prerequisite is INSUFFICIENT, never UNEVALUABLE (identical bug pattern, mirrored fix)', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2', applicable: true, residualMs: [15, 15, 15, 15, 40], occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true, memoryBudgetMet: null, lifecycleDemonstrated: true, moduleResolutionEstablished: true }])],
    passingGlobalPreconditions(),
  );
  assert.equal(ev.tuples[0].boundaries[0].disposition, 'INSUFFICIENT');
  assert.equal(ev.tuples[0].boundaries[0].unevaluableReason, null);
});

test('full integration: two tuples, mixed dispositions, global preconditions all clear', () => {
  const ev = buildEvidenceVector(
    [
      { tuple: { runtime: 'multi-process', caseId: 'R1', broadPhase: 'linear', state: 'warm' }, targets: { tA: true, tB1: true, tB2: true, tC: true }, screenResidualMs: null, boundaries: [] },
      tAFailingTuple([
        { id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null },
        { id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true },
      ]),
    ],
    passingGlobalPreconditions(),
  );
  assert.equal(ev.tuples.length, 2);
  assert.equal(ev.tuples[0].targetsAllPass, true);
  assert.equal(ev.tuples[1].boundaries.length, 2);
  assert.equal(ev.tuples[1].boundaries[0].disposition, 'SUFFICIENT');
  assert.equal(ev.tuples[1].boundaries[1].disposition, 'SUFFICIENT');
});

// --- codex-advisor hardening round: malformed-but-not-null contract values must throw, never silently
// fall through to a passing disposition. ---

test('throws when a §7.3 prerequisite field is present but not a boolean or null', () => {
  assert.throws(
    () => buildEvidenceVector(
      [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null, memoryBudgetMet: 'false', lifecycleDemonstrated: true, moduleResolutionEstablished: true }])],
      passingGlobalPreconditions(),
    ),
    /memoryBudgetMet must be a boolean or null/,
  );
});

test('throws when deliveryTaskIdentified is not null and not exactly 5 booleans', () => {
  assert.throws(
    () => buildEvidenceVector(
      [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: [true], derivedEvidenceBounded: null }])],
      passingGlobalPreconditions(),
    ),
    /deliveryTaskIdentified must be null or an array of exactly 5 booleans/,
  );
  assert.throws(
    () => buildEvidenceVector(
      [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: [true, true, 'false', true, true], derivedEvidenceBounded: null }])],
      passingGlobalPreconditions(),
    ),
    /deliveryTaskIdentified must be null or an array of exactly 5 booleans/,
  );
});

test('throws when boundary.applicable is not strictly a boolean', () => {
  assert.throws(
    () => buildEvidenceVector(
      [tAFailingTuple([{ id: 'WB-2p', applicable: 'false', residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }])],
      passingGlobalPreconditions(),
    ),
    /applicable must be a boolean/,
  );
  assert.throws(
    () => buildEvidenceVector(
      [tAFailingTuple([{ id: 'WB-2p', residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }])],
      passingGlobalPreconditions(),
    ),
    /applicable must be a boolean/,
  );
});

test('throws when derivedEvidenceBounded is present but not a boolean or null', () => {
  assert.throws(
    () => buildEvidenceVector(
      [tAFailingTuple([{ id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: 'true' }])],
      passingGlobalPreconditions(),
    ),
    /derivedEvidenceBounded must be a boolean or null/,
  );
});

test('throws when a residual/occupancy/screen-residual array contains NaN or an infinite value', () => {
  assert.throws(
    () => buildEvidenceVector(
      [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: [10, 10, 10, 10, NaN], occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }])],
      passingGlobalPreconditions(),
    ),
    /residualMs must be an array of exactly 5 finite numbers/,
  );
  assert.throws(
    () => buildEvidenceVector(
      [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: [10, 10, 10, 10, Infinity], deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }])],
      passingGlobalPreconditions(),
    ),
    /occupancyMs must be an array of exactly 5 finite numbers/,
  );
  const base = { tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'cold' }, narrowPhaseFamilyWins: true, targets: { tA: false, tB1: true, tB2: true, tC: true }, boundaries: [] };
  assert.throws(
    () => buildEvidenceVector([{ ...base, screenResidualMs: [10, 10, 10, 10, -Infinity] }], passingGlobalPreconditions()),
    /screenResidualMs must be an array of exactly 5 finite numbers/,
  );
});

test('throws when tuple.state is not one of cold, warm, refresh', () => {
  assert.throws(
    () => buildEvidenceVector(
      [{ tuple: { runtime: 'multi-process', caseId: 'R1', broadPhase: 'linear', state: 'Warm' }, targets: { tA: true, tB1: true, tB2: true, tC: true }, screenResidualMs: null, boundaries: [] }],
      passingGlobalPreconditions(),
    ),
    /tuple.state must be one of/,
  );
});
