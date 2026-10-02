// test/acceptance/clashpanel-viewerbridge.acceptance.c13-ownership.test.mjs
//
// C13 phase ownership (owner-authorized fix of the 2026-10-02 independent re-review High H1). C13's oracle consumes the
// C15(b)/(c)/(e) outcomes produced in P8, so C13 EXECUTES in P8 -- and is now OWNED by P8 everywhere: procedure §5 phase
// chain, procedure §9.2 cross-field rule (v), `PHASE_ORDER` (P8 checks), `CHECK_OWNING_PHASES` (the map the real Node
// authority's `syncPage` and the R1 schema validator use), and the runner's `phaseUnits` (no separate deferral table).
// Before the fix a real P8 `beginCheck('C13')` was refused by the Node authority with `sync-activeCheck-phase-inconsistent`.
//
// Offline only. Non-vacuity: source-slice mutants restoring P7 ownership fail these checks (temp files removed after).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS_FILE = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url));
const SOURCE = readFileSync(HARNESS_FILE, 'utf8');
const PROC_TEXT = readFileSync(path.join(path.dirname(HARNESS_FILE), '..', '..', H.PROCEDURE_REL_PATH), 'utf8');
const vr = H.checkVerdictLabel;

/** The full check -> owning-phase(s) map after the fix (snapshot: only C13 moved, from ['P7'] to ['P8']). */
const EXPECTED_OWNERSHIP = Object.freeze({
  C1: ['P1'], C2: ['P3'], C3: ['P3'], C4: ['P4'], C5: ['P4'], C6: ['P6'], C7: ['P5a', 'P5b'], C8: ['P6'], C9: ['P7'], C10: ['P7'],
  C11: ['P7'], C12: ['P7'], C13: ['P8'], C14: ['P8'], C15: ['P8'], C16: ['P9'], C17: ['P9'], C18: ['P5a', 'P10'], C19: ['P11'], C20: ['P6b'],
});

// ---- mutants (source-slice; each anchor asserted unique) ----------------------------------------------------------------
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length - 1, 1, `anchor must occur exactly once: ${from.slice(0, 80)}`);
  return text.replace(from, () => to);
}
const OWN_P8 = "C12: ['P7'], C13: ['P8'], C14: ['P8'],";
const P7_ROW = "{ id: 'P7', name: 'isolation', checks: ['C9', 'C10', 'C11', 'C12'], controls: ['N4', 'N5'] },";
const P8_ROW = "{ id: 'P8', name: 'supersession + failure injection', checks: ['C14', 'C15', 'C13'], controls: [] },";
const MUTANTS = {
  // the exact pre-fix Node-validator state: execution in P8, ownership map back to P7
  ownershipP7: replaceOnce(SOURCE, OWN_P8, "C12: ['P7'], C13: ['P7'], C14: ['P8'],"),
  // phase metadata back to P7 (PHASE_ORDER lists C13 under P7 again; with no deferral table it would also run there)
  phaseOrderP7: replaceOnce(replaceOnce(SOURCE, P7_ROW, P7_ROW.replace("'C12']", "'C12', 'C13']")), P8_ROW, P8_ROW.replace(", 'C13']", ']')),
};
const SANDBOX = mkdtempSync(path.join(os.tmpdir(), 'g2-c13-own-'));
after(() => { rmSync(SANDBOX, { recursive: true, force: true }); });
const loaded = {};
async function mutant(name) {
  if (!loaded[name]) {
    const file = path.join(SANDBOX, `${name}.mjs`);
    writeFileSync(file, MUTANTS[name]);
    loaded[name] = await import(pathToFileURL(file).href);
  }
  return loaded[name];
}

// ---- procedure parsing --------------------------------------------------------------------------------------------------
/** Expands a procedure check list item ("C9–C12", "C7α", "C18b", "C18a", "N4") to its §10 check names (controls dropped). */
function expandChecks(item) {
  const t = item.trim().replace(/\s*\(.*\)$/, '');
  const range = t.match(/^C(\d+)[–-]C(\d+)$/);
  if (range) { const out = []; for (let i = Number(range[1]); i <= Number(range[2]); i += 1) out.push(`C${i}`); return out; }
  const m = t.match(/^C(\d+)(?:α|β|a|b)?$/);
  return m ? [`C${m[1]}`] : [];
}
const sortedMap = (m) => Object.fromEntries(Object.keys(m).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((k) => [k, [...m[k]].sort()]));
const addOwner = (map, check, phase) => { (map[check] = map[check] || new Set()).add(phase); };

