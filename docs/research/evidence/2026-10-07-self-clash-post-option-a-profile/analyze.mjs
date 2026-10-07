// node analyze.mjs   (run from anywhere) -> writes summary.json next to this file, prints a brief summary.
// Reads the post-Option-A raw profiles (profile-*.json in this directory, each a JSON-encoded string or
// object of the page's window.__CLASH_PROFILE plus environment fields, exactly as captured) and the
// PRE-A run F profile (../2026-10-07-self-clash-real-profile/profile-full.json) for the before/after and
// per-unit result-integrity comparison. Every number in the post-Option-A report comes from here.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HEAD_UNITS = 80;   // the plan's first 80 units hold ~87% of narrow-phase pairs (offline M2, §3.2)
const here = (f) => new URL(f, import.meta.url);
const load = (u) => { let v = JSON.parse(readFileSync(u, 'utf8')); if (typeof v === 'string') v = JSON.parse(v); return v; };
const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const r = (x, d = 2) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const dist = (a, d = 2) => (a.length ? { n: a.length, min: r(Math.min(...a), d), p05: r(q(a, 0.05), d), median: r(q(a, 0.5), d), mean: r(mean(a), d),
  p95: r(q(a, 0.95), d), p99: r(q(a, 0.99), d), max: r(Math.max(...a), d), sum: r(sum(a), d) } : null);

function perUnit(P) {
  const ru = new Map(P.runUnits.map((u) => [u.unitId, u]));
  const order = P.runUnits.map((u) => u.unitId);
  return P.units.map((u, i) => {
    const R = ru.get(u.unitId);
    const k = order.indexOf(u.unitId);
    const next = k >= 0 ? P.runUnits[k + 1] : undefined;
    const nBracket = 2 * (u.scopeExpect?.length ?? 0);
    const dig = (u.digests ?? []).slice(0, nBracket);
    const whole = dig.filter((d) => d.kind === 'whole');
    const roots = dig.filter((d) => d.kind === 'roots');
    return {
      i: i + 1, unitId: u.unitId, completed: !!R, srcRoots: u.srcRoots, targets: u.targets, scopeExpect: u.scopeExpect,
      cpCalls: u.cpCalls ?? null, yields: u.yields, preYields: u.preYields, postYields: u.postYields, preCp: u.preCp ?? null, postCp: u.postCp ?? null,
      preProof: u.preProof ?? null, postProof: u.postProof ?? null, outcome: u.outcome ?? null, outPairs: u.outPairs ?? null, outDiags: u.outDiags ?? null,
      preMs: r(u.preMs), callMs: r(u.callMs), postMs: r(u.postMs), unitWallMs: R ? r(R.t1 - R.t0) : null,
      // gap from this unit's end to the next unit's start: snapshot() + interUnitYield + boundary work
      gapToNextMs: R && next ? r(next.t0 - R.t1) : null,
      yieldWaitMs: P.lite ? null : r(u.yieldMs),
      wholeDigestMs: r(sum(whole.map((d) => d.ms))), wholeDigestYields: sum(whole.map((d) => d.yields)),
      rootsDigestMs: r(sum(roots.map((d) => d.ms))), rootsDigestYields: sum(roots.map((d) => d.yields)),
      lib: u.lib ?? null,
    };
  });
}

function phaseStats(units) {
  const pick = (k) => units.map((u) => u[k]).filter((v) => typeof v === 'number');
  const wall = sum(pick('unitWallMs'));
  return {
    n: units.length,
    unitWallMs: dist(pick('unitWallMs')), preMs: dist(pick('preMs')), postMs: dist(pick('postMs')), callMs: dist(pick('callMs')),
    bracketMs: dist(units.filter((u) => u.preMs != null && u.postMs != null).map((u) => u.preMs + u.postMs)),
    wholeDigestMs: dist(pick('wholeDigestMs')), rootsDigestMs: dist(pick('rootsDigestMs')),
    yieldWaitMs: dist(pick('yieldWaitMs')), cpCalls: dist(pick('cpCalls'), 1), yields: dist(pick('yields'), 1),
    gapToNextMs: dist(pick('gapToNextMs')),
    shares: {
      bracketPctOfUnitWall: r(100 * (sum(pick('preMs')) + sum(pick('postMs'))) / wall),
      callPctOfUnitWall: r(100 * sum(pick('callMs')) / wall),
      yieldWaitPctOfUnitWall: r(100 * sum(pick('yieldWaitMs')) / wall),
    },
  };
}

