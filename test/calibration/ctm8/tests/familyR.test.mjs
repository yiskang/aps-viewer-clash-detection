// test/calibration/ctm8/tests/familyR.test.mjs — NON-PRODUCTION calibration support tests (CTM8-P0-v4 Family R).
// Verifies the §6.2 fixture (NAME, UNIFORM generator, expected counts, mC naming proof) and the §5.2 scenario cells.
// Structural/functional assertions only; no wall-clock threshold is asserted on any timed sample.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as R from '../scenarios/familyR.mjs';

const {
  NAME, generateResults, expectedCounts, buildFixture, createCell, makeNamedHarness, nameProof, pWarmFailures,
  waitFor, canonicalJson, G_STAR_ID,
} = R;

const spec = (scenario, scale, nModels) => ({
  family: 'R', scenario, scale, nModels, kind: scenario === 'R-COLD' ? 'cold' : 'warm', profile: 'UNIFORM',
  cellId: `R|${scenario}|${scale}|${nModels}|UNIFORM`,
});

test('NAME rule table (§6.2)', () => {
  const table = [
    [['mA', 2000000], 'Pipe-0 tagq tagr'],
    [['mB', 2000001], 'Pipe-1'],
    [['mC', 2000002], 'Pipe-2 tagq'],
    [['mA', 2000010], 'Pipe-10 tagq tagr'],
    [['mB', 2000015], 'Pipe-15'],
    [['mA', 1000], 'Wall-1000 tagq tagr'],
    [['mB', 1000], 'Wall-1000'],
    [['mC', 1000], 'Wall-1000'],
    [['mA', 1001], 'Wall-1001'],
    [['mC', 1999], 'Wall-1999'],
  ];
  for (const [[k, d], want] of table) assert.equal(NAME(k, d), want, `${k}/${d}`);
});

test('UNIFORM generator: pair table, a/b assignment, determinism and identical hashes across two builds', () => {
  const r3 = generateResults(100, 3);
  assert.deepEqual(r3[0], { a: ['mA', 1000], b: ['mB', 2000000] });
  assert.deepEqual(r3[10], { a: ['mA', 1001], b: ['mC', 2000010] });
  assert.deepEqual(r3[29], { a: ['mB', 1002], b: ['mC', 2000029] });
  assert.deepEqual(r3[30], { a: ['mA', 1003], b: ['mB', 2000030] });
  assert.ok(generateResults(100, 1).every((r) => r.a[0] === 'mA' && r.b[0] === 'mA'));
  assert.ok(generateResults(100, 2).every((r) => r.a[0] === 'mA' && r.b[0] === 'mB'));
  for (const n of [1, 2, 3]) {
    const x = buildFixture(1000, n);
    const y = buildFixture(1000, n);
    assert.match(x.hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(x.hash, y.hash, `n=${n} hashes equal`);
    assert.deepEqual(x.models.map((m) => m.modelKey), ['mA', 'mB', 'mC'].slice(0, n));
    assert.deepEqual(x.set.provenance.models.map((m) => m.modelKey), x.models.map((m) => m.modelKey), 'makeSet received provenance for all models');
    for (const m of x.models) assert.deepEqual([m.modelVersion, m.bindingGeneration, m.placementGeneration], ['v1', 1, 0]);
  }
  assert.notEqual(buildFixture(1000, 2).hash, buildFixture(1000, 3).hash);
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 0 }] }), '{"a":[2,{"c":0,"d":1}],"b":1}');
  assert.throws(() => generateResults(105, 1), RangeError);
});

test('expected-counts table (§6.2) for the matrix scale points', () => {
  const rows = { 100: [55, 19], 1000: [505, 109], 5000: [2505, 509], 10000: [5005, 1009] };
  for (const [N, [w1, w2]] of Object.entries(rows)) {
    const e = expectedCounts(Number(N));
    assert.equal(e.wT1, w1); assert.equal(e.wT2, w2);
    assert.equal(e.elementGroups, Number(N) + Number(N) / 10);   // 1.1·N (exact integer) assert.equal(e.uniqueParticipants, Number(N) / 10 + Number(N));
    assert.equal(e.sStar, 10); assert.equal(e.maxGroupSize, 10); assert.equal(e.gStarParticipants, 11); assert.equal(e.cold, 0);
  }
});

