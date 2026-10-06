// R1–R8 correlator (spec §6.2) with C1/C2/C3/C6 fail-closed semantics (spec §6.3). [SYN] research tooling only.
// Input: a PROJECTED trace (project.mjs output, or a hand-built trace in the same encoding) plus its configuration.
// It never reads ground-truth (SYN) fields: `ow` and `XTC` are ignored even if present.
// It is TOTAL (remediation M-5): malformed input (schema-invalid events, fields that the configured atoms or identity
// axis cannot produce, a malformed cfg) yields UNDIAGNOSABLE(MALFORMED) for every question; it never throws.
//
// Slot window (remediation H-2, spec §6.2 R3). In 7.124.2 the consumer clears the slot (V:105009) before
// transitionView raises the active flag (V:107122), and no read-only atomic consumption witness exists. A slot object
// written by an unobserved writer after the last visible `pd` read and consumed in the next tick is therefore never
// seen. cfg.slotWindow selects how R3 treats that unobservable window:
//   'OPEN' (DEFAULT, fail-closed): the token of a consumed transition is never inferred from the last visible read;
//     every result that would depend on it (IN_FLIGHT/OWN/PRIOR_TERMINAL owner, ACTIVE_PLUS/COMPLETE subject state,
//     the completion attribution list) is AMBIGUOUS with reason UNOBSERVED_SLOT_WINDOW.
//   'ASSUME_NO_UNOBSERVED_WRITER': R3 as originally specified. Each definite label that relied on it carries
//     `assumption: 'NO_UNOBSERVED_WRITER'`. This assumption holds in D2 by construction (no foreign writer); it
//     is NOT verifiable in a live 7.124.2 Viewer.
// The same OPEN/ASSUME split applies to the two other windows no read covers (Codex advisor follow-up to H-2):
//   - INIT needs a capture-start baseline: the trace's first event must be a visible camera read (CAM). Otherwise an
//     unobserved writer between capture start and the first read cannot be excluded (OPEN: AMBIGUOUS
//     NO_CAPTURE_BASELINE; ASSUME: INIT with the assumption).
//   - A restore without its own post-call read whose pose change is first seen at a later read (OPEN: AMBIGUOUS
//     UNREAD_WRITER; ASSUME: RESTORE with the assumption).
//   - C3 TRUE_EDGE_EMPTY_SLOT is a contradiction only under the assumption; under OPEN a true edge after an empty
//     visible slot is evidence of an unobserved slot writer (DH-6a) and makes identity AMBIGUOUS.
//
// Deliberate, conservative refinements of the §6.2 pseudo-code (recorded as spec deviations in README):
//  (1) R5 prose is applied: a visible value change with no bracketing writer and no active transition is
//      FOREIGN_CANDIDATE (owner UNKNOWN), and without V-EDGE any unbracketed change is UNKNOWN (an unseen transition
//      may be stepping); the pseudo-code omitted the activeTok == NONE branch.
//  (2) A change observed after a bracketing writer (RST OK without its own visible read, or TC) while a transition is
//      (or may be) active is UNKNOWN: the change may come from the writer or from a later step (WRITER_RACE).
//  (3) The synchronous post-call read on RST is the restore's own read: a change there is the restore's write.
//  (4) The first visible camera read is a valid INIT baseline only if no transition can have stepped before it.
//  (7) R5 "positive evidence that no step ran" is applied uniformly: without V-EDGE there is never positive evidence
//      that no transition is active once a fit was issued, so Q-OWNER is AMBIGUOUS (ACTIVE_STATE_UNOBSERVED); the
//      pseudo-code would have emitted INIT/RESTORE from "no visible change" alone.
//  (5) Q-ATTR is UNAVAILABLE without P-TC (completions are not observed at all).
//  (6) fr=1 must sit on the subject's deciding sample and nowhere else (R8); otherwise CONTRADICTION:FR.

