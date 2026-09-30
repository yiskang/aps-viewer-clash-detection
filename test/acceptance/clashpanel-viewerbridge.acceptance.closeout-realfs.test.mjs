// test/acceptance/clashpanel-viewerbridge.acceptance.closeout-realfs.test.mjs
//
// Real-Node filesystem integration tests for the G2 harness closeout (procedure §9.1), in
// os.tmpdir() sandboxes (never test/acceptance/results/), with NO APS Viewer, browser or network:
//   - a full closeout commits K through node:fs's own linkSync (the live commit primitive, identity
//     checked; no test brand allowed) and the reader agrees;
//   - an existing K (EEXIST) is never overwritten; a real EACCES on the results directory fails
//     closed;
//   - in separate `node` child processes with real process-level handlers: a promise rejection
//     raised during the drain turn, an overdue-but-undispatched timer, and an event queued around
//     listener detachment each => late-verdict-change and no link; an unhandled rejection after the
//     commit changes nothing (verdict and exit code stay PASS / 0).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  resolveAttemptsChain,
  createNodeFsLayer,
  createOfflineAttemptFixture,
  createOfflineRunStateFixture,
  closeoutProtocol,
  deriveVerdictFromArtifacts,
  readArtifactFileMap,
  commitName,
  closeoutFailureName,
  R1_NAME,
} from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS_URL = new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url).href;

