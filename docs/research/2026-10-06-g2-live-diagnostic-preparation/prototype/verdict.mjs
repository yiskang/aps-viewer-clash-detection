// Mechanical diagnostic verdict model (Part 2 §14) over schema-2 traces: Part 1 §8.3 projection onto committed
// schema-1 live events, the committed C6 guard and the committed correlator (both consumed UNCHANGED), the Part 1
// derived annotations (PRE_MOTION §9.2, GAP §10.2), target rules T0–T6 and run rules V1–V5 with the total precedence
// BLOCKED > INVALID > INCONCLUSIVE > REJECTED > SUPPORTED. [SYN] offline research prototype only.
//
// Invariant enforced here and audited independently by auditResult(): no ambiguous, partial, unbound or degraded
// trace can yield SUPPORTED or REJECTED. Every verdict has scope NEW_RUN_ONLY and says nothing about the historical
// run R1; the historical status block is a copied constant, never computed.
import { applyVbGuard, correlate, VERDICT } from '../../2026-10-05-g2-diagnostic-instrumentation/correlate.mjs';
import { validateTraceV2, canonicalBytes, sha256 } from './envelope.mjs';
import { windowIndices, isVisibleSlotRead, isCameraBearing, TZ_CAUSE_CODE } from './trace-schema.mjs';
import { evaluateControls } from './controls.mjs';

const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isTok = (v) => Number.isInteger(v) && v >= 1;
export const SOUND_QUESTIONS = Object.freeze(['Q-OWNER', 'Q-SUBJ', 'Q-ATTR']);
export const VERDICTS = Object.freeze(['BLOCKED', 'INVALID', 'INCONCLUSIVE', 'REJECTED', 'SUPPORTED']);
const rank = (v) => VERDICTS.indexOf(v);
/** The earliest verdict in the total precedence order. */
export const worst = (...vs) => vs.reduce((a, b) => (rank(b) < rank(a) ? b : a));

// ---------------------------------------------------------------- projection (Part 1 §8.3, normative pseudocode)

const slotFields = (r) => (r.sp === 1 ? { p: 1, b: r.sb } : { p: 0 });

/** Target-window data records: everything before TZ{targetEnd} (the TZ itself excluded). */
export function targetWindow(data) {
  const w = windowIndices(data);
  return w.targetEnd >= 0 ? data.slice(0, w.targetEnd) : data.slice();
}

/**
 * Projects a validated target window onto committed schema-1 live events. Returns { events } or
 * { unrepresentable: 'FIT_THREW' | 'CAPACITY' }. opts: { edgeInit, projectedEventsMax, smpMax }.
 */
export function projectTarget(win, { edgeInit, projectedEventsMax = 8192, smpMax = 64 }) {
  if (win.some((r) => r.k === 'RQ' && r.pp === 'post' && r.co === 'threw')) return { unrepresentable: 'FIT_THREW' };
  // total samples per settle, keyed by the settle's start seq
  const total = new Map(); const settleOf = new Map(); let curStart = null;
  for (const r of win) {
    if (r.k !== 'T4') continue;
    if (r.tp === 'start') { curStart = r.q; total.set(curStart, 0); }
    if (r.tp === 'sample') { total.set(curStart, total.get(curStart) + 1); settleOf.set(r.q, curStart); }
  }
  const out = []; const pendingFit = new Map(); const hostOf = new Map();
  for (const r of win) {
    switch (r.k) {
      case 'RQ':
        if (r.pp === 'pre') pendingFit.set(r.r, r);
        else {
          const pre = pendingFit.get(r.r); pendingFit.delete(r.r);
          const adjacent = r.q === pre.q + 1;
          out.push({ k: 'FIT', f: r.f, tm: r.tm, r: r.r, cl: r.cl, dg: r.dg, pq: slotFields(pre), pd: { ...slotFields(r), nw: adjacent ? r.nw : 0 } });
        }
        break;
      case 'RS':
        if (r.pp === 'post') {
          const e = { k: 'RST', f: r.f, tm: r.tm, rs: r.rs };
          if (r.rs !== 'THROW') { e.cl = r.cl; e.dg = r.dg; e.pd = slotFields(r); }
          out.push(e);
        }
        break;
      case 'FS':
        hostOf.set(r.q, out.push({ k: 'CAM', f: r.f, tm: r.tm, cl: r.cl, dg: r.dg }) - 1);
        break;
      case 'T4':
        if (r.tp === 'start') { if (r.s === 'G' || r.s === 'S') out.push({ k: 'SST', f: r.f, tm: r.tm, s: r.s, r: r.r }); }
        else if (r.tp === 'sample') {
          const N = total.get(settleOf.get(r.q));
          if (r.s === 'P' || (N > smpMax && r.n >= smpMax && r.n < N)) hostOf.set(r.q, out.push({ k: 'CAM', f: r.f, tm: r.tm, cl: r.cl, dg: r.dg }) - 1);
          else {
            const pn = N > smpMax && r.n === N ? smpMax : r.n;
            hostOf.set(r.q, out.push({ k: 'SMP', f: r.f, tm: r.tm, s: r.s, n: pn, d: 'none', cl: r.cl, dg: r.dg }) - 1);
          }
        } else if ((r.s === 'G' || r.s === 'S') && r.n >= 1) {
          const smp = out[hostOf.get(r.ss)];
          if (smp && smp.k === 'SMP') { smp.d = r.d; if (r.fr === 1) smp.fr = 1; }
        }
        break;
      case 'PS': out[hostOf.get(r.hq)].pd = slotFields(r); break;
      case 'TE': out.push({ k: 'AE', f: r.f, tm: r.tm, ev: r.ev }); break;
      case 'TC': out.push({ k: 'TC', f: r.f, tm: r.tm }); break;
      case 'CE': out.push({ k: 'CC', f: r.f, tm: r.tm }); break;
      default: break; // NV, C8, CT, TZ: not projected
    }
  }
  const events = edgeInit === 'LOW' ? out : out.filter((e) => e.k !== 'AE');
  if (events.length > projectedEventsMax) return { unrepresentable: 'CAPACITY' };
  events.forEach((e, i) => { e.q = i + 1; });
  return { events };
}

const V_FIELDS = Object.freeze({ 'V-PEND': ['pd', 'pq'], 'V-EDGE': [] });

/**
 * Projection + committed C6 guard + committed correlator for one validated trace (target window).
 * opts: { meta, effectivePcVb3 (0|1), slotWindow (default META.sw) }. Returns the correlator output plus
 * { guard, atoms, unrepresentable, projected }.
 */
