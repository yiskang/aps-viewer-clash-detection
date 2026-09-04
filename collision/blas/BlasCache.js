// collision/blas/BlasCache.js
//
// Thin, named seam over ThreeMeshBvhBackend.build. Dedup of simultaneous BVH builds
// is NOT owned here -- it's GeometryRegistry's single-flight accelerationPromise slot
// (see docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1559-1568).
// BlasCache exists so the repo's own module layout (blas/ThreeMeshBvhBackend.js +
// blas/BlasCache.js) is honored, and so a future multi-backend milestone has an
// existing injection point rather than requiring every call site to change.

import * as ThreeMeshBvhBackend from './ThreeMeshBvhBackend.js';

export class BlasCache {
  constructor({ backend = ThreeMeshBvhBackend } = {}) {
    this._backend = backend;
  }

  async build(weldedGeometry) {
    return this._backend.build(weldedGeometry);
  }
}
