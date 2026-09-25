// test/clashtest/results/validateResultSet.capture.test.mjs
//
// Task P5.4: capture-first, schema version and structural validation. Scope note (controller
// ruling, file-ownership split): this file exercises ONLY `captureResultSet`, `applyMigration` and
// `nodeCeilingError` — it never calls `validateResultSet` (Task P5.5's addition to
// `validateResultSet.js`), and never imports anything from `resultSetSchema.js` beyond the two
// pieces P5.4's own code calls (`isOpenPath`, `UNKNOWN_FIELD_BYTES`) plus `MAX_UNIT_TAINTS` (the
// taints[] ceiling ruling). See `.superpowers/sdd/p5-result-set/task-P5.4-report.md` for the note on
// what was moved out to Task P5.5's test file instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureResultSet, applyMigration, nodeCeilingError, SCHEMA_VERSION } from '../../../clashtest/results/validateResultSet.js';
import { isOpenPath, UNKNOWN_FIELD_BYTES, MAX_UNIT_TAINTS } from '../../../clashtest/results/resultSetSchema.js';
import { captureData } from '../../../clashtest/util/capture.js';       // the P5<->P0 seam, directly
import { CorruptResultSetError, ResultSetTooLargeError, UnsupportedSchemaVersionError } from '../../../clashtest/errors.js';
import { ENGINE_LIMIT_DEFAULTS, RUN_OPTION_CEILINGS, SCHEMA_MAX_NODES } from '../../../clashtest/options.js';
import { sealedSet } from '../support/resultSetFixtures.mjs';

const limits = ENGINE_LIMIT_DEFAULTS;
const corruptWith = (code) => (e) => e instanceof CorruptResultSetError && e.issues.some((i) => i.code === code);

// A real `sealedSet()` intentionally shares object references (`evaluatedAs.source === pair.first`,
// spec §11.4/13.4 — verified in `clashtest/results/resultSet.js`'s `projectUnitPairs`/`reconcile`,
// which even names the check `sameRef`). `structuredClone` PRESERVES that sharing, which P0's own
// `captureData` treats as `cyclic` by deliberate, tested design (`test/clashtest/util/capture....
// test.mjs`: "a revisited object (cycle or shared reference) is cyclic") — correct, because the
// real untrusted-read boundary this module guards is a Result Set that has been through a
// `ResultStore`'s JSON persistence, where reference identity never survives a round trip in the
// first place. `JSON.parse(JSON.stringify(...))`, not `structuredClone`, is therefore the faithful
// way to turn a real, in-memory sealed set into "the kind of raw object `captureResultSet` actually
// receives in production" for these tests.
async function rawSet(kind) {
  return JSON.parse(JSON.stringify(await sealedSet(kind)));
}

test('capture detaches: mutating the source afterwards cannot change the capture', async () => {
  const raw = await rawSet();
  const originalCoverage = raw.outcome.coverage;
  const originalResultsLength = raw.results.length;
  const captured = captureResultSet(raw, { limits });
  raw.outcome.coverage = raw.outcome.coverage === 'full' ? 'partial' : 'full';
  raw.results.push({ resultId: 'forged' });
  assert.equal(captured.outcome.coverage, originalCoverage);
  assert.equal(captured.results.length, originalResultsLength);
});

test('schemaVersion is read first and an unsupported value throws before anything else is read', async () => {
  const raw = await rawSet();
  const read = [];
  // codex-review testing gap (2026-09-22): descriptor-based capture never uses `[[Get]]` for a
  // container property, so a `get` trap alone cannot prove "no other property was TRAVERSED" —
  // only a `getOwnPropertyDescriptor` trap does, since that is what `captureData` (and this
  // module's own `checkSchemaVersionFirst` pre-check) actually calls per key.
  const descs = [];
  const spied = new Proxy({ ...raw, schemaVersion: SCHEMA_VERSION + 1 },
    { get(t, k) { read.push(k); return t[k]; },
      getOwnPropertyDescriptor(t, k) { descs.push(k); return Reflect.getOwnPropertyDescriptor(t, k); },
      ownKeys(t) { read.push('#ownKeys'); return Reflect.ownKeys(t); } });
  assert.throws(() => captureResultSet(spied, { limits }),
    (e) => e instanceof UnsupportedSchemaVersionError && e.schemaVersion === SCHEMA_VERSION + 1
        && e.supported === SCHEMA_VERSION && e.type === 'ResultSet');
  assert.equal(read.includes('results'), false, 'no other property was reached');
  // The pre-check fast path means the ONLY descriptor ever read is `schemaVersion` itself — no
  // `ownKeys`, no other key's descriptor, and (per the `get` assertion above) no VALUE read at all.
  assert.deepEqual(descs, ['schemaVersion']);
});

