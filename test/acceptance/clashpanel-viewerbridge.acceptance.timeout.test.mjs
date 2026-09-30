// test/acceptance/clashpanel-viewerbridge.acceptance.timeout.test.mjs
//
// Offline tests for the timeout contract (procedure §4.5, Table T): token-bounded deadlines, late
// completion quarantine, BLOCKED vs FAIL classes, and the T9 attempt timer. Deterministic fake timers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runWithDeadline,
  createTimeoutQuarantine,
  classifyTimeout,
  OP_DEADLINE_SPECS,
  createAttemptDeadlineTimer,
  createFatalEventSink,
  DEADLINE_TOKEN_STATE,
  transitionDeadlineToken,
  createDeadlineToken,
  TABLE_T,
} from './clashpanel-viewerbridge.acceptance.mjs';

/** Manual timer: `advance(ms)` fires due callbacks in order. */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { const id = nextId++; pending.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { pending.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now) { pending.delete(id); t.fn(); }
    },
    get pendingCount() { return pending.size; },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

test('completes before the deadline: value delivered, timer cleared, token completed', async () => {
  const timers = fakeTimers();
  const out = await runWithDeadline({ op: 'load', timeoutMs: 100, fn: async () => 'v', timers });
  assert.equal(out.status, 'completed');
  assert.equal(out.value, 'v');
  assert.equal(out.token.state, DEADLINE_TOKEN_STATE.COMPLETED);
  assert.equal(timers.pendingCount, 0);
});

test('a synchronous throw and a rejection are both reported as threw (never rejects the helper)', async () => {
  const timers = fakeTimers();
  const a = await runWithDeadline({ op: 'x', timeoutMs: 10, fn: () => { throw new Error('sync'); }, timers });
  assert.equal(a.status, 'threw');
  assert.equal(a.error.message, 'sync');
  const b = await runWithDeadline({ op: 'x', timeoutMs: 10, fn: async () => { throw new Error('async'); }, timers });
  assert.equal(b.status, 'threw');
  assert.equal(timers.pendingCount, 0);
});

test('timeout: resolves timed-out, token timed-out, isLive false; late fulfilment is quarantined, counted and never delivered', async () => {
  const timers = fakeTimers();
  const quarantine = createTimeoutQuarantine();
  let release;
  let liveAtStart = null;
  let liveAfter = null;
  const p = runWithDeadline({
    op: 'present', timeoutMs: 50, mutating: true, timers, quarantine,
    fn: ({ isLive }) => new Promise((resolve) => { liveAtStart = isLive(); release = () => { liveAfter = isLive(); resolve('late-value'); }; }),
  });
  timers.advance(50);
  const out = await p;
  assert.equal(out.status, 'timed-out');
  assert.equal(out.op, 'present');
  assert.equal(out.timeoutMs, 50);
  assert.equal(out.token.state, DEADLINE_TOKEN_STATE.TIMED_OUT);
  assert.equal(liveAtStart, true);
  assert.equal(quarantine.staleContinuationsDropped, 0);
  release();
  await flush();
  assert.equal(liveAfter, false, 'the continuation can see it is no longer live');
  assert.equal(quarantine.staleContinuationsDropped, 1);
  assert.deepEqual(quarantine.events[0], { op: 'present', tokenId: out.token.id, kind: 'fulfilled' });
  assert.equal(out.value, undefined);
});

