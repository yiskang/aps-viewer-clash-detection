// Whole-trace META/data/END integrity (spec §6.1.3) and the live entry point (spec §6.3). [SYN] research tests only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadPinned, PINNED_VIEWER_VERSION, PINNED_VIEWER_BUNDLE_SHA256 } from './pins.mjs';
import { LIVE_CAPS, LiveTraceRecorder, encodeNv } from './bounds.mjs';
import { correlate } from './correlate.mjs';
import { validateTrace, correlateTrace, TRACE_ERRORS } from './trace-integrity.mjs';
import { NAMED_CONFIGS } from './project.mjs';

const { mods } = await loadPinned();
const { canonicalBytes } = mods.canonical;
const len = (v) => canonicalBytes(v).length;
const AT = NAMED_CONFIGS.find((c) => c.id === 'T-VB/ON').atoms;
const metaFor = (caps = LIVE_CAPS, over = {}) => ({
  at: AT, br: 'chromium-130', cp: { ...caps }, cs: 0, ec: { max: caps.dataEvents, min: 0 }, f: 0, hh: 'a'.repeat(64), id: 'ON', k: 'META',
  ph: 'b'.repeat(64), q0: 1, run: 'r1', sh: 'c'.repeat(64), sv: 1, tm: 0, vb: { 'VB-1': 1, 'VB-2': 1, 'VB-3': 1 }, vd: PINNED_VIEWER_BUNDLE_SHA256, vg: 1,
  vv: PINNED_VIEWER_VERSION, ...over,
});
const P = (p, b) => (p ? { p: 1, b } : { p: 0 });
/** ownedTrace (correlate.diag-test.mjs) in the live encoding; the recorder stamps q. */
const EVENTS = [
  { f: 0, k: 'FIT', r: 1, pq: P(0), pd: { ...P(1, 1), nw: 1 }, ac: 0, cl: 0, xc: 0 },
  { f: 0, k: 'SST', s: 'S', r: 1 },
  { f: 0, k: 'CAM', cl: 0, xc: 0, pd: P(1, 1), ac: 0 },
  { f: 0, k: 'SMP', s: 'S', n: 1, d: 'none', cl: 0, xc: 0, pd: P(1, 1), ac: 0 },
  { f: 0, k: 'AE', ev: 1 }, { f: 0, k: 'TCK' },
  { f: 1, k: 'CAM', cl: 1, xc: 1, pd: P(0), ac: 1 },
  { f: 1, k: 'SMP', s: 'S', n: 2, d: 'none', cl: 1, xc: 1, pd: P(0), ac: 1 },
  { f: 1, k: 'AE', ev: 0 }, { f: 1, k: 'TC' }, { f: 1, k: 'TCK' },
  { f: 2, k: 'CAM', cl: 2, xc: 2, pd: P(0), ac: 0 },
  { f: 2, k: 'SMP', s: 'S', n: 3, d: 'none', cl: 2, xc: 2, pd: P(0), ac: 0 },
  { f: 3, k: 'CAM', cl: 2, xc: 2, pd: P(0), ac: 0 },
  { f: 3, k: 'SMP', s: 'S', n: 4, d: 'settled', fr: 1, cl: 2, xc: 2, pd: P(0), ac: 0 },
].map((e, i) => ({ ...e, tm: i }));

