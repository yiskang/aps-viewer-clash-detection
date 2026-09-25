# Definitions, validation, `ClashTestStore` and lifecycle — Phase P2 Implementation Plan

**Goal:** Build the definition layer of the core engine: one synchronous capture-and-validate pass that turns a caller's (possibly hostile, possibly mutating) object into a detached, validated, deep-frozen `ClashTestDefinition`; the closed `ClashTestReference` schema and the deterministic `startRun` overload-discrimination rule that decides, without guessing, whether an argument is a definition or a stored reference; the sliced normalization that produces the canonical form and the `semanticDigest` that every `ResultId` depends on; and the `ClashTestStore` port with an in-memory reference implementation whose `put`/`archive`/`delete`/`isTombstoned`/`resolveForRun`/`list` operations are linearizable per `testId`, enforce `latest + 1` revisioning, and make a hard delete a permanent `testId` tombstone. Everything here is Viewer-free, port-free and store-agnostic: P2 imports only P0 foundations and one P1 constant (`CLASH_MODES`, the sole code home of the mode list), and every later phase gets its definitions through the names in the interface summary below rather than re-deriving them.

Master: ../2026-09-20-federated-clash-test-core-engine-implementation.md

## Global Constraints

This phase **inherits the master's Global Constraints** in full. Phase-specific constraints, copied verbatim from the frozen spec:

- §5.3 — "One pure function, `validateTest(def) → ValidationResult = {issues: Issue[], issuesTruncated: boolean}`, is used identically by `validateTest`, `saveTest` and `startRun` … It **collects issues** as `{path, code, message}` in a single pass, performs **no coercion**, and never stops at the first issue *until* it has collected `maxValidationIssues`".
- §5.3 — "validation is the *only* work done synchronously in the caller's turn. It is a single linear pass over the definition … with **no sorting, de-duplication, normalization, or digesting** — those run later, in the sliced work".
- §5.3 — "Every value that crosses an asynchronous boundary is **captured as a detached, data-only copy in the same single pass that validates it**, so the value that is validated, normalized, digested, planned, embedded and persisted is one and the same."
- §5.3 — "no getter on the caller's object is ever *invoked*" … "A caller mutation made after `startRun`/`saveTest` returns — including immediately after, and while the engine is yielded mid-slice — therefore cannot alter validation, the `semanticDigest`, the plan, the embedded definition or the persisted identity (AC-1)."
- §5.4 — "**Swapping `selectionA` and `selectionB` is a different question for every mode, including the unordered ones (R21 Q3, decided)**".
- §5.5 — "The tombstone is written in the **same linearization point** as the delete (so a racing `put` sees either the live test or the tombstone, never neither)."
- §5.5 — "`ClashTestStore` operations (`put`, `get`, `resolveForRun`, `list`, `archive`, `delete`, `isTombstoned`) are **linearizable per `testId`**".
- §5.5 — "`put(def)` accepts a definition iff `(testId` has **never been seen by the store — neither live nor tombstoned** ∧ `revision === 1)` or `revision === latest(testId) + 1` (for a live test) … and **never overwrites**".
- §13.5 — "Paging is **keyset, not offset** … an item present for the whole traversal is returned **exactly once**".

## Phase interface summary

Every exported name P2 owns. Later phases consume these signatures verbatim and must not re-implement them. Names follow spec §18 and the master's §2 module map.

| Export | Module | Signature | Meaning |
|---|---|---|---|
| `validateTest` | `clashtest/definition/validate.js` | `(def, opts?) → {issues, issuesTruncated}` | Pure; **never throws for a data error**. `opts = {limits?}`. §5.3, §18. |
| `captureAndValidate` | `clashtest/definition/validate.js` | `(def, opts?) → {issues, issuesTruncated, captured, gate?}` | The one synchronous capture-and-validate pass: P0 `captureData` (structure) then V1–V6 on the copy (schema). `opts = {limits?}`. `captured` is the detached plain-object copy, non-`null` **iff** `issues.length === 0`. `gate = {key:'schemaVersion', value}` is present **iff** capture stopped at the schema-version gate (integer `> 1`); P7 passes the whole result to `toDefinitionError`. §5.3. |
| `validateReference` | `clashtest/definition/validate.js` | `(ref, opts?) → {issues, issuesTruncated, captured}` | Closed `ClashTestReference` schema R1–R3. `captured = {testId, revision}` (`revision` `null` when absent). |
| `classifyStartRunArgument` | `clashtest/definition/validate.js` | `(arg, opts?) → {kind: 'definition'\|'reference'\|'invalid', issues}` | **R21-I3.** Deterministic, fail-closed overload discrimination for `startRun(defOrRef)`; never guesses. `opts = {limits?}` (the definition node ceiling derives from the resolved limits). `'invalid'` = not capturable as a plain-data object; `issues` say why. |
| `toDefinitionError` | `clashtest/definition/validate.js` | `(result) → InvalidTestDefinitionError \| UnsupportedSchemaVersionError` | Maps a non-empty `captureAndValidate` result to the §5.3 error (P0 object-argument constructors); `UnsupportedSchemaVersionError({type:'ClashTestDefinition', schemaVersion: result.gate.value, supported: 1})` iff `unsupported-schema-version` is the *only* issue. |
| `validateTestSummaryPage` | `clashtest/definition/validate.js` | `(page) → {issues, issuesTruncated}` | Closed `TestSummary` page validation (capture, then validate the copy) for an untrusted `ClashTestStore.list` result (§13.5). Caps at 20 issues, each with an empty `message`. |
| `LIST_LIMIT` | `clashtest/definition/validate.js` | `Readonly<{default: 100, max: 1000}>` | The §13.5 page-size bounds; the in-memory store and the page validator share it. |
| `ISSUE_CODES` | `clashtest/definition/validate.js` | `readonly string[]` | The closed issue-code vocabulary (frozen array), incl. the codes P0's `CAPTURE_CODES` map to. |
| `DEFINITION_KEYS` / `REFERENCE_KEYS` | `clashtest/definition/validate.js` | `readonly string[]` | Schema key lists; the discrimination rule and the walk share them. |
| `normalizeDefinition` | `clashtest/definition/normalize.js` | `(captured) → ClashTestDefinition` | Pure, synchronous: merge/sort/de-duplicate per §5.2+§5.3. Input must be a `captured` value (already V-valid). |
| `canonicalSemanticForm` | `clashtest/definition/normalize.js` | `(normalized) → object` | `{mode, clearance?, selectionA, selectionB}`; `clearance` present **iff** `mode === 'clearance'`. §5.4. |
| `computeSemanticDigest` | `clashtest/definition/normalize.js` | `(normalized) → string` | `digestCanonical(canonicalSemanticForm(normalized))` (P0): `'sha256:' + hex` over the canonical JSON. Synchronous. §5.4. |
| `prepareDefinition` | `clashtest/definition/normalize.js` | `(captured, {yieldToScheduler, now, sliceBudgetMs?, limits?, spanRecorder?}) → Promise<{definition, semanticDigest}>` | The **sliced** post-validation body: normalize → digest (`digestCanonicalSliced`) → deep-freeze (`deepFreezeSliced`), all through one P0 `createSlicer`. `sliceBudgetMs` / `limits` default from P0's `ENGINE_LIMIT_DEFAULTS`. Optional `spanRecorder(label, ms)` is forwarded to the slicer; span labels are `'normalize'` and `'semanticDigest'` (the digest phase), plus P0's `'freeze'`. `definition` is deep-frozen; safe to embed, persist and plan over. §5.3. |
| `deepFreezeDefinition` | `clashtest/definition/normalize.js` | `(def) → def` | Idempotent deep freeze (P0 `deepFreeze`). |
| `assertRootAntichain` | `clashtest/definition/normalize.js` | `(roots) → {ok, violations}` | §5.6.2 roots contract check over `[{dbId, ownerDbIds}]` as returned by `ElementEnumerator.resolveRoots`. |
| `checkCrossRoleNesting` | `clashtest/definition/normalize.js` | `({rootsA, rootsB, rootsUnion}) → {supported, offenders, enumeratorInconsistent}` | §5.6.5 rule **input**: `RU = RA ∪ RB` as dbId sets. `offenders` = up to 20 `{ancestor, descendant}`. The planner's use of it is P3. |
| `hierarchyInternalCandidates` | `clashtest/definition/normalize.js` | `({rootsA, rootsB}) → Array<{dbId, ownerCount}>` | §5.6.3 rule input: roots in `A ∩ B` whose subtree has ≥ 2 fragment owners. Claim-blocking bookkeeping is P5/P6. |
| `assertRootAntichainSliced` | `clashtest/definition/normalize.js` | `(roots, {tick}) → Promise<{ok, violations}>` | Same rule as `assertRootAntichain` (one shared generator body, so semantics cannot drift), deadline-aware: `tick(label?) → void \| Promise<void>` is called once per unit of size-dependent work (owner scans, index inserts, candidate-sort steps) and a returned Promise is awaited. **P3 calls this form on planning data** (via its checkpoint adapter), not the sync one. Added by the P2 independent-review remediation (2026-09-21, H1). |
| `checkCrossRoleNestingSliced` | `clashtest/definition/normalize.js` | `({rootsA, rootsB, rootsUnion}, {tick}) → Promise<{supported, offenders, enumeratorInconsistent}>` | Sliced form of `checkCrossRoleNesting` (shared generator body; same `tick` contract, including the dropped-id sort). |
| `hierarchyInternalCandidatesSliced` | `clashtest/definition/normalize.js` | `({rootsA, rootsB}, {tick}) → Promise<Array<{dbId, ownerCount}>>` | Sliced form of `hierarchyInternalCandidates` (shared generator body; same `tick` contract, including the dbId sort). |
| `createInMemoryClashTestStore` | `clashtest/stores/InMemoryClashTestStore.js` | `({now?} = {}) → ClashTestStore` | The `ClashTestStore` reference implementation (§5.5); `now` is accepted for parity and unused. |
| `ClashTestStore` (port shape) | `clashtest/stores/InMemoryClashTestStore.js` (JSDoc typedef) | `{put, get, resolveForRun, list, archive, delete, isTombstoned}` | The port every store honors. Signatures below. |
| `store.put` | — | `(def) → Promise<ClashTestDefinition>` | Atomic `latest + 1`; rejects `TestDeletedError` → `TestArchivedError` → `RevisionConflictError` in that order (P0 object-argument errors); never overwrites. |
| `store.get` | — | `(testId, revision?) → Promise<ClashTestDefinition\|null>` | No revision ⇒ latest (archived included). Tombstoned ⇒ `null`. |
| `store.resolveForRun` | — | `(testId, revision?) → Promise<{status, definition, latestRevision}>` | `status ∈ {'live','archived','deleted','missing'}`; revision **and** lifecycle state from one point. §5.5. |
| `store.list` | — | `({limit?, cursor?} = {}) → Promise<{summaries: TestSummary[], next?: string}>` | Total order by `testId`, opaque `v1:` keyset cursor, `1 ≤ limit ≤ 1000` (default 100). §13.5. |
| `store.archive` | — | `(testId) → Promise<void>` | One-way `active → archived`, all revisions, idempotent. No restore exists (§5.5, errata E12). |
| `store.delete` | — | `(testId) → Promise<void>` | Removes bodies **and** writes the permanent tombstone in one linearization point. Idempotent. |
| `store.isTombstoned` | — | `(testId) → Promise<boolean>` | Linearizable with `delete`. §5.5. |
| `createDefinitionOperations` | `clashtest/definition/operations.js` | `({testStore, limits, yieldToScheduler, now, spanRecorder?}) → {validateTest, saveTest, getTest, listTests, archiveTest}` | The §18 definition surface, store-bound; P7's engine facade delegates to it. Optional `spanRecorder` is forwarded to `prepareDefinition` for both `saveTest` and store-returned definitions (`getTest`). |
| `RESOLVE_STATUS_TO_PLANNING_CAUSE` | `clashtest/definition/operations.js` | `Readonly<Record<string,string>>` | `{live:null, archived:'test-archived', deleted:'test-deleted', missing:'test-not-found'}` (§5.5). Consumed by P6; P2 does not map it. |

**Closed DTOs P2 owns** (plain data, structured-clone safe):

```js
/** @typedef {{ path: string, code: string, message: string }} Issue */
/** @typedef {{ issues: Issue[], issuesTruncated: boolean }} ValidationResult */
/** @typedef {{ testId: string, revision: number|null }} ClashTestReference */   // R21-I3, closed: exactly these
/** @typedef {{ testId: string, latestRevision: number, archived: boolean, name: string }} TestSummary */
```

`ClashTestDefinition` and `SelectionSpec`/`SelectionEntry` are exactly spec §5.1; P2 adds no field to them.

