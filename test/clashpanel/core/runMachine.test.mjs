// test/clashpanel/core/runMachine.test.mjs — Task 8 (spec §7.1-§7.3, AC-P3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUN_PHASE, initialRunState, reduceRun, canRun, canStop } from '../../../clashpanel/core/runMachine.js';
import { createClashTestEngine } from '../../../clashtest/index.js';
import { createEngineWorld } from '../../clashtest/support/engineWorld.mjs';
import { createScriptedExecutor } from '../../clashtest/support/scriptedExecutor.mjs';
import { createFakeClock } from '../../clashtest/support/fakeClock.mjs';

// ---- real Core shapes (copied from clashtest/run/Run.js emissions; verified against a real run below) ----
const snap = (over = {}) => ({
  runId: 'r1', status: 'queued', phase: 'queued', seq: 0, unitsTotal: 0, unitsEvaluated: 0, unitsFailedOrSkipped: 0,
  pairSpaceTotal: 0, pairSpaceEvaluated: 0, pairSpaceProcessed: 0, fractionEvaluated: null, fractionProcessed: null,
  resultsFound: 0, caveatCount: 0, caveatUnclassified: 0, currentUnitId: null, elapsedMs: 0, ...over,
});
const ev = (type, seq, status, phase, extra = {}) => ({ type, seq, status, phase, ...extra });
const core = (event, snapshot = snap({ seq: event.seq, status: event.status ?? 'running', phase: event.phase ?? 'executing' })) =>
  ({ type: 'core-event', event, snapshot });
const saved = { state: 'saved', timedOut: false, attempt: 1 };
const admitted = () => reduceRun(initialRunState(), { type: 'admitted', snapshot: snap(), atMs: 1000 });
const fold = (events, s = admitted()) => events.reduce(reduceRun, s);

test('initial state is idle, Run enabled, Stop disabled, no ETA-like key anywhere', () => {
  const s = initialRunState();
  assert.equal(s.phase, RUN_PHASE.IDLE);
  assert.equal(canRun(s), true);
  assert.equal(canStop(s), false);
  assert.deepEqual(Object.keys(s).sort(),
    ['admissionError', 'lastSeq', 'phase', 'progress', 'runId', 'startedAtMs', 'stopRequested', 'terminal', 'waitingForOtherRun']);
  assert.ok(Object.isFrozen(s));
});

test('§7.1 table: every Panel state is entered from the real Core signal', () => {
  const rows = [
    // [label, events after admission, expected phase]
    ['admitted (queued snapshot, no event)', [], RUN_PHASE.PREPARING],
    ['first state event planning/enumerating', [core(ev('state', 1, 'planning', 'enumerating'))], RUN_PHASE.PLANNING],
    ['unit event running/executing', [core(ev('state', 1, 'planning', 'enumerating')), core(ev('unit', 2, 'running', 'executing'))], RUN_PHASE.RUNNING],
    ['cancelling', [core(ev('unit', 2, 'running', 'executing')), core(ev('state', 3, 'cancelling', 'executing'))], RUN_PHASE.STOPPING],
    ['sealed: terminal status + finalizing', [core(ev('unit', 2, 'running', 'executing')), core(ev('state', 3, 'completed', 'finalizing'))], RUN_PHASE.FINALIZING],
    ['terminal event before done', [core(ev('state', 3, 'completed', 'finalizing')), core(ev('state', 5, 'completed', 'terminal', { terminal: true, persistence: saved }))], RUN_PHASE.FINALIZING],
  ];
  for (const [label, events, expected] of rows) assert.equal(fold(events).phase, expected, label);
  const done = fold([{ type: 'done', summary: { status: 'completed', resultSet: { results: [] }, persistence: saved } }]);
  assert.equal(done.phase, RUN_PHASE.DONE);
  assert.equal(canRun(done), true);
  assert.equal(canStop(done), false);
});

test('Stop is enabled in every non-terminal state and moves to stopping (finalizing stays finalizing)', () => {
  const states = {
    preparing: admitted(),
    planning: fold([core(ev('state', 1, 'planning', 'enumerating'))]),
    running: fold([core(ev('unit', 2, 'running', 'executing'))]),
    finalizing: fold([core(ev('state', 3, 'cancelled', 'finalizing'))]),
  };
  for (const [label, s] of Object.entries(states)) {
    assert.equal(canStop(s), true, `${label}: Stop enabled`);
    assert.equal(canRun(s), false, `${label}: Run disabled while our run is non-terminal`);
    const after = reduceRun(s, { type: 'stop-requested' });
    assert.equal(after.stopRequested, true);
    assert.equal(after.phase, label === 'finalizing' ? RUN_PHASE.FINALIZING : RUN_PHASE.STOPPING, label);
    assert.equal(canStop(after), true, `${label}: a second Stop stays enabled (Core absorbs it)`);
  }
  assert.equal(reduceRun(initialRunState(), { type: 'stop-requested' }).phase, RUN_PHASE.IDLE);
});

