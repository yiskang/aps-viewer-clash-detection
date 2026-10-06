// R1–R8 correlator and C1/C2/C3/C6 fail-closed behaviour on hand-built traces. [SYN] research tests only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { correlate, applyVbGuard, findContradiction, SLOT_WINDOW } from './correlate.mjs';
import { project, NAMED_CONFIGS } from './project.mjs';
import { PINNED_VIEWER_VERSION, PINNED_VIEWER_BUNDLE_SHA256 } from './pins.mjs';

const VB_ON = { atoms: NAMED_CONFIGS.find((c) => c.id === 'T-VB/ON').atoms, idAxis: 'ON' };
const VB_OFF = { atoms: VB_ON.atoms, idAxis: 'OFF' };
/** R3 under the D2-true assumption (no unobserved writer). The default (VB_ON) is the fail-closed OPEN window. */
const VB_ON_ASSUME = { ...VB_ON, slotWindow: SLOT_WINDOW.ASSUME };
const ASSUMED = 'NO_UNOBSERVED_WRITER';
/**
 * Guard input composed post hoc: {vg, vv, vd, vb} from META, {pc} from END (spec §6.1.3, R-M4). vv/vd added
 * deliberately (H1): VB-0 is derived from the exact pinned build, so a guard input without them now fails closed.
 */
const GOOD_META = { vg: 1, vv: PINNED_VIEWER_VERSION, vd: PINNED_VIEWER_BUNDLE_SHA256, vb: { 'VB-1': 1, 'VB-2': 1, 'VB-3': 1 }, pc: { 'VB-3': 1 } };
const PUB_ON = { atoms: NAMED_CONFIGS.find((c) => c.id === 'T-PUB/ON').atoms, idAxis: 'ON' };
const q = (out, id) => out.questions[id];
const P = (p, b) => (p ? { p: 1, b } : { p: 0 });

/** One request (token 1) that completes before the subject settle decides: owner OWN, subject COMPLETE. */
function ownedTrace() {
  return [
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
  ];
}

test('request correlation (R1/R2/R3/R4): bound slot -> consumed -> attributed completion (only under the no-unobserved-writer assumption)', () => {
  const out = correlate(ownedTrace(), VB_ON_ASSUME);
  assert.deepEqual(out.fits, { 1: 'REQUEST_BOUND' });
  assert.deepEqual(q(out, 'Q-OWNER'), { status: 'DEFINITE', label: 'OWN', assumption: ASSUMED });
  assert.deepEqual(q(out, 'Q-SUBJ'), { status: 'DEFINITE', label: 'COMPLETE', assumption: ASSUMED });
  assert.deepEqual(q(out, 'Q-ATTR'), { status: 'DEFINITE', label: '1', assumption: ASSUMED });
  // default (OPEN slot window): the consumed token is never inferred => fail closed
  const open = correlate(ownedTrace(), VB_ON);
  for (const id of ['Q-OWNER', 'Q-SUBJ', 'Q-ATTR']) assert.deepEqual(q(open, id), { status: 'AMBIGUOUS', reason: 'UNOBSERVED_SLOT_WINDOW' }, id);
});

