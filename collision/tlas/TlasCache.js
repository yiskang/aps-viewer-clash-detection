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
//
// Batch 3 whole-batch review, Important finding #2 (fixed at the Batch 3 boundary, before Task 13
// becomes this module's first production consumer): earlier versions detected supersession/
// eviction/disposal ONLY after an in-flight build's own promise settled on its own -- there was no
// active cancellation SIGNAL racing the build the way GeometryRegistry's `cancellationSignal`/
// `rejectSignal` races every phase (`_runPhase`, GeometryRegistry.js:202-230). Consequence: a slow
// or never-resolving build for an epoch that has since been superseded/evicted/disposed left every
// caller sharing that build (via single-flight) blocked until the build eventually settled on its
// own, wasting the work and the wait. Fixed by giving every 'building' entry its own cancellation
// signal, exactly mirroring GeometryRegistry's `makeCancellationSignal` shape, raced via
// `Promise.race` against the actual build attempt -- but with ONE deliberate divergence from
// GeometryRegistry's own contract, preserved from this module's pre-existing (and already tested)
// behavior: GeometryRegistry's cancellation REJECTS the phase with the real ModelEvictedError/
// WorldDisposedError; TlasCache's own already-landed contract is that a superseded/cancelled build
// must resolve peacefully to {outcome: 'superseded'} -- never reject -- so Task 13 needs no new
// error-handling path beyond the one it already has for a stale expectedRevision. Only a build
// superseded by supersession/eviction/disposal takes this path; checkpointPort.checkpoint()
// throwing on its OWN (the epoch was already dead/disposed before anyone explicitly released this
// entry) is a genuinely different case and still rejects, unchanged -- see the dedicated
// `CANCELLED` sentinel below and the "Important #1" tests this preserves.
//
// The post-completion `current === entry && !entry.released` identity check in _startBuild's
// success path is kept as defense in depth, not replaced: a same-tick synchronous build can in
// principle still win a Promise.race against an already-rejected cancellationSignal (both settled
// before .then handlers are queued, and `attempt` is first in the race's array), so the identity
// check remains the authoritative guard against ever publishing a torn-down/superseded epoch's
// result -- the cancellation signal's job is purely to make cancellation FAST, not to be the sole
// correctness mechanism.

import { CollisionInstanceBVH } from './CollisionInstanceBVH.js';

// Internal-only sentinel distinguishing "this build was cancelled via supersession/eviction/
// disposal" from any other rejection (a genuine checkpoint liveness failure, or buildPrimitives/
// BVH construction itself throwing) -- NEVER exposed outside this module; every catch site that
// sees it converts it to {outcome: 'superseded'} rather than rethrowing.
const CANCELLED = Symbol('tlas-build-cancelled');

// Mirrors GeometryRegistry's own makeCancellationSignal (GeometryRegistry.js:15-23) exactly,
// including the defensive .catch(() => {}) for the case a signal is created but the build settles
// (or is itself cancelled a second time) before Promise.race ever attaches its own handler.
function makeCancellationSignal() {
  let rejectSignal;
  const signal = new Promise((_resolve, reject) => {
    rejectSignal = reject;
  });
  signal.catch(() => {});
  return { signal, rejectSignal };
}

export class TlasCache {
  constructor({ buildPrimitives, checkpointPort }) {
    if (typeof buildPrimitives !== 'function') {
      throw new TypeError('TlasCache requires buildPrimitives(loadEpoch)');
    }
    this._buildPrimitives = buildPrimitives;
    this._checkpointPort = checkpointPort;
    // Map<loadEpoch, Entry>. Entry = { state: 'building'|'ready', builtAtRevision, bvh,
    // buildingForRevision, promise, released, cancellationSignal, rejectSignal }. `released` is
    // Critical #1's second half: set by releaseEntryForEpoch/releaseAll on an entry that is still
    // 'building' at release time, so its eventual resolution can tell "I was torn down while in
    // flight" apart from "I am simply no longer the map's current entry because a newer build
    // replaced me" -- both must discard, but via the identity check in _startBuild (a
    // released-then-immediately-deleted entry is already caught by `current !== entry`, since
    // release also deletes the map slot; `released` is read there defensively rather than being the
    // sole guard). `cancellationSignal`/`rejectSignal` (Important finding #2) are the ACTIVE half of
    // cancellation -- raced via Promise.race against the real build so a superseded/evicted/
    // disposed in-flight build settles to {outcome:'superseded'} immediately rather than only after
    // its own (possibly slow or never-resolving) work finishes on its own.
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
    // Codex-review finding #1 (Batch 3 boundary fix, post-review pass): a caller asking for a
    // revision OLDER than whatever is already ready or in flight for this epoch must never regress
    // the cache -- neither by replacing a ready entry with a stale rebuild, nor (now that
    // supersession actively cancels, finding #2's original fix) by cancelling an in-flight NEWER
    // build. Revisions only ever grow (CollisionWorld._placementRevisionByEpoch is monotonic, only
    // ever incremented); a caller requesting a lower revision than what's already current is
    // necessarily a delayed/stale caller racing one that already won, and has nothing legitimate to
    // build -- it is itself the superseded party, not the other way around.
    const currentRevision = existing?.state === 'ready' ? existing.builtAtRevision : existing?.buildingForRevision;
    if (currentRevision !== undefined && currentRevision > expectedRevision) {
      return { outcome: 'superseded' };
    }
    // Either never built, stale (existing.builtAtRevision !== expectedRevision, from growth or
    // invalidation), or an in-flight build is for a DIFFERENT (already-superseded) revision --
    // start a fresh build for the revision THIS caller actually wants.
    return this._startBuild(loadEpoch, expectedRevision);
  }