function summarize(file) {
  const doc = load(here(file)); const P = doc.profile;
  const units = perUnit(P);
  const done = units.filter((u) => u.completed);
  const head = done.slice(0, HEAD_UNITS); const tail = done.slice(HEAD_UNITS);
  const lat = P.lat ?? [];
  const firstT0 = P.runUnits[0]?.t0; const lastT1 = P.runUnits.at(-1)?.t1;
  const windowMs = lastT1 - firstT0;
  const hist = {}; for (const d of lat) { const b = d < 1 ? '<1' : d < 4 ? '1-4' : d < 4.5 ? '4-4.5' : d < 5 ? '4.5-5' : d < 6 ? '5-6' : d < 8 ? '6-8' : d < 16 ? '8-16' : d < 50 ? '16-50' : '>=50'; hist[b] = (hist[b] || 0) + 1; }
  const snaps = P.snaps ?? [];
  const snapByDecile = []; for (let k = 0; k < 10; k++) { const s = snaps.slice(Math.floor(k * snaps.length / 10), Math.floor((k + 1) * snaps.length / 10)); snapByDecile.push(r(mean(s))); }
  const proofs = {}; for (const u of done) { const key = `${u.preProof}/${u.postProof}/${u.outcome}`; proofs[key] = (proofs[key] || 0) + 1; }
  const stop = P.stopClick ? {
    clickWall: P.stopClick.wall, inFlightUnit: P.cancel?.currentUnitId ?? null,
    inFlightUnitIndex: P.cancel ? units.findIndex((x) => x.unitId === P.cancel.currentUnitId) + 1 : null,
    inFlightUnitElapsedAtClickMs: (() => { const u = P.units.find((x) => x.unitId === P.cancel?.currentUnitId); return u ? r(P.stopClick.t - u.tStart) : null; })(),
    clickToCancelRequestMs: P.cancel ? r(P.cancel.t - P.stopClick.t, 3) : null,
    clickToBoundaryMs: P.sealStart ? r(P.sealStart.t - P.stopClick.t) : null,
    sealMs: P.sealStart && P.sealEnd ? r(P.sealEnd - P.sealStart.t) : null,
    clickToStoppedShownMs: P.stoppedSeen ? r(P.stoppedSeen.t - P.stopClick.t) : null,
  } : null;
  return {
    file, mode: P.mode, capturedAt: doc.capturedAt, ua: doc.ua, viewerVersion: doc.viewerVersion, visibility: doc.visibility,
    viewport: doc.viewport, hardwareConcurrency: doc.hardwareConcurrency, fragments: doc.fragments, isOTG: doc.isOTG,
    runClickWall: P.runClickApprox?.wall ?? null,
    unitsStarted: units.length, unitsCompleted: done.length,
    window: { firstUnitStartToLastUnitEndMs: r(windowMs), runClickToFirstUnitMs: P.runClickApprox ? r(firstT0 - P.runClickApprox.t) : null,
      runClickToSealEndMs: P.runClickApprox && P.sealEnd ? r(P.sealEnd - P.runClickApprox.t) : null,
      unitsPerMin: r(done.length / (windowMs / 60000), 1),
      sumUnitWallMs: r(sum(done.map((u) => u.unitWallMs))), sumGapMs: r(sum(done.map((u) => u.gapToNextMs ?? 0))) },
    totals: { cpCalls: P.cpTotal ?? null, yields: P.yieldTotal, yieldWaitMs: P.lite ? null : r(P.yieldSum) },
    all: phaseStats(done), head: phaseStats(head), tail: phaseStats(tail),
    proofs,
    yieldLatency: P.lite ? null : { ...dist(lat, 3), fracAtLeast4ms: r(lat.filter((d) => d >= 4).length / lat.length, 4), hist },
    globalZeroDelaySetTimeout: P.lite ? null : P.timers,
    interUnitYieldMs: dist(P.interUnit ?? [], 3),
    snapshotMs: { ...dist(snaps, 2), byDecileMean: snapByDecile, first: r(snaps[0]), last: r(snaps.at(-1)) },
    finalCounts: P.runUnits.length ? { resultsFoundAtLastBoundary: P.runUnits.at(-1).resultsFound, caveatsAtLastBoundary: P.runUnits.at(-1).caveatCount } : null,
    sealStart: P.sealStart ?? null, sealMs: P.sealStart && P.sealEnd ? r(P.sealEnd - P.sealStart.t) : null,
    stop,
    units,
  };
}

