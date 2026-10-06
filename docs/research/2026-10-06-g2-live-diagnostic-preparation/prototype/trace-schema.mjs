// Trace schema 2: data-record, META and END validators, plus the Part 1 pairing invariants I1–I7 and the
// whole-trace structural rules of Part 2 §12.6 step 2–3 that need the record sequence. [SYN] offline research
// prototype only: nothing here touches a Viewer, browser, live harness or acceptance code.
//
// Every validator is TOTAL (never throws; own-property lookups only) and returns stable codes. The wire schema is
// taken from the Part 1 appendix (`wireKeys`, `wireVariants`, `fieldTypes`) and the Part 2 appendix (i) (META/END,
// caps) through `loadContract()`; the hand-written value checks below are asserted to cover every contract key by
// the research-local tests. Where the spec is ambiguous the strict (fail-closed) reading is chosen; see NOTES.md.

const own = (o, k) => !!o && typeof o === 'object' && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const int = (lo, hi = Number.MAX_SAFE_INTEGER) => (v) => Number.isInteger(v) && v >= lo && v <= hi;
const oneOf = (...xs) => (v) => xs.includes(v);
const hex = (n) => (v) => typeof v === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(v);
const str = (lo, hi) => (v) => typeof v === 'string' && v.length >= lo && v.length <= hi;
const U32 = 4294967295;

export const DATA_KINDS = Object.freeze(['RQ', 'PS', 'TE', 'FS', 'T4', 'RS', 'CE', 'TC', 'C8', 'CT', 'TZ']);
export const TZ_CAUSE_CODE = Object.freeze({ normal: 0, stop: 1, error: 2 });

/** Value checks per LOGICAL field name (Part 1 Appendix `fieldTypes`); wire names come from `wireKeys`. */
export const FIELD_CHECKS = Object.freeze({
  kind: (v) => typeof v === 'string' && (DATA_KINDS.includes(v) || v === 'NV'),
  seq: int(1),
  frame: int(0),
  tRel: int(0),
  runId: str(1, 32),
  phase: oneOf('pre', 'post'),
  reqToken: int(1),
  callOutcome: oneOf('returned', 'threw'),
  slotPresent: oneOf(0, 1),
  slotBinding: (v) => v === 'U' || int(1)(v),
  slotNew: oneOf(0, 1),
  slotDelta: oneOf('none', 'appear', 'replace', 'clear'),
  hostSeq: int(1),
  readSite: oneOf('frame', 't4Sample'),
  camClass: int(0),
  camDigest: hex(16),
  edgeValue: oneOf(0, 1),
  payloadActive: oneOf(0, 1),
  t4Phase: oneOf('start', 'sample', 'decision'),
  settleRole: oneOf('G', 'S', 'P'),
  sampleIndex: int(0), // the per-settle bound is SAMPLE-BOUND (cp.settleSamples), checked on the sequence
  decision: oneOf('none', 'settled', 'timeout'),
  sampleSeq: int(1),
  terminal: oneOf(1),
  deciding: oneOf(1),
  restoreResult: oneOf('OK', 'NOOP', 'THROW'),
  measureRole: oneOf('subject', 'superseded'),
  targetKey: str(1, 32),
  evaluable: oneOf(0, 1),
  inside: oneOf(0, 1),
  tzPhase: oneOf('targetEnd', 'final'),
  tzCause: oneOf('normal', 'stop', 'error'),
  controlId: oneOf('PC-1', 'PC-2', 'PC-3', 'PC-4', 'PC-5'),
  controlOutcome: oneOf('PASSED', 'FAILED', 'NOT_RUN'),
  framesUsed: int(0),
  frameBudget: int(0),
  numeric: (v) => typeof v === 'string' && v.length === 344 && /^[A-Za-z0-9+/]+=*$/.test(v),
});

/** Wire key -> logical name, built from the contract (single source: Part 1 Appendix `wireKeys`). */
export function wireIndex(contract) {
  const out = {};
  for (const [logical, wire] of Object.entries(contract.part1.wireKeys)) out[wire] = logical;
  return out;
}