// codex-review finding (2026-09-22, fixed): an ABSENT or object-valued `schemaVersion` used to pass
// P0's rootGate silently (it only intercepts a primitive value), so the reader would traverse and
// copy an arbitrary amount of otherwise-legal sibling data before an eventual (correct) rejection —
// a real, if bounded (never past `maxCapturedNodes`), wasted-work cost on untrusted input. Proven
// directly on `captureData`'s own `nodes` counter, which is the only way to observe "was the rest
// of the set touched" from outside.
test('an absent or object-valued schemaVersion is rejected before the rest of the set is traversed', async () => {
  for (const bad of [undefined, {}]) {
    const raw = await rawSet();
    if (bad === undefined) delete raw.schemaVersion; else raw.schemaVersion = bad;
    raw.ledger.filler = Array.from({ length: 500 }, (_, i) => ({ i }));   // cheap, legal, would-be-copied filler
    const r = captureData(raw, {
      maxNodes: limits.maxCapturedNodes, maxDepth: 64, maxIssues: 20,
      openFieldBudget: { isOpenPath, maxBytes: limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES },
      rootGate: { key: 'schemaVersion', check: (v) => v === SCHEMA_VERSION },
    });
    // P0's own rootGate never fires for a non-primitive/absent value (its check is
    // `value === null || typeof value !== 'object'`) — this is exactly the gap the pre-check closes
    // one level up, in `captureResultSet` itself, not inside `captureData`.
    assert.equal(r.gate, undefined, String(bad));
    assert.throws(() => captureResultSet(raw, { limits }), corruptWith('invalid-schema-version'), String(bad));
  }
  // The fix: `captureResultSet`'s own pre-check rejects BEFORE `captureData` ever runs, so the
  // filler is never traversed at all — asserted the same way the review's own probe would.
  const raw = await rawSet();
  delete raw.schemaVersion;
  raw.ledger.filler = Array.from({ length: 500 }, (_, i) => ({ i }));
  let invoked = 0;
  const spied = new Proxy(raw, { get(t, k, r2) { invoked += 1; return Reflect.get(t, k, r2); } });
  assert.throws(() => captureResultSet(spied, { limits }), corruptWith('invalid-schema-version'));
  assert.equal(invoked, 0, 'the pre-check never invokes [[Get]] on the untrusted object');
});

test('a missing, non-integer or sub-1 schemaVersion is invalid-schema-version, not "unsupported"', async () => {
  const base = await rawSet();
  for (const bad of [undefined, null, 0, -1, 1.5, '1', true, NaN, {}]) {
    const raw = { ...base };
    if (bad === undefined) delete raw.schemaVersion; else raw.schemaVersion = bad;
    assert.throws(() => captureResultSet(raw, { limits }), corruptWith('invalid-schema-version'), String(bad));
  }
});

// Review Important 1: registering a migration must NEVER widen the set of valid versions.
test('an invalid schemaVersion stays invalid even with a migration registered under that key', async () => {
  const base = await rawSet();
  for (const bad of [0, -1, 1.5]) {
    const raw = { ...base, schemaVersion: bad };
    const migrations = new Map([[bad, (s) => ({ ...s, schemaVersion: SCHEMA_VERSION })]]);
    assert.throws(() => captureResultSet(raw, { limits, migrations }),
      corruptWith('invalid-schema-version'), `${bad} must stay invalid`);
    assert.throws(() => captureResultSet(raw, { limits }), corruptWith('invalid-schema-version'), String(bad));
  }
  // …and the current version is admitted with no table at all.
  assert.equal(captureResultSet({ ...base }, { limits }).schemaVersion, SCHEMA_VERSION);
});

