// Deterministic generator of SYNTHETIC future-live schema-2 traces and run scenarios (prompt §19; Part 2 §11.3
// control matrix; Part 1 golden-fixture list). [SYN] offline research prototype only. Every trace is produced by the
// offline reference Recorder from a hand-written script, then (for negative fixtures) mutated post hoc. Nothing here
// is, or may be presented as, a real Viewer observation, a real authorization record or real evidence: every
// authorization/attempt/harness/package digest below is a SYNTHETIC placeholder derived from a fixed label.
//
// CLI:  node fixtures-gen.mjs --write   (writes ../fixtures/ atomically; refuses a non-empty existing directory)
//       node fixtures-gen.mjs --check   (byte-compares ../fixtures/ against a fresh in-memory generation)
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from './contract-loader.mjs';
import { Page, Recorder, RecorderRefused, toJsonl, canonicalStringify, canonicalBytes, sha256, reseal } from './envelope.mjs';
import { capsV2 } from './trace-schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = resolve(HERE, '..', 'fixtures');
const sha = (s) => sha256(Buffer.from(s, 'utf8'));
const json = (v) => canonicalStringify(v); // canonical, no trailing newline
const DS_SHA256 = '385993ba1b5bdb30687ab3235c01f651bca5be2690e5ccdfa6fecd9ed7be594e'; // committed instrumentation spec (Part 2 header)

// ---------------------------------------------------------------- synthetic plans and bindings

const FIT = { op: 'fit' }; const RESTORE = { op: 'restore' };
const SETTLE = (role) => ({ op: 'settle', role }); const C8 = (role) => ({ op: 'c8', role });
const TARGETS_SUBJ = [
  { targetId: 'T-SUBJ-PENDING', questionId: 'Q-SUBJ', primary: true, supportLabels: ['PENDING'], rejectLabels: [] },
  { targetId: 'T-OWNER-RESTORE', questionId: 'Q-OWNER', primary: false, supportLabels: ['RESTORE'], rejectLabels: ['INIT'] },
];
const TARGETS_OWNER = [{ targetId: 'T-OWNER-RESTORE', questionId: 'Q-OWNER', primary: true, supportLabels: ['RESTORE'], rejectLabels: ['INIT'] }];

/** Synthetic pre-registered plans (Part 2 §14.2, Appendix (ii) targetPlanSchema): structured steps + targets. */
export const TARGET_PLANS = Object.freeze({
  a: { planId: 'synthetic-plan-a', steps: [FIT, SETTLE('G'), FIT, SETTLE('S'), C8('subject')], targets: TARGETS_SUBJ }, // minimal G/S pair
  b: { planId: 'synthetic-plan-b', steps: [FIT, RESTORE, SETTLE('S'), C8('subject')], targets: TARGETS_OWNER }, // restore-or-init owner probe
  c: { planId: 'synthetic-plan-c', steps: [FIT, SETTLE('S'), C8('subject'), FIT], targets: TARGETS_OWNER }, // init probe, trailing witness fit
  d: { planId: 'synthetic-plan-d', steps: [FIT, SETTLE('G'), FIT, SETTLE('S'), C8('subject'), FIT, SETTLE('P'), C8('superseded')], targets: TARGETS_SUBJ }, // G/S + superseded P
  f: { planId: 'synthetic-plan-f', steps: [FIT, SETTLE('S'), C8('subject'), FIT], targets: TARGETS_SUBJ }, // subject probe, trailing witness fit
  e: { planId: 'synthetic-plan-e', steps: [RESTORE, FIT, SETTLE('G'), FIT, SETTLE('G'), FIT, SETTLE('S'), C8('subject'), FIT, SETTLE('P'), C8('superseded')], targets: TARGETS_SUBJ }, // historical P6 shape
});
/** A post-hoc edit of plan c (labels swapped) that is NOT the bound plan: its digest differs from META.tq / the binding. */
export const UNBOUND_PLAN_C_LABEL_SWAP = Object.freeze({ ...TARGET_PLANS.c, targets: [{ ...TARGETS_OWNER[0], supportLabels: ['INIT'], rejectLabels: ['RESTORE'] }] });

export function bindingFor(contract, planKey) {
  const pin = contract.part1.viewerPin;
  return {
    attemptId: '00000000-0000-4000-8000-000000000000', // synthetic placeholder, never a real attempt
    atoms: ['P-FRM', 'P-TC', 'V-PEND', 'V-EDGE'],
    authorizationId: 'synthetic-fixture-not-an-authorization',
    authorizationRecordSha256: sha('SYNTHETIC FIXTURE PLACEHOLDER - NOT AN AUTHORIZATION RECORD'),
    caps: capsV2(contract),
    diagnosticHarnessSha256: sha('SYNTHETIC FIXTURE PLACEHOLDER - no diagnostic harness exists'),
    diagnosticPackageSha256: sha('SYNTHETIC FIXTURE PLACEHOLDER - diagnostic package manifest'),
    diagnosticSpecSha256: DS_SHA256,
    idAxis: 'ON',
    procedureSha256: contract.authBinding.fields.find((f) => f.name === 'procedureSha256').requiredValue,
    slotWindow: 'OPEN',
    targetPlanSha256: sha256(canonicalBytes(TARGET_PLANS[planKey])),
    viewerBundleSha256: pin.bundleSha256,
    viewerVersion: pin.version,
  };
}

export function metaTemplate(contract, binding, { role, run, over = {} }) {
  const pin = contract.part1.viewerPin;
  return {
    ad: binding.attemptId, ah: binding.authorizationRecordSha256, ai: binding.authorizationId, at: [...binding.atoms],
    br: 'synthetic 0', cp: { ...binding.caps }, cs: 1, ec: { max: contract.envelope.caps.dataEvents, min: 0 }, f: 0,
    hh: binding.diagnosticHarnessSha256, id: binding.idAxis, k: 'META', ph: binding.procedureSha256, pk: binding.diagnosticPackageSha256,
    q0: 1, rc: 1, rl: role, rr: 60, run, sh: binding.diagnosticSpecSha256, sv: 2, sw: binding.slotWindow, tm: 0,
    tq: binding.targetPlanSha256, vb: { 'VB-1': 1, 'VB-2': 1, 'VB-3': 1 }, vd: pin.bundleSha256, vg: 1, vv: pin.version, ...over,
  };
}

// ---------------------------------------------------------------- script DSL over the reference recorder

export const camDigest = (cl) => sha(`synthetic-camera-class:${cl}`).slice(0, 16);
const NV_OF = (cl) => { const b = Buffer.alloc(256); for (let i = 0; i < 32; i += 1) b.writeDoubleLE(cl + i / 64, i * 8); return b.toString('base64'); };