test('a requested Stop is never visually undone by a later planning/unit event', () => {
  const s = fold([{ type: 'stop-requested' }, core(ev('state', 1, 'planning', 'enumerating')), core(ev('unit', 2, 'running', 'executing'))]);
  assert.equal(s.phase, RUN_PHASE.STOPPING);
  assert.equal(fold([core(ev('state', 4, 'cancelled', 'finalizing'))], s).phase, RUN_PHASE.FINALIZING);
});

test('done → terminal for completed/cancelled/failed/invalidated; a Stop that sealed failed shows failed', () => {
  for (const status of ['completed', 'cancelled', 'failed', 'invalidated']) {
    const s = fold([{ type: 'stop-requested' }, { type: 'done', summary: { status, resultSet: { results: [] }, persistence: saved } }]);
    assert.equal(s.phase, RUN_PHASE.DONE);
    assert.deepEqual({ ...s.terminal }, { status, persistence: saved, resultSetPresent: true });
  }
});

test('resultSet:null (fallback seal failed) ⇒ terminal.resultSetPresent === false', () => {
  const s = fold([{ type: 'done', summary: { status: 'failed', resultSet: null, persistence: { state: 'skipped', timedOut: false, attempt: 0, reason: 'seal-failed' } } }]);
  assert.equal(s.terminal.resultSetPresent, false);
  assert.equal(s.terminal.status, 'failed');
});

test('persistence events (even after terminal), progress events and stale seqs never transition', () => {
  const fin = fold([core(ev('state', 3, 'completed', 'finalizing'))]);
  assert.equal(reduceRun(fin, { type: 'core-event', event: { type: 'persistence', state: 'saved', timedOut: false, attempt: 1, seq: 4 } }), fin);
  assert.equal(reduceRun(fin, { type: 'core-event', event: { type: 'progress', seq: 9, status: 'running', phase: 'executing' } }), fin);
  assert.equal(reduceRun(fin, core(ev('unit', 2, 'running', 'executing'))), fin, 'seq 2 <= lastSeq 3');
  const done = fold([{ type: 'done', summary: { status: 'completed', resultSet: { results: [] }, persistence: saved } }], fin);
  assert.equal(reduceRun(done, { type: 'core-event', event: { type: 'persistence', state: 'failed', timedOut: false, attempt: 1, seq: 6 } }), done);
});

test('admission failure keeps idle (or the previous done) and records the error by name', () => {
  const err = Object.assign(new Error('result capacity 4 exhausted'), { name: 'ResultCapacityError', cap: 4, active: [], retained: ['r0'], held: [] });
  const idle = reduceRun(initialRunState(), { type: 'admission-failed', error: err });
  assert.equal(idle.phase, RUN_PHASE.IDLE);
  assert.equal(idle.admissionError.name, 'ResultCapacityError');
  assert.deepEqual(idle.admissionError.retained, ['r0']);
  const prevDone = fold([{ type: 'done', summary: { status: 'completed', resultSet: { results: [] }, persistence: saved } }]);
  const after = reduceRun(prevDone, { type: 'admission-failed', error: err });
  assert.equal(after.phase, RUN_PHASE.DONE, 'previous results/state preserved');
  assert.equal(after.terminal, prevDone.terminal);
  assert.equal(reduceRun(after, { type: 'admitted', snapshot: snap({ runId: 'r2' }), atMs: 5 }).admissionError, null);
  const running = fold([core(ev('unit', 2, 'running', 'executing'))]);
  assert.equal(reduceRun(running, { type: 'admission-failed', error: err }), running, 'ignored while our run is active');
});

test('waitingForOtherRun: set only when a POLL after admission still reads queued; cleared by the first state event', () => {
  const a = admitted();
  assert.equal(a.waitingForOtherRun, false, 'the admission snapshot itself never sets it');
  const w = reduceRun(a, { type: 'poll', snapshot: snap(), atMs: 2000 });
  assert.equal(w.waitingForOtherRun, true);
  assert.equal(w.phase, RUN_PHASE.PREPARING);
  assert.equal(reduceRun(w, core(ev('state', 1, 'planning', 'enumerating'))).waitingForOtherRun, false);
});

