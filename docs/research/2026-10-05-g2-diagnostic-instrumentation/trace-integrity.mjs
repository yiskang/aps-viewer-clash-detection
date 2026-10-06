// Whole-trace META/data/END integrity (spec §6.1.3 "Whole-trace integrity") and the META/END-aware live entry point
// (spec §6.3 "Live entry point"). [SYN] research tooling only: design-bound reference for tests; no live run is
// authorized and nothing here touches a Viewer, browser or the acceptance harness.
//
// validateTrace() is TOTAL (never throws; own-property lookups only; prototype keys are ordinary unknown keys) and runs
// BEFORE correlation. Any envelope failure makes the WHOLE trace UNDIAGNOSABLE: no partial trace is ever positive
// evidence. VB-0 is bound to the single validated META for the whole stream; a data record can never assert or
// override the version, schema or capabilities. If the envelope is valid but VB-0 fails, the trace is usable only as
// public+harness: every V-* atom is disabled and its events/fields are removed by projection (C6 composition rule).
import { createHash } from 'node:crypto';
import { LIVE_CAPS } from './bounds.mjs';
import { viewerPinMatches } from './pins.mjs';
import {
  validateEvent, validateMeta, validateEnd, capsMatch, expectedTerminalStatus, META_FIELD_NAMES, END_FIELD_NAMES, FIELDS,
} from './schema.mjs';
import { applyVbGuard, correlate, CORRELATOR_QUESTIONS, VERDICT } from './correlate.mjs';

const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const kindOf = (r) => (isPlain(r) && own(r, 'k') && typeof r.k === 'string' ? r.k : null);

/** Stable error codes, in the order they are checked (spec §6.1.3 whole-trace integrity table). */
export const TRACE_ERRORS = Object.freeze([
  'VALIDATION-EXCEPTION', // the validator itself hit an exception (fail closed)
  'BAD-OPTIONS', // no canonicalizer, or caps not a complete integer cap set
  'TRACE-NOT-ARRAY',
  'RECORD-NOT-OBJECT', // a record is not a plain object with an own string kind
  'META-MISSING',
  'META-DUPLICATE',
  'DATA-BEFORE-META',
  'META-INVALID', // validateMeta failed (types, required/unknown fields, sv, q0, ec, VB-0 consistency)
  'META-VB0-INCONSISTENT', // vg = 1 or a vb row = 1 although (vv, vd) is not exactly the pinned build
  'SCHEMA-VERSION-UNSUPPORTED',
  'META-CAPS-MISMATCH', // META.cp is not exactly the enforced cap set
  'META-TOO-LARGE',
  'END-MISSING', // truncation without a terminal marker
  'END-DUPLICATE',
  'DATA-AFTER-END',
  'END-INVALID',
  'TERMINAL-STATUS-INCONSISTENT', // END.ts is not the status implied by truncated/overflow/iv
  'END-TOO-LARGE',
  'RUN-ID-MISMATCH', // END.run or any data rn differs from META.run
  'META-FIELD-IN-DATA', // a data record carries a META/END-only field (version/capability/schema mutation)
  'VERSION-MIXED', // a later record asserts a different vv/vd/sv than the validated META
  'DATA-INVALID', // a data event fails the live schema (incl. missing q/tm)
  'EVENT-TOO-LARGE',
  'SEQ-START', // first q != META.q0
  'SEQ-GAP',
  'SEQ-ROLLBACK',
  'SEQ-DUPLICATE',
  'CAPTURE-START-MISSING', // META.cs = 1 but the first data event is not the CAM at f = 0, tm = 0
  'COUNT-MISMATCH', // END.ne != number of data events
  'COUNT-OUT-OF-BOUNDS', // number of data events outside META.ec or above the data-event cap
  'BYTES-MISMATCH', // END.nb != sum(canonical bytes + 1) of the data events
  'LAST-SEQ-MISMATCH', // END.lq != last q (0 if none)
  'END-BEFORE-LAST-EVENT', // END.f / END.tm below the last data event's f / tm
  'NV-COUNT-MISMATCH', // END.nvn != number of NV records, or above the retained-sample cap
  'STREAM-DIGEST-MISMATCH', // END.sd != SHA-256(canonical [META, ...data])
  'TRACE-TOO-LARGE',
  'TRUNCATED', // END.truncated = 1
  'OVERFLOW', // END.overflow = 1 (never valid positive evidence)
  'MALFORMED-APPENDS', // END.iv > 0
]);

