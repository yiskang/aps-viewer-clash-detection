// collision/geometry/ClearanceDerivedGeometryCache.js
//
// SVF2 non-uniform fragment clearance (docs/superpowers/specs/
// 2026-10-07-svf2-nonuniform-fragment-clearance-design.md §4 A / §5.2).
//
// A clearance-PRIVATE cache of derived ("prescaled") meshes: for an operand whose world matrix is
// A = Q * S (orthogonal columns, det > 0 -- ClearanceTransformClass's 'derived' path), the derived
// mesh is the raw Viewer geometry re-read, compacted, prescaled by S (compactAndWeld's
// `positionScale`), welded with the existing weld epsilon in that WORLD-unit frame, and given its own
// BVH (ThreeMeshBvhBackend.build). The clearance distance query then places it by the rigid [Q | t]
// read from the live placement at every query; this cache never stores placement.
//
// Deliberately NOT part of GeometryRegistry: canonical mesh identity, GeometryRegistry entries,
// geometry digests, getEpochGeometryEntries and the BLAS/TLAS caches are untouched, and nothing here
// is ever visible to the Hard modes or to the clearance Hard-Clash precheck (canonical instances).
//
// Key: Map<loadEpoch, bucket>, bucket.entries: Map<"geometryIndex|bits(s0)|bits(s1)|bits(s2)", entry>
// where bits = the exact float64 bit pattern (deterministic, collision-free for distinct scales).
//
// Lifecycle (same rigor as GeometryRegistry, as its own small class):
//  1. miss -> a 'building' placeholder (own cancellation signal) is inserted SYNCHRONOUSLY before
//     any await; concurrent callers for the key share its one promise (single flight).
//  2. build = checkpoint({loadEpoch}) on the world's long-lived port (liveness/disposal validated),
//     then the synchronous Viewer read + compact/prescale/weld + BVH build with no await between the
//     read and the copy (same protected invariant as createGeometryRegistry's buildWeld). The whole
//     attempt is raced against the placeholder's cancellation signal.
//  3. success publishes ONLY if the placeholder is still the current entry of the epoch's CURRENT
//     bucket (a released / detached / evicted build never publishes, never recreates a bucket).
//  4. any rejection removes only the matching placeholder and propagates (nothing cached; the next
//     call retries).
//  5. a deterministic unsupported outcome (non-finite prescaled coordinate) is cached as a marker.
//  6. releaseEpoch (model eviction) rejects that epoch's in-flight waiters with ModelEvictedError;
//     releaseAll (dispose) with WorldDisposedError; both drop the buckets.
//  7. detachEpoch (placement change) is NON-cancelling: the epoch's bucket is replaced by a fresh
//     empty one; in-flight builds keep running and resolve their waiters, but step 3 fails for them.
//  Memory: per epoch, a hard byte budget (ready entries' retained position + index + BVH bytes) and
//  an entry cap (markers included); exceeding either evicts least-recently-used ready/marker
//  entries -- never a building one. Eviction only costs a rebuild; results never depend on it.
//  The cap governs SETTLED entries: an in-flight placeholder holds no geometry (the build is
//  synchronous once its checkpoint passes) and is never refused or evicted; CollisionWorld keeps at
//  most one derived build in flight per findClashes call (pairs and their two sides are resolved
//  sequentially), so in-flight placeholders are bounded by the number of concurrent calls -- the
//  same posture as GeometryRegistry's own building entries. The cap is restored as builds publish.

import { WorldDisposedError, ModelEvictedError } from '../errors.js';
import { compactAndWeld } from './activeRangeCompaction.js';
import { build as buildBvh } from '../blas/ThreeMeshBvhBackend.js';
import {
  maxSyncTriangleCount, maxCollisionInstancesPerEpoch, maxClearanceDerivedGeometryBytesPerEpoch,
} from '../constants.js';

/**
 * Transient: the second Viewer read came back with an unsupported layout, or the derived
 * compaction refused it for a reason other than a non-finite prescaled coordinate. Never cached;
 * the clearance narrow phase maps it to `geometry-not-yet-available` / 'geometry-unavailable'
 * (design §5.6), exactly like a RenderProxyUnavailableError. Internal to the clearance path (not
 * re-exported from collision/index.js).
 */
