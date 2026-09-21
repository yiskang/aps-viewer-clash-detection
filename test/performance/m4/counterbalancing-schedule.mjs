// test/performance/m4/counterbalancing-schedule.mjs
//
// M4 Task 3.7: §6.1.6's counterbalancing schedule (arm-order parity + case-order rotation), plus
// §4's capacity-rejection record shape (never silently trimmed -- exact limit and observed value
// reported). Pure; the live dispatch loop that consumes this schedule lives in run-gate-m4.mjs.

// §5.2/§5.3's baseline matrix, in the schedule's canonical (repetition-0) order. Deliberately
// EXCLUDES the four unconditional spikes S1'/S2'/S3'/S4' -- those are tasks 3.9/3.10's, dispatched
// separately after the baseline matrix, and mixing them into this list would silently give them
// counterbalanced repetitions and a fresh-world tuple identity they are not specified to have.
export const M4_CASE_LIST = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'S1', 'S2', 'S3', 'S4', 'S2T'];

export function armOrderForRepetition(repetitionIndex) {
  return repetitionIndex % 2 === 0 ? ['tlas', 'linear'] : ['linear', 'tlas'];
}

// Rotation by repetition index: repetition `r` starts the list at position `r mod n`. Returns a
// fresh array every call (never a view onto, or an alias of, the caller's own list) so the live
// scheduler can hand the result straight into a loop that mutates or sorts it without corrupting
// the canonical case list every later repetition is rotated from.
//
// §5.6 additionally requires S2T's POPULATION LEVEL order to be counterbalanced "alongside arm
// order and case order" by the same rule, so the live scheduler calls this same function on the
// numeric `S2T_LEVELS` array rather than duplicating the rotation for that dimension -- hence the
// deliberately element-type-agnostic implementation (no string assumptions anywhere).
export function caseOrderForRepetition(cases, repetitionIndex) {
  const n = cases.length;
  const start = ((repetitionIndex % n) + n) % n;
  return [...cases.slice(start), ...cases.slice(0, start)];
}

export function buildCounterbalancedSchedule(cases, repetitionCount) {
  // An empty case list would make `repetitionIndex % 0` NaN and emit `repetitionCount` entries
  // whose caseOrder is silently `[]` -- a schedule that dispatches nothing while still reporting
  // five repetitions. §6.1.8's own "never a verdict computed from an unpopulated set" discipline
  // applied one level up: reject the degenerate input rather than produce an empty-but-plausible
  // schedule.
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('buildCounterbalancedSchedule: needs at least one case to schedule');
  }
  if (!Number.isInteger(repetitionCount) || repetitionCount <= 0) {
    throw new Error(`buildCounterbalancedSchedule: repetitionCount must be a positive integer (got ${repetitionCount})`);
  }
  const schedule = [];
  for (let r = 0; r < repetitionCount; r++) {
    schedule.push({ repetition: r, caseOrder: caseOrderForRepetition(cases, r), armOrder: armOrderForRepetition(r) });
  }
  return schedule;
}

// §4's own reporting rule: a capacity rejection is a NAMED FINDING carrying the exact limit and the
// exact observed value -- "never silently trimmed".
//
// The brief's own excerpt read the observed value from `error.details.observed`. Real production
// errors do not have that shape, confirmed by reading every throw site on disk:
//
//   - `CapacityExceededError` (collision/errors.js:114-122) does `Object.assign(this, details)`,
//     so its payload lands FLAT on the error -- `limit` plus, depending on `kind`, `attempted`
//     ('clearance-narrow-phase-budget', 'tlas-candidate-budget'), `requested`
//     ('call-wide-unique-fragment-precheck'), or `currentSize` + `missing` ('bucket-capacity').
//     There is no `details` property anywhere.
//   - The §9.3.1 LINEAR broad-phase ceiling (CollisionWorld.js:1598) is not a
//     `CapacityExceededError` at all -- it is a PLAIN `Error` whose only carrier of the numbers is
//     its message text, `"... exceeds maxBroadPhaseInstancePairs (A x B > LIMIT)"`.
//   - `ExtractionLimitExceededError` (viewer/ViewerModelAdapter.js:14-26) carries flat
//     `limit`/`observedCount`.
//
// Left as the brief wrote it, EVERY real rejection would have reported `observedValue: null` --
// silently discarding exactly the number §4 requires to be named, on exactly the cases (S2's top
// levels, S3) that exist to find these ceilings. `error.details.observed` is still honoured first
// so the brief's own frozen contract is unchanged.
const LINEAR_CEILING_MESSAGE = /exceeds maxBroadPhaseInstancePairs \((\d+) x (\d+) > (\d+)\)/;

export function recognizeCapacityRejection(errorLike) {
  if (!errorLike) return null;
  const linear = typeof errorLike.message === 'string' ? LINEAR_CEILING_MESSAGE.exec(errorLike.message) : null;
  if (linear) {
    return {
      kind: 'broad-phase-instance-pair-ceiling',
      limitName: 'maxBroadPhaseInstancePairs',
      limitValue: Number(linear[3]),
      observedValue: Number(linear[1]) * Number(linear[2]),
    };
  }
  if (errorLike.name === 'ExtractionLimitExceededError') {
    return {
      kind: 'extraction-limit',
      limitName: String(errorLike.limit ?? 'unknown'),
      limitValue: null,
      observedValue: errorLike.observedCount ?? null,
    };
  }
  if (errorLike.name !== 'CapacityExceededError' && errorLike.kind === undefined) return null;
  const observed = errorLike.attempted
    ?? errorLike.requested
    ?? (errorLike.currentSize !== undefined && errorLike.missing !== undefined
      ? errorLike.currentSize + errorLike.missing
      : undefined);
  return {
    kind: errorLike.kind ?? null,
    limitName: CAPACITY_LIMIT_NAME_BY_KIND[errorLike.kind] ?? 'unknown',
    limitValue: errorLike.limit ?? null,
    observedValue: observed ?? null,
  };
}

// Every `CapacityExceededError` kind thrown anywhere in `collision/`, mapped to the constant whose
// value it checks against -- so the report names the limit the way `collision/constants.js` does
// rather than echoing an error-kind slug.
const CAPACITY_LIMIT_NAME_BY_KIND = {
  'clearance-narrow-phase-budget': 'maxClearanceNarrowPhasePairs',
  'tlas-candidate-budget': 'maxTlasCandidatePairs',
  'call-wide-unique-fragment-precheck': 'maxCollisionInstancesPerEpoch',
  'bucket-capacity': 'maxCollisionInstancesPerEpoch',
};

export function toCapacityRejectedRecord(error, { limitName, limitValue } = {}) {
  const recognized = recognizeCapacityRejection(error);
  return {
    disposition: 'CAPACITY_REJECTED',
    limitName: limitName ?? recognized?.limitName ?? 'unknown',
    limitValue: limitValue !== undefined ? limitValue : (recognized?.limitValue ?? null),
    observedValue: error?.details?.observed ?? recognized?.observedValue ?? null,
    errorKind: error?.kind ?? recognized?.kind ?? null,
  };
}
