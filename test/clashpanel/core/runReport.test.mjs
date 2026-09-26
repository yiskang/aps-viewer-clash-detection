// test/clashpanel/core/runReport.test.mjs — Task 11 (spec §7.3, §7.5, §8.4, §13; AC-P2, AC-P9, AC-P12)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATEMENTS, describeAxes, explainNoClashGaps, emptyStatement, runHeadline, mapSealedFailure,
  mapAdmissionError, bannersFor, diagnosticsExport, unitGapLines, scopeSummary,
} from '../../../clashpanel/core/runReport.js';
// Test-only use of the real Core (the Panel itself never imports the pure claim function).
import {
  assessNoClashClaim, InvalidTestDefinitionError, UnsupportedSchemaVersionError, StoreNotConfiguredError,
  InvalidOptionsError, ResultCapacityError, RunQueueFullError, EngineDisposedError,
} from '../../../clashtest/index.js';
import { sealedSet, sealFakeRun, resealed, claimableSet } from '../../clashtest/support/resultSetFixtures.mjs';

const CURRENT = Object.freeze({ state: 'current', reasons: [] });
const SEALED_KINDS = ['default', 'cancelled-pre-resolution', 'positives', 'completed-clean', 'completed-with-gaps', 'schema-corpus', 'unreachable-positive', 'hierarchy-internal'];
const FAKE_KINDS = ['completed-clean', 'completed-with-gaps', 'cancelled-pre-resolution', 'failed', 'invalidated'];
async function allFixtures() {
  const out = [];
  for (const k of SEALED_KINDS) out.push([`sealedSet:${k}`, await sealedSet(k)]);
  for (const k of FAKE_KINDS) out.push([`sealFakeRun:${k}`, await sealFakeRun(k)]);
  return out;
}
/** Every string reachable in a value (for the wording bans). */
function strings(v, acc = []) {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, acc));
  return acc;
}
// Only the two §7.5 claim sentences may start with "No clashes".
const BARE_NO_CLASHES = /\bNo clashes\b(?! found in the evaluated scope\.| found, excluding the hierarchy-internal pairs)/;

test('DIFFERENTIAL vs Core: explainNoClashGaps is empty iff assessNoClashClaim(set, current).allowed (results stripped)', async () => {
  for (const [label, set] of await allFixtures()) {
    const stripped = { ...set, results: [] };             // results are positives, never a "gap"
    const claim = assessNoClashClaim(stripped, CURRENT);
    const gaps = explainNoClashGaps(stripped, { freshness: CURRENT, claim });
    assert.equal(gaps.length === 0, claim.allowed, `${label}: gaps=${gaps.map((g) => g.code)}`);
  }
});

test('DIFFERENTIAL vs Core: each single conjunct flip of claimableSet() yields exactly its own gap code', () => {
  const flips = [
    ['not-completed', (s) => { s.outcome.status = 'cancelled'; }],
    ['partial-coverage', (s) => { s.outcome.coverage = 'partial'; }],
    ['caveated', (s) => { s.outcome.integrity = 'caveated'; }],
    ['zero-pair-space', (s) => { s.ledger.pairSpaceTotal = 0; }],
    ['empty-operand', (s) => { s.ledger.emptyOperand = true; }],
    ['unresolved-selection', (s) => { s.ledger.unresolvedSelections = [{ modelKey: 'm', dbId: 1 }]; }],
    ['unreachable-population', (s) => { s.ledger.unreachablePopulation = [{ modelKey: 'm' }]; }],
    ['hierarchy-internal', (s) => { s.ledger.hierarchyInternal = [{ modelKey: 'm', rootCount: 1, ownerCount: 2 }]; }],
    ['unknown-digest-version', (s) => { s.digests.digestVersion = 999; }],
  ];
  const base = claimableSet();
  assert.equal(assessNoClashClaim(base, CURRENT).allowed, true, 'control');
  assert.deepEqual(explainNoClashGaps(base, { freshness: CURRENT, claim: assessNoClashClaim(base, CURRENT) }), []);
  for (const [code, flip] of flips) {
    const s = claimableSet();
    flip(s);
    const claim = assessNoClashClaim(s, CURRENT);
    assert.equal(claim.allowed, false, code);
    assert.deepEqual(explainNoClashGaps(s, { freshness: CURRENT, claim }).map((g) => g.code), [code]);
  }
  for (const f of [{ state: 'stale', reasons: ['scope-drift'] }, { state: 'unverifiable', reasons: [] }]) {
    const claim = assessNoClashClaim(claimableSet(), f);
    assert.equal(claim.allowed, false);
    assert.deepEqual(explainNoClashGaps(claimableSet(), { freshness: f, claim }).map((g) => g.code), ['stale']);
  }
  const accepted = claimableSet();
  accepted.ledger.hierarchyInternal = [{ modelKey: 'm', rootCount: 1, ownerCount: 2 }];
  accepted.provenance.hierarchyInternalAcceptance = { recordRef: 'rec-1' };
  assert.equal(assessNoClashClaim(accepted, CURRENT).allowed, true);
  assert.deepEqual(explainNoClashGaps(accepted, { freshness: CURRENT }), [], 'accepted hierarchy-internal is not a gap');
});

