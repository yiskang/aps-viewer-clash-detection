// Input pins, conformance gate, transitivity, projection/partition exactness, minimal sets, public-only ambiguity and
// version-bound resolution cases, and full-run determinism. [SYN] research tests only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadPinned, readPinnedInputs, DEFAULT_PATHS, EXPECTED, HERE, D2_DIR, REPO } from './pins.mjs';
import { observeSchedule, labelsOf, QUESTIONS, QUESTION_IDS } from './observer.mjs';
import { checkSchedule, compareRows } from './conformance.mjs';
import { project, transitivityHolds, maskOf, atomsOfMask, ATOM_INDEX, NAMED_CONFIGS } from './project.mjs';
import { Interner, buildFastData, evaluateSubsets, extractMinimal, compareMasks, N_SUBSETS } from './sufficiency.mjs';
import { runDiagnostic, writeOutputs, SUMMARY_FILE, WITNESSES_FILE } from './run-diagnostic.mjs';
import { correlate, SLOT_WINDOW, CORRELATOR_QUESTIONS } from './correlate.mjs';

const { fixtures: fx, mods } = await loadPinned();
const d2 = { ...mods.contract, ...mods.machine };
const within = mods.contract.cameraSamplesWithin;
const { canonicalBytes, canonicalStringify, sha256Hex } = mods.canonical;
const schedules = mods.schedules.enumerateSchedules(fx.domains);
const exit2 = (e) => e.exitCode === 2;
const sha = (b) => createHash('sha256').update(b).digest('hex');

test('input-hash mismatch fails closed (exit 2) before anything is parsed or loaded', async () => {
  assert.throws(() => readPinnedInputs({ expected: { ...EXPECTED, d2Machine: '0'.repeat(64) } }), (e) => exit2(e) && /d2Machine/.test(e.message));
  // tampered bytes delivered by the single read are rejected
  const reader = (p) => (p === DEFAULT_PATHS.d2Fixtures ? Buffer.concat([readFileSync(p), Buffer.from(' ')]) : readFileSync(p));
  assert.throws(() => readPinnedInputs({ reader }), (e) => exit2(e) && /d2Fixtures/.test(e.message));
  // a missing expected digest is itself a failure
  assert.throws(() => readPinnedInputs({ expected: { ...EXPECTED, d2Canonical: undefined } }), exit2);
  // D2 summary whose outputDigestSha256 field differs (file pin adjusted to the tampered bytes) => exit 2
  const tampered = Buffer.from(readFileSync(DEFAULT_PATHS.d2Summary, 'utf8').replace(/"outputDigestSha256":"[0-9a-f]{64}"/, `"outputDigestSha256":"${'f'.repeat(64)}"`));
  const r2 = (p) => (p === DEFAULT_PATHS.d2Summary ? tampered : readFileSync(p));
  await assert.rejects(loadPinned({ reader: r2, expected: { ...EXPECTED, d2Summary: sha(tampered) } }), exit2);
  await assert.rejects(runDiagnostic({ loadOpts: { expected: { ...EXPECTED, d2Spec: '1'.repeat(64) } } }), exit2);
});

test('every input is read exactly once and hashed/parsed from the same bytes', () => {
  const calls = {};
  const reader = (p) => { calls[p] = (calls[p] || 0) + 1; return readFileSync(p); };
  const { records, snapshots } = readPinnedInputs({ reader });
  for (const p of Object.values(DEFAULT_PATHS)) assert.equal(calls[p], 1, p);
  for (const [n, b] of Object.entries(snapshots)) assert.equal(sha(b), records[n].observed, n);
  assert.equal(records.thisSpec.expected, null);
});