/** A recorder-produced trace [META, ...data, END]. */
function good({ meta = metaFor(), caps = LIVE_CAPS, events = EVENTS, pc = { 'VB-3': 1 }, truncated, nv = false } = {}) {
  const r = new LiveTraceRecorder(meta, canonicalBytes, caps);
  for (const e of events) {
    if (nv && e.k === 'SMP') r.appendSample(e, Array.from({ length: 32 }, (_, i) => i + e.n));
    else r.append(e);
  }
  return r.close({ pc, truncated }).records;
}
const clone = (recs) => structuredClone(recs);
/** Recomputes END's stream accounting so a mutation is detected by its own invariant, not only by the digest. */
function reseal(recs) {
  const meta = recs[0]; const end = recs[recs.length - 1]; const data = recs.slice(1, -1);
  end.ne = data.length; end.nb = data.reduce((s, d) => s + len(d) + 1, 0);
  end.lq = data.length ? data[data.length - 1].q : 0; end.nvn = data.filter((d) => d.k === 'NV').length;
  end.sd = createHash('sha256').update(canonicalBytes([meta, ...data])).digest('hex');
  return recs;
}
const V = (recs, opts = {}) => validateTrace(recs, { canonicalBytes, ...opts });
const rejects = (recs, code, opts) => {
  const v = V(recs, opts);
  assert.equal(v.ok, false, code); assert.equal(v.status, 'UNDIAGNOSABLE');
  assert.ok(v.errors.includes(code), `${code} not in ${JSON.stringify(v.errors)}`);
  for (const e of v.errors) assert.ok(TRACE_ERRORS.includes(e), `unregistered code ${e}`);
  return v;
};
const only = (recs, code, opts) => assert.deepEqual(rejects(recs, code, opts).errors, [code]);

test('integrity: a recorder-produced stream is valid; the live entry point equals correlate() on its data', () => {
  const t = good({ nv: true });
  const v = V(t);
  assert.deepEqual(v, { ok: true, status: 'VALID', reason: null, errors: [], vbEligible: true });
  assert.ok(t.slice(1, -1).every((d, i) => d.q === i + 1), 'recorder-stamped sequence from q0 = 1');
  assert.equal(t[t.length - 1].ts, 'OK');
  const out = correlateTrace(t, { canonicalBytes });
  const direct = correlate(t.slice(1, -1), { atoms: AT, idAxis: 'ON', vbUnavailable: [], mode: 'live' });
  assert.deepEqual(out.questions, direct.questions);
  assert.deepEqual(V(good({ events: [] })).ok, true, 'an empty capture with a valid envelope');
  // rn equal to META.run is accepted; the recorder rejects a caller-supplied q or a foreign rn before mutation
  assert.equal(V(good({ events: EVENTS.map((e) => ({ ...e, rn: 'r1' })) })).ok, true);
  const r = new LiveTraceRecorder(metaFor(), canonicalBytes);
  assert.equal(r.append({ f: 0, k: 'TCK', tm: 0, q: 1 }), false);
  assert.equal(r.append({ f: 0, k: 'TCK', tm: 0, rn: 'other' }), false);
  assert.equal(r.append(Object.assign(Object.create(null), { f: 0, k: 'TCK', tm: 0 })), false);
  assert.equal(r.data.length, 0); assert.equal(r.nextQ, 1); assert.equal(r.iv, 3);
});

test('integrity: envelope structure (META missing/duplicate, data before META, END missing/duplicate, data after END)', () => {
  const t = good();
  const noMeta = rejects(t.slice(1), 'META-MISSING'); assert.ok(noMeta.errors.includes('DATA-BEFORE-META'));
  const dup = clone(t); dup.splice(1, 0, clone(t)[0]); rejects(dup, 'META-DUPLICATE');
  const before = clone(t); before.unshift(before.splice(1, 1)[0]); rejects(before, 'DATA-BEFORE-META');
  const noEnd = rejects(t.slice(0, -1), 'END-MISSING'); assert.equal(noEnd.reason, 'TRUNCATED');
  const dupEnd = clone(t); dupEnd.push(clone(t)[t.length - 1]); rejects(dupEnd, 'END-DUPLICATE');
  const after = clone(t); after.push({ f: 9, k: 'TCK', q: 16, tm: 99 }); rejects(after, 'DATA-AFTER-END');
});

