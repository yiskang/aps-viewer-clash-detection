import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarize, renderMarkdown, run } from '../summarize.mjs';
import { enumerateCells } from '../lib/enumeration.mjs';

function sample(c, launch, phase, i, status, dur, extra = {}) {
  const r = { launchIndex: launch, cellId: c.cellId, family: c.family, scenario: c.scenario };
  r[c.family === 'M' ? 'M.N_tests' : 'R.N_results'] = c.scale;
  return { ...r, nModels: c.nModels, kind: c.kind, phase, iteration: i, status, durationMs: dur, notificationCount: 2, yieldDelta: 1, extra };
}
function make(spec) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ctm8sum-'));
  mkdirSync(path.join(dir, 'raw'));
  for (let L = 0; L < 3; L++) {
    const s = []; const cl = [];
    for (const c of enumerateCells()) {
      if (!spec.include(c, L)) continue;
      const nm = c.kind === 'warm' ? 30 : 15;
      let valid = 0;
      if (c.kind === 'warm') for (let i = 0; i < 5; i++) s.push(sample(c, L, 'warmup', i, 'OK', 1));
      for (let i = 0; i < nm; i++) {
        const bad = spec.bad?.(c, L, i);
        s.push(sample(c, L, 'measured', i, bad ?? 'OK', spec.dur(c, L, i), c.scenario === 'M-HIT' ? { perCallMs: 0.001 * (L + 1) } : {}));
        if (!bad) valid++;
      }
      cl.push({ cellSpec: c, status: spec.status?.(c, L) ?? 'COMPLETED', n_valid: valid, reason: null, wallMs: 5, gc: { count: 2, ms: 0.5 } });
    }
    writeFileSync(path.join(dir, 'raw', `headless-launch${L}.jsonl`), s.map((x) => JSON.stringify(x)).join('\n') + '\n');
    writeFileSync(path.join(dir, 'raw', `headless-launch${L}.cells.jsonl`), cl.map((x) => JSON.stringify(x)).join('\n') + '\n');
  }
  return dir;
}
const full = { include: () => true, dur: (c, L, i) => c.scale / 100 + L * 0.01 + i * 0.001 };

test('full matrix hits mandatory counts with zero shortfall', () => {
  const S = summarize(make(full));
  const r = Object.fromEntries(S.completeness.rows.map((x) => [x.name, x]));
  assert.equal(r['cell executions'].observed, 252);
  assert.equal(r['measured samples'].observed, 7020);
  assert.equal(r['warm-up samples'].observed, 1080);
  assert.equal(r['total samples'].observed, 8100);
  assert.equal(S.completeness.anyShortfall, false);
  assert.equal(S.cells.length, 84);
});

test('p95 policy: warm per-launch yes, cold n/a, pooled cold present, headline median of medians', () => {
  const S = summarize(make(full));
  const w = S.cells.find((c) => c.cellId === 'R-WARM/100/1');
  assert.equal(typeof w.perLaunch[0].p95, 'number');
  const cold = S.cells.find((c) => c.cellId === 'R-COLD/100/1');
  assert.equal(cold.perLaunch[0].p95, 'n/a');
  assert.equal(cold.pooled.label, 'POOLED');
  assert.equal(typeof cold.pooled.p95, 'number'); // 45 >= 30
  const meds = w.perLaunch.map((l) => l.median).sort((a, b) => a - b);
  assert.equal(w.headline, meds[1]);
});

test('shortfall, timeouts and dispositions are reported, not hidden', () => {
  const dir = make({
    include: (c, L) => !(L === 2 && c.scenario === 'M-BASE'),
    dur: full.dur,
    bad: (c, L, i) => (c.cellId === 'R-WARM/1000/2' && L === 0 && i < 3 ? 'TIMEOUT' : undefined),
    status: (c, L) => (c.cellId === 'R-WARM/1000/2' && L === 0 ? 'ABORTED — consecutive failures' : 'COMPLETED'),
  });
  const S = summarize(dir);
  assert.equal(S.completeness.anyShortfall, true);
  assert.equal(S.completeness.rows.find((x) => x.name === 'cell executions').shortfall, 12);
  const c = S.cells.find((x) => x.cellId === 'R-WARM/1000/2');
  assert.equal(c.perLaunch[0].n_timeout, 3);
  assert.equal(c.dispositions[0].status, 'ABORTED — consecutive failures');
  assert.equal(S.cells.find((x) => x.cellId === 'M-BASE/100/1').dispositions[2].status, 'NOT RECORDED');
  const md = renderMarkdown(S);
  assert.match(md, /Shortfall present/);
  assert.match(md, /ABORTED — consecutive failures/);
  assert.match(md, /tested points are calibration observations, not product limits/);
});

test('paired delta: three per-launch differences; indistinguishable inside spread; distinct outside', () => {
  const dir = make({
    include: () => true,
    dur: (c, L) => (c.scenario === 'R-GROUP-WARM' ? 10 + L * 5 + (c.scale === 100 ? 0.1 : 0) : c.scenario === 'R-WARM' ? 10 + L * 5 : 1),
  });
  const S = summarize(dir);
  const p = S.paired.find((x) => x.scale === 100 && x.nModels === 1);
  assert.equal(p.perLaunchDelta.length, 3);
  assert.ok(Math.abs(p.headline - 0.1) < 1e-9);
  assert.equal(p.label, 'indistinguishable'); // spread ~10
  const dir2 = make({ include: () => true, dur: (c) => (c.scenario === 'R-GROUP-WARM' ? 50 : 10) });
  assert.match(summarize(dir2).paired[0].label, /exceeds/);
});

test('M-HIT per-call, unit-cost ratios, covariates, and CLI-style run output', () => {
  const dir = make(full);
  const S = run(dir);
  const m = S.cells.find((c) => c.cellId === 'M-HIT/100/1');
  assert.deepEqual(m.mHitPerCallMs, [0.001, 0.002, 0.003]);
  const u = S.unitCost.find((x) => x.scenario === 'R-WARM' && x.nModels === 1);
  assert.equal(u.steps.length, 3);
  assert.ok(u.steps.every((s) => typeof s.ratio === 'number'));
  assert.equal(m.covariates.medianNotificationCount, 2);
  assert.equal(m.covariates.gcCount, 6);
  const md = readFileSync(path.join(dir, 'summary', 'headless-matrix.md'), 'utf8');
  assert.match(md, /POOLED/);
  assert.ok(!/\bPASS\b|\bFAIL\b/.test(md));
  JSON.parse(readFileSync(path.join(dir, 'summary', 'headless-matrix.json'), 'utf8'));
});

test('missing launch files do not crash', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ctm8sum-'));
  const S = summarize(dir);
  assert.equal(S.completeness.anyShortfall, true);
  assert.equal(S.completeness.perLaunch[0].filePresent, false);
});
