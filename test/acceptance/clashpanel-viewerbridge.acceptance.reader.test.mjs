// test/acceptance/clashpanel-viewerbridge.acceptance.reader.test.mjs
//
// Offline tests for the G2 harness authoritative reader `deriveVerdictFromArtifacts` (procedure §8
// W-0..W-6 and the §9.1 terminal-commit scenario matrix rows 1-11): every witness row on its own,
// reader precedence (worst outcome, W-0 and W-1 never outranked), the reader namespace (candidates,
// temps and `.invalid-` files ignored), the Task 1 label reconciliation (unparseable journal =>
// FAIL(reader-invalid), with the §4.1 class retained), and "the only PASS-derivable file set is the
// complete one". File maps are produced by real closeout runs on the recording fake fs and then
// edited; the reader itself is pure.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  resolveAttemptsChain,
  createRecordingFakeFs,
  createOfflineAttemptFixture,
  createOfflineRunStateFixture,
  closeoutProtocol,
  brandSyncLinkForTest,
  deriveVerdictFromArtifacts,
  readArtifactFileMap,
  classifyJournal,
  JOURNAL_CLASS,
  R1_NAME,
  R2_NAME,
  R3_NAME,
  commitName,
  journalName,
  reservationName,
  closeoutFailureName,
  commitCandidateName,
  serializeJson,
  sha256Hex,
} from './clashpanel-viewerbridge.acceptance.mjs';

const CHAIN = resolveAttemptsChain('/repo');
const ID = 'reader-test-0001';
const N = { res: reservationName(ID), jrn: journalName(ID), k: commitName(ID), f: closeoutFailureName(ID) };

async function closeoutRun({ mutateState = () => {}, fault = null, id = ID } = {}) {
  let armed = null;
  const fs = createRecordingFakeFs({ seedDirs: ['/repo/test/acceptance'], fault: (r, i) => (armed ? armed(r, i) : null) });
  const { handle, binding } = createOfflineAttemptFixture({ fs, chain: CHAIN, authorizationId: id });
  const state = createOfflineRunStateFixture({ binding });
  mutateState(state);
  armed = fault;
  let result = null;
  try {
    result = await closeoutProtocol({ state, handle, fs, chain: CHAIN, commitFs: { linkSync: brandSyncLinkForTest((a, b) => fs.link(a, b)) }, allowTestLinkPrimitive: true });
  } catch (err) { if (!err.simulatedCrash) throw err; }
  return { fs, result, map: readArtifactFileMap({ fs: fs.processCrashView(), chain: CHAIN }) };
}

const derive = (map, id = ID) => deriveVerdictFromArtifacts({ ...map, authorizationId: id });
const clone = (map) => ({ attempts: { ...map.attempts }, results: { ...map.results } });
const parse = (buf) => JSON.parse(buf.toString('utf8'));
const bytes = (obj) => serializeJson(obj);

let COMPLETE = null;
async function completeMap() {
  if (!COMPLETE) COMPLETE = (await closeoutRun()).map;
  return clone(COMPLETE);
}

/** Rewrites K so its hashes match the (edited) R1/R2/R3/journal: isolates the check under test. */
function recommit(map, kEdit = () => {}) {
  const k = parse(map.attempts[N.k]);
  k.resultSha256 = sha256Hex(map.results[R1_NAME]);
  k.summarySha256 = sha256Hex(map.results[R2_NAME]);
  k.manifestSha256 = sha256Hex(map.results[R3_NAME]);
  k.journalSha256 = sha256Hex(map.attempts[N.jrn]);
  kEdit(k);
  map.attempts[N.k] = bytes(k);
  return map;
}

/** Rewrites R3 so its recorded R1/R2 hashes match (edited) R1/R2. */
function remanifest(map, edit = () => {}) {
  const m = parse(map.results[R3_NAME]);
  m.artifacts[0].sha256 = sha256Hex(map.results[R1_NAME]);
  m.artifacts[1].sha256 = sha256Hex(map.results[R2_NAME]);
  edit(m);
  map.results[R3_NAME] = bytes(m);
  return map;
}

function editJson(map, where, name, edit) {
  const o = parse(map[where][name]);
  edit(o);
  map[where][name] = bytes(o);
  return map;
}

const expectFail = (v, witness, label, msg) => {
  assert.equal(v.verdict, 'FAIL', msg);
  if (witness) assert.equal(v.witness, witness, `${msg}: ${v.label} ${JSON.stringify(v.witnesses)}`);
  if (label) assert.equal(v.label, label, msg);
};

// ------------------------------------------------------------------------------------------
// W-6 and the complete file set
// ------------------------------------------------------------------------------------------

test('W-6: a complete, valid, cross-consistent file set derives K.finalOverall (and only that path does)', async () => {
  const v = derive(await completeMap());
  assert.deepEqual([v.verdict, v.label, v.witness], ['PASS', 'PASS', 'W-6']);
  assert.ok(Object.isFrozen(v));
  for (const [mut, verdict] of [[(s) => { s.checks.C9.verdict = 'NOT_EVIDENCED'; }, 'PARTIAL'], [(s) => { s.sessionTainted = true; }, 'BLOCKED'], [(s) => { s.checks.C2.verdict = 'FAIL'; }, 'FAIL']]) {
    const run = await closeoutRun({ mutateState: mut });
    assert.deepEqual([derive(run.map).verdict, derive(run.map).witness], [verdict, 'W-6']);
    assert.equal(run.result.finalOverall, verdict, 'harness and reader agree');
  }
});

test('only the complete file set can derive PASS: removing any required file, or changing any byte of it, derives FAIL', async () => {
  const base = await completeMap();
  for (const [where, name] of [['attempts', N.res], ['attempts', N.jrn], ['attempts', N.k], ['results', R1_NAME], ['results', R2_NAME], ['results', R3_NAME]]) {
    const m = clone(base);
    delete m[where][name];
    expectFail(derive(m), null, null, `without ${name}`);
    // Content bytes only: the reservation is not hashed by anything and the reader compares its
    // binding semantically, so a whitespace-only change to it is (correctly) not an anomaly.
    const content = [...base[where][name].keys()].filter((i) => ![0x20, 0x0a, 0x0d, 0x09].includes(base[where][name][i]));
    const len = content.length;
    for (const pos of [0, 1, Math.floor(len / 3), Math.floor(len / 2), len - 2, len - 1].map((p) => content[p])) {
      const b = Buffer.from(base[where][name]);
      b[pos] = b[pos] === 0x61 ? 0x62 : 0x61;
      const m2 = clone(base);
      m2[where][name] = b;
      expectFail(derive(m2), null, null, `${name} byte ${pos} changed`);
    }
  }
});

