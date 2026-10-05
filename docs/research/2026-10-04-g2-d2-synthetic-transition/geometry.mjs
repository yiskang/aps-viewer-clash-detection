// D2-OFFLINE geometry study (spec §9, §10, §11, §12.2, §14, §15). Research tooling only.
// EVERYTHING emitted is synthetic (synthetic: true). Nothing here is a margin, threshold, or
// historical-causality claim. kappa=0.9 is a synthetic calibration anchor, NOT a margin; the
// stability factor 3 is exploratory, NOT a threshold; d_min is an OBSERVATION about the grid.
// Pure: no I/O, no Math.random, arithmetic only + - * / and Math.abs/min/max.
//
// Interpretations (most literal reading where the spec is ambiguous):
//  I1  Fit centre (cx,cy) of a box = centre of its xy AABB; (hx,hy) = its xy half-widths.
//  I2  fit(box): w = max(hx, alpha*hy)/kappa; for L_home(k) the w is then multiplied by k.
//      The perturbed centre offsets use that FINAL w (cx' = cx + ox*w, cy' = cy + oy*w/alpha).
//  I3  For every V element the fit kappa equals V's kappa (kappa is part of the camera).
//  I4  tau_U = max over U's 4 xy corners of max(|x|,|y|) (U = AABB union of A and B; w=1 depth).
//  I5  O3 = x-NDC of U's AABB centre; I6 L_home interval ranges over V and the 4 k jointly
//      (per-k intervals are also reported for observation only).
//  I7  stably separated iff sep>0 and sep >= 3*max(w1,w2) (exact >=; max(w)=0 => sep>0).
//      Touching/overlap (sep<=0) is never separated. Candidate separator = gap midpoint, observation.
//  I8  d_min: smallest grid d such that all 4 pairs pass in every cell with d'>=d (both dy).
//  I9  Fail closed: fixtures geometry.d must contain an entry === r1.targets.fitPair.distance and
//      fixtures geometry.retainedPairDistance must be === as well (strict bit equality).
//  I10 RET-U: AABB of the 8 retained corners (xy only), fit kappa=0.9, worstExcess=tau-1; a
//      consistency anchor only (does not validate any Viewer algorithm).

export const OBSERVABLES = ['O1', 'O2', 'O3'];
export const PAIRS = [
  ['P_C6', 'L_home'],
  ['P_C6', 'L_prev'],
  ['P_N2', 'L_N2stale'],
  ['P_N2', 'L_prev'],
];
const CLASSES = ['P_C6', 'P_N2', 'L_N2stale', 'L_prev', 'L_home'];

function aabbOf(points) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
  }
  return { x0, x1, y0, y1 };
}
function box(x0, x1, y0, y1) { return { x0, x1, y0, y1 }; }
function union(a, b) {
  return box(Math.min(a.x0, b.x0), Math.max(a.x1, b.x1), Math.min(a.y0, b.y0), Math.max(a.y1, b.y1));
}
function corners(b) { return [[b.x0, b.y0], [b.x0, b.y1], [b.x1, b.y0], [b.x1, b.y1]]; }

/** Evaluate O1..O3 for U seen by camera fit(fitBox) with kappa, w multiplier k, centre offsets (ox,oy). */
export function observe(U, fitBox, alpha, kappa, k, ox, oy) {
  const cx = (fitBox.x0 + fitBox.x1) / 2;
  const cy = (fitBox.y0 + fitBox.y1) / 2;
  const hx = (fitBox.x1 - fitBox.x0) / 2;
  const hy = (fitBox.y1 - fitBox.y0) / 2;
  const w = (Math.max(hx, alpha * hy) / kappa) * k;
  const cxp = cx + ox * w;
  const cyp = cy + oy * (w / alpha);
  let tau = 0;
  for (const c of corners(U)) {
    const x = (c[0] - cxp) / w;
    const y = (alpha * (c[1] - cyp)) / w;
    tau = Math.max(tau, Math.max(Math.abs(x), Math.abs(y)));
  }
  const ux = (U.x0 + U.x1) / 2;
  return { O1: tau - 1, O2: tau, O3: (ux - cxp) / w };
}

function emptyInterval() { return { min: Infinity, max: -Infinity }; }
function extend(iv, v) { iv.min = Math.min(iv.min, v); iv.max = Math.max(iv.max, v); }
function finish(iv) { return { synthetic: true, min: iv.min, max: iv.max, width: iv.max - iv.min }; }

/** sep and stability rule (spec §11.4). a,b are {min,max,width}. */
export function separation(a, b) {
  const sep = Math.max(a.min - b.max, b.min - a.max);
  const mw = Math.max(a.width, b.width);
  const stable = mw === 0 ? sep > 0 : sep > 0 && sep >= 3 * mw;
  let candidateSeparator = null; // observation only, never a margin
  if (stable) {
    const lower = a.max <= b.min ? a : b;
    const upper = lower === a ? b : a;
    candidateSeparator = (lower.max + upper.min) / 2;
  }
  return { sep, stable, candidateSeparator };
}

export function retUConsistency(r1, alpha) {
  const pts = r1.controls.N2.evidence.corners.map((c) => c.corner);
  const U = (() => { const a = aabbOf(pts); return box(a.x0, a.x1, a.y0, a.y1); })();
  const o = observe(U, U, alpha, 0.9, 1, 0, 0);
  const worstExcess = o.O1;
  return {
    synthetic: true,
    consistencyAnchorOnly: true,
    worstExcess,
    expected: -0.1,
    retainedRecordedWorstExcess: r1.controls.N2.fields.worstExcess,
    ok: Math.abs(worstExcess - -0.1) <= 1e-6,
  };
}

