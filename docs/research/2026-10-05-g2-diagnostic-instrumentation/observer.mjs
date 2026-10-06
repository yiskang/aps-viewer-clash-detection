// Observer replica (spec §7.2) + ground-truth DiagEvent emission (spec §7.3) + ground-truth labels (spec §8.2).
// [SYN] research tooling only. It re-executes the D2 machine semantics (machine.mjs runSchedule) step for step and
// additionally records ground-truth events. It is verified against D2's own runSchedule on every schedule (conformance.mjs).
// D2 pure helpers (classify, mechanismLabels, checkInvariants, phi, cameraSamplesWithin) are injected from the pinned load.

export const RELEVANT_CLASSES = ['OWNED', 'STALE_PRIOR_TERMINAL', 'STALE_RESTORE', 'STALE_INIT', 'STALE_IN_FLIGHT'];
const OWNER_OF_CLASS = {
  OWNED: 'OWN', STALE_PRIOR_TERMINAL: 'PRIOR_TERMINAL', STALE_IN_FLIGHT: 'IN_FLIGHT', STALE_RESTORE: 'RESTORE', STALE_INIT: 'INIT',
};

const cmpKey = (a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
const ownerTerminal = (k) => `T${k}*`;
const ownerStep = (k) => `T${k}`;
function mkPose(p) { return [p[0], p[1], p[2], p[3]]; }
const maxAbsDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i += 1) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; } return m; };

/**
 * Replica of D2 runSchedule (shadow-complete) with ground-truth emission.
 * Returns { res (D2-comparable fields), rows (unelided row stream), events (ground truth), gt (labels|null), meta }.
 * Ground-truth events are internal records: camera values are kept as `cam` (32 doubles) and never serialized;
 * slot objects are opaque integer handles (`pre.h` / `post.h`, 0 = null).
 */