export function correlateTraceWindow(data, { meta, effectivePcVb3, slotWindow, contract }) {
  const win = targetWindow(data);
  const pre = preCorrelationContradiction(data);
  const proj = projectTarget(win, { edgeInit: meta.ei, projectedEventsMax: contract.envelope.caps.projectedEventsMax, smpMax: contract.envelope.caps.projectedSamplesPerSettle });
  const guard = applyVbGuard(meta.at, { vg: meta.vg, vv: meta.vv, vd: meta.vd, vb: meta.vb, pc: { 'VB-3': effectivePcVb3 } });
  if (proj.unrepresentable) {
    const questions = {}; for (const id of SOUND_QUESTIONS) questions[id] = { status: VERDICT.UNDIAGNOSABLE, reason: `PROJECTION_UNREPRESENTABLE:${proj.unrepresentable}` };
    return { questions, contradiction: pre, malformed: null, guard, atoms: guard.atoms, unrepresentable: proj.unrepresentable, projected: null, S_d: null };
  }
  let atoms = guard.atoms;
  if (meta.ei !== 'LOW') atoms = atoms.filter((a) => a !== 'V-EDGE'); // Part 1 §8.4: V-EDGE dropped under UNKNOWN
  const disabled = meta.at.filter((a) => own(V_FIELDS, a) && !atoms.includes(a));
  const strip = disabled.flatMap((a) => V_FIELDS[a]);
  const dropAe = disabled.includes('V-EDGE');
  const events = proj.events.filter((e) => !(dropAe && e.k === 'AE')).map((e) => { const o = { ...e }; for (const k of strip) delete o[k]; return o; });
  events.forEach((e, i) => { e.q = i + 1; });
  const cfg = { atoms, idAxis: meta.id, vbUnavailable: guard.vbUnavailable, slotWindow: slotWindow ?? meta.sw, mode: 'live' };
  const res = correlate(events, cfg);
  return { ...res, contradiction: pre || res.contradiction, guard, atoms, unrepresentable: null, projected: events };
}

/** Raw-level contradictions the projection cannot carry: TE payloadActive != edgeValue (Part 1 §8.3 TE row). */
export function preCorrelationContradiction(data) {
  return data.some((r) => r.k === 'TE' && r.pa !== r.ev) ? 'CONTRADICTION:PAYLOAD_MISMATCH' : null;
}

// ---------------------------------------------------------------- derived annotations (Part 1 §9, §10)

/** The subject's deciding sample D (the S sample named by the unique fr=1 decision), or null. */
export function decidingSample(win) {
  const dec = win.find((r) => r.k === 'T4' && r.tp === 'decision' && r.fr === 1);
  return dec ? win.find((r) => r.q === dec.ss) || null : null;
}

/** PRE_MOTION(trace) (Part 1 §9.2), evaluated on the target window. Returns { preMotion, E, B, D }. */
export function preMotion(win) {
  const D = decidingSample(win);
  if (!D) return { preMotion: false, reason: 'NO_DECIDING_SAMPLE' };
  let E = null;
  for (const r of win) {
    if (r.q >= D.q) break;
    if (r.k === 'TE' && r.ev === 1) E = r;
    if (r.k === 'TE' && r.ev === 0) E = null; // a fall in (E, D) disqualifies E
  }
  if (!E) return { preMotion: false, reason: 'NO_OPEN_RISE' };
  let B = null;
  for (const r of win) { if (r.q >= E.q) break; if (isCameraBearing(r)) B = r; }
  if (!B) return { preMotion: false, reason: 'NO_BASELINE_BEFORE_RISE' };
  const C = win.filter((r) => r.q > E.q && r.q <= D.q && isCameraBearing(r));
  const restoreOk = win.some((r) => r.q > E.q && r.q <= D.q && r.k === 'RS' && r.pp === 'post' && r.rs === 'OK');
  const pm = C.every((c) => c.cl === B.cl) && !restoreOk;
  return { preMotion: pm, E: E.q, B: B.q, D: D.q };
}

/** GAP annotations (Part 1 §10.2). Never override the correlator; inferredToken is always null. */
export function gaps(win, { slotWindow }) {
  const out = [];
  const reads = win.filter(isVisibleSlotRead);
  for (const e of win) {
    if (!(e.k === 'TE' && e.ev === 1)) continue;
    let v = null; for (const r of reads) { if (r.q < e.q) v = r; else break; }
    if (!v) { out.push({ openSeq: 0, closeSeq: e.q, boundBefore: null, gapClass: 'EDGE_AFTER_EMPTY', inferredToken: null }); continue; }
    const gapClass = v.sp === 0 ? 'EDGE_AFTER_EMPTY' : isTok(v.sb) ? 'CONSUME_EDGE_BOUND' : 'CONSUME_EDGE_UNBOUND';
    const g = { openSeq: v.q, closeSeq: e.q, boundBefore: v.sp === 1 ? v.sb : null, gapClass, inferredToken: null };
    const priorU = reads.some((r) => r.q <= v.q && r.sb === 'U');
    if (slotWindow === 'ASSUME_NO_UNOBSERVED_WRITER' && gapClass === 'CONSUME_EDGE_BOUND' && !priorU) g.assumedToken = v.sb;
    out.push(g);
  }
  for (let i = 0; i + 1 < reads.length; i += 1) {
    const v1 = reads[i]; const v2 = reads[i + 1];
    if (v1.sp === 1 && v2.sp === 0 && !win.some((r) => r.k === 'TE' && r.ev === 1 && r.q > v1.q && r.q < v2.q)) {
      out.push({ openSeq: v1.q, closeSeq: v2.q, boundBefore: v1.sb, gapClass: 'CLEAR_WITHOUT_EDGE', inferredToken: null });
    }
  }
  return out.sort((a, b) => a.closeSeq - b.closeSeq || a.openSeq - b.openSeq || (a.gapClass < b.gapClass ? -1 : 1));
}