/** Data-record keys that only META/END may carry (a data record carrying one is a mid-stream mutation). */
const ENVELOPE_ONLY = Object.freeze([...new Set([...META_FIELD_NAMES, ...END_FIELD_NAMES])].filter((k) => !own(FIELDS, k)));
const VERSION_KEYS = ['vv', 'vd', 'sv'];
const CAP_KEYS = Object.keys(LIVE_CAPS);

function result(errors) {
  const uniq = [];
  for (const e of errors) if (!uniq.includes(e)) uniq.push(e);
  const ok = uniq.length === 0;
  let reason = null;
  if (!ok) reason = uniq.includes('END-MISSING') || uniq.includes('TRUNCATED') ? 'TRUNCATED' : uniq.includes('OVERFLOW') ? 'OVERFLOW' : 'MALFORMED';
  return { ok, status: ok ? 'VALID' : VERDICT.UNDIAGNOSABLE, reason, errors: uniq, vbEligible: false };
}

/**
 * Whole-trace validator. records = [META, ...data, END] exactly as written. opts.canonicalBytes is the D2
 * canonicalizer; opts.caps the enforced live caps (default LIVE_CAPS). Returns { ok, status: 'VALID'|'UNDIAGNOSABLE',
 * reason: null|'TRUNCATED'|'OVERFLOW'|'MALFORMED', errors: [TRACE_ERRORS codes], vbEligible }. vbEligible is true
 * only if the whole trace is valid AND META passes VB-0 (vg = 1 with (vv, vd) exactly the pinned build). Never throws.
 */
export function validateTrace(records, opts) {
  try { return validateTraceInner(records, opts); } catch { return result(['VALIDATION-EXCEPTION']); }
}

