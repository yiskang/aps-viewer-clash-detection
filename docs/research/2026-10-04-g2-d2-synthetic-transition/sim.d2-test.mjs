// D2-OFFLINE core tests (state machine, T4, oracle, classifier, enumeration, determinism).
// Named *.d2-test.mjs on purpose: scripts/run-tests.mjs only discovers *.test.mjs, so these never join `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtures, phi, cameraSamplesWithin } from './contract.mjs';
import { enumerateSchedules, deriveCounts, characterizationSchedules } from './schedules.mjs';
import { runSchedule, classify, checkInvariants, ALL_CLASSES } from './machine.mjs';
import { runSimulation, DEFAULT_PATHS, outcomeOf, exitCodeOf, selectWitnesses } from './simulate.mjs';
import { sha256Hex } from './canonical.mjs';
import { EXPECTED_INPUT_HASHES } from './inputs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = loadFixtures(join(HERE, 'fixtures.json'));
const sched = (o) => ({ family: 'F0', mode: 'CL', D: 4, L: 0, S: 0, ord: 'HAT', G: 0, rv: null, delta: -1, tN: -1, r: -1, rho: -1, id: 'T', ...o });
const rows = (r) => r.trace.map((x) => x.slice(0, 3).join(':'));

test('schedule count is derived from domains and equals 52,308 with spec cell counts', () => {
  const d = deriveCounts(fx.domains);
  assert.equal(d.total, 52308);
  assert.deepEqual(d.cells, { 'CL-primary': 4104, 'CL-tail': 4788, 'OP-primary': 18144, 'OP-tail': 25272 });
  const all = enumerateSchedules(fx.domains);
  assert.equal(all.length, 52308);
  assert.equal(new Set(all.map((s) => s.id)).size, 52308);
  assert.equal(all[0].id, 'S-00000');
  assert.equal(all[52307].id, 'S-52307');
  const cells = {};
  for (const s of all) cells[s.cell] = (cells[s.cell] || 0) + 1;
  assert.deepEqual(cells, d.cells);
});

test('D=30 characterization: exactly 36 schedules, labelled CW-, never part of the exhaustive set', () => {
  const c = characterizationSchedules(fx);
  assert.equal(c.length, 36);
  assert.ok(c.every((s) => s.id.startsWith('CW-') && s.D === 30 && s.characterization));
  const ids = new Set(enumerateSchedules(fx.domains).map((s) => s.id));
  assert.ok(c.every((s) => !ids.has(s.id)));
});

test('numeric T4: Φ samples compare at 1e-9 element-wise', () => {
  const a = phi([1, 2, 3, 4]);
  assert.equal(a.length, 32);
  assert.ok(cameraSamplesWithin(a, a.slice()));
  const b = a.slice(); b[17] += 1e-10; assert.ok(cameraSamplesWithin(a, b));
  b[17] = a[17] + 2e-9; assert.ok(!cameraSamplesWithin(a, b));
  assert.ok(!cameraSamplesWithin(a, a.slice(0, 31)));
  const c = a.slice(); c[3] = NaN; assert.ok(!cameraSamplesWithin(a, c));
  assert.ok(!cameraSamplesWithin(phi(fx.pose.home), phi(fx.pose.dest['1'])));
});

test('F0 zero-motion pair settles on the pre-request pose (M-PRE), derived frames', () => {
  const r = runSchedule(sched({}), fx, { trace: true });
  assert.equal(r.cls, 'STALE_INIT');
  assert.deepEqual(r.labels, ['M-PRE']);
  assert.equal(r.t4Frame, 1);
  assert.equal(r.t4Samples, 2);
  assert.deepEqual(r.inv, []);
});

test('δ=0: issue(N) runs in H+ of the gate frame; δ=1: next frame external step', () => {
  const base = { family: 'F1', mode: 'CL', D: 4, S: 0 };
  const r0 = runSchedule(sched({ ...base, delta: 0 }), fx, { trace: true });
  const r1 = runSchedule(sched({ ...base, delta: 1 }), fx, { trace: true });
  assert.ok(r0.trace.some((x) => x[0] === 1 && x[1] === '+' && x[2] === 'fit2'));
  assert.ok(r1.trace.some((x) => x[0] === 2 && x[1] === 'X' && x[2] === 'fit2'));
  assert.ok(!r1.trace.some((x) => x[2] === 'fit2' && x[0] < 2));
  // gate (settle N-1) returns at frame 1 H for both
  assert.ok(r0.trace.some((x) => x[0] === 1 && x[1] === 'H' && x[8] === 'settled'));
});