test('H-2 unobservable slot window: normal consumption vs foreign overwrite-then-consume give identical projections', () => {
  // Ground-truth worlds (project.mjs input encoding). World A: request 1 (slot object h=7) is consumed and completes.
  // World B: after the last visible read of h=7, an unobserved writer replaces the slot with h=9 and that object is
  // consumed in the next tick (7.124.2 clears the slot at V:105009 before raising the flag at V:107122), so request 1
  // is DISCARDED and the completion belongs to the foreign writer. No read ever sees h=9.
  const cam = (x) => Array(32).fill(x);
  const world = (ownTag) => [
    { k: 'FIT', f: 0, r: 1, pre: { h: 0 }, post: { h: 7 }, cam: cam(0), ac: 0, ow: 'INIT' },
    { k: 'SST', f: 0, s: 'S', r: 1 },
    { k: 'CAM', f: 0, post: { h: 7 }, cam: cam(0), ac: 0, ow: 'INIT' },
    { k: 'SMP', f: 0, s: 'S', n: 1, d: 'none', post: { h: 7 }, cam: cam(0), ac: 0, ow: 'INIT' },
    { k: 'AE', f: 0, ev: 1 }, { k: 'TCK', f: 0 },
    { k: 'CAM', f: 1, post: { h: 0 }, cam: cam(1), ac: 1, ow: ownTag },
    { k: 'SMP', f: 1, s: 'S', n: 2, d: 'none', post: { h: 0 }, cam: cam(1), ac: 1, ow: ownTag },
    { k: 'AE', f: 1, ev: 0 }, { k: 'TC', f: 1 }, { k: 'TCK', f: 1 },
    { k: 'CAM', f: 2, post: { h: 0 }, cam: cam(2), ac: 0, ow: `${ownTag}*` },
    { k: 'SMP', f: 2, s: 'S', n: 3, d: 'none', post: { h: 0 }, cam: cam(2), ac: 0, ow: `${ownTag}*` },
    { k: 'CAM', f: 3, post: { h: 0 }, cam: cam(2), ac: 0, ow: `${ownTag}*` },
    { k: 'SMP', f: 3, s: 'S', n: 4, d: 'settled', fr: 1, post: { h: 0 }, cam: cam(2), ac: 0, ow: `${ownTag}*` },
  ];
  const eq = (a, b) => (x, y) => x[0] === y[0];
  const A = project(world('T1'), VB_ON.atoms, 'ON', eq());
  const B = project(world('T9'), VB_ON.atoms, 'ON', eq());
  assert.deepEqual(A, B, 'byte-identical under T-VB/ON: no observable closes the window');
  assert.notDeepEqual(project(world('T1'), [...VB_ON.atoms, 'X-OWN'], 'ON', eq()), project(world('T9'), [...VB_ON.atoms, 'X-OWN'], 'ON', eq()), 'only the SYN owner tag separates them');
  // Under the assumption, R3 emits labels that are correct in world A and WRONG in world B (documented gap) ...
  const assumed = correlate(A, VB_ON_ASSUME);
  assert.deepEqual(q(assumed, 'Q-ATTR'), { status: 'DEFINITE', label: '1', assumption: ASSUMED });
  assert.deepEqual(q(assumed, 'Q-OWNER'), { status: 'DEFINITE', label: 'OWN', assumption: ASSUMED });
  // ... so the default OPEN window must not emit any of them.
  const open = correlate(B, VB_ON);
  for (const id of ['Q-OWNER', 'Q-SUBJ', 'Q-ATTR']) assert.equal(q(open, id).status, 'AMBIGUOUS', id);
  assert.equal(q(open, 'Q-ATTR').reason, 'UNOBSERVED_SLOT_WINDOW');
});

test('public-only (no V-EDGE/V-PEND): completion is unattributed and ownership is never asserted', () => {
  const tr = ownedTrace().filter((e) => e.k !== 'AE').map(({ pd, pq, ac, ...rest }) => rest);
  const out = correlate(tr, PUB_ON);
  assert.equal(q(out, 'Q-ATTR').status, 'AMBIGUOUS');
  assert.equal(q(out, 'Q-OWNER').status, 'AMBIGUOUS');
  assert.equal(q(out, 'Q-SUBJ').status, 'UNAVAILABLE');
  assert.equal(q(out, 'Q-SUBJ').reason, 'OBSERVABLE_ABSENT:V-PEND');
});

test('ambiguous request identity (C2): an unbound "U" slot read makes identity AMBIGUOUS, never definite', () => {
  const tr = ownedTrace();
  tr[2] = { ...tr[2], pd: P(1, 'U') }; // a foreign writer replaced the slot object before consumption
  tr[3] = { ...tr[3], pd: P(1, 'U') };
  const out = correlate(tr, VB_ON);
  assert.equal(q(out, 'Q-SUBJ').status, 'AMBIGUOUS');
  assert.equal(q(out, 'Q-SUBJ').reason, 'IDENTITY_AMBIGUOUS');
  assert.equal(q(out, 'Q-ATTR').status, 'AMBIGUOUS');
  assert.equal(q(out, 'Q-OWNER').status, 'AMBIGUOUS');
});

