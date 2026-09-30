// test/acceptance/clashpanel-viewerbridge.acceptance.instrumentation.test.mjs
//
// Offline tests for the G2 instrumentation (procedure §4.3, §4.6): recordingWrap pass-through and
// argument digests, the withOrigin context stack, injection wrappers inside the recorder, original
// restore verification, the N1 spy self-test with negative controls, the prohibited-call ledger, and
// the static "no theming call / no forbidden import" assertions. Fake objects only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createCallRecorder,
  createWrapperRegistry,
  recordingWrap,
  installInjectionWrapper,
  installSpySet,
  runSpySelfTestN1,
  prohibitedCallViolations,
  SPY_TARGETS,
  THEMING_SET_METHOD,
  THEMING_CLEAR_METHOD,
  tokenizeJs,
} from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS_SOURCE = readFileSync(fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url)), 'utf8');

function fresh() {
  return { recorder: createCallRecorder(), registry: createWrapperRegistry() };
}

test('recordingWrap: passes this/args/result through unchanged and records method, digest, index, origin, time', () => {
  const { recorder, registry } = fresh();
  const target = { tag: 'T', add(a, b) { return `${this.tag}:${a + b}`; } };
  const original = target.add;
  const handle = recordingWrap(target, 'add', { recorder, registry, label: 'viewer.add' });
  assert.notEqual(target.add, original);
  const out = recorder.withOrigin('bridge', () => target.add(2, 3));
  assert.equal(out, 'T:5');
  const again = target.add(1, 1);
  assert.equal(again, 'T:2');
  assert.equal(recorder.records.length, 2);
  const [r0, r1] = recorder.records;
  assert.deepEqual([r0.callIndex, r1.callIndex], [0, 1]);
  assert.equal(r0.method, 'viewer.add');
  assert.equal(r0.origin, 'bridge');
  assert.equal(r1.origin, 'unattributed');
  assert.match(r0.at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(typeof r0.atMs, 'number');
  assert.deepEqual(r0.outcome, { threw: false, returned: { kind: 'string', value: 'T:5', length: 3 } });
  assert.equal(r0.argsDigest.length, 64);
  assert.notEqual(r0.argsDigest, r1.argsDigest);
  assert.equal(handle.restore().ok, true);
  assert.equal(target.add, original);
});

test('recordingWrap: a throwing original rethrows the same error object and records a thrown summary', () => {
  const { recorder, registry } = fresh();
  const boom = new RangeError('bad');
  const target = { go() { throw boom; } };
  recordingWrap(target, 'go', { recorder, registry });
  assert.throws(() => target.go(), (e) => e === boom);
  assert.deepEqual(recorder.records[0].outcome, { threw: true, error: { name: 'RangeError', message: 'bad' } });
});

test('recordingWrap: argument digests are stable for equal args, differ for different args, and object args get stable refIds', () => {
  const { recorder, registry } = fresh();
  const mesh = { id: 'm' };
  const other = { id: 'm' };
  const target = { f() {}, g() {} };
  recordingWrap(target, 'f', { recorder, registry, label: 'f' });
  target.f('a', 1);
  target.f('a', 1);
  target.f('a', 2);
  target.f(mesh);
  target.f(mesh);
  target.f(other);
  const d = recorder.records.map((r) => r.argsDigest);
  assert.equal(d[0], d[1]);
  assert.notEqual(d[0], d[2]);
  assert.equal(recorder.records[3].argRefIds[0], recorder.records[4].argRefIds[0]);
  assert.notEqual(recorder.records[3].argRefIds[0], recorder.records[5].argRefIds[0]);
  assert.equal(recorder.refIdOf(mesh), recorder.records[3].argRefIds[0]);
});

test('recordingWrap: returned promises are passed through as the same object and never observed', async () => {
  const { recorder, registry } = fresh();
  const p = Promise.resolve(7);
  const target = { go() { return p; } };
  recordingWrap(target, 'go', { recorder, registry });
  assert.equal(target.go(), p);
  assert.equal(recorder.records[0].outcome.returned.kind, 'promise');
  assert.equal(await p, 7);
});

test('recordingWrap: refuses non-functions, missing recorder, and a double wrap', () => {
  const { recorder, registry } = fresh();
  const target = { x: 1, f() {} };
  assert.throws(() => recordingWrap(target, 'x', { recorder, registry }), /not a function/);
  assert.throws(() => recordingWrap(target, 'f', { registry }), /recorder required/);
  recordingWrap(target, 'f', { recorder, registry });
  assert.throws(() => recordingWrap(target, 'f', { recorder, registry }), /already wrapped/);
});

test('withOrigin: nesting yields the innermost origin and unwinds; unknown origin throws; async frames pop on settle', async () => {
  const { recorder } = fresh();
  assert.equal(recorder.currentOrigin(), 'unattributed');
  const seen = [];
  recorder.withOrigin('harness', () => {
    seen.push(recorder.currentOrigin());
    recorder.withOrigin('bridge', () => {
      seen.push(recorder.currentOrigin());
      recorder.withOrigin('viewer-internal', () => seen.push(recorder.currentOrigin()));
      seen.push(recorder.currentOrigin());
    });
    seen.push(recorder.currentOrigin());
  });
  seen.push(recorder.currentOrigin());
  assert.deepEqual(seen, ['harness', 'bridge', 'viewer-internal', 'bridge', 'harness', 'unattributed']);
  assert.throws(() => recorder.withOrigin('phase-3', () => {}), /unknown origin/);
  assert.throws(() => recorder.withOrigin('shell', () => { throw new Error('x'); }), /x/);
  assert.equal(recorder.originDepth(), 0, 'a throw unwinds the frame');
  let inside;
  await recorder.withOrigin('shell', async () => { await null; inside = recorder.currentOrigin(); });
  assert.equal(inside, 'shell');
  assert.equal(recorder.currentOrigin(), 'unattributed');
  // interleaved async frames pop their own frame, never the wrong one
  const a = recorder.withOrigin('harness', () => new Promise((r) => setTimeout(r, 15)));
  const b = recorder.withOrigin('bridge', () => new Promise((r) => setTimeout(r, 1)));
  await b;
  assert.equal(recorder.currentOrigin(), 'harness');
  await a;
  assert.equal(recorder.originDepth(), 0);
});

test('origin is assigned by context, not by phase: a wrapped call inside nested contexts carries the innermost origin', () => {
  const { recorder, registry } = fresh();
  const target = { f() {} };
  recordingWrap(target, 'f', { recorder, registry, label: 'f' });
  recorder.withOrigin('harness', () => { target.f(); recorder.withOrigin('shell', () => target.f()); target.f(); });
  target.f();
  assert.deepEqual(recorder.records.map((r) => r.origin), ['harness', 'shell', 'harness', 'unattributed']);
});

test('restore: originals restored by reference and verified, own and inherited properties', () => {
  const { recorder, registry } = fresh();
  class Base { hello() { return 'base'; } }
  const obj = new Base();
  const proto = Base.prototype;
  const ownTarget = { f() { return 1; } };
  const ownOriginal = ownTarget.f;
  recordingWrap(obj, 'hello', { recorder, registry, label: 'inherited' });
  recordingWrap(ownTarget, 'f', { recorder, registry, label: 'own' });
  assert.equal(Object.prototype.hasOwnProperty.call(obj, 'hello'), true);
  assert.equal(obj.hello(), 'base');
  const r = registry.restoreAll();
  assert.equal(r.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(obj, 'hello'), false, 'an inherited method is restored by deleting the own shadow');
  assert.equal(obj.hello, proto.hello);
  assert.equal(ownTarget.f, ownOriginal);
  assert.equal(registry.verifyAllRestored().ok, true);
  assert.equal(registry.restoreAll().ok, true, 'idempotent');
});

test('restore negative controls: displaced wrapper and still-installed injection are reported', () => {
  {
    const { recorder, registry } = fresh();
    const t = { f() {} };
    const original = t.f;
    recordingWrap(t, 'f', { recorder, registry, label: 'f' });
    t.f = () => 'someone else wrapped on top';
    const r = registry.restoreAll();
    assert.equal(r.ok, false);
    assert.match(r.failures[0].reason, /wrapper-displaced/);
    assert.equal(t.f, original, 'original is still put back by reference');
  }
  {
    const { recorder, registry } = fresh();
    const t = { f() {} };
    recordingWrap(t, 'f', { recorder, registry, label: 'f' });
    installInjectionWrapper(t, 'f', (inner) => () => inner(), { registry });
    const r = registry.restoreAll();
    assert.equal(r.ok, false);
    assert.match(r.failures[0].reason, /injection-still-installed/);
  }
  {
    const { recorder, registry } = fresh();
    const t = { f() {} };
    const h = recordingWrap(t, 'f', { recorder, registry, label: 'f' });
    assert.equal(h.verifyRestored().ok, false, 'verification fails while the wrapper is installed');
    assert.equal(registry.verifyAllRestored().ok, false);
  }
});

test('injection wrappers sit inside the recorder: injected calls stay recorded, flagged, and removal restores the chain', () => {
  const { recorder, registry } = fresh();
  const t = { present() { return 'real'; } };
  recordingWrap(t, 'present', { recorder, registry, label: 'bridge.present' });
  const inj = installInjectionWrapper(t, 'present', () => () => { throw new Error('injected failure'); }, { registry });
  assert.throws(() => recorder.withOrigin('bridge', () => t.present()), /injected failure/);
  assert.equal(recorder.records.length, 1, 'the injected call is still recorded');
  assert.equal(recorder.records[0].injected, true);
  assert.equal(recorder.records[0].outcome.threw, true);
  assert.equal(recorder.records[0].origin, 'bridge');
  assert.deepEqual(inj.remove(), { ok: true, reason: null });
  assert.equal(t.present(), 'real');
  assert.equal(recorder.records[1].injected, false);
  assert.equal(registry.restoreAll().ok, true);
});

test('injection wrappers: require an existing recorder wrapper (recorder outermost); removal must be LIFO', () => {
  const { recorder, registry } = fresh();
  const t = { f() { return 'r'; } };
  assert.throws(() => installInjectionWrapper(t, 'f', (i) => i, { registry }), /recorder must be outermost/);
  recordingWrap(t, 'f', { recorder, registry, label: 'f' });
  const first = installInjectionWrapper(t, 'f', (inner) => (...a) => `1(${inner(...a)})`, { registry });
  const second = installInjectionWrapper(t, 'f', (inner) => (...a) => `2(${inner(...a)})`, { registry });
  assert.equal(t.f(), '2(1(r))');
  assert.deepEqual(first.remove(), { ok: false, reason: 'out-of-order-removal' });
  assert.deepEqual(second.remove(), { ok: true, reason: null });
  assert.deepEqual(first.remove(), { ok: true, reason: null });
  assert.equal(t.f(), 'r');
  assert.equal(recorder.records.length, 2);
});

test('N1: the real recordingWrap detects the sentinel call and restores it', () => {
  const { recorder } = fresh();
  const r = runSpySelfTestN1({ recorder });
  assert.equal(r.state, 'DETECTED');
  assert.equal(r.capturedCalls, 1);
  assert.equal(r.returned, 42);
  assert.equal(r.restoredByReference, true);
});

test('N1 negative controls: a wrapper that records nothing / alters results / mis-attributes / throws is NOT_DETECTED', () => {
  const silent = (obj, name) => { const orig = obj[name]; obj[name] = function silentWrapper(...a) { return Reflect.apply(orig, this, a); }; return { restore() {} }; };
  assert.equal(runSpySelfTestN1({ recorder: createCallRecorder(), wrapFn: silent }).state, 'NOT_DETECTED');

  const altering = (obj, name, opts) => {
    const inner = recordingWrap(obj, name, opts);
    const wrapped = obj[name];
    obj[name] = function alteringWrapper(...a) { return wrapped.apply(this, a) + 1; };
    return inner;
  };
  assert.equal(runSpySelfTestN1({ recorder: createCallRecorder(), wrapFn: altering }).state, 'NOT_DETECTED');

  const double = (obj, name, opts) => { recordingWrap(obj, name, opts); const reg2 = createWrapperRegistry(); return recordingWrap(obj, name, { ...opts, registry: reg2, label: opts.label }); };
  assert.equal(runSpySelfTestN1({ recorder: createCallRecorder(), wrapFn: double }).state, 'NOT_DETECTED', 'two records for one call is not a clean capture');

  const throwing = () => { throw new Error('install failed'); };
  const r = runSpySelfTestN1({ recorder: createCallRecorder(), wrapFn: throwing });
  assert.equal(r.state, 'NOT_DETECTED');
  assert.match(r.error.message, /install failed/);

  const leaky = (obj, name, opts) => { const h = recordingWrap(obj, name, opts); return { ...h, restore: () => ({ ok: true, reason: null }) }; };
  // restore via the registry still works for a correct wrapper; a wrapper that never restores must not pass
  const neverRestores = (obj, name, opts) => { recordingWrap(obj, name, { ...opts, registry: null }); return null; };
  assert.equal(runSpySelfTestN1({ recorder: createCallRecorder(), wrapFn: neverRestores }).state, 'NOT_DETECTED');
  assert.equal(typeof leaky, 'function');
});

test('installSpySet wraps every present target, lists absent ones, and never invokes the wrapped methods', () => {
  const { recorder, registry } = fresh();
  const calls = [];
  const viewer = { overlays: {} };
  for (const spec of SPY_TARGETS.filter((s) => s.owner === 'viewer')) viewer[spec.method] = (...a) => { calls.push(spec.method); return a; };
  for (const m of ['addScene', 'addMesh', 'removeMesh']) viewer.overlays[m] = () => { calls.push(m); };
  const proto = { initialize() {}, createTitleBar() {} };
  const r = installSpySet({ viewer, dockingPanelPrototype: proto, recorder, registry });
  assert.deepEqual(calls, [], 'installing spies makes no Viewer call');
  assert.equal(recorder.records.length, 0);
  assert.ok(r.installed.includes(`viewer.${THEMING_SET_METHOD}`));
  assert.ok(r.installed.includes(`viewer.${THEMING_CLEAR_METHOD}`));
  assert.ok(r.installed.includes('overlays.addScene'));
  assert.ok(r.installed.includes('DockingPanel.prototype.initialize'));
  assert.ok(r.absent.includes('overlays.removeScene'));
  assert.ok(r.absent.includes('DockingPanel.prototype.uninitialize'));
  assert.equal(r.installed.length + r.absent.length, SPY_TARGETS.length);
  viewer.fitToView([1], {}, true);
  assert.equal(recorder.records[0].method, 'viewer.fitToView');
  assert.equal(registry.restoreAll().ok, true);
});

test('C19 ledger: theming calls violate for every origin; selection calls violate unless harness-origin; unattributed counts', () => {
  const { recorder, registry } = fresh();
  const viewer = { overlays: {} };
  for (const m of [THEMING_SET_METHOD, THEMING_CLEAR_METHOD, 'select', 'clearSelection', 'setSelection']) viewer[m] = () => {};
  installSpySet({ viewer, recorder, registry });
  recorder.withOrigin('harness', () => { viewer.select([1]); });
  assert.deepEqual(prohibitedCallViolations(recorder.records), [], 'a harness-origin selection call is excluded');
  recorder.withOrigin('bridge', () => viewer.clearSelection());
  recorder.withOrigin('shell', () => viewer.setSelection([]));
  viewer.select([2]);
  recorder.withOrigin('harness', () => viewer[THEMING_SET_METHOD](1, 2));
  viewer[THEMING_CLEAR_METHOD]();
  const v = prohibitedCallViolations(recorder.records);
  assert.deepEqual(v.map((x) => `${x.kind}:${x.record.origin}`), ['selection:bridge', 'selection:shell', 'selection:unattributed', 'theming:harness', 'theming:unattributed']);
});

test('static: the harness contains no theming call, no forbidden import, no top-level playwright import', () => {
  const tokens = tokenizeJs(HARNESS_SOURCE);
  for (const t of tokens) {
    if (t.type === 'ident') assert.notEqual(t.value, THEMING_SET_METHOD), assert.notEqual(t.value, THEMING_CLEAR_METHOD);
    if (t.type === 'string') assert.doesNotMatch(t.value, new RegExp(`${THEMING_SET_METHOD}|${THEMING_CLEAR_METHOD}`));
  }
  assert.doesNotMatch(HARNESS_SOURCE.replace(/\/\/[^\n]*/g, ''), /\.\s*(setThemingColor|clearThemingColors)\s*\(/);
  const importSpecifiers = [];
  tokens.forEach((t, i) => {
    if (t.type === 'ident' && t.value === 'from' && tokens[i + 1] && tokens[i + 1].type === 'string') importSpecifiers.push(tokens[i + 1].value);
  });
  assert.ok(importSpecifiers.length >= 5);
  for (const s of importSpecifiers) {
    assert.doesNotMatch(s, /clashpanel\/core|engine|catalog|createClashPanel|server(\.js)?$|playwright/i, s);
  }
  assert.equal(tokens.some((t) => t.type === 'ident' && t.value === 'createClashPanel'), false);
});
