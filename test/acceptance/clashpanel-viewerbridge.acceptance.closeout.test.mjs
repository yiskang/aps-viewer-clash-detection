// test/acceptance/clashpanel-viewerbridge.acceptance.closeout.test.mjs
//
// Offline tests for the G2 harness closeout and evidence-write protocol (procedure §9.1, §4.2
// "closeout matrix"), on the recording fake filesystem: the operation order; a fault injected at
// EVERY write/fsync/rename/link/verification-read operation of CLOSEOUT_STARTED, R1, R2, R3 and Kc
// (error, error-after "the op landed then failed", crash, crash-after, partial write) with the
// harness verdict and the reader verdict on the surviving files (process- and OS-crash views);
// post-K faults (unlink, directory fsync, read-back, late fatal event, unhandled rejection) leave
// the verdict unchanged; X9-X13 and X15-X19; the scheduler simulation (a fatal event at every
// scheduling point can only land before the gate => late-verdict-change, or after the commit =>
// ignored); the R1 payload cutoff (immutability, late mutation, forbidden keys); the async-link
// negative control. No real filesystem, no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAttemptsChain,
  createRecordingFakeFs,
  createOfflineAttemptFixture,
  createOfflineRunStateFixture,
  closeoutProtocol,
  createFatalEventSink,
  brandSyncLinkForTest,
  linkPrimitiveProblem,
  deriveVerdictFromArtifacts,
  readArtifactFileMap,
  validateResultSchema,
  validateCloseoutManifest,
  validateCommitRecord,
  takeFrozenSnapshot,
  buildResultPayload,
  RESULT_FORBIDDEN_DEEP_KEYS,
  RESULT_FORBIDDEN_SHALLOW_KEYS,
  RESULT_TOP_LEVEL_KEYS,
  R1_NAME,
  R2_NAME,
  R3_NAME,
  JOURNAL_STATE,
  commitName,
  journalName,
  closeoutFailureName,
  sha256Hex,
} from './clashpanel-viewerbridge.acceptance.mjs';
import * as nodeFs from 'node:fs';

const CHAIN = resolveAttemptsChain('/repo');

/**
 * A fake fs with a W2/W3-complete attempt (journal at ATTEMPT_CONSUMED) and an all-PASS run state.
 * `arm(fn)` installs a fault function that only sees operations issued after setup; `base` is the
 * op index where closeout begins.
 */
function setup({ mutateState = () => {} } = {}) {
  let armed = null;
  const fs = createRecordingFakeFs({ seedDirs: ['/repo/test/acceptance'], fault: (rec, idx) => (armed ? armed(rec, idx) : null) });
  const { handle, binding } = createOfflineAttemptFixture({ fs, chain: CHAIN });
  const state = createOfflineRunStateFixture({ binding });
  Object.defineProperty(state, 'closeoutComplete', { enumerable: false, get() { throw new Error('closeoutComplete read before K'); } });
  mutateState(state);
  const sink = createFatalEventSink(state.errorLedger);
  const commitFs = { linkSync: brandSyncLinkForTest((a, b) => fs.link(a, b)) };
  return { fs, handle, binding, state, sink, commitFs, base: fs.ops.length, arm: (fn) => { armed = fn; }, id: handle.authorizationId };
}

function run(ctx, extra = {}) {
  return closeoutProtocol({ state: ctx.state, handle: ctx.handle, fs: ctx.fs, chain: CHAIN, sink: ctx.sink, commitFs: ctx.commitFs, allowTestLinkPrimitive: true, ...extra });
}

/** Reader over a fault-free copy of the visible state (the injected fault may still be armed on ctx.fs). */
function reader(fsOrView, id) {
  const view = typeof fsOrView.processCrashView === 'function' ? fsOrView.processCrashView() : fsOrView;
  return deriveVerdictFromArtifacts({ ...readArtifactFileMap({ fs: view, chain: CHAIN }), authorizationId: id });
}

/** File map over a fault-free copy of the visible state. */
function files(ctx) { return readArtifactFileMap({ fs: ctx.fs.processCrashView(), chain: CHAIN }); }

const linkOps = (ctx) => ctx.fs.ops.filter((o) => o.op === 'link');

/** Baseline op log (fault-free) for index-based fault enumeration. */
async function baselineOps() {
  const ctx = setup();
  const r = await run(ctx);
  assert.equal(r.finalOverall, 'PASS');
  const ops = ctx.fs.ops.slice(ctx.base);
  const linkIdx = ops.findIndex((o) => o.op === 'link');
  return { ops, linkIdx, dirFsyncAfterLink: ops.findIndex((o, i) => i > linkIdx && o.op === 'fsync') };
}

// ------------------------------------------------------------------------------------------
// Happy path and operation order
// ------------------------------------------------------------------------------------------