// ------------------------------------------------------------------------------------------
// Reader namespace
// ------------------------------------------------------------------------------------------

test('namespace: candidates, temps, .invalid- files and other IDs are ignored (never authoritative, never an anomaly)', async () => {
  const m = await completeMap();
  m.attempts[commitCandidateName(ID, randomUUID())] = m.attempts[N.k];
  m.attempts[commitCandidateName(ID, randomUUID())] = Buffer.from('garbage');
  m.attempts[`${N.jrn}.tmp-${randomUUID()}`] = Buffer.from('{');
  m.attempts[`${N.k}.invalid-${randomUUID()}`] = Buffer.from('x');
  m.results[`${R1_NAME}.invalid-${randomUUID()}`] = Buffer.from('x');
  m.results[`${R1_NAME}.tmp-${randomUUID()}`] = Buffer.from('x');
  m.attempts['other-id-0001.closeout-failure.json'] = Buffer.from('');
  m.attempts['other-id-0001.journal.json'] = Buffer.from('not json');
  const v = derive(m);
  assert.deepEqual([v.verdict, v.witness], ['PASS', 'W-6']);
  assert.equal(v.detail.ignored.length, 4);
  // a complete candidate alone never substitutes for K (terminal row 2)
  const m2 = await completeMap();
  m2.attempts[commitCandidateName(ID, randomUUID())] = m2.attempts[N.k];
  delete m2.attempts[N.k];
  expectFail(derive(m2), 'W-3', 'FAIL(commit-missing)', 'candidate only');
});

// ------------------------------------------------------------------------------------------
// W-0 totality rule
// ------------------------------------------------------------------------------------------

test('W-0: unparseable journal => FAIL(reader-invalid) (Task 1 label reconciliation: classifyJournal says CRASHED(unreadable-journal))', async () => {
  const m = await completeMap();
  m.attempts[N.jrn] = Buffer.from('{"journalVersion":1,');
  const cls = classifyJournal({ reservation: { bytes: m.attempts[N.res] }, journal: { bytes: m.attempts[N.jrn] }, commitExists: true });
  assert.equal(cls.class, JOURNAL_CLASS.CRASHED_UNREADABLE_JOURNAL);
  const v = derive(m);
  expectFail(v, 'W-0', 'FAIL(reader-invalid)', 'unparseable journal');
  assert.equal(v.detail.journalClass, 'CRASHED(unreadable-journal)');
  assert.ok(v.witnesses.some((w) => w.reason === 'journal-unparseable'));
});

test('W-0: unknown transition, illegal paths, missing fields, non-regular files, K without journal, unparseable K / R1 / R3', async () => {
  const cases = [
    ['COMPLETED transition', (m) => editJson(m, 'attempts', N.jrn, (j) => { j.transitions.push({ state: 'COMPLETED', at: j.transitions[2].at, monotonicMs: j.transitions[2].monotonicMs }); })],
    ['unknown transition name', (m) => editJson(m, 'attempts', N.jrn, (j) => { j.transitions[2].state = 'DONE'; })],
    ['PREFLIGHT_FAILED then ATTEMPT_CONSUMED', (m) => editJson(m, 'attempts', N.jrn, (j) => { j.transitions.splice(1, 0, { state: 'PREFLIGHT_FAILED', at: j.transitions[0].at, monotonicMs: j.transitions[0].monotonicMs }); })],
    ['second ATTEMPT_CONSUMED', (m) => editJson(m, 'attempts', N.jrn, (j) => { j.transitions.splice(2, 0, { ...j.transitions[1] }); })],
    ['journal missing a required field', (m) => editJson(m, 'attempts', N.jrn, (j) => { delete j.headSha; })],
    ['journal not a regular file', (m) => { m.attempts[N.jrn] = { nonRegular: true }; }],
    ['reservation not a regular file', (m) => { m.attempts[N.res] = { nonRegular: true }; }],
    ['K not a regular file', (m) => { m.attempts[N.k] = { nonRegular: true }; }],
    ['K without a journal', (m) => { delete m.attempts[N.jrn]; delete m.attempts[N.res]; }],
    ['K unparseable', (m) => { m.attempts[N.k] = Buffer.from('{"attemptId":'); }],
    ['K missing a field', (m) => editJson(m, 'attempts', N.k, (k) => { delete k.committedAt; })],
    ['K extra field', (m) => editJson(m, 'attempts', N.k, (k) => { k.closeoutComplete = true; })],
    ['K finalOverall out of enum', (m) => editJson(m, 'attempts', N.k, (k) => { k.finalOverall = 'OK'; k.primaryOverall = 'OK'; })],
    ['R1 unparseable (hashes recomputed)', (m) => { m.results[R1_NAME] = Buffer.from('{'); remanifest(m); recommit(m); }],
    ['R3 unparseable (hash recomputed)', (m) => { m.results[R3_NAME] = Buffer.from('['); recommit(m); }],
    ['reservation/journal binding differs', (m) => editJson(m, 'attempts', N.res, (r) => { r.headSha = 'f'.repeat(40); })],
  ];
  for (const [label, mut] of cases) {
    const m = await completeMap();
    mut(m);
    expectFail(derive(m), 'W-0', 'FAIL(reader-invalid)', label);
  }
  // garbage inputs never throw
  for (const bad of [{}, { attempts: null, results: null, authorizationId: ID }, { attempts: { [N.k]: 5 }, authorizationId: ID }, { authorizationId: '' }]) {
    assert.equal(deriveVerdictFromArtifacts(bad).verdict, 'FAIL');
  }
});

// ------------------------------------------------------------------------------------------
// W-1 .. W-5
// ------------------------------------------------------------------------------------------

test('W-1: F in any content state dominates every other observation, even a valid K', async () => {
  for (const f of [Buffer.from(''), Buffer.from('{"causes":["x"]}'), { nonRegular: true }]) {
    const m = await completeMap();
    m.attempts[N.f] = f;
    expectFail(derive(m), 'W-1', 'FAIL(closeout-failure-witness)', 'F beside valid K');
  }
});