export class Script {
  constructor(contract, template, { page = new Page(), boundary = {}, quiescenceEdges = 0 } = {}) {
    this.rec = new Recorder(page, template, { contract });
    for (let i = 0; i < quiescenceEdges; i += 1) this.rec.quiescenceEdge();
    this.frameNo = 0; this.sub = 0; this.cam = 0;
    this.slot = null; this.nextObj = 1; this.binding = new Map(); this.prevObj = null;
    this.nextTok = 1; this.settle = null;
    this.rec.start({ ...boundary, fsFields: { cl: 0, dg: camDigest(0) } });
    this.sub = 1;
    this.add({ k: 'PS', hq: 1, rd: 'frame', ...this.read() });
  }
  tm() { const t = this.frameNo * 167 + this.sub; this.sub += 1; return t; }
  add(r) { return this.rec.append({ f: this.frameNo, tm: this.tm(), ...r }); }
  read() {
    const obj = this.slot; const prev = this.prevObj;
    const sx = prev === null ? (obj === null ? 'none' : 'appear') : obj === null ? 'clear' : obj === prev ? 'none' : 'replace';
    this.prevObj = obj;
    return obj === null ? { sp: 0, sx } : { sb: this.binding.get(obj), sp: 1, sx };
  }
  frame(cl) {
    this.frameNo += 1; this.sub = 0;
    if (cl !== undefined) this.cam = cl;
    const fs = this.add({ k: 'FS', cl: this.cam, dg: camDigest(this.cam) });
    if (fs) this.add({ k: 'PS', hq: fs.q, rd: 'frame', ...this.read() });
    return fs;
  }
  frames(...cls) { for (const c of cls) this.frame(c); }
  write(token) { const o = this.nextObj; this.nextObj += 1; this.slot = o; this.binding.set(o, token); return o; }
  /** A harness fitToView through the tag wrapper (CP01/CP02). */
  fit({ request = true, threw = false, nested = null } = {}) {
    const tok = this.nextTok; this.nextTok += 1;
    const preObj = this.slot;
    const pre = this.add({ k: 'RQ', pp: 'pre', r: tok, ...this.read() });
    if (nested) nested(this);
    const adjacent = this.rec.data[this.rec.data.length - 1] === pre;
    if (threw) { this.add({ k: 'RQ', pp: 'post', r: tok, co: 'threw' }); return tok; }
    if (request) this.write(adjacent ? tok : 'U');
    const nw = this.slot !== preObj ? 1 : 0;
    this.add({ k: 'RQ', pp: 'post', r: tok, co: 'returned', ...this.read(), nw, cl: this.cam, dg: camDigest(this.cam) });
    return tok;
  }
  foreignWrite() { this.write('U'); }
  clearSlot() { this.slot = null; }
  /** Consumption: the slot clear (V:105009) and the rise (V:107122) in one synchronous stack. */
  consume() { this.slot = null; this.edge(1); }
  edge(v) { this.add({ k: 'TE', ev: v, pa: v }); }
  fall() { this.edge(0); this.add({ k: 'TC' }); }
  settleStart(s, r) { this.settle = { s, n: 0, lastQ: null, terminal: null }; this.add({ k: 'T4', tp: 'start', s, r }); }
  sample({ nv = false } = {}) {
    const st = this.settle; st.n += 1;
    const smp = this.add({ k: 'T4', tp: 'sample', s: st.s, n: st.n, cl: this.cam, dg: camDigest(this.cam) });
    if (!smp) return null;
    if (nv) this.add({ k: 'NV', nv: NV_OF(this.cam) });
    this.add({ k: 'PS', hq: smp.q, rd: 't4Sample', ...this.read() });
    st.lastQ = smp.q;
    return smp;
  }
  /** One settle frame: FS(+PS), T4 sample(+PS), comparison decision (none unless `d` given). */
  settleFrame(cl, { d = null, fr = false, nv = false } = {}) {
    this.frame(cl); this.sample({ nv });
    if (d) this.decide(d, { fr });
  }
  decide(d, { fr = false } = {}) {
    const st = this.settle;
    const r = { k: 'T4', tp: 'decision', s: st.s, n: st.n, d };
    if (st.n >= 1) r.ss = st.lastQ;
    if (d !== 'none') r.te = 1;
    if (fr) r.fr = 1;
    const out = this.add(r);
    if (d !== 'none') st.terminal = { ...r, q: out ? out.q : null, lastQ: st.lastQ };
    return out;
  }
  restore(rs, cl) {
    this.add({ k: 'RS', pp: 'pre' });
    if (rs === 'THROW') { this.add({ k: 'RS', pp: 'post', rs }); return; }
    if (rs === 'OK' && cl !== undefined) this.cam = cl;
    this.add({ k: 'RS', pp: 'post', rs, cl: this.cam, dg: camDigest(this.cam), ...this.read() });
  }
  c8(mr, { ss, dg, el = 1, inside = 1 } = {}) {
    const st = this.settle;
    const q = ss ?? st.terminal.lastQ;
    const host = this.rec.data.find((r) => r.q === q);
    this.add({ k: 'C8', ss: q, dg: dg ?? (host ? host.dg : camDigest(0)), mr, tk: 'synthetic-target-0', el, in: inside });
  }
  tz(zp, zc = 'normal') { this.add({ k: 'TZ', zp, zc }); }
  ct(ci, cr, fu, fb) { this.add({ k: 'CT', ci, cr, fu, fb }); }
  /** Target-trace control window with the post-capture PC-3 (Part 2 §11.2). */
  pc3({ outcome = 'PASSED' } = {}) {
    const f0 = this.frameNo;
    this.tz('targetEnd');
    this.frame(); this.fit(); this.frame(); this.consume(); this.frame(this.cam + 100); this.fall(); this.frame();
    this.ct('PC-3', outcome, this.frameNo - f0, 120);
    this.tz('final');
  }
  close(opts = {}) { return this.rec.close(opts); }
}

// ---------------------------------------------------------------- record-level mutation helpers (negative fixtures)

const clone = (v) => JSON.parse(JSON.stringify(v));
/** Removes data record at data index i, renumbers q and every seq reference (hq, ss), then reseals END. */
export function removeData(records, i) {
  const recs = clone(records);
  const data = recs.slice(1, -1);
  const gone = data[i].q;
  data.splice(i, 1);
  const fix = (v) => (v > gone ? v - 1 : v);
  for (const d of data) { d.q = fix(d.q); if (Number.isInteger(d.hq)) d.hq = fix(d.hq); if (Number.isInteger(d.ss)) d.ss = fix(d.ss); }
  const end = recs[recs.length - 1];
  if (Number.isInteger(end.zt)) end.zt = fix(end.zt);
  return reseal([recs[0], ...data, end]);
}
const mutateData = (records, pred, fn, { resealIt = true } = {}) => {
  const recs = clone(records);
  const d = recs.slice(1, -1).find(pred);
  fn(d);
  return resealIt ? reseal(recs) : recs;
};
const lastIdx = (data, pred) => { for (let i = data.length - 1; i >= 0; i -= 1) if (pred(data[i])) return i; return -1; };

// ---------------------------------------------------------------- scripts