// `[1, SCHEMA_VERSION)` is EMPTY while SCHEMA_VERSION === 1, so the dispatcher is proven as a pure
// function with an INJECTED higher current version — never by pretending version 0 is valid.
test('applyMigration is single-hop: one lookup, output must already be at the current version', () => {
  const captured = { schemaVersion: 1, results: [] };
  const opts = { runId: 'r', currentVersion: 2 };                              // injected, test-only
  const good = new Map([[1, (s) => ({ ...s, schemaVersion: 2 })]]);
  assert.equal(applyMigration(captured, good, opts).schemaVersion, 2);
  for (const table of [new Map(),                                              // missing
                       new Map([[1, () => { throw new Error('boom'); }]]),     // throwing
                       new Map([[1, (s) => s]]),                               // output still at 1: no chaining
                       new Map([[1, () => null]])]) {
    assert.throws(() => applyMigration(captured, table, opts), corruptWith('migration-failed'));
  }
  // The default current version is SCHEMA_VERSION, and a source version outside [1, current) is
  // never dispatched at all — not even to a registered entry.
  assert.throws(() => applyMigration({ schemaVersion: 0 }, new Map([[0, (s) => s]]), { runId: 'r' }),
    corruptWith('invalid-schema-version'));
});

// codex-review finding (2026-09-22, fixed): a migration's RETURN VALUE is untrusted output too — an
// array, an inherited `schemaVersion`, or a throwing getter must all become `migration-failed`,
// never a raw escaped exception and never silently accepted. Scope note (documented in
// `applyMigration`'s own doc comment and this task's report): this is a TOP-LEVEL shape check only
// — a nested accessor or a cycle elsewhere in a migration's output is Task P5.5's `readResultSet`
// to catch when it re-validates migration output, not this function's job.
test('applyMigration treats its own migration function\'s return value as untrusted output', () => {
  const captured = { schemaVersion: 1, results: [] };
  const opts = { runId: 'r', currentVersion: 2 };

  // A throwing `schemaVersion` getter on the migration's output must not escape as a raw exception.
  const throwing = new Map([[1, () => ({ get schemaVersion() { throw new Error('side effect'); } })]]);
  assert.throws(() => applyMigration(captured, throwing, opts), corruptWith('migration-failed'));

  // An array happens to have an own `schemaVersion` property assigned, but is not a plain object.
  const arrayOut = Object.assign([], { schemaVersion: 2 });
  const arrayTable = new Map([[1, () => arrayOut]]);
  assert.throws(() => applyMigration(captured, arrayTable, opts), corruptWith('migration-failed'));

  // An INHERITED `schemaVersion` (via the prototype, not an own property) must not count — the
  // check is `getOwnPropertyDescriptor`, never a `.schemaVersion`/`in` read that walks the chain.
  const inherited = Object.create({ schemaVersion: 2 });
  const inheritedTable = new Map([[1, () => inherited]]);
  assert.throws(() => applyMigration(captured, inheritedTable, opts), corruptWith('migration-failed'));

  // A well-behaved Proxy that genuinely reports `schemaVersion: currentVersion` through its own
  // (non-hostile) traps is still a plain-shaped, admissible migration output at THIS function's
  // level — the top-level shape check does not reject a proxy merely for being one.
  const target = { schemaVersion: 2, results: [] };
  let getOwnPropertyDescriptorCalls = 0;
  const proxied = new Proxy(target, {
    getOwnPropertyDescriptor(t, k) { getOwnPropertyDescriptorCalls += 1; return Reflect.getOwnPropertyDescriptor(t, k); },
  });
  const proxyTable = new Map([[1, () => proxied]]);
  assert.equal(applyMigration(captured, proxyTable, opts), proxied);
  assert.ok(getOwnPropertyDescriptorCalls > 0, 'sanity: the proxy was actually consulted');
});

