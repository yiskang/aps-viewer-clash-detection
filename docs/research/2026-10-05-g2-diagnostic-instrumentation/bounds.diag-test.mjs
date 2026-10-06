// Schema validation and EVERY spec §6.4 bound at exactly the cap and at cap + 1. [SYN] research tests only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPinned, PINNED_VIEWER_VERSION, PINNED_VIEWER_BUNDLE_SHA256 } from './pins.mjs';
import { validateEvent, validateMeta, validateEnd, FIELDS, KIND_CLASS, MAX_SEQ } from './schema.mjs';
import {
  OFFLINE_CAPS, LIVE_CAPS, OfflineTraceBuffer, assertCap, selectRetained, selectLiveExcerpts, checkOutputCaps,
  assertNoNumericPose, encodeNv, LiveTraceRecorder,
} from './bounds.mjs';

const { mods } = await loadPinned();
const { canonicalBytes } = mods.canonical;
const len = (v) => canonicalBytes(v).length;
const exit2 = (fn) => assert.throws(fn, (e) => e.exitCode === 2);

/** An event padded (via a free-form key, cap tests only) to exactly `n` canonical bytes. */
function padded(n, base = { f: 0, k: 'TCK' }) {
  const e = { ...base, z: '' };
  e.z = 'x'.repeat(n - len(e));
  assert.equal(len(e), n);
  return e;
}

test('schema: field/class tags; request identity is HAR only; SYN never live', () => {
  assert.equal(FIELDS.r.cls, 'HAR');
  assert.equal(FIELDS.ow.cls, 'SYN'); assert.equal(FIELDS.tg.cls, 'SYN');
  assert.ok(KIND_CLASS.AE.includes('VB7124')); assert.ok(KIND_CLASS.XTC.includes('SYN'));
  for (const f of Object.values(FIELDS)) assert.ok(typeof f.cls === 'string' && f.cls.length > 0);
  const smp = { f: 3, k: 'SMP', s: 'S', n: 2, d: 'settled', fr: 1, cl: 0, xc: 0, pd: { p: 1, b: 2 }, ac: 0, ow: 'T1*' };
  assert.deepEqual(validateEvent(smp), []);
  assert.ok(validateEvent(smp, { mode: 'live' }).some((x) => x.includes('SYN field ow')));
  assert.ok(validateEvent({ f: 1, k: 'XTC', tg: 1 }, { mode: 'live' }).some((x) => x.includes('SYN kind')));
  assert.ok(validateEvent({ f: 1, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 0, tm: 4 }).some((x) => x.includes('live-only')));
  assert.ok(validateEvent({ f: 1, k: 'TCK', r: 1 }).some((x) => x.includes('not allowed')));
  assert.ok(validateEvent({ f: 1, k: 'SMP', s: 'S', n: 1, d: 'none', fr: 1, cl: 0 }).some((x) => x.includes('fr on a non-deciding')));
  assert.ok(validateEvent({ f: 1, k: 'FIT', pq: { p: 1, b: 1, nw: 1 } }).length > 0);
  assert.ok(validateEvent({ f: 1, k: 'CAM', cl: 0, pd: { p: 1, b: 1, ch: 1 } }).length > 0, 'b and ch never together');
  assert.ok(validateEvent({ f: 1, k: 'CAM', cl: null }).length > 0, 'absent fields are omitted, never null');
});

test('schema: per-event byte cap 160 accepted at exactly the cap, rejected at cap+1', () => {
  const ok = { f: 1, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 0 };
  assert.deepEqual(validateEvent(ok, { canonicalBytes, byteCap: len(ok) }), []);
  assert.ok(validateEvent(ok, { canonicalBytes, byteCap: len(ok) - 1 }).some((x) => x.includes('> cap')));
  const b = new OfflineTraceBuffer(canonicalBytes);
  assert.equal(b.append(padded(160)), true);
  assert.equal(b.append(padded(161)), false); assert.equal(b.overflow, 'bytesPerEvent');
  exit2(() => b.assertNoOverflow('t'));
  assert.equal(OFFLINE_CAPS.bytesPerEvent, 160);
});