for (const N of [100, 1000]) {
  for (const n of [1, 2, 3]) {
    test(`first-VM / preparatory counts equal the §6.2 table (N=${N}, n=${n})`, async () => {
      const cell = createCell(spec('R-BASE', N, n));
      const s = await cell.setup({ setupTimeoutMs: 120000 });
      try {
        assert.equal(s.status, 'OK', s.reason);
        const e = expectedCounts(N);
        const o = s.manifest.observedCounts;
        assert.equal(o.total, N); assert.equal(o.filtered, N);
        assert.equal(o.elementGroups, e.elementGroups);
        assert.equal(o.maxGroupSize, e.maxGroupSize);
        assert.equal(o.wT1, e.wT1); assert.equal(o.wT2, e.wT2);
        assert.equal(o.gStarClashCount, e.sStar); assert.equal(o.gStarParticipants, e.gStarParticipants);
        assert.equal(s.manifest.coldTextProof.ok, true);
        assert.equal(s.manifest.nameProof.ok, true);
        assert.equal(s.manifest.nameProof.checked, e.uniqueParticipants);
        assert.equal(s.manifest.fixtureHash, buildFixture(N, n).hash);
        for (const key of ['S1', 'S2', 'T1', 'T2']) {
          const ref = s.manifest.references[key];
          assert.match(ref.hash, /^sha256:/); assert.equal(ref.first3.length, 3); assert.ok(ref.length >= 3 && ref.length <= 50);
          assert.equal(Object.keys(ref).sort().join(), 'first3,hash,length', 'summary only, no bulk list');
        }
      } finally { await cell.teardown(); }
    });
  }
}

test('mC injection positive: n=3 names resolve through NAME and the catalog holds the same Model object', () => {
  const h = makeNamedHarness(3);
  assert.equal(h.extraModels.mC, h.catalog.modelOf('mC'));
  const p = nameProof(h, buildFixture(100, 3));
  assert.equal(p.ok, true); assert.equal(p.mcIdentity, true); assert.equal(p.mismatchCount, 0); assert.equal(p.checked, 110);
  assert.equal(h.extraModels.mC.getObjectTree().getNodeName(2000020), 'Pipe-20 tagq tagr');
});

test('mC injection negative: skipping the getObjectTree replacement makes the proof FAIL and the cell INVALID_SETUP', async () => {
  const h = makeNamedHarness(3, { skipMcInjection: true });
  const p = nameProof(h, buildFixture(100, 3));
  assert.equal(p.ok, false);
  assert.ok(p.mismatchCount > 0);
  assert.equal(p.mismatches[0].modelKey, 'mC');
  for (const scenario of ['R-BASE', 'R-COLD']) {
    const cell = createCell(spec(scenario, 100, 3), { skipMcInjection: true });
    const s = await cell.setup({ setupTimeoutMs: 120000 });
    assert.equal(s.status, 'INVALID_SETUP');
    assert.match(s.reason, /name proof/);
    assert.equal(s.manifest.failure.nameProof.ok, false);
    await cell.teardown();
  }
  // n<3 is unaffected by the option (no mC).
  const ok = createCell(spec('R-BASE', 100, 2), { skipMcInjection: true });
  assert.equal((await ok.setup()).status, 'OK');
  await ok.teardown();
});

async function runSamples(cell, k) {
  const out = [];
  for (let i = 0; i < k; i += 1) {
    const prep = await cell.prepareSample();
    assert.equal(prep.ok, true, prep.reason);
    const r = await cell.runSample({ timeoutMs: 30000 });
    const reset = await cell.resetSample();
    assert.equal(reset.ok, true, reset.reason);
    out.push(r);
  }
  return out;
}