## File structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `clashtest/definition/validate.js` | Create | The single capture-and-validate pass (P0 `captureData`, then V1–V6 on the copy), the closed `ClashTestReference` schema, `classifyStartRunArgument`, the error mapping, listing-page validation. Imports P0 (`util/capture.js`, `options.js`, `errors.js`) and P1 (`identity/ids.js`: `CLASH_MODES`). No I/O, no async, no store. |
| `clashtest/definition/normalize.js` | Create | Post-validation work: normalization (one generator body, driven sync and sliced), canonical semantic form, `semanticDigest`, sliced `prepareDefinition`, deep freeze (P0's), roots-contract helpers. |
| `clashtest/stores/InMemoryClashTestStore.js` | Create | `ClashTestStore` port JSDoc + the in-memory reference implementation (revisions, archive, delete/tombstone, `resolveForRun`, keyset listing). |
| `clashtest/definition/operations.js` | Create | Store-bound §18 definition surface (`validateTest`/`saveTest`/`getTest`/`listTests`/`archiveTest`) + `StoreNotConfiguredError` handling. **Not in the master §2 module map** — see Gates and open items. |
| `test/clashtest/definition/reference.test.mjs` | Create | Task P2.1. |
| `test/clashtest/definition/validate.test.mjs` | Create | Tasks P2.2, P2.3. |
| `test/clashtest/definition/normalize.test.mjs` | Create | Task P2.4. |
| `test/clashtest/definition/capture-stability.test.mjs` | Create | Task P2.5. |
| `test/clashtest/stores/InMemoryClashTestStore.test.mjs` | Create | Task P2.6. |
| `test/clashtest/stores/clashTestStore.listing.test.mjs` | Create | Task P2.7. |
| `test/clashtest/definition/operations.test.mjs` | Create | Task P2.8. |
| `test/clashtest/definition/roots.test.mjs` | Create | Task P2.9. |
| `test/clashtest/support/index.mjs` | Modify (one appended line) | `export * from './definitions.mjs';` — P0's extension rule (2). No existing export is touched. |
| `test/clashtest/support/definitions.mjs` | Create (P2 adds to P0's support dir) | The definition fixture builder `makeDefinition`. P2 **adds to** `test/clashtest/support/`, never forks it (master §2.1 rule 5): the deterministic clock is P0's `createFakeClock`, and the new file's export is appended to P0's `support/index.mjs` barrel per its extension rule (2). |

---

### Task P2.1: `ClashTestReference` schema and `startRun` overload discrimination (R21-I3)

Owns the deferred erratum R21-I3. `startRun(defOrRef)` must decide, for **any** object including partial and mixed-shape ones, whether it is a full definition or a stored reference — deterministically, and never by guessing.

**Files**
- Create: `clashtest/definition/validate.js`
- Test: `test/clashtest/definition/reference.test.mjs`

**Interfaces**
- Consumes (**P0 `clashtest/util/capture.js`**, reconciliation row N4): the single export `captureData(root, opts) → {ok:true, value, nodes} | {ok:false, issues:{path,code,message}[], issuesTruncated, gate?}` and its `CAPTURE_CODES`. P0 exports no per-property reflection primitives; those steps are internal to `captureData` (one `Reflect.ownKeys` per object, one descriptor read per property, never a getter, prototype ∈ `{Object.prototype, null}`). **Capture-then-validate (P0 design note 1 and Gates item 3, stated here as P0 requires):** every function in this file first runs `captureData` — which guarantees only the *structural* invariants — and then applies the *schema* checks to `result.value`, the detached copy. The observable safety invariants of §5.3 are unchanged: no getter is ever invoked, each descriptor is read once, the caller's object is never touched again after `captureData` returns, and the value validated is the value used. `captureData`'s `CAPTURE_CODES` are mapped into P2's `ISSUE_CODES` by the `CAPTURE_TO_ISSUE` table below (the root pointer `''` is reported as `'/'`; `array-too-long` is refined to `too-many-entries` / `too-many-elements` by path).
- Consumes (**P0 `clashtest/options.js`**): `ENGINE_LIMIT_DEFAULTS` — `maxValidationIssues`, `maxEntriesPerSelection`, `maxExplicitElementsPerSelection` are read from the caller's resolved limits, falling back to these defaults; P2 restates no number of §17.1.
- Consumes (P0 `clashtest/errors.js`, used from P2.3): `InvalidTestDefinitionError`, `UnsupportedSchemaVersionError` — object-argument constructors (row N1).
- Produces: `classifyStartRunArgument`, `validateReference`, `REFERENCE_KEYS`, `DEFINITION_KEYS`, `ISSUE_CODES`.

**The rule (normative for this plan).** An argument is a **reference** iff, after `captureData` has copied it, the copy's own string-key set is exactly `{'testId'}` or exactly `{'testId','revision'}`. Otherwise it is a **definition** and is put through the full V1–V6 validation, which rejects it with issues if it is not one. There is no third "ambiguous" outcome and no field sniffing: `{testId:'T', revision:1, mode:'clearance'}` is a definition (its key set is neither reference set) and is rejected with `unknown-property` at `/mode` plus `missing-required` for `schemaVersion`/`name`/`selectionA`/`selectionB`. `kind: 'invalid'` means the argument is **not capturable as a plain-data object**: a non-object, an array, or any structural `captureData` issue (symbol key, accessor, cycle, unreadable, over the node ceiling …) — the issues say which.

Why the copy's keys rather than own **enumerable** keys: `captureData` copies by `Reflect.ownKeys`, enumerable **and** non-enumerable alike, and §5.3's capture rejects any key outside the schema. An enumerable-only discrimination could classify `{testId}` (with a non-enumerable `mode`) as a reference while the definition capture then sees `mode`. One key notion, used by both, removes that gap.

Why a second capture (classification, then `captureAndValidate` / `validateReference`) is safe: nothing is invoked and nothing is trusted from the first. Only a `Proxy` can answer differently twice, and both orders fail closed — a shape that shifts reference→definition is rejected by V1 for missing required keys, and one that shifts definition→reference is rejected by R1 for unknown keys. The classification pass costs at most the definition node ceiling (P0 bounds allocation before reading elements), so `startRun`'s synchronous span stays bounded by the same lowered ceilings as §5.3.

- [x] **Step 1: Write the failing discrimination test.**

```js
// test/clashtest/definition/reference.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStartRunArgument, validateReference } from '../../../clashtest/definition/validate.js';

const codes = (r) => r.issues.map((i) => `${i.path}:${i.code}`);

test('own key set exactly {testId} or {testId, revision} is a reference', () => {
  assert.equal(classifyStartRunArgument({ testId: 'T' }).kind, 'reference');
  assert.equal(classifyStartRunArgument({ testId: 'T', revision: 3 }).kind, 'reference');
  assert.equal(classifyStartRunArgument({ revision: 3, testId: 'T' }).kind, 'reference'); // key order irrelevant
});

test('mixed-shape objects are definitions, never guessed references (R21-I3)', () => {
  // the exact failure scenario of round-21 finding I3
  assert.equal(classifyStartRunArgument({ testId: 'T', revision: 1, mode: 'clearance' }).kind, 'definition');
  assert.equal(classifyStartRunArgument({ testId: 'T', name: 'x' }).kind, 'definition');
  assert.equal(classifyStartRunArgument({}).kind, 'definition');
  assert.equal(classifyStartRunArgument({ revision: 1 }).kind, 'definition');
});

test('a non-enumerable extra key still makes it a definition', () => {
  const o = { testId: 'T' };
  Object.defineProperty(o, 'mode', { value: 'clearance', enumerable: false });
  assert.equal(classifyStartRunArgument(o).kind, 'definition');
});

test('non-objects and arrays are invalid, not guessed', () => {
  for (const bad of [null, undefined, 'T', 7, true, () => {}, ['T']]) {
    const r = classifyStartRunArgument(bad);
    assert.equal(r.kind, 'invalid');
    assert.deepEqual(codes(r), ['/:not-an-object']);
  }
});

test('anything captureData cannot capture as plain data is invalid, and the issue says why', () => {
  assert.deepEqual(codes(classifyStartRunArgument({ testId: 'T', [Symbol('x')]: 1 })), ['/x:symbol-key']);
  const withGetter = Object.defineProperty({ testId: 'T' }, 'revision', { get() { throw new Error('never invoked'); }, enumerable: true });
  const g = classifyStartRunArgument(withGetter);
  assert.equal(g.kind, 'invalid');
  assert.deepEqual(codes(g), ['/revision:accessor-property']);
  const cyclic = { testId: 'T' }; cyclic.self = cyclic;
  assert.deepEqual(codes(classifyStartRunArgument(cyclic)), ['/self:cyclic']);
});

test('a proxy whose ownKeys trap throws is invalid, and the throw never escapes', () => {
  const p = new Proxy({}, { ownKeys() { throw new Error('boom'); } });
  const r = classifyStartRunArgument(p);
  assert.equal(r.kind, 'invalid');
  assert.deepEqual(codes(r), ['/:unreadable']);
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  assert.deepEqual(codes(classifyStartRunArgument(proxy)), ['/:unreadable']);
});

test('ClashTestReference is a closed schema (R1-R3)', () => {
  assert.deepEqual(validateReference({ testId: 'T' }).captured, { testId: 'T', revision: null });
  assert.deepEqual(validateReference({ testId: 'T', revision: 4 }).captured, { testId: 'T', revision: 4 });
  assert.deepEqual(codes(validateReference({ testId: '' })), ['/testId:string-too-short']);
  assert.deepEqual(codes(validateReference({ testId: 'x'.repeat(257) })), ['/testId:string-too-long']);
  assert.deepEqual(codes(validateReference({ testId: 7 })), ['/testId:not-a-string']);
  assert.deepEqual(codes(validateReference({ revision: 1 })), ['/testId:missing-required']);
  assert.deepEqual(codes(validateReference({ testId: 'T', mode: 'clearance' })), ['/mode:unknown-property']);
  assert.deepEqual(codes(validateReference({ testId: 'T', revision: 0 })), ['/revision:out-of-range']);
  assert.deepEqual(codes(validateReference({ testId: 'T', revision: 1.5 })), ['/revision:not-an-integer']);
  assert.deepEqual(codes(validateReference({ testId: 'T', revision: 2 ** 53 })), ['/revision:out-of-range']);
  assert.equal(validateReference({ testId: 'T', revision: 1 }).issues.length, 0);
  assert.deepEqual(codes(validateReference(null)), ['/:not-an-object']);
});

test('an accessor on a reference field is rejected and the getter is never invoked', () => {
  let called = 0;
  const ref = Object.defineProperty({}, 'testId', { get() { called += 1; return 'T'; }, enumerable: true });
  assert.deepEqual(codes(validateReference(ref)), ['/testId:accessor-property']);
  assert.equal(called, 0);
});

test('a non-plain prototype is rejected at the reference level', () => {
  class R { constructor() { this.testId = 'T'; } }
  assert.deepEqual(codes(validateReference(new R())), ['/:not-plain-object']);
});
```

- [x] **Step 2: Run it and see it fail.** `node --test test/clashtest/definition/reference.test.mjs` — expected failure: `Cannot find module '.../clashtest/definition/validate.js'` (ERR_MODULE_NOT_FOUND) for every test.

- [x] **Step 3: Write the minimal implementation.**

```js
// clashtest/definition/validate.js
import { captureData } from '../util/capture.js';
import { ENGINE_LIMIT_DEFAULTS } from '../options.js';

export const DEFINITION_KEYS = Object.freeze([
  'schemaVersion', 'testId', 'revision', 'name', 'description', 'selectionA', 'selectionB', 'mode', 'clearance',
]);
export const REFERENCE_KEYS = Object.freeze(['testId', 'revision']);

export const ISSUE_CODES = Object.freeze([
  // structural (mapped from P0's CAPTURE_CODES, see CAPTURE_TO_ISSUE)
  'not-plain-object', 'unreadable', 'symbol-key', 'accessor-property', 'sparse-array', 'array-extra-key',
  'cyclic', 'too-deep', 'too-many-nodes', 'array-too-long', 'unsupported-schema-version',
  // schema (applied to the detached copy)
  'not-an-object', 'unknown-property', 'missing-required', 'not-a-string', 'not-an-array',
  'string-too-short', 'string-too-long', 'not-an-integer', 'out-of-range', 'not-a-finite-number', 'not-positive',
  'too-many-entries', 'too-many-elements', 'invalid-enum', 'invalid-schema-version',
  'clearance-required', 'clearance-forbidden',
]);

/** P0 `CAPTURE_CODES` -> P2 `ISSUE_CODES` (reconciliation row N4). `array-too-long` is refined by path below. */
const CAPTURE_TO_ISSUE = Object.freeze({
  accessor: 'accessor-property', 'symbol-key': 'symbol-key', 'sparse-array': 'sparse-array',
  'array-extra-key': 'array-extra-key', 'not-plain': 'not-plain-object', cyclic: 'cyclic',
  unreadable: 'unreadable', depth: 'too-deep', 'too-many-nodes': 'too-many-nodes',
  'string-too-long': 'string-too-long', 'array-too-long': 'array-too-long', gated: 'unsupported-schema-version',
});

// Spec 5.1 / V3-V5 field bounds. These are schema constants, not option defaults.
const SCHEMA = Object.freeze({ testId: 256, name: 256, description: 4096, modelKey: 1024 });
const DEFINITION_SCHEMA_VERSION = 1;
const REFERENCE_MAX_NODES = 16;                  // 3 legitimate nodes + headroom so unknown keys are *named*
const ENTRIES_PATH = /^\/selection[AB]\/entries$/;
const DBIDS_PATH = /^\/selection[AB]\/entries\/\d+\/dbIds$/;
const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.hasOwn(o, k);

/** Engine limits P2 reads, filled from P0's defaults (nothing is restated here). */
function limitsOf(limits) {
  return { ...ENGINE_LIMIT_DEFAULTS, ...limits };
}

// An issue collector with a hard cap. `add` returns false once the cap is reached. Reaching the cap
// exactly also reports truncated (conservative, S-P2-4). Messages are schema-derived and NEVER embed a
// caller value; `valueFree` blanks them entirely (13.5 listing pages carry {path, code} only).
function createCollector(maxIssues, { valueFree = false } = {}) {
  const issues = [];
  let truncated = false;
  return {
    issues,
    get truncated() { return truncated; },
    get full() { return issues.length >= maxIssues; },
    add(path, code, message) {
      if (issues.length >= maxIssues) { truncated = true; return false; }
      issues.push({ path, code, message: valueFree ? '' : message });
      if (issues.length >= maxIssues) truncated = true;
      return issues.length < maxIssues;
    },
  };
}

/** Maps one P0 capture issue to a P2 issue. Root pointer '' becomes '/'. */
function mapCaptureIssue({ path, code }, valueFree) {
  let mapped = CAPTURE_TO_ISSUE[code] ?? 'unreadable';
  if (mapped === 'array-too-long') {
    if (ENTRIES_PATH.test(path)) mapped = 'too-many-entries';
    else if (DBIDS_PATH.test(path)) mapped = 'too-many-elements';
  }
  return { path: path === '' ? '/' : path, code: mapped, message: valueFree ? '' : `structural: ${code}` };
}

/**
 * The structural half of the single pass: P0's captureData, then the issue mapping. A non-object root is
 * rejected before any reflection. Returns captureData's shape with P2 issues.
 */
function captureStructural(root, opts, { valueFree = false } = {}) {
  if (root === null || typeof root !== 'object') {
    return { ok: false, issues: [{ path: '/', code: 'not-an-object', message: valueFree ? '' : 'expected an object' }], issuesTruncated: false };
  }
  const result = captureData(root, opts);
  if (result.ok) return result;
  const out = {
    ok: false,
    issues: result.issues.map((i) => mapCaptureIssue(i, valueFree)),
    issuesTruncated: result.issuesTruncated || result.issues.length >= opts.maxIssues,
  };
  if (result.gate) out.gate = result.gate;
  return out;
}

/**
 * captureData options for a definition (P0 Gates item 1). The node ceiling is
 * 16 + 2 x (2 + 4 x maxEntriesPerSelection + maxExplicitElementsPerSelection): per selection one object,
 * one `entries` array, up to four nodes per entry and one node per explicit dbId, plus the scalar fields.
 * `rootGate` fires before anything else is read when `schemaVersion` is an integer > 1 (5.3: a newer
 * schema "is never partially interpreted").
 */
function definitionCaptureOpts(l, maxIssues) {
  return {
    maxNodes: 16 + 2 * (2 + 4 * l.maxEntriesPerSelection + l.maxExplicitElementsPerSelection),
    maxIssues,
    maxStringLength: SCHEMA.description,           // the largest V3 string cap
    maxArrayLength: Math.max(l.maxEntriesPerSelection, l.maxExplicitElementsPerSelection),
    arrayLimitFor: (p) => (ENTRIES_PATH.test(p) ? l.maxEntriesPerSelection
      : DBIDS_PATH.test(p) ? l.maxExplicitElementsPerSelection : undefined),
    rootGate: {
      key: 'schemaVersion',
      check: (v) => !(typeof v === 'number' && Number.isInteger(v) && v > DEFINITION_SCHEMA_VERSION),
    },
  };
}

/**
 * R21-I3. Deterministic, fail-closed overload discrimination for startRun(defOrRef).
 * The argument is captured once (P0 `captureData`, which copies every own key by Reflect.ownKeys,
 * enumerable or not); an object is a REFERENCE iff the copy's key set is exactly {testId} or
 * {testId, revision}. Any other captured object is a DEFINITION and goes through V1-V6. 'invalid' means
 * "not capturable as a plain-data object" (non-object, array, symbol key, accessor, cycle, unreadable,
 * over the node ceiling). Nothing is guessed.
 */
export function classifyStartRunArgument(arg, { limits } = {}) {
  const l = limitsOf(limits);
  const captured = captureStructural(arg, definitionCaptureOpts(l, 8));
  if (!captured.ok) return { kind: 'invalid', issues: captured.issues };
  if (Array.isArray(captured.value)) {
    return { kind: 'invalid', issues: [{ path: '/', code: 'not-an-object', message: 'expected an object' }] };
  }
  const keys = Object.keys(captured.value);
  const isReference = keys.length >= 1 && keys.length <= 2
    && keys.includes('testId')
    && keys.every((k) => REFERENCE_KEYS.includes(k));
  return { kind: isReference ? 'reference' : 'definition', issues: [] };
}

/** The closed ClashTestReference schema: R1 shape, R2 testId, R3 revision. Capture, then validate the copy. */
export function validateReference(ref, { limits } = {}) {
  const l = limitsOf(limits);
  const cap = captureStructural(ref, {
    maxNodes: REFERENCE_MAX_NODES, maxIssues: l.maxValidationIssues, maxStringLength: SCHEMA.testId,
  });
  if (!cap.ok) return { issues: cap.issues, issuesTruncated: cap.issuesTruncated, captured: null };
  const c = createCollector(l.maxValidationIssues);
  const copy = cap.value;
  if (!isRecord(copy)) {
    c.add('/', 'not-an-object', 'expected an object');
    return { issues: c.issues, issuesTruncated: c.truncated, captured: null };
  }
  for (const k of Object.keys(copy)) {
    if (!REFERENCE_KEYS.includes(k)) c.add(`/${esc(k)}`, 'unknown-property', 'not a reference field');
  }
  if (!has(copy, 'testId')) c.add('/testId', 'missing-required', 'testId is required');
  else if (typeof copy.testId !== 'string') c.add('/testId', 'not-a-string', 'testId must be a string');
  else if (copy.testId.length < 1) c.add('/testId', 'string-too-short', 'testId must be 1-256 code units');
  else if (copy.testId.length > SCHEMA.testId) c.add('/testId', 'string-too-long', 'testId must be 1-256 code units');
  if (has(copy, 'revision')) {
    const r = copy.revision;
    if (typeof r !== 'number' || !Number.isInteger(r)) c.add('/revision', 'not-an-integer', 'revision must be an integer');
    else if (r < 1 || r > Number.MAX_SAFE_INTEGER) c.add('/revision', 'out-of-range', 'revision must be 1..2^53-1');
  }
  const captured = c.issues.length === 0 ? { testId: copy.testId, revision: has(copy, 'revision') ? copy.revision : null } : null;
  return { issues: c.issues, issuesTruncated: c.truncated, captured };
}
```

- [x] **Step 4: Run it and see it pass.** `node --test test/clashtest/definition/reference.test.mjs` — expected: all 9 tests pass.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits).** Message: `feat(clashtest): add ClashTestReference schema and startRun overload discrimination (R21-I3)`.

---

### Task P2.2: The single capture-and-validate pass — validation matrix V1–V6

**Files**
- Modify: `clashtest/definition/validate.js`
- Create: `test/clashtest/support/definitions.mjs`
- Modify: `test/clashtest/support/index.mjs` (append `export * from './definitions.mjs';`)
- Test: `test/clashtest/definition/validate.test.mjs`

**Interfaces**
- Consumes: `captureData` and `ENGINE_LIMIT_DEFAULTS` (P0, as in P2.1); `createCollector` / `captureStructural` / `definitionCaptureOpts` / `limitsOf` from P2.1.
- Consumes (**P1 `clashtest/identity/ids.js`**, reconciliation row N7 — a REAL dependency edge): `CLASH_MODES`, the four modes and the **sole code home of the mode list**. V6's "`mode` ∈ the four modes" is `CLASH_MODES.includes(d.mode)`; P2 restates no mode. `pairSemanticsOf` (same module) is not called by the validator — a definition never carries `pairSemantics`, so a caller-supplied one is simply an `unknown-property` (§4.5: semantics are derived from `mode`, never supplied) — and is used only by the P2.2 test that pins "every accepted mode has derived semantics".
- Produces: `captureAndValidate(def, {limits}) → {issues, issuesTruncated, captured, gate?}`, `validateTest`.

**The walk (deterministic order, one capture then one schema pass).** (1) `captureData` over the caller's value with the options of `definitionCaptureOpts` — the structural issues (`accessor-property`, `symbol-key`, `sparse-array`, `array-extra-key`, `not-plain-object`, `cyclic`, `too-deep`, `too-many-nodes`, `array-too-long`→`too-many-entries`/`too-many-elements`, `string-too-long`, `unreadable`, and the schemaVersion gate) come back in `captureData`'s traversal order and, if there are any, **the schema pass is not run** (a structurally unsound value is never interpreted); (2) on the detached copy: top-level shape; unknown own keys, in the order the copy holds them (= the order `Reflect.ownKeys` reported them); (3) each schema key in `DEFINITION_KEYS` order, a missing required key reported at its turn; (4) within a selection, `entries` in index order and each entry's fields in the fixed order `kind, modelKey, dbIds`. **A cycle needs no special handling:** `captureData` reports a revisited object as `cyclic`, and the schema walk's depth is fixed by the schema, so it never recurses.

**Node ceiling and the over-cap arrays.** `captureData`'s `maxNodes` is `16 + 2 × (2 + 4 × maxEntriesPerSelection + maxExplicitElementsPerSelection)` (P0 Gates item 1). `arrayLimitFor` gives `…/entries` the entry cap and `…/dbIds` the explicit-element cap, so an over-cap array is rejected **before any element is read or allocated** — the O(1) property V5 requires — and the per-selection running total of explicit dbIds is then a schema check on the copy.

**`schemaVersion` split (resolving an under-specification, not a redesign).** §5.3 requires a *distinct* `UnsupportedSchemaVersionError` for "a `schemaVersion` greater than the engine understands ... never partially interpreted", while V2 requires "exactly `1`". These are different failures, so the code is split, and the first is a **P0 `rootGate`**: an integer `> 1` at the root's `schemaVersion` stops capture at once with the single issue `unsupported-schema-version` and **no other property is read** (`result.gate = {key:'schemaVersion', value}`). Any other non-`1` value (`0`, `1.5`, `'1'`, `null`, missing) is validated on the copy as `invalid-schema-version` / `missing-required`. Only the first can become `UnsupportedSchemaVersionError` (task P2.3), and — because the gate reads nothing else — it is always the *only* issue.

**Rule table (schema + rule; rows are the complete V-matrix of §5.3).** "Layer" says whether `captureData` (structure) or the schema pass on the copy emits the code.

| Rule | Path(s) | Rule | Issue codes emitted (layer) |
|---|---|---|---|
| V1 | `/`, every nested object/array | plain object (prototype `Object.prototype` or `null`), own data properties only, no symbol keys, no accessors; arrays are real `Array`s, hole-free, with no extra own keys; unknown properties rejected at every level; reflection failure reported, never rethrown; bounded depth and node count | structure: `not-plain-object`, `symbol-key`, `accessor-property`, `sparse-array`, `array-extra-key`, `cyclic`, `too-deep`, `too-many-nodes`, `unreadable`; schema: `not-an-object`, `unknown-property`, `missing-required`, `not-an-array` |
| V2 | `/schemaVersion` | exactly `1`; integer `> 1` is the distinct unsupported case | structure (gate): `unsupported-schema-version`; schema: `invalid-schema-version` |
| V3 | `/testId`, `/revision`, `/name`, `/description` | `testId` string 1–256; `revision` integer 1…2^53−1; `name` string 1–256; `description` string ≤ 4096 when present | schema: `not-a-string`, `string-too-short`, `string-too-long`, `not-an-integer`, `out-of-range` (structure also emits `string-too-long` above 4096) |
| V4 | `/selectionA`, `/selectionB`, `…/entries[i]` | `{entries: SelectionEntry[]}` with `1 ≤ length ≤ limits.maxEntriesPerSelection`; each entry exactly `{kind:'model', modelKey}` or `{kind:'elements', modelKey, dbIds}` | structure: `too-many-entries` (over-cap); schema: `out-of-range` (empty), `invalid-enum`, `unknown-property`, `missing-required` |
| V5 | `…/entries[i]/modelKey`, `…/dbIds` | `modelKey` string 1–1024; `dbIds` non-empty array of non-negative safe integers; running total per selection ≤ `limits.maxExplicitElementsPerSelection`; **an over-cap array is rejected before its elements are read** | structure: `too-many-elements` (over-cap array); schema: `not-a-string`, `string-too-short`, `string-too-long`, `not-an-array`, `not-an-integer`, `out-of-range`, `too-many-elements` (running total) |
| V6 | `/mode`, `/clearance` | `mode` ∈ `CLASH_MODES` (P1); `clearance` present **iff** `mode === 'clearance'`, and then a finite number `> 0`. No default clearance exists | schema: `invalid-enum`, `clearance-required`, `clearance-forbidden`, `not-a-finite-number` (a non-number), `not-positive`; a `NaN`/`±Infinity` never survives capture and is reported there as `not-plain-object` |

- [x] **Step 1: Write the failing matrix test.**

```js
// test/clashtest/support/definitions.mjs
export function makeDefinition(overrides = {}) {
  return {
    schemaVersion: 1,
    testId: 'T1',
    revision: 1,
    name: 'structure vs mep',
    selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [2, 1] }] },
    selectionB: { entries: [{ kind: 'model', modelKey: 'mB' }] },
    mode: 'volume-overlap',
    ...overrides,
  };
}
```

```js
// test/clashtest/definition/validate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureAndValidate, validateTest, ISSUE_CODES } from '../../../clashtest/definition/validate.js';
import { CAPTURE_CODES } from '../../../clashtest/util/capture.js';
import { CLASH_MODES, pairSemanticsOf } from '../../../clashtest/identity/ids.js';
import { makeDefinition } from '../support/definitions.mjs';

const codes = (r) => r.issues.map((i) => `${i.path}:${i.code}`);

test('a valid definition yields no issues and a detached capture', () => {
  const def = makeDefinition();
  const r = captureAndValidate(def);
  assert.deepEqual(r.issues, []);
  assert.equal(r.issuesTruncated, false);
  assert.notEqual(r.captured, def);
  assert.notEqual(r.captured.selectionA.entries[0].dbIds, def.selectionA.entries[0].dbIds);
  assert.deepEqual(r.captured.selectionA.entries[0].dbIds, [2, 1]); // capture does NOT normalize
});

test('V-matrix: every rule has an accept and a reject case', () => {
  const rows = [
    ['V2 wrong version',   { schemaVersion: 0 },                       ['/schemaVersion:invalid-schema-version']],
    ['V2 string version',  { schemaVersion: '1' },                     ['/schemaVersion:invalid-schema-version']],
    ['V2 newer version',   { schemaVersion: 2 },                       ['/schemaVersion:unsupported-schema-version']],
    ['V3 fractional rev',  { revision: 1.5 },                          ['/revision:not-an-integer']],
    ['V3 null name',       { name: null },                             ['/name:not-a-string']],
    ['V3 long description',{ description: 'x'.repeat(4097) },          ['/description:string-too-long']],
    ['V4 empty entries',   { selectionA: { entries: [] } },            ['/selectionA/entries:out-of-range']],
    ['V4 bad kind',        { selectionA: { entries: [{ kind: 'nope', modelKey: 'm' }] } },
                           ['/selectionA/entries/0/kind:invalid-enum']],
    ['V4 model+dbIds',     { selectionA: { entries: [{ kind: 'model', modelKey: 'm', dbIds: [1] }] } },
                           ['/selectionA/entries/0/dbIds:unknown-property']],
    ['V5 negative dbId',   { selectionA: { entries: [{ kind: 'elements', modelKey: 'm', dbIds: [-1] }] } },
                           ['/selectionA/entries/0/dbIds/0:out-of-range']],
    ['V6 bad mode',        { mode: 'nope' },                           ['/mode:invalid-enum']],
    ['V6 clearance missing', { mode: 'clearance' },                    ['/clearance:clearance-required']],
    ['V6 clearance extra', { clearance: 1 },                           ['/clearance:clearance-forbidden']],
    ['V6 clearance zero',  { mode: 'clearance', clearance: 0 },        ['/clearance:not-positive']],
    ['V6 clearance string', { mode: 'clearance', clearance: '1' },     ['/clearance:not-a-finite-number']],
    // a non-finite number never survives structural capture: P0 reports it as `not-plain` -> `not-plain-object`
    ['V6 clearance NaN',   { mode: 'clearance', clearance: NaN },      ['/clearance:not-plain-object']],
    ['V1 unknown nested',  { selectionA: { entries: [{ kind: 'model', modelKey: 'm' }], extra: 1 } },
                           ['/selectionA/extra:unknown-property']],
    ['V1 pairSemantics',   { pairSemantics: 'unordered' },             ['/pairSemantics:unknown-property']],
  ];
  for (const [label, override, expected] of rows) {
    assert.deepEqual(codes(captureAndValidate(makeDefinition(override))), expected, label);
    assert.equal(captureAndValidate(makeDefinition(override)).captured, null, `${label} captured`);
  }
  // accept case for the clearance mode
  assert.deepEqual(codes(captureAndValidate(makeDefinition({ mode: 'clearance', clearance: 0.05 }))), []);
});

test('the mode list is P1\'s CLASH_MODES: every mode is accepted and has derived pair semantics (4.5)', () => {
  for (const mode of CLASH_MODES) {
    const o = mode === 'clearance' ? { mode, clearance: 0.05 } : { mode };
    assert.deepEqual(codes(captureAndValidate(makeDefinition(o))), [], mode);
    assert.ok(['ordered', 'unordered'].includes(pairSemanticsOf(mode)), mode);
  }
});

test('every P0 CAPTURE_CODE maps to a code in ISSUE_CODES (reconciliation N4)', () => {
  const ones = (n) => Array.from({ length: n }, () => 1);
  const deep = (n) => { let v = 1; for (let i = 0; i < n; i += 1) v = { c: v }; return v; };
  const cyc = makeDefinition(); cyc.selectionA.entries[0].self = cyc;
  const extra = makeDefinition(); extra.selectionA.entries.note = 'x';
  const rows = {
    accessor: [Object.defineProperty(makeDefinition(), 'mode', { get: () => 'volume-overlap', enumerable: true }), 'accessor-property'],
    'symbol-key': [{ ...makeDefinition(), [Symbol('s')]: 1 }, 'symbol-key'],
    'sparse-array': [makeDefinition({ selectionA: { entries: [{ kind: 'elements', modelKey: 'm', dbIds: [1, , 3] }] } }), 'sparse-array'], // eslint-disable-line no-sparse-arrays
    'array-extra-key': [extra, 'array-extra-key'],
    'not-plain': [makeDefinition({ name: undefined }), 'not-plain-object'],
    cyclic: [cyc, 'cyclic'],
    unreadable: [makeDefinition({ selectionA: new Proxy({}, { ownKeys() { throw new Error('boom'); } }) }), 'unreadable'],
    depth: [makeDefinition({ name: deep(70) }), 'too-deep'],
    'too-many-nodes': [makeDefinition({ name: [ones(9000), ones(9000), ones(9000), ones(9000)] }), 'too-many-nodes'],
    'string-too-long': [makeDefinition({ name: 'x'.repeat(5000) }), 'string-too-long'],
    'array-too-long': [makeDefinition({ name: ones(10001) }), 'array-too-long'],
    gated: [makeDefinition({ schemaVersion: 3 }), 'unsupported-schema-version'],
  };
  assert.deepEqual(Object.keys(rows).sort(), [...CAPTURE_CODES].sort(), 'a row for every P0 capture code');
  for (const [captureCode, [input, expected]] of Object.entries(rows)) {
    const r = captureAndValidate(input);
    assert.ok(r.issues.some((i) => i.code === expected), `${captureCode} -> ${expected} (got ${codes(r)})`);
    for (const i of r.issues) assert.ok(ISSUE_CODES.includes(i.code), `${captureCode}: ${i.code} is not in ISSUE_CODES`);
  }
});

test('a missing required key is reported once, in DEFINITION_KEYS order', () => {
  const def = makeDefinition();
  delete def.name;
  delete def.selectionB;
  assert.deepEqual(codes(captureAndValidate(def)), ['/name:missing-required', '/selectionB:missing-required']);
});

test('V1 rejects sparse arrays, extra array own keys and non-plain nesting (structural, via captureData)', () => {
  const sparse = makeDefinition();
  sparse.selectionA.entries[0].dbIds = [1, , 3]; // eslint-disable-line no-sparse-arrays
  assert.deepEqual(codes(captureAndValidate(sparse)), ['/selectionA/entries/0/dbIds/1:sparse-array']);

  const extra = makeDefinition();
  extra.selectionA.entries.note = 'x';
  assert.deepEqual(codes(captureAndValidate(extra)), ['/selectionA/entries:array-extra-key']);

  const proto = makeDefinition({ selectionA: Object.create({ entries: [] }) });
  assert.deepEqual(codes(captureAndValidate(proto)), ['/selectionA:not-plain-object']);
});

test('all schema issues are collected in one pass, not just the first', () => {
  const r = captureAndValidate(makeDefinition({ revision: 0, name: '', mode: 'nope' }));
  assert.deepEqual(codes(r), ['/revision:out-of-range', '/name:string-too-short', '/mode:invalid-enum']);
});

test('structural issues are reported first and the schema is not run on a structurally unsound value', () => {
  const r = captureAndValidate(makeDefinition({ mode: 'nope', name: undefined }));
  assert.deepEqual(codes(r), ['/name:not-plain-object']);   // the schema issue for /mode is NOT reported yet
});

test('the issue list is capped and reports issuesTruncated', () => {
  const entries = Array.from({ length: 40 }, () => ({ kind: 'bad', modelKey: 'm' }));
  const r = captureAndValidate(makeDefinition({ selectionA: { entries } }), { limits: { maxValidationIssues: 10 } });
  assert.equal(r.issues.length, 10);
  assert.equal(r.issuesTruncated, true);
  assert.equal(r.captured, null);
});

test('an over-cap dbIds array is rejected without scanning its elements', () => {
  const dbIds = new Proxy([], {
    get(t, k) { if (k === 'length') return 20000; throw new Error('element read'); },
    getOwnPropertyDescriptor(t, k) {
      if (k === 'length') return { value: 20000, writable: true, enumerable: false, configurable: false };
      throw new Error('element read');
    },
    ownKeys() { return ['length']; },
  });
  const r = captureAndValidate(makeDefinition({
    selectionA: { entries: [{ kind: 'elements', modelKey: 'm', dbIds }] },
  }), { limits: { maxExplicitElementsPerSelection: 10000 } });
  assert.deepEqual(codes(r), ['/selectionA/entries/0/dbIds:too-many-elements']);
});

test('the running explicit-element total per selection is enforced across entries', () => {
  const limits = { maxExplicitElementsPerSelection: 4 };
  const two = (m) => ({ kind: 'elements', modelKey: m, dbIds: [1, 2, 3] });
  const r = captureAndValidate(makeDefinition({ selectionA: { entries: [two('a'), two('b')] } }), { limits });
  assert.deepEqual(codes(r), ['/selectionA/entries/1/dbIds:too-many-elements']);
});

test('a cyclic structure is a structural issue, never a stack overflow', () => {
  const def = makeDefinition();
  def.selectionA.entries[0].self = def;
  assert.deepEqual(codes(captureAndValidate(def)), ['/selectionA/entries/0/self:cyclic']);
});

test('a newer schemaVersion stops at the gate: one issue, and nothing else is read', () => {
  let calls = 0;
  const def = makeDefinition({ schemaVersion: 9, mode: 'nope' });
  Object.defineProperty(def, 'trap', { get() { calls += 1; return 1; }, enumerable: true });
  const r = captureAndValidate(def);
  assert.deepEqual(codes(r), ['/schemaVersion:unsupported-schema-version']);
  assert.deepEqual(r.gate, { key: 'schemaVersion', value: 9 });
  assert.equal(calls, 0);
});

test('-0 is normalized to 0 in the capture (5.4 needs it before digesting)', () => {
  const r = captureAndValidate(makeDefinition({ selectionA: { entries: [{ kind: 'elements', modelKey: 'm', dbIds: [-0, 1] }] } }));
  assert.equal(Object.is(r.captured.selectionA.entries[0].dbIds[0], 0), true);
});

test('validateTest returns the same issues and no capture', () => {
  const def = makeDefinition({ mode: 'nope' });
  const v = validateTest(def);
  assert.deepEqual(v, { issues: captureAndValidate(def).issues, issuesTruncated: false });
  assert.equal('captured' in v, false);
});

```

- [x] **Step 2: Run it and see it fail.** `node --test test/clashtest/definition/validate.test.mjs` — expected failure: `SyntaxError: The requested module '../../../clashtest/definition/validate.js' does not provide an export named 'captureAndValidate'` (the module exists from P2.1 but exports neither `captureAndValidate` nor `validateTest`).

- [x] **Step 3: Write the minimal implementation.** Add `import { CLASH_MODES } from '../identity/ids.js';` to the import block at the top of `clashtest/definition/validate.js`, then append:

```js
const ENTRY_KEYS_MODEL = Object.freeze(['kind', 'modelKey']);
const ENTRY_KEYS_ELEMENTS = Object.freeze(['kind', 'modelKey', 'dbIds']);

/** Schema check for one string field of the copy. Returns nothing; issues go to the collector. */
function checkString(obj, key, path, c, min, max, required) {
  if (!has(obj, key)) { if (required) c.add(path, 'missing-required', 'required'); return; }
  const v = obj[key];
  if (typeof v !== 'string') c.add(path, 'not-a-string', 'must be a string');
  else if (v.length < min) c.add(path, 'string-too-short', 'below the minimum length');
  else if (v.length > max) c.add(path, 'string-too-long', 'above the maximum length');
}

function checkDbIds(dbIds, path, c, budget) {
  if (!Array.isArray(dbIds)) { c.add(path, 'not-an-array', 'must be an array'); return; }
  if (dbIds.length < 1) { c.add(path, 'out-of-range', 'dbIds must be non-empty'); return; }
  budget.remaining -= dbIds.length;
  if (budget.remaining < 0) { c.add(path, 'too-many-elements', 'over maxExplicitElementsPerSelection'); return; }
  for (let i = 0; i < dbIds.length && !c.full; i += 1) {
    const v = dbIds[i];
    if (typeof v !== 'number' || !Number.isInteger(v)) c.add(`${path}/${i}`, 'not-an-integer', 'must be an integer');
    else if (v < 0 || v > Number.MAX_SAFE_INTEGER) c.add(`${path}/${i}`, 'out-of-range', 'must be a non-negative safe integer');
    else if (v === 0) dbIds[i] = 0;                       // -0 normalized in the copy (5.4 needs it before digesting)
  }
}

function checkSelection(sel, path, c, l) {
  if (!isRecord(sel)) { c.add(path, 'not-an-object', 'expected an object'); return; }
  for (const k of Object.keys(sel)) {
    if (k !== 'entries') c.add(`${path}/${esc(k)}`, 'unknown-property', 'not a selection field');
  }
  const entriesPath = `${path}/entries`;
  if (!has(sel, 'entries')) { c.add(entriesPath, 'missing-required', 'required'); return; }
  const entries = sel.entries;
  if (!Array.isArray(entries)) { c.add(entriesPath, 'not-an-array', 'must be an array'); return; }
  if (entries.length < 1) { c.add(entriesPath, 'out-of-range', 'entries must be non-empty'); return; }
  const budget = { remaining: l.maxExplicitElementsPerSelection };
  for (let i = 0; i < entries.length && !c.full; i += 1) {
    const ep = `${entriesPath}/${i}`;
    const entry = entries[i];
    if (!isRecord(entry)) { c.add(ep, 'not-an-object', 'expected an object'); continue; }
    if (!has(entry, 'kind')) { c.add(`${ep}/kind`, 'missing-required', 'required'); continue; }
    if (entry.kind !== 'model' && entry.kind !== 'elements') { c.add(`${ep}/kind`, 'invalid-enum', 'kind must be model or elements'); continue; }
    const allowed = entry.kind === 'model' ? ENTRY_KEYS_MODEL : ENTRY_KEYS_ELEMENTS;
    for (const k of Object.keys(entry)) {
      if (!allowed.includes(k)) c.add(`${ep}/${esc(k)}`, 'unknown-property', 'not an entry field for this kind');
    }
    checkString(entry, 'modelKey', `${ep}/modelKey`, c, 1, SCHEMA.modelKey, true);
    if (entry.kind === 'elements') {
      if (!has(entry, 'dbIds')) c.add(`${ep}/dbIds`, 'missing-required', 'required');
      else checkDbIds(entry.dbIds, `${ep}/dbIds`, c, budget);
    }
  }
}

/** V1-V6 over the detached copy. Order: unknown keys (caller's key order), then the fields in DEFINITION_KEYS order. */
function checkDefinition(d, c, l) {
  if (!isRecord(d)) { c.add('/', 'not-an-object', 'expected an object'); return; }
  for (const k of Object.keys(d)) {
    if (!DEFINITION_KEYS.includes(k)) c.add(`/${esc(k)}`, 'unknown-property', 'not a definition field');
  }
  // V2 -- an integer > 1 never reaches here: P0's rootGate stopped capture with `unsupported-schema-version`
  if (!has(d, 'schemaVersion')) c.add('/schemaVersion', 'missing-required', 'required');
  else if (d.schemaVersion !== DEFINITION_SCHEMA_VERSION) c.add('/schemaVersion', 'invalid-schema-version', 'schemaVersion must be 1');
  // V3
  checkString(d, 'testId', '/testId', c, 1, SCHEMA.testId, true);
  if (!has(d, 'revision')) c.add('/revision', 'missing-required', 'required');
  else if (typeof d.revision !== 'number' || !Number.isInteger(d.revision)) c.add('/revision', 'not-an-integer', 'must be an integer');
  else if (d.revision < 1 || d.revision > Number.MAX_SAFE_INTEGER) c.add('/revision', 'out-of-range', 'outside the permitted range');
  checkString(d, 'name', '/name', c, 1, SCHEMA.name, true);
  if (has(d, 'description')) checkString(d, 'description', '/description', c, 0, SCHEMA.description, false);
  // V4 + V5
  for (const side of ['selectionA', 'selectionB']) {
    if (!has(d, side)) c.add(`/${side}`, 'missing-required', 'required');
    else checkSelection(d[side], `/${side}`, c, l);
  }
  // V6 -- the mode list is P1's (`CLASH_MODES`); a caller-supplied `pairSemantics` is an unknown key (4.5)
  let mode;
  if (!has(d, 'mode')) c.add('/mode', 'missing-required', 'required');
  else if (!CLASH_MODES.includes(d.mode)) c.add('/mode', 'invalid-enum', 'mode must be one of the four library modes');
  else mode = d.mode;
  if (mode === 'clearance' && !has(d, 'clearance')) {
    c.add('/clearance', 'clearance-required', 'clearance mode requires a clearance');
  } else if (mode !== undefined && mode !== 'clearance' && has(d, 'clearance')) {
    c.add('/clearance', 'clearance-forbidden', 'clearance is forbidden outside clearance mode');
  } else if (has(d, 'clearance')) {
    if (typeof d.clearance !== 'number') c.add('/clearance', 'not-a-finite-number', 'clearance must be a finite number');
    else if (!(d.clearance > 0)) c.add('/clearance', 'not-positive', 'clearance must be greater than zero');
  }
}

/**
 * The ONE synchronous capture-and-validate pass (5.3), realised as P0's `captureData` (structure) followed
 * by V1-V6 on the copy (schema). `captured` is that detached copy, non-null iff `issues` is empty. `gate`
 * is present iff capture stopped at the schemaVersion gate (it carries the offending value for
 * `toDefinitionError`).
 */
export function captureAndValidate(def, { limits } = {}) {
  const l = limitsOf(limits);
  const cap = captureStructural(def, definitionCaptureOpts(l, l.maxValidationIssues));
  if (!cap.ok) {
    const out = { issues: cap.issues, issuesTruncated: cap.issuesTruncated, captured: null };
    if (cap.gate) out.gate = cap.gate;
    return out;
  }
  const c = createCollector(l.maxValidationIssues);
  checkDefinition(cap.value, c, l);
  return { issues: c.issues, issuesTruncated: c.truncated, captured: c.issues.length === 0 ? cap.value : null };
}

/** Pure; never throws for a data error (5.3, R16 Q1). */
export function validateTest(def, opts) {
  const { issues, issuesTruncated } = captureAndValidate(def, opts);
  return { issues, issuesTruncated };
}
```

- [x] **Step 4: Run it and see it pass.** `node --test test/clashtest/definition/validate.test.mjs` — expected: all 15 tests pass.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits).** Message: `feat(clashtest): add the single capture-and-validate pass for ClashTestDefinition (V1-V6)`.

