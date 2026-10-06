#!/usr/bin/env node
// G2 diagnostic-instrumentation OFFLINE prototype (spec §7–§8). [SYN] research tooling only.
//   node docs/research/2026-10-05-g2-diagnostic-instrumentation/run-diagnostic.mjs --out <empty-dir>
// Exit 0 = every gate passed. Exit 2 = input-hash, conformance, cap, transitivity, label or correlator-soundness
// failure (nothing is written). No network, Viewer, browser, randomness or wall-clock values in outputs.
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPinned, fail, REPO, D2_DIR, D2_DIR_REL } from './pins.mjs';
import { observeSchedule, labelsOf, QUESTIONS, QUESTION_IDS, RELEVANT_CLASSES } from './observer.mjs';
import { checkSchedule, checkAggregates, FIELDS_CHECKED } from './conformance.mjs';
import {
  ATOMS, NAMED_CONFIGS, FULL_ATOMS, ATOM_INDEX, project, transitivityHolds, maskOf, atomsOfMask, isOracleFree,
} from './project.mjs';
import { correlate, CORRELATOR_RUNS, CORRELATOR_QUESTIONS, VERDICT } from './correlate.mjs';
import {
  Interner, buildFastData, evaluateSubsets, extractMinimal, groupNecessity, requestIdentityNecessity, oracleBundleNecessity, N_SUBSETS,
} from './sufficiency.mjs';
import { OFFLINE_CAPS, OfflineTraceBuffer, assertCap, selectRetained, checkOutputCaps, assertNoNumericPose } from './bounds.mjs';
import { validateEvent } from './schema.mjs';
import { startAblation, analyzeAblation, maskOfElements, WINDOWS as ABL_WINDOWS, N_CONFIG_MASKS } from './ablation.mjs';

export const SUMMARY_FILE = 'diag-summary.json';
export const WITNESSES_FILE = 'diag-witnesses.json';
export const CELLS = ['CL-primary', 'CL-tail', 'OP-primary', 'OP-tail'];
const HERE_REL = 'docs/research/2026-10-05-g2-diagnostic-instrumentation';
export const PROTOTYPE_FILES = ['pins.mjs', 'observer.mjs', 'conformance.mjs', 'project.mjs', 'correlate.mjs', 'sufficiency.mjs', 'bounds.mjs', 'schema.mjs', 'ablation.mjs', 'ablation-worker.mjs', 'run-diagnostic.mjs'].map((f) => `${HERE_REL}/${f}`);
const ALL_CLASSES_ORDER = ['PRECONDITION_BLOCKED', 'HARNESS_ABORT', 'TIMED_OUT', 'INVALID_AMBIGUOUS', 'OWNED', 'STALE_PRIOR_TERMINAL', 'STALE_RESTORE', 'STALE_INIT', 'STALE_IN_FLIGHT'];
const RETAIN_QUESTIONS = ['Q-STALE', 'Q-TUPLE'];
const RETAIN_CONFIGS = ['T-PUB/OFF', 'T-VB/ON'];
const RETAIN_CELLS = ['CL-primary', 'CL-tail'];

const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
/** Bounded reason-code enum persisted in correlator.*.reasons (L-2). */
const REASON_RE = /^(ACTIVE_WITHOUT_VISIBLE_STEP|ACTIVE_STATE_UNOBSERVED|IDENTITY_AMBIGUOUS|UNOBSERVED_SLOT_WINDOW|FOREIGN_CANDIDATE|WRITER_RACE|NO_BASELINE|NO_CAPTURE_BASELINE|UNREAD_WRITER|UNBRACKETED_CHANGE|OBSERVABLE_ABSENT:(V-PEND|V-EDGE|V-EDGE\|P-TC|P-TC|ID-ON)|VB_UNAVAILABLE:VB-[0-3])$/;