const SUBJ = (s, opts = {}) => { // subject fit + S settle that decides while the request is still pending
  const k = s.fit();
  s.settleStart('S', k);
  s.settleFrame(s.cam, { nv: opts.nv });
  s.settleFrame(s.cam, { d: 'settled', fr: true, nv: opts.nvDeciding });
  s.c8('subject');
  return k;
};
const GATE = (s) => { // fit N-1, its transition, then a G settle
  const k = s.fit(); s.frame(); s.consume(); s.frames(s.cam + 1, s.cam + 2); s.fall(); s.frame();
  s.settleStart('G', k); s.settleFrame(s.cam, { nv: true }); s.settleFrame(s.cam, { d: 'settled', nv: true });
  return k;
};
const TAIL = (s) => { s.frame(); s.consume(); s.frames(s.cam + 1, s.cam + 2); s.fall(); s.frame(); };

export function scriptValid(contract, tpl, opts = {}) {
  const s = new Script(contract, tpl, opts);
  s.frame(); GATE(s); s.frame(); SUBJ(s, opts); TAIL(s); s.pc3(opts.pc3);
  return s;
}

function controlTrace(contract, binding, id, run) {
  const role = id === 'PC-1-FAILED' ? 'PC-1' : id;
  const s = new Script(contract, metaTemplate(contract, binding, { role, run: `${run}-${role.toLowerCase().replace('-', '')}` }));
  const f0 = s.frameNo;
  const transition = () => { s.frame(); s.consume(); s.frames(s.cam + 1, s.cam + 2); s.fall(); s.frame(); };
  if (id === 'PC-1' || id === 'PC-1-FAILED') {
    s.frame(); s.fit();
    if (id === 'PC-1') transition(); else { s.frame(); s.consume(); s.frames(s.cam + 1, s.cam + 2); s.frame(); } // no fall: control fails
  } else if (id === 'PC-2') {
    s.frame(); s.fit(); transition(); s.frames(s.cam, s.cam); s.fit(); transition();
    s.settleStart('S', 2); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled', fr: true });
  } else if (id === 'PC-4') {
    s.frame(); const k1 = s.fit(); s.settleStart('S', k1); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled', fr: true }); s.c8('subject');
    s.frame(); const k2 = s.fit(); s.settleStart('P', k2); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled' }); s.c8('superseded');
    transition();
  } else if (id === 'PC-5') {
    s.frame(); s.fit(); transition(); s.frames(s.cam, s.cam); s.restore('OK', 0);
    s.settleStart('S', 1); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled', fr: true });
  }
  s.tz('targetEnd');
  const ctId = id === 'PC-1-FAILED' ? 'PC-1' : id;
  s.ct(ctId, id === 'PC-1-FAILED' ? 'FAILED' : 'PASSED', s.frameNo - f0, 50);
  s.tz('final');
  return s.close({ pc: { 'VB-3': 0 } });
}

// ---------------------------------------------------------------- scenario catalogue

/**
 * Builds every scenario. Returns [{ id, title, promptItems, ncRefs, planKey, attemptConsumed, stop, target (records |
 * null | {raw: string}), controls: 'std' | 'pc1-failed' | 'none', expected: {runVerdict, integrityCodes?, reasonsInclude?},
 * ambiguous }].
 */
