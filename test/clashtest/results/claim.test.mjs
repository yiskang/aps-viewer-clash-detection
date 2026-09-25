// test/clashtest/results/claim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessNoClashClaim, canClaimNoClashes, freshnessStateOf } from '../../../clashtest/results/claim.js';
import { DIGEST_VERSION } from '../../../clashtest/util/canonical.js';
import { claimableSet } from '../support/resultSetFixtures.mjs';

// Each row flips exactly ONE conjunct of the §8.3 predicate on a set that is otherwise claimable.
const FLIPS = [
  ['status',                (s) => { s.outcome.status = 'cancelled'; }],
  ['coverage',              (s) => { s.outcome.coverage = 'partial'; }],
  ['integrity',             (s) => { s.outcome.integrity = 'caveated'; }],
  ['pairSpaceTotal',        (s) => { s.ledger.pairSpaceTotal = 0; }],
  ['emptyOperand',          (s) => { s.ledger.emptyOperand = true; }],
  ['unresolvedSelections',  (s) => { s.ledger.unresolvedSelections = [{ selectionRole: 'A', modelKey: 'MA', cause: 'element-unresolvable', dbIds: [4] }]; }],
  ['unreachablePopulation', (s) => { s.ledger.unreachablePopulation = [{ modelKey: 'MA', ownerDbIds: [9], mixedOwnerDbIds: [], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } }]; }],
  ['hierarchyInternal',     (s) => { s.ledger.hierarchyInternal = [{ modelKey: 'MA', rootCount: 1, ownerCount: 3, examples: [] }]; }],
  ['results',               (s) => { s.results = [{ resultId: 'r', flags: {} }]; }],
  // Review Critical 2 — the digest-version conjunct, flipped ALONE on an otherwise claimable set.
  ['digestVersion',         (s) => { s.digests = { ...s.digests, digestVersion: 99 }; }],
];

test('every conjunct flipped alone blocks the claim', () => {
  for (const [name, flip] of FLIPS) {
    const set = claimableSet();
    flip(set);
    assert.equal(assessNoClashClaim(set, 'current').allowed, false, `${name} must block`);
    assert.equal(canClaimNoClashes(set, 'current'), false, `${name} must block the boolean`);
  }
});

test('freshness is a required argument and only "current" passes', () => {
  const set = claimableSet();
  assert.equal(assessNoClashClaim(set, 'current').allowed, true);
  assert.equal(canClaimNoClashes(set, 'current'), true);
  for (const f of [undefined, null, 'stale', 'unverifiable']) {
    assert.equal(assessNoClashClaim(set, f).allowed, false);
    assert.equal(canClaimNoClashes(set, f), false);
  }
});

// --- row N19 / contradiction C1: the two freshness shapes ------------------------------------
test('freshnessStateOf reads both shapes and is null for everything else', () => {
  for (const s of ['current', 'stale', 'unverifiable']) {
    assert.equal(freshnessStateOf(s), s);
    assert.equal(freshnessStateOf({ state: s, reasons: [] }), s);
    assert.equal(freshnessStateOf(Object.freeze({ state: s, reasons: Object.freeze(['r']) })), s);
  }
  const REJECTED = [undefined, null, '', 'CURRENT', 'fresh', 0, 1, true, [], ['current'],
    {}, { state: null }, { state: 'nope', reasons: [] }, { State: 'current' },
    { state: 'current', reasons: 'not-an-array' }, () => 'current', new Map()];
  for (const bad of REJECTED) assert.equal(freshnessStateOf(bad), null, String(bad));
  assert.equal(freshnessStateOf({ state: 'current', reasons: 'not-an-array' }), null);  // shape is all-or-nothing
  // codex-advisor finding, 2026-09-22: `reasons` is a REQUIRED array of the Freshness shape
  // (§16.4), not an optional one — a bare `{state: 'current'}` must not fail open.
  assert.equal(freshnessStateOf({ state: 'current' }), null, 'missing reasons must not fail open');
});

test('the claim helpers accept the Freshness OBJECT P6 and P7 actually pass', () => {
  const set = claimableSet();
  assert.equal(assessNoClashClaim(set, { state: 'current', reasons: [] }).allowed, true);
  assert.equal(canClaimNoClashes(set, { state: 'current', reasons: [] }), true);
  for (const f of [{ state: 'stale', reasons: ['modelVersion changed'] },
                   { state: 'unverifiable', reasons: ['enumerator absent'] },
                   { state: 'bogus', reasons: [] }, { reasons: [] }]) {
    assert.equal(assessNoClashClaim(set, f).allowed, false, f.state);
    assert.equal(canClaimNoClashes(set, f), false, f.state);
  }
});

