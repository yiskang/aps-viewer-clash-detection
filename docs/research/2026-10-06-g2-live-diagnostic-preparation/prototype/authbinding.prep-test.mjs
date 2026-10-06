// All records here are SYNTHETIC in-memory fixtures. No real authorization record is read, written or issued.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from './contract-loader.mjs';
import { checkAuthBinding, syntheticExpected, syntheticExistingRecord, syntheticProposedRecord, HISTORICAL_ACCEPTANCE_IDS } from './auth-binding.mjs';

const C = () => loadContract();
const clone = (x) => structuredClone(x);
const has = (r, re) => r.findings.some((x) => re.test(x));
const setup = () => { const c = C(); const e = syntheticExpected(c); return { c, e }; };

test('authbinding: existing format can never bind a diagnostic run (every unsupported field is an OWNER_DECISION)', () => {
  const { c, e } = setup();
  const r = checkAuthBinding(syntheticExistingRecord(e, c), e, c);
  assert.equal(r.ok, false);
  const unsupported = c.authBinding.fields.filter((f) => f.existingFormatSupport !== 'SUPPORTED').map((f) => f.name);
  for (const n of unsupported) assert.ok(r.findings.includes(`OWNER_DECISION:${n}`), n);
  for (const n of ['diagnosticHarnessSha256', 'diagnosticPackageSha256', 'diagnosticSpecSha256', 'viewerBundleSha256', 'exactCommand', 'targetPlanSha256', 'atoms', 'idAxis', 'slotWindow', 'controlRequirements', 'caps', 'outputLocation', 'recordKind']) {
    assert.ok(r.findings.includes(`OWNER_DECISION:${n}`), n);
  }
  // supported fields match, so they raise nothing
  for (const n of ['authorizationId', 'repoCommit', 'procedureSha256', 'acceptanceHarnessSha256', 'viewerVersion', 'runtimeEnvelope']) {
    assert.ok(!r.findings.some((x) => x.endsWith(`:${n}`)), n);
  }
  assert.ok(r.findings.includes('OWNER_DECISION:issuanceSeparateFromExecution'));
});

test('authbinding: OD-1 hazard - reusing the existing marker joins the acceptance candidate set', () => {
  const { c, e } = setup();
  let rec = syntheticExistingRecord(e, c);
  assert.ok(has(checkAuthBinding(rec, e, c), /HAZARD:ACCEPTANCE_CANDIDATE_SET_JOIN \(OD-1\).*candidate-set-ambiguous/));
  rec = syntheticExistingRecord(e, c); rec.markers.Supersedes = ['g2-live-20261004-75a3ccb9'];
  assert.ok(has(checkAuthBinding(rec, e, c), /HAZARD:ACCEPTANCE_CANDIDATE_SET_JOIN \(OD-1\).*SOLE non-superseded acceptance candidate/));
});

test('authbinding: proposed distinct-namespace record binds every field once OD-1 is decided', () => {
  const { c, e } = setup();
  const rec = syntheticProposedRecord(e);
  let r = checkAuthBinding(rec, e, c);
  assert.equal(r.ok, false);
  assert.ok(has(r, /OWNER_DECISION:OD-1/), 'format not decided -> not ok');
  e.od1Decided = true;
  r = checkAuthBinding(syntheticProposedRecord(e), e, c);
  assert.deepEqual(r.findings, []);
  assert.equal(r.ok, true);
});

test('authbinding: every bound field is compared (mutating any one field in a proposed record is detected)', () => {
  const { c, e } = setup(); e.od1Decided = true;
  for (const fl of c.authBinding.fields) {
    if (!(fl.name in e)) continue;
    const rec = syntheticProposedRecord(e);
    rec.fields[fl.name] = { tampered: true };
    const r = checkAuthBinding(rec, e, c);
    assert.equal(r.ok, false, fl.name);
    assert.ok(r.findings.includes(`MISMATCH:${fl.name}`), fl.name);
    const rec2 = syntheticProposedRecord(e); delete rec2.fields[fl.name];
    assert.ok(checkAuthBinding(rec2, e, c).findings.includes(`MISSING:${fl.name}`), `missing ${fl.name}`);
  }
});