for (const scenario of ['R-BASE', 'R-WARM', 'R-GROUP-WARM', 'R-COLD']) {
  for (const n of [1, 2, 3]) {
    test(`${scenario} (N=100, n=${n}): consecutive OK samples; reset restores the pre-state`, async () => {
      const cell = createCell(spec(scenario, 100, n));
      const s = await cell.setup({ setupTimeoutMs: 120000 });
      try {
        assert.equal(s.status, 'OK', s.reason);
        const rs = await runSamples(cell, 4);
        for (const r of rs) {
          assert.equal(r.status, 'OK', JSON.stringify(r.extra));
          assert.ok(Number.isFinite(r.durationMs) && r.durationMs >= 0);
          assert.ok(r.notificationCount >= 1, 'the no-op subscriber observed the window');
          assert.ok(Number.isInteger(r.yieldDelta) && r.yieldDelta >= 0);
          assert.equal(r.catalogListDelta, null);
        }
        if (scenario !== 'R-COLD') {
          // after the last reset the pre-state predicate holds again (prepareSample re-verifies it)
          const again = await cell.prepareSample();
          assert.equal(again.ok, true, again.reason);
        }
      } finally { await cell.teardown(); }
    });
  }
}

test('R-WARM pre-state is P-WARM(T1); the window ends on P-WARM(T2) with W(T2)', async () => {
  const cell = createCell(spec('R-WARM', 100, 2));
  assert.equal((await cell.setup()).status, 'OK');
  try {
    const refs = cell._debug.references();
    const h = cell._debug.harness();
    assert.deepEqual(pWarmFailures(h.controller.getViewModel(), 'tagq', 55, refs.T1), []);
    assert.equal((await cell.prepareSample()).ok, true);
    const staged = h.controller.getViewModel();
    assert.equal(staged.filters.text, 'tagr', 'draft set outside the window');
    assert.equal(staged.run.counts.filtered, 55, 'committed filter still T1 before the window');
    const r = await cell.runSample({});
    assert.equal(r.status, 'OK');
    assert.deepEqual(pWarmFailures(h.controller.getViewModel(), 'tagr', 19, refs.T2), []);
    assert.equal((await cell.resetSample()).ok, true);
    assert.deepEqual(pWarmFailures(h.controller.getViewModel(), 'tagq', 55, refs.T1), []);
  } finally { await cell.teardown(); }
});

test('R-GROUP-WARM validity: presentGroup count unchanged, same G*, clashCount S* and participants identical', async () => {
  const cell = createCell(spec('R-GROUP-WARM', 100, 3));
  const s = await cell.setup();
  assert.equal(s.status, 'OK', s.reason);
  try {
    const h = cell._debug.harness();
    const p0 = s.manifest.p0;
    assert.equal(p0, h.bridge.groupPresents.length);
    const before = h.controller.getViewModel().selected;
    assert.deepEqual([before.kind, before.groupId, before.clashCount, before.participants], ['group', G_STAR_ID, 10, 11]);
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await cell.prepareSample()).ok, true);
      const r = await cell.runSample({});
      assert.equal(r.status, 'OK', JSON.stringify(r.extra));
      assert.equal(r.extra.presentGroupDelta, 0, 'no presentGroup in the window');
      const during = h.controller.getViewModel().selected;
      assert.deepEqual([during.groupId, during.clashCount, during.participants], [before.groupId, before.clashCount, before.participants]);
      assert.equal((await cell.resetSample()).ok, true);
      assert.equal(h.bridge.groupPresents.length, p0, 'reset did not present either');
    }
  } finally { await cell.teardown(); }
});

test('R-COLD: a fresh harness/controller per sample; never reused; cold staging is distinguishable from P-WARM', async () => {
  const cell = createCell(spec('R-COLD', 100, 3));
  assert.equal((await cell.setup()).status, 'OK');
  const seen = new Set();
  const harnesses = [];
  try {
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await cell.prepareSample()).ok, true);
      const h = cell._debug.harness();
      harnesses.push(h);
      const staged = h.controller.getViewModel();
      assert.equal(staged.filters.text, 'tagq');
      assert.equal(staged.filters.active, false, 'no filter ever committed in this generation');
      assert.ok(pWarmFailures(staged, 'tagq', 55, null).includes('filtered'));
      const r = await cell.runSample({});
      assert.equal(r.status, 'OK', JSON.stringify(r.extra));
      assert.ok(Array.isArray(r.extra.transitions) && r.extra.transitions.length >= 1);
      for (const t of r.extra.transitions) assert.equal(t.length, 4);
      assert.equal(Object.keys(r.extra).some((k) => /phase|commit/i.test(k)), false, 'no sub-phase durations');
      seen.add(r.extra.harnessId);
      assert.equal((await cell.resetSample()).ok, true);
      assert.equal(cell._debug.harness(), null, 'discarded');
    }
    assert.equal(seen.size, 3);
    assert.equal(new Set(harnesses).size, 3);
    assert.deepEqual(cell._debug.harnessIds, [...seen]);
  } finally { await cell.teardown(); }
});

