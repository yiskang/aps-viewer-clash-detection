// test/acceptance/clashpanel-viewerbridge.acceptance.journal.test.mjs
//
// Offline tests for the G2 attempt/reservation journal (procedure §4.1 "Reservation and
// journal", "Canonical boundary sequence", "Durable write order", "Crash matrix", "Startup rule",
// "Durability algorithm"; §4.2 journal crash matrix, fake-filesystem order tests, orphan temp,
// empty/truncated reservation, concurrency). Uses the harness's recording fake filesystem (which
// models visible vs fsync-durable state for process-crash vs OS-crash views) plus real-Node-fs
// integration and a multi-process race in os.tmpdir() sandboxes. Never imports playwright.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import {
  JOURNAL_STATE,
  JOURNAL_TRANSITIONS,
  JOURNAL_CLASS,
  BINDING_KEYS,
  G2DurabilityError,
  G2RefusalError,
  SimulatedCrash,
  appendTransition,
  validateTransitionHistory,
  buildBindingRecord,
  serializeJson,
  parseReservationBytes,
  parseJournalBytes,
  reservationName,
  journalName,
  journalTempPrefix,
  commitName,
  resolveAttemptsChain,
  scanAttemptsDirectoryForStartup,
  classifyJournal,
  inspectAttemptFiles,
  establishAttemptsDirectory,
  reserveAttempt,
  markAttemptConsumed,
  createRecordingFakeFs,
  createNodeFsLayer,
  sha256Hex,
} from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS_URL = new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url).href;
const ROOT = '/repo';
const CHAIN = resolveAttemptsChain(ROOT);
const ID = 'g2-live-0001';
const RECORD_SHA = 'c'.repeat(64);

function validationFor({ id = ID, sha = RECORD_SHA } = {}) {
  return {
    ok: true,
    record: { path: `docs/prompts/${id}.md`, sha256: sha, id },
    digests: { headSha: '8'.repeat(40), procedureSha256: '1'.repeat(64), harnessSha256: '2'.repeat(64), urnASha256: '3'.repeat(64), urnBSha256: '4'.repeat(64) },
  };
}

let uuidCounter = 0;
function fakeUuid() {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
}

function bindingFor(opts) { return buildBindingRecord({ validation: validationFor(opts), attemptId: fakeUuid() }); }

function fakeClock() {
  let mono = 0;
  return { nowIso: () => '2026-09-30T12:00:00.000Z', monotonicMs: () => { mono += 1; return mono; } };
}

function newFakeFs({ fault = null, existing = false } = {}) {
  const seedDirs = existing ? [CHAIN.D2] : [CHAIN.D0];
  return createRecordingFakeFs({ fault, seedDirs });
}

/** Full W2a + W2b on an fs (throws whatever the harness throws). */
function runW2(fs, { binding = bindingFor(), clock = fakeClock() } = {}) {
  establishAttemptsDirectory({ fs, chain: CHAIN });
  return reserveAttempt({ fs, chain: CHAIN, binding, clock, uuid: fakeUuid });
}

const T = (state, monotonicMs, detail) => (detail === undefined
  ? { state, at: '2026-09-30T12:00:00.000Z', monotonicMs }
  : { state, at: '2026-09-30T12:00:00.000Z', monotonicMs, detail });

// ============================================================================================
// State machine
// ============================================================================================

test('state machine: the legal graph is exactly the §4.1 table (no COMPLETED state)', () => {
  assert.deepEqual(Object.keys(JOURNAL_STATE).sort(), ['ATTEMPT_CONSUMED', 'AUTH_BOUND', 'CLOSEOUT_STARTED', 'FAILED', 'PREFLIGHT_FAILED']);
  assert.deepEqual({ ...JOURNAL_TRANSITIONS }, {
    null: ['AUTH_BOUND'],
    AUTH_BOUND: ['PREFLIGHT_FAILED', 'ATTEMPT_CONSUMED'],
    PREFLIGHT_FAILED: [],
    ATTEMPT_CONSUMED: ['CLOSEOUT_STARTED', 'FAILED'],
    CLOSEOUT_STARTED: ['FAILED'],
    FAILED: [],
  });
});

test('state machine: every legal path validates', () => {
  const co = { primaryOverall: 'PASS', primaryRow: 8 };
  const fl = { causes: ['r1-write-failed'] };
  for (const h of [
    [T('AUTH_BOUND', 1)],
    [T('AUTH_BOUND', 1), T('PREFLIGHT_FAILED', 2, { category: 'preflight' })],
    [T('AUTH_BOUND', 1), T('ATTEMPT_CONSUMED', 2)],
    [T('AUTH_BOUND', 1), T('ATTEMPT_CONSUMED', 2), T('FAILED', 3, fl)],
    [T('AUTH_BOUND', 1), T('ATTEMPT_CONSUMED', 2), T('CLOSEOUT_STARTED', 3, co)],
    [T('AUTH_BOUND', 1), T('ATTEMPT_CONSUMED', 2), T('CLOSEOUT_STARTED', 3, co), T('FAILED', 4, { ...fl, primaryOverall: 'PASS', primaryRow: 8 })],
  ]) {
    assert.equal(validateTransitionHistory(h).ok, true, JSON.stringify(h.map((t) => t.state)));
  }
});

test('state machine: every illegal (from -> to) pair is rejected by appendTransition', () => {
  const states = Object.keys(JOURNAL_STATE);
  const detailFor = (s) => (s === 'CLOSEOUT_STARTED' ? { primaryOverall: 'FAIL', primaryRow: 3 } : s === 'FAILED' ? { causes: ['x'] } : undefined);
  const prefixes = {
    AUTH_BOUND: [T('AUTH_BOUND', 1)],
    PREFLIGHT_FAILED: [T('AUTH_BOUND', 1), T('PREFLIGHT_FAILED', 2)],
    ATTEMPT_CONSUMED: [T('AUTH_BOUND', 1), T('ATTEMPT_CONSUMED', 2)],
    CLOSEOUT_STARTED: [T('AUTH_BOUND', 1), T('ATTEMPT_CONSUMED', 2), T('CLOSEOUT_STARTED', 3, detailFor('CLOSEOUT_STARTED'))],
    FAILED: [T('AUTH_BOUND', 1), T('ATTEMPT_CONSUMED', 2), T('FAILED', 3, detailFor('FAILED'))],
  };
  let illegal = 0;
  for (const from of states) {
    for (const to of states) {
      const legal = JOURNAL_TRANSITIONS[from].includes(to);
      const j = { transitions: prefixes[from] };
      const fn = () => appendTransition(j, to, { at: '2026-09-30T12:00:01.000Z', monotonicMs: 10, detail: detailFor(to) });
      if (legal) assert.doesNotThrow(fn, `${from}->${to}`);
      else { assert.throws(fn, /illegal-transition/, `${from}->${to}`); illegal += 1; }
    }
  }
  assert.ok(illegal >= 18);
  // from NOT_STARTED only AUTH_BOUND
  for (const to of states.filter((s) => s !== 'AUTH_BOUND')) {
    assert.throws(() => appendTransition({ transitions: [] }, to, { at: '2026-09-30T12:00:00.000Z', monotonicMs: 1, detail: detailFor(to) }), /illegal-transition/);
  }
});