---

### Task P2.3: Error mapping and the `validateTest`-never-throws guarantee

**Files**
- Modify: `clashtest/definition/validate.js`
- Test: `test/clashtest/definition/validate.test.mjs` (append)

**Interfaces**
- Consumes (**P0 `clashtest/errors.js`**, row N1 — one object argument): `InvalidTestDefinitionError({issues, issuesTruncated})`; `UnsupportedSchemaVersionError({type, schemaVersion, supported})` (P0 keeps `schemaVersion` only if it is a number or a short string). `error.name` is the class name.
- Consumes: `result.gate` from P2.2 (`{key:'schemaVersion', value}`), which is where the offending version comes from.
- Produces: `toDefinitionError(result) → Error`.

- [x] **Step 1: Write the failing test.**

```js
// append to test/clashtest/definition/validate.test.mjs (add `toDefinitionError` to the validate.js import)
import { toDefinitionError } from '../../../clashtest/definition/validate.js';

test('toDefinitionError picks UnsupportedSchemaVersionError only when that is the ONLY issue', () => {
  const only = toDefinitionError(captureAndValidate(makeDefinition({ schemaVersion: 9 })));
  assert.equal(only.name, 'UnsupportedSchemaVersionError');
  assert.equal(only.type, 'ClashTestDefinition');
  assert.equal(only.schemaVersion, 9);
  assert.equal(only.supported, 1);

  const mixed = toDefinitionError({
    issues: [
      { path: '/schemaVersion', code: 'unsupported-schema-version', message: 'x' },
      { path: '/mode', code: 'invalid-enum', message: 'x' },
    ],
    issuesTruncated: false,
  });
  assert.equal(mixed.name, 'InvalidTestDefinitionError');
  assert.equal(mixed.issues.length, 2);
  assert.equal(mixed.issuesTruncated, false);
});

test('toDefinitionError carries issuesTruncated through', () => {
  const entries = Array.from({ length: 40 }, () => ({ kind: 'bad', modelKey: 'm' }));
  const r = captureAndValidate(makeDefinition({ selectionA: { entries } }), { limits: { maxValidationIssues: 5 } });
  const err = toDefinitionError(r);
  assert.equal(err.issuesTruncated, true);
  assert.equal(err.issues.length, 5);
});

test('validateTest never throws for a data error, whatever the input', () => {
  const hostile = [
    null, undefined, 7, 'x', [], () => {},
    new Proxy({}, { ownKeys() { throw new Error('boom'); } }),
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('boom'); } }),
    (() => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; })(),
    Object.defineProperty(makeDefinition(), 'mode', { get() { throw new Error('boom'); }, configurable: true }),
  ];
  for (const [index, input] of hostile.entries()) {
    const r = validateTest(input);
    assert.ok(Array.isArray(r.issues) && r.issues.length > 0, `issues for hostile input #${index}`);
    assert.equal(typeof r.issuesTruncated, 'boolean');
  }
});

