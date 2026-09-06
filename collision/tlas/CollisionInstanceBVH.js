import { BVH, CENTER } from 'three-mesh-bvh';

// One CollisionInstanceBVH per loadEpoch (design spec §5.3, §6.2). `records` is this epoch's
// full admitted-instance placement list at build time -- immutable once passed in; a rebuild
// constructs a brand-new instance rather than mutating an existing one (spec §6.4).
export class CollisionInstanceBVH extends BVH {
  constructor(records) {
    super();
    this._records = records;
    // primitiveBuffer holds each primitive's ORIGINAL index into `records`, stride 1. The packed-
    // tree builder reorders this buffer in place during construction (sortUtils.js's `partition`
    // swaps stride-wide slices) -- after init() runs, primitiveBuffer[i] is the original index for
    // builder-position i. This is the "reordered-leaf-to-original-record mapping" spec §5.2
    // requires the adapter to retain.
    this.primitiveBuffer = new Uint32Array(records.length);
    for (let i = 0; i < records.length; i++) this.primitiveBuffer[i] = i;
    this.primitiveBufferStride = 1;
    // Explicit build-strategy configuration (spec §5.2: "must be passed explicitly rather than
    // relying on whatever the package's own default happens to be"), even though CENTER/10 today
    // matches the package default (Constants.js:75,77 in the checked-out 0.9.14 vendor copy) --
    // pinning it here means a future sync-vendor.mjs bump changing the *package's* default cannot
    // silently change ours.
    //
    // Resolved empirically against node_modules/three-mesh-bvh@0.9.14: `CENTER` is a named numeric
    // export (value 0) from src/core/Constants.js, re-exported from the public barrel at
    // src/index.js:9 (`export { CENTER, AVERAGE, SAH, ... } from './core/Constants.js';`) -- there
    // is no `BVH.Constants` namespace on the BVH class itself. `import { BVH, CENTER } from
    // 'three-mesh-bvh'` is the real, concrete import path.
    this.init({ strategy: CENTER, targetLeafSize: 10 });
  }

  getRootRanges() {
    // One root range covering every admitted primitive for this epoch -- no multi-root splitting
    // needed for one epoch's flat instance list (spec §5.2).
    return [{ offset: 0, count: this._records.length }];
  }

  writePrimitiveBounds(i, buffer, writeOffset) {
    const originalIndex = this.primitiveBuffer[i];
    const { min, max } = this._records[originalIndex].worldBounds;
    buffer[writeOffset + 0] = min[0]; buffer[writeOffset + 1] = min[1]; buffer[writeOffset + 2] = min[2];
    buffer[writeOffset + 3] = max[0]; buffer[writeOffset + 4] = max[1]; buffer[writeOffset + 5] = max[2];
  }

  // Resolves a builder-position primitive index (as reported by an intersectsRange leaf callback)
  // back to its original record.
  recordAt(builderPositionIndex) {
    return this._records[this.primitiveBuffer[builderPositionIndex]];
  }

  // { onLeafRange, onCandidate }: onLeafRange(offset, count) fires once per matched leaf, BEFORE
  // expansion (spec §7.5.1 stage-1 tlasLeafRangeEmissions); onCandidate(builderPositionIndex) fires
  // once per expanded primitive (stage-2 tlasPrimitiveCandidatePairs). Both callback ARGUMENTS to
  // onCandidate are builder-position indices -- recordAt(builderPositionIndex) is the only
  // legitimate way to resolve one to its original record (spec §5.2's "reordered-leaf-to-original-
  // record mapping" requirement; codex-review Important #4's naming fix).
  queryBox(min, max, { onLeafRange, onCandidate }) {
    let truncated = false;
    let pendingError = null;
    const boxIntersects = (bMin, bMax) =>
      bMin[0] <= max[0] && bMax[0] >= min[0]
      && bMin[1] <= max[1] && bMax[1] >= min[1]
      && bMin[2] <= max[2] && bMax[2] >= min[2];

    const fail = (err) => { pendingError = err; truncated = true; };

    try {
      this.shapecast({
        intersectsBounds: (box) => boxIntersects([box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z]),
        intersectsRange: (offset, count, contained, depth, nodeIndex, box) => {
          // shapecastTraverse starts at the tree's ROOT node and only calls `intersectsBounds` on
          // a node's CHILDREN during recursion -- never on the root itself. When the whole
          // primitive set fits in a single leaf (any epoch with count <= targetLeafSize, which
          // includes every small unit-test fixture here), that leaf IS the root, so this callback
          // fires unconditionally regardless of query-box overlap unless we re-test the leaf's own
          // box ourselves. Do that first so a genuinely disjoint leaf never counts as "matched" --
          // codex-advisor (2026-09-06) confirmed this is a real gap, not a hypothetical one.
          if (!boxIntersects([box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z])) {
            return false; // not a match -- keep traversing (irrelevant for a leaf, but correct)
          }

          try {
            onLeafRange?.(offset, count);
          } catch (err) {
            // Callback-exception containment (spec §5.2, §9.3.3) applies to BOTH callbacks, not
            // just onCandidate -- codex-advisor (2026-09-06) flagged the original draft only
            // guarding onCandidate as a real gap, since vendored cleanup is not itself
            // try/finally-guarded.
            fail(err);
            return true; // stop this range, and the whole traversal, immediately
          }

          for (let i = offset; i < offset + count; i++) {
            // A matched leaf's own bounding box is the union of every primitive it contains -- it
            // does not mean every individual primitive overlaps the query box. Re-test each
            // primitive's own worldBounds here so onCandidate only fires for primitives that
            // genuinely overlap (mirrors MeshBVH's own per-triangle `intersectsTriangle` re-test
            // after leaf expansion -- codex-advisor (2026-09-06) confirmed this is the right model).
            //
            // Note for Task 13 (not implemented here): because onCandidate is now exact-overlap
            // gated, it under-reports raw leaf expansion. Task 13's stage-2 statistic
            // (tlasPrimitiveCandidatePairs / its expansion budget) should be driven by the matched
            // range's own `count` (available from onLeafRange), not by counting onCandidate calls.
            const { min: pMin, max: pMax } = this.recordAt(i).worldBounds;
            if (!boxIntersects(pMin, pMax)) continue;

            let signal;
            try {
              signal = onCandidate?.(i);
            } catch (err) {
              fail(err);
              return true; // stop this range, and the whole traversal, immediately
            }
            if (signal === 'stop') { truncated = true; return true; }
          }
          return false; // keep traversing -- normal candidate collection wants every match
        },
      });
    } finally {
      // Traversal has now fully returned and cleaned up (shapecast.js's own boxPool release runs
      // regardless of how shapecastTraverse exited) -- only NOW is it safe to rethrow.
    }
    if (pendingError) throw pendingError;
    return { truncated };
  }
}