test('missing pending-slot identity: V-PEND absent => Q-SUBJ UNAVAILABLE (C1); VB-1 guard failure => AMBIGUOUS (C6)', () => {
  const noPend = VB_ON.atoms.filter((a) => a !== 'V-PEND');
  const tr = ownedTrace().map(({ pd, pq, ...rest }) => rest);
  const out = correlate(tr, { atoms: noPend, idAxis: 'ON' });
  assert.deepEqual(q(out, 'Q-SUBJ'), { status: 'UNAVAILABLE', reason: 'OBSERVABLE_ABSENT:V-PEND' });
  const g = applyVbGuard(VB_ON.atoms, { ...GOOD_META, vb: { ...GOOD_META.vb, 'VB-1': 0 } });
  assert.ok(!g.atoms.includes('V-PEND')); assert.deepEqual(g.vbUnavailable, ['VB-1']);
  const out2 = correlate(tr, { atoms: g.atoms, idAxis: 'ON', vbUnavailable: g.vbUnavailable });
  assert.deepEqual(q(out2, 'Q-SUBJ'), { status: 'AMBIGUOUS', reason: 'VB_UNAVAILABLE:VB-1' });
});

test('VB-0 guard failure disables every V-* atom; event order is never substituted (C6)', () => {
  const g = applyVbGuard(VB_ON.atoms, { vg: 0 });
  assert.deepEqual(g.atoms.filter((a) => a.startsWith('V-')), []);
  assert.deepEqual(g.vbUnavailable, ['VB-0']);
  const tr = ownedTrace().filter((e) => e.k !== 'AE').map(({ pd, pq, ac, ...rest }) => rest);
  const out = correlate(tr, { atoms: g.atoms, idAxis: 'ON', vbUnavailable: g.vbUnavailable });
  assert.equal(q(out, 'Q-SUBJ').reason, 'VB_UNAVAILABLE:VB-0');
  assert.equal(q(out, 'Q-ATTR').reason, 'VB_UNAVAILABLE:VB-0');
  assert.equal(q(out, 'Q-OWNER').status, 'AMBIGUOUS');
  assert.equal(q(out, 'Q-OWNER').reason, 'VB_UNAVAILABLE:VB-0');
});

test('VB guard fails closed on missing, partial or malformed metadata (M-4); VB-3 also needs its positive control (M-6)', () => {
  const v = (meta) => applyVbGuard(VB_ON.atoms, meta);
  const vAtoms = (meta) => v(meta).atoms.filter((a) => a.startsWith('V-'));
  assert.deepEqual(vAtoms(GOOD_META), ['V-PEND', 'V-ACT', 'V-EDGE']);
  assert.deepEqual(vAtoms({ ...GOOD_META, vb: {} }), [], 'empty vb');
  assert.deepEqual(v({ ...GOOD_META, vb: {} }).vbUnavailable, ['VB-1', 'VB-2', 'VB-3']);
  assert.deepEqual(vAtoms({ vb: GOOD_META.vb, pc: GOOD_META.pc }), [], 'vg absent');
  assert.deepEqual(v({ vb: GOOD_META.vb }).vbUnavailable, ['VB-0']);
  assert.deepEqual(vAtoms(undefined), []); assert.deepEqual(vAtoms(null), []); assert.deepEqual(vAtoms('x'), []);
  for (const vg of [true, '1', 2, null]) assert.deepEqual(vAtoms({ ...GOOD_META, vg }), [], `vg=${String(vg)}`);
  assert.deepEqual(vAtoms({ ...GOOD_META, vb: { 'VB-1': 1 } }), ['V-PEND'], 'partial vb');
  assert.deepEqual(vAtoms({ ...GOOD_META, vb: { 'VB-1': true, 'VB-2': '1', 'VB-3': 1 } }), ['V-EDGE'], 'malformed rows');
  assert.deepEqual(vAtoms({ ...GOOD_META, vb: [1, 1, 1] }), [], 'array vb');
  assert.deepEqual(vAtoms({ ...GOOD_META, pc: undefined }), ['V-PEND', 'V-ACT'], 'no positive control => V-EDGE disabled');
  assert.deepEqual(vAtoms({ ...GOOD_META, pc: { 'VB-3': 0 } }), ['V-PEND', 'V-ACT']);
  assert.deepEqual(v({ ...GOOD_META, pc: { 'VB-3': 0 } }).vbUnavailable, ['VB-3']);
  const inherited = Object.create({ 'VB-1': 1, 'VB-2': 1, 'VB-3': 1 });
  assert.deepEqual(vAtoms({ ...GOOD_META, vb: inherited }), [], 'prototype-chain rows are not own properties');
  assert.deepEqual(applyVbGuard(undefined, GOOD_META), { atoms: [], vbUnavailable: [] });
});