test('§7.5 wording matrix: claim / qualified-claim / non-claim / stale / pending / results present', async () => {
  const cleanSet = await sealedSet('completed-clean');
  const allowed = assessNoClashClaim(cleanSet, CURRENT);
  const claim = emptyStatement({ resultSet: cleanSet, claim: allowed, freshness: CURRENT, modelName: (k) => `Model ${k.slice(-12)}` });
  assert.equal(claim.kind, 'claim');
  assert.equal(claim.text, 'No clashes found in the evaluated scope.');
  assert.deepEqual(claim.lines, scopeSummary(cleanSet, (k) => `Model ${k.slice(-12)}`));
  assert.match(claim.lines[0], /^Set A: /);

  const qualified = emptyStatement({ resultSet: { ...cleanSet, ledger: { ...cleanSet.ledger, hierarchyInternal: [{ modelKey: 'mA', rootCount: 4, ownerCount: 9 }] } },
    claim: { allowed: true, unqualified: false, qualifiers: [{ kind: 'hierarchy-internal-accepted' }] }, freshness: CURRENT });
  assert.equal(qualified.kind, 'qualified-claim');
  assert.equal(qualified.text, STATEMENTS.QUALIFIED_CLAIM);
  assert.deepEqual(qualified.lines, ['mA: 4 roots, 9 owners']);

  const hier = { ...(await sealedSet('hierarchy-internal')), results: [] };  // whole-model self-clash shape (spec §7.5)
  const nonClaim = emptyStatement({ resultSet: hier, claim: assessNoClashClaim(hier, CURRENT), freshness: CURRENT });
  assert.equal(nonClaim.kind, 'non-claim');
  assert.equal(nonClaim.text, '0 clashes reported — this is not a clearance.');
  assert.deepEqual(nonClaim.lines, [explainNoClashGaps(hier, { freshness: CURRENT })[0].text]);

  const staleF = { state: 'stale', reasons: ['scope-drift'] };
  const stale = emptyStatement({ resultSet: cleanSet, claim: assessNoClashClaim(cleanSet, staleF), freshness: staleF });
  assert.equal(stale.kind, 'stale');
  assert.equal(stale.text, STATEMENTS.NON_CLAIM);
  assert.deepEqual(stale.lines, [STATEMENTS.STALE, 'Reason: scope-drift']);

  const pending = emptyStatement({ resultSet: cleanSet, claim: null, freshness: null });
  assert.equal(pending.kind, 'non-claim');
  assert.equal(pending.text, STATEMENTS.CLAIM_PENDING);

  assert.equal(emptyStatement({ resultSet: await sealedSet('positives'), claim: null, freshness: null }), null, 'results present ⇒ no empty statement');
  assert.equal(emptyStatement({ resultSet: null }), null);
});