function validateTraceInner(records, { canonicalBytes, caps = LIVE_CAPS } = {}) {
  if (typeof canonicalBytes !== 'function' || !isPlain(caps) || !CAP_KEYS.every((k) => own(caps, k) && Number.isInteger(caps[k]) && caps[k] >= 0)) return result(['BAD-OPTIONS']);
  if (!Array.isArray(records)) return result(['TRACE-NOT-ARRAY']);
  const E = [];
  const len = (v) => { try { return canonicalBytes(v).length; } catch { return null; } };
  const n = records.length;
  const kinds = [];
  for (let i = 0; i < n; i += 1) { const k = kindOf(records[i]); kinds.push(k); if (k === null) E.push('RECORD-NOT-OBJECT'); }
  const metaIdx = []; const endIdx = [];
  kinds.forEach((k, i) => { if (k === 'META') metaIdx.push(i); if (k === 'END') endIdx.push(i); });

  // ---- envelope structure
  if (metaIdx.length === 0) E.push('META-MISSING');
  if (metaIdx.length > 1) E.push('META-DUPLICATE');
  if (n > 0 && kinds[0] !== 'META') E.push('DATA-BEFORE-META');
  if (endIdx.length === 0) E.push('END-MISSING');
  if (endIdx.length > 1) E.push('END-DUPLICATE');
  if (endIdx.length && kinds.slice(endIdx[0] + 1).some((k) => k !== 'END' && k !== 'META')) E.push('DATA-AFTER-END');
  const meta = metaIdx.length ? records[metaIdx[0]] : null;
  const end = endIdx.length ? records[endIdx[0]] : null;
  const data = records.filter((_, i) => kinds[i] !== 'META' && kinds[i] !== 'END');

  // ---- META (the single source of version, schema and capabilities)
  let metaOk = false;
  if (meta) {
    const me = validateMeta(meta, { caps });
    if (me.length) E.push('META-INVALID');
    const pinned = viewerPinMatches(own(meta, 'vv') ? meta.vv : undefined, own(meta, 'vd') ? meta.vd : undefined);
    const anyVb = own(meta, 'vb') && isPlain(meta.vb) && Object.values(meta.vb).some((x) => x === 1);
    if (!pinned && ((own(meta, 'vg') && meta.vg === 1) || anyVb)) E.push('META-VB0-INCONSISTENT');
    if (!own(meta, 'sv') || meta.sv !== 1) E.push('SCHEMA-VERSION-UNSUPPORTED');
    if (!own(meta, 'cp') || !capsMatch(meta.cp, caps)) E.push('META-CAPS-MISMATCH');
    const mb = len(meta);
    if (mb === null || mb > caps.metaBytes) E.push('META-TOO-LARGE');
    metaOk = me.length === 0;
  }
  // a second META, or any later record asserting a different version/schema, is a mixed-version stream
  for (let i = 0; i < n; i += 1) {
    if (meta && i === metaIdx[0]) continue;
    const r = records[i];
    if (meta && isPlain(r) && VERSION_KEYS.some((k) => own(r, k) && (!own(meta, k) || r[k] !== meta[k]))) E.push('VERSION-MIXED');
  }

  // ---- END
  if (end) {
    const ee = validateEnd(end);
    if (ee.length) E.push('END-INVALID');
    if (own(end, 'ts') && Number.isInteger(end.iv) && end.ts !== expectedTerminalStatus(end)) E.push('TERMINAL-STATUS-INCONSISTENT');
    const eb = len(end);
    if (eb === null || eb > caps.endBytes) E.push('END-TOO-LARGE');
    if (!meta || !own(end, 'run') || !own(meta, 'run') || end.run !== meta.run) E.push('RUN-ID-MISMATCH');
    if (own(end, 'truncated') && end.truncated === 1) E.push('TRUNCATED');
    if (own(end, 'overflow') && end.overflow === 1) E.push('OVERFLOW');
    if (own(end, 'iv') && end.iv !== 0) E.push('MALFORMED-APPENDS');
  }

  // ---- data events
  const q0 = meta && own(meta, 'q0') ? meta.q0 : 1;
  let prevQ = null; const seenQ = new Set(); let nb = 0; let nvCount = 0; let bytesOk = true;
  for (let i = 0; i < data.length; i += 1) {
    const d = data[i];
    if (!isPlain(d)) { bytesOk = false; continue; }
    if (ENVELOPE_ONLY.some((k) => own(d, k))) E.push('META-FIELD-IN-DATA');
    if (own(d, 'rn') && (!meta || d.rn !== meta.run)) E.push('RUN-ID-MISMATCH');
    if (validateEvent(d, { mode: 'live' }).length) E.push('DATA-INVALID');
    const b = len(d);
    if (b === null) { bytesOk = false; E.push('DATA-INVALID'); } else {
      nb += b + 1;
      if (b > (d.k === 'NV' ? caps.bytesPerNv : caps.bytesPerEvent)) E.push('EVENT-TOO-LARGE');
    }
    if (d.k === 'NV') nvCount += 1;
    const q = own(d, 'q') ? d.q : undefined;
    if (Number.isInteger(q)) {
      if (prevQ === null) { if (q !== q0) E.push('SEQ-START'); } else if (q === prevQ) E.push('SEQ-DUPLICATE');
      else if (q < prevQ) E.push('SEQ-ROLLBACK');
      else { if (q > prevQ + 1) E.push('SEQ-GAP'); if (seenQ.has(q)) E.push('SEQ-DUPLICATE'); }
      seenQ.add(q); prevQ = q;
    } else E.push('DATA-INVALID');
  }
  if (meta && own(meta, 'cs') && meta.cs === 1) {
    const d0 = data[0];
    if (!(isPlain(d0) && d0.k === 'CAM' && d0.f === 0 && d0.tm === 0)) E.push('CAPTURE-START-MISSING');
  }

  // ---- END accounting against the stream
  if (end) {
    if (!own(end, 'ne') || end.ne !== data.length) E.push('COUNT-MISMATCH');
    const ec = meta && own(meta, 'ec') && isPlain(meta.ec) ? meta.ec : null;
    if (data.length > caps.dataEvents || (ec && (!(data.length >= ec.min) || !(data.length <= ec.max)))) E.push('COUNT-OUT-OF-BOUNDS');
    if (!bytesOk || !own(end, 'nb') || end.nb !== nb) E.push('BYTES-MISMATCH');
    const last = data.length ? data[data.length - 1] : null;
    const lastQ = last && own(last, 'q') ? last.q : 0;
    if (!own(end, 'lq') || end.lq !== lastQ) E.push('LAST-SEQ-MISMATCH');
    if (last && isPlain(last) && ((Number.isInteger(last.f) && !(end.f >= last.f)) || (Number.isInteger(last.tm) && !(end.tm >= last.tm)))) E.push('END-BEFORE-LAST-EVENT');
    if (!own(end, 'nvn') || end.nvn !== nvCount || nvCount > caps.retainedNumericSamples) E.push('NV-COUNT-MISMATCH');
    if (meta) {
      let sd = null;
      try { sd = createHash('sha256').update(canonicalBytes([meta, ...data])).digest('hex'); } catch { sd = null; }
      if (sd === null || !own(end, 'sd') || end.sd !== sd) E.push('STREAM-DIGEST-MISMATCH');
      const total = len([meta, ...data, end]);
      if (total === null || total > caps.totalTraceBytes) E.push('TRACE-TOO-LARGE');
    }
  }

  const out = result(E);
  if (out.ok) out.vbEligible = metaOk && meta.vg === 1 && viewerPinMatches(meta.vv, meta.vd);
  return out;
}

