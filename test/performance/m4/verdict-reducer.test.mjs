import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceVerdict } from './verdict-reducer.mjs';

// Design spec §19.3: "The harness must therefore ship the verdict reducer as a pure function over
// an evidence vector -- never entangled with measurement or I/O -- and run a fixed suite of
// synthetic evidence-vector fixtures against it... Each fixture is a hand-constructed evidence
// vector, not a real measured run -- it exercises the reducer's branches directly." This suite
// therefore constructs `EvidenceVector` objects directly rather than routing them through Task
// 2.4's `buildEvidenceVector` adapter: doing so isolates Task 2.5's reducer from Task 2.4's own
// correctness, so a Task 2.4 regression can never silently make one of these fixtures stop
// testing what its name claims to test (codex-advisor finding, task 2.5 fixture-completeness
// consult -- an earlier draft of this suite routed every fixture through buildEvidenceVector).

const GLOBAL_CONDITIONS = [
  ['noConfirmedResponsivenessTarget', 1, 'no-confirmed-responsiveness-target'],
  ['noRepresentativeRuntime', 2, 'no-representative-runtime'],
  ['capacityCensored', 3, 'capacity-censoring'],
  ['workloadValidityFailed', 4, 'workload-validity'],
  ['insufficientStatisticalConfidence', 5, 'insufficient-statistical-confidence'],
  ['missingCausalAttribution', 6, 'missing-causal-attribution'],
  ['unconfirmedMemoryMultipliers', 7, 'unconfirmed-memory-multipliers'],
  ['undeterminedDeviceScopeOrConcurrency', 8, 'undetermined-device-scope-or-concurrency'],
];
const GLOBAL_D_KEYS = GLOBAL_CONDITIONS.map(([key]) => key);
// Independently hand-typed expected label strings (never imported from verdict-reducer.mjs's own
// D_CONDITION_LABELS table) -- codex-advisor finding: asserting only `verdict === 'D'` and
// `scope === 'global'` would let a swapped, duplicated, or undefined label entry in the reducer's
// own table pass silently. Typing the expected string independently here is what actually locks
// each of the 8 labels down.
const GLOBAL_D_LABELS = Object.fromEntries(GLOBAL_CONDITIONS.map(([key, , label]) => [key, label]));

function globalMandatoryD(overrides = {}) {
  const base = Object.fromEntries(GLOBAL_D_KEYS.map((key) => [key, false]));
  const merged = { ...base, ...overrides };
  const causes = GLOBAL_CONDITIONS.filter(([key]) => merged[key]).map(([, condition]) => condition);
  return { ...merged, causes, any: causes.length > 0 };
}

function ev(tuples, globalOverrides = {}) {
  return { globalMandatoryD: globalMandatoryD(globalOverrides), tuples };
}

function tuple(caseId, state) {
  return { runtime: 'multi-process', caseId, broadPhase: 'linear', state };
}

function passingTuple(caseId, state = 'warm') {
  return { tuple: tuple(caseId, state), targetsAllPass: true, onlyQueryEvidenceFailing: false, noBoundaryScreenFailed: false, warmNarrowPhaseFailure: false, boundaries: [] };
}

function onlyQueryEvidenceFailingTuple(caseId) {
  return { tuple: tuple(caseId, 'warm'), targetsAllPass: false, onlyQueryEvidenceFailing: true, noBoundaryScreenFailed: false, warmNarrowPhaseFailure: false, boundaries: [] };
}

// §1.1 no-boundary: §7.3 condition 3's boundary-independent screen fails at a T-a-failing tuple.
function noBoundaryTuple(caseId) {
  return { tuple: tuple(caseId, 'cold'), targetsAllPass: false, onlyQueryEvidenceFailing: false, noBoundaryScreenFailed: true, warmNarrowPhaseFailure: false, boundaries: [] };
}

// A T-a-failing tuple with named boundaries. `warmNarrowPhaseFailure` defaults to Task 2.4's own
// derivation rule (state==='warm' AND the §17 family-selection rule says narrow-phase won) but can
// be overridden to probe the derived-fact gate directly.
function tAFailingTuple(caseId, boundaries, { state = 'cold', warmNarrowPhaseFailure } = {}) {
  return {
    tuple: tuple(caseId, state),
    targetsAllPass: false,
    onlyQueryEvidenceFailing: false,
    noBoundaryScreenFailed: false,
    warmNarrowPhaseFailure: warmNarrowPhaseFailure ?? state === 'warm',
    boundaries,
  };
}