test('malformed input never throws: UNDIAGNOSABLE(MALFORMED) for every question (M-5)', () => {
  const bad = (tr, cfg = VB_ON) => {
    let out; assert.doesNotThrow(() => { out = correlate(tr, cfg); });
    for (const id of ['Q-OWNER', 'Q-SUBJ', 'Q-ATTR']) assert.deepEqual(q(out, id), { status: 'UNDIAGNOSABLE', reason: 'MALFORMED' }, id);
    assert.ok(out.malformed);
  };
  const t = ownedTrace();
  bad([{ ...t[0], pd: undefined }].map(({ pd, ...r }) => r).concat(t.slice(1)), VB_ON); // FIT without pd under V-PEND (was a TypeError)
  bad([{ f: 0, k: 'FIT' }], { atoms: ['V-PEND'], idAxis: 'ON' });
  bad([{ f: 0, k: 'SMP' }]); // bare SMP
  bad([{ f: 0, k: 'AE' }]); // bare AE
  bad([{ f: 0, k: 'toString' }]); // prototype-key kind
  bad([{ f: 0, k: 'TCK', constructor: 1 }]);
  bad([{ ...t[2], pd: { p: 0, b: 1 } }]); // empty slot with a binding
  bad([{ ...t[2], pd: { p: 1 } }]); // occupied slot with neither b nor ch
  bad([null]); bad('x'); bad(undefined);
  bad(t, null); bad(t, { atoms: 'P-TC', idAxis: 'ON' }); bad(t, { ...VB_ON, idAxis: 'on' }); bad(t, { ...VB_ON, slotWindow: 'MAYBE' });
  bad(t, VB_OFF); // r and pd.b are ID-ON encodings
  bad(t.map(({ ac, ...r }) => r)); // V-ACT configured but no ac on reads
  bad(t, { atoms: VB_ON.atoms.filter((a) => a !== 'V-EDGE'), idAxis: 'ON' }); // AE present without V-EDGE
  assert.equal(correlate(t, VB_ON).malformed, null);
});

test('transition ownership (R3/R4): two requests, held second request, ordered attribution "1,2"; subject PENDING at t_d', () => {
  const tr = [
    { f: 0, k: 'FIT', r: 1, pq: P(0), pd: { ...P(1, 1), nw: 1 }, ac: 0, cl: 0, xc: 0 },
    { f: 0, k: 'AE', ev: 1 },
    { f: 1, k: 'CAM', cl: 1, xc: 1, pd: P(0), ac: 1 },
    { f: 1, k: 'FIT', r: 2, pq: P(0), pd: { ...P(1, 2), nw: 1 }, ac: 1, cl: 1, xc: 1 },
    { f: 1, k: 'SST', s: 'S', r: 2 },
    { f: 2, k: 'AE', ev: 0 }, { f: 2, k: 'TC' },
    { f: 2, k: 'CAM', cl: 2, xc: 2, pd: P(1, 2), ac: 0 },
    { f: 2, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 2, xc: 2, pd: P(1, 2), ac: 0 },
    { f: 3, k: 'CAM', cl: 2, xc: 2, pd: P(1, 2), ac: 0 },
    { f: 3, k: 'SMP', s: 'S', n: 2, d: 'settled', fr: 1, cl: 2, xc: 2, pd: P(1, 2), ac: 0 },
    { f: 3, k: 'AE', ev: 1 },
    { f: 4, k: 'CAM', cl: 3, xc: 3, pd: P(0), ac: 1 },
    { f: 5, k: 'AE', ev: 0 }, { f: 5, k: 'TC' },
  ];
  const out = correlate(tr, VB_ON_ASSUME);
  assert.deepEqual(q(out, 'Q-SUBJ'), { status: 'DEFINITE', label: 'PENDING' }, 'a direct bound read: no assumption needed');
  assert.deepEqual(q(out, 'Q-OWNER'), { status: 'DEFINITE', label: 'PRIOR_TERMINAL', assumption: ASSUMED });
  assert.deepEqual(q(out, 'Q-ATTR'), { status: 'DEFINITE', label: '1,2', assumption: ASSUMED });
  const open = correlate(tr, VB_ON);
  assert.deepEqual(q(open, 'Q-SUBJ'), { status: 'DEFINITE', label: 'PENDING' }, 'PENDING survives the OPEN window');
  assert.deepEqual(q(open, 'Q-OWNER'), { status: 'AMBIGUOUS', reason: 'UNOBSERVED_SLOT_WINDOW' });
  assert.deepEqual(q(open, 'Q-ATTR'), { status: 'AMBIGUOUS', reason: 'UNOBSERVED_SLOT_WINDOW' });
  // the same trace without identity (ID-OFF encoding): attribution and the OWN/PRIOR split are not available
  const off = correlate(tr.map((e) => {
    const o = { ...e }; delete o.r;
    for (const k of ['pd', 'pq']) if (o[k]) { const { b, ...rest } = o[k]; o[k] = { ...rest, ch: 0 }; }
    return o;
  }), VB_OFF);
  assert.equal(q(off, 'Q-SUBJ').status, 'UNAVAILABLE');
  assert.notEqual(q(off, 'Q-ATTR').status, 'DEFINITE');
  assert.notEqual(q(off, 'Q-OWNER').status, 'DEFINITE');
});

