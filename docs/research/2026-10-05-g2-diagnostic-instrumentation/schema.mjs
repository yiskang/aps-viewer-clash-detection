// DiagEvent schema (spec §6.1): kinds, fields, source-class tags and a TOTAL validator. [SYN] research tooling only.
// Totality (remediation M-5): every lookup is an own-property lookup (a kind or key such as 'toString' is rejected),
// every kind has required fields, the slot-read invariants are enforced, and META/END have their own validators.
import { viewerPinMatches } from './pins.mjs';
import { SEARCH_ATOMS } from './project.mjs';

const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

/** Kind -> source classes (spec §6.1.1). */
export const KIND_CLASS = Object.freeze({
  FIT: ['HAR', 'PUB†'], RST: ['HAR', 'PUB†'], SST: ['HAR'], SMP: ['HAR', 'PUB'], CAM: ['PUB', 'HAR'], TCK: ['PUB'],
  CC: ['PUB†'], CC0: ['PUB†'], TC: ['PUB'], AE: ['VB7124'], XTC: ['SYN'], NV: ['PUB'], META: ['HAR'], END: ['HAR'],
});

/**
 * Per-kind REQUIRED fields of a data event in every projection (spec §6.1.1/§6.1.2). These are the base-atom fields
 * (a projection never removes them); atom-dependent fields are checked against the configured atoms by the
 * correlator (correlate.mjs `checkAtomConsistency`). `tm` is additionally required on every live data event.
 */
export const REQUIRED = Object.freeze({
  FIT: [], RST: ['rs'], SST: ['s'], SMP: ['s', 'n', 'd', 'cl'], CAM: ['cl'], TCK: [], CC: [], CC0: [], TC: [],
  AE: ['ev'], XTC: ['tg'], NV: ['nv'],
});

/** Field -> { cls, kinds, check } (spec §6.1.2). `r` is HAR only; `ow`/`tg` are SYN only. */
const int = (lo, hi = Infinity) => (v) => Number.isInteger(v) && v >= lo && v <= hi;
const oneOf = (...xs) => (v) => xs.includes(v);
/**
 * Slot read invariants (spec §6.1.2 `pd`/`pq`): p in {0,1}; only keys p/b/ch/nw; b is a token or "U"; never b and ch
 * together; p=0 => no b (an empty slot has no binding); p=1 => exactly one of b (ID-ON) / ch (ID-OFF).
 * (`ch` on p=0 is allowed: under ID-OFF the null slot is a value, so "became empty" is ch=1.)
 */
const slotRead = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
  && (v.p === 0 || v.p === 1)
  && Object.keys(v).every((k) => ['p', 'b', 'ch', 'nw'].includes(k))
  && (v.b === undefined || v.b === 'U' || int(1)(v.b)) && (v.ch === undefined || v.ch === 0 || v.ch === 1)
  && (v.nw === undefined || v.nw === 0 || v.nw === 1) && !(v.b !== undefined && v.ch !== undefined)
  && !(v.p === 0 && v.b !== undefined)
  && !(v.p === 1 && v.b === undefined && v.ch === undefined);
