// Hard numeric bounds (spec §6.4) and the live-trace byte accounting (spec §6.1.3). [SYN] research tooling only.
// All caps are inclusive: a value equal to the cap is accepted; the first operation reaching cap + 1 is rejected.
// The live recorder below is a DESIGN-BOUND REFERENCE for tests only. No live run is authorized; nothing here
// touches a Viewer, browser or the acceptance harness.
import { createHash } from 'node:crypto';
import { fail } from './pins.mjs';
import { validateEvent, validateMeta, validateEnd, expectedTerminalStatus, MAX_SEQ } from './schema.mjs';

/** (a) Offline prototype caps. */
export const OFFLINE_CAPS = Object.freeze({
  eventsPerTrace: 1024,
  bytesPerEvent: 160,
  bytesPerTrace: 163840,
  retainedNumericSamples: 0,
  retainedTraces: 16,
  witnessIndexEntries: 468,
  minimalSetsPerKey: 126,
  summaryBytes: 1048576,
  witnessesBytes: 3145728,
  totalOutputBytes: 4194304,
});

/** (b) Future live diagnostic caps (design bound only; not authorized). */
export const LIVE_CAPS = Object.freeze({
  dataEvents: 8192,
  bytesPerEvent: 256,
  bytesPerNv: 406, // 397 B worst case (f = 99,999,999, tm = MAX_SAFE_INTEGER) + 9 B for `"q":8192,` (whole-trace integrity)
  metaBytes: 1536,
  endBytes: 384, // worst case 371 B with every counter at MAX_SAFE_INTEGER (run/lq/ts/sd added); 2 + 1536 + 1 + 384 <= 2048 reserve
  totalTraceBytes: 2457600,
  retainedNumericSamples: 512,
  retainedExcerpts: 32,
  settleSamples: 64,
  reserveBytes: 2048,
});

/** Generic inclusive cap assertion: value <= limit passes, otherwise exit 2. */
export function assertCap(name, value, limit) {
  if (!(value <= limit)) throw fail('CAP-EXCEEDED', `${name}: ${value} > ${limit}`);
  return value;
}

/**
 * Offline per-trace buffer. append() never partially writes: an event that would exceed any cap is rejected and the
 * buffer is marked overflowed (C5). Trace bytes = canonical array bytes (brackets + commas included).
 */
export class OfflineTraceBuffer {
  constructor(canonicalBytes, caps = OFFLINE_CAPS) {
    this.cb = canonicalBytes; this.caps = caps;
    this.events = []; this.bytes = 2; this.maxEventBytes = 0; this.overflow = null;
  }
  append(ev) {
    if (this.overflow) return false;
    const n = this.cb(ev).length;
    const add = n + (this.events.length ? 1 : 0);
    if (this.events.length + 1 > this.caps.eventsPerTrace) { this.overflow = 'events'; return false; }
    if (n > this.caps.bytesPerEvent) { this.overflow = 'bytesPerEvent'; return false; }
    if (this.bytes + add > this.caps.bytesPerTrace) { this.overflow = 'bytesPerTrace'; return false; }
    this.events.push(ev); this.bytes += add; if (n > this.maxEventBytes) this.maxEventBytes = n;
    return true;
  }
  /** Offline: any overflow is a conformance failure (caps are sized for the D2 domain) => exit 2. */
  assertNoOverflow(id) {
    if (this.overflow) throw fail('CAP-EXCEEDED', `${id}: trace UNDIAGNOSABLE(OVERFLOW:${this.overflow})`);
  }
}

/** Retained witness traces: deterministic first-N selection; the rest are counted (not a verdict change). */
export function selectRetained(refs, cap = OFFLINE_CAPS.retainedTraces) {
  const uniq = [];
  for (const r of refs) if (!uniq.includes(r)) uniq.push(r);
  return { retained: uniq.slice(0, cap), omitted: Math.max(0, uniq.length - cap) };
}