export function buildScenarios(contract) {
  const B = Object.fromEntries(Object.keys(TARGET_PLANS).map((k) => [k, bindingFor(contract, k)]));
  const T = (planKey = 'a', over = {}) => metaTemplate(contract, B[planKey], { role: 'T', run: `syn-${planKey}`, over });
  const valid = () => scriptValid(contract, T()).close({ pc: { 'VB-3': 1 } });
  const S = [];
  const add = (id, title, o) => S.push({ id, title, promptItems: [], ncRefs: [], planKey: 'a', attemptConsumed: true, stop: null, controls: 'std', ambiguous: o.expected.runVerdict !== 'SUPPORTED' && o.expected.runVerdict !== 'REJECTED', ...o });

  // --- positive paths
  add('valid-complete', 'valid complete trace: subject decision while its request is still pending (Q-SUBJ = PENDING)', { promptItems: ['valid complete trace'], target: valid(), expected: { runVerdict: 'SUPPORTED' } });
  const ownerRestore = () => { const s = new Script(contract, T('b')); s.frame(); const k = s.fit(); s.frame(); s.consume(); s.frames(1, 2); s.fall(); s.frame(); s.restore('OK', 0); s.settleStart('S', k); s.settleFrame(0); s.settleFrame(0, { d: 'settled', fr: true }); s.c8('subject'); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); };
  add('valid-owner-restore', 'valid trace: deciding sample shows the restore pose (Q-OWNER = RESTORE)', {
    planKey: 'b', expected: { runVerdict: 'SUPPORTED' },
    target: ownerRestore(),
  });
  const rejectedInit = () => { const s = new Script(contract, T('c')); s.frame(); const k = s.fit({ request: false }); s.settleStart('S', k); s.settleFrame(0); s.settleFrame(0, { d: 'settled', fr: true }); s.c8('subject'); s.frame(); s.fit(); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); };
  add('valid-rejected-init', 'valid trace: deciding sample shows the initial pose (Q-OWNER = INIT, pre-registered reject)', {
    planKey: 'c', expected: { runVerdict: 'REJECTED' }, target: rejectedInit(),
  });
  // H-1: the evaluated plan is a post-hoc label swap of the bound plan c (META.tq and the binding still name plan c)
  add('target-plan-digest-mismatch', 'evaluated target plan differs from the bound plan (labels swapped after capture): never SUPPORTED/REJECTED', {
    planKey: 'c', targetPlanFile: 'shared/target-plan-c-label-swap.json', target: rejectedInit(),
    expected: { runVerdict: 'INVALID', reasonsInclude: ['TARGET_PLAN_DIGEST_MISMATCH'] },
  });

  // --- wrong Viewer version / digest (NC-1, NC-2)
  const metaVariant = (over) => scriptValid(contract, T('a', over)).close({ pc: { 'VB-3': 1 } });
  add('wrong-viewer-version', 'wrong Viewer version, honest META (vg = 0, vb all 0)', { promptItems: ['wrong Viewer version'], ncRefs: ['NC-1a'], target: metaVariant({ vv: '7.124.1', vg: 0, vb: { 'VB-1': 0, 'VB-2': 0, 'VB-3': 0 } }), expected: { runVerdict: 'INVALID', integrityCodes: ['OBSERVED_VIEWER_NOT_BOUND'] } });
  add('wrong-viewer-version-claims-vb0', 'wrong Viewer version while claiming VB-0', { promptItems: ['wrong Viewer version'], ncRefs: ['NC-1b'], target: metaVariant({ vv: '7.125.0' }), expected: { runVerdict: 'INVALID', integrityCodes: ['META-INVALID', 'META-VB0-INCONSISTENT'] } });
  add('wrong-viewer-digest', 'wrong Viewer bundle digest, honest META', { promptItems: ['wrong Viewer digest'], ncRefs: ['NC-2a'], target: metaVariant({ vd: sha('synthetic other bundle'), vg: 0, vb: { 'VB-1': 0, 'VB-2': 0, 'VB-3': 0 } }), expected: { runVerdict: 'INVALID', integrityCodes: ['OBSERVED_BUNDLE_NOT_BOUND'] } });
  add('wrong-viewer-digest-claims-vb0', 'wrong Viewer bundle digest while claiming VB-0', { promptItems: ['wrong Viewer digest'], ncRefs: ['NC-2b'], target: metaVariant({ vd: sha('synthetic other bundle') }), expected: { runVerdict: 'INVALID', integrityCodes: ['META-INVALID', 'META-VB0-INCONSISTENT'] } });

  // --- missing version-bound observables (NC-3)
  add('missing-vb1', 'VB-1 (pending slot) structurally absent: V-PEND disabled by the C6 guard', { promptItems: ['missing VB-1'], ncRefs: ['NC-3a'], target: metaVariant({ vb: { 'VB-1': 0, 'VB-2': 1, 'VB-3': 1 } }), expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['VB_UNAVAILABLE:VB-1'] } });
  add('missing-vb3', 'VB-3 behaviour not confirmed: post-capture PC-3 FAILED, END.pc VB-3 = 0', { promptItems: ['missing VB-3'], ncRefs: ['NC-3b'], target: scriptValid(contract, T(), { pc3: { outcome: 'FAILED' } }).close({ pc: { 'VB-3': 0 } }), expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['VB_UNAVAILABLE:VB-3'] } });

  // --- missing request id (NC-4)
  add('missing-request-id', 'an RQ post without its reqToken', { promptItems: ['missing request ID'], ncRefs: ['NC-4a'], target: mutateData(valid(), (r) => r.k === 'RQ' && r.pp === 'post', (d) => { delete d.r; }), expected: { runVerdict: 'INVALID', integrityCodes: ['DATA-INVALID'] } });
  add('request-tagging-off', 'META.id = OFF (request tagging off)', { promptItems: ['missing request ID'], ncRefs: ['NC-4b'], target: metaVariant({ id: 'OFF' }), expected: { runVerdict: 'INVALID', integrityCodes: ['META-INVALID'] } });

  // --- ambiguity classes (NC-5, NC-10, NC-11)
  add('ambiguous-ownership-foreign-write', 'a foreign slot object ("U") read between the subject fit and its deciding sample', { ncRefs: ['NC-5'], expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['IDENTITY_AMBIGUOUS'] },
    target: (() => { const s = new Script(contract, T()); s.frame(); GATE(s); s.frame(); const k = s.fit(); s.foreignWrite(); s.frame(); s.settleStart('S', k); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled', fr: true }); s.c8('subject'); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })() });
  add('pre-motion-ambiguity', 'subject rise, no visible step before the deciding sample (PRE_MOTION / ACTIVE0 class)', { promptItems: ['pre-motion ambiguity'], ncRefs: ['NC-10'], expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['PRE_MOTION_UNRESOLVED'] },
    target: (() => { const s = new Script(contract, T()); s.frame(); GATE(s); s.frame(); const k = s.fit(); s.frame(); s.settleStart('S', k); s.settleFrame(s.cam); s.consume(); s.settleFrame(s.cam, { d: 'settled', fr: true }); s.c8('subject'); s.frames(s.cam + 1, s.cam + 2); s.fall(); s.frame(); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })() });
  add('pending-clear-active-edge-gap', 'visible subject binding, then a rise (GAP CONSUME_EDGE_BOUND) before the deciding sample', { promptItems: ['pending-clear/active-edge gap'], ncRefs: ['NC-11'], expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['UNOBSERVED_SLOT_WINDOW'] },
    target: (() => { const s = new Script(contract, T()); s.frame(); GATE(s); s.frame(); const k = s.fit(); s.frame(); s.settleStart('S', k); s.settleFrame(s.cam); s.consume(); s.settleFrame(s.cam + 1, { d: 'none' }); s.settleFrame(s.cam, { d: 'settled', fr: true }); s.c8('subject'); s.frames(s.cam + 1); s.fall(); s.frame(); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })() });
  add('gap-clear-without-edge', 'subject object leaves the slot with no rise (GAP CLEAR_WITHOUT_EDGE)', { ncRefs: [], expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['IDENTITY_AMBIGUOUS'] },
    planKey: 'f', target: (() => { const s = new Script(contract, T('f')); s.frame(); const k = s.fit(); s.frame(); s.clearSlot(); s.frame(); s.settleStart('S', k); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled', fr: true }); s.c8('subject'); s.frame(); s.fit(); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })() });
  // M-3: the cleared subject object reappears in the slot (source-impossible: objects are never reassigned)
  add('token-reappears-after-clear', 'subject object leaves the slot with no rise, then is visible again at t_d (source-fact contradiction, SC-C04)', { expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['SOURCE_FACT_CONTRADICTION:TOKEN_REAPPEARED', 'IDENTITY_AMBIGUOUS:CLEAR_WITHOUT_EDGE'] },
    target: (() => { const s = new Script(contract, T()); s.frame(); GATE(s); s.frame(); const k = s.fit(); s.frame(); const o = s.slot; s.clearSlot(); s.frame(); s.slot = o; s.frame(); s.settleStart('S', k); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled', fr: true }); s.c8('subject'); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })() });

  // --- control failure (SC-B02)
  add('control-failure', 'Phase-2 positive control PC-1 FAILED (no fall/TC)', { promptItems: ['control failure'], controls: 'pc1-failed', target: valid(), expected: { runVerdict: 'INVALID', reasonsInclude: ['CONTROL_NOT_PASSED:PC-1'] } });
  add('controls-not-run', 'Phase-2 control traces absent', { controls: 'none', target: valid(), expected: { runVerdict: 'INVALID', reasonsInclude: ['CONTROL_NOT_PASSED:PC-1'] } });

  // --- truncation / overflow / envelope mismatch (NC-6..NC-9)
  const v = valid();
  add('truncated-no-end', 'END missing', { promptItems: ['truncated trace'], ncRefs: ['NC-7'], target: v.slice(0, -1), expected: { runVerdict: 'INVALID', integrityCodes: ['END-MISSING'] } });
  add('truncated-flag', 'END.truncated = 1, ts = TRUNCATED', { promptItems: ['truncated trace'], ncRefs: ['NC-7'], target: scriptValid(contract, T()).close({ pc: { 'VB-3': 1 }, truncated: 1 }), expected: { runVerdict: 'INVALID', integrityCodes: ['TRUNCATED'] } });
  add('truncated-no-tz-final', 'no TZ final (harness died before terminalization)', { promptItems: ['truncated trace'], ncRefs: ['NC-7'], target: (() => { const s = new Script(contract, T()); s.frame(); GATE(s); s.frame(); SUBJ(s); TAIL(s); s.tz('targetEnd'); return s.close({ pc: { 'VB-3': 0 } }); })(), expected: { runVerdict: 'INVALID', integrityCodes: ['I6-TZ-WINDOW'] } });
  add('overflow', 'recorder overflow: an append rejected at a cap (END.overflow = 1, rj > iv)', { promptItems: ['overflow trace'], ncRefs: ['NC-8'], target: (() => { const s = scriptValid(contract, T()); s.rec.overflow = 1; s.rec.rj += 1; return s.close({ pc: { 'VB-3': 1 } }); })(), expected: { runVerdict: 'INVALID', integrityCodes: ['OVERFLOW'] } });
  add('envelope-run-id-mismatch', 'END.run differs from META.run', { promptItems: ['META/data/END mismatch'], ncRefs: ['NC-9'], target: (() => { const r = clone(v); r[r.length - 1].run = 'syn-other'; return r; })(), expected: { runVerdict: 'INVALID', integrityCodes: ['RUN-ID-MISMATCH'] } });
  add('envelope-meta-duplicate', 'a second META record', { promptItems: ['META/data/END mismatch'], ncRefs: ['NC-9'], target: (() => { const r = clone(v); r.splice(5, 0, clone(r[0])); return r; })(), expected: { runVerdict: 'INVALID', integrityCodes: ['META-DUPLICATE'] } });
  add('envelope-data-after-end', 'a data record after END', { promptItems: ['META/data/END mismatch'], ncRefs: ['NC-9', 'NC-19'], target: (() => { const r = clone(v); const last = r[r.length - 2]; r.push({ f: last.f, k: 'TC', q: last.q + 1, tm: last.tm + 1 }); return r; })(), expected: { runVerdict: 'INVALID', integrityCodes: ['DATA-AFTER-END'] } });
  add('envelope-count-mismatch', 'END.ne off by one', { promptItems: ['META/data/END mismatch'], ncRefs: ['NC-9'], target: (() => { const r = clone(v); r[r.length - 1].ne += 1; return r; })(), expected: { runVerdict: 'INVALID', integrityCodes: ['COUNT-MISMATCH'] } });
  add('envelope-tz-status-mismatch', 'END.ds differs from the TZ final cause code', { promptItems: ['META/data/END mismatch'], ncRefs: ['NC-9'], target: (() => { const r = clone(v); r[r.length - 1].ds = 1; return r; })(), expected: { runVerdict: 'INVALID', integrityCodes: ['TZ-STATUS-MISMATCH'] } });
  add('stream-digest-mismatch', 'END.sd is not SHA-256(canonical [META, ...data])', { promptItems: ['stream digest mismatch'], ncRefs: ['NC-6'], target: (() => { const r = clone(v); r[r.length - 1].sd = '0'.repeat(64); return r; })(), expected: { runVerdict: 'INVALID', integrityCodes: ['STREAM-DIGEST-MISMATCH'] } });
  add('stream-digest-data-mutated', 'a data record mutated after END was sealed (digest no longer matches)', { promptItems: ['stream digest mismatch'], ncRefs: ['NC-6'], target: mutateData(v, (r) => r.k === 'FS' && r.f === 3, (d) => { d.cl = 77; d.dg = camDigest(77); }, { resealIt: false }), expected: { runVerdict: 'INVALID', integrityCodes: ['STREAM-DIGEST-MISMATCH'] } });
  add('integrity-seq-gap', 'one seq skipped', { ncRefs: ['NC-6'], target: (() => { const r = clone(v); for (const d of r.slice(10, -1)) d.q += 1; return reseal(r); })(), expected: { runVerdict: 'INVALID', integrityCodes: ['SEQ-GAP'] } });
  add('integrity-version-in-data', 'a data record carrying vv', { ncRefs: ['NC-6'], target: mutateData(v, (r) => r.k === 'TC', (d) => { d.vv = '7.125.0'; }), expected: { runVerdict: 'INVALID', integrityCodes: ['META-FIELD-IN-DATA', 'VERSION-MIXED'] } });
  add('integrity-fs-without-ps', 'an FS without its PS', { ncRefs: ['NC-6'], target: removeData(v, v.slice(1, -1).findIndex((r, i, a) => r.k === 'PS' && i > 3 && a[i - 1].k === 'FS')), expected: { runVerdict: 'INVALID', integrityCodes: ['I3-HOST-PS'] } });
  add('integrity-fs-frame-gap', 'a target-window frame without its FS', { ncRefs: ['NC-6'], target: (() => { const d = v.slice(1, -1); const i = d.findIndex((r) => r.k === 'FS' && r.f === 2); return removeData(removeData(v, i + 1), i); })(), expected: { runVerdict: 'INVALID', integrityCodes: ['FS-FRAME-GAP'] } });
  add('integrity-frame-order', 'a TC whose frame is below the latest FS frame (Part 2 FRAME-ORDER)', { ncRefs: ['NC-6'], target: mutateData(v, (r) => r.k === 'TC', (d) => { d.f -= 1; }), expected: { runVerdict: 'INVALID', integrityCodes: ['FRAME-ORDER'] } });
  add('integrity-time-order', 'a TC whose tm is below the previous record\'s tm (Part 2 TIME-ORDER)', { ncRefs: ['NC-6'], target: mutateData(v, (r) => r.k === 'TC', (d) => { d.tm -= 5; }), expected: { runVerdict: 'INVALID', integrityCodes: ['TIME-ORDER'] } });
  add('integrity-rs-post-without-pre', 'an RS post without its adjacent RS pre (Part 1 RS-PAIR)', { ncRefs: ['NC-6'], planKey: 'b', target: (() => { const r = ownerRestore(); return removeData(r, r.slice(1, -1).findIndex((d) => d.k === 'RS' && d.pp === 'pre')); })(), expected: { runVerdict: 'INVALID', integrityCodes: ['RS-PAIR'] } });
  add('ce-not-configured', 'a CE record although P-CC is not configured', { target: (() => { const r = clone(v); const d = r.slice(1, -1); const i = d.findIndex((x) => x.k === 'TC'); const tc = d[i]; d.splice(i + 1, 0, { f: tc.f, k: 'CE', q: tc.q + 1, tm: tc.tm }); for (const x of d.slice(i + 2)) { x.q += 1; if (Number.isInteger(x.hq) && x.hq > tc.q) x.hq += 1; if (Number.isInteger(x.ss) && x.ss > tc.q) x.ss += 1; } const end = r[r.length - 1]; end.zt += 1; return reseal([r[0], ...d, end]); })(), expected: { runVerdict: 'INVALID', integrityCodes: ['CE-NOT-CONFIGURED'] } });

  // --- C8 (NC-12, NC-14, NC-18)
  add('inconclusive-c8-numeric-not-retained', 'deciding sample NV not retained: C8 numeric reproduction AMBIGUOUS(NUMERIC_NOT_RETAINED); targets unaffected', { promptItems: ['inconclusive C8 case'], ncRefs: ['NC-14'], target: scriptValid(contract, T(), { nv: true, nvDeciding: false }).close({ pc: { 'VB-3': 1 } }), expected: { runVerdict: 'SUPPORTED' } });
  const c8Bad = (fn) => { const s = new Script(contract, T()); s.frame(); GATE(s); s.frame(); fn(s); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); };
  add('c8-bound-to-non-terminal-sample', 'subject C8 names a non-terminal sample', { ncRefs: ['NC-12'], target: c8Bad((s) => { const k = s.fit(); s.settleStart('S', k); s.settleFrame(s.cam); const first = s.settle.lastQ; s.settleFrame(s.cam, { d: 'settled', fr: true }); s.c8('subject', { ss: first }); }), expected: { runVerdict: 'INVALID', integrityCodes: ['I5-C8-BINDING'] } });
  add('c8-digest-mismatch', 'subject C8 camDigest differs from its sample', { ncRefs: ['NC-12'], target: c8Bad((s) => { const k = s.fit(); s.settleStart('S', k); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled', fr: true }); s.c8('subject', { dg: camDigest(999) }); }), expected: { runVerdict: 'INVALID', integrityCodes: ['I5-C8-BINDING'] } });
  add('c8-subject-on-timed-out-settle', 'subject C8 for a timed-out settle', { ncRefs: ['NC-12'], target: c8Bad((s) => { const k = s.fit(); s.settleStart('S', k); s.settleFrame(s.cam); s.settleFrame(s.cam + 1, { d: 'none' }); s.decide('timeout', { fr: true }); s.settle.terminal.lastQ = s.settle.lastQ; s.c8('subject'); }), expected: { runVerdict: 'INVALID', integrityCodes: ['I5-C8-BINDING'] } });
  const withP = (fn) => { const s = new Script(contract, T('d')); s.frame(); GATE(s); s.frame(); SUBJ(s); s.frame(); fn(s); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); };
  add('c8-superseded-p-settle', 'S and P settles, subject and superseded C8 correctly bound', { ncRefs: ['NC-18'], planKey: 'd', target: withP((s) => { const k = s.fit(); s.settleStart('P', k); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled' }); s.c8('superseded'); }), expected: { runVerdict: 'SUPPORTED' } });
  add('c8-superseded-bound-to-s', 'superseded C8 bound to the subject sample', { ncRefs: ['NC-18'], planKey: 'd', target: withP((s) => { const sq = s.settle.terminal.lastQ; const k = s.fit(); s.settleStart('P', k); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled' }); s.c8('superseded', { ss: sq }); }), expected: { runVerdict: 'INVALID', integrityCodes: ['I5-C8-BINDING'] } });
  add('c8-superseded-timed-out-p', 'superseded C8 for a timed-out P settle', { ncRefs: ['NC-18'], planKey: 'd', target: withP((s) => { const k = s.fit(); s.settleStart('P', k); s.settleFrame(s.cam); s.settleFrame(s.cam + 1, { d: 'none' }); s.decide('timeout'); s.settle.terminal.lastQ = s.settle.lastQ; s.c8('superseded'); }), expected: { runVerdict: 'INVALID', integrityCodes: ['I5-C8-BINDING'] } });

  // --- edgeInit (NC-15; Part 1 §8.4 fixtures)
  const ei = (opts) => scriptValid(contract, T(), opts).close({ pc: { 'VB-3': 1 } });
  add('edge-init-already-high-at-listener-registration', 'boundary read: transition already active (ba = TRUE) -> edgeInit UNKNOWN', { ncRefs: ['NC-15'], target: ei({ boundary: { ba: 'TRUE' } }), expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['EDGE_INIT_UNKNOWN'] } });
  add('edge-init-rise-before-target-start', 'a TE during the quiescence window (qe = 1) -> edgeInit UNKNOWN', { ncRefs: ['NC-15'], target: ei({ quiescenceEdges: 1 }), expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['EDGE_INIT_UNKNOWN'] } });
  add('edge-init-listeners-late', 'listeners registered after quiescence began (lb = 0) -> edgeInit UNKNOWN', { ncRefs: ['NC-15'], target: ei({ boundary: { lb: 0 } }), expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['EDGE_INIT_UNKNOWN'] } });
  add('edge-init-claims-low-inconsistent', 'META claims edgeInit LOW although qe = 1', { ncRefs: ['NC-15'], target: (() => { const r = clone(ei({ quiescenceEdges: 1 })); r[0].ei = 'LOW'; return reseal(r); })(), expected: { runVerdict: 'INVALID', integrityCodes: ['EDGEINIT-INCONSISTENT', 'META-INVALID'] } });
  add('edge-init-fall-after-target-start', 'a fall in the target window with no rise (LOW boundary): committed C3 FALSE_EDGE_WITHOUT_TRUE', { target: (() => { const s = new Script(contract, T()); s.frame(); s.edge(0); s.frame(); GATE(s); s.frame(); SUBJ(s); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })(), expected: { runVerdict: 'INVALID', reasonsInclude: ['TARGET_PROJECTION_CONTRADICTION:CONTRADICTION:FALSE_EDGE_WITHOUT_TRUE'] } });

  // --- settle shapes (NC-16, NC-17, P6)
  add('zero-sample-timeout', 'subject settle times out with zero samples (no t_d)', { ncRefs: ['NC-16'], target: (() => { const s = new Script(contract, T()); s.frame(); GATE(s); s.frame(); const k = s.fit(); s.settleStart('S', k); s.decide('timeout'); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })(), expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['NO_DECIDING_SAMPLE'] } });
  add('zero-sample-timeout-with-c8', 'zero-sample subject timeout with a subject C8', { ncRefs: ['NC-16'], target: (() => { const s = new Script(contract, T()); s.frame(); const g = GATE(s); void g; const gq = s.settle.lastQ; s.frame(); const k = s.fit(); s.settleStart('S', k); s.decide('timeout'); s.c8('subject', { ss: gq }); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })(), expected: { runVerdict: 'INVALID', integrityCodes: ['I5-C8-BINDING'] } });
  add('t4-more-than-64-samples-then-settled', '70 unequal samples, then settled at sample 71 (projection compaction)', { ncRefs: ['NC-17'], target: (() => { const s = new Script(contract, T()); s.frame(); GATE(s); s.frame(); const k = s.fit(); s.frame(); s.consume(); s.settleStart('S', k); for (let i = 1; i <= 70; i += 1) s.settleFrame(s.cam + 1, i === 1 ? {} : { d: 'none' }); s.fall(); s.settleFrame(s.cam, { d: 'settled', fr: true }); s.c8('subject'); s.frame(); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })(), expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['UNOBSERVED_SLOT_WINDOW'] } });
  add('t4-sample-index-above-bound', 'an append with sampleIndex 1,802 is rejected at the recorder (overflow)', { ncRefs: ['NC-17'], target: (() => { const s = new Script(contract, T()); s.frame(); GATE(s); s.frame(); const k = s.fit(); s.settleStart('S', k); s.settleFrame(s.cam); s.settle.n = 1801; s.frame(); s.sample(); s.settle.n = 1; s.settleFrame(s.cam, { d: 'settled', fr: true }); s.c8('subject'); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })(), expected: { runVerdict: 'INVALID', integrityCodes: ['OVERFLOW'] } });
  add('plan-p6-two-g-settles', 'historical P6 shape: restore, G (N2), G (C6), S (C8), P (p2) with superseded C8', { planKey: 'e', target: (() => { const s = new Script(contract, T('e')); s.frame(); s.restore('OK', 0); s.frame(); GATE(s); s.frame(); GATE(s); s.frame(); SUBJ(s); s.frame(); const k = s.fit(); s.settleStart('P', k); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled' }); s.c8('superseded'); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })(), expected: { runVerdict: 'SUPPORTED' } });
  add('rq-interleaved', 'a nested fitToView inside the outer call (I1 interleaving): outer binding refused', { target: (() => { const s = new Script(contract, T()); s.frame(); GATE(s); s.frame(); s.fit({ request: false, nested: (x) => { x.fit(); } }); s.settleStart('S', 3); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled', fr: true }); s.c8('subject'); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })(), expected: { runVerdict: 'SUPPORTED' } });
  add('rq-threw-unrepresentable', 'a target-window fitToView that throws: projection unrepresentable (FIT_THREW)', { ncRefs: ['NC-21'], target: (() => { const s = new Script(contract, T()); s.frame(); GATE(s); s.frame(); const k = s.fit({ threw: true }); s.frame(); s.settleStart('S', k); s.settleFrame(s.cam); s.settleFrame(s.cam, { d: 'settled', fr: true }); s.c8('subject'); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })(), expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['PROJECTION_UNREPRESENTABLE:FIT_THREW'] } });

  // --- lifecycle (NC-19, NC-20)
  add('late-callback-after-closed', 'TE/TC delivered in FINALIZING and CLOSED: no byte, seq or counter change', { ncRefs: ['NC-19'], target: (() => { const s = scriptValid(contract, T()); s.edge(1); s.add({ k: 'TC' }); const recs = s.close({ pc: { 'VB-3': 1 } }); s.edge(0); s.add({ k: 'TC' }); s.rec.teardown(); return recs; })(), expected: { runVerdict: 'SUPPORTED' } });
  add('late-data-after-tz-final', 'a data record between TZ final and END', { ncRefs: ['NC-19'], target: (() => { const r = clone(v); const d = r.slice(1, -1); const last = d[d.length - 1]; d.push({ f: last.f, k: 'TC', q: last.q + 1, tm: last.tm + 1 }); return reseal([r[0], ...d, r[r.length - 1]]); })(), expected: { runVerdict: 'INVALID', integrityCodes: ['I6-TZ-WINDOW'] } });
  add('second-recorder-refused', 'a second recorder in the same page is refused (SC-B01): no target trace', { ncRefs: ['NC-20'], stop: { id: 'SC-B01', class: 'b' }, target: (() => { const page = new Page(); new Recorder(page, T(), { contract }); try { new Recorder(page, T(), { contract }); return { refused: false }; } catch (e) { return e instanceof RecorderRefused ? null : { refused: false }; } })(), expected: { runVerdict: 'INVALID', reasonsInclude: ['STOP_CLASS_B:SC-B01', 'TARGET_TRACE_ABSENT'] } });
  add('recorder-ordinal-2', 'META.rc = 2', { ncRefs: ['NC-20'], target: (() => { const r = clone(v); r[0].rc = 2; return reseal(r); })(), expected: { runVerdict: 'INVALID', integrityCodes: ['RECORDER-ORDINAL', 'META-INVALID'] } });
  add('listener-duplication-edge-repeat', 'a duplicated TE listener: two identical consecutive rises (committed C3 EDGE_REPEAT)', { ncRefs: ['NC-20'], target: (() => { const s = new Script(contract, T()); s.frame(); const k = s.fit(); s.frame(); s.consume(); s.edge(1); s.frames(1, 2); s.fall(); s.frame(); s.settleStart('G', k); s.settleFrame(2); s.settleFrame(2, { d: 'settled' }); s.frame(); SUBJ(s); TAIL(s); s.pc3(); return s.close({ pc: { 'VB-3': 1 } }); })(), expected: { runVerdict: 'INVALID', reasonsInclude: ['TARGET_PROJECTION_CONTRADICTION:CONTRADICTION:EDGE_REPEAT'] } });

  // --- other run-level classes
  add('blocked-preflight-stop', 'live preflight finds a wrong Viewer version (SC-A09) before ATTEMPT_CONSUMED: no trace', { promptItems: ['wrong Viewer version'], attemptConsumed: false, stop: { id: 'SC-A09', class: 'a' }, target: null, controls: 'none', expected: { runVerdict: 'BLOCKED' } });
  add('class-gate-nontransitive', 'END.cg = 1 (camClass relation not transitive)', { target: scriptValid(contract, T()).close({ pc: { 'VB-3': 1 }, cg: 1 }), expected: { runVerdict: 'INCONCLUSIVE', reasonsInclude: ['CLASS_NONTRANSITIVE'] } });
  add('target-step-stop', 'a target step could not be issued (SC-B08): TZ final with tzCause stop', { stop: { id: 'SC-B08', class: 'b' }, target: (() => { const s = new Script(contract, T()); s.frame(); GATE(s); s.tz('targetEnd'); s.tz('final', 'stop'); return s.close({ pc: { 'VB-3': 0 } }); })(), expected: { runVerdict: 'INVALID', reasonsInclude: ['STOP_CLASS_B:SC-B08'] } });
  add('binding-mismatch-target-plan', 'target trace bound to another target plan (META.tq differs from the binding)', { target: scriptValid(contract, T('b')).close({ pc: { 'VB-3': 1 } }), expected: { runVerdict: 'INVALID', integrityCodes: ['BINDING-MISMATCH'] } });
  add('payload-mismatch', 'TE payloadActive differs from edgeValue', { target: mutateData(v, (r) => r.k === 'TE' && r.ev === 1, (d) => { d.pa = 0; }), expected: { runVerdict: 'INVALID', reasonsInclude: ['TARGET_PROJECTION_CONTRADICTION:CONTRADICTION:PAYLOAD_MISMATCH'] } });
  // M-8: trace-to-plan conformance (the subject C8 that plan a pre-registers is missing)
  add('target-plan-nonconformant-missing-c8', 'the pre-registered subject C8 step is missing from the trace (plan non-conformance)', { target: removeData(v, v.slice(1, -1).findIndex((r) => r.k === 'C8')), expected: { runVerdict: 'INVALID', reasonsInclude: ['TARGET_PLAN_NONCONFORMANT'] } });
  // M-1: external Phase-5 gates must be exactly true (absent / mistyped fails closed)
  add('gate-nc-rerun-absent', 'the Phase-5 negative-control rerun result is absent', { gates: { ledgerOk: true }, target: valid(), expected: { runVerdict: 'INVALID', reasonsInclude: ['NEGATIVE_CONTROL_RERUN_UNKNOWN'] } });
  add('gate-ledger-mistyped', 'the hash-ledger/manifest gate is a non-boolean (0)', { gates: { ncRerunOk: true, ledgerOk: 0 }, target: valid(), expected: { runVerdict: 'INVALID', reasonsInclude: ['HASH_LEDGER_UNKNOWN'] } });
  return S.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------- file materialization

/** Generates every fixture file in memory. Returns { files: {relPath: string}, scenarios }. Deterministic. */
export function generateFixtures(contract = loadContract()) {
  const files = {};
  const put = (p, s) => { if (Object.prototype.hasOwnProperty.call(files, p)) throw new Error(`duplicate fixture path ${p}`); files[p] = s; };
  put('shared/target-plan-c-label-swap.json', json(UNBOUND_PLAN_C_LABEL_SWAP));
  for (const k of Object.keys(TARGET_PLANS)) {
    put(`shared/target-plan-${k}.json`, json(TARGET_PLANS[k]));
    put(`shared/binding-${k}.json`, json(bindingFor(contract, k)));
    const binding = bindingFor(contract, k);
    for (const id of ['PC-1', 'PC-2', 'PC-4', 'PC-5']) put(`controls/${k}/${id.toLowerCase()}.records.jsonl`, toJsonl(controlTrace(contract, binding, id, `syn-${k}`)));
    put(`controls/${k}/pc-1-failed.records.jsonl`, toJsonl(controlTrace(contract, binding, 'PC-1-FAILED', `syn-${k}`)));
  }
  const scenarios = buildScenarios(contract);
  const index = [];
  for (const sc of scenarios) {
    const dir = `scenarios/${sc.id}`;
    let targetRef = null;
    if (Array.isArray(sc.target)) {
      const end = sc.target[sc.target.length - 1];
      if (end && end.k === 'END' && end.iv !== 0) throw new Error(`${sc.id}: generator produced a schema-invalid append (iv = ${end.iv}) ${JSON.stringify(sc.target.rejections || [])}`);
      targetRef = `${dir}/target.records.jsonl`; put(targetRef, toJsonl(sc.target));
    }
    else if (sc.target !== null) throw new Error(`${sc.id}: target generation did not behave as expected`);
    const pcs = {};
    for (const id of ['PC-1', 'PC-2', 'PC-4', 'PC-5']) {
      if (sc.controls === 'none') pcs[id] = null;
      else pcs[id] = `controls/${sc.planKey}/${id === 'PC-1' && sc.controls === 'pc1-failed' ? 'pc-1-failed' : id.toLowerCase()}.records.jsonl`;
    }
    const scenarioFile = {
      id: sc.id, title: sc.title, synthetic: true, promptItems: sc.promptItems, ncRefs: sc.ncRefs,
      attemptConsumed: sc.attemptConsumed, stop: sc.stop, ...(sc.gates || { ncRerunOk: true, ledgerOk: true }),
      binding: `shared/binding-${sc.planKey}.json`, targetPlan: sc.targetPlanFile || `shared/target-plan-${sc.planKey}.json`,
      traces: { T: targetRef, ...pcs }, expected: sc.expected, ambiguous: sc.ambiguous,
    };
    put(`${dir}/scenario.json`, json(scenarioFile));
    index.push({ id: sc.id, expected: sc.expected.runVerdict, ncRefs: sc.ncRefs, promptItems: sc.promptItems });
  }
  put('index.json', json({ synthetic: true, note: 'SYNTHETIC future-live schema-2 fixtures for offline preparation tests only; not evidence; no real authorization, attempt, harness or Viewer observation', scenarios: index }));
  return { files, scenarios };
}

/** Loads one scenario (by its scenario.json path) from a {relPath: text} map into evaluateScenario input. */
export function scenarioFromFiles(files, id, { parseJsonl }) {
  const sc = JSON.parse(files[`scenarios/${id}/scenario.json`]);
  const traces = {};
  for (const [role, ref] of Object.entries(sc.traces)) {
    if (ref === null) { traces[role] = null; continue; }
    const p = parseJsonl(files[ref]);
    traces[role] = p.ok ? p.records : { parseError: p.code };
  }
  return {
    id: sc.id, attemptConsumed: sc.attemptConsumed, stop: sc.stop, ncRerunOk: sc.ncRerunOk, ledgerOk: sc.ledgerOk,
    binding: JSON.parse(files[sc.binding]), targetPlan: JSON.parse(files[sc.targetPlan]), traces,
    expected: sc.expected, ambiguous: sc.ambiguous, ncRefs: sc.ncRefs, promptItems: sc.promptItems, title: sc.title,
  };
}

/** Reads a fixtures directory into a {relPath: text} map (POSIX relative paths, sorted). */
export function readFixturesDir(dir = FIXTURES_DIR) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p); else out[relative(dir, p).split(sep).join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

/** Writes the fixture map atomically (staging dir, then one rename). Refuses a non-empty existing directory. */
export function writeFixturesDir(files, dir = FIXTURES_DIR) {
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`refusing non-empty fixtures dir ${relative(process.cwd(), dir) || '.'}`);
  const stage = join(dirname(dir), '.fixtures.staging');
  if (existsSync(stage)) throw new Error('refusing: stale staging directory');
  mkdirSync(stage);
  try {
    for (const [rel, text] of Object.entries(files)) { const p = join(stage, ...rel.split('/')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); }
    if (existsSync(dir)) rmSync(dir, { recursive: true });
    renameSync(stage, dir);
  } catch (e) { rmSync(stage, { recursive: true, force: true }); throw e; }
}

/** Byte-compares an on-disk fixtures map with a fresh generation. Returns sorted findings ([] = identical). */
export function compareFixtures(onDisk, generated) {
  const F = [];
  for (const k of Object.keys(generated)) if (onDisk[k] !== generated[k]) F.push(onDisk[k] === undefined ? `missing ${k}` : `differs ${k}`);
  for (const k of Object.keys(onDisk)) if (!(k in generated)) F.push(`extra ${k}`);
  return F.sort();
}

async function main(argv) {
  const contract = loadContract();
  const { files } = generateFixtures(contract);
  if (argv.includes('--write')) { writeFixturesDir(files); console.log(`wrote ${Object.keys(files).length} fixture files`); return 0; }
  if (argv.includes('--check')) {
    if (!existsSync(FIXTURES_DIR)) { console.error('fixtures dir absent'); return 2; }
    const f = compareFixtures(readFixturesDir(), files);
    if (f.length) { console.error(f.join('\n')); return 2; }
    console.log(`fixtures identical (${Object.keys(files).length} files)`); return 0;
  }
  console.error('usage: fixtures-gen.mjs --write | --check'); return 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then((c) => { process.exitCode = c; });
