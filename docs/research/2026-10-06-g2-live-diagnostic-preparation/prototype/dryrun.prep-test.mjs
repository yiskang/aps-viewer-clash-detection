import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from './contract-loader.mjs';
import { validateDryRunConfig, syntheticValidConfig, ACCEPTANCE_HARNESS_SHA256, ACCEPTED_PROCEDURE_SHA256 } from './dryrun-config.mjs';

const C = () => loadContract();
const clone = (x) => structuredClone(x);
const stops = (r) => r.stops.map((s) => s.id);
const mut = (fn) => { const c = C(); const cfg = syntheticValidConfig(c); fn(cfg, c); return validateDryRunConfig(cfg, c); };

test('dryrun: a fully valid synthetic hypothetical config passes', () => {
  const c = C(); const r = validateDryRunConfig(syntheticValidConfig(c), c);
  assert.deepEqual(r, { ok: true, findings: [], stops: [] });
  assert.equal(ACCEPTANCE_HARNESS_SHA256, 'cc8868cd68b9c2c3382297070289a2aa165c74249c6d82896d76bacc6c6ef09b');
  assert.equal(ACCEPTED_PROCEDURE_SHA256, 'd1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75');
});

test('dryrun: deterministic (deep-equal and byte-equal)', () => {
  const c = C(); const cfg = syntheticValidConfig(c); cfg.viewer.version = '1.0'; cfg.outputDir.entryCount = 3;
  const a = validateDryRunConfig(cfg, c); const b = validateDryRunConfig(clone(cfg), c);
  assert.deepEqual(a, b); assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a.findings, [...a.findings].sort());
});

test('dryrun: wrong Viewer version / bundle digest map to SC-A09 / SC-A10 (class a2)', () => {
  let r = mut((x) => { x.viewer.version = '7.124.1'; });
  assert.deepEqual(stops(r), ['SC-A09']); assert.equal(r.stops[0].class, 'a'); assert.equal(r.stops[0].subclass, 'a2'); assert.equal(r.ok, false);
  r = mut((x) => { x.viewer.version = '7.124.2 '; });
  assert.deepEqual(stops(r), ['SC-A09'], 'strict comparison');
  r = mut((x) => { x.viewer.bundleSha256 = 'e'.repeat(64); });
  assert.deepEqual(stops(r), ['SC-A10']);
  r = mut((x) => { delete x.viewer; });
  assert.deepEqual(stops(r), ['SC-A09', 'SC-A10']);
});

test('dryrun: harness / procedure SHA mismatch map to SC-A02 (class a1)', () => {
  let r = mut((x) => { x.harnessSha256 = '0'.repeat(64); });
  assert.deepEqual(stops(r), ['SC-A02']); assert.equal(r.stops[0].subclass, 'a1');
  r = mut((x) => { x.procedureSha256 = '0'.repeat(64); });
  assert.deepEqual(stops(r), ['SC-A02']);
  r = mut((x) => { x.diagnosticHarnessSha256 = ACCEPTANCE_HARNESS_SHA256; });
  assert.deepEqual(stops(r), ['SC-A02']);
  r = mut((x) => { x.diagnosticHarnessSha256 = 'nothex'; });
  assert.deepEqual(stops(r), ['SC-A02']);
});

test('dryrun: output directory must be absent/empty and inside the diagnostic run root (SC-A04)', () => {
  for (const f of [(x) => { x.outputDir.exists = true; }, (x) => { x.outputDir.entryCount = 1; }, (x) => { x.outputDir.path = '/abs/out'; },
    (x) => { x.outputDir.path = 'test/acceptance/results/g2-live-diagnostic/../../x'; }, (x) => { x.outputDir.path = 'docs/research/evidence/g2-live-20261004-75a3ccb9'; },
    (x) => { x.outputDir.path = 'test/acceptance/results/clashpanel-viewerbridge-g2-attempts/'; }, (x) => { delete x.outputDir; }, (x) => { x.outputDir.path = ''; }]) {
    const r = mut(f);
    assert.equal(r.ok, false);
    assert.ok(stops(r).includes('SC-A04')); assert.deepEqual([...new Set(stops(r))], ['SC-A04']);
  }
});

test('dryrun: active-authorization ambiguity maps to SC-A03', () => {
  for (const f of [(x) => { x.authorization.nonSupersededCount = 2; }, (x) => { x.authorization.nonSupersededCount = 0; }, (x) => { x.authorization.hasLiveExecutionMarker = true; },
    (x) => { x.authorization.spent = true; }, (x) => { x.authorization.superseded = true; }, (x) => { x.authorization.present = false; }, (x) => { delete x.authorization; }]) {
    const r = mut(f);
    assert.deepEqual(stops(r), ['SC-A03']);
  }
});

