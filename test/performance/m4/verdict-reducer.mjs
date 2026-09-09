// M4 Task 2.5: verdict reducer. Pure function over Task 2.4's EvidenceVector shape. Implements
// §7.3/§7.5's fixed precedence: mandatory D first, then A, then B, then C, otherwise D.

const D_CONDITION_LABELS = {
  1: 'no-confirmed-responsiveness-target', 2: 'no-representative-runtime', 3: 'capacity-censoring',
  4: 'workload-validity', 5: 'insufficient-statistical-confidence', 6: 'missing-causal-attribution',
  7: 'unconfirmed-memory-multipliers', 8: 'undetermined-device-scope-or-concurrency',
  9: 'no-full-query-evidence', 10: 'no-settled-boundary',
};
const NO_BOUNDARY_CAUSE = 'no-boundary';

function reduceTuple(tupleEvidence) {
  if (tupleEvidence.targetsAllPass) return { tuple: tupleEvidence.tuple, status: 'A' };
  if (tupleEvidence.onlyQueryEvidenceFailing) return { tuple: tupleEvidence.tuple, status: 'D', cause: D_CONDITION_LABELS[9] };
  if (tupleEvidence.noBoundaryScreenFailed) return { tuple: tupleEvidence.tuple, status: 'D', cause: NO_BOUNDARY_CAUSE };

  const bClassApplicable = tupleEvidence.boundaries.filter((b) => b.class === 'B' && b.applicable);
  const bSufficient = bClassApplicable.filter((b) => b.disposition === 'SUFFICIENT');
  if (bSufficient.length > 0) return { tuple: tupleEvidence.tuple, status: 'B', settledBy: bSufficient.map((b) => b.id) };

  const bAllInsufficient = bClassApplicable.length === 0 || bClassApplicable.every((b) => b.disposition === 'INSUFFICIENT');
  // §7.3: a C-class boundary is applicable only at a tuple whose failure is in the warm narrow
  // phase. `warmNarrowPhaseFailure` is Task 2.4's DERIVED fact (state==='warm' AND the §17
  // family-selection rule says narrow-phase won) -- never a trusted `applicable` flag on the
  // boundary entry itself. Independent review (Critical): an earlier draft filtered only on
  // `b.applicable`, which let a caller-supplied true settle a COLD tuple as Verdict C, contradicting
  // C's own defining condition. Gating the whole candidate list on the tuple-level derived fact,
  // rather than trusting each boundary's own flag, is what makes this correct by construction.
  const cClassApplicable = tupleEvidence.warmNarrowPhaseFailure
    ? tupleEvidence.boundaries.filter((b) => b.class === 'C' && b.applicable)
    : [];
  const cSufficient = cClassApplicable.filter((b) => b.disposition === 'SUFFICIENT');

  if (bAllInsufficient && cSufficient.length > 0) {
    const mechanicalDifference =
      bClassApplicable.length === 0
        ? { vacuous: true, cBoundaryOwnedStages: cSufficient.map((c) => ({ id: c.id, ownedStages: c.ownedStages })) }
        : cSufficient.map((c) => ({
            cBoundaryId: c.id,
            rejectedBBoundaries: bClassApplicable.map((b) => ({ id: b.id, extraStagesOwnedByC: c.ownedStages.filter((s) => !b.ownedStages.includes(s)) })),
          }));
    return { tuple: tupleEvidence.tuple, status: 'C', settledBy: cSufficient.map((c) => c.id), mechanicalDifference };
  }

  return { tuple: tupleEvidence.tuple, status: 'D', cause: D_CONDITION_LABELS[10] };
}

export function reduceVerdict(evidenceVector) {
  if (evidenceVector.globalMandatoryD.any) {
    return {
      verdict: 'D',
      causes: evidenceVector.globalMandatoryD.causes.map((c) => ({ scope: 'global', cause: D_CONDITION_LABELS[c] })),
      tupleFindings: [],
    };
  }
  const tupleFindings = evidenceVector.tuples.map(reduceTuple);
  const dFindings = tupleFindings.filter((f) => f.status === 'D');
  if (dFindings.length > 0) {
    return { verdict: 'D', causes: dFindings.map((f) => ({ scope: 'tuple', tuple: f.tuple, cause: f.cause })), tupleFindings };
  }
  const cFindings = tupleFindings.filter((f) => f.status === 'C');
  if (cFindings.length > 0) {
    const settledBoundaries = [...new Set(tupleFindings.flatMap((f) => f.settledBy ?? []))];
    return {
      verdict: 'C',
      settledBoundaries,
      mechanicalDifferences: cFindings.map((f) => ({ tuple: f.tuple, mechanicalDifference: f.mechanicalDifference })),
      tupleFindings,
    };
  }
  const bFindings = tupleFindings.filter((f) => f.status === 'B');
  if (bFindings.length > 0) {
    const settledBoundaries = [...new Set(tupleFindings.flatMap((f) => f.settledBy ?? []))];
    return { verdict: 'B', settledBoundaries, tupleFindings };
  }
  return { verdict: 'A', tupleFindings };
}