test('H1 claim gate: a clearance sentence needs claim.allowed === true AND a completed freshness.state === "current" (whole matrix)', async () => {
  const cleanSet = await sealedSet('completed-clean');                       // empty results, completed/full/clean
  const ALLOWED = { allowed: true, unqualified: true, qualifiers: [], exclusions: [], proofMethod: 'bracketed-digest' };
  const QUALIFIED = { allowed: true, unqualified: false, qualifiers: [{ kind: 'hierarchy-internal-accepted' }], exclusions: [] };
  const DENIED = { allowed: false, unqualified: false, qualifiers: [], exclusions: [] };
  const claims = { allowed: ALLOWED, qualified: QUALIFIED, denied: DENIED, pending: null };
  const freshnesses = {
    current: CURRENT,
    stale: { state: 'stale', reasons: ['scope-drift'] },
    unverifiable: { state: 'unverifiable', reasons: [] },
    pending: null,
    empty: {},                                                              // malformed reads fail closed
    unknownState: { state: 'fresh', reasons: [] },
    noReasons: { state: 'current' },
  };
  for (const [cn, claim] of Object.entries(claims)) {
    for (const [fn, freshness] of Object.entries(freshnesses)) {
      const s = emptyStatement({ resultSet: cleanSet, claim, freshness });
      const mayClaim = claim !== null && claim.allowed === true && fn === 'current';
      assert.equal(['claim', 'qualified-claim'].includes(s.kind), mayClaim, `${cn} × ${fn}: kind ${s.kind}`);
      if (!mayClaim) for (const str of strings(s)) assert.doesNotMatch(str, /No clashes/, `${cn} × ${fn}: ${str}`);
    }
  }
  const kindOf = (claim, freshness) => emptyStatement({ resultSet: cleanSet, claim, freshness });
  assert.equal(kindOf(ALLOWED, CURRENT).text, STATEMENTS.CLAIM);                                 // allowed + current ⇒ allowed wording
  assert.equal(kindOf(QUALIFIED, CURRENT).text, STATEMENTS.QUALIFIED_CLAIM);
  const allowedStale = kindOf(ALLOWED, freshnesses.stale);                                       // allowed + stale ⇒ forbidden
  assert.deepEqual([allowedStale.kind, allowedStale.text, allowedStale.lines], ['stale', STATEMENTS.NON_CLAIM, [STATEMENTS.STALE, 'Reason: scope-drift']]);
  assert.equal(kindOf(ALLOWED, freshnesses.unverifiable).kind, 'stale');
  assert.equal(kindOf(ALLOWED, null).text, STATEMENTS.CLAIM_PENDING);                            // freshness not read yet ⇒ pending, not a claim
  assert.equal(kindOf(null, CURRENT).text, STATEMENTS.CLAIM_PENDING);                            // claim not read yet ⇒ pending
  assert.equal(kindOf(DENIED, CURRENT).text, STATEMENTS.NON_CLAIM);                              // disallowed + current ⇒ forbidden
  assert.equal(kindOf(ALLOWED, freshnesses.empty).kind, 'non-claim');
});

test('AC-P2: no output of any runReport function contains a bare "No clashes" across all fixtures × claim states', async () => {
  const produced = [];
  for (const [, set] of await allFixtures()) {
    for (const fresh of [CURRENT, { state: 'stale', reasons: ['r'] }, { state: 'unverifiable', reasons: [] }, null]) {
      const empty = { ...set, results: [] };
      const claim = fresh === null ? null : assessNoClashClaim(empty, fresh);
      produced.push(emptyStatement({ resultSet: empty, claim, freshness: fresh }), explainNoClashGaps(empty, { freshness: fresh ?? undefined, claim }));
      produced.push(describeAxes(set.outcome, fresh), mapSealedFailure(set), bannersFor({ terminal: { status: set.outcome.status, resultSetPresent: true }, resultSet: set, freshness: fresh, setupChanged: true, persistence: { state: 'failed' } }));
      for (const status of ['completed', 'cancelled', 'failed', 'invalidated']) produced.push(runHeadline({ status, total: set.results.length, coverage: set.outcome.coverage, resultSet: set }));
    }
  }
  for (const s of strings(produced)) assert.doesNotMatch(s, BARE_NO_CLASHES, s);
  assert.ok(strings(produced).includes(STATEMENTS.CLAIM), 'the claim sentence is reachable (completed-clean + current)');
});

