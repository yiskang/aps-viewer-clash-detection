// VB-0 fails closed on anything but the exact pinned build (independent review H1). [SYN] research tests only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPinned, PINNED_VIEWER_VERSION, PINNED_VIEWER_BUNDLE_SHA256, viewerPinMatches } from './pins.mjs';
import { validateMeta } from './schema.mjs';
import { LIVE_CAPS, LiveTraceRecorder } from './bounds.mjs';
import { applyVbGuard, correlate } from './correlate.mjs';
import { correlateTrace, validateTrace } from './trace-integrity.mjs';
import { NAMED_CONFIGS } from './project.mjs';

const { mods } = await loadPinned();
const { canonicalBytes } = mods.canonical;
const AT = NAMED_CONFIGS.find((c) => c.id === 'T-VB/ON').atoms;
const V = ['V-PEND', 'V-ACT', 'V-EDGE'];
const ALL_VB = { 'VB-1': 1, 'VB-2': 1, 'VB-3': 1 };
const NO_VB = { 'VB-1': 0, 'VB-2': 0, 'VB-3': 0 };
const META = {
  at: AT, br: 'chromium-130', cp: { ...LIVE_CAPS }, cs: 0, ec: { max: LIVE_CAPS.dataEvents, min: 0 }, f: 0, hh: 'a'.repeat(64), id: 'ON', k: 'META',
  ph: 'b'.repeat(64), q0: 1, run: 'r1', sh: 'c'.repeat(64), sv: 1, tm: 0, vb: ALL_VB, vd: PINNED_VIEWER_BUNDLE_SHA256, vg: 1, vv: PINNED_VIEWER_VERSION,
};
const guardIn = (m, pc = { 'VB-3': 1 }) => ({ vg: m.vg, vv: m.vv, vd: m.vd, vb: m.vb, pc });
const vAtoms = (g) => g.atoms.filter((a) => a.startsWith('V-'));
const without = (o, key) => { const c = { ...o }; delete c[key]; return c; };

/** Rejected by BOTH the META validator (and so the recorder) and the guard; the guard reports VB-0 only. */
function assertVb0Rejected(m, why) {
  assert.ok(validateMeta(m, { caps: LIVE_CAPS }).length > 0, `validateMeta: ${why}`);
  assert.throws(() => new LiveTraceRecorder(m, canonicalBytes), (e) => e.code === 'META-INVALID', `recorder: ${why}`);
  const g = applyVbGuard(AT, guardIn(m));
  assert.deepEqual(vAtoms(g), [], `guard: ${why}`);
  assert.deepEqual(g.vbUnavailable, ['VB-0'], `guard reason: ${why}`);
}

test('VB-0 pin: one canonical form (exact "7.124.2" + pinned viewer3D.js SHA-256) is the only eligible build', () => {
  assert.equal(PINNED_VIEWER_VERSION, '7.124.2');
  assert.equal(PINNED_VIEWER_BUNDLE_SHA256, '12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e');
  assert.deepEqual(validateMeta(META, { caps: LIVE_CAPS }), []);
  const g = applyVbGuard(AT, guardIn(META));
  assert.deepEqual(vAtoms(g), V); assert.deepEqual(g.vbUnavailable, []);
  assert.equal(viewerPinMatches(PINNED_VIEWER_VERSION, PINNED_VIEWER_BUNDLE_SHA256), true);
});

test('H1 reproduction: META.vv "7.125.0" with vg=1 and all vb=1 is rejected by validateMeta AND by applyVbGuard (even with END.pc VB-3=1)', () => {
  const h1 = { ...META, vv: '7.125.0' };
  assertVb0Rejected(h1, 'H1');
  const g = applyVbGuard(AT, { ...guardIn(h1), pc: { 'VB-3': 1 } });
  assert.ok(!g.atoms.includes('V-PEND') && !g.atoms.includes('V-EDGE'));
});