/** Output-file caps (abort before write). files = {name: Buffer}. */
export function checkOutputCaps(files, names, caps = OFFLINE_CAPS) {
  const s = files[names.summary].length; const w = files[names.witnesses].length;
  assertCap('summaryBytes', s, caps.summaryBytes);
  assertCap('witnessesBytes', w, caps.witnessesBytes);
  assertCap('totalOutputBytes', s + w, caps.totalOutputBytes);
  return { summaryBytes: s, witnessesBytes: w, totalOutputBytes: s + w };
}

/**
 * Retained numeric camera samples offline = 0: any non-integer number, or any numeric array of length 32 (a camera
 * sample), anywhere in an output object => exit 2.
 */
export function assertNoNumericPose(obj, path = '$') {
  if (typeof obj === 'number') { if (!Number.isInteger(obj)) throw fail('CAP-EXCEEDED', `numeric pose/fraction at ${path}`); return; }
  if (Array.isArray(obj)) {
    if (obj.length === 32 && obj.every((v) => typeof v === 'number')) throw fail('CAP-EXCEEDED', `numeric camera sample at ${path}`);
    obj.forEach((v, i) => assertNoNumericPose(v, `${path}[${i}]`));
    return;
  }
  if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) assertNoNumericPose(obj[k], `${path}.${k}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Live design bound (§6.1.3 / §6.4(b)) — reference implementation for tests only.

/** Fixed-width NV encoding: 32 finite doubles, little-endian binary64, base64 (exactly 344 chars). null if any non-finite. */
export function encodeNv(values) {
  if (!Array.isArray(values) || values.length !== 32 || values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const buf = Buffer.alloc(256);
  values.forEach((v, i) => buf.writeDoubleLE(v, i * 8));
  return buf.toString('base64');
}

/** Live schema validator used by the recorder by default (M-5). */
export const liveValidator = (ev) => validateEvent(ev, { mode: 'live' });

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const ownKey = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export class LiveTraceRecorder {
  /**
   * opts.validator(ev) -> string[] validates each (sequence-stamped) data event BEFORE any state changes (default: live
   * schema). opts.metaValidator(meta, {caps}) -> string[] (default: validateMeta, which also requires META.cp to be
   * exactly `caps`). Byte-cap tests pass permissive validators because they pad records with a free-form key; that is
   * test-only.
   */
  constructor(meta, canonicalBytes, caps = LIVE_CAPS, { validator = liveValidator, metaValidator = validateMeta } = {}) {
    this.cb = canonicalBytes; this.caps = caps; this.validator = validator;
    let me;
    try { me = metaValidator(meta, { caps }); } catch { me = ['META validator threw']; }
    if (!Array.isArray(me) || me.length) throw fail('META-INVALID', `META invalid (${Array.isArray(me) ? me[0] : 'validator'}): the run does not start`);
    const mb = this.cb(meta).length;
    if (mb > caps.metaBytes) throw fail('META-TOO-LARGE', `META ${mb} > ${caps.metaBytes}: the run does not start`);
    this.meta = meta; this.data = []; this.dataBytes = 0;
    this.nvn = 0; this.nvx = 0; this.rj = 0; this.iv = 0; this.overflow = 0; this.closed = false; this.lastF = 0; this.lastTm = 0;
    this.nextQ = meta.q0; this.lastQ = 0;
  }
  /**
   * Appends one data event; returns true if accepted. The recorder stamps the sequence `q` itself (from META.q0,
   * +1 per ACCEPTED event); a caller-supplied `q`, an `rn` other than META.run, or a non-plain event is invalid. A
   * schema-invalid event is rejected before any state change and counted in END.iv (and rj); a trace with iv > 0 is
   * UNDIAGNOSABLE(MALFORMED). A cap rejection sets overflow (C5). Nothing is partially written.
   */
  append(ev) {
    if (this.closed) throw new Error('recorder closed');
    let errs; let stamped = null;
    try {
      if (!isPlain(ev)) errs = ['not a plain object'];
      else if (ownKey(ev, 'q')) errs = ['q is stamped by the recorder'];
      else if (ownKey(ev, 'rn') && ev.rn !== this.meta.run) errs = ['rn is not META.run'];
      else {
        stamped = { ...ev, q: this.nextQ };
        // sequence exhaustion is a cap (overflow below), never a schema rejection of the caller's event
        errs = this.validator(this.nextQ <= MAX_SEQ ? stamped : { ...ev, q: MAX_SEQ });
      }
    } catch (e) { errs = ['validator threw']; }
    if (!Array.isArray(errs) || errs.length) { this.iv += 1; this.rj += 1; return false; }
    if (this.overflow) { this.rj += 1; return false; }
    let n;
    try { n = this.cb(stamped).length; } catch { this.iv += 1; this.rj += 1; return false; }
    const cap = stamped.k === 'NV' ? this.caps.bytesPerNv : this.caps.bytesPerEvent;
    const ok = n <= cap && this.data.length + 1 <= this.caps.dataEvents && stamped.q <= MAX_SEQ
      && this.dataBytes + n + 1 + this.caps.reserveBytes <= this.caps.totalTraceBytes;
    if (!ok) { this.overflow = 1; this.rj += 1; return false; }
    this.data.push(stamped); this.dataBytes += n + 1; this.lastQ = stamped.q; this.nextQ += 1;
    if (typeof stamped.f === 'number') this.lastF = stamped.f; if (typeof stamped.tm === 'number') this.lastTm = stamped.tm;
    return true;
  }
  /** SMP followed by its NV record while the numeric cap allows (C7: beyond the cap, digest/class only). */
  appendSample(smp, values) {
    if (!this.append(smp)) return false;
    const nv = encodeNv(values);
    if (nv === null || this.nvn >= this.caps.retainedNumericSamples) { this.nvx += 1; return true; }
    if (this.append({ f: smp.f, k: 'NV', nv, tm: smp.tm })) this.nvn += 1;
    return true;
  }
  /**
   * Closes the trace. `pc` is the VB-3 positive-control result obtained AFTER the data capture (spec §6.1.3, R-M4);
   * absent means not run or failed => {VB-3: 0} (fail closed; the C6 guard then disables V-EDGE post hoc).
   * `truncated: 1` records an aborted capture. END carries the run id, the terminal sequence `lq`, the terminal
   * status `ts` implied by truncated/overflow/iv, and the stream commitment `sd` = SHA-256(canonical [META, ...data]).
   */
  close({ pc, truncated = 0 } = {}) {
    this.closed = true;
    const end = {
      f: this.lastF, iv: this.iv, k: 'END', lq: this.lastQ, nb: this.dataBytes, ne: this.data.length, nvn: this.nvn, nvx: this.nvx,
      overflow: this.overflow, pc: pc === undefined ? { 'VB-3': 0 } : pc, rj: this.rj, run: this.meta.run,
      sd: createHash('sha256').update(this.cb([this.meta, ...this.data])).digest('hex'), tm: this.lastTm, truncated,
    };
    end.ts = expectedTerminalStatus(end);
    const ee = validateEnd(end);
    if (ee.length) throw fail('END-INVALID', `END invalid (${ee[0]})`);
    const eb = this.cb(end).length;
    if (eb > this.caps.endBytes) throw fail('END-TOO-LARGE', `END ${eb} > ${this.caps.endBytes}`);
    const all = [this.meta, ...this.data, end];
    const bytes = this.cb(all);
    if (bytes.length > this.caps.totalTraceBytes) throw fail('CAP-EXCEEDED', `live trace ${bytes.length} > ${this.caps.totalTraceBytes}`);
    return { end, bytes, records: all };
  }
}

/** Retained live witness excerpts (cap 32). */
export const selectLiveExcerpts = (refs) => selectRetained(refs, LIVE_CAPS.retainedExcerpts);
