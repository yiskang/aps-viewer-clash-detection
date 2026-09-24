// test/clashtest/engine/exports.test.mjs
//
// Task P7.10: the public entry point `clashtest/index.js` (spec §18). A pure re-export barrel: the
// §18 names are present and are the OWNING modules' own bindings, every error class is exported by
// identity, and everything internal or deferred is ABSENT (not stubbed).
//
// Two checks are deliberately not the brief's excerpt (preflight scan rows P7.10, controller rulings):
//   - the "no side effect" check runs in a CHILD process. Re-importing `index.js?fresh=1` in this
//     process re-evaluates only the barrel; its dependencies are cached, so a side effect in any of
//     them would be invisible. The child imports the barrel once, cold, and diffs the global object.
//   - the deferred surfaces are pinned on BOTH the barrel and the engine object (`compareResultSets`
//     is asserted here, scan row "P7.6 <-> P7.8 Step 16").
//
// OPEN-3 (controller ruling): the core engine ships WITHOUT `derivations` and WITHOUT `annotate`. The
// absence assertions below are CORE-SCOPED, not permanent: Task P8.8 legitimately edits this file when
// it adds `derivations` / `createDerivationContext`, and the annotation follow-up does the same for
// `annotate`. Nothing else in this file may be relaxed by a later phase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as api from '../../../clashtest/index.js';
import * as errors from '../../../clashtest/errors.js';
import * as engineModule from '../../../clashtest/engine.js';
import { RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { validateTest } from '../../../clashtest/definition/validate.js';
import { assessNoClashClaim, canClaimNoClashes } from '../../../clashtest/results/claim.js';
import { getPairStatus, getElementStatus } from '../../../clashtest/results/status.js';
import { getFreshness } from '../../../clashtest/run/freshness.js';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createLocalUnitExecutor } from '../../../clashtest/execution/LocalUnitExecutor.js';
import { createModelRegistry } from '../../../clashtest/identity/ModelRegistry.js';
import { createExecutionWorld } from '../support/executionWorld.mjs';
import { createFakeEnumerator } from '../support/fakeEnumerator.mjs';

const INDEX_URL = new URL('../../../clashtest/index.js', import.meta.url);
const base = () => ({ world: createExecutionWorld(), enumerator: createFakeEnumerator() });

/** Each §18 function with the OWNING module's own binding (a re-export of the wrong module's twin would differ). */
const OWNED_FUNCTIONS = {
  createClashTestEngine: engineModule.createClashTestEngine,
  validateTest,
  assessNoClashClaim,
  canClaimNoClashes,
  getPairStatus,
  getElementStatus,
  getFreshness,
  createInMemoryClashTestStore,
  createInMemoryResultStore,
  createLocalUnitExecutor,
  createModelRegistry,
};

/**
 * Internal names of `clashtest/engine.js` (named exports and the constructor-config seams) that the
 * barrel must NOT publish: a careless `export * from './engine.js'` would publish the first group
 * silently. Asserted by name because a presence/absence check is not a closed-set comparison.
 */
const MUST_NOT_BE_PUBLIC = [
  'createStoredDefinitionResolver', 'withStoredDefinitionValidator',      // P7.4 Step 3a obligations 3 and 4
  'createEngineCore', 'ENGINE_METHODS',                                    // named exports of engine.js
  'admitAndBegin', 'buildRunSpec', 'readSetById', 'withReadSet',           // core internals (R-P7-11)
  'scheduleTimeout', 'yieldToScheduler',                                   // host/test config seams (R-P7-6), not exports
];

/** Deferred surfaces: ABSENT, not stubbed (P8 / the annotation follow-up own them). */
const DEFERRED = ['annotate', 'derivations', 'createDerivationContext', 'compareResultSets'];

