// test/acceptance/g1-svf2-f1-f8-verification.f1digest.test.mjs
//
// Offline regression tests for the bounded post-first-live-run remediation of F1's digest
// oracle. The first live run (2026-09-29) returned F1 FAIL because observeF1 built digest rows
// WITHOUT the geometryId that scopeDigest.js requires, so digestSubtree/digestPopulation threw and
// a blanket catch reported the exception as a "mismatch"; earlier tests used fake digest functions
// that ignored row shape and so could not see it. These tests use the REAL scopeDigest.js and the
// REAL populationScan.js on the adapter side, so the harness's rows must match the true contract.
//
// NEVER launches a browser, imports playwright, or executes main().

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestSubtree, digestPopulation } from '../../clashtest/planning/scopeDigest.js';
import { scanPopulation } from '../../clashtest/viewer/populationScan.js';
import {
  CHECK_VERDICT,
  OVERALL_VERDICT,
  IN_PAGE_FUNCTION_REGISTRY,
  observeF1,
  observeF4,
  scoreF1,
  buildCheckRecord,
  selectAuthoritativeFragmentTarget,
  wrongOwnerControlInPage,
  buildWrongOwnerControlDep,
  buildInvalidBoundsControlDep,
  buildBoundsBeyondToleranceControlDep,
  exitCodeForVerdict,
  runCli,
  isDirectInvocation,
} from './g1-svf2-f1-f8-verification.mjs';

const HARNESS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'g1-svf2-f1-f8-verification.mjs');

function createPageRealm(initialWindow = {}) {
  const context = vm.createContext({ window: initialWindow, performance, setTimeout, clearTimeout, console });
  for (const [name, fn] of Object.entries(IN_PAGE_FUNCTION_REGISTRY)) {
    vm.runInContext(`globalThis.${name} = (${fn.toString()})`, context);
  }
  return { window: initialWindow, call: (fn, ...args) => vm.runInContext(fn.name, context)(...args) };
}

// Fixture: frag 0,1 -> dbId 10 (geometry 5,6); frag 2 -> dbId 20 (geometry 7); frag 3 not loaded.
const FRAGS = [
  { fragId: 0, owner: 10, geom: 5 }, { fragId: 1, owner: 10, geom: 6 },
  { fragId: 2, owner: 20, geom: 7 }, { fragId: 3, notLoaded: true },
];
const fakeFragList = {
  getCount: () => FRAGS.length,
  isNotLoaded: (f) => Boolean(FRAGS[f].notLoaded),
  getDbIds: (f) => FRAGS[f].owner,
  getGeometryId: (f) => FRAGS[f].geom,
};
const record = (f) => ({ fragmentId: f.fragId, ownerDbId: f.owner, geometryIdentity: { loadEpoch: 0, geometryIndex: f.geom } });
const rootFrags = { 10: FRAGS.filter((f) => f.owner === 10), 20: FRAGS.filter((f) => f.owner === 20) };

async function adapterRoot(dbId) {
  const rows = rootFrags[dbId].map((f) => ({ fragId: f.fragId, ownerDbId: f.owner, geometryId: f.geom })); // enumerator's subtreeRecords shape
  const { digest } = await digestSubtree(rows);
  return { dbId, fragmentCount: rows.length, ownerDbIds: [dbId], subtreeDigest: digest };
}

