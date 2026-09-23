// test/clashtest/support/index.mjs
//
// Barrel for the shared clashtest test doubles (master plan 2.1 rule 5: later phases ADD to this
// directory, they never fork it).
//
// EXTENSION RULES
//  1. Never change the signature or default behaviour of an exported name. Add options with
//     defaults that preserve the old behaviour.
//  2. A phase adds a NEW file `support/<area>.mjs` (e.g. `fakeWorld.placement.mjs`,
//     `fakeExecutor.mjs`, `fakeResultStore.mjs`) and appends its exports below; it does not edit
//     another phase's file.
//  3. Support files contain no `test(...)` calls and are not named `*.test.mjs`, so the runner
//     (scripts/run-tests.mjs) never treats them as tests. Their own tests live in support.test.mjs
//     (P0) or `<area>.support.test.mjs`.
//  4. No wall-clock time, no timers, no network: time comes from createFakeClock.
export * from './fakeClock.mjs';
export * from './fakeWorld.mjs';
export * from './fakeEnumerator.mjs';
export * from './fakeRegistry.mjs';
//
// LATER PHASES APPEND ONE LINE EACH, in phase order, as their task creates the file. P0 creates
// only the four above; the roster below is the *expected* final contents of this barrel and is
// recorded here (not implemented here) so no phase re-invents a double that already exists:
//   P1  export * from './leaseWorld.mjs';            // makeLeaseWorld — the only lease surface
//   P2  export * from './definitions.mjs';           // makeDefinition
//   P3  export * from './syntheticModels.mjs';       // synthetic models -> conforming enumerator
//   P3  export * from './bruteForcePairs.mjs';       // reference pair space (property suite)
//   P4  export * from './executionWorld.mjs';        // createExecutionWorld = fakeWorld + leaseWorld
//   P4  export * from './executionRequests.mjs';     // makeRequest / makeExecutorDeps
//   P4  export * from './realWorldFixture.mjs';      // makeTwoModelFixture / box
//   P5  export * from './resultSetFixtures.mjs';     // makeFakeRun / sealFakeRun / ledgerWith
//   P5  export * from './resultStoreConformance.mjs';// runResultStoreConformance
//   P6  export * from './scriptedExecutor.mjs';      // createScriptedExecutor
//   P6  export * from './placementRegistry.mjs';     // createPlacementRegistry
//   P6  export * from './sealedSetFixture.mjs';      // createSealedSetFixture
//   P7  export * from './realWorld.mjs';             // makeRealWorldFixture
//   P7  export * from './bruteForce.mjs';            // per-pair differential reference
//   P7  export * from './maximumShape.mjs';          // maximum-shape synthesizer
export * from './definitions.mjs';
export * from './syntheticModels.mjs';
export * from './executionWorld.mjs';
export * from './executionRequests.mjs';
export * from './resultSetFixtures.mjs';
export * from './fakePlanner.mjs';                    // P6.3: createFakePlan
export * from './runFixture.mjs';                     // P6.3: createRunFixture
