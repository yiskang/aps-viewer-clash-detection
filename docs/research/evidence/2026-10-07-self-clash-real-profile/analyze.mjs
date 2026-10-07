// node analyze.mjs   (run from this directory) -> prints summary JSON, writes summary.json
// Reads profile-full.json / profile-lite.json exactly as captured (a JSON-encoded string of the page's
// window.__CLASH_PROFILE snapshot) and derives every number quoted in the report.
import { readFileSync, writeFileSync } from 'node:fs';

const load = (f) => { let v = JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8')); if (typeof v === 'string') v = JSON.parse(v); return v; };
const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const r = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

function perUnit(P) {
  const ru = new Map(P.runUnits.map((u) => [u.unitId, u]));
  return P.units.map((u, i) => {
    const R = ru.get(u.unitId);
    const wall = R ? R.t1 - R.t0 : null;
    // A unit's bracket performs exactly 2 x |scopeExpect| digests (pre + post). Any further digest recorded
    // while this unit was still `P.cur` happened AFTER its bracket (e.g. the engine's read-time freshness
    // pass after the stop, which uses a different, non-yielding ctx) and is reported separately.
    const nBracket = 2 * (u.scopeExpect?.length ?? 0);
    const dig = (u.digests ?? []).slice(0, nBracket);
    const outOfBracketDigests = (u.digests ?? []).slice(nBracket).map((d) => ({ ...d, ms: r(d.ms, 3) }));
    const whole = dig.filter((d) => d.kind === 'whole');
    const roots = dig.filter((d) => d.kind === 'roots');
    return {
      i: i + 1, unitId: u.unitId, completed: !!R, srcRoots: u.srcRoots, targets: u.targets, scopeExpect: u.scopeExpect,
      yields: u.yields, preYields: u.preYields, postYields: u.postYields,
      preMs: r(u.preMs), callMs: r(u.callMs), postMs: r(u.postMs), unitWallMs: r(wall),
      yieldWaitMs: P.lite ? null : r(u.yieldMs), digestCalls: dig.length,
      wholeDigestMs: r(sum(whole.map((d) => d.ms))), wholeDigestYields: sum(whole.map((d) => d.yields)),
      rootsDigestMs: r(sum(roots.map((d) => d.ms))), rootsDigestYields: sum(roots.map((d) => d.yields)),
      rootsDigestShapes: roots.map((d) => d.roots), outOfBracketDigests,
      lib: u.lib ?? null,
      pairSpaceProcessed: R?.pairSpaceProcessed ?? null, resultsFound: R?.resultsFound ?? null, caveatCount: R?.caveatCount ?? null,
    };
  });
}

function summarize(name) {
  const doc = load(name); const P = doc.profile;
  const units = perUnit(P);
  const done = units.filter((u) => u.completed);
  const lat = P.lat ?? [];
  const firstT0 = P.runUnits[0]?.t0; const lastT1 = P.runUnits.at(-1)?.t1;
  const windowMs = lastT1 - firstT0;
  const agg = (k) => sum(done.map((u) => u[k] ?? 0));
  const totalWall = agg('unitWallMs');
  const hist = {}; for (const d of lat) { const b = d < 4 ? '<4' : d < 4.5 ? '4-4.5' : d < 5 ? '4.5-5' : d < 6 ? '5-6' : d < 8 ? '6-8' : d < 16 ? '8-16' : d < 50 ? '16-50' : '>=50'; hist[b] = (hist[b] || 0) + 1; }
  return {
    file: name, mode: P.mode, capturedAt: doc.capturedAt, ua: doc.ua, viewerVersion: doc.viewerVersion, visibility: doc.visibility,
    viewport: doc.viewport, hardwareConcurrency: doc.hardwareConcurrency, fragments: doc.fragments, isOTG: doc.isOTG,
    panelRunStatusText: doc.panelRunStatusText,
    unitsStarted: units.length, unitsCompleted: done.length,
    window: { firstUnitStartToLastUnitEndMs: r(windowMs), unitsPerMin: r(done.length / (windowMs / 60000), 3) },
    perUnitMeans: {
      yields: r(agg('yields') / done.length, 1), unitWallMs: r(totalWall / done.length, 1),
      preMs: r(agg('preMs') / done.length, 1), callMs: r(agg('callMs') / done.length, 1), postMs: r(agg('postMs') / done.length, 1),
      wholeDigestMs: r(agg('wholeDigestMs') / done.length, 1), rootsDigestMs: r(agg('rootsDigestMs') / done.length, 1),
      wholeDigestYields: r(agg('wholeDigestYields') / done.length, 1), rootsDigestYields: r(agg('rootsDigestYields') / done.length, 1),
    },
    shares: {
      bracketPct: r(100 * (agg('preMs') + agg('postMs')) / totalWall, 2),
      callPct: r(100 * agg('callMs') / totalWall, 2),
      otherPct: r(100 * (totalWall - agg('preMs') - agg('postMs') - agg('callMs')) / totalWall, 2),
      yieldWaitPctOfWall: P.lite ? null : r(100 * agg('yieldWaitMs') / totalWall, 2),
      wholeDigestPctOfBracket: P.lite ? null : r(100 * agg('wholeDigestMs') / (agg('preMs') + agg('postMs')), 2),
    },
    yieldLatency: P.lite ? null : {
      n: lat.length, min: r(Math.min(...lat), 3), p05: r(q(lat, 0.05), 3), median: r(q(lat, 0.5), 3), mean: r(sum(lat) / lat.length, 3),
      p95: r(q(lat, 0.95), 3), p99: r(q(lat, 0.99), 3), max: r(Math.max(...lat), 3), fracAtLeast4ms: r(lat.filter((d) => d >= 4).length / lat.length, 4), hist,
    },
    globalZeroDelaySetTimeout: P.lite ? null : P.timers,
    interUnitYieldMs: { n: P.interUnit.length, median: r(q(P.interUnit, 0.5), 3), max: r(Math.max(...P.interUnit), 3) },
    snapshotMs: { n: P.snaps.length, total: r(sum(P.snaps), 3), median: r(q(P.snaps, 0.5), 3), max: r(Math.max(...P.snaps), 3) },
    stop: {
      clickWall: P.stopClick?.wall, inFlightUnit: P.cancel?.currentUnitId,
      inFlightUnitElapsedAtClickMs: (() => { const u = P.units.find((x) => x.unitId === P.cancel?.currentUnitId); return u ? r(P.stopClick.t - u.tStart) : null; })(),
      clickToCancelRequestMs: r(P.cancel.t - P.stopClick.t, 3),
      clickToBoundaryMs: r(P.sealStart.t - P.stopClick.t), sealMs: r(P.sealEnd - P.sealStart.t), clickToStoppedShownMs: r(P.stoppedSeen.t - P.stopClick.t),
    },
    units,
  };
}

const out = { full: summarize('profile-full.json'), lite: summarize('profile-lite.json') };
writeFileSync(new URL('summary.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
const brief = (s) => { const { units, ...rest } = s; return rest; };
console.log(JSON.stringify({ full: brief(out.full), lite: brief(out.lite) }, null, 2));