import { validateEvent } from './schema.mjs';
import { viewerPinMatches } from './pins.mjs';

export const VERDICT = { DEFINITE: 'DEFINITE', AMBIGUOUS: 'AMBIGUOUS', UNAVAILABLE: 'UNAVAILABLE', UNDIAGNOSABLE: 'UNDIAGNOSABLE' };
const NONE = 'NONE'; const UNKNOWN = 'UNKNOWN'; const UNBOUND = 'U';
const WINDOW = 'WINDOW'; // a consumed transition whose token R3 may not infer (OPEN slot window, H-2)
const isTok = (t) => typeof t === 'number';

const hasOwn = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const VB_DEP = Object.freeze({ 'V-PEND': 'VB-1', 'V-ACT': 'VB-2', 'V-EDGE': 'VB-3' });
/** VB rows whose presence is behavioural and needs a passed post-capture positive control (spec §6.1.3 END.pc, R-M4). */
const VB_NEEDS_PC = Object.freeze(['VB-3']);

/**
 * VB-0 / per-row presence guard (spec §6.3 C6). FAILS CLOSED (remediation M-4; independent review H1): a V-* atom
 * stays enabled only if VB-0 holds — DERIVED here from the observed meta.vv === PINNED_VIEWER_VERSION and
 * meta.vd === PINNED_VIEWER_BUNDLE_SHA256 (exact, own properties, no coercion) AND meta.vg === 1 exactly (the guard
 * flag is required but never trusted alone) — and vb[row] === 1 exactly (own property) and, for a behavioural row
 * (VB-3), the positive control pc[row] === 1 exactly. Absent, partial or malformed metadata disables the atom; a VB-0
 * failure disables every V-* atom with no fallback (the run is public+harness only). The caller composes the argument
 * post hoc as {vg, vv, vd, vb} from META and {pc} from END (R-M4); events/fields of disabled atoms are then removed by
 * projection before correlation (R-L3), so the verdict is the C6 one, never MALFORMED.
 * Returns the effective atom list and the disabled VB rows (VB-0 once when the guard itself is not established).
 */
export function applyVbGuard(atoms, meta) {
  try { return applyVbGuardInner(atoms, meta); } catch {
    // total: hostile metadata (e.g. a throwing proxy) fails closed — every V-* atom disabled, no fallback
    try {
      const list = Array.isArray(atoms) ? atoms : [];
      const eff = []; let anyV = false;
      for (const a of list) { if (typeof a === 'string' && hasOwn(VB_DEP, a)) anyV = true; else eff.push(a); }
      return { atoms: eff, vbUnavailable: anyV ? ['VB-0'] : [] };
    } catch { return { atoms: [], vbUnavailable: ['VB-0'] }; }
  }
}
function applyVbGuardInner(atoms, meta) {
  const list = Array.isArray(atoms) ? atoms : [];
  const vgOk = hasOwn(meta, 'vg') && meta.vg === 1 && hasOwn(meta, 'vv') && hasOwn(meta, 'vd') && viewerPinMatches(meta.vv, meta.vd);
  const vb = hasOwn(meta, 'vb') && meta.vb && typeof meta.vb === 'object' && !Array.isArray(meta.vb) ? meta.vb : null;
  const pc = hasOwn(meta, 'pc') && meta.pc && typeof meta.pc === 'object' && !Array.isArray(meta.pc) ? meta.pc : null;
  const disabled = [];
  const eff = [];
  for (const a of list) {
    if (typeof a === 'string' && hasOwn(VB_DEP, a)) {
      const row = VB_DEP[a];
      if (!vgOk) { if (!disabled.includes('VB-0')) disabled.push('VB-0'); continue; }
      const present = vb !== null && hasOwn(vb, row) && vb[row] === 1;
      const behaved = !VB_NEEDS_PC.includes(row) || (pc !== null && hasOwn(pc, row) && pc[row] === 1);
      if (!present || !behaved) { if (!disabled.includes(row)) disabled.push(row); continue; }
    }
    eff.push(a);
  }
  return { atoms: eff, vbUnavailable: disabled };
}