test('every §18 function is present and is the owning module\'s own binding', () => {
  for (const [name, owned] of Object.entries(OWNED_FUNCTIONS)) {
    assert.equal(typeof api[name], 'function', name);
    assert.equal(api[name], owned, `${name} must be the owning module's binding`);
  }
  assert.equal(api.RUN_OPTION_DEFAULTS, RUN_OPTION_DEFAULTS);
  assert.equal(api.ENGINE_LIMIT_DEFAULTS, ENGINE_LIMIT_DEFAULTS);
  assert.ok(api.RUN_OPTION_DEFAULTS && api.ENGINE_LIMIT_DEFAULTS);
});

test('the deferred surfaces are absent from the barrel, not stubbed', () => {
  for (const name of DEFERRED) {
    assert.equal(api[name], undefined, `${name} must not be exported`);
    assert.equal(name in api, false, `${name} must not be a key of the module namespace`);
  }
});

test('the internal engine seams are absent from the barrel (asserted by name)', () => {
  for (const name of MUST_NOT_BE_PUBLIC) {
    assert.equal(api[name], undefined, `${name} must stay internal`);
    assert.equal(name in api, false, `${name} must not be a key of the module namespace`);
  }
});

test('no named export of clashtest/engine.js other than createClashTestEngine reaches the barrel', () => {
  // Dynamic, so an internal seam added to engine.js later is covered without editing the name list above.
  const internal = Object.keys(engineModule).filter((name) => name !== 'createClashTestEngine');
  assert.ok(internal.length > 0, 'engine.js has internal named exports to keep out');
  for (const name of internal) assert.equal(name in api, false, `${name} leaked into the barrel`);
  // ...and the seams the list above names are, in fact, real exports of engine.js (the list is not stale).
  for (const name of ['createStoredDefinitionResolver', 'withStoredDefinitionValidator', 'createEngineCore', 'ENGINE_METHODS']) {
    assert.equal(typeof engineModule[name], name === 'ENGINE_METHODS' ? 'object' : 'function', name);
  }
});

test('every error class of §18 that the core raises is exported from the entry point, by identity', () => {
  let seen = 0;
  for (const [name, ctor] of Object.entries(errors)) {
    if (typeof ctor === 'function' && name.endsWith('Error')) {
      assert.equal(api[name], ctor, name);
      seen += 1;
    }
  }
  assert.ok(seen > 30, 'the loop actually visited the error catalogue');
  assert.equal(api.ClashTestError, errors.ClashTestError, 'the base class is exported too');
});

test('the core engine object has no annotate, no derivations and no compareResultSets', () => {
  const engine = api.createClashTestEngine(base());
  for (const name of ['annotate', 'derivations', 'compareResultSets']) {
    assert.equal(engine[name], undefined, name);
    assert.equal(name in engine, false, `${name} in engine`);
    assert.equal(Object.hasOwn(engine, name), false, `${name} own property`);
  }
});

test('the barrel is a pure re-export: one `export {...} from` per module, no star export, no globalThis', () => {
  const source = readFileSync(fileURLToPath(INDEX_URL), 'utf8');
  const code = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  assert.doesNotMatch(code, /export\s*\*/, 'no `export *` (it would publish engine.js internals)');
  assert.doesNotMatch(code, /globalThis/, 'the barrel never reads a global');
  assert.doesNotMatch(code, /^\s*import\b/m, 'a pure re-export module imports nothing');
  const froms = [...code.matchAll(/export\s*\{[^}]*\}\s*from\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(froms.length > 0);
  assert.equal(new Set(froms).size, froms.length, 'exactly one `export {...} from` per owning module');
  const statements = code.split(';').map((s) => s.trim()).filter(Boolean);
  assert.equal(statements.length, froms.length, 'every statement is such a re-export');
});

test('importing the entry point runs no side effect (cold import in a child process)', () => {
  const script = `
    const before = Reflect.ownKeys(globalThis);
    await import(${JSON.stringify(INDEX_URL.href)});
    const added = Reflect.ownKeys(globalThis).filter((k) => !before.includes(k)).map(String);
    console.log(JSON.stringify({ added, coordinators: Symbol.for('clashtest.coordinators') in globalThis }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { added: [], coordinators: false });
});
