// CTM8-P0-v4 §11/§13: NON-PRODUCTION descriptive summary of headless evidence.
// Usage: node test/calibration/ctm8/summarize.mjs --in <evidenceDir> [--out <dir>]
// No threshold, budget, limit, pass or fail is derived.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonl } from './lib/evidence.mjs';
import { arithmetic, enumerateCells, LAUNCHES, SCALES, MODELS, PROTOCOL } from './lib/enumeration.mjs';
import { summarizeLaunchCell, headlineMedianOfMedians, pooledSummary, pairedDelta, median } from './lib/stats.mjs';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const spreadOf = (perLaunch) => {
  const m = perLaunch.map((s) => s.median).filter(num);
  return m.length ? Math.max(...m) - Math.min(...m) : 'n/a';
};

function loadLaunch(dir, i) {
  const sf = path.join(dir, 'raw', `headless-launch${i}.jsonl`);
  const cf = path.join(dir, 'raw', `headless-launch${i}.cells.jsonl`);
  const done = [path.join(dir, `launch${i}.done.json`), path.join(dir, 'raw', `launch${i}.done.json`)].find(existsSync);
  let doneInfo = null;
  if (done) { try { doneInfo = JSON.parse(readFileSync(done, 'utf8')); } catch { doneInfo = { unreadable: true }; } }
  return {
    i,
    present: existsSync(sf) || existsSync(cf),
    samples: existsSync(sf) ? readJsonl(sf) : [],
    cells: existsSync(cf) ? readJsonl(cf) : [],
    doneInfo,
  };
}

export function summarize(dir) {
  const launches = Array.from({ length: LAUNCHES }, (_, i) => loadLaunch(dir, i));
  const expected = enumerateCells();
  const arith = arithmetic();
  const scaleOf = (r) => r['M.N_tests'] ?? r['R.N_results'];
  const key = (scenario, scale, nModels) => `${scenario}/${scale}/${nModels}`;

  const cells = expected.map((c) => {
    const k = key(c.scenario, c.scale, c.nModels);
    const per = launches.map((L) => {
      const all = L.samples.filter((r) => key(r.scenario, scaleOf(r), r.nModels) === k);
      const meas = all.filter((r) => r.phase === 'measured');
      const rec = L.cells.find((x) => x.cellSpec?.cellId === k) ?? null;
      return {
        launch: L.i, all, meas, rec,
        stats: summarizeLaunchCell(meas, { kind: c.kind }),
      };
    });
    const perStats = per.map((p) => p.stats);
    const pooledSamples = per.flatMap((p) => p.meas);
    const okRecs = pooledSamples.filter((r) => r.status === 'OK');
    const med = (f) => { const v = okRecs.map(f).filter(num); return v.length ? median(v) : 'n/a'; };
    const perCall = c.scenario === 'M-HIT'
      ? per.map((p) => { const v = p.meas.filter((r) => r.status === 'OK').map((r) => r.extra?.perCallMs).filter(num); return v.length ? median(v) : 'n/a'; })
      : null;
    return {
      cellId: k, scenario: c.scenario, family: c.family, kind: c.kind, scale: c.scale, nModels: c.nModels,
      perLaunch: perStats.map((s, i) => ({ launch: i, ...s })),
      headline: headlineMedianOfMedians(perStats),
      spreadOfLaunchMedians: spreadOf(perStats),
      pooled: pooledSummary(pooledSamples),
      dispositions: per.map((p) => ({
        launch: p.launch,
        status: p.rec ? p.rec.status : 'NOT RECORDED',
        reason: p.rec?.reason ?? null,
        partial: p.rec?.partial === true,
        cleanupFailed: p.rec?.cleanupFailed === true,
      })),
      mHitPerCallMs: perCall,
      covariates: {
        medianNotificationCount: med((r) => r.notificationCount),
        medianYieldDelta: med((r) => r.yieldDelta),
        gcCount: per.reduce((a, p) => a + (num(p.rec?.gc?.count) ? p.rec.gc.count : 0), 0),
        gcMs: per.reduce((a, p) => a + (num(p.rec?.gc?.ms) ? p.rec.gc.ms : 0), 0),
        wallMs: per.map((p) => (num(p.rec?.wallMs) ? p.rec.wallMs : 'n/a')),
      },
    };
  });
  const byId = new Map(cells.map((c) => [c.cellId, c]));

  // Paired delta R-GROUP-WARM - R-WARM
  const paired = [];
  for (const scale of SCALES) {
    for (const nModels of MODELS) {
      const g = byId.get(key('R-GROUP-WARM', scale, nModels));
      const w = byId.get(key('R-WARM', scale, nModels));
      const d = pairedDelta(g.perLaunch, w.perLaunch);
      const spread = Math.max(...[spreadOf(g.perLaunch), spreadOf(w.perLaunch)].filter(num), -Infinity);
      let label = 'n/a';
      if (num(d.headline) && Number.isFinite(spread)) {
        label = Math.abs(d.headline) <= spread ? 'indistinguishable' : 'exceeds run-to-run spread (descriptive)';
      }
      paired.push({
        scale, nModels, perLaunchDelta: d.perLaunch, headline: d.headline,
        spreadGroupWarm: spreadOf(g.perLaunch), spreadWarm: spreadOf(w.perLaunch), label,
      });
    }
  }

  // Per-unit-cost ratio between successive scales (descriptive)
  const unitCost = [];
  for (const s of expected.filter((c) => c.scale === SCALES[0] && c.nModels === 1).map((c) => c.scenario)) {
    for (const nModels of MODELS) {
      const rows = SCALES.map((scale) => {
        const c = byId.get(key(s, scale, nModels));
        const perUnit = num(c.headline) ? c.headline / scale : 'n/a';
        return { scale, headlineMs: c.headline, perUnitMs: perUnit };
      });
      const steps = rows.slice(1).map((r, i) => ({
        from: rows[i].scale, to: r.scale,
        ratio: num(r.perUnitMs) && num(rows[i].perUnitMs) && rows[i].perUnitMs > 0 ? r.perUnitMs / rows[i].perUnitMs : 'n/a',
      }));
      unitCost.push({ scenario: s, kind: byId.get(key(s, SCALES[0], nModels)).kind, nModels, rows, steps });
    }
  }

  // Completeness
  const observedExec = launches.reduce((a, L) => a + L.cells.length, 0);
  const observedMeasured = launches.reduce((a, L) => a + L.samples.filter((r) => r.phase === 'measured').length, 0);
  const observedWarmups = launches.reduce((a, L) => a + L.samples.filter((r) => r.phase === 'warmup').length, 0);
  const rowsC = [
    ['cells per launch (max observed)', arith.cellsPerLaunch, Math.max(...launches.map((L) => L.cells.length))],
    ['cell executions', arith.cellExecutions, observedExec],
    ['measured samples', arith.measured, observedMeasured],
    ['warm-up samples', arith.warmups, observedWarmups],
    ['total samples', arith.totalOps, observedMeasured + observedWarmups],
  ].map(([name, exp, obs]) => ({ name, expected: exp, observed: obs, shortfall: exp - obs }));
  const completeness = {
    rows: rowsC,
    perLaunch: launches.map((L) => ({
      launch: L.i, filePresent: L.present, cells: L.cells.length, samples: L.samples.length,
      measured: L.samples.filter((r) => r.phase === 'measured').length,
      warmups: L.samples.filter((r) => r.phase === 'warmup').length,
      partialCells: L.cells.filter((c) => c.partial === true).length,
      done: L.doneInfo,
      globalFailure: L.doneInfo?.globalFailure ?? null,
    })),
    anyShortfall: rowsC.some((r) => r.shortfall !== 0),
  };

  const dispositionCounts = {};
  for (const c of cells) for (const d of c.dispositions) dispositionCounts[d.status] = (dispositionCounts[d.status] ?? 0) + 1;

  return {
    protocol: PROTOCOL,
    statement: 'tested points are calibration observations, not product limits',
    cells, paired, unitCost, completeness, dispositionCounts,
  };
}

