// Tests for CTM8-P0-v4 cell runner policy (§7.5, §7.6) against a mocked scenario module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCell, GlobalFailure } from '../lib/cellRunner.mjs';

const warmSpec = { family: 'R', scenario: 'R-BASE', scale: 100, nModels: 1, kind: 'warm', profile: 'UNIFORM', cellId: 'R-BASE/100/1' };
const coldSpec = { ...warmSpec, scenario: 'R-COLD', kind: 'cold', cellId: 'R-COLD/100/1' };
const mSpec = { family: 'M', scenario: 'M-BASE', scale: 1000, nModels: 2, kind: 'warm', profile: null, cellId: 'M-BASE/1000/2' };

const okSample = { status: 'OK', durationMs: 1, notificationCount: 1, yieldDelta: 0, catalogListDelta: null, extra: {} };
const timeout = { ...okSample, status: 'TIMEOUT', durationMs: 31000 };

function mock({ setup = { status: 'OK', manifest: { m: 1 } }, run = () => okSample, prepare = () => ({ ok: true }), reset = () => ({ ok: true }) } = {}) {
  const calls = { prepare: 0, run: 0, reset: 0, teardown: 0 };
  const factory = () => ({
    setup: async () => setup,
    prepareSample: async () => prepare(calls.prepare++),
    runSample: async () => run(calls.run++),
    resetSample: async () => reset(calls.reset++),
    teardown: async () => { calls.teardown++; },
  });
  return { factory, calls };
}

const go = async (spec, m) => {
  const records = [];
  const result = await runCell({ cellSpec: spec, createCell: m.factory, launchIndex: 1, sink: { append: (r) => records.push(r) } });
  return { result, records };
};

test('warm cell: 5 warm-up + 30 measured, labelled fields', async () => {
  const m = mock();
  const { result, records } = await go(warmSpec, m);
  assert.equal(records.length, 35);
  assert.equal(records.filter((r) => r.phase === 'warmup').length, 5);
  assert.equal(records.filter((r) => r.phase === 'measured').length, 30);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.n_valid, 30);
  assert.equal(m.calls.teardown, 1);
  const r = records[0];
  assert.equal(r.protocol, 'CTM8-P0-v4');
  assert.equal(r['R.N_results'], 100);
  assert.ok(!('M.N_tests' in r) && !('N' in r) && !('count' in r));
  assert.equal(r.profile, 'UNIFORM');
});

test('family M record uses M.N_tests only', async () => {
  const { records } = await go(mSpec, mock());
  assert.equal(records[0]['M.N_tests'], 1000);
  assert.ok(!('R.N_results' in records[0]));
  assert.equal(records[0].profile, null);
});

test('cold cell: 0 warm-up, 15 measured', async () => {
  const { result, records } = await go(coldSpec, mock());
  assert.equal(records.length, 15);
  assert.ok(records.every((r) => r.phase === 'measured'));
  assert.equal(result.n_valid, 15);
});

test('TIMEOUT retained, excluded from n_valid, repetitions continue', async () => {
  const m = mock({ run: (i) => (i === 10 ? { ...okSample, durationMs: 30000 } : i === 12 ? timeout : okSample) });
  const { result, records } = await go(warmSpec, m);
  assert.equal(records.length, 35);
  assert.equal(records.filter((r) => r.status === 'TIMEOUT').length, 2);
  assert.ok(records.filter((r) => r.status === 'TIMEOUT').every((r) => r.durationMs >= 30000));
  assert.equal(result.n_timeout, 2);
  assert.equal(result.n_valid, 28);
  assert.equal(result.status, 'COMPLETED');
});

test('thrown runSample error becomes INVALID with message; consecutive INVALID does not abort', async () => {
  const m = mock({ run: (i) => { if (i >= 6 && i < 10) throw new Error('boom'); return okSample; } });
  const { result, records } = await go(warmSpec, m);
  assert.equal(records.length, 35);
  const bad = records.filter((r) => r.status === 'INVALID');
  assert.equal(bad.length, 4);
  assert.equal(bad[0].extra.error, 'boom');
  assert.equal(result.n_invalid, 4);
  assert.equal(result.status, 'COMPLETED');
});

test('3 consecutive TIMEOUTs abort that cell only, keeping samples', async () => {
  const bad = mock({ run: (i) => (i >= 2 ? timeout : okSample) });
  const { result, records } = await go(warmSpec, bad);
  assert.equal(result.status, 'ABORTED — consecutive failures');
  assert.equal(records.length, 5);
  assert.equal(bad.calls.teardown, 1);
  const next = await go(warmSpec, mock());
  assert.equal(next.result.status, 'COMPLETED');
});

test('non-consecutive failures do not abort', async () => {
  const m = mock({ run: (i) => (i % 3 === 2 ? timeout : okSample) });
  const { result } = await go(warmSpec, m);
  assert.equal(result.status, 'COMPLETED');
});

test('setup statuses map to cell statuses and run nothing', async () => {
  const cases = [
    ['SETUP_TIMEOUT', 'NOT EXECUTED — setup timeout'],
    ['INVALID_SETUP', 'INVALID_SETUP'],
    ['UNAVAILABLE', 'UNAVAILABLE'],
  ];
  for (const [s, expected] of cases) {
    const m = mock({ setup: { status: s, reason: 'why', manifest: { k: 1 } } });
    const { result, records } = await go(warmSpec, m);
    assert.equal(result.status, expected);
    assert.equal(result.reason, 'why');
    assert.equal(records.length, 0);
    assert.equal(m.calls.run, 0);
    assert.equal(m.calls.teardown, 1);
  }
});

