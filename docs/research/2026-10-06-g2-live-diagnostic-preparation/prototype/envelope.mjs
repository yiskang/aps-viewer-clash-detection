// Trace-schema-2 envelope (Part 2 §12): canonical serialization (the committed D2 canonicalizer, loaded from its
// digest-verified bytes), JSONL raw form and the derived trace array, the stream commitment END.sd, an offline
// reference recorder with the Part 1 §8.6 lifecycle (used only to generate synthetic fixtures), and the TOTAL
// whole-trace validator validateTraceV2 (Part 2 §12.6). [SYN] offline research prototype only: nothing here touches
// a Viewer, browser, live harness or acceptance code, and nothing here writes a file.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED as COMMITTED_PIN_DIGESTS } from '../../2026-10-05-g2-diagnostic-instrumentation/pins.mjs';
import {
  validateDataRecord, validateMetaV2, validateEndV2, envelopeOnlyKeys, checkSequence, capsV2, viewerPinned,
  windowIndices, expectedTerminalStatus, TZ_CAUSE_CODE,
} from './trace-schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..', '..', '..');
const D2_CANONICAL = join(REPO, 'docs/research/2026-10-04-g2-d2-synthetic-transition/canonical.mjs');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Loads the committed D2 canonicalizer from bytes whose SHA-256 equals the committed pin (fail closed). */
async function loadCanonical() {
  const bytes = readFileSync(D2_CANONICAL);
  const d = sha256(bytes);
  if (d !== COMMITTED_PIN_DIGESTS.d2Canonical) throw new Error(`CANONICAL-DIGEST: ${d} != ${COMMITTED_PIN_DIGESTS.d2Canonical}`);
  return import(`data:text/javascript;base64,${bytes.toString('base64')}`);
}
const CANON = await loadCanonical();
export const canonicalStringify = CANON.canonicalStringify;
export const canonicalBytes = CANON.canonicalBytes;
export const CANONICAL_SHA256 = COMMITTED_PIN_DIGESTS.d2Canonical;
export { sha256 };

const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const U32 = 4294967295;
const sat = (n) => Math.min(n, U32);

// ---------------------------------------------------------------- raw file forms (Part 2 §12.2)

/** Authoritative raw form: one canonical record per line, each line LF-terminated. */
export function toJsonl(records) {
  return records.map((r) => canonicalStringify(r)).join('\n') + (records.length ? '\n' : '');
}
/** The derived trace array bytes: '[' + lines without their LF, joined by ',' + ']' (rule 4). */
export function traceArrayFromJsonl(text) {
  const lines = text.split('\n'); lines.pop();
  return `[${lines.join(',')}]`;
}
/**
 * Strict JSONL parse: LF only, final LF, every line canonical. Returns { ok, records, code }. Total. A non-canonical
 * or unparsable line is never repaired (raw bytes are never normalized).
 */
export function parseJsonl(text) {
  try {
    if (typeof text !== 'string') return { ok: false, records: null, code: 'JSONL-NOT-TEXT' };
    if (text.includes('\r')) return { ok: false, records: null, code: 'JSONL-CR' };
    if (text.length && !text.endsWith('\n')) return { ok: false, records: null, code: 'JSONL-NO-FINAL-LF' };
    const lines = text.split('\n'); lines.pop();
    const records = [];
    for (const line of lines) {
      let v;
      try { v = JSON.parse(line); } catch { return { ok: false, records: null, code: 'JSONL-PARSE' }; }
      let c;
      try { c = canonicalStringify(v); } catch { return { ok: false, records: null, code: 'JSONL-NON-CANONICAL' }; }
      if (c !== line) return { ok: false, records: null, code: 'JSONL-NON-CANONICAL' };
      records.push(v);
    }
    return { ok: true, records, code: null };
  } catch { return { ok: false, records: null, code: 'JSONL-PARSE' }; }
}

/** END.sd: SHA-256 of the canonical bytes of [META, ...data]. */
export const streamDigest = (meta, data) => sha256(canonicalBytes([meta, ...data]));

// ---------------------------------------------------------------- offline reference recorder (Part 1 §8.6)