test('accessors are rejected without ever invoking the getter — including runId and schemaVersion', async () => {
  const base = await rawSet();
  for (const key of ['results', 'runId']) {
    const raw = structuredClone(base);
    let invoked = 0;
    Object.defineProperty(raw, key, { get() { invoked += 1; return []; }, configurable: true, enumerable: true });
    assert.throws(() => captureResultSet(raw, { limits }), corruptWith('accessor'), key);
    assert.equal(invoked, 0, key);
  }
  // `runId` is a parameter, never read off the untrusted argument: a throwing getter cannot fire.
  const hostile = structuredClone(base);
  Object.defineProperty(hostile, 'runId', { get() { throw new Error('side effect'); }, configurable: true, enumerable: true });
  assert.throws(() => captureResultSet(hostile, { limits, runId: 'diagnostic-id' }),
    (e) => e instanceof CorruptResultSetError && e.runId === 'diagnostic-id');
});

test('cyclic, non-plain, symbol-keyed and sparse inputs are corrupt, never partially copied', async () => {
  const cases = [
    ['cyclic', (s) => { s.ledger.self = s.ledger; }],
    ['not-plain', (s) => { s.statistics.m = new Map(); }],
    ['not-plain', (s) => { s.statistics.n = Number.POSITIVE_INFINITY; }],
    ['not-plain', (s) => { s.statistics.f = () => 1; }],
    ['not-plain', (s) => { s.statistics.u = undefined; }],
    ['symbol-key', (s) => { s.ledger[Symbol('x')] = 1; }],
    // `new Array(3)` — genuinely sparse (three holes, no own index properties). `Array.from({length:
    // 3})` (the plan's own draft) instead creates a DENSE array of three explicit `undefined`s
    // (`Array.from` assigns via `[[Set]]` for every index), which capture correctly reports as
    // `not-plain` (undefined is not a legal captured value), never `sparse-array` — verified by
    // running it. That earlier snippet tested the wrong code, not this one.
    ['sparse-array', (s) => { s.results = new Array(3); }],
    ['array-extra-key', (s) => { s.results.tag = 'x'; }],
    ['depth', (s) => { let v = 1; for (let i = 0; i < 70; i++) v = { c: v }; s.ledger.deep = v; }],
  ];
  for (const [code, mutate] of cases) {
    const raw = await rawSet();
    mutate(raw);
    assert.throws(() => captureResultSet(raw, { limits }), corruptWith(code), code);
  }
});

test('issues carry a path and a code and never a value or a message (§13.6)', async () => {
  const raw = await rawSet();
  raw.provenance.secretToken = 'hunter2';
  raw.provenance.bad = new Map();
  try {
    captureResultSet(raw, { limits });
    assert.fail('expected a corrupt set');
  } catch (e) {
    assert.ok(e.issues.length > 0 && e.issues.length <= 20);
    for (const i of e.issues) assert.deepEqual(Object.keys(i).sort(), ['code', 'path']);
    assert.equal(JSON.stringify(e.issues).includes('hunter2'), false);
  }
});

test('a nested array over its §17.1.1 schema ceiling is corrupt', async () => {
  const raw = await rawSet();
  raw.results = Array.from({ length: RUN_OPTION_CEILINGS.maxResultsPerRun + 1 }, (_, i) => ({ resultId: `r${i}`, flags: {} }));
  assert.throws(() => captureResultSet(raw, { limits }), corruptWith('array-too-long'));
});

test('the ONE node ceiling maps to two errors by which ceiling actually bit', async () => {
  const valid = await rawSet();
  // End to end: a reader limit below the schema ceiling ⇒ "valid, but too large for THIS reader".
  assert.throws(() => captureResultSet(valid, { limits: { ...limits, maxCapturedNodes: 16 } }), ResultSetTooLargeError);
  // The other branch needs a set above SCHEMA_MAX_NODES (16M+ nodes), which no test may allocate,
  // so the mapping itself is the pure function and both branches are asserted on it directly.
  assert.ok(nodeCeilingError({ maxCapturedNodes: SCHEMA_MAX_NODES }, 'r', [{ path: '/results', code: 'too-many-nodes' }])
    instanceof CorruptResultSetError);
  assert.ok(nodeCeilingError({ maxCapturedNodes: SCHEMA_MAX_NODES - 1 }, 'r', [{ path: '/results', code: 'too-many-nodes' }])
    instanceof ResultSetTooLargeError);
});

