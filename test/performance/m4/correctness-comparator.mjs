// M4 Task 3.6: §6.4's canonical correctness comparator, implemented exactly to spec. Used by (a)
// the gate's own TLAS-vs-linear parity check across every measured run pair, and (b) any
// full-result worker arm (none exists in Phase 3 -- reserved for a later phase). Fully pure.

export function sigEqual(pairSetA, pairSetB) {
  const signature = (p) => `${p.sourceModelTag}:${p.sourceDbId}:${p.targetModelTag}:${p.targetDbId}:${p.type}`;
  const a = pairSetA.map(signature).sort();
  const b = pairSetB.map(signature).sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

// Bit-identical by default (TLAS-vs-linear). A worker-arm caller passes an explicit
// { tolerance: 1e-9 } and must report that relaxation, per §6.4's own instruction.
export function distancesEqual(distanceA, distanceB, { tolerance = 0 } = {}) {
  return Math.abs(distanceA - distanceB) <= tolerance;
}

export function witnessesEqual(a, b, { worldDiagonalScale }) {
  const tol = 1e-9 * worldDiagonalScale;
  const closeVec = (u, v) => u.length === v.length && u.every((c, i) => Math.abs(c - v[i]) <= tol);
  const isClearanceShape = (w) => w && 'sourcePoint' in w && 'targetPoint' in w;
  const isOverlapShape = (w) => w && 'kind' in w && 'point' in w;
  if (isClearanceShape(a) && isClearanceShape(b)) return closeVec(a.sourcePoint, b.sourcePoint) && closeVec(a.targetPoint, b.targetPoint);
  if (isOverlapShape(a) && isOverlapShape(b)) return a.kind === b.kind && closeVec(a.point, b.point);
  return false; // shape mismatch is itself a failure
}

const STATISTICS_FIELDS = ['clearanceExactAabbSurvivors', 'narrowPhasePairs', 'clearanceOverlapPrechecksRun', 'clearanceHardClashExclusions', 'clearanceDistanceQueriesRun', 'clearanceHits'];

export function statisticsEqual(a, b) {
  return STATISTICS_FIELDS.every((f) => a[f] === b[f]);
}

function fragKey(f) {
  return f ? `${f.modelTag}:${f.dbId}:${f.fragId}` : null;
}

function diagnosticKey(d) {
  return JSON.stringify({
    reason: d.reason, scope: d.scope, role: d.role ?? null,
    fragment: fragKey(d.fragment), sourceFragment: fragKey(d.sourceFragment), targetFragment: fragKey(d.targetFragment),
  });
}

export function diagnosticsMultisetEqual(diagnosticsA, diagnosticsB) {
  const tally = (arr) => {
    const m = new Map();
    for (const d of arr) { const k = diagnosticKey(d); m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  const ma = tally(diagnosticsA);
  const mb = tally(diagnosticsB);
  if (ma.size !== mb.size) return false;
  for (const [k, count] of ma) if (mb.get(k) !== count) return false;
  return true;
}

// Canonical full-tuple identity, matching `sigEqual`'s own signature exactly (source model
// identity included -- this codebase has hit the "signatures need model identity, not just
// dbId" bug three times already; a join key must never regress to a narrower tuple).
function pairKey(p) {
  return `${p.sourceModelTag}:${p.sourceDbId}:${p.targetModelTag}:${p.targetDbId}:${p.type}`;
}

// Distance is only part of the public pair contract for `clearance` pairs (CollisionWorld never
// sets `distance` on `surface-intersection`/`containment`/`volume-overlap` pairs) -- comparing it
// unconditionally would fail every real volume-overlap (hard-clash) parity check.
function pairDistancesEqual(pa, pb, distanceTolerance) {
  if (pa.type !== 'clearance') return true; // not part of this pair type's contract
  return distancesEqual(pa.distance, pb.distance, { tolerance: distanceTolerance });
}

// Witness is only part of the public pair contract for `clearance` and `volume-overlap` pairs.
// `volume-overlap` additionally permits `witness: null` (the witness-unavailable case) -- two
// matching nulls are equal without ever reaching `witnessesEqual`'s shape checks; a null on only
// one side is a real mismatch, not a shape-mismatch fallback.
function pairWitnessesEqual(pa, pb, worldDiagonalScale) {
  if (pa.type !== 'clearance' && pa.type !== 'volume-overlap') return true; // not part of the contract
  if (pa.witness === null && pb.witness === null) return true;
  if (pa.witness === null || pb.witness === null) return false; // presence mismatch
  return witnessesEqual(pa.witness, pb.witness, { worldDiagonalScale });
}

export function compareRuns(runA, runB, { distanceTolerance = 0, worldDiagonalScale }) {
  // Build the run-B lookup once (O(n)) rather than re-scanning runB.pairs per runA pair per field
  // (O(n^2) via Array.find x2) -- matters once a gate result carries thousands of pairs.
  const bByKey = new Map();
  for (const p of runB.pairs) {
    if (!bByKey.has(pairKey(p))) bByKey.set(pairKey(p), p); // first-discovery-wins, same convention as CollisionWorld's own pairsByKey
  }
  const fields = {
    pairSet: sigEqual(runA.pairs, runB.pairs),
    statistics: statisticsEqual(runA.statistics, runB.statistics),
    diagnostics: diagnosticsMultisetEqual(runA.statistics.diagnostics, runB.statistics.diagnostics),
    distances: runA.pairs.every((pa) => {
      const pb = bByKey.get(pairKey(pa));
      return !!pb && pairDistancesEqual(pa, pb, distanceTolerance);
    }),
    witnesses: runA.pairs.every((pa) => {
      const pb = bByKey.get(pairKey(pa));
      return !!pb && pairWitnessesEqual(pa, pb, worldDiagonalScale);
    }),
  };
  return { valid: Object.values(fields).every(Boolean), fields };
}

// §6.4's stage-scoped-validity rule, welded-buffer clause -- specified here for this task's full
// §6.4 scope; S7' (a later phase) is its only real caller and will duplicate this function rather
// than import it, per the no-shared-module-across-phases convention this plan applies within M4.
export function weldedBuffersEqual(a, b) {
  if (a.position.length !== b.position.length || a.index.length !== b.index.length) return false;
  for (let i = 0; i < a.position.length; i++) if (a.position[i] !== b.position[i]) return false;
  for (let i = 0; i < a.index.length; i++) if (a.index[i] !== b.index[i]) return false;
  return true;
}