export class DerivedGeometryUnavailableError extends Error {
  constructor({ loadEpoch, geometryIndex, reason } = {}) {
    super(`Derived clearance geometry unavailable for geometryIndex ${geometryIndex} (loadEpoch ${loadEpoch}): ${reason}`);
    this.name = 'DerivedGeometryUnavailableError';
    this.loadEpoch = loadEpoch;
    this.geometryIndex = geometryIndex;
    this.reason = reason;
  }
}

const bitsView = new DataView(new ArrayBuffer(8));
function float64Bits(value) {
  bitsView.setFloat64(0, value);
  return `${bitsView.getUint32(0).toString(16).padStart(8, '0')}${bitsView.getUint32(4).toString(16).padStart(8, '0')}`;
}

/** Exact-bits cache key for (geometryIndex, S). Exported for tests. */
export function derivedGeometryKey(geometryIndex, scale) {
  return `${geometryIndex}|${float64Bits(scale[0])}|${float64Bits(scale[1])}|${float64Bits(scale[2])}`;
}

function makeCancellationSignal() {
  let rejectSignal;
  const signal = new Promise((_resolve, reject) => { rejectSignal = reject; });
  signal.catch(() => {}); // always raced; avoid a stray unhandled rejection
  return { signal, rejectSignal };
}

function bvhRetainedBytes(bvh) {
  if (!bvh) return 0;
  const roots = Array.isArray(bvh._roots)
    ? bvh._roots.reduce((sum, root) => sum + (root && root.byteLength ? root.byteLength : 0), 0)
    : 0;
  return roots + (bvh._indirectBuffer ? bvh._indirectBuffer.byteLength : 0);
}

function retainedBytesOf(result) {
  if (result.state !== 'ready' || !result.geometry) return { position: 0, index: 0, bvh: 0 };
  return {
    position: result.geometry.attributes.position.array.byteLength,
    index: result.geometry.index.array.byteLength,
    bvh: bvhRetainedBytes(result.bvh),
  };
}

/**
 * Default derived build: compact + prescale + world-unit weld, then the canonical BVH builder.
 * Pure function of (raw view, weldEpsilon, scale).
 */
export function buildDerivedGeometry(triangleGeometryView, { weldEpsilon, scale, loadEpoch, geometryIndex }) {
  const welded = compactAndWeld(triangleGeometryView, { weldEpsilon, maxSyncTriangleCount, positionScale: scale });
  if (welded.scaledPositionNonFinite === true) {
    // Deterministic for the key (pure function of raw geometry and S): cached as a marker.
    return { state: 'unsupported', cause: 'scaled-position-non-finite' };
  }
  if (welded.oversized === true) {
    throw new DerivedGeometryUnavailableError({ loadEpoch, geometryIndex, reason: welded.reason });
  }
  if (welded.triangleCount === 0) {
    // Every triangle collapsed under the world-unit weld: diagnosed by the caller, never treated as
    // a silent "no clearance hit" (design §5.6). Nothing to traverse, nothing retained.
    return { state: 'ready', geometry: null, bvh: null, localDiagonal: 0, triangleCount: 0 };
  }
  const built = buildBvh(welded);
  return {
    state: 'ready', geometry: built.geometry, bvh: built.bvh, localDiagonal: built.localDiagonal,
    triangleCount: welded.triangleCount,
  };
}

function emptyDiagnostics() {
  return {
    readyEntries: 0, buildingEntries: 0, unsupportedEntries: 0,
    builds: 0, hits: 0, sharedWaits: 0, evictions: 0,
    retainedPositionBytes: 0, retainedIndexBytes: 0, retainedBvhBytes: 0,
  };
}

function newBucket(counters = { builds: 0, hits: 0, sharedWaits: 0, evictions: 0 }) {
  return { entries: new Map(), counters, bytes: { position: 0, index: 0, bvh: 0 } };
}