test('integrity: run id binding (END.run, data rn) and sequence gap / rollback / duplicate / start', () => {
  const t = good();
  const er = clone(t); er[er.length - 1].run = 'other'; only(er, 'RUN-ID-MISMATCH');
  const dr = clone(t); dr[3].rn = 'other'; only(reseal(dr), 'RUN-ID-MISMATCH');
  const gap = clone(t); for (let i = 4; i < gap.length - 1; i += 1) gap[i].q += 1; only(reseal(gap), 'SEQ-GAP');
  const back = clone(t); back[4].q = 2; assert.ok(rejects(reseal(back), 'SEQ-ROLLBACK').errors.every((e) => ['SEQ-ROLLBACK', 'SEQ-GAP'].includes(e)));
  const dup = clone(t); dup[4].q = dup[3].q; assert.ok(rejects(reseal(dup), 'SEQ-DUPLICATE').errors.every((e) => ['SEQ-DUPLICATE', 'SEQ-GAP'].includes(e)));
  const fwdDup = clone(t); [fwdDup[3].q, fwdDup[4].q] = [4, 3]; rejects(reseal(fwdDup), 'SEQ-ROLLBACK');
  const start = clone(t); for (let i = 1; i < start.length - 1; i += 1) start[i].q += 1; only(reseal(start), 'SEQ-START');
  const noQ = clone(t); delete noQ[2].q; rejects(reseal(noQ), 'DATA-INVALID');
});

test('integrity: END accounting (ne, META.ec bounds, nb, lq, f/tm, nvn) and the stream digest', () => {
  const t = good({ nv: true });
  const end = (m) => { const c = clone(t); m(c[c.length - 1], c); return c; };
  only(end((e) => { e.ne += 1; }), 'COUNT-MISMATCH');
  const n = t.length - 2;
  const lo = clone(t); lo[0].ec = { max: n - 1, min: 0 }; only(reseal(lo), 'COUNT-OUT-OF-BOUNDS');
  const hi = clone(t); hi[0].ec = { max: n + 5, min: n + 1 }; only(reseal(hi), 'COUNT-OUT-OF-BOUNDS');
  const exact = clone(t); exact[0].ec = { max: n, min: n }; assert.equal(V(reseal(exact)).ok, true, 'count at exactly the declared bounds');
  only(end((e) => { e.nb += 1; }), 'BYTES-MISMATCH');
  only(end((e) => { e.lq -= 1; }), 'LAST-SEQ-MISMATCH');
  only(end((e) => { e.f -= 1; }), 'END-BEFORE-LAST-EVENT');
  only(end((e) => { e.tm -= 1; }), 'END-BEFORE-LAST-EVENT');
  only(end((e) => { e.nvn += 1; }), 'NV-COUNT-MISMATCH');
  only(end((e) => { e.sd = '0'.repeat(64); }), 'STREAM-DIGEST-MISMATCH');
  const edited = clone(t); edited[3].cl = 7; only(edited, 'STREAM-DIGEST-MISMATCH'); // same length: only the commitment catches it
  const dropped = clone(t); dropped.splice(5, 1); assert.ok(rejects(dropped, 'COUNT-MISMATCH').errors.includes('SEQ-GAP'));
});

test('integrity: META.cp must be exactly the enforced cap set; per-event and total caps are re-checked', () => {
  const t = good();
  const missing = clone(t); delete missing[0].cp.endBytes; assert.ok(rejects(reseal(missing), 'META-CAPS-MISMATCH').errors.includes('META-INVALID'));
  const extra = clone(t); extra[0].cp.x = 1; rejects(reseal(extra), 'META-CAPS-MISMATCH');
  const value = clone(t); value[0].cp.bytesPerEvent = 9999; rejects(reseal(value), 'META-CAPS-MISMATCH');
  rejects(t, 'META-CAPS-MISMATCH', { caps: { ...LIVE_CAPS, dataEvents: 100 } });
  const tiny = { ...LIVE_CAPS, bytesPerEvent: 40 };
  const small = clone(t); small[0].cp = { ...tiny }; rejects(reseal(small), 'EVENT-TOO-LARGE', { caps: tiny });
  const tot = { ...LIVE_CAPS, totalTraceBytes: 1000 };
  const total = clone(t); total[0].cp = { ...tot }; rejects(reseal(total), 'TRACE-TOO-LARGE', { caps: tot });
  const bigMeta = clone(t); bigMeta[0].cp = { ...LIVE_CAPS, metaBytes: 100 }; rejects(reseal(bigMeta), 'META-TOO-LARGE', { caps: { ...LIVE_CAPS, metaBytes: 100 } });
});