test('pWarmFailures: a cold result (count 0, empty-filtered) can never satisfy P-WARM', () => {
  const cold = { filters: { text: 'tagq', active: true, busy: false }, results: { state: 'empty-filtered', rows: [] }, run: { counts: { filtered: 0 } } };
  const f = pWarmFailures(cold, 'tagq', 55, ['g:x']);
  assert.deepEqual(f, ['state', 'filtered', 'firstPage']);
});

test('setup-timeout path: the 120 s bound is enforced as wall clock (here a 0 ms bound) -> SETUP_TIMEOUT', async () => {
  for (const scenario of ['R-BASE', 'R-COLD']) {
    const cell = createCell(spec(scenario, 100, 1));
    const s = await cell.setup({ setupTimeoutMs: 0 });
    assert.equal(s.status, 'SETUP_TIMEOUT');
    assert.ok(s.manifest);
    await cell.teardown();
  }
});

test('rounds exhausted before the wall clock -> INVALID with until-rounds-exhausted (never TIMEOUT)', async () => {
  const cell = createCell(spec('R-BASE', 100, 1), { maxRounds: 0 });
  assert.equal((await cell.setup()).status, 'OK');
  try {
    assert.equal((await cell.prepareSample()).ok, true);
    const r = await cell.runSample({});
    assert.equal(r.status, 'INVALID');
    assert.equal(r.extra.reason, 'until-rounds-exhausted');
    assert.equal((await cell.resetSample()).ok, true);
  } finally { await cell.teardown(); }
});

test('waitFor: real wall-clock bound yields timeout; its timer is cleared on completion', async () => {
  const sched = { advance: async () => {} };
  assert.equal(await waitFor(sched, () => false, { wallMs: 30 }), 'timeout');
  assert.equal(await waitFor(sched, () => true, { wallMs: 60000 }), 'ok');      // would hold the process 60 s if not cleared
  assert.equal(await waitFor(sched, () => false, { wallMs: 60000, maxRounds: 3 }), 'rounds-exhausted');
});

test('the module has no SKEWED profile and refuses non-UNIFORM cells / wrong kinds', async () => {
  const src = await readFile(new URL('../scenarios/familyR.mjs', import.meta.url), 'utf8');
  assert.equal(/skewed/i.test(src), false);
  assert.equal(Object.keys(R).some((k) => /skew/i.test(k)), false);
  assert.throws(() => createCell({ ...spec('R-BASE', 100, 1), profile: 'OTHER' }));
  assert.throws(() => createCell({ ...spec('R-COLD', 100, 1), kind: 'warm' }));
  assert.throws(() => createCell({ ...spec('R-WARM', 100, 1), kind: 'cold' }));
});

// ── wall-clock bounds over the FULL operation, timeoutMs honoured, cleanup failures surfaced ───────────────────────

const never = () => new Promise(() => {});
const busy = (ms) => { const end = performance.now() + ms; while (performance.now() < end) { /* spin */ } };

test('runSample validates timeoutMs (positive finite number)', async () => {
  const cell = createCell(spec('R-BASE', 100, 1));
  assert.equal((await cell.setup()).status, 'OK');
  try {
    for (const bad of [0, -1, NaN, Infinity, '30000', null]) {
      await assert.rejects(cell.runSample({ timeoutMs: bad }), RangeError, String(bad));
    }
  } finally { await cell.teardown(); }
});