test('prepare failure: INVALID_SETUP, never retried, run skipped; 3 in a row abort', async () => {
  const m = mock({ prepare: () => ({ ok: false, reason: 'pre-state' }) });
  const { result, records } = await go(warmSpec, m);
  assert.equal(m.calls.prepare, 3);
  assert.equal(m.calls.run, 0);
  assert.equal(records.length, 3);
  assert.ok(records.every((r) => r.status === 'INVALID_SETUP' && r.extra.reason === 'pre-state'));
  assert.equal(result.status, 'ABORTED — consecutive failures');
});

test('isolated prepare failure keeps iteration count and is not retried', async () => {
  const m = mock({ prepare: (i) => (i === 7 ? { ok: false, reason: 'x' } : { ok: true }) });
  const { result, records } = await go(warmSpec, m);
  assert.equal(records.length, 35);
  assert.equal(m.calls.prepare, 35);
  assert.equal(records[7].status, 'INVALID_SETUP');
  assert.equal(result.n_invalid, 1);
});

test('reset failure after OK: INVALID_SETUP, timed evidence retained, excluded', async () => {
  const m = mock({ run: () => ({ ...okSample, durationMs: 7, notificationCount: 3, yieldDelta: 2, extra: { k: 1 } }),
    reset: (i) => (i === 8 ? { ok: false, reason: 'reset' } : { ok: true }) });
  const { result, records } = await go(warmSpec, m);
  const r = records[8];
  assert.equal(r.status, 'INVALID_SETUP');
  assert.equal(r.durationMs, 7);
  assert.equal(r.notificationCount, 3);
  assert.equal(r.yieldDelta, 2);
  assert.deepEqual(r.extra, { k: 1, resetFailure: 'reset', measuredStatus: 'OK' });
  assert.equal(result.n_invalid, 1); // iteration 8 is measured (warm-ups are 0-4)
  assert.equal(result.n_valid, 29);
});

test('reset failure after TIMEOUT: stays TIMEOUT, counted as timeout, reset failure recorded', async () => {
  const m = mock({ run: (i) => (i === 9 ? timeout : okSample), reset: (i) => (i === 9 ? { ok: false, reason: 'rst' } : { ok: true }) });
  const { result, records } = await go(warmSpec, m);
  assert.equal(records[9].status, 'TIMEOUT');
  assert.equal(records[9].durationMs, 31000);
  assert.equal(records[9].extra.resetFailure, 'rst');
  assert.equal(records[9].extra.measuredStatus, 'TIMEOUT');
  assert.equal(result.n_timeout, 1);
  assert.equal(result.n_invalid, 0);
});

test('mixed TIMEOUT and reset-failure samples count toward consecutive abort', async () => {
  const m = mock({ run: (i) => (i < 2 ? okSample : timeout), reset: (i) => (i === 3 ? { ok: false, reason: 'r' } : { ok: true }) });
  const { result } = await go(warmSpec, m);
  assert.equal(result.status, 'ABORTED — consecutive failures');
});

test('non-Global teardown rejection after success -> CLEANUP_FAILED, measurements retained', async () => {
  const m = mock();
  const factory = (spec) => ({ ...m.factory(spec), teardown: async () => { throw new Error('leak'); } });
  const records = [];
  const result = await runCell({ cellSpec: warmSpec, createCell: factory, launchIndex: 0, sink: { append: (r) => records.push(r) } });
  assert.equal(result.status, 'CLEANUP_FAILED');
  assert.equal(result.cleanupFailed, true);
  assert.equal(result.reason, 'leak');
  assert.equal(result.n_valid, 30);
  assert.equal(records.length, 35);
});

test('simultaneous run failure and teardown failure keep primary and attach teardownError', async () => {
  const mk = (setup) => () => ({
    setup: async () => setup,
    prepareSample: async () => ({ ok: true }),
    runSample: async () => timeout,
    resetSample: async () => ({ ok: true }),
    teardown: async () => { throw new Error('td'); },
  });
  const aborted = await runCell({ cellSpec: warmSpec, createCell: mk({ status: 'OK', manifest: {} }), launchIndex: 0, sink: { append() {} } });
  assert.equal(aborted.status, 'ABORTED — consecutive failures');
  assert.equal(aborted.cleanupFailed, true);
  assert.equal(aborted.teardownError.message, 'td');
  const factory = () => ({ ...mk({ status: 'OK' })(), runSample: async () => { throw new GlobalFailure('g'); } });
  await assert.rejects(
    runCell({ cellSpec: warmSpec, createCell: factory, launchIndex: 0, sink: { append() {} } }),
    (e) => e instanceof GlobalFailure && e.teardownError?.message === 'td',
  );
});

test('GlobalFailure propagates (runSample and setup) and teardown still runs', async () => {
  const m = mock({ run: (i) => { if (i === 3) throw new GlobalFailure('crash'); return okSample; } });
  await assert.rejects(go(warmSpec, m), (e) => e instanceof GlobalFailure && e.code === 'GLOBAL_FAILURE');
  assert.equal(m.calls.teardown, 1);
  const factory = () => ({ setup: async () => { throw new GlobalFailure('gen'); }, teardown: async () => {} });
  await assert.rejects(runCell({ cellSpec: warmSpec, createCell: factory, launchIndex: 0, sink: { append() {} } }), GlobalFailure);
});
