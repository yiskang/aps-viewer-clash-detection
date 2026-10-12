// test/calibration/ctm8/tests/familyM.test.mjs — focused tests for the CTM8-P0-v4 Family M cells
// (scenarios/familyM.mjs). Small N only; no timing assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { INTENT } from '../../../../clashpanel/core/intents.js';
import { createCell, canonicalJson, _internals } from '../scenarios/familyM.mjs';

const SOURCE = fileURLToPath(new URL('../scenarios/familyM.mjs', import.meta.url));
const spec = (scenario, scale, nModels) => ({ family: 'M', scenario, scale, nModels, kind: 'warm', cellId: `${scenario}-${scale}-${nModels}` });
const SET_B = { 1: 'Architecture', 2: 'Structure', 3: 'Structure; Mechanical' };

async function built(s, hooks) {
  const cell = createCell(s, hooks);
  const r = await cell.setup({ setupTimeoutMs: 120000 });
  return { cell, r };
}

/** Test-only wrappers logging every subscribe/unsubscribe/dispose against the cell's ordered event log. */
const loggingHooks = (extra = {}) => ({
  wrapEditor: (controller, log) => ({
    ...controller,
    subscribe(cb) { log('subscribe', { target: 'controller' }); const off = controller.subscribe(cb); return () => { log('unsubscribe', { target: 'controller' }); off(); }; },
  }),
  wrapManager: (manager, log) => ({
    ...manager,
    subscribe(cb) { log('subscribe', { target: 'manager' }); const off = manager.subscribe(cb); return () => { log('unsubscribe', { target: 'manager' }); off(); }; },
    dispose() { log('dispose', { target: 'manager' }); return manager.dispose(); },
  }),
  ...extra,
});

test('canonicalJson sorts keys recursively and keeps array order', () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 'x' }, null] }), '{"a":[{"c":"x","d":2},null],"b":1}');
});

test('fixture determinism: manifest hash identical across two builds; differs across n', async () => {
  const hashes = {};
  for (const n of [1, 2, 3]) {
    const a = await built(spec('M-HIT', 5, n));
    const b = await built(spec('M-HIT', 5, n));
    assert.equal(a.r.status, 'OK');
    assert.equal(b.r.status, 'OK');
    assert.match(a.r.manifest.recordsSha256, /^[0-9a-f]{64}$/);
    assert.equal(a.r.manifest.recordsSha256, b.r.manifest.recordsSha256);
    hashes[n] = a.r.manifest.recordsSha256;
    await a.cell.teardown();
    await b.cell.teardown();
  }
  assert.equal(new Set(Object.values(hashes)).size, 3);
});

for (const n of [1, 2, 3]) {
  for (const N of [1, 5]) {
    test(`Step 3 readiness predicates hold (N=${N}, n=${n})`, async () => {
      const { cell, r } = await built(spec('M-HIT', N, n));
      assert.equal(r.status, 'OK', r.reason);
      const vm = cell._ctx.m.manager.getViewModel().manager;
      assert.equal(vm.count, N);
      assert.equal(vm.view, 'list');
      assert.equal(vm.activeTestId, N === 1 ? 'test-1' : `new-${N - 1}`);
      assert.equal(vm.confirm, null);
      vm.tests.forEach((t, i) => {
        assert.equal(t.name, `CTM8-M-${N}-${n}-${i + 1}`);
        assert.equal(t.setA, 'Architecture');
        assert.equal(t.setB, SET_B[n]);
        assert.equal(t.readiness.state, 'setup-complete');
      });
      assert.equal(r.manifest.expected.setB, SET_B[n]);
      assert.equal(r.manifest.initialRecords.count, N);
      assert.equal(r.manifest.recordsBuilt, N);
      assert.equal(r.manifest.subscriberAttachedAfterBuild, true);
      await cell.teardown();
    });
  }
}

test('no calibration subscriber exists during Steps 0–3; the manager subscriber is attached at Step 3b only', async () => {
  const { cell, r } = await built(spec('M-BASE', 5, 2), loggingHooks());
  assert.equal(r.status, 'OK', r.reason);
  const ev = cell._events.map((e) => (e.target ? `${e.event}:${e.target}` : e.event));
  const at = (name) => ev.indexOf(name);
  // The ONLY controller subscription is the manager's own internal editor-sync listener, acquired inside
  // createTestsManager (Step 0) — not a calibration subscriber. No other controller subscription ever happens.
  assert.deepEqual(ev.filter((e) => e === 'subscribe:controller').length, 1);
  assert.ok(at('step0-begin') < at('subscribe:controller') && at('subscribe:controller') < at('step0-end'));
  // Exactly one manager subscription, strictly after the Step 3 predicates passed and before Step 3c.
  assert.equal(ev.filter((e) => e === 'subscribe:manager').length, 1);
  assert.ok(at('step1-end') < at('step3-end'));
  assert.ok(at('step3-end') < at('subscribe:manager'));
  assert.ok(at('subscribe:manager') < at('step3b-subscribed'));
  assert.ok(at('step3b-subscribed') < at('step3c-end'));
  await cell.teardown();
});

