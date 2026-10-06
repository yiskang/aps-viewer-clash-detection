import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from './contract-loader.mjs';
import { validateRunbook } from './runbook-validator.mjs';

const base = () => loadContract();
const clone = (c) => structuredClone(c);
const step = (c, id) => c.runbook.phases.flatMap((p) => p.steps).find((s) => s.stepId === id);
const has = (r, re) => r.findings.some((x) => re.test(x));

test('runbook: committed contract is valid (phases 0-5, executed=false, authorized=false)', () => {
  const r = validateRunbook(base());
  assert.deepEqual(r.findings, []);
  assert.equal(r.ok, true);
  assert.equal(base().runbook.executed, false);
  assert.equal(base().runbook.authorized, false);
});

test('runbook: deterministic (deep-equal and byte-equal)', () => {
  const a = validateRunbook(base()); const b = validateRunbook(base());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('runbook: findings are sorted', () => {
  const c = clone(base()); c.runbook.executed = true; c.runbook.phases.pop(); step(c, 'P0.02').preconditions = ['P0.09'];
  const r = validateRunbook(c);
  assert.equal(r.ok, false);
  assert.deepEqual(r.findings, [...r.findings].sort());
});

test('runbook adversarial: runbook.executed=true is refused', () => {
  const c = clone(base()); c.runbook.executed = true;
  assert.ok(has(validateRunbook(c), /RUNBOOK_EXECUTED_NOT_FALSE/));
});

test('runbook adversarial: runbook.authorized=true is refused', () => {
  const c = clone(base()); c.runbook.authorized = true;
  const r = validateRunbook(c);
  assert.ok(has(r, /RUNBOOK_AUTHORIZED_NOT_FALSE/));
});

test('runbook adversarial: a mutated runbook that executes a live step is refused', () => {
  for (const id of ['P0.12', 'P2.02', 'P3.03']) {
    const c = clone(base()); step(c, id).executed = true;
    const r = validateRunbook(c);
    assert.equal(r.ok, false, id);
    assert.ok(has(r, new RegExp(`STEP_EXECUTED: ${id}`)) && has(r, new RegExp(`LIVE_STEP_EXECUTED: ${id}`)), id);
  }
  const c = clone(base()); step(c, 'P3.03').authorized = true;
  assert.ok(has(validateRunbook(c), /STEP_AUTHORIZED: P3\.03/));
});

test('runbook adversarial: a live step explicitly lacking the owner-authorization marker is refused', () => {
  for (const id of ['P0.12', 'P0.13', 'P2.02', 'P3.03', 'P4.01']) {
    const c = clone(base()); step(c, id).requiresFutureOwnerAuthorization = false;
    const r = validateRunbook(c);
    assert.ok(has(r, new RegExp(`STEP_MARKER_FALSE: ${id.replace('.', '\\.')}`)) && has(r, new RegExp(`LIVE_STEP_WITHOUT_AUTHORIZATION_MARKER: ${id.replace('.', '\\.')}`)), id);
  }
  const d = clone(base()); delete step(d, 'P0.12').requiresFutureOwnerAuthorization;
  const r = validateRunbook(d);
  assert.ok(has(r, /STEP_MARKER_MISSING: P0\.12/) && has(r, /LIVE_STEP_WITHOUT_AUTHORIZATION_MARKER: P0\.12/));
  const e = clone(base()); step(e, 'P0.03').requiresFutureOwnerAuthorization = 'yes';
  assert.ok(has(validateRunbook(e), /STEP_MARKER_MISSING: P0\.03/), 'a non-boolean marker is refused');
});

test('runbook: every step carries an explicit boolean marker; true exactly where the contract rule requires it', () => {
  const r = validateRunbook(base());
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
  const steps = base().runbook.phases.flatMap((p) => p.steps);
  assert.equal(steps.length, 49);
  for (const s of steps) {
    assert.equal(typeof s.requiresFutureOwnerAuthorization, 'boolean', s.stepId);
    const [ph, n] = s.stepId.split('.');
    const want = ['P1', 'P2', 'P3', 'P4'].includes(ph) || (ph === 'P0' && Number(n) >= 10);
    assert.equal(s.requiresFutureOwnerAuthorization, want, s.stepId);
  }
  // record-spending (P0.10) and attempt-consuming (P0.14) steps must be true
  for (const id of ['P0.10', 'P0.11', 'P0.14']) {
    const c = clone(base()); step(c, id).requiresFutureOwnerAuthorization = false;
    assert.ok(has(validateRunbook(c), new RegExp(`STEP_MARKER_FALSE: ${id.replace('.', '\\.')}`)), id);
  }
  // false is admitted for static pre-reservation checks and offline analysis (it never means executable now)
  const c = clone(base()); step(c, 'P5.04').requiresFutureOwnerAuthorization = true;
  assert.equal(validateRunbook(c).ok, true);
});

test('runbook adversarial: browser launch smuggled into offline phase P5 is refused', () => {
  const c = clone(base()); step(c, 'P5.04').action = 'launchBrowserForAnalysis';
  assert.ok(has(validateRunbook(c), /OFFLINE_PHASE_(BROWSER|LIVE)_STEP: P5\.04/));
});

test('runbook: phase missing / reordered / extra', () => {
  let c = clone(base()); c.runbook.phases = c.runbook.phases.filter((p) => p.phaseId !== 'P3');
  assert.ok(has(validateRunbook(c), /PHASES_NOT_P0_TO_P5_IN_ORDER/));
  c = clone(base()); c.runbook.phases.reverse();
  assert.ok(has(validateRunbook(c), /PHASES_NOT_P0_TO_P5_IN_ORDER/));
  c = clone(base()); c.runbook.phases.push({ phaseId: 'P6', steps: [] });
  assert.ok(has(validateRunbook(c), /PHASES_NOT_P0_TO_P5_IN_ORDER/));
});

test('runbook: step numbering gaps, duplicates and phase mismatch', () => {
  let c = clone(base()); step(c, 'P1.03').stepId = 'P1.05';
  assert.ok(has(validateRunbook(c), /STEP_NUMBERING_NOT_CONSECUTIVE: P1\.05/));
  c = clone(base()); step(c, 'P1.03').stepId = 'P1.02';
  assert.ok(has(validateRunbook(c), /STEP_DUPLICATE: P1\.02/));
  c = clone(base()); step(c, 'P1.03').stepId = 'P2.03';
  assert.ok(has(validateRunbook(c), /STEP_ID_PHASE_MISMATCH/));
  c = clone(base()); step(c, 'P1.03').stepId = 'step-3';
  assert.ok(has(validateRunbook(c), /STEP_ID_FORMAT/));
});

test('runbook: preconditions must reference existing earlier steps', () => {
  let c = clone(base()); step(c, 'P0.03').preconditions = ['P4.06'];
  assert.ok(has(validateRunbook(c), /PRECONDITION_NOT_EARLIER: P0\.03 requires P4\.06/));
  c = clone(base()); step(c, 'P0.03').preconditions = ['P9.99'];
  assert.ok(has(validateRunbook(c), /PRECONDITION_UNKNOWN/));
  c = clone(base()); step(c, 'P0.03').preconditions = ['P0.03'];
  assert.ok(has(validateRunbook(c), /PRECONDITION_NOT_EARLIER: P0\.03 requires P0\.03/));
  c = clone(base()); step(c, 'P0.01').preconditions = ['P0.02'];
  assert.ok(has(validateRunbook(c), /PRECONDITION_NOT_EARLIER|FIRST_STEP_HAS_PRECONDITIONS/));
  c = clone(base()); step(c, 'P2.03').preconditions = [];
  assert.ok(has(validateRunbook(c), /STEP_UNCONDITIONAL_NOT_ALLOWED: P2\.03/));
});

test('runbook: stop-condition references are consistent with contract.stopConditions', () => {
  let c = clone(base()); step(c, 'P0.02').onFail = 'SC-Z99';
  assert.ok(has(validateRunbook(c), /STOP_CONDITION_UNKNOWN: P0\.02 references SC-Z99/));
  // class b before consumption
  c = clone(base()); step(c, 'P0.02').onFail = 'SC-B06';
  assert.ok(has(validateRunbook(c), /CLASS_B_BEFORE_CONSUMPTION: P0\.02/));
  // class a after consumption
  c = clone(base()); step(c, 'P3.01').onFail = 'SC-A09';
  assert.ok(has(validateRunbook(c), /CLASS_A_AFTER_CONSUMPTION: P3\.01/));
  // locator mismatch
  c = clone(base()); step(c, 'P0.02').onFail = 'SC-A09';
  assert.ok(has(validateRunbook(c), /STOP_CONDITION_STEP_MISMATCH: P0\.02/));
  // class c in preflight
  c = clone(base()); step(c, 'P0.02').onFail = 'SC-C01';
  assert.ok(has(validateRunbook(c), /CLASS_C_IN_PREFLIGHT/));
});

test('runbook: stop-condition class definitions are checked', () => {
  let c = clone(base()); c.stopConditions.classes.b.retry = true;
  assert.ok(has(validateRunbook(c), /STOP_CLASS_B_DEFINITION/));
  c = clone(base()); c.stopConditions.classes.a.attemptConsumed = true;
  assert.ok(has(validateRunbook(c), /STOP_CLASS_A_DEFINITION/));
  c = clone(base()); c.stopConditions.stopConditions.find((s) => s.id === 'SC-B01').class = 'a';
  assert.ok(has(validateRunbook(c), /STOP_CONDITION_CLASS_MISMATCH: SC-B01/));
  // class c unreferenced by any step
  c = clone(base());
  for (const p of c.runbook.phases) for (const s of p.steps) if (s.onFail && /SC-C/.test(s.onFail)) s.onFail = null;
  assert.ok(has(validateRunbook(c), /STOP_CLASS_UNREFERENCED: class c/));
});

test('runbook: consumption boundary and retry are enforced', () => {
  let c = clone(base()); step(c, 'P0.14').effect = undefined;
  assert.ok(has(validateRunbook(c), /ATTEMPT_CONSUMED_STEP_COUNT/));
  c = clone(base()); step(c, 'P1.01').effect = 'attemptConsumed';
  assert.ok(has(validateRunbook(c), /ATTEMPT_CONSUMED_STEP_UNEXPECTED: P1\.01/));
  c = clone(base()); step(c, 'P3.03').retry = true;
  assert.ok(has(validateRunbook(c), /STEP_RETRY: P3\.03/));
  c = clone(base()); c.runbook.phases[0].consumesAttempt = true;
  assert.ok(has(validateRunbook(c), /PHASE_CONSUMES_ATTEMPT: P0/));
  c = clone(base()); c.runbook.phases[5].offlineOnly = false;
  assert.ok(has(validateRunbook(c), /PHASE_P5_NOT_OFFLINE_ONLY/));
});

test('runbook: P2/P4 control steps agree with the control matrix', () => {
  let c = clone(base()); step(c, 'P2.04').control = 'PC-3';
  assert.ok(has(validateRunbook(c), /P2_CONTROLS_MISMATCH/));
  c = clone(base()); step(c, 'P4.01').control = 'PC-1';
  assert.ok(has(validateRunbook(c), /P4_CONTROLS_MISMATCH/));
});

test('runbook: degenerate inputs fail closed', () => {
  assert.equal(validateRunbook({}).ok, false);
  assert.equal(validateRunbook(null).ok, false);
  const c = clone(base()); c.runbook.phases[1].steps = [];
  assert.ok(has(validateRunbook(c), /PHASE_WITHOUT_STEPS: P1/));
  const d = clone(base()); delete d.stopConditions;
  assert.equal(validateRunbook(d).ok, false);
});

test('runbook (H-2): evidence finalization order is mechanical — raw freeze, determinism, publish, manifest, run-root freeze, commit last', () => {
  const r = validateRunbook(base()); assert.equal(r.ok, true);
  const at = (c, k) => c.runbook.phases.flatMap((p) => p.steps).find((s) => s.finalization === k).stepId;
  const b = base();
  assert.deepEqual(['rawFrozen', 'determinismChecked', 'derivedPublished', 'manifestWritten', 'runRootFrozen', 'commitRecordWritten'].map((k) => at(b, k)), ['P4.06', 'P5.07', 'P5.08', 'P5.09', 'P5.11', 'P5.12']);
  // the reviewed defect: the run root frozen before teardown.json and the derived files are written
  let c = clone(base()); step(c, 'P4.05').finalization = 'rawFrozen'; delete step(c, 'P4.06').finalization;
  assert.ok(has(validateRunbook(c), /RAW_WRITE_AFTER_RAW_FREEZE: P4\.05 raw\/teardown\.json/));
  // the commit record (or the publish) before the determinism check
  c = clone(base()); step(c, 'P5.07').finalization = 'commitRecordWritten'; step(c, 'P5.12').finalization = 'determinismChecked';
  assert.ok(has(validateRunbook(c), /FINALIZATION_OUT_OF_ORDER/));
  assert.ok(has(validateRunbook(c), /COMMIT_RECORD_WRITE_OUTSIDE_COMMIT_STEP: P5\.12/));
  // derived files written by an analysis step instead of the publish step
  c = clone(base()); step(c, 'P5.06').writes = ['derived/verdict.json'];
  assert.ok(has(validateRunbook(c), /DERIVED_WRITE_OUTSIDE_PUBLISH_STEP: P5\.06/));
  // anything created in the run root after the run-root freeze
  c = clone(base()); step(c, 'P5.12').writes = ['attempts:<authorizationId>.commit.json', 'derived/late.json'];
  assert.ok(has(validateRunbook(c), /RUN_ROOT_WRITE_AFTER_FREEZE: P5\.12 derived\/late\.json/));
  // the commit record is the very last step
  c = clone(base()); c.runbook.phases[5].steps.push({ stepId: 'P5.13', action: 'checkSomething', requiresFutureOwnerAuthorization: false, preconditions: ['P5.12'], onFail: null });
  assert.ok(has(validateRunbook(c), /COMMIT_RECORD_NOT_LAST/));
  // re-review finding 1: manifest consistency is checked after publication (P5.10), never as a pre-publication verdict input
  assert.equal(step(base(), 'P5.10').action, 'checkManifestLedgerConsistencyPostPublication');
  assert.match(base().verdictTable.externalGateRule.ledgerOkComputedAt, /manifest consistency is not a verdict input/);
});

test('runbook (M-6): no path is written twice (teardown.json once; control disposals in their own file)', () => {
  const c = clone(base()); step(c, 'P2.07').writes = ['raw/teardown.json'];
  assert.ok(has(validateRunbook(c), /PATH_WRITTEN_TWICE: raw\/teardown\.json by P2\.07 and P4\.05/));
  const writes = base().runbook.phases.flatMap((p) => p.steps).flatMap((s) => s.writes || []);
  assert.equal(writes.length, new Set(writes).size);
  for (const p of ['governance/target-plan.json', 'preflight/meta-template.target.json', 'raw/control-disposal.json', 'raw/teardown.json']) assert.ok(writes.includes(p), p);
});

test('runbook (M-4, M-7): control traces terminalize TZ targetEnd -> CT -> TZ final -> END; P0.06/P5.03 run the full NC registry', () => {
  const c = clone(base()); step(c, 'P2.02').controlTraceOrder = ['CT', 'TZ targetEnd', 'TZ final', 'END'];
  assert.ok(has(validateRunbook(c), /CONTROL_TRACE_ORDER: P2\.02/));
  const reg = base().controlMatrix.selfTestRegistry;
  assert.deepEqual(reg.order, base().controlMatrix.negativeControls.map((n) => n.id));
  assert.equal(reg.order[0], 'NC-1a'); assert.equal(reg.order.at(-1), 'NC-21');
  for (const id of ['P0.06', 'P5.03']) assert.match(step(base(), id).ncRegistry, /NC-1a\.\.NC-21/);
  assert.deepEqual(reg.runAt, ['P0.06', 'P5.03']);
});

test('runbook (M1 SC-C03 closeout): the committed branch is declared exactly (P5.07 scC03Branch, P5.08 branchWrites)', () => {
  const c = base();
  assert.equal(step(c, 'P5.07').onFail, 'SC-C03');
  assert.deepEqual(step(c, 'P5.07').scC03Branch, { continuesAt: 'P5.08', publishes: [], scratchAfterCompare: 'READ_ONLY_UNCHANGED' });
  assert.deepEqual(step(c, 'P5.08').branchWrites, { 'SC-C03': ['SC-C03-CLOSEOUT.json'] });
  assert.ok(step(c, 'P5.08').preconditions.includes('P5.07'));
  assert.equal(step(c, 'P5.08').finalization, 'derivedPublished');
  assert.ok(!(step(c, 'P5.08').writes || []).includes('SC-C03-CLOSEOUT.json'), 'closeout is disjoint from the normal writes');
  assert.deepEqual(validateRunbook(c).findings, []);
});

test('runbook (M1 SC-C03 closeout) mutations: branch removed or malformed', () => {
  let c = clone(base()); delete step(c, 'P5.07').scC03Branch;
  assert.ok(has(validateRunbook(c), /SC_C03_BRANCH_MISSING: P5\.07/));
  c = clone(base()); step(c, 'P5.07').onFail = null;
  assert.ok(has(validateRunbook(c), /SC_C03_BRANCH_MISSING: P5\.07 onFail/));
  c = clone(base()); step(c, 'P5.07').scC03Branch.continuesAt = 'P5.09';
  assert.ok(has(validateRunbook(c), /SC_C03_BRANCH_INVALID: P5\.07 continuesAt/));
  c = clone(base()); step(c, 'P5.07').scC03Branch.publishes = ['derived/verdict.json'];
  assert.ok(has(validateRunbook(c), /SC_C03_BRANCH_INVALID: P5\.07 publishes/));
  c = clone(base()); step(c, 'P5.07').scC03Branch.scratchAfterCompare = 'ANNOTATED';
  assert.ok(has(validateRunbook(c), /SC_C03_BRANCH_INVALID: P5\.07 scratchAfterCompare/));
  c = clone(base()); delete step(c, 'P5.08').branchWrites;
  assert.ok(has(validateRunbook(c), /SC_C03_BRANCH_INVALID: P5\.08 branchWrites must be exactly/));
  c = clone(base()); step(c, 'P5.08').branchWrites = { 'SC-C03': ['SC-C03-CLOSEOUT.json', 'TERMINAL-VERDICT.json'] };
  assert.ok(has(validateRunbook(c), /SC_C03_BRANCH_INVALID: P5\.08/));
  c = clone(base()); step(c, 'P5.08').preconditions = ['P5.06'];
  assert.ok(has(validateRunbook(c), /SC_C03_BRANCH_INVALID: P5\.08 preconditions must include/));
  c = clone(base()); step(c, 'P5.06').scC03Branch = { continuesAt: 'P5.08', publishes: [], scratchAfterCompare: 'READ_ONLY_UNCHANGED' };
  assert.ok(has(validateRunbook(c), /SC_C03_BRANCH_INVALID: scC03Branch on P5\.06/));
});

test('runbook (M1 SC-C03 closeout) mutations: the closeout is written only by the publish step, once, and never after a freeze', () => {
  let c = clone(base()); step(c, 'P5.06').writes = ['SC-C03-CLOSEOUT.json'];
  let r = validateRunbook(c);
  assert.ok(has(r, /SC_C03_CLOSEOUT_WRITE_OUTSIDE_PUBLISH_STEP: P5\.06/));
  assert.ok(has(r, /PATH_WRITTEN_TWICE: SC-C03-CLOSEOUT\.json/));
  c = clone(base()); step(c, 'P5.09').branchWrites = { 'SC-C03': ['SC-C03-CLOSEOUT.json'] }; step(c, 'P5.08').branchWrites = { 'SC-C03': [] };
  r = validateRunbook(c);
  assert.ok(has(r, /SC_C03_CLOSEOUT_WRITE_OUTSIDE_PUBLISH_STEP: P5\.09/));
  assert.ok(has(r, /SC_C03_BRANCH_INVALID: P5\.08 branchWrites must be exactly/));
  // normal writes of the publish step may not also carry the closeout (disjoint alternate sets)
  c = clone(base()); step(c, 'P5.08').writes = [...step(c, 'P5.08').writes, 'SC-C03-CLOSEOUT.json'];
  r = validateRunbook(c);
  assert.ok(has(r, /PATH_WRITTEN_TWICE: SC-C03-CLOSEOUT\.json/) && has(r, /SC_C03_BRANCH_INVALID: P5\.08 lists SC-C03-CLOSEOUT\.json in normal writes/));
  // after the run-root freeze / after the raw freeze
  c = clone(base()); step(c, 'P5.12').branchWrites = { 'SC-C03': ['late-closeout.json'] };
  assert.ok(has(validateRunbook(c), /RUN_ROOT_WRITE_AFTER_FREEZE: P5\.12 late-closeout\.json/));
  c = clone(base()); step(c, 'P5.12').branchWrites = { 'SC-C03': ['raw/late.json'] };
  assert.ok(has(validateRunbook(c), /RAW_WRITE_AFTER_RAW_FREEZE: P5\.12 raw\/late\.json/));
  c = clone(base()); step(c, 'P5.11').branchWrites = { 'SC-C03': ['SC-C03-CLOSEOUT.json'] };
  r = validateRunbook(c);
  assert.ok(has(r, /SC_C03_CLOSEOUT_WRITE_OUTSIDE_PUBLISH_STEP: P5\.11/) && has(r, /RUN_ROOT_WRITE_AFTER_FREEZE: P5\.11 SC-C03-CLOSEOUT\.json/));
  // the closeout branch never publishes derived files
  c = clone(base()); step(c, 'P5.08').branchWrites = { 'SC-C03': ['SC-C03-CLOSEOUT.json'], 'SC-X': ['derived/verdict.json'] };
  assert.ok(has(validateRunbook(c), /SC_C03_BRANCH_INVALID: P5\.08/));
  // a branch write of a derived file by an analysis step
  c = clone(base()); step(c, 'P5.06').branchWrites = { 'SC-C03': ['derived/x.json'] };
  assert.ok(has(validateRunbook(c), /DERIVED_WRITE_OUTSIDE_PUBLISH_STEP: P5\.06 derived\/x\.json/));
  // malformed
  c = clone(base()); step(c, 'P5.06').branchWrites = 'nope';
  assert.ok(has(validateRunbook(c), /STEP_WRITES_INVALID: P5\.06 branchWrites/));
});
