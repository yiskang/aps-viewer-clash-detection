// test/clashpanel/core/derivationQueue.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDerivationQueue } from '../../../clashpanel/core/derivationQueue.js';
import { createGeneration } from '../../../clashpanel/core/generation.js';
import { DERIVATION_BUSY_MAX_RETRIES, DERIVATION_BUSY_RETRY_MS } from '../../../clashpanel/core/constants.js';
import { DerivationAbortedError, DerivationBusyError } from '../../../clashtest/index.js';
import { createDeferred, createFakeScheduler, flush } from '../support/index.mjs';

function setup() {
  const scheduler = createFakeScheduler();
  const generation = createGeneration();
  const queue = createDerivationQueue({ scheduler, generation });
  const log = [];
  let inFlight = 0;
  let maxInFlight = 0;
  /** A deferred job: records start order, its AbortSignal, and the maximum concurrency ever observed. */
  const job = (name) => {
    const d = createDeferred();
    const j = {
      name, calls: 0, signal: null, d,
      run(signal) {
        j.calls += 1; j.signal = signal; log.push(`start:${name}`);
        inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
        return d.promise.finally(() => { inFlight -= 1; });
      },
    };
    return j;
  };
  return { scheduler, generation, queue, log, job, maxInFlight: () => maxInFlight };
}
const submit = (queue, j, priority = 0, key = j.name) => queue.submit({ key, priority, job: j.run });
const busy = () => new DerivationBusyError({ limit: 2 });

test('single flight: jobs run one at a time, in submission order for equal priority, and resolve ok with their values', async () => {
  const { queue, log, job, maxInFlight } = setup();
  const [a, b, c] = [job('a'), job('b'), job('c')];
  const ps = [submit(queue, a), submit(queue, b), submit(queue, c)];
  await flush();
  assert.deepEqual(log, ['start:a']);
  a.d.resolve(1);
  await flush();
  assert.deepEqual(log, ['start:a', 'start:b']);
  b.d.resolve(2);
  await flush();
  c.d.resolve(3);
  assert.deepEqual(await Promise.all(ps), [{ status: 'ok', value: 1 }, { status: 'ok', value: 2 }, { status: 'ok', value: 3 }]);
  assert.equal(maxInFlight(), 1);
  assert.deepEqual(queue.stats(), { pending: 0, running: false, cached: 3 });
});

test('priority: lower number first, FIFO on ties, including jobs submitted in the SAME tick', async () => {
  const s = setup();
  const [low, high] = [s.job('low'), s.job('high')];
  const p1 = submit(s.queue, low, 5);
  const p2 = submit(s.queue, high, 1);
  await flush();
  assert.deepEqual(s.log, ['start:high']);
  high.d.resolve('h');
  await flush();
  low.d.resolve('l');
  await Promise.all([p1, p2]);

  const t = setup();
  const blocker = t.job('blocker');
  const rest = [t.job('low'), t.job('high'), t.job('mid1'), t.job('mid2')];
  const pb = submit(t.queue, blocker, 0);
  await flush();
  const prios = { low: 5, high: 1, mid1: 3, mid2: 3 };
  const ps = rest.map((j) => submit(t.queue, j, prios[j.name]));
  blocker.d.resolve(0);
  for (const j of ['high', 'mid1', 'mid2', 'low']) {
    await flush();
    rest.find((x) => x.name === j).d.resolve(j);
  }
  await Promise.all([pb, ...ps]);
  assert.deepEqual(t.log, ['start:blocker', 'start:high', 'start:mid1', 'start:mid2', 'start:low']);
});

test('a duplicate submit of a queued key shares the promise and can only RAISE its priority', async () => {
  const s = setup();
  const [blocker, x, y] = [s.job('blocker'), s.job('x'), s.job('y')];
  const pb = submit(s.queue, blocker);
  await flush();
  const px = submit(s.queue, x, 9);
  const py = submit(s.queue, y, 5);
  assert.equal(submit(s.queue, x, 0), px);
  assert.equal(submit(s.queue, x, 99), px);
  blocker.d.resolve(0);
  await flush();
  assert.deepEqual(s.log, ['start:blocker', 'start:x']);
  x.d.resolve(0);
  await flush();
  y.d.resolve(0);
  await Promise.all([pb, px, py]);
});

test('generation bump aborts the RUNNING job (real AbortSignal), drops queued jobs unstarted, and resolves both superseded at once', async () => {
  const s = setup();
  const [running, queued] = [s.job('running'), s.job('queued')];
  const p1 = submit(s.queue, running);
  const p2 = submit(s.queue, queued);
  await flush();
  assert.equal(running.signal.aborted, false);
  s.generation.bump();
  assert.equal(running.signal.aborted, true);
  assert.deepEqual(await p1, { status: 'superseded' });
  assert.deepEqual(await p2, { status: 'superseded' });
  assert.equal(queued.calls, 0);
  assert.equal(s.queue.stats().pending, 0);
  assert.equal(s.queue.stats().cached, 0);
  running.d.reject(new DerivationAbortedError());
  await flush();
});