test('happy path: PASS committed through exactly one link; artifacts verified; reader == harness', async () => {
  const ctx = setup();
  const lines = [];
  const r = await run(ctx, { print: (l) => lines.push(l) });
  assert.equal(r.committed, true);
  assert.equal(r.finalOverall, 'PASS');
  assert.equal(r.closeoutComplete, true);
  assert.equal(r.exitCode, 0);
  assert.deepEqual([...r.causes], []);
  assert.ok(Object.isFrozen(r));
  assert.deepEqual(linkOps(ctx).length, 1);
  assert.equal(linkOps(ctx)[0].to, `${CHAIN.D2}/${commitName(ctx.id)}`);
  assert.match(linkOps(ctx)[0].path, /\.commit\.candidate-[0-9a-f-]{36}$/);
  assert.deepEqual(r.postCommit, { unlinkCandidate: 'ok', directoryFsync: 'ok', readBack: 'match', durabilityUnconfirmed: false });
  assert.ok(lines.includes('finalOverall: PASS'));

  const map = files(ctx);
  assert.deepEqual(Object.keys(map.attempts).sort(), [commitName(ctx.id), journalName(ctx.id), `${ctx.id}.reservation.json`].sort(), 'candidate unlinked, no F');
  const r1 = JSON.parse(map.results[R1_NAME].toString('utf8'));
  assert.deepEqual(validateResultSchema(r1, 'payload'), { ok: true, errors: [] });
  assert.deepEqual(Object.keys(r1), [...RESULT_TOP_LEVEL_KEYS]);
  assert.deepEqual(r1.attempt.journalStates.map((t) => t.state), ['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED']);
  assert.deepEqual(r1.closeout, { phase: 'payload', primaryOverall: 'PASS', primaryRow: 8, optional: [{ name: 'O2', status: 'absent' }] });
  const r3 = JSON.parse(map.results[R3_NAME].toString('utf8'));
  assert.ok(validateCloseoutManifest(r3).ok);
  assert.equal(r3.artifacts[0].sha256, sha256Hex(map.results[R1_NAME]));
  assert.equal(r3.artifacts[1].sha256, sha256Hex(map.results[R2_NAME]));
  const k = JSON.parse(map.attempts[commitName(ctx.id)].toString('utf8'));
  assert.ok(validateCommitRecord(k).ok);
  assert.equal(k.journalSha256, sha256Hex(map.attempts[journalName(ctx.id)]));
  assert.equal(k.manifestSha256, sha256Hex(map.results[R3_NAME]));
  const journal = JSON.parse(map.attempts[journalName(ctx.id)].toString('utf8'));
  assert.deepEqual(journal.transitions.at(-1), { ...journal.transitions.at(-1), state: 'CLOSEOUT_STARTED', detail: { primaryOverall: 'PASS', primaryRow: 8 } });
  const v = reader(ctx.fs, ctx.id);
  assert.deepEqual([v.verdict, v.witness], ['PASS', 'W-6']);
});

test('operation order: CLOSEOUT_STARTED -> R1 -> R2 -> R3 -> Kc (wx, fsync, close, fsync D2) -> verify reads -> link -> post-commit', async () => {
  const { ops, linkIdx } = await baselineOps();
  const label = (o) => {
    const p = o.path.split('/').pop();
    const kind = p.includes('.journal.json') ? 'journal' : p.startsWith(R1_NAME) ? 'R1' : p.startsWith(R2_NAME) ? 'R2' : p.startsWith(R3_NAME) ? 'R3'
      : p.includes('.commit.candidate-') ? 'Kc' : p.endsWith('.commit.json') ? 'K' : p === 'results' ? 'D1' : p === 'clashpanel-viewerbridge-g2-attempts' ? 'D2' : p;
    return `${o.op}:${kind}`;
  };
  const seq = ops.map(label);
  const firstOf = (x) => seq.indexOf(x);
  // CLOSEOUT_STARTED journal write precedes every results artifact
  assert.ok(firstOf('rename:journal') < firstOf('open:R1'));
  // each results artifact: temp wx, write, fsync, close, rename, fsync(D1), verification read
  for (const r of ['R1', 'R2', 'R3']) {
    const at = firstOf(`open:${r}`);
    assert.deepEqual(seq.slice(at, at + 7), [`open:${r}`, `write:${r}`, `fsync:${r}`, `close:${r}`, `rename:${r}`, 'fsync:D1', `readFile:${r}`], r);
  }
  assert.ok(firstOf('readFile:R2') < firstOf('open:R3'), 'R3 only after R1 and R2 verified');
  const kc = firstOf('open:Kc');
  assert.ok(kc > firstOf('readFile:R3'));
  assert.deepEqual(seq.slice(kc, kc + 7), ['open:Kc', 'write:Kc', 'fsync:Kc', 'close:Kc', 'fsync:D2', 'readFile:Kc', 'readFile:journal']);
  assert.equal(ops[kc].flags, 'wx');
  assert.equal(seq[linkIdx], 'link:Kc');
  assert.equal(linkIdx, kc + 7, 'nothing fallible between the last verification read and the link');
  assert.deepEqual(seq.slice(linkIdx + 1), ['unlink:Kc', 'fsync:D2', 'readFile:K']);
});

// ------------------------------------------------------------------------------------------
// Closeout matrix: fault at every operation
// ------------------------------------------------------------------------------------------