/** Upper bound of the live sequence `q` (= LIVE_CAPS.dataEvents, §6.4(b); asserted equal by a test). */
export const MAX_SEQ = 8192;
export const FIELDS = Object.freeze({
  f: { cls: 'HAR', kinds: '*', check: int(0) },
  k: { cls: 'per-kind', kinds: '*', check: (v) => own(KIND_CLASS, v) },
  r: { cls: 'HAR', kinds: ['FIT', 'SST'], check: int(1) },
  s: { cls: 'HAR', kinds: ['SST', 'SMP'], check: oneOf('G', 'S') },
  n: { cls: 'HAR', kinds: ['SMP'], check: int(1, 64) },
  d: { cls: 'HAR', kinds: ['SMP'], check: oneOf('none', 'settled', 'timeout') },
  fr: { cls: 'HAR', kinds: ['SMP'], check: oneOf(1) },
  cl: { cls: 'PUB+HAR', kinds: ['SMP', 'CAM', 'FIT', 'RST'], check: int(0) },
  xc: { cls: 'PUB+HAR', kinds: ['SMP', 'CAM', 'FIT', 'RST'], check: int(0) },
  rs: { cls: 'PUB†+HAR', kinds: ['RST'], check: oneOf('OK', 'NOOP', 'THROW') },
  pd: { cls: 'VB7124', kinds: ['FIT', 'RST', 'SMP', 'CAM'], check: slotRead },
  pq: { cls: 'VB7124', kinds: ['FIT'], check: (v) => slotRead(v) && v.nw === undefined },
  ac: { cls: 'VB7124', kinds: ['FIT', 'RST', 'SMP', 'CAM'], check: oneOf(0, 1) },
  ev: { cls: 'VB7124', kinds: ['AE'], check: oneOf(0, 1) },
  ow: { cls: 'SYN', kinds: ['SMP', 'CAM', 'FIT', 'RST'], check: (v) => typeof v === 'string' && /^(INIT|RESTORE|T\d+\*?)$/.test(v) },
  tg: { cls: 'SYN', kinds: ['XTC'], check: int(1) },
  tm: { cls: 'HAR', kinds: '*', check: int(0), liveOnly: true },
  dg: { cls: 'PUB+HAR', kinds: ['SMP', 'CAM', 'FIT', 'RST'], check: (v) => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v), liveOnly: true },
  nv: { cls: 'PUB', kinds: ['NV'], check: (v) => typeof v === 'string' && v.length === 344 && /^[A-Za-z0-9+/]+=*$/.test(v), liveOnly: true },
  // Whole-trace integrity (spec §6.1.3): `q` = recorder-stamped monotonic sequence (REQUIRED on every live data
  // event; bounded by the §6.4(b) data-event cap), `rn` = optional run id (must equal META.run; not on NV, so the
  // fixed-width NV bound holds).
  q: { cls: 'HAR', kinds: '*', check: int(1, MAX_SEQ), liveOnly: true },
  rn: { cls: 'HAR', kinds: ['FIT', 'RST', 'SST', 'SMP', 'CAM', 'TCK', 'CC', 'CC0', 'TC', 'AE'], check: (v) => typeof v === 'string' && v.length >= 1 && v.length <= 32, liveOnly: true },
});
const LIVE_ONLY_KINDS = ['NV', 'META', 'END'];

/**
 * Validates one data event. mode 'offline' (synthetic) or 'live'. Returns a list of error strings (empty = valid).
 * Total: never throws for any input. Live traces reject SYN fields/kinds; offline traces reject live-only
 * fields/kinds. Byte cap is inclusive.
 */
export function validateEvent(ev, opts) {
  // Total (R-M1): no untrusted value is ever stringified, and any unexpected exception becomes a validation error.
  try { return validateEventInner(ev, opts); } catch { return ['validation failed (exception)']; }
}
function validateEventInner(ev, { mode = 'offline', canonicalBytes, byteCap } = {}) {
  const errs = [];
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return ['not an object'];
  if (Object.getPrototypeOf(ev) !== Object.prototype) return ['not a plain object'];
  if (mode !== 'offline' && mode !== 'live') return ['unknown mode'];
  if (!own(KIND_CLASS, ev.k)) return [typeof ev.k === 'string' ? `unknown kind (string, length ${ev.k.length})` : `unknown kind (${typeof ev.k})`];
  if (ev.k === 'META' || ev.k === 'END') return ['META/END are not data events'];
  if (mode === 'offline' && LIVE_ONLY_KINDS.includes(ev.k)) errs.push(`live-only kind ${ev.k} in offline trace`);
  if (mode === 'live' && KIND_CLASS[ev.k].includes('SYN')) errs.push(`SYN kind ${ev.k} in live trace`);
  if (!own(ev, 'f')) errs.push('missing f');
  for (const req of REQUIRED[ev.k]) if (!own(ev, req)) errs.push(`missing ${req} on ${ev.k}`);
  if (mode === 'live' && !own(ev, 'tm')) errs.push('missing tm on a live event');
  if (mode === 'live' && !own(ev, 'q')) errs.push('missing q on a live event');
  for (const key of Object.keys(ev)) {
    const v = ev[key];
    if (!own(FIELDS, key)) { errs.push(`unknown field ${key}`); continue; }
    const spec = FIELDS[key];
    if (spec.kinds !== '*' && !spec.kinds.includes(ev.k)) errs.push(`field ${key} not allowed on ${ev.k}`);
    if (v === null) errs.push(`null ${key}`);
    else if (!spec.check(v)) errs.push(`bad value for ${key}`);
    if (mode === 'offline' && spec.liveOnly) errs.push(`live-only field ${key} offline`);
    if (mode === 'live' && spec.cls === 'SYN') errs.push(`SYN field ${key} in live trace`);
  }
  // cross-field invariants
  if (own(ev, 'fr') && !(ev.d === 'settled' || ev.d === 'timeout')) errs.push('fr on a non-deciding sample');
  if (own(ev, 'pd') && ev.pd && typeof ev.pd === 'object' && own(ev.pd, 'nw') && ev.k !== 'FIT') errs.push('nw only on the FIT post-call read');
  if (own(ev, 'pq') && !own(ev, 'pd')) errs.push('pq without its post-call pd');
  if (own(ev, 'pd') && ev.k === 'FIT' && ev.pd && typeof ev.pd === 'object' && !own(ev.pd, 'nw')) errs.push('FIT pd without nw');
  if (own(ev, 'xc') && !own(ev, 'cl')) errs.push('xc without cl');
  if (ev.k === 'RST' && ev.rs === 'THROW' && ['cl', 'xc', 'pd', 'ac', 'dg'].some((x) => own(ev, x))) errs.push('a throwing restore has no post-call read');
  if (canonicalBytes && byteCap !== undefined) {
    try {
      const n = canonicalBytes(ev).length;
      if (n > byteCap) errs.push(`event ${n} B > cap ${byteCap}`);
    } catch { errs.push('not serializable'); }
  }
  return errs;
}