test('a job that ignores the abort and later resolves (or rejects) still yields superseded: its result is dropped', async () => {
  const s = setup();
  const ok = s.job('ok');
  const p = submit(s.queue, ok);
  await flush();
  s.generation.bump();
  ok.d.resolve('late value');
  assert.deepEqual(await p, { status: 'superseded' });
  const bad = s.job('bad');
  const q = submit(s.queue, bad);
  await flush();
  s.generation.bump();
  bad.d.reject(new Error('late failure'));
  assert.deepEqual(await q, { status: 'superseded' });
});

test('the slot stays occupied until an aborted job settles: a new-generation job waits, and at most one job is ever in flight', async () => {
  const s = setup();
  const zombie = s.job('zombie');
  const next = s.job('next');
  const pz = submit(s.queue, zombie);
  await flush();
  s.generation.bump();
  assert.deepEqual(await pz, { status: 'superseded' });
  const pn = submit(s.queue, next);
  await flush();
  assert.equal(next.calls, 0);
  assert.equal(s.queue.stats().running, true);
  zombie.d.resolve('ignored abort');
  await flush();
  assert.equal(next.calls, 1);
  next.d.resolve('fresh');
  assert.deepEqual(await pn, { status: 'ok', value: 'fresh' });
  assert.equal(s.maxInFlight(), 1);
});

test('DerivationBusyError: the same job is retried after the configured backoff through the scheduler, then succeeds (one successful computation)', async () => {
  const s = setup();
  let attempts = 0;
  const p = s.queue.submit({
    key: 'g', priority: 0,
    job: () => { attempts += 1; if (attempts <= 3) throw busy(); return Promise.resolve('finally'); },
  });
  await flush();
  assert.equal(attempts, 1);
  for (let i = 1; i <= 3; i += 1) {
    assert.equal(s.scheduler.pendingTimers(), 1);
    await s.scheduler.advance(DERIVATION_BUSY_RETRY_MS - 1);
    assert.equal(attempts, i);
    await s.scheduler.advance(1);
    assert.equal(attempts, i + 1);
  }
  assert.deepEqual(await p, { status: 'ok', value: 'finally' });
  assert.deepEqual(s.scheduler.delays, [DERIVATION_BUSY_RETRY_MS, DERIVATION_BUSY_RETRY_MS, DERIVATION_BUSY_RETRY_MS]);
});

test('busy retries are bounded: 1 + DERIVATION_BUSY_MAX_RETRIES attempts, then {status:"error"} carrying the busy error; detection is by error.name', async () => {
  const s = setup();
  let attempts = 0;
  const plain = Object.assign(new Error('busy'), { name: 'DerivationBusyError' });
  const p = s.queue.submit({ key: 'g', priority: 0, job: () => { attempts += 1; return Promise.reject(plain); } });
  for (let i = 0; i < DERIVATION_BUSY_MAX_RETRIES + 1; i += 1) await s.scheduler.advance(DERIVATION_BUSY_RETRY_MS);
  const r = await p;
  assert.equal(attempts, 1 + DERIVATION_BUSY_MAX_RETRIES);
  assert.equal(r.status, 'error');
  assert.equal(r.error, plain);
  assert.equal(s.scheduler.pendingTimers(), 0);
});

test('a non-busy failure is NOT retried; a synchronous throw and a plain rejection both become {status:"error"} with the same error object', async () => {
  const s = setup();
  const boom = new Error('boom');
  let calls = 0;
  const r1 = await s.queue.submit({ key: 'throws', priority: 0, job: () => { calls += 1; throw boom; } });
  const r2 = await s.queue.submit({ key: 'rejects', priority: 0, job: () => { calls += 1; return Promise.reject(boom); } });
  assert.deepEqual([r1.status, r1.error === boom, r2.status, r2.error === boom, calls], ['error', true, 'error', true, 2]);
  assert.equal(s.scheduler.delays.length, 0);
  const notBusy = await s.queue.submit({ key: 'aborted', priority: 0, job: () => Promise.reject(new DerivationAbortedError()) });
  assert.equal(notBusy.status, 'error');
});

test('a bump during the busy backoff cancels the timer, does not retry, and resolves superseded', async () => {
  const s = setup();
  let attempts = 0;
  const p = s.queue.submit({ key: 'g', priority: 0, job: () => { attempts += 1; throw busy(); } });
  await flush();
  assert.equal(s.scheduler.pendingTimers(), 1);
  s.generation.bump();
  assert.equal(s.scheduler.pendingTimers(), 0);
  assert.deepEqual(await p, { status: 'superseded' });
  await s.scheduler.advance(10 * DERIVATION_BUSY_RETRY_MS);
  assert.equal(attempts, 1);
  const p2 = s.queue.submit({ key: 'h', priority: 0, job: () => Promise.resolve('next') });
  assert.deepEqual(await p2, { status: 'ok', value: 'next' });
});

