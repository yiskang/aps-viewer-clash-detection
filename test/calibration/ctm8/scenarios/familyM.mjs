// test/calibration/ctm8/scenarios/familyM.mjs
// CTM8-P0-v4 Family M (manager test-records) calibration cells: M-BASE, M-REC, M-HIT.
// NON-PRODUCTION calibration support code. Governing protocol:
//   docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md  §5.1, §6.1, §7.1, §7.2, §7.6.
// This module implements the frozen protocol; it does not choose methodology.
//
// Cell contract (driven by ../lib/cellRunner.mjs):
//   cell.setup({setupTimeoutMs})  -> {status:'OK'|'INVALID_SETUP'|'SETUP_TIMEOUT', reason?, manifest}
//   cell.prepareSample()          -> {ok:true} | {ok:false, reason}
//   cell.runSample({timeoutMs})   -> {status:'OK'|'TIMEOUT'|'INVALID', durationMs, notificationCount, yieldDelta,
//                                     catalogListDelta, extra}
//   cell.resetSample()            -> {ok:true, extra?} | {ok:false, reason}
//   cell.teardown()               -> unsubscribe -> manager.dispose() -> await h.controller.dispose() (all attempted;
//                                    first error rethrown). A failed setup disposes whatever it acquired itself.
//
// Test-only second argument `hooks` (never used by the campaign runner, which calls createCell(cellSpec)):
//   wrapEditor(controller, log)  -> object handed to createTestsManager as `editor` (default: the controller itself)
//   wrapManager(manager, log)    -> object the cell uses as the manager (default: the manager itself)
//   beforeReadiness(ctx)         -> async; runs after Step 2 and before the Step 3 predicates (fixture tampering)
//   untilPredicate(pred)         -> returns the predicate the M-REC poll uses (default: identity)
//   untilMaxRounds               -> round bound of the M-REC poll (default 20000, = settle.mjs `until`)
//   untimedTimeoutMs             -> bound of prepareSample/resetSample (default 120000)
// `log(event, data)` appends to `cell._events` (ordered; step boundaries are logged by the cell itself).
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { makeHarness } from '../../../clashpanel/support/controllerHarness.mjs';
import { settle as settleRounds } from '../../../clashpanel/support/settle.mjs';
import { createTestsManager } from '../../../../clashpanel/core/testsManager.js';
import { INTENT, MANAGER_INTENT } from '../../../../clashpanel/core/intents.js';

export const SCENARIOS = Object.freeze(['M-BASE', 'M-REC', 'M-HIT']);
export const DEFAULT_SETUP_TIMEOUT_MS = 120000;
export const DEFAULT_TIMED_TIMEOUT_MS = 30000;
export const M_HIT_BATCH = 1000;
export const DRAIN_EXTRA_ROUNDS = 5;
const SET_B_TEXT = Object.freeze({ 1: 'Architecture', 2: 'Structure', 3: 'Structure; Mechanical' });
const TIMED_OUT = Symbol('timed-out');
export const UNTIL_MAX_ROUNDS = 20000;           // same default bound as settle.mjs `until`
export const STOP_GRACE_MS = 5000;               // wait for a non-cooperative await to finish after an abort

// ── small local helpers ────────────────────────────────────────────────────────────────────────────────────────

/** Canonical JSON: object keys sorted recursively, arrays in order (local; lib/evidence.mjs is not imported). */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Thrown inside a cooperative operation once its deadline has passed. */
class OpAborted extends Error { constructor() { super('operation aborted (wall-clock deadline)'); this.name = 'OpAborted'; } }

/**
 * Cooperative settle: `rounds` single settle.mjs rounds (setImmediate turn + scheduler.advance(0) each — identical to
 * settle(scheduler, rounds)), checking `op.aborted` before every round; an aborted op throws OpAborted.
 */
async function coopSettle(scheduler, op, rounds = 30) {
  for (let i = 0; i < rounds; i += 1) {
    if (op.aborted) throw new OpAborted();
    await settleRounds(scheduler, 1);
  }
}

