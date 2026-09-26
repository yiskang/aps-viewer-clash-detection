// test/clashpanel/support/index.mjs
// Barrel for the Panel test doubles (Task 3). EXTENSION RULES (mirrors test/clashtest/support/index.mjs):
//  1. Never change the signature or default behaviour of an exported name; add options with defaults that preserve it.
//  2. A later task adds a NEW file and appends one export line; it does not edit another task's file. (Tasks 22-26 extend
//     the viewer fakes only if strictly needed, and say so.)
//  3. Support files contain no `test(...)` calls and are not named `*.test.mjs`. No wall-clock time, no real timers.
export * from './fakeScheduler.mjs';
export * from './fakeCatalog.mjs';
export * from './fakeEngine.mjs';
export * from './fakeBridge.mjs';
export * from './fakeThree.mjs';
export * from './fakeViewer.mjs';
export * from './resultFixtures.mjs';