// Mirrors decision-evidence-model.mjs's BOUNDARY_TABLE as an independent, hand-typed literal --
// deliberately not imported, so these fixtures never depend on Task 2.4's module at all.
const OWNED_STAGES = {
  'WB-1a': ['bvhConstruction'],
  'WB-1b': ['compactAndWeld', 'connectivity', 'bvhConstruction'],
  'WB-2p': ['hardClashPrecheck'],
  'WB-3': ['clearanceDistanceQuery'],
  'WB-2': ['hardClashPrecheck', 'exactNarrowPhase', 'clearanceDistanceQuery'],
  'WB-4': ['broadPhaseCandidateWork', 'hardClashPrecheck', 'exactNarrowPhase', 'clearanceDistanceQuery', 'resultAggregation'],
};
const BOUNDARY_CLASS = { 'WB-1a': 'B', 'WB-1b': 'B', 'WB-2p': 'B', 'WB-3': 'B', 'WB-2': 'C', 'WB-4': 'C' };

function boundary(id, disposition, unevaluableReason = null) {
  return { id, class: BOUNDARY_CLASS[id], applicable: true, ownedStages: OWNED_STAGES[id], disposition, unevaluableReason };
}

test('§19.3 Verdict A: every verdict-bearing tuple passing every target', () => {
  const verdict = reduceVerdict(ev([passingTuple('R1'), passingTuple('R2')]));
  assert.equal(verdict.verdict, 'A');
  assert.equal(verdict.tupleFindings.every((f) => f.status === 'A'), true);
});

test('§7.5 conditions 1-8: any true global precondition forces D, with its own exact cause label, even when every tuple would otherwise pass (A)', () => {
  for (const key of GLOBAL_D_KEYS) {
    const verdict = reduceVerdict(ev([passingTuple('R1')], { [key]: true }));
    assert.equal(verdict.verdict, 'D', `condition ${key} must force D`);
    assert.equal(verdict.causes.length, 1, `condition ${key} must report exactly one cause`);
    assert.deepEqual(verdict.causes[0], { scope: 'global', cause: GLOBAL_D_LABELS[key] }, `condition ${key} must report its own exact label`);
  }
});

test('§7.5.9 no-full-query-evidence: a tuple whose only failing metrics are T-b1/T-b2/T-c forces D, unconditionally', () => {
  const verdict = reduceVerdict(ev([onlyQueryEvidenceFailingTuple('R2')]));
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes[0].cause, 'no-full-query-evidence');
});

test('§1.1 no-boundary: condition 3\'s screen failing at a T-a-failing tuple forces D and is never conflated with no-full-query-evidence', () => {
  const verdict = reduceVerdict(ev([noBoundaryTuple('R3')]));
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes[0].cause, 'no-boundary');
});

test('§19.3 Verdict B: exactly one applicable B-class boundary SUFFICIENT and every other condition satisfied', () => {
  const verdict = reduceVerdict(ev([tAFailingTuple('R3', [boundary('WB-2p', 'SUFFICIENT')], { state: 'cold' })]));
  assert.equal(verdict.verdict, 'B');
  assert.deepEqual(verdict.settledBoundaries, ['WB-2p']);
});

test('§19.3 no applicable boundary of either class SUFFICIENT (an INSUFFICIENT B and an INSUFFICIENT C boundary both present on a WARM tuple): falls to D under §7.5.10, never silently to B or C', () => {
  // codex-advisor finding: a cold, B-only fixture here cannot catch a regression that treats an
  // applicable, INSUFFICIENT C-class boundary as if it were sufficient. Warm + both classes
  // present-but-insufficient genuinely exercises that both filters reject their candidates.
  const verdict = reduceVerdict(ev([tAFailingTuple('R3', [
    boundary('WB-2p', 'INSUFFICIENT'),
    boundary('WB-2', 'INSUFFICIENT'),
  ], { state: 'warm' })]));
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes[0].cause, 'no-settled-boundary');
});