test('closeout matrix: error / error-after at every op => FAIL, no link before the fault point, reader FAIL; post-K faults => PASS', async () => {
  const { ops, linkIdx } = await baselineOps();
  assert.ok(linkIdx > 20);
  let checked = 0;
  for (let k = 0; k < ops.length; k += 1) {
    for (const mode of ['error', 'error-after']) {
      const ctx = setup();
      ctx.arm((rec, idx) => (idx === ctx.base + k ? mode : null));
      const r = await run(ctx);
      const v = reader(ctx.fs, ctx.id);
      const tag = `op ${k} ${ops[k].op} ${ops[k].path} ${mode}`;
      assert.deepEqual(ctx.fs.ops[ctx.base + k].op, ops[k].op, `${tag}: op log aligned`);
      if (k < linkIdx) {
        assert.equal(r.committed, false, tag);
        assert.equal(r.finalOverall, 'FAIL', tag);
        assert.equal(r.exitCode, 1, tag);
        assert.ok(r.causes.length > 0, tag);
        assert.equal(linkOps(ctx).length, 0, `${tag}: no linkSync attempted`);
        assert.equal(v.verdict, 'FAIL', tag);
        assert.ok(!(commitName(ctx.id) in files(ctx).attempts), `${tag}: K never exists`);
      } else if (k === linkIdx) {
        // link error: K absent. link error-after (outside the stated FS assumption): K landed, but
        // step 10's F / FAILED witnesses still make the reader FAIL, agreeing with the harness.
        assert.equal(r.committed, false, tag);
        assert.equal(r.finalOverall, 'FAIL', tag);
        assert.equal(v.verdict, 'FAIL', tag);
        assert.ok(['W-1', 'W-2', 'W-3'].includes(v.witness), `${tag}: ${v.label}`);
        assert.equal(r.failurePath.failureWitnessWritten, true, tag);
      } else {
        assert.equal(r.committed, true, tag);
        assert.equal(r.finalOverall, 'PASS', tag);
        assert.equal(r.exitCode, 0, tag);
        assert.deepEqual([v.verdict, v.witness], ['PASS', 'W-6'], tag);
      }
      checked += 1;
    }
  }
  assert.equal(checked, ops.length * 2);
});

test('crash matrix: crash / crash-after / partial write at every op => reader on process- and OS-crash views is FAIL before the link, K.finalOverall once K is visible', async () => {
  const { ops, linkIdx, dirFsyncAfterLink } = await baselineOps();
  const rows = new Set();
  for (let k = 0; k < ops.length; k += 1) {
    const modes = ops[k].op === 'write' ? ['crash', 'crash-after', 'partial'] : ['crash', 'crash-after'];
    for (const mode of modes) {
      const ctx = setup();
      ctx.arm((rec, idx) => (idx === ctx.base + k ? mode : null));
      await assert.rejects(run(ctx), (err) => err && err.simulatedCrash === true, `op ${k} ${mode}`);
      const proc = reader(ctx.fs.processCrashView(), ctx.id);
      const os = reader(ctx.fs.osCrashView(), ctx.id);
      const tag = `op ${k} ${ops[k].op} ${mode}`;
      const linkLanded = k > linkIdx || (k === linkIdx && mode === 'crash-after');
      if (!linkLanded) {
        assert.equal(proc.verdict, 'FAIL', tag);
        assert.equal(os.verdict, 'FAIL', tag);
        assert.ok(['W-3', 'W-4', 'W-0'].includes(proc.witness), `${tag}: ${proc.label}`);
        rows.add('before-link');
      } else {
        assert.deepEqual([proc.verdict, proc.witness], ['PASS', 'W-6'], `${tag}: process crash after the link (row 9)`);
        const kDurable = k > dirFsyncAfterLink || (k === dirFsyncAfterLink && mode === 'crash-after');
        if (kDurable) assert.deepEqual([os.verdict, os.witness], ['PASS', 'W-6'], tag);
        else assert.deepEqual([os.verdict, os.label], ['FAIL', 'FAIL(commit-missing)'], `${tag}: OS crash before the directory entry is durable (row 10)`);
        rows.add(kDurable ? 'after-link-durable' : 'after-link-not-durable');
      }
    }
  }
  assert.deepEqual([...rows].sort(), ['after-link-durable', 'after-link-not-durable', 'before-link']);
});

// ------------------------------------------------------------------------------------------
// Worked examples X9-X13, X15-X19 (closeout level)
// ------------------------------------------------------------------------------------------

const atFirst = (ctx, pred, mode = 'error') => {
  let fired = false;
  ctx.arm((rec, idx) => { if (!fired && idx >= ctx.base && pred(rec)) { fired = true; return mode; } return null; });
};
const failAllAfter = (ctx, pred) => {
  let fired = false;
  ctx.arm((rec, idx) => { if (idx < ctx.base) return null; if (fired) return 'error'; if (pred(rec)) { fired = true; return 'error'; } return null; });
};
const isOpOn = (op, name) => (rec) => rec.op === op && rec.path.split('/').pop().startsWith(name);

test('X9: primaryOverall PASS; result-JSON write or read-back fails => FAIL (row 5 via step 10), no link, F + FAILED retained', async () => {
  for (const pred of [isOpOn('open', R1_NAME), isOpOn('readFile', R1_NAME)]) {
    const ctx = setup();
    atFirst(ctx, pred);
    const r = await run(ctx);
    assert.deepEqual([r.primaryOverall, r.finalOverall, r.committed, r.exitCode], ['PASS', 'FAIL', false, 1]);
    assert.ok(r.causes[0].startsWith('r1-'), r.causes.join());
    assert.equal(linkOps(ctx).length, 0);
    const map = files(ctx);
    const f = JSON.parse(map.attempts[closeoutFailureName(ctx.id)].toString('utf8'));
    assert.deepEqual([f.primaryOverall, f.causes], ['PASS', [...r.causes]]);
    const journal = JSON.parse(map.attempts[journalName(ctx.id)].toString('utf8'));
    assert.equal(journal.transitions.at(-1).state, 'FAILED');
    assert.deepEqual(reader(ctx.fs, ctx.id).label, 'FAIL(closeout-failure-witness)');
  }
});