async function buildSession({ mutateRoot, extractFragmentsImpl, extractAllFragmentsImpl, recordMutator } = {}) {
  const roots = [await adapterRoot(10), await adapterRoot(20)];
  if (mutateRoot) mutateRoot(roots);
  const scan = await scanPopulation(fakeFragList, { checkpoint() {} }, { loadEpoch: 0 });
  const population = await digestPopulation(scan);
  const model = { getFragmentList: () => fakeFragList };
  const enumerator = {
    resolveRoots: async () => ({ roots, ownerMismatch: { count: 0 }, unreachable: { count: 0 }, population: { count: population.count, digest: population.digest } }),
  };
  const mk = recordMutator || ((r) => r);
  const session = { binding: { model }, model, enumerator, artifacts: { f1FragmentMapsByRoot: new Map() } };
  const mod = {
    '/collision/viewer/ViewerModelAdapter.js': {
      extractFragments: extractFragmentsImpl || (async (m, [dbId]) => new Map(rootFrags[dbId].map((f) => [f.fragId, mk(record(f))]))),
      extractAllFragments: extractAllFragmentsImpl || (async () => ({
        records: new Map(FRAGS.filter((f) => !f.notLoaded).map((f) => [f.fragId, mk(record(f))])),
        diagnostics: [{ fragment: { fragId: 3 }, reason: 'fragment-not-loaded' }],
      })),
    },
    '/clashtest/planning/scopeDigest.js': { digestSubtree, digestPopulation }, // REAL
  };
  return { session, mod, realm: createPageRealm({ __g1: { sessions: { s1: session }, mod }, __viewer: {} }) };
}

test('observeF1 with the REAL scopeDigest contract: rows carry geometryId -> equal digests, PASS, no oracle errors', async () => {
  const { realm, session } = await buildSession();
  const r = await realm.call(observeF1, 's1');
  assert.equal(r.ok, true);
  assert.equal(r.fields.subtreeDigestMismatch, 0);
  assert.equal(r.fields.subtreeDigestErrorCount, 0);
  assert.equal(r.fields.populationDigestErrorCount, 0);
  assert.equal(r.fields.populationDigestEqual, true);
  assert.equal(r.populationDigestEvidence.state, 'EQUAL');
  assert.equal(r.populationDigestEvidence.computedDigest, r.populationDigestEvidence.adapterDigest);
  assert.equal(scoreF1(r.fields).verdict, CHECK_VERDICT.PASS);
  assert.equal(session.artifacts.f1PopulationRecords.size, 3);
});

test('observeF1: a REAL digest inequality is reported as a mismatch (not an oracle error) with both digests durably recorded', async () => {
  const { realm } = await buildSession({ mutateRoot: (roots) => { roots[0] = { ...roots[0], subtreeDigest: 'f'.repeat(64) }; } });
  const r = await realm.call(observeF1, 's1');
  assert.equal(r.fields.subtreeDigestMismatch, 1);
  assert.equal(r.fields.subtreeDigestErrorCount, 0);
  const s = scoreF1(r.fields);
  assert.equal(s.verdict, CHECK_VERDICT.FAIL);
  assert.equal(s.reason, 'f1-mismatch-or-digest-disagreement');
  const m = r.first20Mismatches[0];
  assert.equal(m.dbId, 10);
  assert.equal(m.digestState, 'UNEQUAL');
  assert.equal(m.digestError, null);
  assert.equal(m.adapter.subtreeDigest, 'f'.repeat(64));
  assert.match(m.library.subtreeDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(m.library.rowCount, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(m.library.rowSample[0])), { fragId: 0, ownerDbId: 10, geometryId: 5 });
});

test('observeF1: a digest EXCEPTION (record lacking geometryIdentity) is oracle failure, distinct from mismatch, with the exception persisted', async () => {
  const { realm, session } = await buildSession({ recordMutator: (rec) => ({ ...rec, geometryIdentity: undefined }) });
  const r = await realm.call(observeF1, 's1');
  assert.equal(r.fields.subtreeDigestMismatch, 0, 'an exception must not be counted as a digest disagreement');
  assert.equal(r.fields.subtreeDigestErrorCount, 2);
  assert.equal(r.fields.populationDigestErrorCount, 1);
  assert.equal(r.fields.populationDigestEqual, false);
  assert.equal(r.populationDigestEvidence.state, 'ORACLE_ERROR');
  assert.match(r.populationDigestEvidence.error.message, /geometryId/);
  assert.equal(r.first20Mismatches[0].digestState, 'ORACLE_ERROR');
  assert.match(r.first20Mismatches[0].digestError.message, /geometryId/);
  const s = scoreF1(r.fields);
  assert.equal(s.verdict, CHECK_VERDICT.FAIL);
  assert.equal(s.reason, 'f1-digest-oracle-error');
  // The valid extraction output is still retained, so dependents are not starved by an oracle failure.
  assert.equal(session.artifacts.f1PopulationRecords.size, 3);
});