const f = (v) => (num(v) ? (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')) : String(v));
const tbl = (head, rows) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;

export function renderMarkdown(S) {
  const o = [];
  o.push(`# CTM-8 headless matrix summary (${S.protocol})\n`);
  o.push(`**Statement: ${S.statement}.** This summary is descriptive only; no limit, budget, pass or fail is derived. Times in ms. Per-launch summaries are authoritative; POOLED is secondary.\n`);

  o.push('## Mandatory completeness\n');
  o.push(tbl(['quantity', 'expected', 'observed', 'shortfall'], S.completeness.rows.map((r) => [r.name, r.expected, r.observed, r.shortfall])));
  o.push(S.completeness.anyShortfall ? '**Shortfall present: campaign evidence is INCOMPLETE relative to the mandatory matrix.**\n' : 'Observed counts equal the mandatory counts.\n');
  o.push(tbl(['launch', 'file present', 'cells', 'measured', 'warm-ups', 'partial cells', 'global failure'],
    S.completeness.perLaunch.map((l) => [l.launch, l.filePresent, l.cells, l.measured, l.warmups, l.partialCells, l.globalFailure ? JSON.stringify(l.globalFailure) : 'none recorded'])));

  o.push('## Cell dispositions\n');
  o.push(`Counts (cell x launch, 84 x 3 expected): ${Object.entries(S.dispositionCounts).map(([k, v]) => `${k}=${v}`).join(', ')}\n`);
  const nonOk = [];
  for (const c of S.cells) for (const d of c.dispositions) if (d.status !== 'COMPLETED') nonOk.push([c.cellId, d.launch, d.status, d.reason ?? '']);
  o.push(nonOk.length ? tbl(['cell', 'launch', 'disposition', 'reason'], nonOk) : 'All recorded cells COMPLETED.\n');
  const partial = [];
  for (const c of S.cells) for (const d of c.dispositions) if (d.partial) partial.push(`${c.cellId}@L${d.launch}`);
  if (partial.length) o.push(`Cells flagged partial: ${partial.join(', ')}\n`);

  for (const kind of ['warm', 'cold']) {
    const cs = S.cells.filter((c) => c.kind === kind);
    o.push(`## ${kind.toUpperCase()} cells: per-launch (authoritative) and headline\n`);
    o.push(`p95 shown only for warm with per-launch n_valid >= 20; cold p95 is n/a.\n`);
    o.push(tbl(['cell', 'launch', 'n_valid', 'n_timeout', 'n_invalid', 'min', 'median', 'max', 'p95', 'headline (median of 3 launch medians)', 'spread of launch medians'],
      cs.flatMap((c) => c.perLaunch.map((l) => [c.cellId, l.launch, l.n_valid, l.n_timeout, l.n_invalid, f(l.min), f(l.median), f(l.max), f(l.p95),
        l.launch === 0 ? `**${f(c.headline)}** [${c.perLaunch.map((x) => f(x.median)).join(', ')}]` : '', l.launch === 0 ? f(c.spreadOfLaunchMedians) : '']))));
    o.push(`## POOLED (${kind}) - secondary, not authoritative\n`);
    o.push('POOLED p95 only when pooled n_valid >= 30.\n');
    o.push(tbl(['cell', 'label', 'n_valid', 'n_timeout', 'n_invalid', 'median', 'min', 'max', 'p95'],
      cs.map((c) => [c.cellId, c.pooled.label, c.pooled.n_valid, c.pooled.n_timeout, c.pooled.n_invalid, f(c.pooled.median), f(c.pooled.min), f(c.pooled.max), f(c.pooled.p95)])));
  }

  o.push('## Paired selected-group delta (R-GROUP-WARM minus R-WARM)\n');
  o.push('Three per-launch differences of medians; headline = median of the three. Differences not larger than the run-to-run spread (per-launch median spread) are labelled indistinguishable.\n');
  o.push(tbl(['scale', 'nModels', 'delta L0', 'delta L1', 'delta L2', 'headline', 'spread G-WARM', 'spread WARM', 'label'],
    S.paired.map((p) => [p.scale, p.nModels, ...p.perLaunchDelta.map(f), f(p.headline), f(p.spreadGroupWarm), f(p.spreadWarm), p.label])));

  o.push('## Per-unit-cost ratio between successive scales (descriptive knee observation)\n');
  o.push('perUnit = headline / scale; ratio = perUnit(next) / perUnit(previous). No criterion is applied.\n');
  o.push(tbl(['scenario', 'kind', 'nModels', 'perUnit by scale', 'ratios'],
    S.unitCost.map((u) => [u.scenario, u.kind, u.nModels, u.rows.map((r) => `${r.scale}: ${f(r.perUnitMs)}`).join('; '), u.steps.map((s) => `${s.from}->${s.to}: ${f(s.ratio)}`).join('; ')])));

  o.push('## M-HIT per-call values (ms, median of per-sample perCallMs, per launch)\n');
  o.push(tbl(['cell', 'L0', 'L1', 'L2'], S.cells.filter((c) => c.mHitPerCallMs).map((c) => [c.cellId, ...c.mHitPerCallMs.map((v) => (num(v) ? v.toExponential(3) : v))])));

  o.push('## Covariates\n');
  o.push('Median notificationCount and yieldDelta over valid measured samples (all launches); gc totals summed over launches from cell records.\n');
  o.push(tbl(['cell', 'median notificationCount', 'median yieldDelta', 'gc count', 'gc ms'],
    S.cells.map((c) => [c.cellId, f(c.covariates.medianNotificationCount), f(c.covariates.medianYieldDelta), c.covariates.gcCount, f(c.covariates.gcMs)])));
  o.push('\nStatement repeated: tested points are calibration observations, not product limits.\n');
  return o.join('\n');
}

export function run(inDir, outDir = path.join(inDir, 'summary')) {
  const S = summarize(inDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'headless-matrix.json'), `${JSON.stringify(S, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'headless-matrix.md'), renderMarkdown(S));
  return S;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const get = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const inDir = get('--in');
  if (!inDir) { console.error('usage: summarize.mjs --in <evidenceDir> [--out <dir>]'); process.exit(2); }
  const S = run(path.resolve(inDir), get('--out') ? path.resolve(get('--out')) : undefined);
  const r = S.completeness.rows.find((x) => x.name === 'measured samples');
  console.log(`summary written; measured ${r.observed}/${r.expected}`);
}