test('X10: R2 / R3 / K-candidate write or read-back fails => FAIL, no link, K never exists; reader W-3 when F and FAILED cannot land', async () => {
  for (const pred of [isOpOn('write', R2_NAME), isOpOn('readFile', R2_NAME), isOpOn('fsync', R3_NAME), isOpOn('readFile', R3_NAME), (rec) => rec.op === 'write' && rec.path.includes('.commit.candidate-'), (rec) => rec.op === 'readFile' && rec.path.includes('.commit.candidate-')]) {
    const ctx = setup();
    failAllAfter(ctx, pred);
    const r = await run(ctx);
    assert.deepEqual([r.finalOverall, r.committed, r.exitCode], ['FAIL', false, 1]);
    assert.equal(linkOps(ctx).length, 0);
    assert.equal(r.failurePath.failureWitnessWritten, false);
    assert.equal(r.failurePath.failedAppended, false);
    const v = reader(ctx.fs, ctx.id);
    assert.deepEqual([v.verdict, v.witness, v.label], ['FAIL', 'W-3', 'FAIL(commit-missing)']);
  }
});

test('X11: C7 FAIL (primaryOverall FAIL) and result-JSON write fails => FAIL with primaryOverall and closeout causes retained', async () => {
  const ctx = setup({ mutateState: (s) => { s.checks.C7.verdict = 'FAIL'; } });
  atFirst(ctx, isOpOn('rename', R1_NAME));
  const r = await run(ctx);
  assert.deepEqual([r.primaryOverall, r.primaryRow, r.finalOverall], ['FAIL', 3, 'FAIL']);
  assert.deepEqual([...r.causes], ['r1-write']);
  const map = files(ctx);
  assert.deepEqual(JSON.parse(map.attempts[closeoutFailureName(ctx.id)].toString('utf8')).primaryOverall, 'FAIL');
  const journal = JSON.parse(map.attempts[journalName(ctx.id)].toString('utf8'));
  assert.deepEqual(journal.transitions.at(-1).detail, { causes: ['r1-write'], primaryOverall: 'FAIL', primaryRow: 3 });
  assert.ok(r.printed.some((l) => l.includes('closeout causes: r1-write')));
});

test('X12: primaryOverall PARTIAL and result-JSON write fails => FAIL (row 5 outranks row 7)', async () => {
  const ctx = setup({ mutateState: (s) => { s.checks.C20.verdict = 'NOT_EVIDENCED(unstable-frame)'; } });
  atFirst(ctx, isOpOn('write', R1_NAME));
  const r = await run(ctx);
  assert.deepEqual([r.primaryOverall, r.finalOverall, r.exitCode], ['PARTIAL', 'FAIL', 1]);
});

test('X13 / optional rule: O2 absent, failed or timed out never affects the verdict (recorded in closeout.optional only)', async () => {
  for (const [writeO2, status] of [[null, 'absent'], [async () => { throw Object.assign(new Error('png'), { code: 'ENOSPC' }); }, 'failed:ENOSPC'], [() => new Promise(() => {}), 'failed:timeout'], [async () => 'written', 'written']]) {
    const ctx = setup();
    const r = await run(ctx, { writeO2, stepDeadlineMs: 100 });
    assert.deepEqual([r.finalOverall, r.committed], ['PASS', true], status);
    const r1 = JSON.parse(files(ctx).results[R1_NAME].toString('utf8'));
    assert.deepEqual(r1.closeout.optional, [{ name: 'O2', status }]);
  }
});

test('primary non-PASS verdicts are committed as-is through K: BLOCKED exit 2, PARTIAL exit 3, FAIL exit 1; reader agrees', async () => {
  for (const [mut, verdict, code] of [
    [(s) => { s.classifier.B = 'CONTRADICTORY'; }, 'BLOCKED', 2],
    [(s) => { s.checks.C14.verdict = 'NOT_EVIDENCED'; }, 'PARTIAL', 3],
    [(s) => { s.checks.C4.verdict = 'FAIL(not-contained)'; }, 'FAIL', 1],
  ]) {
    const ctx = setup({ mutateState: mut });
    const r = await run(ctx);
    assert.deepEqual([r.committed, r.finalOverall, r.exitCode], [true, verdict, code]);
    const v = reader(ctx.fs, ctx.id);
    assert.deepEqual([v.verdict, v.witness], [verdict, 'W-6']);
  }
});

test('X15: the K candidate landed durably but its verification read faulted => no link, FAIL; reader has no K', async () => {
  for (const mode of ['error', 'error-after']) {
    const ctx = setup();
    atFirst(ctx, (rec) => rec.op === 'readFile' && rec.path.includes('.commit.candidate-'), mode);
    const r = await run(ctx);
    assert.deepEqual([r.finalOverall, [...r.causes]], ['FAIL', ['kc-verify']]);
    assert.equal(linkOps(ctx).length, 0);
    const v = reader(ctx.fs, ctx.id);
    assert.equal(v.verdict, 'FAIL');
    assert.ok(v.witnesses.some((w) => w.witness === 'W-1') && !(commitName(ctx.id) in files(ctx).attempts));
  }
});