test('integrity: no mid-stream version/capability/schema mutation; mixed Viewer or schema versions are rejected', () => {
  const t = good();
  for (const [key, val] of [['vv', '7.125.0'], ['vd', 'f'.repeat(64)], ['vg', 1], ['sv', 2], ['vb', { 'VB-1': 1 }], ['at', ['V-EDGE']], ['cp', {}], ['id', 'OFF'], ['ts', 'OK']]) {
    const c = clone(t); c[4][key] = val;
    const v = rejects(reseal(c), 'META-FIELD-IN-DATA'); assert.ok(v.errors.includes('DATA-INVALID'), key);
  }
  const mixed = clone(t); mixed[4].vv = '7.125.0'; rejects(reseal(mixed), 'VERSION-MIXED');
  const second = clone(t); second.splice(5, 0, { ...clone(t)[0], vv: '7.125.0', vg: 0, vb: { 'VB-1': 0, 'VB-2': 0, 'VB-3': 0 } });
  const s = rejects(second, 'META-DUPLICATE'); assert.ok(s.errors.includes('VERSION-MIXED'));
  const sv2 = clone(t); sv2[0].sv = 2; assert.ok(rejects(reseal(sv2), 'SCHEMA-VERSION-UNSUPPORTED').errors.includes('META-INVALID'));
  const endV = clone(t); endV[endV.length - 1].sv = 2; assert.ok(rejects(endV, 'VERSION-MIXED').errors.includes('END-INVALID'));
});

test('integrity: partial traces are never valid — truncation, overflow and malformed appends need an explicit terminal status', () => {
  const tr = good({ truncated: 1 });
  assert.equal(tr[tr.length - 1].ts, 'TRUNCATED');
  assert.equal(rejects(tr, 'TRUNCATED').reason, 'TRUNCATED');
  const lie = clone(tr); lie[lie.length - 1].ts = 'OK'; rejects(lie, 'TERMINAL-STATUS-INCONSISTENT');
  const caps = { ...LIVE_CAPS, dataEvents: 3 };
  const ov = good({ meta: metaFor(caps), caps });
  assert.equal(ov[ov.length - 1].overflow, 1); assert.equal(ov[ov.length - 1].ts, 'OVERFLOW');
  const o = rejects(ov, 'OVERFLOW', { caps }); assert.equal(o.reason, 'OVERFLOW'); assert.equal(o.vbEligible, false);
  const ovLie = clone(ov); ovLie[ovLie.length - 1].ts = 'OK'; rejects(ovLie, 'TERMINAL-STATUS-INCONSISTENT', { caps });
  const r = new LiveTraceRecorder(metaFor(), canonicalBytes);
  r.append({ f: 0, k: 'SMP', tm: 0 }); r.append({ f: 0, k: 'TCK', tm: 0 });
  const mal = r.close().records;
  assert.equal(mal[mal.length - 1].ts, 'MALFORMED');
  only(mal, 'MALFORMED-APPENDS');
  for (const recs of [tr, ov, mal, tr.slice(0, -1)]) {
    const out = correlateTrace(recs, { canonicalBytes, caps: recs === ov ? caps : LIVE_CAPS });
    for (const id of ['Q-OWNER', 'Q-SUBJ', 'Q-ATTR']) assert.equal(out.questions[id].status, 'UNDIAGNOSABLE', id);
  }
});

test('integrity: capture-start promise (META.cs = 1) requires the CAM at f = 0, tm = 0 first', () => {
  const t = good({ meta: metaFor(LIVE_CAPS, { cs: 1 }) });
  only(t, 'CAPTURE-START-MISSING');
  const ok = good({ meta: metaFor(LIVE_CAPS, { cs: 1 }), events: [{ f: 0, k: 'CAM', cl: 0, xc: 0, pd: P(0), ac: 0, tm: 0 }, ...EVENTS.map((e) => ({ ...e, tm: e.tm + 1 }))] });
  assert.equal(V(ok).ok, true);
});