test('offline events per trace: 1,024 accepted, 1,025th rejected => OVERFLOW:events => exit 2', () => {
  const b = new OfflineTraceBuffer(canonicalBytes);
  for (let i = 0; i < 1024; i += 1) assert.equal(b.append({ f: i, k: 'TCK' }), true);
  b.assertNoOverflow('exact');
  assert.equal(b.append({ f: 1024, k: 'TCK' }), false);
  assert.equal(b.overflow, 'events'); assert.equal(b.events.length, 1024, 'never partially written');
  exit2(() => b.assertNoOverflow('cap+1'));
});

test('offline bytes per trace: 163,840 accepted exactly, 163,841 rejected', () => {
  const fill = (lastBytes) => {
    const b = new OfflineTraceBuffer(canonicalBytes);
    for (let i = 0; i < 1017; i += 1) assert.equal(b.append(padded(160)), true);
    const ok = b.append(padded(lastBytes));
    return { b, ok };
  };
  const a = fill(101); assert.equal(a.ok, true); assert.equal(a.b.bytes, 163840); a.b.assertNoOverflow('exact');
  assert.equal(len(a.b.events), 163840);
  const c = fill(102); assert.equal(c.ok, false); assert.equal(c.b.overflow, 'bytesPerTrace'); exit2(() => c.b.assertNoOverflow('cap+1'));
});

test('offline retained numeric samples: 0 accepted, any numeric pose => exit 2', () => {
  assertNoNumericPose({ a: [1, 2, 3], b: { c: 7 } });
  exit2(() => assertNoNumericPose({ pose: Array.from({ length: 32 }, (_, i) => i) }));
  exit2(() => assertNoNumericPose({ x: 0.5 }));
});

test('retained witness traces: 16 retained, 17th counted in tracesOmitted (unique traceRefs)', () => {
  const refs = Array.from({ length: 16 }, (_, i) => `S-${i}@T-PUB/OFF`);
  assert.deepEqual(selectRetained(refs), { retained: refs, omitted: 0 });
  const r17 = selectRetained([...refs, refs[0], 'S-99@T-VB/ON']);
  assert.equal(r17.retained.length, 16); assert.equal(r17.omitted, 1);
});

test('witness index 468 / minimal sets 126: exact cap accepted, cap+1 => exit 2', () => {
  assertCap('witnessIndexEntries', 468, OFFLINE_CAPS.witnessIndexEntries);
  exit2(() => assertCap('witnessIndexEntries', 469, OFFLINE_CAPS.witnessIndexEntries));
  assertCap('minimalSetsPerKey', 126, OFFLINE_CAPS.minimalSetsPerKey);
  exit2(() => assertCap('minimalSetsPerKey', 127, OFFLINE_CAPS.minimalSetsPerKey));
  assert.equal(OFFLINE_CAPS.witnessIndexEntries, 4 * 9 * 13);
});

test('output files: summary 1,048,576 / witnesses 3,145,728 / total 4,194,304 exact accepted, +1 => exit 2', () => {
  const N = { summary: 's', witnesses: 'w' };
  const f = (s, w) => ({ s: Buffer.alloc(s), w: Buffer.alloc(w) });
  checkOutputCaps(f(1048576, 3145728), N);
  exit2(() => checkOutputCaps(f(1048577, 0), N));
  exit2(() => checkOutputCaps(f(0, 3145729), N));
  const tight = { ...OFFLINE_CAPS, summaryBytes: 3000000, witnessesBytes: 3000000 };
  checkOutputCaps(f(1194304, 3000000), N, tight); // total exactly 4,194,304
  exit2(() => checkOutputCaps(f(1194305, 3000000), N, tight));
});