/** Kind -> gating atom (null = base), mirroring project.mjs KIND_GATE; NV is live-only and base. */
const KIND_ATOM = Object.freeze({ FIT: null, RST: null, SST: null, SMP: null, NV: null, CAM: 'P-FRM', TCK: 'P-TICK', CC: 'P-CC', CC0: 'P-CC0', TC: 'P-TC', AE: 'V-EDGE', XTC: 'X-TAG' });
export const SLOT_WINDOW = Object.freeze({ OPEN: 'OPEN', ASSUME: 'ASSUME_NO_UNOBSERVED_WRITER' });

/**
 * Structural validation of a trace against its configuration (M-5). Returns null or an error string. Checks every
 * event with the total schema validator, then that each atom-dependent field/kind is present exactly when its atom
 * is configured, and that the identity axis matches the encoding (r and pd.b only under ID-ON, pd.ch only under OFF).
 */
export function checkAtomConsistency(events, cfg) {
  if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.atoms) || !['ON', 'OFF'].includes(cfg.idAxis)) return 'cfg';
  if (cfg.slotWindow !== undefined && !Object.values(SLOT_WINDOW).includes(cfg.slotWindow)) return 'cfg.slotWindow';
  if (!Array.isArray(events)) return 'events';
  const mode = cfg.mode === undefined ? 'offline' : cfg.mode;
  if (mode !== 'offline' && mode !== 'live') return 'cfg.mode';
  const A = new Set(cfg.atoms);
  const on = cfg.idAxis === 'ON';
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    const errs = validateEvent(e, { mode });
    if (errs.length) return `#${i}: ${errs[0]}`;
    const gate = KIND_ATOM[e.k];
    if (gate !== null && gate !== 'X-TAG' && !A.has(gate)) return `#${i}: ${e.k} without ${gate}`;
    const read = e.k === 'FIT' || e.k === 'SMP' || e.k === 'CAM' || (e.k === 'RST' && e.rs !== 'THROW');
    if (read) {
      if (A.has('V-PEND') !== hasOwn(e, 'pd')) return `#${i}: pd vs V-PEND`;
      if (A.has('V-ACT') !== hasOwn(e, 'ac')) return `#${i}: ac vs V-ACT`;
      if (e.k === 'FIT' && A.has('V-PEND') !== hasOwn(e, 'pq')) return `#${i}: pq vs V-PEND`;
      const camVisible = e.k === 'SMP' || e.k === 'CAM' || A.has('P-FRM');
      if (camVisible !== hasOwn(e, 'cl')) return `#${i}: cl vs P-FRM`;
      if ((camVisible && A.has('P-XS')) !== hasOwn(e, 'xc')) return `#${i}: xc vs P-XS`;
    }
    if ((e.k === 'FIT' || e.k === 'SST') && hasOwn(e, 'r') !== on) return `#${i}: r vs ID axis`;
    for (const key of ['pd', 'pq']) {
      if (!hasOwn(e, key)) continue;
      if (on && hasOwn(e[key], 'ch')) return `#${i}: ${key}.ch under ID-ON`;
      if (!on && hasOwn(e[key], 'b')) return `#${i}: ${key}.b under ID-OFF`;
      if (!on && !hasOwn(e[key], 'ch')) return `#${i}: ${key} without ch under ID-OFF`;
    }
  }
  return null;
}

function contradiction(rule, pos) {
  return { contradiction: `CONTRADICTION:${rule}`, position: pos };
}