/** Annotations of one target window, including whether a GAP intersects [subject RQ post.seq, D.seq]. */
export function annotate(data, { slotWindow }) {
  const win = targetWindow(data);
  const pm = preMotion(win);
  const g = gaps(win, { slotWindow });
  const start = win.find((r) => r.k === 'T4' && r.tp === 'start' && r.s === 'S');
  const post = start ? win.find((r) => r.k === 'RQ' && r.pp === 'post' && r.r === start.r) : null;
  const D = decidingSample(win);
  const inter = !!(post && D) && g.some((x) => x.openSeq <= D.q && x.closeSeq >= post.q);
  const zeroSampleSubject = win.some((r) => r.k === 'T4' && r.tp === 'decision' && r.s === 'S' && r.n === 0 && r.d === 'timeout');
  return {
    preMotionUnresolved: pm.preMotion, preMotion: pm, gaps: g, gapClasses: [...new Set(g.map((x) => x.gapClass))].sort(), gapIntersectsSubjectWindow: inter, zeroSampleSubjectTimeout: zeroSampleSubject,
    clearedWithoutEdge: clearedWithoutEdge(g), subjectToken: start ? start.r : null, tokenReappeared: tokenReappearance(win),
  };
}

/**
 * Source-fact contradiction (Part 1 §10.3, §10.4a): a token whose bound object was visible, then left the slot (a
 * later visible read shows an empty slot or another object), is visible again. Writes create fresh objects and no
 * code path reassigns an old one (V:95294, V:96698, V:96709, V:96727, V:96738), and a token binds exactly one object
 * at CP02, so a reappearance contradicts a pinned source fact (Part 2 SC-C04). Returns the first offending read or null.
 */
export function tokenReappearance(win) {
  const state = new Map(); // token -> 'present' | 'left'
  for (const r of win.filter(isVisibleSlotRead)) {
    const cur = r.sp === 1 && isTok(r.sb) ? r.sb : null;
    if (cur !== null && state.get(cur) === 'left') return { seq: r.q, token: cur };
    for (const [t, s] of state) if (s === 'present' && t !== cur) state.set(t, 'left');
    if (cur !== null) state.set(cur, 'present');
  }
  return null;
}

/** Tokens cleared by a CLEAR_WITHOUT_EDGE gap (Part 1 §10.4: IDENTITY_AMBIGUOUS for the cleared token, both modes). */
export const clearedWithoutEdge = (g) => [...new Set(g.filter((x) => x.gapClass === 'CLEAR_WITHOUT_EDGE' && isTok(x.boundBefore)).map((x) => x.boundBefore))].sort((a, b) => a - b);

/** C8 numeric reproduction status (offline): never a target question; NV absent => NUMERIC_NOT_RETAINED. */
export function c8Numeric(data) {
  return data.filter((r) => r.k === 'C8').map((c) => {
    const host = data.find((r) => r.q === c.ss);
    const nv = host ? data.find((r) => r.q === host.q + 1 && r.k === 'NV') : null;
    return { measureRole: c.mr, sampleSeq: c.ss, status: nv ? 'NOT_EVALUATED_OFFLINE' : 'AMBIGUOUS', reason: nv ? 'FROZEN_C8_ORACLE_NOT_IN_PROTOTYPE' : 'NUMERIC_NOT_RETAINED' };
  });
}

// ---------------------------------------------------------------- target plan (Part 2 §14.2)

/** SHA-256 of the canonical bytes of a target plan (Part 2 §14.2: = binding.targetPlanSha256 = META.tq), or null. */
export function targetPlanDigest(plan) {
  try { return sha256(canonicalBytes(plan)); } catch { return null; }
}

/** Strict structural check of plan.steps against Appendix (ii) targetPlanSchema. Returns sorted findings. */
export function validatePlanSteps(plan, contract) {
  const S = contract.verdictTable.targetPlanSchema;
  const F = [];
  const steps = plan.steps;
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > S.maxSteps) return ['STEPS-SHAPE'];
  const n = { fit: 0, restore: 0, G: 0, S: 0, P: 0, subject: 0, superseded: 0 };
  let fitSinceSettle = false; let sawS = false;
  steps.forEach((st, i) => {
    if (!isPlain(st) || !own(S.stepOps, st.op)) { F.push(`STEP-OP:${i}`); return; }
    const allowed = ['op', ...S.stepOps[st.op]];
    if (Object.keys(st).some((k) => !allowed.includes(k)) || S.stepOps[st.op].some((k) => !own(st, k))) { F.push(`STEP-FIELDS:${i}`); return; }
    if (st.op === 'fit') { n.fit += 1; fitSinceSettle = true; }
    if (st.op === 'restore') n.restore += 1;
    if (st.op === 'settle') {
      if (!S.settleRoles.includes(st.role)) { F.push(`STEP-ROLE:${i}`); return; }
      n[st.role] += 1;
      if (!fitSinceSettle) F.push(`SETTLE-WITHOUT-FIT:${i}`);
      if (st.role === 'P' && !sawS) F.push(`P-BEFORE-S:${i}`);
      if (st.role === 'S') sawS = true;
      fitSinceSettle = false;
    }
    if (st.op === 'c8') {
      if (!S.c8Roles.includes(st.role)) { F.push(`STEP-ROLE:${i}`); return; }
      n[st.role] += 1;
      const prev = steps[i - 1];
      const want = st.role === 'subject' ? 'S' : 'P';
      if (!(isPlain(prev) && prev.op === 'settle' && prev.role === want)) F.push(`C8-NOT-AFTER-${want}:${i}`);
    }
  });
  for (const [k, [lo, hi]] of Object.entries(S.counts)) if (n[k] < lo || n[k] > hi) F.push(`COUNT:${k}`);
  if (n.subject !== 1) F.push('C8-SUBJECT-COUNT');
  if (n.superseded !== n.P) F.push('C8-SUPERSEDED-COUNT');
  return [...new Set(F)].sort();
}

/**
 * Derived (never declared) worst-case bounds of a plan (Part 2 §14.2, P0.08/P0.13). b1: per-fit/restore transition
 * frame budget; bPost: post-sequence budget (both implementation-plan values bound by the authorization).
 * frames(r) = 1 + settles*(floor(deadlineMs*r/1000)+1) + (fits+restores)*b1 + bPost. maxRefreshHz = the largest
 * integer r <= cp.maxRefreshHz with frames(r) <= targetWindowFrames (0 => SC-A07); P0.13 requires rr <= maxRefreshHz.
 */
