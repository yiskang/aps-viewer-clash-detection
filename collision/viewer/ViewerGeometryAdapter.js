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
//
// Returns LIVE REFERENCES into whatever the Viewer geometry object itself owns (geometry.vb,
// positionAttr.data.array, positionAttr.array, geometry.ib, geometry.index.array) -- never
// copies. The caller (the weldPromise factory, Task 14) MUST hand this result into
// compactAndWeld with no intervening await/yield -- this closes the one channel this codebase
// could introduce for an event-loop-driven lifecycle event (reload teardown, epoch eviction) to
// land in the gap; it is not a claim that Viewer's buffers are proven stable in general -- see
// Task 14's "Protected invariants" section.

function isValidPositiveNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function isValidNonNegativeNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function isValidDrawRangeCount(n) {
  // drawRange.count may be Infinity (three.js default meaning "no limit"), but not
  // NaN, -Infinity, or negative values. Regular ranges are clamped during intersectRange.
  // A finite count must be an integer -- these are index-element counts, never fractional.
  return typeof n === 'number' && (Number.isFinite(n) ? (n >= 0 && Number.isInteger(n)) : n === Infinity);
}

function isValidNonNegativeInteger(n) {
  // group/drawRange start and count are always index-element offsets/counts, never
  // fractional quantities (Finding 4).
  return isValidNonNegativeNumber(n) && Number.isInteger(n);
}

function isValidPositiveInteger(n) {
  // Same rationale as isValidNonNegativeInteger (Finding 4): a stride is an
  // array-element index distance, never a fractional quantity.
  return isValidPositiveNumber(n) && Number.isInteger(n);
}