test('issue messages never embed a caller value', () => {
  const secret = 'S'.repeat(300);
  const r = captureAndValidate(makeDefinition({ name: secret }));
  assert.deepEqual(codes(r), ['/name:string-too-long']);
  assert.equal(r.issues[0].message.includes('S'.repeat(10)), false);
});
```

- [x] **Step 2: Run it and see it fail.** `node --test test/clashtest/definition/validate.test.mjs` — expected failure: `SyntaxError ... does not provide an export named 'toDefinitionError'` (the whole file fails to load until P2.3 step 3).

- [x] **Step 3: Write the minimal implementation.** Add `import { InvalidTestDefinitionError, UnsupportedSchemaVersionError } from '../errors.js';` to the import block at the top of `clashtest/definition/validate.js`, then append:

```js
/** 5.3: UnsupportedSchemaVersionError iff `unsupported-schema-version` is the ONLY issue. Object-argument errors (P0 N1). */
export function toDefinitionError({ issues, issuesTruncated, gate }) {
  if (issues.length === 1 && issues[0].code === 'unsupported-schema-version') {
    return new UnsupportedSchemaVersionError({
      type: 'ClashTestDefinition', schemaVersion: gate ? gate.value : null, supported: DEFINITION_SCHEMA_VERSION,
    });
  }
  return new InvalidTestDefinitionError({ issues, issuesTruncated });
}
```

- [x] **Step 4: Run it and see it pass.** `node --test test/clashtest/definition/validate.test.mjs` — expected: all 19 tests pass.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits).** Message: `feat(clashtest): map validation results to InvalidTestDefinitionError / UnsupportedSchemaVersionError`.

---

> **Superseded by the P2 independent-review remediation (2026-09-21).** The P2.4, P2.5, P2.8 and P2.9 code blocks below are superseded where the implementation differs: the model-key sort is the sliced generator merge sort (H2), the three roots-contract helpers are shared generator bodies with `*Sliced` forms (H1), and `prepareDefinition` / `createDefinitionOperations` accept and forward an optional `spanRecorder` with the digest span labelled `'semanticDigest'` (H3). Authority: [`docs/reviews/2026-09-21-federated-clash-test-core-p2-independent-review-adjudication.md`](../../../reviews/2026-09-21-federated-clash-test-core-p2-independent-review-adjudication.md).

### Task P2.4: Normalization, canonical form and `semanticDigest`

**Files**
- Create: `clashtest/definition/normalize.js`
- Test: `test/clashtest/definition/normalize.test.mjs`

**Interfaces**
- Consumes (**P0 `clashtest/util/canonical.js`**, reconciliation row N5): `digestCanonical(value) → 'sha256:' + lowercase hex` — **synchronous and value-taking**: it canonicalizes (`canonicalJson`: keys sorted by UTF-16 code-unit order, no insignificant whitespace, ES2019 well-formed string escaping, shortest round-trip finite numbers, `-0` → `0`) and hashes the UTF-8 bytes in one call. `computeSemanticDigest(normalized)` is exactly `digestCanonical(canonicalSemanticForm(normalized))` — one value-taking call, not a canonicalize-then-hash-the-text pair. (P0's `sha256Text(text)` is the text-taking form; P2 does not need it.) `canonicalJson` is imported by the test only, to pin the canonical bytes.
- Consumes: `captureAndValidate` (P2.2) — `normalizeDefinition`'s input is always a `captured` value.
- Produces: `normalizeDefinition`, `canonicalSemanticForm`, `computeSemanticDigest`.

**Normalization rules (§5.2, §5.3), applied per selection:** merge entries by `modelKey`; a `model` entry wins over every `elements` entry for that key; `elements` entries for one key union their `dbIds`; each surviving `dbIds` list is de-duplicated and sorted ascending numerically; entries are ordered ascending by `modelKey` in code-unit order, **one entry per model**. The body is written **once**, as a generator (`normalizeSteps`) that yields between entries: `normalizeDefinition` drives it synchronously here, and P2.5's `prepareDefinition` drives the same generator with `slicer.tick()` at each yield — so the sync and sliced results cannot drift.

**Canonical semantic form (§5.4):** `{mode, clearance?, selectionA, selectionB}` — `name`, `description`, `revision`, `testId` and `schemaVersion` are excluded; `clearance` is present iff `mode === 'clearance'`. Role tagging needs no extra machinery: the keys `selectionA` and `selectionB` are themselves the role tags, so swapping the two selections changes the canonical JSON (and hence the digest) for every mode, exactly as §5.4 requires.

- [x] **Step 1: Write the failing test.** The golden vectors below are real SHA-256 values over the canonical JSON; they are the byte-level anchor AC-1 asks for. (They were re-derived against an executable copy of P0's `canonicalJson` / `digestCanonical`; if P0's encoder ever produces different bytes, P0 has the defect, not P2.)

```js
// test/clashtest/definition/normalize.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureAndValidate } from '../../../clashtest/definition/validate.js';
import { normalizeDefinition, canonicalSemanticForm, computeSemanticDigest } from '../../../clashtest/definition/normalize.js';
import { canonicalJson } from '../../../clashtest/util/canonical.js';
import { makeDefinition } from '../support/definitions.mjs';

const prep = (o) => normalizeDefinition(captureAndValidate(makeDefinition(o)).captured);

test('dbIds are de-duplicated and sorted; entries are merged and ordered by modelKey', () => {
  const n = prep({
    selectionA: { entries: [
      { kind: 'elements', modelKey: 'mB', dbIds: [5, 1, 5] },
      { kind: 'elements', modelKey: 'mA', dbIds: [3] },
      { kind: 'elements', modelKey: 'mA', dbIds: [2, 3] },
    ] },
  });
  assert.deepEqual(n.selectionA.entries, [
    { kind: 'elements', modelKey: 'mA', dbIds: [2, 3] },
    { kind: 'elements', modelKey: 'mB', dbIds: [1, 5] },
  ]);
});

test('a model entry wins over elements entries for the same modelKey', () => {
  const n = prep({
    selectionA: { entries: [
      { kind: 'elements', modelKey: 'mA', dbIds: [1] },
      { kind: 'model', modelKey: 'mA' },
    ] },
  });
  assert.deepEqual(n.selectionA.entries, [{ kind: 'model', modelKey: 'mA' }]);
});

test('modelKey ordering is code-unit order, not locale order', () => {
  const n = prep({
    selectionA: { entries: [
      { kind: 'model', modelKey: 'a' }, { kind: 'model', modelKey: 'B' }, { kind: 'model', modelKey: 'Z' },
    ] },
  });
  assert.deepEqual(n.selectionA.entries.map((e) => e.modelKey), ['B', 'Z', 'a']);
});

test('semanticDigest is invariant under key order, whitespace, name, description and revision', () => {
  const base = computeSemanticDigest(prep({}));
  assert.equal(computeSemanticDigest(prep({ name: 'other name' })), base);
  assert.equal(computeSemanticDigest(prep({ description: 'notes' })), base);
  assert.equal(computeSemanticDigest(prep({ revision: 97 })), base);
  assert.equal(computeSemanticDigest(prep({ testId: 'T-other' })), base);
  const reordered = normalizeDefinition(captureAndValidate({
    mode: 'volume-overlap', selectionB: { entries: [{ modelKey: 'mB', kind: 'model' }] }, revision: 1,
    selectionA: { entries: [{ dbIds: [1, 2], modelKey: 'mA', kind: 'elements' }] }, name: 'structure vs mep',
    testId: 'T1', schemaVersion: 1,
  }).captured);
  assert.equal(computeSemanticDigest(reordered), base);
});

test('semanticDigest changes with every semantic field, including a selection swap (5.4)', () => {
  const base = computeSemanticDigest(prep({}));
  const swapped = computeSemanticDigest(prep({
    selectionA: { entries: [{ kind: 'model', modelKey: 'mB' }] },
    selectionB: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [1, 2] }] },
  }));
  assert.notEqual(swapped, base);
  assert.notEqual(computeSemanticDigest(prep({ mode: 'surface-intersection' })), base);
  assert.notEqual(computeSemanticDigest(prep({ mode: 'clearance', clearance: 0.05 })), base);
  assert.notEqual(computeSemanticDigest(prep({
    selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [1, 2, 3] }] },
  })), base);
});

test('clearance is in the canonical form iff mode is clearance', () => {
  assert.equal('clearance' in canonicalSemanticForm(prep({})), false);
  assert.equal(canonicalSemanticForm(prep({ mode: 'clearance', clearance: 0.05 })).clearance, 0.05);
});

test('golden byte-level vectors for the canonical JSON and digest (AC-1)', () => {
  const A = { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [1, 2] }] };
  const B = { entries: [{ kind: 'model', modelKey: 'mB' }] };
  const vectors = [
    [{ selectionA: A, selectionB: B, mode: 'volume-overlap' },
     'sha256:beb9b5250e0c535c8a124cbcdb90f3cc12668358735b0da552f897d68e647e00'],
    [{ selectionA: B, selectionB: A, mode: 'volume-overlap' },             // swap => different question
     'sha256:67acf043f927e22aeee02aa63285e0caf4f5af02394fd12ffd98fe30ab0af054'],
    [{ selectionA: A, selectionB: B, mode: 'clearance', clearance: 0.05 },
     'sha256:ce8393d0919a4d875c486391f97ae77359067620c4ae710ee7126145229d31eb'],
    [{ mode: 'containment',
      selectionA: { entries: [{ kind: 'model', modelKey: 'mA' }] },
      selectionB: { entries: [{ kind: 'model', modelKey: 'mA' }] } },      // A = B self test
     'sha256:8f9f4ec2633090cbde92cf1603593bb92da331470741e2fa344eff9eddfd2289'],
    [{ mode: 'volume-overlap', selectionB: B,                              // e-acute + lone surrogate + BEL
      selectionA: { entries: [{ kind: 'elements', modelKey: 'mé\uD800\u0007', dbIds: [0] }] } },
     'sha256:7ac1530a8690d731aeda6cbb57142652221405a5d69f7123c58d935095b9d7fd'],
    [{ mode: 'volume-overlap', selectionB: B,                              // -0 normalized to 0
      selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [-0] }] } },
     'sha256:6d8e208b271b02d44707951e940af3ff58d3e04be791f2b3bd710caf04fb15b1'],
    [{ selectionA: A, selectionB: B, mode: 'clearance', clearance: 1e-7 }, // exponent-form number
     'sha256:478211d9cf0d329e89b5e168e2bc8e1407b3dd14cc1e34d8c7f1ead43a77db12'],
  ];
  for (const [override, expected] of vectors) {
    assert.equal(computeSemanticDigest(prep(override)), expected, JSON.stringify(override));
  }
});

test('the first golden vector pins the canonical JSON bytes (P0 canonicalJson: sorted keys), not just the digest', () => {
  assert.equal(
    canonicalJson(canonicalSemanticForm(prep({}))),
    '{"mode":"volume-overlap","selectionA":{"entries":[{"dbIds":[1,2],"kind":"elements","modelKey":"mA"}]},'
    + '"selectionB":{"entries":[{"kind":"model","modelKey":"mB"}]}}',
  );
});
```

- [x] **Step 2: Run it and see it fail.** `node --test test/clashtest/definition/normalize.test.mjs` — expected failure: `ERR_MODULE_NOT_FOUND` for `clashtest/definition/normalize.js`.

- [x] **Step 3: Write the minimal implementation.**

```js
// clashtest/definition/normalize.js
import { digestCanonical } from '../util/canonical.js';

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const SIDES = ['selectionA', 'selectionB'];

/**
 * ONE normalization body, written as a generator so the synchronous `normalizeDefinition` and the sliced
 * `prepareDefinition` cannot drift: the sync driver ignores the yields, the sliced driver turns each one
 * into `slicer.tick()`. It reads only the `captured` value it is handed.
 */
function* normalizeSteps(captured) {
  const definition = {
    schemaVersion: 1,
    testId: captured.testId,
    revision: captured.revision,
    name: captured.name,
    selectionA: null,
    selectionB: null,
    mode: captured.mode,
  };
  if ('description' in captured) definition.description = captured.description;
  if (captured.mode === 'clearance') definition.clearance = captured.clearance;
  for (const side of SIDES) definition[side] = yield* normalizeSelectionSteps(captured[side]);
  return definition;
}

function* normalizeSelectionSteps(selection) {
  /** @type {Map<string, {kind: 'model'} | {kind: 'elements', dbIds: Set<number>}>} */
  const byModel = new Map();
  for (const entry of selection.entries) {
    yield;
    const current = byModel.get(entry.modelKey);
    if (entry.kind === 'model') { byModel.set(entry.modelKey, { kind: 'model' }); continue; }
    if (current && current.kind === 'model') continue;            // 5.2: model wins
    if (current) { for (const id of entry.dbIds) current.dbIds.add(id); continue; }
    byModel.set(entry.modelKey, { kind: 'elements', dbIds: new Set(entry.dbIds) });
  }
  const entries = [];
  for (const modelKey of [...byModel.keys()].sort(byCodeUnit)) {
    yield;
    const v = byModel.get(modelKey);
    entries.push(v.kind === 'model'
      ? { kind: 'model', modelKey }
      : { kind: 'elements', modelKey, dbIds: [...v.dbIds].sort((a, b) => a - b) });
  }
  return { entries };
}

