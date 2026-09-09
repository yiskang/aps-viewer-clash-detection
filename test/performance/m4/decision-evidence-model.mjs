// M4 Task 2.4: canonical decision-evidence model — the adapter/validator that maps a harness's
// raw measured record set into the pure evidence-vector shape Task 2.5's reducer is built against.
// See this task's "Interfaces" note in the plan for the full RawMeasuredRecord/EvidenceVector contracts.

export const CLAUSE_THRESHOLD_MS = 50;

export const BOUNDARY_TABLE = {
  'WB-1a': { class: 'B', ownedStages: ['bvhConstruction'] },
  'WB-1b': { class: 'B', ownedStages: ['compactAndWeld', 'connectivity', 'bvhConstruction'] },
  'WB-2p': { class: 'B', ownedStages: ['hardClashPrecheck'] },
  'WB-3': { class: 'B', ownedStages: ['clearanceDistanceQuery'] },
  'WB-2': { class: 'C', ownedStages: ['hardClashPrecheck', 'exactNarrowPhase', 'clearanceDistanceQuery'] },
  'WB-4': { class: 'C', ownedStages: ['broadPhaseCandidateWork', 'hardClashPrecheck', 'exactNarrowPhase', 'clearanceDistanceQuery', 'resultAggregation'] },
};

const GLOBAL_PRECONDITIONS = [
  { key: 'noConfirmedResponsivenessTarget', condition: 1 },
  { key: 'noRepresentativeRuntime', condition: 2 },
  { key: 'capacityCensored', condition: 3 },
  { key: 'workloadValidityFailed', condition: 4 },
  { key: 'insufficientStatisticalConfidence', condition: 5 },
  { key: 'missingCausalAttribution', condition: 6 },
  { key: 'unconfirmedMemoryMultipliers', condition: 7 },
  { key: 'undeterminedDeviceScopeOrConcurrency', condition: 8 },
];

function buildGlobalMandatoryD(globalPreconditions) {
  const causes = GLOBAL_PRECONDITIONS.filter(({ key }) => globalPreconditions[key]).map(({ condition }) => condition);
  return {
    ...Object.fromEntries(GLOBAL_PRECONDITIONS.map(({ key }) => [key, globalPreconditions[key]])),
    causes,
    any: causes.length > 0,
  };
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`buildEvidenceVector: ${label} must be a boolean`);
}

function validateGlobalPreconditions(globalPreconditions) {
  for (const { key } of GLOBAL_PRECONDITIONS) requireBoolean(globalPreconditions?.[key], key);
}

function requireFiveNumbers(value, label) {
  if (!Array.isArray(value) || value.length !== 5 || value.some((v) => typeof v !== 'number')) {
    throw new Error(`buildEvidenceVector: ${label} must be an array of exactly 5 numbers`);
  }
}

function buildTupleEvidence(raw) {
  if (!raw.tuple?.runtime || !raw.tuple?.caseId) {
    throw new Error('buildEvidenceVector: tuple.runtime and tuple.caseId are required');
  }
  requireBoolean(raw.targets?.tA, `tuple ${raw.tuple.caseId}: targets.tA`);
  requireBoolean(raw.targets?.tB1, `tuple ${raw.tuple.caseId}: targets.tB1`);
  requireBoolean(raw.targets?.tB2, `tuple ${raw.tuple.caseId}: targets.tB2`);
  requireBoolean(raw.targets?.tC, `tuple ${raw.tuple.caseId}: targets.tC`);
  const { tA, tB1, tB2, tC } = raw.targets;
  const targetsAllPass = tA && tB1 && tB2 && tC;
  const onlyQueryEvidenceFailing = tA === true && !targetsAllPass;

  let noBoundaryScreenFailed = false;
  if (tA === false) {
    requireFiveNumbers(raw.screenResidualMs, `tuple ${raw.tuple.caseId}: screenResidualMs`);
    noBoundaryScreenFailed = Math.max(...raw.screenResidualMs) > CLAUSE_THRESHOLD_MS;
  }
  const boundaries = (raw.boundaries ?? []).map(computeBoundaryDisposition);
  return { tuple: raw.tuple, targetsAllPass, onlyQueryEvidenceFailing, noBoundaryScreenFailed, boundaries };
}

function computeBoundaryDisposition(raw) {
  const meta = BOUNDARY_TABLE[raw.id];
  if (!meta) throw new Error(`buildEvidenceVector: unknown boundary id "${raw.id}"`);

  if (!raw.applicable) {
    return { id: raw.id, class: meta.class, applicable: false, ownedStages: meta.ownedStages, disposition: 'NOT_APPLICABLE', unevaluableReason: null };
  }

  if (meta.class === 'B') {
    if (raw.residualMs === null || raw.occupancyMs === null) {
      return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'UNEVALUABLE', unevaluableReason: 'missing-vertical' };
    }
    if (raw.deliveryTaskIdentified === null || raw.deliveryTaskIdentified.some((v) => v === false)) {
      return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'UNEVALUABLE', unevaluableReason: 'undetermined-delivery-task' };
    }
    requireFiveNumbers(raw.residualMs, `boundaries[${raw.id}].residualMs`);
    requireFiveNumbers(raw.occupancyMs, `boundaries[${raw.id}].occupancyMs`);
    const sums = raw.residualMs.map((r, i) => r + raw.occupancyMs[i]);
    const disposition = Math.max(...sums) <= CLAUSE_THRESHOLD_MS ? 'SUFFICIENT' : 'INSUFFICIENT';
    return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition, unevaluableReason: null };
  }

  // C-class -- disposition rule and thresholds are otherwise identical (§7.3's Verdict C clause); see Step 21.
  return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'UNEVALUABLE', unevaluableReason: 'unboundable-derived-evidence' };
}

export function buildEvidenceVector(rawRecords, globalPreconditions) {
  validateGlobalPreconditions(globalPreconditions);
  return {
    globalMandatoryD: buildGlobalMandatoryD(globalPreconditions),
    tuples: rawRecords.map(buildTupleEvidence),
  };
}
