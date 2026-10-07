// node analyze.mjs   (run from anywhere) -> writes summary.json next to this file, prints a brief summary.
// Reads the post-Option-D/E raw profiles in this directory (profile-full.json = run F, completed;
// profile-stop-mid.json = run M, Stop mid-run; profile-stop-head.json = run H, Stop in head unit 3b.1),
// each a JSON-encoded string of {environment..., profile: window.__CLASH_PROFILE}, and the POST-A run F
// profile (../2026-10-07-self-clash-post-option-a-profile/profile-full.json) for the before/after and the
// per-unit equivalence comparison. Every number in the post-D/E report comes from here.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HEAD_UNITS = 80;
const here = (f) => new URL(f, import.meta.url);
const load = (u) => { let v = JSON.parse(readFileSync(u, 'utf8')); if (typeof v === 'string') v = JSON.parse(v); return v; };
const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const r = (x, d = 2) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const dist = (a, d = 2) => (a.length ? { n: a.length, min: r(Math.min(...a), d), median: r(q(a, 0.5), d), mean: r(mean(a), d),
  p95: r(q(a, 0.95), d), p99: r(q(a, 0.99), d), max: r(Math.max(...a), d), sum: r(sum(a), d) } : null);
const deciles = (a) => { const out = []; for (let k = 0; k < 10; k++) out.push(r(mean(a.slice(Math.floor(k * a.length / 10), Math.floor((k + 1) * a.length / 10))), 3)); return out; };
/** least squares y = a + b*x */
const fit = (xs, ys) => { const n = xs.length; const mx = mean(xs); const my = mean(ys); let sxy = 0; let sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; } const b = sxy / sxx; return { a: my - b * mx, b }; };

function perUnit(P) {
  const ru = new Map(P.runUnits.map((u, k) => [u.unitId, { ...u, k }]));
  return P.units.map((u, i) => {
    const R = ru.get(u.unitId);
    const next = R ? P.runUnits[R.k + 1] : undefined;
    const nBracket = 2 * (u.scopeExpect?.length ?? 0);
    const dig = (u.digests ?? []).slice(0, nBracket);
    return {
      i: i + 1, unitId: u.unitId, completed: !!R, srcRoots: u.srcRoots, scopeExpect: u.scopeExpect,
      cpCalls: u.cpCalls ?? null, yields: u.yields, preProof: u.preProof ?? null, postProof: u.postProof ?? null,
      outcome: u.outcome ?? null, outPairs: u.outPairs ?? null, outDiags: u.outDiags ?? null,
      preMs: r(u.preMs), callMs: r(u.callMs), postMs: r(u.postMs), unitWallMs: R ? r(R.t1 - R.t0) : null,
      gapToNextMs: R && next ? r(next.t0 - R.t1) : null,
      wholeDigestMs: r(sum(dig.filter((d) => d.kind === 'whole').map((d) => d.ms))),
      lib: u.lib ?? null,
      counters: R ? { pairSpaceProcessed: R.pairSpaceProcessed, resultsFound: R.resultsFound, caveatCount: R.caveatCount } : null,
    };
  });
}

function phase(units) {
  const pick = (k) => units.map((u) => u[k]).filter((v) => typeof v === 'number');
  const wall = sum(pick('unitWallMs'));
  return { n: units.length, unitWallMs: dist(pick('unitWallMs')), preMs: dist(pick('preMs')), postMs: dist(pick('postMs')), callMs: dist(pick('callMs')),
    bracketMs: dist(units.filter((u) => u.preMs != null && u.postMs != null).map((u) => u.preMs + u.postMs)),
    wholeDigestMs: dist(pick('wholeDigestMs')), yields: dist(pick('yields'), 1), gapToNextMs: dist(pick('gapToNextMs'), 3),
    bracketPctOfUnitWall: r(100 * (sum(pick('preMs')) + sum(pick('postMs'))) / wall), callPctOfUnitWall: r(100 * sum(pick('callMs')) / wall) };
}