test('X16: linkSync returns an error (incl. EEXIST from another run\'s K) => not committed, harness FAIL exit 1, reader FAIL', async () => {
  const ctx = setup();
  atFirst(ctx, (rec) => rec.op === 'link');
  const r = await run(ctx);
  assert.deepEqual([r.committed, r.finalOverall, r.exitCode], [false, 'FAIL', 1]);
  assert.match(r.causes[0], /^link-failed:EIO$/);
  assert.equal(reader(ctx.fs, ctx.id).verdict, 'FAIL');

  const ctx2 = setup();
  const foreign = Buffer.from('{"foreign":true}\n');
  ctx2.fs.putFileForTest(`${CHAIN.D2}/${commitName(ctx2.id)}`, foreign);
  const r2 = await run(ctx2);
  assert.deepEqual([r2.committed, r2.finalOverall], [false, 'FAIL']);
  assert.equal(r2.causes[0], 'link-failed:EEXIST');
  const map = files(ctx2);
  assert.ok(map.attempts[commitName(ctx2.id)].equals(foreign), 'an existing K is never overwritten or touched');
  assert.equal(reader(ctx2.fs, ctx2.id).verdict, 'FAIL');
});

test('X17 / post-K faults: unlink, directory fsync and read-back faults, late fatal events and rejections after the commit never change PASS', async () => {
  for (const op of ['unlink', 'fsync', 'readFile']) {
    const ctx = setup();
    let linked = false;
    ctx.arm((rec) => { if (rec.op === 'link') { linked = true; return null; } return linked && rec.op === op ? 'error' : null; });
    const lines = [];
    const r = await run(ctx, { print: (l) => lines.push(l) });
    assert.deepEqual([r.committed, r.finalOverall, r.exitCode], [true, 'PASS', 0], op);
    assert.deepEqual(reader(ctx.fs, ctx.id).verdict, 'PASS', op);
    // each post-commit step is individually caught and reported; the others still ran
    const expectedObs = { unlink: ['failed:EIO', 'ok', 'match'], fsync: ['ok', 'failed:EIO', 'match'], readFile: ['ok', 'ok', 'failed:EIO'] }[op];
    assert.deepEqual([r.postCommit.unlinkCandidate, r.postCommit.directoryFsync, r.postCommit.readBack], expectedObs, op);
    if (op === 'fsync') {
      assert.equal(r.postCommit.durabilityUnconfirmed, true);
      assert.ok(lines.includes('finalOverall: PASS-UNCONFIRMED'));
      assert.ok(lines.some((l) => l.startsWith('COMMIT_DURABILITY_UNCONFIRMED')));
      assert.equal(r.exitCode, 0, 'exit code still follows K.finalOverall');
    }
  }
  // late fatal event / unhandled rejection delivered after the commit latch: ignored, verdict frozen
  const ctx = setup();
  const r = await run(ctx);
  const before = ctx.state.errorLedger.fatalCount;
  assert.equal(ctx.sink.recordFatal('pageerror', 'late'), false);
  assert.equal(ctx.sink.recordFatal('unhandledrejection', 'late'), false);
  assert.equal(ctx.sink.recordAttemptDeadline(), false);
  assert.equal(ctx.state.errorLedger.fatalCount, before);
  assert.equal(ctx.sink.ignored.length, 3);
  assert.throws(() => { 'use strict'; r.finalOverall = 'FAIL'; }, TypeError);
  assert.deepEqual([r.finalOverall, r.exitCode, reader(ctx.fs, ctx.id).verdict], ['PASS', 0, 'PASS']);
});

test('X18: a fatal event delivered during Kc quiescence => late-verdict-change, no link, reader FAIL', async () => {
  for (const hook of ['clearTimersAndSettle', 'detachListeners']) {
    const ctx = setup();
    const quiescence = { [hook]: () => { ctx.sink.recordFatal('pageerror', 'during quiescence'); } };
    const r = await run(ctx, { quiescence });
    assert.deepEqual([r.committed, r.finalOverall, [...r.causes]], [false, 'FAIL', ['late-verdict-change(fatal-event)']], hook);
    assert.equal(linkOps(ctx).length, 0);
    assert.equal(reader(ctx.fs, ctx.id).verdict, 'FAIL');
  }
  // a recorded T9 expiry (ATTEMPT_DEADLINE) during closeout changes the pre-link row => late-verdict-change
  const ctx = setup();
  const r = await run(ctx, { quiescence: { detachListeners: () => { ctx.sink.recordAttemptDeadline(); } } });
  assert.deepEqual([r.finalOverall, [...r.causes]], ['FAIL', ['late-verdict-change(verdict-changed)']]);
});

test('X19: a step deadline (T8) expires while Kc is being written => no link, FAIL; an overdue armed deadline => late-verdict-change(deadline-overdue)', async () => {
  const ctx = setup();
  const spin = (ms) => { const end = performance.now() + ms; while (performance.now() < end) { /* busy */ } };
  ctx.arm((rec) => { if (rec.op === 'write' && rec.path.includes('.commit.candidate-')) spin(5); return null; });
  const r = await run(ctx, { stepDeadlineOverridesMs: { Kc: 1 } });
  assert.deepEqual([r.committed, r.finalOverall, [...r.causes]], [false, 'FAIL', ['deadline-expired:Kc']]);
  assert.equal(linkOps(ctx).length, 0);

  const ctx2 = setup();
  const r2 = await run(ctx2, { quiescence: { deadlines: () => [{ name: 'poll:C17', deadlineAbs: performance.now() - 1 }] } });
  assert.deepEqual([r2.finalOverall, [...r2.causes]], ['FAIL', ['late-verdict-change(deadline-overdue)']]);
  // a deadline whose step completed strictly before its expiry does not count
  const ctx3 = setup();
  const t = performance.now();
  const r3 = await run(ctx3, { quiescence: { deadlines: () => [{ name: 'poll:C16', deadlineAbs: t - 1, completedMs: t - 2 }] } });
  assert.equal(r3.finalOverall, 'PASS');
});