/** Per-unit result integrity against the PRE-A run F for every unit id present in both. */
function integrity(post) {
  const preDoc = load(here('../2026-10-07-self-clash-real-profile/profile-full.json'));
  const pre = perUnit(preDoc.profile).filter((u) => u.completed);
  const postById = new Map(post.units.filter((u) => u.completed).map((u) => [u.unitId, u]));
  const keys = ['pairs', 'narrowPhasePairs', 'broadPhasePairs', 'tlasPrimitiveCandidatePairs', 'diagnostics'];
  const rows = pre.map((a) => {
    const b = postById.get(a.unitId);
    if (!b) return { unitId: a.unitId, compared: false };
    const diffs = keys.filter((k) => a.lib?.[k] !== b.lib?.[k]);
    const shapeSame = a.srcRoots === b.srcRoots && JSON.stringify(a.scopeExpect) === JSON.stringify(b.scopeExpect);
    return { unitId: a.unitId, compared: true, shapeSame, identical: diffs.length === 0 && shapeSame, diffs,
      pre: Object.fromEntries(keys.map((k) => [k, a.lib?.[k]])), post: Object.fromEntries(keys.map((k) => [k, b.lib?.[k]])),
      postOutPairs: b.outPairs, postProofs: `${b.preProof}/${b.postProof}` };
  });
  // Cumulative engine counters at the same boundary (resultsFound/caveatCount lag one unit in both profiles).
  const preRU = preDoc.profile.runUnits; const postRU = new Map(post.__runUnits.map((u) => [u.unitId, u]));
  const counters = preRU.map((a) => { const b = postRU.get(a.unitId); return b ? { unitId: a.unitId, same: a.resultsFound === b.resultsFound && a.caveatCount === b.caveatCount && a.pairSpaceProcessed === b.pairSpaceProcessed,
    pre: [a.pairSpaceProcessed, a.resultsFound, a.caveatCount], post: [b.pairSpaceProcessed, b.resultsFound, b.caveatCount] } : null; }).filter(Boolean);
  const preStats = phaseStats(pre);
  return { comparedUnits: rows.filter((x) => x.compared).length, allIdentical: rows.every((x) => !x.compared || x.identical),
    countersIdentical: counters.every((c) => c.same), rows, counters, preF: { stats: preStats } };
}

const files = ['profile-full.json', 'profile-lite.json', 'profile-stop2.json'].filter((f) => existsSync(here(f)));
const out = {};
for (const f of files) {
  out[f.replace(/^profile-|\.json$/g, '')] = summarize(f);
}
if (out.full) {
  out.full.__runUnits = load(here('profile-full.json')).profile.runUnits;
  out.integrity = integrity(out.full);
  delete out.full.__runUnits;
}
// Cross-run reproducibility (post-A F vs post-A L / stop2): same unit ids -> same library statistics and
// same engine counters at the same boundary.
for (const other of ['lite', 'stop2']) {
  if (!out.full || !out[other]) continue;
  const fById = new Map(out.full.units.filter((u) => u.completed).map((u) => [u.unitId, u]));
  const keys = ['pairs', 'narrowPhasePairs', 'broadPhasePairs', 'tlasPrimitiveCandidatePairs', 'diagnostics'];
  const rows = out[other].units.filter((u) => u.completed).map((b) => { const a = fById.get(b.unitId); return a ? keys.every((k) => a.lib?.[k] === b.lib?.[k]) && a.outPairs === b.outPairs : null; }).filter((x) => x !== null);
  const fRU = new Map(load(here('profile-full.json')).profile.runUnits.map((u) => [u.unitId, u]));
  const oRU = load(here(`profile-${other}.json`)).profile.runUnits;
  const counters = oRU.map((b) => { const a = fRU.get(b.unitId); return a ? a.resultsFound === b.resultsFound && a.caveatCount === b.caveatCount && a.pairSpaceProcessed === b.pairSpaceProcessed : null; }).filter((x) => x !== null);
  out[`crossRun_full_vs_${other}`] = { comparedUnits: rows.length, libAndOutPairsIdentical: rows.every(Boolean), countersCompared: counters.length, countersIdentical: counters.every(Boolean) };
}
writeFileSync(here('summary.json'), JSON.stringify(out, null, 2) + '\n');
const brief = (s) => { const { units, ...rest } = s; return rest; };
const printed = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, k === 'integrity' ? { comparedUnits: v.comparedUnits, allIdentical: v.allIdentical, countersIdentical: v.countersIdentical, rows: v.rows } : brief(v)]));
console.log(JSON.stringify(printed, null, 2));