export function runGeometryStudy({ fixtures, r1 }) {
  const g = fixtures.geometry;
  const retained = r1.targets.fitPair.distance;
  if (!(g.d.some((x) => x === retained)) || g.retainedPairDistance !== retained) {
    throw new Error('geometry: fixtures retained-pair distance is not bit-identical to R1 targets.fitPair.distance (fail closed)');
  }
  const alpha = g.aspect.num / g.aspect.den;
  const h = g.boxHalf;
  const V = [];
  for (const kappa of g.kappaSet) for (const ox of g.offsets) for (const oy of g.offsets) V.push({ kappa, ox, oy });
  const A = box(-h, h, -h, h);

  const cells = [];
  const classIntervals = { synthetic: true };
  const sep = { synthetic: true };
  const stablePairs = { synthetic: true };
  const candidateSeparators = { synthetic: true };
  let evaluationCount = 0;
  const cellPass = [];

  for (const d of g.d) {
    for (const dy of g.dy) {
      const B = box(d - h, d + h, dy - h, dy + h);
      const U = union(A, B);
      const key = `${d}|${dy}`;
      const iv = {};
      const perK = {};
      for (const c of CLASSES) { iv[c] = {}; for (const o of OBSERVABLES) iv[c][o] = emptyInterval(); }
      for (const k of g.homeMultipliers) { perK[k] = {}; for (const o of OBSERVABLES) perK[k][o] = emptyInterval(); }
      const inst = [
        ['P_C6', U, 1], ['P_N2', B, 1], ['L_N2stale', U, 1], ['L_prev', A, 1],
        ...g.homeMultipliers.map((k) => ['L_home', U, k]),
      ];
      for (const [cls, fitBox, k] of inst) {
        for (const v of V) {
          const r = observe(U, fitBox, alpha, v.kappa, k, v.ox, v.oy);
          evaluationCount += 1;
          for (const o of OBSERVABLES) {
            extend(iv[cls][o], r[o]);
            if (cls === 'L_home') extend(perK[k][o], r[o]);
          }
        }
      }
      const ci = { synthetic: true };
      for (const c of CLASSES) {
        ci[c] = { synthetic: true };
        for (const o of OBSERVABLES) ci[c][o] = finish(iv[c][o]);
      }
      ci.L_home_perK = { synthetic: true };
      for (const k of g.homeMultipliers) {
        ci.L_home_perK[k] = { synthetic: true };
        for (const o of OBSERVABLES) ci.L_home_perK[k][o] = finish(perK[k][o]);
      }
      classIntervals[key] = ci;

      const sp = { synthetic: true }, st = { synthetic: true }, cs = { synthetic: true };
      let allPass = true;
      for (const [c1, c2] of PAIRS) {
        const pk = `${c1}~${c2}`;
        sp[pk] = { synthetic: true };
        cs[pk] = { synthetic: true };
        const passedOn = [];
        for (const o of OBSERVABLES) {
          const s = separation(ci[c1][o], ci[c2][o]);
          sp[pk][o] = s.sep;
          if (s.stable) { passedOn.push(o); cs[pk][o] = { synthetic: true, exploratory: true, observationOnly: true, value: s.candidateSeparator }; }
        }
        const passes = passedOn.length > 0;
        if (!passes) allPass = false;
        st[pk] = { synthetic: true, exploratory: true, passes, passedOn };
      }
      sep[key] = sp; stablePairs[key] = st; candidateSeparators[key] = cs;
      cells.push({ synthetic: true, d, dy, key, allPairsPass: allPass });
      cellPass.push({ d, dy, key, st });
    }
  }

  // d_min: observation about the synthetic grid only (never a threshold).
  const grid = g.d.slice().sort((a, b) => a - b);
  let dMin = 'none';
  for (const cand of grid) {
    const ok = cellPass.filter((c) => c.d >= cand).every((c) => PAIRS.every(([a, b]) => c.st[`${a}~${b}`].passes));
    if (ok) { dMin = cand; break; }
  }
  const failingSet = new Set();
  for (const c of cellPass) {
    if (c.d < retained) continue;
    for (const [a, b] of PAIRS) if (!c.st[`${a}~${b}`].passes) failingSet.add(`${a}~${b}`);
  }
  const failingPairs = PAIRS.map(([a, b]) => `${a}~${b}`).filter((p) => failingSet.has(p));
  const outcome = dMin !== 'none' && dMin <= retained ? 'D' : 'E';

  return {
    geometry: {
      synthetic: true,
      exploratory: true,
      note: 'kappa=0.9 synthetic calibration anchor, not a margin; stability factor 3 exploratory, not a threshold; d_min observed only',
      cells, classIntervals, sep, stablePairs, candidateSeparators,
      d_min: dMin,
      d_min_exploratory_observation: true,
      retUConsistency: retUConsistency(r1, alpha),
      evaluationCount,
      evaluationsPerObservable: evaluationCount,
    },
    outcomeControl: {
      synthetic: true,
      outcome,
      failingPairs: outcome === 'E' ? failingPairs : [],
      failingPairsAtOrAboveRetainedD: failingPairs,
    },
  };
}
