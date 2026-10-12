// CTM8-P0-v4 headed corroboration: fold the per-point raw records (headed/points/*.json, written in-page by the
// runtime-injected instrumentation) into headed/results.json. Median/min/max only (§9.2; no p95). Pure file transform.
// Usage: node test/calibration/ctm8/headed/summarize-headed.mjs <headed-evidence-dir>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function summarize(values) {
  const s = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (s.length === 0) return { n: 0, median: null, min: null, max: null };
  const m = s.length >> 1;
  return { n: s.length, median: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2, min: s[0], max: s[s.length - 1] };
}
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x);

export function sampleRow(s) {
  return {
    label: s.label, warmup: s.warmup === true, status: s.status, durationMs: r1(s.durationMs),
    afterDebounceNominalMs: r1(s.afterDebounceNominalMs ?? null), afterFirstBusyMs: r1(s.afterFirstBusyMs ?? null),
    notifications: s.notifications, mutations: s.mutations, longtaskCount: s.longtasks?.count ?? null, longtaskMaxMs: r1(s.longtasks?.maxMs ?? null),
    resetFailed: s.resetFailed === true, viewerUnchanged: s.viewerUnchanged ?? null,
    transitions: s.scenario === 'HB-COLD' ? s.transitions : undefined,
    provisionalEmptyFilteredSeen: s.provisionalEmptyFilteredSeen ?? undefined, emptyFilteredSpanMs: s.emptyFilteredSpanMs ?? undefined,
    pre: s.pre ?? undefined,
  };
}

export function foldPoint(p, meta) {
  const scenarios = {};
  for (const [k, sc] of Object.entries(p.scenarios)) {
    if (!sc.samples) { scenarios[k] = { status: sc.status }; continue; }
    const measured = sc.samples.filter((s) => !s.warmup);
    const ok = measured.filter((s) => s.status === 'OK');
    scenarios[k] = {
      status: ok.length === measured.length ? 'EXECUTED' : 'EXECUTED (with non-OK samples)',
      n_measured: measured.length, n_ok: ok.length, n_warmup: sc.samples.length - measured.length,
      durationMs: summarize(ok.map((s) => s.durationMs)),
      afterDebounceNominalMs: k === 'HB-BASE' ? null : summarize(ok.map((s) => s.afterDebounceNominalMs)),
      afterFirstBusyMs: k === 'HB-BASE' ? null : summarize(ok.map((s) => s.afterFirstBusyMs)),
      Gdagger: sc.Gdagger,
      samples: sc.samples.map(sampleRow),
    };
  }
  const hv = Object.fromEntries(Object.entries(p.hv).map(([k, x]) => [k, { pass: x.pass, settled: x.settled, detail: x }]));
  return {
    pointId: p.pid, nModels: p.cfg.nModels, ...meta[p.pid], definition: p.cfg, modelsInResults: p.modelOptions,
    counts: { configuredMaxResultsPerRun: '100,000 (options.js default, source-derived; not observable via public VM)', produced: p.run0.counts.total, retained: p.run0.counts.total, truncated: /result limit/.test(p.run0.headline), headline: p.run0.headline, doneKind: p.run0.doneKind, runMs: p.run0.runMs },
    sentinel: { T1: p.sentinel.T1, T2: p.sentinel.T2, valid: p.sentinel.valid, C_T1: p.sentinel.prep?.T1?.C, C_T2: p.sentinel.prep?.T2?.C, coldCountObservedT1: p.sentinel.coldCountObservedT1, Gdagger: p.sentinel.Gdagger },
    scenarios, hv, actions: p.actions, screenshots: p.screenshots, errors: p.errors, rawFile: `points/${p.pid}.json`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  const meta = JSON.parse(readFileSync(join(dir, 'point-meta.json'), 'utf8'));
  const points = readdirSync(join(dir, 'points')).filter((f) => f.endsWith('.json')).sort()
    .map((f) => foldPoint(JSON.parse(readFileSync(join(dir, 'points', f), 'utf8')), meta.points));
  const out = { protocol: 'CTM8-P0-v4', part: 'headed corroboration (§9)', generatedAt: new Date().toISOString(), familyM: meta.familyM, notReachable: meta.notReachable, points };
  writeFileSync(join(dir, 'results.json'), JSON.stringify(out, null, 2));
  const rows = out.points.map((p) => [p.pointId, p.counts.produced, ...['HB-BASE', 'HB-WARM', 'HB-GROUP', 'HB-COLD'].map((k) => {
    const d = p.scenarios[k]?.durationMs; return d ? `${r1(d.median)} [${r1(d.min)}–${r1(d.max)}] (n=${d.n})` : p.scenarios[k]?.status;
  }), ...['HV-1', 'HV-2', 'HV-3', 'HV-4'].map((k) => (p.hv[k]?.pass ? 'pass' : 'NOT MET'))]);
  console.log(rows.map((r) => r.join(' | ')).join('\n'));
}