test('§7.3 headlines: completed / cancelled (planning vs running) / invalidated / failed by cause / null set', async () => {
  assert.equal(runHeadline({ status: 'completed', total: 2, coverage: 'full' }), 'Completed — 2 clashes');
  assert.equal(runHeadline({ status: 'completed', total: 1, coverage: 'partial' }), 'Completed — 1 clash (partial coverage)');
  assert.equal(runHeadline({ status: 'completed', total: 0, coverage: 'full' }), 'Completed — 0 clashes');
  const planningCancel = await sealFakeRun('cancelled-pre-resolution');
  assert.equal(mapSealedFailure(planningCancel).headline, 'Stopped before any results');
  const runningCancel = await resealed((d) => { d.outcome.status = 'cancelled'; d.outcome.reasons = ['cancel-requested']; }, 'positives');
  assert.equal(mapSealedFailure(runningCancel).headline, 'Stopped — partial results (2)');
  assert.match(mapSealedFailure(runningCancel).retainedNote, /^2 clashes found before the run ended are valid/);
  assert.equal(mapSealedFailure(await sealFakeRun('invalidated')).headline, 'The model changed during the run — results are partial and stale');
  assert.equal(runHeadline({ status: 'failed', total: 0, resultSet: null }), STATEMENTS.NO_RESULT_SET);
  assert.equal(mapSealedFailure(null).headline, STATEMENTS.NO_RESULT_SET);
});

test('§13 rows: planning failure, enumeration-failed likely causes, mid-planning unload (either cause), duplicate rows', async () => {
  const planFail = await sealFakeRun('failed');                    // planningGaps [{cause:'plan-too-large'}]
  const r1 = mapSealedFailure(planFail);
  assert.equal(r1.headline, 'The test could not be planned.');
  assert.deepEqual(r1.details, ['The test is too large to plan — narrow the selections.']);
  assert.equal(r1.retainedNote, null, 'planning failures retain nothing');

  const withGaps = (gaps) => ({ ...planFail, ledger: { ...planFail.ledger, planningGaps: gaps } });
  const enumFail = mapSealedFailure(withGaps([{ phase: 'enumerating', cause: 'enumeration-failed' }]));
  assert.equal(enumFail.headline, "Couldn't read the model's element tree.");
  assert.match(enumFail.details[0], /^Likely causes \(not confirmed by the engine\)/);
  assert.doesNotMatch(enumFail.details.join(' '), /\d{2},?\d{3}/, 'no Core default number is restated as a limit');

  for (const cause of ['model-not-bound', 'enumeration-failed']) {                    // frozen-Core residual M1
    const r = mapSealedFailure(withGaps([{ phase: 'enumerating', cause }]));
    assert.notEqual(r.headline, STATEMENTS.ENGINE_FAILED, cause);
    assert.ok(r.headline.length > 0 && r.retainedNote === null, cause);
  }
  const dup = mapSealedFailure(withGaps([{ phase: 'planning', cause: 'owner-mapping-mismatch' }, { phase: 'planning', cause: 'owner-mapping-mismatch' }]));
  assert.deepEqual(dup.details, ["The model's element ownership could not be mapped consistently."], 'residual M2: one line');
});