test('observeF1: extractAllFragments itself throwing -> EXTRACTION_ERROR evidence, no population records, oracle-error reason', async () => {
  const { realm, session } = await buildSession({ extractAllFragmentsImpl: async () => { throw new Error('extract boom'); } });
  const r = await realm.call(observeF1, 's1');
  assert.equal(r.populationDigestEvidence.state, 'EXTRACTION_ERROR');
  assert.equal(r.populationDigestEvidence.error.message, 'extract boom');
  assert.equal(r.fields.populationDigestErrorCount, 1);
  assert.equal(session.artifacts.f1PopulationRecords, undefined);
  assert.equal(scoreF1(r.fields).reason, 'f1-digest-oracle-error');
});

test('buildCheckRecord persists optional evidence.details only when supplied (existing record shape unchanged)', () => {
  assert.deepEqual(buildCheckRecord({ verdict: 'PASS' }).evidence, { status: 'observed', error: null, blockedBy: null });
  const withDetails = buildCheckRecord({ verdict: 'FAIL', evidence: { status: 'observed', details: { x: 1 } } });
  assert.deepEqual(withDetails.evidence.details, { x: 1 });
});

test('dependent inputs: valid F1 population records make the wrong-owner target selectable and let observeF4 past its F1 precondition', async () => {
  const { realm, session } = await buildSession();
  await realm.call(observeF1, 's1');
  const target = selectAuthoritativeFragmentTarget(session.artifacts.f1PopulationRecords);
  assert.deepEqual({ ...target }, { fragId: 0, ownerDbId: 10 });
  const f4 = await realm.call(observeF4, 's1');
  assert.ok(f4 && typeof f4 === 'object', 'observeF4 must return a structured result');
  assert.notEqual(f4.reason, 'f1-population-records-not-available-run-observeF1-first');
});

test('wrong-owner injected owner is a valid dbId for the REAL population scan + digest (a negative sentinel made resolveRoots throw)', async () => {
  const m = /const wrongOwnerDbId = realOwnerDbId === (\d+) \? (\d+) : (\d+);/.exec(wrongOwnerControlInPage.toString());
  assert.ok(m, 'wrongOwnerDbId derivation must be a non-negative integer literal pair');
  const [, sentinel, alt, primary] = m.map(Number);
  assert.equal(primary, sentinel);
  for (const injected of [primary, alt]) {
    const list = { ...fakeFragList, getDbIds: (f) => (f === 0 ? injected : FRAGS[f].owner) };
    const scan = await scanPopulation(list, { checkpoint() {} }, { loadEpoch: 0 });
    await assert.doesNotReject(() => digestPopulation(scan), `injected owner ${injected} must not make the population digest throw`);
  }
  await assert.rejects(() => digestPopulation({ count: 1, records: [{ fragId: 0, cls: 'L', ownerDbId: -999999, geometryId: 5 }] }), 'documents why the old -999999 sentinel was unusable');
});