test('authbinding: required binds - commit, harness SHA, viewer version + bundle digest, command, models, output, one-attempt, no-retry, controls', () => {
  const { c, e } = setup(); e.od1Decided = true;
  const names = ['repoCommit', 'acceptanceHarnessSha256', 'diagnosticHarnessSha256', 'viewerVersion', 'viewerBundleSha256', 'exactCommand', 'modelInputs', 'outputLocation', 'exactlyOneAttempt', 'noRetry', 'controlRequirements'];
  for (const n of names) assert.ok(c.authBinding.fields.some((f) => f.name === n), n);
  for (const n of ['exactlyOneAttempt', 'noRetry']) {
    const e2 = clone(e); e2[n] = false;
    const r = checkAuthBinding(syntheticProposedRecord(e2), e2, c);
    assert.ok(r.findings.includes(`EXPECTED_MUST_BE_TRUE:${n}`), n);
  }
});

test('authbinding: expected values contradicting the contract pins are refused', () => {
  const { c, e } = setup(); e.od1Decided = true;
  const cases = { procedureSha256: 'f'.repeat(64), acceptanceHarnessSha256: 'f'.repeat(64), viewerVersion: '7.124.1', viewerBundleSha256: 'f'.repeat(64), idAxis: 'OFF', atoms: ['P-FRM'] };
  for (const [k, v] of Object.entries(cases)) {
    const e2 = clone(e); e2[k] = v;
    const r = checkAuthBinding(syntheticProposedRecord(e2), e2, c);
    assert.ok(r.findings.includes(`EXPECTED_CONTRADICTS_CONTRACT:${k}`), k);
    assert.equal(r.ok, false);
  }
  const e3 = clone(e); e3.controlRequirements = { requiredControls: ['PC-1'], degradingControls: ['PC-3'] };
  assert.ok(checkAuthBinding(syntheticProposedRecord(e3), e3, c).findings.includes('EXPECTED_CONTRADICTS_CONTRACT:controlRequirements'));
  const e4 = clone(e); e4.caps = { ...e4.caps, dataEvents: 1 };
  assert.ok(checkAuthBinding(syntheticProposedRecord(e4), e4, c).findings.includes('EXPECTED_CONTRADICTS_CONTRACT:caps'));
  const e5 = clone(e); e5.slotWindow = 'ASSUME_NO_UNOBSERVED_WRITER';
  assert.ok(has(checkAuthBinding(syntheticProposedRecord(e5), e5, c), /OWNER_DECISION:OD-2/));
});

test('authbinding adversarial: existing-format SUPPORTED fields detect mismatches and omissions', () => {
  const { c, e } = setup();
  for (const [marker, field] of [['Baseline-HEAD', 'repoCommit'], ['Procedure-SHA256', 'procedureSha256'], ['Harness-SHA256', 'acceptanceHarnessSha256'], ['Authorization-ID', 'authorizationId'], ['Runtime', 'viewerVersion']]) {
    const rec = syntheticExistingRecord(e, c); rec.markers[marker] = marker === 'Runtime' ? 'viewer=7.124.1 env=AutodeskProduction2 api=streamingV2' : 'zzzz';
    assert.ok(checkAuthBinding(rec, e, c).findings.includes(`MISMATCH:${field}`), field);
    const rec2 = syntheticExistingRecord(e, c); delete rec2.markers[marker];
    assert.ok(checkAuthBinding(rec2, e, c).findings.includes(`MISSING:${field}`), field);
  }
  const rec = syntheticExistingRecord(e, c); rec.markers['Model-A-URN-SHA256'] = 'q';
  assert.ok(has(checkAuthBinding(rec, e, c), /MISMATCH:modelInputs\.modelA/));
});

