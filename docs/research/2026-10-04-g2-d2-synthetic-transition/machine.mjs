// Viewer-like synthetic transition state machine + T4 + oracle + classifier (spec §5–§8).
// [SYN] research tooling: nothing here is historical Viewer behaviour. Pure, deterministic, +−×÷ only.
import { phi, cameraSamplesWithin, ORD_NAMES } from './contract.mjs';

export const STALE_CLASSES = ['STALE_PRIOR_TERMINAL', 'STALE_RESTORE', 'STALE_INIT', 'STALE_IN_FLIGHT'];
export const ALL_CLASSES = ['PRECONDITION_BLOCKED', 'HARNESS_ABORT', 'TIMED_OUT', 'INVALID_AMBIGUOUS', 'OWNED', ...STALE_CLASSES];

const cmpKey = (a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
const ownerTerminal = (k) => `T${k}*`;
const ownerStep = (k) => `T${k}`;

/** Spec §7.4 decision list — first match wins. Pure. */
export function classify(i) {
  if (i.preconditionBlocked) return 'PRECONDITION_BLOCKED';
  if (i.harnessAbort) return 'HARNESS_ABORT';
  if (i.t4Status === 'timeout') return 'TIMED_OUT';
  const own = i.ownerAtSample;
  const subjStar = ownerTerminal(i.subject);
  if ((own === subjStar && !i.withinDest) || (i.withinDest && own !== subjStar)) return 'INVALID_AMBIGUOUS';
  if (own === subjStar) return 'OWNED';
  if (/^T\d\*$/.test(own)) return 'STALE_PRIOR_TERMINAL';
  if (own === 'RESTORE') return 'STALE_RESTORE';
  if (own === 'INIT') return 'STALE_INIT';
  return 'STALE_IN_FLIGHT'; // T(j) non-terminal
}

export function mechanismLabels(i, cls, L) {
  const labels = [];
  if (i.subjState === 'PENDING' || i.subjState === 'ACTIVE0') labels.push('M-PRE');
  if (cls === 'STALE_PRIOR_TERMINAL' && i.subjState === 'PENDING' && !i.transitionActive) labels.push('M-GAP');
  if (cls === 'STALE_RESTORE') labels.push('M-RST');
  if (cls === 'STALE_IN_FLIGHT' && L >= 1) labels.push('M-TAIL');
  return labels;
}

/** Invariant checks over a recorded log (pure, so tests can feed corrupted logs). Returns list of violated names. */
export function checkInvariants(log) {
  const v = new Set();
  // V0 causality
  for (const c of log.causality) if (!(cmpKey(c.issueKey, c.gateKey) > 0)) v.add('V0');
  // V1/V2/V4 token flow
  const terminals = {};
  for (const t of log.terminals) terminals[t.token] = (terminals[t.token] || 0) + 1;
  for (const k of Object.keys(terminals)) if (terminals[k] > 1) v.add('V1');
  if (log.oracleEvents.length !== log.terminals.length || log.completionLog.length !== log.terminals.length) v.add('V2');
  for (let n = 0; n < log.terminals.length; n += 1) {
    const t = log.terminals[n];
    const o = log.oracleEvents[n];
    // one-to-one: token, frame and the untagged completion frame must all agree
    if (!o || o.token !== t.token || o.frame !== t.frame || log.completionLog[n] !== t.frame || t.activeToken !== t.token) v.add('V2');
  }
  // V4/V3: explicit per-token state machine ABSENT -> fit -> PENDING -> {overwritten | consume -> ACTIVE -> terminal}
  const next = {
    ABSENT: { fit: 'PENDING' },
    PENDING: { overwritten: 'DISCARDED', consume: 'ACTIVE' },
    ACTIVE: { terminal: 'TERMINAL' },
  };
  for (const seq of Object.values(log.tokenLog)) {
    let state = 'ABSENT';
    for (const e of seq) {
      const to = next[state] && next[state][e];
      if (!to) { v.add('V4'); break; }
      state = to;
    }
    if (state === 'ACTIVE') v.add('V3'); // consumed but never completed within the cap
  }
  if (log.pendingAtCap) v.add('V3');
  // V5 numeric sanity
  if (!log.a3) v.add('V5');
  for (const s of log.steps) {
    if (s.kind === 'main' && !(s.change > 1e-9)) v.add('V5');
    if (s.kind === 'tail' && !(s.change <= 1e-9 && s.change > 0)) v.add('V5');
  }
  // V7 settle activation
  for (const a of log.activations) if (cmpKey(a.slotKey, a.fitKey) !== 0 || a.afterAbort) v.add('V7');
  return [...v].sort();
}

function mkPose(p) { return [p[0], p[1], p[2], p[3]]; }
const maxAbsDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i += 1) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; } return m; };

