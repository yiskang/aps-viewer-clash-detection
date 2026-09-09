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

function tAFailingTuple(caseId, boundaries, screenResidualMs = fiveReps(10), state = 'cold', narrowPhaseFamilyWins = true) {
  return {
    tuple: { runtime: 'multi-process', caseId, broadPhase: 'linear', state },
    targets: { tA: false, tB1: true, tB2: true, tC: true },
    screenResidualMs,
    narrowPhaseFamilyWins, // Task 2.4's derived warmNarrowPhaseFailure = (state==='warm' && this) --
                            // default true is harmless for B-only fixtures (no C-class boundary
                            // present); C-related fixtures below pass state:'warm' explicitly.
    boundaries: boundaries.map((b) => ({ memoryBudgetMet: true, lifecycleDemonstrated: true, moduleResolutionEstablished: true, ...b })), // Task 2.4's §7.3 conditions 6/7/8 gate -- defaulted true for fixtures not testing it
  };
}
function onlyQueryEvidenceFailingTuple(caseId) {
  return { tuple: { runtime: 'multi-process', caseId, broadPhase: 'linear', state: 'warm' }, targets: { tA: true, tB1: false, tB2: true, tC: true }, screenResidualMs: null, boundaries: [] };
}

test('§7.5.9 no-full-query-evidence: a tuple whose only failing metrics are T-b1/T-b2/T-c forces D, unconditionally', () => {
  const ev = buildEvidenceVector([onlyQueryEvidenceFailingTuple('R2')], passingGlobalPreconditions());
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes[0].cause, 'no-full-query-evidence');
});

test('§1.1 no-boundary: condition 3\'s screen failing at a T-a-failing tuple forces D and is never conflated with no-full-query-evidence', () => {
  const ev = buildEvidenceVector([tAFailingTuple('R3', [], fiveReps(60))], passingGlobalPreconditions());
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes[0].cause, 'no-boundary');
});

test('§19.3 Verdict B: exactly one applicable B-class boundary SUFFICIENT and every other condition satisfied', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple('R3', [{ id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'B');
  assert.deepEqual(verdict.settledBoundaries, ['WB-2p']);
});

test('§19.3 no applicable boundary of either class SUFFICIENT: falls to D under §7.5.10, never silently to B or C', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple('R3', [{ id: 'WB-2p', applicable: true, residualMs: [20, 20, 20, 20, 40], occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes[0].cause, 'no-settled-boundary');
});

test('§19.3 Verdict C: every applicable B-class boundary INSUFFICIENT and a named C-class boundary SUFFICIENT, mechanical difference named (WARM tuple -- C is only reachable there)', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple('R3', [
      { id: 'WB-2p', applicable: true, residualMs: [20, 20, 20, 20, 40], occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null },
      { id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true },
    ], fiveReps(10), 'warm')],
    passingGlobalPreconditions(),
  );
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'C');
  assert.deepEqual(verdict.settledBoundaries, ['WB-2']);
  const diff = verdict.mechanicalDifferences[0].mechanicalDifference[0];
  assert.equal(diff.cBoundaryId, 'WB-2');
  assert.deepEqual(diff.rejectedBBoundaries[0].extraStagesOwnedByC, ['exactNarrowPhase', 'clearanceDistanceQuery']); // WB-2p owns only hardClashPrecheck
});

test('§7.3 negative: an otherwise-identical COLD tuple can never reach Verdict C, even though the C-class boundary\'s own numeric bound (and every other condition) would pass', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple('R3', [
      { id: 'WB-2p', applicable: true, residualMs: [20, 20, 20, 20, 40], occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null },
      { id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true },
    ])], // default state:'cold' -- everything else identical to the passing Verdict-C fixture above
    passingGlobalPreconditions(),
  );
  const verdict = reduceVerdict(ev);
  assert.notEqual(verdict.verdict, 'C');
  assert.equal(verdict.verdict, 'D'); // WB-2p is INSUFFICIENT and WB-2, though numerically sufficient, is not applicable on a cold tuple -- no-settled-boundary
  assert.equal(verdict.causes[0].cause, 'no-settled-boundary');
});

test('§19.3 B-over-C precedence: a WARM tuple where a B-class boundary is SUFFICIENT and a C-class boundary would also satisfy reports B, never C and never both', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple('R3', [
      { id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null },
      { id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true },
    ], fiveReps(10), 'warm')], // warm + C genuinely applicable-and-sufficient, so this proves real precedence, not accidental inapplicability
    passingGlobalPreconditions(),
  );
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'B');
  assert.equal('mechanicalDifferences' in verdict, false);
});