test('active transition with no visible step since its true edge => owner AMBIGUOUS (R5 ACTIVE0 vs zero-change step)', () => {
  const tr = [
    { f: 0, k: 'FIT', r: 1, pq: P(0), pd: { ...P(1, 1), nw: 1 }, ac: 0, cl: 0, xc: 0 },
    { f: 0, k: 'SST', s: 'S', r: 1 },
    { f: 0, k: 'AE', ev: 1 },
    { f: 1, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 0, xc: 0, pd: P(0), ac: 1 },
    { f: 2, k: 'SMP', s: 'S', n: 2, d: 'settled', fr: 1, cl: 0, xc: 0, pd: P(0), ac: 1 },
  ];
  const out = correlate(tr, VB_ON_ASSUME);
  assert.deepEqual(q(out, 'Q-OWNER'), { status: 'AMBIGUOUS', reason: 'ACTIVE_WITHOUT_VISIBLE_STEP' });
  assert.deepEqual(q(out, 'Q-SUBJ'), { status: 'AMBIGUOUS', reason: 'ACTIVE_WITHOUT_VISIBLE_STEP' });
  assert.equal(q(correlate(tr, VB_ON), 'Q-SUBJ').status, 'AMBIGUOUS');
});

test('restore interaction (R6): OK while outstanding, then overwritten by a later step; a true return is never a witness', () => {
  const head = [
    { f: 0, k: 'FIT', r: 1, pq: P(0), pd: { ...P(1, 1), nw: 1 }, ac: 0, cl: 0, xc: 0 },
    { f: 0, k: 'AE', ev: 1 },
    { f: 1, k: 'CAM', cl: 1, xc: 1, pd: P(0), ac: 1 },
    { f: 1, k: 'RST', rs: 'OK', cl: 0, xc: 0, pd: P(0), ac: 1 }, // restore lands while request 1 is active
    { f: 1, k: 'SST', s: 'S', r: 1 },
  ];
  const restoredWins = correlate([...head,
    { f: 1, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 0, xc: 0, pd: P(0), ac: 1 },
    { f: 2, k: 'SMP', s: 'S', n: 2, d: 'settled', fr: 1, cl: 0, xc: 0, pd: P(0), ac: 1 }], VB_ON);
  // restore pose observed with a transition still active and no later visible step => not provable either way
  assert.equal(q(restoredWins, 'Q-OWNER').status, 'AMBIGUOUS');
  const overwritten = correlate([...head,
    { f: 2, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 2, xc: 2, pd: P(0), ac: 1 },
    { f: 3, k: 'SMP', s: 'S', n: 2, d: 'settled', fr: 1, cl: 2, xc: 2, pd: P(0), ac: 1 }], VB_ON_ASSUME);
  assert.deepEqual(q(overwritten, 'Q-OWNER'), { status: 'DEFINITE', label: 'IN_FLIGHT', assumption: ASSUMED });
  const idle = correlate([
    { f: 0, k: 'FIT', r: 1, pq: P(0), pd: { ...P(1, 1), nw: 1 }, ac: 0, cl: 0, xc: 0 },
    { f: 0, k: 'AE', ev: 1 }, { f: 1, k: 'CAM', cl: 1, xc: 1, pd: P(0), ac: 1 },
    { f: 2, k: 'AE', ev: 0 }, { f: 2, k: 'TC' }, { f: 2, k: 'CAM', cl: 2, xc: 2, pd: P(0), ac: 0 },
    { f: 3, k: 'RST', rs: 'OK', cl: 0, xc: 0, pd: P(0), ac: 0 },
    { f: 3, k: 'SST', s: 'S', r: 1 },
    { f: 4, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 0, xc: 0, pd: P(0), ac: 0 },
    { f: 5, k: 'SMP', s: 'S', n: 2, d: 'settled', fr: 1, cl: 0, xc: 0, pd: P(0), ac: 0 }], VB_ON);
  assert.deepEqual(q(idle, 'Q-OWNER'), { status: 'DEFINITE', label: 'RESTORE' });
});

