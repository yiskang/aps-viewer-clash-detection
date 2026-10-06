// Offline authorization-binding checker (spec part 2 §17 / contract.authBinding). Pure, deterministic.
// Works ONLY on synthetic in-memory records. It never reads, writes or issues a real authorization record.
//
// record (synthetic):
//   { synthetic: true, format: 'EXISTING' | 'PROPOSED_DIAGNOSTIC',
//     markers: { 'G2-LIVE-EXECUTION'?, 'Authorization-ID', 'Baseline-HEAD', 'Procedure-SHA256', 'Harness-SHA256',
//                'Model-A-URN-SHA256', 'Model-B-URN-SHA256', 'Runtime', 'Supersedes'?: string[], 'G2-LIVE-DIAGNOSTIC'? },
//     fields?: { <contractFieldName>: value }   // PROPOSED_DIAGNOSTIC only: the distinct-namespace markers
//     freeText?: string }                        // existing format: NOT bound
// expected: { <contractFieldName>: value, od1Decided?: boolean }  (supersedes / issuanceSeparateFromExecution optional)

export const HISTORICAL_ACCEPTANCE_IDS = Object.freeze(['g2-live-20261004-75a3ccb9', 'g2-live-20261004-8a8d49f6', 'g2-live-20261004-dbd97137']);
const NON_SPENT_ACCEPTANCE_CANDIDATE = 'g2-live-20261004-75a3ccb9';
const OPTIONAL = new Set(['supersedes', 'issuanceSeparateFromExecution']);
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const SHA_FIELDS = new Set(['procedureSha256', 'acceptanceHarnessSha256', 'diagnosticHarnessSha256', 'diagnosticPackageSha256', 'diagnosticSpecSha256', 'viewerBundleSha256', 'targetPlanSha256']);
const BOOL_TRUE = new Set(['exactlyOneAttempt', 'noRetry']);

