// Trace schema 2: data-record, META and END validators against the contract appendices. [SYN] research-local tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from './contract-loader.mjs';
import {
  FIELD_CHECKS, validateDataRecord, validateMetaV2, validateEndV2, envelopeOnlyKeys, wireKeyCollisions, allowedSharedKeys, capsV2, variantOf,
} from './trace-schema.mjs';
import { metaTemplate, bindingFor } from './fixtures-gen.mjs';
import { TRACE_V2_CODES } from './envelope.mjs';

const contract = loadContract();
const env = envelopeOnlyKeys(contract);
const V = (r, atoms = ['P-FRM', 'P-TC', 'V-PEND', 'V-EDGE']) => validateDataRecord(r, { contract, envelopeOnlyKeys: env, atoms });
const C = (r) => ({ f: 1, q: 5, tm: 10, ...r });
const meta = () => ({ ...metaTemplate(contract, bindingFor(contract, 'a'), { role: 'T', run: 'syn-a' }), ba: 'FALSE', bp: 'NULL', ei: 'LOW', lb: 1, qe: 0 });

test('schema: every contract wire key has a value check, and every wire variant is reachable', () => {
  for (const logical of Object.keys(contract.part1.wireKeys)) assert.ok(FIELD_CHECKS[logical], `no check for ${logical}`);
  for (const ft of Object.keys(contract.part1.fieldTypes)) assert.ok(FIELD_CHECKS[ft], `fieldTypes ${ft} unchecked`);
  const seen = new Set([
    variantOf({ k: 'RQ', pp: 'pre' }), variantOf({ k: 'RQ', pp: 'post', co: 'returned' }), variantOf({ k: 'RQ', pp: 'post', co: 'threw' }),
    variantOf({ k: 'PS' }), variantOf({ k: 'TE' }), variantOf({ k: 'FS' }), variantOf({ k: 'T4', tp: 'start' }), variantOf({ k: 'T4', tp: 'sample' }),
    variantOf({ k: 'T4', tp: 'decision' }), variantOf({ k: 'RS', pp: 'pre' }), variantOf({ k: 'RS', pp: 'post' }), variantOf({ k: 'CE' }),
    variantOf({ k: 'TC' }), variantOf({ k: 'C8' }), variantOf({ k: 'TZ' }), variantOf({ k: 'CT' }), variantOf({ k: 'NV' }),
  ]);
  assert.deepEqual([...seen].sort(), Object.keys(contract.part1.wireVariants).sort());
});