test('dryrun: missing capabilities map to SC-A11 / SC-A12 / SC-A13', () => {
  assert.deepEqual(stops(mut((x) => { x.capabilities.vb['VB-1'] = 0; })), ['SC-A11']);
  assert.deepEqual(stops(mut((x) => { x.capabilities.vb['VB-3'] = 0; })), ['SC-A11']);
  assert.deepEqual(stops(mut((x) => { delete x.capabilities.vb; })), ['SC-A11']);
  assert.deepEqual(stops(mut((x) => { x.capabilities.tagWrapper = false; })), ['SC-A12']);
  assert.deepEqual(stops(mut((x) => { x.capabilities.atoms = ['P-FRM', 'P-TC']; })), ['SC-A13']);
  assert.deepEqual(stops(mut((x) => { x.capabilities.atoms = ['P-FRM', 'P-TC', 'V-PEND', 'V-EDGE', 'P-XS']; })), ['SC-A13']);
  assert.deepEqual(stops(mut((x) => { x.capabilities.idAxis = 'OFF'; })), ['SC-A13']);
  assert.deepEqual(stops(mut((x) => { x.capabilities.slotWindow = 'ASSUME_NO_UNOBSERVED_WRITER'; })), ['SC-A13']);
  assert.deepEqual(stops(mut((x) => { delete x.capabilities; })), ['SC-A13']);
});

test('dryrun: buffer bounds below the contract caps map to SC-A07 (every buffer key)', () => {
  const c = C();
  for (const k of Object.keys(syntheticValidConfig(c).caps)) {
    const r = mut((x) => { x.caps[k] -= 1; });
    assert.deepEqual(stops(r), ['SC-A07'], k);
    const r2 = mut((x) => { x.caps[k] += 1; });
    assert.deepEqual(stops(r2), ['SC-A06'], `${k} above LIVE_CAPS_V2 is a META.cp mismatch`);
    const r3 = mut((x) => { delete x.caps[k]; });
    assert.deepEqual(stops(r3), ['SC-A07'], `${k} missing`);
  }
  assert.deepEqual(stops(mut((x) => { x.expectedCount.max = 24577; })), ['SC-A07']);
  assert.deepEqual(stops(mut((x) => { x.plan.worstCaseRawRecords = 24577; })), ['SC-A07']);
  assert.deepEqual(stops(mut((x) => { x.plan.worstCaseProjectedRecords = 8193; })), ['SC-A07']);
  assert.deepEqual(stops(mut((x) => { x.plan.worstCaseDurationFrames = 3577; })), ['SC-A07']);
  assert.deepEqual(stops(mut((x) => { x.plan.controlWindowFramesNeeded = 1802; })), ['SC-A07']);
  assert.deepEqual(stops(mut((x) => { delete x.caps; })), ['SC-A07']);
});

test('dryrun: refresh rate above 360 Hz maps to SC-A17', () => {
  assert.deepEqual(stops(mut((x) => { x.measuredRefreshHz = 361; })), ['SC-A17']);
  assert.deepEqual(stops(mut((x) => { x.measuredRefreshHz = 0; })), ['SC-A17']);
  assert.equal(mut((x) => { x.measuredRefreshHz = 360; }).ok, true);
});

test('dryrun adversarial: live execution request, non-hypothetical config, garbage input', () => {
  let r = mut((x) => { x.executeRequested = true; });
  assert.equal(r.ok, false); assert.ok(r.findings.some((f) => /LIVE_EXECUTION_NOT_AUTHORIZED/.test(f)));
  r = mut((x) => { x.hypothetical = false; });
  assert.ok(r.findings.some((f) => /CONFIG_INVALID: hypothetical/.test(f)));
  const c = C();
  for (const bad of [null, undefined, 5, 'x', []]) assert.equal(validateDryRunConfig(bad, c).ok, false);
  assert.equal(validateDryRunConfig(syntheticValidConfig(c), {}).ok, false);
});

test('dryrun: every reported stop id exists in the contract with its class', () => {
  const c = C(); const reg = new Map(c.stopConditions.stopConditions.map((s) => [s.id, s]));
  const r = mut((x) => { x.viewer.version = 'x'; x.viewer.bundleSha256 = 'y'; x.harnessSha256 = 'z'; x.outputDir.exists = true; x.authorization.spent = true; x.capabilities.tagWrapper = false; x.caps.dataEvents = 1; x.measuredRefreshHz = 999; });
  assert.deepEqual(stops(r), ['SC-A02', 'SC-A03', 'SC-A04', 'SC-A07', 'SC-A09', 'SC-A10', 'SC-A12', 'SC-A17']);
  for (const s of r.stops) { assert.equal(s.class, reg.get(s.id).class); assert.equal(s.subclass, reg.get(s.id).subclass); assert.ok(r.findings.some((f) => f.startsWith(`${s.id}[`))); }
});