test('T4 sample correlation (R7) and C8/frustum timing (R8): fr binds to the deciding sample only', () => {
  const out = correlate(ownedTrace(), VB_ON);
  assert.equal(out.t4.samples.length, 4);
  assert.ok(out.t4.samples.every((s) => s.s === 'S' && s.r === 1));
  assert.deepEqual(out.t4.deciding, { s: 'S', n: 4, d: 'settled', position: 14, f: 3, r: 1, frustumOnThisSample: true });
  const early = ownedTrace(); early[7] = { ...early[7], fr: 1 };
  assert.ok(correlate(early, VB_ON).malformed, 'fr on a non-deciding sample is a schema violation (MALFORMED)');
  const gate = ownedTrace(); gate.splice(1, 0, { f: 0, k: 'SST', s: 'G', r: 1 }, { f: 0, k: 'SMP', s: 'G', n: 1, d: 'timeout', fr: 1, cl: 0, xc: 0, pd: P(1, 1), ac: 0 });
  assert.equal(correlate(gate, VB_ON).contradiction, 'CONTRADICTION:FR', 'fr on a deciding sample of a non-subject settle');
  const none = ownedTrace(); delete none[14].fr;
  assert.equal(correlate(none, VB_ON).contradiction, 'CONTRADICTION:FR');
});

test('contradictory ordering (C3) => whole trace UNDIAGNOSABLE', () => {
  const cases = {
    ORDER_F: (t) => { t[7] = { ...t[7], f: 0 }; }, // f decreases (t[6] is at f=1); a negative f is MALFORMED instead
    FALSE_EDGE_WITHOUT_TRUE: (t) => { t.splice(4, 1); },
    EDGE_REPEAT: (t) => { t.splice(5, 0, { f: 0, k: 'AE', ev: 1 }); },
    TRUE_EDGE_EMPTY_SLOT: (t) => { t[2] = { ...t[2], pd: P(0) }; t[3] = { ...t[3], pd: P(0) }; }, // assumption mode only
    TC_WITHOUT_ACTIVE: (t) => { t.splice(12, 0, { f: 2, k: 'TC' }); },
    SETTLED_ON_FIRST_SAMPLE: (t) => { t[3] = { ...t[3], d: 'settled' }; },
    SMP_AFTER_DECISION: (t) => { t.push({ f: 4, k: 'SMP', s: 'S', n: 5, d: 'none', cl: 2, xc: 2, pd: P(0), ac: 0 }); },
  };
  for (const [rule, mut] of Object.entries(cases)) {
    const t = ownedTrace(); mut(t);
    const out = correlate(t, rule === 'TRUE_EDGE_EMPTY_SLOT' ? VB_ON_ASSUME : VB_ON);
    assert.equal(out.contradiction, `CONTRADICTION:${rule}`, rule);
    for (const id of ['Q-OWNER', 'Q-SUBJ', 'Q-ATTR']) assert.equal(q(out, id).status, 'UNDIAGNOSABLE');
  }
  assert.equal(findContradiction(ownedTrace(), VB_ON), null);
  assert.equal(findContradiction([{ f: 0, k: 'TCK', tm: 5 }, { f: 0, k: 'TCK', tm: 4 }], VB_ON).contradiction, 'CONTRADICTION:ORDER_TM');
  assert.equal(findContradiction([{ f: 0, k: 'TCK', tm: 5 }, { f: 0, k: 'TCK', tm: 5 }], VB_ON), null, 'equal tm allowed');
});

