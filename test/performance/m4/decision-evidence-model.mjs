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
  if (!Array.isArray(value) || value.length !== 5 || value.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error(`buildEvidenceVector: ${label} must be an array of exactly 5 finite numbers`);
  }
}

function requireBooleanOrNull(value, label) {
  if (value !== null && typeof value !== 'boolean') {
    throw new Error(`buildEvidenceVector: ${label} must be a boolean or null`);
  }
}

function requireFiveBooleansOrNull(value, label) {
  if (value === null) return;
  if (!Array.isArray(value) || value.length !== 5 || value.some((v) => typeof v !== 'boolean')) {
    throw new Error(`buildEvidenceVector: ${label} must be null or an array of exactly 5 booleans`);
  }
}

const VALID_TUPLE_STATES = ['cold', 'warm', 'refresh'];

function buildTupleEvidence(raw) {
  if (!raw.tuple?.runtime || !raw.tuple?.caseId) {
    throw new Error('buildEvidenceVector: tuple.runtime and tuple.caseId are required');
  }
  if (!VALID_TUPLE_STATES.includes(raw.tuple.state)) {
    throw new Error(`buildEvidenceVector: tuple ${raw.tuple.caseId}: tuple.state must be one of ${VALID_TUPLE_STATES.join(', ')}`);
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

  if (tA === false) {
    if (typeof raw.narrowPhaseFamilyWins !== 'boolean') {
      throw new Error(`buildEvidenceVector: tuple ${raw.tuple.caseId}: narrowPhaseFamilyWins must be a boolean when tA is false`);
    }
  }
  const warmNarrowPhaseFailure = tA === false && raw.tuple.state === 'warm' && raw.narrowPhaseFamilyWins === true;

  const boundaries = (raw.boundaries ?? []).map(computeBoundaryDisposition);
  return { tuple: raw.tuple, targetsAllPass, onlyQueryEvidenceFailing, noBoundaryScreenFailed, warmNarrowPhaseFailure, boundaries };
}

function validatePrerequisiteTypes(raw) {
  requireBooleanOrNull(raw.memoryBudgetMet, `boundaries[${raw.id}].memoryBudgetMet`);
  requireBooleanOrNull(raw.lifecycleDemonstrated, `boundaries[${raw.id}].lifecycleDemonstrated`);
  requireBooleanOrNull(raw.moduleResolutionEstablished, `boundaries[${raw.id}].moduleResolutionEstablished`);
}

function checkPrerequisites(raw) {
  const fields = { memoryBudgetMet: raw.memoryBudgetMet, lifecycleDemonstrated: raw.lifecycleDemonstrated, moduleResolutionEstablished: raw.moduleResolutionEstablished };
  // A known failed prerequisite is decisive over an unmeasured one: check false before null, so a
  // mixed {false, null} pair reports as the known failure (INSUFFICIENT), not as unevaluable.
  if (Object.values(fields).some((v) => v === false)) return 'prerequisite-not-met';
  if (Object.values(fields).some((v) => v === null || v === undefined)) return 'missing-prerequisite-evidence';
  return null; // all three true -- gate passes
}

function computeBoundaryDisposition(raw) {
  const meta = BOUNDARY_TABLE[raw.id];
  if (!meta) throw new Error(`buildEvidenceVector: unknown boundary id "${raw.id}"`);

  requireBoolean(raw.applicable, `boundaries[${raw.id}].applicable`);

  if (!raw.applicable) {
    return { id: raw.id, class: meta.class, applicable: false, ownedStages: meta.ownedStages, disposition: 'NOT_APPLICABLE', unevaluableReason: null };
  }

  requireBooleanOrNull(raw.derivedEvidenceBounded, `boundaries[${raw.id}].derivedEvidenceBounded`);
  requireFiveBooleansOrNull(raw.deliveryTaskIdentified, `boundaries[${raw.id}].deliveryTaskIdentified`);
  validatePrerequisiteTypes(raw);

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
    const numericPasses = Math.max(...sums) <= CLAUSE_THRESHOLD_MS;
    // §7.3: a boundary's OWN threshold check failing is decisive once evidence for it exists --
    // it is never overridden by a null (not-yet-gathered) condition 6-8 prerequisite. UNEVALUABLE
    // via a null prerequisite is legitimate ONLY when the numeric threshold already passed.
    if (!numericPasses) {
      return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'INSUFFICIENT', unevaluableReason: null };
    }
    const prereqFailure = checkPrerequisites(raw);
    if (prereqFailure === 'missing-prerequisite-evidence') {
      return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'UNEVALUABLE', unevaluableReason: 'missing-prerequisite-evidence' };
    }
    const disposition = prereqFailure === null ? 'SUFFICIENT' : 'INSUFFICIENT';
    return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition, unevaluableReason: null };
  }

  // C-class
  if (raw.residualMs === null || raw.occupancyMs === null || raw.derivedEvidenceBounded !== true) {
    return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'UNEVALUABLE', unevaluableReason: 'unboundable-derived-evidence' };
  }
  requireFiveNumbers(raw.residualMs, `boundaries[${raw.id}].residualMs`);
  requireFiveNumbers(raw.occupancyMs, `boundaries[${raw.id}].occupancyMs`);
  const cSums = raw.residualMs.map((r, i) => r + raw.occupancyMs[i]);
  const cNumericPasses = Math.max(...cSums) <= CLAUSE_THRESHOLD_MS;
  // Identical rule as the B-class branch above: a known threshold failure is decisive over an
  // unmeasured prerequisite.
  if (!cNumericPasses) {
    return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'INSUFFICIENT', unevaluableReason: null };
  }
  const cPrereqFailure = checkPrerequisites(raw);
  if (cPrereqFailure === 'missing-prerequisite-evidence') {
    return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'UNEVALUABLE', unevaluableReason: 'missing-prerequisite-evidence' };
  }
  const cDisposition = cPrereqFailure === null ? 'SUFFICIENT' : 'INSUFFICIENT';
  return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: cDisposition, unevaluableReason: null };
}

export function buildEvidenceVector(rawRecords, globalPreconditions) {
  validateGlobalPreconditions(globalPreconditions);
  return {
    globalMandatoryD: buildGlobalMandatoryD(globalPreconditions),
    tuples: rawRecords.map(buildTupleEvidence),
  };
}