/** The variant name of a data record (a Part 1 `wireVariants` key), or null if it cannot be determined. */
export function variantOf(r) {
  if (!isPlain(r) || !own(r, 'k')) return null;
  switch (r.k) {
    case 'RQ':
      if (r.pp === 'pre') return 'RQ.pre';
      if (r.pp === 'post') return r.co === 'threw' ? 'RQ.post.threw' : 'RQ.post.returned';
      return null;
    case 'T4':
      return r.tp === 'start' ? 'T4.start' : r.tp === 'sample' ? 'T4.sample' : r.tp === 'decision' ? 'T4.decision' : null;
    case 'RS':
      return r.pp === 'pre' ? 'RS.pre' : r.pp === 'post' ? 'RS.post' : null;
    case 'NV': return 'NV';
    default:
      return DATA_KINDS.includes(r.k) ? r.k : null;
  }
}

const COMMON_REQ = ['k', 'q', 'f', 'tm'];

/** Conditional keys per variant: key -> predicate(record) meaning "present iff predicate". */
function conditionalRules(variant) {
  const sbIff = { sb: (r) => r.sp === 1 };
  switch (variant) {
    case 'RQ.pre': case 'RQ.post.returned': case 'PS': return sbIff;
    case 'T4.decision': return {
      ss: (r) => Number.isInteger(r.n) && r.n >= 1,
      te: (r) => r.d === 'settled' || r.d === 'timeout', // strict reading: te=1 iff the decision is terminal
      fr: null, // optional; constrained below and by I4
    };
    case 'RS.post': return {
      cl: (r) => r.rs !== 'THROW', dg: (r) => r.rs !== 'THROW', sp: (r) => r.rs !== 'THROW', sx: (r) => r.rs !== 'THROW',
      sb: (r) => r.rs !== 'THROW' && r.sp === 1,
    };
    default: return {};
  }
}

/**
 * Validates one data record against its Part 1 wire variant. Returns a sorted, de-duplicated list of codes:
 * `DATA-INVALID` (unknown variant, missing required key, bad value type), `WIRE-VARIANT` (forbidden, unknown or
 * conditional-key violation), `META-FIELD-IN-DATA` (a META/END-only key), `I2-RQ-THREW-READS`, `CE-NOT-CONFIGURED`.
 * opts: { contract, envelopeOnlyKeys: Set, atoms: [] }. Total.
 */
export function validateDataRecord(r, opts) {
  try { return validateDataRecordInner(r, opts); } catch { return ['DATA-INVALID']; }
}
function validateDataRecordInner(r, { contract, envelopeOnlyKeys = new Set(), atoms = [] }) {
  const codes = new Set();
  if (!isPlain(r)) return ['DATA-INVALID'];
  const variant = variantOf(r);
  const spec = variant ? contract.part1.wireVariants[variant] : undefined;
  if (!variant || !spec) return ['DATA-INVALID'];
  const W = wireIndex(contract);
  const required = new Set([...COMMON_REQ.filter((k) => !(variant === 'NV' && k === 'rn')), ...(spec.required || [])]);
  const forbidden = new Set(spec.forbidden || []);
  const cond = conditionalRules(variant);
  const allowed = new Set([...required, ...Object.keys(cond)]);
  if (variant !== 'NV') allowed.add('rn');
  // values
  for (const key of Object.keys(r)) {
    if (envelopeOnlyKeys.has(key)) { codes.add('META-FIELD-IN-DATA'); continue; }
    if (!own(W, key)) { codes.add('WIRE-VARIANT'); continue; }
    if (!allowed.has(key) || forbidden.has(key)) codes.add('WIRE-VARIANT');
    const chk = FIELD_CHECKS[W[key]];
    if (!chk || !chk(r[key])) codes.add('DATA-INVALID');
  }
  for (const key of required) if (!own(r, key)) codes.add('DATA-INVALID');
  for (const [key, pred] of Object.entries(cond)) {
    if (pred === null) continue;
    if (pred(r) !== own(r, key)) codes.add('WIRE-VARIANT');
  }
  // variant-specific cross-field rules (Part 1 §8.3 notes column)
  if (variant === 'RQ.post.threw' && ['sp', 'sx', 'nw', 'sb', 'cl', 'dg'].some((k) => own(r, k))) codes.add('I2-RQ-THREW-READS');
  if (variant === 'PS' || variant === 'RQ.pre' || variant === 'RQ.post.returned' || (variant === 'RS.post' && r.rs !== 'THROW')) {
    if (r.sx === 'clear' && r.sp !== 0) codes.add('WIRE-VARIANT');
    if (r.sp === 1 && r.sx === 'clear') codes.add('WIRE-VARIANT');
    if (r.sp === 0 && (r.sx === 'appear' || r.sx === 'replace')) codes.add('WIRE-VARIANT');
  }
  if (variant === 'T4.decision') {
    if (r.n === 0 && !(r.d === 'timeout' && r.te === 1 && !own(r, 'ss') && !own(r, 'fr'))) codes.add('WIRE-VARIANT');
    if (own(r, 'fr') && !(r.te === 1 && Number.isInteger(r.n) && r.n >= 1)) codes.add('WIRE-VARIANT');
  }
  if (variant === 'T4.sample' && !(Number.isInteger(r.n) && r.n >= 1)) codes.add('DATA-INVALID');
  if (variant === 'C8' && r.el === 0 && r.in !== 0) codes.add('WIRE-VARIANT');
  if (variant === 'CE' && !atoms.includes('P-CC')) codes.add('CE-NOT-CONFIGURED');
  return [...codes].sort();
}