/** §5 phase chain: every "`<Pid> <name> (<units>)`" segment. */
function procedurePhaseChainOwnership(text) {
  const line = text.split('\n').find((l) => l.startsWith('`P0 preflight` → '));
  assert.ok(line, '§5 phase chain line present');
  const map = {};
  for (const seg of line.matchAll(/`(P\d+[ab]?) [^`(]*\(([^)`]*)\)`/g)) for (const item of seg[2].split(',')) for (const c of expandChecks(item)) addOwner(map, c, seg[1]);
  return sortedMap(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]])));
}
/** §9.2 cross-field rule (v): "(C1 ⇒ P1; C2, C3 ⇒ P3; ... ; where C7/C18 ...)". */
function procedureRuleVOwnership(text) {
  const m = text.match(/the check belongs to `phase` per the §5 phase order \(([^]*?); where C7\/C18/);
  assert.ok(m, '§9.2 rule (v) ownership list present');
  const map = {};
  for (const part of m[1].split(';')) {
    const [lhs, rhs] = part.split('⇒').map((x) => x.trim());
    const phase = rhs.replace(/\s*\(.*\)$/, '');
    for (const item of lhs.split(',')) for (const c of expandChecks(item)) addOwner(map, c, phase);
  }
  return sortedMap(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]])));
}
/** Harness PHASE_ORDER (via phaseUnits, i.e. what the runner executes): check -> phases listing one of its units. */
function harnessExecutionOwnership(M) {
  const map = {};
  for (const p of M.PHASE_ORDER) for (const u of M.phaseUnits(p).checks) addOwner(map, M.SUBCHECK_OF[u] || u, p.id);
  return sortedMap(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]])));
}
/** Every ownership disagreement between the procedure, the runtime ownership map and the executed phase metadata. */
function ownershipProblems(M, text = PROC_TEXT) {
  const runtime = sortedMap(M.CHECK_OWNING_PHASES);
  const out = [];
  const cmp = (name, m) => { for (const c of M.CHECK_NAMES) if (JSON.stringify(m[c]) !== JSON.stringify(runtime[c])) out.push(`${name}:${c}`); };
  cmp('procedure-§5', procedurePhaseChainOwnership(text));
  cmp('procedure-§9.2(v)', procedureRuleVOwnership(text));
  cmp('phase-order', harnessExecutionOwnership(M));
  return out;
}

// ---- real Node authority helpers ------------------------------------------------------------------------------------------
function authorityAt(M, phase) {
  const violations = [];
  const attribution = { phase: 'P0', activeCheck: null, activeControl: null };
  const a = M.createRunAuthority({ allocator: M.createRunSeqAllocator(), attribution, onViolation: (r) => violations.push(r) });
  const step = (report) => a.syncPage({ hw: a.lastOrdinal(), pending: [], ...report });
  if (phase !== null) assert.deepEqual(step({ phase, activeCheck: null, activeControl: null }), { ok: true });
  return { a, step, violations, attribution };
}

/** The REAL runner (offline-fake drivers) with every attribution fence going through the REAL Node authority's syncPage. */
async function runThroughAuthority(M) {
  const violations = [];
  const attribution = { phase: 'P0', activeCheck: null, activeControl: null };
  const authority = M.createRunAuthority({ allocator: M.createRunSeqAllocator(), attribution, onViolation: (r) => violations.push(r) });
  const pageSeq = M.createPageOrdinalSource();
  const recorder = M.createCallRecorder({ nextSeq: pageSeq.next });
  const sync = {
    attribution: async (att) => {
      const rep = { hw: pageSeq.highWater(), pending: pageSeq.pending() };
      const r = authority.syncPage({ ...att, ...rep });
      if (!r.ok) throw new Error(`attribution sync refused by the node authority (${r.reason})`);
      pageSeq.ack(rep.hw);
    },
  };
  const begun = [];
  const pass = () => M.makeCheckRecord({ verdict: 'PASS' });
  const ok = (n) => M.makeControlRecord(n, { N1: 'DETECTED', N6: 'DETECTED', N8: 'DETECTED' }[n] || 'DETECTED_RESTORED');
  const drivers = {};
  for (const p of M.PHASE_ORDER) {
    drivers[p.id] = async (ctx) => {
      // every runnable check is begun (Node attribution fence), then acts (one event); as the live P8 driver, C13 last
      for (const c of ctx.runnable.checks) { await ctx.beginCheck(c); begun.push(`${p.id}:${c}`); recorder.logEvent(`ran:${c}`, { note: 'executed' }); }
      for (const n of ctx.runnable.controls) { await ctx.beginControl(n); recorder.logEvent(`ran:${n}`, { note: 'executed' }); }
      return { checks: Object.fromEntries(ctx.runnable.checks.map((c) => [c, pass()])), controls: Object.fromEntries(ctx.runnable.controls.map((n) => [n, ok(n)])) };
    };
  }
  const run = await M.runChecksInPhaseOrder({ drivers, mode: 'offline-fake', recorder, sync });
  return { run, violations, begun, authority, recorder };
}

// ==========================================================================================
// metadata / procedure agreement
// ==========================================================================================