export function derivePlanBounds(plan, contract, { b1, bPost }) {
  const c = contract.envelope.caps;
  const steps = Array.isArray(plan && plan.steps) ? plan.steps.filter(isPlain) : [];
  const cnt = (op, role) => steps.filter((s) => s.op === op && (role === undefined || s.role === role)).length;
  const settles = cnt('settle'); const fits = cnt('fit'); const restores = cnt('restore'); const c8s = cnt('c8');
  const projectedSettles = cnt('settle', 'G') + cnt('settle', 'S');
  const frames = (r) => 1 + settles * (Math.floor((c.deadlineMs * r) / 1000) + 1) + (fits + restores) * b1 + bPost;
  let maxRefreshHz = 0;
  for (let r = c.maxRefreshHz; r >= 1; r -= 1) if (frames(r) <= c.targetWindowFrames) { maxRefreshHz = r; break; }
  const at = (r) => {
    const F = frames(r); const samples = Math.min(F, settles * c.settleSamples);
    return {
      frames: F,
      rawRecords: 2 * (F + c.controlWindowFrames) + 2 * settles + 3 * samples + c.retainedNumericSamples + 2 * (fits + 1) + 2 * restores + c.viewerDispatchAllowance + c8s + 3,
      projectedEvents: 2 * F + projectedSettles + fits + restores + c.viewerDispatchAllowance,
    };
  };
  const w = maxRefreshHz ? at(maxRefreshHz) : at(1);
  const F = [];
  if (maxRefreshHz === 0) F.push('SC-A07:DURATION');
  if (w.rawRecords > c.dataEvents) F.push('SC-A07:RAW_COUNT');
  if (w.projectedEvents > c.projectedEventsMax) F.push('SC-A07:PROJECTED_COUNT');
  return { ok: F.length === 0, findings: F, settles, fits, restores, maxRefreshHz, worstCase: w };
}

/**
 * Phase-5 plan conformance (Part 2 §14.2): the target window's plan-relevant records, in seq order, must match
 * plan.steps exactly. Top-level RQ post -> fit (a nested RQ pair is an open-world call, not a plan step); RS post ->
 * restore; T4 start -> settle(role), whose reqToken must be the latest top-level fit's token or a call nested in it;
 * C8 -> c8(mr). A c8 step is expected iff its settle's terminal decision is `settled` (a timed-out settle has no C8).
 * Returns { ok, findings }.
 */
export function planConformance(plan, win) {
  const F = [];
  const ops = []; const stack = []; let group = null; let lastGroup = new Set(); let cur = null;
  for (const r of win) {
    if (r.k === 'RQ' && r.pp === 'pre') { if (!stack.length) group = new Set(); group.add(r.r); stack.push(r.r); }
    if (r.k === 'RQ' && r.pp === 'post') { stack.pop(); if (!stack.length) { ops.push({ op: 'fit' }); lastGroup = group; } }
    if (r.k === 'RS' && r.pp === 'post') ops.push({ op: 'restore' });
    if (r.k === 'T4' && r.tp === 'start') { cur = { op: 'settle', role: r.s, terminal: null }; ops.push(cur); if (!lastGroup.has(r.r)) F.push(`SETTLE-TOKEN:${r.q}`); }
    if (r.k === 'T4' && r.tp === 'decision' && r.te === 1 && cur) cur.terminal = r.d;
    if (r.k === 'C8') ops.push({ op: 'c8', role: r.mr });
  }
  const steps = Array.isArray(plan && plan.steps) ? plan.steps : [];
  let j = 0; let lastTerminal = null;
  steps.forEach((st, i) => {
    if (st.op === 'c8' && lastTerminal !== 'settled') { return; } // expected absent: checked by the next step / the tail
    const o = ops[j];
    if (!o || o.op !== st.op || (st.role !== undefined && o.role !== st.role)) { F.push(`STEP:${i}`); return; }
    if (o.op === 'settle') lastTerminal = o.terminal;
    j += 1;
  });
  if (F.length === 0 && j !== ops.length) F.push(`EXTRA:${ops.slice(j).map((o) => o.op + (o.role ? `:${o.role}` : '')).join(',')}`);
  return { ok: F.length === 0, findings: F };
}

/** Validates a pre-registered target plan. Returns { ok, findings, targets: [{..., supportReachable, rejectReachable, oneSided}] }. */
export function validateTargetPlan(plan, { contract, slotWindow }) {
  const vt = contract.verdictTable;
  const F = [];
  const targets = [];
  if (!isPlain(plan) || !Array.isArray(plan.targets)) return { ok: false, findings: ['TARGET-PLAN-SHAPE'], targets };
  const S = vt.targetPlanSchema;
  if (Object.keys(plan).some((k) => !S.fields.includes(k)) || typeof plan.planId !== 'string' || !new RegExp(S.planIdPattern).test(plan.planId)) F.push('TARGET-PLAN-SHAPE');
  for (const x of validatePlanSteps(plan, contract)) F.push(`PLAN-STEPS:${x}`);
  const ids = new Set();
  for (const t of plan.targets) {
    if (!isPlain(t) || typeof t.targetId !== 'string' || ids.has(t.targetId)) { F.push('TARGET-ID'); continue; }
    ids.add(t.targetId);
    if (Object.keys(t).some((k) => !S.targetFields.includes(k))) { F.push(`TARGET-SHAPE:${t.targetId}`); continue; }
    if (!vt.soundQuestions.includes(t.questionId)) { F.push(`UNSOUND-QUESTION:${t.targetId}`); continue; }
    const sup = Array.isArray(t.supportLabels) ? t.supportLabels : null; const rej = Array.isArray(t.rejectLabels) ? t.rejectLabels : null;
    if (!sup || !rej || typeof t.primary !== 'boolean') { F.push(`TARGET-SHAPE:${t.targetId}`); continue; }
    if (sup.some((l) => rej.includes(l))) F.push(`LABEL-OVERLAP:${t.targetId}`);
    const inDomain = (l) => (t.questionId === 'Q-ATTR' ? /^[1-9][0-9]*(,[1-9][0-9]*)*$/.test(l) && l.split(',').map(Number).every((x, i, a) => i === 0 || a[i - 1] < x) : vt.preregistrableLabels[t.questionId].includes(l));
    for (const l of [...sup, ...rej]) {
      if ((vt.forbiddenLabels[t.questionId] || []).includes(l) || !inDomain(l)) F.push(`LABEL-OUT-OF-DOMAIN:${t.targetId}`);
    }
    const reach = (l) => (slotWindow === 'OPEN' ? vt.openReachableLabels[t.questionId].includes(l) : true);
    const supportReachable = sup.some(reach); const rejectReachable = rej.some(reach);
    if (!supportReachable && !rejectReachable) F.push(`UNREACHABLE:${t.targetId}`);
    targets.push({ ...t, supportReachable, rejectReachable, oneSided: supportReachable !== rejectReachable });
  }
  if (!plan.targets.some((t) => isPlain(t) && t.primary === true)) F.push('NO-PRIMARY-TARGET');
  return { ok: F.length === 0, findings: [...new Set(F)].sort(), targets };
}

// ---------------------------------------------------------------- target rules T0–T6 (Part 2 §14.3)