test('invariant V0 rejects a causal inversion; other invariants reject corrupted logs', () => {
  const ok = { causality: [{ issueKey: [1, 0.5], gateKey: [1, 0] }], terminals: [], oracleEvents: [], completionLog: [], tokenLog: { 1: [], 2: [] }, steps: [], activations: [], a3: true, pendingAtCap: false };
  assert.deepEqual(checkInvariants(ok), []);
  assert.deepEqual(checkInvariants({ ...ok, causality: [{ issueKey: [1, -1], gateKey: [1, 0] }] }), ['V0']);
  assert.ok(checkInvariants({ ...ok, terminals: [{ token: 1, frame: 3, activeToken: 1 }, { token: 1, frame: 4, activeToken: 1 }], oracleEvents: [{ token: 1, frame: 3 }, { token: 1, frame: 4 }], completionLog: [3, 4], tokenLog: { 1: ['fit', 'consume', 'terminal', 'terminal'], 2: [] } }).includes('V1'));
  assert.ok(checkInvariants({ ...ok, terminals: [{ token: 1, frame: 3, activeToken: 1 }] }).includes('V2'));
  assert.ok(checkInvariants({ ...ok, tokenLog: { 1: ['fit', 'consume'], 2: [] } }).includes('V3'));
  assert.ok(checkInvariants({ ...ok, tokenLog: { 1: ['fit', 'consume', 'consume'], 2: [] } }).includes('V4'));
  assert.ok(checkInvariants({ ...ok, steps: [{ kind: 'main', change: 1e-12 }] }).includes('V5'));
  assert.ok(checkInvariants({ ...ok, steps: [{ kind: 'tail', change: 1e-8 }] }).includes('V5'));
  assert.ok(checkInvariants({ ...ok, activations: [{ slotKey: [1, 0], fitKey: [1, -1], afterAbort: false }] }).includes('V7'));
  assert.ok(checkInvariants({ ...ok, pendingAtCap: true }).includes('V3'));
});

test('V2/V4 reject frame-mismatched events and illegal token histories (review finding 1)', () => {
  const ok = { causality: [], terminals: [{ token: 1, frame: 3, activeToken: 1 }], oracleEvents: [{ token: 1, frame: 3 }], completionLog: [3], tokenLog: { 1: ['fit', 'consume', 'terminal'], 2: [] }, steps: [], activations: [], a3: true, pendingAtCap: false };
  assert.deepEqual(checkInvariants(ok), []);
  assert.ok(checkInvariants({ ...ok, oracleEvents: [{ token: 1, frame: 99 }] }).includes('V2'));
  assert.ok(checkInvariants({ ...ok, completionLog: [77] }).includes('V2'));
  assert.ok(checkInvariants({ ...ok, tokenLog: { 1: ['consume', 'terminal'], 2: [] } }).includes('V4')); // never fitted
  assert.ok(checkInvariants({ ...ok, tokenLog: { 1: ['fit', 'terminal'], 2: [] } }).includes('V4')); // never consumed
  assert.ok(checkInvariants({ ...ok, tokenLog: { 1: ['fit', 'consume', 'overwritten'], 2: [] } }).includes('V4'));
});

test('witness traces carry one oracle delivery row per delivered verdict at completionFrame+e (review finding 2)', () => {
  const s = enumerateSchedules(fx.domains).find((x) => x.mode === 'CL' && x.family === 'F1' && runSchedule(x, fx).cls === 'STALE_PRIOR_TERMINAL');
  const r = runSchedule(s, fx, { trace: true });
  const fin = r.trace.find((x) => x[1] === 'A' && x[2] === 'final' && x[9] === 'c2');
  assert.ok(fin);
  for (const e of [0, 1]) {
    const d = r.trace.filter((x) => x[1] === 'O' && x[2] === `o2e${e}`);
    assert.equal(d.length, 1);
    assert.equal(d[0][0], fin[0] + e);
    assert.equal(d[0][9], 'T2*');
  }
});

