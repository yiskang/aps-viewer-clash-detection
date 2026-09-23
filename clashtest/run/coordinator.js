// clashtest/run/coordinator.js
//
// Spec §7.3 / §4.3 — ONE coordinator per CollisionWorld, discovered through a globalThis symbol so
// duplicate bundles or module copies in one page join the same coordinator. The coordinator owns the
// world's sole ModelRegistry, its FIFO run queue and its single in-flight slot.

import { ModelBindingError, EngineDisposedError } from '../errors.js';
import { createModelRegistry } from '../identity/ModelRegistry.js';   // A5 (N11)

export const COORDINATOR_PROTOCOL_VERSION = 1;
export const COORDINATOR_SLOT = Symbol.for('clashtest.coordinators');

function coordinatorMap() {
  let map = globalThis[COORDINATOR_SLOT];
  if (map instanceof WeakMap) return map;
  map = new WeakMap();
  Object.defineProperty(globalThis, COORDINATOR_SLOT, {
    value: map, writable: false, enumerable: false, configurable: false,
  });
  return map;
}

function createCoordinator(world, { protocolVersion, registry }) {
  /** @type {Array<{runId, engineId, run, ticket, started, resolveFinish, rejectFinish}>} */
  const queue = [];
  const stopped = new Set();
  let inFlight = null;                                    // the single in-flight slot

  // Claims the single in-flight slot for `job`, synchronously, then invokes `job.run()` — also
  // synchronously, right here, exactly as calling any async function runs its body up to its own
  // first `await` before yielding. This keeps "started resolved" and "run() actually invoked" in
  // the same synchronous step (no extra microtask hop between them), which is what lets a caller
  // observe a job's own synchronous side effects immediately after its `started` promise settles.
  function startInFlight(job) {
    job.started = true;
    inFlight = job;
    job.resolveStart();
    runJob(job);                                          // fire-and-forget: settlement drives itself
  }

  // Once `job` settles (however it settles), the slot is freed and — in the SAME microtask, no
  // extra hop — the next queued job (if any) is promoted. A failing job never wedges the queue.
  async function runJob(job) {
    try {
      const value = await job.run();
      job.resolveFinish(value);
    } catch (err) {
      job.rejectFinish(err);
    } finally {
      inFlight = null;
      if (queue.length > 0) startInFlight(queue.shift());
    }
  }

  return Object.freeze({
    world,
    protocolVersion,
    registry,
    // Synchronous and limit-free (R6): `maxQueuedRuns` belongs to ONE engine, and P7's admission
    // prefix has already checked it (and rolled back its residency reservation if it failed)
    // before this is reached.
    enqueue({ runId, engineId, run }) {
      if (stopped.has(engineId)) {
        throw new EngineDisposedError({                   // A3/N1: one object argument
          message: `engine ${engineId} is disposing; no further runs are admitted`,
        });
      }
      let resolveStart; let resolveFinish; let rejectFinish;
      const started = new Promise((r) => { resolveStart = r; });
      const finished = new Promise((res, rej) => { resolveFinish = res; rejectFinish = rej; });
      const job = { runId, engineId, run, started: false, resolveStart, resolveFinish, rejectFinish };
      const ticket = Object.freeze({
        runId,
        started,
        finished,
        withdraw() {
          if (job.started) return false;
          const i = queue.indexOf(job);
          if (i < 0) return false;
          queue.splice(i, 1);
          job.resolveFinish(undefined);
          return true;
        },
      });
      job.ticket = ticket;
      // The single-in-flight slot is claimed SYNCHRONOUSLY, right here, when it is free — not on a
      // later microtask — so that `queueDepth` (WAITING runs only) is accurate for any caller that
      // enqueues several jobs back-to-back with no `await` between them (R6).
      if (inFlight === null) {
        startInFlight(job);
      } else {
        queue.push(job);
      }
      return ticket;
    },
    // Returns TRUE iff this call is the one that withdrew the job. The run's own cancel path
    // branches on that boolean (R5): the winner owes the queued run a pre-resolution cancelled
    // seal, because a withdrawn job's `run` function is never invoked.
    cancelQueued(runId) {
      const job = queue.find((j) => j.runId === runId);
      return job === undefined ? false : job.ticket.withdraw();
    },
    stopAdmitting(engineId) { stopped.add(engineId); },
    // Depth is runs WAITING; the in-flight job has already left the array (R6).
    queueDepth(engineId) {
      return engineId === undefined ? queue.length : queue.filter((j) => j.engineId === engineId).length;
    },
    inFlightRunId() { return inFlight === null ? null : inFlight.runId; },
  });
}

/**
 * Join (or create) the coordinator for `world`. A coordinator built by an incompatible engine copy
 * is refused rather than run beside (§7.3).
 */
export function getWorldCoordinator(world, {
  protocolVersion = COORDINATOR_PROTOCOL_VERSION,
  createRegistry = createModelRegistry,                   // A5: P1's factory is the default
} = {}) {
  const map = coordinatorMap();
  let coordinator = map.get(world);
  if (coordinator === undefined) {
    if (typeof createRegistry !== 'function') {
      throw new ModelBindingError({                       // A3/N1: ONE object argument, `.reason`
        reason: 'registry-factory-required', modelKey: null,
        message: 'createRegistry is required to build a coordinator',
      });
    }
    // A5: `world` is REQUIRED and there is no `now` option. One registry per world (§4.3).
    coordinator = createCoordinator(world, { protocolVersion, registry: createRegistry({ world }) });
    map.set(world, coordinator);
  }
  if (coordinator.protocolVersion !== protocolVersion) {
    throw new ModelBindingError({
      reason: 'coordinator-version-mismatch', modelKey: null,
      message: `this world already has a clashtest coordinator at protocol ${coordinator.protocolVersion}`,
    });
  }
  return coordinator;
}