test('W-2: a FAILED transition anywhere => FAIL with causes retained', async () => {
  const run = await closeoutRun({ fault: (rec) => (rec.op === 'link' ? 'error' : null) });
  const m = clone(run.map);
  delete m.attempts[N.f];
  const v = derive(m);
  expectFail(v, 'W-2', 'FAIL(failed-transition)', 'FAILED');
  assert.deepEqual(v.witnesses[0].causes, ['link-failed:EIO']);
});

test('W-3: last state CLOSEOUT_STARTED and no K => FAIL(commit-missing), whatever else exists', async () => {
  const m = await completeMap();
  delete m.attempts[N.k];
  expectFail(derive(m), 'W-3', 'FAIL(commit-missing)', 'no K');
  m.attempts[commitCandidateName(ID, randomUUID())] = (await completeMap()).attempts[N.k];
  m.attempts[`${N.jrn}.tmp-${randomUUID()}`] = Buffer.from('{}');
  expectFail(derive(m), 'W-3', 'FAIL(commit-missing)', 'complete candidate + orphan temp');
});

test('W-4: preflight / crashed classes and the empty file set never derive PASS', async () => {
  const run = await closeoutRun();
  const full = parse(run.map.attempts[N.jrn]);
  const withStates = (n) => { const j = { ...full, transitions: full.transitions.slice(0, n) }; return bytes(j); };
  const res = run.map.attempts[N.res];
  const cases = [
    ['AUTH_BOUND', { [N.res]: res, [N.jrn]: withStates(1) }, 'FAIL(crashed:AUTH_BOUND)'],
    ['ATTEMPT_CONSUMED', { [N.res]: res, [N.jrn]: withStates(2) }, 'FAIL(crashed:ATTEMPT_CONSUMED)'],
    ['PREFLIGHT_FAILED', { [N.res]: res, [N.jrn]: bytes({ ...full, transitions: [full.transitions[0], { state: 'PREFLIGHT_FAILED', at: full.transitions[1].at, monotonicMs: full.transitions[1].monotonicMs, detail: { category: 'preflight' } }] }) }, 'FAIL(crashed:PREFLIGHT_FAILED)'],
    ['reservation only (complete)', { [N.res]: res }, 'FAIL(crashed:reservation-only)'],
    ['reservation only (empty)', { [N.res]: Buffer.alloc(0) }, 'FAIL(crashed:reservation-only)'],
    ['reservation only (truncated)', { [N.res]: res.subarray(0, 10) }, 'FAIL(crashed:reservation-only)'],
    ['reservation + orphan journal temp', { [N.res]: res, [`${N.jrn}.tmp-${randomUUID()}`]: withStates(1) }, 'FAIL(crashed:reservation-only)'],
    ['journal without reservation', { [N.jrn]: withStates(2) }, 'FAIL(crashed:journal-without-reservation)'],
    ['NOT_STARTED (nothing)', {}, 'FAIL(no-run)'],
  ];
  for (const [label, attempts, expected] of cases) expectFail(derive({ attempts, results: {} }), 'W-4', expected, label);
  // K beside a non-CLOSEOUT_STARTED journal: still a crashed class, never W-6
  expectFail(derive({ attempts: { [N.res]: res, [N.jrn]: withStates(2), [N.k]: run.map.attempts[N.k] }, results: run.map.results }), 'W-4', 'FAIL(crashed:ATTEMPT_CONSUMED)', 'K + ATTEMPT_CONSUMED');
});

test('W-5: every K cross-validation failure derives FAIL(commit-invalid)', async () => {
  const cases = [
    ['R1 missing', (m) => { delete m.results[R1_NAME]; }],
    ['R2 missing', (m) => { delete m.results[R2_NAME]; }],
    ['R3 missing', (m) => { delete m.results[R3_NAME]; }],
    ['R1 not regular', (m) => { m.results[R1_NAME] = { nonRegular: true }; }],
    ['sha256(R1) != resultSha256', (m) => editJson(m, 'attempts', N.k, (k) => { k.resultSha256 = 'a'.repeat(64); })],
    ['sha256(R2) != summarySha256', (m) => editJson(m, 'attempts', N.k, (k) => { k.summarySha256 = 'b'.repeat(64); })],
    ['sha256(R3) != manifestSha256', (m) => editJson(m, 'attempts', N.k, (k) => { k.manifestSha256 = 'c'.repeat(64); })],
    ['R1 carries a forbidden closeout key (hashes recomputed)', (m) => { editJson(m, 'results', R1_NAME, (r) => { r.closeout.verification = { ok: true }; }); remanifest(m); recommit(m); }],
    ['R1 carries finalOverall deep (hashes recomputed)', (m) => { editJson(m, 'results', R1_NAME, (r) => { r.c17 = { finalOverall: 'PASS' }; }); remanifest(m); recommit(m); }],
    ['R3 recorded R1 hash differs (K recomputed)', (m) => { editJson(m, 'results', R3_NAME, (r) => { r.artifacts[0].sha256 = 'd'.repeat(64); }); recommit(m); }],
    ['R3 recorded R2 hash differs (K recomputed)', (m) => { editJson(m, 'results', R3_NAME, (r) => { r.artifacts[1].sha256 = 'e'.repeat(64); }); recommit(m); }],
    ['primaryOverall differs: R3', (m) => { remanifest(m, (r) => { r.primaryOverall = 'PARTIAL'; }); recommit(m); }],
    ['primaryOverall differs: K (finalOverall kept equal)', (m) => { recommit(m, (k) => { k.primaryOverall = 'PARTIAL'; k.finalOverall = 'PARTIAL'; }); }],
    ['primaryOverall differs: R1', (m) => { editJson(m, 'results', R1_NAME, (r) => { r.closeout.primaryOverall = 'BLOCKED'; r.overall.verdict = 'BLOCKED'; }); remanifest(m); recommit(m); }],
    ['primaryOverall differs: CLOSEOUT_STARTED transition', (m) => { editJson(m, 'attempts', N.jrn, (j) => { j.transitions[2].detail.primaryOverall = 'PARTIAL'; }); recommit(m); }],
    ['K.finalOverall != K.primaryOverall', (m) => { recommit(m, (k) => { k.finalOverall = 'PARTIAL'; }); }],
    ['K.journalSha256 != sha256(journal)', (m) => editJson(m, 'attempts', N.k, (k) => { k.journalSha256 = 'f'.repeat(64); })],
    ['attemptId differs: K', (m) => { recommit(m, (k) => { k.attemptId = randomUUID(); }); }],
    ['attemptId differs: R3', (m) => { remanifest(m, (r) => { r.attemptId = randomUUID(); }); recommit(m); }],
    ['attemptId differs: R1', (m) => { editJson(m, 'results', R1_NAME, (r) => { r.attempt.attemptId = randomUUID(); }); remanifest(m); recommit(m); }],
    ['attemptId differs: journal + reservation', (m) => { const a = randomUUID(); editJson(m, 'attempts', N.jrn, (j) => { j.attemptId = a; }); editJson(m, 'attempts', N.res, (r) => { r.attemptId = a; }); recommit(m); }],
  ];
  for (const [label, mut] of cases) {
    const m = await completeMap();
    mut(m);
    expectFail(derive(m), 'W-5', 'FAIL(commit-invalid)', label);
  }
});