/** Pure, synchronous; input MUST be a `captured` value from captureAndValidate (already V-valid). */
export function normalizeDefinition(captured) {
  const steps = normalizeSteps(captured);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** 5.4: role-tagged by the keys themselves; name/description/revision/testId excluded. */
export function canonicalSemanticForm(normalized) {
  const form = { mode: normalized.mode, selectionA: normalized.selectionA, selectionB: normalized.selectionB };
  if (normalized.mode === 'clearance') form.clearance = normalized.clearance;
  return form;
}

/** `'sha256:' + hex` over the canonical JSON of the canonical form -- P0's value-taking `digestCanonical` (row N5). */
export function computeSemanticDigest(normalized) {
  return digestCanonical(canonicalSemanticForm(normalized));
}
```

- [x] **Step 4: Run it and see it pass.** `node --test test/clashtest/definition/normalize.test.mjs` — expected: all 8 tests pass, including all 7 golden vectors.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits).** Message: `feat(clashtest): add definition normalization, canonical form and semanticDigest`.

---

### Task P2.5: Sliced `prepareDefinition`, deep freeze, and stability across yields

The V1 mutation-during-yield guarantee: a caller object mutated by a getter, a proxy trap or a plain assignment **between** validation steps, or while the engine is yielded mid-slice, cannot change what is digested, planned, embedded or persisted.

**Files**
- Modify: `clashtest/definition/normalize.js`
- Test: `test/clashtest/definition/capture-stability.test.mjs`

**Interfaces**
- Consumes (**P0 `clashtest/util/slicer.js`**, reconciliation row N6): `createSlicer({now?, yieldToScheduler?, limits?, sliceBudgetMs?, maxItemsPerSlice?, checkEvery?, spanRecorder?, afterYield?}) → {tick(label?), yieldNow(label?), forEach(list, fn, opts?), sortSliced(list, compare, opts?), stats()}`. The yield point is **`slicer.tick(label?)`**, which returns `undefined` when no yield is due and a Promise when one is: `const pending = slicer.tick('normalize'); if (pending) await pending;`. The slicer reads the clock only every `checkEvery` (default 64) ticks and `sliceBudgetMs` must be a positive integer (P0 throws `TypeError` for `0`), so yield-forcing tests use a clock that advances per read and **more than 64** work items. (P3's `EnumerationContext` is a different object with its own method; P2 does not touch it.)
- Consumes (P0 `clashtest/util/capture.js`): `deepFreeze(value)` and `deepFreezeSliced(value, slicer)` (one `tick('freeze')` per node) — the iterative freeze is P0's, P2 does not hand-roll one.
- Consumes (P0 `clashtest/util/canonical.js`): `digestCanonicalSliced(value, slicer, {label?}) → Promise<'sha256:…'>`, byte-identical to `digestCanonical` with one `tick` per ~8 KiB of canonical text — the sliced body uses it because `digestCanonical` is "small values only".
- Consumes (P0 `clashtest/options.js`): `ENGINE_LIMIT_DEFAULTS` — `prepareDefinition`'s optional `limits` is merged over it, so `sliceBudgetMs` and `aggregationSliceMaxItems` are never restated here.
- Consumes (P0 test support): `createFakeClock({start, tickMs, yieldAdvanceMs})` and its `onYield(fn)` hook from `test/clashtest/support/index.mjs` — P2 adds **no** clock of its own (master §2.1 rule 5).
- Produces: `prepareDefinition(captured, {yieldToScheduler, now, sliceBudgetMs?, limits?, spanRecorder?}) → Promise<{definition, semanticDigest}>`, `deepFreezeDefinition(def) → def`.

- [x] **Step 1: Write the failing test.**

```js
// test/clashtest/definition/capture-stability.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureAndValidate } from '../../../clashtest/definition/validate.js';
import { prepareDefinition, computeSemanticDigest, normalizeDefinition } from '../../../clashtest/definition/normalize.js';
import { isDeepFrozen } from '../../../clashtest/util/capture.js';
import { createFakeClock } from '../support/index.mjs';
import { makeDefinition } from '../support/definitions.mjs';

// Enough entries that the slicer (P0: it reads the clock every `checkEvery` = 64 ticks) checks the deadline
// several times. `tickMs: 1` makes every clock read cost 1 ms, so a 1 ms slice budget is always exhausted.
const MANY = 130;
const manyEntries = () => Array.from({ length: MANY }, (_, i) => ({ kind: 'elements', modelKey: `m${i}`, dbIds: [i, i + 1] }));
const seams = (clock) => ({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, sliceBudgetMs: 1 });
const idle = { now: () => 0, yieldToScheduler: async () => {}, sliceBudgetMs: 1000 };

test('mutating the caller object after capture cannot change the prepared definition', async () => {
  const def = makeDefinition();
  const { captured } = captureAndValidate(def);
  const control = computeSemanticDigest(normalizeDefinition(captureAndValidate(makeDefinition()).captured));

  def.selectionA.entries[0].dbIds.push(999);
  def.mode = 'containment';
  def.testId = 'HIJACKED';
  def.selectionB.entries.pop();

  const { definition, semanticDigest } = await prepareDefinition(captured, seams(createFakeClock({ tickMs: 1 })));
  assert.equal(semanticDigest, control);
  assert.equal(definition.testId, 'T1');
  assert.equal(definition.mode, 'volume-overlap');
  assert.deepEqual(definition.selectionA.entries[0].dbIds, [1, 2]);
  assert.equal(definition.selectionB.entries.length, 1);
});

test('mutating the caller object FROM a yield hook, mid-slice, changes nothing', async () => {
  const def = makeDefinition({ selectionA: { entries: manyEntries() } });
  const { captured } = captureAndValidate(def);
  const clock = createFakeClock({ tickMs: 1 });
  let mutations = 0;
  clock.onYield(() => {
    mutations += 1;
    def.selectionA.entries[0].dbIds[0] = 10 ** 6 + mutations;
    def.mode = 'containment';
  });
  const control = await prepareDefinition(captureAndValidate(makeDefinition({ selectionA: { entries: manyEntries() } })).captured, idle);

  const out = await prepareDefinition(captured, seams(clock));
  assert.ok(mutations > 0, 'the hook must have run at least once');
  assert.equal(out.semanticDigest, control.semanticDigest);
  assert.deepEqual(out.definition, control.definition);
});

test('a getter is never invoked during capture and its object is still rejected', () => {
  let called = 0;
  const def = makeDefinition();
  Object.defineProperty(def, 'mode', { get() { called += 1; return 'volume-overlap'; }, enumerable: true, configurable: true });
  const r = captureAndValidate(def);
  assert.equal(called, 0);
  assert.deepEqual(r.issues.map((i) => `${i.path}:${i.code}`), ['/mode:accessor-property']);
});

test('a proxy that reports valid data is captured once; later target mutation is inert', async () => {
  const target = makeDefinition();
  let ownKeysCalls = 0;
  const proxy = new Proxy(target, { ownKeys(t) { ownKeysCalls += 1; return Reflect.ownKeys(t); } });
  const { captured } = captureAndValidate(proxy);
  assert.equal(ownKeysCalls, 1);                         // P0 reads the root's own keys exactly once
  target.selectionA.entries[0].dbIds.push(999);
  target.mode = 'containment';
  const { definition } = await prepareDefinition(captured, idle);
  assert.deepEqual(definition.selectionA.entries[0].dbIds, [1, 2]);
  assert.equal(definition.mode, 'volume-overlap');
});

test('the prepared definition is deep-frozen', async () => {
  const { captured } = captureAndValidate(makeDefinition());
  const { definition } = await prepareDefinition(captured, idle);
  assert.ok(isDeepFrozen(definition));
  assert.throws(() => { definition.selectionA.entries[0].dbIds.push(3); }, TypeError);
});

test('prepareDefinition actually yields when the slice budget is exhausted', async () => {
  const clock = createFakeClock({ tickMs: 1 });
  const { captured } = captureAndValidate(makeDefinition({
    selectionA: { entries: Array.from({ length: MANY }, (_, i) => ({ kind: 'model', modelKey: `m${i}` })) },
  }));
  await prepareDefinition(captured, seams(clock));
  assert.ok(clock.yieldCount > 0, 'expected at least one cooperative yield');
});

test('normalizeDefinition and prepareDefinition agree byte for byte (one shared body)', async () => {
  const captured = captureAndValidate(makeDefinition({ selectionA: { entries: [
    { kind: 'elements', modelKey: 'mB', dbIds: [5, 1, 5] }, { kind: 'elements', modelKey: 'mA', dbIds: [3] }] } })).captured;
  const sync = normalizeDefinition(captured);
  const sliced = await prepareDefinition(captured, { now: () => 0, yieldToScheduler: async () => {} });
  assert.deepEqual(sliced.definition, sync);
  assert.equal(sliced.semanticDigest, computeSemanticDigest(sync));   // digestCanonicalSliced === digestCanonical
});
```

- [x] **Step 2: Run it and see it fail.** `node --test test/clashtest/definition/capture-stability.test.mjs` — expected failure: `SyntaxError ... does not provide an export named 'prepareDefinition'` (the file fails to load until step 3; the getter test is already satisfied by P2.2's capture).

- [x] **Step 3: Write the minimal implementation.** Add these imports to the top of `clashtest/definition/normalize.js` (and extend the `canonical.js` import to `{ digestCanonical, digestCanonicalSliced }`):

```js
import { digestCanonicalSliced } from '../util/canonical.js';   // (merge with the existing canonical.js import)
import { deepFreeze, deepFreezeSliced } from '../util/capture.js';
import { createSlicer } from '../util/slicer.js';
import { ENGINE_LIMIT_DEFAULTS } from '../options.js';
```

and append:

```js
/** Idempotent deep freeze of the closed definition shape (P0's iterative `deepFreeze`). */
export function deepFreezeDefinition(def) {
  return deepFreeze(def);
}

/**
 * The sliced post-validation body of 5.3: normalize -> digest -> deep-freeze, over the CAPTURED copy only.
 * It never touches the caller's object, so a mutation made at any yield is inert. `limits` (resolved engine
 * limits; missing keys fall back to P0's defaults) supply `sliceBudgetMs` / `aggregationSliceMaxItems`.
 */
export async function prepareDefinition(captured, { yieldToScheduler, now, sliceBudgetMs, limits } = {}) {
  const slicer = createSlicer({ now, yieldToScheduler, limits: { ...ENGINE_LIMIT_DEFAULTS, ...limits }, sliceBudgetMs });
  const steps = normalizeSteps(captured);
  let definition;
  for (let r = steps.next(); ; r = steps.next()) {
    if (r.done) { definition = r.value; break; }
    const pending = slicer.tick('normalize');
    if (pending) await pending;
  }
  const semanticDigest = await digestCanonicalSliced(canonicalSemanticForm(definition), slicer, { label: 'digest' });
  await deepFreezeSliced(definition, slicer);
  return { definition, semanticDigest };
}
```

- [x] **Step 4: Run it and see it pass.** `node --test test/clashtest/definition/capture-stability.test.mjs` — expected: all 7 tests pass. Then re-run the earlier two files to confirm no regression: `node --test test/clashtest/definition/validate.test.mjs test/clashtest/definition/normalize.test.mjs`.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits).** Message: `feat(clashtest): add sliced prepareDefinition with deep freeze and yield-stable capture`.

---

### Task P2.6: `InMemoryClashTestStore` — revisions, archive, delete/tombstone, linearizability

**Files**
- Create: `clashtest/stores/InMemoryClashTestStore.js`
- Test: `test/clashtest/stores/InMemoryClashTestStore.test.mjs`

**Interfaces**
- Consumes (**P0 `clashtest/errors.js`**, row N1 — one object argument each): `RevisionConflictError({testId, latest, offered})`, `TestDeletedError({testId})`, `TestArchivedError({testId})`. (`latest` is `null` for a never-seen id.)
- Consumes: `deepFreezeDefinition` (P2.5, a thin wrapper over P0's `deepFreeze`).
- Produces: `createInMemoryClashTestStore({now?} = {})` and the `ClashTestStore` JSDoc typedef. `now` is accepted for signature parity with P7's construction site and P5's stores; nothing here reads a clock.

**Linearizability, the simplest mechanism that preserves the invariant.** Every operation performs its whole read-modify-write **synchronously in its own function body**, with no `await` between the read and the write, and returns an already-settled promise. In a single-threaded runtime that *is* a linearization point: no other operation can interleave inside it. In particular `delete` removes the bodies and writes the tombstone in one uninterrupted statement sequence, so a racing `put` can never observe "neither the live test nor the tombstone" (§5.5). A backend store achieves the same with a committed transaction; the port's contract is the observable behavior, not this mechanism.

**Refusal precedence in `put`, pinned here** (§5.5 names the three refusals but not their order; the order below is fail-closed — the most permanent refusal first): **1.** tombstoned ⇒ `TestDeletedError`; **2.** archived ⇒ `TestArchivedError` (whatever revision was offered); **3.** revision ≠ `latest + 1` (or ≠ 1 for a never-seen id) ⇒ `RevisionConflictError{testId, latest, offered}`. Nothing is written on any refusal.

- [x] **Step 1: Write the failing test.**

```js
// test/clashtest/stores/InMemoryClashTestStore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { captureAndValidate } from '../../../clashtest/definition/validate.js';
import { normalizeDefinition, deepFreezeDefinition } from '../../../clashtest/definition/normalize.js';
import { makeDefinition } from '../support/definitions.mjs';

const def = (o) => deepFreezeDefinition(normalizeDefinition(captureAndValidate(makeDefinition(o)).captured));
const rejects = (p, name) => assert.rejects(p, (e) => e.name === name);

test('put accepts revision 1 for a new test, then latest + 1', async () => {
  const s = createInMemoryClashTestStore();
  await s.put(def({ revision: 1 }));
  await s.put(def({ revision: 2 }));
  assert.equal((await s.get('T1')).revision, 2);
  assert.equal((await s.get('T1', 1)).revision, 1);
  assert.equal(await s.get('T1', 9), null);
});

test('put rejects duplicates, gaps and out-of-order saves without overwriting', async () => {
  const s = createInMemoryClashTestStore();
  await s.put(def({ revision: 1, name: 'first' }));
  for (const bad of [1, 3]) {   // duplicate, then a gap (an out-of-order save is the same refusal)
    await assert.rejects(s.put(def({ revision: bad, name: 'second' })), (e) => {
      assert.equal(e.name, 'RevisionConflictError');
      assert.equal(e.testId, 'T1'); assert.equal(e.latest, 1);
      return true;
    });
  }
  assert.equal((await s.get('T1')).name, 'first');
  assert.equal((await s.get('T1')).revision, 1);
});

test('a first put with revision != 1 is a RevisionConflictError with latest null', async () => {
  const s = createInMemoryClashTestStore();
  await assert.rejects(s.put(def({ revision: 2 })), (e) => e.name === 'RevisionConflictError' && e.latest === null && e.offered === 2);
  assert.equal(await s.get('T1'), null);
});

test('archive is one-way, covers all revisions, and blocks new revisions', async () => {
  const s = createInMemoryClashTestStore();
  await s.put(def({ revision: 1 }));
  await s.put(def({ revision: 2 }));
  await s.archive('T1');
  await s.archive('T1');                                    // idempotent
  assert.equal((await s.get('T1')).revision, 2);            // still readable, latest returned
  assert.equal((await s.get('T1', 1)).revision, 1);
  await rejects(s.put(def({ revision: 3 })), 'TestArchivedError');
  await rejects(s.put(def({ revision: 1 })), 'TestArchivedError');   // archive outranks revision
  assert.equal(await s.isTombstoned('T1'), false);
});

test('delete tombstones the testId permanently', async () => {
  const s = createInMemoryClashTestStore();
  await s.put(def({ revision: 1 }));
  await s.delete('T1');
  await s.delete('T1');                                     // idempotent
  assert.equal(await s.isTombstoned('T1'), true);
  assert.equal(await s.get('T1'), null);
  assert.equal(await s.get('T1', 1), null);
  await rejects(s.put(def({ revision: 1 })), 'TestDeletedError');   // recreate at revision 1 refused
  await rejects(s.put(def({ revision: 2 })), 'TestDeletedError');
  const page = await s.list();
  assert.equal(page.summaries.length, 0);                   // a tombstoned id is not listed
});

test('a never-seen id is not tombstoned; deleting it still tombstones it', async () => {
  const s = createInMemoryClashTestStore();
  assert.equal(await s.isTombstoned('ghost'), false);
  await s.delete('ghost');
  assert.equal(await s.isTombstoned('ghost'), true);
  await rejects(s.put(def({ testId: 'ghost', revision: 1 })), 'TestDeletedError');
});

test('operations are linearizable per testId under interleaving', async () => {
  const s = createInMemoryClashTestStore();
  await s.put(def({ revision: 1 }));
  // Fire without awaiting between them: each must take effect at one point, in issue order.
  const results = await Promise.allSettled([
    s.put(def({ revision: 2 })),
    s.archive('T1'),
    s.put(def({ revision: 3 })),
    s.resolveForRun('T1'),
    s.delete('T1'),
    s.put(def({ revision: 1 })),
    s.isTombstoned('T1'),
  ]);
  assert.equal(results[0].status, 'fulfilled');                       // put r2 before archive
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(results[2].reason.name, 'TestArchivedError');          // put r3 after archive
  assert.equal(results[3].value.status, 'archived');                  // revision AND state from one point
  assert.equal(results[3].value.latestRevision, 2);
  assert.equal(results[3].value.definition.revision, 2);
  assert.equal(results[4].status, 'fulfilled');
  assert.equal(results[5].reason.name, 'TestDeletedError');           // put after delete
  assert.equal(results[6].value, true);
});

test('a delete racing a put never leaves neither the live test nor the tombstone', async () => {
  const s = createInMemoryClashTestStore();
  await s.put(def({ revision: 1 }));
  const observations = [];
  const deleting = s.delete('T1').then(() => observations.push('deleted'));
  const putting = s.put(def({ revision: 2 })).then(
    () => observations.push('put-ok'),
    (e) => observations.push(`put-${e.name}`),
  );
  await Promise.all([deleting, putting]);
  assert.deepEqual(observations.sort(), ['deleted', 'put-TestDeletedError'].sort());
  assert.equal(await s.isTombstoned('T1'), true);
  assert.equal(await s.get('T1'), null);
});

test('the store hands back frozen definitions', async () => {
  const s = createInMemoryClashTestStore();
  const saved = def({ revision: 1 });
  await s.put(saved);
  const got = await s.get('T1');
  assert.ok(Object.isFrozen(got));
  assert.throws(() => { got.name = 'x'; }, TypeError);
});
```

- [x] **Step 2: Run it and see it fail.** `node --test test/clashtest/stores/InMemoryClashTestStore.test.mjs` — expected failure: `ERR_MODULE_NOT_FOUND` for `clashtest/stores/InMemoryClashTestStore.js`.

- [x] **Step 3: Write the minimal implementation.**

```js
// clashtest/stores/InMemoryClashTestStore.js
import { RevisionConflictError, TestArchivedError, TestDeletedError } from '../errors.js';
import { deepFreezeDefinition } from '../definition/normalize.js';

/**
 * @typedef {Object} ClashTestStore  the port of spec 5.5 (every method linearizable per testId)
 * @property {(def) => Promise<object>} put
 * @property {(testId: string, revision?: number) => Promise<object|null>} get
 * @property {(testId: string, revision?: number) => Promise<{status: 'live'|'archived'|'deleted'|'missing',
 *            definition: object|null, latestRevision: number|null}>} resolveForRun
 * @property {(opts?: {limit?: number, cursor?: string}) => Promise<{summaries: object[], next?: string}>} list
 * @property {(testId: string) => Promise<void>} archive
 * @property {(testId: string) => Promise<void>} delete
 * @property {(testId: string) => Promise<boolean>} isTombstoned
 */

/** `now` is accepted for signature parity with the other stores; nothing here reads a clock. */
export function createInMemoryClashTestStore(_opts = {}) {
  /** @type {Map<string, {revisions: Map<number, object>, latest: number, archived: boolean}>} */
  const tests = new Map();
  /** @type {Set<string>} */
  const tombstones = new Set();

  // Every body below is one synchronous critical section: no await between read and write.
  return {
    async put(def) {
      const { testId, revision } = def;
      if (tombstones.has(testId)) throw new TestDeletedError({ testId });
      const record = tests.get(testId);
      if (record && record.archived) throw new TestArchivedError({ testId });
      const latest = record ? record.latest : null;
      const expected = record ? record.latest + 1 : 1;
      if (revision !== expected) throw new RevisionConflictError({ testId, latest, offered: revision });
      const frozen = deepFreezeDefinition(def);
      if (record) { record.revisions.set(revision, frozen); record.latest = revision; }
      else tests.set(testId, { revisions: new Map([[revision, frozen]]), latest: revision, archived: false });
      return frozen;
    },

    async get(testId, revision) {
      const record = tests.get(testId);
      if (!record) return null;
      if (revision === undefined) return record.revisions.get(record.latest) ?? null;
      return record.revisions.get(revision) ?? null;
    },

    async resolveForRun(testId, revision) {
      if (tombstones.has(testId)) return { status: 'deleted', definition: null, latestRevision: null };
      const record = tests.get(testId);
      if (!record) return { status: 'missing', definition: null, latestRevision: null };
      const wanted = revision === undefined ? record.latest : revision;
      const definition = record.revisions.get(wanted) ?? null;
      // 5.5: a requested revision that does not exist is `missing` (latestRevision null for missing)
      if (!definition) return { status: 'missing', definition: null, latestRevision: null };
      return { status: record.archived ? 'archived' : 'live', definition, latestRevision: record.latest };
    },

    async list() { throw new Error('list is implemented in task P2.7'); },

    async archive(testId) {
      const record = tests.get(testId);
      if (record) record.archived = true;      // one-way, idempotent, covers every revision
    },

    async delete(testId) {
      // ONE linearization point: the tombstone and the body removal happen together.
      tombstones.add(testId);
      tests.delete(testId);
    },

    async isTombstoned(testId) { return tombstones.has(testId); },
  };
}
```

- [x] **Step 4: Run it and see it pass.** `node --test test/clashtest/stores/InMemoryClashTestStore.test.mjs` — expected: 8 of 9 tests pass; the `delete tombstones the testId permanently` test still fails on its final `s.list()` assertion with `Error: list is implemented in task P2.7`. Complete that one assertion in P2.7 and re-run.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits).** Message: `feat(clashtest): add InMemoryClashTestStore with atomic revisioning, archive and tombstone`.

---

### Task P2.7: `resolveForRun` coverage and the `ClashTestStore.list` contract

**Files**
- Modify: `clashtest/stores/InMemoryClashTestStore.js`
- Modify: `clashtest/definition/validate.js`
- Test: `test/clashtest/stores/clashTestStore.listing.test.mjs`

**Interfaces**
- Consumes (**P0 `clashtest/errors.js`**, row N1): `InvalidOptionsError({issues, reason})` — a bad cursor sets `reason: 'bad-cursor'` (a value P0 lists) and the issue code `bad-cursor`; every other list-option failure has `reason: null`.
- Consumes (P0 `clashtest/util/capture.js`): `captureData`, through P2.1's `captureStructural`, for the untrusted page — the page validator is **capture-then-validate**, like the definition path.
- Produces: `store.list`, `validateTestSummaryPage(page) → {issues, issuesTruncated}`, and `LIST_LIMIT = {default: 100, max: 1000}` (§13.5) exported from `validate.js` so the store and the page validator share one copy of the bound.

**Listing contract, minimal for the reference store (§13.5).** Total order: ascending by `testId` in code-unit order, one row per test, tombstoned ids excluded. `limit`: integer `1 ≤ n ≤ 1000` (`LIST_LIMIT.max`), default 100 (`LIST_LIMIT.default`); anything else ⇒ `InvalidOptionsError`. `cursor`: opaque and versioned — the store issues `'v1:' + encodeURIComponent(lastTestId)`; a non-string, a missing `v1:` prefix or an undecodable body ⇒ `InvalidOptionsError{reason:'bad-cursor'}` with issue code `bad-cursor`, never a silent restart. Paging is **keyset**: a page is everything strictly after the cursor's key in the total order, so a row present for the whole traversal appears exactly once however inserts and deletes interleave. `next` is present only when rows remain after the page.

`TestSummary` is the closed shape `{testId, latestRevision, archived, name}` (§13.5), where `name` is the latest revision's name. `validateTestSummaryPage` is the reader side: any engine reading a *foreign* store's page runs it through this before trusting it, and maps a non-empty result to `CorruptListingError({issues})` (that mapping lives in P2.8/P7, not here). It captures the page with `captureData` first (node ceiling `8 + 5 × LIST_LIMIT.max`, `/summaries` capped at `LIST_LIMIT.max` rows, strings at 1024), then validates the copy. It caps at **20** issues, per §5.5/§13.5's "first 20 `{path, code}` only — no values", so its issues carry an empty `message` — the collector's `valueFree` flag blanks every message, structural ones included.

- [x] **Step 1: Write the failing test.**

```js
// test/clashtest/stores/clashTestStore.listing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { validateTestSummaryPage, captureAndValidate } from '../../../clashtest/definition/validate.js';
import { normalizeDefinition, deepFreezeDefinition } from '../../../clashtest/definition/normalize.js';
import { makeDefinition } from '../support/definitions.mjs';

const def = (o) => deepFreezeDefinition(normalizeDefinition(captureAndValidate(makeDefinition(o)).captured));

async function seed(ids) {
  const s = createInMemoryClashTestStore();
  for (const testId of ids) await s.put(def({ testId, name: `n-${testId}` }));
  return s;
}

test('list returns closed TestSummary rows in ascending testId code-unit order', async () => {
  const s = await seed(['b', 'A', 'a', 'B']);
  const { summaries, next } = await s.list();
  assert.equal(next, undefined);
  assert.deepEqual(summaries.map((x) => x.testId), ['A', 'B', 'a', 'b']);
  assert.deepEqual(Object.keys(summaries[0]).sort(), ['archived', 'latestRevision', 'name', 'testId']);
  assert.deepEqual(summaries[0], { testId: 'A', latestRevision: 1, archived: false, name: 'n-A' });
});

test('latestRevision and archived track the store state', async () => {
  const s = await seed(['t']);
  await s.put(def({ testId: 't', revision: 2, name: 'n2' }));
  await s.archive('t');
  assert.deepEqual((await s.list()).summaries, [{ testId: 't', latestRevision: 2, archived: true, name: 'n2' }]);
});

test('paging is keyset: every row appears exactly once across inserts and deletes', async () => {
  const s = await seed(['a', 'b', 'c', 'd', 'e']);
  const seen = [];
  let cursor;
  for (let page = 0; page < 10; page += 1) {
    const r = await s.list({ limit: 2, cursor });
    seen.push(...r.summaries.map((x) => x.testId));
    if (page === 0) { await s.put(def({ testId: 'a0' })); await s.delete('e'); }  // interleaved mutation
    cursor = r.next;
    if (!cursor) break;
  }
  assert.deepEqual(seen.filter((id) => ['b', 'c', 'd'].includes(id)).sort(), ['b', 'c', 'd']);
  assert.equal(new Set(seen).size, seen.length, 'no duplicates');
  assert.equal(seen.includes('a0'), false, 'a key before the cursor is never revisited');
});

test('limit is bounded and the cursor is opaque and versioned', async () => {
  const s = await seed(['a', 'b']);
  for (const limit of [0, 1001, 1.5, -1, '10', NaN, Infinity]) {
    await assert.rejects(s.list({ limit }), (e) => e.name === 'InvalidOptionsError');
  }
  for (const cursor of ['a', 'v2:a', 7, {}, 'v1:%zz']) {
    await assert.rejects(s.list({ cursor }), (e) => {
      assert.equal(e.name, 'InvalidOptionsError');
      assert.equal(e.reason, 'bad-cursor');            // P0: InvalidOptionsError carries `reason` for a bad cursor
      assert.equal(e.issues[0].code, 'bad-cursor');
      return true;
    });
  }
  const first = await s.list({ limit: 1 });
  assert.equal(typeof first.next, 'string');
  assert.ok(first.next.startsWith('v1:'));
  assert.deepEqual((await s.list({ limit: 1, cursor: first.next })).summaries.map((x) => x.testId), ['b']);
  await assert.rejects(s.list({ unknownKey: 1 }), (e) => e.name === 'InvalidOptionsError');
});

test('resolveForRun returns each of the four statuses', async () => {
  const s = await seed(['live', 'arch']);
  await s.archive('arch');
  await s.delete('gone');
  assert.deepEqual(await s.resolveForRun('nope'), { status: 'missing', definition: null, latestRevision: null });
  assert.deepEqual(await s.resolveForRun('gone'), { status: 'deleted', definition: null, latestRevision: null });
  const live = await s.resolveForRun('live');
  assert.equal(live.status, 'live'); assert.equal(live.latestRevision, 1); assert.equal(live.definition.testId, 'live');
  const arch = await s.resolveForRun('arch');
  assert.equal(arch.status, 'archived'); assert.ok(arch.definition);
  assert.deepEqual(await s.resolveForRun('live', 9), { status: 'missing', definition: null, latestRevision: null });
});

test('validateTestSummaryPage accepts a conforming page and rejects every deviation', () => {
  const ok = { summaries: [{ testId: 't', latestRevision: 1, archived: false, name: 'n' }], next: 'v1:t' };
  assert.deepEqual(validateTestSummaryPage(ok).issues, []);
  assert.deepEqual(validateTestSummaryPage(ok), { issues: [], issuesTruncated: false });
  const bad = [
    [{ summaries: [{ testId: 't', latestRevision: 1, archived: false, name: 'n', extra: 1 }] }, '/summaries/0/extra:unknown-property'],
    [{ summaries: [{ testId: 't', latestRevision: 0, archived: false, name: 'n' }] }, '/summaries/0/latestRevision:out-of-range'],
    [{ summaries: [{ testId: '', latestRevision: 1, archived: false, name: 'n' }] }, '/summaries/0/testId:string-too-short'],
    [{ summaries: [{ testId: 't', latestRevision: 1, archived: 'no', name: 'n' }] }, '/summaries/0/archived:invalid-enum'],
    [{ summaries: [{ testId: 't', latestRevision: 1, archived: false }] }, '/summaries/0/name:missing-required'],
    [{ summaries: {} }, '/summaries:not-an-array'],
    [{ summaries: [], next: 7 }, '/next:not-a-string'],
    [{ summaries: [], other: 1 }, '/other:unknown-property'],
    [null, '/:not-an-object'],
    [{ summaries: [undefined] }, '/summaries/0:not-plain-object'],            // structural, from captureData
  ];
  for (const [page, expected] of bad) {
    const r = validateTestSummaryPage(page);
    assert.deepEqual(r.issues.map((i) => `${i.path}:${i.code}`), [expected], JSON.stringify(page));
    assert.equal(r.issues[0].message, '');       // {path, code} only, no values
  }
});

test('validateTestSummaryPage caps at 20 issues', () => {
  const summaries = Array.from({ length: 40 }, () => ({ testId: 't', latestRevision: 1, archived: false }));
  const r = validateTestSummaryPage({ summaries });
  assert.equal(r.issues.length, 20);
  assert.equal(r.issuesTruncated, true);
});
```

- [x] **Step 2: Run it and see it fail.** `node --test test/clashtest/stores/clashTestStore.listing.test.mjs` — expected failure: `Error: list is implemented in task P2.7` for the listing tests and `TypeError: validateTestSummaryPage is not a function` for the last two.

- [x] **Step 3: Write the minimal implementation.** In `clashtest/stores/InMemoryClashTestStore.js`, replace the `errors.js` import line with the two lines below (keeping the `normalize.js` import):

```js
import { RevisionConflictError, TestArchivedError, TestDeletedError, InvalidOptionsError } from '../errors.js';
import { LIST_LIMIT } from '../definition/validate.js';
```

add the list-option parsing above `createInMemoryClashTestStore`:

```js
const LIST_OPTION_KEYS = ['limit', 'cursor'];
const CURSOR_PREFIX = 'v1:';
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // local; normalize.js keeps its own copy

function parseListOptions(opts) {
  const issues = [];
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new InvalidOptionsError({ issues: [{ path: '/', code: 'not-an-object' }] });
  }
  for (const k of Object.keys(opts)) {
    if (!LIST_OPTION_KEYS.includes(k)) issues.push({ path: `/${k}`, code: 'unknown-property' });
  }
  let limit = LIST_LIMIT.default;
  if (opts.limit !== undefined) {
    if (typeof opts.limit !== 'number' || !Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > LIST_LIMIT.max) {
      issues.push({ path: '/limit', code: 'out-of-range' });
    } else limit = opts.limit;
  }
  let after = null;
  let badCursor = false;
  if (opts.cursor !== undefined) {
    if (typeof opts.cursor !== 'string' || !opts.cursor.startsWith(CURSOR_PREFIX)) badCursor = true;
    else {
      try { after = decodeURIComponent(opts.cursor.slice(CURSOR_PREFIX.length)); }
      catch { badCursor = true; }
    }
  }
  if (badCursor) issues.push({ path: '/cursor', code: 'bad-cursor' });
  if (issues.length > 0) throw new InvalidOptionsError({ issues, reason: badCursor ? 'bad-cursor' : null });
  return { limit, after };
}
```

and replace the `list` stub inside the returned object:

```js
    async list(opts = {}) {
      const { limit, after } = parseListOptions(opts);
      const ids = [...tests.keys()].sort(byCodeUnit)
        .filter((id) => after === null || byCodeUnit(id, after) > 0);   // keyset: strictly after
      const page = ids.slice(0, limit);
      const summaries = page.map((testId) => {
        const record = tests.get(testId);
        return { testId, latestRevision: record.latest, archived: record.archived, name: record.revisions.get(record.latest).name };
      });
      const result = { summaries };
      if (ids.length > page.length) result.next = CURSOR_PREFIX + encodeURIComponent(page[page.length - 1]);
      return result;
    },
