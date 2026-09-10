// test/performance/m4/evidence-report.mjs
//
// M4 Task 3.8: pure §7.2 aggregation rules, §16.2's summarizer discipline (duplicated from
// run-gate-m3.mjs:120-172 rather than imported, per the no-shared-module convention), and this
// phase's OWN proposed canonical-evidence-record shape. That shape is explicitly PROVISIONAL --
// Phase 2 task 2.4 (`decision-evidence-model.mjs`) is the real adapter/validator between a
// harness's raw measured record set and the verdict reducer's pure evidence-vector input, and is
// the authority on the final shape. This module deliberately does NOT call
// `decision-evidence-model.mjs` or `verdict-reducer.mjs` -- reconciling into Task 2.4's exact
// `RawMeasuredRecord` contract (which requires `targets.{tA,tB1,tB2,tC}` as already-resolved,
// non-nullable booleans -- see that module's `requireBoolean`) is explicitly out of this task's
// scope per the brief's own "Interfaces" note: "nothing here should be assumed already pinned."

// §7.2: T-a and T-b2 are HARD MAXIMA -- a single repetition over threshold fails the whole case.
// Never medianed, never subject to the 1.5x clause below.
//
// `expectedCount` (codex-review finding, Critical, task 3.8 live-wiring round) is the number of
// repetitions the §6.1.6 protocol actually calls for (typically REPETITIONS=5) -- it defaults to
// `values.length` so an omitted third argument reproduces the ORIGINAL two-argument behavior
// exactly (every one of this module's own prescribed tests calls this with 2 args and must keep
// passing unchanged). When a real expected count is supplied and fewer repetitions were determined
// than that, a PASS is downgraded to INSUFFICIENT_POPULATION -- a partial population can never
// prove every untested repetition would also have passed. A FAILURE from a partial population
// stays decisive and is never upgraded: §7.2's hard-maximum rule ("fails on ANY repetition") does
// not need the full population to already be proven wrong.
export function evaluateHardMaximum(values, thresholdMs, expectedCount = values.length) {
  if (values.length === 0) return { pass: null, worst: null, reason: 'NOT_EXERCISED — empty population' };
  const worst = Math.max(...values); // safe: length-guarded above, never Math.max(...[])
  const passes = worst <= thresholdMs;
  if (passes && values.length < expectedCount) {
    return {
      pass: null, worst,
      reason: `INSUFFICIENT_POPULATION — only ${values.length} of ${expectedCount} expected repetitions determined; cannot confirm PASS from a partial population (a determined failure would still stand)`,
    };
  }
  return { pass: passes, worst };
}

// §7.2: T-b1 and T-c are PERCENTILE statistics -- pass only if (i) the median across the 5
// repetition values is within threshold AND (ii) no single repetition exceeds 1.5x threshold.
//
// `expectedCount` (see evaluateHardMaximum's own header above for the full rationale) defaults to
// `perRepetitionValues.length`, so an omitted third argument reproduces the original two-argument
// behavior exactly. Unlike a hard maximum, ANY population shortfall here is UNEVALUABLE in either
// direction, never a pass or a fail: a percentile statistic is only meaningful over its full
// declared population (a median "of 3 out of 5" is not a defined quantity the way "the worst of 3
// out of 5, so far" still is for a hard maximum), so a partial population cannot be treated as
// decisive evidence of failure the way an over-threshold hard maximum can.
export function evaluatePercentileMedian(perRepetitionValues, thresholdMs, expectedCount = perRepetitionValues.length) {
  if (perRepetitionValues.length === 0) return { pass: null, median: null, anyOver1_5x: null, reason: 'NOT_EXERCISED — empty population' };
  const sorted = [...perRepetitionValues].sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  const anyOver1_5x = perRepetitionValues.some((v) => v > thresholdMs * 1.5);
  if (perRepetitionValues.length < expectedCount) {
    return {
      pass: null, median, anyOver1_5x,
      reason: `INSUFFICIENT_POPULATION — only ${perRepetitionValues.length} of ${expectedCount} expected repetitions determined; a percentile statistic requires the full population`,
    };
  }
  return { pass: median <= thresholdMs && !anyOver1_5x, median, anyOver1_5x };
}

// §16.2/§6.1.8: population summary with 8ms/24.8ms/50ms counts+fractions and an explicit
// empty-set guard -- duplicated shape from run-gate-m3.mjs's own summarizeDurations
// (run-gate-m3.mjs:153-172), extended with the three named thresholds §6.1.8 requires (M3's
// version only tracked frameBudgetMs).
//
// Field naming (minMs/p50Ms/.../maxMs/meanMs/sumMs) matches run-gate-m3.mjs's own convention
// exactly, not this task's own brief excerpt (which named the same fields `min`/`p50`/`max` with
// no `Ms` suffix) -- the brief excerpt's own prescribed Step-1 test asserts `s.maxMs`, which only
// the M3-convention naming satisfies; reconciled in favor of the convention + the test, both of
// which agree, over the excerpt's inconsistent-with-itself field list.
export function summarizeDurations(msValues, thresholds = [8, 24.8, 50]) {
  if (msValues.length === 0) {
    const empty = { count: 0, minMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null, meanMs: null, sumMs: 0 };
    for (const t of thresholds) { empty[`over${t}msCount`] = 0; empty[`over${t}msFraction`] = null; }
    return empty;
  }
  const sorted = [...msValues].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  const out = { count: sorted.length, minMs: sorted[0], p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: sorted[sorted.length - 1], meanMs: sum / sorted.length, sumMs: sum };
  for (const t of thresholds) {
    const c = sorted.filter((v) => v > t).length;
    out[`over${t}msCount`] = c;
    out[`over${t}msFraction`] = c / sorted.length;
  }
  return out;
}

export function summarizeSpans(spans, topN = 20) {
  const byLabel = {};
  for (const s of spans) {
    const entry = (byLabel[s.label] ||= { count: 0, maxMs: 0, sumMs: 0 });
    entry.count++; entry.maxMs = Math.max(entry.maxMs, s.ms); entry.sumMs += s.ms;
  }
  for (const label of Object.keys(byLabel)) byLabel[label].meanMs = byLabel[label].sumMs / byLabel[label].count;
  return { byLabel, top: [...spans].sort((a, b) => b.ms - a.ms).slice(0, topN) };
}

export function summarizeDiagnostics(diagnostics, sampleN = 20) {
  const byReason = {};
  for (const d of diagnostics) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  return { count: diagnostics.length, byReason, sample: diagnostics.slice(0, sampleN) };
}

// This phase's own proposed canonical evidence-record shape -- ONE record per (case, broadPhase,
// state) tuple. Marked shapeStatus:'PROVISIONAL' deliberately, per this phase's own instructions:
// Phase 2 task 2.4 is the real adapter/validator and may reshape this before the reducer ever
// consumes it.
export function buildEvidenceRecord({ runtime, caseName, broadPhase, state, targets, correctness }) {
  return {
    runtime, case: caseName, broadPhase, state,
    targets: { Ta: targets.Ta, Tb1: targets.Tb1, Tb2: targets.Tb2, Tc: targets.Tc },
    partition: targets.partition ?? null, // §6.3 main-only/transferable, per tuple
    capacityRejected: targets.capacityRejected ?? null,
    correctnessGate: correctness, // 'PASSED' | 'FAILED_VALIDATION' | 'NOT_COMPARED'
    shapeStatus: 'PROVISIONAL — reconciled by Phase 2 task 2.4',
  };
}