test('conformance gate: replica equals D2 on sampled schedules; a corrupted field or decision-time row => exit 2', () => {
  const pick = schedules.filter((_, i) => i % 997 === 0);
  for (const s of pick) checkSchedule(s, observeSchedule(s, fx, d2), fx, mods.machine);
  const s = schedules.find((x) => observeSchedule(x, fx, d2).gt && x.family === 'F2');
  const base = () => observeSchedule(s, fx, d2);
  const o1 = base(); o1.res.t4Frame += 1;
  assert.throws(() => checkSchedule(s, o1, fx, mods.machine), (e) => exit2(e) && /t4Frame/.test(e.message));
  const o2 = base(); const dr = o2.rows.findIndex((r) => r[1] === 'H' && /^ss/.test(r[2]) && r[8] !== '-'); o2.rows[dr] = [...o2.rows[dr]]; o2.rows[dr][5] += 1;
  assert.throws(() => checkSchedule(s, o2, fx, mods.machine), exit2);
  const o3 = base(); o3.gt.subj = o3.gt.subj === 'PENDING' ? 'COMPLETE' : 'PENDING';
  assert.throws(() => checkSchedule(s, o3, fx, mods.machine), (e) => exit2(e) && /\(b\)/.test(e.message));
  const o4 = base(); o4.gt.restore = o4.gt.restore === 'OK_WHILE_IDLE' ? 'OK_WHILE_OUTSTANDING' : 'OK_WHILE_IDLE';
  assert.throws(() => checkSchedule(s, o4, fx, mods.machine), (e) => exit2(e) && /\(c\)/.test(e.message));
  const o5 = base(); o5.events = o5.events.filter((e) => e.k !== 'TC');
  assert.equal(compareRows(o5, mods.machine.runSchedule(s, fx, { trace: true }).trace).ok, false);
});

test('transitivity gate: holds on D2 traces; a non-transitive relation is detected', () => {
  for (const s of schedules.filter((_, i) => i % 1499 === 0)) assert.equal(transitivityHolds(observeSchedule(s, fx, d2).events, within), true);
  const v = (x) => Array(32).fill(x);
  const ev = [v(0), v(0.6), v(1.2)].map((cam) => ({ k: 'CAM', cam }));
  const loose = (a, b) => Math.abs(a[0] - b[0]) <= 1;
  assert.equal(transitivityHolds(ev, loose), false);
});

// ---- a deterministic CL-primary subsample for exactness / monotonicity checks
const clp = schedules.filter((s) => s.cell === 'CL-primary').map((s) => ({ s, o: observeSchedule(s, fx, d2) })).filter((x) => x.o.gt);
const SUB = clp.filter((_, i) => i % 27 === 0); // 120 relevant schedules
function fastFor(sample) {
  const it = { OFF: new Interner(), ON: new Interner() };
  const data = sample.map((x) => buildFastData(x.o.events, within, canonicalStringify, it));
  const labels = QUESTIONS.map((q, qi) => Int32Array.from(sample.map((x) => q.labelDomain.indexOf(labelsOf(x.o.gt)[qi]))));
  return { data, labels };
}

test('fast exact partition == canonical-bytes partition for ALL 512 subsets on both identity axes (subsample)', () => {
  const { data, labels } = fastFor(SUB);
  const all = Array.from({ length: N_SUBSETS }, (_, m) => m);
  for (const axis of ['OFF', 'ON']) {
    const fast = evaluateSubsets(data, labels, axis, all);
    for (let m = 0; m < N_SUBSETS; m += 1) {
      const keys = SUB.map((x) => sha256Hex(canonicalBytes(project(x.o.events, atomsOfMask(m), axis, within))));
      const fb = fast.blockOf[m];
      for (let i = 0; i < SUB.length; i += 1) for (let j = i + 1; j < SUB.length; j += 1) {
        assert.equal(fb[i] === fb[j], keys[i] === keys[j], `${axis} mask ${m} pair ${i},${j}`);
      }
    }
  }
});

test('projection monotonicity: adding an atom always refines the partition (subsample, both axes)', () => {
  const { data, labels } = fastFor(SUB);
  const all = Array.from({ length: N_SUBSETS }, (_, m) => m);
  for (const axis of ['OFF', 'ON']) {
    const fast = evaluateSubsets(data, labels, axis, all);
    for (let m = 0; m < N_SUBSETS; m += 1) for (let b = 0; b < 9; b += 1) {
      if (m & (1 << b)) continue;
      const fine = fast.blockOf[m | (1 << b)]; const coarse = fast.blockOf[m]; const map = new Map();
      for (let i = 0; i < SUB.length; i += 1) {
        if (map.has(fine[i])) assert.equal(map.get(fine[i]), coarse[i], `${axis} ${m}+${b}`);
        map.set(fine[i], coarse[i]);
      }
    }
  }
});

