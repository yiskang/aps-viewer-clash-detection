// Trace envelope: canonical raw forms, stream commitment, recorder caps and lifecycle, whole-trace integrity and
// fail-closed partial traces. [SYN] research-local tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from './contract-loader.mjs';
import {
  toJsonl, parseJsonl, traceArrayFromJsonl, canonicalStringify, streamDigest, validateTraceV2, Page, Recorder, RecorderRefused,
  RECORDER_STATE, TRACE_V2_CODES, reseal,
} from './envelope.mjs';
import { generateFixtures, scenarioFromFiles, scriptValid, metaTemplate, bindingFor, removeData } from './fixtures-gen.mjs';

const contract = loadContract();
const { files } = generateFixtures(contract);
const sc = scenarioFromFiles(files, 'valid-complete', { parseJsonl });
const VALID = sc.traces.T;
const B = sc.binding;
const V = (recs, o = {}) => validateTraceV2(recs, { contract, role: 'T', binding: B, ...o });
const clone = (v) => JSON.parse(JSON.stringify(v));
const tpl = () => metaTemplate(contract, bindingFor(contract, 'a'), { role: 'T', run: 'syn-a' });

test('envelope: JSONL is canonical, LF-terminated and round-trips; the trace array is the canonical array', () => {
  const text = toJsonl(VALID);
  assert.ok(text.endsWith('\n') && !text.includes('\r'));
  const p = parseJsonl(text);
  assert.equal(p.ok, true); assert.deepEqual(p.records, VALID);
  assert.equal(traceArrayFromJsonl(text), canonicalStringify(VALID));
  assert.equal(parseJsonl(text.replace('\n', '\r\n')).code, 'JSONL-CR');
  assert.equal(parseJsonl(text.slice(0, -1)).code, 'JSONL-NO-FINAL-LF');
  assert.equal(parseJsonl(text.replace('{"', '{ "')).code, 'JSONL-NON-CANONICAL');
  assert.equal(parseJsonl('{"b":1,"a":2}\n').code, 'JSONL-NON-CANONICAL');
  assert.equal(parseJsonl('{x}\n').code, 'JSONL-PARSE');
});

test('envelope: the valid fixture passes whole-trace integrity; END.sd commits to [META, ...data]', () => {
  const v = V(VALID);
  assert.deepEqual(v.errors, []); assert.equal(v.ok, true); assert.equal(v.vbEligible, true);
  const end = VALID[VALID.length - 1];
  assert.equal(end.sd, streamDigest(VALID[0], VALID.slice(1, -1)));
  assert.equal(end.ts, 'OK'); assert.equal(end.lq, VALID[VALID.length - 2].q);
});

test('envelope: fail-closed partial traces — every proper prefix, and every single-record deletion without reseal, is invalid', () => {
  for (let n = 0; n < VALID.length; n += 1) assert.equal(V(VALID.slice(0, n)).ok, false, `prefix ${n}`);
  for (let i = 1; i < VALID.length - 1; i += 1) { const r = clone(VALID); r.splice(i, 1); assert.equal(V(r).ok, false, `delete ${i}`); }
});