const dependsOnVEdge = (questionId, label) => questionId === 'Q-OWNER' || questionId === 'Q-SUBJ' || (questionId === 'Q-ATTR' && typeof label === 'string' && label !== '-');

function coverage(label, qr) {
  if (label === 'RESTORE') return 'CONTROLLED';
  if (label === 'PENDING') return 'MECHANISM_ONLY';
  if (qr && qr.assumption && (['OWN', 'PRIOR_TERMINAL', 'IN_FLIGHT'].includes(label) || /^[0-9,]+$/.test(String(label)))) return 'CONTROLLED';
  return 'NONE';
}

/**
 * One target's verdict. ctx: { runVerdict, cg, preMotionUnresolved, slotWindow, edgeInit, rg, forbiddenLabels }.
 * Returns { verdict, reason, allReasons }: `reason` is the first matching rule's; `allReasons` lists every
 * applicable INCONCLUSIVE rule in rule order (diagnostic only; the verdict is the first match).
 */
export function targetVerdict(t, qr, ctx) {
  const reasons = [];
  if (ctx.runVerdict === 'BLOCKED' || ctx.runVerdict === 'INVALID') return { verdict: ctx.runVerdict, reason: 'INHERITED', allReasons: ['INHERITED'] };
  if (ctx.cg === 1) reasons.push('CLASS_NONTRANSITIVE');
  if (ctx.sourceFactContradiction) reasons.push(ctx.sourceFactContradiction); // T0c
  const status = qr ? qr.status : VERDICT.UNDIAGNOSABLE;
  if (status !== VERDICT.DEFINITE) reasons.push(ctx.renameReason(qr ? qr.reason : 'MISSING_QUESTION'));
  if (ctx.preMotionUnresolved && (t.questionId === 'Q-OWNER' || (t.questionId === 'Q-SUBJ' && status !== VERDICT.DEFINITE))) reasons.push('PRE_MOTION_UNRESOLVED');
  const label = qr ? qr.label : undefined;
  // T1c (Part 1 §10.4): CLEAR_WITHOUT_EDGE makes the cleared token's identity ambiguous in both modes
  const cleared = ctx.clearedTokens || [];
  if (cleared.length && ((t.questionId === 'Q-SUBJ' && cleared.includes(ctx.subjectToken))
    || (t.questionId === 'Q-OWNER' && ['OWN', 'PRIOR_TERMINAL', 'IN_FLIGHT'].includes(label))
    || (t.questionId === 'Q-ATTR' && typeof label === 'string' && label !== '-' && label.split(',').map(Number).some((x) => cleared.includes(x))))) reasons.push('IDENTITY_AMBIGUOUS:CLEAR_WITHOUT_EDGE');
  if (qr && own(qr, 'assumption') && ctx.slotWindow !== 'ASSUME_NO_UNOBSERVED_WRITER') reasons.push('ASSUMPTION_NOT_AUTHORIZED');
  const vEdge = dependsOnVEdge(t.questionId, label);
  if (vEdge && ctx.edgeInit !== 'LOW') reasons.push('EDGE_INIT_UNKNOWN');
  if (vEdge && ctx.rg !== true) reasons.push('VB3_NOT_REPRESENTATIVE');
  // belt and braces (fail closed): a never-definite label or the empty attribution is never evidence
  if (status === VERDICT.DEFINITE && ((ctx.forbiddenLabels[t.questionId] || []).includes(label))) reasons.push('FORBIDDEN_LABEL');
  if (reasons.length) return { verdict: 'INCONCLUSIVE', reason: reasons[0], allReasons: reasons };
  if (t.rejectLabels.includes(label)) return { verdict: 'REJECTED', reason: 'PREREGISTERED_REJECT', allReasons: ['PREREGISTERED_REJECT'] };
  if (t.supportLabels.includes(label)) return { verdict: 'SUPPORTED', reason: 'PREREGISTERED_SUPPORT', allReasons: ['PREREGISTERED_SUPPORT'] };
  return { verdict: 'INCONCLUSIVE', reason: 'LABEL_NOT_PREREGISTERED', allReasons: ['LABEL_NOT_PREREGISTERED'] };
}

// ---------------------------------------------------------------- run evaluation (Part 2 §14.4)

const ROLES = ['T', 'PC-1', 'PC-2', 'PC-4', 'PC-5'];

/**
 * Evaluates one future-run scenario end to end. scenario: {
 *   attemptConsumed: bool, stop: null | {id, class: 'a'|'b'|'c'},
 *   traces: { T?: records|null, 'PC-1'?: ..., 'PC-2'?, 'PC-4'?, 'PC-5'? } (records = [META, ...data, END]) or
 *           { parseError: code } for an unparsable raw file,
 *   binding, targetPlan, ncRerunOk: bool, ledgerOk: bool, metaTemplates?: {role: frozen META template} }.
 * ncRerunOk / ledgerOk pass only when exactly `true` (absent or non-boolean => INVALID, fail closed). The target plan
 * must hash to binding.targetPlanSha256 and every META.tq, and the target trace must conform to its steps.
 * Returns a TERMINAL-VERDICT-shaped object (without file digests). Deterministic and total.
 */
