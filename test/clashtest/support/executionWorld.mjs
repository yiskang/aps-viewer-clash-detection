// test/clashtest/support/executionWorld.mjs
//
// P4 File structure row: `createExecutionWorld({defaultResult?})` composes P0's `createFakeWorld`
// (recording/scripting `findClashes`) with P1's `makeLeaseWorld` (`admitModel` / `isLeaseValid` /
// `evictModel` / `invalidateModelPlacement` / `dispose`), because no single shipped fake has both
// surfaces. Neither P0's `fakeWorld.mjs` nor P1's `leaseWorld.mjs` is edited (P0 extension rule 2,
// master §2.1 rule 5) -- this is a NEW file that only composes their exports.
//
// The composition passes P0's whole fake-world surface through VERBATIM -- `calls`, `script`,
// `hold`, `inFlight`, `maxInFlight`, `disposed`, `findClashes` -- and adds P1's lease methods; it
// never re-implements or narrows either. `hold()` in particular is load-bearing outside this phase
// (P7 Task P7.5's disposal signal-then-wait tests park an in-flight `findClashes` through
// `createExecutionWorld().hold()`), so it must keep working unmodified.
import { createFakeWorld } from './fakeWorld.mjs';
import { makeLeaseWorld } from './leaseWorld.mjs';

/**
 * @param {{defaultResult?: Function}} [options]  forwarded to P0's `createFakeWorld` verbatim.
 * @returns {object} P0's fake-world surface (`calls`, `script`, `hold`, `inFlight`, `maxInFlight`,
 *   `disposed`, `findClashes`) plus P1's lease surface (`admitModel`, `isLeaseValid`, `evictModel`,
 *   `invalidateModelPlacement`, `dispose`).
 */
export function createExecutionWorld(options) {
  const fake = createFakeWorld(options);
  const lease = makeLeaseWorld();

  const world = {};
  // Copy P0's own property descriptors (including its `inFlight` / `maxInFlight` / `disposed`
  // getters) verbatim, so reads keep observing the fake world's own live state rather than a
  // snapshot taken at composition time.
  Object.defineProperties(world, Object.getOwnPropertyDescriptors(fake));

  // Add P1's lease surface. These are plain functions closed over `leaseWorld`'s own state (never
  // over `this`), so assigning them directly is exactly as verbatim as copying `fake`'s.
  world.admitModel = lease.admitModel;
  world.isLeaseValid = lease.isLeaseValid;
  world.evictModel = lease.evictModel;
  world.invalidateModelPlacement = lease.invalidateModelPlacement;
  // `dispose` is the one method both fakes define; a composed world must dispose BOTH halves so
  // that neither `findClashes` nor the lease surface silently outlives the other.
  world.dispose = () => {
    fake.dispose();
    lease.dispose();
  };

  return world;
}
