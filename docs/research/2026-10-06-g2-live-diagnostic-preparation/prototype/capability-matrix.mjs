// Offline validator for the minimum observable set / capability matrix (contract.part1 + envelope). Pure, deterministic.
// Returns { ok, findings } with sorted findings.

export const MINIMUM_SET = Object.freeze(['ID-ON', 'P-FRM', 'P-TC', 'V-PEND', 'V-EDGE']);
const TIERS = new Set(['harness-local', 'public', 'public+harness-local', 'viewer-7.124.2-version-bound']);
const EXPECTED_VB = { 'ID-ON': null, 'P-FRM': null, 'P-TC': null, 'V-PEND': 'VB-1', 'V-EDGE': 'VB-3' };

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortedCopy = (a) => [...a].sort();

export function validateCapabilityMatrix(contract) {
  const findings = [];
  const f = (m) => findings.push(m);
  const p1 = contract && contract.part1;
  const env = contract && contract.envelope;
  const sc = contract && contract.stopConditions;
  if (!p1) return { ok: false, findings: ['PART1_MISSING'] };

  // Minimum observable set.
  const min = Array.isArray(p1.minimumObservableSet) ? p1.minimumObservableSet : [];
  if (!eq(sortedCopy(min), sortedCopy(MINIMUM_SET)) || new Set(min).size !== min.length) f(`MINIMUM_SET_MISMATCH: found ${JSON.stringify(min)}`);
  const tier = p1.observableTier || {};
  const dep = p1.observableVbDependency || {};
  for (const o of MINIMUM_SET) {
    if (!min.includes(o)) { f(`OBSERVABLE_MISSING: ${o}`); }
    if (typeof tier[o] !== 'string' || !TIERS.has(tier[o])) f(`TIER_MISSING_OR_UNKNOWN: ${o} tier ${JSON.stringify(tier[o])}`);
    if (!Object.prototype.hasOwnProperty.call(dep, o)) f(`VB_DEPENDENCY_MISSING: ${o}`);
    else if (dep[o] !== EXPECTED_VB[o]) f(`VB_DEPENDENCY_WRONG: ${o} expected ${JSON.stringify(EXPECTED_VB[o])} found ${JSON.stringify(dep[o])}`);
    const versionBound = tier[o] === 'viewer-7.124.2-version-bound';
    if (versionBound !== (dep[o] !== null && dep[o] !== undefined)) f(`TIER_VB_INCONSISTENT: ${o} tier ${tier[o]} dependency ${JSON.stringify(dep[o])}`);
  }
  for (const k of Object.keys(tier)) if (!min.includes(k)) f(`TIER_FOR_NON_MINIMUM_OBSERVABLE: ${k}`);
  for (const k of Object.keys(dep)) if (!min.includes(k)) f(`VB_DEPENDENCY_FOR_NON_MINIMUM_OBSERVABLE: ${k}`);

  // P-XS and the other excluded observables stay out.
  const excluded = Array.isArray(p1.excludedObservables) ? p1.excludedObservables : [];
  if (!excluded.includes('P-XS')) f('P_XS_NOT_EXCLUDED');
  for (const x of excluded) {
    if (min.includes(x)) f(`EXCLUDED_IN_MINIMUM_SET: ${x}`);
    if (Array.isArray(p1.baseAtoms) && p1.baseAtoms.includes(x)) f(`EXCLUDED_IN_BASE_ATOMS: ${x}`);
  }
  if (min.includes('P-XS')) f('P_XS_IN_MINIMUM_SET');
  for (const q of (p1.questions || [])) if (q.candidateObservable && q.adopted !== false) f(`CANDIDATE_OBSERVABLE_ADOPTED: ${q.id} ${q.candidateObservable}`);
  const q4 = (p1.questions || []).find((q) => q.id === 'Q-DH4');
  if (!q4 || q4.candidateObservable !== 'P-XS') f('Q_DH4_P_XS_CANDIDATE_MISSING');

  // Envelope META atoms / ID axis agree with the minimum set.
  const metaFields = (env && env.meta && env.meta.requiredFields) || [];
  const at = metaFields.find((x) => x.key === 'at');
  const id = metaFields.find((x) => x.key === 'id');
  const vb = metaFields.find((x) => x.key === 'vb');
  const wantAtoms = MINIMUM_SET.filter((o) => o !== 'ID-ON');
  if (!at || !eq(at.value, wantAtoms)) f(`META_ATOMS_MISMATCH: ${JSON.stringify(at && at.value)}`);
  if (!id || !eq(id.values, ['ON'])) f('META_IDAXIS_MISMATCH');
  if (!vb || !eq(vb.keys, ['VB-1', 'VB-2', 'VB-3'])) f('META_VB_KEYS_MISMATCH');
  if (!metaFields.find((x) => x.key === 'vg' && typeof x.rule === 'string' && x.rule.length > 0)) f('META_VB0_GATE_RULE_MISSING');

  // Capture points map to existing record kinds.
  const kindEnum = String((p1.fieldTypes && p1.fieldTypes.kind) || '').replace(/^enum:/, '').split('|').filter(Boolean);
  if (kindEnum.length === 0) f('RECORD_KINDS_MISSING');
  const cps = Array.isArray(p1.capturePoints) ? p1.capturePoints : [];
  if (cps.length === 0) f('CAPTURE_POINTS_MISSING');
  const seenCp = new Set();
  cps.forEach((cp, i) => {
    const want = `CP${String(i + 1).padStart(2, '0')}`;
    if (!cp || cp.id !== want) f(`CAPTURE_POINT_ID_SEQUENCE: position ${i + 1} has ${cp && cp.id}`);
    if (cp && seenCp.has(cp.id)) f(`CAPTURE_POINT_DUPLICATE: ${cp.id}`);
    if (cp) seenCp.add(cp.id);
    if (!cp || !kindEnum.includes(cp.recordKind)) f(`CAPTURE_POINT_UNKNOWN_RECORD_KIND: ${cp && cp.id} -> ${cp && cp.recordKind}`);
    if (cp && !Array.isArray(cp.requiredFields) && (typeof cp.requiredFieldsByPhase !== 'object' || cp.requiredFieldsByPhase === null)) f(`CAPTURE_POINT_REQUIRED_FIELDS_MISSING: ${cp.id}`);
  });
  if (cps.length !== 15) f(`CAPTURE_POINT_COUNT: expected 15 found ${cps.length}`);
  const cp12 = cps.find((c) => c.id === 'CP12');
  if (!cp12 || cp12.capturedInMinimum !== false) f('CP12_CE_MUST_NOT_BE_CAPTURED_IN_MINIMUM');
  const wk = p1.wireKeys || {};
  for (const k of kindEnum) if (!/^[A-Z0-9]{2}$/.test(k)) f(`RECORD_KIND_FORMAT: ${k}`);
  if (typeof wk.kind !== 'string') f('WIRE_KEY_KIND_MISSING');

  // Fail-closed behaviours (each must be evidenced in the contract).
  const fc = (name, ok) => { if (!ok) f(`FAIL_CLOSED_MISSING: ${name}`); };
  const ann = p1.derivedAnnotations || {};
  const cp9 = cps.find((c) => c.id === 'CP09') || {};
  const scIds = new Set(((sc && sc.stopConditions) || []).map((x) => x.id));
  fc('slotWindowDefaultOpen', p1.slotWindowDefault === 'OPEN');
  fc('edgeInitUnknownDisablesVEdge', !!(p1.boundaryInit && /V-EDGE disabled/.test(String(p1.boundaryInit.unknownEffect))));
  fc('sampleBoundOverflowNeverEarlySettle', !!(p1.sampleBound && /UNDIAGNOSABLE\(OVERFLOW\)/.test(String(p1.sampleBound.onExceed)) && /never early settle/.test(String(p1.sampleBound.onExceed))));
  fc('gapNeverInferredUnderOpenOrResolvedLater', !!(ann.GAP && ann.GAP.inferredTokenUnderOpen === null && ann.GAP.laterResolution === false));
  fc('preMotionNoCorrelatorOverride', !!(ann.PRE_MOTION && ann.PRE_MOTION.correlatorOverride === false && ann.PRE_MOTION.additionalObservableJustified === false));
  fc('zeroSampleTimeoutNoC8', !!(cp9.zeroSampleTimeout && cp9.zeroSampleTimeout.c8Allowed === false));
  fc('partialTraceNeverPositive', !!(env && /no prefix is ever positive/.test(String(env.partialTracePolicy))));
  // Per-capture-point fail-closed entries (Part 1 Appendix capturePoints[].failClosed). Every reference must resolve in
  // the contract itself: integrity codes in Part 2 Appendix (i) integrityCodes (committedList, part1, part2), reasons in
  // Part 1 failClosedReasonVocabulary, stop conditions in Part 2 Appendix (vi). No fixed list of behaviours is assumed.
  const ic = (env && env.integrityCodes) || {};
  const codeSet = new Set([...(Array.isArray(ic.committedList) ? ic.committedList : []), ...(Array.isArray(ic.part1) ? ic.part1 : []), ...(Array.isArray(ic.part2) ? ic.part2 : [])]);
  if (!Array.isArray(ic.committedList) || ic.committedList.length !== 39) f('INTEGRITY_CODES_COMMITTED_LIST_MISSING');
  const vocab = (p1.failClosedReasonVocabulary && typeof p1.failClosedReasonVocabulary === 'object') ? p1.failClosedReasonVocabulary : {};
  for (const cp of cps) {
    if (!cp || typeof cp !== 'object') continue;
    const fcl = cp.failClosed;
    if (!fcl || typeof fcl !== 'object' || Array.isArray(fcl)) { f(`FAIL_CLOSED_MISSING: ${cp.id}`); continue; }
    if (typeof fcl.effect !== 'string' || fcl.effect.length === 0) f(`FAIL_CLOSED_EFFECT_MISSING: ${cp.id}`);
    const lists = ['integrityCodes', 'reasons', 'stopConditions'];
    for (const l of lists) if (!Array.isArray(fcl[l])) f(`FAIL_CLOSED_FIELD_NOT_ARRAY: ${cp.id} ${l}`);
    const ints = Array.isArray(fcl.integrityCodes) ? fcl.integrityCodes : [];
    const reas = Array.isArray(fcl.reasons) ? fcl.reasons : [];
    const stops = Array.isArray(fcl.stopConditions) ? fcl.stopConditions : [];
    if (ints.length + reas.length === 0) f(`FAIL_CLOSED_NO_OUTCOME: ${cp.id} names neither an integrity code nor a reason`);
    if (stops.length === 0) f(`FAIL_CLOSED_NO_STOP_CONDITION: ${cp.id}`);
    for (const c of ints) if (!codeSet.has(c)) f(`FAIL_CLOSED_UNKNOWN_INTEGRITY_CODE: ${cp.id} ${c}`);
    for (const r of reas) if (!Object.prototype.hasOwnProperty.call(vocab, r)) f(`FAIL_CLOSED_UNKNOWN_REASON: ${cp.id} ${r}`);
    for (const x of stops) if (!scIds.has(x)) f(`FAIL_CLOSED_UNKNOWN_STOP_CONDITION: ${cp.id} ${x}`);
  }
  const nonInt = (env && env.nonIntegrityWholeTraceConditions) || {};
  fc('nonIntegrityConditions', nonInt['META.ei=UNKNOWN'] === 'EDGE_INIT_UNKNOWN' && nonInt['END.cg=1'] === 'CLASS_NONTRANSITIVE' && nonInt.projectionUnrepresentable === 'PROJECTION_UNREPRESENTABLE');

  findings.sort();
  return { ok: findings.length === 0, findings };
}