test('C-class vacuous B-applicability (exact-query-substage case: no B-class boundary applicable at all), WARM tuple', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple('R3', [{ id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true }], fiveReps(10), 'warm')],
    passingGlobalPreconditions(),
  );
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'C');
  assert.equal(verdict.mechanicalDifferences[0].mechanicalDifference.vacuous, true);
});

test('§19.3: each of §7.5\'s ten mandatory-D causes fires individually, plus §1.1\'s no-boundary cause separately (11 total)', () => {
  // 1-8: global preconditions, already covered by the table-driven test in Step 6 -- re-asserted here
  // as part of the complete named-cause inventory this fixture suite requires.
  for (const key of GLOBAL_D_KEYS) {
    const ev = buildEvidenceVector([passingTuple('R1')], { ...passingGlobalPreconditions(), [key]: true });
    assert.equal(reduceVerdict(ev).verdict, 'D');
  }
  // 9: no-full-query-evidence
  assert.equal(reduceVerdict(buildEvidenceVector([onlyQueryEvidenceFailingTuple('R2')], passingGlobalPreconditions())).causes[0].cause, 'no-full-query-evidence');
  // 10: no-settled-boundary (no applicable boundary of either class at all)
  assert.equal(reduceVerdict(buildEvidenceVector([tAFailingTuple('R3', [])], passingGlobalPreconditions())).causes[0].cause, 'no-settled-boundary');
  // §1.1: no-boundary
  assert.equal(reduceVerdict(buildEvidenceVector([tAFailingTuple('R3', [], fiveReps(60))], passingGlobalPreconditions())).causes[0].cause, 'no-boundary');
});

test('§19.3 every UNEVALUABLE path: UNEVALUABLE is never scored as INSUFFICIENT and never silently promoted to SUFFICIENT', () => {
  const missingVertical = tAFailingTuple('R3', [{ id: 'WB-2p', applicable: true, residualMs: null, occupancyMs: null, deliveryTaskIdentified: null, derivedEvidenceBounded: null }]);
  assert.equal(reduceVerdict(buildEvidenceVector([missingVertical], passingGlobalPreconditions())).causes[0].cause, 'no-settled-boundary');

  const unboundedDerived = tAFailingTuple('R3', [{ id: 'WB-2', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: null, derivedEvidenceBounded: false }]);
  assert.equal(reduceVerdict(buildEvidenceVector([unboundedDerived], passingGlobalPreconditions())).causes[0].cause, 'no-settled-boundary');

  const undeterminedDelivery = tAFailingTuple('R3', [{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: [true, false, true, true, true], derivedEvidenceBounded: null }]);
  assert.equal(reduceVerdict(buildEvidenceVector([undeterminedDelivery], passingGlobalPreconditions())).causes[0].cause, 'no-settled-boundary');
});

test('§19.3 mixed cold/warm multi-tuple aggregation: aggregate reports B, naming both distinct boundaries', () => {
  const coldTuple = tAFailingTuple('R3-cold', [{ id: 'WB-1b', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }]);
  const warmTuple = { ...tAFailingTuple('R3-warm', [{ id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }]), tuple: { runtime: 'multi-process', caseId: 'R3-warm', broadPhase: 'linear', state: 'warm' } };
  const verdict = reduceVerdict(buildEvidenceVector([coldTuple, warmTuple], passingGlobalPreconditions()));
  assert.equal(verdict.verdict, 'B');
  assert.deepEqual(new Set(verdict.settledBoundaries), new Set(['WB-1b', 'WB-2p']));
});

test('§19.3 aggregate reports D even though every other tuple is settled, per the "any unsettled tuple forces D" rule', () => {
  const settled = tAFailingTuple('R3', [{ id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }]);
  const unsettled = { ...tAFailingTuple('R4', []), tuple: { runtime: 'multi-process', caseId: 'R4', broadPhase: 'linear', state: 'cold' } };
  const verdict = reduceVerdict(buildEvidenceVector([settled, unsettled], passingGlobalPreconditions()));
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes.some((c) => c.cause === 'no-settled-boundary'), true);
});

test('§7.3 multi-tuple: C is named whenever settling at least one tuple required a C-class boundary, even where others were settled by B alone', () => {
  const bSettled = tAFailingTuple('R3', [{ id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }]);
  const cSettled = { ...tAFailingTuple('R4', [
    { id: 'WB-2p', applicable: true, residualMs: [20, 20, 20, 20, 40], occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null },
    { id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true },
  ]), tuple: { runtime: 'multi-process', caseId: 'R4', broadPhase: 'linear', state: 'warm' } };
  const verdict = reduceVerdict(buildEvidenceVector([bSettled, cSettled], passingGlobalPreconditions()));
  assert.equal(verdict.verdict, 'C');
  assert.deepEqual(new Set(verdict.settledBoundaries), new Set(['WB-2p', 'WB-2']));
});