test('state machine: unknown names (incl. COMPLETED), bad timestamps, decreasing monotonic, bad details', () => {
  const base = [T('AUTH_BOUND', 5)];
  const bad = [
    [[T('COMPLETED', 1)], /unknown-transition:COMPLETED/],
    [[...base, T('ATTEMPT_CONSUMED', 6), T('COMPLETED', 7)], /unknown-transition/],
    [[...base, T('ATTEMPT_CONSUMED', 6), T('ATTEMPT_CONSUMED', 7)], /illegal-transition/],
    [[...base, T('PREFLIGHT_FAILED', 6), T('ATTEMPT_CONSUMED', 7)], /illegal-transition/],
    [[...base, T('ATTEMPT_CONSUMED', 4)], /transition-monotonic-invalid/],
    [[{ state: 'AUTH_BOUND', at: '2026-09-30 12:00:00', monotonicMs: 1 }], /transition-at-invalid/],
    [[{ state: 'AUTH_BOUND', at: '2026-09-30T12:00:00.000+01:00', monotonicMs: 1 }], /transition-at-invalid/],
    [[{ state: 'AUTH_BOUND', at: '2026-09-30T12:00:00.000Z', monotonicMs: Number.NaN }], /transition-monotonic-invalid/],
    [[{ ...T('AUTH_BOUND', 1), extra: 1 }], /transition-unknown-key/],
    [[...base, T('ATTEMPT_CONSUMED', 6), T('CLOSEOUT_STARTED', 7)], /closeout-started-detail-required/],
    [[...base, T('ATTEMPT_CONSUMED', 6), T('CLOSEOUT_STARTED', 7, { primaryOverall: 'PASS', primaryRow: 8, resultSha256: 'x' })], /closeout-started-detail-keys/],
    [[...base, T('ATTEMPT_CONSUMED', 6), T('CLOSEOUT_STARTED', 7, { primaryOverall: 'OK', primaryRow: 8 })], /closeout-started-primary-overall/],
    [[...base, T('ATTEMPT_CONSUMED', 6), T('CLOSEOUT_STARTED', 7, { primaryOverall: 'PASS', primaryRow: 9 })], /closeout-started-primary-row/],
    [[...base, T('ATTEMPT_CONSUMED', 6), T('FAILED', 7)], /failed-detail-required/],
    [[...base, T('ATTEMPT_CONSUMED', 6), T('FAILED', 7, { causes: [] })], /failed-causes/],
    [[], /history-empty/],
  ];
  for (const [h, re] of bad) {
    const v = validateTransitionHistory(h);
    assert.equal(v.ok, false, JSON.stringify(h));
    assert.match(v.reason, re);
  }
});

test('appendTransition is pure: returns a new object, never mutates or rewrites earlier transitions', () => {
  const j0 = { ...bindingFor(), transitions: [] };
  const j1 = appendTransition(j0, 'AUTH_BOUND', { at: '2026-09-30T12:00:00.000Z', monotonicMs: 1 });
  const j2 = appendTransition(j1, 'ATTEMPT_CONSUMED', { at: '2026-09-30T12:00:01.000Z', monotonicMs: 2 });
  assert.equal(j0.transitions.length, 0);
  assert.equal(j1.transitions.length, 1);
  assert.deepEqual(j2.transitions.map((t) => t.state), ['AUTH_BOUND', 'ATTEMPT_CONSUMED']);
  assert.equal(j2.transitions[0], j1.transitions[0]);
});

test('binding record: carries every §4.1 binding field; reservation parse round-trips; extra keys rejected', () => {
  const b = bindingFor();
  assert.deepEqual(Object.keys(b), [...BINDING_KEYS]);
  assert.deepEqual(b.runtimeEnvelopeRequested, { viewer: '7.124.2', env: 'AutodeskProduction2', api: 'streamingV2' });
  assert.equal(b.procedure.version, 'v5');
  assert.deepEqual([b.fixtures.A.name, b.fixtures.B.name], ['Audubon_Mechanical_clash_test.rvt', 'Audubon_Structure_clash_test.rvt']);
  assert.deepEqual(parseReservationBytes(serializeJson(b)), { ok: true, value: b });
  assert.equal(parseReservationBytes(serializeJson({ ...b, transitions: [] })).ok, false);
  assert.throws(() => buildBindingRecord({ validation: validationFor(), attemptId: 'not-a-uuid' }));
  assert.throws(() => buildBindingRecord({ validation: { ok: false }, attemptId: fakeUuid() }));
});

// ============================================================================================
// Fake-filesystem order tests (W2a/W2b)
// ============================================================================================

const opName = (o) => `${o.op}(${o.path}${o.flags ? `,${o.flags}` : ''})`;
const idxOf = (ops, pred, from = 0) => { for (let i = from; i < ops.length; i += 1) if (pred(ops[i])) return i; return -1; };
const is = (op, p, flags) => (o) => o.op === op && o.path === p && (flags === undefined || o.flags === flags);
const RES_PATH = path.join(CHAIN.D2, reservationName(ID));
const JOURNAL_PATH = path.join(CHAIN.D2, journalName(ID));

