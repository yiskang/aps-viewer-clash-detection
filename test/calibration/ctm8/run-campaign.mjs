// CTM8-P0-v4 headless campaign runner. NON-PRODUCTION calibration tooling (not a *.test.mjs; never part of `npm test`).
// One invocation = ONE independent launch (§7.5): run it three times with --launch 0|1|2 (three Node processes).
//   node test/calibration/ctm8/run-campaign.mjs --launch 0 --out <evidenceDir> [--only <cellId-substring>] [--max-scale N]
// --only/--max-scale exist for dev smokes (output must go to a scratch dir, never the evidence dir); a run using them is
// stamped `partial:true` in its cell log and is not a mandatory-campaign execution.
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { enumerateCells, shuffleCells, PROTOCOL } from './lib/enumeration.mjs';
import { runCell, GlobalFailure } from './lib/cellRunner.mjs';
import { createJsonlSink, collectEnvironment } from './lib/evidence.mjs';
import { createCell as createCellM } from './scenarios/familyM.mjs';
import { createCell as createCellR } from './scenarios/familyR.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const launchIndex = Number(opt('launch'));
const outDir = opt('out');
if (![0, 1, 2].includes(launchIndex) || !outDir) {
  console.error('usage: run-campaign.mjs --launch 0|1|2 --out <dir> [--only substr] [--max-scale N]');
  process.exit(2);
}
const only = opt('only');
const maxScale = opt('max-scale') ? Number(opt('max-scale')) : Infinity;
const partial = only !== undefined || Number.isFinite(maxScale);

const createCell = (spec) => (spec.family === 'M' ? createCellM(spec) : createCellR(spec));

mkdirSync(join(outDir, 'raw'), { recursive: true });
const rawPath = join(outDir, 'raw', `headless-launch${launchIndex}.jsonl`);
const cellsPath = join(outDir, 'raw', `headless-launch${launchIndex}.cells.jsonl`);
const sink = createJsonlSink(rawPath);

// GC covariate (§7.7): recorded, never a reason to exclude a sample.
let gcCount = 0;
let gcMs = 0;
try {
  new PerformanceObserver((list) => { for (const e of list.getEntries()) { gcCount += 1; gcMs += e.duration; } }).observe({ entryTypes: ['gc'] });
} catch { /* gc entries unavailable: covariate recorded as null */ }
const gcAvailable = (() => { try { return PerformanceObserver.supportedEntryTypes.includes('gc'); } catch { return false; } })();

let cells = enumerateCells();
const { order, seed, algorithm } = shuffleCells(cells, launchIndex);
cells = order.filter((c) => c.scale <= maxScale && (only === undefined || c.cellId.includes(only)));

const meta = {
  protocol: PROTOCOL, launchIndex, seed, algorithm, partial, only: only ?? null, maxScale: Number.isFinite(maxScale) ? maxScale : null,
  startedAt: new Date().toISOString(), command: `node ${process.argv.slice(1).join(' ')}`, cellOrder: cells.map((c) => c.cellId),
  environment: collectEnvironment({ repoRoot: process.cwd() }), gcAvailable,
};
writeFileSync(join(outDir, `launch${launchIndex}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`);

let globalFailure = null;
for (const cellSpec of cells) {
  const gc0 = { c: gcCount, ms: gcMs };
  const t0 = performance.now();
  try {
    const result = await runCell({ cellSpec, createCell, launchIndex, sink });
    await new Promise((r) => setImmediate(r)); // let the gc observer flush
    appendFileSync(cellsPath, `${JSON.stringify({ ...result, launchIndex, partial, wallMs: performance.now() - t0, gc: gcAvailable ? { count: gcCount - gc0.c, ms: gcMs - gc0.ms } : null })}\n`);
    if (result.cleanupFailed) {
      // Leaked listeners/timers could contaminate later cells in this process: stop, record distinctly.
      globalFailure = { cellId: cellSpec.cellId, message: `cleanup failed: ${result.reason ?? result.teardownError?.message ?? 'unknown'}` };
      console.error(`GLOBAL_FAILURE (cleanup) at ${cellSpec.cellId}`);
      break;
    }
    console.log(`[L${launchIndex}] ${cellSpec.cellId} ${result.status} valid=${result.n_valid} timeout=${result.n_timeout} invalid=${result.n_invalid} (${Math.round(performance.now() - t0)} ms)`);
  } catch (err) {
    if (err instanceof GlobalFailure) {
      globalFailure = { cellId: cellSpec.cellId, message: err.message };
      appendFileSync(cellsPath, `${JSON.stringify({ status: 'GLOBAL_FAILURE', cellSpec, launchIndex, partial, message: err.message })}\n`);
      console.error(`GLOBAL_FAILURE at ${cellSpec.cellId}: ${err.message}`);
      break;
    }
    throw err;
  }
}
writeFileSync(join(outDir, `launch${launchIndex}.done.json`), `${JSON.stringify({ finishedAt: new Date().toISOString(), cellsRun: cells.length, globalFailure }, null, 2)}\n`);
process.exit(globalFailure ? 1 : 0);