// ---- live design bounds (§6.4(b)); reference recorder, tests only
// Whole-trace integrity fields (sv, vd, ec, q0, cs; cp = the enforced caps) added deliberately (spec §6.1.3).
const metaFor = (caps) => ({
  at: ['P-FRM'], br: 'chromium-130', cp: { ...caps }, cs: 0, ec: { max: caps.dataEvents, min: 0 }, f: 0, hh: 'a'.repeat(64), id: 'ON', k: 'META',
  ph: 'b'.repeat(64), q0: 1, run: 'r1', sh: 'c'.repeat(64), sv: 1, tm: 0, vb: { 'VB-1': 1, 'VB-2': 1, 'VB-3': 1 }, vd: PINNED_VIEWER_BUNDLE_SHA256, vg: 1, vv: PINNED_VIEWER_VERSION,
});
const META = metaFor(LIVE_CAPS);
/** Byte-cap tests pad events with a free-form key, so they use a permissive validator (test-only). */
const PAD = { validator: () => [] };
/** A data event that is exactly `n` canonical bytes AFTER the recorder stamps its sequence `q`. */
function padLive(r, n, base) {
  const e = padded(n, { ...base, q: r.nextQ });
  delete e.q;
  return e;
}

test('live META 1,536 accepted / 1,537 => run does not start; END bound by reserve', () => {
  // Every META field is now bounded and cp must equal the enforced caps, so a VALID META cannot be padded: its worst
  // case stays below the cap. The cap boundary itself is exercised with a permissive META validator (test-only).
  const worst = { ...META, run: 'r'.repeat(32), vv: 'v'.repeat(16), vd: 'f'.repeat(64), vg: 0, vb: { 'VB-1': 0, 'VB-2': 0, 'VB-3': 0 }, br: 'b'.repeat(24), at: ['P-FRM', 'P-XS', 'P-TICK', 'P-CC', 'P-CC0', 'P-TC', 'V-PEND', 'V-ACT', 'V-EDGE'], id: 'OFF', cs: 1 };
  assert.deepEqual(validateMeta(worst, { caps: LIVE_CAPS }), []);
  assert.ok(len(worst) <= LIVE_CAPS.metaBytes, `worst-case valid META ${len(worst)} B`);
  const PERMISSIVE_META = { metaValidator: () => [] };
  const m = { ...META, z: '' }; m.z = 'x'.repeat(1536 - len(m));
  assert.equal(len(m), 1536);
  assert.ok(new LiveTraceRecorder(m, canonicalBytes, LIVE_CAPS, PERMISSIVE_META));
  m.z += 'x';
  assert.equal(len(m), 1537);
  assert.throws(() => new LiveTraceRecorder(m, canonicalBytes, LIVE_CAPS, PERMISSIVE_META), (e) => e.exitCode === 2 && e.code === 'META-TOO-LARGE');
  assert.throws(() => new LiveTraceRecorder({ ...META, cp: { ...LIVE_CAPS, endBytes: 1 } }, canonicalBytes), (e) => e.code === 'META-INVALID', 'cp must be the enforced caps');
  const { end } = new LiveTraceRecorder(META, canonicalBytes).close();
  assert.ok(len(end) <= LIVE_CAPS.endBytes);
  const M = Number.MAX_SAFE_INTEGER;
  const worstEnd = { ...end, f: M, iv: M - 1, lq: MAX_SEQ, nb: M, ne: M, nvn: M, nvx: M, overflow: 1, rj: M, run: 'r'.repeat(32), tm: M, truncated: 1, ts: 'TRUNCATED' };
  assert.deepEqual(validateEnd(worstEnd), []);
  assert.ok(len(worstEnd) <= LIVE_CAPS.endBytes, `worst-case END ${len(worstEnd)} B`);
  assert.ok(3 + LIVE_CAPS.metaBytes + LIVE_CAPS.endBytes <= LIVE_CAPS.reserveBytes, 'META + END + brackets + comma fit the reserve');
  const L = len(end);
  const atL = { ...LIVE_CAPS, endBytes: L };
  assert.ok(new LiveTraceRecorder(metaFor(atL), canonicalBytes, atL).close(), 'END at exactly the cap');
  const below = { ...LIVE_CAPS, endBytes: L - 1 };
  assert.throws(() => new LiveTraceRecorder(metaFor(below), canonicalBytes, below).close(), (e) => e.code === 'END-TOO-LARGE', 'END at cap+1');
});