test('order (first run, D1/D2 absent): mkdir(Di) -> fsync(Di) -> fsync(D(i-1)), D1 before D2, all before open(reservation,wx)', () => {
  const fs = newFakeFs();
  const handle = runW2(fs);
  const ops = fs.ops;
  const mk1 = idxOf(ops, is('mkdir', CHAIN.D1));
  const fs1 = idxOf(ops, is('fsync', CHAIN.D1), mk1);
  const fs0 = idxOf(ops, is('fsync', CHAIN.D0), fs1);
  const mk2 = idxOf(ops, is('mkdir', CHAIN.D2), fs0);
  const fs2 = idxOf(ops, is('fsync', CHAIN.D2), mk2);
  const fs1p = idxOf(ops, is('fsync', CHAIN.D1), fs2);
  const res = idxOf(ops, is('open', RES_PATH, 'wx'));
  for (const [name, i] of Object.entries({ mk1, fs1, fs0, mk2, fs2, fs1p, res })) assert.ok(i >= 0, `${name} missing: ${ops.map(opName).join(' ')}`);
  assert.ok(mk1 < fs1 && fs1 < fs0 && fs0 < mk2 && mk2 < fs2 && fs2 < fs1p && fs1p < res);
  // W2b durability sequence: wx -> write -> fsync(fd) -> close -> fsync(D2Fd) -> journal temp+rename -> fsync(D2Fd) -> read-back
  const tail = ops.slice(res).map(opName);
  const tmp = `${path.join(CHAIN.D2, journalTempPrefix(ID))}`;
  assert.deepEqual(tail.map((s) => s.replace(/tmp-[0-9a-f-]+/, 'tmp-*')), [
    `open(${RES_PATH},wx)`, `write(${RES_PATH})`, `fsync(${RES_PATH})`, `close(${RES_PATH})`, `fsync(${CHAIN.D2})`,
    `open(${tmp}*,wx)`, `write(${tmp}*)`, `fsync(${tmp}*)`, `close(${tmp}*)`, `rename(${tmp}*)`, `fsync(${CHAIN.D2})`, `readFile(${JOURNAL_PATH})`,
  ]);
  // D2Fd was opened before the reservation and is still held by the handle
  assert.ok(idxOf(ops, is('open', CHAIN.D2, 'r'), fs1p) < res);
  assert.equal(handle.current().journal.transitions[0].state, 'AUTH_BOUND');
});

test('order (D1/D2 already exist): no mkdir, but fsync(D1), fsync(D0), fsync(D2) and the parent fsync(D1) all precede the reservation', () => {
  const fs = newFakeFs({ existing: true });
  runW2(fs);
  const ops = fs.ops;
  assert.equal(ops.some((o) => o.op === 'mkdir'), false);
  const res = idxOf(ops, is('open', RES_PATH, 'wx'));
  const seq = ops.slice(0, res).filter((o) => o.op === 'fsync').map((o) => o.path);
  assert.deepEqual(seq, [CHAIN.D1, CHAIN.D0, CHAIN.D2, CHAIN.D1]);
});

test('order: parent fsync runs even when only D2 exists-created-earlier (D1 exists, D2 exists) and when D1 exists but D2 is absent', () => {
  const fs = createRecordingFakeFs({ seedDirs: [CHAIN.D1] });
  runW2(fs);
  const res = idxOf(fs.ops, is('open', RES_PATH, 'wx'));
  const pre = fs.ops.slice(0, res);
  assert.deepEqual(pre.filter((o) => o.op === 'mkdir').map((o) => o.path), [CHAIN.D2]);
  assert.deepEqual(pre.filter((o) => o.op === 'fsync').map((o) => o.path), [CHAIN.D1, CHAIN.D0, CHAIN.D2, CHAIN.D1]);
});

test('W2a refusals: D0 missing, D1/D2 symlink or regular file => G2DurabilityError, no reservation attempted', () => {
  const cases = [
    () => createRecordingFakeFs({ seedDirs: ['/repo/test'] }),
    () => { const f = createRecordingFakeFs({ seedDirs: [CHAIN.D0] }); f.symlinkForTest('/tmp/x', CHAIN.D1); return f; },
    () => { const f = createRecordingFakeFs({ seedDirs: [CHAIN.D1] }); f.symlinkForTest('/tmp/x', CHAIN.D2); return f; },
    () => { const f = createRecordingFakeFs({ seedDirs: [CHAIN.D0] }); f.putFileForTest(CHAIN.D1, 'x'); return f; },
    () => { const f = createRecordingFakeFs({ seedDirs: [CHAIN.D1] }); f.putFileForTest(CHAIN.D2, 'x'); return f; },
    () => { const f = createRecordingFakeFs({ seedDirs: ['/repo/test'] }); f.symlinkForTest('/elsewhere', CHAIN.D0); return f; },
  ];
  for (const mk of cases) {
    const fs = mk();
    assert.throws(() => runW2(fs), G2DurabilityError);
    assert.equal(fs.ops.some((o) => o.op === 'open' && o.flags === 'wx'), false);
  }
});

test('W2a mkdir EEXIST race: accepted only if the result is a real directory', () => {
  const racing = (makeSymlink) => {
    const inner = createRecordingFakeFs({ seedDirs: [CHAIN.D0] });
    return {
      ...inner,
      ops: inner.ops,
      mkdir: (p) => {
        if (p === CHAIN.D1) {
          // another process wins the mkdir between our lstat and mkdir
          if (makeSymlink) inner.symlinkForTest('/elsewhere', p); else inner.__seedDir(p);
          const e = new Error('EEXIST'); e.code = 'EEXIST'; throw e;
        }
        return inner.mkdir(p);
      },
    };
  };
  const ok = racing(false);
  const r = establishAttemptsDirectory({ fs: ok, chain: CHAIN });
  assert.deepEqual(r.created, { D1: false, D2: true });
  // parent fsync of D0 still ran for the D1 this process did not create
  assert.ok(ok.ops.some(is('fsync', CHAIN.D0)));
  assert.throws(() => establishAttemptsDirectory({ fs: racing(true), chain: CHAIN }), G2DurabilityError);
});

// ============================================================================================
// Startup rule (W1 scan)
// ============================================================================================

function fsWithD2(files = {}) {
  const fs = createRecordingFakeFs({ seedDirs: [CHAIN.D2] });
  for (const [name, content] of Object.entries(files)) fs.putFileForTest(path.join(CHAIN.D2, name), content);
  return fs;
}