function summarize(file) {
  const doc = load(here(file)); const P = doc.profile;
  const units = perUnit(P); const done = units.filter((u) => u.completed);
  const firstT0 = P.runUnits[0]?.t0; const lastT1 = P.runUnits.at(-1)?.t1; const windowMs = lastT1 - firstT0;
  const snaps = P.snaps ?? []; const addUnit = P.addUnit ?? [];
  // long tasks inside the unit window, and per settled unit
  const lt = (P.longtasks ?? []).filter(([s]) => s >= firstT0 && s <= lastT1);
  const ltD = lt.map(([, d]) => d);
  const longtasks = P.longtaskSupported ? { supported: true, inWindow: { ...dist(ltD, 1), count: ltD.length },
    perSettledUnitMs: r(sum(ltD) / done.length, 3), shareOfWindowPct: r(100 * sum(ltD) / windowMs),
    allPage: { count: (P.longtasks ?? []).length, max: r(Math.max(0, ...(P.longtasks ?? []).map(([, d]) => d)), 1) } } : { supported: false };
  const stop = P.stopClick ? {
    clickWall: P.stopClick.wall, inFlightUnit: P.cancel?.currentUnitId ?? null, settledAtClick: P.runUnits.filter((u) => u.t1 <= P.stopClick.t).length,
    inFlightUnitElapsedAtClickMs: (() => { const u = P.units.find((x) => x.unitId === P.cancel?.currentUnitId); return u ? r(P.stopClick.t - u.tStart) : null; })(),
    clickToCancelRequestMs: P.cancel ? r(P.cancel.t - P.stopClick.t, 3) : null,
    clickToBoundaryMs: P.sealStart ? r(P.sealStart.t - P.stopClick.t) : null,
    sealMs: P.sealStart && P.sealEnd ? r(P.sealEnd - P.sealStart.t) : null,
    clickToStoppedShownMs: P.stoppedSeen ? r(P.stoppedSeen.t - P.stopClick.t) : null,
  } : null;
  // completion: provenance finishedAt (stamped when the seal builds the set) vs the last unit end, on the wall clock
  let completion = null;
  const fin = (doc.panelDetails ?? []).find(([k]) => k === 'Finished')?.[1];
  const started = (doc.panelDetails ?? []).find(([k]) => k === 'Started')?.[1];
  if (fin && P.runClickApprox) {
    const clickWallMs = Date.parse(P.runClickApprox.wall);
    const lastUnitEndWallMs = clickWallMs + (lastT1 - P.runClickApprox.t);
    completion = { engineStarted: started, engineFinishedAt: fin, engineStartedToFinishedS: r((Date.parse(fin) - Date.parse(started)) / 1000, 3),
      runClickToFinishedAtS: r((Date.parse(fin) - clickWallMs) / 1000, 3), lastUnitEndToFinishedAtMs: r(Date.parse(fin) - lastUnitEndWallMs, 0),
      runClickToLastUnitEndS: r((lastT1 - P.runClickApprox.t) / 1000, 3) };
  }
  return {
    file, mode: P.mode, capturedAt: doc.capturedAt, ua: doc.ua, viewerVersion: doc.viewerVersion, visibility: doc.visibility, viewport: doc.viewport,
    hardwareConcurrency: doc.hardwareConcurrency, fragments: doc.fragments, isOTG: doc.isOTG, panelState: doc.panelState, runClickWall: P.runClickApprox?.wall ?? null,
    unitsStarted: units.length, unitsCompleted: done.length,
    window: { firstUnitStartToLastUnitEndMs: r(windowMs), runClickToFirstUnitMs: P.runClickApprox ? r(firstT0 - P.runClickApprox.t) : null,
      unitsPerMin: r(done.length / (windowMs / 60000), 1), sumUnitWallMs: r(sum(done.map((u) => u.unitWallMs))), sumGapMs: r(sum(done.map((u) => u.gapToNextMs ?? 0))),
      sumCountersMs: r(sum(snaps), 3), sumAddUnitMs: r(sum(addUnit)) },
    completion,
    all: phase(done), head: phase(done.slice(0, HEAD_UNITS)), tail: phase(done.slice(HEAD_UNITS)),
    countersMs: { ...dist(snaps, 4), byDecileMean: deciles(snaps) },
    addUnitMs: { ...dist(addUnit, 3), byDecileMean: deciles(addUnit), tailFit: addUnit.length > HEAD_UNITS + 10 ? (() => { const xs = []; const ys = []; for (let k = HEAD_UNITS; k < addUnit.length; k++) { xs.push(k + 1); ys.push(addUnit[k]); } const f = fit(xs, ys); return { a: r(f.a, 4), bPerUnit: r(f.b, 7) }; })() : null },
    interUnitYieldMs: dist(P.interUnit ?? [], 3),
    sealSnapshot: P.sealSnapshot ? { ...P.sealSnapshot, ms: r(P.sealSnapshot.ms), countsByReasonSum: sum(P.sealSnapshot.countsByReason.map((c) => c[2])) } : null,
    finalBoundary: P.runUnits.length ? P.runUnits.at(-1) : null,
    longtasks, stop,
    progressSamples: (doc.progressSamples ?? []).map((s) => ({ wall: s.wall, settledUnits: s.settledUnits, executorStarted: s.executorStarted, state: s.state, ariaNow: s.ariaNow,
      pctText: s.pctText, unitsText: s.unitsText, trueUnitsPct: r(100 * s.settledUnits / 4294, 2),
      pairSpacePct: s.lastPairSpaceProcessed == null ? null : r(100 * s.lastPairSpaceProcessed / 9003645, 2) })),
    units: done,
  };
}