test('precedence: the worst outcome wins; W-0 then W-1 label first, every witness is listed', async () => {
  const m = await completeMap();
  delete m.attempts[N.k];
  m.attempts[N.f] = Buffer.from('{}');
  const v = derive(m);
  assert.deepEqual([v.witness, v.witnesses.map((w) => w.witness)], ['W-1', ['W-1', 'W-3']]);
  m.attempts[N.jrn] = Buffer.from('nope');
  const v2 = derive(m);
  assert.equal(v2.witness, 'W-0');
  assert.ok(v2.witnesses.some((w) => w.witness === 'W-1'));
  // the reader never mutates its input
  const m3 = await completeMap();
  const snap = JSON.stringify(Object.fromEntries(Object.entries(m3.attempts).map(([k, b]) => [k, sha256Hex(b)])));
  derive(m3);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(m3.attempts).map(([k, b]) => [k, sha256Hex(b)]))), snap);
});

// ------------------------------------------------------------------------------------------
// §9.1 terminal-commit scenario matrix, row by row (surviving files from real closeout runs)
// ------------------------------------------------------------------------------------------

test('terminal-commit matrix rows 1-11', async () => {
  const kc = (rec) => rec.path.includes('.commit.candidate-');
  const failEverythingFrom = (pred) => { let on = false; return (rec) => { if (on) return 'error'; if (pred(rec)) { on = true; return 'error'; } return null; }; };

  // 1: R1/R2/R3 valid, journal CLOSEOUT_STARTED, no candidate, no K
  const r1 = await closeoutRun({ fault: failEverythingFrom((rec) => rec.op === 'open' && kc(rec)) });
  assert.ok(!Object.keys(r1.map.attempts).some((n) => n.includes('.commit.')));
  expectFail(derive(r1.map), 'W-3', 'FAIL(commit-missing)', 'row 1');
  // 2: R1-R3 valid and a complete valid Kc; no linkSync
  const r2 = await closeoutRun({ fault: failEverythingFrom((rec) => rec.op === 'link') });
  assert.ok(Object.keys(r2.map.attempts).some((n) => n.includes('.commit.candidate-')));
  expectFail(derive(r2.map), 'W-3', 'FAIL(commit-missing)', 'row 2');
  // 3: Kc write / fsync / read-back failed (incl. a read fault while verifying Kc)
  for (const pred of [(rec) => rec.op === 'write' && kc(rec), (rec) => rec.op === 'fsync' && kc(rec), (rec) => rec.op === 'readFile' && kc(rec)]) {
    const r = await closeoutRun({ fault: failEverythingFrom(pred) });
    expectFail(derive(r.map), 'W-3', 'FAIL(commit-missing)', 'row 3');
    assert.equal(r.result.finalOverall, 'FAIL');
  }
  // 4: late-verdict-change detected by the gate (fatal event before the critical section) => no link
  {
    let armed = null;
    const fs = createRecordingFakeFs({ seedDirs: ['/repo/test/acceptance'], fault: (r, i) => (armed ? armed(r, i) : null) });
    const { handle, binding } = createOfflineAttemptFixture({ fs, chain: CHAIN, authorizationId: ID });
    const state = createOfflineRunStateFixture({ binding });
    const res = await closeoutProtocol({
      state, handle, fs, chain: CHAIN, commitFs: { linkSync: brandSyncLinkForTest((a, b) => fs.link(a, b)) }, allowTestLinkPrimitive: true,
      quiescence: { detachListeners: () => { state.errorLedger.fatalCount += 1; armed = () => 'error'; } },
    });
    assert.deepEqual([res.finalOverall, [...res.causes]], ['FAIL', ['late-verdict-change(fatal-event)']]);
    expectFail(derive(readArtifactFileMap({ fs: fs.processCrashView(), chain: CHAIN })), 'W-3', 'FAIL(commit-missing)', 'row 4 (harness FAIL agrees)');
  }
  // 5: linkSync threw => K does not exist
  const r5 = await closeoutRun({ fault: failEverythingFrom((rec) => rec.op === 'link') });
  assert.equal(r5.result.finalOverall, 'FAIL');
  expectFail(derive(r5.map), 'W-3', 'FAIL(commit-missing)', 'row 5 (harness FAIL agrees)');
  // 6: K valid
  const r6 = await closeoutRun();
  assert.deepEqual([derive(r6.map).verdict, r6.result.finalOverall], ['PASS', 'PASS']);
  // 7: K invalid / F present => FAIL; a leftover candidate or temp beside a valid K is ignored
  const m7 = clone(r6.map);
  m7.attempts[N.k] = Buffer.from('{}');
  expectFail(derive(m7), 'W-0', null, 'row 7 malformed K');
  const m7b = clone(r6.map);
  m7b.attempts[N.f] = Buffer.from('');
  expectFail(derive(m7b), 'W-1', null, 'row 7 F present');
  const m7c = clone(r6.map);
  m7c.attempts[commitCandidateName(ID, randomUUID())] = Buffer.from('x');
  m7c.attempts[`${N.jrn}.tmp-${randomUUID()}`] = Buffer.from('x');
  assert.equal(derive(m7c).verdict, 'PASS', 'row 7 leftovers ignored');
  // 8: process crash before linkSync was invoked
  const r8 = await closeoutRun({ fault: (rec) => (rec.op === 'link' ? 'crash' : null) });
  expectFail(derive(r8.map), 'W-3', null, 'row 8');
  // 9: process crash after linkSync succeeded
  const r9 = await closeoutRun({ fault: (rec) => (rec.op === 'link' ? 'crash-after' : null) });
  assert.equal(derive(r9.map).verdict, 'PASS', 'row 9');
  // 10: OS crash after linkSync but before the directory entry is durable
  {
    let armed = null;
    const fs = createRecordingFakeFs({ seedDirs: ['/repo/test/acceptance'], fault: (r, i) => (armed ? armed(r, i) : null) });
    const { handle, binding } = createOfflineAttemptFixture({ fs, chain: CHAIN, authorizationId: ID });
    const state = createOfflineRunStateFixture({ binding });
    armed = (rec) => (rec.op === 'link' ? 'crash-after' : null);
    await assert.rejects(closeoutProtocol({ state, handle, fs, chain: CHAIN, commitFs: { linkSync: brandSyncLinkForTest((a, b) => fs.link(a, b)) }, allowTestLinkPrimitive: true }), (e) => e.simulatedCrash);
    const os = derive(readArtifactFileMap({ fs: fs.osCrashView(), chain: CHAIN }));
    expectFail(os, 'W-3', 'FAIL(commit-missing)', 'row 10 (K lost; Kc durable but non-authoritative)');
    assert.ok(Object.keys(readArtifactFileMap({ fs: fs.osCrashView(), chain: CHAIN }).attempts).some((n) => n.includes('.commit.candidate-')));
  }
  // 11: linkSync succeeded, then post-commit faults => K.finalOverall
  let linked = false;
  const r11 = await closeoutRun({ fault: (rec) => { if (rec.op === 'link') { linked = true; return null; } return linked ? 'error' : null; } });
  assert.deepEqual([r11.result.finalOverall, derive(r11.map).verdict], ['PASS', 'PASS'], 'row 11 (harness and reader agree)');
});