// --- review Critical 1: the 64 KiB budget is charged DURING capture, before allocation ----------
test('the unknown-field budget is charged mid-traversal: later values are never copied', async () => {
  const CHUNK = 4 * 1024;                                    // each value is individually legal
  const budget = limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES;     // never a literal here
  const overAt = Math.ceil(budget / CHUNK);                  // the index whose copy crosses it
  const raw = await rawSet();
  // An OPEN type (`ledger`) with an unknown field far below every node/array/string ceiling: this
  // is the review's own scenario — thousands of individually legal 4 KiB strings, tens of MB if
  // copied. A large multiplier (not the plan's own smaller one) so the array dominates the node
  // count regardless of the real fixture's own baseline size — see `rawSet`'s doc comment on why a
  // real, production-built fixture is richer than a minimal hand-built one.
  raw.ledger.futureData = Array.from({ length: overAt * 2000 }, () => 'x'.repeat(CHUNK));

  // Node's `assert.throws` does not return the caught error, so the error is captured directly.
  let err;
  try { captureResultSet(raw, { limits }); assert.fail('expected unknown-field-bytes'); } catch (e) { err = e; }
  assert.ok(corruptWith('unknown-field-bytes')(err));
  const hit = err.issues.find((i) => i.code === 'unknown-field-bytes');
  // Charged DURING capture ⇒ the issue names the element that crossed the budget, near the start.
  // Charged AFTER capture ⇒ it would name the whole field, and every string would be in memory.
  const index = Number(hit.path.split('/').pop());
  assert.ok(Number.isInteger(index), `expected an element path, got ${hit.path}`);
  assert.ok(index <= overAt, `refused at element ${index}, expected <= ${overAt}`);
  assert.ok(index < raw.ledger.futureData.length / 2, 'the tail was never reached');
});

test('P0 reports exactly how many values were copied before the budget refusal', async () => {
  // The direct P5↔P0 seam: `captureResultSet` maps the failure to an error and drops the counters,
  // so the ALLOCATION bound itself is asserted on `captureData`'s own `nodes` — which P0 defines as
  // "values actually copied before capture stopped".
  const CHUNK = 4 * 1024;
  const budget = limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES;
  const overAt = Math.ceil(budget / CHUNK);
  const raw = await rawSet();
  raw.ledger.futureData = Array.from({ length: overAt * 2000 }, () => 'x'.repeat(CHUNK));

  const r = captureData(raw, {
    maxNodes: limits.maxCapturedNodes, maxDepth: 64, maxIssues: 20,
    openFieldBudget: { isOpenPath, maxBytes: budget },
  });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'unknown-field-bytes'));
  assert.ok(r.openFieldBytes <= budget + CHUNK, 'the counter stopped at the boundary');
  // The whole point: `nodes` is bounded by what fits in the budget plus the set's own fields —
  // NOT by the ~200k-element array. A post-capture check would have copied every one of them.
  assert.ok(r.nodes < overAt * 2 + 1_000,
    `copied ${r.nodes} values; the budget admits about ${overAt}`);
  assert.ok(r.nodes < raw.ledger.futureData.length / 10, 'the tail was never copied');
});