// ---------------------------------------------------------------- META / END (Part 2 appendix (i))

/** LIVE_CAPS_V2 as bound in META.cp: the caps block without its 'name'. */
export function capsV2(contract) {
  const caps = { ...contract.envelope.caps };
  delete caps.name;
  return caps;
}

function fieldCheck(spec) {
  switch (spec.type) {
    case 'const': return (v) => v === spec.value;
    case 'int': return (v) => (spec.value !== undefined ? v === spec.value : int(spec.min ?? 0, spec.max ?? Number.MAX_SAFE_INTEGER)(v));
    case 'string': return (v) => typeof v === 'string' && new RegExp(spec.pattern).test(v);
    case 'enum': return (v) => spec.values.includes(v);
    case 'hex64': return (v) => (spec.value !== undefined ? v === spec.value : hex(64)(v));
    case 'hex64OrAbsent': return (v) => v === 'ABSENT' || hex(64)(v);
    case 'flag': return oneOf(0, 1);
    case 'object': return (v) => isPlain(v) && (spec.keys ? (Object.keys(v).length === spec.keys.length && spec.keys.every((k) => own(v, k) && (spec.valueType !== 'flag' || v[k] === 0 || v[k] === 1))) : true);
    case 'atomList': return (v) => Array.isArray(v) && v.length === spec.value.length && v.every((a, i) => a === spec.value[i]);
    default: return () => false;
  }
}