test('minimal-set extraction is checked against the full 512-subset table (no pruning)', () => {
  // synthetic non-monotone table: {0} and {1,2} sufficient, {0,3} NOT sufficient (a violation), full set sufficient
  const suff = Array.from({ length: N_SUBSETS }, (_, m) => (m & 1) !== 0 || (m & 6) === 6);
  suff[1 | 8] = false;
  const r = extractMinimal(suff);
  assert.deepEqual(r.minimal, [1, 6]);
  assert.equal(r.subsetsEvaluated, 512);
  assert.equal(r.monotonicityViolations, 1);
  // P-CC0 (index 4) is never recommended; V-* atoms lose ties
  const t2 = Array.from({ length: N_SUBSETS }, (_, m) => (m & (1 << 4)) !== 0 || (m & (1 << 8)) !== 0 || (m & 0b11) === 0b11);
  const r2 = extractMinimal(t2);
  assert.deepEqual(r2.recommended, 1 << 8);
  assert.deepEqual(r2.recommendedIncludingInf, 1 << 4);
  assert.equal(extractMinimal(Array(N_SUBSETS).fill(false)).status, 'INSUFFICIENT_BELOW_ORACLE');
  assert.ok(compareMasks(0b11, 1 << 8) > 0, 'fewest atoms first');
  // real CL-primary table: brute-force definition of minimality agrees with extractMinimal
  const { data, labels } = fastFor(clp);
  const ev = evaluateSubsets(data, labels, 'ON');
  const qi = QUESTION_IDS.indexOf('Q-TUPLE');
  const tab = Array.from({ length: N_SUBSETS }, (_, m) => ev.amb[m * QUESTIONS.length + qi] === 0);
  const brute = [];
  for (let m = 0; m < N_SUBSETS; m += 1) if (tab[m] && !Array.from({ length: N_SUBSETS }, (_, s) => s).some((s) => s !== m && (s & m) === s && tab[s])) brute.push(m);
  assert.deepEqual([...extractMinimal(tab).minimal].sort((a, b) => a - b), brute);
});

test('public-only ambiguity case and version-bound resolution case (actual CL-primary collision data)', () => {
  // Base atoms only (harness calls + T4 samples: public getCamera + harness tags) are ambiguous for Q-TUPLE;
  // take the lowest-id collision pair with different labels, confirm byte equality, then resolve it.
  const qi = QUESTION_IDS.indexOf('Q-TUPLE');
  const byKey = new Map(); let pair = null;
  for (const x of clp) {
    const bytes = canonicalBytes(project(x.o.events, [], 'ON', within)).toString('base64');
    const L = labelsOf(x.o.gt)[qi];
    if (!byKey.has(bytes)) byKey.set(bytes, x);
    else if (labelsOf(byKey.get(bytes).o.gt)[qi] !== L && !pair) pair = [byKey.get(bytes), x];
  }
  assert.ok(pair, 'a public-only (base) collision exists in CL-primary');
  const [a, b] = pair;
  const proj = (x, atoms) => canonicalBytes(project(x.o.events, atoms, 'ON', within));
  assert.ok(proj(a, []).equals(proj(b, [])), 'byte-identical under public+harness base');
  assert.notEqual(labelsOf(a.o.gt)[qi], labelsOf(b.o.gt)[qi]);
  assert.ok(!proj(a, ['V-PEND']).equals(proj(b, ['V-PEND'])) || !proj(a, ['V-EDGE']).equals(proj(b, ['V-EDGE'])), 'a version-bound atom separates the pair');
  // and the sound correlator never claims a definite label that differs from ground truth (L-3), in either slot mode
  const cfg = NAMED_CONFIGS.find((c) => c.id === 'T-VB/ON');
  for (const x of pair) {
    const L = labelsOf(x.o.gt);
    for (const slotWindow of [SLOT_WINDOW.OPEN, SLOT_WINDOW.ASSUME]) {
      const out = correlate(project(x.o.events, cfg.atoms, 'ON', within), { atoms: cfg.atoms, idAxis: 'ON', slotWindow });
      assert.equal(out.malformed, null); assert.equal(out.contradiction, null);
      for (const qid of CORRELATOR_QUESTIONS) {
        const v = out.questions[qid];
        if (v.status === 'DEFINITE') assert.equal(v.label, L[QUESTION_IDS.indexOf(qid)], `${x.s.id} ${qid} ${slotWindow}`);
      }
    }
  }
});

