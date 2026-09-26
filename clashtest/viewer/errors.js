// clashtest/viewer/errors.js
// Adapter-local (D-V7): NOT added to clashtest/errors.js, whose list is pinned to spec 18. The planner maps
// any unrecognized enumerator throw to planning gap `enumeration-failed` by name (engine.js planningCauseOf),
// which is the spec 6.2 disposition for "an enumerator defect".
export class EnumerationInconsistencyError extends Error {
  constructor(reason, detail = {}) {
    super(`Viewer enumeration inconsistent: ${reason}`);
    this.name = 'EnumerationInconsistencyError';
    this.reason = reason;
    this.detail = detail;
  }
}

// D-V9: a planning traversal crossed an EXISTING collision extraction limit (never a new one). Adapter-local
// like D-V7; the planner maps any unrecognized throw to `enumeration-failed` by name (engine.js planningCauseOf).
export class EnumerationBoundExceededError extends Error {
  constructor(bound, detail = {}) {
    super(`Viewer enumeration exceeds ${bound}`);
    this.name = 'EnumerationBoundExceededError';
    this.bound = bound;      // 'maxFragmentsPerDbId' | 'maxChildrenPerNode'
    this.detail = detail;
  }
}
