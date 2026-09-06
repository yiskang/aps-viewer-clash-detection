// collision/tlas/TlasCache.js
//
// Task 10 (M2 Batch 3): lazy build, revision-aware single-flight, release lifecycle for the
// per-epoch TLAS (top-level acceleration structure over an epoch's own placement records).
// Mirrors GeometryRegistry's own insert-first-then-build / cancellation-race pattern
// (collision/geometry/GeometryRegistry.js) with the one genuinely new mechanism a TLAS cache
// needs beyond that: revision-aware staleness during an in-flight build.
//
// Fixed after codex-review (Critical #1, resolved in the plan's own text before this task ever
// started): getEntry must NEVER retry internally with the CALLER's own (possibly stale)
// expectedRevision -- a superseded build returns {outcome: 'superseded'} and it is the CALLER's
// (Task 13's) job to re-derive the current expected revision fresh and call getEntry again. Doing
// this internally instead can regress a newer, already-published revision back to an older one,
// or resurrect a build for an epoch releaseEntryForEpoch/releaseAll already tore down.

import { CollisionInstanceBVH } from './CollisionInstanceBVH.js';

export class TlasCache {
  constructor({ buildPrimitives, checkpointPort }) {
    if (typeof buildPrimitives !== 'function') {
      throw new TypeError('TlasCache requires buildPrimitives(loadEpoch)');
    }
    this._buildPrimitives = buildPrimitives;
    this._checkpointPort = checkpointPort;
    // Map<loadEpoch, Entry>. Entry = { state: 'building'|'ready', builtAtRevision, bvh,
    // buildingForRevision, promise, released }. `released` is Critical #1's second half: set by
    // releaseEntryForEpoch/releaseAll on an entry that is still 'building' at release time, so its
    // eventual resolution can tell "I was torn down while in flight" apart from "I am simply no
    // longer the map's current entry because a newer build replaced me" -- both must discard, but
    // via the identity check in _startBuild (a released-then-immediately-deleted entry is already
    // caught by `current !== entry`, since release also deletes the map slot; `released` is read
    // there defensively rather than being the sole guard).
    this._entries = new Map();
  }

  async getEntry(loadEpoch, expectedRevision) {
    const existing = this._entries.get(loadEpoch);
    if (existing?.state === 'ready' && existing.builtAtRevision === expectedRevision) {
      return { bvh: existing.bvh, builtAtRevision: existing.builtAtRevision, outcome: 'hit' };
    }
    if (existing?.state === 'building' && existing.buildingForRevision === expectedRevision) {
      // Single-flight: share the in-flight build for the SAME revision this caller expects.
      const result = await existing.promise;
      return result.outcome === 'superseded' ? result : { ...result, outcome: 'shared-wait' };
    }
    // Either never built, stale (existing.builtAtRevision !== expectedRevision, from growth or
    // invalidation), or an in-flight build is for a DIFFERENT (already-superseded) revision --
    // start a fresh build for the revision THIS caller actually wants.
    return this._startBuild(loadEpoch, expectedRevision);
  }

  async _startBuild(loadEpoch, expectedRevision) {
    const entry = {
      state: 'building', buildingForRevision: expectedRevision, bvh: null, builtAtRevision: null, released: false,
    };
    // Insert into the map BEFORE calling the builder IIFE below (insert-first-then-build, mirrors
    // GeometryRegistry's own pattern) -- load-bearing ordering, not just a style choice: if
    // `this._checkpointPort.checkpoint(...)` throws SYNCHRONOUSLY (before any await), the ENTIRE
    // IIFE body -- including its own catch block's cleanup -- runs synchronously to completion as
    // part of evaluating the IIFE call below. Inserting the entry AFTER that call (as an earlier
    // version of this method did) would mean the catch block's `this._entries.get(loadEpoch) ===
    // entry` check runs before the entry was ever inserted, finds nothing to clean up, and then the
    // insert immediately afterward leaves the now-rejected entry stuck in the map anyway.
    this._entries.set(loadEpoch, entry);
    entry.promise = (async () => {
      try {
        const pending = this._checkpointPort.checkpoint({ loadEpoch });
        if (pending) await pending;
        const records = await this._buildPrimitives(loadEpoch);
        const bvh = new CollisionInstanceBVH(records);
        // Publish ONLY if this entry is STILL the one in the map (identity check -- a newer build
        // for a different revision, or a release, replaces/deletes the map slot without touching
        // this `entry` object) AND was never released while in flight. NEVER retry internally with
        // this build's own (now possibly-stale) `expectedRevision` -- return a `superseded` outcome
        // and let the CALLER (Task 13) re-derive the current expected revision fresh.
        const current = this._entries.get(loadEpoch);
        if (current === entry && !entry.released) {
          entry.state = 'ready';
          entry.bvh = bvh;
          entry.builtAtRevision = expectedRevision;
          return { bvh, builtAtRevision: expectedRevision, outcome: 'built' };
        }
        return { outcome: 'superseded' };
      } catch (err) {
        // Batch 3 whole-batch review, Important finding #1: without this, a build that REJECTS
        // (the checkpoint port throwing for a disposed world or a dead epoch -- the real,
        // production checkpointPort does exactly this; or buildPrimitives/CollisionInstanceBVH
        // itself failing) leaves a permanently-'building', permanently-rejecting entry behind that
        // nothing ever removes -- for a dead epoch, _releaseEpochScopedState has already run once
        // and will never run again for it. Mirrors GeometryRegistry's own "remove on rejection if
        // still current" discipline. Remove ONLY if this entry is still the map's current one for
        // this epoch -- a newer build already replacing it must not be clobbered by an older one's
        // failure cleanup.
        if (this._entries.get(loadEpoch) === entry) this._entries.delete(loadEpoch);
        throw err;
      }
    })();
    return entry.promise;
  }

  // Read-only accessor for Task 13's own refresh-trigger condition -- returns undefined for a
  // never-built or in-flight (not yet 'ready') epoch, which Task 13 treats as builtAtRevision = -1
  // (always stale relative to any real invalidation marker, closing codex-review's Critical #2).
  getBuiltAtRevision(loadEpoch) {
    const entry = this._entries.get(loadEpoch);
    return entry?.state === 'ready' ? entry.builtAtRevision : undefined;
  }

  releaseEntryForEpoch(loadEpoch) {
    const entry = this._entries.get(loadEpoch);
    if (entry && entry.state === 'building') entry.released = true; // in-flight build must discard on resolution
    this._entries.delete(loadEpoch);
  }

  releaseAll() {
    for (const entry of this._entries.values()) {
      if (entry.state === 'building') entry.released = true;
    }
    this._entries.clear();
  }
}