// ==========================================================================================
// FAILED-RUN CLOSEOUT (owner-authorized 2026-10-02): reader over a failed-run artifact set.
// The failed run's state is produced by the REAL Node verdict function (`applyPhaseRunFailureToState`) on the offline
// fixture, then closed out by the real closeoutProtocol: R1 (with `phaseRunFailure`) -> R2 -> R3 -> J -> K (FAIL).
// ==========================================================================================

// (imports are hoisted; kept here so this section stays self-contained)
import { applyPhaseRunFailureToState, validateResultSchema, validateCloseoutManifest, validateFailureWitness, failedRunRecordProblems } from './clashpanel-viewerbridge.acceptance.mjs';

const FR = Object.freeze({ name: 'TypeError', message: 'runner threw after P11 (reader fixture)', phase: 'P11', activeCheck: null, activeControl: null, operation: null, seq: 90, cleanupEntry: 'marker-allocated' });
/** Turns the PASS offline state into the failed-run state Node builds for a page failure transfer (seq 90 = the page-alloc failure seq). */
function failState(s) {
  let n = 100;
  s.authoritativeGate = s.gates.C1; // POST-C1 failure after every check/control was produced (truthful history kept)
  s.errorLedger.markers.push({ seq: 80, name: 'P11' }, { seq: 95, name: 'cleanup' });
  applyPhaseRunFailureToState(s, { phaseRunFailure: { ...FR }, partial: { checks: s.checks, controls: s.controls, extras: {} }, eventLog: s.eventLog, spyLedger: s.spyLedger, screenshots: [], stateSnapshots: s.stateSnapshots }, { nextSeq: () => n++ });
  s.sessionTainted = true;
}
let FAILED = null;
async function failedMap() {
  if (!FAILED) FAILED = await closeoutRun({ mutateState: failState });
  return clone(FAILED.map);
}
const FR_PRE = Object.freeze({ name: 'TypeError', message: 'runner threw in P1 before the gate (reader fixture)', phase: 'P1', activeCheck: null, activeControl: null, operation: null, seq: 5, cleanupEntry: 'marker-allocated' });
/** PRE-C1 failed run: Node holds no gate; markers P1 + cleanup only; the page partial (all PASS) is ignored by Node. */
function preFailState(s) {
  let n = 100;
  s.errorLedger.markers.push({ seq: 0, name: 'P1' }, { seq: 6, name: 'cleanup' });
  applyPhaseRunFailureToState(s, { phaseRunFailure: { ...FR_PRE }, partial: { checks: JSON.parse(JSON.stringify(s.checks)), controls: JSON.parse(JSON.stringify(s.controls)), extras: {} }, eventLog: s.eventLog, spyLedger: s.spyLedger, screenshots: [], stateSnapshots: s.stateSnapshots }, { nextSeq: () => n++ });
  s.sessionTainted = true;
}
let PRE_FAILED = null;
async function preFailedMap() {
  if (!PRE_FAILED) PRE_FAILED = await closeoutRun({ mutateState: preFailState });
  return clone(PRE_FAILED.map);
}
const FR_PARTIAL = Object.freeze({ name: 'TypeError', message: 'runner threw in P4 after N6 (reader fixture)', phase: 'P4', activeCheck: null, activeControl: null, operation: null, seq: 30, cleanupEntry: 'marker-allocated' });
const PARTIAL_KEPT = Object.freeze({ checks: ['C1', 'C2', 'C3', 'C4', 'C5'], controls: ['N1', 'N6'] });
/**
 * POST-C1 failed run with a PARTIAL history: Node's OPEN gate (gateSeq 2); the page had produced C1..C5 (P1, P3, P4) and the
 * control-runs N1 (P2, seq 10/11) and N6 (P4, seq 20/21), then threw in P4 at seq 30; markers P1/P2/P3/P4 + cleanup (31).
 */
function partialFailState(s) {
  let n = 100;
  s.authoritativeGate = JSON.parse(JSON.stringify(s.gates.C1));
  s.errorLedger.markers.push({ seq: 0, name: 'P1' }, { seq: 3, name: 'P2' }, { seq: 12, name: 'P3' }, { seq: 13, name: 'P4' }, { seq: 31, name: 'cleanup' });
  const pick = (o, ks) => JSON.parse(JSON.stringify(Object.fromEntries(ks.map((k) => [k, o[k]]))));
  applyPhaseRunFailureToState(s, { phaseRunFailure: { ...FR_PARTIAL }, partial: { checks: pick(s.checks, PARTIAL_KEPT.checks), controls: pick(s.controls, PARTIAL_KEPT.controls), extras: {} }, eventLog: s.eventLog, spyLedger: s.spyLedger, screenshots: [], stateSnapshots: s.stateSnapshots }, { nextSeq: () => n++ });
  s.sessionTainted = true;
}
let PARTIAL_FAILED = null;
async function partialFailedMap() {
  if (!PARTIAL_FAILED) PARTIAL_FAILED = await closeoutRun({ mutateState: partialFailState });
  return clone(PARTIAL_FAILED.map);
}
/** Flips one byte inside a JSON string value of an artifact (stays parseable; only the content changes). */
function flipInside(buf, needle) {
  const i = buf.indexOf(needle);
  assert.ok(i >= 0, `needle ${needle}`);
  const b = Buffer.from(buf);
  b[i] = b[i] === 0x61 ? 0x62 : 0x61;
  return b;
}

