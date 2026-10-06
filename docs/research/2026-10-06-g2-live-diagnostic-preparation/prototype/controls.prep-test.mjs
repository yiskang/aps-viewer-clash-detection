// Positive/negative controls (Part 2 §11): PC-1..PC-5 evaluation, RG, what a failure invalidates, and the negative-
// control matrix runner. [SYN] research-local tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from './contract-loader.mjs';
import { parseJsonl, reseal } from './envelope.mjs';
import { generateFixtures, scenarioFromFiles, removeData } from './fixtures-gen.mjs';
import { evaluatePC1, evaluatePC2, evaluatePC4, evaluatePC5, evaluatePC3, evaluateControls, inCaptureEdgeWitness, runNegativeControlMatrix, CONTROL_EFFECTS } from './controls.mjs';
import { evaluateScenario } from './verdict.mjs';

const contract = loadContract();
const { files, scenarios } = generateFixtures(contract);
const load = (id) => scenarioFromFiles(files, id, { parseJsonl });
const sc = load('valid-complete');
const clone = (v) => JSON.parse(JSON.stringify(v));
const present = { T: true, 'PC-1': true, 'PC-2': true, 'PC-4': true, 'PC-5': true };

test('positive controls: every synthetic control trace passes its own pattern and correlator expectations', () => {
  assert.deepEqual(evaluatePC1(sc.traces['PC-1']), { outcome: 'PASSED', reasons: [] });
  assert.deepEqual(evaluatePC2(sc.traces['PC-2'], { contract }), { outcome: 'PASSED', reasons: [] });
  assert.deepEqual(evaluatePC4(sc.traces['PC-4'], { contract }), { outcome: 'PASSED', reasons: [], scope: 'STRUCTURAL_ONLY', nvReproduction: 'NOT_RETAINED' });
  assert.deepEqual(evaluatePC5(sc.traces['PC-5'], { contract }), { outcome: 'PASSED', reasons: [] });
  assert.deepEqual(evaluatePC3(sc.traces.T, { contract }), { outcome: 'PASSED', reasons: [] });
  const all = evaluateControls({ traces: sc.traces, present, contract });
  assert.equal(all.RG, true); assert.deepEqual(all.rgParts, { pc1: true, pc3: true, inCaptureWitness: true });
});

test('positive controls: a recorded PASSED that the pattern does not confirm is FAILED; a recorded FAILED is FAILED', () => {
  const failed = load('control-failure').traces['PC-1'];
  const r = evaluatePC1(failed);
  assert.equal(r.outcome, 'FAILED'); assert.ok(r.reasons.includes('CT_RECORDED_FAILED'));
  // flip the recorded outcome to PASSED: the missing fall/TC still fails the control
  const forged = clone(failed); forged.find((x) => x.k === 'CT').cr = 'PASSED'; reseal(forged);
  assert.equal(evaluatePC1(forged).outcome, 'FAILED');
  // PC-2: an extra foreign read breaks it; PC-5 without a restore fails; PC-4 with a retained NV on a bound sample fails closed
  const pc2 = clone(sc.traces['PC-2']); const i = pc2.findIndex((x) => x.k === 'PS' && x.sp === 1); pc2[i].sb = 'U'; reseal(pc2);
  assert.equal(evaluatePC2(pc2, { contract }).outcome, 'FAILED');
  const pc5 = sc.traces['PC-5']; const rs = pc5.slice(1, -1).findIndex((x) => x.k === 'RS' && x.pp === 'post');
  assert.equal(evaluatePC5(removeData(removeData(pc5, rs), rs - 1), { contract }).outcome, 'FAILED');
  const pc4 = clone(sc.traces['PC-4']); pc4[0].ei = 'UNKNOWN'; pc4[0].lb = 0; reseal(pc4);
  assert.ok(evaluatePC4(pc4, { contract }).reasons.includes('EDGE_INIT_NOT_LOW'));
});

test('controls: absent -> NOT_RUN; non-intact -> FAILED; each required control failure makes the run INVALID', () => {
  const c = evaluateControls({ traces: { ...sc.traces, 'PC-2': null }, present: { ...present, 'PC-2': false }, contract });
  assert.equal(c['PC-2'].outcome, 'NOT_RUN');
  const c2 = evaluateControls({ traces: { ...sc.traces, 'PC-4': null }, present, contract });
  assert.equal(c2['PC-4'].outcome, 'FAILED');
  for (const pc of ['PC-1', 'PC-2', 'PC-4', 'PC-5']) {
    assert.equal(CONTROL_EFFECTS[pc].required, true);
    const broken = clone(sc.traces[pc]); broken[broken.length - 1].sd = '0'.repeat(64);
    const r = evaluateScenario({ ...sc, traces: { ...sc.traces, [pc]: broken } }, { contract });
    assert.equal(r.runVerdict, 'INVALID', pc); assert.ok(r.runReasons.includes(`CONTROL_NOT_PASSED:${pc}`));
    for (const t of r.targets) assert.equal(t.verdict, 'INVALID');
  }
  // PC-3 is degrading, not invalidating: V-EDGE is disabled and edge-dependent targets are INCONCLUSIVE
  assert.equal(CONTROL_EFFECTS['PC-3'].required, false);
  const m = load('missing-vb3'); const r = evaluateScenario(m, { contract });
  assert.equal(r.runVerdict, 'INCONCLUSIVE'); assert.equal(r.controls['PC-3'], 'FAILED');
});