/** C3 checks (whole trace). Returns null or {contradiction, position}. */
export function findContradiction(events, cfg) {
  const A = new Set(cfg.atoms);
  const edgeV = A.has('V-EDGE');
  const pendV = A.has('V-PEND');
  let lastF = -1; let lastTm = -1;
  let lastEdge = null; let lastEdgeOrTc = null;
  let slotEmpty = null; let foreign = false;
  const settle = {};
  let subjDecided = 0; let frCount = 0;
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (!(Number.isInteger(e.f) && e.f >= 0) || e.f < lastF) return contradiction('ORDER_F', i);
    lastF = e.f;
    if (e.tm !== undefined) { if (e.tm < lastTm) return contradiction('ORDER_TM', i); lastTm = e.tm; }
    const pd = e.pd;
    if (pendV && pd) { slotEmpty = pd.p === 0; if (pd.b === UNBOUND) foreign = true; }
    if (e.k === 'AE' && edgeV) {
      if (e.ev === 1 && lastEdge === 1) return contradiction('EDGE_REPEAT', i);
      if (e.ev === 0 && lastEdge !== 1) return contradiction('FALSE_EDGE_WITHOUT_TRUE', i);
      // Only under the no-unobserved-writer assumption; under OPEN this is DH-6a evidence (handled in correlate).
      if (e.ev === 1 && pendV && slotEmpty === true && !foreign && cfg.slotWindow === SLOT_WINDOW.ASSUME) return contradiction('TRUE_EDGE_EMPTY_SLOT', i);
      lastEdge = e.ev; lastEdgeOrTc = `AE${e.ev}`;
    }
    if (e.k === 'TC' && edgeV) {
      if (lastEdgeOrTc !== 'AE0') return contradiction('TC_WITHOUT_ACTIVE', i);
      lastEdgeOrTc = 'TC';
    }
    if (e.k === 'SST') settle[e.s] = { n: 0, decided: false };
    if (e.k === 'SMP') {
      const s = settle[e.s];
      if (!s) return contradiction('SMP_WITHOUT_SST', i);
      if (s.decided) return contradiction('SMP_AFTER_DECISION', i);
      if (e.n !== s.n + 1) return contradiction('SAMPLE_INDEX', i);
      if (e.n === 1 && e.d === 'settled') return contradiction('SETTLED_ON_FIRST_SAMPLE', i);
      s.n = e.n;
      if (e.d === 'settled' || e.d === 'timeout') s.decided = true;
      if (e.fr === 1) {
        frCount += 1;
        if (e.s !== 'S' || !s.decided) return contradiction('FR', i);
      }
      if (e.s === 'S' && s.decided) { subjDecided += 1; if (e.fr !== 1) return contradiction('FR', i); }
    }
  }
  if (frCount > 1 || subjDecided > 1) return contradiction('FR', events.length);
  return null;
}

const Q_IDS = ['Q-OWNER', 'Q-SUBJ', 'Q-ATTR'];

/**
 * Correlate one projected trace. cfg = { atoms[], idAxis: 'ON'|'OFF', vbUnavailable?: [], slotWindow?, mode? }.
 * slotWindow defaults to OPEN (fail-closed, see header). mode is the schema mode ('offline' default, or 'live').
 * Returns { questions: {Q-OWNER|Q-SUBJ|Q-ATTR: {status, label?, reason?, assumption?}}, fits: {[r]: status}, t4, S_d,
 * contradiction, malformed }. Never throws: malformed input => every question UNDIAGNOSABLE(MALFORMED).
 */
