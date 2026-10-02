// Completed-result retention: the runner merges the driver's returned check/control/extras records into the runner-owned
// maps (partialSink source) BEFORE the final attribution-clear fence, so a fence throw cannot erase completed work.
// Offline only. Non-vacuity: a mutated copy of the harness (fence moved back before the merge) must LOSE the results.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS_URL = new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url);
const SOURCE = readFileSync(fileURLToPath(HARNESS_URL), 'utf8');
const FENCE = 'await setAttr({ activeCheck: null, activeControl: null });';
const EXTRAS_LINE = 'if (got.extras) Object.assign(extras, got.extras);';
const GOT_LINE = 'const got = out || {};';

const { PHASE_ORDER, makeCheckRecord, makeControlRecord, createCallRecorder, checkVerdictLabel: vr } = H;
const pass = () => makeCheckRecord({ verdict: 'PASS' });
const ok = (n) => makeControlRecord(n, { N1: 'DETECTED', N6: 'DETECTED', N8: 'DETECTED' }[n] || 'DETECTED_RESTORED');
const FENCE_ERR = new Error('fence-refused: post-driver clear');

function passingDrivers(log = [], overrides = {}) {
  const drivers = {};
  for (const p of PHASE_ORDER) {
    drivers[p.id] = async ({ runnable, beginControl }) => {
      log.push(p.id);
      for (const n of runnable.controls) beginControl(n);
      if (overrides[p.id]) return overrides[p.id]({ runnable });
      return { checks: Object.fromEntries(runnable.checks.map((c) => [c, pass()])), controls: Object.fromEntries(runnable.controls.map((n) => [n, ok(n)])) };
    };
  }
  return drivers;
}

/** Wrap a phase driver so the NEXT attribution clear for that phase (after the driver returned) throws. */
function setup(failPhase, overrides = {}) {
  const log = [];
  const recorder = createCallRecorder({});
  const state = { returned: false, fenceCalls: 0, seqAtFence: null, order: [] };
  const base = passingDrivers(log, overrides);
  const drivers = { ...base };
  if (failPhase) {
    drivers[failPhase] = async (ctx) => {
      const out = await base[failPhase](ctx);
      state.returned = true;
      return out;
    };
  }
  const sync = {
    attribution: async (a) => {
      state.order.push(`${a.phase}:${a.activeCheck}:${a.activeControl}`);
      if (failPhase && state.returned && a.phase === failPhase && a.activeCheck === null && a.activeControl === null) {
        state.fenceCalls += 1;
        state.seqAtFence = recorder.nextSeq('probe', 'at-fence');
        throw FENCE_ERR;
      }
    },
  };
  const partialSink = {};
  const run = (runner = H.runChecksInPhaseOrder) => runner({ drivers, mode: 'offline-fake', recorder, sync, partialSink });
  return { run, state, partialSink, log, recorder };
}

async function failedRun(failPhase, overrides, runner) {
  const s = setup(failPhase, overrides);
  await assert.rejects(s.run(runner), (e) => e === FENCE_ERR);
  assert.equal(s.state.fenceCalls, 1, 'the post-driver clear fence was reached and threw');
  return { ...s, p: s.partialSink.read() };
}

const P3 = { P3: () => ({ checks: { C2: pass(), C3: pass() } }) };
const P3_C2 = { P3: ({ runnable }) => ({ checks: { C2: pass() } }) };
const P2_N1 = { P2: () => ({ controls: { N1: makeControlRecord('N1', 'DETECTED') } }) };

test('1. P3 returns C2 PASS; fence throws -> C2 retained as PASS (not blocked)', async () => {
  const { p } = await failedRun('P3', P3_C2);
  assert.ok(p.units.C2);
  assert.equal(vr(p.units.C2), 'PASS');
});

test('2. P3 returns C2 and C3 PASS; fence throws -> both retained', async () => {
  const { p } = await failedRun('P3', P3);
  assert.equal(vr(p.units.C2), 'PASS');
  assert.equal(vr(p.units.C3), 'PASS');
});

test('3. P2 returns N1 DETECTED; fence throws -> controls.N1 retained with state/outcome and terminalSeq', async () => {
  const { p } = await failedRun('P2', P2_N1);
  assert.ok(p.controls.N1);
  assert.equal(p.controls.N1.state, 'DETECTED');
  assert.equal(p.controls.N1.executionRecord.started, true);
  assert.ok(Number.isInteger(p.controls.N1.executionRecord.terminalSeq));
});

test('4. mixed checks + controls + extras in one phase survive the fence failure', async () => {
  const { p } = await failedRun('P4', {
    P4: ({ runnable }) => ({
      checks: Object.fromEntries(runnable.checks.map((c) => [c, pass()])),
      controls: Object.fromEntries(runnable.controls.map((n) => [n, ok(n)])),
      extras: { retentionProbe: { kept: true } },
    }),
  });
  const phase = PHASE_ORDER.find((x) => x.id === 'P4');
  const u = H.phaseUnits(phase);
  assert.ok(u.checks.length > 0 && u.controls.length > 0, 'P4 has both checks and controls');
  for (const c of u.checks) assert.equal(vr(p.units[c]), 'PASS', c);
  for (const n of u.controls) assert.equal(p.controls[n].state, 'DETECTED', n);
  assert.deepEqual(p.extras.retentionProbe, { kept: true });
});

