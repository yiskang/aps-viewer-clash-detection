// collision/geometry/GeometryRegistry.js
//
// Registry of per-(loadEpoch, geometryIndex) GeometryRecord/OversizedMarker entries.
// Implements the "publish-when-build-starts" rule
// (docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1413-1499).
//
// Builder-agnostic by design: buildWeld/buildConnectivity/buildAcceleration are
// injected constructor parameters. Task 14 wires the real compactAndWeld /
// GeometryConnectivity / BlasCache builders via createGeometryRegistry.js; this file
// is exercised in isolation with stub builders in test/geometry/GeometryRegistry.test.mjs.

import { WorldDisposedError, ModelEvictedError } from '../errors.js';

function makeCancellationSignal() {
  let rejectSignal;
  const signal = new Promise((_resolve, reject) => {
    rejectSignal = reject;
  });
  signal.catch(() => {}); // always raced via Promise.race below; avoid stray warnings
  // in the case a phase is never actually scheduled against this signal.
  return { signal, rejectSignal };
}

export class GeometryRegistry {
  constructor({ buildWeld, buildConnectivity, buildAcceleration, checkpointPort }) {
    if (typeof buildWeld !== 'function') {
      throw new TypeError('GeometryRegistry requires buildWeld(loadEpoch, geometryIndex, ownerModelIdHint)');
    }
    if (typeof buildConnectivity !== 'function') {
      throw new TypeError('GeometryRegistry requires buildConnectivity(weldedGeometry)');
    }
    if (typeof buildAcceleration !== 'function') {
      throw new TypeError('GeometryRegistry requires buildAcceleration(weldedGeometry)');
    }
    if (!checkpointPort || typeof checkpointPort.checkpoint !== 'function') {
      throw new TypeError('GeometryRegistry requires a checkpointPort exposing checkpoint({ loadEpoch })');
    }
    this._buildWeld = buildWeld;
    this._buildConnectivity = buildConnectivity;
    this._buildAcceleration = buildAcceleration;
    this._checkpointPort = checkpointPort;
    // Map<loadEpoch, Map<geometryIndex, Entry>> -- nested so releaseEntriesForEpoch is
    // O(entries-in-epoch), mirroring the CollisionInstance cache's own
    // Map<loadEpoch, Map<fragmentId, CollisionInstance>> partitioning (spec :207, :1324-1330).
    // Entry = { buildState, weldPromise, connectivityPromise, accelerationPromise,
    //           cancellationSignal, rejectSignal, ownerModelIdHint, weldedGeometry,
    //           weldWasOversized }                                    (a GeometryRecord)
    //       | { oversized: true, reason, activeTriangleCount }        (an OversizedMarker,
    //           stored verbatim -- see _convertToOversized -- so a cache hit can hand it
    //           back to a caller directly, with no internal tag to strip first)
    // The two are told apart by `entry.oversized === true`, never by a separate tag
    // field: a GeometryRecord never sets `oversized` at all, and OversizedMarker's own
    // canonical shape already carries it.
    this._epochs = new Map();
  }

  async getOrBuildGeometry({ loadEpoch, geometryIndex, ownerModelIdHint, needsConnectivity }) {
    let bucket = this._epochs.get(loadEpoch);
    if (!bucket) {
      bucket = new Map();
      this._epochs.set(loadEpoch, bucket);
    }
    let entry = bucket.get(geometryIndex);
    if (!entry) {
      // "Insert first, then build" (spec :1423-1429): the entry is inserted here,
      // synchronously, before the weld phase's checkpoint ever runs. A concurrent
      // lookup landing after this line -- however soon -- shares this exact entry
      // rather than starting a duplicate build.
      entry = this._insertBuildingEntry(loadEpoch, geometryIndex, ownerModelIdHint, needsConnectivity);
      bucket.set(geometryIndex, entry);
    }
    return this._awaitEntry(loadEpoch, geometryIndex, entry, needsConnectivity);
  }

  releaseEntriesForEpoch(loadEpoch) {
    const bucket = this._epochs.get(loadEpoch);
    if (!bucket) return;
    for (const entry of bucket.values()) {
      // Oversized markings never had a phase started, and therefore never had a
      // cancellation signal created -- nothing to reject (spec :1490-1498).
      if (entry.oversized !== true) {
        entry.rejectSignal(new ModelEvictedError(entry.ownerModelIdHint));
      }
    }
    this._epochs.delete(loadEpoch);
  }

  releaseAll() {
    for (const bucket of this._epochs.values()) {
      for (const entry of bucket.values()) {
        if (entry.oversized !== true) {
          entry.rejectSignal(new WorldDisposedError());
        }
      }
    }
    this._epochs.clear();
  }

  // -- internals --------------------------------------------------------

  _insertBuildingEntry(loadEpoch, geometryIndex, ownerModelIdHint, needsConnectivityAtStart) {
    const { signal, rejectSignal } = makeCancellationSignal();
    const entry = {
      buildState: 'building',
      weldPromise: null,
      connectivityPromise: null,
      accelerationPromise: null,
      cancellationSignal: signal,
      rejectSignal,
      ownerModelIdHint,
      weldedGeometry: null,
      weldWasOversized: false,
    };

    entry.weldPromise = this._runPhase(loadEpoch, geometryIndex, entry, () =>
      this._buildWeld(loadEpoch, geometryIndex, ownerModelIdHint)
    );

    // `tail` is reassigned synchronously every time a phase is scheduled below, so
    // phase ORDER is fixed at schedule time, never at settle time -- this is what
    // keeps concurrent callers from racing each other into starting the same phase
    // twice, and what enforces "at most one phase unresolved on an entry at a time"
    // (spec :1482-1484).
    let tail = entry.weldPromise.then((weldResult) => {
      if (weldResult && weldResult.oversized === true) {
        entry.weldWasOversized = true;
        this._convertToOversized(loadEpoch, geometryIndex, entry, weldResult);
        return;
      }
      entry.weldedGeometry = weldResult;
    });

    if (needsConnectivityAtStart) {
      tail = this._chainConnectivity(loadEpoch, geometryIndex, entry, tail);
    }
    this._chainAcceleration(loadEpoch, geometryIndex, entry, tail);

    return entry;
  }