test('VB-0 version mismatches (other versions, malformed strings, wrong types, missing) all fail closed', () => {
  const bad = ['7.124.1', '7.125.0', '7.125.3', '7.124.20', '7.124.2.0', '7.124', 'ABSENT', '', '7.124.2 ', ' 7.124.2', 'v7.124.2', '7.124.2\n', 'V7.124.2',
    7.124, 7124, null, true, [], ['7.124.2'], {}, { toString: () => '7.124.2' }];
  for (const vv of bad) assertVb0Rejected({ ...META, vv }, `vv=${JSON.stringify(vv)}`);
  assertVb0Rejected(without(META, 'vv'), 'vv missing');
});

test('VB-0 digest mismatches: correct version + wrong/missing/malformed digest, and wrong version + correct digest', () => {
  const bad = ['0'.repeat(64), PINNED_VIEWER_BUNDLE_SHA256.toUpperCase(), `${PINNED_VIEWER_BUNDLE_SHA256}\n`, PINNED_VIEWER_BUNDLE_SHA256.slice(1), 'ABSENT', '', 12, null, [PINNED_VIEWER_BUNDLE_SHA256]];
  for (const vd of bad) assertVb0Rejected({ ...META, vd }, `vd=${JSON.stringify(vd)}`);
  assertVb0Rejected(without(META, 'vd'), 'vd missing');
  assertVb0Rejected({ ...META, vv: '7.124.1' }, 'wrong version + correct digest');
  // a vb row 1 alone (vg=0) with a mismatching build also invalidates META
  assert.ok(validateMeta({ ...META, vg: 0, vv: '7.125.0' }, { caps: LIVE_CAPS }).length > 0);
});

test('VB-0 is derived, not trusted: vg must be exactly 1 AND consistent with (vv, vd); prototype-chain values never count', () => {
  for (const vg of [0, true, '1', 2, null, undefined]) {
    const g = applyVbGuard(AT, { ...guardIn(META), vg });
    assert.deepEqual(vAtoms(g), [], `vg=${String(vg)}`); assert.deepEqual(g.vbUnavailable, ['VB-0']);
  }
  const inherited = Object.assign(Object.create({ vv: PINNED_VIEWER_VERSION, vd: PINNED_VIEWER_BUNDLE_SHA256 }), { vg: 1, vb: ALL_VB, pc: { 'VB-3': 1 } });
  assert.deepEqual(vAtoms(applyVbGuard(AT, inherited)), []);
  const trap = new Proxy({}, { get() { throw new Error('trap'); }, has() { throw new Error('trap'); }, getOwnPropertyDescriptor() { throw new Error('trap'); } });
  let g; assert.doesNotThrow(() => { g = applyVbGuard(AT, trap); });
  assert.deepEqual(vAtoms(g), []); assert.deepEqual(g.vbUnavailable, ['VB-0']);
  // the honest guard-failure record (vg=0, all vb=0, any observed vv/vd) is a VALID META: the run is public+harness
  assert.deepEqual(validateMeta({ ...META, vg: 0, vb: NO_VB, vv: '7.125.0' }, { caps: LIVE_CAPS }), []);
  assert.deepEqual(validateMeta({ ...META, vg: 0, vb: NO_VB, vv: 'ABSENT', vd: 'ABSENT' }, { caps: LIVE_CAPS }), []);
});