test('5. no fabrication: later-phase units absent; earlier phases kept; failed phase invents nothing un-returned', async () => {
  const { p, log } = await failedRun('P3', P3_C2);
  assert.deepEqual(log, ['P1', 'P2', 'P3']);
  assert.equal(p.units.C4, undefined);
  assert.equal(p.units.C5, undefined);
  assert.equal(p.controls.N6, undefined);
  // the un-returned C3 is explicitly BLOCKED(not-produced), never an invented PASS/FAIL
  assert.equal(vr(p.units.C3), 'BLOCKED(not-produced:P3)');
});

test('6. the fence failure is the runner rejection reason (root failure preserved)', async () => {
  const s = setup('P3', P3);
  await assert.rejects(s.run(), (e) => { assert.equal(e, FENCE_ERR); return true; });
});

test('7. ordering: retained terminalSeq was allocated before the fence call', async () => {
  const { p, state } = await failedRun('P2', P2_N1);
  assert.ok(Number.isInteger(state.seqAtFence));
  assert.ok(p.controls.N1.executionRecord.terminalSeq < state.seqAtFence);
  assert.ok(p.controls.N1.executionRecord.startSeq < p.controls.N1.executionRecord.terminalSeq);
});

test('8. PASS path unchanged: non-throwing fence yields all-PASS run, sane markers and eventLog', async () => {
  const s = setup(null);
  const r = await s.run();
  assert.deepEqual(s.log, PHASE_ORDER.filter((x) => !['P0', 'cleanup', 'closeout'].includes(x.id)).map((x) => x.id));
  for (const n of H.CHECK_NAMES) assert.equal(r.checks[n].verdict, 'PASS', n);
  for (const n of H.CONTROL_NAMES) assert.equal(r.controls[n].executionRecord.started, true, n);
  assert.equal(r.sessionTainted, false);
  // the partial sink reads the same maps the result was built from
  const p = s.partialSink.read();
  assert.equal(vr(p.units.C2), 'PASS');
  assert.equal(p.controls.N1.state, 'DETECTED');
});

// ---- 9. non-vacuity ----

function phaseRunBody() {
  const start = SOURCE.indexOf('const runPhase = async (phase) => {');
  assert.ok(start > 0);
  const end = SOURCE.indexOf('// ---- P1 (C1), C1 finalization', start);
  assert.ok(end > start);
  return { start, end, text: SOURCE.slice(start, end) };
}

test('9a. static: in the real source the clear fence follows the extras merge and the control/check merge loops', () => {
  const { text } = phaseRunBody();
  const occurrences = text.split(FENCE).length - 1;
  assert.equal(occurrences, 1, 'exactly one literal post-driver clear fence in runPhase');
  const iFence = text.indexOf(FENCE);
  const iGot = text.indexOf(GOT_LINE);
  const iExtras = text.indexOf(EXTRAS_LINE);
  const iSetControl = text.indexOf('setControl(n, v.ok ? r :');
  const iSetUnit = text.indexOf('setUnit(c, v.ok ? r :');
  for (const [name, i] of Object.entries({ iGot, iExtras, iSetControl, iSetUnit })) assert.ok(i > 0, name);
  assert.ok(iFence > iExtras);
  assert.ok(iFence > iSetControl);
  assert.ok(iFence > iSetUnit);
  assert.ok(iFence > iGot);
  assert.ok(text.indexOf(EXTRAS_LINE) < iFence);
});

const MUT_PATH = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mutant-retention.tmp.mjs', import.meta.url));
let mutant = null;
async function loadMutant() {
  if (mutant) return mutant;
  const { text } = phaseRunBody();
  assert.equal(text.split(FENCE).length - 1, 1);
  const without = text.replace(FENCE, '');
  assert.ok(without.includes(GOT_LINE));
  const mutatedText = without.replace(GOT_LINE, `${FENCE}\n    ${GOT_LINE}`);
  assert.notEqual(mutatedText, text);
  const { start, end } = phaseRunBody();
  writeFileSync(MUT_PATH, SOURCE.slice(0, start) + mutatedText + SOURCE.slice(end));
  mutant = await import(`${new URL(`file://${MUT_PATH}`).href}?v=${Date.now()}`);
  return mutant;
}
after(() => { try { rmSync(MUT_PATH, { force: true }); } catch { /* best effort */ } });

async function lost(failPhase, overrides, pick) {
  const M = await loadMutant();
  const s = setup(failPhase, overrides);
  await assert.rejects(s.run(M.runChecksInPhaseOrder), (e) => e === FENCE_ERR);
  return pick(s.partialSink.read());
}

test('9b. mutation (fence moved before the merge): case 1 (C2) loses the completed result', async () => {
  assert.equal(await lost('P3', P3_C2, (p) => p.units.C2 === undefined || vr(p.units.C2) !== 'PASS'), true);
});

test('9c. mutation: case 2 (C2/C3) loses the completed results', async () => {
  assert.equal(await lost('P3', P3, (p) => p.units.C2 === undefined && p.units.C3 === undefined), true);
});

test('9d. mutation: case 3 (N1) loses the completed control', async () => {
  assert.equal(await lost('P2', P2_N1, (p) => p.controls.N1 === undefined), true);
});

test('9e. the mutant harness is otherwise functional (same module, passing run unchanged)', async () => {
  const M = await loadMutant();
  const s = setup(null);
  const r = await s.run(M.runChecksInPhaseOrder);
  for (const n of M.CHECK_NAMES) assert.equal(r.checks[n].verdict, 'PASS', n);
});