test('FAILED-RUN CLOSEOUT reader: a durably closed failed run derives FAIL at W-6 with detail.failedRun; harness and reader agree; R1 schema-valid, R3 validates and hashes the R1 bytes; K.finalOverall = primaryOverall = FAIL', async () => {
  await failedMap();
  const { result } = FAILED;
  assert.deepEqual([result.finalOverall, result.primaryRow, result.committed], ['FAIL', 3, true], JSON.stringify(result.causes));
  const m = await failedMap();
  const r1 = parse(m.results[R1_NAME]);
  assert.deepEqual(validateResultSchema(r1, 'payload').errors, []);
  assert.deepEqual(failedRunRecordProblems(r1), []);
  assert.deepEqual([r1.phaseRunFailure.failureSeq, r1.phaseRunFailure.seqSource, r1.overall.verdict], [90, 'page-alloc', 'FAIL']);
  const r3 = parse(m.results[R3_NAME]);
  assert.deepEqual(validateCloseoutManifest(r3), { ok: true, errors: [] });
  assert.equal(r3.artifacts[0].sha256, sha256Hex(m.results[R1_NAME]));
  const k = parse(m.attempts[N.k]);
  assert.deepEqual([k.finalOverall, k.primaryOverall, k.primaryRow], ['FAIL', 'FAIL', 3]);
  assert.match(m.results[R2_NAME].toString('utf8'), /^failedRun: page-phase-run\/TypeError\/P11\/seq 90\/post-c1$/m);
  const v = derive(m);
  assert.deepEqual([v.verdict, v.label, v.witness], ['FAIL', 'FAIL', 'W-6']);
  assert.deepEqual({ ...v.detail.failedRun }, { source: 'page-phase-run', category: 'TypeError', phase: 'P11', failureSeq: 90, c1Stage: 'post-c1' });
  // contrast: the PASS set's detail carries no failed run
  assert.equal(derive(await completeMap()).detail.failedRun, null);
});

test('FAILED-RUN CLOSEOUT reader: a failed-run artifact set with a missing or corrupt artifact derives FAIL with the proper witness (R1/R3 missing, R1 bytes changed, R1 failure record edited even with hashes recomputed => W-5; K corrupt => W-0; K removed => W-3)', async () => {
  const cases = [
    ['R1 deleted', (m) => { delete m.results[R1_NAME]; }, 'W-5', 'FAIL(commit-invalid)', ['R1-missing']],
    ['R3 deleted', (m) => { delete m.results[R3_NAME]; }, 'W-5', 'FAIL(commit-invalid)', ['R3-missing']],
    ['R2 deleted', (m) => { delete m.results[R2_NAME]; }, 'W-5', 'FAIL(commit-invalid)', ['R2-missing']],
    ['R1 bytes changed (failure message)', (m) => { m.results[R1_NAME] = flipInside(m.results[R1_NAME], 'reader fixture'); }, 'W-5', 'FAIL(commit-invalid)', ['R1-sha256', 'R3-R1-hash']],
    ['K corrupt (unparseable)', (m) => { m.attempts[N.k] = Buffer.from('{"attemptId":'); }, 'W-0', 'FAIL(reader-invalid)', null],
    ['K removed (journal CLOSEOUT_STARTED)', (m) => { delete m.attempts[N.k]; }, 'W-3', 'FAIL(commit-missing)', null],
  ];
  for (const [label, mut, witness, lbl, reasons] of cases) {
    const m = await failedMap();
    mut(m);
    const v = derive(m);
    expectFail(v, witness, lbl, label);
    if (reasons) for (const r of reasons) assert.ok(v.witnesses[0].reasons.includes(r), `${label}: ${JSON.stringify(v.witnesses[0].reasons)}`);
  }
  // R1 root failure message edited, hashes recomputed: wherever a check is BLOCKED by the failure (pre-C1 set; post-C1 partial set)
  // its evidence no longer matches => W-5; on the post-C1 set where EVERY item had already produced a record nothing else carries
  // the message, so the reader still derives FAIL (never PASS).
  for (const [label, get] of [['pre-C1', preFailedMap], ['post-C1 partial', partialFailedMap]]) {
    const e = await get();
    editJson(e, 'results', R1_NAME, (r) => { r.phaseRunFailure.message = 'something else'; });
    remanifest(e); recommit(e);
    const ve = derive(e);
    expectFail(ve, 'W-5', 'FAIL(commit-invalid)', `${label} R1 root failure edited`);
    assert.ok(ve.witnesses[0].reasons.includes('R1-schema'), JSON.stringify(ve.witnesses[0].reasons));
  }
  const eAll = await failedMap();
  editJson(eAll, 'results', R1_NAME, (r) => { r.phaseRunFailure.message = 'something else'; });
  remanifest(eAll); recommit(eAll);
  assert.equal(derive(eAll).verdict, 'FAIL', 'post-C1 all-produced R1 root failure edited: never PASS');
  // R1 root failure removed (null), hashes recomputed: on a PRE-C1 set (gates null) gates-missing is NOT waived => W-5;
  // on the POST-C1 set (gates kept) the R1 stays a FAIL row-3 record, so the reader still derives FAIL (never PASS).
  const pre = await preFailedMap();
  editJson(pre, 'results', R1_NAME, (r) => { r.phaseRunFailure = null; });
  remanifest(pre); recommit(pre);
  const vPre = derive(pre);
  expectFail(vPre, 'W-5', 'FAIL(commit-invalid)', 'pre-C1 R1 root failure removed');
  assert.ok(vPre.witnesses[0].reasons.includes('R1-schema'), JSON.stringify(vPre.witnesses[0].reasons));
  const post = await failedMap();
  editJson(post, 'results', R1_NAME, (r) => { r.phaseRunFailure = null; });
  remanifest(post); recommit(post);
  assert.equal(derive(post).verdict, 'FAIL', 'post-C1 R1 root failure removed: never PASS');
  // R3 corrupt (still parseable): verification flag flipped, K recomputed => R3-schema (W-5)
  const m = await failedMap();
  editJson(m, 'results', R3_NAME, (r) => { r.verification.R1.schemaValid = false; });
  recommit(m);
  const v = derive(m);
  expectFail(v, 'W-5', 'FAIL(commit-invalid)', 'R3 corrupt');
  assert.ok(v.witnesses[0].reasons.includes('R3-schema'), JSON.stringify(v.witnesses[0].reasons));
});