export const RECORDER_STATE = Object.freeze({ CREATED: 'CREATED', CAPTURING: 'CAPTURING', CONTROL: 'CONTROL', FINALIZING: 'FINALIZING', CLOSED: 'CLOSED' });

/** A simulated page load: at most one recorder may ever be constructed in it (Part 1 §8.6, SC-B01). */
export class Page {
  constructor() { this.recorderOrdinal = 0; }
}
export class RecorderRefused extends Error {
  constructor(msg) { super(msg); this.code = 'SC-B01'; }
}

/**
 * Offline model of the future recorder, used only to produce synthetic fixtures with exact END accounting. It stamps
 * `q`, validates each record against its wire variant BEFORE any state change (invalid => iv, rj), enforces the
 * schema-2 caps (exceeding => overflow, rj; nothing partially written), and implements the one-way lifecycle:
 * callbacks in FINALIZING/CLOSED are no-ops that change no byte, counter or sequence number.
 */
export class Recorder {
  constructor(page, metaTemplate, { contract }) {
    if (!(page instanceof Page)) throw new RecorderRefused('no page');
    if (page.recorderOrdinal >= 1) throw new RecorderRefused('second recorder in one page load refused');
    page.recorderOrdinal += 1;
    this.contract = contract; this.caps = capsV2(contract);
    this.template = { ...metaTemplate, rc: page.recorderOrdinal };
    this.state = RECORDER_STATE.CREATED; this.listeners = 2; this.qe = 0; this.teardowns = 0;
    this.meta = null; this.data = []; this.bytes = 0; this.nvn = 0; this.nvx = 0; this.rj = 0; this.iv = 0;
    this.overflow = 0; this.mx = 0; this.cg = 0; this.lr = 0; this.zt = null; this.rejections = [];
    this.envKeys = envelopeOnlyKeys(contract);
  }
  /** A TE dispatched while CREATED (quiescence window): marks quiescence failure only, no data record. */
  quiescenceEdge() { if (this.state === RECORDER_STATE.CREATED) this.qe = sat(this.qe + 1); }
  /** Same-segment boundary read + META + capture-start FS (CREATED -> CAPTURING). Returns the META written. */
  start({ ba = 'FALSE', bp = 'NULL', lb = 1, fsFields }) {
    if (this.state !== RECORDER_STATE.CREATED) return null;
    const m = { ...this.template, ba, bp, lb, qe: this.qe };
    m.ei = m.lb === 1 && m.qe === 0 && m.ba === 'FALSE' && m.bp === 'NULL' ? 'LOW' : 'UNKNOWN';
    this.meta = m; this.state = RECORDER_STATE.CAPTURING;
    this.append({ ...fsFields, k: 'FS', f: 0, tm: 0 });
    return m;
  }
  /** Appends one data record; returns its stamped form, or null if rejected or a no-op. */
  append(rec) {
    if (this.state === RECORDER_STATE.FINALIZING || this.state === RECORDER_STATE.CLOSED || this.state === RECORDER_STATE.CREATED) return null;
    const stamped = { ...rec, q: this.data.length + 1 };
    if (own(rec, 'q')) { this.iv = sat(this.iv + 1); this.rj = sat(this.rj + 1); return null; }
    const codes = validateDataRecord(stamped, { contract: this.contract, envelopeOnlyKeys: this.envKeys, atoms: this.meta.at });
    if (codes.length) { this.iv = sat(this.iv + 1); this.rj = sat(this.rj + 1); this.rejections.push({ codes, record: rec }); return null; }
    if (this.overflow) { this.rj = sat(this.rj + 1); return null; }
    const n = canonicalBytes(stamped).length;
    const cap = stamped.k === 'NV' ? this.caps.bytesPerNv : this.caps.bytesPerEvent;
    const sampleOver = stamped.k === 'T4' && stamped.tp === 'sample' && stamped.n > this.caps.settleSamples;
    const nvOver = stamped.k === 'NV' && this.nvn >= this.caps.retainedNumericSamples;
    if (nvOver) { this.nvx = sat(this.nvx + 1); return null; } // C7: beyond the retained cap, digest/class only
    if (sampleOver || n > cap || this.data.length + 1 > this.caps.dataEvents
      || this.bytes + n + 1 + this.caps.reserveBytes > this.caps.totalTraceBytes) {
      this.overflow = 1; this.rj = sat(this.rj + 1); return null;
    }
    this.data.push(stamped); this.bytes += n + 1;
    if (stamped.k === 'NV') this.nvn += 1;
    if (stamped.k === 'T4' && stamped.tp === 'sample') this.mx = Math.max(this.mx, stamped.n);
    if (stamped.k === 'TZ' && stamped.zp === 'targetEnd' && this.state === RECORDER_STATE.CAPTURING) { this.state = RECORDER_STATE.CONTROL; this.zt = stamped.q; }
    if (stamped.k === 'TZ' && stamped.zp === 'final') { this.state = RECORDER_STATE.FINALIZING; this.teardown(); }
    return stamped;
  }
  /** A numeric sample that was not retained (C7 accounting). */
  nvNotRetained() { if (this.state === RECORDER_STATE.CAPTURING) this.nvx = sat(this.nvx + 1); }
  /** Removes the recorder's own TE/TC listeners; idempotent (a second call is a no-op). */
  teardown() {
    this.teardowns += 1;
    if (this.listeners === 0) return false;
    this.listeners = 0; this.lr = 1; return true;
  }
  /** Writes END (FINALIZING -> CLOSED, or an abnormal close). Returns [META, ...data, END]. */
  close({ pc = { 'VB-3': 0 }, truncated = 0, cg = 0 } = {}) {
    if (this.state === RECORDER_STATE.CLOSED) return null;
    const last = this.data[this.data.length - 1];
    const fin = this.data.find((r) => r.k === 'TZ' && r.zp === 'final');
    const end = {
      cg: cg ? 1 : this.cg, ds: fin ? TZ_CAUSE_CODE[fin.zc] : 2, f: last ? last.f : 0, iv: this.iv, k: 'END',
      lq: last ? last.q : 0, lr: this.lr, mx: this.mx, nb: this.bytes, ne: this.data.length, nvn: this.nvn, nvx: this.nvx,
      overflow: this.overflow, pc, rj: this.rj, run: this.meta.run, sd: streamDigest(this.meta, this.data),
      tm: last ? last.tm : 0, truncated, zt: this.zt ?? 1,
    };
    end.ts = expectedTerminalStatus(end);
    this.state = RECORDER_STATE.CLOSED;
    const out = [this.meta, ...this.data, end];
    Object.defineProperty(out, 'rejections', { value: this.rejections, enumerable: false });
    return out;
  }
}