test('R2 no-op rebinding: post-call slot object == pre-call object => NO_REQUEST_OR_UNRESOLVED, never rebound', () => {
  // correlator level (projected encoding)
  const tr = [
    { f: 0, k: 'FIT', r: 1, pq: P(0), pd: { ...P(1, 1), nw: 1 }, ac: 0, cl: 0, xc: 0 },
    { f: 0, k: 'FIT', r: 2, pq: P(1, 1), pd: { ...P(1, 1), nw: 0 }, ac: 0, cl: 0, xc: 0 },
    { f: 0, k: 'SST', s: 'S', r: 2 },
    { f: 0, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 0, xc: 0, pd: P(1, 1), ac: 0 },
    { f: 1, k: 'SMP', s: 'S', n: 2, d: 'settled', fr: 1, cl: 0, xc: 0, pd: P(1, 1), ac: 0 },
  ];
  const out = correlate(tr, VB_ON);
  assert.deepEqual(out.fits, { 1: 'REQUEST_BOUND', 2: 'NO_REQUEST_OR_UNRESOLVED' });
  assert.equal(out.S_d.slotTok, 1, 'the slot keeps its previous binding');
  assert.notEqual(q(out, 'Q-SUBJ').label, 'PENDING');
  // projection level (ground-truth handles): the same object after fit 2 keeps b = 1 and nw = 0
  const cam = Array(32).fill(0);
  const gt = [
    { k: 'FIT', f: 0, r: 1, pre: { h: 0 }, post: { h: 7 }, cam, ac: 0, ow: 'INIT' },
    { k: 'FIT', f: 0, r: 2, pre: { h: 7 }, post: { h: 7 }, cam, ac: 0, ow: 'INIT' },
    { k: 'CAM', f: 0, post: { h: 7 }, cam, ac: 0, ow: 'INIT' },
  ];
  const p = project(gt, VB_ON.atoms, 'ON', () => true);
  assert.deepEqual(p[1].pd, { p: 1, b: 1, nw: 0 });
  assert.deepEqual(p[2].pd, { p: 1, b: 1 });
  const foreign = project([{ k: 'CAM', f: 0, post: { h: 9 }, cam, ac: 0, ow: 'INIT' }], VB_ON.atoms, 'ON', () => true);
  assert.deepEqual(foreign[0].pd, { p: 1, b: 'U' }, 'a slot object no harness call bound reads as "U"');
});

test('OPEN mode closes the other unobservable windows (Codex follow-up to H-2): INIT baseline, unread restore, empty-slot edge', () => {
  // INIT without a capture-start camera read: an unobserved writer before the first read cannot be excluded
  const initTr = [
    { f: 0, k: 'SST', s: 'S', r: 1 },
    { f: 0, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 0, xc: 0, pd: P(0), ac: 0 },
    { f: 1, k: 'SMP', s: 'S', n: 2, d: 'settled', fr: 1, cl: 0, xc: 0, pd: P(0), ac: 0 },
  ];
  const noR = (tr) => tr.map((e) => (e.k === 'SST' ? { f: e.f, k: 'SST', s: e.s, r: 1 } : e));
  assert.deepEqual(q(correlate(noR(initTr), VB_ON), 'Q-OWNER'), { status: 'AMBIGUOUS', reason: 'NO_CAPTURE_BASELINE' });
  assert.deepEqual(q(correlate(noR(initTr), VB_ON_ASSUME), 'Q-OWNER'), { status: 'DEFINITE', label: 'INIT', assumption: ASSUMED });
  const anchored = [{ f: 0, k: 'CAM', cl: 0, xc: 0, pd: P(0), ac: 0 }, ...noR(initTr)];
  assert.deepEqual(q(correlate(anchored, VB_ON), 'Q-OWNER'), { status: 'DEFINITE', label: 'INIT' }, 'capture-start CAM anchors INIT');
  // a restore without its own read (no P-FRM) whose change is first seen at a later read
  const atoms = VB_ON.atoms.filter((a) => a !== 'P-FRM' && a !== 'P-XS');
  const unread = [
    { f: 0, k: 'SST', s: 'S', r: 1 },
    { f: 0, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 0, pd: P(0), ac: 0 },
    { f: 1, k: 'RST', rs: 'OK', pd: P(0), ac: 0 },
    { f: 2, k: 'SMP', s: 'S', n: 2, d: 'none', cl: 1, pd: P(0), ac: 0 },
    { f: 3, k: 'SMP', s: 'S', n: 3, d: 'settled', fr: 1, cl: 1, pd: P(0), ac: 0 },
  ];
  assert.deepEqual(q(correlate(unread, { atoms, idAxis: 'ON' }), 'Q-OWNER'), { status: 'AMBIGUOUS', reason: 'UNREAD_WRITER' });
  assert.deepEqual(q(correlate(unread, { atoms, idAxis: 'ON', slotWindow: SLOT_WINDOW.ASSUME }), 'Q-OWNER'), { status: 'DEFINITE', label: 'RESTORE', assumption: ASSUMED });
  // a true edge after an empty visible slot: contradiction only under the assumption; OPEN => DH-6a evidence
  const t = ownedTrace(); t[2] = { ...t[2], pd: P(0) }; t[3] = { ...t[3], pd: P(0) };
  const open = correlate(t, VB_ON);
  assert.equal(open.contradiction, null);
  assert.equal(open.S_d.foreign, true);
  for (const id of ['Q-OWNER', 'Q-SUBJ', 'Q-ATTR']) assert.equal(q(open, id).status, 'AMBIGUOUS', id);
  assert.equal(correlate(t, VB_ON_ASSUME).contradiction, 'CONTRADICTION:TRUE_EDGE_EMPTY_SLOT');
});

