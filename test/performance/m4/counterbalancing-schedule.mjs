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

export function toCapacityRejectedRecord(error, { limitName, limitValue }) {
  return {
    disposition: 'CAPACITY_REJECTED',
    limitName,
    limitValue,
    observedValue: error?.details?.observed ?? null,
    errorKind: error?.kind ?? null,
  };
}