test('live data events: 8,192 accepted, 8,193rd rejected with END.overflow=1', () => {
  const r = new LiveTraceRecorder(META, canonicalBytes);
  for (let i = 0; i < 8192; i += 1) assert.equal(r.append({ f: i, k: 'TCK', tm: i }), true);
  assert.equal(r.append({ f: 8192, k: 'TCK', tm: 8192 }), false);
  const { end } = r.close();
  assert.equal(end.ne, 8192); assert.equal(end.overflow, 1); assert.equal(end.rj, 1);
});

test('live bytes per event 256 / NV 406: exact accepted, +1 rejected (sizes include the stamped q)', () => {
  assert.equal(LIVE_CAPS.bytesPerNv, 406);
  const r = new LiveTraceRecorder(META, canonicalBytes, LIVE_CAPS, PAD);
  assert.equal(r.append(padLive(r, 256, { f: 1, k: 'TCK' })), true);
  assert.equal(len(r.data[0]), 256);
  assert.equal(r.append(padLive(r, 257, { f: 2, k: 'TCK' })), false);
  assert.equal(r.close().end.overflow, 1);
  const r2 = new LiveTraceRecorder(META, canonicalBytes, LIVE_CAPS, PAD);
  assert.equal(r2.append(padLive(r2, 406, { f: 1, k: 'NV' })), true);
  assert.equal(len(r2.data[0]), 406);
  assert.equal(r2.append(padLive(r2, 407, { f: 2, k: 'NV' })), false);
});

test('live total trace bytes 2,457,600 with the 2,048 B reserve: END always fits; +1 rejected', () => {
  const r = new LiveTraceRecorder(META, canonicalBytes, LIVE_CAPS, PAD);
  const budget = LIVE_CAPS.totalTraceBytes - LIVE_CAPS.reserveBytes; // data bytes incl. one comma each
  const nNv = Math.floor(budget / 407); // 406 B NV records (+1 comma each) stay under the 8,192-event cap
  assert.ok(nNv < LIVE_CAPS.dataEvents);
  for (let f = 0; f < nNv; f += 1) assert.equal(r.append(padLive(r, 406, { f, k: 'NV' })), true);
  const rest = budget - nNv * 407; // fill exactly to the data limit with one ordinary event
  assert.ok(rest - 1 <= 256 && rest - 1 >= 40, `remainder ${rest}`);
  const f = nNv;
  assert.equal(r.append(padLive(r, rest - 1, { f, k: 'TCK' })), true);
  assert.equal(r.dataBytes, budget);
  assert.equal(r.append({ f: f + 1, k: 'TCK' }), false, 'cap+1 rejected');
  const { bytes, end } = r.close();
  assert.ok(bytes.length <= LIVE_CAPS.totalTraceBytes, `trace ${bytes.length} within total cap`);
  assert.equal(end.overflow, 1);
});