```

then append to `clashtest/definition/validate.js`:

```js
/** 13.5: `ClashTestStore.list` limits. The in-memory store imports this; the page validator bounds its capture with it. */
export const LIST_LIMIT = Object.freeze({ default: 100, max: 1000 });
const SUMMARY_KEYS = Object.freeze(['testId', 'latestRevision', 'archived', 'name']);
const MAX_LISTING_ISSUES = 20;
const MAX_CURSOR_LENGTH = 1024;

/** Reader side of the 13.5 listing contract: a foreign store's page is untrusted data. Capture, then validate the copy. */
export function validateTestSummaryPage(page) {
  const opts = {
    maxNodes: 8 + 5 * LIST_LIMIT.max, maxIssues: MAX_LISTING_ISSUES, maxStringLength: MAX_CURSOR_LENGTH,
    arrayLimitFor: (p) => (p === '/summaries' ? LIST_LIMIT.max : undefined),
  };
  const cap = captureStructural(page, opts, { valueFree: true });
  if (!cap.ok) return { issues: cap.issues, issuesTruncated: cap.issuesTruncated };
  const c = createCollector(MAX_LISTING_ISSUES, { valueFree: true });
  const p = cap.value;
  if (!isRecord(p)) { c.add('/', 'not-an-object', ''); return { issues: c.issues, issuesTruncated: c.truncated }; }
  for (const k of Object.keys(p)) {
    if (k !== 'summaries' && k !== 'next') c.add(`/${esc(k)}`, 'unknown-property', '');
  }
  if (has(p, 'next')) {
    if (typeof p.next !== 'string') c.add('/next', 'not-a-string', '');
    else if (p.next.length > MAX_CURSOR_LENGTH) c.add('/next', 'string-too-long', '');
  }
  if (!has(p, 'summaries')) c.add('/summaries', 'missing-required', '');
  else if (!Array.isArray(p.summaries)) c.add('/summaries', 'not-an-array', '');
  else {
    for (let i = 0; i < p.summaries.length && !c.full; i += 1) {
      const row = p.summaries[i];
      const rp = `/summaries/${i}`;
      if (!isRecord(row)) { c.add(rp, 'not-an-object', ''); continue; }
      for (const k of Object.keys(row)) {
        if (!SUMMARY_KEYS.includes(k)) c.add(`${rp}/${esc(k)}`, 'unknown-property', '');
      }
      checkString(row, 'testId', `${rp}/testId`, c, 1, SCHEMA.testId, true);
      if (!has(row, 'latestRevision')) c.add(`${rp}/latestRevision`, 'missing-required', '');
      else if (typeof row.latestRevision !== 'number' || !Number.isInteger(row.latestRevision)) c.add(`${rp}/latestRevision`, 'not-an-integer', '');
      else if (row.latestRevision < 1 || row.latestRevision > Number.MAX_SAFE_INTEGER) c.add(`${rp}/latestRevision`, 'out-of-range', '');
      checkString(row, 'name', `${rp}/name`, c, 1, SCHEMA.name, true);
      if (!has(row, 'archived')) c.add(`${rp}/archived`, 'missing-required', '');
      else if (typeof row.archived !== 'boolean') c.add(`${rp}/archived`, 'invalid-enum', '');
    }
  }
  return { issues: c.issues, issuesTruncated: c.truncated };
}
```

> The collector's `valueFree` flag is what makes `validateTestSummaryPage` value-free: it blanks every issue message, so no listing rejection ever carries a caller value (§13.5); the assertion `r.issues[0].message === ''` is the contract.

- [x] **Step 4: Run it and see it pass.** `node --test test/clashtest/stores/clashTestStore.listing.test.mjs test/clashtest/stores/InMemoryClashTestStore.test.mjs` — expected: all 7 listing tests and all 9 store tests pass (the P2.6 `list` assertion is now reachable).

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits).** Message: `feat(clashtest): add ClashTestStore keyset listing, resolveForRun coverage and page validation`.

---

### Task P2.8: The §18 definition surface — `createDefinitionOperations`

**Files**
- Create: `clashtest/definition/operations.js`
- Test: `test/clashtest/definition/operations.test.mjs`

**Interfaces**
- Consumes: `captureAndValidate`, `validateTest`, `toDefinitionError`, `validateTestSummaryPage` (P2.2, P2.3, P2.7); `prepareDefinition` (P2.5); the `ClashTestStore` port (P2.6/P2.7).
- Consumes (**P0 `clashtest/errors.js`**, row N1 — object arguments): `StoreNotConfiguredError({store})`, `CorruptListingError({issues})` (P0 keeps the first 20 `{path, code}` pairs and never values or messages).
- Consumes (P0 `clashtest/options.js`): `ENGINE_LIMIT_DEFAULTS` — the caller's `limits` (P7 passes its resolved engine limits; the tests pass `{}`) are merged over it, so the slicer's `sliceBudgetMs` is never restated here.
- Consumes (P0 test support): `createFakeClock` from `test/clashtest/support/index.mjs`; its `now` / `yieldToScheduler` are detachable closures.
- **Consumed by P7** (`createDefinitionOperations({testStore, limits, yieldToScheduler, now, spanRecorder})`) and by P6 (`RESOLVE_STATUS_TO_PLANNING_CAUSE`).
- Produces: `createDefinitionOperations`, `RESOLVE_STATUS_TO_PLANNING_CAUSE`.

**Rules pinned here** (§5.3 scope (iii)/(iv), §5.5 "Missing stores"):
- `saveTest(def)` captures and validates **synchronously in the caller's turn** (before the promise is returned), then returns a promise. With no `testStore`, the promise rejects `StoreNotConfiguredError{store:'testStore'}`; with issues, it rejects the `toDefinitionError` mapping. It **neither assigns nor rewrites revisions**. The store receives — and `saveTest` resolves with — the normalized, deep-frozen copy.
- `getTest` treats every definition a store returns as untrusted (§5.3 scope (iv)): it captures and validates the returned object, then normalizes and freezes it. **Decision (spec silent):** an invalid stored definition makes `getTest` *reject* with the `toDefinitionError` mapping rather than return an unvalidated object — fail closed. The run-admission path's richer `definition-invalid` / `schema-unsupported` / `migration-failed` planning causes are **the engine's, not `getTest`'s** — precisely, **P7's** `resolveDefinition` / `planningCauseOf` closures over `testStore` (P7 Task P7.4 Step 3a), which P6 merely *drives* through `RunSpec` and seals via `failPlanning`. (Corrected 2026-09-21 by the H1 traceability sweep: this sentence previously said "P6's", and the AC-16 row had mapped the conjunct to a P2 store-reference test file that no phase creates. `'migration-failed'` is a **reserved, unreachable** cause while `DEFINITION_SCHEMA_VERSION === 1` — the `[1, 1)` older-version window is empty and V2 below makes every non-newer value `invalid-schema-version` — so no P2 surface produces it either.)
- `listTests` validates the store's page with `validateTestSummaryPage` and rejects `CorruptListingError{issues}` on any issue — never a partially trusted page, never a per-entry skip.
- `archiveTest` and `getTest`/`listTests` reject `StoreNotConfiguredError` with no store. `deleteTest` is **not** here: it needs `resultStore.tombstoneTest` first (§5.5 ordering) and is wired in P7.

- [x] **Step 1: Write the failing test.**

```js
// test/clashtest/definition/operations.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefinitionOperations } from '../../../clashtest/definition/operations.js';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { createFakeClock } from '../support/index.mjs';
import { makeDefinition } from '../support/definitions.mjs';

const seams = () => { const c = createFakeClock(); return { now: c.now, yieldToScheduler: c.yieldToScheduler, limits: {} }; };
const ops = (testStore) => createDefinitionOperations({ testStore, ...seams() });

test('saveTest validates, normalizes, freezes and stores', async () => {
  const store = createInMemoryClashTestStore();
  const saved = await ops(store).saveTest(makeDefinition());
  assert.deepEqual(saved.selectionA.entries[0].dbIds, [1, 2]);   // normalized (input was [2,1])
  assert.ok(Object.isFrozen(saved));
  assert.deepEqual(await store.get('T1'), saved);
});

test('saveTest captures synchronously: a mutation right after the call is inert', async () => {
  const store = createInMemoryClashTestStore();
  const def = makeDefinition();
  const promise = ops(store).saveTest(def);
  def.name = 'HIJACKED';
  def.selectionA.entries[0].dbIds.push(999);
  const saved = await promise;
  assert.equal(saved.name, 'structure vs mep');
  assert.deepEqual(saved.selectionA.entries[0].dbIds, [1, 2]);
});

test('saveTest rejects an invalid definition and never touches the store', async () => {
  let puts = 0;
  const store = { ...createInMemoryClashTestStore(), put: async (d) => { puts += 1; return d; } };
  await assert.rejects(ops(store).saveTest(makeDefinition({ mode: 'nope' })),
    (e) => e.name === 'InvalidTestDefinitionError' && e.issues.length === 1);
  await assert.rejects(ops(store).saveTest(makeDefinition({ schemaVersion: 7 })),
    (e) => e.name === 'UnsupportedSchemaVersionError');
  assert.equal(puts, 0);
});

test('saveTest neither assigns nor rewrites revisions', async () => {
  const store = createInMemoryClashTestStore();
  const o = ops(store);
  await o.saveTest(makeDefinition({ revision: 1 }));
  await assert.rejects(o.saveTest(makeDefinition({ revision: 1 })), (e) => e.name === 'RevisionConflictError');
  await o.saveTest(makeDefinition({ revision: 2 }));
  assert.equal((await store.get('T1')).revision, 2);
});

