// test/clashpanel/core/measurementBasis.test.mjs — owner decision 2026-10-07: Soft is no longer disabled by an unverified
// measurement basis; the user may attest a unit or choose raw model units, and neither is ever reported as `verified`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASIS_STATE, basisProvenanceText, isBasisChoice, resolveBasis } from '../../../clashpanel/core/measurementBasis.js';
import { BASIS_RAW, BASIS_UNITS } from '../../../clashpanel/core/constants.js';

const UNVERIFIED = { verifiedBasis: false };

test('resolveBasis: a verified basis is `verified` whatever the user chose (no unit is attached)', () => {
  for (const basisUnit of ['', 'mm', 'ft', BASIS_RAW]) {
    assert.deepEqual(resolveBasis({ basisUnit, verifiedBasis: true }), { state: 'verified', unit: null }, basisUnit);
  }
});

test('resolveBasis: unverified + a declared unit => user-supplied with that unit (never verified)', () => {
  for (const unit of BASIS_UNITS) {
    const r = resolveBasis({ basisUnit: unit, ...UNVERIFIED });
    assert.deepEqual(r, { state: 'user-supplied', unit }, unit);
    assert.notEqual(r.state, 'verified');
  }
});

test('resolveBasis: unverified + raw => raw-model-units with no unit; unverified + nothing => unavailable', () => {
  assert.deepEqual(resolveBasis({ basisUnit: BASIS_RAW, ...UNVERIFIED }), { state: 'raw-model-units', unit: null });
  assert.deepEqual(resolveBasis({ basisUnit: '', ...UNVERIFIED }), { state: 'unavailable', unit: null });
});

test('resolveBasis: fail closed — only the literal boolean true verifies; junk units and junk flags never yield verified', () => {
  for (const verifiedBasis of [false, undefined, null, 0, 1, 'true', 'verified', {}, []]) {
    for (const basisUnit of ['', 'mm', 'raw', 'km', 'MM', undefined, null, 5, 'verified']) {
      assert.notEqual(resolveBasis({ basisUnit, verifiedBasis }).state, 'verified', `${String(verifiedBasis)}/${String(basisUnit)}`);
    }
  }
  assert.equal(resolveBasis({ basisUnit: 'km', ...UNVERIFIED }).state, 'unavailable');   // not a known unit
  assert.equal(resolveBasis({ basisUnit: 'verified', ...UNVERIFIED }).state, 'unavailable');
});

test('resolveBasis: results are frozen; BASIS_STATE names the four states', () => {
  assert.ok(Object.isFrozen(resolveBasis({ basisUnit: 'mm', ...UNVERIFIED })));
  assert.ok(Object.isFrozen(resolveBasis({ basisUnit: '', verifiedBasis: true })));
  assert.deepEqual({ ...BASIS_STATE }, { VERIFIED: 'verified', USER_SUPPLIED: 'user-supplied', RAW: 'raw-model-units', UNAVAILABLE: 'unavailable' });
  assert.ok(Object.isFrozen(BASIS_STATE));
});

test('isBasisChoice: only the empty string, raw, and the five declared units', () => {
  for (const ok of ['', 'raw', 'mm', 'cm', 'm', 'in', 'ft']) assert.equal(isBasisChoice(ok), true, ok);
  for (const bad of ['km', 'MM', 'verified', ' mm', 'millimeter', null, undefined, 5, {}, ['mm']]) assert.equal(isBasisChoice(bad), false, String(bad));
});

test('basisProvenanceText: user-supplied/raw say so and never claim verification; verified keeps the host basisKey', () => {
  const supplied = basisProvenanceText(resolveBasis({ basisUnit: 'cm', ...UNVERIFIED }), { state: 'incompatible', reason: 'x' });
  assert.match(supplied, /^user-supplied, not verified/);
  assert.match(supplied, /"cm"/);
  assert.match(supplied, /unchanged/);
  assert.doesNotMatch(supplied, /^verified/);
  const raw = basisProvenanceText(resolveBasis({ basisUnit: BASIS_RAW, ...UNVERIFIED }), null);
  assert.match(raw, /^raw model units, not verified/);
  assert.doesNotMatch(raw, /^verified/);
  assert.equal(basisProvenanceText(resolveBasis({ basisUnit: '', verifiedBasis: true }), { state: 'verified', basisKey: 'shared-frame' }), 'verified (shared-frame)');
  assert.equal(basisProvenanceText(resolveBasis({ basisUnit: '', verifiedBasis: true }), null), 'verified (single model: no cross-model comparison)');
  // A verified record paired with a NON-verified host verdict never prints the host basisKey as verified evidence.
  assert.equal(basisProvenanceText({ state: 'verified', unit: null }, { state: 'incompatible', basisKey: 'k' }), 'verified (single model: no cross-model comparison)');
  assert.equal(basisProvenanceText(resolveBasis({ basisUnit: '', ...UNVERIFIED }), null), 'unavailable');
  assert.equal(basisProvenanceText(undefined, null), 'unavailable');
});