// ------------------------------------------------------------------------------------------
// Scheduler simulation
// ------------------------------------------------------------------------------------------

test('scheduler simulation: a fatal event at every scheduling point lands before the gate (late-verdict-change, no link) or after the commit (ignored)', async () => {
  const { ops, linkIdx } = await baselineOps();
  const outcomes = { beforeGate: 0, afterCommit: 0 };
  // (1) every fs operation boundary of the closeout, the link itself and the post-commit ops
  for (let k = 0; k < ops.length; k += 1) {
    const ctx = setup();
    ctx.arm((rec, idx) => { if (idx === ctx.base + k) ctx.sink.recordFatal('pageerror', `injected@op${k}`); return null; });
    const r = await run(ctx);
    const v = reader(ctx.fs, ctx.id);
    if (k < linkIdx) {
      assert.deepEqual([r.committed, r.finalOverall, [...r.causes]], [false, 'FAIL', ['late-verdict-change(fatal-event)']], `op ${k}`);
      assert.equal(linkOps(ctx).length, 0, `op ${k}`);
      assert.equal(v.verdict, 'FAIL');
      outcomes.beforeGate += 1;
    } else {
      // at the link syscall (after the gate) or post-commit: the committed verdict is untouched
      assert.deepEqual([r.committed, r.finalOverall], [true, 'PASS'], `op ${k}`);
      assert.equal(v.verdict, 'PASS');
      outcomes.afterCommit += 1;
    }
  }
  // (2) every macrotask dispatch of the drain and the dedicated critical-section macrotask
  for (let d = 0; d < 3; d += 1) {
    const ctx = setup();
    let n = 0;
    const scheduler = { setImmediate: (fn) => setImmediate(() => { if (n === d) ctx.sink.recordFatal('unhandledrejection', `dispatch${d}`); n += 1; fn(); }) };
    const r = await run(ctx, { scheduler });
    assert.equal(n, 3, 'two drain turns + one dedicated macrotask');
    assert.deepEqual([r.committed, [...r.causes]], [false, ['late-verdict-change(fatal-event)']], `dispatch ${d}`);
    outcomes.beforeGate += 1;
  }
  // (3) every asynchronous hook of steps 3 and 7
  for (const hook of ['writeO2', 'clearTimersAndSettle', 'detachListeners', 'deadlines']) {
    const ctx = setup();
    const fire = () => { ctx.sink.recordFatal('pageerror', hook); return []; };
    const r = await run(ctx, hook === 'writeO2' ? { writeO2: async () => { fire(); } } : { quiescence: { [hook]: fire } });
    assert.deepEqual([r.committed, [...r.causes]], [false, ['late-verdict-change(fatal-event)']], hook);
    outcomes.beforeGate += 1;
  }
  // (4) after closeoutProtocol resolved (post-commit event loop turns)
  const ctx = setup();
  const r = await run(ctx);
  await new Promise((res) => setImmediate(res));
  assert.equal(ctx.sink.recordFatal('pageerror', 'after'), false);
  assert.deepEqual([r.committed, r.finalOverall], [true, 'PASS']);
  outcomes.afterCommit += 1;
  assert.ok(outcomes.beforeGate > 20 && outcomes.afterCommit >= 4, JSON.stringify(outcomes));
});

// ------------------------------------------------------------------------------------------
// R1 payload cutoff: immutability, late mutation, forbidden keys
// ------------------------------------------------------------------------------------------

test('R1 cutoff: S* is deep-frozen; a write to it after the cutoff is closeout failure r1-mutated (no link)', async () => {
  for (const hook of ['afterSnapshot', 'afterR1']) {
    const ctx = setup();
    const r = await run(ctx, { hooks: { [hook]: (S) => { S.run.checks.C1.verdict = 'FAIL'; } } });
    assert.deepEqual([r.finalOverall, [...r.causes]], ['FAIL', ['r1-mutated']], hook);
    assert.equal(linkOps(ctx).length, 0);
  }
});

test('R1 cutoff: mutating the LIVE state after the cutoff never reaches R1 bytes, and the gate then refuses (late-verdict-change)', async () => {
  const ctx = setup();
  const r = await run(ctx, { hooks: { afterSnapshot: () => { ctx.state.checks.C1.verdict = 'FAIL'; ctx.state.limitations.push('late'); } } });
  assert.deepEqual([r.finalOverall, [...r.causes]], ['FAIL', ['late-verdict-change(verdict-changed)']]);
  const r1 = JSON.parse(files(ctx).results[R1_NAME].toString('utf8'));
  assert.equal(r1.checks.C1.verdict, 'PASS', 'R1 reflects S*, not the later state');
  assert.deepEqual(r1.limitations, []);
});