test('pending slot is last-writer-wins: overwritten token never completes', () => {
  const r = runSchedule(sched({ family: 'F1', mode: 'OP', tN: 0, D: 3 }), fx);
  assert.deepEqual(r.tokenLog[1], ['fit', 'overwritten']);
  assert.deepEqual(r.terminalTokens, [2]);
  assert.deepEqual(r.inv, []);
});

test('restore branches: THROW aborts harness but shadow completes (derived frames); NOOP/OK do not cancel', () => {
  const thr = runSchedule(sched({ family: 'F2', D: 4, S: 0, delta: 0, rho: 0, rv: 'THROW' }), fx, { trace: true });
  assert.equal(thr.cls, 'HARNESS_ABORT');
  assert.ok(!thr.trace.some((x) => x[2] === 'fit2'));
  assert.deepEqual(thr.terminalTokens, [1]);
  assert.ok(thr.trace.some((x) => x[0] === 1 && x[1] === '+' && x[2] === 'restoreTHROW'));
  assert.ok(thr.trace.some((x) => x[0] === 4 && x[1] === 'A' && x[2] === 'final'));
  assert.deepEqual(thr.inv, []);
  for (const rv of ['OK-SAME', 'OK-NEXT', 'NOOP']) {
    const r = runSchedule(sched({ family: 'F2', mode: 'OP', D: 6, S: 0, r: 2, rho: 1, rv }), fx);
    assert.deepEqual(r.terminalTokens, [1, 2], rv); // restore never cancels the active transition
    assert.equal(r.finalOwner, 'T2*');
    assert.ok(cameraSamplesWithin(phi(r.finalCam), phi(fx.pose.dest['2'])));
  }
  const idle = runSchedule(sched({ family: 'F2', mode: 'OP', D: 2, S: 0, r: 12, rho: 0, rv: 'OK-SAME' }), fx);
  assert.equal(idle.finalOwner, 'T2*');
});

test('SYNC timing differs only through the restore branch (OK-SAME vs OK-NEXT enumerated)', () => {
  const a = runSchedule(sched({ family: 'F2', mode: 'OP', D: 6, S: 0, r: 3, rho: 0, rv: 'OK-SAME' }), fx);
  const b = runSchedule(sched({ family: 'F2', mode: 'OP', D: 6, S: 0, r: 3, rho: 0, rv: 'OK-NEXT' }), fx);
  assert.deepEqual(a.terminalTokens, b.terminalTokens);
  assert.deepEqual(a.inv, []); assert.deepEqual(b.inv, []);
});

test('consume delay S: S=0 consumes on the arming tick, S=2 skips exactly two eligible ticks', () => {
  const t = (S) => runSchedule(sched({ D: 1, S }), fx, { trace: true }).trace.filter((x) => x[1] === 'T').map((x) => `${x[0]}:${x[2]}`);
  assert.deepEqual(t(0), ['0:cons1']);
  assert.deepEqual(t(2), ['0:skip', '1:skip', '2:cons1']);
});

test('timeout boundary: settle at sample 63/64 settles; 64 distinct samples → TIMED_OUT, never a 65th', () => {
  const jitter = (m) => ({ mutate: { afterFrame: (f, st) => { if (f < m) st.cam[0] += 1; } } });
  const atM = (m) => runSchedule(sched({ D: 1 }), fx, jitter(m));
  const a = atM(61); assert.equal(a.cls !== 'TIMED_OUT', true); assert.equal(a.t4Samples, 63);
  const b = atM(62); assert.equal(b.cls !== 'TIMED_OUT', true); assert.equal(b.t4Samples, 64);
  const c = atM(63); assert.equal(c.cls, 'TIMED_OUT'); assert.equal(c.t4Samples, 64);
});

test('tail-stall: each L∈{1,2} yields a valid M-TAIL STALE_IN_FLIGHT witness with V5 holding', () => {
  const all = enumerateSchedules(fx.domains).filter((s) => s.mode === 'CL' && s.family === 'F0');
  for (const L of [1, 2]) {
    const hit = all.filter((s) => s.L === L).map((s) => ({ s, r: runSchedule(s, fx) })).find((x) => x.r.cls === 'STALE_IN_FLIGHT');
    assert.ok(hit, `L=${L}`);
    assert.ok(hit.r.labels.includes('M-TAIL'));
    assert.deepEqual(hit.r.inv, []);
  }
});