test('late rejection after a timeout is swallowed into the quarantine (no unhandled rejection)', async () => {
  const timers = fakeTimers();
  const quarantine = createTimeoutQuarantine();
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    let fail;
    const p = runWithDeadline({ op: 'screenshot', timeoutMs: 10, timers, quarantine, fn: () => new Promise((_, reject) => { fail = () => reject(new Error('late boom')); }) });
    timers.advance(10);
    assert.equal((await p).status, 'timed-out');
    fail();
    await flush();
    await flush();
    assert.equal(quarantine.staleContinuationsDropped, 1);
    assert.equal(quarantine.events[0].kind, 'rejected');
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('a result that lands at the same tick as the deadline cannot produce two outcomes', async () => {
  const timers = fakeTimers();
  const quarantine = createTimeoutQuarantine();
  let resolveFn;
  const p = runWithDeadline({ op: 'load', timeoutMs: 10, timers, quarantine, fn: () => new Promise((r) => { resolveFn = r; }) });
  timers.advance(10);
  resolveFn('x');
  const out = await p;
  assert.equal(out.status, 'timed-out');
  await flush();
  assert.equal(quarantine.staleContinuationsDropped, 1);
});

test('token state machine: no revival of a timed-out token; abandoned only from timed-out', () => {
  const t = createDeadlineToken({});
  transitionDeadlineToken(t, DEADLINE_TOKEN_STATE.TIMED_OUT);
  assert.throws(() => transitionDeadlineToken(t, DEADLINE_TOKEN_STATE.COMPLETED), /illegal transition/);
  transitionDeadlineToken(t, DEADLINE_TOKEN_STATE.ABANDONED);
  assert.throws(() => transitionDeadlineToken(t, DEADLINE_TOKEN_STATE.DISPOSED), /illegal transition/);
  const a = createDeadlineToken({});
  assert.throws(() => transitionDeadlineToken(a, DEADLINE_TOKEN_STATE.ABANDONED), /illegal transition/);
});

test('input validation: op, timeoutMs, fn', () => {
  assert.throws(() => runWithDeadline({ op: '', timeoutMs: 1, fn() {} }), /op required/);
  assert.throws(() => runWithDeadline({ op: 'x', timeoutMs: 0, fn() {} }), /timeoutMs/);
  assert.throws(() => runWithDeadline({ op: 'x', timeoutMs: Infinity, fn() {} }), /timeoutMs/);
  assert.throws(() => runWithDeadline({ op: 'x', timeoutMs: 5 }), /fn required/);
});

test('classification: BLOCKED timeouts (T2, T3, T4, T5, T7) never FAIL; control scope gives TIMED_OUT', () => {
  for (const op of ['load', 'tree-enumeration', 'camera-settle', 'present', 'clear', 'dispose', 'screenshot']) {
    const c = classifyTimeout({ op });
    assert.equal(c.verdict, 'BLOCKED', op);
    assert.equal(c.reason, `timeout:${op}`);
    assert.equal(c.controlState, null);
    assert.equal(c.forbidMutating, true);
    assert.equal(c.proceedToCleanup, true);
    assert.equal(c.exception, null);
    assert.equal(classifyTimeout({ op, scope: 'control' }).controlState, 'TIMED_OUT');
  }
});

test('classification: taint for mutating ops, Table-T taint rows, and unknown completion; none for read-only', () => {
  assert.equal(classifyTimeout({ op: 'present' }).sessionTainted, true);
  assert.equal(classifyTimeout({ op: 'dispose' }).sessionTainted, true);
  assert.equal(classifyTimeout({ op: 'screenshot' }).sessionTainted, true, 'T7: BLOCKED + taint');
  assert.equal(classifyTimeout({ op: 'load' }).sessionTainted, true, 'loading is mutating');
  assert.equal(classifyTimeout({ op: 'camera-settle' }).sessionTainted, false);
  assert.equal(classifyTimeout({ op: 'tree-enumeration' }).sessionTainted, false);
  assert.equal(classifyTimeout({ op: 'camera-settle', completionUnknown: true }).sessionTainted, true);
  assert.equal(classifyTimeout({ op: 'camera-settle', mutating: true }).sessionTainted, true);
});

test('classification: FAIL only for T6 absent event (E4), T9 attempt cap (E5), T1 Phase-0 step (E5), and T8 with unresolved ownership', () => {
  const ev = classifyTimeout({ op: 'expected-event' });
  assert.deepEqual([ev.verdict, ev.reason, ev.exception], ['FAIL', 'expected-event-absent:expected-event', 'E4']);
  const att = classifyTimeout({ op: 'attempt' });
  assert.deepEqual([att.verdict, att.reason, att.overallRow, att.exception], ['FAIL', 'ATTEMPT_DEADLINE', 5, 'E5']);
  const p0 = classifyTimeout({ op: 'phase0-step' });
  assert.deepEqual([p0.verdict, p0.consumesAttempt, p0.exception], ['FAIL', false, 'E5']);
  const resolved = classifyTimeout({ op: 'cleanup-step' });
  assert.deepEqual([resolved.verdict, resolved.overallRow], ['STEP_FAILED', 7]);
  const unresolved = classifyTimeout({ op: 'cleanup-step', ownershipUnresolved: true });
  assert.deepEqual([unresolved.verdict, unresolved.overallRow, unresolved.reason], ['FAIL', 2, 'cleanup-step-timeout-ownership-unresolved']);
  assert.throws(() => classifyTimeout({ op: 'nope' }), /unknown op/);
  assert.throws(() => classifyTimeout({ op: 'load', scope: 'phase' }), /unknown scope/);
  // the exact set of FAIL-capable ops
  const failCapable = Object.keys(OP_DEADLINE_SPECS).filter((op) => classifyTimeout({ op, ownershipUnresolved: true }).verdict === 'FAIL').sort();
  assert.deepEqual(failCapable, ['attempt', 'cleanup-step', 'expected-event', 'phase0-step']);
});

test('attempt timer (T9): expiry records ATTEMPT_DEADLINE on the sink; disarm prevents it; commit latch ignores it', () => {
  const timers = fakeTimers();
  const ledger = { fatalCount: 0, entries: [], attemptDeadlineExpired: false };
  const sink = createFatalEventSink(ledger);
  const timer = createAttemptDeadlineTimer({ sink, timers });
  assert.equal(timer.arm(), true);
  assert.equal(timer.arm(), false, 'arm is idempotent');
  assert.equal(timer.isArmed(), true);
  timers.advance(TABLE_T.T9.wholeAttemptCapMs - 1);
  assert.equal(ledger.attemptDeadlineExpired, false);
  timers.advance(1);
  assert.equal(ledger.attemptDeadlineExpired, true);
  assert.equal(timer.hasExpired(), true);
  assert.equal(timer.isArmed(), false);

  const t2 = fakeTimers();
  const ledger2 = { fatalCount: 0, entries: [], attemptDeadlineExpired: false };
  const timer2 = createAttemptDeadlineTimer({ sink: createFatalEventSink(ledger2), timers: t2 });
  timer2.arm();
  timer2.disarm();
  t2.advance(TABLE_T.T9.wholeAttemptCapMs * 2);
  assert.equal(ledger2.attemptDeadlineExpired, false);
  assert.equal(t2.pendingCount, 0);

  const t3 = fakeTimers();
  const ledger3 = { fatalCount: 0, entries: [], attemptDeadlineExpired: false };
  const sink3 = createFatalEventSink(ledger3);
  const timer3 = createAttemptDeadlineTimer({ sink: sink3, timers: t3 });
  timer3.arm();
  sink3.markCommitted();
  t3.advance(TABLE_T.T9.wholeAttemptCapMs);
  assert.equal(ledger3.attemptDeadlineExpired, false, 'an expiry after the commit latch is ignored');
  assert.equal(sink3.ignored.length, 1);
});

test('real timers: a short deadline really times out and the late result is quarantined', async () => {
  const quarantine = createTimeoutQuarantine();
  const out = await runWithDeadline({ op: 'load', timeoutMs: 20, quarantine, fn: () => new Promise((r) => setTimeout(() => r('late'), 60)) });
  assert.equal(out.status, 'timed-out');
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(quarantine.staleContinuationsDropped, 1);
});
