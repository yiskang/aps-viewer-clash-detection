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

  return { tuple: tupleEvidence.tuple, status: 'D', cause: D_CONDITION_LABELS[10] }; // C-class path added in Step 21
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
  const bFindings = tupleFindings.filter((f) => f.status === 'B');
  if (bFindings.length > 0) {
    const settledBoundaries = [...new Set(tupleFindings.flatMap((f) => f.settledBy ?? []))];
    return { verdict: 'B', settledBoundaries, tupleFindings };
  }
  return { verdict: 'A', tupleFindings };
}