test('a scheduler that throws while arming the backoff yields {status:"error"} (no unhandled rejection) and frees the slot', async () => {
  const s = setup();
  const boomScheduler = { ...s.scheduler, now: s.scheduler.now, setTimeout() { throw new Error('timer down'); }, clearTimeout() {}, yield: s.scheduler.yield };
  const queue = createDerivationQueue({ scheduler: boomScheduler, generation: createGeneration() });
  const r = await queue.submit({ key: 'g', priority: 0, job: () => { throw busy(); } });
  assert.equal(r.status, 'error');
  assert.match(r.error.message, /timer down/);
  assert.deepEqual(await queue.submit({ key: 'h', priority: 0, job: () => 1 }), { status: 'ok', value: 1 });
});

test('dedupe per (generation, key): same promise, one computation, cached ok served again; an error is forgotten; a new generation recomputes', async () => {
  const s = setup();
  let calls = 0;
  const spec = { key: 'summary', priority: 0, job: () => { calls += 1; return Promise.resolve(calls); } };
  const p1 = s.queue.submit(spec);
  const p2 = s.queue.submit({ ...spec, priority: 3 });
  assert.equal(p1, p2);
  assert.deepEqual(await p1, { status: 'ok', value: 1 });
  assert.equal(s.queue.submit(spec), p1);
  assert.deepEqual(await s.queue.submit(spec), { status: 'ok', value: 1 });
  assert.equal(calls, 1);
  const other = await s.queue.submit({ ...spec, key: 'mask' });
  assert.deepEqual(other, { status: 'ok', value: 2 });
  let fails = 0;
  const flaky = { key: 'flaky', priority: 0, job: () => { fails += 1; return fails === 1 ? Promise.reject(new Error('once')) : Promise.resolve('good'); } };
  assert.equal((await s.queue.submit(flaky)).status, 'error');
  assert.deepEqual(await s.queue.submit(flaky), { status: 'ok', value: 'good' });
  s.generation.bump();
  assert.deepEqual(await s.queue.submit(spec), { status: 'ok', value: 3 });
  assert.equal(calls, 3);
});

test('dispose aborts the running job, supersedes queued jobs, ignores later submits, is idempotent, and stops listening to the generation', async () => {
  const s = setup();
  const [a, b] = [s.job('a'), s.job('b')];
  const pa = submit(s.queue, a);
  const pb = submit(s.queue, b);
  await flush();
  s.queue.dispose();
  s.queue.dispose();
  assert.equal(a.signal.aborted, true);
  assert.deepEqual(await pa, { status: 'superseded' });
  assert.deepEqual(await pb, { status: 'superseded' });
  assert.equal(b.calls, 0);
  assert.deepEqual(await s.queue.submit({ key: 'late', priority: 0, job: () => 1 }), { status: 'superseded' });
  assert.equal(s.queue.stats().cached, 0);
  s.generation.bump();
  a.d.resolve('late');
  await flush();
  assert.deepEqual(s.log, ['start:a']);
});

test('a generation object WITHOUT onBump is still honored at submit, pump and settle (defensive isCurrent checks)', async () => {
  let n = 0;
  const generation = { current: () => n, isCurrent: (g) => g === n };
  const queue = createDerivationQueue({ scheduler: createFakeScheduler(), generation });
  const d = createDeferred();
  const started = [];
  const p1 = queue.submit({ key: 'a', priority: 0, job: () => { started.push('a'); return d.promise; } });
  const p2 = queue.submit({ key: 'b', priority: 0, job: () => { started.push('b'); return Promise.resolve('b'); } });
  await flush();
  n += 1;
  d.resolve('stale');
  assert.deepEqual(await p1, { status: 'superseded' });
  assert.deepEqual(await p2, { status: 'superseded' });
  assert.deepEqual(started, ['a']);
  assert.deepEqual(await queue.submit({ key: 'a', priority: 0, job: () => 'fresh' }), { status: 'ok', value: 'fresh' });
});

test('malformed arguments throw TypeError synchronously; a job may return a plain (non-promise) value', async () => {
  const s = setup();
  for (const bad of [undefined, {}, { key: '', priority: 0, job() {} }, { key: 'k', priority: 'x', job() {} }, { key: 'k', priority: NaN, job() {} }, { key: 'k', priority: 0 }, { key: 7, priority: 0, job() {} }]) {
    assert.throws(() => s.queue.submit(bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => createDerivationQueue({ generation: createGeneration() }), TypeError);
  assert.throws(() => createDerivationQueue({ scheduler: createFakeScheduler(), generation: {} }), TypeError);
  assert.deepEqual(await s.queue.submit({ key: 'plain', priority: 0, job: () => 42 }), { status: 'ok', value: 42 });
  assert.ok(Object.isFrozen(s.queue));
});