/**
 * Cooperative predicate poll (replaces settle.mjs `until`, same semantics: predicate checked up to `maxRounds` times
 * with one settle round between checks). Returns 'met' | 'exhausted' | 'aborted'; exits within one settle round of
 * `op.aborted` being set.
 */
async function pollUntil(scheduler, predicate, op, maxRounds = UNTIL_MAX_ROUNDS) {
  for (let i = 0; i < maxRounds; i += 1) {
    if (op.aborted) return 'aborted';
    if (predicate()) return 'met';
    await settleRounds(scheduler, 1);
  }
  return 'exhausted';
}

/**
 * Runs `fn(op)` under a REAL wall-clock deadline (setTimeout/performance — never the fake scheduler's virtual time).
 * If the deadline wins, `op.aborted` is set and the operation's own termination is AWAITED before returning (a
 * cooperative loop exits within one settle round; STOP_GRACE_MS only bounds a non-cooperative await such as a dispatch
 * that never settles, reported as stopped:false). Timers are always cleared.
 * Result: {timedOut:false, ok, value|error} | {timedOut:true, stopped}.
 */
async function runBounded(fn, ms, { graceMs = STOP_GRACE_MS } = {}) {
  const op = { aborted: false };
  let started;
  try { started = Promise.resolve(fn(op)); } catch (error) { started = Promise.reject(error); }
  const settled = started.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
  const timer = (delay) => {
    let id = null;
    const p = new Promise((resolve) => { id = setTimeout(() => resolve(TIMED_OUT), Math.max(0, delay)); });
    return { p, clear: () => clearTimeout(id) };
  };
  const deadline = timer(ms);
  const first = await Promise.race([settled, deadline.p]);
  deadline.clear();
  if (first !== TIMED_OUT) return { timedOut: false, ...first };
  op.aborted = true;
  const grace = timer(graceMs);
  const stop = await Promise.race([settled, grace.p]);
  grace.clear();
  return { timedOut: true, stopped: stop !== TIMED_OUT };
}
export const _internals = Object.freeze({ runBounded, pollUntil, coopSettle, OpAborted });

const expectedName = (N, n, i) => `CTM8-M-${N}-${n}-${i}`;
const expectedActiveId = (N) => (N === 1 ? 'test-1' : `new-${N - 1}`);

// ── M-BASE timed window (§5.1, §7.1 M-BASE exception) ──────────────────────────────────────────────────────────
// The function between the markers is a plain (non-async) function: no `await` can occur between t0 and t1, so no
// asynchronous continuation (microtask/macrotask) can execute inside the window. A unit test checks this region's
// source text.
// <CTM8-M-BASE-TIMED-WINDOW>
function mBaseTimedWindow(catalog, manager, lastIndex, c0) {
  const t0 = performance.now();
  catalog.fire();
  const vm = manager.getViewModel();
  const tests = vm.manager.tests;
  const ok = tests[0].setA === 'Architecture-R' && tests[lastIndex].setA === 'Architecture-R' && catalog.calls.list > c0;
  const t1 = performance.now();
  return { t0, t1, ok, vm };
}
// </CTM8-M-BASE-TIMED-WINDOW>

// ── §6.1 Step 0: a copy of testsManager.integration.test.mjs setup(opts) (lines 14–27) ─────────────────────────
// Additions only: the test-only identity-default wrap hooks, and `hold`, which receives every acquired object the
// moment it exists so a failure part-way through (e.g. a throwing wrap hook) can still be disposed.
function setup(opts, hooks, hold) {
  const h = makeHarness(opts);
  hold.h = h;
  let n = 0;
  const editor = typeof hooks.wrapEditor === 'function' ? hooks.wrapEditor(h.controller, hooks.log) : h.controller;
  const rawManager = createTestsManager({ editor, engine: h.engine, catalog: h.catalog, bridge: h.bridge, scheduler: h.scheduler,
    mintId: () => { n += 1; return `new-${n}`; } });
  hold.rawManager = rawManager;
  const manager = typeof hooks.wrapManager === 'function' ? hooks.wrapManager(rawManager, hooks.log) : rawManager;
  hold.manager = manager;
  const m = {
    manager,
    vm: () => manager.getViewModel().manager,
    ed: () => h.controller.getViewModel(),
    row: (id) => manager.getViewModel().manager.tests.find((t) => t.testId === id),
    async do(intent) { const out = await manager.dispatch(intent); await h.settle(); return out; },
  };
  hold.m = m;
  return { h, m };
}

