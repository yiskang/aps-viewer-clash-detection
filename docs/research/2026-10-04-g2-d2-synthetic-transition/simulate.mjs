#!/usr/bin/env node
// D2-OFFLINE synthetic simulator CLI/orchestrator (research tooling only; spec §14–§15).
//   node docs/research/2026-10-04-g2-d2-synthetic-transition/simulate.mjs --out <empty-dir>
// Exit codes: 0 = no cell C1-INVALID; 2 = C1-INVALID / conformance / input-hash / cap failure.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFixtures } from './contract.mjs';
import { enumerateSchedules, deriveCounts, characterizationSchedules } from './schedules.mjs';
import { runSchedule, STALE_CLASSES, ALL_CLASSES } from './machine.mjs';
import { runGeometryStudy } from './geometry.mjs';
import { canonicalBytes } from './canonical.mjs';
import { assertInputs, EXPECTED_INPUT_HASHES } from './inputs.mjs';
import { checkCaps, withDigests, writeOutputsAtomically, SUMMARY_FILE, WITNESSES_FILE } from './outputs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
export const DEFAULT_PATHS = {
  spec: join(REPO, 'docs/research/2026-10-04-g2-d2-synthetic-transition-spec.md'),
  harness: join(REPO, 'test/acceptance/clashpanel-viewerbridge.acceptance.mjs'),
  r1: join(REPO, 'docs/research/evidence/g2-live-20261004-75a3ccb9/R1-clashpanel-viewerbridge-g2-result.json'),
  fixtures: join(HERE, 'fixtures.json'),
};
const INV_NAMES = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V7'];
const CELLS = ['CL-primary', 'CL-tail', 'OP-primary', 'OP-tail'];

const tupleOf = (s) => ({
  family: s.family, mode: s.mode, D: s.D, L: s.L, S: s.S, ord: s.ord, G: s.G, rv: s.rv,
  delta: s.delta, tN: s.tN, r: s.r, rho: s.rho, synthetic: true,
});
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const fail = (code, message) => Object.assign(new Error(message), { exitCode: 2, code });

/**
 * Deterministic witness selection with reason merging (a shared schedule keeps every reason).
 * `pick` = { stale:{group:[ids]}, owned:{group:id}, diag:{name:id}, mech:{'cell|label':id} }.
 */
export function selectWitnesses({ pick, byId, characterization }) {
  const selected = []; // {witnessId, s, reasons[]}
  const add = (id, sch, reason) => {
    const ex = selected.find((w) => w.witnessId === id);
    if (ex) { if (!ex.reasons.includes(reason)) ex.reasons.push(reason); } else selected.push({ witnessId: id, s: sch, reasons: [reason] });
  };
  for (const k of Object.keys(pick.stale).sort()) for (const id of pick.stale[k]) add(`W-${id}`, byId.get(id), 'stale');
  for (const k of Object.keys(pick.owned).sort()) add(`W-${pick.owned[k]}`, byId.get(pick.owned[k]), 'owned-exemplar');
  for (const k of Object.keys(pick.mech || {}).sort()) { const [cell, label] = k.split('|'); add(`W-${pick.mech[k]}`, byId.get(pick.mech[k]), `mechanism:${label}@${cell}`); }
  for (const k of Object.keys(pick.diag).sort()) add(`W-${pick.diag[k]}`, byId.get(pick.diag[k]), `diagnostic:${k}`);
  for (const sch of characterization) add(sch.id, sch, 'characterization');
  return selected;
}

/** Cell outcome precedence (spec §12.1): C1, then A, then C2, then B. */
export function outcomeOf(st) {
  if (st.invariant > 0 || st.ambiguous > 0) return 'C1-INVALID';
  if (st.stale > 0) return 'A';
  if (st.inconclusive > 0) return 'C2-INCONCLUSIVE';
  return 'B';
}
export const exitCodeOf = (outcomes) => (Object.values(outcomes).some((o) => o === 'C1-INVALID') ? 2 : 0);