test('every definition operation rejects StoreNotConfiguredError with no testStore', async () => {
  const o = createDefinitionOperations({ testStore: null, ...seams() });
  for (const call of [o.saveTest(makeDefinition()), o.getTest('T1'), o.listTests(), o.archiveTest('T1')]) {
    await assert.rejects(call, (e) => e.name === 'StoreNotConfiguredError' && e.store === 'testStore');
  }
  assert.deepEqual(o.validateTest(makeDefinition()), { issues: [], issuesTruncated: false }); // unaffected
});

test('getTest treats a store definition as untrusted and re-validates it', async () => {
  const bad = { ...makeDefinition(), mode: 'nope' };
  const store = { ...createInMemoryClashTestStore(), get: async () => bad };
  await assert.rejects(ops(store).getTest('T1'), (e) => e.name === 'InvalidTestDefinitionError');

  const newer = { ...makeDefinition(), schemaVersion: 9 };
  const store2 = { ...createInMemoryClashTestStore(), get: async () => newer };
  await assert.rejects(ops(store2).getTest('T1'), (e) => e.name === 'UnsupportedSchemaVersionError');
});

test('a store definition mutated after it is returned cannot affect the caller', async () => {
  const mutable = makeDefinition();
  const store = { ...createInMemoryClashTestStore(), get: async () => mutable };
  const got = await ops(store).getTest('T1');
  mutable.name = 'HIJACKED';
  mutable.selectionA.entries[0].dbIds.push(999);
  assert.equal(got.name, 'structure vs mep');
  assert.deepEqual(got.selectionA.entries[0].dbIds, [1, 2]);
  assert.ok(Object.isFrozen(got));
});

test('getTest resolves null for a missing test', async () => {
  assert.equal(await ops(createInMemoryClashTestStore()).getTest('nope'), null);
});

test('listTests rejects a corrupt page whole, never per entry', async () => {
  const store = {
    ...createInMemoryClashTestStore(),
    list: async () => ({ summaries: [
      { testId: 'a', latestRevision: 1, archived: false, name: 'n' },
      { testId: 'b', latestRevision: 0, archived: false, name: 'n' },
    ] }),
  };
  await assert.rejects(ops(store).listTests(), (e) => {
    assert.equal(e.name, 'CorruptListingError');
    assert.deepEqual(e.issues, [{ path: '/summaries/1/latestRevision', code: 'out-of-range' }]);
    return true;
  });
});

test('archiveTest delegates and then blocks stored-reference revisions', async () => {
  const store = createInMemoryClashTestStore();
  const o = ops(store);
  await o.saveTest(makeDefinition());
  await o.archiveTest('T1');
  assert.equal((await store.resolveForRun('T1')).status, 'archived');
  await assert.rejects(o.saveTest(makeDefinition({ revision: 2 })), (e) => e.name === 'TestArchivedError');
});
```

- [x] **Step 2: Run it and see it fail.** `node --test test/clashtest/definition/operations.test.mjs` — expected failure: `ERR_MODULE_NOT_FOUND` for `clashtest/definition/operations.js`.

- [x] **Step 3: Write the minimal implementation.**

```js
// clashtest/definition/operations.js
import { captureAndValidate, toDefinitionError, validateTestSummaryPage, validateTest } from './validate.js';
import { prepareDefinition } from './normalize.js';
import { StoreNotConfiguredError, CorruptListingError } from '../errors.js';
import { ENGINE_LIMIT_DEFAULTS } from '../options.js';

/** 5.5: the engine maps a resolveForRun status to one planning cause. Consumed by P6. */
export const RESOLVE_STATUS_TO_PLANNING_CAUSE = Object.freeze({
  live: null, archived: 'test-archived', deleted: 'test-deleted', missing: 'test-not-found',
});

export function createDefinitionOperations({ testStore = null, limits = {}, yieldToScheduler, now }) {
  const resolved = { ...ENGINE_LIMIT_DEFAULTS, ...limits };
  const slice = { yieldToScheduler, now, limits: resolved };
  const requireStore = () => { if (!testStore) throw new StoreNotConfiguredError({ store: 'testStore' }); };

  async function prepareUntrusted(value) {
    const result = captureAndValidate(value, { limits: resolved });
    if (result.issues.length > 0) throw toDefinitionError(result);
    const { definition } = await prepareDefinition(result.captured, slice);
    return definition;
  }

  return {
    validateTest: (def) => validateTest(def, { limits: resolved }),

    saveTest(def) {
      // The capture MUST happen in the caller's turn, before the promise is returned (5.3 (iii)).
      const captured = captureAndValidate(def, { limits: resolved });
      return (async () => {
        requireStore();
        if (captured.issues.length > 0) throw toDefinitionError(captured);
        const { definition } = await prepareDefinition(captured.captured, slice);
        return testStore.put(definition);
      })();
    },

    async getTest(testId, revision) {
      requireStore();
      const stored = await testStore.get(testId, revision);
      if (stored === null || stored === undefined) return null;
      return prepareUntrusted(stored);       // 5.3 (iv): untrusted, captured and validated on receipt
    },

    async listTests(options = {}) {
      requireStore();
      const page = await testStore.list(options);
      const { issues } = validateTestSummaryPage(page);
      if (issues.length > 0) throw new CorruptListingError({ issues });
      return page;
    },

    async archiveTest(testId) {
      requireStore();
      return testStore.archive(testId);
    },
  };
}
```

> `requireStore()` throws inside the async bodies, which turns into a rejection — the §5.5 behavior for these four methods ("reject/throw … the last synchronously", where "the last" is `startRun({testId})`, which is P6/P7's).

- [x] **Step 4: Run it and see it pass.** `node --test test/clashtest/definition/operations.test.mjs` — expected: all 10 tests pass.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits).** Message: `feat(clashtest): add the store-bound definition operations surface (spec 18)`.

---

### Task P2.9: The roots contract — antichain, cross-role nesting, hierarchy-internal candidates

Pure rule **inputs** for §5.6. The planner (P3) decides what to do with them; P2 only computes them, from data `ElementEnumerator.resolveRoots` already returns, with no tree access of its own.

**Files**
- Modify: `clashtest/definition/normalize.js`
- Test: `test/clashtest/definition/roots.test.mjs`

**Interfaces**
- Consumes: nothing beyond plain data. Root records are `{dbId: number, ownerDbIds: number[]}` — the §6.2 `resolveRoots` shape, of which only these two fields are used (`fragmentCount` and `subtreeDigest` are ignored here). That ordering is **enforced by P3** — `validateResolveRootsResult` (`clashtest/planning/ElementEnumerator.js`) rejects non-ascending roots, duplicate roots and non-ascending `ownerDbIds` at the port boundary — so these helpers may rely on it; P2 imports nothing from P3. P3's `resolveSelectionRoots` calls the sliced form of all three helpers below with exactly these argument shapes (plus the trailing `{tick}`) (`assertRootAntichain(roots)`, `checkCrossRoleNesting({rootsA, rootsB, rootsUnion})`, `hierarchyInternalCandidates({rootsA, rootsB})`) and owns only the planning consequences.
- Produces: `assertRootAntichain`, `checkCrossRoleNesting`, `hierarchyInternalCandidates` and their deadline-aware `assertRootAntichainSliced`, `checkCrossRoleNestingSliced`, `hierarchyInternalCandidatesSliced` (`(input, {tick})`; P3 calls the sliced forms with `{tick: () => checkpoint()}`).

**The nesting test, using only owner sets.** §5.6.5 states the rule as `RU = RA ∪ RB` on dbId sets. Deriving the *offending* `(ancestor, descendant)` pairs needs an ancestry relation; rather than take a tree, P2 uses the containment already implied by the enumerator's output — a root `d` is nested under a root `u` iff `ownerDbIds(d) ⊆ ownerDbIds(u)` and `d ≠ u`. That is derivable from §6.2 data alone, is deterministic, and is exactly what "no root in one role may be an ancestor of a root in the other" means for the fragments in scope. Offenders are capped at 20 (§5.6.5). If a union root appears that is in **neither** role's root set, the three enumerations disagree; that is not a nesting failure but an enumerator inconsistency (§6.2 already fails planning with `enumeration-failed` for it), so it is reported through the separate `enumeratorInconsistent` flag and P3 routes it there.

- [x] **Step 1: Write the failing test.**

```js
// test/clashtest/definition/roots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRootAntichain, checkCrossRoleNesting, hierarchyInternalCandidates }
  from '../../../clashtest/definition/normalize.js';

const root = (dbId, ownerDbIds) => ({ dbId, ownerDbIds });

test('an antichain of roots passes; an owner-set containment is a violation', () => {
  assert.deepEqual(assertRootAntichain([root(10, [11, 12]), root(20, [21])]), { ok: true, violations: [] });
  assert.deepEqual(
    assertRootAntichain([root(10, [11, 12]), root(11, [11])]),
    { ok: false, violations: [{ ancestor: 10, descendant: 11 }] },
  );
  assert.deepEqual(assertRootAntichain([root(10, [11]), root(10, [11])]),
    { ok: false, violations: [{ ancestor: 10, descendant: 10 }] });   // duplicate dbId
});

test('identical roots in both roles are supported (5.6.5)', () => {
  const rootsA = [root(10, [11, 12])];
  const rootsB = [root(10, [11, 12]), root(20, [21])];
  const rootsUnion = [root(10, [11, 12]), root(20, [21])];
  assert.deepEqual(checkCrossRoleNesting({ rootsA, rootsB, rootsUnion }),
    { supported: true, offenders: [], enumeratorInconsistent: false });
});

test('cross-role nesting is unsupported and names the offending pairs', () => {
  const rootsA = [root(10, [11, 12, 13])];      // A selects the parent
  const rootsB = [root(12, [12])];              // B selects a descendant of it
  const rootsUnion = [root(10, [11, 12, 13])];  // the union collapses to the ancestor
  assert.deepEqual(checkCrossRoleNesting({ rootsA, rootsB, rootsUnion }), {
    supported: false, offenders: [{ ancestor: 10, descendant: 12 }], enumeratorInconsistent: false,
  });
});

test('offenders are capped at 20 and ascending by descendant dbId', () => {
  const owners = Array.from({ length: 30 }, (_, i) => 100 + i);
  const rootsA = [root(10, owners)];
  const rootsB = owners.map((o) => root(o, [o]));
  const r = checkCrossRoleNesting({ rootsA, rootsB, rootsUnion: [root(10, owners)] });
  assert.equal(r.supported, false);
  assert.equal(r.offenders.length, 20);
  assert.deepEqual(r.offenders.map((o) => o.descendant), owners.slice(0, 20));
  assert.ok(r.offenders.every((o) => o.ancestor === 10));
});

test('a union root belonging to neither role is an enumerator inconsistency, not a nesting failure', () => {
  const r = checkCrossRoleNesting({
    rootsA: [root(10, [11])], rootsB: [root(20, [21])],
    rootsUnion: [root(10, [11]), root(20, [21]), root(30, [31])],
  });
  assert.equal(r.enumeratorInconsistent, true);
  assert.equal(r.supported, false);
});

test('hierarchyInternalCandidates lists A-and-B roots with two or more owners (5.6.3)', () => {
  const rootsA = [root(10, [11, 12]), root(20, [20]), root(30, [31, 32, 33])];
  const rootsB = [root(10, [11, 12]), root(20, [20]), root(40, [41, 42])];
  // 10 is in both and has 2 owners -> claim-blocking candidate.
  // 20 is in both but has ONE owner -> no internal pair exists.
  // 30 is A-only and 40 is B-only -> the question asks no internal pair about them.
  assert.deepEqual(hierarchyInternalCandidates({ rootsA, rootsB }), [{ dbId: 10, ownerCount: 2 }]);
});

test('hierarchyInternalCandidates is empty for disjoint selections', () => {
  assert.deepEqual(hierarchyInternalCandidates({
    rootsA: [root(10, [11, 12])], rootsB: [root(20, [21, 22])],
  }), []);
});
```

- [x] **Step 2: Run it and see it fail.** `node --test test/clashtest/definition/roots.test.mjs` — expected failure: `TypeError: assertRootAntichain is not a function` (and the same for the other two) in all 7 tests.

- [x] **Step 3: Write the minimal implementation.** Append to `clashtest/definition/normalize.js`:

```js
const MAX_OFFENDERS = 20;
const ownersSubset = (a, b) => { const s = new Set(b); return a.every((o) => s.has(o)); };

/** 5.6.2: the returned roots must form an antichain (no root's subtree contains another's). */
export function assertRootAntichain(roots) {
  const violations = [];
  for (let i = 0; i < roots.length; i += 1) {
    for (let j = 0; j < roots.length; j += 1) {
      if (i === j) continue;
      if (roots[i].dbId === roots[j].dbId && i < j) { violations.push({ ancestor: roots[i].dbId, descendant: roots[j].dbId }); continue; }
      if (roots[i].dbId !== roots[j].dbId && ownersSubset(roots[j].ownerDbIds, roots[i].ownerDbIds)) {
        violations.push({ ancestor: roots[i].dbId, descendant: roots[j].dbId });
      }
    }
  }
  return { ok: violations.length === 0, violations: violations.slice(0, MAX_OFFENDERS) };
}

/** 5.6.5 rule INPUT: supported iff RU = RA u RB as dbId sets. The planner's use of it is P3. */
export function checkCrossRoleNesting({ rootsA, rootsB, rootsUnion }) {
  const roleRoots = new Map();
  for (const r of [...rootsA, ...rootsB]) if (!roleRoots.has(r.dbId)) roleRoots.set(r.dbId, r);
  const unionIds = new Set(rootsUnion.map((r) => r.dbId));
  const enumeratorInconsistent = rootsUnion.some((r) => !roleRoots.has(r.dbId));

  const dropped = [...roleRoots.keys()].filter((id) => !unionIds.has(id)).sort((a, b) => a - b);
  const offenders = [];
  for (const descendant of dropped) {
    if (offenders.length >= MAX_OFFENDERS) break;
    const owners = roleRoots.get(descendant).ownerDbIds;
    const ancestor = rootsUnion
      .filter((u) => u.dbId !== descendant && ownersSubset(owners, u.ownerDbIds))
      .map((u) => u.dbId).sort((a, b) => a - b)[0];
    offenders.push({ ancestor: ancestor === undefined ? null : ancestor, descendant });
  }
  return {
    supported: offenders.length === 0 && dropped.length === 0 && !enumeratorInconsistent,
    offenders,
    enumeratorInconsistent,
  };
}