test('f-ablation (M-3): label separability under T-PUB does not need the frame index f (nor cl/xc); f adds uniqueness only', () => {
  // CL-primary, ID-OFF, Q-TUPLE. Blocks / mixed-label blocks per projection variant.
  const cfg = NAMED_CONFIGS.find((c) => c.id === 'T-PUB/OFF');
  const qi = QUESTION_IDS.indexOf('Q-TUPLE');
  const measure = (strip) => {
    const blocks = new Map();
    for (const x of clp) {
      const key = canonicalStringify(project(x.o.events, cfg.atoms, 'OFF', within).map(strip));
      const L = labelsOf(x.o.gt)[qi];
      const b = blocks.get(key); if (!b) blocks.set(key, new Set([L])); else b.add(L);
    }
    return { blocks: blocks.size, mixed: [...blocks.values()].filter((v) => v.size > 1).length };
  };
  const noF = ({ f, ...rest }) => rest;
  const noFnoCl = ({ f, cl, xc, ...rest }) => rest;
  assert.deepEqual(measure((e) => e), { blocks: 3240, mixed: 0 }, 'with f every trace is unique');
  assert.deepEqual(measure(noF), { blocks: 1968, mixed: 0 }, 'without f: fewer blocks, still 0 mixed');
  assert.deepEqual(measure(noFnoCl), { blocks: 1898, mixed: 0 }, 'without f and camera classes: still 0 mixed');
});

test('output writer is atomic as a unit (L-6): staging directory renamed onto an absent or empty target', () => {
  const root = mkdtempSync(join(tmpdir(), 'g2diag-'));
  try {
    const files = { a: Buffer.from('1'), b: Buffer.from('2') };
    writeOutputs(join(root, 'absent'), files);
    assert.deepEqual(readdirSync(join(root, 'absent')).sort(), ['a', 'b']);
    mkdirSync(join(root, 'empty'));
    writeOutputs(join(root, 'empty'), files);
    assert.deepEqual(readdirSync(join(root, 'empty')).sort(), ['a', 'b']);
    assert.deepEqual(readdirSync(root).sort(), ['absent', 'empty'], 'no staging directory left behind');
    mkdirSync(join(root, '.stale.staging'));
    assert.throws(() => writeOutputs(join(root, 'stale'), files), (e) => e.code === 'OUTPUT-DIR-NOT-EMPTY');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('output writer refuses non-empty and forbidden directories (no write happens)', () => {
  assert.throws(() => writeOutputs(HERE, { x: Buffer.from('1') }), (e) => e.code === 'OUTPUT-DIR-NOT-EMPTY');
  assert.throws(() => writeOutputs(join(D2_DIR, 'new-out'), { x: Buffer.from('1') }), (e) => e.code === 'FORBIDDEN-OUTPUT-DIR');
  assert.throws(() => writeOutputs(join(REPO, 'docs/research/evidence/x'), { x: Buffer.from('1') }), (e) => e.code === 'FORBIDDEN-OUTPUT-DIR');
});

test('determinism: a fresh full run is byte-identical to the committed results; outputs carry no paths/timestamps', { timeout: 900000 }, async () => {
  const res = await runDiagnostic();
  const dir = join(HERE, 'results');
  for (const f of [SUMMARY_FILE, WITNESSES_FILE]) assert.ok(res.files[f].equals(readFileSync(join(dir, f))), `${f} byte-identical`);
  const s = res.summary;
  const { outputDigestSha256: d, ...rest } = s;
  assert.equal(sha256Hex(canonicalStringify(rest)), d);
  assert.equal(s.companionDigestSha256, sha256Hex(res.files[WITNESSES_FILE]));
  const text = res.files[SUMMARY_FILE].toString('utf8') + res.files[WITNESSES_FILE].toString('utf8');
  assert.ok(!text.includes(REPO) && !/\/Users\/|[A-Z]:\\\\/.test(text), 'no absolute paths');
  assert.ok(!/20\d\d-\d\d-\d\dT\d\d:/.test(text), 'no timestamps');
  assert.equal(s.synthetic, true);
  assert.deepEqual(Object.keys(s.correlator).sort(), ['T-PUB/ON', 'T-VB/OFF', 'T-VB/ON', 'T-VB/ON@OPEN']);
  for (const id of Object.keys(s.correlator)) for (const c of Object.values(s.correlator[id])) for (const q of Object.values(c)) {
    assert.equal(q.wrong, 0);
    const reasons = Object.values(q.reasons).reduce((a, b) => a + b, 0);
    assert.equal(reasons, q.ambiguous + q.unavailable, `${id}: every non-definite verdict has exactly one persisted reason`);
  }
  for (const c of Object.values(s.correlator['T-VB/ON@OPEN'])) for (const q of Object.values(c)) assert.equal(q.definiteAssuming, 0, 'OPEN never relies on the assumption');
  assert.equal(s.d2Conformance.mismatches, 0); assert.equal(s.d2Conformance.schedules, 52308);
});