function resolvePositions(geometry) {
  // Priority 1: Viewer-internal interleaved layout keyed off an explicit
  // `geometry.vblayout` descriptor (spec:1154-1159). This shape is still provisional --
  // decompiling the official viewer3D.js v7.124.2 bundle shows
  // `LeanBufferGeometry.prototype.setInterleavedBuffer` sets `this.vb`/`this.vbstride`
  // but never stores `this.vblayout` on the geometry object (it's consumed into
  // per-attribute descriptors during load and discarded), and it was never observed
  // across 50 sampled render-proxy geometries from a real classic-SVF acceptance
  // model. Kept in case some other Viewer/format path nobody has tested yet does
  // produce it -- see Priority 4 below for the confirmed real classic-SVF shape.
  if (
    geometry.vb &&
    isValidPositiveNumber(geometry.vbstride) &&
    geometry.vblayout &&
    geometry.vblayout.position &&
    isValidNonNegativeNumber(geometry.vblayout.position.offset)
  ) {
    const offset = geometry.vblayout.position.offset;
    // Finding 3: enough room in each stride for x,y,z without reading into the next
    // vertex's data.
    if (offset + 3 > geometry.vbstride) return null;
    return {
      positions: geometry.vb,
      positionStride: geometry.vbstride,
      positionOffset: offset,
    };
  }

  const positionAttr = geometry.attributes && geometry.attributes.position;

  // Priority 2: standard three.js InterleavedBufferAttribute.
  if (positionAttr && positionAttr.data && positionAttr.data.array && isValidPositiveNumber(positionAttr.data.stride)) {
    const offset = typeof positionAttr.offset === 'undefined' ? 0 : positionAttr.offset;
    if (!isValidNonNegativeNumber(offset)) return null;
    // Finding 3: enough room in each stride for x,y,z without reading into the next
    // vertex's data.
    if (offset + 3 > positionAttr.data.stride) return null;
    return {
      positions: positionAttr.data.array,
      positionStride: positionAttr.data.stride,
      positionOffset: offset,
    };
  }

  // Priority 3: standard non-interleaved BufferAttribute.
  if (positionAttr && positionAttr.array) {
    // If itemSize is explicitly provided, validate it; otherwise default to 3.
    const stride = typeof positionAttr.itemSize === 'undefined' ? 3 : positionAttr.itemSize;
    if (!isValidPositiveNumber(stride)) return null;
    // Finding 3: a position attribute needs at least x,y,z (itemSize >= 3); offset is
    // always 0 here, so this alone also guarantees offset + 3 <= stride.
    if (stride < 3) return null;
    return { positions: positionAttr.array, positionStride: stride, positionOffset: 0 };
  }

  // Priority 4: Viewer-internal lean BufferAttribute shape -- the real classic-SVF
  // layout, confirmed by decompiling the official viewer3D.js v7.124.2 bundle and by
  // live sampling 50 render-proxy geometries from a real acceptance model. For a
  // genuinely interleaved attribute, `findBufferAttribute` constructs
  // `new BufferAttribute(undefined, itemSize)` with `attr.offset = attr.itemOffset =
  // <the real offset>` and `.array` left `undefined` by design -- so this branch is
  // gated on `.array` being absent, which is mutually exclusive with Priority 2/3
  // above (both require `.array` present).
  if (geometry.vb && isValidPositiveInteger(geometry.vbstride) && positionAttr && !positionAttr.array) {
    const offset = typeof positionAttr.offset !== 'undefined' ? positionAttr.offset : positionAttr.itemOffset;
    // Offsets/strides are array-element indices, never fractional -- a fractional
    // value here would read as undefined/NaN downstream (codex-review round 2
    // finding). Reuse the existing integer-checking helpers rather than the plain
    // isValidNonNegativeNumber this branch's first draft used, which accepted 0.5.
    if (!isValidNonNegativeInteger(offset)) return null;
    // If itemSize is explicitly present on the lean attribute (the real Viewer
    // bundle's findBufferAttribute always supplies it for position), it must declare
    // room for x,y,z, matching Priority 3's equivalent check for the standard
    // non-interleaved shape (codex-review round 2 finding: an inconsistent itemSize
    // of 2 here would silently read an adjacent attribute's value as z).
    if (typeof positionAttr.itemSize !== 'undefined' && !(isValidPositiveInteger(positionAttr.itemSize) && positionAttr.itemSize >= 3)) {
      return null;
    }
    // Finding 3: enough room in each stride for x,y,z without reading into the next
    // vertex's data.
    if (offset + 3 > geometry.vbstride) return null;
    return {
      positions: geometry.vb,
      positionStride: geometry.vbstride,
      positionOffset: offset,
    };
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

function intersectRange(range, constraint) {
  if (!constraint) return { start: range.start, count: range.count };
  const start = Math.max(range.start, constraint.start);
  const end = Math.min(range.start + range.count, constraint.start + constraint.count);
  return { start, count: Math.max(0, end - start) };
}

function resolveRanges(geometry, fullCount) {
  const drawRange =
    geometry.drawRange && typeof geometry.drawRange.count === 'number'
      ? { start: typeof geometry.drawRange.start === 'undefined' ? 0 : geometry.drawRange.start, count: geometry.drawRange.count }
      : null;

  // All ranges must be clamped to the actual geometry bounds [0, fullCount) to prevent
  // index overruns downstream. This applies to both the groups branch and the fallback.
  const fullCountRange = { start: 0, count: fullCount };

  // Branch condition is `groups.length > 0`, NOT "groups is present" -- standard
  // BufferGeometry always initializes `groups = []` (spec:1166), so a naive
  // truthiness/presence check takes this branch, iterates zero groups, and silently
  // emits zero triangle ranges: a false negative indistinguishable from a verified
  // no-clash. This is the exact bug this length check guards against.
  if (Array.isArray(geometry.groups) && geometry.groups.length > 0) {
    // Group and draw ranges are INTERSECTED, not either/or (spec:1167).
    // Each group range is clamped to the geometry's actual bounds.
    return geometry.groups.map((g) => {
      const bounded = intersectRange({ start: g.start, count: g.count }, fullCountRange);
      return intersectRange(bounded, drawRange);
    });
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
  // Guard against null/undefined/non-object input before accessing any properties.
  if (geometry === null || typeof geometry !== 'object') {
    return { unsupported: true, reason: 'unsupported-geometry-layout' };
  }

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

  // Validate drawRange numeric fields if present.
  // drawRange.count may be Infinity (three.js default) meaning "no limit", handled by intersectRange.
  if (geometry.drawRange && typeof geometry.drawRange.count === 'number') {
    const drStart = typeof geometry.drawRange.start === 'undefined' ? 0 : geometry.drawRange.start;
    if (!isValidNonNegativeInteger(drStart) || !isValidDrawRangeCount(geometry.drawRange.count)) {
      return { unsupported: true, reason: 'unsupported-geometry-layout' };
    }
  }

  // Validate groups numeric fields if present.
  if (Array.isArray(geometry.groups)) {
    for (const group of geometry.groups) {
      if (!group || !isValidNonNegativeInteger(group.start) || !isValidNonNegativeInteger(group.count)) {
        return { unsupported: true, reason: 'unsupported-geometry-layout' };
      }
    }
  }

  const ranges = resolveRanges(geometry, fullCount);
  const activeTriangleCount = computeActiveTriangleCount(ranges);

  return { unsupported: false, positions, positionStride, positionOffset, index, ranges, activeTriangleCount };
}