function journalBytes(states, { binding = bindingFor() } = {}) {
  let j = { ...binding, transitions: [] };
  let m = 0;
  for (const s of states) {
    m += 1;
    const detail = s === 'CLOSEOUT_STARTED' ? { primaryOverall: 'PASS', primaryRow: 8 } : s === 'FAILED' ? { causes: ['x'] } : undefined;
    j = appendTransition(j, s, { at: '2026-09-30T12:00:00.000Z', monotonicMs: m, detail });
  }
  return serializeJson(j);
}

const scan = (fs, id = ID, sha = RECORD_SHA) => scanAttemptsDirectoryForStartup({ fs, chain: CHAIN, authorizationId: id, recordSha256: sha });

test('startup: absent D1/D2 or empty D2 => ok', () => {
  assert.equal(scan(createRecordingFakeFs({ seedDirs: [CHAIN.D0] })).ok, true);
  assert.equal(scan(fsWithD2()).ok, true);
});

test('startup: own reservation in any content state (empty/truncated/complete) => reservation-exists', () => {
  const full = serializeJson(bindingFor());
  for (const content of ['', full.subarray(0, 17), full]) {
    assert.equal(scan(fsWithD2({ [reservationName(ID)]: content })).reason, 'reservation-exists');
  }
});

test('startup: own journal in every state => journal-exists:<state>; unparseable => journal-exists:unreadable', () => {
  const histories = {
    AUTH_BOUND: ['AUTH_BOUND'],
    PREFLIGHT_FAILED: ['AUTH_BOUND', 'PREFLIGHT_FAILED'],
    ATTEMPT_CONSUMED: ['AUTH_BOUND', 'ATTEMPT_CONSUMED'],
    CLOSEOUT_STARTED: ['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED'],
    FAILED: ['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'FAILED'],
  };
  for (const [state, h] of Object.entries(histories)) {
    assert.equal(scan(fsWithD2({ [journalName(ID)]: journalBytes(h) })).reason, `journal-exists:${state}`);
  }
  assert.equal(scan(fsWithD2({ [journalName(ID)]: '{"trunc' })).reason, 'journal-exists:unreadable');
});

test('startup: orphan <id>.journal.json.tmp-* alone => orphan-temp', () => {
  assert.equal(scan(fsWithD2({ [`${journalTempPrefix(ID)}abc`]: '' })).reason, 'orphan-temp');
});

test('startup: other IDs -- unparseable reservation/journal => unreadable-reservation; same record sha => refused; distinct valid => ok', () => {
  const other = bindingFor({ id: 'g2-live-0000', sha: 'd'.repeat(64) });
  assert.equal(scan(fsWithD2({ 'g2-live-0000.reservation.json': '' })).reason, 'unreadable-reservation');
  assert.equal(scan(fsWithD2({ 'g2-live-0000.reservation.json': '{"a":1}' })).reason, 'unreadable-reservation');
  assert.equal(scan(fsWithD2({ 'g2-live-0000.journal.json': 'garbage' })).reason, 'unreadable-reservation');
  const sameSha = bindingFor({ id: 'g2-live-0000', sha: RECORD_SHA });
  assert.equal(scan(fsWithD2({ 'g2-live-0000.reservation.json': serializeJson(sameSha) })).reason, 'reservation-exists');
  assert.equal(scan(fsWithD2({ 'g2-live-0000.journal.json': journalBytes(['AUTH_BOUND', 'ATTEMPT_CONSUMED'], { binding: sameSha }) })).reason, 'journal-exists:ATTEMPT_CONSUMED');
  assert.equal(scan(fsWithD2({
    'g2-live-0000.reservation.json': serializeJson(other),
    'g2-live-0000.journal.json': journalBytes(['AUTH_BOUND', 'PREFLIGHT_FAILED'], { binding: other }),
    'g2-live-0000.journal.json.tmp-zzz': 'ignored for another id',
  })).ok, true);
});

test('startup (conservative extension): any other own-ID artifact, or a non-real attempts dir => refused', () => {
  assert.equal(scan(fsWithD2({ [commitName(ID)]: '{}' })).reason, 'own-artifact-exists');
  const f = createRecordingFakeFs({ seedDirs: [CHAIN.D1] });
  f.symlinkForTest('/elsewhere', CHAIN.D2);
  assert.equal(scan(f).reason, 'attempts-dir-not-real-directory');
});

test('startup: a refusal writes nothing', () => {
  const fs = fsWithD2({ [reservationName(ID)]: '' });
  scan(fs);
  assert.deepEqual(fs.ops.filter((o) => !['lstat', 'readdir', 'readFile'].includes(o.op)), []);
});

// ============================================================================================
// classifyJournal (reader classes, precedence)
// ============================================================================================

test('classifyJournal: every class, with precedence (unreadable journal beats reservation-only)', () => {
  const b = bindingFor();
  const res = { bytes: serializeJson(b) };
  const J = (states, binding = b) => ({ bytes: journalBytes(states, { binding }) });
  const cases = [
    [{}, JOURNAL_CLASS.NOT_STARTED, { consumed: false, recordSpent: false }],
    [{ reservation: { bytes: Buffer.alloc(0) } }, JOURNAL_CLASS.CRASHED_RESERVATION_ONLY, { consumed: false, recordSpent: true }],
    [{ reservation: { bytes: res.bytes.subarray(0, 20) } }, JOURNAL_CLASS.CRASHED_RESERVATION_ONLY, {}],
    [{ reservation: res }, JOURNAL_CLASS.CRASHED_RESERVATION_ONLY, {}],
    [{ reservation: res, journal: { bytes: Buffer.from('{"x"') } }, JOURNAL_CLASS.CRASHED_UNREADABLE_JOURNAL, { consumed: 'unknown' }],
    [{ journal: { bytes: Buffer.alloc(0) } }, JOURNAL_CLASS.CRASHED_UNREADABLE_JOURNAL, {}],
    [{ reservation: res, journal: { bytes: null, nonRegular: true } }, JOURNAL_CLASS.CRASHED_UNREADABLE_JOURNAL, {}],
    [{ journal: J(['AUTH_BOUND']) }, JOURNAL_CLASS.CRASHED_JOURNAL_WITHOUT_RESERVATION, { consumed: 'unknown' }],
    [{ reservation: res, journal: J(['AUTH_BOUND']) }, JOURNAL_CLASS.CRASHED_AUTH_BOUND, { consumed: false, alias: 'CRASHED(PREFLIGHT_FAILED-unterminated)' }],
    [{ reservation: res, journal: J(['AUTH_BOUND', 'PREFLIGHT_FAILED']) }, JOURNAL_CLASS.PREFLIGHT_FAILED, { consumed: false, recordSpent: true }],
    [{ reservation: res, journal: J(['AUTH_BOUND', 'ATTEMPT_CONSUMED']) }, JOURNAL_CLASS.CRASHED_ATTEMPT_CONSUMED, { consumed: true }],
    [{ reservation: res, journal: J(['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED']) }, JOURNAL_CLASS.CRASHED_CLOSEOUT_STARTED, { consumed: true }],
    [{ reservation: res, journal: J(['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'FAILED']) }, JOURNAL_CLASS.FAILED, { consumed: true }],
    [{ reservation: res, journal: J(['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED', 'FAILED']) }, JOURNAL_CLASS.FAILED, {}],
    [{ reservation: { bytes: Buffer.from('') }, journal: J(['AUTH_BOUND']) }, JOURNAL_CLASS.INVALID, { reason: 'reservation-unreadable-beside-journal' }],
    [{ reservation: { bytes: serializeJson(bindingFor()) }, journal: J(['AUTH_BOUND']) }, JOURNAL_CLASS.INVALID, { reason: 'reservation-journal-binding-mismatch' }],
  ];
  for (const [input, cls, extra] of cases) {
    const r = classifyJournal(input);
    assert.equal(r.class, cls, JSON.stringify({ input: Object.keys(input), r }));
    assert.equal(r.derivesFail, true);
    for (const [k, v] of Object.entries(extra)) assert.deepEqual(r[k], v, `${cls}.${k}`);
  }
  // an illegal history in a parseable journal is INVALID (the §8 W-0 reader-invalid family)
  const illegal = { ...b, transitions: [T('AUTH_BOUND', 1), T('PREFLIGHT_FAILED', 2), T('ATTEMPT_CONSUMED', 3)] };
  assert.equal(classifyJournal({ reservation: res, journal: { bytes: serializeJson(illegal) } }).class, JOURNAL_CLASS.INVALID);
  const completed = { ...b, transitions: [T('AUTH_BOUND', 1), T('COMPLETED', 2)] };
  assert.match(classifyJournal({ reservation: res, journal: { bytes: serializeJson(completed) } }).reason, /unknown-transition:COMPLETED/);
  // CLOSEOUT_STARTED + K present: deferred to the §8 reader (Task 2), never a FAIL-free class here
  const withK = classifyJournal({ reservation: res, journal: J(['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED']), commitExists: true });
  assert.equal(withK.class, JOURNAL_CLASS.CLOSEOUT_STARTED_WITH_COMMIT);
  assert.equal(withK.derivesFail, null);
});

// ============================================================================================
// Crash matrix (§4.1 table), row by row, derived from the fake fs's process/OS-crash views
// ============================================================================================

/** Op index of each W2 milestone in an uninterrupted run on the given starting tree. */
function milestones(existing) {
  const fs = newFakeFs({ existing });
  runW2(fs);
  const ops = fs.ops;
  const iRes = idxOf(ops, is('open', RES_PATH, 'wx'));
  const iResFsync = idxOf(ops, is('fsync', RES_PATH), iRes);
  const iResDirSync = idxOf(ops, is('fsync', CHAIN.D2), iRes);
  const iTmp = idxOf(ops, (o) => o.op === 'open' && o.flags === 'wx' && o.path.includes('.tmp-'));
  const iRen = idxOf(ops, (o) => o.op === 'rename');
  const iJDirSync = idxOf(ops, is('fsync', CHAIN.D2), iRen);
  return { total: ops.length, ops, iRes, iResFsync, iResDirSync, iTmp, iRen, iJDirSync };
}

function classify(view) { return classifyJournal(inspectAttemptFiles({ fs: view, D2: CHAIN.D2, authorizationId: ID })); }

for (const existing of [false, true]) {
  test(`crash matrix (${existing ? 'D1/D2 exist' : 'first run, D1/D2 absent'}): every op x {crash-before, crash-after, partial write} x {process, OS} crash`, () => {
    const m = milestones(existing);
    const rowsSeen = new Set();
    for (let k = 0; k < m.total; k += 1) {
      const modes = ['crash', 'crash-after', ...(m.ops[k].op === 'write' ? ['partial'] : [])];
      for (const mode of modes) {
        const fs = newFakeFs({ existing, fault: (_rec, i) => (i === k ? mode : null) });
        assert.throws(() => runW2(fs), SimulatedCrash, `k=${k} ${mode}`);
        const applied = (i) => i < k || (i === k && mode !== 'crash');
        // ---- process crash: everything the kernel accepted is visible ----
        const pv = fs.processCrashView();
        const resVisible = applied(m.iRes);
        const journalVisible = applied(m.iRen);
        const pScan = scan(pv);
        const pCls = classify(pv);
        if (!resVisible) {
          // rows "during W0/W1" / "during W2a": no reservation => reusable, reader class none
          assert.equal(pScan.ok, true, `k=${k} ${mode} process: reusable`);
          assert.equal(pCls.class, JOURNAL_CLASS.NOT_STARTED);
          rowsSeen.add('W2a-process');
        } else if (!journalVisible) {
          // rows "during W2b after wx ... process crash" / "reservation durable; final journal absent"
          assert.equal(pScan.ok, false, `k=${k} ${mode} process: spent`);
          assert.equal(pScan.reason, 'reservation-exists');
          assert.equal(pCls.class, JOURNAL_CLASS.CRASHED_RESERVATION_ONLY);
          rowsSeen.add('reservation-only-process');
        } else {
          // row "after AUTH_BOUND durable, before ATTEMPT_CONSUMED": spent, CRASHED(AUTH_BOUND)
          assert.equal(pScan.ok, false);
          assert.equal(pCls.class, JOURNAL_CLASS.CRASHED_AUTH_BOUND);
          rowsSeen.add('auth-bound-process');
        }
        // ---- OS crash: only fsync-covered state survives ----
        const ov = fs.osCrashView();
        const resDurable = applied(m.iResDirSync);
        const journalDurable = applied(m.iJDirSync);
        const oScan = scan(ov);
        const oCls = classify(ov);
        if (!resDurable) {
          // "same point, OS crash": reusable only if nothing survived -- and nothing did
          assert.equal(oScan.ok, true, `k=${k} ${mode} OS: reusable`);
          assert.equal(oCls.class, JOURNAL_CLASS.NOT_STARTED);
          assert.equal(existsInView(ov, RES_PATH), false);
          rowsSeen.add('os-nothing-survived');
        } else if (!journalDurable) {
          assert.equal(oScan.reason, 'reservation-exists');
          assert.equal(oCls.class, JOURNAL_CLASS.CRASHED_RESERVATION_ONLY);
          // a durable reservation is always complete (fsync(fd) precedes fsync(D2Fd))
          assert.equal(parseReservationBytes(ov.readFile(RES_PATH)).ok, true);
          rowsSeen.add('os-reservation-only');
        } else {
          assert.equal(oCls.class, JOURNAL_CLASS.CRASHED_AUTH_BOUND);
          rowsSeen.add('os-auth-bound');
        }
        // Directory-chain durability invariant: whenever the reservation is durable, the whole
        // chain D0 -> D1 -> D2 leading to it is durable too.
        if (resDurable) assert.equal(existsInView(ov, CHAIN.D2), true);
      }
    }
    assert.deepEqual([...rowsSeen].sort(), ['W2a-process', 'auth-bound-process', 'os-auth-bound', 'os-nothing-survived', 'os-reservation-only', 'reservation-only-process']);
  });
}

function existsInView(view, p) { try { view.lstat(p); return true; } catch { return false; } }

test('crash matrix: an uninterrupted W2 leaves reservation + AUTH_BOUND durable before returning (durable-before-effect)', () => {
  for (const existing of [false, true]) {
    const fs = newFakeFs({ existing });
    runW2(fs);
    const ov = fs.osCrashView();
    const c = classify(ov);
    assert.equal(c.class, JOURNAL_CLASS.CRASHED_AUTH_BOUND, 'an OS crash right after W2 still shows the spent record');
    assert.equal(scan(ov).ok, false);
  }
});

test('crash matrix: a durability ERROR at every W2 op => G2DurabilityError, no further non-close op, reusable iff no reservation visible', () => {
  for (const existing of [false, true]) {
    const m = milestones(existing);
    for (let k = 0; k < m.total; k += 1) {
      for (const mode of ['error', 'error-after']) {
        const fs = newFakeFs({ existing, fault: (_rec, i) => (i === k ? mode : null) });
        let err;
        try { runW2(fs); } catch (e) { err = e; }
        assert.ok(err instanceof G2DurabilityError, `k=${k} ${mode} (${opName(m.ops[k])}): ${err}`);
        assert.equal(err.exitCode, 1);
        const after = fs.ops.slice(k + 1).filter((o) => o.op !== 'close');
        assert.deepEqual(after.map(opName), [], `k=${k} ${mode}: no retry, nothing after the failure except fd closes`);
        const view = fs.processCrashView();
        const resVisible = existsInView(view, RES_PATH);
        assert.equal(scan(view).ok, !resVisible, `k=${k} ${mode}`);
        if (resVisible && !existsInView(view, JOURNAL_PATH)) assert.equal(classify(view).class, JOURNAL_CLASS.CRASHED_RESERVATION_ONLY);
      }
    }
  }
});

test('empty and truncated reservations => startup refusal and CRASHED(reservation-only)', () => {
  const m = milestones(false);
  // empty: crash right after open(reservation,'wx')
  const empty = newFakeFs({ fault: (_r, i) => (i === m.iRes ? 'crash-after' : null) });
  assert.throws(() => runW2(empty), SimulatedCrash);
  const ev = empty.processCrashView();
  assert.equal(ev.readFile(RES_PATH).length, 0);
  assert.equal(scan(ev).reason, 'reservation-exists');
  assert.equal(classify(ev).class, JOURNAL_CLASS.CRASHED_RESERVATION_ONLY);
  // truncated: partial write then crash
  const trunc = newFakeFs({ fault: (r, i) => (i === m.iRes + 1 ? 'partial' : null) });
  assert.throws(() => runW2(trunc), SimulatedCrash);
  const tv = trunc.processCrashView();
  assert.ok(tv.readFile(RES_PATH).length > 0);
  assert.equal(parseReservationBytes(tv.readFile(RES_PATH)).ok, false);
  assert.equal(scan(tv).reason, 'reservation-exists');
  assert.equal(classify(tv).class, JOURNAL_CLASS.CRASHED_RESERVATION_ONLY);
  // a crashed empty reservation of an OLDER id refuses every later id (never skipped)
  assert.equal(scan(tv, 'g2-live-0002', 'e'.repeat(64)).reason, 'unreadable-reservation');
});

test('orphan journal temp (crash between temp create and rename) => refusal; reader ignores the temp', () => {
  const m = milestones(false);
  const fs = newFakeFs({ fault: (_r, i) => (i === m.iTmp + 1 ? 'crash' : null) });
  assert.throws(() => runW2(fs), SimulatedCrash);
  const v = fs.processCrashView();
  const names = v.readdir(CHAIN.D2);
  assert.ok(names.some((n) => n.startsWith(journalTempPrefix(ID))));
  assert.equal(scan(v).ok, false);
  assert.equal(classify(v).class, JOURNAL_CLASS.CRASHED_RESERVATION_ONLY);
  assert.ok(inspectAttemptFiles({ fs: v, D2: CHAIN.D2, authorizationId: ID }).ignored.length === 1);
  // the orphan alone (e.g. reservation removed by hand) still refuses
  const only = fsWithD2({ [names.find((n) => n.includes('.tmp-'))]: v.readFile(path.join(CHAIN.D2, names.find((n) => n.includes('.tmp-')))) });
  assert.equal(scan(only).reason, 'orphan-temp');
});

// ============================================================================================
// Journal handle: W3 ATTEMPT_CONSUMED and later transitions; no reuse
// ============================================================================================

test('handle: ATTEMPT_CONSUMED -> CLOSEOUT_STARTED appended durably; each append is one temp+rename+fsync(D2Fd)+read-back', () => {
  const fs = newFakeFs();
  const h = runW2(fs);
  const before = fs.ops.length;
  markAttemptConsumed(h);
  const seq = fs.ops.slice(before).map((o) => o.op);
  assert.deepEqual(seq, ['open', 'write', 'fsync', 'close', 'rename', 'fsync', 'readFile']);
  h.append('CLOSEOUT_STARTED', { primaryOverall: 'FAIL', primaryRow: 3 });
  const j = parseJournalBytes(fs.readFile(JOURNAL_PATH));
  assert.equal(j.ok, true);
  assert.deepEqual(j.value.transitions.map((t) => t.state), ['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED']);
  assert.equal(sha256Hex(fs.readFile(JOURNAL_PATH)), sha256Hex(h.current().bytes));
  // the reservation was never modified
  assert.deepEqual(parseReservationBytes(fs.readFile(RES_PATH)).value, Object.fromEntries(BINDING_KEYS.map((k) => [k, j.value[k]])));
  assert.equal(classify(fs.osCrashView()).class, JOURNAL_CLASS.CRASHED_CLOSEOUT_STARTED);
});

test('handle: illegal append throws before any I/O; best-effort append never throws', () => {
  const fs = newFakeFs();
  const h = runW2(fs);
  const n = fs.ops.length;
  assert.throws(() => h.append('CLOSEOUT_STARTED', { primaryOverall: 'PASS', primaryRow: 8 }), /illegal-transition/);
  assert.throws(() => h.append('FAILED', { causes: ['x'] }), /illegal-transition/);
  assert.equal(fs.ops.length, n);
  h.append('PREFLIGHT_FAILED', { category: 'preflight' });
  const r = h.appendBestEffort('ATTEMPT_CONSUMED');
  assert.equal(r.ok, false);
  assert.equal(classify(fs.processCrashView()).class, JOURNAL_CLASS.PREFLIGHT_FAILED);
});

test('W3 failure (any step of the ATTEMPT_CONSUMED write) => throws, in-memory state not advanced, durable journal stays AUTH_BOUND', () => {
  for (const failAt of ['open', 'write', 'fsync', 'close', 'rename']) {
    let armed = false;
    const fs = newFakeFs({ fault: (rec) => (armed && rec.op === failAt ? 'error' : null) });
    const h = runW2(fs);
    armed = true;
    assert.throws(() => markAttemptConsumed(h), G2DurabilityError, failAt);
    armed = false;
    assert.equal(h.current().journal.transitions.at(-1).state, 'AUTH_BOUND');
    const c = classify(fs.processCrashView());
    assert.equal(c.class, JOURNAL_CLASS.CRASHED_AUTH_BOUND, failAt);
    assert.equal(c.consumed, false);
  }
});

test('journal read-back mismatch => G2DurabilityError (write-success verification), at AUTH_BOUND and at W3', () => {
  // AUTH_BOUND write: the final journal reads back different bytes
  const fresh = newFakeFs();
  establishAttemptsDirectory({ fs: fresh, chain: CHAIN });
  const lyingFresh = { ...fresh, readFile: (p) => (p === JOURNAL_PATH ? Buffer.from('{}') : fresh.readFile(p)) };
  assert.throws(() => reserveAttempt({ fs: lyingFresh, chain: CHAIN, binding: bindingFor(), clock: fakeClock(), uuid: fakeUuid }), (e) => e instanceof G2DurabilityError && /verify/.test(e.step));
  // W3 write: a lie only after AUTH_BOUND verified
  let lie = false;
  const base = newFakeFs();
  const liar = { ...base, readFile: (p) => (lie && p === JOURNAL_PATH ? Buffer.from('{}') : base.readFile(p)) };
  const h = runW2(liar);
  lie = true;
  assert.throws(() => markAttemptConsumed(h), (e) => e instanceof G2DurabilityError && /verify/.test(e.step));
  assert.equal(h.current().journal.transitions.at(-1).state, 'AUTH_BOUND', 'in-memory state not advanced on an unverified write');
});

test('no reuse of a consumed attempt: startup refuses, a second wx reservation refuses, the handle cannot go back', () => {
  const fs = newFakeFs();
  const binding = bindingFor();
  const h = runW2(fs, { binding });
  markAttemptConsumed(h);
  assert.equal(scan(fs).reason, 'reservation-exists');
  assert.throws(() => reserveAttempt({ fs, chain: CHAIN, binding, clock: fakeClock(), uuid: fakeUuid }), (e) => e instanceof G2RefusalError && e.reason === 'reservation-exists');
  assert.throws(() => h.append('AUTH_BOUND'), /illegal-transition/);
  assert.throws(() => h.append('ATTEMPT_CONSUMED'), /illegal-transition/);
  assert.throws(() => h.append('PREFLIGHT_FAILED'), /illegal-transition/);
});

test('two in-process racers that both passed W1: exactly one wins the wx reservation', () => {
  const fs = newFakeFs();
  const b1 = bindingFor();
  const b2 = { ...b1, attemptId: fakeUuid() };
  assert.equal(scan(fs).ok, true);
  assert.equal(scan(fs).ok, true);
  establishAttemptsDirectory({ fs, chain: CHAIN });
  establishAttemptsDirectory({ fs, chain: CHAIN });
  const win = reserveAttempt({ fs, chain: CHAIN, binding: b1, clock: fakeClock(), uuid: fakeUuid });
  const n = fs.ops.length;
  assert.throws(() => reserveAttempt({ fs, chain: CHAIN, binding: b2, clock: fakeClock(), uuid: fakeUuid }), (e) => e.reason === 'reservation-exists');
  // the loser wrote nothing after its failed wx (only its D2Fd close)
  assert.deepEqual(fs.ops.slice(n).map((o) => o.op), ['open', 'open', 'close']);
  assert.equal(parseJournalBytes(fs.readFile(JOURNAL_PATH)).value.attemptId, win.attemptId);
});

// ============================================================================================
// Real Node filesystem integration (os.tmpdir sandbox; no Viewer, no network)
// ============================================================================================

function realRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'g2-journal-'));
  mkdirSync(path.join(root, 'test/acceptance'), { recursive: true });
  return root;
}

test('real fs: first run creates D1/D2, reservation + AUTH_BOUND journal; second run refused at scan and at wx', () => {
  const root = realRoot();
  try {
    const chain = resolveAttemptsChain(root);
    const fs = createNodeFsLayer();
    const binding = bindingFor();
    assert.equal(scanAttemptsDirectoryForStartup({ fs, chain, authorizationId: ID, recordSha256: RECORD_SHA }).ok, true);
    const r = establishAttemptsDirectory({ fs, chain });
    assert.deepEqual(r.created, { D1: true, D2: true });
    const h = reserveAttempt({ fs, chain, binding });
    assert.deepEqual(readdirSync(chain.D2).sort(), [journalName(ID), reservationName(ID)]);
    const res = parseReservationBytes(readFileSync(path.join(chain.D2, reservationName(ID))));
    assert.deepEqual(res.value, binding);
    const j = parseJournalBytes(readFileSync(path.join(chain.D2, journalName(ID))));
    assert.equal(j.lastState, 'AUTH_BOUND');
    assert.match(j.value.transitions[0].at, /Z$/);
    markAttemptConsumed(h);
    h.close();
    assert.equal(scanAttemptsDirectoryForStartup({ fs, chain, authorizationId: ID, recordSha256: RECORD_SHA }).reason, 'reservation-exists');
    // same record sha under a different ID string (impossible in practice) is refused too
    assert.match(scanAttemptsDirectoryForStartup({ fs, chain, authorizationId: 'g2-live-9999', recordSha256: RECORD_SHA }).reason, /^(reservation-exists|journal-exists:ATTEMPT_CONSUMED)$/);
    establishAttemptsDirectory({ fs, chain });
    assert.throws(() => reserveAttempt({ fs, chain, binding: { ...binding, attemptId: fakeUuid() } }), (e) => e instanceof G2RefusalError && e.reason === 'reservation-exists');
    const cls = classifyJournal(inspectAttemptFiles({ fs, D2: chain.D2, authorizationId: ID }));
    assert.equal(cls.class, JOURNAL_CLASS.CRASHED_ATTEMPT_CONSUMED);
    assert.equal(readdirSync(chain.D2).some((n) => n.includes('.tmp-')), false, 'no temp left after successful writes');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('real fs: symlinked D2 (or D1) is refused by W2a and by the startup scan', () => {
  const root = realRoot();
  try {
    const chain = resolveAttemptsChain(root);
    const fs = createNodeFsLayer();
    mkdirSync(chain.D1);
    mkdirSync(path.join(root, 'elsewhere'));
    symlinkSync(path.join(root, 'elsewhere'), chain.D2);
    assert.throws(() => establishAttemptsDirectory({ fs, chain }), G2DurabilityError);
    assert.equal(scanAttemptsDirectoryForStartup({ fs, chain, authorizationId: ID, recordSha256: RECORD_SHA }).reason, 'attempts-dir-not-real-directory');
    assert.equal(existsSync(path.join(root, 'elsewhere', reservationName(ID))), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('real fs: an orphan temp and an empty reservation on disk both refuse', () => {
  const root = realRoot();
  try {
    const chain = resolveAttemptsChain(root);
    const fs = createNodeFsLayer();
    mkdirSync(chain.D2, { recursive: true });
    writeFileSync(path.join(chain.D2, `${journalTempPrefix(ID)}x`), '');
    assert.equal(scanAttemptsDirectoryForStartup({ fs, chain, authorizationId: ID, recordSha256: RECORD_SHA }).reason, 'orphan-temp');
    rmSync(path.join(chain.D2, `${journalTempPrefix(ID)}x`));
    writeFileSync(path.join(chain.D2, reservationName(ID)), '');
    assert.equal(scanAttemptsDirectoryForStartup({ fs, chain, authorizationId: ID, recordSha256: RECORD_SHA }).reason, 'reservation-exists');
    assert.equal(classifyJournal(inspectAttemptFiles({ fs, D2: chain.D2, authorizationId: ID })).class, JOURNAL_CLASS.CRASHED_RESERVATION_ONLY);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('real fs concurrency: N processes race W2a+W2b on one Authorization-ID -- exactly one wins', async () => {
  const root = realRoot();
  try {
    const N = 8;
    const go = path.join(root, 'go');
    const bindingJson = JSON.stringify(bindingFor());
    const child = `
      import { existsSync } from 'node:fs';
      import { randomUUID } from 'node:crypto';
      const h = await import(process.env.HARNESS_URL);
      const sleep = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(process.env.GO)) Atomics.wait(sleep, 0, 0, 2);
      const fs = h.createNodeFsLayer();
      const chain = h.resolveAttemptsChain(process.env.ROOT);
      const binding = { ...JSON.parse(process.env.BINDING), attemptId: randomUUID() };
      try {
        h.establishAttemptsDirectory({ fs, chain });
        const a = h.reserveAttempt({ fs, chain, binding });
        console.log('WIN ' + a.attemptId);
      } catch (e) {
        console.log('LOSE ' + (e.reason || e.step || e.message));
      }
    `;
    const procs = Array.from({ length: N }, () => new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', child], {
        env: { ...process.env, HARNESS_URL, ROOT: root, GO: go, BINDING: bindingJson, NODE_TEST_CONTEXT: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let errOut = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { errOut += d; });
      p.on('error', reject);
      p.on('close', (code) => resolve({ code, out: out.trim(), err: errOut }));
    }));
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(go, '');
    const results = await Promise.all(procs);
    for (const r of results) assert.equal(r.code, 0, r.err);
    const wins = results.filter((r) => r.out.startsWith('WIN '));
    const losses = results.filter((r) => r.out.startsWith('LOSE '));
    assert.equal(wins.length, 1, JSON.stringify(results));
    assert.equal(losses.length, N - 1);
    for (const l of losses) assert.equal(l.out, 'LOSE reservation-exists');
    const chain = resolveAttemptsChain(root);
    const j = parseJournalBytes(readFileSync(path.join(chain.D2, journalName(ID))));
    assert.equal(`WIN ${j.value.attemptId}`, wins[0].out);
    assert.equal(parseReservationBytes(readFileSync(path.join(chain.D2, reservationName(ID)))).value.attemptId, j.value.attemptId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
