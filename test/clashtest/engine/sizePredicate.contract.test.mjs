// test/clashtest/engine/sizePredicate.contract.test.mjs
//
// Spec erratum A16 (owner ruling on M2 / D-6, Option C; docs/reviews/2026-09-25-...-p7-independent-review-
// adjudication.md): the §13.6 "exact ResultSetTooLargeError predicate" clause (ii) is a RERUN admission /
// capacity check against THAT rerun's resolved `maxResultsPerRun` / `maxLedgerRecords` /
// `maxRetainedDiagnostics` (RunOptions, §17.1.1), for a resident or read-through base; a caller-supplied
// RAW base is exempt. `getResultSet`, `getFreshness`, `canClaimNoClashes` and `assessNoClashClaim` never
// make a set resident, take no run options, and apply no run-option count: they are bounded only by the
// store-side byte guard (i) and the node limit (iii, `maxCapturedNodes`).
//
// This file PINS the shipped behaviour (no engine change): every test here passed as soon as it was
// written. The same-file boundary/resident/read-through/raw arms of (ii) already live in rerun.test.mjs
// ("predicate (ii)" block) and the node limit (iii) in integration/maximumShape.test.mjs
// ("a valid set read by an engine with a smaller maxCapturedNodes ..."); this file adds the contrast
// the ruling turns on: the SAME self-produced set, over exactly one DEFAULT count, is readable by every
// non-rerun read while `rerun(id, {})` refuses it and a rerun that raises the limit admits it.
//
// The set is produced by the engine itself under `maxRetainedDiagnostics: default + 1` (a legal option,
// the producer/reader invariant still holds), so it carries `default + 1` retained diagnostics. G-CAL:
// the §17.1 default is imported (`RUN_OPTION_DEFAULTS`), never written as a literal; time is a fake clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import { CorruptResultSetError, ResultSetTooLargeError } from '../../../clashtest/errors.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';

const OVER_DIAGNOSTICS = RUN_OPTION_DEFAULTS.maxRetainedDiagnostics + 1;

/** One retained diagnostic per source root (distinct `dbId`s do not merge). */
function diagnosingExecutor() {
  return (request) => createScriptedExecutor({}, {
    unscripted: {
      facts: [],
      diagnostics: request.materialized.sourceDbIds.map((dbId) => ({
        reason: 'fragment-bounds-empty', modelKey: request.unit.sourceModelKey, dbId,
      })),
    },
  })(request);
}

function config(extra = {}, worldOptions = {}) {
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 25) });
  return createEngineWorld(worldOptions).config({
    unitExecutor: diagnosingExecutor(),
    now: clock.now,
    yieldToScheduler: clock.yieldToScheduler,
    scheduleTimeout: () => () => {},
    ...extra,
  });
}

/**
 * A completed set whose retained-diagnostic count is exactly one over the §17.1 default. The source roots are
 * split over two models because a model may carry at most `maxEntriesPerSelection` (10,000) union roots
 * (erratum A15 / D-10), and the default count is exactly that.
 */
async function overDefaultBase() {
  const frag = (fragId, ownerDbId) => ({ fragId, ownerDbId, geometryId: 1 });
  const rootsOf = (from, count) => Array.from({ length: count }, (_, i) => {
    const dbId = from + i;
    return { dbId, owners: [dbId], fragments: [frag(dbId, dbId)] };
  });
  const inA = Math.ceil(OVER_DIAGNOSTICS / 2);
  const modelSpecs = [
    { modelKey: 'mA', roots: rootsOf(1, inA) },
    { modelKey: 'mB', roots: rootsOf(inA + 1, OVER_DIAGNOSTICS - inA) },
    { modelKey: 'mC', roots: rootsOf(OVER_DIAGNOSTICS + 1, 1) },
  ];
  const engine = createClashTestEngine(config({}, { modelSpecs }));
  const def = makeDefinition({
    testId: 'T',
    selectionA: { entries: [{ kind: 'model', modelKey: 'mA' }, { kind: 'model', modelKey: 'mB' }] },
    selectionB: { entries: [{ kind: 'model', modelKey: 'mC' }] },
  });
  const summary = await engine.startRun(def, { maxRetainedDiagnostics: OVER_DIAGNOSTICS }).done;
  return { engine, set: summary.resultSet };
}

test('A16: a self-produced set over one default count is readable by every non-rerun read, resident and released', async () => {
  const { engine, set } = await overDefaultBase();
  assert.equal(set.outcome.status, 'completed');
  assert.equal(set.diagnostics.diagnostics.length, OVER_DIAGNOSTICS, 'fixture: exactly one retained diagnostic over the default');

  for (const phase of ['resident', 'released']) {
    if (phase === 'released') engine.releaseResultSet(set.runId);        // saved: read-through only from here
    const read = await engine.getResultSet(set.runId);
    assert.equal(read.digests.pairSetDigest, set.digests.pairSetDigest, `${phase}: getResultSet`);
    const freshness = await engine.getFreshness(set.runId);
    assert.ok(freshness && typeof freshness.state === 'string', `${phase}: getFreshness resolves`);
    assert.equal(typeof await engine.canClaimNoClashes(set.runId), 'boolean', `${phase}: canClaimNoClashes resolves`);
    const assessment = await engine.assessNoClashClaim(set.runId);
    assert.ok(assessment && typeof assessment === 'object', `${phase}: assessNoClashClaim resolves`);
    assert.equal(engine.retentionReport().readSlotsInUse, 0, `${phase}: no read slot leaked`);
  }
});

test('A16: rerun(id, {}) refuses that same set (predicate ii, default options), resident and released, never as corrupt', async () => {
  const { engine, set } = await overDefaultBase();
  const isTooLarge = (e) => e instanceof ResultSetTooLargeError && !(e instanceof CorruptResultSetError) && e.runId === set.runId;
  await assert.rejects(engine.rerun(set.runId, {}), isTooLarge, 'resident base');
  engine.releaseResultSet(set.runId);
  await assert.rejects(engine.rerun(set.runId, {}), isTooLarge, 'read-through base');
  await assert.rejects(engine.rerun(set.runId, { runOptions: {} }), isTooLarge, 'explicit empty runOptions is the same rerun');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
  // The refusal never poisons the set: it is still readable afterwards.
  assert.equal((await engine.getResultSet(set.runId)).runId, set.runId);
});

test('A16: a rerun whose own runOptions carry the larger limit is admitted (the capacity fit is against THAT rerun)', async () => {
  const { engine, set } = await overDefaultBase();
  const resident = await engine.rerun(set.runId, { runOptions: { maxRetainedDiagnostics: OVER_DIAGNOSTICS } });
  assert.equal((await resident.done).resultSet.derivedFromRunId, set.runId);
  engine.releaseResultSet(set.runId);
  const readThrough = await engine.rerun(set.runId, { runOptions: { maxRetainedDiagnostics: OVER_DIAGNOSTICS } });
  assert.equal((await readThrough.done).resultSet.derivedFromRunId, set.runId);
});

test('A16: a RAW rerun base is exempt from (ii) even at default options: rerun(structuredClone(set), {}) is admitted', async () => {
  const { engine, set } = await overDefaultBase();
  const handle = await engine.rerun(structuredClone(set), {});
  assert.equal((await handle.done).resultSet.derivedFromRunId, set.runId);
  // ...and the by-id form of the very same rerun is the one that is refused.
  await assert.rejects(engine.rerun(set.runId, {}), ResultSetTooLargeError);
});