test('classifier: single decision list is exclusive/exhaustive and C1/C2 inputs map as specified', () => {
  const owners = ['INIT', 'RESTORE', 'T1', 'T2', 'T1*', 'T2*'];
  for (const subject of [1, 2]) for (const ownerAtSample of owners) for (const withinDest of [true, false]) for (const t4Status of ['settled', 'timeout']) {
    for (const [pb, ha] of [[false, false], [true, false], [false, true]]) {
      const c = classify({ preconditionBlocked: pb, harnessAbort: ha, t4Status, subject, ownerAtSample, withinDest, subjState: 'PENDING', transitionActive: false });
      assert.ok(ALL_CLASSES.includes(c));
    }
  }
  const base = { preconditionBlocked: false, harnessAbort: false, t4Status: 'settled', subject: 2, subjState: 'COMPLETE', transitionActive: false };
  assert.equal(classify({ ...base, ownerAtSample: 'T2*', withinDest: false }), 'INVALID_AMBIGUOUS');
  assert.equal(classify({ ...base, ownerAtSample: 'T1*', withinDest: true }), 'INVALID_AMBIGUOUS');
  assert.equal(classify({ ...base, ownerAtSample: 'T2*', withinDest: true }), 'OWNED');
  assert.equal(classify({ ...base, ownerAtSample: 'T1*', withinDest: false }), 'STALE_PRIOR_TERMINAL');
  assert.equal(classify({ ...base, ownerAtSample: 'RESTORE', withinDest: false }), 'STALE_RESTORE');
  assert.equal(classify({ ...base, ownerAtSample: 'INIT', withinDest: false }), 'STALE_INIT');
  assert.equal(classify({ ...base, ownerAtSample: 'T2', withinDest: false }), 'STALE_IN_FLIGHT');
  assert.equal(classify({ ...base, t4Status: 'timeout', ownerAtSample: 'T2*', withinDest: false }), 'TIMED_OUT');
  assert.equal(classify({ ...base, harnessAbort: true, t4Status: 'timeout', ownerAtSample: 'T2*', withinDest: false }), 'HARNESS_ABORT');
  assert.equal(classify({ ...base, preconditionBlocked: true, harnessAbort: true, ownerAtSample: 'T2*', withinDest: false }), 'PRECONDITION_BLOCKED');
});

test('cell outcomes: precedence C1 > A > C2 > B; exit 2 only for C1 (C2 exits 0)', () => {
  const z = { stale: 0, ambiguous: 0, inconclusive: 0, invariant: 0 };
  assert.equal(outcomeOf({ ...z, invariant: 1, stale: 3 }), 'C1-INVALID');
  assert.equal(outcomeOf({ ...z, ambiguous: 1 }), 'C1-INVALID');
  assert.equal(outcomeOf({ ...z, stale: 1, inconclusive: 5 }), 'A');
  assert.equal(outcomeOf({ ...z, inconclusive: 1 }), 'C2-INCONCLUSIVE');
  assert.equal(outcomeOf(z), 'B');
  assert.equal(exitCodeOf({ a: 'C2-INCONCLUSIVE', b: 'A' }), 0);
  assert.equal(exitCodeOf({ a: 'C1-INVALID', b: 'B' }), 2);
});

test('oracle is independent of T4: it reads the state-machine owner tag at delivery, not the sample', () => {
  const s = enumerateSchedules(fx.domains).find((x) => x.mode === 'OP' && x.family === 'F1' && runSchedule(x, fx).cls === 'STALE_PRIOR_TERMINAL');
  const honest = runSchedule(s, fx);
  assert.ok(['CURES', 'NOT_CURED_OWNER_CHANGED', 'NO_EVENT'].includes(honest.oracle.e0));
  // corrupt the owner tag after the terminal write: camera sample unchanged, oracle must notice
  const corrupted = runSchedule(s, fx, { mutate: { afterFrame: (f, st) => { if (st.owner === 'T2*') st.owner = 'RESTORE'; } } });
  assert.equal(honest.oracle.e1, 'CURES');
  assert.equal(corrupted.oracle.e0, 'CURES'); // delivered at end of the write frame, before the corruption
  assert.equal(corrupted.oracle.e1, 'NOT_CURED_OWNER_CHANGED');
});