function canon(v) {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
const same = (a, b) => canon(a) === canon(b);

const MARKER_VALUE = {
  authorizationId: (m) => m['Authorization-ID'],
  repoCommit: (m) => m['Baseline-HEAD'],
  procedureSha256: (m) => m['Procedure-SHA256'],
  acceptanceHarnessSha256: (m) => m['Harness-SHA256'],
  viewerVersion: (m) => { const r = /^viewer=(\S+)(?: |$)/.exec(m.Runtime || ''); return r ? r[1] : undefined; },
  runtimeEnvelope: (m) => m.Runtime,
  supersedes: (m) => (Array.isArray(m.Supersedes) ? [...m.Supersedes].sort() : undefined),
};

/** Builds a synthetic expected-values object that matches the contract's pinned values (test/dry-run helper). */
export function syntheticExpected(contract) {
  const rv = {};
  for (const fl of contract.authBinding.fields) if (fl.requiredValue !== undefined) rv[fl.name] = fl.requiredValue;
  const hx = (c) => c.repeat(64);
  return {
    authorizationId: 'g2-diag-synthetic-00000001',
    recordKind: 'diagnostic',
    repoCommit: 'a'.repeat(40),
    procedureSha256: rv.procedureSha256,
    acceptanceHarnessSha256: rv.acceptanceHarnessSha256,
    diagnosticHarnessSha256: hx('1'),
    diagnosticPackageSha256: hx('2'),
    diagnosticSpecSha256: hx('3'),
    viewerVersion: rv.viewerVersion,
    viewerBundleSha256: rv.viewerBundleSha256,
    runtimeEnvelope: contract.authBinding.existingFormat.fixedRuntimeLine.replace(/^Runtime: /, ''),
    runtimeToolchain: { node: 'SYNTHETIC', playwright: 'SYNTHETIC', browser: 'SYNTHETIC' },
    exactCommand: 'SYNTHETIC-DIAGNOSTIC-COMMAND',
    modelInputs: { modelAUrnSha256: hx('4'), modelBUrnSha256: hx('5') },
    targetPlanSha256: hx('6'),
    atoms: rv.atoms,
    idAxis: rv.idAxis,
    slotWindow: 'OPEN',
    controlRequirements: { requiredControls: ['PC-1', 'PC-2', 'PC-4', 'PC-5'], degradingControls: ['PC-3'] },
    caps: contract.envelope.caps,
    outputLocation: { runRoot: 'test/acceptance/results/g2-live-diagnostic/g2-diag-synthetic-00000001/', attemptsDir: 'test/acceptance/results/g2-live-diagnostic-attempts/' },
    exactlyOneAttempt: true,
    noRetry: true,
    consumptionBoundary: 'ATTEMPT_CONSUMED before first model load in either instance',
    od1Decided: false,
  };
}

/** Builds a synthetic record in the PROPOSED (distinct-namespace) shape that matches `expected`. */
export function syntheticProposedRecord(expected) {
  const fields = {};
  for (const [k, v] of Object.entries(expected)) if (k !== 'od1Decided') fields[k] = v;
  return { synthetic: true, format: 'PROPOSED_DIAGNOSTIC', markers: { 'G2-LIVE-DIAGNOSTIC': 'AUTHORIZED EXACTLY ONE ATTEMPT' }, fields };
}

/** Builds a synthetic record in the EXISTING format (what a naive reuse of the marker would look like). */
export function syntheticExistingRecord(expected, contract) {
  return {
    synthetic: true, format: 'EXISTING',
    markers: {
      'G2-LIVE-EXECUTION': 'AUTHORIZED EXACTLY ONE ATTEMPT',
      'Authorization-ID': expected.authorizationId,
      'Baseline-HEAD': expected.repoCommit,
      'Procedure-SHA256': expected.procedureSha256,
      'Harness-SHA256': expected.acceptanceHarnessSha256,
      'Model-A-URN-SHA256': expected.modelInputs && expected.modelInputs.modelAUrnSha256,
      'Model-B-URN-SHA256': expected.modelInputs && expected.modelInputs.modelBUrnSha256,
      Runtime: contract.authBinding.existingFormat.fixedRuntimeLine.replace(/^Runtime: /, ''),
    },
    freeText: '',
  };
}

export function checkAuthBinding(record, expected, contract) {
  const findings = [];
  const f = (m) => findings.push(m);
  const ab = contract && contract.authBinding;
  if (!ab || !Array.isArray(ab.fields)) return { ok: false, findings: ['CONTRACT_AUTHBINDING_MISSING'] };
  if (ab.recordIssued !== false) f('CONTRACT_RECORD_ISSUED_NOT_FALSE');
  if (ab.existingFormat && ab.existingFormat.canBindDiagnosticRun !== false) f('CONTRACT_EXISTING_FORMAT_CLAIMS_TO_BIND');
  if (!record || typeof record !== 'object') return { ok: false, findings: [...findings, 'RECORD_MISSING'].sort() };
  if (!expected || typeof expected !== 'object') return { ok: false, findings: [...findings, 'EXPECTED_MISSING'].sort() };
  if (record.synthetic !== true) f('RECORD_NOT_SYNTHETIC: this offline checker refuses anything not explicitly marked synthetic');
  const markers = record.markers && typeof record.markers === 'object' ? record.markers : {};
  const fmt = record.format;
  if (fmt !== 'EXISTING' && fmt !== 'PROPOSED_DIAGNOSTIC') f(`RECORD_FORMAT_UNKNOWN: ${JSON.stringify(fmt)}`);
  const proposed = fmt === 'PROPOSED_DIAGNOSTIC';
  const hasAcceptanceMarker = Object.prototype.hasOwnProperty.call(markers, 'G2-LIVE-EXECUTION');

  // OD-1 hazard: the acceptance marker joins the acceptance candidate set.
  if (hasAcceptanceMarker) {
    const sup = Array.isArray(markers.Supersedes) ? markers.Supersedes : [];
    f(sup.includes(NON_SPENT_ACCEPTANCE_CANDIDATE)
      ? 'HAZARD:ACCEPTANCE_CANDIDATE_SET_JOIN (OD-1): marker G2-LIVE-EXECUTION would make this the SOLE non-superseded acceptance candidate and could authorize an acceptance run'
      : 'HAZARD:ACCEPTANCE_CANDIDATE_SET_JOIN (OD-1): marker G2-LIVE-EXECUTION without superseding g2-live-20261004-75a3ccb9 yields candidate-set-ambiguous in the acceptance validator');
  }
  if (proposed && hasAcceptanceMarker) f('PROPOSED_FORMAT_CONTAINS_ACCEPTANCE_MARKER');
  if (proposed && markers['G2-LIVE-DIAGNOSTIC'] !== 'AUTHORIZED EXACTLY ONE ATTEMPT') f('PROPOSED_MARKER_MISSING_OR_WRONG: G2-LIVE-DIAGNOSTIC');
  if (!proposed && fmt === 'EXISTING' && !hasAcceptanceMarker) f('EXISTING_FORMAT_WITHOUT_ACCEPTANCE_MARKER');
  if (proposed && !expected.od1Decided) f('OWNER_DECISION:OD-1 (a distinct diagnostic record format is not decided; the checker cannot pass a record whose format has no owner decision)');
  if (typeof expected.authorizationId === 'string' && HISTORICAL_ACCEPTANCE_IDS.includes(expected.authorizationId)) f(`HISTORICAL_AUTHORIZATION_ID_REUSED: ${expected.authorizationId}`);

  const fieldsObj = proposed && record.fields && typeof record.fields === 'object' ? record.fields : {};
  for (const fl of ab.fields) {
    const name = fl.name;
    const supp = fl.existingFormatSupport;
    const have = Object.prototype.hasOwnProperty.call(expected, name);
    if (!have) { if (!OPTIONAL.has(name)) f(`EXPECTED_MISSING:${name}`); }
    // Contract-pinned value must equal the expected value.
    if (have && fl.requiredValue !== undefined && !same(expected[name], fl.requiredValue)) f(`EXPECTED_CONTRADICTS_CONTRACT:${name}`);
    // Format sanity on expected values.
    if (have && SHA_FIELDS.has(name) && !HEX64.test(String(expected[name]))) f(`EXPECTED_NOT_HEX64:${name}`);
    if (have && name === 'repoCommit' && !HEX40.test(String(expected[name]))) f('EXPECTED_NOT_HEX40:repoCommit');
    if (have && BOOL_TRUE.has(name) && expected[name] !== true) f(`EXPECTED_MUST_BE_TRUE:${name}`);
    if (have && name === 'recordKind' && expected[name] !== 'diagnostic') f('EXPECTED_RECORD_KIND_NOT_DIAGNOSTIC');
    if (have && name === 'controlRequirements') {
      const c = expected[name] || {};
      if (!same(c.requiredControls, fl.requiredControls) || !same(c.degradingControls, fl.degradingControls)) f('EXPECTED_CONTRADICTS_CONTRACT:controlRequirements');
    }
    if (have && name === 'caps' && !same(expected[name], contract.envelope && contract.envelope.caps)) f('EXPECTED_CONTRADICTS_CONTRACT:caps');
    if (have && name === 'slotWindow' && !['OPEN', 'ASSUME_NO_UNOBSERVED_WRITER'].includes(expected[name])) f('EXPECTED_SLOT_WINDOW_INVALID');
    if (have && name === 'slotWindow' && expected[name] === 'ASSUME_NO_UNOBSERVED_WRITER') f('OWNER_DECISION:OD-2 (ASSUME_NO_UNOBSERVED_WRITER is an owner decision; default is OPEN)');
    if (!have) continue;

    if (proposed) {
      // Every field is bound by the (hypothetical) distinct-namespace markers.
      if (!Object.prototype.hasOwnProperty.call(fieldsObj, name)) { f(`MISSING:${name}`); continue; }
      if (!same(fieldsObj[name], expected[name])) f(`MISMATCH:${name}`);
      continue;
    }

    // EXISTING format.
    if (supp === 'SUPPORTED') {
      const getter = MARKER_VALUE[name];
      if (!getter) { f(`CHECKER_GAP:${name}`); continue; }
      const got = getter(markers);
      if (got === undefined) { if (!OPTIONAL.has(name)) f(`MISSING:${name}`); continue; }
      if (!same(got, name === 'supersedes' ? [...expected[name]].sort() : expected[name])) f(`MISMATCH:${name}`);
    } else {
      // PARTIAL / NOT_SUPPORTED: the existing format cannot bind the diagnostic meaning. Never silently pass.
      if (!OPTIONAL.has(name)) f(`OWNER_DECISION:${name}`);
      if (name === 'modelInputs' && expected.modelInputs) {
        if (markers['Model-A-URN-SHA256'] !== expected.modelInputs.modelAUrnSha256) f('MISMATCH:modelInputs.modelA (partial binding)');
        if (markers['Model-B-URN-SHA256'] !== expected.modelInputs.modelBUrnSha256) f('MISMATCH:modelInputs.modelB (partial binding)');
      }
    }
  }
  // issuanceSeparateFromExecution is machine-unbound (free text) in the existing format.
  if (!proposed) f('OWNER_DECISION:issuanceSeparateFromExecution');

  // Existing-format free text is not bound: a claim there about an unsupported field does not count.
  if (!proposed && typeof record.freeText === 'string' && record.freeText.length) {
    for (const fl of ab.fields) {
      if (fl.existingFormatSupport === 'SUPPORTED' || !Object.prototype.hasOwnProperty.call(expected, fl.name)) continue;
      const v = expected[fl.name];
      if (typeof v === 'string' && v.length >= 8 && record.freeText.includes(v)) f(`FREE_TEXT_NOT_BOUND:${fl.name} (free text is not bound by the existing format)`);
    }
  }
  // Proposed-format fields that the contract does not know.
  if (proposed) {
    const known = new Set(ab.fields.map((x) => x.name));
    for (const k of Object.keys(fieldsObj)) if (!known.has(k)) f(`UNKNOWN_FIELD:${k}`);
  }
  const unique = [...new Set(findings)].sort();
  return { ok: unique.length === 0, findings: unique };
}