export const INTERPRETATION_LIMITS = [
  'Every result is synthetic and holds only within D2\'s closed universe: two requests, no foreign writer, no no-op fit, the subject never discarded, finite domains (D2-spec section 7.6), and the section 7.3 modelling mapping.',
  'Public-only sufficiency measured here is a closed-world D2 result that implies no bound for a live Viewer; distinguishable means the label is a function of the projected synthetic trace inside D2 only.',
  'No result proves historical causality. Historical C8 stays unresolved, C6 stays NOT_EVIDENCED, historical G2 stays FAIL (row 3), and real T4 is unchanged. No settle rule is proposed.',
  'Version-bound atoms (V-PEND, V-ACT, V-EDGE) remain diagnostic/research-only even where shown necessary; any production or acceptance use would require procedure re-acceptance.',
  'D=30 is not simulated and supports no inference.',
  'ID-OFF measures information-theoretic separability inside a two-request universe where call order can implicitly reveal identity; it never licenses ORDER_ONLY attribution in a live diagnostic. Where ID-ON adds no discrimination this is "not demonstrated within D2\'s two-request, no-foreign-writer universe", never "unnecessary".',
  'P-CC0 (zero-motion cameraChanged at consumption) is [INF], runtime-unverified, and is never recommended.',
  'Modelling mapping [INF]: D2 runs the dispatch sub-step R even on skip frames, so a CC event may be emitted on a skip frame (followed literally).',
  'Oracle atoms X-OWN and X-TAG are evaluated only as named bundles; RESOLVED_BY_NAMED_BUNDLE / NOT_RESOLVED_BY_NAMED_BUNDLE are not necessity or insufficiency statements about those atoms.',
  'Not testable in D2 (reported, never results): DH-6a (no foreign writer), DH-8H/8P/8-empty (D2-spec section 8.3), DH-9 (A3 excludes no-op), subject-DH-10 (the subject is never discarded), DH-7b (latency is only the G dimension; label count only).',
  'Inside D2 (deterministic, jitter-free, two requests, no foreign writer) a per-frame public stream reconstitutes the timeline, so event order determines every label; the harness frame index f adds trace uniqueness only (label separability persists without f). Some separability is definitional (Q-DH7A is TCK absence; Q-ACTIVE is ac on the deciding SMP). Minimal sets are therefore closed-world fingerprint results: closed-world D2 results that imply no live bound, never an instrumentation recommendation.',
  'The R1-R8 correlator (section 6.2, with the conservative refinements listed in the README) is sound on every relevant schedule (wrong = 0) in all four named runs and in all 2,048 ablation configurations (exit 2 otherwise). Under the fail-closed OPEN window the minimum answers 2 of 13 questions (Q-ATTR has 0 definite labels in every configuration), and the assumption mode answers 3 of 13; only 3 of 13 questions (Q-OWNER, Q-SUBJ, Q-ATTR) have a sound procedure (none of Q-OWNER/Q-SUBJ fully). The other 10 are procedure-limited (NO_SOUND_PROCEDURE), not atom-limited. Its definiteness gap versus information-theoretic distinguishability is a finding, not a defect.',
  'ablation.canonical is the minimum sufficient diagnostic set for the sound correlator only (objective: the full 9-atom ID-ON definite counts in BOTH slot windows, wrong = 0), found by exhaustive evaluation of all 2 x 1,024 configurations of the 9 searchable atoms x the identity axis, with no pruning. It is a closed-world D2 result: a live diagnostic may need more, never less is implied, and every V-* atom in it remains research-only. Public-only configurations (no V-* atom) yield 0 definite owner/subject/attribution labels in every one of the 128 public subsets x 2 windows.',
  'Correlator runs keyed T-PUB/ON, T-VB/OFF and T-VB/ON assume no unobserved writer in any window no read covers: between the last visible pending-slot read and a consumption edge, between capture start and the first camera read, and between an unread restore and the next read (true in D2 by construction; unverifiable in a live 7.124.2 Viewer). T-VB/ON@OPEN is the fail-closed mode without that assumption; a camera write that leaves the 32-entry value unchanged stays invisible in both modes.',
];

/**
 * Runs the full offline experiment. Returns { summary, witnesses, files: {name: Buffer} }. Throws exit-2 errors.
 * `loadOpts` is passed to loadPinned (paths/expected/reader injection for fail-closed tests).
 */
export async function runDiagnostic({ loadOpts, ablationWorkers } = {}) {
  const pinned = await loadPinned(loadOpts);
  // exhaustive sound-correlator ablation (spec §8.6) runs on worker threads concurrently with passes 1-2
  const ablation = startAblation({ loadOpts: loadOpts || {}, records: pinned.records, nWorkers: ablationWorkers });
  try { return await runDiagnosticInner(pinned, ablation); } catch (e) { ablation.terminate(); throw e; }
}