test('unknown fields in open types are budgeted together across every open type, not per field', async () => {
  const budget = limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES;
  // Chunks, never one giant string: a single string over `MAX_STRING_LENGTH` (this module's own
  // §13.5.2 per-field cap, well under the 64 KiB budget) is refused as `string-too-long` before the
  // byte budget is even consulted — the same reason tests above chunk at exactly that boundary.
  const CHUNK = 4 * 1024;
  const chunksFor = (totalBytes) => Array.from({ length: Math.ceil(totalBytes / CHUNK) }, () => 'x'.repeat(CHUNK));

  // Comfortably under, spread across three open types: accepted, preserved verbatim (§13.6).
  const under = await rawSet();
  under.ledger.a = chunksFor(budget * 0.2);
  under.provenance.b = chunksFor(budget * 0.2);
  under.outcome.c = chunksFor(budget * 0.2);                 // sum ≈ 0.6 x budget
  assert.equal(captureResultSet(under, { limits }).ledger.a.length, under.ledger.a.length);

  // Comfortably over, same three fields: refused.
  const over = await rawSet();
  over.ledger.a = chunksFor(budget * 0.4);
  over.provenance.b = chunksFor(budget * 0.4);
  over.outcome.c = chunksFor(budget * 0.4);                  // sum ≈ 1.2 x budget
  assert.throws(() => captureResultSet(over, { limits }), corruptWith('unknown-field-bytes'));

  // NOTE (scope, controller ruling): the companion assertion that a CLOSED type's unknown field is
  // rejected as `unknown-field-closed-type` by a fully-working `validateResultSet` belongs to Task
  // P5.5's own `validateResultSet.invariants.test.mjs` (that check needs the full closed TYPES
  // table, which is P5.5's responsibility) — see task-P5.4-report.md.
});

// Controller ruling ("P5.4/P5.5 taints[] ceiling formula"), CORRECTED (progress.md, "Correction to
// the taints[] ceiling ruling"): `MAX_UNIT_TAINTS` is now `RUN_OPTION_CEILINGS.maxLedgerRecords`
// itself — the real, shipped `clashtest/planning/ledger.js` bounds a target-model/unit-kind taint's
// `reason` to "any non-empty string" (`normalizeTaint`'s `nonEmptyString` check, no membership test
// against `KNOWN_DIAGNOSTIC_REASONS` or any other closed table), so the only real bound on how many
// distinct, uncollapsed taints one unit can hold is the run-wide discretionary ledger budget a
// single unit could consume via `admitRuntime(...)` before its own admission fails and it collapses
// — not a combinatorial reason/model count. The old exact-boundary test (materialising
// `MAX_UNIT_TAINTS` and `MAX_UNIT_TAINTS + 1` real objects) no longer makes sense at 20 million
// entries — it would take tens of seconds and hit `captureResultSet`'s own node ceiling
// (`maxCapturedNodes`) long before `array-too-long` ever became the limiting factor at that scale.
// This asserts instead: (1) the ceiling is READ from the real, named run-wide constant, never a
// re-derived or hard-coded number; (2) a large-but-legitimate taints array well past the OLD
// (insufficient) bound is still accepted at THIS capture-time `ARRAY_CEILINGS` site.
test('MAX_UNIT_TAINTS is RUN_OPTION_CEILINGS.maxLedgerRecords, and a large legitimate taints array is accepted', async () => {
  assert.equal(MAX_UNIT_TAINTS, RUN_OPTION_CEILINGS.maxLedgerRecords);

  const taintAt = (i) => ({ kind: 'unit', modelKey: null, dbId: null, reason: `r${i}`, occurrences: 1 });
  const LARGE_BUT_CHEAP = 50_000;   // well past the old (insufficient) ~101k/3 formula's own inputs; cheap to allocate
  assert.ok(LARGE_BUT_CHEAP < MAX_UNIT_TAINTS);
  const set = await rawSet();
  set.ledger.units[0] = { ...set.ledger.units[0],
    taints: Array.from({ length: LARGE_BUT_CHEAP }, (_, i) => taintAt(i)) };
  const captured = captureResultSet(set, { limits });
  assert.equal(captured.ledger.units[0].taints.length, LARGE_BUT_CHEAP);
});

test('native structuredClone is never used on external input', async () => {
  const raw = await rawSet();
  const real = globalThis.structuredClone;
  let called = 0;
  globalThis.structuredClone = (...a) => { called += 1; return real(...a); };
  try { captureResultSet(raw, { limits }); } finally { globalThis.structuredClone = real; }
  assert.equal(called, 0);
});