/** Run the full simulation; returns { summary, witnesses, summaryBytes, witnessesBytes, exitCode }. */
export function runSimulation({ paths = DEFAULT_PATHS, expected = EXPECTED_INPUT_HASHES, reader = readFileSync } = {}) {
  // 1. input/hash validation — fail closed before enumeration; every mandatory digest must be supplied
  for (const k of ['spec', 'harness', 'r1', 'fixtures']) {
    if (typeof expected?.[k] !== 'string' || !/^[0-9a-f]{64}$/.test(expected[k])) throw fail('C1-INVALID', `mandatory expected digest missing/invalid: ${k}`);
  }
  // Each input is read once into an owned byte snapshot; the digest and the parsed value both come from those bytes (no path reopen).
  const inputCheck = assertInputs({ paths, expected, reader });
  const fx = parseFixtures(inputCheck.snapshots.fixtures.toString('utf8'));
  const r1 = JSON.parse(inputCheck.snapshots.r1.toString('utf8'));

  // 2. derive counts from declared domains, enumerate, compare — fail closed on mismatch
  const derived = deriveCounts(fx.domains);
  const schedules = enumerateSchedules(fx.domains);
  const cellCounts = Object.fromEntries(CELLS.map((c) => [c, 0]));
  for (const s of schedules) cellCounts[s.cell] += 1;
  if (schedules.length > fx.caps.maxEnumerated) throw fail('C1-INVALID', `enumerated ${schedules.length} > cap`);
  const want = fx.expectedCounts;
  const mismatch = derived.total !== want.total || schedules.length !== want.total
    || CELLS.some((c) => derived.cells[c] !== want.cells[c] || cellCounts[c] !== want.cells[c]);
  if (mismatch) throw fail('C1-INVALID', `schedule count mismatch: derived=${derived.total} enumerated=${schedules.length} expected=${want.total}`);
  const charSchedules = characterizationSchedules(fx);
  if (charSchedules.length !== want.characterization) throw fail('C1-INVALID', `characterization count ${charSchedules.length} != ${want.characterization}`);

  // 3. exhaustive run (characterization schedules are structurally refused here)
  const classCounts = {}; const mechanismCounts = {}; const oracle = {};
  const invariantResults = Object.fromEntries(INV_NAMES.map((n) => [n, { violations: 0, firstScheduleId: null }]));
  const cellStat = Object.fromEntries(CELLS.map((c) => [c, { stale: 0, ambiguous: 0, inconclusive: 0, invariant: 0, h5Witness: 0, other: 0 }]));
  let e6 = 0;
  const pick = { stale: {}, owned: {}, diag: {}, mech: {} };
  const diag = (key, id) => { if (!pick.diag[key]) pick.diag[key] = id; };
  for (const s of schedules) {
    if (s.characterization) throw fail('C1-INVALID', 'characterization schedule leaked into exhaustive set');
    const r = runSchedule(s, fx);
    const cs = cellStat[s.cell];
    (classCounts[s.cell] ??= {});
    inc((classCounts[s.cell][s.family] ??= {}), r.cls);
    for (const l of r.labels) inc((mechanismCounts[s.cell] ??= {}), l);
    for (const v of r.inv) {
      invariantResults[v].violations += 1;
      invariantResults[v].firstScheduleId ??= s.id;
      cs.invariant += 1; diag(v, s.id);
    }
    if (r.cls === 'INVALID_AMBIGUOUS') { cs.ambiguous += 1; diag('INVALID_AMBIGUOUS', s.id); }
    if (r.cls === 'TIMED_OUT') { cs.inconclusive += 1; e6 += 1; diag('TIMED_OUT', s.id); }
    if (r.cls === 'PRECONDITION_BLOCKED') { cs.inconclusive += 1; e6 += 1; diag('PRECONDITION_BLOCKED', s.id); }
    const grp = `${s.family}|${s.mode}|${s.L === 0 ? 'primary' : 'tail'}`;
    for (const l of r.labels) pick.mech[`${s.cell}|${l}`] ??= s.id; // lowest schedule id per (cell, mechanism)
    if (r.stale) {
      cs.stale += 1;
      if (!r.labels.includes('M-GAP')) cs.h5Witness += 1;
      for (const e of ['e0', 'e1']) {
        const o = ((oracle[s.cell] ??= {})[e] ??= { CURES: 0, NOT_CURED_OWNER_CHANGED: 0, NO_EVENT: 0 });
        o[r.oracle[e]] += 1;
      }
      const k = `${grp}|${r.cls}`;
      (pick.stale[k] ??= []);
      if (pick.stale[k].length < 2) pick.stale[k].push(s.id);
    } else if (r.cls === 'OWNED') pick.owned[grp] ??= s.id;
  }
  // zero-fill missing class keys for readability
  for (const c of CELLS) for (const fam of Object.keys(classCounts[c] || {})) for (const k of ALL_CLASSES) classCounts[c][fam][k] ??= 0;

  // 4. per-cell outcomes and hypothesis verdicts (spec §8, §12)
  const outcomeSchedule = {}; const hypotheses = {};
  for (const c of CELLS) {
    const st = cellStat[c];
    const c1 = st.invariant > 0 || st.ambiguous > 0;
    const out = outcomeOf(st);
    outcomeSchedule[c] = out;
    const verdict = (witness) => (c1 ? 'INVALID' : witness > 0 ? 'SUPPORTED' : st.inconclusive > 0 ? 'INCONCLUSIVE' : 'REJECTED');
    hypotheses[c] = { H2: verdict(st.stale), H5: verdict(st.h5Witness), h5WitnessCount: st.h5Witness, staleCount: st.stale };
  }
  const exitCode = exitCodeOf(outcomeSchedule);

  // 5. D=30 characterization (never feeds cells / invariantResults / exit code)
  const char = {
    synthetic: true, count: charSchedules.length, modelValid: false, excludedFromExhaustiveCounts: true,
    excludedFromHypothesisInference: true, inferenceDrawn: 'none',
    classCounts: {}, byFamily: {}, invariantViolationCounts: {}, v5ViolationCount: 0, invalidAmbiguousCount: 0,
    timedOut: 0, preconditionBlocked: 0, staleCount: 0, ownedCount: 0,
    note: 'The D=30 characterization branch is outside the valid exhaustive model domain. All 36 schedules violate V5, and 12 are INVALID_AMBIGUOUS. These are model-invalid characterization results and are excluded from exhaustive H2/H5 inference, cell outcomes, invariantResults and the exit code. No inference is drawn from this branch.',
  };
  const charTraceIds = [];
  for (const s of charSchedules) {
    const r = runSchedule(s, fx);
    inc(char.classCounts, r.cls); inc((char.byFamily[s.family] ??= {}), r.cls);
    for (const v of r.inv) inc(char.invariantViolationCounts, v);
    if (r.inv.includes('V5')) char.v5ViolationCount += 1;
    if (r.cls === 'INVALID_AMBIGUOUS') char.invalidAmbiguousCount += 1;
    if (r.cls === 'TIMED_OUT') char.timedOut += 1;
    if (r.cls === 'PRECONDITION_BLOCKED') char.preconditionBlocked += 1;
    if (r.stale) char.staleCount += 1;
    if (r.cls === 'OWNED') char.ownedCount += 1;
    charTraceIds.push(s);
  }

  // 6. witness selection (deterministic) and bounded traces
  const byId = new Map(schedules.map((s) => [s.id, s]));
  const selected = selectWitnesses({ pick, byId, characterization: charTraceIds });
  if (selected.length > fx.caps.maxTraces) throw fail('CAP-EXCEEDED', `retained traces ${selected.length} > ${fx.caps.maxTraces}`);
  const witnessList = []; const traces = {};
  for (const w of selected) {
    const r = runSchedule(w.s, fx, { trace: true });
    if (r.trace.length > fx.caps.traceRows) throw fail('CAP-EXCEEDED', `trace ${w.witnessId} has ${r.trace.length} rows`);
    const bytes = canonicalBytes(r.trace).length;
    if (bytes > 16384) throw fail('CAP-EXCEEDED', `trace ${w.witnessId} is ${bytes} B`);
    traces[w.witnessId] = { witnessId: w.witnessId, scheduleId: w.s.id, tuple: tupleOf(w.s), classification: r.cls, rows: r.trace, synthetic: true };
    witnessList.push({ witnessId: w.witnessId, scheduleId: w.s.id, tuple: tupleOf(w.s), traceRef: `d2-witnesses.json#traces/${w.witnessId}`, classification: r.cls, mechanisms: r.labels, reasons: w.reasons, synthetic: true });
  }
  const diagnosticWitnesses = Object.keys(pick.diag).sort().map((k) => ({ reason: k, scheduleId: pick.diag[k], witnessId: `W-${pick.diag[k]}`, traceRef: `d2-witnesses.json#traces/W-${pick.diag[k]}`, synthetic: true }));

  // 7. geometry / C6-N2 study
  const geo = runGeometryStudy({ fixtures: fx, r1 });

  // 8. assemble
  const witnesses = {
    schemaVersion: 1, synthetic: true,
    traceRowSchema: ['frame', 'phase(X=external,H,+=post-H,A,T)', 'event', 'pendingToken', 'activeToken', 'progress', 'cameraOwner', 'transitionActive', 'sampleDecision', 'out'],
    traces,
  };
  const summary = {
    schemaVersion: 1,
    kind: 'D2-OFFLINE synthetic transition simulation (mechanical possibility only; no historical causality claim)',
    inputHashes: inputCheck.records,
    enumerationCount: schedules.length,
    derivedCount: derived.total,
    cellCounts,
    domains: { ...fx.domains, tail: fx.tail, t4: fx.t4, synthetic: true },
    classCounts, mechanismCounts,
    invariantResults,
    expectationE6: { count: e6 },
    oracle, outcomeSchedule, hypotheses,
    diagnosticWitnesses,
    characterization: char,
    geometry: geo.geometry,
    outcomeControl: geo.outcomeControl,
    witnesses: witnessList,
    caps: {
      observed: { traces: witnessList.length, witnessesCanonicalBytes: canonicalBytes(witnesses).length, geometryBytes: canonicalBytes(geo.geometry).length },
      limit: { traces: fx.caps.maxTraces, perOutputBytes: fx.caps.perOutputBytes, totalOutputBytes: fx.caps.totalOutputBytes, geometryBytes: fx.caps.geometryTableBytes },
    },
    provenance: {
      historicalDerived: [
        'U: 8 retained corners (R1 controls.N2.evidence.corners)',
        'fit-pair distance 263.8571494974672 (R1 targets.fitPair.distance, checked bit-for-bit)',
        'aspect 676/380 (derived from retained C6 ortho extents)',
        'kappa anchor 0.9 (read from the retained N2-like sample; a synthetic calibration anchor, not a margin)',
      ],
      retainedComparisonTargetsOnly: [
        'A:104 box and C8 worstExcess (D1 pattern targets; not a geometry operand of this simulator)',
        'C6/N2 retained scalars (pattern targets)',
      ],
      synthetic: [
        'SYN-A and SYN-B unit boxes (spec section 9.1; NOT the historical B:111/A:135 boxes)',
        'SYN-U (AABB union of SYN-A and SYN-B)',
        'home/target poses and the numeric sample map',
        'transition timing and ordering', 'tail stalls (tau=1e-10)', 'ease curve', 'calibration variation set V',
      ],
    },
    interpretationLimits: [
      'Mechanical possibility under modelled assumptions only; not historical causality.',
      'Scheduling-axis cell outcomes and control-axis D/E are independent and neither is a product-defect verdict.',
      'kappa=0.9 is not a margin; 3x is exploratory, not a threshold; d_min is observed only; no C6 margin is selected.',
      'D=30 characterization is model-invalid (V5 / INVALID_AMBIGUOUS), outside the exhaustive cell space, and supports no H2/H5 or mechanism inference.',
    ],
  };
  const { summaryBytes, witnessesBytes, summary: finalSummary } = withDigests({ summary, witnesses });
  const files = { [SUMMARY_FILE]: summaryBytes, [WITNESSES_FILE]: witnessesBytes };
  const caps = checkCaps({ files, fixturesCaps: fx.caps, traceCount: witnessList.length });
  if (!caps.ok) throw fail('CAP-EXCEEDED', caps.violations.join('; '));
  if (finalSummary.geometry && canonicalBytes(finalSummary.geometry).length > fx.caps.geometryTableBytes) throw fail('CAP-EXCEEDED', 'geometry table cap');
  return { summary: finalSummary, witnesses, summaryBytes, witnessesBytes, files, caps: fx.caps, traceCount: witnessList.length, exitCode };
}

function main(argv) {
  const i = argv.indexOf('--out');
  if (i < 0 || !argv[i + 1]) { console.error('usage: simulate.mjs --out <dir>'); return 2; }
  try {
    const res = runSimulation();
    const w = writeOutputsAtomically(resolve(argv[i + 1]), res.files, res.caps, { traceCount: res.traceCount });
    console.log(`enumerated=${res.summary.enumerationCount} derived=${res.summary.derivedCount} cells=${JSON.stringify(res.summary.cellCounts)}`);
    console.log(`outcomes=${JSON.stringify(res.summary.outcomeSchedule)} control=${res.summary.outcomeControl.outcome}`);
    console.log(`bytes=${JSON.stringify(w.files)} outputDigestSha256=${res.summary.outputDigestSha256}`);
    return res.exitCode;
  } catch (e) {
    console.error(`${e.code || 'ERROR'}: ${e.message}`);
    return e.exitCode ?? 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