/** Trace-row cap (inclusive): JSON length <= cap passes; > cap throws. The only trace insertion path calls this. */
export function assertTraceRowWithinCap(row, cap) {
  if (JSON.stringify(row).length > cap) throw new Error(`trace row exceeds ${cap} B`);
}

/**
 * Run one schedule (shadow-complete). Returns { cls, labels, inv, oracle, t4, ... , trace? }.
 * `opts.trace` enables bounded trace rows; `opts.mutate` is a test-only fault-injection hook.
 */
export function runSchedule(sch, fx, opts = {}) {
  const { D, L, S, G } = sch;
  const ord = sch.ord;
  const posH = ord.indexOf('H');
  const cap = fx.domains.shadowCapFrame;
  const tau = fx.tail.tau;
  const timeout = fx.t4.timeoutSamples;
  const tol = fx.t4.toleranceAbs;
  const home = fx.pose.home;
  const dest = { 1: fx.pose.dest['1'], 2: fx.pose.dest['2'] };
  const phiDest = { 1: phi(dest[1]), 2: phi(dest[2]) };
  const syncNext = sch.rv === 'OK-NEXT';
  const isCL = sch.mode === 'CL';
  const subject = sch.family === 'F0' ? 1 : 2;
  const gated = isCL && sch.family !== 'F0';

  const st = {
    pending: null, active: null, tActive: false, progress: 0,
    cam: mkPose(home), auto: mkPose(home), owner: 'INIT', flag: 0, delayLeft: -1,
    tailBase: null,
  };
  const log = {
    causality: [], terminals: [], oracleEvents: [], completionLog: [], tokenLog: { 1: [], 2: [] },
    steps: [], activations: [], a3: true, pendingAtCap: false,
  };
  const a3 = (() => {
    const a = phi(home); const b = phiDest[1]; const c = phiDest[2];
    return !cameraSamplesWithin(a, b, tol) && !cameraSamplesWithin(a, c, tol) && !cameraSamplesWithin(b, c, tol);
  })();
  log.a3 = a3;

  const trace = opts.trace ? [] : null;
  let aborted = false;
  let preconditionBlocked = false;
  const settles = []; // {role, startFrame, firstFrame, prev, n, status}
  const fitKeys = {};
  let gateReturn = null; // {frame} when gate settle returned settled/timeout
  const extEvents = new Map(); // frame -> ops[] (fixed OP events, plus dynamic CL)
  const addExt = (f, ops) => { extEvents.set(f, [...(extEvents.get(f) || []), ...ops]); };
  const subjRes = {};
  let t4Done = false;
  let subjectRecord = null;
  let restoreCalled = false;
  let shadowEnd = -1;

  // ---- schedule construction
  addExt(0, ['fit1']);
  if (sch.family === 'F0') addExt(0, ['act1:subject']);
  else if (isCL) addExt(0, ['act1:gate']);
  if (!isCL) {
    if (sch.family === 'F1') addExt(sch.tN, ['fit2', 'act2:subject']);
    else {
      addExt(sch.r, ['restore']);
      addExt(sch.r + sch.rho, ['fit2', 'act2:subject']);
    }
  }

  const row = (f, ph, ev, smp, out) => {
    if (!trace) return;
    const r = [f, ph, ev, st.pending ? st.pending.token : 0, st.active ? st.active.token : 0, st.progress, st.owner, st.tActive ? 1 : 0, smp, out];
    assertTraceRowWithinCap(r, fx.caps.traceRowBytes);
    trace.push(r);
  };

  const doFit = (k, key, f, ph) => {
    if (st.pending) log.tokenLog[st.pending.token].push('overwritten');
    st.pending = { token: k, dest: dest[k] };
    log.tokenLog[k].push('fit');
    fitKeys[k] = key;
    row(f, ph, `fit${k}`, '-', '-');
  };
  const doRestore = (f, ph) => {
    restoreCalled = true;
    if (sch.rv === 'THROW') { aborted = true; row(f, ph, 'restoreTHROW', '-', 'abort'); return; }
    if (sch.rv === 'NOOP') { row(f, ph, 'restoreNOOP', '-', '-'); return; }
    st.cam = mkPose(home); st.owner = 'RESTORE'; st.flag = 1;
    row(f, ph, 'restoreOK', '-', '-');
  };

  /** Execute harness ops in one slot; ops after an abort are cancelled. */
  const execOps = (ops, f, kind) => {
    const key = kind === 'EXT' ? [f, -1] : [f, posH + 0.5];
    const ph = kind === 'EXT' ? 'X' : '+';
    for (const op of ops) {
      if (aborted) break;
      if (op === 'fit1') doFit(1, key, f, ph);
      else if (op === 'fit2') doFit(2, key, f, ph);
      else if (op === 'restore') doRestore(f, ph);
      else if (op.startsWith('act')) {
        const k = Number(op[3]);
        const role = op.split(':')[1];
        const first = kind === 'EXT' ? f + G : f + 1 + G;
        settles.push({ role, startFrame: f, firstFrame: first, prev: null, n: 0, status: 'running', forFit: k });
        log.activations.push({ slotKey: key, fitKey: fitKeys[k], afterAbort: aborted });
      }
    }
  };

  const stepBlend = (k, i) => {
    // returns pose for a non-final step i of request k (1 <= i <= D-1)
    if (L >= 1 && i >= D - L) {
      const base = st.tailBase;
      const p = mkPose(base); p[0] = base[0] + (i - (D - L - 1)) * tau;
      return { pose: p, kind: 'tail' };
    }
    const s = i / D;
    const u = s * s * (3 - 2 * s);
    const d = dest[k]; const a = st.auto;
    const p = [0, 1, 2, 3].map((c) => (1 - u) * a[c] + u * d[c]);
    return { pose: p, kind: 'main' };
  };

  const subjState = () => {
    if (st.pending && st.pending.token === subject) return 'PENDING';
    if (st.active && st.active.token === subject) return st.progress === 0 ? 'ACTIVE0' : 'ACTIVE+';
    if (log.terminals.some((t) => t.token === subject)) return 'COMPLETE';
    return 'PENDING';
  };

  const phaseH = (f) => {
    const returned = [];
    for (const s of settles) {
      if (s.status !== 'running' || f < s.firstFrame) continue;
      const smp = phi(st.cam);
      s.n += 1;
      const ownerAt = st.owner;
      let out = 'none';
      if (s.prev !== null && cameraSamplesWithin(s.prev, smp, tol)) { s.status = 'settled'; out = 'settled'; }
      else { s.prev = smp; if (s.n >= timeout) { s.status = 'timeout'; out = 'timeout'; } }
      if (s.status !== 'running') {
        s.decisionFrame = f; s.ownerAtSample = ownerAt; s.subjState = subjState();
        s.tActive = st.tActive; s.sample = smp; returned.push(s);
      }
      if (out !== 'none' || s.n === 1) row(f, 'H', `s${s.role[0]}${s.n}`, out === 'none' ? '-' : out, '-');
    }
    return returned;
  };

  const phaseA = (f) => {
    if (!st.tActive) return;
    st.progress += 1;
    const k = st.active.token;
    if (st.progress === D) {
      st.cam = mkPose(dest[k]); st.auto = mkPose(dest[k]); st.owner = ownerTerminal(k);
      st.tActive = false;
      log.completionLog.push(f);
      log.oracleEvents.push({ token: k, frame: f });
      log.terminals.push({ token: k, frame: f, activeToken: st.active.token });
      log.tokenLog[k].push('terminal');
      st.active = null; st.flag = 1;
      row(f, 'A', 'final', '-', `c${k}`);
    } else {
      const before = st.auto;
      const { pose, kind } = stepBlend(k, st.progress);
      let change;
      if (kind === 'tail') {
        const i = st.progress;
        const prevTail = i === D - L ? st.tailBase : (() => { const q = mkPose(st.tailBase); q[0] = st.tailBase[0] + (i - 1 - (D - L - 1)) * tau; return q; })();
        change = maxAbsDiff(phi(pose), phi(prevTail));
      } else change = maxAbsDiff(phi(pose), phi(before));
      log.steps.push({ kind, change });
      st.cam = mkPose(pose); st.auto = mkPose(pose); st.owner = ownerStep(k); st.flag = 1;
      if (L >= 1 && st.progress === D - L - 1) st.tailBase = mkPose(pose);
      // trace elision (documented): intermediate steps are elided except first, last non-final and tail-start
      if (st.progress === 1 || st.progress === D - 1 || (L >= 1 && st.progress === D - L)) row(f, 'A', `s${st.progress}`, '-', '-');
    }
  };

  const phaseT = (f) => {
    let ev = '-';
    if (st.pending && !st.tActive) {
      if (st.delayLeft === -1) st.delayLeft = S;
      if (st.delayLeft > 0) { st.delayLeft -= 1; ev = 'skip'; }
      else {
        st.active = st.pending; st.pending = null; st.tActive = true; st.progress = 0; st.delayLeft = -1;
        log.tokenLog[st.active.token].push('consume');
        ev = `cons${st.active.token}`;
      }
    }
    // R: camera-change dispatch
    const before = st.flag;
    if (!syncNext) { if (st.flag >= 1) { st.auto = mkPose(st.cam); st.flag = 0; } }
    else if (st.flag === 2) { st.auto = mkPose(st.cam); st.flag = 0; }
    else if (st.flag === 1) st.flag = 2;
    if (ev !== '-') row(f, 'T', ev, '-', '-');
  };

  const quiescent = (f) => {
    if (st.pending || st.active || st.tActive) return false;
    if (settles.some((s) => s.status === 'running') && !aborted) return false;
    for (const k of extEvents.keys()) if (k > f && !aborted) return false;
    // oracle deliveries for e=0,1
    for (const e of log.oracleEvents) if (e.frame + 1 > f) return false;
    return true;
  };

  const oracleSnap = {}; // key `${token}|${e}` -> {owner}
  const takeOracle = (f) => {
    for (const ev of log.oracleEvents) for (const e of [0, 1]) {
      if (ev.frame + e === f) {
        oracleSnap[`${ev.token}|${e}`] = { owner: st.owner };
        row(f, 'O', `o${ev.token}e${e}`, '-', st.owner);
      }
    }
  };

  for (let f = 0; f <= cap; f += 1) {
    // 1. external events
    const ext = extEvents.get(f);
    if (ext && !aborted) {
      // causality bookkeeping for CL issue (the dynamic ops carry marker)
      execOps(ext, f, 'EXT');
    }
    // 2. phases
    for (const ph of ord) {
      if (ph === 'H') {
        const returned = phaseH(f);
        // H+ continuation
        for (const s of returned) {
          if (s.role === 'subject') { subjectRecord = s; t4Done = true; }
          if (s.role === 'gate' && !aborted) {
            gateReturn = { frame: f };
            if (s.status === 'timeout') preconditionBlocked = true;
            else {
              const ops0 = sch.family === 'F1' ? ['fit2', 'act2:subject']
                : (sch.rho === 0 ? ['restore', 'fit2', 'act2:subject'] : ['restore']);
              const gateKey = [f, posH];
              let slotFrame;
              if (sch.delta === 0) {
                slotFrame = f;
                log.causality.push({ issueKey: [f, posH + 0.5], gateKey });
                execOps(ops0, f, 'H+');
              } else {
                slotFrame = f + 1;
                log.causality.push({ issueKey: [f + 1, -1], gateKey });
                addExt(f + 1, ops0);
              }
              if (sch.family === 'F2' && sch.rho === 1) {
                log.causality.push({ issueKey: [slotFrame + 1, -1], gateKey });
                addExt(slotFrame + 1, ['fit2', 'act2:subject']);
              }
            }
          }
        }
      } else if (ph === 'A') phaseA(f);
      else phaseT(f);
    }
    // 3. oracle deliveries
    takeOracle(f);
    if (opts.mutate && opts.mutate.afterFrame) opts.mutate.afterFrame(f, st, log);
    if (quiescent(f)) { shadowEnd = f; break; }
  }
  if (shadowEnd === -1) { shadowEnd = cap; log.pendingAtCap = !!(st.pending || st.active); }
  if (opts.mutate && opts.mutate.log) opts.mutate.log(log);

  // ---- classification
  let cls; let labels = []; let inputs = null;
  if (preconditionBlocked) cls = 'PRECONDITION_BLOCKED';
  else if (aborted) cls = 'HARNESS_ABORT';
  else if (!subjectRecord) cls = 'TIMED_OUT'; // no decision recorded at all (should not happen in domain; flagged via E6)
  else {
    inputs = {
      preconditionBlocked, harnessAbort: aborted, t4Status: subjectRecord.status, subject,
      ownerAtSample: subjectRecord.ownerAtSample, subjState: subjectRecord.subjState,
      transitionActive: subjectRecord.tActive,
      withinDest: cameraSamplesWithin(subjectRecord.sample, phiDest[subject], tol),
    };
    cls = classify(inputs);
    labels = mechanismLabels(inputs, cls, L);
  }
  const oracle = {};
  if (STALE_CLASSES.includes(cls)) {
    for (const e of [0, 1]) {
      const snap = oracleSnap[`${subject}|${e}`];
      oracle[`e${e}`] = !snap ? 'NO_EVENT' : (snap.owner === ownerTerminal(subject) ? 'CURES' : 'NOT_CURED_OWNER_CHANGED');
    }
  }
  const inv = checkInvariants(log);
  void restoreCalled; void gateReturn; void subjRes; void t4Done; void ORD_NAMES;
  return {
    id: sch.id, cls, labels, inv, oracle, gated, shadowEnd,
    t4Frame: subjectRecord ? subjectRecord.decisionFrame : -1,
    t4Samples: subjectRecord ? subjectRecord.n : 0,
    stale: STALE_CLASSES.includes(cls),
    finalCam: st.cam, finalOwner: st.owner, terminalTokens: log.terminals.map((t) => t.token),
    tokenLog: log.tokenLog,
    trace,
  };
}
