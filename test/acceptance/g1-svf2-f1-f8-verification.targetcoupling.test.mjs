// test/acceptance/g1-svf2-f1-f8-verification.targetcoupling.test.mjs
//
// Final bounded H3-R1 fix: a target-bearing control (wrong-owner, hidden-fragment) can only be
// PASS-eligible as DETECTED_RESTORED if a complete, valid, semantically consistent
// `controlTargets` record for it is present. Enforced in computeOverall (verdict boundary) AND
// validateResultSchema (evidence boundary). Pure/offline; no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROL_STATE, CONTROL_NAMES, CHECK_VERDICT, CLASSIFIER, INTEGRITY_RESULT, OVERALL_VERDICT,
  createControlResult, computeOverall, validateResultSchema, validateControlTargetEvidence, runBridgedControl,
} from './g1-svf2-f1-f8-verification.mjs';

const validWrongOwner = () => ({
  controlName: 'wrong-owner', selectedFragId: 7, selectedOwnerDbId: 42, injectedOwnerDbId: -999999,
  selectionSource: 'f1PopulationRecords', selectionRule: 'numeric-minimum', populationSize: 3,
});
const validHidden = () => ({
  controlName: 'hidden-fragment', selectedFragId: 4242, selectedTreeOwnerDbId: 9, actedOnFragId: 4242,
  selectionSource: 'f2TreeOwnerByFragId-intersect-f1PopulationClasses-L', selectionRule: 'numeric-minimum', populationSize: 5,
});
const validTargets = () => ({ 'wrong-owner': validWrongOwner(), 'hidden-fragment': validHidden() });

function cleanInput(overrides = {}) {
  const controls = {};
  for (const name of CONTROL_NAMES) controls[name] = createControlResult(name, { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true });
  const checks = Object.fromEntries(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'].map((n) => [n, CHECK_VERDICT.PASS]));
  return {
    fatalErrorObserved: false, cleanupUnresolvedOwnership: false, viewerScriptIntegrity: INTEGRITY_RESULT.VERIFIED,
    classifier: CLASSIFIER.CONFIRMED_SVF2, checks, controls, cleanupFailures: [], controlTargets: validTargets(), ...overrides,
  };
}

test('valid target records remain PASS-compatible', () => {
  assert.equal(computeOverall(cleanInput()), OVERALL_VERDICT.PASS);
});

test('1. wrong-owner DETECTED_RESTORED with no target record -> not PASS', () => {
  const t = validTargets(); delete t['wrong-owner'];
  assert.notEqual(computeOverall(cleanInput({ controlTargets: t })), OVERALL_VERDICT.PASS);
});

test('2. hidden-fragment DETECTED_RESTORED with no target record -> not PASS', () => {
  const t = validTargets(); delete t['hidden-fragment'];
  assert.notEqual(computeOverall(cleanInput({ controlTargets: t })), OVERALL_VERDICT.PASS);
});

test('missing controlTargets input entirely -> not PASS', () => {
  const i = cleanInput(); delete i.controlTargets;
  assert.notEqual(computeOverall(i), OVERALL_VERDICT.PASS);
});

test('3. structurally malformed target record -> not PASS', () => {
  for (const bad of [{ ...validWrongOwner(), selectedFragId: '7' }, 'x', [], null, { controlName: 'wrong-owner' }]) {
    assert.notEqual(computeOverall(cleanInput({ controlTargets: { ...validTargets(), 'wrong-owner': bad } })), OVERALL_VERDICT.PASS);
  }
});

test('4. semantically invalid wrong-owner record (injected == real owner) -> not PASS', () => {
  const bad = { ...validWrongOwner(), injectedOwnerDbId: 42 };
  assert.notEqual(computeOverall(cleanInput({ controlTargets: { ...validTargets(), 'wrong-owner': bad } })), OVERALL_VERDICT.PASS);
});

test('5. semantically invalid hidden-fragment record (acted-on != selected) -> not PASS', () => {
  const bad = { ...validHidden(), actedOnFragId: 4243 };
  assert.notEqual(computeOverall(cleanInput({ controlTargets: { ...validTargets(), 'hidden-fragment': bad } })), OVERALL_VERDICT.PASS);
});

test('a record filed under the wrong control name does not satisfy the gate', () => {
  const t = { 'wrong-owner': validHidden(), 'hidden-fragment': validWrongOwner() };
  assert.notEqual(computeOverall(cleanInput({ controlTargets: t })), OVERALL_VERDICT.PASS);
});

test('runBridgedControl: malformed booleans => NOT_EXECUTABLE and NO target record is emitted (no fabricated target)', async () => {
  const sunk = [];
  const raw = { ok: true, detected: 'true', restored: true, timedOut: false, selectedFragId: 7, selectedOwnerDbId: 42, injectedOwnerDbId: -999999, selectionSource: 'f1PopulationRecords', selectionRule: 'numeric-minimum', populationSize: 3 };
  const r = await runBridgedControl({ pageEvaluate: async () => raw, controlName: 'wrong-owner', inPageFn: () => {}, innerTimeoutMs: 50, onTargetEvidence: (rec) => sunk.push(rec) });
  assert.equal(r.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.deepEqual(sunk, []);
});

test('runBridgedControl: a well-formed settled result still emits its target record', async () => {
  const sunk = [];
  const raw = { ok: true, detected: true, restored: true, timedOut: false, selectedFragId: 7, selectedOwnerDbId: 42, injectedOwnerDbId: -999999, selectionSource: 'f1PopulationRecords', selectionRule: 'numeric-minimum', populationSize: 3 };
  const r = await runBridgedControl({ pageEvaluate: async () => raw, controlName: 'wrong-owner', inPageFn: () => {}, innerTimeoutMs: 50, onTargetEvidence: (rec) => sunk.push(rec) });
  assert.equal(r.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.deepEqual(sunk, [validWrongOwner()]);
});
