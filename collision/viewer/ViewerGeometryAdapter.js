// collision/viewer/ViewerGeometryAdapter.js
//
// Normalizes a raw Viewer (or standard three.js) geometry object into the shape the
// rest of the collision library consumes: { positions, positionStride, positionOffset,
// index, ranges, activeTriangleCount }, per spec:1148-1227. Runtime capability
// detection, not a hard-coded single layout -- Viewer's own internal interleaved
// layout, standard three.js InterleavedBufferAttribute, and standard non-interleaved
// BufferAttribute are all supported; legacy `offsets` multi-draw layouts are
// explicitly rejected (never silently guessed).
//
// Never throws for an unsupported/rejected geometry -- returns a diagnostic marker
// instead (spec:3804-3810: "skip that fragment; record a diagnostic ... must be
// distinguishable from a verified no-clash").

function resolvePositions(geometry) {
  // Priority 1: Viewer-internal interleaved layout (spec:1154-1159) -- confirmed
  // universal across SVF/SVF2/OTG in Viewer 7.124.2.
  if (
    geometry.vb &&
    typeof geometry.vbstride === 'number' &&
    geometry.vblayout &&
    geometry.vblayout.position &&
    typeof geometry.vblayout.position.offset === 'number'
  ) {
    return {
      positions: geometry.vb,
      positionStride: geometry.vbstride,
      positionOffset: geometry.vblayout.position.offset,
    };
  }

  const positionAttr = geometry.attributes && geometry.attributes.position;

  // Priority 2: standard three.js InterleavedBufferAttribute.
  if (positionAttr && positionAttr.data && positionAttr.data.array && typeof positionAttr.data.stride === 'number') {
    return {
      positions: positionAttr.data.array,
      positionStride: positionAttr.data.stride,
      positionOffset: positionAttr.offset || 0,
    };
  }

  // Priority 3: standard non-interleaved BufferAttribute.
  if (positionAttr && positionAttr.array) {
    return { positions: positionAttr.array, positionStride: positionAttr.itemSize || 3, positionOffset: 0 };
  }

  return null;
}

function resolveIndex(geometry) {
  // spec:1178-1183 -- geometry.ib (Viewer-internal) first, then geometry.index?.array.
  // Deliberately NEVER geometry.attributes.index.array: standard three.js stores the
  // index as top-level geometry.index, never inside attributes -- a previous draft's bug.
  if (geometry.ib) return geometry.ib;
  if (geometry.index && geometry.index.array) return geometry.index.array;
  return null; // non-indexed
}

function intersectRange(range, drawRange) {
  if (!drawRange) return { start: range.start, count: range.count };
  const start = Math.max(range.start, drawRange.start);
  const end = Math.min(range.start + range.count, drawRange.start + drawRange.count);
  return { start, count: Math.max(0, end - start) };
}

function resolveRanges(geometry, fullCount) {
  const drawRange =
    geometry.drawRange && typeof geometry.drawRange.count === 'number'
      ? { start: geometry.drawRange.start || 0, count: geometry.drawRange.count }
      : null;

  // Branch condition is `groups.length > 0`, NOT "groups is present" -- standard
  // BufferGeometry always initializes `groups = []` (spec:1166), so a naive
  // truthiness/presence check takes this branch, iterates zero groups, and silently
  // emits zero triangle ranges: a false negative indistinguishable from a verified
  // no-clash. This is the exact bug this length check guards against.
  if (Array.isArray(geometry.groups) && geometry.groups.length > 0) {
    // Group and draw ranges are INTERSECTED, not either/or (spec:1167).
    return geometry.groups.map((g) => intersectRange({ start: g.start, count: g.count }, drawRange));
  }

  // groups absent OR empty: synthesize one range covering the full index/vertex
  // count, clipped to drawRange if present (spec:1168).
  return [intersectRange({ start: 0, count: fullCount }, drawRange)];
}

export function computeActiveTriangleCount(ranges) {
  // TriangleRange.count is an index-ELEMENT (or vertex) count, not a triangle count.
  // A clipped range whose count is not a multiple of 3 contributes only whole
  // triangles (spec:1164, 1523 "floor(count/3)"). Comparing raw sum(ranges[].count)
  // instead of this converted sum would enforce a ceiling ~3x stricter than intended.
  let total = 0;
  for (const range of ranges) {
    total += Math.floor(range.count / 3);
  }
  return total;
}

export function adaptViewerGeometry(geometry) {
  // Legacy `offsets` layouts are explicitly rejected, not silently normalized with a
  // guessed `baseVertex: 0` (spec:1170) -- no confirmed rule for this layout, no
  // evidence it appears in Viewer 7.124.2.
  if (Array.isArray(geometry.offsets) && geometry.offsets.length > 0) {
    return { unsupported: true, reason: 'rejected-primitive-range' };
  }

  const positionResult = resolvePositions(geometry);
  if (!positionResult) {
    return { unsupported: true, reason: 'unsupported-geometry-layout' };
  }
  const { positions, positionStride, positionOffset } = positionResult;

  const index = resolveIndex(geometry);

  // Uniform accessor invariant for callers: x_i = positions[i*positionStride + positionOffset].
  const vertexCount = Math.floor(positions.length / positionStride);
  const fullCount = index ? index.length : vertexCount;

  const ranges = resolveRanges(geometry, fullCount);
  const activeTriangleCount = computeActiveTriangleCount(ranges);

  return { unsupported: false, positions, positionStride, positionOffset, index, ranges, activeTriangleCount };
}