test('(4) ownership table vs runtime metadata: procedure §5 phase chain, procedure §9.2 rule (v), CHECK_OWNING_PHASES and the executed PHASE_ORDER units all agree; C13 is P8 in each', () => {
  assert.deepEqual(ownershipProblems(H), []);
  assert.deepEqual(procedurePhaseChainOwnership(PROC_TEXT).C13, ['P8']);
  assert.deepEqual(procedureRuleVOwnership(PROC_TEXT).C13, ['P8']);
  assert.deepEqual(H.CHECK_OWNING_PHASES.C13, ['P8']);
  assert.deepEqual(harnessExecutionOwnership(H).C13, ['P8']);
  assert.deepEqual(H.PHASE_ORDER.find((p) => p.id === 'P7').checks, ['C9', 'C10', 'C11', 'C12']);
  assert.deepEqual(H.PHASE_ORDER.find((p) => p.id === 'P8').checks, ['C14', 'C15', 'C13'], 'C13 after C15 (it consumes the C15 outcomes)');
  assert.deepEqual(H.phaseUnits(H.PHASE_ORDER.find((p) => p.id === 'P8')).checks, ['C14', 'C15', 'C13']);
  assert.equal(H.phaseUnits(H.PHASE_ORDER.find((p) => p.id === 'P7')).checks.includes('C13'), false);
  // no separate deferral table any more: the phase metadata alone decides where a unit runs
  assert.equal('DEFERRED_UNITS' in H, false);
  assert.equal(/\bDEFERRED_UNITS\b/.test(SOURCE), false);
  // the live P8 driver is where C13 executes
  const p8 = SOURCE.slice(SOURCE.indexOf('    async P8(ctx) {'), SOURCE.indexOf('    async P9(ctx) {'));
  assert.ok(p8.includes("if (runnable.checks.includes('C13')) { await beginChk(ctx, 'C13'); checks.C13 = evaluateC13(st.c13); }"));
  const p7 = SOURCE.slice(SOURCE.indexOf('    async P7(ctx) {'), SOURCE.indexOf('    async P8(ctx) {'));
  assert.equal(p7.includes("beginChk(ctx, 'C13')"), false);
});

test('(6) no other check\'s ownership changed: the whole CHECK_OWNING_PHASES map is exactly the snapshot (only C13 moved P7 -> P8); dependencies and read-only status of C13 unchanged', () => {
  assert.deepEqual(sortedMap(H.CHECK_OWNING_PHASES), sortedMap(EXPECTED_OWNERSHIP));
  assert.deepEqual(Object.keys(H.CHECK_OWNING_PHASES).sort(), [...H.CHECK_NAMES].sort());
  assert.deepEqual(H.CHECK_DEPENDENCIES.C13, ['C10']);
  assert.ok(H.READ_ONLY_UNITS.includes('C13'));
  // every other phase's check/control lists are untouched
  const lists = Object.fromEntries(H.PHASE_ORDER.map((p) => [p.id, [[...p.checks], [...p.controls]]]));
  assert.deepEqual(lists, {
    P0: [[], []], P1: [['C1'], []], P2: [[], ['N1']], P3: [['C2', 'C3'], []], P4: [['C4', 'C5'], ['N6']],
    P5a: [['C7alpha', 'C18b'], ['N3']], P5b: [['C7'], []], P6: [['C6', 'C8'], ['N2']], P6b: [['C20'], ['N8']],
    P7: [['C9', 'C10', 'C11', 'C12'], ['N4', 'N5']], P8: [['C14', 'C15', 'C13'], []], P9: [['C16', 'C17'], ['N7']],
    P10: [['C18a'], []], P11: [['C19'], []], cleanup: [[], []], closeout: [[], []],
  });
});

// ==========================================================================================
// real Node authority
// ==========================================================================================

test('(1)/(3) C13 in P8 is accepted by the REAL Node authority (syncPage): attribution adopted, no violation; R1 rule (v) accepts {P8, C13}', () => {
  const { a, step, violations, attribution } = authorityAt(H, 'P8');
  assert.deepEqual(step({ phase: 'P8', activeCheck: 'C13', activeControl: null }), { ok: true });
  assert.deepEqual([attribution.phase, attribution.activeCheck], ['P8', 'C13']);
  assert.deepEqual(violations, []);
  assert.equal(a.isSynced(), true);
  // pending page ordinals carrying {P8, C13} are ingestible (the attribution validator of ingestBatch)
  const B = H.PAGE_LOCAL_BASE;
  assert.deepEqual(a.ingestFence({ pending: [{ ord: B + 1, kind: 'event', label: 'ran:C13', phase: 'P8', activeCheck: 'C13', activeControl: null }], hw: B + 1 }), { ok: true, count: 1 });
  assert.deepEqual(violations, []);
});