test('FAILED-RUN CLOSEOUT reader: a forced closeout failure on a failed run (R1 write fault) => no K, F carries the original phaseRunFailure and validates, reader FAIL (W-1; W-3 without F)', async () => {
  const run = await closeoutRun({ mutateState: failState, fault: (rec) => (rec.op === 'open' && rec.flags === 'wx' && rec.path.startsWith(`${CHAIN.D1}/${R1_NAME}`) ? 'error' : null) });
  assert.deepEqual([run.result.finalOverall, run.result.committed], ['FAIL', false]);
  assert.equal(run.map.attempts[N.k], undefined);
  const f = parse(run.map.attempts[N.f]);
  assert.deepEqual(validateFailureWitness(f), { ok: true, errors: [] });
  assert.deepEqual(f.phaseRunFailure, parse(FAILED ? FAILED.map.results[R1_NAME] : (await failedMap()).results[R1_NAME]).phaseRunFailure, 'F carries the same root failure the committed R1 would');
  assert.equal(f.phaseRunFailure.message, FR.message);
  expectFail(derive(run.map), 'W-1', 'FAIL(closeout-failure-witness)', 'F present');
  const noF = clone(run.map);
  delete noF.attempts[N.f];
  const v = derive(noF);
  assert.equal(v.verdict, 'FAIL');
  assert.ok(['W-2', 'W-3'].includes(v.witness), `${v.witness} ${v.label}`);
});

test('FAILED-RUN CLOSEOUT reader: failed-run evidence can NEVER derive PASS -- (a) a forged, hash-consistent set whose R1/R3/journal/K all claim PASS => W-5 (R1-schema: failed-run-overall-not-fail); a K claiming PASS over the valid FAIL R1 => W-5 (failed-run-final-not-fail); (b) validateResultSchema rejects a failed-run R1 with a non-FAIL overall', async () => {
  // (a1) everything claims PASS row 8, every hash recomputed
  const m = await failedMap();
  editJson(m, 'results', R1_NAME, (r) => { r.overall = { verdict: 'PASS', row: 8 }; r.closeout.primaryOverall = 'PASS'; r.closeout.primaryRow = 8; });
  editJson(m, 'attempts', N.jrn, (j) => { j.transitions[2].detail.primaryOverall = 'PASS'; j.transitions[2].detail.primaryRow = 8; });
  remanifest(m, (r) => { r.primaryOverall = 'PASS'; r.primaryRow = 8; });
  recommit(m, (k) => { k.finalOverall = 'PASS'; k.primaryOverall = 'PASS'; k.primaryRow = 8; });
  const v1 = derive(m);
  expectFail(v1, 'W-5', 'FAIL(commit-invalid)', 'forged all-PASS failed run');
  assert.deepEqual(v1.witnesses.map((w) => w.witness), ['W-5']);
  assert.ok(v1.witnesses[0].reasons.includes('R1-schema'), JSON.stringify(v1.witnesses[0].reasons));
  assert.ok(validateResultSchema(parse(m.results[R1_NAME]), 'payload').errors.includes('failed-run-overall-not-fail'));
  // control: the genuine PASS set making the same claims (phaseRunFailure null) derives PASS
  const c = await completeMap();
  assert.equal(derive(c).verdict, 'PASS');
  // (a2) the R1 stays the valid FAIL record; only K (and the journal) claim PASS
  const m2 = await failedMap();
  editJson(m2, 'attempts', N.jrn, (j) => { j.transitions[2].detail.primaryOverall = 'PASS'; });
  recommit(m2, (k) => { k.finalOverall = 'PASS'; k.primaryOverall = 'PASS'; });
  const v2 = derive(m2);
  expectFail(v2, 'W-5', 'FAIL(commit-invalid)', 'PASS K over a failed-run R1');
  assert.ok(v2.witnesses[0].reasons.includes('failed-run-final-not-fail'), JSON.stringify(v2.witnesses[0].reasons));
  assert.ok(v2.witnesses[0].reasons.includes('primaryOverall-differs'));
  assert.equal(v2.detail.failedRun.failureSeq, 90, 'the root failure is still reported');
  // (b) schema: any non-FAIL overall on a failed-run R1
  const r1 = parse((await failedMap()).results[R1_NAME]);
  for (const [verdict, row] of [['PASS', 8], ['BLOCKED', 6], ['PARTIAL', 7]]) {
    const x = { ...r1, overall: { verdict, row }, closeout: { ...r1.closeout, primaryOverall: verdict, primaryRow: row } };
    assert.ok(validateResultSchema(x, 'payload').errors.includes('failed-run-overall-not-fail'), verdict);
  }
  assert.equal(validateResultSchema(r1, 'payload').errors.includes('failed-run-overall-not-fail'), false, 'FAIL is accepted');
  const pass = parse((await completeMap()).results[R1_NAME]);
  assert.equal(pass.phaseRunFailure, null);
  assert.deepEqual(validateResultSchema(pass, 'payload').errors, [], 'a PASS R1 (phaseRunFailure null) is unaffected');
});