const hex64 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const flag = (v) => v === 0 || v === 1;
const plainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const META_VB_ROWS = ['VB-1', 'VB-2', 'VB-3'];
const META_PC_ROWS = ['VB-3'];
/** The one supported live trace schema version (META.sv). */
export const SCHEMA_VERSION = 1;
/** Terminal status values of END.ts (spec §6.1.3 whole-trace integrity). */
export const TERMINAL_STATUS = Object.freeze(['OK', 'TRUNCATED', 'OVERFLOW', 'MALFORMED']);
const META_FIELDS = {
  k: (v) => v === 'META', f: (v) => v === 0, tm: (v) => v === 0,
  sv: (v) => v === SCHEMA_VERSION,
  run: (v) => typeof v === 'string' && v.length >= 1 && v.length <= 32, hh: hex64, ph: hex64, sh: hex64,
  // observed values, recorded verbatim ("ABSENT" when unreadable); VB-0 eligibility is DERIVED from them (pins.mjs)
  vv: (v) => typeof v === 'string' && v.length <= 16, vd: (v) => v === 'ABSENT' || hex64(v), vg: flag,
  vb: (v) => plainObj(v) && Object.keys(v).length === META_VB_ROWS.length && META_VB_ROWS.every((r) => own(v, r) && flag(v[r])),
  br: (v) => typeof v === 'string' && v.length <= 24,
  at: (v) => Array.isArray(v) && v.length <= SEARCH_ATOMS.length && v.every((a, i) => typeof a === 'string' && SEARCH_ATOMS.includes(a) && v.indexOf(a) === i),
  id: oneOf('ON', 'OFF'),
  cp: (v) => plainObj(v) && Object.values(v).every((x) => Number.isInteger(x) && x >= 0),
  ec: (v) => plainObj(v) && Object.keys(v).length === 2 && int(0, MAX_SEQ)(v.min) && int(0, MAX_SEQ)(v.max) && own(v, 'min') && own(v, 'max') && v.min <= v.max,
  q0: (v) => v === 1,
  cs: flag,
};
/** Names of the META-only / END-only fields; a data record carrying one is a mid-stream mutation (trace-integrity). */
export const META_FIELD_NAMES = Object.freeze(Object.keys(META_FIELDS));
/** True iff `cp` is exactly the enforced cap set: same own keys, same integer values. */
export function capsMatch(cp, caps) {
  try {
    if (!plainObj(cp) || !caps || typeof caps !== 'object') return false;
    const a = Object.keys(cp).sort(); const b = Object.keys(caps).sort();
    return a.length === b.length && a.every((k, i) => k === b[i] && cp[k] === caps[k]);
  } catch { return false; }
}
/**
 * Live META validator (spec §6.1.3; all fields required, no others). META holds STRUCTURAL presence only (`vb`); the
 * VB-3 behavioural positive control runs AFTER capture and is recorded in END.pc (R-M4), so it cannot disturb the
 * initial condition being diagnosed. VB-0 (H1): `vg = 1` is valid ONLY when (vv, vd) equal the pinned build exactly;
 * a mismatching (vv, vd) with `vg = 1` or with any `vb` row 1 invalidates the whole META. With `opts.caps`, `cp` must
 * be exactly that cap set. Total: never throws.
 */