const exactObj = (a, b) => {
  if (!isPlain(a) || !isPlain(b)) return false;
  const ka = Object.keys(a).sort(); const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

export const pinnedOf = (contract) => contract.part1.viewerPin;
export const viewerPinned = (contract, vv, vd) => vv === pinnedOf(contract).version && vd === pinnedOf(contract).bundleSha256;

/** The edgeInit value implied by the boundary-read fields (Part 2 §12.3). */
export const impliedEdgeInit = (m) => (m.lb === 1 && m.qe === 0 && m.ba === 'FALSE' && m.bp === 'NULL' ? 'LOW' : 'UNKNOWN');

/**
 * META (schema 2) validator. Returns sorted codes: META-INVALID plus the specific sub-codes META-VB0-INCONSISTENT,
 * SCHEMA-VERSION-UNSUPPORTED, META-CAPS-MISMATCH, EDGEINIT-INCONSISTENT, RECORDER-ORDINAL. Total.
 */
export function validateMetaV2(m, { contract }) {
  try { return validateMetaV2Inner(m, contract); } catch { return ['META-INVALID']; }
}
function validateMetaV2Inner(m, contract) {
  if (!isPlain(m)) return ['META-INVALID'];
  const codes = new Set();
  const fields = contract.envelope.meta.requiredFields;
  const keys = fields.map((f) => f.key);
  for (const f of fields) {
    if (!own(m, f.key)) { codes.add('META-INVALID'); continue; }
    if (f.key === 'cp') { if (!exactObj(m.cp, capsV2(contract))) { codes.add('META-INVALID'); codes.add('META-CAPS-MISMATCH'); } continue; }
    if (f.key === 'ec') {
      const ok = isPlain(m.ec) && Object.keys(m.ec).length === 2 && int(0, contract.envelope.caps.dataEvents)(m.ec.min)
        && int(0, contract.envelope.caps.dataEvents)(m.ec.max) && m.ec.min <= m.ec.max;
      if (!ok) codes.add('META-INVALID');
      continue;
    }
    if (f.key === 'vv') { if (!(m.vv === 'ABSENT' || (typeof m.vv === 'string' && new RegExp(f.pattern).test(m.vv)))) codes.add('META-INVALID'); continue; }
    if (f.key === 'sv') { if (m.sv !== f.value) { codes.add('META-INVALID'); codes.add('SCHEMA-VERSION-UNSUPPORTED'); } continue; }
    if (f.key === 'rc') { if (m.rc !== f.value) { codes.add('META-INVALID'); codes.add('RECORDER-ORDINAL'); } continue; }
    if (!fieldCheck(f)(m[f.key])) codes.add('META-INVALID');
  }
  for (const k of Object.keys(m)) if (!keys.includes(k)) codes.add('META-INVALID');
  // VB-0 (committed rule, Part 2 §12.1): vg = 1 and any vb row = 1 only on the exact pin; vb all 0 unless VB-0 holds
  const pinned = viewerPinned(contract, m.vv, m.vd);
  const anyVb = isPlain(m.vb) && Object.values(m.vb).some((x) => x === 1);
  if (!pinned && (m.vg === 1 || anyVb)) { codes.add('META-INVALID'); codes.add('META-VB0-INCONSISTENT'); }
  if (m.vg !== 1 && anyVb) { codes.add('META-INVALID'); codes.add('META-VB0-INCONSISTENT'); }
  if (['lb', 'qe', 'ba', 'bp', 'ei'].every((k) => own(m, k)) && m.ei !== impliedEdgeInit(m)) { codes.add('META-INVALID'); codes.add('EDGEINIT-INCONSISTENT'); }
  return [...codes].sort();
}

/** The terminal status implied by END flags (committed precedence TRUNCATED > OVERFLOW > MALFORMED > OK). */
export const expectedTerminalStatus = (e) => (e.truncated === 1 ? 'TRUNCATED' : e.overflow === 1 ? 'OVERFLOW' : e.iv > 0 ? 'MALFORMED' : 'OK');

/** END (schema 2) validator. Returns sorted codes: END-INVALID, TERMINAL-STATUS-INCONSISTENT. Total. */
export function validateEndV2(e, { contract }) {
  try { return validateEndV2Inner(e, contract); } catch { return ['END-INVALID']; }
}
function validateEndV2Inner(e, contract) {
  if (!isPlain(e)) return ['END-INVALID'];
  const codes = new Set();
  const fields = contract.envelope.end.requiredFields;
  const keys = fields.map((f) => f.key);
  for (const f of fields) {
    if (!own(e, f.key)) { codes.add('END-INVALID'); continue; }
    let ok;
    if (f.key === 'run') ok = typeof e.run === 'string' && /^[a-z0-9-]{1,32}$/.test(e.run);
    else if (f.key === 'ds') ok = f.values.includes(e.ds);
    else if (f.key === 'pc') ok = isPlain(e.pc) && Object.keys(e.pc).length === 1 && (e.pc['VB-3'] === 0 || e.pc['VB-3'] === 1);
    else if (f.type === 'int') ok = int(f.min ?? 0, f.max ?? Number.MAX_SAFE_INTEGER)(e[f.key]);
    else ok = fieldCheck(f)(e[f.key]);
    if (!ok) codes.add('END-INVALID');
  }
  for (const k of Object.keys(e)) if (!keys.includes(k)) codes.add('END-INVALID');
  const ints = Number.isInteger(e.iv) && Number.isInteger(e.rj);
  if (ints && e.iv > e.rj) codes.add('END-INVALID');
  if (ints && ((e.overflow === 0 && e.rj !== e.iv) || (e.overflow === 1 && e.rj <= e.iv))) codes.add('END-INVALID');
  if (ints && (e.truncated === 0 || e.truncated === 1) && (e.overflow === 0 || e.overflow === 1) && e.ts !== expectedTerminalStatus(e)) codes.add('TERMINAL-STATUS-INCONSISTENT');
  return [...codes].sort();
}

/** Keys only META/END may carry: every META/END wire key that is not also a data-record wire key. */
export function envelopeOnlyKeys(contract) {
  const data = new Set(Object.values(contract.part1.wireKeys));
  const env = [...contract.envelope.meta.requiredFields, ...contract.envelope.end.requiredFields].map((f) => f.key);
  return new Set(env.filter((k) => !data.has(k)));
}

/** The shared data/envelope keys the contract allows (Part 2 Appendix (i) wireKeyCollisionRule.allowedShared). */
export const allowedSharedKeys = (contract) => [...contract.envelope.wireKeyCollisionRule.allowedShared].sort();

/** Data wire keys that also appear as META/END keys (must equal allowedSharedKeys(contract): k, f, tm). */
export function wireKeyCollisions(contract) {
  const data = new Set(Object.values(contract.part1.wireKeys));
  const env = new Set([...contract.envelope.meta.requiredFields, ...contract.envelope.end.requiredFields].map((f) => f.key));
  return [...data].filter((k) => env.has(k)).sort();
}

// ---------------------------------------------------------------- sequence rules (I1–I7 and Part 2 step 3)

const VISIBLE_READ = (r) => (r.k === 'RQ' && r.pp === 'pre') || (r.k === 'RQ' && r.pp === 'post' && r.co === 'returned')
  || (r.k === 'RS' && r.pp === 'post' && r.rs !== 'THROW') || r.k === 'PS';
export const isVisibleSlotRead = VISIBLE_READ;
export const isCameraBearing = (r) => r.k === 'FS' || (r.k === 'T4' && r.tp === 'sample')
  || (r.k === 'RQ' && r.pp === 'post' && own(r, 'cl')) || (r.k === 'RS' && r.pp === 'post' && own(r, 'cl'));

/** Splits data records into windows by the TZ records. Returns {targetEnd, final} indices (or -1). */
export function windowIndices(data) {
  const te = []; const fi = [];
  data.forEach((r, i) => { if (r.k === 'TZ' && r.zp === 'targetEnd') te.push(i); if (r.k === 'TZ' && r.zp === 'final') fi.push(i); });
  return { targetEnds: te, finals: fi, targetEnd: te.length === 1 ? te[0] : -1, final: fi.length === 1 ? fi[0] : -1 };
}

/**
 * Sequence-level checks over the data records of one trace (META and END excluded; records already individually
 * schema-valid or flagged). Returns sorted codes from: I1-RQ-PAIR, I3-HOST-PS, I4-T4-DECISION, I5-C8-BINDING,
 * I6-TZ-WINDOW, I7-SLOT-DELTA, SETTLE-ROLES, CONTROL-WINDOW-KIND, FS-FRAME-GAP, CT-PLACEMENT, FRAME-BOUND,
 * SAMPLE-BOUND, RS-PAIR, FRAME-ORDER, TIME-ORDER. opts: { role, caps }. Total.
 */
export function checkSequence(data, opts) {
  try { return checkSequenceInner(data, opts); } catch { return { codes: ['DATA-INVALID'], maxSampleIndex: 0, settles: [] }; }
}
function checkSequenceInner(data, { role, caps }) {
  const C = new Set();
  const bySeq = new Map();
  for (const r of data) if (isPlain(r) && Number.isInteger(r.q)) bySeq.set(r.q, r);
  // ---- I6 windows
  const w = windowIndices(data);
  if (w.targetEnds.length !== 1 || w.finals.length !== 1 || w.final !== data.length - 1 || w.targetEnd > w.final) C.add('I6-TZ-WINDOW');
  const tEnd = w.targetEnd >= 0 ? w.targetEnd : data.length; // target window = [0, tEnd)
  const inTarget = (i) => i < tEnd;
  const controlKinds = new Set(['RQ', 'TE', 'TC', 'FS', 'PS', 'CT']);
  for (let i = tEnd + 1; i < (w.final >= 0 ? w.final : data.length); i += 1) if (!controlKinds.has(data[i].k)) C.add('CONTROL-WINDOW-KIND');
  // ---- CT placement
  const cts = data.map((r, i) => [r, i]).filter(([r]) => r.k === 'CT');
  for (const [r, i] of cts) if (inTarget(i) || i === tEnd || (w.final >= 0 && i > w.final)) C.add('CT-PLACEMENT');
  if (role === 'T') {
    if (cts.length > 1 || cts.some(([r]) => r.ci !== 'PC-3')) C.add('CT-PLACEMENT');
  } else {
    // a control trace's control window holds exactly one record: its own CT, immediately before TZ final
    const ok = cts.length === 1 && w.final >= 1 && cts[0][1] === w.final - 1 && w.targetEnd === w.final - 2 && cts[0][0].ci === role;
    if (!ok) C.add('CT-PLACEMENT');
  }
  // ---- frame / time order, FS frame contiguity (target window), frame bounds
  let lastF = -1; let lastTm = -1; let curFrame = -1; let nextFrame = 0;
  for (let i = 0; i < data.length; i += 1) {
    const r = data[i];
    if (!(Number.isInteger(r.f) && Number.isInteger(r.tm))) continue;
    if (r.f < lastF) C.add('FRAME-ORDER'); // Part 2 §12.6 step 3
    if (r.tm < lastTm) C.add('TIME-ORDER');
    lastF = Math.max(lastF, r.f); lastTm = Math.max(lastTm, r.tm);
    if (r.k === 'FS') {
      if (inTarget(i)) { if (r.f !== nextFrame) C.add('FS-FRAME-GAP'); nextFrame = r.f + 1; }
      curFrame = r.f;
    } else if (r.f !== curFrame) C.add('FRAME-ORDER'); // every non-FS record carries the frame of the latest FS
    if (inTarget(i) && r.f >= caps.targetWindowFrames) C.add('FRAME-BOUND');
  }
  if (data.length && data[0].k !== 'FS') C.add('FS-FRAME-GAP');
  const ctrlFrames = new Set();
  for (let i = tEnd + 1; i < data.length; i += 1) if (data[i].k === 'FS') ctrlFrames.add(data[i].f);
  if (ctrlFrames.size > caps.controlWindowFrames) C.add('FRAME-BOUND');
  // ---- I1 RQ pairs, token order, binding
  const pre = new Map(); const tokensIssued = []; const boundTokens = new Set();
  const postOf = new Map();
  for (let i = 0; i < data.length; i += 1) {
    const r = data[i];
    if (r.k !== 'RQ') continue;
    if (r.pp === 'pre') {
      if (pre.has(r.r) || tokensIssued.includes(r.r)) C.add('I1-RQ-PAIR');
      if (r.r !== tokensIssued.length + 1) C.add('I1-RQ-PAIR'); // reqToken = 1-based call order
      pre.set(r.r, i); tokensIssued.push(r.r);
    } else if (r.pp === 'post') {
      if (!pre.has(r.r)) { C.add('I1-RQ-PAIR'); continue; }
      const pi = pre.get(r.r); pre.delete(r.r);
      postOf.set(r.r, i);
      for (let j = pi + 1; j < i; j += 1) if (!['RQ', 'TE', 'TC'].includes(data[j].k)) C.add('I1-RQ-PAIR');
      const adjacent = i === pi + 1;
      if (r.co === 'returned') {
        if (adjacent && r.nw === 1) { if (r.sb !== r.r) C.add('I1-RQ-PAIR'); boundTokens.add(r.r); }
        if (!adjacent && r.sb === r.r) C.add('I1-RQ-PAIR'); // interleaved: the recorder refuses to bind a new object to k
        if (adjacent && (r.nw === 1) !== (r.sx === 'appear' || r.sx === 'replace')) C.add('I7-SLOT-DELTA');
      }
    }
  }
  if (pre.size) C.add('I1-RQ-PAIR');
  // RS pre/post: adjacent pairs only (Part 1 CP10/CP11: post.seq = pre.seq + 1; a post without its pre is malformed)
  for (let i = 0; i < data.length; i += 1) {
    const r = data[i];
    if (r.k !== 'RS') continue;
    if (r.pp === 'pre' && !(data[i + 1] && data[i + 1].k === 'RS' && data[i + 1].pp === 'post' && data[i + 1].q === r.q + 1)) C.add('RS-PAIR');
    if (r.pp === 'post' && !(data[i - 1] && data[i - 1].k === 'RS' && data[i - 1].pp === 'pre' && r.q === data[i - 1].q + 1)) C.add('RS-PAIR');
  }
  // every token binding on a visible read must name a token bound at its CP02 before that read
  const boundSoFar = new Set();
  for (const r of data) {
    if (r.k === 'RQ' && r.pp === 'post' && r.co === 'returned' && Number.isInteger(r.sb) && r.sb === r.r && r.nw === 1) boundSoFar.add(r.r);
    if (VISIBLE_READ(r) && Number.isInteger(r.sb) && !boundSoFar.has(r.sb)) C.add('I1-RQ-PAIR');
  }
  // ---- I7 slotDelta on every visible read (baseline: boundary read null)
  let prev = { sp: 0, sb: undefined };
  for (const r of data) {
    if (!VISIBLE_READ(r) || !(r.sp === 0 || r.sp === 1)) continue;
    let ok;
    if (prev.sp === 0 && r.sp === 0) ok = r.sx === 'none';
    else if (prev.sp === 0 && r.sp === 1) ok = r.sx === 'appear';
    else if (prev.sp === 1 && r.sp === 0) ok = r.sx === 'clear';
    else if (Number.isInteger(prev.sb) && Number.isInteger(r.sb)) ok = r.sx === (prev.sb === r.sb ? 'none' : 'replace');
    else if (Number.isInteger(prev.sb) !== Number.isInteger(r.sb)) ok = r.sx === 'replace'; // token <-> "U": different objects
    else ok = r.sx === 'none' || r.sx === 'replace'; // "U" -> "U": identity not recoverable offline
    if (!ok) C.add('I7-SLOT-DELTA');
    prev = { sp: r.sp, sb: r.sb };
  }
  // ---- I3 host -> PS
  const psByHost = new Map();
  for (const r of data) if (r.k === 'PS') { if (psByHost.has(r.hq)) C.add('I3-HOST-PS'); psByHost.set(r.hq, r); }
  for (const r of data) {
    const isHost = r.k === 'FS' || (r.k === 'T4' && r.tp === 'sample');
    if (!isHost) continue;
    const ps = psByHost.get(r.q);
    const nv = bySeq.get(r.q + 1);
    const okSeq = ps && (ps.q === r.q + 1 || (ps.q === r.q + 2 && nv && nv.k === 'NV' && r.k === 'T4'));
    const okSite = ps && ps.rd === (r.k === 'FS' ? 'frame' : 't4Sample');
    if (!okSeq || !okSite) C.add('I3-HOST-PS');
  }
  for (const r of data) if (r.k === 'PS') { const h = bySeq.get(r.hq); if (!h || !(h.k === 'FS' || (h.k === 'T4' && h.tp === 'sample'))) C.add('I3-HOST-PS'); }
  for (const r of data) if (r.k === 'NV') { const h = bySeq.get(r.q - 1); if (!h || !(h.k === 'T4' && h.tp === 'sample')) C.add('I3-HOST-PS'); }
  // ---- I4 settles and SETTLE-ROLES
  const settles = []; let cur = null; let maxN = 0; let frCount = 0;
  for (let i = 0; i < data.length; i += 1) {
    const r = data[i];
    if (r.k !== 'T4') continue;
    if (!inTarget(i)) { C.add('CONTROL-WINDOW-KIND'); continue; }
    if (r.tp === 'start') {
      if (cur && !cur.terminal) C.add('SETTLE-ROLES'); // settles strictly sequential
      if (!tokensIssued.includes(r.r) || (postOf.has(r.r) ? postOf.get(r.r) > i : true)) C.add('SETTLE-ROLES');
      cur = { role: r.s, start: r, samples: [], terminal: null, decisions: [] }; settles.push(cur);
      continue;
    }
    if (!cur || cur.terminal || r.s !== cur.role) { C.add('I4-T4-DECISION'); continue; }
    if (r.tp === 'sample') {
      if (r.n !== cur.samples.length + 1) C.add('I4-T4-DECISION');
      if (r.n > caps.settleSamples) C.add('SAMPLE-BOUND');
      maxN = Math.max(maxN, Number.isInteger(r.n) ? r.n : 0);
      cur.samples.push(r);
    } else if (r.tp === 'decision') {
      cur.decisions.push(r);
      const last = cur.samples[cur.samples.length - 1];
      if (r.d === 'timeout') {
        if (r.n !== cur.samples.length || (r.n >= 1 && r.ss !== last.q)) C.add('I4-T4-DECISION');
      } else {
        const smp = bySeq.get(r.ss);
        const ps = smp ? psByHost.get(smp.q) : null;
        if (!smp || smp !== last || r.n !== smp.n || !ps || r.q !== ps.q + 1) C.add('I4-T4-DECISION');
        if (cur.decisions.filter((d) => d.ss === r.ss && d.d !== 'timeout').length > 1) C.add('I4-T4-DECISION');
        if (r.d === 'settled' && r.n === 1) C.add('I4-T4-DECISION'); // committed C3 SETTLED_ON_FIRST_SAMPLE, all roles
      }
      if (r.d === 'settled' || r.d === 'timeout') cur.terminal = r;
      if (r.fr === 1) {
        frCount += 1;
        if (cur.role !== 'S' || !(r.n >= 1) || r.te !== 1) C.add('I4-T4-DECISION');
      }
      if (cur.role === 'S' && cur.terminal === r && r.n >= 1 && r.fr !== 1) C.add('I4-T4-DECISION');
    }
  }
  if (frCount > 1) C.add('I4-T4-DECISION');
  for (const s of settles) if (!s.terminal) C.add('I4-T4-DECISION');
  const nS = settles.filter((s) => s.role === 'S').length;
  const nG = settles.filter((s) => s.role === 'G').length;
  const nP = settles.filter((s) => s.role === 'P').length;
  if (role === 'T' && nS !== 1) C.add('SETTLE-ROLES');
  if (nS > 1 || nG > 2 || nP > 1 || settles.length > caps.maxSettles) C.add('SETTLE-ROLES');
  // ---- I5 C8 binding
  const settleOfSample = new Map();
  for (const s of settles) for (const smp of s.samples) settleOfSample.set(smp.q, s);
  const c8Roles = [];
  for (let i = 0; i < data.length; i += 1) {
    const r = data[i];
    if (r.k !== 'C8') continue;
    if (!inTarget(i)) { C.add('CONTROL-WINDOW-KIND'); continue; }
    const s = settleOfSample.get(r.ss);
    const smp = bySeq.get(r.ss);
    const ok = s && smp && s.terminal && s.terminal.d === 'settled' && s.terminal.ss === r.ss && smp.dg === r.dg
      && ((r.mr === 'subject' && s.role === 'S' && s.terminal.fr === 1) || (r.mr === 'superseded' && s.role === 'P'))
      && r.q > s.terminal.q;
    if (!ok) C.add('I5-C8-BINDING');
    c8Roles.push(r.mr);
  }
  if (c8Roles.filter((x) => x === 'subject').length > 1 || c8Roles.filter((x) => x === 'superseded').length > 1) C.add('I5-C8-BINDING');
  return { codes: [...C].sort(), maxSampleIndex: maxN, settles };
}