test('§13 rows: unit-level partial, result cap (value from provenance, Soft vs Hard action), unexpected failure', async () => {
  const gaps = await sealedSet('completed-with-gaps');            // completed / partial, one failed:capacity-exceeded leaf
  assert.deepEqual(unitGapLines(gaps), ['1 part could not be evaluated (collision capacity was exceeded).']);
  const partial = bannersFor({ terminal: { status: 'completed', resultSetPresent: true }, resultSet: gaps });
  assert.deepEqual(partial.map((b) => b.id), ['partial']);
  assert.ok(partial[0].details.includes('1 part could not be evaluated (collision capacity was exceeded).'));
  assert.match(partial[0].details.at(-1), /are valid; parts that were not evaluated are unknown\.$/);

  const capped = await resealed((d) => {
    d.outcome.status = 'failed'; d.outcome.reasons = ['unit:result-cap'];
    d.ledger.units[1].cause = 'result-cap'; d.ledger.units[1].outcome = 'failed';
    d.provenance.runOptions.maxResultsPerRun = 12345;
  }, 'positives');
  const cap = mapSealedFailure(capped);
  assert.equal(cap.headline, 'Too many clashes — stopped at the result limit (12,345).');
  assert.equal(cap.details[1], 'Action: narrow the selection.', 'Hard: scope narrowing only');
  const softCap = mapSealedFailure({ ...capped, definition: { ...capped.definition, mode: 'clearance', clearance: 5 } });
  assert.match(softCap.details[1], /reduce the clearance — a larger clearance broadens matching/);
  assert.ok(cap.retainedNote !== null, 'retained results = whole units evaluated before the cap');

  for (const mutate of [
    (d) => { d.ledger.planningGaps = [{ phase: 'planning', cause: 'internal-error' }]; },
    (d) => { d.outcome.reasons = ['unit:world-disposed']; },
  ]) {
    const set = await sealFakeRun('failed');
    const copy = structuredClone(set);
    mutate(copy);
    assert.equal(mapSealedFailure(copy).headline, 'The clash engine failed. Details are available to copy.');
  }
});

test('diagnostics: truncated flag preserved in export and surfaced in details; no provenance/elementCount exported', async () => {
  const set = await sealedSet('positives');
  const truncated = { ...set, diagnostics: { ...set.diagnostics, truncated: true } };
  const parsed = JSON.parse(diagnosticsExport(truncated));
  assert.deepEqual(Object.keys(parsed).sort(), ['diagnostics', 'outcome', 'planningGaps', 'runId']);
  assert.equal(parsed.diagnostics.truncated, true);
  assert.deepEqual(parsed.outcome, set.outcome);
  assert.ok(mapSealedFailure(truncated).details.includes(STATEMENTS.DIAGNOSTICS_TRUNCATED));
  assert.doesNotMatch(diagnosticsExport(truncated), /elementCount/);
  assert.deepEqual(JSON.parse(diagnosticsExport(null)), { resultSet: null });
});

test('AC-P12: provenance.models[].elementCount is never read by any runReport function', async () => {
  const set = structuredClone(await sealedSet('schema-corpus'));
  for (const m of set.provenance.models) Object.defineProperty(m, 'elementCount', { get() { throw new Error('elementCount read'); } });
  assert.doesNotThrow(() => {
    describeAxes(set.outcome, null); mapSealedFailure(set); explainNoClashGaps(set); diagnosticsExport(set);
    emptyStatement({ resultSet: { ...set, results: [] }, claim: null, freshness: null });
    bannersFor({ terminal: { status: 'failed', resultSetPresent: true }, resultSet: set, freshness: CURRENT });
    runHeadline({ status: 'failed', total: 4, coverage: 'partial', resultSet: set });
  });
});