export function observeSchedule(sch, fx, d2) {
  const { phi, cameraSamplesWithin, classify, mechanismLabels, checkInvariants, STALE_CLASSES } = d2;
  const { D, L, S, G } = sch;
  const ord = sch.ord;
  const posH = ord.indexOf('H');
  const posT = ord.indexOf('T');
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

  const st = {
    pending: null, active: null, tActive: false, progress: 0,
    cam: mkPose(home), auto: mkPose(home), owner: 'INIT', flag: 0, delayLeft: -1, tailBase: null,
  };
  const log = {
    causality: [], terminals: [], oracleEvents: [], completionLog: [], tokenLog: { 1: [], 2: [] },
    steps: [], activations: [], a3: true, pendingAtCap: false,
  };
  log.a3 = (() => {
    const a = phi(home); const b = phiDest[1]; const c = phiDest[2];
    return !cameraSamplesWithin(a, b, tol) && !cameraSamplesWithin(a, c, tol) && !cameraSamplesWithin(b, c, tol);
  })();

  const rows = [];
  const events = [];
  let handleSeq = 0;
  let aborted = false;
  let preconditionBlocked = false;
  const settles = [];
  const fitKeys = {};
  const extEvents = new Map(); // frame -> ops[] (internal only; never iterated into outputs)
  const addExt = (f, ops) => { extEvents.set(f, [...(extEvents.get(f) || []), ...ops]); };
  let subjectRecord = null;
  let shadowEnd = -1;
  let restorePre = null; // {variant, outstanding}
  const tOutcome = {}; // frame -> 'skip' | 'cons' | '-'

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
    rows.push([f, ph, ev, st.pending ? st.pending.token : 0, st.active ? st.active.token : 0, st.progress, st.owner, st.tActive ? 1 : 0, smp, out]);
  };
  const slotH = () => (st.pending ? st.pending.h : 0);
  const reads = () => ({ cam: phi(st.cam), post: { h: slotH() }, ac: st.tActive ? 1 : 0, ow: st.owner });

  const doFit = (k, key, f, ph) => {
    const pre = { h: slotH() };
    if (st.pending) log.tokenLog[st.pending.token].push('overwritten');
    handleSeq += 1;
    st.pending = { token: k, dest: dest[k], h: handleSeq };
    log.tokenLog[k].push('fit');
    fitKeys[k] = key;
    row(f, ph, `fit${k}`, '-', '-');
    events.push({ k: 'FIT', f, r: k, pre, ...reads() });
  };
  const doRestore = (f, ph) => {
    if (sch.rv === 'THROW') {
      aborted = true; row(f, ph, 'restoreTHROW', '-', 'abort');
      events.push({ k: 'RST', f, rs: 'THROW' });
      return;
    }
    restorePre = { variant: sch.rv, outstanding: !!(st.pending || st.tActive) };
    if (sch.rv === 'NOOP') {
      row(f, ph, 'restoreNOOP', '-', '-');
      events.push({ k: 'RST', f, rs: 'NOOP', ...reads() });
      return;
    }
    st.cam = mkPose(home); st.owner = 'RESTORE'; st.flag = 1;
    row(f, ph, 'restoreOK', '-', '-');
    events.push({ k: 'RST', f, rs: 'OK', ...reads() });
  };

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
        events.push({ k: 'SST', f, s: role === 'gate' ? 'G' : 'S', r: k });
      }
    }
  };

  const stepBlend = (k, i) => {
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
    events.push({ k: 'CAM', f, ...reads() });
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
      const ev = { k: 'SMP', f, s: s.role === 'gate' ? 'G' : 'S', n: s.n, d: out, ...reads() };
      if (s.role === 'subject' && s.status !== 'running') ev.fr = 1;
      events.push(ev);
      row(f, 'H', `s${s.role[0]}${s.n}`, out === 'none' ? '-' : out, '-');
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
      events.push({ k: 'AE', f, ev: 0 }, { k: 'TC', f }, { k: 'XTC', f, tg: k });
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
      row(f, 'A', `s${st.progress}`, '-', '-'); // unelided (D2 elides some of these rows)
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
        events.push({ k: 'AE', f, ev: 1 }, { k: 'CC0', f });
      }
    }
    tOutcome[f] = ev === 'skip' ? 'skip' : ev === '-' ? '-' : 'cons';
    let synced = false;
    if (!syncNext) { if (st.flag >= 1) { st.auto = mkPose(st.cam); st.flag = 0; synced = true; } }
    else if (st.flag === 2) { st.auto = mkPose(st.cam); st.flag = 0; synced = true; }
    else if (st.flag === 1) st.flag = 2;
    if (synced) events.push({ k: 'CC', f });
    if (ev !== 'skip') events.push({ k: 'TCK', f });
    if (ev !== '-') row(f, 'T', ev, '-', '-');
  };

  const quiescent = (f) => {
    if (st.pending || st.active || st.tActive) return false;
    if (settles.some((s) => s.status === 'running') && !aborted) return false;
    for (const k of extEvents.keys()) if (k > f && !aborted) return false;
    for (const e of log.oracleEvents) if (e.frame + 1 > f) return false;
    return true;
  };

  const oracleSnap = {};
  const takeOracle = (f) => {
    for (const ev of log.oracleEvents) for (const e of [0, 1]) {
      if (ev.frame + e === f) {
        oracleSnap[`${ev.token}|${e}`] = { owner: st.owner };
        row(f, 'O', `o${ev.token}e${e}`, '-', st.owner);
      }
    }
  };

  for (let f = 0; f <= cap; f += 1) {
    const ext = extEvents.get(f);
    if (ext && !aborted) execOps(ext, f, 'EXT');
    for (const ph of ord) {
      if (ph === 'H') {
        const returned = phaseH(f);
        for (const s of returned) {
          if (s.role === 'subject') subjectRecord = s;
          if (s.role === 'gate' && !aborted) {
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
    takeOracle(f);
    if (quiescent(f)) { shadowEnd = f; break; }
  }
  if (shadowEnd === -1) { shadowEnd = cap; log.pendingAtCap = !!(st.pending || st.active); }

  let cls; let labels = [];
  if (preconditionBlocked) cls = 'PRECONDITION_BLOCKED';
  else if (aborted) cls = 'HARNESS_ABORT';
  else if (!subjectRecord) cls = 'TIMED_OUT';
  else {
    const inputs = {
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
  const res = {
    cls, labels, inv, oracle, shadowEnd,
    t4Frame: subjectRecord ? subjectRecord.decisionFrame : -1,
    t4Samples: subjectRecord ? subjectRecord.n : 0,
    terminalTokens: log.terminals.map((t) => t.token),
    tokenLog: log.tokenLog,
    finalOwner: st.owner,
  };

  let gt = null;
  if (RELEVANT_CLASSES.includes(cls)) {
    const subj = subjectRecord.subjState === 'ACTIVE+' ? 'ACTIVE_PLUS' : subjectRecord.subjState;
    const active = subjectRecord.tActive ? '1' : '0';
    let restore = 'NONE';
    if (sch.family === 'F2') {
      if (!restorePre) throw new Error(`${sch.id}: F2 relevant schedule without restore`);
      restore = restorePre.variant === 'NOOP' ? 'NOOP' : (restorePre.outstanding ? 'OK_WHILE_OUTSTANDING' : 'OK_WHILE_IDLE');
    }
    const fd = subjectRecord.decisionFrame;
    const tFrame = posT > posH ? fd - 1 : fd; // the single T phase between H(fd-1) and H(fd)
    const dh7a = subjectRecord.n >= 2 && tOutcome[tFrame] === 'skip';
    gt = { owner: OWNER_OF_CLASS[cls], subj, active, restore, dh7a, attr: res.terminalTokens.length ? res.terminalTokens.join(',') : '-' };
  }
  return { res, rows, events, gt, meta: { subject, restorePre, tOutcome } };
}

/** The 13 questions (spec §8.2), fixed order, with label functions over the ground-truth axes. */
const OWNERS = ['OWN', 'PRIOR_TERMINAL', 'IN_FLIGHT', 'RESTORE', 'INIT'];
const SUBJS = ['PENDING', 'ACTIVE0', 'ACTIVE_PLUS', 'COMPLETE'];
const ACTS = ['0', '1'];
const RESTS = ['NONE', 'OK_WHILE_OUTSTANDING', 'OK_WHILE_IDLE', 'NOOP'];
const TF = ['F', 'T'];
const b = (x) => (x ? 'T' : 'F');
export const QUESTIONS = [
  { id: 'Q-STALE', labelDomain: TF, definition: 'owner != OWN', label: (g) => b(g.owner !== 'OWN') },
  { id: 'Q-OWNER', labelDomain: OWNERS, definition: 'owner', label: (g) => g.owner },
  { id: 'Q-SUBJ', labelDomain: SUBJS, definition: 'subj', label: (g) => g.subj },
  { id: 'Q-ACTIVE', labelDomain: ACTS, definition: 'active', label: (g) => g.active },
  { id: 'Q-RESTORE', labelDomain: RESTS, definition: 'restore', label: (g) => g.restore },
  { id: 'Q-DH1', labelDomain: TF, definition: 'subj in {PENDING, ACTIVE0}', label: (g) => b(g.subj === 'PENDING' || g.subj === 'ACTIVE0') },
  { id: 'Q-DH2', labelDomain: TF, definition: 'owner=PRIOR_TERMINAL and subj=PENDING and active=0', label: (g) => b(g.owner === 'PRIOR_TERMINAL' && g.subj === 'PENDING' && g.active === '0') },
  { id: 'Q-DH3A', labelDomain: TF, definition: 'owner=RESTORE and restore=OK_WHILE_OUTSTANDING', label: (g) => b(g.owner === 'RESTORE' && g.restore === 'OK_WHILE_OUTSTANDING') },
  { id: 'Q-DH3B', labelDomain: TF, definition: 'restore=OK_WHILE_OUTSTANDING and owner in {PRIOR_TERMINAL, IN_FLIGHT, OWN}', label: (g) => b(g.restore === 'OK_WHILE_OUTSTANDING' && ['PRIOR_TERMINAL', 'IN_FLIGHT', 'OWN'].includes(g.owner)) },
  { id: 'Q-DH4', labelDomain: TF, definition: 'owner = IN_FLIGHT', label: (g) => b(g.owner === 'IN_FLIGHT') },
  { id: 'Q-DH7A', labelDomain: TF, definition: "the single T phase between the subject's previous and deciding samples was a D2 skip", label: (g) => b(g.dh7a) },
  { id: 'Q-ATTR', labelDomain: ['-', '1', '1,2', '2'], definition: 'ordered list of completion tokens in the window (comma-joined; "-" if empty)', label: (g) => g.attr },
  {
    id: 'Q-TUPLE',
    labelDomain: OWNERS.flatMap((o) => SUBJS.flatMap((s) => ACTS.flatMap((a) => RESTS.map((r) => `${o}|${s}|${a}|${r}`)))),
    definition: 'owner|subj|active|restore',
    label: (g) => `${g.owner}|${g.subj}|${g.active}|${g.restore}`,
  },
];
export const QUESTION_IDS = QUESTIONS.map((q) => q.id);

/** Labels for every question; throws (exit 2) if a label falls outside its declared domain. */
export function labelsOf(gt) {
  return QUESTIONS.map((q) => {
    const l = q.label(gt);
    if (!q.labelDomain.includes(l)) throw Object.assign(new Error(`label ${l} outside domain of ${q.id}`), { exitCode: 2, code: 'LABEL-DOMAIN' });
    return l;
  });
}