test('schema: valid records of every variant pass; required, forbidden and conditional keys are enforced', () => {
  const ok = [
    C({ k: 'RQ', pp: 'pre', r: 1, sp: 0, sx: 'none' }),
    C({ k: 'RQ', pp: 'post', r: 1, co: 'returned', sp: 1, sb: 1, sx: 'appear', nw: 1, cl: 0, dg: 'a'.repeat(16) }),
    C({ k: 'RQ', pp: 'post', r: 1, co: 'threw' }),
    C({ k: 'PS', hq: 4, rd: 'frame', sp: 1, sb: 'U', sx: 'replace' }),
    C({ k: 'TE', ev: 1, pa: 1 }), C({ k: 'FS', cl: 3, dg: '0'.repeat(16) }),
    C({ k: 'T4', tp: 'start', s: 'G', r: 1 }), C({ k: 'T4', tp: 'sample', s: 'S', n: 1801, cl: 0, dg: '0'.repeat(16) }),
    C({ k: 'T4', tp: 'decision', s: 'S', n: 2, d: 'settled', ss: 4, te: 1, fr: 1 }),
    C({ k: 'T4', tp: 'decision', s: 'S', n: 0, d: 'timeout', te: 1 }),
    C({ k: 'RS', pp: 'pre' }), C({ k: 'RS', pp: 'post', rs: 'THROW' }),
    C({ k: 'RS', pp: 'post', rs: 'NOOP', cl: 0, dg: '0'.repeat(16), sp: 0, sx: 'none' }),
    C({ k: 'TC' }), C({ k: 'C8', ss: 3, dg: '0'.repeat(16), mr: 'subject', tk: 'x', el: 0, in: 0 }),
    C({ k: 'TZ', zp: 'final', zc: 'normal' }), C({ k: 'CT', ci: 'PC-3', cr: 'PASSED', fu: 3, fb: 9 }),
    C({ k: 'NV', nv: 'A'.repeat(344) }), C({ k: 'TC', rn: 'syn-a' }),
  ];
  for (const r of ok) assert.deepEqual(V(r), [], JSON.stringify(r));
  const bad = [
    [C({ k: 'RQ', pp: 'post', co: 'returned', sp: 0, sx: 'none', nw: 0, cl: 0, dg: '0'.repeat(16) }), 'DATA-INVALID'], // NC-4a missing r
    [C({ k: 'RQ', pp: 'pre', r: 1, sp: 1, sx: 'appear' }), 'WIRE-VARIANT'], // sb missing although sp = 1
    [C({ k: 'RQ', pp: 'pre', r: 1, sp: 0, sx: 'none', sb: 1 }), 'WIRE-VARIANT'], // sb although sp = 0
    [C({ k: 'RQ', pp: 'post', r: 1, co: 'threw', cl: 0 }), 'I2-RQ-THREW-READS'],
    [C({ k: 'PS', hq: 4, rd: 'frame', sp: 1, sb: 1, sx: 'clear' }), 'WIRE-VARIANT'],
    [C({ k: 'T4', tp: 'decision', s: 'S', n: 0, d: 'timeout', te: 1, fr: 1 }), 'WIRE-VARIANT'],
    [C({ k: 'T4', tp: 'decision', s: 'S', n: 2, d: 'none', ss: 3, te: 1 }), 'WIRE-VARIANT'],
    [C({ k: 'T4', tp: 'decision', s: 'S', n: 2, d: 'settled', ss: 3 }), 'WIRE-VARIANT'], // terminal without te
    [C({ k: 'T4', tp: 'sample', s: 'S', n: 0, cl: 0, dg: '0'.repeat(16) }), 'DATA-INVALID'],
    [C({ k: 'RS', pp: 'post', rs: 'OK' }), 'WIRE-VARIANT'], // a non-THROW restore needs its read
    [C({ k: 'C8', ss: 3, dg: '0'.repeat(16), mr: 'subject', tk: 'x', el: 0, in: 1 }), 'WIRE-VARIANT'],
    [C({ k: 'CE' }), 'CE-NOT-CONFIGURED'],
    [C({ k: 'TC', vv: '7.124.2' }), 'META-FIELD-IN-DATA'],
    [C({ k: 'TC', zz: 1 }), 'WIRE-VARIANT'],
    [C({ k: 'NV', nv: 'A'.repeat(344), rn: 'syn-a' }), 'WIRE-VARIANT'],
    [C({ k: 'FS', cl: -1, dg: '0'.repeat(16) }), 'DATA-INVALID'],
    [C({ k: 'TE', ev: 1, pa: 1, toString: 1 }), 'WIRE-VARIANT'],
    [{ k: 'TC', q: 1, f: 0 }, 'DATA-INVALID'], // missing tm
  ];
  for (const [r, code] of bad) assert.ok(V(r).includes(code), `${code} not in ${JSON.stringify(V(r))} for ${JSON.stringify(r)}`);
  for (const junk of [null, 1, 'x', [], Object.create(null), { k: 'META' }, { k: 'XX' }]) assert.deepEqual(V(junk), ['DATA-INVALID']);
});