test('runSample honours a small timeoutMs: a trigger that completes late => TIMEOUT by durationMs >= timeoutMs (not poisoned)', async () => {
  let delay = true;
  const cell = createCell(spec('R-BASE', 100, 1), { hooks: { beforeTrigger: () => { if (delay) busy(40); } } });
  assert.equal((await cell.setup()).status, 'OK');
  try {
    assert.equal((await cell.prepareSample()).ok, true);
    const r = await cell.runSample({ timeoutMs: 20 });
    assert.equal(r.status, 'TIMEOUT');
    assert.ok(r.durationMs >= 20);
    assert.equal(r.extra.timeoutMs, 20);
    assert.equal(cell._debug.poisoned(), false);
    assert.equal((await cell.resetSample()).ok, true);
    delay = false;
    assert.equal((await cell.prepareSample()).ok, true);
    assert.equal((await cell.runSample({ timeoutMs: 30000 })).status, 'OK', 'same harness keeps working');
    assert.equal((await cell.resetSample()).ok, true);
  } finally { await cell.teardown(); }
});

test('a slow async trigger is cut off at the deadline (TIMEOUT, returned before the trigger finishes) and poisons the harness', async () => {
  const cell = createCell(spec('R-WARM', 100, 2), { hooks: { beforeTrigger: () => new Promise((r) => setTimeout(r, 400)) } });
  assert.equal((await cell.setup()).status, 'OK');
  try {
    assert.equal((await cell.prepareSample()).ok, true);
    const t = performance.now();
    const r = await cell.runSample({ timeoutMs: 30 });
    assert.ok(performance.now() - t < 300, 'did not wait for the trigger');
    assert.equal(r.status, 'TIMEOUT');
    assert.equal(r.extra.poisoned, true);
    assert.deepEqual(await cell.prepareSample(), { ok: false, reason: R.POISONED_REASON });
  } finally { await cell.teardown(); }
});

for (const scenario of ['R-BASE', 'R-WARM', 'R-GROUP-WARM']) {
  test(`${scenario}: a never-resolving trigger returns TIMEOUT at the wall-clock deadline; later prepare/reset refuse; teardown still disposes`, async () => {
    const cell = createCell(spec(scenario, 100, 3), { hooks: { beforeTrigger: never } });
    assert.equal((await cell.setup()).status, 'OK');
    assert.equal((await cell.prepareSample()).ok, true);
    const t = performance.now();
    const r = await cell.runSample({ timeoutMs: 50 });
    assert.ok(performance.now() - t < 1000);
    assert.equal(r.status, 'TIMEOUT');
    assert.ok(r.durationMs >= 50);
    assert.equal((await cell.resetSample()).ok, false);
    const p = await cell.prepareSample();
    assert.equal(p.ok, false); assert.equal(p.reason, R.POISONED_REASON);
    assert.equal((await cell.runSample({ timeoutMs: 50 })).status, 'INVALID');
    await cell.teardown();                                          // bounded; must not hang or throw
    assert.equal(cell._debug.harness(), null);
  });
}

test('R-WARM: a never-resolving scheduler.advance (the timed trigger itself) is bounded by the deadline', async () => {
  const cell = createCell(spec('R-WARM', 100, 1));
  assert.equal((await cell.setup()).status, 'OK');
  try {
    assert.equal((await cell.prepareSample()).ok, true);
    const h = cell._debug.harness();
    const real = h.scheduler.advance;
    h.scheduler.advance = (ms) => (ms > 0 ? never() : real(ms));
    const t = performance.now();
    const r = await cell.runSample({ timeoutMs: 40 });
    assert.ok(performance.now() - t < 1000);
    assert.equal(r.status, 'TIMEOUT');
    assert.equal(r.extra.reason, 'trigger exceeded the wall-clock deadline');
    h.scheduler.advance = real;
  } finally { await cell.teardown(); }
});