export function evaluateScenario(scenario, { contract }) {
  try { return evaluateScenarioInner(scenario, contract); } catch (e) {
    return { runVerdict: 'INVALID', runReasons: ['EVALUATOR_EXCEPTION'], targets: [], controls: {}, integrity: {}, annotations: null, scope: 'NEW_RUN_ONLY', historicalStatus: contract.verdictTable.historicalStatusConstants };
  }
}
function evaluateScenarioInner(sc, contract) {
  const vt = contract.verdictTable;
  const base = { scope: vt.scope, historicalStatus: { ...vt.historicalStatusConstants }, stopCondition: sc.stop ? sc.stop.id : null, attemptConsumed: sc.attemptConsumed === true };
  const blocked = (reasons) => ({ ...base, runVerdict: 'BLOCKED', runReasons: reasons, targets: planTargets(sc).map((t) => ({ ...tShell(t), verdict: 'BLOCKED', reason: 'INHERITED', allReasons: ['INHERITED'] })), controls: {}, integrity: {}, annotations: null, c8: [] });
  // V1
  if (sc.attemptConsumed !== true) return blocked([sc.stop ? `STOP:${sc.stop.id}` : 'ATTEMPT_NOT_CONSUMED']);
  const traces = isPlain(sc.traces) ? sc.traces : {};
  // integrity per present trace
  const integrity = {};
  for (const role of ROLES) {
    const t = traces[role];
    if (t === undefined || t === null) continue;
    if (isPlain(t) && own(t, 'parseError')) { integrity[role] = { ok: false, errors: [t.parseError] }; continue; }
    const template = isPlain(sc.metaTemplates) && own(sc.metaTemplates, role) ? sc.metaTemplates[role] : undefined; // frozen META template (§12.3), when supplied
    const v = validateTraceV2(t, { contract, role, binding: sc.binding, template });
    integrity[role] = { ok: v.ok, errors: v.errors };
  }
  const ok = (role) => integrity[role] && integrity[role].ok;
  const recs = (role) => (ok(role) ? traces[role] : null);
  const tRecs = recs('T');
  const tMeta = tRecs ? tRecs[0] : null; const tEnd = tRecs ? tRecs[tRecs.length - 1] : null; const tData = tRecs ? tRecs.slice(1, -1) : null;
  // controls (PC-1..PC-5, RG)
  const controls = evaluateControls({ traces: { 'PC-1': recs('PC-1'), 'PC-2': recs('PC-2'), 'PC-4': recs('PC-4'), 'PC-5': recs('PC-5'), T: tRecs }, present: Object.fromEntries(ROLES.map((r) => [r, traces[r] !== undefined && traces[r] !== null])), contract });
  // target plan
  const sw = tMeta ? tMeta.sw : (sc.binding && sc.binding.slotWindow) || 'OPEN';
  const plan = validateTargetPlan(sc.targetPlan, { contract, slotWindow: sw });
  // V2 reasons
  const R = [];
  if (sc.stop && sc.stop.class === 'b') R.push(`STOP_CLASS_B:${sc.stop.id}`);
  if (sc.stop && sc.stop.class === 'a') R.push(`STOP_CLASS_A_AFTER_CONSUMPTION:${sc.stop.id}`); // inconsistent input: fail closed
  if (!traces.T) R.push('TARGET_TRACE_ABSENT');
  for (const role of ROLES) if (integrity[role] && !integrity[role].ok) R.push(`INTEGRITY:${role}`);
  for (const pc of vt.requiredPositiveControls) if (controls[pc].outcome !== 'PASSED') R.push(`CONTROL_NOT_PASSED:${pc}`);
  if (tData) {
    const fin = tData.find((r) => r.k === 'TZ' && r.zp === 'final');
    if (!fin || fin.zc !== 'normal') R.push('FINAL_TZ_CAUSE_NOT_NORMAL');
    if (tData.some((r) => r.k === 'TZ' && r.zp === 'targetEnd' && r.zc !== 'normal')) R.push('TARGET_END_TZ_CAUSE_NOT_NORMAL'); // stricter than V2 (NOTES.md)
  }
  // external Phase-5 gates: only an explicit boolean true passes (absent / mistyped fails closed)
  if (typeof sc.ncRerunOk !== 'boolean') R.push('NEGATIVE_CONTROL_RERUN_UNKNOWN'); else if (sc.ncRerunOk !== true) R.push('NEGATIVE_CONTROL_RERUN_MISMATCH');
  if (typeof sc.ledgerOk !== 'boolean') R.push('HASH_LEDGER_UNKNOWN'); else if (sc.ledgerOk !== true) R.push('HASH_LEDGER_INCONSISTENT');
  if (!plan.ok) R.push('TARGET_PLAN_INVALID');
  // pre-registration binding (§14.2): the plan evaluated is the plan bound by digest, and the plan every trace carries
  const planSha = targetPlanDigest(sc.targetPlan);
  for (const k of Object.keys(traces)) if (!ROLES.includes(k)) R.push(`UNKNOWN_TRACE_ROLE:${k}`); // strict scenario input
  const rawMetas = Object.values(traces).filter((t) => Array.isArray(t) && isPlain(t[0])).map((t) => t[0]);
  if (planSha === null || !isPlain(sc.binding) || sc.binding.targetPlanSha256 !== planSha || rawMetas.some((m) => m.tq !== planSha)) R.push('TARGET_PLAN_DIGEST_MISMATCH');
  // control-trace run linkage (§12.3: control META.run = <target run>-pcN)
  if (tMeta) for (const pc of ['PC-1', 'PC-2', 'PC-4', 'PC-5']) { const c = recs(pc); if (c && c[0].run !== `${tMeta.run}-${pc.toLowerCase().replace('-', '')}`) R.push(`CONTROL_RUN_NOT_LINKED:${pc}`); }
  // trace-to-plan conformance (§14.2), on an intact target trace and a valid plan
  if (tData && plan.ok) { const conf = planConformance(sc.targetPlan, targetWindow(tData)); if (!conf.ok) R.push('TARGET_PLAN_NONCONFORMANT'); }
  for (const role of ROLES) {
    const errs = integrity[role] ? integrity[role].errors : [];
    if (errs.includes('BINDING-MISMATCH')) R.push(`BINDING_MISMATCH:${role}`);
    if (errs.includes('OBSERVED_VIEWER_NOT_BOUND')) R.push(`OBSERVED_VIEWER_NOT_BOUND:${role}`);
    if (errs.includes('OBSERVED_BUNDLE_NOT_BOUND')) R.push(`OBSERVED_BUNDLE_NOT_BOUND:${role}`);
  }
  // correlation of the target (only on an intact target trace)
  let corr = null; let ann = null; let c8 = [];
  if (tData) {
    const effPc = tEnd.pc['VB-3'] === 1 && controls['PC-3'].outcome === 'PASSED' ? 1 : 0;
    corr = correlateTraceWindow(tData, { meta: tMeta, effectivePcVb3: effPc, contract });
    if (corr.contradiction) R.push(`TARGET_PROJECTION_CONTRADICTION:${corr.contradiction}`);
    if (corr.malformed) R.push('TARGET_PROJECTION_MALFORMED');
    ann = annotate(tData, { slotWindow: tMeta.sw });
    c8 = c8Numeric(tData);
  }
  const runInvalid = R.length > 0;
  // SC-C04 (T0c): the mechanical TOKEN_REAPPEARED case, or any other contradiction raised as a class-c SC-C04 stop
  const contradiction = ann && ann.tokenReappeared ? 'SOURCE_FACT_CONTRADICTION:TOKEN_REAPPEARED'
    : sc.stop && sc.stop.class === 'c' && sc.stop.id === 'SC-C04' ? 'SOURCE_FACT_CONTRADICTION:SC-C04' : null;
  const withheldBy = sc.stop && sc.stop.class === 'c' && ['SC-C03', 'SC-C04'].includes(sc.stop.id) ? sc.stop.id : contradiction ? 'SC-C04' : null;
  const withheld = withheldBy !== null;
  // targets
  const ctx = {
    runVerdict: runInvalid ? 'INVALID' : null, cg: tEnd ? tEnd.cg : 1, preMotionUnresolved: ann ? ann.preMotionUnresolved : true,
    sourceFactContradiction: contradiction, clearedTokens: ann ? ann.clearedWithoutEdge : [], subjectToken: ann ? ann.subjectToken : null,
    slotWindow: sw, edgeInit: tMeta ? tMeta.ei : 'UNKNOWN', rg: controls.RG === true, forbiddenLabels: vt.forbiddenLabels,
    renameReason: (r) => (r === 'TRUNCATED' && ann && ann.zeroSampleSubjectTimeout ? 'NO_DECIDING_SAMPLE' : r),
  };
  const targets = planTargets(sc, plan).map((t) => {
    const qr = corr && corr.questions ? corr.questions[t.questionId] : null;
    const tv = targetVerdict(t, qr, ctx);
    return { ...tShell(t), status: qr ? qr.status : null, label: qr && own(qr, 'label') ? qr.label : null, assumption: qr && own(qr, 'assumption') ? qr.assumption : null, questionReason: qr && own(qr, 'reason') ? ctx.renameReason(qr.reason) : null, ...tv, controlCoverage: coverage(qr ? qr.label : null, qr) };
  });
  // run verdict V2..V5
  let runVerdict; let runReasons;
  const primary = targets.filter((t) => t.primary);
  if (runInvalid) { runVerdict = 'INVALID'; runReasons = R; }
  else if (primary.length === 0) { runVerdict = 'INVALID'; runReasons = ['NO_PRIMARY_TARGET']; }
  else if (primary.some((t) => t.verdict === 'INCONCLUSIVE')) { runVerdict = 'INCONCLUSIVE'; runReasons = [...new Set(primary.filter((t) => t.verdict === 'INCONCLUSIVE').map((t) => `${t.targetId}:${t.reason}`))]; }
  else if (primary.some((t) => t.verdict === 'REJECTED')) { runVerdict = 'REJECTED'; runReasons = primary.filter((t) => t.verdict === 'REJECTED').map((t) => `${t.targetId}:${t.reason}`); }
  else if (primary.every((t) => t.verdict === 'SUPPORTED') && tMeta.ei === 'LOW' && tEnd.cg === 0) { runVerdict = 'SUPPORTED'; runReasons = primary.map((t) => `${t.targetId}:${t.reason}`); }
  else { runVerdict = 'INCONCLUSIVE'; runReasons = ['V5_PRECONDITION_NOT_MET']; }
  if (sc.stop && sc.stop.class === 'c') runReasons = [...runReasons, `STOP_CLASS_C:${sc.stop.id}`];
  if (contradiction && !runInvalid) runReasons = [...new Set([...runReasons, contradiction])];
  return {
    ...base, runVerdict, runReasons, verdictWithheld: withheld, withheldBy, targets,
    controls: { ...Object.fromEntries(['PC-1', 'PC-2', 'PC-3', 'PC-4', 'PC-5'].map((k) => [k, controls[k].outcome])), RG: controls.RG === true },
    boundary: { edgeInit: tMeta ? tMeta.ei : null, classGateFailed: tEnd ? tEnd.cg : null, slotWindow: sw },
    controlDetail: controls,
    integrity,
    annotations: ann ? { preMotionUnresolved: ann.preMotionUnresolved, gapClasses: ann.gapClasses, gaps: ann.gaps, gapIntersectsSubjectWindow: ann.gapIntersectsSubjectWindow } : null,
    correlation: corr ? { questions: corr.questions, atoms: corr.atoms, vbUnavailable: corr.guard.vbUnavailable, unrepresentable: corr.unrepresentable, contradiction: corr.contradiction, malformed: corr.malformed, projectedCount: corr.projected ? corr.projected.length : null } : null,
    c8,
  };
}

