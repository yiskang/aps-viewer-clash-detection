// collision/errors.js
//
// The two lifecycle error classes checkpoints (collision/scheduler.js) and
// CollisionWorld (Task 17) throw. Every yield-point checkpoint in this design must
// throw one of exactly these two, never swallow a lifecycle failure silently
// (spec:3937-3953, 3916-3930).

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