const KEYS = ['pairs', 'narrowPhasePairs', 'broadPhasePairs', 'tlasPrimitiveCandidatePairs', 'diagnostics'];
function compareUnits(aUnits, bUnits) {
  const bById = new Map(bUnits.map((u) => [u.unitId, u]));
  let compared = 0; let libSame = 0; let outSame = 0; let countersSame = 0; let proofsSame = 0; const firstDiffs = [];
  for (const a of aUnits) {
    const b = bById.get(a.unitId); if (!b) continue; compared++;
    const lib = KEYS.every((k) => a.lib?.[k] === b.lib?.[k]); if (lib) libSame++;
    const out = a.outPairs === b.outPairs && a.outDiags === b.outDiags && a.srcRoots === b.srcRoots && JSON.stringify(a.scopeExpect) === JSON.stringify(b.scopeExpect); if (out) outSame++;
    const ctr = JSON.stringify(a.counters) === JSON.stringify(b.counters); if (ctr) countersSame++;
    if (a.preProof === b.preProof && a.postProof === b.postProof && a.outcome === b.outcome) proofsSame++;
    if ((!lib || !out || !ctr) && firstDiffs.length < 5) firstDiffs.push({ unitId: a.unitId, a: { lib: a.lib, outPairs: a.outPairs, outDiags: a.outDiags, counters: a.counters }, b: { lib: b.lib, outPairs: b.outPairs, outDiags: b.outDiags, counters: b.counters } });
  }
  return { compared, libStatsIdentical: libSame, outcomeSizesIdentical: outSame, engineCountersIdentical: countersSame, proofsAndOutcomeIdentical: proofsSame, allIdentical: libSame === compared && outSame === compared && countersSame === compared && proofsSame === compared, firstDiffs };
}

const out = {};
for (const [k, f] of [['full', 'profile-full.json'], ['stopMid', 'profile-stop-mid.json'], ['stopHead', 'profile-stop-head.json']]) if (existsSync(here(f))) out[k] = summarize(f);

// Before (post-A run F) vs after (post-D/E run F): same unit ids.
const postAPath = here('../2026-10-07-self-clash-post-option-a-profile/profile-full.json');
if (existsSync(postAPath) && out.full) {
  const postA = perUnit(load(postAPath).profile).filter((u) => u.completed);
  out.equivalence_postA_F_vs_postDE_F = compareUnits(postA, out.full.units);
  // post-A per-unit snapshot() cost for the before/after table
  const PA = load(postAPath).profile;
  out.postA = { snapshotMs: { ...dist(PA.snaps, 2), byDecileMean: deciles(PA.snaps) }, gapTail: phase(postA.slice(HEAD_UNITS)).gapToNextMs,
    unitsPerMin: r(postA.length / ((PA.runUnits.at(-1).t1 - PA.runUnits[0].t0) / 60000), 1), units: postA.length,
    windowMs: r(PA.runUnits.at(-1).t1 - PA.runUnits[0].t0), tailUnitWall: phase(postA.slice(HEAD_UNITS)).unitWallMs };
}
if (out.full && out.stopMid) out.equivalence_F_vs_stopMid = compareUnits(out.full.units, out.stopMid.units);
if (out.full && out.stopHead) out.equivalence_F_vs_stopHead = compareUnits(out.full.units, out.stopHead.units);

// Final Result Set internal consistency (run F, completed).
if (out.full) {
  const f = out.full; const ss = f.sealSnapshot; const fb = f.finalBoundary;
  out.finalConsistency = { panelState: f.panelState, unitsCompleted: f.unitsCompleted, unitsStarted: f.unitsStarted,
    resultsFoundAtLastBoundary: fb.resultsFound, caveatCountAtLastBoundary: fb.caveatCount, pairSpaceProcessedAtLastBoundary: fb.pairSpaceProcessed,
    sealDiagnostics: ss && { total: ss.total, completenessAffectingCount: ss.completenessAffectingCount, unclassifiedOccurrences: ss.unclassifiedOccurrences,
      retained: ss.retained, truncated: ss.truncated, countsByReasonSum: ss.countsByReasonSum, distinctReasons: ss.countsByReason.length },
    caveatCountEqualsSealCompletenessAffecting: ss ? fb.caveatCount === ss.completenessAffectingCount : null,
    allEvaluatedEqualEqual: f.units.every((u) => u.outcome === 'evaluated' && u.preProof === 'equal' && u.postProof === 'equal'),
    sumOutPairsVsResults: { sumOutPairs: sum(f.units.map((u) => u.outPairs ?? 0)), resultsFound: fb.resultsFound } };
}

// Projection check: from the first 1,000 units only (the decision rule), vs the measured end to end.
if (out.full) {
  const P = load(here('profile-full.json')).profile; const RU = P.runUnits;
  const t1000 = RU[999].t1 - RU[0].t0; const tailPer = (RU[999].t1 - RU[HEAD_UNITS].t0) / (1000 - HEAD_UNITS);
  out.projectionFrom1000 = { measuredFirst1000S: r(t1000 / 1000, 2), tailPerUnitMs: r(tailPer, 3),
    projectedTotalS: r((t1000 + tailPer * (RU.length - 1000)) / 1000 + (P.runUnits[0].t0 - P.runClickApprox.t) / 1000, 1),
    measuredRunClickToLastUnitEndS: out.full.completion?.runClickToLastUnitEndS ?? null };
}

writeFileSync(here('summary.json'), JSON.stringify(out, null, 1));
const brief = { ...out };
for (const k of ['full', 'stopMid', 'stopHead']) if (brief[k]) brief[k] = { ...brief[k], units: `[${brief[k].units.length} units]`, progressSamples: `[${brief[k].progressSamples.length}]` };
console.log(JSON.stringify(brief, null, 1));