function planTargets(sc, plan) {
  if (plan) return plan.targets;
  return isPlain(sc.targetPlan) && Array.isArray(sc.targetPlan.targets) ? sc.targetPlan.targets.filter(isPlain) : [];
}
const tShell = (t) => ({ targetId: t.targetId, questionId: t.questionId, primary: t.primary === true, oneSided: t.oneSided === true });

// ---------------------------------------------------------------- independent soundness audit

/**
 * Re-checks, independently of the rule engine, that a SUPPORTED/REJECTED outcome (run or target) rests only on an
 * intact, bound, controlled, LOW-boundary, class-transitive trace with a DEFINITE, assumption-free (unless ASSUME was
 * bound) label, and that pre-motion never supports an owner label. Returns a sorted list of violations ([] = sound).
 */
export function auditResult(res, scenario) {
  const V = [];
  const positive = (v) => v === 'SUPPORTED' || v === 'REJECTED';
  const anyPositive = positive(res.runVerdict) || (res.targets || []).some((t) => positive(t.verdict));
  if (!anyPositive) return V;
  if (scenario !== undefined) for (const v of auditRaw(scenario)) V.push(v);
  if (scenario !== undefined) for (const v of auditInputs(scenario)) V.push(v);
  if (res.verdictWithheld === true) V.push('POSITIVE_WHILE_WITHHELD');
  if (res.attemptConsumed !== true) V.push('POSITIVE_WITHOUT_CONSUMED_ATTEMPT');
  for (const [role, i] of Object.entries(res.integrity || {})) if (!i.ok) V.push(`POSITIVE_WITH_INTEGRITY_FAILURE:${role}`);
  if (!res.integrity || !res.integrity.T || !res.integrity.T.ok) V.push('POSITIVE_WITHOUT_INTACT_TARGET');
  for (const pc of ['PC-1', 'PC-2', 'PC-4', 'PC-5']) if (!res.controls || res.controls[pc] !== 'PASSED') V.push(`POSITIVE_WITHOUT_CONTROL:${pc}`);
  if (!res.controls || res.controls.RG !== true) V.push('POSITIVE_WITHOUT_RG');
  if (!res.boundary || res.boundary.edgeInit !== 'LOW') V.push('POSITIVE_WITHOUT_LOW_BOUNDARY');
  if (!res.boundary || res.boundary.classGateFailed !== 0) V.push('POSITIVE_WITH_CLASS_GATE_FAILURE');
  if (res.correlation && (res.correlation.contradiction || res.correlation.malformed || res.correlation.unrepresentable)) V.push('POSITIVE_WITH_CORRELATOR_FAILURE');
  for (const t of res.targets || []) {
    if (!positive(t.verdict)) continue;
    if (t.status !== 'DEFINITE') V.push(`POSITIVE_FROM_NON_DEFINITE:${t.targetId}`);
    if (t.assumption && (!res.boundary || res.boundary.slotWindow !== 'ASSUME_NO_UNOBSERVED_WRITER')) V.push(`POSITIVE_FROM_ASSUMPTION_UNDER_OPEN:${t.targetId}`);
    if (res.annotations && res.annotations.preMotionUnresolved && t.questionId === 'Q-OWNER') V.push(`POSITIVE_OWNER_UNDER_PRE_MOTION:${t.targetId}`);
    if (['FOREIGN', 'ACTIVE0', '-'].includes(t.label)) V.push(`POSITIVE_FROM_FORBIDDEN_LABEL:${t.targetId}`);
  }
  if (positive(res.runVerdict) && (res.targets || []).filter((t) => t.primary).some((t) => !positive(t.verdict))) V.push('POSITIVE_RUN_WITH_NON_POSITIVE_PRIMARY');
  return [...new Set(V)].sort();
}

