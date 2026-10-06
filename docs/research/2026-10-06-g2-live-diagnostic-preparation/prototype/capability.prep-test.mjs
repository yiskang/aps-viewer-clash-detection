import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from './contract-loader.mjs';
import { validateCapabilityMatrix, MINIMUM_SET } from './capability-matrix.mjs';

const base = () => loadContract();
const clone = (c) => structuredClone(c);
const has = (r, re) => r.findings.some((x) => re.test(x));

test('capability: committed contract passes; minimum set is exactly ID-ON,P-FRM,P-TC,V-PEND,V-EDGE', () => {
  const r = validateCapabilityMatrix(base());
  assert.deepEqual(r.findings, []);
  assert.equal(r.ok, true);
  assert.deepEqual([...MINIMUM_SET], ['ID-ON', 'P-FRM', 'P-TC', 'V-PEND', 'V-EDGE']);
  const c = base();
  assert.equal(c.part1.observableVbDependency['V-PEND'], 'VB-1');
  assert.equal(c.part1.observableVbDependency['V-EDGE'], 'VB-3');
  assert.ok(c.part1.excludedObservables.includes('P-XS'));
});

test('capability: deterministic (deep-equal and byte-equal)', () => {
  const a = validateCapabilityMatrix(base()); const b = validateCapabilityMatrix(base());
  assert.deepEqual(a, b); assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('capability: each missing minimum observable is reported', () => {
  for (const o of MINIMUM_SET) {
    const c = clone(base()); c.part1.minimumObservableSet = c.part1.minimumObservableSet.filter((x) => x !== o);
    const r = validateCapabilityMatrix(c);
    assert.equal(r.ok, false, o);
    assert.ok(has(r, /MINIMUM_SET_MISMATCH/) && has(r, new RegExp(`OBSERVABLE_MISSING: ${o}`)), o);
  }
});

test('capability: tier and VB dependency are required and consistent', () => {
  let c = clone(base()); delete c.part1.observableTier['V-EDGE'];
  assert.ok(has(validateCapabilityMatrix(c), /TIER_MISSING_OR_UNKNOWN: V-EDGE/));
  c = clone(base()); c.part1.observableTier['V-EDGE'] = 'public';
  assert.ok(has(validateCapabilityMatrix(c), /TIER_VB_INCONSISTENT: V-EDGE/));
  c = clone(base()); delete c.part1.observableVbDependency['V-PEND'];
  assert.ok(has(validateCapabilityMatrix(c), /VB_DEPENDENCY_MISSING: V-PEND/));
  c = clone(base()); c.part1.observableVbDependency['V-PEND'] = 'VB-3';
  assert.ok(has(validateCapabilityMatrix(c), /VB_DEPENDENCY_WRONG: V-PEND/));
  c = clone(base()); c.part1.observableVbDependency['P-TC'] = 'VB-1';
  assert.ok(has(validateCapabilityMatrix(c), /VB_DEPENDENCY_WRONG: P-TC/));
});

test('capability adversarial: P-XS added to the minimum set or un-excluded is refused', () => {
  let c = clone(base()); c.part1.minimumObservableSet.push('P-XS');
  let r = validateCapabilityMatrix(c);
  assert.ok(has(r, /P_XS_IN_MINIMUM_SET/) && has(r, /EXCLUDED_IN_MINIMUM_SET: P-XS/));
  c = clone(base()); c.part1.excludedObservables = c.part1.excludedObservables.filter((x) => x !== 'P-XS');
  assert.ok(has(validateCapabilityMatrix(c), /P_XS_NOT_EXCLUDED/));
  c = clone(base()); c.part1.baseAtoms.push('V-ACT');
  assert.ok(has(validateCapabilityMatrix(c), /EXCLUDED_IN_BASE_ATOMS: V-ACT/));
  c = clone(base()); c.part1.questions.find((q) => q.id === 'Q-DH4').adopted = true;
  assert.ok(has(validateCapabilityMatrix(c), /CANDIDATE_OBSERVABLE_ADOPTED: Q-DH4/));
  c = clone(base()); c.part1.observableTier['P-XS'] = 'public';
  assert.ok(has(validateCapabilityMatrix(c), /TIER_FOR_NON_MINIMUM_OBSERVABLE: P-XS/));
});

test('capability: every capture point maps to an existing record kind', () => {
  let c = clone(base()); c.part1.capturePoints[4].recordKind = 'ZZ';
  assert.ok(has(validateCapabilityMatrix(c), /CAPTURE_POINT_UNKNOWN_RECORD_KIND: CP05/));
  c = clone(base()); c.part1.capturePoints.pop();
  assert.ok(has(validateCapabilityMatrix(c), /CAPTURE_POINT_COUNT/));
  c = clone(base()); c.part1.capturePoints[2].id = 'CP09';
  assert.ok(has(validateCapabilityMatrix(c), /CAPTURE_POINT_ID_SEQUENCE|CAPTURE_POINT_DUPLICATE/));
  c = clone(base()); delete c.part1.capturePoints[0].requiredFields;
  assert.ok(has(validateCapabilityMatrix(c), /CAPTURE_POINT_REQUIRED_FIELDS_MISSING: CP01/));
  c = clone(base()); c.part1.capturePoints[11].capturedInMinimum = true;
  assert.ok(has(validateCapabilityMatrix(c), /CP12_CE_MUST_NOT_BE_CAPTURED_IN_MINIMUM/));
  c = clone(base()); c.part1.fieldTypes.kind = '';
  assert.ok(has(validateCapabilityMatrix(c), /RECORD_KINDS_MISSING/));
});

test('capability: each fail-closed behavior is required', () => {
  const mutations = {
    slotWindowDefaultOpen: (c) => { c.part1.slotWindowDefault = 'ASSUME_NO_UNOBSERVED_WRITER'; },
    edgeInitUnknownDisablesVEdge: (c) => { c.part1.boundaryInit.unknownEffect = 'ignored'; },
    sampleBoundOverflowNeverEarlySettle: (c) => { c.part1.sampleBound.onExceed = 'settle early'; },
    gapNeverInferredUnderOpenOrResolvedLater: (c) => { c.part1.derivedAnnotations.GAP.laterResolution = true; },
    preMotionNoCorrelatorOverride: (c) => { c.part1.derivedAnnotations.PRE_MOTION.correlatorOverride = true; },
    zeroSampleTimeoutNoC8: (c) => { c.part1.capturePoints[8].zeroSampleTimeout.c8Allowed = true; },
    partialTraceNeverPositive: (c) => { c.envelope.partialTracePolicy = 'prefix ok'; },
    nonIntegrityConditions: (c) => { delete c.envelope.nonIntegrityWholeTraceConditions['END.cg=1']; },
  };
  for (const [name, mut] of Object.entries(mutations)) {
    const c = clone(base()); mut(c);
    const r = validateCapabilityMatrix(c);
    assert.equal(r.ok, false, name);
    assert.ok(has(r, new RegExp(`FAIL_CLOSED_MISSING: ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)), name);
  }
});

test('capability: META atoms / idAxis agree with the minimum set', () => {
  let c = clone(base()); c.envelope.meta.requiredFields.find((x) => x.key === 'at').value = ['P-FRM', 'P-TC', 'V-PEND', 'V-EDGE', 'P-XS'];
  assert.ok(has(validateCapabilityMatrix(c), /META_ATOMS_MISMATCH/));
  c = clone(base()); c.envelope.meta.requiredFields.find((x) => x.key === 'id').values = ['ON', 'OFF'];
  assert.ok(has(validateCapabilityMatrix(c), /META_IDAXIS_MISMATCH/));
});

test('capability: findings sorted, degenerate input fails closed', () => {
  const c = clone(base()); c.part1.minimumObservableSet = []; c.part1.capturePoints = [];
  const r = validateCapabilityMatrix(c);
  assert.deepEqual(r.findings, [...r.findings].sort());
  assert.equal(validateCapabilityMatrix({}).ok, false);
});

test('capability: every capture point carries a failClosed entry whose references resolve in the contract', () => {
  const c0 = base();
  for (const cp of c0.part1.capturePoints) {
    assert.ok(cp.failClosed && typeof cp.failClosed.effect === 'string' && cp.failClosed.effect.length > 0, cp.id);
    assert.ok(cp.failClosed.integrityCodes.length + cp.failClosed.reasons.length > 0, cp.id);
    assert.ok(cp.failClosed.stopConditions.length > 0, cp.id);
  }
  let c = clone(base()); delete c.part1.capturePoints[4].failClosed;
  assert.ok(has(validateCapabilityMatrix(c), /FAIL_CLOSED_MISSING: CP05/));
  c = clone(base()); c.part1.capturePoints[0].failClosed.effect = '';
  assert.ok(has(validateCapabilityMatrix(c), /FAIL_CLOSED_EFFECT_MISSING: CP01/));
  c = clone(base()); c.part1.capturePoints[9].failClosed.integrityCodes = ['NO-SUCH-CODE'];
  assert.ok(has(validateCapabilityMatrix(c), /FAIL_CLOSED_UNKNOWN_INTEGRITY_CODE: CP10 NO-SUCH-CODE/));
  c = clone(base()); c.part1.capturePoints[13].failClosed.reasons.push('MADE_UP');
  assert.ok(has(validateCapabilityMatrix(c), /FAIL_CLOSED_UNKNOWN_REASON: CP14 MADE_UP/));
  c = clone(base()); c.part1.capturePoints[11].failClosed.integrityCodes = []; c.part1.capturePoints[11].failClosed.reasons = [];
  assert.ok(has(validateCapabilityMatrix(c), /FAIL_CLOSED_NO_OUTCOME: CP12/));
  c = clone(base()); c.part1.capturePoints[12].failClosed.stopConditions = [];
  assert.ok(has(validateCapabilityMatrix(c), /FAIL_CLOSED_NO_STOP_CONDITION: CP13/));
  // removing a stop condition the contract references is caught as an unresolved reference (derived, not a fixed list)
  for (const [id, cp] of [['SC-A11', 'CP05'], ['SC-C01', 'CP05'], ['SC-C07', 'CP02'], ['SC-C06', 'CP07']]) {
    c = clone(base()); c.stopConditions.stopConditions = c.stopConditions.stopConditions.filter((s) => s.id !== id);
    const r = validateCapabilityMatrix(c);
    assert.equal(r.ok, false, id);
    assert.ok(has(r, new RegExp(`FAIL_CLOSED_UNKNOWN_STOP_CONDITION: ${cp} ${id}`)), id);
  }
  // removing a contract integrity code that a capture point references is caught
  c = clone(base()); c.envelope.integrityCodes.part1 = c.envelope.integrityCodes.part1.filter((x) => x !== 'RS-PAIR');
  assert.ok(has(validateCapabilityMatrix(c), /FAIL_CLOSED_UNKNOWN_INTEGRITY_CODE: CP10 RS-PAIR/));
  c = clone(base()); c.envelope.integrityCodes.committedList.pop();
  assert.ok(has(validateCapabilityMatrix(c), /INTEGRITY_CODES_COMMITTED_LIST_MISSING/));
});