// ── the cell ───────────────────────────────────────────────────────────────────────────────────────────────────

export function createCell(cellSpec, hooks = {}) {
  const { family, scenario, scale: N, nModels: n, kind, cellId, profile } = cellSpec ?? {};
  if (family !== 'M') throw new TypeError(`familyM.createCell: family must be 'M' (got ${family})`);
  if (!SCENARIOS.includes(scenario)) throw new TypeError(`familyM.createCell: unknown scenario ${scenario}`);
  if (!Number.isInteger(N) || N < 1) throw new TypeError('familyM.createCell: scale must be a positive integer');
  if (![1, 2, 3].includes(n)) throw new TypeError('familyM.createCell: nModels must be 1, 2 or 3');
  if (kind !== 'warm') throw new TypeError(`familyM.createCell: kind must be 'warm' for Family M (got ${kind})`);
  if (profile !== undefined && profile !== null) throw new TypeError(`familyM.createCell: profile must be null/undefined for Family M (got ${profile})`);

  const events = [];
  const log = (event, data) => { events.push(data === undefined ? { event } : { event, ...data }); };
  const opts = n === 3 ? { extraModels: [{ modelKey: 'mC', displayName: 'Mechanical' }] } : {};
  const setB = SET_B_TEXT[n];
  const lastIndex = N - 1;
  const k = Math.floor(N / 2);
  const nameK = expectedName(N, n, k + 1);

  const st = {
    hold: {},                     // {h, rawManager, manager, m} — filled as each is acquired (setup())
    unsubscribe: null,
    managerDisposed: false,
    controllerDisposed: false,
    notificationCount: 0,
    setupStatus: null,
    torndown: false,
    idK: null,
    recOpened: false,
    base: null,                   // M-BASE per-sample bookkeeping {c0, s0, notifAtT1, extra}
  };

  const manifest = {
    protocol: 'CTM8-P0-v4',
    family: 'M', scenario, scale: N, nModels: n, kind, cellId,
    params: { 'M.N_tests': N, n_models: n, harnessOpts: opts },
    expected: {
      count: N, view: 'list', namePattern: `CTM8-M-${N}-${n}-<i>`, firstName: expectedName(N, n, 1), lastName: expectedName(N, n, N),
      setA: 'Architecture', setB, readiness: 'setup-complete', activeTestId: expectedActiveId(N), confirm: null,
    },
    scenarioParams: scenario === 'M-REC' ? { k, nameK, nameA: `${nameK}-A`, nameB: `${nameK}-B`, idK: null }
      : scenario === 'M-HIT' ? { batch: M_HIT_BATCH } : { renameTo: 'Architecture-R', drainExtraRounds: DRAIN_EXTRA_ROUNDS },
    status: null,
    reason: null,
    recordsBuilt: 0,
    setupElapsedMs: null,
    recordsSha256: null,
    initialRecords: null,
    subscriberAttachedAfterBuild: false,
  };

  const untilPredicate = typeof hooks.untilPredicate === 'function' ? hooks.untilPredicate : (p) => p;   // test-only
  const untilMaxRounds = Number.isInteger(hooks.untilMaxRounds) ? hooks.untilMaxRounds : UNTIL_MAX_ROUNDS;
  const mgr = () => st.hold.manager;
  const mvm = () => mgr().getViewModel().manager;
  const sched = () => st.hold.h.scheduler;

  // ── disposal: unsubscribe -> manager.dispose() -> await controller.dispose(); every step attempted ─────────────
  async function disposeAcquired() {
    const errors = [];
    if (st.unsubscribe !== null) {
      const off = st.unsubscribe;
      st.unsubscribe = null;
      try { off(); log('teardown-unsubscribe'); } catch (e) { errors.push(e); log('teardown-error', { step: 'unsubscribe' }); }
    }
    const { manager, rawManager, h } = st.hold;
    if (!st.managerDisposed && (manager ?? rawManager) !== undefined) {
      st.managerDisposed = true;
      try { (manager ?? rawManager).dispose(); log('teardown-manager-dispose'); } catch (e) {
        errors.push(e);
        log('teardown-error', { step: 'manager.dispose' });
        // a wrapper whose dispose threw: the real manager must still release its listeners (dispose is idempotent)
        if (manager !== undefined && rawManager !== undefined && manager !== rawManager) {
          try { rawManager.dispose(); log('teardown-raw-manager-dispose'); } catch (e2) { errors.push(e2); }
        }
      }
    }
    if (!st.controllerDisposed && h !== undefined) {
      st.controllerDisposed = true;
      try {
        const outcome = await h.controller.dispose();
        log('teardown-controller-dispose', { released: outcome?.released ?? null });
      } catch (e) { errors.push(e); log('teardown-error', { step: 'controller.dispose' }); }
    }
    return errors;
  }

  // ── setup: §6.1 Steps 0–3c, bounded by setupTimeoutMs of wall-clock ───────────────────────────────────────────
  async function build(op, setupTimeoutMs, start) {
    const overdue = () => op.aborted || performance.now() - start > setupTimeoutMs;
    const timeout = () => ({ status: 'SETUP_TIMEOUT', reason: `setup exceeded ${setupTimeoutMs} ms after ${manifest.recordsBuilt}/${N} records` });
    const invalid = (reason) => ({ status: 'INVALID_SETUP', reason });

    // Step 0 — harness + manager. No calibration subscriber of any kind exists from here through Step 3.
    log('step0-begin');
    const { h, m } = setup(opts, { ...hooks, log }, st.hold);
    log('step0-end');
    if (overdue()) return timeout();
    // m.do(intent) with a cooperative settle: dispatch, then 30 single settle rounds (== h.settle()), abortable.
    const step = async (intent) => { await m.manager.dispatch(intent); await coopSettle(h.scheduler, op, 30); };

    // Step 1 — ordered public sequence; no getViewModel() read and no confirm check between steps.
    log('step1-begin');
    for (let i = 1; i <= N; i += 1) {
      if (i > 1) { await step({ type: MANAGER_INTENT.CREATE }); if (overdue()) return timeout(); }
      await step({ type: INTENT.SETUP_NAME, value: expectedName(N, n, i) });
      if (overdue()) return timeout();
      await step({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });
      if (overdue()) return timeout();
      if (n === 1) {
        await step({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mA' });
      } else {
        await step({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });
        if (n === 3) { if (overdue()) return timeout(); await step({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mC' }); }
      }
      manifest.recordsBuilt = i;
      if (overdue()) return timeout();
    }
    log('step1-end', { records: N });

    // Step 2 — return to list view.
    await step({ type: MANAGER_INTENT.VIEW_LIST });
    log('step2-end');
    if (overdue()) return timeout();

    if (typeof hooks.beforeReadiness === 'function') await hooks.beforeReadiness({ h, m });

    // Step 3 — readiness predicates (first getViewModel() read of the build).
    log('step3-begin');
    const vm = m.manager.getViewModel().manager;
    const fails = [];
    if (vm.count !== N) fails.push(`count ${vm.count} !== ${N}`);
    if (vm.view !== 'list') fails.push(`view ${vm.view} !== list`);
    if (vm.activeTestId !== expectedActiveId(N)) fails.push(`activeTestId ${vm.activeTestId} !== ${expectedActiveId(N)}`);
    if (vm.confirm !== null) fails.push('confirm !== null');
    if (!Array.isArray(vm.tests) || vm.tests.length !== N) fails.push(`tests.length ${vm.tests?.length} !== ${N}`);
    else {
      for (let i = 1; i <= N && fails.length < 20; i += 1) {
        const t = vm.tests[i - 1];
        if (t.name !== expectedName(N, n, i)) fails.push(`tests[${i - 1}].name ${JSON.stringify(t.name)}`);
        if (t.setA !== 'Architecture') fails.push(`tests[${i - 1}].setA ${JSON.stringify(t.setA)}`);
        if (t.setB !== setB) fails.push(`tests[${i - 1}].setB ${JSON.stringify(t.setB)}`);
        if (t.readiness?.state !== 'setup-complete') fails.push(`tests[${i - 1}].readiness ${JSON.stringify(t.readiness?.state)}`);
      }
    }
    if (fails.length > 0) { log('step3-failed'); return invalid(`Step 3 readiness predicates failed: ${fails.join('; ')}`); }
    const records = vm.tests.map((t) => ({ testId: t.testId, name: t.name, setA: t.setA, setB: t.setB, readiness: { state: t.readiness.state } }));
    manifest.recordsSha256 = sha256(canonicalJson(records));
    manifest.initialRecords = { count: records.length, first: records[0], last: records[records.length - 1] };
    if (scenario === 'M-REC') { st.idK = vm.tests[k].testId; manifest.scenarioParams.idK = st.idK; }
    log('step3-end');
    if (overdue()) return timeout();

    // Step 3b — attach the no-op counting subscriber (only after Step 3 passed).
    st.unsubscribe = m.manager.subscribe(() => { st.notificationCount += 1; });
    manifest.subscriberAttachedAfterBuild = true;
    log('step3b-subscribed');

    // Step 3c — final untimed settle and stability checks.
    await coopSettle(h.scheduler, op, 30);
    const a = m.manager.getViewModel();
    const b = m.manager.getViewModel();
    if (a !== b) return invalid('Step 3c: two consecutive getViewModel() reads are not the same object');
    const count0 = st.notificationCount;
    await coopSettle(h.scheduler, op, 30);
    if (st.notificationCount !== count0) return invalid(`Step 3c: notification count changed across a settle (${count0} -> ${st.notificationCount})`);
    log('step3c-end');
    if (overdue()) return timeout();
    return { status: 'OK' };
  }

  async function cellSetup({ setupTimeoutMs = DEFAULT_SETUP_TIMEOUT_MS } = {}) {
    const start = performance.now();
    const r = await runBounded((op) => build(op, setupTimeoutMs, start), setupTimeoutMs);
    let out;
    if (r.timedOut) {
      out = { status: 'SETUP_TIMEOUT', reason: `setup exceeded ${setupTimeoutMs} ms (wall-clock deadline) after ${manifest.recordsBuilt}/${N} records${r.stopped ? '' : '; build did not stop within the grace period'}` };
    } else if (!r.ok) {
      out = r.error instanceof OpAborted
        ? { status: 'SETUP_TIMEOUT', reason: `setup exceeded ${setupTimeoutMs} ms after ${manifest.recordsBuilt}/${N} records` }
        : { status: 'INVALID_SETUP', reason: `setup threw: ${r.error?.message ?? r.error}` };
    } else out = r.value;
    manifest.setupElapsedMs = performance.now() - start;
    if (out.status !== 'OK') {
      // Partial-setup leak guard: release whatever was acquired, in the teardown order.
      const errors = await disposeAcquired();
      if (errors.length > 0) out = { ...out, reason: `${out.reason}; disposal after failed setup threw: ${errors[0]?.message ?? errors[0]}` };
    }
    manifest.status = out.status;
    manifest.reason = out.reason ?? null;
    st.setupStatus = out.status;
    log('setup-result', { status: out.status });
    return { ...out, manifest };
  }

  // ── M-BASE drain (§5.1 Drain / quiescence) ─────────────────────────────────────────────────────────────────────
  async function drain(op) {
    for (let round = 0; round <= DRAIN_EXTRA_ROUNDS; round += 1) {
      await coopSettle(sched(), op, 30);
      const a = st.notificationCount;
      await coopSettle(sched(), op, 30);
      if (st.notificationCount === a) return { ok: true, rounds: round };
    }
    return { ok: false, reason: `INVALID_SETUP: drain not quiescent after ${DRAIN_EXTRA_ROUNDS} extra rounds` };
  }

  // ── per-scenario prepare / run / reset ─────────────────────────────────────────────────────────────────────────
  function commonCheck(view) {
    const vm = mvm();
    if (vm.count !== N) return `count ${vm.count} !== ${N}`;
    if (vm.confirm !== null) return 'confirm !== null';
    if (view !== undefined && vm.view !== view) return `view ${vm.view} !== ${view}`;
    return null;
  }

  async function prepareBase(op) {
    const d = await drain(op);
    if (!d.ok) return d;
    const { catalog } = st.hold.h;
    const bad = commonCheck('list');
    if (bad) return { ok: false, reason: `pre-state: ${bad}` };
    const tests = mvm().tests;
    if (catalog.displayNameFor('mA') !== 'Architecture') return { ok: false, reason: 'pre-state: displayNameFor(mA) !== Architecture' };
    if (tests[0].setA !== 'Architecture' || tests[lastIndex].setA !== 'Architecture') return { ok: false, reason: 'pre-state: setA !== Architecture' };
    st.base = { c0: catalog.calls.list, s0: st.notificationCount, notifAtT1: null, extra: null };
    catalog.addModel({ modelKey: 'mA', displayName: 'Architecture-R', model: catalog.modelOf('mA'), loaded: true });
    return { ok: true };
  }

  function runBase() {
    const { catalog, scheduler } = st.hold.h;
    const b = st.base;
    if (b === null) return { status: 'INVALID', durationMs: null, notificationCount: null, yieldDelta: null, catalogListDelta: null, extra: { reason: 'not-prepared' } };
    const y0 = scheduler.yieldCount;
    const w = mBaseTimedWindow(catalog, mgr(), lastIndex, b.c0);
    const notifInWindow = st.notificationCount - b.s0;
    b.notifAtT1 = st.notificationCount;
    const extra = { notif_in_window: notifInWindow, notif_after_window: null };
    if (!w.ok) extra.reason = 'completion-predicate-false';
    b.extra = extra;
    return {
      status: w.ok ? 'OK' : 'INVALID', durationMs: w.t1 - w.t0, notificationCount: notifInWindow,
      yieldDelta: scheduler.yieldCount - y0, catalogListDelta: catalog.calls.list - b.c0, extra,
    };
  }

  async function resetBase(op) {
    const { catalog } = st.hold.h;
    const b = st.base;
    catalog.addModel({ modelKey: 'mA', displayName: 'Architecture', model: catalog.modelOf('mA'), loaded: true });
    catalog.fire();
    const tests = mgr().getViewModel().manager.tests;
    if (tests[0].setA !== 'Architecture' || tests[lastIndex].setA !== 'Architecture') return { ok: false, reason: 'reset: setA !== Architecture' };
    const beforeDrain = st.notificationCount;
    const d = await drain(op);
    // notif_after_window: every notification from t1 through the end of the reset drain (async continuations of the
    // timed fire() plus the reset's own fire()); notif_during_drain: only those arriving inside the drain.
    const covariates = b === null || b.notifAtT1 === null ? null
      : { notif_after_window: st.notificationCount - b.notifAtT1, notif_during_drain: st.notificationCount - beforeDrain, drain_rounds: d.rounds ?? null };
    if (covariates !== null && b.extra !== null) Object.assign(b.extra, covariates);   // same object the runner records
    st.base = null;
    if (!d.ok) return d;
    return { ok: true, extra: covariates };
  }

  async function prepareRec(op) {
    if (!st.recOpened) {
      await mgr().dispatch({ type: MANAGER_INTENT.OPEN, testId: st.idK });
      await coopSettle(sched(), op, 30);
      let vm = mvm();
      if (vm.confirm !== null) return { ok: false, reason: 'INVALID_SETUP: confirm pending after OPEN' };
      if (vm.activeTestId !== st.idK) return { ok: false, reason: `OPEN: activeTestId ${vm.activeTestId} !== ${st.idK}` };
      await mgr().dispatch({ type: INTENT.SETUP_NAME, value: `${nameK}-A` });
      await coopSettle(sched(), op, 30);
      vm = mvm();
      if (vm.tests[k].name !== `${nameK}-A`) return { ok: false, reason: `setup: tests[k].name ${JSON.stringify(vm.tests[k].name)}` };
      st.recOpened = true;
    }
    const bad = commonCheck();
    if (bad) return { ok: false, reason: `pre-state: ${bad}` };
    const vm = mvm();
    if (vm.activeTestId !== st.idK) return { ok: false, reason: 'pre-state: activeTestId !== idK' };
    if (vm.tests[k].name !== `${nameK}-A` || vm.tests[k].testId !== st.idK) return { ok: false, reason: 'pre-state: tests[k] not <nameK>-A' };
    return { ok: true };
  }

  const recPredicate = () => {
    const vm = mvm();
    return vm.tests[k]?.name === `${nameK}-B` && vm.tests[k]?.testId === st.idK && vm.activeTestId === st.idK && vm.count === N;
  };

  async function runRec(timeoutMs) {
    const { catalog, scheduler } = st.hold.h;
    const manager = mgr();
    const predicate = untilPredicate(recPredicate);
    const y0 = scheduler.yieldCount;
    const c0 = catalog.calls.list;
    const s0 = st.notificationCount;
    let dispatchError = null;
    const t0 = performance.now();
    const dp = manager.dispatch({ type: INTENT.SETUP_NAME, value: `${nameK}-B` });
    Promise.resolve(dp).catch((e) => { dispatchError = e; });
    // Cooperative poll under the real 30 s wall-clock deadline; on timeout the poll is aborted and its exit awaited.
    const r = await runBounded((op) => pollUntil(scheduler, predicate, op, untilMaxRounds), timeoutMs - (performance.now() - t0));
    const vm = manager.getViewModel();
    const t1 = performance.now();
    const base = { durationMs: t1 - t0, notificationCount: st.notificationCount - s0, yieldDelta: scheduler.yieldCount - y0, catalogListDelta: catalog.calls.list - c0 };
    if (r.timedOut) return { status: 'TIMEOUT', ...base, extra: { reason: 'wall-clock-timeout', pollStopped: r.stopped } };
    if (!r.ok) return { status: 'INVALID', ...base, extra: { reason: `poll-threw: ${r.error?.message ?? r.error}` } };
    if (r.value === 'exhausted') return { status: 'INVALID', ...base, extra: { reason: 'until-rounds-exhausted' } };
    if (dispatchError !== null) return { status: 'INVALID', ...base, extra: { reason: `dispatch-rejected: ${dispatchError?.message ?? dispatchError}` } };
    const t = vm.manager.tests[k];
    const ok = t?.name === `${nameK}-B` && t?.testId === st.idK && vm.manager.activeTestId === st.idK && vm.manager.count === N;
    return ok ? { status: 'OK', ...base, extra: {} } : { status: 'INVALID', ...base, extra: { reason: 'completion-predicate-false-on-final-vm' } };
  }

  async function resetRec(op) {
    await mgr().dispatch({ type: INTENT.SETUP_NAME, value: `${nameK}-A` });
    await coopSettle(sched(), op, 30);
    const vm = mvm();
    if (vm.tests[k].name !== `${nameK}-A` || vm.tests[k].testId !== st.idK || vm.activeTestId !== st.idK) return { ok: false, reason: 'reset: tests[k] not restored to <nameK>-A' };
    return { ok: true };
  }

  function prepareHit() {
    const bad = commonCheck('list');
    if (bad) return { ok: false, reason: `pre-state: ${bad}` };
    const a = mgr().getViewModel();
    const b = mgr().getViewModel();
    if (a !== b) return { ok: false, reason: 'pre-state: two consecutive getViewModel() are not ===' };
    return { ok: true };
  }

  function runHit() {
    const { catalog, scheduler } = st.hold.h;
    const manager = mgr();
    const y0 = scheduler.yieldCount;
    const c0 = catalog.calls.list;
    const s0 = st.notificationCount;
    let prev = null;
    let last = null;
    const t0 = performance.now();
    for (let i = 0; i < M_HIT_BATCH; i += 1) { prev = last; last = manager.getViewModel(); }
    const t1 = performance.now();
    const duration = t1 - t0;
    const ok = last !== null && last === prev;
    const extra = { batch: M_HIT_BATCH, batchDurationMs: duration, perCallMs: duration / M_HIT_BATCH };
    if (!ok) extra.reason = 'final-call-not-identical';
    return { status: ok ? 'OK' : 'INVALID', durationMs: duration, notificationCount: st.notificationCount - s0, yieldDelta: scheduler.yieldCount - y0, catalogListDelta: catalog.calls.list - c0, extra };
  }

  // ── untimed-step 120 s wall-clock bound (§7.6); cooperative: an overdue step is aborted and its exit awaited ──
  const untimedBound = async (fn, what) => {
    if (st.setupStatus !== 'OK' || st.torndown) return { ok: false, reason: `${what}: setup status ${st.setupStatus}${st.torndown ? ' (torn down)' : ''}` };
    const ms = Number.isFinite(hooks.untimedTimeoutMs) ? hooks.untimedTimeoutMs : DEFAULT_SETUP_TIMEOUT_MS;
    const r = await runBounded(fn, ms);
    if (r.timedOut) return { ok: false, reason: `INVALID_SETUP: ${what} exceeded ${ms} ms${r.stopped ? '' : ' (did not stop within the grace period)'}` };
    if (!r.ok) {
      return r.error instanceof OpAborted ? { ok: false, reason: `INVALID_SETUP: ${what} exceeded ${ms} ms` }
        : { ok: false, reason: `${what} threw: ${r.error?.message ?? r.error}` };
    }
    return r.value;
  };

  const cell = {
    cellSpec,
    get _events() { return events; },
    get _ctx() { return st.hold.h === undefined ? null : { h: st.hold.h, m: st.hold.m ?? null }; },
    get _notificationCount() { return st.notificationCount; },
    get manifest() { return manifest; },
    setup: cellSetup,
    prepareSample() {
      return untimedBound(async (op) => {
        if (scenario === 'M-BASE') return prepareBase(op);
        if (scenario === 'M-REC') return prepareRec(op);
        return prepareHit();
      }, 'prepareSample');
    },
    async runSample({ timeoutMs = DEFAULT_TIMED_TIMEOUT_MS } = {}) {
      if (st.setupStatus !== 'OK' || st.torndown) return { status: 'INVALID', durationMs: null, notificationCount: null, yieldDelta: null, catalogListDelta: null, extra: { reason: `setup status ${st.setupStatus}` } };
      if (scenario === 'M-BASE') return runBase();                 // no until/timeout wrapper (§7.1 M-BASE exception)
      if (scenario === 'M-REC') return runRec(timeoutMs);
      return runHit();
    },
    resetSample() {
      return untimedBound(async (op) => {
        if (scenario === 'M-BASE') return resetBase(op);
        if (scenario === 'M-REC') return resetRec(op);
        return { ok: true };                                      // M-HIT: none
      }, 'resetSample');
    },
    /** unsubscribe -> manager.dispose() -> await controller.dispose(). Every step is attempted; the first error is rethrown. */
    async teardown() {
      if (st.torndown) return;
      const errors = await disposeAcquired();
      st.torndown = true;
      if (errors.length > 0) throw errors[0];
    },
  };
  return cell;
}