test('envelope: META/data/END mismatches and digest mismatches are detected by their own codes', () => {
  const m = (fn) => { const r = clone(VALID); fn(r); return V(r); };
  assert.ok(m((r) => { r[r.length - 1].run = 'other'; }).errors.includes('RUN-ID-MISMATCH'));
  assert.ok(m((r) => { r.splice(3, 0, clone(r[0])); }).errors.includes('META-DUPLICATE'));
  assert.ok(m((r) => { r.push({ k: 'TC', q: 9999, f: 0, tm: 0 }); }).errors.includes('DATA-AFTER-END'));
  assert.ok(m((r) => { r[r.length - 1].ne -= 1; }).errors.includes('COUNT-MISMATCH'));
  assert.ok(m((r) => { r[r.length - 1].sd = 'f'.repeat(64); }).errors.includes('STREAM-DIGEST-MISMATCH'));
  assert.ok(m((r) => { r[5].tm += 0; r[1].cl = 9; }).errors.includes('STREAM-DIGEST-MISMATCH'));
  assert.ok(m((r) => { r[r.length - 1].zt += 1; }).errors.includes('LIFECYCLE-MISMATCH'));
  assert.ok(m((r) => { r[r.length - 1].mx += 1; }).errors.includes('SAMPLE-BOUND'));
  assert.ok(m((r) => { r[r.length - 1].pc = { 'VB-3': 0 }; }).errors.includes('PC-MISMATCH'));
  assert.ok(m((r) => { r[r.length - 1].ds = 2; }).errors.includes('TZ-STATUS-MISMATCH'));
  assert.ok(m((r) => { r[0].rl = 'PC-1'; reseal(r); }).errors.includes('ROLE-MISMATCH'));
  assert.ok(m((r) => { r.unshift(r.splice(1, 1)[0]); }).errors.includes('DATA-BEFORE-META'));
  assert.ok(m((r) => { r[r.length - 1] = { ...r[r.length - 1], truncated: 1, ts: 'TRUNCATED' }; }).errors.includes('TRUNCATED'));
  assert.ok(m((r) => { r[r.length - 1] = { ...r[r.length - 1], overflow: 1, rj: 1, ts: 'OVERFLOW' }; }).errors.includes('OVERFLOW'));
  assert.ok(m((r) => { r[r.length - 1] = { ...r[r.length - 1], iv: 1, rj: 1, ts: 'MALFORMED' }; }).errors.includes('MALFORMED-APPENDS'));
});

test('envelope: binding check — every bound META field and the observed Viewer pin must equal the binding', () => {
  for (const field of ['authorizationId', 'authorizationRecordSha256', 'attemptId', 'diagnosticHarnessSha256', 'diagnosticSpecSha256', 'diagnosticPackageSha256', 'targetPlanSha256', 'slotWindow']) {
    const b = { ...B, [field]: field === 'slotWindow' ? 'ASSUME_NO_UNOBSERVED_WRITER' : field === 'authorizationId' ? 'other-id-xxxxxxxx' : field === 'attemptId' ? '11111111-1111-4111-8111-111111111111' : 'e'.repeat(64) };
    const v = V(VALID, { binding: b });
    assert.equal(v.ok, false); assert.ok(v.errors.includes(`BINDING-MISMATCH:${field}`), field);
    assert.equal(v.envelopeOk, true, 'a binding mismatch is reported separately from envelope integrity');
  }
  assert.ok(V(VALID, { binding: { ...B, viewerVersion: '7.124.1' } }).errors.includes('OBSERVED_VIEWER_NOT_BOUND'));
  assert.ok(V(VALID, { binding: { ...B, viewerBundleSha256: 'e'.repeat(64) } }).errors.includes('OBSERVED_BUNDLE_NOT_BOUND'));
  assert.ok(V(VALID, { binding: undefined }).errors.includes('BINDING-MISMATCH'));
  // frozen template: everything except the five capture-start fields must match
  const t = { ...VALID[0] }; for (const k of ['ei', 'ba', 'bp', 'lb', 'qe']) delete t[k];
  assert.equal(V(VALID, { template: t }).ok, true);
  assert.ok(V(VALID, { template: { ...t, br: 'other' } }).errors.includes('BINDING-MISMATCH:metaTemplate'));
});

