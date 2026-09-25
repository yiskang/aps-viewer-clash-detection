// test/clashtest/integration/recordRef.producerReader.test.mjs
//
// H1 (P7 independent review adjudication, owner ruling): `hierarchyInternalAcceptance.recordRef` is capped at 512
// UTF-16 code units by the frozen spec (§8.3, §18, AC-20(d)) and by the engine's construction check
// (clashtest/engine.js MAX_RECORD_REF_UNITS). The result-set schema used to type it `str('id')` (STRING_CAPS.id = 256),
// so a 257..512-unit recordRef sealed and persisted 'saved', and then every read-back (by id after release, and a raw
// set passed to assessNoClashClaim) failed capture with CorruptResultSetError at
// /provenance/hierarchyInternalAcceptance/recordRef, `string-too-long`. Fix: a dedicated STRING_CAPS.recordRef = 512;
// the generic `id` cap stays 256.
//
// Boundary: 512 accepted (schema AND full engine round trip), 513 rejected (schema; and at engine construction, which
// test/clashtest/engine/construction.test.mjs already covers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { validateResultSet } from '../../../clashtest/results/validateResultSet.js';
import { resolveEngineLimits } from '../../../clashtest/options.js';
import { STRING_CAPS } from '../../../clashtest/results/resultSetSchema.js';
import { resealed } from '../support/resultSetFixtures.mjs';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';

const REF_PATH = '/provenance/hierarchyInternalAcceptance/recordRef';
const MAX_REF = 512;                                                 // spec §8.3 / AC-20(d)
const GENERIC_ID_CAP = 256;                                          // ordinary `id` fields are unchanged

const withRecordRef = (recordRef) => resealed((s) => { s.provenance.hierarchyInternalAcceptance = { recordRef }; },
  'schema-corpus');
const limits = resolveEngineLimits(undefined);
const validate = (set) => validateResultSet(structuredClone(set), { limits });
const tooLong = (result) => result.issues.filter((i) => i.code === 'string-too-long');

// ---- schema / validator level -------------------------------------------------------------------------------------

test('STRING_CAPS: recordRef has its own 512 cap; the generic id cap is still 256', () => {
  assert.equal(STRING_CAPS.recordRef, MAX_REF);
  assert.equal(STRING_CAPS.id, GENERIC_ID_CAP);
});

test('a sealed set whose recordRef is exactly 512 code units validates', async () => {
  const set = await withRecordRef('r'.repeat(MAX_REF));
  const result = validate(set);
  assert.deepEqual(result.issues, []);
  // The boundary is in CODE UNITS (String.length), the unit the engine's construction check counts.
  const astral = await withRecordRef('\u{1F600}'.repeat(MAX_REF / 2));
  assert.equal(astral.provenance.hierarchyInternalAcceptance.recordRef.length, MAX_REF);
  assert.deepEqual(validate(astral).issues, []);
});

test('a recordRef of 513 code units is rejected as string-too-long at the recordRef path', async () => {
  const set = await withRecordRef('r'.repeat(MAX_REF + 1));
  const issues = tooLong(validate(set));
  assert.deepEqual(issues.map((i) => i.path), [REF_PATH]);
});

test('ordinary id fields still cap at 256: a 257-unit registrySessionId is rejected, 256 is accepted', async () => {
  const at = await resealed((s) => { s.provenance.registrySessionId = 'i'.repeat(GENERIC_ID_CAP); }, 'schema-corpus');
  assert.deepEqual(validate(at).issues, []);
  const over = await resealed((s) => { s.provenance.registrySessionId = 'i'.repeat(GENERIC_ID_CAP + 1); }, 'schema-corpus');
  assert.deepEqual(tooLong(validate(over)).map((i) => i.path), ['/provenance/registrySessionId']);
});

// ---- engine level: produce -> seal -> persist -> release -> read back --------------------------------------------

const frag = (fragId, ownerDbId, geometryId = 1) => ({ fragId, ownerDbId, geometryId });
/** Root 20's subtree holds fragments of TWO owners (20, 21): a hierarchy-internal root under a whole-model self-test. */
const nestedModelSpec = () => ({
  modelKey: 'x',
  roots: [
    { dbId: 20, owners: [20, 21], fragments: [frag(0, 20), frag(1, 21)] },
    { dbId: 30, owners: [30], fragments: [frag(2, 30)] },
  ],
});
const selfTestDef = () => makeDefinition({
  testId: 'S',
  selectionA: { entries: [{ kind: 'model', modelKey: 'x' }] },
  selectionB: { entries: [{ kind: 'model', modelKey: 'x' }] },
});

test('a 512-unit recordRef survives the engine round trip: seal, persist, release, then every read-back succeeds', async () => {
  const recordRef = 'D'.repeat(MAX_REF);
  const store = createInMemoryResultStore();
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 25) });
  const world = createEngineWorld({ modelSpecs: [nestedModelSpec()] });
  const engine = createClashTestEngine(world.config({
    now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {},
    resultStore: store, hierarchyInternalAcceptance: { recordRef },
  }));

  const h = engine.startRun(selfTestDef());
  const summary = await h.done;
  const set = summary.resultSet;
  assert.equal(set.outcome.status, 'completed');
  assert.equal(set.outcome.coverage, 'full');
  assert.equal(set.outcome.integrity, 'clean');
  assert.equal(set.ledger.hierarchyInternal.length, 1, 'the run must actually exercise the hierarchy-internal path');
  assert.equal(set.provenance.hierarchyInternalAcceptance.recordRef.length, MAX_REF);
  await h.persisted;
  assert.equal(engine.getPersistenceState(h.runId).state, 'saved');

  // A raw copy of the engine's own sealed set is readable by the claim surface.
  const viaRaw = await engine.assessNoClashClaim(structuredClone(set));
  assert.equal(viaRaw.allowed, true);
  assert.deepEqual(viaRaw.qualifiers,
    [{ kind: 'hierarchy-internal-accepted', recordRef, rootCount: 1, ownerCount: 2 }]);

  // Drop the resident copy: everything below is a store read-through, i.e. capture + validate of the stored set.
  engine.releaseResultSet(h.runId);
  assert.equal(engine.getRun(h.runId), null);
  const back = await engine.getResultSet(h.runId);
  assert.equal(back.provenance.hierarchyInternalAcceptance.recordRef, recordRef);
  const assessment = await engine.assessNoClashClaim(h.runId);
  assert.equal(assessment.allowed, true);
  assert.equal(assessment.unqualified, false);
  assert.deepEqual(assessment.qualifiers,
    [{ kind: 'hierarchy-internal-accepted', recordRef, rootCount: 1, ownerCount: 2 }]);
  assert.deepEqual(await engine.getFreshness(h.runId), { state: 'current', reasons: [] });
  // Rerun by id re-reads the stored set through the same boundary, and its own sealed set reads back too.
  const rerun = await engine.rerun(h.runId, {});
  const rerunSummary = await rerun.done;
  assert.equal(rerunSummary.resultSet.provenance.hierarchyInternalAcceptance.recordRef, recordRef);
  await rerun.persisted;
  engine.releaseResultSet(rerun.runId);
  assert.equal((await engine.assessNoClashClaim(rerun.runId)).allowed, true);
});