test('RG: requires PC-1, PC-3 and an in-capture rise/fall after a harness RQ post with slotNew = 1', () => {
  const data = sc.traces.T.slice(1, -1);
  assert.equal(inCaptureEdgeWitness(data), true);
  const noEdges = data.filter((r) => !(r.k === 'TE' && r.q < data.find((x) => x.k === 'TZ').q));
  assert.equal(inCaptureEdgeWitness(noEdges), false);
  const c = evaluateControls({ traces: { ...sc.traces, 'PC-1': load('control-failure').traces['PC-1'] }, present, contract });
  assert.equal(c.RG, false);
});

test('negative-control matrix: the runner flags any verdict, integrity-code or reason mismatch', () => {
  const s = scenarios.find((x) => x.id === 'stream-digest-mismatch');
  const observed = evaluateScenario(load(s.id), { contract });
  assert.equal(runNegativeControlMatrix([{ id: s.id, expected: s.expected, observed }]).ok, true);
  assert.equal(runNegativeControlMatrix([{ id: s.id, expected: { runVerdict: 'INCONCLUSIVE' }, observed }]).ok, false);
  assert.equal(runNegativeControlMatrix([{ id: s.id, expected: { runVerdict: 'INVALID', integrityCodes: ['OVERFLOW'] }, observed }]).ok, false);
  assert.equal(runNegativeControlMatrix([{ id: s.id, expected: { runVerdict: 'INVALID', reasonsInclude: ['NOPE'] }, observed }]).ok, false);
  // every Part 2 NC id with an offline fixture is represented
  const refs = new Set(scenarios.flatMap((x) => x.ncRefs));
  for (const nc of contract.controlMatrix.negativeControls.map((n) => n.id)) {
    if (nc === 'NC-13') continue; // proper prefixes: checked exhaustively in envelope/verdict tests and the run gate
    assert.ok(refs.has(nc), `${nc} has no fixture`);
  }
});

test('PC-4 scope: offline evaluation is structural only; a retained bound NV is never claimed reproduced (LIVE-only oracle)', () => {
  const t = clone(sc.traces['PC-4']);
  const c8s = t.filter((r) => r.k === 'C8');
  // a retained NV for the subject C8's bound terminal sample (unit-level insertion; integrity is not the subject here)
  t.splice(t.length - 1, 0, { k: 'NV', q: c8s[0].ss + 1, f: 0, tm: 0, nv: 'A'.repeat(344) });
  const r = evaluatePC4(t, { contract });
  assert.equal(r.outcome, 'FAILED');
  assert.deepEqual(r.reasons, ['NV_REPRODUCTION_LIVE_ONLY']);
  assert.equal(r.scope, 'STRUCTURAL_ONLY');
  assert.equal(r.nvReproduction, 'NOT_EVALUATED_OFFLINE');
  // no offline output names the oracle as having run
  assert.ok(!/REPRODUCED|ORACLE_PASSED|MATCHED/.test(JSON.stringify(r)));
  const all = evaluateControls({ traces: { ...sc.traces, 'PC-4': null }, present: { ...present, 'PC-4': false }, contract });
  assert.equal(all['PC-4'].outcome, 'NOT_RUN'); assert.equal(all['PC-4'].scope, 'STRUCTURAL_ONLY');
});

test('control-trace C6 guard input: PC-2/PC-5 correlator expectations need the control\'s own re-derived edge pattern', () => {
  for (const id of ['PC-2', 'PC-5']) {
    const t = sc.traces[id];
    assert.equal(t[t.length - 1].pc['VB-3'], 0, `${id} END.pc VB-3 is 0 by contract`);
    const data = t.slice(1, -1);
    const fall = data.findIndex((r) => r.k === 'TE' && r.ev === 0);
    const noFall = removeData(t, fall);
    const fn = id === 'PC-2' ? evaluatePC2 : evaluatePC5;
    const r = fn(noFall, { contract });
    assert.equal(r.outcome, 'FAILED', id);
    assert.ok(r.reasons.some((x) => /EDGE_PATTERN|TC_NOT_ADJACENT/.test(x)), `${id}: ${r.reasons}`);
    // the correlator expectation is not computed without the pattern (no ASSUME/OPEN/RESTORE reason)
    assert.ok(!r.reasons.some((x) => /ASSUME_CORRELATION|OPEN_NOT_FAIL_CLOSED|RESTORE_NOT_DEFINITE/.test(x)), id);
  }
});