test('§19.3 Verdict C: every applicable B-class boundary INSUFFICIENT and a named C-class boundary SUFFICIENT, mechanical difference named (WARM tuple -- C is only reachable there)', () => {
  const verdict = reduceVerdict(ev([tAFailingTuple('R3', [
    boundary('WB-2p', 'INSUFFICIENT'),
    boundary('WB-2', 'SUFFICIENT'),
  ], { state: 'warm' })]));
  assert.equal(verdict.verdict, 'C');
  assert.deepEqual(verdict.settledBoundaries, ['WB-2']);
  const diff = verdict.mechanicalDifferences[0].mechanicalDifference[0];
  assert.equal(diff.cBoundaryId, 'WB-2');
  assert.deepEqual(diff.rejectedBBoundaries[0].extraStagesOwnedByC, ['exactNarrowPhase', 'clearanceDistanceQuery']); // WB-2p owns only hardClashPrecheck
});

test('§7.3 negative: an otherwise-identical COLD tuple can never reach Verdict C, even though the C-class boundary is (numerically) SUFFICIENT and every other condition would pass', () => {
  const verdict = reduceVerdict(ev([tAFailingTuple('R3', [
    boundary('WB-2p', 'INSUFFICIENT'),
    boundary('WB-2', 'SUFFICIENT'),
  ], { state: 'cold' })])); // default state:'cold' -- everything else identical to the passing Verdict-C fixture above
  assert.notEqual(verdict.verdict, 'C');
  assert.equal(verdict.verdict, 'D'); // WB-2p is INSUFFICIENT and WB-2, though SUFFICIENT, is not applicable on a cold tuple -- no-settled-boundary
  assert.equal(verdict.causes[0].cause, 'no-settled-boundary');
});

test('§19.3 B-over-C precedence: a WARM tuple where a B-class boundary is SUFFICIENT and a C-class boundary is also SUFFICIENT reports B, never C and never both', () => {
  const verdict = reduceVerdict(ev([tAFailingTuple('R3', [
    boundary('WB-2p', 'SUFFICIENT'),
    boundary('WB-2', 'SUFFICIENT'),
  ], { state: 'warm' })])); // warm + C genuinely applicable-and-sufficient, so this proves real precedence, not accidental inapplicability
  assert.equal(verdict.verdict, 'B');
  assert.equal('mechanicalDifferences' in verdict, false);
});

test('C-class vacuous B-applicability (exact-query-substage case: no B-class boundary applicable at all), WARM tuple', () => {
  const verdict = reduceVerdict(ev([tAFailingTuple('R3', [boundary('WB-2', 'SUFFICIENT')], { state: 'warm' })]));
  assert.equal(verdict.verdict, 'C');
  assert.equal(verdict.mechanicalDifferences[0].mechanicalDifference.vacuous, true);
});

test('§19.3: each of §7.5\'s ten mandatory-D causes fires individually, plus §1.1\'s no-boundary cause separately (11 total)', () => {
  // 1-8: global preconditions, already covered (with exact-label assertions) by the table-driven
  // test above -- re-asserted here as part of the complete named-cause inventory this fixture
  // suite requires.
  for (const key of GLOBAL_D_KEYS) {
    const verdict = reduceVerdict(ev([passingTuple('R1')], { [key]: true }));
    assert.equal(verdict.verdict, 'D');
    assert.equal(verdict.causes[0].cause, GLOBAL_D_LABELS[key]);
  }
  // 9: no-full-query-evidence
  assert.equal(reduceVerdict(ev([onlyQueryEvidenceFailingTuple('R2')])).causes[0].cause, 'no-full-query-evidence');
  // 10: no-settled-boundary (no applicable boundary of either class at all)
  assert.equal(reduceVerdict(ev([tAFailingTuple('R3', [], { state: 'cold' })])).causes[0].cause, 'no-settled-boundary');
  // §1.1: no-boundary
  assert.equal(reduceVerdict(ev([noBoundaryTuple('R3')])).causes[0].cause, 'no-boundary');
});