test('R1 cutoff: a non-deterministic payload builder (re-serialization differs) => r1-mutated / r1-verify, no link', async () => {
  const ctx = setup();
  let calls = 0;
  const buildPayload = (S) => { calls += 1; const p = buildResultPayload(S); return calls > 1 ? { ...p, staleContinuationsDropped: calls } : p; };
  const r = await run(ctx, { buildPayload });
  assert.equal(r.finalOverall, 'FAIL');
  assert.ok(['r1-mutated', 'r1-verify'].includes(r.causes[0]), r.causes.join());
  assert.equal(linkOps(ctx).length, 0);
});

test('R1 cutoff: a payload carrying a forbidden closeout key fails R1 verification (schema), no link', async () => {
  for (const key of ['finalOverall', 'closeoutFailures', 'journalSha256']) {
    const ctx = setup();
    const r = await run(ctx, { buildPayload: (S) => ({ ...buildResultPayload(S), [key]: 'x' }) });
    assert.deepEqual([r.finalOverall, [...r.causes]], ['FAIL', ['r1-verify']], key);
    assert.equal(linkOps(ctx).length, 0);
    // the failing final-named R1 was renamed to .invalid-<uuid> (treated as unwritten)
    const names = ctx.fs.processCrashView().readdir(CHAIN.D1);
    assert.ok(!names.includes(R1_NAME) && names.some((n) => n.startsWith(`${R1_NAME}.invalid-`)), names.join());
  }
});

test('validateResultSchema: whitelist, forbidden keys at every depth, closeout/attempt shapes; only the payload mode exists', async () => {
  const ctx = setup();
  await run(ctx);
  const good = JSON.parse(files(ctx).results[R1_NAME].toString('utf8'));
  assert.ok(validateResultSchema(good, 'payload').ok);
  assert.throws(() => validateResultSchema(good, 'final'), /only 'payload'/);
  assert.throws(() => validateResultSchema(good, 'commit'), /only 'payload'/);
  const bad = (mut) => { const c = structuredClone(good); mut(c); return validateResultSchema(c, 'payload'); };
  for (const k of [...RESULT_FORBIDDEN_DEEP_KEYS, ...RESULT_FORBIDDEN_SHALLOW_KEYS]) {
    assert.equal(bad((c) => { c[k] = 1; }).ok, false, `top-level ${k}`);
    assert.equal(bad((c) => { c.closeout[k] = 1; }).ok, false, `closeout.${k}`);
  }
  for (const k of RESULT_FORBIDDEN_DEEP_KEYS) assert.equal(bad((c) => { c.checks.C5.evidence = { nested: [{ [k]: 'x' }] }; }).ok, false, `deep ${k}`);
  assert.equal(bad((c) => { c.extra = 1; }).ok, false, 'unknown key');
  for (const k of RESULT_TOP_LEVEL_KEYS) assert.equal(bad((c) => { delete c[k]; }).ok, false, `missing ${k}`);
  assert.equal(bad((c) => { c.attempt.journalStates.push({ state: 'FAILED', at: c.finishedAt }); }).ok, false, 'journal after CLOSEOUT_STARTED');
  assert.equal(bad((c) => { c.closeout.phase = 'commit'; }).ok, false);
  assert.equal(bad((c) => { c.overall.verdict = 'FAIL'; }).ok, false, 'overall must equal closeout.primaryOverall');
  assert.equal(bad((c) => { c.procedure.version = 'v4'; }).ok, false);
  assert.equal(bad((c) => { c.checks.C21 = { verdict: 'PASS' }; }).ok, false);
  assert.equal(bad((c) => { c.controls.N2.state = 'DETECTED'; }).ok, false, 'N2 must be a §7 state');
});

test('takeFrozenSnapshot: plain-JSON only, whitelisted keys only (never reads closeoutComplete), deterministic hash', () => {
  const ctx = setup();
  const journal = { ...ctx.handle.current().journal, transitions: [...ctx.handle.current().journal.transitions, { state: 'CLOSEOUT_STARTED', at: '2026-09-30T00:00:01.000Z', monotonicMs: 1e9, detail: { primaryOverall: 'PASS', primaryRow: 8 } }] };
  const args = { state: ctx.state, primary: { overall: 'PASS', row: 8 }, optional: [{ name: 'O2', status: 'absent' }], journal, finishedAt: '2026-09-30T00:00:02.000Z' };
  const a = takeFrozenSnapshot(args);
  const b = takeFrozenSnapshot(args);
  assert.equal(a.snapshotSha256, b.snapshotSha256);
  assert.ok(Object.isFrozen(a.snapshot) && Object.isFrozen(a.snapshot.run.checks.C1));
  ctx.state.checks.C1.verdict = 'FAIL';
  assert.equal(a.snapshot.run.checks.C1.verdict, 'PASS', 'deep copy, not a reference');
  for (const [label, v] of [['Map', new Map()], ['Set', new Set()], ['Date', new Date()], ['typed array', new Float64Array(2)], ['Buffer', Buffer.alloc(1)], ['NaN', NaN], ['Infinity', Infinity], ['undefined', [undefined]], ['function', () => 1]]) {
    const s = { ...ctx.state, c20: { frames: v } };
    assert.throws(() => takeFrozenSnapshot({ ...args, state: s }), /non-plain-json/, label);
  }
  assert.throws(() => takeFrozenSnapshot({ ...args, journal: ctx.handle.current().journal }), /CLOSEOUT_STARTED/);
});