test('dependent controls: wrong-owner dep enters the page; invalid-bounds / bounds-beyond-tolerance deps become executable given valid F7 fields', async () => {
  const calls = [];
  const pageEvaluate = async (fn, arg) => { calls.push(arg.controlId); return { ok: false, reason: 'test-stop' }; };
  const ctx = { controlTimeoutMs: 1000, recordControlTarget() {} };
  const base = { pageEvaluate, sessionId: 's1', tokenId: 't', gen: 1 };
  await buildWrongOwnerControlDep(base)(ctx);
  const f7Fields = {
    censusedDbIds: [10, 20],
    boundsAgreement: { 10: 'agrees', 20: 'agrees' },
    boundsScalePerDbId: { 10: { x: { S_a: 1, refMin_a: 0, nodeMin_a: 0 }, y: {}, z: {} } },
    boundsPrimary: {},
  };
  await buildInvalidBoundsControlDep({ ...base, primaryF7Fields: f7Fields })(ctx);
  assert.ok(calls.includes('wrong-owner'));
  assert.ok(calls.includes('invalid-bounds'), 'invalid-bounds must reach the page when censused dbIds exist');
  // Without F7 inputs the same deps short-circuit (the dependency is real, not a fixture limitation).
  const noCalls = calls.length;
  const r1 = await buildInvalidBoundsControlDep({ ...base, primaryF7Fields: {} })(ctx);
  const r2 = await buildBoundsBeyondToleranceControlDep({ ...base, primaryF7Fields: {} })(ctx);
  assert.equal(calls.length, noCalls);
  assert.equal(r1.state, 'NOT_EXECUTABLE');
  assert.equal(r2.reason, 'perturbation-not-representable');
});

// ---- exit-code semantics -------------------------------------------------------------------

test('exitCodeForVerdict: PASS 0, FAIL 1, BLOCKED 2, PARTIAL 3, anything else 4 (fail closed)', () => {
  assert.equal(exitCodeForVerdict(OVERALL_VERDICT.PASS), 0);
  assert.equal(exitCodeForVerdict(OVERALL_VERDICT.FAIL), 1);
  assert.equal(exitCodeForVerdict(OVERALL_VERDICT.BLOCKED), 2);
  assert.equal(exitCodeForVerdict(OVERALL_VERDICT.PARTIAL), 3);
  for (const bad of [undefined, null, '', 'pass', 'toString', 'constructor']) assert.equal(exitCodeForVerdict(bad), 4);
});

test('shell exit status matches the retained overall verdict (real child process, stubbed main -- no live run)', () => {
  const expected = { PASS: 0, FAIL: 1, BLOCKED: 2, PARTIAL: 3 };
  for (const [verdict, code] of Object.entries(expected)) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { runCli } from ${JSON.stringify(HARNESS)}; await runCli(async () => ({ overall: ${JSON.stringify(verdict)} }));`],
    { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } });
    assert.equal(r.status, code, `${verdict} -> exit ${code}, got ${r.status} (${r.stderr})`);
  }
  const thrown = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { runCli } from ${JSON.stringify(HARNESS)}; await runCli(async () => { throw new Error('x'); });`],
  { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } });
  assert.equal(thrown.status, 1);
  const missing = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { runCli } from ${JSON.stringify(HARNESS)}; await runCli(async () => ({}));`],
  { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } });
  assert.equal(missing.status, 4);
});

// ---- import side-effect safety --------------------------------------------------------------

test('importing the harness from another entry script never runs main()/Phase 0 (no output, exit 0)', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(HARNESS)}); console.log('imported');`],
  { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '', G1_F1_F8_LIVE_AUTHORIZED: 'YES' }, cwd: path.dirname(HARNESS) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'imported');
  assert.equal(r.stderr, '');
});

test('isDirectInvocation: true only for the entry script itself (realpath-compared); false under NODE_TEST_CONTEXT or other entries', () => {
  const url = `file://${HARNESS}`;
  assert.equal(isDirectInvocation(url, HARNESS, {}), true);
  assert.equal(isDirectInvocation(url, HARNESS, { NODE_TEST_CONTEXT: 'child' }), false);
  assert.equal(isDirectInvocation(url, '/nonexistent/other.mjs', {}), false);
  assert.equal(isDirectInvocation(url, undefined, {}), false);
  assert.equal(typeof runCli, 'function');
});