test('integrity: VB-0 is bound to the validated META — version-bound events are used only on the exact pinned build', () => {
  // envelope valid, VB-0 failed honestly (vg=0): AE/pd/pq/ac are removed, never used
  const failed = good({ meta: metaFor(LIVE_CAPS, { vg: 0, vv: '7.124.1', vb: { 'VB-1': 0, 'VB-2': 0, 'VB-3': 0 } }) });
  assert.equal(V(failed).ok, true); assert.equal(V(failed).vbEligible, false);
  const out = correlateTrace(failed, { canonicalBytes });
  assert.deepEqual(out.guard.vbUnavailable, ['VB-0']); assert.equal(out.malformed, null);
  assert.deepEqual(out.questions['Q-SUBJ'], { status: 'AMBIGUOUS', reason: 'VB_UNAVAILABLE:VB-0' });
  // forged eligibility (vg=1 on another build): the envelope fails, whole trace UNDIAGNOSABLE
  for (const over of [{ vv: '7.125.0' }, { vd: '0'.repeat(64) }, { vv: '7.124.2 ' }]) {
    const f = clone(good()); Object.assign(f[0], over);
    const v = rejects(reseal(f), 'META-VB0-INCONSISTENT');
    assert.equal(v.vbEligible, false);
    assert.equal(correlateTrace(f, { canonicalBytes }).questions['Q-SUBJ'].status, 'UNDIAGNOSABLE');
  }
  // the post-capture control still gates V-EDGE on the pinned build (C6 composition, never MALFORMED)
  const noCtl = correlateTrace(good({ pc: { 'VB-3': 0 } }), { canonicalBytes });
  assert.deepEqual(noCtl.guard.vbUnavailable, ['VB-3']); assert.equal(noCtl.malformed, null);
  // an atom not configured in META.at is never silently dropped: its events make the trace MALFORMED (C8)
  const pubOnly = good({ meta: metaFor(LIVE_CAPS, { at: AT.filter((a) => a !== 'V-EDGE') }) });
  assert.equal(correlateTrace(pubOnly, { canonicalBytes }).questions['Q-OWNER'].reason, 'MALFORMED');
});

test('integrity: validator and entry point are total (garbage, prototype keys, proxies never throw)', () => {
  const trap = new Proxy([], { get() { throw new Error('trap'); } });
  const hostile = [
    null, undefined, 'x', 42, {}, [], [null], [undefined], [Object.create(null)], [{ k: '__proto__' }], [{ k: 'toString' }],
    [JSON.parse('{"__proto__":{"k":"META"}}')], [JSON.parse('{"k":"META","__proto__":{"vg":1}}')], trap, [trap], [{ k: 'META', vb: trap }],
    [Object.assign(Object.create({ k: 'META' }), { f: 0 })], [{ k: 'META' }, { k: 'END' }], good().map((r, i) => (i === 3 ? 7 : r)),
  ];
  for (const h of hostile) {
    let v; let o;
    assert.doesNotThrow(() => { v = V(h); });
    assert.equal(v.ok, false); assert.equal(v.vbEligible, false);
    assert.doesNotThrow(() => { o = correlateTrace(h, { canonicalBytes }); });
    assert.equal(o.questions['Q-OWNER'].status, 'UNDIAGNOSABLE');
  }
  assert.deepEqual(validateTrace(good(), {}).errors, ['BAD-OPTIONS']);
  assert.deepEqual(validateTrace(good(), { canonicalBytes, caps: { ...LIVE_CAPS, endBytes: -1 } }).errors, ['BAD-OPTIONS']);
  assert.deepEqual(validateTrace(good(), { canonicalBytes: () => { throw new Error('x'); } }).ok, false);
});