test('authbinding adversarial: free text claiming an unsupported field is not binding', () => {
  const { c, e } = setup();
  const rec = syntheticExistingRecord(e, c); rec.freeText = `Issuance scope note: diagnostic harness ${e.diagnosticHarnessSha256}`;
  const r = checkAuthBinding(rec, e, c);
  assert.ok(has(r, /FREE_TEXT_NOT_BOUND:diagnosticHarnessSha256/));
  assert.ok(r.findings.includes('OWNER_DECISION:diagnosticHarnessSha256'));
});

test('authbinding adversarial: non-synthetic, historical-id reuse, acceptance marker in proposed record, unknown fields', () => {
  const { c, e } = setup(); e.od1Decided = true;
  let rec = syntheticProposedRecord(e); delete rec.synthetic;
  assert.ok(has(checkAuthBinding(rec, e, c), /RECORD_NOT_SYNTHETIC/));
  const e2 = clone(e); e2.authorizationId = HISTORICAL_ACCEPTANCE_IDS[0];
  assert.ok(has(checkAuthBinding(syntheticProposedRecord(e2), e2, c), /HISTORICAL_AUTHORIZATION_ID_REUSED/));
  rec = syntheticProposedRecord(e); rec.markers['G2-LIVE-EXECUTION'] = 'AUTHORIZED EXACTLY ONE ATTEMPT';
  const r = checkAuthBinding(rec, e, c);
  assert.ok(has(r, /PROPOSED_FORMAT_CONTAINS_ACCEPTANCE_MARKER/) && has(r, /HAZARD:ACCEPTANCE_CANDIDATE_SET_JOIN/));
  rec = syntheticProposedRecord(e); rec.fields.surprise = 1;
  assert.ok(has(checkAuthBinding(rec, e, c), /UNKNOWN_FIELD:surprise/));
  rec = syntheticProposedRecord(e); rec.format = 'WHATEVER';
  assert.ok(has(checkAuthBinding(rec, e, c), /RECORD_FORMAT_UNKNOWN/));
  rec = syntheticProposedRecord(e); delete rec.markers['G2-LIVE-DIAGNOSTIC'];
  assert.ok(has(checkAuthBinding(rec, e, c), /PROPOSED_MARKER_MISSING_OR_WRONG/));
});

test('authbinding: missing expected values fail closed; degenerate inputs', () => {
  const { c, e } = setup(); e.od1Decided = true;
  const e2 = clone(e); delete e2.viewerBundleSha256; delete e2.exactCommand;
  const r = checkAuthBinding(syntheticProposedRecord(e), e2, c);
  assert.ok(r.findings.includes('EXPECTED_MISSING:viewerBundleSha256') && r.findings.includes('EXPECTED_MISSING:exactCommand'));
  assert.equal(checkAuthBinding(null, e, c).ok, false);
  assert.equal(checkAuthBinding(syntheticProposedRecord(e), null, c).ok, false);
  assert.equal(checkAuthBinding(syntheticProposedRecord(e), e, {}).ok, false);
  const c2 = clone(c); c2.authBinding.recordIssued = true;
  assert.ok(has(checkAuthBinding(syntheticProposedRecord(e), e, c2), /CONTRACT_RECORD_ISSUED_NOT_FALSE/));
  const c3 = clone(c); c3.authBinding.existingFormat.canBindDiagnosticRun = true;
  assert.ok(has(checkAuthBinding(syntheticProposedRecord(e), e, c3), /CONTRACT_EXISTING_FORMAT_CLAIMS_TO_BIND/));
});

test('authbinding: deterministic and sorted (deep-equal and byte-equal)', () => {
  const { c, e } = setup();
  const a = checkAuthBinding(syntheticExistingRecord(e, c), e, c);
  const b = checkAuthBinding(syntheticExistingRecord(e, c), e, c);
  assert.deepEqual(a, b); assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a.findings, [...a.findings].sort());
  assert.equal(new Set(a.findings).size, a.findings.length);
});

test('authbinding: the checker never touches the filesystem (synthetic only)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('./auth-binding.mjs', import.meta.url), 'utf8');
  assert.ok(!/from 'node:(fs|child_process|net|http|https)'|require\(/.test(src));
});