test('§19.3 every UNEVALUABLE path: UNEVALUABLE is never scored as INSUFFICIENT and never silently promoted to SUFFICIENT', () => {
  // Missing §17 vertical for a B-class boundary, paired with a genuinely-SUFFICIENT WARM C-class
  // boundary. §7.3's own C precondition requires "every applicable B-class boundary is mechanically
  // INSUFFICIENT" -- an UNEVALUABLE boundary does not satisfy that, so this must still fall to D,
  // never be promoted to C. (A cold, C-boundary-free fixture here could not distinguish a correct
  // UNEVALUABLE-excluded-from-both-B-and-C implementation from a buggy one that miscounts
  // UNEVALUABLE as INSUFFICIENT -- codex-advisor finding.)
  const missingVertical = reduceVerdict(ev([tAFailingTuple('R3', [
    boundary('WB-2p', 'UNEVALUABLE', 'missing-vertical'),
    boundary('WB-2', 'SUFFICIENT'),
  ], { state: 'warm' })]));
  assert.equal(missingVertical.verdict, 'D');
  assert.equal(missingVertical.causes[0].cause, 'no-settled-boundary');

  // Unboundable derived-evidence for a C-class boundary, genuinely applicable on a WARM tuple with
  // no B-class boundary present at all -- must never be promoted to SUFFICIENT.
  const unboundedDerived = reduceVerdict(ev([tAFailingTuple('R3', [
    boundary('WB-2', 'UNEVALUABLE', 'unboundable-derived-evidence'),
  ], { state: 'warm' })]));
  assert.equal(unboundedDerived.verdict, 'D');
  assert.equal(unboundedDerived.causes[0].cause, 'no-settled-boundary');

  // Unidentifiable delivery task under §6.2's correlation rule (Hᵢ) for a B-class boundary, paired
  // with a genuinely-SUFFICIENT WARM C-class boundary -- same discriminating shape as the
  // missing-vertical case above.
  const undeterminedDelivery = reduceVerdict(ev([tAFailingTuple('R3', [
    boundary('WB-2p', 'UNEVALUABLE', 'undetermined-delivery-task'),
    boundary('WB-2', 'SUFFICIENT'),
  ], { state: 'warm' })]));
  assert.equal(undeterminedDelivery.verdict, 'D');
  assert.equal(undeterminedDelivery.causes[0].cause, 'no-settled-boundary');
});

test('§19.3 mixed cold/warm multi-tuple aggregation: aggregate reports B, naming both distinct boundaries', () => {
  const coldTuple = tAFailingTuple('R3-cold', [boundary('WB-1b', 'SUFFICIENT')], { state: 'cold' });
  const warmTuple = tAFailingTuple('R3-warm', [boundary('WB-2p', 'SUFFICIENT')], { state: 'warm' });
  const verdict = reduceVerdict(ev([coldTuple, warmTuple]));
  assert.equal(verdict.verdict, 'B');
  assert.deepEqual(new Set(verdict.settledBoundaries), new Set(['WB-1b', 'WB-2p']));
});

test('§19.3 aggregate reports D even though every other tuple is settled, per the "any unsettled tuple forces D" rule', () => {
  const settled = tAFailingTuple('R3', [boundary('WB-2p', 'SUFFICIENT')], { state: 'cold' });
  const unsettled = tAFailingTuple('R4', [], { state: 'cold' });
  const verdict = reduceVerdict(ev([settled, unsettled]));
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes.some((c) => c.cause === 'no-settled-boundary'), true);
});

test('§7.3 multi-tuple: C is named whenever settling at least one tuple required a C-class boundary, even where others were settled by B alone', () => {
  const bSettled = tAFailingTuple('R3', [boundary('WB-2p', 'SUFFICIENT')], { state: 'cold' });
  const cSettled = tAFailingTuple('R4', [
    boundary('WB-2p', 'INSUFFICIENT'),
    boundary('WB-2', 'SUFFICIENT'),
  ], { state: 'warm' });
  const verdict = reduceVerdict(ev([bSettled, cSettled]));
  assert.equal(verdict.verdict, 'C');
  assert.deepEqual(new Set(verdict.settledBoundaries), new Set(['WB-2p', 'WB-2']));
});

test('§7.5: a global mandatory-D condition and a co-occurring tuple-level D cause are both named separately, never suppressing one another', () => {
  // codex-advisor finding (Critical): an earlier draft's reduceVerdict early-returned as soon as
  // globalMandatoryD.any was true, reporting only the global cause with an empty tupleFindings --
  // silently dropping any tuple-level D cause that also applied. §7.5's own closing sentence
  // requires both: "where more than one applies, each is named separately, and no two of these
  // causes are ever reported as if they were the same finding."
  const verdict = reduceVerdict(ev([onlyQueryEvidenceFailingTuple('R2')], { capacityCensored: true }));
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes.some((c) => c.scope === 'global' && c.cause === 'capacity-censoring'), true);
  assert.equal(verdict.causes.some((c) => c.scope === 'tuple' && c.cause === 'no-full-query-evidence'), true);
  assert.equal(verdict.tupleFindings.length, 1); // tupleFindings still populated even though a global D also fired
});