/** Recomputes END accounting after a deliberate fixture mutation of META/data (so a mutation is caught by its own rule). */
export function reseal(records, { keepSd = false } = {}) {
  const meta = records[0]; const end = records[records.length - 1]; const data = records.slice(1, -1);
  end.ne = data.length; end.nb = data.reduce((s, d) => s + canonicalBytes(d).length + 1, 0);
  end.lq = data.length ? data[data.length - 1].q : 0; end.nvn = data.filter((d) => d.k === 'NV').length;
  if (!keepSd) end.sd = streamDigest(meta, data);
  return records;
}

// ---------------------------------------------------------------- whole-trace validator (Part 2 §12.6)

/** Every code validateTraceV2 can emit (committed 39, adapted to sv = 2; Part 1; Part 2). Must equal the union of
 * Part 2 Appendix (i) integrityCodes.committedList, .part1 and .part2 (asserted by envelope.prep-test.mjs). */
export const TRACE_V2_CODES = Object.freeze([
  'VALIDATION-EXCEPTION', 'BAD-OPTIONS', 'TRACE-NOT-ARRAY', 'RECORD-NOT-OBJECT', 'META-MISSING', 'META-DUPLICATE',
  'DATA-BEFORE-META', 'META-INVALID', 'META-VB0-INCONSISTENT', 'SCHEMA-VERSION-UNSUPPORTED', 'META-CAPS-MISMATCH',
  'META-TOO-LARGE', 'END-MISSING', 'END-DUPLICATE', 'DATA-AFTER-END', 'END-INVALID', 'TERMINAL-STATUS-INCONSISTENT',
  'END-TOO-LARGE', 'RUN-ID-MISMATCH', 'META-FIELD-IN-DATA', 'VERSION-MIXED', 'DATA-INVALID', 'EVENT-TOO-LARGE',
  'SEQ-START', 'SEQ-GAP', 'SEQ-ROLLBACK', 'SEQ-DUPLICATE', 'CAPTURE-START-MISSING', 'COUNT-MISMATCH',
  'COUNT-OUT-OF-BOUNDS', 'BYTES-MISMATCH', 'LAST-SEQ-MISMATCH', 'END-BEFORE-LAST-EVENT', 'NV-COUNT-MISMATCH',
  'STREAM-DIGEST-MISMATCH', 'TRACE-TOO-LARGE', 'TRUNCATED', 'OVERFLOW', 'MALFORMED-APPENDS',
  // Part 1
  'I1-RQ-PAIR', 'I2-RQ-THREW-READS', 'I3-HOST-PS', 'I4-T4-DECISION', 'I5-C8-BINDING', 'I6-TZ-WINDOW', 'I7-SLOT-DELTA',
  'RS-PAIR', 'SETTLE-ROLES', 'CONTROL-WINDOW-KIND', 'FS-FRAME-GAP', 'CE-NOT-CONFIGURED', 'WIRE-VARIANT',
  // Part 2
  'TZ-STATUS-MISMATCH', 'PC-MISMATCH', 'ROLE-MISMATCH', 'CT-PLACEMENT', 'EDGEINIT-INCONSISTENT', 'RECORDER-ORDINAL',
  'LIFECYCLE-MISMATCH', 'FRAME-BOUND', 'SAMPLE-BOUND', 'FRAME-ORDER', 'TIME-ORDER', 'BINDING-MISMATCH',
  'OBSERVED_VIEWER_NOT_BOUND', 'OBSERVED_BUNDLE_NOT_BOUND',
]);