export { TZ_CAUSE_CODE };

/**
 * Raw-record re-checks used by auditResult for positive outcomes, written independently of trace-schema.mjs and
 * controls.mjs (defence in depth against a validator or control-pattern gap): every RQ/RS post has its pre (RS
 * adjacent), the target starts with the capture-start FS, every trace is LOW-bounded, the PC-3 control window holds
 * exactly one fit and one rise/fall pair, and PC-4 uses two distinct fits for its S and P settles.
 */
export function auditRaw(scenario) {
  const V = [];
  const traces = isPlain(scenario) && isPlain(scenario.traces) ? scenario.traces : {};
  const T = Array.isArray(traces.T) ? traces.T : null;
  if (!T) return ['RAW_TARGET_ABSENT'];
  for (const [role, recs] of Object.entries(traces)) {
    if (!Array.isArray(recs) || !recs.length) { V.push(`RAW_TRACE_ABSENT:${role}`); continue; }
    const data = recs.slice(1, -1);
    if (!isPlain(recs[0]) || recs[0].ei !== 'LOW') V.push(`RAW_BOUNDARY_NOT_LOW:${role}`);
    data.forEach((r, i) => {
      if (r.k === 'RS' && r.pp === 'post' && !(i > 0 && data[i - 1].k === 'RS' && data[i - 1].pp === 'pre' && data[i - 1].q + 1 === r.q)) V.push(`RAW_RS_POST_WITHOUT_PRE:${role}`);
      if (r.k === 'RQ' && r.pp === 'post' && !data.slice(0, i).some((x) => x.k === 'RQ' && x.pp === 'pre' && x.r === r.r)) V.push(`RAW_RQ_POST_WITHOUT_PRE:${role}`);
    });
  }
  const tData = T.slice(1, -1);
  if (!(tData[0] && tData[0].k === 'FS' && tData[0].f === 0 && tData[0].tm === 0)) V.push('RAW_NO_CAPTURE_START');
  const te = tData.findIndex((r) => r.k === 'TZ' && r.zp === 'targetEnd');
  const cw = te >= 0 ? tData.slice(te + 1) : [];
  if (cw.filter((r) => r.k === 'RQ').length !== 2 || cw.filter((r) => r.k === 'TE').length !== 2) V.push('RAW_PC3_WINDOW_NOT_EXACT');
  // a token visible again after its object left the slot (source-fact contradiction, Part 1 §10.4a)
  const reads = te >= 0 ? tData.slice(0, te) : tData;
  const seen = new Map();
  for (const r of reads) {
    if (!((r.k === 'PS') || (r.k === 'RQ' && (r.pp === 'pre' || r.co === 'returned')) || (r.k === 'RS' && r.pp === 'post' && r.rs !== 'THROW'))) continue;
    const tok = r.sp === 1 && Number.isInteger(r.sb) ? r.sb : null;
    if (tok !== null && seen.get(tok) === 'gone') V.push('RAW_TOKEN_REAPPEARED');
    for (const [k, s] of seen) if (s === 'here' && k !== tok) seen.set(k, 'gone');
    if (tok !== null) seen.set(tok, 'here');
  }
  const pc4 = Array.isArray(traces['PC-4']) ? traces['PC-4'].slice(1, -1) : [];
  const starts = pc4.filter((r) => r.k === 'T4' && r.tp === 'start');
  const toks = new Set(pc4.filter((r) => r.k === 'RQ' && r.pp === 'post').map((r) => r.r));
  if (toks.size !== 2 || starts.length !== 2 || starts[0].r === starts[1].r) V.push('RAW_PC4_FITS_NOT_DISTINCT');
  return [...new Set(V)].sort();
}

/**
 * Scenario-input re-checks used by auditResult for positive outcomes (independent of the rule engine): the
 * evaluated plan is the bound plan (digest = binding.targetPlanSha256 = every META.tq), both external Phase-5 gates
 * are exactly true, and every control trace is linked to the target run (<run>-pcN).
 */
export function auditInputs(scenario) {
  const V = [];
  const sc = isPlain(scenario) ? scenario : {};
  const traces = isPlain(sc.traces) ? sc.traces : {};
  const T = Array.isArray(traces.T) ? traces.T : null;
  const d = targetPlanDigest(sc.targetPlan);
  if (d === null || !isPlain(sc.binding) || sc.binding.targetPlanSha256 !== d) V.push('INPUT_TARGET_PLAN_NOT_BOUND');
  for (const [role, recs] of Object.entries(traces)) if (Array.isArray(recs) && isPlain(recs[0]) && recs[0].tq !== d) V.push(`INPUT_TARGET_PLAN_NOT_IN_META:${role}`);
  if (sc.ncRerunOk !== true) V.push('INPUT_NC_RERUN_NOT_TRUE');
  if (sc.ledgerOk !== true) V.push('INPUT_LEDGER_NOT_TRUE');
  const run = T && isPlain(T[0]) ? T[0].run : null;
  for (const pc of ['PC-1', 'PC-2', 'PC-4', 'PC-5']) {
    const c = traces[pc];
    if (!Array.isArray(c) || !isPlain(c[0]) || run === null || c[0].run !== `${run}-${pc.toLowerCase().replace('-', '')}`) V.push(`INPUT_CONTROL_NOT_LINKED:${pc}`);
  }
  return [...new Set(V)].sort();
}