test('teardown order: unsubscribe -> manager.dispose() -> await controller.dispose(); listeners released', async () => {
  const { cell, r } = await built(spec('M-REC', 5, 3), loggingHooks());
  assert.equal(r.status, 'OK', r.reason);
  const { catalog, bridge } = cell._ctx.h;
  await cell.teardown();
  const ev = cell._events.map((e) => (e.target ? `${e.event}:${e.target}` : e.event));
  const tail = ev.slice(ev.indexOf('unsubscribe:manager'));
  assert.deepEqual(tail, [
    'unsubscribe:manager', 'teardown-unsubscribe', 'dispose:manager', 'unsubscribe:controller',
    'teardown-manager-dispose', 'teardown-controller-dispose',
  ]);
  assert.equal(catalog.listenerCount(), 0);
  assert.equal(bridge.listenerCount(), 0);
  await cell.teardown();                                            // idempotent
});

test('M-BASE timed window: marked region is a non-async function with no await', () => {
  const src = readFileSync(SOURCE, 'utf8');
  const begin = src.indexOf('// <CTM8-M-BASE-TIMED-WINDOW>');
  const end = src.indexOf('// </CTM8-M-BASE-TIMED-WINDOW>');
  assert.ok(begin > 0 && end > begin);
  const region = src.slice(begin, end);
  assert.doesNotMatch(region, /\bawait\b/);
  assert.doesNotMatch(region, /\basync\b/);
  assert.doesNotMatch(region, /\.then\s*\(/);
  assert.match(region, /^function mBaseTimedWindow\(/m);
  assert.match(region, /const t0 = performance\.now\(\);\s*catalog\.fire\(\);\s*const vm = manager\.getViewModel\(\);/);
  // the runner path calls the window synchronously (no await between bookkeeping and the window)
  assert.match(src, /const w = mBaseTimedWindow\(catalog, mgr\(\), lastIndex, b\.c0\);/);
});

test('M-BASE: a notification arriving only via an async continuation is excluded from the window', async () => {
  const { cell, r } = await built(spec('M-BASE', 5, 1));
  assert.equal(r.status, 'OK', r.reason);
  const sample = async () => {
    assert.equal((await cell.prepareSample()).ok, true);
    const s = await cell.runSample({ timeoutMs: 30000 });
    const z = await cell.resetSample();
    assert.equal(z.ok, true, z.reason);
    return s;
  };
  const base = await sample();
  assert.equal(base.status, 'OK');
  // A later catalog listener schedules one extra fire() as a MICROTASK during the timed fire(): it can only run after t1.
  const { catalog } = cell._ctx.h;
  let armed = false;
  const off = catalog.onChange(() => { if (armed) { armed = false; queueMicrotask(() => catalog.fire()); } });
  armed = true;
  const hooked = await sample();
  off();
  assert.equal(hooked.status, 'OK');
  assert.equal(hooked.notificationCount, base.notificationCount);
  assert.equal(hooked.extra.notif_in_window, base.extra.notif_in_window);
  assert.ok(hooked.extra.notif_after_window > base.extra.notif_after_window,
    `async notification must be counted after the window (${hooked.extra.notif_after_window} vs ${base.extra.notif_after_window})`);
  await cell.teardown();
});

for (const scenario of ['M-BASE', 'M-REC', 'M-HIT']) {
  for (const n of [1, 2, 3]) {
    test(`${scenario} n=${n}: ≥3 consecutive OK samples with reset restoring the pre-state`, async () => {
      const N = 10;
      const { cell, r } = await built(spec(scenario, N, n));
      assert.equal(r.status, 'OK', r.reason);
      const { catalog } = cell._ctx.h;
      const manager = cell._ctx.m.manager;
      const k = Math.floor(N / 2);
      for (let i = 0; i < 4; i += 1) {
        const p = await cell.prepareSample();
        assert.equal(p.ok, true, p.reason);
        const s = await cell.runSample({ timeoutMs: 30000 });
        assert.equal(s.status, 'OK', JSON.stringify(s.extra));
        assert.equal(typeof s.durationMs, 'number');
        assert.ok(s.durationMs >= 0);
        assert.equal(typeof s.notificationCount, 'number');
        assert.equal(typeof s.yieldDelta, 'number');
        assert.equal(typeof s.catalogListDelta, 'number');
        if (scenario === 'M-BASE') {
          assert.ok(s.catalogListDelta > 0);
          assert.equal(s.extra.notif_in_window, s.notificationCount);
        }
        if (scenario === 'M-HIT') {
          assert.equal(s.notificationCount, 0);
          assert.equal(s.extra.perCallMs, s.durationMs / 1000);
        }
        const z = await cell.resetSample();
        assert.equal(z.ok, true, z.reason);
        const vm = manager.getViewModel().manager;
        assert.equal(vm.count, N);
        if (scenario === 'M-BASE') {
          assert.equal(catalog.displayNameFor('mA'), 'Architecture');
          assert.equal(vm.tests[0].setA, 'Architecture');
          assert.equal(vm.tests[N - 1].setA, 'Architecture');
          assert.equal(typeof s.extra.notif_after_window, 'number');   // filled in by the reset (same object)
        }
        if (scenario === 'M-REC') {
          assert.equal(vm.tests[k].name, `CTM8-M-${N}-${n}-${k + 1}-A`);
          assert.equal(vm.activeTestId, r.manifest.scenarioParams.idK);
        }
        if (scenario === 'M-HIT') assert.equal(manager.getViewModel(), manager.getViewModel());
      }
      await cell.teardown();
    });
  }
}

test('setup timeout: a tiny setupTimeoutMs yields SETUP_TIMEOUT with progress retained; teardown still runs', async () => {
  const cell = createCell(spec('M-BASE', 50, 2), loggingHooks());
  const r = await cell.setup({ setupTimeoutMs: 1 });
  assert.equal(r.status, 'SETUP_TIMEOUT');
  assert.ok(r.manifest.recordsBuilt < 50);
  assert.equal(typeof r.manifest.setupElapsedMs, 'number');
  assert.equal(r.manifest.subscriberAttachedAfterBuild, false);
  assert.equal((await cell.prepareSample()).ok, false);
  assert.equal((await cell.runSample()).status, 'INVALID');
  const { catalog } = cell._ctx.h;
  await cell.teardown();
  assert.ok(cell._events.some((e) => e.event === 'teardown-controller-dispose'));
  assert.ok(!cell._events.some((e) => e.event === 'subscribe' && e.target === 'manager'));
  assert.equal(catalog.listenerCount(), 0);
});

test('INVALID_SETUP: a tampered fixture fails the Step 3 predicates and no subscriber is attached', async () => {
  const hooks = loggingHooks({
    beforeReadiness: async ({ m }) => { await m.do({ type: INTENT.SETUP_NAME, value: 'tampered' }); },
  });
  const { cell, r } = await built(spec('M-REC', 5, 1), hooks);
  assert.equal(r.status, 'INVALID_SETUP');
  assert.match(r.reason, /tests\[4\]\.name "tampered"/);
  assert.equal(r.manifest.subscriberAttachedAfterBuild, false);
  assert.ok(!cell._events.some((e) => e.event === 'subscribe' && e.target === 'manager'));
  assert.equal((await cell.prepareSample()).ok, false);
  await cell.teardown();
});

const turns = (count) => (async () => { for (let i = 0; i < count; i += 1) await new Promise((r) => setImmediate(r)); })();

/** Counts scheduler.advance calls (every settle round calls advance(0)). */
function spyAdvance(cell) {
  const scheduler = cell._ctx.h.scheduler;
  const original = scheduler.advance;
  const spy = { calls: 0 };
  scheduler.advance = (ms) => { spy.calls += 1; return original.call(scheduler, ms); };
  return spy;
}

test('M-REC: until round exhaustion is INVALID (until-rounds-exhausted), never folded into TIMEOUT', async () => {
  let checks = 0;
  const { cell, r } = await built(spec('M-REC', 5, 2), { untilPredicate: () => () => { checks += 1; return false; }, untilMaxRounds: 3 });
  assert.equal(r.status, 'OK', r.reason);
  assert.equal((await cell.prepareSample()).ok, true);
  const s = await cell.runSample({ timeoutMs: 30000 });
  assert.equal(s.status, 'INVALID');
  assert.equal(s.extra.reason, 'until-rounds-exhausted');
  assert.equal(checks, 3);
  assert.ok(s.durationMs < 30000);
  assert.equal((await cell.resetSample()).ok, true);
  await cell.teardown();
});

test('M-REC: a wall-clock timeout is TIMEOUT and the losing poll has stopped when runSample returns', async () => {
  let checks = 0;
  const { cell, r } = await built(spec('M-REC', 5, 2), { untilPredicate: () => () => { checks += 1; return false; } });
  assert.equal(r.status, 'OK', r.reason);
  assert.equal((await cell.prepareSample()).ok, true);
  const spy = spyAdvance(cell);
  const s = await cell.runSample({ timeoutMs: 60 });
  assert.equal(s.status, 'TIMEOUT');
  assert.equal(s.extra.reason, 'wall-clock-timeout');
  assert.equal(s.extra.pollStopped, true);
  assert.ok(s.durationMs >= 55, `durationMs ${s.durationMs}`);
  assert.ok(spy.calls > 0 && checks > 0);
  const [advances, predicateChecks] = [spy.calls, checks];
  await turns(50);
  assert.equal(spy.calls, advances, 'no settle/advance after runSample returned');
  assert.equal(checks, predicateChecks, 'no predicate check after runSample returned');
  await cell.teardown();
});

test('prepareSample bound: an overdue untimed step is aborted and stopped before it returns (INVALID_SETUP reason)', async () => {
  const { cell, r } = await built(spec('M-BASE', 5, 1), { untimedTimeoutMs: 1 });
  assert.equal(r.status, 'OK', r.reason);
  const spy = spyAdvance(cell);
  const p = await cell.prepareSample();
  assert.equal(p.ok, false);
  assert.match(p.reason, /^INVALID_SETUP: prepareSample exceeded 1 ms/);
  const advances = spy.calls;
  await turns(50);
  assert.equal(spy.calls, advances);
  await cell.teardown();
});

test('runBounded: resolves, rejects, and on timeout aborts the op and awaits its exit', async () => {
  const { runBounded } = _internals;
  assert.deepEqual(await runBounded(() => 7, 1000), { timedOut: false, ok: true, value: 7 });
  const rej = await runBounded(async () => { throw new Error('x'); }, 1000);
  assert.equal(rej.ok, false);
  assert.equal(rej.error.message, 'x');
  let exited = false;
  const out = await runBounded(async (op) => { while (!op.aborted) await new Promise((res) => setImmediate(res)); exited = true; }, 10);
  assert.deepEqual(out, { timedOut: true, stopped: true });
  assert.equal(exited, true);
  const stuck = await runBounded(() => new Promise(() => {}), 5, { graceMs: 5 });
  assert.deepEqual(stuck, { timedOut: true, stopped: false });
});

for (const which of ['wrapEditor', 'wrapManager']) {
  test(`partial setup: a throwing ${which} gives INVALID_SETUP and every acquired listener is released`, async () => {
    const cell = createCell(spec('M-HIT', 5, 3), { [which]: () => { throw new Error(`${which} boom`); } });
    const r = await cell.setup({ setupTimeoutMs: 120000 });
    assert.equal(r.status, 'INVALID_SETUP');
    assert.match(r.reason, new RegExp(`${which} boom`));
    const { catalog, bridge } = cell._ctx.h;
    assert.equal(catalog.listenerCount(), 0);
    assert.equal(bridge.listenerCount(), 0);
    const ev = cell._events.map((e) => e.event);
    if (which === 'wrapManager') assert.ok(ev.indexOf('teardown-manager-dispose') < ev.indexOf('teardown-controller-dispose'));
    else assert.ok(!ev.includes('teardown-manager-dispose'));
    assert.ok(ev.includes('teardown-controller-dispose'));
    await cell.teardown();                                          // no-op, no throw
  });
}

test('teardown: a throwing step does not skip the rest; the first error is rethrown', async () => {
  const hooks = { wrapManager: (manager) => ({ ...manager, dispose() { throw new Error('dispose boom'); } }) };
  const { cell, r } = await built(spec('M-HIT', 5, 2), hooks);
  assert.equal(r.status, 'OK', r.reason);
  const { catalog, bridge } = cell._ctx.h;
  await assert.rejects(cell.teardown(), /dispose boom/);
  const ev = cell._events.map((e) => e.event);
  assert.deepEqual(ev.slice(ev.indexOf('teardown-unsubscribe')),
    ['teardown-unsubscribe', 'teardown-error', 'teardown-raw-manager-dispose', 'teardown-controller-dispose']);
  assert.equal(catalog.listenerCount(), 0);
  assert.equal(bridge.listenerCount(), 0);
  await cell.teardown();                                            // already attempted: resolves
});

test('cellSpec validation: Family M requires kind "warm" and no profile', () => {
  assert.throws(() => createCell({ ...spec('M-HIT', 5, 1), kind: 'cold' }), /kind must be 'warm'/);
  assert.throws(() => createCell({ ...spec('M-HIT', 5, 1), kind: undefined }), /kind must be 'warm'/);
  assert.throws(() => createCell({ ...spec('M-HIT', 5, 1), profile: 'UNIFORM' }), /profile must be null\/undefined/);
  assert.doesNotThrow(() => createCell({ ...spec('M-HIT', 5, 1), profile: null }));
  assert.throws(() => createCell({ ...spec('M-HIT', 5, 4) }), /nModels/);
  assert.throws(() => createCell({ ...spec('M-NOPE', 5, 1) }), /unknown scenario/);
  assert.throws(() => createCell({ ...spec('M-HIT', 5, 1), family: 'R' }), /family must be 'M'/);
});