test('R-COLD: a hung trigger poisons only that sample harness; reset discards it and the next fresh harness measures OK', async () => {
  let hang = true;
  const cell = createCell(spec('R-COLD', 100, 2), { hooks: { beforeTrigger: () => (hang ? never() : undefined) } });
  assert.equal((await cell.setup()).status, 'OK');
  try {
    assert.equal((await cell.prepareSample()).ok, true);
    const r = await cell.runSample({ timeoutMs: 40 });
    assert.equal(r.status, 'TIMEOUT');
    assert.equal((await cell.resetSample()).ok, true, 'discarded with a bounded disposal');
    hang = false;
    assert.equal((await cell.prepareSample()).ok, true);
    assert.equal((await cell.runSample({})).status, 'OK');
    assert.equal((await cell.resetSample()).ok, true);
  } finally { await cell.teardown(); }
});

test('setup: a hung harness step (runToDone) is bounded by the setup deadline -> SETUP_TIMEOUT promptly', async () => {
  const cell = createCell(spec('R-WARM', 100, 1), { hooks: { beforeStep: (where) => (where === 'runToDone' ? never() : undefined) } });
  const t = performance.now();
  const s = await cell.setup({ setupTimeoutMs: 150 });
  assert.ok(performance.now() - t < 3000);
  assert.equal(s.status, 'SETUP_TIMEOUT');
  assert.match(s.reason, /runToDone/);
  await cell.teardown();
});

test('prepareSample: a hung untimed step is bounded and poisons the harness', async () => {
  let hang = false;
  const cell = createCell(spec('R-WARM', 100, 1), { untimedBoundMs: 100, hooks: { beforeStep: (where) => (hang && where === 'draft-T2' ? never() : undefined) } });
  assert.equal((await cell.setup()).status, 'OK');
  hang = true;
  const p = await cell.prepareSample();
  assert.equal(p.ok, false);
  assert.match(p.reason, /draft-T2/);
  assert.equal(cell._debug.poisoned(), true);
  assert.deepEqual(await cell.prepareSample(), { ok: false, reason: R.POISONED_REASON });
  await cell.teardown();
});

test('R-COLD: a failed disposal surfaces as resetSample {ok:false, reason:"dispose failed: …"}', async () => {
  const cell = createCell(spec('R-COLD', 100, 1), { hooks: { dispose: (h, role) => (role === 'cold' ? Promise.reject(new Error('boom')) : undefined) } });
  assert.equal((await cell.setup()).status, 'OK');
  assert.equal((await cell.prepareSample()).ok, true);
  assert.equal((await cell.runSample({})).status, 'OK');
  const reset = await cell.resetSample();
  assert.equal(reset.ok, false);
  assert.equal(reset.reason, 'dispose failed: boom');
  await cell.teardown();                                            // nothing left to dispose
});

test('teardown rethrows a disposal failure after best-effort cleanup; a failed preparatory disposal invalidates setup', async () => {
  const warm = createCell(spec('R-BASE', 100, 1), { hooks: { dispose: (h, role) => (role === 'main' ? Promise.reject(new Error('main-boom')) : undefined) } });
  assert.equal((await warm.setup()).status, 'OK');
  await assert.rejects(warm.teardown(), /dispose failed: main-boom/);
  assert.equal(warm._debug.harness(), null, 'released even though disposal failed');
  const prep = createCell(spec('R-BASE', 100, 1), { hooks: { dispose: (h, role) => (role === 'prep' ? Promise.reject(new Error('prep-boom')) : undefined) } });
  const s = await prep.setup();
  assert.equal(s.status, 'INVALID_SETUP');
  assert.match(s.reason, /dispose failed .*prep-boom/);
  await prep.teardown();
});

test('lifecycle at N=5000, n=3: all four scenarios set up, sample OK and reset', async () => {
  for (const scenario of ['R-BASE', 'R-WARM', 'R-GROUP-WARM', 'R-COLD']) {
    const cell = createCell(spec(scenario, 5000, 3));
    const s = await cell.setup();
    try {
      assert.equal(s.status, 'OK', `${scenario}: ${s.reason}`);
      assert.equal(s.manifest.observedCounts.elementGroups, 5500);
      assert.equal(s.manifest.observedCounts.wT1, 2505);
      assert.equal(s.manifest.observedCounts.wT2, 509);
      for (const r of await runSamples(cell, 2)) assert.equal(r.status, 'OK', `${scenario}: ${JSON.stringify(r.extra)}`);
    } finally { await cell.teardown(); }
  }
});