export class ClearanceDerivedGeometryCache {
  /**
   * @param {Object} deps
   * @param {(loadEpoch: number, geometryIndex: number) => {triangleGeometryView, weldEpsilon}} deps.resolveGeometryView
   *   the world's synchronous raw-geometry read (CollisionWorld._resolveGeometryView).
   * @param {{checkpoint: (args: {loadEpoch: number}) => (Promise<void>|undefined)}} deps.checkpointPort
   * @param {Function} [deps.buildDerived]  test seam; defaults to buildDerivedGeometry.
   * @param {number} [deps.maxBytesPerEpoch]
   * @param {number} [deps.maxEntriesPerEpoch]
   */
  constructor({
    resolveGeometryView, checkpointPort, buildDerived = buildDerivedGeometry,
    maxBytesPerEpoch = maxClearanceDerivedGeometryBytesPerEpoch,
    maxEntriesPerEpoch = maxCollisionInstancesPerEpoch,
  } = {}) {
    if (typeof resolveGeometryView !== 'function') {
      throw new TypeError('ClearanceDerivedGeometryCache requires resolveGeometryView(loadEpoch, geometryIndex)');
    }
    if (!checkpointPort || typeof checkpointPort.checkpoint !== 'function') {
      throw new TypeError('ClearanceDerivedGeometryCache requires a checkpointPort exposing checkpoint({ loadEpoch })');
    }
    this._resolveGeometryView = resolveGeometryView;
    this._checkpointPort = checkpointPort;
    this._buildDerived = buildDerived;
    this._maxBytesPerEpoch = maxBytesPerEpoch;
    this._maxEntriesPerEpoch = maxEntriesPerEpoch;
    this._epochs = new Map();   // Map<loadEpoch, bucket>
    this._inflight = new Map(); // Map<loadEpoch, Set<placeholder>> -- incl. builds detached from their bucket
  }

  /**
   * @returns {Promise<{state: 'ready', geometry, bvh, localDiagonal: number, triangleCount: number}
   *   | {state: 'unsupported', cause: 'scaled-position-non-finite'}>}
   */
  get({ loadEpoch, geometryIndex, scale, ownerModelIdHint }) {
    const key = derivedGeometryKey(geometryIndex, scale);
    let bucket = this._epochs.get(loadEpoch);
    if (!bucket) {
      bucket = newBucket();
      this._epochs.set(loadEpoch, bucket);
    }
    const existing = bucket.entries.get(key);
    if (existing) {
      if (existing.state === 'building') {
        bucket.counters.sharedWaits++;
        return existing.promise;
      }
      bucket.counters.hits++;
      bucket.entries.delete(key); // LRU touch: move to most-recently-used
      bucket.entries.set(key, existing);
      return Promise.resolve(existing.result);
    }
    bucket.counters.builds++;
    const { signal, rejectSignal } = makeCancellationSignal();
    const placeholder = { state: 'building', signal, rejectSignal, ownerModelIdHint, promise: null };
    // Inserted synchronously, before the checkpoint below can ever yield (single flight).
    bucket.entries.set(key, placeholder);
    let inflight = this._inflight.get(loadEpoch);
    if (!inflight) { inflight = new Set(); this._inflight.set(loadEpoch, inflight); }
    inflight.add(placeholder);
    placeholder.promise = this._run(loadEpoch, geometryIndex, scale, key, placeholder);
    return placeholder.promise;
  }

  _run(loadEpoch, geometryIndex, scale, key, placeholder) {
    const attempt = (async () => {
      // scheduler.js contract: undefined synchronously when no yield is due; a synchronous throw on
      // a liveness failure still rejects this async IIFE.
      const pending = this._checkpointPort.checkpoint({ loadEpoch });
      if (pending) await pending;
      // Synchronous from here: Viewer read -> compaction copy -> weld -> BVH, no await in between.
      const { triangleGeometryView, weldEpsilon } = this._resolveGeometryView(loadEpoch, geometryIndex);
      if (!triangleGeometryView || triangleGeometryView.unsupported === true) {
        throw new DerivedGeometryUnavailableError({
          loadEpoch, geometryIndex, reason: triangleGeometryView?.reason ?? 'no-geometry-view',
        });
      }
      return this._buildDerived(triangleGeometryView, { weldEpsilon, scale, loadEpoch, geometryIndex });
    })();
    return Promise.race([attempt, placeholder.signal]).then(
      (result) => {
        this._settle(loadEpoch, placeholder);
        this._publish(loadEpoch, key, placeholder, result);
        return result;
      },
      (err) => {
        this._settle(loadEpoch, placeholder);
        this._removeIfSame(loadEpoch, key, placeholder, err);
        throw err;
      },
    );
  }

  _settle(loadEpoch, placeholder) {
    const inflight = this._inflight.get(loadEpoch);
    if (!inflight) return;
    inflight.delete(placeholder);
    if (inflight.size === 0) this._inflight.delete(loadEpoch);
  }