test('live NV: fixed-width encoding <= 406 B (incl. q <= 8,192) for arbitrary finite doubles; 512 retained, 513th digest-only (C7)', () => {
  const worst = [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -0, 1e-308, 5e-324, 0.1, -1 / 3];
  const vals = Array.from({ length: 32 }, (_, i) => worst[i % worst.length]);
  const nv = encodeNv(vals);
  assert.equal(nv.length, 344);
  assert.equal(MAX_SEQ, LIVE_CAPS.dataEvents, 'q is bounded by the data-event cap');
  assert.equal(len({ f: 99999999, k: 'NV', nv, q: MAX_SEQ, tm: Number.MAX_SAFE_INTEGER }), LIVE_CAPS.bytesPerNv, 'worst case equals the cap');
  assert.deepEqual(validateEvent({ f: 99999999, k: 'NV', nv, q: MAX_SEQ, tm: 1 }, { mode: 'live' }), []);
  assert.ok(validateEvent({ f: 1, k: 'NV', nv, q: MAX_SEQ + 1, tm: 1 }, { mode: 'live' }).length > 0, 'q above the cap');
  assert.ok(validateEvent({ f: 1, k: 'NV', nv, q: 1, rn: 'r1', tm: 1 }, { mode: 'live' }).some((x) => x.includes('field rn not allowed')), 'no rn on NV');
  assert.equal(encodeNv([...vals.slice(0, 31), NaN]), null);
  const r = new LiveTraceRecorder(META, canonicalBytes);
  for (let i = 0; i < 513; i += 1) r.appendSample({ f: i, k: 'SMP', n: 1, s: 'S', d: 'none', cl: 0, tm: i }, vals);
  const { end } = r.close();
  assert.equal(end.nvn, 512); assert.equal(end.nvx, 1); assert.equal(end.overflow, 0);
});

test('live witness excerpts 32 retained / 33rd counted; settle samples n=64 valid, 65 invalid', () => {
  const refs = Array.from({ length: 33 }, (_, i) => `x${i}`);
  assert.equal(selectLiveExcerpts(refs.slice(0, 32)).omitted, 0);
  assert.equal(selectLiveExcerpts(refs).omitted, 1);
  assert.deepEqual(validateEvent({ f: 1, k: 'SMP', s: 'S', n: 64, d: 'timeout', cl: 0 }), []);
  assert.ok(validateEvent({ f: 1, k: 'SMP', s: 'S', n: 65, d: 'timeout', cl: 0 }).length > 0);
});

test('schema validator is total (M-5): required fields per kind, slot invariants, own-property lookups, never throws', () => {
  const rejects = (ev, mode = 'offline') => { let e; assert.doesNotThrow(() => { e = validateEvent(ev, { mode }); }); assert.ok(e.length > 0, JSON.stringify(ev)); };
  for (const mode of ['offline', 'live']) {
    rejects({ f: 0, k: 'SMP', ...(mode === 'live' ? { tm: 0 } : {}) }, mode); // bare SMP
    rejects({ f: 0, k: 'AE', ...(mode === 'live' ? { tm: 0 } : {}) }, mode); // bare AE
    rejects({ f: 0, k: 'toString' }, mode); rejects({ f: 0, k: 'constructor' }, mode); rejects({ f: 0, k: '__proto__' }, mode);
    rejects({ f: 0, k: 'TCK', toString: 1, ...(mode === 'live' ? { tm: 0 } : {}) }, mode);
  }
  rejects({ f: 0, k: 'CAM', cl: 0, pd: { p: 0, b: 1 } }); // empty slot with a binding
  rejects({ f: 0, k: 'CAM', cl: 0, pd: { p: 1 } }); // occupied slot without b or ch
  rejects({ f: 0, k: 'CAM', cl: 0, pd: { p: 1, b: 1, nw: 1 } }); // nw only on FIT
  rejects({ f: 0, k: 'FIT', pq: { p: 0 }, pd: { p: 1, b: 1 } }); // FIT pd without nw
  rejects({ f: 0, k: 'FIT', pq: { p: 0 } }); // pq without pd
  rejects({ f: 0, k: 'CAM', xc: 0 }); // xc without cl (and CAM without cl)
  rejects({ f: 0, k: 'RST', rs: 'THROW', cl: 0 }); // a throwing restore has no post-call read
  rejects({ f: 0, k: 'TCK' }, 'live'); // live events carry tm
  rejects({ f: 0, k: 'CAM', cl: 0, pd: Object.assign(Object.create({ evil: 1 }), { p: 0 }) });
  rejects(Object.create(null)); rejects([]); rejects(null); rejects('SMP'); rejects({ f: 0, k: 'TCK' }, 'neither');
  assert.deepEqual(validateEvent({ f: 0, k: 'CAM', cl: 0, pd: { p: 0, ch: 1 } }), [], 'ID-OFF: the slot became empty');
  assert.deepEqual(validateEvent({ f: 0, k: 'FIT', pq: { p: 0 }, pd: { p: 1, b: 1, nw: 1 } }), []);
  assert.deepEqual(validateEvent({ f: 0, k: 'AE', ev: 1, q: 1, tm: 3 }, { mode: 'live' }), []); // q added (whole-trace integrity)
  rejects({ f: 0, k: 'AE', ev: 1, tm: 3 }, 'live'); // live events carry q
  rejects({ f: 0, k: 'AE', ev: 1, q: 1 }); // q is live-only
});