test('(2) C13 in P7 (and in every other non-P8 phase) is rejected: sync-activeCheck-phase-inconsistent, exactly one violation, attribution unchanged', () => {
  for (const phase of H.ATTRIBUTION_PHASES.filter((p) => p !== 'P8')) {
    const { step, violations, attribution } = authorityAt(H, ['P0', 'cleanup', 'closeout'].includes(phase) ? null : phase);
    const before = { ...attribution };
    const r = step({ phase, activeCheck: 'C13', activeControl: null });
    assert.deepEqual(r, { ok: false, reason: 'sync-activeCheck-phase-inconsistent' }, phase);
    assert.deepEqual(violations, ['sync-activeCheck-phase-inconsistent'], phase);
    assert.deepEqual(attribution, before, `${phase}: attribution not adopted`);
  }
});

test('(3) the real intended path: the REAL runner with every attribution fence through the REAL Node authority begins C13 in P8 (after C14/C15) -- no violation, C13 PASS, its event attributed {P8, C13}', async () => {
  const x = await runThroughAuthority(H);
  assert.deepEqual(x.violations, []);
  assert.deepEqual(x.begun.filter((b) => b.startsWith('P8:')), ['P8:C14', 'P8:C15', 'P8:C13']);
  assert.equal(x.begun.some((b) => b.startsWith('P7:C13')), false);
  assert.equal(vr(x.run.checks.C13), 'PASS');
  for (const n of H.CHECK_NAMES) assert.equal(vr(x.run.checks[n]), 'PASS', n);
  const ev = x.recorder.events.find((e) => e.kind === 'ran:C13');
  assert.deepEqual([ev.phase, ev.activeCheck], ['P8', 'C13']);
  // Node ingested the C13 event with that attribution
  assert.ok(x.authority.ingested().some((e) => e.kind === 'event' && e.label === 'ran:C13' && e.phase === 'P8' && e.activeCheck === 'C13'));
});

// ==========================================================================================
// non-vacuity: restoring P7 ownership fails
// ==========================================================================================

test('(5) mutation: restoring P7 ownership (CHECK_OWNING_PHASES.C13 = [P7]) => the real authority refuses P8 C13 again, the runner\'s C13 is a harness exception, and the agreement/snapshot checks fail', async () => {
  const M = await mutant('ownershipP7');
  const { step, violations } = authorityAt(M, 'P8');
  assert.deepEqual(step({ phase: 'P8', activeCheck: 'C13', activeControl: null }), { ok: false, reason: 'sync-activeCheck-phase-inconsistent' });
  assert.deepEqual(violations, ['sync-activeCheck-phase-inconsistent']);
  const x = await runThroughAuthority(M);
  assert.ok(x.violations.includes('sync-activeCheck-phase-inconsistent'), JSON.stringify(x.violations));
  assert.equal(vr(x.run.checks.C13), 'BLOCKED(harness-exception:P8)', 'the pre-fix live failure mode');
  assert.ok(ownershipProblems(M).includes('procedure-§5:C13'));
  assert.ok(ownershipProblems(M).includes('phase-order:C13'));
  assert.notDeepEqual(sortedMap(M.CHECK_OWNING_PHASES), sortedMap(EXPECTED_OWNERSHIP));
});

test('(5) mutation: C13 listed under P7 in PHASE_ORDER again => it is no longer a P8 unit (runs before its C15 inputs) and the agreement checks fail', async () => {
  const M = await mutant('phaseOrderP7');
  assert.equal(M.phaseUnits(M.PHASE_ORDER.find((p) => p.id === 'P8')).checks.includes('C13'), false);
  assert.ok(ownershipProblems(M).includes('phase-order:C13'), JSON.stringify(ownershipProblems(M)));
  // and a P7 begin of C13 is refused by the (P8-owning) authority
  const x = await runThroughAuthority(M);
  assert.ok(x.violations.includes('sync-activeCheck-phase-inconsistent'));
  assert.notEqual(vr(x.run.checks.C13), 'PASS');
});

test('(5) the procedure parser is not vacuous: a procedure text that still says "C9–C13 ⇒ P7" / "P7 isolation (C9–C13, …)" disagrees with the runtime map', () => {
  const stale = PROC_TEXT.replace('C9–C12 ⇒ P7; C13, C14, C15 ⇒ P8;', 'C9–C13 ⇒ P7; C14, C15 ⇒ P8;')
    .replace('`P7 isolation (C9–C12, N4, N5)` → `P8 supersession + failure injection (C14,C15,C13)`', '`P7 isolation (C9–C13, N4, N5)` → `P8 supersession + failure injection (C14,C15)`');
  assert.notEqual(stale, PROC_TEXT);
  assert.deepEqual(ownershipProblems(H, stale), ['procedure-§5:C13', 'procedure-§9.2(v):C13']);
});