test('full run: no invariant failures, caps and counters bounded, D=30 isolated, outputs deterministic', () => {
  const a = runSimulation();
  const b = runSimulation();
  assert.ok(Buffer.compare(a.summaryBytes, b.summaryBytes) === 0 && Buffer.compare(a.witnessesBytes, b.witnessesBytes) === 0);
  const s = a.summary;
  assert.equal(s.enumerationCount, 52308); assert.equal(s.derivedCount, 52308);
  assert.deepEqual(s.cellCounts, { 'CL-primary': 4104, 'CL-tail': 4788, 'OP-primary': 18144, 'OP-tail': 25272 });
  let total = 0;
  for (const cell of Object.values(s.classCounts)) for (const fam of Object.values(cell)) total += Object.values(fam).reduce((x, y) => x + y, 0);
  assert.equal(total, 52308); // D=30 results are not in the class aggregates
  assert.ok(Object.values(s.invariantResults).every((v) => v.violations === 0));
  assert.equal(s.characterization.count, 36);
  assert.equal(s.characterization.excludedFromExhaustiveCounts, true);
  assert.ok(s.witnesses.length <= 154);
  assert.equal(a.exitCode, 0);
  assert.equal(s.expectationE6.count, 0);
  assert.ok(a.summaryBytes.length <= 524288 && a.witnessesBytes.length <= 2621440);
  assert.ok(a.summaryBytes.length + a.witnessesBytes.length <= 3670016);
  assert.equal(sha256Hex(a.witnessesBytes), s.companionDigestSha256);
  assert.ok(s.provenance.synthetic.length > 0 && s.provenance.historicalDerived.length > 0);
});

test('every schedule keeps counters inside their declared domains', () => {
  let maxEnd = 0; let maxSamples = 0;
  for (const s of enumerateSchedules(fx.domains)) {
    const r = runSchedule(s, fx);
    maxEnd = Math.max(maxEnd, r.shadowEnd); maxSamples = Math.max(maxSamples, r.t4Samples);
    assert.ok(r.shadowEnd < 127 && r.t4Samples <= 64);
  }
  assert.ok(maxEnd < 127 && maxSamples <= 64);
});