test('schema: META template from the binding is valid; every field is required and type-checked', () => {
  assert.deepEqual(validateMetaV2(meta(), { contract }), []);
  for (const f of contract.envelope.meta.requiredFields) {
    const m = meta(); delete m[f.key];
    assert.ok(validateMetaV2(m, { contract }).includes('META-INVALID'), `missing ${f.key} accepted`);
  }
  const cases = [
    [{ sv: 1 }, 'SCHEMA-VERSION-UNSUPPORTED'], [{ rc: 2 }, 'RECORDER-ORDINAL'], [{ id: 'OFF' }, 'META-INVALID'],
    [{ vv: '7.125.0' }, 'META-VB0-INCONSISTENT'], [{ vd: 'f'.repeat(64) }, 'META-VB0-INCONSISTENT'],
    [{ vg: 0 }, 'META-VB0-INCONSISTENT'], // vb rows 1 although the guard failed
    [{ qe: 1 }, 'EDGEINIT-INCONSISTENT'], [{ cp: { ...capsV2(contract), dataEvents: 8192 } }, 'META-CAPS-MISMATCH'],
    [{ at: ['P-FRM', 'P-TC', 'V-PEND'] }, 'META-INVALID'], [{ ph: '0'.repeat(64) }, 'META-INVALID'], [{ rr: 361 }, 'META-INVALID'],
    [{ ec: { min: 5, max: 4 } }, 'META-INVALID'], [{ extra: 1 }, 'META-INVALID'], [{ ad: 'not-a-uuid' }, 'META-INVALID'],
  ];
  for (const [over, code] of cases) assert.ok(validateMetaV2({ ...meta(), ...over }, { contract }).includes(code), `${JSON.stringify(over)} -> ${code}`);
  assert.deepEqual(validateMetaV2({ ...meta(), ba: 'TRUE', ei: 'UNKNOWN' }, { contract }), [], 'an honest UNKNOWN boundary is valid');
  assert.deepEqual(validateMetaV2({ ...meta(), vv: '7.124.1', vg: 0, vb: { 'VB-1': 0, 'VB-2': 0, 'VB-3': 0 } }, { contract }), [], 'NC-1a honest META is valid');
  assert.deepEqual(validateMetaV2(null, { contract }), ['META-INVALID']);
});

test('schema: END validator enforces flags, counters and terminal status', () => {
  const end = { cg: 0, ds: 0, f: 3, iv: 0, k: 'END', lq: 9, lr: 1, mx: 2, nb: 100, ne: 9, nvn: 0, nvx: 0, overflow: 0, pc: { 'VB-3': 1 }, rj: 0, run: 'syn-a', sd: '0'.repeat(64), tm: 5, truncated: 0, ts: 'OK', zt: 4 };
  assert.deepEqual(validateEndV2(end, { contract }), []);
  assert.ok(validateEndV2({ ...end, ts: 'TRUNCATED' }, { contract }).includes('TERMINAL-STATUS-INCONSISTENT'));
  assert.ok(validateEndV2({ ...end, overflow: 1 }, { contract }).includes('END-INVALID'), 'overflow requires rj > iv');
  assert.deepEqual(validateEndV2({ ...end, overflow: 1, rj: 1, ts: 'OVERFLOW' }, { contract }), []);
  assert.ok(validateEndV2({ ...end, mx: 1802 }, { contract }).includes('END-INVALID'));
  assert.ok(validateEndV2({ ...end, ds: 3 }, { contract }).includes('END-INVALID'));
  assert.ok(validateEndV2({ ...end, extra: 0 }, { contract }).includes('END-INVALID'));
  assert.ok(validateEndV2({ ...end, iv: 1, rj: 1, ts: 'OK' }, { contract }).includes('TERMINAL-STATUS-INCONSISTENT'));
});

test('schema: data wire keys collide with META/END keys only on the contract-allowed shared keys k, f, tm (Part 2 §12.4 collision rule)', () => {
  assert.deepEqual(wireKeyCollisions(contract), allowedSharedKeys(contract));
  assert.deepEqual(allowedSharedKeys(contract), ['f', 'k', 'tm']);
  for (const k of allowedSharedKeys(contract)) assert.ok(!env.has(k), `${k} is shared, not envelope-only`);
  // a mutated contract that adds a new shared key is caught by the comparison
  const c2 = structuredClone(contract); c2.envelope.meta.requiredFields.push({ key: 'sb', name: 'x', type: 'int' });
  assert.notDeepEqual(wireKeyCollisions(c2), allowedSharedKeys(c2));
  for (const k of ['vv', 'vd', 'sv', 'run', 'sd', 'pc', 'ts', 'ne']) assert.ok(env.has(k), `${k} is envelope-only`);
  for (const code of ['I1-RQ-PAIR', 'WIRE-VARIANT', 'OBSERVED_VIEWER_NOT_BOUND']) assert.ok(TRACE_V2_CODES.includes(code));
  const all = [...contract.envelope.integrityCodes.part1, ...contract.envelope.integrityCodes.part2];
  for (const code of all) assert.ok(TRACE_V2_CODES.includes(code), `contract code ${code} not implemented`);
});