/** 5.6.3 rule INPUT: a root in A n B whose subtree owns two or more fragment-owning nodes. */
export function hierarchyInternalCandidates({ rootsA, rootsB }) {
  const inB = new Set(rootsB.map((r) => r.dbId));
  return rootsA
    .filter((r) => inB.has(r.dbId) && r.ownerDbIds.length >= 2)
    .map((r) => ({ dbId: r.dbId, ownerCount: r.ownerDbIds.length }))
    .sort((a, b) => a.dbId - b.dbId);
}
```

- [x] **Step 4: Run it and see it pass.** `node --test test/clashtest/definition/roots.test.mjs` — expected: all 7 tests pass.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits).** Message: `feat(clashtest): add roots-contract helpers for the 5.6 hierarchy rules`.

---

## Verification / acceptance for P2

Run in this order; every command must be green before P2 is handed to P3.

| # | Check | Command | Spec AC |
|---|---|---|---|
| 1 | Reference schema and overload discrimination | `node --test test/clashtest/definition/reference.test.mjs` | R21-I3 (new; P7 adds it to the AC map) |
| 2 | V-matrix, issue cap, `validateTest` never throws, error mapping | `node --test test/clashtest/definition/validate.test.mjs` | AC-1 (validation, `maxValidationIssues`, distinct newer-schema rejection) |
| 3 | Normalization, canonical form, golden digest vectors, swap sensitivity | `node --test test/clashtest/definition/normalize.test.mjs` | AC-1 (digest golden vectors, invariance, swap pair) |
| 4 | Capture stability across yields, getter never invoked, deep freeze, sync/sliced normalization agree | `node --test test/clashtest/definition/capture-stability.test.mjs` | AC-1 (capture at the boundary, R11-1) |
| 5 | Store revisioning, archive, delete/tombstone, linearizability | `node --test test/clashtest/stores/InMemoryClashTestStore.test.mjs` | AC-1 (definition store, tombstone) |
| 6 | `resolveForRun` statuses + listing contract + page validation | `node --test test/clashtest/stores/clashTestStore.listing.test.mjs` | AC-1 (`resolveForRun` four statuses), AC-11 (listing paging, partial for `ClashTestStore`) |
| 7 | Definition operations surface, untrusted store reads, `StoreNotConfiguredError` | `node --test test/clashtest/definition/operations.test.mjs` | AC-1 (`validateTest`/`saveTest`/`startRun` accept and reject identically — the `startRun` leg lands in P6/P7) |
| 8 | Roots contract helpers | `node --test test/clashtest/definition/roots.test.mjs` | AC-1/AC-20 inputs (the planner assertions are P3/P5) |
| 9 | Whole suite, no regression | `npm test` | Master §5 DoD item 2 |

**Phase acceptance checklist**

- [ ] Every module in the File structure table exists and exports exactly the names in the Phase interface summary (no extras, no renames; `LIST_LIMIT` is in the summary).
- [ ] `validateTest` returns `{issues, issuesTruncated}` for **every** input in the hostile table (P2.3) and throws for none.
- [ ] `captureAndValidate` never invokes a getter (spy asserts 0 calls) and never rethrows a trap's error.
- [ ] Every P0 `CAPTURE_CODES` member maps to a member of `ISSUE_CODES` (the P2.2 mapping test has a row for each and fails if P0 adds a code).
- [ ] The seven golden digest vectors in P2.4 pass byte-for-byte, including the selection-swap pair.
- [ ] A definition mutated immediately after capture, and again from a yield hook, produces a digest and a prepared definition byte-identical to the unmutated control.
- [ ] `put` never overwrites: after any refusal, `get(testId)` returns exactly what it returned before.
- [ ] After `delete(testId)`, `put` at revision 1 rejects `TestDeletedError`, `get` returns `null`, and `list` omits the id — forever.
- [ ] A `delete`/`put` race resolves to exactly one of {live test, tombstone} — never neither.
- [ ] `list` returns every row present for a whole traversal exactly once under interleaved insert/delete.
- [ ] No module under `clashtest/definition/` or `clashtest/stores/` imports from `wwwroot/`, `collision/`, `three`, or any P3–P8 module; the only imports are P0 (`util/capture.js`, `util/canonical.js`, `util/slicer.js`, `options.js`, `errors.js`) and P1 (`identity/ids.js` → `CLASH_MODES`).
- [ ] The mechanical grep of *Conformance check* (every pre-reconciliation name from the reconciliation register) finds nothing in this file outside that section, and nothing in the P2 source and test files.
- [ ] `npm test` passes from a clean checkout with no server, no APS credentials and no network.
- [ ] `docs/handoffs/latest.md` updated from the verified final state (project CLAUDE.md).

## Implementation status (2026-09-21)

**P2.1–P2.9 IMPLEMENTED and verified on branch `feature/federated-clash-test-core-engine`; awaiting the independent Work review and adjudication gate before any P3 work.** Modules were built from this file's code blocks by task (RED confirmed per test file; per-task "Checkpoint commit" boxes are ticked as satisfied by a single authorized phase commit, if and when authorized). One internal Codex round (four findings: three High, one Low, all accepted and fixed with adversarial tests and mutation checks) is recorded in [`docs/reviews/2026-09-21-federated-clash-test-core-p2-internal-codex-review.md`](../../../reviews/2026-09-21-federated-clash-test-core-p2-internal-codex-review.md); the plan blocks for P2.4 `normalizeSelectionSteps`, P2.8 `listTests`, P2.9 `assertRootAntichain` and the P2.2 mapping test are superseded by the implementation. **P2 independent-review remediation (2026-09-21, uncommitted): the three adjudicated High findings are implemented** — H1 (`*Sliced` root-rule forms on shared generator bodies), H2 (sliced model-key sort), H3 (`spanRecorder` forwarding, digest span `'semanticDigest'`); see the adjudication record in `docs/reviews/`; a focused independent re-review is still required before P2 acceptance. Implemented counts after remediation: reference 9, validate 21, normalize 9, capture-stability 19, store 9, listing 7, operations 29, roots 22 = **125**; all `test/clashtest` 317/317. (Before remediation: 109 and 301/301.) Pre-remediation counts, for the record: reference 9, validate 21, normalize 9, capture-stability 14, store 9, listing 7, operations 26, roots 14 = 109; all `test/clashtest` 301/301; full `node scripts/run-tests.mjs` 1,427 total / 1,426 pass / 0 fail / 1 todo (pre-existing KNOWN GAP).

## Spec coverage

| Spec § | Covered by |
|---|---|
| §5.1 schema | P2.2 (`DEFINITION_KEYS`, V1–V6), P2.4 (`normalizeDefinition` output shape) |
| §5.2 operand semantics (union per model, `model` wins, duplicates merge) | P2.4 |
| §5.2 snapshot boundary / `snapshotBindings` | **Not P2** — the snapshot is taken at `queued → planning` by P6 over P1's `registry.snapshotBindings`; P2 contributes only the captured, frozen definition it snapshots *over*. See Gates and open items. |
| §5.3 single synchronous capture-and-validate pass, no coercion | P2.2 |
| §5.3 capture algorithm, accessor/symbol/sparse/proxy/prototype rules | P0 `captureData` (mechanism), invoked by P2.2 and mapped into `ISSUE_CODES`; P2.5 (behavioral proof at the definition boundary) |
| §5.3 bounded issue list, `issuesTruncated` | P2.2 |
| §5.3 validation matrix V1–V6 | P2.2 |
| §5.3 `InvalidTestDefinitionError` / `UnsupportedSchemaVersionError` split | P2.2 (the `rootGate`), P2.3 (`toDefinitionError`) |
| §5.3 normalization runs in slices, after validation only | P2.4, P2.5 |
| §5.4 `semanticDigest`, canonical JSON, golden vectors, swap is a different question | P2.4 |
| §5.4 `digestVersion: 1` | P0 (`util/canonical.js`); P2 consumes it through `digestCanonical` |
| §5.5 lifecycle `active → archived`, hard delete = tombstone | P2.6 |
| §5.5 `put` latest+1 / `RevisionConflictError`, never overwrites | P2.6 |
| §5.5 `isTombstoned`, linearizable with `delete` | P2.6 |
| §5.5 `resolveForRun` (revision + archive state from one point) | P2.6, P2.7 |
| §5.5 store consistency contract (linearizable per `testId`) | P2.6 |
| §5.5 `StoreNotConfiguredError` for the definition operations | P2.8 |
| §5.5 untrusted store definitions | P2.8 |
| §5.5 `engine.deleteTest` ordering (`tombstoneTest` THEN `delete`) | **P7** — P2 supplies only the `ClashTestStore` side (`delete` + tombstone) |
| §5.5 admission check `isTombstoned` at the first `queued` step | **P6** — P2 supplies `isTombstoned` |
| §5.6.2 root normalization to an antichain | P2.9 (`assertRootAntichain`) |
| §5.6.3 hierarchy-internal rule input | P2.9 (`hierarchyInternalCandidates`) |
| §5.6.5 cross-role nesting rule input | P2.9 (`checkCrossRoleNesting`); the `hierarchy-overlap` planning failure is P3 |
| §13.5 listing contract (order, keyset cursor, bounded limit) for `ClashTestStore.list` | P2.7 |
| §13.5 `TestSummary` closed schema, untrusted pages, `CorruptListingError` | P2.7, P2.8 |
| §18 `validateTest`/`saveTest`/`getTest`/`listTests`/`archiveTest` | P2.8 |
| §18 `startRun(definition｜{testId, revision?})` overload discrimination (E10 / R21-I3) | P2.1 (rule); the `startRun` binding itself is P6/P7 |

## Gates and open items

**Master gates that block work in this phase:** none blocks a P2 *task*. **G-PLAN** (plan review passed, "core-only" scope recorded) blocks the start of P0 implementation and therefore P2's too, transitively. **G-CAL** blocks only promoting `maxValidationIssues` / `maxEntriesPerSelection` / `maxExplicitElementsPerSelection` from provisional to frozen defaults — P2 reads all three from P0's `options.js` and hard-codes none, so no P2 task changes when G-CAL closes. **G-OQ16** does not block P2: `hierarchyInternalCandidates` computes the table either way; whether a non-empty table blocks a claim is P5's.

**Interfaces consumed from other phases — RECONCILED AND EXERCISED.** Each entry below was checked against the owning phase's *Phase interface summary*, corrected **producer-wins**, and the executable steps above were then re-run against copies of the producers' code (see *Conformance check*). The authority and the full register are [`interface-reconciliation.md`](interface-reconciliation.md) (rows N1, N4, N5, N6, N7 here). No entry is an open assumption.

1. **P0 `clashtest/util/capture.js` — row N4.** One whole-object function, `captureData(root, opts)`, plus `CAPTURE_CODES`, `deepFreeze`, `deepFreezeSliced`, `isDeepFrozen`. **`captureAndValidate` = `captureData(def, opts)` first, then V1–V6 on `result.value`**, with the `CAPTURE_TO_ISSUE` mapping of P2.1. `opts` per P0's Gates item 1: `maxNodes = 16 + 2 × (2 + 4 × maxEntriesPerSelection + maxExplicitElementsPerSelection)`, `maxIssues = limits.maxValidationIssues`, `maxStringLength = 4096`, `maxArrayLength = max(maxEntriesPerSelection, maxExplicitElementsPerSelection)` refined per path by `arrayLimitFor`, and `rootGate = {key:'schemaVersion', check}` firing only for an integer `> 1`. **P0's split of capture from schema validation is stated in this phase file (P2.1 *Interfaces*), as P0's Gates item 3 requires.** Consequences that differ visibly from the pre-reconciliation draft, all inside the observable invariants: structural issues are reported first and suppress the schema pass; a cycle is `cyclic` (not `unknown-property`); `array-extra-key` is reported at the array's own path; a `NaN`/`±Infinity` is `not-plain-object`; a newer `schemaVersion` is always the sole issue. The observable invariants asserted in P2.2/P2.5 are unchanged: no getter is invoked, each descriptor is read once, the caller's object is never touched again, and the value validated is the value used.
2. **P0 `clashtest/util/canonical.js` — row N5.** `digestCanonical(value)` (sync, value-taking) for `computeSemanticDigest`; `digestCanonicalSliced(value, slicer, {label?})` inside `prepareDefinition`; `canonicalJson` in the P2.4 test only. The seven golden vectors in P2.4 are the executable contract.
3. **P0 `clashtest/util/slicer.js` — row N6.** `createSlicer({...}) → {tick, yieldNow, forEach, sortSliced, stats}`; the yield point is `slicer.tick(label?)` (`undefined` or a Promise). P2 constructs no private slicer.
4. **P0 `clashtest/errors.js` — row N1.** Every class takes **one object argument**: `InvalidTestDefinitionError({issues, issuesTruncated})`, `UnsupportedSchemaVersionError({type, schemaVersion, supported})`, `RevisionConflictError({testId, latest, offered})`, `TestArchivedError({testId})`, `TestDeletedError({testId})`, `StoreNotConfiguredError({store})`, `CorruptListingError({issues})`, `InvalidOptionsError({issues, reason})`; `error.name` is the class name.
5. **P0 `clashtest/options.js`** — `ENGINE_LIMIT_DEFAULTS` carrying `maxValidationIssues`, `maxEntriesPerSelection`, `maxExplicitElementsPerSelection`, `sliceBudgetMs`, `aggregationSliceMaxItems`; resolved limits from P7 are merged over it. P2 hard-codes none of them.
6. **P0 test support** — `createFakeClock({start, tickMs, yieldAdvanceMs})` with `onYield(fn)` and `yieldCount`.
7. **P3 `ElementEnumerator.resolveRoots`** — root records carrying `{dbId, ownerDbIds}` with `ownerDbIds` ascending and distinct (§6.2), enforced at the port by P3's `validateResolveRootsResult`. P2.9 uses only those two fields; P3 calls P2's three helpers with the argument shapes in P2.9.
8. **P1 — row N7: the edge is a real one.** `clashtest/definition/validate.js` **imports `CLASH_MODES` from `clashtest/identity/ids.js`** and must not restate the mode list (P1: "sole code home of the mode list (P2's validator imports it)"). V6's "`mode` ∈ the four modes" is `CLASH_MODES.includes(d.mode)`, and a caller-supplied `pairSemantics` is rejected as `unknown-property` (§4.5 — semantics are derived from `mode`, never supplied). `pairSemanticsOf` is exercised by a P2.2 test only (an accepted mode always has derived semantics); the validator has no use for it. Nothing else is imported from P1: `modelKey` stays an opaque string inside a definition, and no `ModelRegistry` is touched here.

**Decisions left to implementers, with reasons:**

- Whether the collector's `valueFree` is a flag (as written) or a separate collector factory — only `message === ''` on listing issues is contractual.
- Whether `createDefinitionOperations` memoizes the slicer between calls — no observable difference; it is per-call for clarity.
- `saveTest` computes `semanticDigest` (§5.3 mandates it in the sliced body) but nothing persists it: §5.1 is closed and carries no digest field, so the value is discarded and recomputed at run time. An implementer may skip it with **no** externally observable difference; the plan keeps it because §5.3 says so and because it proves the normalized form is canonicalizable before the store sees it.
- `assertRootAntichain` is O(n²) in the root count over owner sets. That is fine at the fixture scale P3 exercises; if a real whole-model enumeration makes it hot, an implementer may index owners once into a `Map<ownerDbId, rootDbId>` and test containment in O(n) — same result, so no test changes.

**Additions/deviations this phase makes, for the controller to reconcile:**

- **New module not in the master §2 map:** `clashtest/definition/operations.js`. Reason: §18's `saveTest`/`getTest`/`listTests`/`archiveTest` are §5-governed rules (synchronous capture before the promise, untrusted store reads, `StoreNotConfiguredError`, `CorruptListingError`). Leaving them to P7's `engine.js` would make P7 re-derive §5.5 and would put the only tests for those rules in the integration phase. P2 owns the rules; P7's engine facade delegates. If the controller prefers, the same exports can live in `definition/validate.js`, but the master §2 map should then say so.
- **Discrimination reads the captured copy's own keys, not own *enumerable* keys** (the brief's example wording). Reason: `captureData` copies by `Reflect.ownKeys` and §5.3's capture rejects any key outside the schema, so an enumerable-only rule would let a non-enumerable key change the classification between discrimination and capture. One key notion for both closes that gap; the tests pin it. `classifyStartRunArgument` therefore performs a second capture (the cost is bounded by the definition node ceiling); it returns `invalid` for any structural capture failure.
- **Capture-then-validate, with structural issues first** (P0 design note 1). Two visible consequences besides those listed in item 1 above: an `invalid-schema-version` (a non-`1`, not-newer value) is reported alongside the other schema issues, whereas a *newer* version is gated to a single issue; and `issuesTruncated` is reported `true` whenever the cap is reached, on both layers (S-P2-4).
- **`gate` on the `captureAndValidate` result** and **`LIST_LIMIT`** are P2 additions to its summary (both listed there); neither changes a consumer's call.
- **Refusal precedence in `put`** (tombstone → archive → revision) is pinned by this plan; §5.5 names all three refusals but not their order.
- **`getTest` rejects** (rather than returning) an invalid stored definition; §5.3 (iv) requires validation on receipt but §5.5 defines the failure only for the run-admission path.
- **`getTest` returns the normalized, frozen copy**, not the store's bytes. The reference store already holds normalized definitions, so this is observable only against a foreign store; it is the fail-closed choice.

**Spec items that look contradictory — reported, not resolved:**

1. **`TestSummary` field set.** §5.5 says "`list` summaries carry `{testId, latestRevision, archived}`"; §13.5 defines the closed shape as `TestSummary = {testId, latestRevision, archived, name}`. This plan adopts §13.5's four-field shape because §13.5 is the section that declares the summary schemas closed and untrusted-validated. A definition-layer reader following §5.5 would reject every conforming page on `/summaries/0/name:unknown-property`. **SETTLED — register S-P2-1, APPLIED as spec erratum A2 (owner-authorized 2026-09-21): the one word `name` is added to §5.5's list, so both sections now give the same four-field closed shape.** No implementation step changes.
2. **`resolveForRun` loses `latestRevision` for a `missing` revision.** §5.5 says "a requested revision that does not exist is `missing`" *and* "`latestRevision` is the store's current latest, `null` for `deleted`/`missing`". So `resolveForRun('T', 99)` on a live test at revision 3 returns `{status:'missing', latestRevision: null}` — the caller cannot distinguish "no such test" from "no such revision of an existing test", although the store knows. Implemented literally here; flagged because a Panel will want the difference.
3. **V2 vs. the `UnsupportedSchemaVersionError` rule.** §5.3 requires a distinct error for a `schemaVersion` "greater than the engine understands"; V2 says only "Exactly `1`". The two failures need two codes, and §5.3 names only one (`unsupported-schema-version`). This plan adds `invalid-schema-version` for every non-`1` value that is not an integer greater than 1. Reported as an under-specification, resolved without changing any externally observable rule.
4. **`issuesTruncated` when the input has exactly `maxValidationIssues` issues.** §5.3 sets the flag when scanning stops at the cap, which cannot distinguish "exactly at the cap" from "more remained". This plan reports `issuesTruncated: true` in both cases (conservative, fail-closed). AC-1's own case ("an input with more than that many issues") is unaffected.
5. **Archive + wrong revision.** §5.5 gives `TestArchivedError` for "new revisions" on an archived test and `RevisionConflictError` for a bad revision, without saying which wins. Pinned here as archive-first; no spec text is contradicted, but a second implementation could reasonably choose the other order, which AC-1's interleaving test would not catch.

## Conformance check

Mechanical check that the *executable* steps of this file (test code, implementation code, *Interfaces* blocks, verification lists) use the producers' reconciled names — the defect class that survived the summary-level reconciliation in the other phase files. Authority: [`interface-reconciliation.md`](interface-reconciliation.md) (name table rows N1, N3–N7, N27–N29) and each producer's `## Phase interface summary` (P0 `errors.js` / `util/capture.js` / `util/canonical.js` / `util/slicer.js` / `options.js` / `test/clashtest/support/`; P1 `identity/ids.js`; P3 `planning/ElementEnumerator.js`).

**Cross-phase call sites, each checked against its producer's summary.**

| P2 call site | Producer / name | Checked against |
|---|---|---|
| `captureData(root, {maxNodes, maxIssues, maxStringLength, maxArrayLength, arrayLimitFor, rootGate})` and the `{ok, value \| issues, issuesTruncated, gate?}` result; `CAPTURE_CODES` | P0 `util/capture.js` | P0 summary + `captureData` source; a test asserts every `CAPTURE_CODES` member has a mapping row |
| `deepFreeze`, `deepFreezeSliced(value, slicer)`, `isDeepFrozen` | P0 `util/capture.js` | P0 summary |
| `digestCanonical(value)`, `digestCanonicalSliced(value, slicer, {label})`, `canonicalJson` (test) | P0 `util/canonical.js` | P0 summary (rows N3, N5); golden vectors re-run against the extracted P0 code |
| `createSlicer({now, yieldToScheduler, limits, sliceBudgetMs})`, `slicer.tick(label)` | P0 `util/slicer.js` | P0 summary (row N6); `sliceBudgetMs` positive integer honoured |
| `ENGINE_LIMIT_DEFAULTS` (`maxValidationIssues`, `maxEntriesPerSelection`, `maxExplicitElementsPerSelection`, `sliceBudgetMs`, `aggregationSliceMaxItems`) | P0 `options.js` | P0 summary (row N33); no default restated |
| `InvalidTestDefinitionError`, `UnsupportedSchemaVersionError`, `RevisionConflictError`, `TestArchivedError`, `TestDeletedError`, `StoreNotConfiguredError`, `CorruptListingError`, `InvalidOptionsError` — every construction is `new XError({...})` | P0 `errors.js` | P0 summary (row N1) field tables |
| `createFakeClock({tickMs})`, `.now`, `.yieldToScheduler`, `.onYield`, `.yieldCount` | P0 `test/clashtest/support/index.mjs` | P0 summary (no private clock in P2) |
| `CLASH_MODES` (imported by `validate.js`); `pairSemanticsOf` (test only) | P1 `identity/ids.js` | P1 summary (row N7); mode list not restated in P2 source |
| `{dbId, ownerDbIds}` root records; the three helpers' argument shapes as P3 calls them | P3 `planning/ElementEnumerator.js`, `planning/planner.js` | P3 summary + Task P3.x text (P3 consumes P2, not the reverse) |

**Pre-reconciliation ("consumer-assumed") names grepped for.** Run over this file *outside this section* (`sed '/^## Conformance check/,$d' p2-definitions.md | grep -cF -- '<name>'`), and over the P2 source and test snippets. **Every count is 0.**

| Register row | Old / assumed name searched | Hits |
|---|---|---|
| N4 | `ownKeysOf`, `readOwnValue`, `prototypeIsPlain` | 0 |
| N29 | `captureDefinition`, `captureResultSet` (attributed to P0 by consumers) | 0 |
| N3 | `digestOf` | 0 |
| N5 | `digestSync` | 0 |
| N6 | `checkpoint(`, `.checkpoint`, `.step(`, `runSliced` (slicer yield spellings) | 0 |
| N6 / P0 slicer | `sliceBudgetMs: 0` (P0 rejects it) | 0 |
| P0 support | `makeSlicedClock`, `makeHostileDefinition` (private clock / undefined fixture) | 0 |
| N33 | hard-coded fallbacks `?? 4`, `?? 100`, `?? 1024`, `?? 10000` | 0 |
| N7 | `const MODES`, `pairSemanticsForMode`, "imports **nothing** from P1" | 0 |
| N27 | `state:` / `resolveForRun.*state` (P7's assumed field; P2's is `status`) | 0 |
| N1 | `e.code`, `err.code`; positional constructions `new TestDeletedError(testId`, `new TestArchivedError(testId`, `new UnsupportedSchemaVersionError(issues`, `new InvalidOptionsError(issues`; regex `new [A-Za-z]+Error\(` not followed by `{` | 0 |
| — | the words `Assumed` and `read through` (superseded-note markers) | 0 |

**Executed evidence.** The code blocks of P2.1–P2.9 were run in a scratch directory with **P0's `errors.js`, `util/capture.js`, `util/canonical.js`, `util/slicer.js`, `options.js` and `test/clashtest/support/*` extracted verbatim from `p0-foundations.md`**, and a ten-line stub of P1's `identity/ids.js` (`CLASH_MODES`, `pairSemanticsOf` exactly as P1's summary declares them). Result: `node --test test/clashtest/definition/*.test.mjs test/clashtest/stores/*.test.mjs` → **76 tests, 76 pass, 0 fail** (reference 9, validate 19, normalize 8, capture-stability 7, store 9, listing 7, operations 10, roots 7). This run found and fixed, before the snippets were written into this file: the private clock and `sliceBudgetMs: 0` (P0's slicer throws on `0`); positional error constructors; a revoked-proxy `String()` slip in the hostile-input test; a `too-many-nodes` probe that actually hit the array cap; and the sync/sliced normalization duplicate (now one generator).

**Deviations from the register, for the controller.** (1) Register row N7 says `validate.js` imports *both* `CLASH_MODES` and `pairSemanticsOf`; the validator has no use for the second (a `pairSemantics` field is just an unknown key), so only `CLASH_MODES` is imported there and `pairSemanticsOf` is used by a test — an unused import would be dead code. (2) `captureAndValidate` gains an optional `gate` result field and `validateTestSummaryPage` gains no `opts` (it never used one); `LIST_LIMIT` is a new export — all recorded in the Phase interface summary.