test('§6 re-review fixes: hostile values never throw (R-M1), delayed first CAM (R-M2), unread restore without change (R-M3)', async () => {
  const { validateEvent } = await import('./schema.mjs');
  const hostile = JSON.parse('{"f":0,"k":{"toString":null,"valueOf":null}}');
  assert.doesNotThrow(() => validateEvent(hostile));
  assert.ok(validateEvent(hostile).length > 0);
  assert.doesNotThrow(() => validateEvent({ f: 0, k: 'TCK' }, { mode: hostile.k }));
  assert.deepEqual(validateEvent({ f: 0, k: 'TCK' }, { mode: hostile.k }), ['unknown mode']);
  let out;
  assert.doesNotThrow(() => { out = correlate([hostile], { atoms: [], idAxis: 'ON' }); });
  assert.equal(out.questions['Q-OWNER'].reason, 'MALFORMED');
  assert.doesNotThrow(() => { out = correlate(ownedTrace(), { ...VB_ON, mode: hostile.k }); });
  assert.equal(out.malformed, 'cfg.mode');
  const trap = new Proxy([], { get() { throw new Error('trap'); } });
  assert.doesNotThrow(() => { out = correlate(trap, VB_ON); });
  assert.equal(out.questions['Q-SUBJ'].status, 'UNDIAGNOSABLE');
  // R-M2: a first CAM that is not at the frame origin anchors nothing
  const tail = [
    { f: 10, k: 'SST', s: 'S', r: 1 },
    { f: 10, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 0, xc: 0, pd: P(0), ac: 0 },
    { f: 11, k: 'SMP', s: 'S', n: 2, d: 'settled', fr: 1, cl: 0, xc: 0, pd: P(0), ac: 0 },
  ];
  const late = [{ f: 10, k: 'CAM', cl: 0, xc: 0, pd: P(0), ac: 0 }, ...tail];
  assert.deepEqual(q(correlate(late, VB_ON), 'Q-OWNER'), { status: 'AMBIGUOUS', reason: 'NO_CAPTURE_BASELINE' });
  const origin = [{ f: 0, k: 'CAM', cl: 0, xc: 0, pd: P(0), ac: 0 }, ...tail];
  assert.deepEqual(q(correlate(origin, VB_ON), 'Q-OWNER'), { status: 'DEFINITE', label: 'INIT' });
  // live: the baseline CAM must also be at tm = 0
  const live = (tm0) => origin.map((e, i) => ({ ...e, q: i + 1, tm: i === 0 ? tm0 : 5 + i })); // q: live sequence (whole-trace integrity)
  assert.deepEqual(q(correlate(live(0), { ...VB_ON, mode: 'live' }), 'Q-OWNER'), { status: 'DEFINITE', label: 'INIT' });
  assert.deepEqual(q(correlate(live(3), { ...VB_ON, mode: 'live' }), 'Q-OWNER'), { status: 'AMBIGUOUS', reason: 'NO_CAPTURE_BASELINE' });
  // R-M3: unread restore, later value UNCHANGED (the restore pose may have been undone by an unobserved writer)
  const atoms = ['V-EDGE', 'P-TC'];
  const unchanged = [
    { f: 0, k: 'SST', s: 'S', r: 1 },
    { f: 0, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 5 },
    { f: 1, k: 'RST', rs: 'OK' },
    { f: 2, k: 'SMP', s: 'S', n: 2, d: 'settled', fr: 1, cl: 5 },
  ];
  assert.deepEqual(q(correlate(unchanged, { atoms, idAxis: 'ON' }), 'Q-OWNER'), { status: 'AMBIGUOUS', reason: 'UNREAD_WRITER' });
  assert.deepEqual(q(correlate(unchanged, { atoms, idAxis: 'ON', slotWindow: SLOT_WINDOW.ASSUME }), 'Q-OWNER'), { status: 'DEFINITE', label: 'RESTORE', assumption: ASSUMED });
});
