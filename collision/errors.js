// collision/errors.js
//
// The lifecycle error classes checkpoints (collision/scheduler.js) and
// CollisionWorld (Task 17) throw. Every yield-point checkpoint in this design must
// throw one of exactly WorldDisposedError/ModelEvictedError, never swallow a
// lifecycle failure silently (spec:3937-3953, 3916-3930).
//
// The two classes below them are NOT checkpoint/lifecycle errors and are deliberately
// distinct from those two, so neither is ever mistaken for an eviction or a disposal:
//  - RenderProxyUnavailableError -- a TRANSIENT Viewer-side miss (batch-4 fix wave, B2)
//  - ObjectTreeUnavailableError  -- the Viewer's own "the tree could not be built"
//    signal at findClashes entry (docs/superpowers/specs/instance-tree-readiness-decision.md)

export class WorldDisposedError extends Error {
  constructor(message = 'CollisionWorld has been disposed') {
    super(message);
    this.name = 'WorldDisposedError';
  }
}

export class ModelEvictedError extends Error {
  constructor(modelId) {
    super(`Model ${modelId} was evicted`);
    this.name = 'ModelEvictedError';
    this.modelId = modelId;
  }
}

/**
 * `viewer.impl.getRenderProxy(model, fragId)` returned nothing usable -- no proxy at all, or a
 * proxy with no `.geometry`. The Viewer does this legitimately and TRANSIENTLY: the fragment may
 * not be loaded yet, may be culled, or may already be torn down.
 *
 * This is deliberately an EXCEPTION rather than an `{ unsupported: true }` marker, and the
 * distinction is load-bearing. A normalization failure (`unsupported-geometry-layout` /
 * `rejected-primitive-range`) describes a geometry that WAS inspected and structurally rejected, so
 * re-attempting it could only reach the same verdict; this library caches that verdict as an
 * oversized marker for the epoch. (The design spec :3170-3174 in fact says those two reasons should
 * settle no persistent entry state either -- a known, pre-existing deviation, noted in
 * CollisionWorld._runNarrowPhasePair and out of scope for this class.) A missing render proxy is
 * categorically different: no geometry existed to inspect at all, the condition is transient, and it
 * must therefore settle NO persistent GeometryRegistry state. Throwing routes it through
 * GeometryRegistry._runPhase's existing rejection path (`_removeIfSame`), which discards the
 * in-flight entry and lets a later lookup for the same (loadEpoch, geometryIndex) start fresh.
 *
 * CollisionWorld._runNarrowPhasePair catches exactly this class and skips the candidate pair with a
 * `geometry-not-yet-available` diagnostic; every other error still aborts the whole findClashes call.
 */
export class RenderProxyUnavailableError extends Error {
  constructor({ loadEpoch, geometryIndex, fragId, modelId } = {}) {
    super(
      `No render proxy geometry available for fragment ${fragId} ` +
      `(geometryIndex ${geometryIndex}, loadEpoch ${loadEpoch}, model ${modelId}) -- ` +
      `not yet loaded, culled, or already torn down`,
    );
    this.name = 'RenderProxyUnavailableError';
    this.loadEpoch = loadEpoch;
    this.geometryIndex = geometryIndex;
    this.fragId = fragId;
    this.modelId = modelId;
  }
}

/**
 * `model.getObjectTree(onSuccess, onError)` called back with an ERROR: the Viewer itself reports
 * that the property database / instance tree could not be built for this model.
 *
 * Distinct from WorldDisposedError/ModelEvictedError by design
 * (docs/superpowers/specs/instance-tree-readiness-decision.md, "Hook point for implementation"):
 * nothing about this world or this model's lease is wrong -- the Viewer simply has no tree to walk,
 * so findClashes rejects rather than silently running an extraction walk against an unavailable tree.
 */
export class ObjectTreeUnavailableError extends Error {
  constructor(modelId, cause) {
    super(`Object tree unavailable for model ${modelId}`);
    this.name = 'ObjectTreeUnavailableError';
    this.modelId = modelId;
    // The Viewer's own onError argument, kept verbatim for diagnosis. Assigned rather than passed
    // through `new Error(msg, { cause })` so the field is present on every Node/browser version this
    // app supports, not only those implementing the error-cause option.
    this.cause = cause;
  }
}

/**
 * Thrown when a cross-model query's mid-query placement-revalidation (design spec §9.2 point 8)
 * detects that a captured model's placement revision changed for a reason the query did not
 * itself cause (§6.7.5). Distinct from ModelEvictedError: the model is still live, but the input
 * geometry may have moved out from under this in-flight query.
 */
export class ModelPlacementChangedError extends Error {
  constructor({ modelId, loadEpoch, expectedRevision, actualRevision } = {}) {
    super(
      `Model ${modelId} (loadEpoch ${loadEpoch}) placement changed mid-query: ` +
      `expected revision ${expectedRevision}, observed ${actualRevision}`,
    );
    this.name = 'ModelPlacementChangedError';
    this.modelId = modelId;
    this.loadEpoch = loadEpoch;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

const CAPACITY_EXCEEDED_MESSAGES = {
  'call-wide-unique-fragment-precheck': (kind) => `CollisionInstance admission rejected (${kind})`,
  'bucket-capacity': (kind) => `CollisionInstance admission rejected (${kind})`,
  'tlas-candidate-budget': () => 'TLAS candidate-expansion budget exceeded for this findClashes call',
  'whole-model-enumeration': (kind) => `CollisionInstance admission rejected (${kind})`, // Task 5's own kind, added here
  'clearance-narrow-phase-budget': (k) =>
    `Clearance narrow-phase pair budget exceeded (${k}) — too many candidate pairs for this findClashes call`,
};

export class CapacityExceededError extends Error {
  constructor(kind, details) {
    const messageFn = CAPACITY_EXCEEDED_MESSAGES[kind]
      ?? ((k) => `CollisionInstance admission rejected (${k})`); // unknown kind: preserve old text
    super(messageFn(kind));
    this.name = 'CapacityExceededError';
    this.kind = kind;
    Object.assign(this, details);
  }
}