  _chainConnectivity(loadEpoch, geometryIndex, entry, waitFor) {
    entry.connectivityPromise = waitFor.then(() => {
      if (entry.weldWasOversized) return null; // never read by any real caller.
      return this._runPhase(loadEpoch, geometryIndex, entry, () =>
        this._buildConnectivity(entry.weldedGeometry)
      );
    });
    // May legitimately go unread (e.g. a surface-intersection caller sharing an
    // entry a containment caller built) -- prevent a spurious unhandledRejection.
    entry.connectivityPromise.catch(() => {});
    return entry.connectivityPromise;
  }

  _chainAcceleration(loadEpoch, geometryIndex, entry, waitFor) {
    entry.accelerationPromise = waitFor
      .then(() => {
        if (entry.weldWasOversized) return null;
        return this._runPhase(loadEpoch, geometryIndex, entry, () =>
          this._buildAcceleration(entry.weldedGeometry)
        );
      })
      .then((accel) => {
        // 'ready' is record-level and mode-independent: weld+BVH both resolved,
        // regardless of whether connectivity was ever touched (spec :1439-1448).
        if (!entry.weldWasOversized) entry.buildState = 'ready';
        return accel;
      });
    entry.accelerationPromise.catch(() => {});
    return entry.accelerationPromise;
  }

  _runPhase(loadEpoch, geometryIndex, entry, builderFn) {
    const attempt = (async () => {
      // scheduler.js's own contract: checkpoint() returns undefined synchronously on
      // the "not due" fast path and only returns a real Promise when a yield is
      // actually due. Callers MUST branch on that rather than bare-`await`ing the
      // call, or every checkpoint reinstates the microtask hop the port exists to
      // avoid at scale. A synchronous throw (liveness failure with nothing due yet)
      // still propagates correctly since this whole block runs inside an async IIFE.
      const pending = this._checkpointPort.checkpoint({ loadEpoch });
      if (pending) await pending;
      return builderFn();
    })();
    // Every phase races the entry's one cancellation signal, including a lazily
    // started connectivity build against an already-'ready' entry (spec :1475-1477).
    // On ANY rejection -- a checkpoint's own liveness failure, the cancellation
    // signal winning the race, or an arbitrary builder exception -- the entry is
    // removed synchronously as part of the same rejection (spec :1462-1470,
    // generalized here to any phase-rejection cause, not only a checkpoint failure,
    // so a builder bug can never leave a permanently stuck 'building' record).
    return Promise.race([attempt, entry.cancellationSignal]).catch((err) => {
      this._removeIfSame(loadEpoch, geometryIndex, entry);
      throw err;
    });
  }

  _convertToOversized(loadEpoch, geometryIndex, placeholder, marker) {
    const bucket = this._epochs.get(loadEpoch);
    if (bucket && bucket.get(geometryIndex) === placeholder) {
      // Stored verbatim as the canonical OversizedMarker shape -- no extra internal
      // tag -- so a cache-hit lookup can return this object directly (see
      // _awaitEntry) without stripping fields first.
      bucket.set(geometryIndex, {
        oversized: true,
        reason: marker.reason,
        activeTriangleCount: marker.activeTriangleCount,
      });
    }
    // else: placeholder already removed (e.g. released mid-classification) -- a
    // later lookup should start fresh, not resurrect a stale verdict; do nothing.
  }

  _removeIfSame(loadEpoch, geometryIndex, entry) {
    const bucket = this._epochs.get(loadEpoch);
    if (bucket && bucket.get(geometryIndex) === entry) {
      bucket.delete(geometryIndex);
      if (bucket.size === 0) this._epochs.delete(loadEpoch);
    }
  }

  async _awaitEntry(loadEpoch, geometryIndex, entry, needsConnectivity) {
    if (entry.oversized === true) {
      // Skip the pair immediately, without awaiting any phase (spec :1430-1432).
      return entry;
    }
    const weldResult = await entry.weldPromise;
    if (weldResult && weldResult.oversized === true) {
      return weldResult;
    }
    if (needsConnectivity && !entry.connectivityPromise) {
      // Lazy, on-demand connectivity against an entry that never needed it before --
      // possibly already 'ready', possibly still mid-BVH-build, in which case this
      // synchronously queues behind whatever phase is currently in flight (spec
      // :1443-1447; "at most one phase unresolved on an entry at a time", :1482-1484).
      this._chainConnectivity(loadEpoch, geometryIndex, entry, entry.accelerationPromise);
    }
    const accel = await entry.accelerationPromise;
    const connectivity = needsConnectivity ? await entry.connectivityPromise : null;
    // Spread the full resolved `accel` object (the real ThreeMeshBvhBackend.build()
    // resolves to { bvh, localDiagonal, aspectRatio, aspectRatioExceeded } -- Task 14
    // wires that in) rather than hand-picking named fields, so this stays
    // forward-compatible without a matching edit here. `accel` is spread FIRST so the
    // explicit `oversized`/`connectivity` written AFTER it below always win over
    // anything accidentally present on `accel` with the same name.
    return { ...accel, oversized: false, connectivity };
  }
}