test('FAILED-RUN v2 (10) reader: a POST-C1 partial-history failed run is durably closed and derives FAIL (W-6) while PRESERVING prior history -- R1 on disk keeps Node\'s gate, the retained PASS check-runs C1..C5 and the executed control-runs N1/N6 (seqs intact); the rest blocked / unstarted; detail.failedRun.c1Stage post-c1; R2 ends /post-c1', async () => {
  await partialFailedMap();
  const { result } = PARTIAL_FAILED;
  assert.deepEqual([result.finalOverall, result.primaryRow, result.committed], ['FAIL', 3, true], JSON.stringify(result.causes));
  const m = await partialFailedMap();
  const r1 = parse(m.results[R1_NAME]);
  const pass = createOfflineRunStateFixture({ binding: createOfflineAttemptFixture({ fs: createRecordingFakeFs({ seedDirs: ['/repo/test/acceptance'] }), chain: CHAIN, authorizationId: 'reader-test-pass-0002' }).binding });
  assert.deepEqual(validateResultSchema(r1, 'payload').errors, []);
  assert.deepEqual(failedRunRecordProblems(r1), []);
  assert.deepEqual(r1.gates, pass.gates, 'the authoritative OPEN gate is in the durable R1');
  for (const n of PARTIAL_KEPT.checks) assert.deepEqual(r1.checks[n], pass.checks[n], `${n} retained verbatim (PASS)`);
  for (const n of PARTIAL_KEPT.controls) assert.deepEqual(r1.controls[n], pass.controls[n], `${n} retained with its start/terminal seqs`);
  assert.deepEqual([r1.controls.N1.executionRecord.startSeq, r1.controls.N1.executionRecord.terminalSeq, r1.controls.N6.executionRecord.startSeq, r1.controls.N6.executionRecord.terminalSeq], [10, 11, 20, 21]);
  for (const [n, c] of Object.entries(r1.checks)) if (!PARTIAL_KEPT.checks.includes(n)) assert.deepEqual([c.verdict, c.reason, c.evidence.phaseRunFailure.message], ['BLOCKED', 'phase-run-threw', FR_PARTIAL.message], n);
  for (const [n, c] of Object.entries(r1.controls)) if (!PARTIAL_KEPT.controls.includes(n)) assert.deepEqual([c.executionRecord.started, c.fields.reason, c.executionRecord.terminalSeq >= 100], [false, 'phase-run-threw', true], n);
  const pf = r1.phaseRunFailure;
  assert.deepEqual([pf.c1Stage, pf.gateSeq, pf.gateOutcome, pf.failureSeq, pf.phase], ['post-c1', 2, 'OPEN', 30, 'P4']);
  assert.deepEqual([r1.overall.verdict, r1.overall.row], ['FAIL', 3]);
  assert.match(m.results[R2_NAME].toString('utf8'), /^failedRun: page-phase-run\/TypeError\/P4\/seq 30\/post-c1$/m);
  const k = parse(m.attempts[N.k]);
  assert.deepEqual([k.finalOverall, k.primaryOverall, k.primaryRow], ['FAIL', 'FAIL', 3]);
  const v = derive(m);
  assert.deepEqual([v.verdict, v.label, v.witness], ['FAIL', 'FAIL', 'W-6']);
  assert.deepEqual({ ...v.detail.failedRun }, { source: 'page-phase-run', category: 'TypeError', phase: 'P4', failureSeq: 30, c1Stage: 'post-c1' });
});

test('FAILED-RUN v2 (10) reader: forged stage / history on the POST-C1 partial set (hashes recomputed) => W-5 R1-schema: c1Stage flipped to pre-c1 or post-c1-untransferred, gates nulled, the gate fact edited, an executed control erased to a placeholder over its own history; the untouched set derives W-6', async () => {
  const cases = [
    ['c1Stage -> pre-c1 (gate fact cleared)', (r) => { Object.assign(r.phaseRunFailure, { c1Stage: 'pre-c1', gateSeq: null, gateOutcome: null }); }, 'failed-run-gate-present'],
    ['c1Stage -> post-c1-untransferred', (r) => { r.phaseRunFailure.c1Stage = 'post-c1-untransferred'; }, 'failed-run-gate-present'],
    ['gates nulled', (r) => { r.gates = null; }, 'failed-run-post-c1-without-gate'],
    ['gate fact edited', (r) => { r.phaseRunFailure.gateSeq = 3; }, 'failed-run-gate-mismatch'],
    ['failureSeq before N6 terminal', (r) => { r.phaseRunFailure.failureSeq = 15; }, 'failed-run-control-after-failure:N6'],
  ];
  for (const [label, edit, problem] of cases) {
    const m = await partialFailedMap();
    let edited = null;
    editJson(m, 'results', R1_NAME, (r) => { edit(r); edited = r; });
    assert.ok(failedRunRecordProblems(edited).includes(problem), `${label}: ${JSON.stringify(failedRunRecordProblems(edited))}`);
    remanifest(m); recommit(m);
    const v = derive(m);
    expectFail(v, 'W-5', 'FAIL(commit-invalid)', label);
    assert.ok(v.witnesses[0].reasons.includes('R1-schema'), `${label}: ${JSON.stringify(v.witnesses[0].reasons)}`);
  }
  // non-vacuity: the same recompute path without an edit is the valid W-6 set
  const ok = await partialFailedMap();
  remanifest(ok); recommit(ok);
  assert.deepEqual([derive(ok).verdict, derive(ok).witness], ['FAIL', 'W-6']);
});

test('FAILED-RUN v2 (1)/(10) reader: a PRE-C1 failed run is durably closed with gates null, every check BLOCKED and every control unstarted; reader FAIL W-6 with c1Stage pre-c1; R2 ends /pre-c1; a forged downstream marker (hashes recomputed) => W-5', async () => {
  await preFailedMap();
  assert.deepEqual([PRE_FAILED.result.finalOverall, PRE_FAILED.result.primaryRow, PRE_FAILED.result.committed], ['FAIL', 3, true], JSON.stringify(PRE_FAILED.result.causes));
  const m = await preFailedMap();
  const r1 = parse(m.results[R1_NAME]);
  assert.deepEqual(validateResultSchema(r1, 'payload').errors, []);
  assert.equal(r1.gates, null);
  assert.ok(Object.values(r1.checks).every((c) => c.verdict === 'BLOCKED' && c.reason === 'phase-run-threw'));
  assert.ok(Object.values(r1.controls).every((c) => c.executionRecord.started === false));
  assert.deepEqual([r1.phaseRunFailure.c1Stage, r1.phaseRunFailure.gateSeq, r1.phaseRunFailure.gateOutcome], ['pre-c1', null, null]);
  assert.match(m.results[R2_NAME].toString('utf8'), /^failedRun: page-phase-run\/TypeError\/P1\/seq 5\/pre-c1$/m);
  const v = derive(m);
  assert.deepEqual([v.verdict, v.witness, v.detail.failedRun.c1Stage], ['FAIL', 'W-6', 'pre-c1']);
  const forged = await preFailedMap();
  editJson(forged, 'results', R1_NAME, (r) => { r.errorLedger.markers.splice(1, 0, { seq: 4, name: 'P2' }); });
  assert.ok(failedRunRecordProblems(parse(forged.results[R1_NAME])).includes('failed-run-pre-c1-downstream-marker'));
  remanifest(forged); recommit(forged);
  expectFail(derive(forged), 'W-5', 'FAIL(commit-invalid)', 'pre-c1 with a downstream marker');
});