  _publish(loadEpoch, key, placeholder, result) {
    const bucket = this._epochs.get(loadEpoch);
    if (!bucket || bucket.entries.get(key) !== placeholder) return; // released / detached / superseded
    const bytes = retainedBytesOf(result);
    bucket.entries.delete(key); // publish as most-recently-used
    bucket.entries.set(key, { state: result.state, result, bytes });
    bucket.bytes.position += bytes.position;
    bucket.bytes.index += bytes.index;
    bucket.bytes.bvh += bytes.bvh;
    this._enforceBudget(bucket);
  }

  _removeIfSame(loadEpoch, key, placeholder, err) {
    const bucket = this._epochs.get(loadEpoch);
    if (!bucket || bucket.entries.get(key) !== placeholder) return;
    bucket.entries.delete(key);
    // A rejection caused by eviction/disposal must not leave a bucket behind for a dead epoch
    // (the bucket was only (re)created by this very call); a live epoch keeps its counters.
    if (bucket.entries.size === 0 && (err instanceof ModelEvictedError || err instanceof WorldDisposedError)) {
      this._epochs.delete(loadEpoch);
    }
  }

  _enforceBudget(bucket) {
    const totalBytes = () => bucket.bytes.position + bucket.bytes.index + bucket.bytes.bvh;
    while (totalBytes() > this._maxBytesPerEpoch || bucket.entries.size > this._maxEntriesPerEpoch) {
      let victimKey;
      for (const [k, entry] of bucket.entries) {
        if (entry.state !== 'building') { victimKey = k; break; } // Map order = LRU first
      }
      if (victimKey === undefined) return; // only building entries left -- never evicted
      const victim = bucket.entries.get(victimKey);
      bucket.entries.delete(victimKey);
      bucket.bytes.position -= victim.bytes.position;
      bucket.bytes.index -= victim.bytes.index;
      bucket.bytes.bvh -= victim.bytes.bvh;
      bucket.counters.evictions++;
    }
  }

  _rejectInflight(loadEpoch, makeError) {
    const inflight = this._inflight.get(loadEpoch);
    if (!inflight) return;
    for (const placeholder of inflight) placeholder.rejectSignal(makeError(placeholder));
    this._inflight.delete(loadEpoch);
  }

  /** Model eviction only: reject in-flight waiters with ModelEvictedError and drop the epoch. */
  releaseEpoch(loadEpoch) {
    this._rejectInflight(loadEpoch, (placeholder) => new ModelEvictedError(placeholder.ownerModelIdHint));
    this._epochs.delete(loadEpoch);
  }

  /** Dispose only: reject every in-flight waiter with WorldDisposedError and drop everything. */
  releaseAll() {
    for (const loadEpoch of [...this._inflight.keys()]) {
      this._rejectInflight(loadEpoch, () => new WorldDisposedError());
    }
    this._epochs.clear();
  }

  /**
   * Placement change (invalidateModelPlacement / placement-refresh publish): NON-cancelling. The
   * epoch's bucket is replaced by a fresh empty one (cumulative counters carried over); in-flight
   * builds resolve their waiters normally but can no longer publish.
   */
  detachEpoch(loadEpoch) {
    const bucket = this._epochs.get(loadEpoch);
    if (!bucket) return;
    this._epochs.set(loadEpoch, newBucket(bucket.counters));
  }

  hasEpoch(loadEpoch) {
    return this._epochs.has(loadEpoch);
  }

  /** Read-only, exhaustive per-epoch diagnostics (design §5.4); empty default for an unknown epoch. */
  getEpochDiagnostics(loadEpoch) {
    const bucket = this._epochs.get(loadEpoch);
    if (!bucket) return emptyDiagnostics();
    const out = emptyDiagnostics();
    for (const entry of bucket.entries.values()) {
      if (entry.state === 'building') out.buildingEntries++;
      else if (entry.state === 'ready') out.readyEntries++;
      else out.unsupportedEntries++;
    }
    out.builds = bucket.counters.builds;
    out.hits = bucket.counters.hits;
    out.sharedWaits = bucket.counters.sharedWaits;
    out.evictions = bucket.counters.evictions;
    out.retainedPositionBytes = bucket.bytes.position;
    out.retainedIndexBytes = bucket.bytes.index;
    out.retainedBvhBytes = bucket.bytes.bvh;
    return out;
  }
}