export function validateMeta(m, opts) {
  try { return validateMetaInner(m, opts); } catch { return ['META validation failed (exception)']; }
}
function validateMetaInner(m, { caps } = {}) {
  if (!plainObj(m)) return ['META not a plain object'];
  const errs = [];
  for (const [key, chk] of Object.entries(META_FIELDS)) if (!own(m, key)) errs.push(`META missing ${key}`); else if (!chk(m[key])) errs.push(`META bad ${key}`);
  for (const key of Object.keys(m)) if (!own(META_FIELDS, key)) errs.push(`META unknown field ${key}`);
  const anyVb = own(m, 'vb') && plainObj(m.vb) && Object.values(m.vb).some((x) => x === 1);
  if (own(m, 'vg') && m.vg === 0 && anyVb) errs.push('META vb rows present although the VB-0 guard failed');
  const pinned = viewerPinMatches(own(m, 'vv') ? m.vv : undefined, own(m, 'vd') ? m.vd : undefined);
  if (own(m, 'vg') && m.vg === 1 && !pinned) errs.push('META VB-0: vg = 1 but (vv, vd) is not the pinned build');
  if (!pinned && anyVb) errs.push('META VB-0: vb rows present although (vv, vd) is not the pinned build');
  if (caps !== undefined && own(m, 'cp') && !capsMatch(m.cp, caps)) errs.push('META cp is not the enforced cap set');
  return errs;
}
const pcObj = (v) => plainObj(v) && Object.keys(v).length === META_PC_ROWS.length && META_PC_ROWS.every((r) => own(v, r) && flag(v[r]));
const END_FIELDS = {
  k: (v) => v === 'END', pc: pcObj, f: int(0), tm: int(0), ne: int(0), nb: int(0), nvn: int(0), nvx: int(0), rj: int(0), iv: int(0),
  overflow: flag, truncated: flag,
  run: (v) => typeof v === 'string' && v.length >= 1 && v.length <= 32, lq: int(0, MAX_SEQ), ts: (v) => TERMINAL_STATUS.includes(v), sd: hex64,
};
export const END_FIELD_NAMES = Object.freeze(Object.keys(END_FIELDS));
/** The only terminal status consistent with the END flags (precedence TRUNCATED > OVERFLOW > MALFORMED > OK). */
export const expectedTerminalStatus = (e) => (e.truncated === 1 ? 'TRUNCATED' : e.overflow === 1 ? 'OVERFLOW' : e.iv > 0 ? 'MALFORMED' : 'OK');
/**
 * Live END validator (spec §6.1.3; all fields required, no others). `iv` = appends rejected as malformed (M-5);
 * `pc` = post-capture VB-3 positive-control result (R-M4); `ts` must be the status implied by truncated/overflow/iv
 * (`OK` only if all three are 0); without overflow every rejection was a schema rejection (rj = iv), with overflow at
 * least one was a cap rejection (rj > iv). Total: never throws.
 */
export function validateEnd(e) {
  try { return validateEndInner(e); } catch { return ['END validation failed (exception)']; }
}
function validateEndInner(e) {
  if (!plainObj(e)) return ['END not a plain object'];
  const errs = [];
  for (const [key, chk] of Object.entries(END_FIELDS)) if (!own(e, key)) errs.push(`END missing ${key}`); else if (!chk(e[key])) errs.push(`END bad ${key}`);
  for (const key of Object.keys(e)) if (!own(END_FIELDS, key)) errs.push(`END unknown field ${key}`);
  const ints = ['iv', 'rj'].every((k) => own(e, k) && Number.isInteger(e[k]));
  if (ints && e.iv > e.rj) errs.push('END iv > rj');
  if (ints && own(e, 'overflow') && ((e.overflow === 0 && e.rj !== e.iv) || (e.overflow === 1 && e.rj <= e.iv))) errs.push('END rj inconsistent with overflow');
  if (own(e, 'ts') && ints && flag(e.truncated) && flag(e.overflow) && e.ts !== expectedTerminalStatus(e)) errs.push('END ts inconsistent with truncated/overflow/iv');
  return errs;
}