test('envelope: validateTraceV2 is total on hostile input and only emits registered codes', () => {
  const junk = [undefined, null, 0, 'x', {}, [], [null], [{}], [{ k: 'META' }], [{ k: 'END' }], [VALID[0]], [VALID[VALID.length - 1]],
    [Object.create(null)], [{ k: 'META', get vv() { throw new Error('boom'); } }], VALID.map((r, i) => (i === 3 ? { ...r, k: 'toString' } : r))];
  for (const j of junk) {
    const v = validateTraceV2(j, { contract, role: 'T', binding: B });
    assert.equal(v.ok, false);
    for (const e of v.errors) assert.ok(TRACE_V2_CODES.includes(e) || e.startsWith('BINDING-MISMATCH:'), `unregistered ${e}`);
  }
  assert.deepEqual(validateTraceV2(VALID, {}).errors, ['BAD-OPTIONS']);
});

test('envelope: recorder caps — sampleIndex 1,801 accepted, 1,802 rejected as overflow; nothing after an overflow is written', () => {
  const page = new Page();
  const r = new Recorder(page, tpl(), { contract });
  r.start({ fsFields: { cl: 0, dg: '0'.repeat(16) } });
  const at = (n) => r.append({ k: 'T4', tp: 'sample', s: 'S', n, cl: 0, dg: '0'.repeat(16), f: 0, tm: 1 });
  assert.ok(at(1801)); assert.equal(r.mx, 1801); assert.equal(r.overflow, 0);
  assert.equal(at(1802), null); assert.equal(r.overflow, 1); assert.equal(r.rj, 1); assert.equal(r.iv, 0);
  const len = r.data.length;
  assert.equal(r.append({ k: 'TC', f: 0, tm: 2 }), null); assert.equal(r.data.length, len); assert.equal(r.rj, 2);
  const out = r.close({ pc: { 'VB-3': 0 } });
  assert.equal(out[out.length - 1].ts, 'OVERFLOW');
  assert.equal(V(out).reason, 'OVERFLOW');
});

test('envelope: recorder rejects schema-invalid and caller-sequenced appends before any state change (iv)', () => {
  const r = new Recorder(new Page(), tpl(), { contract });
  r.start({ fsFields: { cl: 0, dg: '0'.repeat(16) } });
  const n = r.data.length;
  assert.equal(r.append({ k: 'RQ', pp: 'post', co: 'returned', f: 0, tm: 1 }), null);
  assert.equal(r.append({ k: 'TC', q: 7, f: 0, tm: 1 }), null);
  assert.equal(r.data.length, n); assert.equal(r.iv, 2); assert.equal(r.rj, 2);
  const out = r.close();
  assert.equal(out[out.length - 1].ts, 'MALFORMED');
});

test('envelope: recorder lifecycle — one recorder per page, idempotent teardown, callbacks after TZ final are no-ops', () => {
  const page = new Page();
  const s = scriptValid(contract, tpl(), { page });
  assert.throws(() => new Recorder(page, tpl(), { contract }), RecorderRefused);
  assert.equal(s.rec.state, RECORDER_STATE.FINALIZING); assert.equal(s.rec.lr, 1);
  const snap = JSON.stringify([s.rec.data, s.rec.rj, s.rec.iv, s.rec.nvx]);
  s.edge(1); s.add({ k: 'TC' }); s.rec.nvNotRetained();
  assert.equal(JSON.stringify([s.rec.data, s.rec.rj, s.rec.iv, s.rec.nvx]), snap);
  assert.equal(s.rec.teardown(), false, 'second teardown is a no-op');
  const out = s.close({ pc: { 'VB-3': 1 } });
  assert.equal(s.rec.state, RECORDER_STATE.CLOSED);
  s.edge(0); assert.equal(s.close(), null);
  assert.equal(toJsonl(out), files[JSON.parse(files['scenarios/valid-complete/scenario.json']).traces.T]);
  // a CREATED recorder writes nothing and only counts quiescence edges
  const r = new Recorder(new Page(), tpl(), { contract });
  assert.equal(r.append({ k: 'TC', f: 0, tm: 0 }), null); r.quiescenceEdge(); r.quiescenceEdge();
  const m = r.start({ fsFields: { cl: 0, dg: '0'.repeat(16) } });
  assert.equal(m.qe, 2); assert.equal(m.ei, 'UNKNOWN');
});