/** Binding field -> META key (Part 2 §12.6 step 4). */
export const BINDING_META_KEYS = Object.freeze({
  authorizationId: 'ai', authorizationRecordSha256: 'ah', attemptId: 'ad', diagnosticHarnessSha256: 'hh',
  procedureSha256: 'ph', diagnosticSpecSha256: 'sh', diagnosticPackageSha256: 'pk', targetPlanSha256: 'tq',
  atoms: 'at', idAxis: 'id', slotWindow: 'sw', caps: 'cp',
});
const BOUNDARY_KEYS = ['ei', 'ba', 'bp', 'lb', 'qe'];
const deepEq = (a, b) => { try { return canonicalStringify(a) === canonicalStringify(b); } catch { return false; } };

function finish(envelopeErrs, bindingErrs, extra) {
  const env = [...new Set(envelopeErrs)].sort();
  const bind = [...new Set(bindingErrs)].sort();
  const errors = [...new Set([...env, ...bind])].sort();
  const ok = errors.length === 0;
  let reason = null;
  if (!ok) reason = errors.includes('END-MISSING') || errors.includes('TRUNCATED') ? 'TRUNCATED' : errors.includes('OVERFLOW') ? 'OVERFLOW' : 'MALFORMED';
  return { ok, envelopeOk: env.length === 0, bindingOk: bind.length === 0, reason, errors, envelopeErrors: env, bindingErrors: bind, ...extra };
}

/**
 * Whole-trace validator for trace schema 2. records = [META, ...data, END] exactly as written.
 * opts: { contract, role ('T' | 'PC-1' | 'PC-2' | 'PC-4' | 'PC-5'), binding (contract-name object, §17 / Appendix iv),
 * template? (frozen META template; every field except ei/ba/bp/lb/qe must match) }.
 * Returns { ok, envelopeOk, bindingOk, reason, errors, envelopeErrors, bindingErrors, vbEligible, maxSampleIndex }.
 * TOTAL: never throws. Any failure makes the WHOLE trace unusable; no prefix is ever positive evidence.
 */