test('live META/END validators and recorder validation before mutation (M-5, M-6, R-M4)', () => {
  assert.deepEqual(validateMeta(META), []);
  const withPc = { ...META, pc: { 'VB-3': 1 } };
  assert.ok(validateMeta(withPc).some((x) => x.includes('unknown field pc')), 'R-M4: the behavioural control is not in META (it runs after capture)');
  assert.ok(validateMeta({ ...META, vb: { 'VB-1': 1 } }).length > 0, 'partial vb');
  assert.ok(validateMeta({ ...META, vg: 0 }).length > 0, 'vb rows present although VB-0 failed');
  assert.ok(validateMeta({ ...META, extra: 1 }).length > 0);
  assert.ok(validateMeta(null).length > 0);
  assert.throws(() => new LiveTraceRecorder(withPc, canonicalBytes), (e) => e.exitCode === 2 && e.code === 'META-INVALID');
  const r = new LiveTraceRecorder(META, canonicalBytes);
  assert.equal(r.append({ f: 1, k: 'SMP', tm: 1 }), false, 'bare SMP rejected');
  assert.equal(r.append({ f: 1, k: 'toString', tm: 1 }), false);
  assert.equal(r.append({ f: 1, k: 'CAM', cl: 0, pd: { p: 0, b: 1 }, tm: 1 }), false);
  assert.equal(r.append({ f: 1, k: 'XTC', tg: 1, tm: 1 }), false, 'SYN kind never live');
  assert.equal(r.data.length, 0); assert.equal(r.dataBytes, 0); assert.equal(r.lastF, 0, 'no state mutated');
  assert.equal(r.append({ f: 2, k: 'TCK', tm: 2 }), true);
  const { end } = r.close();
  assert.equal(end.iv, 4); assert.equal(end.rj, 4); assert.equal(end.ne, 1); assert.equal(end.overflow, 0);
  assert.deepEqual(validateEnd(end), []);
  assert.ok(validateEnd({ ...end, iv: 9 }).length > 0, 'iv <= rj');
  assert.ok(validateEnd({ ...end, toString: 1 }).length > 0);
  assert.deepEqual(end.pc, { 'VB-3': 0 }, 'no post-capture control recorded => fail closed');
  const { pc, ...noPc } = end;
  assert.ok(validateEnd(noPc).some((x) => x.includes('pc')), 'END must carry the post-capture positive-control result');
  const r2 = new LiveTraceRecorder(META, canonicalBytes);
  assert.deepEqual(r2.close({ pc: { 'VB-3': 1 } }).end.pc, { 'VB-3': 1 });
  assert.throws(() => new LiveTraceRecorder(META, canonicalBytes).close({ pc: { 'VB-3': true } }), (e) => e.code === 'END-INVALID');
});