test('envelope: sequence rules — I3 host/PS, FS frame gaps, settle roles and C8 binding fail the whole trace', () => {
  const data = VALID.slice(1, -1);
  const psIdx = data.findIndex((r, i) => r.k === 'PS' && i > 2);
  assert.ok(V(removeData(VALID, psIdx)).errors.includes('I3-HOST-PS'));
  const c8 = data.findIndex((r) => r.k === 'C8');
  const noC8 = removeData(VALID, c8);
  assert.equal(V(noC8).ok, true, 'a target without any C8 is still intact');
  const sStart = data.findIndex((r) => r.k === 'T4' && r.tp === 'start' && r.s === 'S');
  const r2 = clone(VALID); r2[sStart + 1].s = 'G'; reseal(r2);
  assert.ok(V(r2).errors.includes('SETTLE-ROLES') || V(r2).errors.includes('I4-T4-DECISION'));
});

test('envelope: the registered code set equals the contract code set (committed 39 + Part 1 + Part 2), with no drift', () => {
  const ic = contract.envelope.integrityCodes;
  assert.equal(ic.committedList.length, 39);
  const want = [...new Set([...ic.committedList, ...ic.part1, ...ic.part2])].sort();
  assert.deepEqual([...TRACE_V2_CODES].sort(), want);
  for (const c of ['RS-PAIR']) assert.ok(ic.part1.includes(c), `${c} is a Part 1 code`);
  for (const c of ['FRAME-ORDER', 'TIME-ORDER']) assert.ok(ic.part2.includes(c), `${c} is a Part 2 code`);
});

test('envelope: the committed code list in the contract equals the committed TRACE_ERRORS export (read-only import)', async () => {
  const { TRACE_ERRORS } = await import('../../2026-10-05-g2-diagnostic-instrumentation/trace-integrity.mjs');
  assert.deepEqual([...contract.envelope.integrityCodes.committedList], [...TRACE_ERRORS]);
});

test('envelope: frame/time ordering violations have their own codes (FRAME-ORDER, TIME-ORDER), not DATA-INVALID', () => {
  const data = VALID.slice(1, -1);
  const tc = data.findIndex((r) => r.k === 'TC') + 1; // index in records
  const f1 = clone(VALID); f1[tc].f -= 1; reseal(f1);
  const v1 = V(f1);
  assert.ok(v1.errors.includes('FRAME-ORDER')); assert.ok(!v1.errors.includes('DATA-INVALID')); assert.equal(v1.ok, false);
  const f2 = clone(VALID); f2[tc].tm -= 5; reseal(f2);
  const v2 = V(f2);
  assert.ok(v2.errors.includes('TIME-ORDER')); assert.ok(!v2.errors.includes('DATA-INVALID')); assert.equal(v2.ok, false);
  // a non-FS record that keeps a monotone frame but skips ahead of the latest FS frame is FRAME-ORDER too
  const f3 = clone(VALID); f3[tc].f += 1; reseal(f3);
  assert.ok(V(f3).errors.includes('FRAME-ORDER'));
});

test('envelope: result fields — an honest wrong-Viewer trace is envelopeOk but not ok (Part 2 §12.6 step 4)', () => {
  const s2 = scenarioFromFiles(files, 'wrong-viewer-version', { parseJsonl });
  const v = V(s2.traces.T, { binding: s2.binding });
  assert.equal(v.envelopeOk, true); assert.equal(v.bindingOk, false); assert.equal(v.ok, false); assert.equal(v.vbEligible, false);
  assert.deepEqual(v.bindingErrors, ['OBSERVED_VIEWER_NOT_BOUND']);
  assert.deepEqual(v.errors, [...new Set([...v.envelopeErrors, ...v.bindingErrors])].sort());
});