export function validateTraceV2(records, opts) {
  try { return validateTraceV2Inner(records, opts || {}); } catch { return finish(['VALIDATION-EXCEPTION'], [], { vbEligible: false, maxSampleIndex: 0 }); }
}
function validateTraceV2Inner(records, { contract, role, binding, template }) {
  if (!contract || !contract.envelope || !contract.part1) return finish(['BAD-OPTIONS'], [], { vbEligible: false, maxSampleIndex: 0 });
  if (!Array.isArray(records)) return finish(['TRACE-NOT-ARRAY'], [], { vbEligible: false, maxSampleIndex: 0 });
  const caps = capsV2(contract);
  const E = []; const B = [];
  const len = (v) => { try { return canonicalBytes(v).length; } catch { return null; } };
  const kinds = records.map((r) => (isPlain(r) && own(r, 'k') && typeof r.k === 'string' ? r.k : null));
  kinds.forEach((k) => { if (k === null) E.push('RECORD-NOT-OBJECT'); });
  const metaIdx = []; const endIdx = [];
  kinds.forEach((k, i) => { if (k === 'META') metaIdx.push(i); if (k === 'END') endIdx.push(i); });
  if (metaIdx.length === 0) E.push('META-MISSING');
  if (metaIdx.length > 1) E.push('META-DUPLICATE');
  if (records.length > 0 && kinds[0] !== 'META') E.push('DATA-BEFORE-META');
  if (endIdx.length === 0) E.push('END-MISSING');
  if (endIdx.length > 1) E.push('END-DUPLICATE');
  if (endIdx.length && kinds.slice(endIdx[0] + 1).some((k) => k !== 'END' && k !== 'META')) E.push('DATA-AFTER-END');
  const meta = metaIdx.length ? records[metaIdx[0]] : null;
  const end = endIdx.length ? records[endIdx[endIdx.length - 1]] : null;
  const data = records.filter((r, i) => kinds[i] !== 'META' && kinds[i] !== 'END' && kinds[i] !== null);

  // ---- META
  if (meta) {
    for (const c of validateMetaV2(meta, { contract })) E.push(c);
    if (meta.rl !== role) E.push('ROLE-MISMATCH');
    const mb = len(meta);
    if (mb === null || mb > caps.metaBytes) E.push('META-TOO-LARGE');
  }
  for (let i = 0; i < records.length; i += 1) {
    if (meta && i === metaIdx[0]) continue;
    const r = records[i];
    if (meta && isPlain(r) && ['vv', 'vd', 'sv'].some((k) => own(r, k) && (!own(meta, k) || r[k] !== meta[k]))) E.push('VERSION-MIXED');
  }
  // ---- END
  if (end) {
    for (const c of validateEndV2(end, { contract })) E.push(c);
    const eb = len(end);
    if (eb === null || eb > caps.endBytes) E.push('END-TOO-LARGE');
    if (!meta || end.run !== meta.run) E.push('RUN-ID-MISMATCH');
    if (end.truncated === 1) E.push('TRUNCATED');
    if (end.overflow === 1) E.push('OVERFLOW');
    if (end.iv !== 0) E.push('MALFORMED-APPENDS');
  }
  // ---- data records
  const envKeys = envelopeOnlyKeys(contract);
  const atoms = meta && Array.isArray(meta.at) ? meta.at : [];
  let prevQ = null; const seenQ = new Set(); let nb = 0; let nvCount = 0; let bytesOk = true;
  for (const d of data) {
    for (const c of validateDataRecord(d, { contract, envelopeOnlyKeys: envKeys, atoms })) E.push(c);
    if (own(d, 'rn') && (!meta || d.rn !== meta.run)) E.push('RUN-ID-MISMATCH');
    const b = len(d);
    if (b === null) { bytesOk = false; E.push('DATA-INVALID'); } else {
      nb += b + 1;
      if (b > (d.k === 'NV' ? caps.bytesPerNv : caps.bytesPerEvent)) E.push('EVENT-TOO-LARGE');
    }
    if (d.k === 'NV') nvCount += 1;
    const q = d.q;
    if (Number.isInteger(q)) {
      if (prevQ === null) { if (q !== (meta && Number.isInteger(meta.q0) ? meta.q0 : 1)) E.push('SEQ-START'); } else if (q === prevQ) E.push('SEQ-DUPLICATE');
      else if (q < prevQ) E.push('SEQ-ROLLBACK');
      else { if (q > prevQ + 1) E.push('SEQ-GAP'); if (seenQ.has(q)) E.push('SEQ-DUPLICATE'); }
      seenQ.add(q); prevQ = q;
    } else E.push('DATA-INVALID');
  }
  const d0 = data[0];
  if (!(d0 && d0.k === 'FS' && d0.f === 0 && d0.tm === 0)) E.push('CAPTURE-START-MISSING');
  // ---- sequence rules (Part 1 I1–I7; Part 2 step 2–3)
  const seqRes = checkSequence(data, { role, caps });
  for (const c of seqRes.codes) E.push(c);
  // ---- END accounting and Part 2 cross-checks
  if (end) {
    if (end.ne !== data.length) E.push('COUNT-MISMATCH');
    const ec = meta && isPlain(meta.ec) ? meta.ec : null;
    if (data.length > caps.dataEvents || (ec && !(data.length >= ec.min && data.length <= ec.max))) E.push('COUNT-OUT-OF-BOUNDS');
    if (!bytesOk || end.nb !== nb) E.push('BYTES-MISMATCH');
    const last = data.length ? data[data.length - 1] : null;
    if (end.lq !== (last && Number.isInteger(last.q) ? last.q : 0)) E.push('LAST-SEQ-MISMATCH');
    if (last && ((Number.isInteger(last.f) && !(end.f >= last.f)) || (Number.isInteger(last.tm) && !(end.tm >= last.tm)))) E.push('END-BEFORE-LAST-EVENT');
    if (end.nvn !== nvCount || nvCount > caps.retainedNumericSamples) E.push('NV-COUNT-MISMATCH');
    if (meta) {
      let sd = null; try { sd = streamDigest(meta, data); } catch { sd = null; }
      if (sd === null || end.sd !== sd) E.push('STREAM-DIGEST-MISMATCH');
      const total = len([meta, ...data, end]);
      if (total === null || total > caps.totalTraceBytes) E.push('TRACE-TOO-LARGE');
    }
    const w = windowIndices(data);
    const fin = w.final >= 0 ? data[w.final] : null;
    if (!fin || end.ds !== TZ_CAUSE_CODE[fin.zc]) E.push('TZ-STATUS-MISMATCH');
    const tzEnd = w.targetEnd >= 0 ? data[w.targetEnd] : null;
    if (!tzEnd || end.zt !== tzEnd.q) E.push('LIFECYCLE-MISMATCH');
    if (end.mx !== seqRes.maxSampleIndex) E.push('SAMPLE-BOUND');
    const pcPassed = data.some((r) => r.k === 'CT' && r.ci === 'PC-3' && r.cr === 'PASSED');
    const pcVal = isPlain(end.pc) ? end.pc['VB-3'] : undefined;
    if (role === 'T' ? pcVal !== (pcPassed ? 1 : 0) : pcVal !== 0) E.push('PC-MISMATCH');
  }
  // ---- binding (Part 2 §12.6 step 4)
  if (meta) {
    if (!isPlain(binding)) B.push('BINDING-MISMATCH');
    else {
      for (const [field, key] of Object.entries(BINDING_META_KEYS)) if (!deepEq(binding[field], meta[key])) B.push('BINDING-MISMATCH', `BINDING-MISMATCH:${field}`);
      if (meta.vv !== binding.viewerVersion) B.push('OBSERVED_VIEWER_NOT_BOUND');
      if (meta.vd !== binding.viewerBundleSha256) B.push('OBSERVED_BUNDLE_NOT_BOUND');
    }
    if (template !== undefined) {
      const strip = (m) => { const o = { ...m }; for (const k of BOUNDARY_KEYS) delete o[k]; return o; };
      if (!isPlain(template) || !deepEq(strip(template), strip(meta))) B.push('BINDING-MISMATCH', 'BINDING-MISMATCH:metaTemplate');
    }
  }
  const out = finish(E, B, { maxSampleIndex: seqRes.maxSampleIndex });
  out.vbEligible = out.ok && meta.vg === 1 && viewerPinned(contract, meta.vv, meta.vd);
  return out;
}