function sandbox() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'g2-closeout-'));
  mkdirSync(path.join(root, 'test', 'acceptance'), { recursive: true });
  return { root, chain: resolveAttemptsChain(root), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('real fs: full closeout commits K via node:fs linkSync (no test primitive); candidate removed; reader PASS', async () => {
  const sb = sandbox();
  try {
    const fs = createNodeFsLayer();
    const { handle, binding } = createOfflineAttemptFixture({ fs, chain: sb.chain });
    const state = createOfflineRunStateFixture({ binding });
    Object.defineProperty(state, 'closeoutComplete', { enumerable: false, get() { throw new Error('pre-K read'); } });
    const r = await closeoutProtocol({ state, handle, fs, chain: sb.chain });
    handle.close();
    assert.deepEqual([r.committed, r.finalOverall, r.exitCode], [true, 'PASS', 0]);
    assert.deepEqual(r.postCommit, { unlinkCandidate: 'ok', directoryFsync: 'ok', readBack: 'match', durabilityUnconfirmed: false });
    const names = readdirSync(sb.chain.D2).sort();
    assert.deepEqual(names, [commitName(handle.authorizationId), `${handle.authorizationId}.journal.json`, `${handle.authorizationId}.reservation.json`].sort());
    assert.equal(statSync(path.join(sb.chain.D2, commitName(handle.authorizationId))).nlink, 1, 'candidate link removed after commit');
    assert.ok(!readdirSync(sb.chain.D1).some((n) => n.includes('.tmp-') || n.includes('.invalid-')));
    const v = deriveVerdictFromArtifacts({ ...readArtifactFileMap({ fs, chain: sb.chain }), authorizationId: handle.authorizationId });
    assert.deepEqual([v.verdict, v.witness], ['PASS', 'W-6']);
  } finally { sb.cleanup(); }
});

test('real fs: an existing K (another run\'s) makes linkSync throw EEXIST => FAIL, K untouched, F written, reader FAIL', async () => {
  const sb = sandbox();
  try {
    const fs = createNodeFsLayer();
    const { handle, binding } = createOfflineAttemptFixture({ fs, chain: sb.chain });
    const kPath = path.join(sb.chain.D2, commitName(handle.authorizationId));
    writeFileSync(kPath, '{"foreign":true}\n');
    const r = await closeoutProtocol({ state: createOfflineRunStateFixture({ binding }), handle, fs, chain: sb.chain });
    handle.close();
    assert.deepEqual([r.committed, r.finalOverall, r.exitCode, [...r.causes]], [false, 'FAIL', 1, ['link-failed:EEXIST']]);
    assert.equal(readFileSync(kPath, 'utf8'), '{"foreign":true}\n');
    assert.ok(readdirSync(sb.chain.D2).includes(closeoutFailureName(handle.authorizationId)));
    assert.ok(!readdirSync(sb.chain.D2).some((n) => n.includes('.commit.candidate-')), 'candidate removed best-effort');
    assert.equal(deriveVerdictFromArtifacts({ ...readArtifactFileMap({ fs, chain: sb.chain }), authorizationId: handle.authorizationId }).verdict, 'FAIL');
  } finally { sb.cleanup(); }
});

test('real fs: a real EACCES on the results directory fails closed before any K candidate or link', { skip: process.getuid && process.getuid() === 0 ? 'root ignores permissions' : false }, async () => {
  const sb = sandbox();
  try {
    const fs = createNodeFsLayer();
    const { handle, binding } = createOfflineAttemptFixture({ fs, chain: sb.chain });
    chmodSync(sb.chain.D1, 0o555);
    let r;
    try { r = await closeoutProtocol({ state: createOfflineRunStateFixture({ binding }), handle, fs, chain: sb.chain }); } finally { chmodSync(sb.chain.D1, 0o755); }
    handle.close();
    assert.deepEqual([r.committed, r.finalOverall, [...r.causes]], [false, 'FAIL', ['r1-write']]);
    assert.ok(!readdirSync(sb.chain.D1).includes(R1_NAME));
    assert.ok(!readdirSync(sb.chain.D2).some((n) => n.includes('.commit.')));
    const v = deriveVerdictFromArtifacts({ ...readArtifactFileMap({ fs, chain: sb.chain }), authorizationId: handle.authorizationId });
    assert.equal(v.verdict, 'FAIL');
  } finally { sb.cleanup(); }
});

// ------------------------------------------------------------------------------------------
// Child-process scenarios (real event loop, real process-level handlers)
// ------------------------------------------------------------------------------------------

const CHILD = `
import * as H from ${JSON.stringify(HARNESS_URL)};
import { EventEmitter } from 'node:events';
import path from 'node:path';
const root = process.env.G2_ROOT;
const scenario = process.env.G2_SCENARIO;
const chain = H.resolveAttemptsChain(root);
const fs = H.createNodeFsLayer();
const { handle, binding } = H.createOfflineAttemptFixture({ fs, chain });
const state = H.createOfflineRunStateFixture({ binding });
const sink = H.createFatalEventSink(state.errorLedger);
H.installProcessFatalHandlers({ proc: process, sink });
const page = new EventEmitter();
const onPageError = (e) => sink.recordFatal('pageerror', e && e.message);
page.on('pageerror', onPageError);
let timer = null;
let timerAbs = null;
const spin = (ms) => { const end = performance.now() + ms; while (performance.now() < end) {} };
const quiescence = {
  deadlines: () => (timerAbs === null ? [] : [{ name: 'poll:child', deadlineAbs: timerAbs }]),
  clearTimersAndSettle: async () => {
    if (scenario === 'overdue-timer') { spin(80); clearTimeout(timer); }
  },
  detachListeners: () => {
    if (scenario === 'drain-rejection') {
      // nest the rejection G2_DEPTH immediates deep: 1 = before drain turn 1, 2 = same loop
      // iteration as drain turn 2, 3 = same iteration as (just before) the critical macrotask,
      // 4 = the iteration after the critical macrotask (post-commit).
      const depth = Number(process.env.G2_DEPTH || '1');
      const nest = (n) => setImmediate(() => { if (n <= 1) Promise.reject(new Error('rejection raised during the drain')); else nest(n - 1); });
      nest(depth);
    }
    if (scenario === 'queued-event') {
      const deliver = onPageError;
      setImmediate(() => deliver(new Error('pageerror queued before detachment')));
    }
    if (scenario === 'event-during-detach') page.emit('pageerror', new Error('emitted while detaching'));
    page.off('pageerror', onPageError);
  },
};
const writeO2 = scenario === 'overdue-timer'
  ? async () => { timer = setTimeout(() => sink.recordFatal('T-expiry', 'fired'), 30); timerAbs = performance.now() + 30; return 'absent'; }
  : null;
const print = scenario === 'post-commit-rejection'
  ? (line) => { if (line.startsWith('finalOverall')) Promise.reject(new Error('unhandled rejection after the commit')); }
  : () => {};
const r = await H.closeoutProtocol({ state, handle, fs, chain, sink, quiescence, writeO2, print });
await new Promise((res) => setTimeout(res, 20));
const v = H.deriveVerdictFromArtifacts({ ...H.readArtifactFileMap({ fs, chain }), authorizationId: handle.authorizationId });
handle.close();
const names = (await import('node:fs')).readdirSync(chain.D2);
process.stdout.write(JSON.stringify({
  committed: r.committed, finalOverall: r.finalOverall, exitCode: r.exitCode, causes: r.causes,
  reader: v.label, kExists: names.includes(H.commitName(handle.authorizationId)),
  fatalCount: state.errorLedger.fatalCount, ignored: sink.ignored.length,
}));
process.exitCode = r.exitCode;
`;

function runChild(scenario, extraEnv = {}) {
  const sb = sandbox();
  try {
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
      env: { ...process.env, G2_ROOT: sb.root, G2_SCENARIO: scenario, NODE_TEST_CONTEXT: '', ...extraEnv },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(out.error, undefined, String(out.error));
    let parsed;
    try { parsed = JSON.parse(out.stdout); } catch { assert.fail(`child ${scenario} printed no JSON: ${out.stdout}\n${out.stderr}`); }
    return { ...parsed, status: out.status };
  } finally { sb.cleanup(); }
}

test('child process baseline: real handlers installed, no late event => PASS committed, exit 0', () => {
  const r = runChild('baseline');
  assert.deepEqual([r.committed, r.finalOverall, r.reader, r.kExists, r.status], [true, 'PASS', 'PASS', true, 0]);
});

test('child process: a promise rejection raised during the drain reaches the ledger before the critical macrotask => late-verdict-change, no link; one landing after it is post-commit and ignored', () => {
  for (const depth of ['1', '2', '3']) {
    const r = runChild('drain-rejection', { G2_DEPTH: depth });
    assert.deepEqual([r.committed, r.finalOverall, r.causes, r.kExists, r.status], [false, 'FAIL', ['late-verdict-change(fatal-event)'], false, 1], `depth ${depth}`);
    assert.equal(r.fatalCount, 1, `depth ${depth}`);
    assert.equal(r.reader.startsWith('FAIL'), true, `depth ${depth}`);
  }
  const after = runChild('drain-rejection', { G2_DEPTH: '4' });
  assert.deepEqual([after.committed, after.finalOverall, after.reader, after.fatalCount, after.ignored, after.status], [true, 'PASS', 'PASS', 0, 1, 0], 'depth 4 (after the commit)');
});

test('child process: an overdue timer cleared before it dispatched is still caught by the gate deadlineAbs re-check => late-verdict-change, no link', () => {
  const r = runChild('overdue-timer');
  assert.deepEqual([r.committed, r.finalOverall, r.causes, r.kExists], [false, 'FAIL', ['late-verdict-change(deadline-overdue)'], false]);
  assert.equal(r.fatalCount, 0, 'the timer never fired (the loop was blocked, then it was cleared)');
});

test('child process: an event queued around listener detachment is delivered during the drain => late-verdict-change, no link', () => {
  for (const scenario of ['queued-event', 'event-during-detach']) {
    const r = runChild(scenario);
    assert.deepEqual([r.committed, r.finalOverall, r.causes, r.kExists], [false, 'FAIL', ['late-verdict-change(fatal-event)'], false], scenario);
  }
});

test('child process: an unhandled rejection after the commit is ignored by the latched handlers => PASS, exit code 0', () => {
  const r = runChild('post-commit-rejection');
  assert.deepEqual([r.committed, r.finalOverall, r.exitCode, r.reader, r.status], [true, 'PASS', 0, 'PASS', 0]);
  assert.equal(r.fatalCount, 0);
  assert.equal(r.ignored, 1);
});