test('a non-plain value in the run state => closeout failure snapshot-not-plain-json, no link', async () => {
  const ctx = setup({ mutateState: (s) => { s.c20 = { frame: new Uint8Array(4) }; } });
  const r = await run(ctx);
  assert.deepEqual([r.finalOverall, [...r.causes]], ['FAIL', ['snapshot-not-plain-json']]);
});

test('journal bytes changed on disk after Kc was hashed => journal-changed, no link', async () => {
  const ctx = setup();
  ctx.arm((rec) => {
    if (rec.op === 'readFile' && rec.path.endsWith('.journal.json') && ctx.fs.ops.some((o) => o.path.includes('.commit.candidate-'))) {
      ctx.fs.putFileForTest(rec.path, Buffer.from('{"tampered":true}'));
    }
    return null;
  });
  const r = await run(ctx);
  assert.deepEqual([r.finalOverall, [...r.causes]], ['FAIL', ['journal-changed']]);
  assert.equal(linkOps(ctx).length, 0);
});

test('closeout refuses to start from a journal that is not at ATTEMPT_CONSUMED (fail-closed; FAILED/F best-effort)', async () => {
  let armed = null;
  const fs = createRecordingFakeFs({ seedDirs: ['/repo/test/acceptance'], fault: (r, i) => (armed ? armed(r, i) : null) });
  const { handle, binding } = createOfflineAttemptFixture({ fs, chain: CHAIN });
  handle.append(JOURNAL_STATE.CLOSEOUT_STARTED, { primaryOverall: 'PASS', primaryRow: 8 });
  const state = createOfflineRunStateFixture({ binding });
  const r = await closeoutProtocol({ state, handle, fs, chain: CHAIN, commitFs: { linkSync: brandSyncLinkForTest((a, b) => fs.link(a, b)) }, allowTestLinkPrimitive: true });
  assert.deepEqual([r.primaryOverall, r.primaryRow, r.finalOverall], ['FAIL', 5, 'FAIL']);
  assert.equal(r.causes[0], 'closeout-started-write');
  assert.equal(fs.ops.filter((o) => o.op === 'link').length, 0);
});

// ------------------------------------------------------------------------------------------
// Async-link negative control (runtime)
// ------------------------------------------------------------------------------------------

test('async-link negative control: an asynchronous/late link implementation is rejected before any link; K never appears later', async () => {
  const late = (ctx) => async (a, b) => { await new Promise((res) => setTimeout(res, 20)); ctx.fs.link(a, b); };
  const variants = [
    ['async function (branded)', (ctx) => ({ linkSync: brandSyncLinkForTest(late(ctx)) }), 'async-link-primitive'],
    ['async function (unbranded)', (ctx) => ({ linkSync: late(ctx) }), 'async-link-primitive'],
    ['promise-returning plain function (fake link settles after a simulated timeout)', (ctx) => ({ linkSync: (a, b) => new Promise((res) => setTimeout(() => { ctx.fs.link(a, b); res(); }, 20)) }), 'link-primitive-not-vetted'],
    ['Promise.race(link, timeout) wrapper', (ctx) => ({ linkSync: (a, b) => Promise.race([late(ctx)(a, b), new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout')), 5))]) }), 'link-primitive-not-vetted'],
    ['fs.promises.link', () => ({ linkSync: nodeFs.promises.link }), 'async-link-primitive'],
    ['accessor (getter) linkSync', (ctx) => ({ get linkSync() { return brandSyncLinkForTest((a, b) => ctx.fs.link(a, b)); } }), 'link-primitive-accessor'],
    ['no linkSync at all', () => ({ link: () => {} }), 'link-primitive-missing'],
  ];
  for (const [label, make, cause] of variants) {
    const ctx = setup();
    const r = await run(ctx, { commitFs: make(ctx) });
    assert.deepEqual([r.committed, r.finalOverall, [...r.causes]], [false, 'FAIL', [cause]], label);
    await new Promise((res) => setTimeout(res, 40));
    assert.equal(linkOps(ctx).length, 0, `${label}: the late link never ran`);
    assert.ok(!(commitName(ctx.id) in files(ctx).attempts), `${label}: K never appears`);
    assert.equal(reader(ctx.fs, ctx.id).verdict, 'FAIL', label);
  }
});

test('linkPrimitiveProblem: node:fs linkSync accepted by identity; a branded test primitive only when explicitly allowed', () => {
  assert.equal(linkPrimitiveProblem(nodeFs, false), null);
  assert.equal(linkPrimitiveProblem({ linkSync: nodeFs.linkSync }, false), null);
  const branded = brandSyncLinkForTest(() => {});
  assert.equal(linkPrimitiveProblem({ linkSync: branded }, false), 'link-primitive-not-vetted', 'never in a live run');
  assert.equal(linkPrimitiveProblem({ linkSync: branded }, true), null);
  assert.equal(linkPrimitiveProblem({ linkSync: (a, b) => nodeFs.linkSync(a, b) }, true), 'link-primitive-not-vetted', 'a wrapper around the primitive is not the primitive');
  assert.equal(linkPrimitiveProblem(null, true), 'link-primitive-missing');
  function* gen() { yield 1; }
  assert.equal(linkPrimitiveProblem({ linkSync: gen }, true), 'async-link-primitive');
});