export function correlate(events, cfg) {
  try { return correlateInner(events, cfg); } catch {
    // R-M1: the correlator is total; any exception on hostile input is MALFORMED, never thrown.
    const q = {}; for (const id of Q_IDS) q[id] = { status: VERDICT.UNDIAGNOSABLE, reason: 'MALFORMED' };
    return { questions: q, fits: {}, t4: null, S_d: null, contradiction: null, malformed: 'exception' };
  }
}
function correlateInner(events, cfg) {
  const bad = checkAtomConsistency(events, cfg);
  if (bad) {
    const q = {}; for (const id of Q_IDS) q[id] = { status: VERDICT.UNDIAGNOSABLE, reason: 'MALFORMED' };
    return { questions: q, fits: {}, t4: null, S_d: null, contradiction: null, malformed: bad };
  }
  const A = new Set(cfg.atoms);
  const on = cfg.idAxis === 'ON';
  const pendV = A.has('V-PEND'); const edgeV = A.has('V-EDGE'); const tcV = A.has('P-TC'); const xsV = A.has('P-XS');
  const vbOff = Array.isArray(cfg.vbUnavailable) ? cfg.vbUnavailable : [];
  const windowOpen = (cfg.slotWindow ?? SLOT_WINDOW.OPEN) === SLOT_WINDOW.OPEN;
  const ASSUMED = 'NO_UNOBSERVED_WRITER';
  const c = findContradiction(events, cfg);
  if (c) {
    const q = {}; for (const id of Q_IDS) q[id] = { status: VERDICT.UNDIAGNOSABLE, reason: c.contradiction };
    return { questions: q, fits: {}, t4: null, S_d: null, contradiction: c.contradiction, malformed: null };
  }

  let slotTok = NONE; let foreign = false;
  let activeTok = NONE; let pendingFalseEdge = null; let lastEdgeOrTc = null;
  let lastWriter = { kind: 'INIT' }; let changedSinceEdge = false;
  let prevVal; let writerSincePrevRead = false;
  let fitSeen = false; let hiddenTerminal = false;
  const completions = [];
  const fits = {}; let fitOrdinal = 0;
  const settles = {}; let subjectTok = null; let S_d = null;
  let unbracketed = null; // reason code of the most recent UNKNOWN writer
  const t4 = { deciding: null, samples: [] };
  // capture-start camera baseline (INIT anchor; R-M2): the first event is a CAM at the frame origin (f = 0), and in a
  // live trace also at the relative-clock origin (tm = 0), matching META.f/tm. A delayed first read anchors nothing.
  const baselineAtStart = events.length > 0 && events[0].k === 'CAM' && events[0].f === 0
    && (cfg.mode !== 'live' || events[0].tm === 0);

  const refreshSlot = (pd) => {
    if (!pendV || !pd) return;
    if (on) {
      if (pd.p === 0) slotTok = NONE;
      else if (pd.b === UNBOUND) { slotTok = UNBOUND; foreign = true; } else slotTok = pd.b;
    } else if (pd.p === 0) slotTok = NONE;
    else if (pd.ch === 1) slotTok = UNKNOWN;
  };
  const camVal = (e) => (xsV && e.xc !== undefined ? e.xc : e.cl);
  const setUnknown = (why) => { lastWriter = { kind: 'UNKNOWN' }; unbracketed = why; };
  const onRead = (e) => {
    const val = camVal(e);
    if (val === undefined) return;
    const mayBeActive = edgeV ? activeTok !== NONE : fitSeen; // without V-EDGE an unseen transition may be running
    if (prevVal === undefined) {
      if (mayBeActive) setUnknown('NO_BASELINE');
    } else if (writerSincePrevRead && mayBeActive) setUnknown('WRITER_RACE');
    else if (writerSincePrevRead && lastWriter.kind === 'RESTORE' && lastWriter.unread && val !== prevVal) {
      // the restore's write is first seen here: an unobserved writer in between cannot be excluded
      if (windowOpen) setUnknown('UNREAD_WRITER'); else lastWriter.assumed = true;
    }
    else if (val !== prevVal && !writerSincePrevRead) {
      if (!edgeV) setUnknown('UNBRACKETED_CHANGE');
      else if (activeTok === NONE) setUnknown('FOREIGN_CANDIDATE');
      else { lastWriter = { kind: 'INFLIGHT', tok: activeTok }; changedSinceEdge = true; }
    }
    prevVal = val; writerSincePrevRead = false;
  };

  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    switch (e.k) {
      case 'FIT': {
        fitOrdinal += 1;
        onRead(e); // the synchronous post-call read: no tick can run between the call and this read
        fitSeen = true;
        const key = on && isTok(e.r) ? e.r : `#${fitOrdinal}`;
        if (!pendV) { fits[key] = 'UNAVAILABLE'; slotTok = UNKNOWN; }
        else if (e.pd.p === 0) { fits[key] = 'NO_REQUEST'; slotTok = NONE; }
        else if (e.pd.nw === 1) { fits[key] = 'REQUEST_BOUND'; slotTok = on ? e.r : UNKNOWN; }
        else { fits[key] = 'NO_REQUEST_OR_UNRESOLVED'; refreshSlot({ p: e.pd.p, b: e.pd.b, ch: 0 }); } // never rebinds (R2)
        break;
      }
      case 'RST':
        if (e.rs === 'OK') {
          lastWriter = { kind: 'RESTORE' }; changedSinceEdge = false;
          if (e.cl !== undefined) { prevVal = camVal(e); writerSincePrevRead = false; } else { writerSincePrevRead = true; lastWriter.unread = true; }
        }
        if (e.rs !== 'OK' && e.cl !== undefined) onRead(e);
        refreshSlot(e.pd);
        break;
      case 'SST':
        settles[e.s] = { r: on ? e.r : null, n: 0 };
        if (e.s === 'S') subjectTok = on && isTok(e.r) ? e.r : null;
        break;
      case 'AE':
        if (e.ev === 1) {
          // R3: the consumed request is the one bound to the most recent visible read ONLY if no unobserved writer
          // replaced the slot object in between (unverifiable in 7.124.2). OPEN window => token not inferred.
          if (pendV && isTok(slotTok)) activeTok = windowOpen ? WINDOW : slotTok;
          else {
            activeTok = UNKNOWN;
            // empty visible slot then a true edge: an unseen slot writer (under ASSUME with ID-ON, C3 already returned
            // CONTRADICTION; under ID-OFF this is also reached in ASSUME mode, harmlessly: Q-SUBJ is UNAVAILABLE there)
            if (pendV && slotTok === NONE) foreign = true;
          }
          slotTok = NONE; changedSinceEdge = false;
        } else {
          pendingFalseEdge = activeTok;
          if (!tcV) { activeTok = NONE; hiddenTerminal = true; } // hidden terminal write: without P-TC the false edge is not attributable (ablation soundness fix)
        }
        lastEdgeOrTc = `AE${e.ev}`;
        break;
      case 'TC': {
        const tok = edgeV && lastEdgeOrTc === 'AE0' ? pendingFalseEdge : '?';
        completions.push(tok);
        lastWriter = { kind: 'TERMINAL', tok };
        writerSincePrevRead = true;
        activeTok = NONE; lastEdgeOrTc = 'TC';
        break;
      }
      case 'SMP':
      case 'CAM':
        onRead(e);
        refreshSlot(e.pd);
        if (e.k === 'SMP') {
          t4.samples.push({ s: e.s, n: e.n, r: settles[e.s] ? settles[e.s].r : null, position: i, f: e.f });
          if (e.fr === 1) {
            t4.deciding = { s: e.s, n: e.n, d: e.d, position: i, f: e.f, r: settles[e.s] ? settles[e.s].r : null, frustumOnThisSample: true };
            S_d = { slotTok, activeTok, lastWriter: { ...lastWriter }, changedSinceEdge, completions: [...completions], foreign, unbracketed, fitSeen, hiddenTerminal };
          }
        }
        break;
      default: break; // TCK, CC, CC0 carry no proof (R3); XTC/ow are SYN and ignored
    }
  }

  const q = {};
  // ---- Q-OWNER
  if (!S_d) q['Q-OWNER'] = { status: VERDICT.UNDIAGNOSABLE, reason: 'TRUNCATED' };
  else if (!edgeV && !tcV) q['Q-OWNER'] = { status: VERDICT.UNAVAILABLE, reason: vbOff.length ? `VB_UNAVAILABLE:${vbOff[0]}` : 'OBSERVABLE_ABSENT:V-EDGE|P-TC' };
  else {
    const w = S_d.lastWriter;
    const unknownTok = (t) => !isTok(t);
    if (w.kind === 'TERMINAL' && !on) q['Q-OWNER'] = { status: VERDICT.UNAVAILABLE, reason: 'OBSERVABLE_ABSENT:ID-ON' };
    else if (!edgeV && S_d.fitSeen) q['Q-OWNER'] = { status: VERDICT.AMBIGUOUS, reason: vbOff.length ? `VB_UNAVAILABLE:${vbOff[0]}` : 'ACTIVE_STATE_UNOBSERVED' };
    else if (S_d.hiddenTerminal) q['Q-OWNER'] = { status: VERDICT.AMBIGUOUS, reason: 'OBSERVABLE_ABSENT:P-TC' };
    else if (w.kind === 'UNKNOWN') q['Q-OWNER'] = { status: VERDICT.AMBIGUOUS, reason: S_d.unbracketed || 'IDENTITY_AMBIGUOUS' };
    else if ((w.kind === 'TERMINAL' || w.kind === 'INFLIGHT') && w.tok === WINDOW) q['Q-OWNER'] = { status: VERDICT.AMBIGUOUS, reason: 'UNOBSERVED_SLOT_WINDOW' };
    else if ((w.kind === 'TERMINAL' || w.kind === 'INFLIGHT') && unknownTok(w.tok)) q['Q-OWNER'] = { status: VERDICT.AMBIGUOUS, reason: 'IDENTITY_AMBIGUOUS' };
    else if (S_d.activeTok !== NONE && !S_d.changedSinceEdge) q['Q-OWNER'] = { status: VERDICT.AMBIGUOUS, reason: 'ACTIVE_WITHOUT_VISIBLE_STEP' };
    else {
      let label;
      if (w.kind === 'RESTORE') label = 'RESTORE';
      else if (w.kind === 'INIT') label = 'INIT';
      else if (w.kind === 'INFLIGHT') label = 'IN_FLIGHT';
      else label = w.tok === subjectTok ? 'OWN' : 'PRIOR_TERMINAL';
      const initUnanchored = w.kind === 'INIT' && !baselineAtStart;
      if (w.kind === 'TERMINAL' && subjectTok === null) q['Q-OWNER'] = { status: VERDICT.UNAVAILABLE, reason: 'OBSERVABLE_ABSENT:ID-ON' };
      else if (initUnanchored && windowOpen) q['Q-OWNER'] = { status: VERDICT.AMBIGUOUS, reason: 'NO_CAPTURE_BASELINE' };
      // R-M3: a restore without its own post-call read is never credited under OPEN, whatever the later value
      else if (w.kind === 'RESTORE' && w.unread && windowOpen) q['Q-OWNER'] = { status: VERDICT.AMBIGUOUS, reason: 'UNREAD_WRITER' };
      else if (w.kind === 'TERMINAL' || w.kind === 'INFLIGHT' || initUnanchored || w.assumed || (w.kind === 'RESTORE' && w.unread)) q['Q-OWNER'] = { status: VERDICT.DEFINITE, label, assumption: ASSUMED };
      else q['Q-OWNER'] = { status: VERDICT.DEFINITE, label };
    }
  }
  // ---- Q-SUBJ
  const subjNeeds = ['V-PEND', 'V-EDGE'].filter((a) => !A.has(a));
  if (!S_d) q['Q-SUBJ'] = { status: VERDICT.UNDIAGNOSABLE, reason: 'TRUNCATED' };
  else if (subjNeeds.length && vbOff.length) q['Q-SUBJ'] = { status: VERDICT.AMBIGUOUS, reason: `VB_UNAVAILABLE:${vbOff[0]}` };
  else if (subjNeeds.length) q['Q-SUBJ'] = { status: VERDICT.UNAVAILABLE, reason: `OBSERVABLE_ABSENT:${subjNeeds[0]}` };
  else if (!on || subjectTok === null) q['Q-SUBJ'] = { status: VERDICT.UNAVAILABLE, reason: 'OBSERVABLE_ABSENT:ID-ON' };
  else if (S_d.foreign) q['Q-SUBJ'] = { status: VERDICT.AMBIGUOUS, reason: 'IDENTITY_AMBIGUOUS' };
  else if (S_d.slotTok === subjectTok) q['Q-SUBJ'] = { status: VERDICT.DEFINITE, label: 'PENDING' };
  else if (S_d.hiddenTerminal) q['Q-SUBJ'] = { status: VERDICT.AMBIGUOUS, reason: 'OBSERVABLE_ABSENT:P-TC' };
  else if (S_d.activeTok === subjectTok && S_d.changedSinceEdge) q['Q-SUBJ'] = { status: VERDICT.DEFINITE, label: 'ACTIVE_PLUS', assumption: ASSUMED };
  else if (S_d.activeTok === subjectTok) q['Q-SUBJ'] = { status: VERDICT.AMBIGUOUS, reason: 'ACTIVE_WITHOUT_VISIBLE_STEP' };
  else if (S_d.completions.includes(subjectTok)) q['Q-SUBJ'] = { status: VERDICT.DEFINITE, label: 'COMPLETE', assumption: ASSUMED };
  else if (S_d.activeTok === WINDOW || S_d.completions.includes(WINDOW)) q['Q-SUBJ'] = { status: VERDICT.AMBIGUOUS, reason: 'UNOBSERVED_SLOT_WINDOW' };
  else q['Q-SUBJ'] = { status: VERDICT.AMBIGUOUS, reason: 'IDENTITY_AMBIGUOUS' };
  // ---- Q-ATTR (whole window)
  if (!tcV) q['Q-ATTR'] = { status: VERDICT.UNAVAILABLE, reason: 'OBSERVABLE_ABSENT:P-TC' };
  else if (completions.some((t) => !isTok(t) && t !== WINDOW)) {
    q['Q-ATTR'] = { status: VERDICT.AMBIGUOUS, reason: !edgeV && vbOff.length ? `VB_UNAVAILABLE:${vbOff[0]}` : 'IDENTITY_AMBIGUOUS' };
  } else if (completions.includes(WINDOW)) q['Q-ATTR'] = { status: VERDICT.AMBIGUOUS, reason: 'UNOBSERVED_SLOT_WINDOW' };
  else if (completions.length) q['Q-ATTR'] = { status: VERDICT.DEFINITE, label: completions.join(','), assumption: ASSUMED };
  else q['Q-ATTR'] = { status: VERDICT.DEFINITE, label: '-' };

  return { questions: q, fits, t4, S_d, contradiction: null, malformed: null };
}

export const CORRELATOR_QUESTIONS = Q_IDS;
export const CORRELATOR_CONFIGS = ['T-PUB/ON', 'T-VB/OFF', 'T-VB/ON'];
/**
 * Correlator runs reported in the summary (spec §8.9): the three configurations under the D2-true assumption
 * (no unobserved writer; true by construction in D2), plus T-VB/ON under the fail-closed OPEN slot window, which
 * is the only mode a live 7.124.2 diagnostic could use without an unverifiable assumption.
 */
export const CORRELATOR_RUNS = [
  { key: 'T-PUB/ON', configId: 'T-PUB/ON', slotWindow: SLOT_WINDOW.ASSUME },
  { key: 'T-VB/OFF', configId: 'T-VB/OFF', slotWindow: SLOT_WINDOW.ASSUME },
  { key: 'T-VB/ON', configId: 'T-VB/ON', slotWindow: SLOT_WINDOW.ASSUME },
  { key: 'T-VB/ON@OPEN', configId: 'T-VB/ON', slotWindow: SLOT_WINDOW.OPEN },
];