async function runDiagnosticInner({ records, fixtures: fx, d2Summary, mods }, ablationRun) {
  const { canonicalStringify, canonicalBytes, sha256Hex } = mods.canonical;
  const within = mods.contract.cameraSamplesWithin;
  const d2 = { ...mods.contract, ...mods.machine };

  // ---- enumeration (52,308 exhaustive schedules only; D=30 never enters)
  const schedules = mods.schedules.enumerateSchedules(fx.domains);
  const cellCounts = Object.fromEntries(CELLS.map((c) => [c, 0]));
  for (const s of schedules) {
    if (s.characterization || !fx.domains.D.includes(s.D) || s.D === fx.characterization.D) throw fail('CONFORMANCE', `non-exhaustive schedule ${s.id}`);
    cellCounts[s.cell] += 1;
  }
  if (schedules.length !== fx.expectedCounts.total) throw fail('CONFORMANCE', `enumerated ${schedules.length}`);
  for (const c of CELLS) if (cellCounts[c] !== fx.expectedCounts.cells[c]) throw fail('CONFORMANCE', `cell ${c} ${cellCounts[c]}`);

  // ---- pass 1: conformance gate, caps, schema, transitivity, labels
  const classCounts = {}; const mechanismCounts = {};
  const capObs = { eventsPerTrace: 0, bytesPerEvent: 0, bytesPerTrace: 0 };
  let rowsChecked = 0;
  const relevant = Object.fromEntries(CELLS.map((c) => [c, []]));
  const relevantCounts = Object.fromEntries(CELLS.map((c) => [c, { total: 0, relevant: 0, excluded: Object.fromEntries(ALL_CLASSES_ORDER.filter((k) => !RELEVANT_CLASSES.includes(k)).map((k) => [k, 0])) }]));
  const labelCounts = Object.fromEntries(CELLS.map((c) => [c, Object.fromEntries(QUESTIONS.map((q) => [q.id, Object.fromEntries(q.labelDomain.map((l) => [l, 0]))]))]));
  for (const s of schedules) {
    const obs = observeSchedule(s, fx, d2);
    rowsChecked += checkSchedule(s, obs, fx, mods.machine);
    inc(((classCounts[s.cell] ??= {})[s.family] ??= {}), obs.res.cls);
    for (const l of obs.res.labels) inc((mechanismCounts[s.cell] ??= {}), l);
    for (const axis of ['OFF', 'ON']) {
      const buf = new OfflineTraceBuffer(canonicalBytes);
      for (const ev of project(obs.events, FULL_ATOMS, axis, within)) {
        const errs = validateEvent(ev, { mode: 'offline' });
        if (errs.length) throw fail('SCHEMA', `${s.id}/${axis}: ${errs.join('; ')}`);
        buf.append(ev);
      }
      buf.assertNoOverflow(`${s.id}/${axis}`);
      capObs.eventsPerTrace = Math.max(capObs.eventsPerTrace, buf.events.length);
      capObs.bytesPerEvent = Math.max(capObs.bytesPerEvent, buf.maxEventBytes);
      capObs.bytesPerTrace = Math.max(capObs.bytesPerTrace, buf.bytes);
    }
    if (!transitivityHolds(obs.events, within)) throw fail('TRANSITIVITY', `${s.id}: 1e-9 relation is not an equivalence`);
    const rc = relevantCounts[s.cell];
    rc.total += 1;
    if (obs.gt) {
      rc.relevant += 1;
      const L = labelsOf(obs.gt);
      QUESTIONS.forEach((q, i) => { labelCounts[s.cell][q.id][L[i]] += 1; });
      relevant[s.cell].push({ s, L });
    } else inc(rc.excluded, obs.res.cls);
  }
  for (const c of CELLS) for (const fam of Object.keys(classCounts[c] || {})) for (const k of ALL_CLASSES_ORDER) classCounts[c][fam][k] ??= 0;
  checkAggregates({ classCounts, mechanismCounts, cellCounts, total: schedules.length }, d2Summary, fx);

  // ---- label conformance (§8.2)
  for (const c of CELLS) {
    const m = d2Summary.mechanismCounts[c] || {};
    const lc = labelCounts[c];
    if (lc['Q-DH1'].T !== (m['M-PRE'] || 0)) throw fail('LABEL-CONFORMANCE', `${c} Q-DH1 ${lc['Q-DH1'].T} != M-PRE`);
    if (lc['Q-DH2'].T !== (m['M-GAP'] || 0)) throw fail('LABEL-CONFORMANCE', `${c} Q-DH2 != M-GAP`);
    if (c.endsWith('tail') && lc['Q-DH4'].T !== (m['M-TAIL'] || 0)) throw fail('LABEL-CONFORMANCE', `${c} Q-DH4 != M-TAIL`);
    const cls = {}; for (const fam of Object.keys(d2Summary.classCounts[c])) for (const [k, v] of Object.entries(d2Summary.classCounts[c][fam])) inc(cls, k, v);
    const own = { OWN: 'OWNED', PRIOR_TERMINAL: 'STALE_PRIOR_TERMINAL', IN_FLIGHT: 'STALE_IN_FLIGHT', RESTORE: 'STALE_RESTORE', INIT: 'STALE_INIT' };
    for (const [o, k] of Object.entries(own)) if (lc['Q-OWNER'][o] !== (cls[k] || 0)) throw fail('LABEL-CONFORMANCE', `${c} Q-OWNER ${o}`);
  }

  // ---- pass 2 per cell: fast exhaustive subset search, generic named configs, correlator
  const nQ = QUESTIONS.length;
  const sufficiency = {}; const minimalSets = { 'ID-OFF': {}, 'ID-ON': {} }; const necessity = {};
  const correlator = Object.fromEntries(CORRELATOR_RUNS.map((r) => [r.key, {}]));
  const witnessIndex = [];
  let maxMinimal = 0;
  const cfgById = Object.fromEntries(NAMED_CONFIGS.map((c) => [c.id, c]));
  const projDigest = (events, cfg) => sha256Hex(canonicalBytes(project(events, cfg.atoms, cfg.idAxis, within)));
  const observe = (s) => observeSchedule(s, fx, d2);

  for (const cell of CELLS) {
    const rel = relevant[cell];
    const nS = rel.length;
    const labels = QUESTIONS.map((q, qi) => Int32Array.from(rel.map((r) => q.labelDomain.indexOf(r.L[qi]))));
    const interners = { OFF: new Interner(), ON: new Interner() };
    const data = new Array(nS);
    const digests = Object.fromEntries(NAMED_CONFIGS.map((c) => [c.id, new Array(nS)]));
    const corr = Object.fromEntries(CORRELATOR_RUNS.map((r) => [r.key, Object.fromEntries(CORRELATOR_QUESTIONS.map((q) => [q, { ambiguous: 0, definite: 0, definiteAssuming: 0, unavailable: 0, wrong: 0, reasons: {} }]))]));
    for (let i = 0; i < nS; i += 1) {
      const { s, L } = rel[i];
      const obs = observe(s);
      data[i] = buildFastData(obs.events, within, canonicalStringify, interners);
      for (const cfg of NAMED_CONFIGS) digests[cfg.id][i] = projDigest(obs.events, cfg);
      const truth = { 'Q-OWNER': L[QUESTION_IDS.indexOf('Q-OWNER')], 'Q-SUBJ': L[QUESTION_IDS.indexOf('Q-SUBJ')], 'Q-ATTR': L[QUESTION_IDS.indexOf('Q-ATTR')] };
      const projCache = new Map();
      for (const run of CORRELATOR_RUNS) {
        const id = run.key; const cfg = cfgById[run.configId];
        if (!projCache.has(cfg.id)) projCache.set(cfg.id, project(obs.events, cfg.atoms, cfg.idAxis, within));
        const out = correlate(projCache.get(cfg.id), { atoms: cfg.atoms, idAxis: cfg.idAxis, slotWindow: run.slotWindow });
        if (out.malformed) throw fail('CORRELATOR', `${s.id}/${id}: MALFORMED ${out.malformed} on a projected synthetic trace`);
        if (out.contradiction) throw fail('CORRELATOR', `${s.id}/${id}: ${out.contradiction} on a consistent synthetic trace`);
        for (const q of CORRELATOR_QUESTIONS) {
          const v = out.questions[q]; const t = corr[id][q];
          if (v.status === VERDICT.DEFINITE) {
            if (v.label !== truth[q]) { t.wrong += 1; throw fail('CORRELATOR-SOUNDNESS', `${s.id}/${id}/${q}: definite ${v.label} != ground truth ${truth[q]}`); }
            t.definite += 1; if (v.assumption) t.definiteAssuming += 1;
          } else if (v.status === VERDICT.AMBIGUOUS || v.status === VERDICT.UNAVAILABLE) {
            if (v.status === VERDICT.AMBIGUOUS) t.ambiguous += 1; else t.unavailable += 1;
            if (!REASON_RE.test(v.reason)) throw fail('CORRELATOR', `${s.id}/${id}/${q}: reason ${v.reason} outside the bounded enum`);
            inc(t.reasons, v.reason);
          } else throw fail('CORRELATOR', `${s.id}/${id}/${q}: ${v.status}`);
        }
      }
    }
    for (const r of CORRELATOR_RUNS) correlator[r.key][cell] = corr[r.key];

    const keep = { OFF: [], ON: [] };
    for (const cfg of NAMED_CONFIGS) if (isOracleFree(cfg.atoms)) keep[cfg.idAxis].push(maskOf(cfg.atoms));
    const fast = { OFF: evaluateSubsets(data, labels, 'OFF', keep.OFF), ON: evaluateSubsets(data, labels, 'ON', keep.ON) };

    // generic (canonical-bytes) partitions for the 9 named configs
    sufficiency[cell] = {};
    for (const cfg of NAMED_CONFIGS) {
      const blockOf = new Int32Array(nS); const byDigest = new Map(); const members = [];
      for (let i = 0; i < nS; i += 1) {
        const d = digests[cfg.id][i];
        let b = byDigest.get(d);
        if (b === undefined) { b = members.length; byDigest.set(d, b); members.push([]); }
        blockOf[i] = b; members[b].push(i);
      }
      const perQ = {};
      for (let qi = 0; qi < nQ; qi += 1) {
        const lab = labels[qi];
        let amb = 0; let ambB = 0; let A = -1;
        const mixed = members.map((m) => m.some((i) => lab[i] !== lab[m[0]]));
        mixed.forEach((x, b) => { if (x) { ambB += 1; amb += members[b].length; } });
        for (let i = 0; i < nS && A < 0; i += 1) if (mixed[blockOf[i]]) A = i;
        perQ[QUESTION_IDS[qi]] = { relevant: nS, distinguishable: nS - amb, ambiguous: amb, blocks: members.length, ambiguousBlocks: ambB };
        if (A >= 0) {
          const B = members[blockOf[A]].find((i) => lab[i] !== lab[A]);
          const sa = rel[A].s; const sb = rel[B].s;
          const pa = canonicalBytes(project(observe(sa).events, cfg.atoms, cfg.idAxis, within));
          const pb = canonicalBytes(project(observe(sb).events, cfg.atoms, cfg.idAxis, within));
          if (!pa.equals(pb)) throw fail('WITNESS', `${cell}/${cfg.id}/${QUESTION_IDS[qi]}: witness pair not byte-identical`);
          witnessIndex.push({
            witnessId: `DW-${cell}-${cfg.id}-${QUESTION_IDS[qi]}`, cell, configId: cfg.id, question: QUESTION_IDS[qi],
            scheduleA: sa.id, scheduleB: sb.id, labelA: rel[A].L[qi], labelB: rel[B].L[qi], projectionDigest: sha256Hex(pa), traceRefs: [], synthetic: true,
          });
        }
      }
      sufficiency[cell][cfg.id] = perQ;
      // cross-check: the fast exact partition must equal the canonical-bytes partition for oracle-free configs
      if (isOracleFree(cfg.atoms)) {
        const m = maskOf(cfg.atoms); const f = fast[cfg.idAxis];
        const fb = f.blockOf[m];
        const map1 = new Map(); const map2 = new Map();
        for (let i = 0; i < nS; i += 1) {
          if ((map1.has(fb[i]) && map1.get(fb[i]) !== blockOf[i]) || (map2.has(blockOf[i]) && map2.get(blockOf[i]) !== fb[i])) throw fail('PARTITION-CROSSCHECK', `${cell}/${cfg.id}`);
          map1.set(fb[i], blockOf[i]); map2.set(blockOf[i], fb[i]);
        }
        for (let qi = 0; qi < nQ; qi += 1) if (f.amb[m * nQ + qi] !== perQ[QUESTION_IDS[qi]].ambiguous) throw fail('PARTITION-CROSSCHECK', `${cell}/${cfg.id}/${QUESTION_IDS[qi]}`);
      }
    }

    // minimal sets, necessity
    const minByAxis = {};
    for (const axis of ['OFF', 'ON']) {
      const key = `ID-${axis}`; minimalSets[key][cell] = {}; minByAxis[axis] = {};
      for (let qi = 0; qi < nQ; qi += 1) {
        const suff = new Array(N_SUBSETS);
        for (let m = 0; m < N_SUBSETS; m += 1) suff[m] = fast[axis].amb[m * nQ + qi] === 0;
        const r = extractMinimal(suff);
        if (r.status === 'SUFFICIENT_SETS_FOUND' && !r.fullSetSufficient) throw fail('SPEC-STATUS', `${cell}/${key}/${QUESTION_IDS[qi]}: a subset is sufficient but the full set is not`);
        assertCap('minimalSetsPerKey', r.minimal.length, OFFLINE_CAPS.minimalSetsPerKey);
        maxMinimal = Math.max(maxMinimal, r.minimal.length);
        minByAxis[axis][QUESTION_IDS[qi]] = r.minimal;
        minimalSets[key][cell][QUESTION_IDS[qi]] = {
          status: r.status,
          minimalSets: r.minimal.map(atomsOfMask),
          recommended: r.recommended === null ? null : atomsOfMask(r.recommended),
          recommendedIncludingInf: r.recommendedIncludingInf === null ? null : atomsOfMask(r.recommendedIncludingInf),
          subsetsEvaluated: r.subsetsEvaluated,
          monotonicityViolations: r.monotonicityViolations,
        };
      }
    }
    necessity[cell] = {};
    const g = (names) => names.reduce((m, a) => m | (1 << ATOM_INDEX[a]), 0);
    for (const q of QUESTION_IDS) {
      const on = minByAxis.ON[q]; const off = minByAxis.OFF[q];
      necessity[cell][q] = {
        requestIdentity: requestIdentityNecessity(off, on),
        transitionActive: groupNecessity(on, g(['V-ACT', 'V-EDGE'])),
        pendingSlot: groupNecessity(on, g(['V-PEND'])),
        formalCompletionPublic: groupNecessity(on, g(['P-TC'])),
        cameraWriteOwnership: oracleBundleNecessity(on, sufficiency[cell]['T-VB+OWN/ON'][q].ambiguous === 0),
        requestTaggedCompletion: oracleBundleNecessity(on, sufficiency[cell]['T-VB+TAG/ON'][q].ambiguous === 0),
      };
    }
  }
  assertCap('witnessIndexEntries', witnessIndex.length, OFFLINE_CAPS.witnessIndexEntries);

  // ---- exhaustive ablation (§8.6): merge, check coverage, cross-check against the four correlator runs
  const { acc: ablAcc, relevantByCell } = await ablationRun.promise;
  for (const c of CELLS) if ((relevantByCell[c] || 0) !== relevantCounts[c].relevant) throw fail('ABLATION', `${c}: ablated ${relevantByCell[c] || 0} relevant schedules, expected ${relevantCounts[c].relevant}`);
  const nRelevant = CELLS.reduce((a, c) => a + relevantCounts[c].relevant, 0);
  const ablation = analyzeAblation(ablAcc, nRelevant, (o) => schedules[o].id);
  for (const run of CORRELATOR_RUNS) {
    const cfg = cfgById[run.configId];
    const cm = maskOfElements(cfg.atoms) | (cfg.idAxis === 'ON' ? maskOfElements(['ID-ON']) : 0);
    const wk = ABL_WINDOWS.indexOf(run.slotWindow) === 0 ? 'OPEN' : 'ASSUME';
    const o = ablation.outcomes[ablation.outcomeIndex[wk][cm]];
    for (const q of CORRELATOR_QUESTIONS) {
      const sum = { definite: 0, definiteAssuming: 0, ambiguous: 0, unavailable: 0, wrong: 0, reasons: {} };
      for (const c of CELLS) { const t = correlator[run.key][c][q]; for (const k of ['definite', 'definiteAssuming', 'ambiguous', 'unavailable', 'wrong']) sum[k] += t[k]; for (const [r, n] of Object.entries(t.reasons)) inc(sum.reasons, r, n); }
      const got = { definite: o[q].definite, definiteAssuming: o[q].definiteAssuming, ambiguous: o[q].ambiguous, unavailable: o[q].unavailable, wrong: o[q].wrong, reasons: o[q].reasons };
      if (canonicalStringify(got) !== canonicalStringify(sum)) throw fail('ABLATION-CROSSCHECK', `${run.key}/${q}: ablation ${canonicalStringify(got)} != correlator ${canonicalStringify(sum)}`);
    }
  }
  if (ablation.outcomeIndex.OPEN.length !== N_CONFIG_MASKS) throw fail('ABLATION', 'outcome index size');
  // the INTERPRETATION_LIMITS wording about the ablation must hold on the data (fail closed on drift)
  const drift = [];
  if (ablation.canonical === null) drift.push('no canonical minimum');
  for (const w of ['OPEN', 'ASSUME']) for (const q of CORRELATOR_QUESTIONS) if (ablation.publicOnly.maxDefinite[w][q] !== 0) drift.push(`public-only ${w} ${q}`);
  if (ablation.allConfigurations.maxDefinite.OPEN['Q-ATTR'] !== 0) drift.push('OPEN Q-ATTR definite > 0');
  if (ablation.canonical && (ablation.questionCoverage.canonical.OPEN.answeredCount !== 2 || ablation.questionCoverage.canonical.ASSUME.answeredCount !== 3)) drift.push('x of 13');
  if (ablation.canonical && ablation.questionCoverage.canonical.ASSUME.fullyAnswered.some((q) => q !== 'Q-ATTR')) drift.push('fully answered');
  if (drift.length) throw fail('LIMITS-DRIFT', `interpretation limits no longer match the ablation: ${drift.join('; ')}`);

  // ---- retained traces (§8.8): nested order question x config x cell, dedupe by traceRef, cap 16
  const order = (w) => [CELLS.indexOf(w.cell), NAMED_CONFIGS.findIndex((c) => c.id === w.configId), QUESTION_IDS.indexOf(w.question)];
  witnessIndex.sort((a, b) => { const x = order(a); const y = order(b); for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
  const wanted = [];
  for (const q of RETAIN_QUESTIONS) for (const c of RETAIN_CONFIGS) for (const cell of RETAIN_CELLS) {
    const w = witnessIndex.find((x) => x.question === q && x.configId === c && x.cell === cell);
    if (w) wanted.push(`${w.scheduleA}@${c}`, `${w.scheduleB}@${c}`);
  }
  const sel = selectRetained(wanted);
  const byId = new Map(schedules.map((s) => [s.id, s]));
  const traces = sel.retained.map((ref) => {
    const [sid, cfgId] = ref.split('@');
    const cfg = cfgById[cfgId];
    const events = project(observe(byId.get(sid)).events, cfg.atoms, cfg.idAxis, within);
    assertCap('bytesPerTrace(retained)', canonicalBytes(events).length, OFFLINE_CAPS.bytesPerTrace);
    return { traceRef: ref, scheduleId: sid, configId: cfgId, events, synthetic: true };
  });
  for (const w of witnessIndex) {
    for (const sid of [w.scheduleA, w.scheduleB]) { const ref = `${sid}@${w.configId}`; if (sel.retained.includes(ref)) w.traceRefs.push(ref); }
  }

  const witnesses = { kind: 'g2-diagnostic-collision-witnesses', schemaVersion: 2, synthetic: true, traces, tracesOmitted: sel.omitted };
  const limit = { ...OFFLINE_CAPS };
  const observedBase = {
    ...capObs, retainedNumericSamples: 0, retainedTraces: traces.length, witnessIndexEntries: witnessIndex.length,
    minimalSetsPerKey: maxMinimal, summaryBytes: 0, witnessesBytes: 0, totalOutputBytes: 0,
  };
  for (const k of Object.keys(capObs)) assertCap(k, capObs[k], OFFLINE_CAPS[k]);
  assertCap('retainedTraces', traces.length, OFFLINE_CAPS.retainedTraces);

  const summaryCore = {
    kind: 'g2-diagnostic-sufficiency-summary', schemaVersion: 3, synthetic: true,
    inputHashes: records,
    d2Conformance: { schedules: schedules.length, mismatches: 0, fieldsChecked: [...FIELDS_CHECKED, 'rows(a)', 'decidingRow(b)', 'restoreRow(c)', 'cons/skip/final(d)', 'classCounts', 'mechanismCounts'], rowsChecked },
    atoms: ATOMS,
    questions: QUESTIONS.map((q) => ({ id: q.id, labelDomain: q.labelDomain, definition: q.definition })),
    relevantCounts, labelCounts,
    namedConfigs: NAMED_CONFIGS.map((c) => ({ id: c.id, atoms: c.atoms, idAxis: c.idAxis })),
    sufficiency, minimalSets, necessity, correlator, ablation, witnessIndex,
    interpretationLimits: INTERPRETATION_LIMITS,
    provenance: { d2Dir: D2_DIR_REL, prototypeFiles: PROTOTYPE_FILES },
  };
  const witnessesBytes = canonicalBytes(witnesses);
  const companionDigestSha256 = sha256Hex(witnessesBytes);
  // caps.observed includes the summary's own size: iterate to a fixed point (digest fields have fixed width)
  let observed = { ...observedBase, witnessesBytes: witnessesBytes.length };
  let summary; let summaryBytes;
  for (let iter = 0; iter < 8; iter += 1) {
    const s0 = { ...summaryCore, caps: { observed, limit }, companionDigestSha256 };
    s0.outputDigestSha256 = sha256Hex(canonicalStringify(s0));
    const bytes = canonicalBytes(s0);
    const next = { ...observed, summaryBytes: bytes.length, totalOutputBytes: bytes.length + witnessesBytes.length };
    if (next.summaryBytes === observed.summaryBytes) { summary = s0; summaryBytes = bytes; break; }
    observed = next;
  }
  if (!summary) throw fail('CAP-EXCEEDED', 'summary size did not reach a fixed point');
  assertNoNumericPose(summary); assertNoNumericPose(witnesses);
  const files = { [SUMMARY_FILE]: summaryBytes, [WITNESSES_FILE]: witnessesBytes };
  checkOutputCaps(files, { summary: SUMMARY_FILE, witnesses: WITNESSES_FILE });
  return { summary, witnesses, files };
}

// ---- atomic output writing (empty dir only; never under D2, evidence or acceptance results)
const FORBIDDEN = [D2_DIR, join(REPO, 'docs', 'research', 'evidence'), join(REPO, 'test', 'acceptance', 'results')];
function realish(p) {
  let cur = resolve(p); const tail = [];
  while (!existsSync(cur)) { tail.unshift(basename(cur)); const up = dirname(cur); if (up === cur) break; cur = up; }
  return resolve(realpathSync(cur), ...tail);
}
const under = (p, root) => p === root || p.startsWith(root + sep);
/**
 * Atomic as a UNIT (remediation L-6): all files are written into a sibling staging directory, which is then renamed
 * onto the (absent, or empty and removed) output directory in one rename. A crash leaves either no output directory
 * contents or the complete set, never a summary without its companion. A stale staging directory is refused.
 */
export function writeOutputs(dir, files) {
  const abs = resolve(dir); const real = realish(abs);
  for (const f of FORBIDDEN) if (under(abs, f) || under(real, realish(f))) throw fail('FORBIDDEN-OUTPUT-DIR', `refusing to write under ${f}`);
  if (existsSync(abs) && readdirSync(abs).length > 0) throw fail('OUTPUT-DIR-NOT-EMPTY', `refusing non-empty output dir ${abs}`);
  const stage = join(dirname(abs), `.${basename(abs)}.staging`);
  if (existsSync(stage)) throw fail('OUTPUT-DIR-NOT-EMPTY', `refusing: stale staging directory ${stage}`);
  mkdirSync(dirname(abs), { recursive: true });
  mkdirSync(stage);
  try {
    for (const [name, data] of Object.entries(files)) writeFileSync(join(stage, name), data);
    if (existsSync(abs)) rmdirSync(abs); // empty (checked above)
    renameSync(stage, abs);
  } catch (e) {
    rmSync(stage, { recursive: true, force: true });
    throw e;
  }
}

async function main(argv) {
  const i = argv.indexOf('--out');
  if (i < 0 || !argv[i + 1]) { console.error('usage: run-diagnostic.mjs --out <empty-dir>'); return 2; }
  try {
    const res = await runDiagnostic();
    writeOutputs(argv[i + 1], res.files);
    console.log(`schedules=${res.summary.d2Conformance.schedules} rowsChecked=${res.summary.d2Conformance.rowsChecked} witnessIndex=${res.summary.witnessIndex.length} traces=${res.witnesses.traces.length}`);
    console.log(`bytes=${JSON.stringify({ [SUMMARY_FILE]: res.files[SUMMARY_FILE].length, [WITNESSES_FILE]: res.files[WITNESSES_FILE].length })}`);
    console.log(`outputDigestSha256=${res.summary.outputDigestSha256}`);
    console.log(`companionDigestSha256=${res.summary.companionDigestSha256}`);
    return 0;
  } catch (e) {
    console.error(`${e.code || 'ERROR'}: ${e.message}`);
    return e.exitCode ?? 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then((c) => { process.exitCode = c; });