test('an object freshness contributes its reasons to qualifiers, so a refusal is explainable (§16.4)', () => {
  const set = claimableSet();
  const a = assessNoClashClaim(set, { state: 'stale', reasons: ['modelVersion changed', 'placementGeneration moved'] });
  assert.equal(a.allowed, false);
  assert.deepEqual(a.qualifiers, [
    { kind: 'freshness', state: 'stale', reason: 'modelVersion changed' },
    { kind: 'freshness', state: 'stale', reason: 'placementGeneration moved' },
  ]);
  assert.deepEqual(assessNoClashClaim(set, 'stale').qualifiers, []);            // a bare string carries none
  assert.deepEqual(assessNoClashClaim(set, { state: 'current', reasons: [] }).qualifiers, []);
  // a malformed reasons list is ignored, never thrown over, and never blocks reading `state`
  const m = assessNoClashClaim(set, { state: 'stale', reasons: [1, null, 'ok', { x: 1 }] });
  assert.deepEqual(m.qualifiers, [{ kind: 'freshness', state: 'stale', reason: 'ok' }]);
});

test('the sealed outcome.freshness is never substituted for the argument', () => {
  const set = claimableSet();
  set.outcome.freshness = 'current';
  assert.equal(canClaimNoClashes(set, 'stale'), false);
});

test('a recorded acceptance allows a QUALIFIED claim only', () => {
  const set = claimableSet();
  set.ledger.hierarchyInternal = [{ modelKey: 'MA', rootCount: 1, ownerCount: 3, examples: [] }];
  set.provenance.libraryExclusions = ['hierarchy-internal'];
  assert.equal(assessNoClashClaim(set, 'current').allowed, false);        // unaccepted default fails closed
  set.provenance.hierarchyInternalAcceptance = { recordRef: 'rec-7' };
  const a = assessNoClashClaim(set, 'current');
  assert.equal(a.allowed, true);
  assert.equal(a.unqualified, false);
  assert.deepEqual(a.qualifiers, [{ kind: 'hierarchy-internal-accepted', recordRef: 'rec-7', rootCount: 1, ownerCount: 3 }]);
  assert.deepEqual(a.exclusions, ['hierarchy-internal']);
  assert.equal(a.proofMethod, 'bracketed-digest');
  assert.equal(canClaimNoClashes(set, 'current'), false);                 // the boolean never licenses it
});

// --- review Critical 2: the claim predicate OWNS the digest-version rule ----------------------
test('an unknown digestVersion blocks the claim on an otherwise claimable EMPTY-results set', () => {
  // The earlier draft asserted this on the `positives` fixture, whose non-empty `results` already
  // blocked the claim — so it proved nothing. This set is claimable on every OTHER conjunct.
  const base = claimableSet();
  assert.deepEqual(base.results, [], 'the fixture must be the empty-results completed-clean shape');
  assert.equal(assessNoClashClaim(base, 'current').allowed, true, 'baseline is claimable');
  assert.equal(base.digests.digestVersion, DIGEST_VERSION);

  for (const bad of [99, 0, -1, 1.5, '1', null, undefined, Number.NaN]) {
    const set = claimableSet();
    set.digests = { ...set.digests, digestVersion: bad,
                    pairSetDigest: `sha256:${'0'.repeat(64)}`, ledgerDigest: `sha256:${'0'.repeat(64)}` };
    const a = assessNoClashClaim(set, 'current');
    assert.equal(a.allowed, false, `digestVersion ${String(bad)} must block`);
    assert.equal(canClaimNoClashes(set, 'current'), false, String(bad));
    assert.ok(a.qualifiers.some((q) => q.reason === 'unknown-digest-version'),
      `the refusal must be explainable: ${JSON.stringify(a.qualifiers)}`);
  }

  // Absent or malformed `digests` fails the same way — fail-closed, never a thrown TypeError.
  for (const digests of [undefined, null, {}, 'sha256:x', []]) {
    const set = claimableSet();
    set.digests = digests;
    assert.equal(assessNoClashClaim(set, 'current').allowed, false, String(digests));
  }
});

test('non-empty results are a valid positive result, never a claim', () => {
  const set = claimableSet();
  set.results = [{ resultId: 'r1', flags: {} }, { resultId: 'r2', flags: {} }];
  set.provenance.hierarchyInternalAcceptance = { recordRef: 'rec-7' };
  assert.equal(assessNoClashClaim(set, 'current').allowed, false);
});