test('mapAdmissionError by error.name (real Core error instances); release-and-retry only when the Panel set blocks', () => {
  const rows = [
    [new InvalidTestDefinitionError({ issues: [{ path: '/name', code: 'string-too-short', message: 'x' }] }), /setup is invalid/],
    [new UnsupportedSchemaVersionError({ type: 'definition', schemaVersion: 9 }), /definition version/],
    [new StoreNotConfiguredError({ store: 'clashTestStore' }), /store/],
    [new InvalidOptionsError({ reason: 'unknown-key' }), /run options/],
    [new RunQueueFullError({ limit: 8, queued: 8 }), /too many runs are waiting/],
    [new EngineDisposedError(), /shut down/],
  ];
  for (const [error, re] of rows) {
    const m = mapAdmissionError(error, { heldRunId: 'mine' });
    assert.match(m.text, re, error.name);
    assert.equal(m.action, null, error.name);
  }
  const blockedByMe = [
    new ResultCapacityError({ cap: 4, active: [], retained: ['mine'], held: [] }),
    new ResultCapacityError({ cap: 4, active: [], retained: [], held: [{ runId: 'mine', persistence: 'skipped' }] }),
  ];
  for (const e of blockedByMe) assert.deepEqual({ ...mapAdmissionError(e, { heldRunId: 'mine' }) }, { text: 'The clash engine is at capacity. Clear previous results and try again.', action: 'release-and-retry' });
  const other = new ResultCapacityError({ cap: 4, active: ['x'], retained: ['y'], held: [] });
  assert.equal(mapAdmissionError(other, { heldRunId: 'mine' }).action, null);
  assert.equal(mapAdmissionError(blockedByMe[0]).action, null, 'no held set ⇒ nothing to release');
  const hostile = '<img src=x onerror=alert(1)>';
  assert.equal(mapAdmissionError(Object.assign(new Error(hostile), { name: 'WeirdError' })).text, `The run could not be started: ${hostile}`, 'untrusted text passes through as a plain string');
});

test('A-1: mapAdmissionError treats a STUCK own set (ownRunIds) as the Panel\'s own blocker ⇒ release-and-retry', () => {
  const blockedByStuck = new ResultCapacityError({ cap: 1, active: [], retained: ['stuck-1'], held: [] });
  assert.deepEqual({ ...mapAdmissionError(blockedByStuck, { heldRunId: null, ownRunIds: ['stuck-1'] }) },
    { text: 'The clash engine is at capacity. Clear previous results and try again.', action: 'release-and-retry' });
  assert.equal(mapAdmissionError(blockedByStuck, { heldRunId: 'shown', ownRunIds: ['other'] }).action, null, 'not one of ours ⇒ no action');
  assert.equal(mapAdmissionError(blockedByStuck, { ownRunIds: 'stuck-1' }).action, null, 'malformed ownRunIds ⇒ ignored');
});

test('bannersFor: no-result-set, failed, stale (live reasons, plain text), setup changed, held-unsaved; axes badges', async () => {
  const none = bannersFor({ terminal: { status: 'failed', resultSetPresent: false }, resultSet: null });
  assert.deepEqual(none.map((b) => [b.id, b.kind]), [['no-result-set', 'error']]);
  const clean = await sealedSet('completed-clean');
  const b = bannersFor({ terminal: { status: 'completed', resultSetPresent: true }, resultSet: clean,
    freshness: { state: 'stale', reasons: ['<b>scope-drift</b>'] }, setupChanged: true, persistence: { state: 'skipped' } });
  assert.deepEqual(b.map((x) => x.id), ['stale', 'setup-changed', 'held-unsaved']);
  assert.deepEqual(b[0].details, ['Reason: <b>scope-drift</b>', 'Run the test again to refresh.']);
  assert.equal(bannersFor({ terminal: null, resultSet: clean, persistence: { state: 'pending' } }).length, 0, 'pending shows nothing extra');
  const failed = bannersFor({ terminal: { status: 'failed', resultSetPresent: true }, resultSet: await sealFakeRun('failed') });
  assert.deepEqual(failed.map((x) => [x.id, x.kind, x.text]), [['failed', 'error', 'The test could not be planned.'], ['stale', 'warning', STATEMENTS.STALE]]);

  const axes = describeAxes(clean.outcome, null);
  assert.deepEqual({ ...axes.freshness }, { value: 'current', label: 'Freshness: current (at seal) — checking freshness…', pending: true });
  const live = describeAxes((await sealedSet('schema-corpus')).outcome, { state: 'stale', reasons: [] });
  assert.deepEqual([live.coverage.value, live.integrity.value, live.freshness.value, live.freshness.pending], ['partial', 'caveated', 'stale', false]);
});