test('hash-validation failure and cap failure are fail-closed (exit 2) on tampered temp copies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'd2-sim-'));
  try {
    const before = sha256Hex(readFileSync(DEFAULT_PATHS.fixtures));
    const tampered = join(dir, 'fixtures.json');
    copyFileSync(DEFAULT_PATHS.fixtures, tampered);
    writeFileSync(tampered, readFileSync(tampered, 'utf8').replace('"schemaVersion": 1', '"schemaVersion": 2'));
    assert.throws(() => runSimulation({ paths: { ...DEFAULT_PATHS, fixtures: tampered } }), (e) => e.exitCode === 2 && e.code === 'C1-INVALID');
    // cap failure: valid (re-pinned) fixtures with an impossible trace cap
    const capped = join(dir, 'capped.json');
    const f = JSON.parse(readFileSync(DEFAULT_PATHS.fixtures, 'utf8')); f.caps.maxTraces = 5;
    writeFileSync(capped, JSON.stringify(f, null, 2));
    assert.throws(() => runSimulation({ paths: { ...DEFAULT_PATHS, fixtures: capped }, expected: { ...EXPECTED_INPUT_HASHES, fixtures: sha256Hex(readFileSync(capped)) } }), (e) => e.exitCode === 2);
    assert.equal(sha256Hex(readFileSync(DEFAULT_PATHS.fixtures)), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runSimulation rejects absent or malformed mandatory digests (review finding)', () => {
  assert.throws(() => runSimulation({ expected: {} }), (e) => e.exitCode === 2 && /mandatory expected digest/.test(e.message));
  assert.throws(() => runSimulation({ expected: { ...EXPECTED_INPUT_HASHES, spec: null } }), (e) => e.exitCode === 2);
  assert.throws(() => runSimulation({ expected: { ...EXPECTED_INPUT_HASHES, r1: 'abc' } }), (e) => e.exitCode === 2);
});

test('selectWitnesses merges every reason on a shared schedule (non-vacuous dedup)', () => {
  const byId = new Map([['S-00001', { id: 'S-00001' }], ['S-00002', { id: 'S-00002' }]]);
  const pick = {
    stale: { 'F1|CL|primary|STALE_PRIOR_TERMINAL': ['S-00001', 'S-00002'] },
    owned: { 'F1|CL|primary': 'S-00002' },
    mech: { 'CL-primary|M-GAP': 'S-00001', 'CL-primary|M-PRE': 'S-00001' },
    diag: { V5: 'S-00001', INVALID_AMBIGUOUS: 'S-00001' },
  };
  const sel = selectWitnesses({ pick, byId, characterization: [{ id: 'CW-F0-HAT-0' }] });
  assert.equal(sel.length, 3); // S-00001, S-00002, CW — shared ids are deduplicated
  const w1 = sel.find((w) => w.witnessId === 'W-S-00001');
  assert.deepEqual(w1.reasons, ['stale', 'mechanism:M-GAP@CL-primary', 'mechanism:M-PRE@CL-primary', 'diagnostic:INVALID_AMBIGUOUS', 'diagnostic:V5']);
  const w2 = sel.find((w) => w.witnessId === 'W-S-00002');
  assert.deepEqual(w2.reasons, ['stale', 'owned-exemplar']);
});

test('every mechanism with a non-zero count has a retained witness trace (M-GAP included)', () => {
  const { summary, witnesses } = runSimulation();
  for (const [cell, labels] of Object.entries(summary.mechanismCounts)) {
    for (const [label, n] of Object.entries(labels)) {
      if (!(n > 0)) continue;
      const w = summary.witnesses.find((x) => x.reasons.includes(`mechanism:${label}@${cell}`));
      assert.ok(w, `${label}@${cell} has no retained witness`);
      assert.ok(w.mechanisms.includes(label), `${label}@${cell} witness does not carry the mechanism`);
      assert.ok(witnesses.traces[w.witnessId].rows.length > 0);
    }
  }
  assert.ok(summary.witnesses.some((x) => x.mechanisms.includes('M-GAP')));
  assert.ok(summary.witnesses.length <= 154);
});

test('D=30 is reported as model-invalid characterization and never feeds inference or exit status', () => {
  const { summary, exitCode } = runSimulation();
  const c = summary.characterization;
  assert.equal(c.count, 36);
  assert.equal(c.modelValid, false);
  assert.equal(c.v5ViolationCount, 36);
  assert.equal(c.invalidAmbiguousCount, 12);
  assert.equal(c.excludedFromHypothesisInference, true);
  assert.equal(c.inferenceDrawn, 'none');
  assert.match(c.note, /model-invalid characterization/);
  assert.doesNotMatch(c.note, /not model defects/);
  assert.match(c.note, /outside the valid exhaustive model domain/);
  // exhaustive side is untouched by the D=30 results
  assert.ok(Object.values(summary.invariantResults).every((v) => v.violations === 0));
  assert.deepEqual(Object.values(summary.outcomeSchedule), ['A', 'A', 'A', 'A']);
  assert.equal(exitCode, 0);
  const ids = new Set(summary.witnesses.filter((w) => w.reasons.includes('characterization')).map((w) => w.scheduleId));
  assert.equal(ids.size, 36);
  for (const cell of Object.values(summary.classCounts)) for (const fam of Object.values(cell)) assert.ok(Object.keys(fam).every((k) => k !== 'CW'));
  assert.equal(summary.hypotheses['CL-primary'].staleCount, 1071); // unchanged by D=30
});

test('provenance labels: SYN boxes are synthetic; A:104 is a comparison target only', () => {
  const p = runSimulation().summary.provenance;
  assert.ok(p.synthetic.some((x) => /SYN-A and SYN-B/.test(x) && /NOT the historical B:111\/A:135/.test(x)));
  assert.ok(!p.historicalDerived.some((x) => /A:104|B:111|A:135/.test(x)));
  assert.ok(p.retainedComparisonTargetsOnly.some((x) => /A:104/.test(x) && /not a geometry operand/.test(x)));
});

test('count mismatch is a conformance failure (C1-INVALID) before any result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'd2-cnt-'));
  try {
    const bad = join(dir, 'f.json');
    const f = JSON.parse(readFileSync(DEFAULT_PATHS.fixtures, 'utf8')); f.expectedCounts.total = 52309;
    writeFileSync(bad, JSON.stringify(f));
    assert.throws(() => runSimulation({ paths: { ...DEFAULT_PATHS, fixtures: bad }, expected: { ...EXPECTED_INPUT_HASHES, fixtures: sha256Hex(readFileSync(bad)) } }), (e) => e.exitCode === 2 && /count mismatch/.test(e.message));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

void rows;