const V_ATOMS = Object.freeze({ 'V-PEND': ['pd', 'pq'], 'V-ACT': ['ac'], 'V-EDGE': [] });

/**
 * META/END-aware live entry point (spec §6.3 "Live entry point"). Order: (1) validateTrace — any failure is
 * whole-trace UNDIAGNOSABLE (reason TRUNCATED / OVERFLOW / MALFORMED) for every question, before any correlation;
 * (2) cfg from META.at / META.id; (3) C6 guard applyVbGuard(META.at, {vg, vv, vd, vb} of META + {pc} of END) — VB-0
 * derived from the exact pinned (vv, vd), never from vg alone; (4) events/fields of each DISABLED configured V-* atom
 * are removed (AE for V-EDGE, pd/pq for V-PEND, ac for V-ACT), so a VB-0 failure yields the public+harness C6 verdict
 * and is never upgraded; (5) correlate(..., {mode: 'live'}). Never throws.
 */
export function correlateTrace(records, { canonicalBytes, caps = LIVE_CAPS, slotWindow } = {}) {
  const integrity = validateTrace(records, { canonicalBytes, caps });
  const undiag = (reason, malformed) => {
    const questions = {}; for (const id of CORRELATOR_QUESTIONS) questions[id] = { status: VERDICT.UNDIAGNOSABLE, reason };
    return { integrity, guard: null, questions, fits: {}, t4: null, S_d: null, contradiction: null, malformed };
  };
  if (!integrity.ok) return undiag(integrity.reason, integrity.reason === 'MALFORMED' ? 'integrity' : null);
  try {
    const meta = records[0]; const end = records[records.length - 1];
    const guard = applyVbGuard(meta.at, { vg: meta.vg, vv: meta.vv, vd: meta.vd, vb: meta.vb, pc: end.pc });
    const disabled = meta.at.filter((a) => own(V_ATOMS, a) && !guard.atoms.includes(a));
    const strip = disabled.flatMap((a) => V_ATOMS[a]);
    const dropAe = disabled.includes('V-EDGE');
    const events = records.slice(1, -1).filter((e) => !(dropAe && e.k === 'AE')).map((e) => {
      const o = { ...e }; for (const key of strip) delete o[key]; return o;
    });
    const cfg = { atoms: guard.atoms, idAxis: meta.id, vbUnavailable: guard.vbUnavailable, mode: 'live' };
    if (slotWindow !== undefined) cfg.slotWindow = slotWindow;
    return { integrity, guard, ...correlate(events, cfg) };
  } catch { return undiag('MALFORMED', 'exception'); }
}