  async _startBuild(loadEpoch, expectedRevision) {
    // Important finding #2: a newer build request for THIS epoch supersedes whatever is currently
    // 'building' for it -- cancel that old entry actively rather than letting it run to completion
    // unwatched. Mirrors _entries.set below immediately replacing the map slot (the pre-existing
    // supersession mechanism); this just ALSO wakes up anyone still awaiting the old entry's promise
    // (single-flight sharers included) instead of leaving them blocked on a build whose result will
    // never be used.
    //
    // Defense in depth for codex-review finding #1: `getEntry`'s own monotonicity guard above
    // should already prevent this method from ever being reached with a stale `expectedRevision`,
    // but the `expectedRevision > superseded.buildingForRevision` check is repeated here, directly
    // at the point of the irreversible action (cancelling another entry), rather than trusting one
    // call site far away to always get it right. If this invariant were ever violated, the fallback
    // is the OLD (pre-active-cancellation) behavior -- the stale caller's build still replaces the
    // map slot below, but the genuinely-newer in-flight build is left uncancelled to settle on its
    // own, where its own identity check (`current === entry`) already guarantees it is discarded
    // rather than wrongly published -- never actively cancelling a build that is not stale.
    const superseded = this._entries.get(loadEpoch);
    if (superseded && superseded.state === 'building' && expectedRevision > superseded.buildingForRevision) {
      superseded.released = true;
      superseded.rejectSignal(CANCELLED);
    }

    const { signal, rejectSignal } = makeCancellationSignal();
    // Codex-review (third pass, request 20260906-221118-19299-12386): `entry.promise` must be a
    // real, already-settleable promise from the instant the entry becomes visible via `_entries`,
    // not merely "whatever the IIFE below eventually evaluates to". The IIFE's own call expression
    // doesn't finish evaluating (and so doesn't produce a value to assign) until it either hits its
    // first `await` or throws-and-rethrows synchronously -- and `checkpointPort.checkpoint()` /
    // `buildPrimitives()` both run SYNCHRONOUSLY inside that same call, before either happens. A
    // synchronously re-entrant callback (an injected `buildPrimitives` or `checkpointPort` that
    // calls back into `getEntry()` for this SAME loadEpoch+revision while still inside that
    // synchronous window) would otherwise see this entry's `promise` field as `undefined` and crash
    // on `undefined.outcome` in the single-flight branch above -- reproduced by codex-review. A
    // deferred promise, constructed and assigned BEFORE `_entries.set` runs, closes this window
    // entirely.
    let settleEntryPromise, failEntryPromise;
    const deferred = new Promise((resolve, reject) => { settleEntryPromise = resolve; failEntryPromise = reject; });
    const entry = {
      state: 'building', buildingForRevision: expectedRevision, bvh: null, builtAtRevision: null,
      released: false, cancellationSignal: signal, rejectSignal, promise: deferred,
    };
    // Insert into the map BEFORE starting the build IIFE below (insert-first-then-build, mirrors
    // GeometryRegistry's own pattern) -- load-bearing ordering, not just a style choice: if
    // `this._checkpointPort.checkpoint(...)` throws SYNCHRONOUSLY (before any await), the ENTIRE
    // IIFE body below -- including its own catch block's cleanup -- runs synchronously to
    // completion as part of STARTING the IIFE. Inserting the entry AFTER that call (as an earlier
    // version of this method did) would mean the catch block's `this._entries.get(loadEpoch) ===
    // entry` check runs before the entry was ever inserted, finds nothing to clean up, and then the
    // insert immediately afterward leaves the now-rejected entry stuck in the map anyway. This
    // ordering requirement is UNCHANGED by the deferred-promise fix above -- `entry.promise` being
    // pre-assigned doesn't move when `_entries.set` itself must run relative to the IIFE starting.
    this._entries.set(loadEpoch, entry);
    (async () => {
      try {
        // Codex-review finding #2: `Promise.race` below only stops WAITING for `attempt` on
        // cancellation -- it does not itself interrupt `attempt`'s own execution (no JS primitive
        // does, short of a cooperative AbortSignal `buildPrimitives` doesn't take; GeometryRegistry
        // has this exact same characteristic for its own builders, so this is parity, not a new
        // gap). What IS actionable without new machinery: check for cancellation immediately after
        // every await, before paying for the next (potentially expensive) step -- in particular
        // before constructing the BVH, which is the one step actually worth skipping.
        const bailIfCancelled = () => {
          if (entry.released || this._entries.get(loadEpoch) !== entry) throw CANCELLED;
        };
        const attempt = (async () => {
          const pending = this._checkpointPort.checkpoint({ loadEpoch });
          if (pending) { await pending; bailIfCancelled(); }
          const records = await this._buildPrimitives(loadEpoch);
          bailIfCancelled();
          return new CollisionInstanceBVH(records);
        })();
        // Important finding #2: race the real build against this entry's own cancellation signal
        // so a supersession/eviction/disposal that arrives while the build is still in flight
        // settles this promise IMMEDIATELY (superseded), instead of every awaiter -- including
        // single-flight sharers -- blocking until the (possibly slow, possibly never-resolving)
        // build finishes on its own. `entry.cancellationSignal` only ever REJECTS (with the
        // internal-only CANCELLED sentinel below), never resolves, so Promise.race resolves via
        // `attempt` on any genuine success.
        const bvh = await Promise.race([attempt, entry.cancellationSignal]);
        // Publish ONLY if this entry is STILL the one in the map (identity check -- a newer build
        // for a different revision, or a release, replaces/deletes the map slot without touching
        // this `entry` object) AND was never released while in flight. This defense-in-depth check
        // is kept even with the active signal above: a fully synchronous build can in principle
        // still win a same-tick race against an already-rejected signal (Promise.race favors
        // whichever promise settles first among those already settled when it is called, and
        // `attempt` is listed first), so this remains the sole AUTHORITATIVE publish guard. NEVER
        // retry internally with this build's own (now possibly-stale) `expectedRevision` -- return
        // a `superseded` outcome and let the CALLER (Task 13) re-derive the current expected
        // revision fresh.
        const current = this._entries.get(loadEpoch);
        if (current === entry && !entry.released) {
          entry.state = 'ready';
          entry.bvh = bvh;
          entry.builtAtRevision = expectedRevision;
          settleEntryPromise({ bvh, builtAtRevision: expectedRevision, outcome: 'built' });
          return;
        }
        settleEntryPromise({ outcome: 'superseded' });
      } catch (err) {
        // Remove ONLY if this entry is still the map's current one for this epoch -- a newer build
        // already replacing it must not be clobbered by an older one's failure/cancellation
        // cleanup (Important finding #1's own identity-guarded discipline, extended here to the
        // cancellation path too).
        if (this._entries.get(loadEpoch) === entry) this._entries.delete(loadEpoch);
        // The CANCELLED sentinel means this build was cancelled via supersession/eviction/disposal
        // (this method's own top, or releaseEntryForEpoch/releaseAll below) -- resolve peacefully
        // to the same {outcome:'superseded'} contract every other supersession path already uses,
        // never reject for this cause; Task 13 needs exactly one non-hit/non-built outcome to
        // handle, not two.
        //
        // Batch 3 whole-batch review, Important finding #1: any OTHER rejection -- the checkpoint
        // port throwing for a disposed world or a dead epoch that was never explicitly released
        // through this cache (the real, production checkpointPort does exactly this), or
        // buildPrimitives/CollisionInstanceBVH itself failing -- still rethrows here, unchanged:
        // without the identity-guarded delete above, a rejecting build would otherwise leave a
        // permanently-'building', permanently-rejecting entry behind that nothing ever removes --
        // for a dead epoch, _releaseEpochScopedState has already run once and will never run again
        // for it. Mirrors GeometryRegistry's own "remove on rejection if still current" discipline.
        if (err === CANCELLED) { settleEntryPromise({ outcome: 'superseded' }); return; }
        failEntryPromise(err);
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
    if (entry && entry.state === 'building') {
      entry.released = true; // defense-in-depth guard, kept alongside the active signal below
      // Important finding #2: wake the in-flight build's own Promise.race immediately, rather than
      // relying solely on the post-completion identity check to discover the discard once the build
      // eventually settles on its own.
      entry.rejectSignal(CANCELLED);
    }
    this._entries.delete(loadEpoch);
  }

  releaseAll() {
    for (const entry of this._entries.values()) {
      if (entry.state === 'building') {
        entry.released = true;
        entry.rejectSignal(CANCELLED); // Important finding #2 -- same active-cancellation fix as releaseEntryForEpoch
      }
    }
    this._entries.clear();
  }
}