/** ownedTrace (correlate.diag-test.mjs) in the live encoding: tm added; the recorder stamps q. */
const P = (p, b) => (p ? { p: 1, b } : { p: 0 });
const LIVE_EVENTS = [
  { f: 0, k: 'FIT', r: 1, pq: P(0), pd: { ...P(1, 1), nw: 1 }, ac: 0, cl: 0, xc: 0 },
  { f: 0, k: 'SST', s: 'S', r: 1 },
  { f: 0, k: 'CAM', cl: 0, xc: 0, pd: P(1, 1), ac: 0 },
  { f: 0, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 0, xc: 0, pd: P(1, 1), ac: 0 },
  { f: 0, k: 'AE', ev: 1 }, { f: 0, k: 'TCK' },
  { f: 1, k: 'CAM', cl: 1, xc: 1, pd: P(0), ac: 1 },
  { f: 1, k: 'SMP', s: 'S', n: 2, d: 'none', cl: 1, xc: 1, pd: P(0), ac: 1 },
  { f: 1, k: 'AE', ev: 0 }, { f: 1, k: 'TC' }, { f: 1, k: 'TCK' },
  { f: 2, k: 'CAM', cl: 2, xc: 2, pd: P(0), ac: 0 },
  { f: 2, k: 'SMP', s: 'S', n: 3, d: 'none', cl: 2, xc: 2, pd: P(0), ac: 0 },
  { f: 3, k: 'CAM', cl: 2, xc: 2, pd: P(0), ac: 0 },
  { f: 3, k: 'SMP', s: 'S', n: 4, d: 'settled', fr: 1, cl: 2, xc: 2, pd: P(0), ac: 0 },
].map((e, i) => ({ ...e, tm: i }));
function record(meta, pc) {
  const r = new LiveTraceRecorder(meta, canonicalBytes);
  for (const e of LIVE_EVENTS) assert.equal(r.append(e), true);
  return r.close({ pc }).records;
}

test('no fallback: a VB-0 failure is public+harness only — V-* events removed, verdict is the C6 VB_UNAVAILABLE ambiguity, never upgraded', () => {
  const failed = record({ ...META, vg: 0, vb: NO_VB, vv: '7.125.0' }, { 'VB-3': 1 });
  const v = validateTrace(failed, { canonicalBytes });
  assert.equal(v.ok, true); assert.equal(v.vbEligible, false);
  const out = correlateTrace(failed, { canonicalBytes });
  assert.deepEqual(out.guard.vbUnavailable, ['VB-0']);
  assert.deepEqual(vAtoms(out.guard), []);
  assert.equal(out.malformed, null, 'AE/pd/pq/ac of the disabled atoms were removed, not MALFORMED');
  for (const id of ['Q-OWNER', 'Q-SUBJ', 'Q-ATTR']) assert.deepEqual(out.questions[id], { status: 'AMBIGUOUS', reason: 'VB_UNAVAILABLE:VB-0' }, id);
  // identical to correlating the public+harness projection directly
  const pub = failed.slice(1, -1).filter((e) => e.k !== 'AE').map(({ pd, pq, ac, ...rest }) => rest);
  const direct = correlate(pub, { atoms: AT.filter((a) => !a.startsWith('V-')), idAxis: 'ON', vbUnavailable: ['VB-0'], mode: 'live' });
  assert.deepEqual(out.questions, direct.questions);
  // the same capture on the exact pinned build keeps V-* (the guard is the only difference)
  const pinned = correlateTrace(record(META, { 'VB-3': 1 }), { canonicalBytes });
  assert.equal(pinned.integrity.vbEligible, true);
  assert.deepEqual(vAtoms(pinned.guard), V);
  assert.deepEqual(pinned.questions['Q-SUBJ'], { status: 'AMBIGUOUS', reason: 'UNOBSERVED_SLOT_WINDOW' });
  // a META claiming vg=1 on another build is not even a valid envelope: whole-trace UNDIAGNOSABLE, never V-* evidence
  const forged = record(META, { 'VB-3': 1 });
  forged[0] = { ...forged[0], vv: '7.125.0' };
  const fo = correlateTrace(forged, { canonicalBytes });
  assert.equal(fo.integrity.ok, false); assert.ok(fo.integrity.errors.includes('META-VB0-INCONSISTENT'));
  for (const id of ['Q-OWNER', 'Q-SUBJ', 'Q-ATTR']) assert.equal(fo.questions[id].status, 'UNDIAGNOSABLE', id);
});