test('progress carries only fractions/counts; startedAtMs is the Panel clock; no ETA keys', () => {
  const s = fold([core(ev('unit', 2, 'running', 'executing'), snap({ seq: 2, status: 'running', phase: 'executing', unitsTotal: 4, unitsEvaluated: 1, fractionProcessed: 0.25, resultsFound: 3, caveatCount: 1 }))]);
  assert.equal(s.startedAtMs, 1000);
  assert.deepEqual({ ...s.progress }, { fraction: 0.25, unitsEvaluated: 1, unitsTotal: 4, unitsFailedOrSkipped: 0, resultsFound: 3, caveatCount: 1 });
  for (const k of Object.keys(s.progress)) assert.doesNotMatch(k, /eta|remaining|rate|throughput/i);
  const p0 = reduceRun(admitted(), { type: 'poll', snapshot: snap({ fractionProcessed: null }) });
  assert.equal(p0.progress.fraction, null, 'fractionProcessed is null while pairSpaceTotal is 0');
});

// ---- REAL engine: the reducer consumes what Core actually emits ----------------------------------------------
function realEngine(unitExecutor) {
  const w = createEngineWorld();
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 26) });
  const engine = createClashTestEngine(w.config({
    unitExecutor, now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {},
  }));
  return { engine, w };
}
function drive(handle) {
  let s = reduceRun(initialRunState(), { type: 'admitted', snapshot: handle.getSnapshot(), atMs: 0 });
  const phases = [s.phase];
  handle.subscribe((e) => { s = reduceRun(s, { type: 'core-event', event: e, snapshot: handle.getSnapshot() }); phases.push(s.phase); });
  return { get state() { return s; }, set state(v) { s = v; }, phases };
}
function gated() {
  const inner = createScriptedExecutor({}, { unscripted: { facts: [] } });
  let open; let started;
  const gate = new Promise((r) => { open = r; });
  const began = new Promise((r) => { started = r; });
  const exec = async (req) => { started(); await gate; return inner(req); };
  return { exec, began, release: () => open() };
}

test('REAL engine: a clean run walks preparing → planning → running → finalizing → done', async () => {
  const { engine, w } = realEngine(createScriptedExecutor({}, { unscripted: { facts: [] } }));
  const h = engine.startRun(w.definition());
  assert.equal(h.getSnapshot().status, 'queued', 'no event at queued; admission snapshot is queued');
  const d = drive(h);
  const summary = await h.done;
  d.state = reduceRun(d.state, { type: 'done', summary });
  assert.deepEqual([...new Set(d.phases)], ['preparing', 'planning', 'running', 'finalizing']);
  assert.equal(d.state.phase, 'done');
  assert.equal(d.state.terminal.status, 'completed');
  assert.equal(d.state.terminal.resultSetPresent, true);
});

test('REAL engine: Stop while running goes through cancelling (stopping) and seals cancelled', async () => {
  const g = gated();
  const { engine, w } = realEngine(g.exec);
  const h = engine.startRun(w.definition());
  const d = drive(h);
  await g.began;
  d.state = reduceRun(d.state, { type: 'stop-requested' });
  const donePromise = h.cancel('user');
  assert.equal(h.getSnapshot().status, 'cancelling');
  g.release();
  const summary = await donePromise;
  d.state = reduceRun(d.state, { type: 'done', summary });
  assert.ok(d.phases.includes('stopping'));
  assert.equal(d.state.terminal.status, 'cancelled');
});

test('REAL engine: Stop while preparing (queued behind another run) withdraws and seals cancelled', async () => {
  const g = gated();
  const { engine, w } = realEngine(g.exec);
  const first = engine.startRun(w.definition());
  await g.began;
  const second = engine.startRun(w.definition({ testId: 'T2' }));
  const d = drive(second);
  let polled = reduceRun(d.state, { type: 'poll', snapshot: second.getSnapshot() });
  assert.equal(polled.waitingForOtherRun, true);
  d.state = reduceRun(polled, { type: 'stop-requested' });
  const summary = await second.cancel('user');
  d.state = reduceRun(d.state, { type: 'done', summary });
  assert.equal(d.state.terminal.status, 'cancelled');
  assert.equal(summary.resultSet.results.length, 0);
  g.release();
  first.cancel('cleanup');
  await first.done;
});
