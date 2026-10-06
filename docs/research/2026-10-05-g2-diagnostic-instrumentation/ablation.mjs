// Exhaustive sound-correlator ablation (spec §8.6 "minimum sufficient diagnostic set", remediation M1).
// [SYN] research tooling only.
//
// Candidate observable set: the 9 searchable atoms x the identity axis = 10 ELEMENTS (bit 0..8 = SEARCH_ATOMS in
// canonical order, bit 9 = ID-ON); the base atoms H-CALL/H-T4 are always present and oracle atoms never are. For EVERY
// configuration mask cm in 0..1023 and BOTH slot windows (OPEN, ASSUME_NO_UNOBSERVED_WRITER) the UNMODIFIED sound
// correlator correlate(project(events, atoms(cm), axis(cm)), {atoms, idAxis, slotWindow}) is run on EVERY relevant
// schedule: 2 x 1,024 = 2,048 configurations, nothing inferred, nothing pruned, no projection is re-encoded by hand.
// The run is split across worker threads by schedule index (ablation-worker.mjs); every merged quantity is a sum or
// a deterministic minimum, so the result is independent of the worker count and of completion order.
import { project, SEARCH_ATOMS, ATOM_INDEX, atomsOfMask } from './project.mjs';
import { correlate, SLOT_WINDOW, VERDICT, CORRELATOR_QUESTIONS } from './correlate.mjs';
import { QUESTIONS, QUESTION_IDS } from './observer.mjs';
import { fail } from './pins.mjs';
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

export const ELEMENTS = [...SEARCH_ATOMS, 'ID-ON'];
export const N_ELEMENTS = ELEMENTS.length; // 10
export const N_CONFIG_MASKS = 1 << N_ELEMENTS; // 1,024
export const ID_BIT = 1 << 9;
export const WINDOWS = [SLOT_WINDOW.OPEN, SLOT_WINDOW.ASSUME];
export const N_CONFIGURATIONS = WINDOWS.length * N_CONFIG_MASKS; // 2,048
const QN = CORRELATOR_QUESTIONS.length; // 3
/** Bounded reason enum (same set as run-diagnostic REASON_RE). */
export const REASONS = [
  'ACTIVE_WITHOUT_VISIBLE_STEP', 'ACTIVE_STATE_UNOBSERVED', 'IDENTITY_AMBIGUOUS', 'UNOBSERVED_SLOT_WINDOW', 'FOREIGN_CANDIDATE',
  'WRITER_RACE', 'NO_BASELINE', 'NO_CAPTURE_BASELINE', 'UNREAD_WRITER', 'UNBRACKETED_CHANGE',
  'OBSERVABLE_ABSENT:V-PEND', 'OBSERVABLE_ABSENT:V-EDGE', 'OBSERVABLE_ABSENT:V-EDGE|P-TC', 'OBSERVABLE_ABSENT:P-TC', 'OBSERVABLE_ABSENT:ID-ON',
  'VB_UNAVAILABLE:VB-0', 'VB_UNAVAILABLE:VB-1', 'VB_UNAVAILABLE:VB-2', 'VB_UNAVAILABLE:VB-3',
];
const RID = new Map(REASONS.map((r, i) => [r, i]));
const NR = REASONS.length;
const SUBJ_DOMAIN = QUESTIONS.find((q) => q.id === 'Q-SUBJ').labelDomain;
const NSUBJ = SUBJ_DOMAIN.length;
const LABEL_DOMAIN = Object.fromEntries(CORRELATOR_QUESTIONS.map((q) => [q, QUESTIONS.find((x) => x.id === q).labelDomain]));
const F_DEF = 0; const F_ASM = 1; const F_AMB = 2; const F_UNAV = 3; const F_WRONG = 4; const NF = 5;
const V_MASK = (1 << ATOM_INDEX['V-PEND']) | (1 << ATOM_INDEX['V-ACT']) | (1 << ATOM_INDEX['V-EDGE']);
const INF_MASK = 1 << ATOM_INDEX['P-CC0'];
const ATOMS_OF = Array.from({ length: 512 }, (_, m) => atomsOfMask(m));

export const configOf = (cm) => ({ atoms: ATOMS_OF[cm & 511], idAxis: cm & ID_BIT ? 'ON' : 'OFF' });
export const elementsOfMask = (cm) => ELEMENTS.filter((_, i) => cm & (1 << i));
export const maskOfElements = (els) => els.reduce((m, e) => m | (1 << ELEMENTS.indexOf(e)), 0);

/** Empty accumulator (plain typed arrays, transferable between threads). */
export function newAccumulator() {
  return {
    schedules: 0,
    counts: new Int32Array(N_CONFIGURATIONS * QN * NF),
    reasons: new Int32Array(N_CONFIGURATIONS * QN * NR),
    nonDefBySubj: new Int32Array(N_CONFIGURATIONS * QN * NSUBJ),
    // verdict influence of each element: per window x element x config-without-element, #schedules whose verdict
    // tuple (status, label/reason, assumption for all 3 questions) differs between cm and cm | element
    influence: new Int32Array(WINDOWS.length * N_ELEMENTS * N_CONFIG_MASKS),
    // the same, restricted to the DEFINITE part of the verdict (definite or not, its label, its assumption flag)
    influenceDefinite: new Int32Array(WINDOWS.length * N_ELEMENTS * N_CONFIG_MASKS),
    // deterministic first witness per window x element: [scheduleOrdinal, cm] minimum, -1 when none
    witness: new Int32Array(WINDOWS.length * N_ELEMENTS * 2).fill(-1),
    witnessDefinite: new Int32Array(WINDOWS.length * N_ELEMENTS * 2).fill(-1),
    // first wrong definite label per configuration x question: [scheduleOrdinal, emitted label index], -1 when none
    wrongWitness: new Int32Array(N_CONFIGURATIONS * QN * 2).fill(-1),
  };
}

/**
 * Runs all 2,048 configurations on one relevant schedule. `truth` = {Q-OWNER, Q-SUBJ, Q-ATTR} labels; `ordinal` is the
 * schedule's index in the D2 enumeration (used only for deterministic witnesses). Throws exit-2 on a malformed
 * projection, a contradiction, a reason outside the bounded enum, or ANY wrong definite label (hard soundness gate).
 */
export function ablateSchedule(events, truth, within, acc, ordinal = 0, sid = '?') {
  const sig = new Int32Array(N_CONFIGURATIONS);
  const dsig = new Int32Array(N_CONFIGURATIONS);
  const subjIdx = SUBJ_DOMAIN.indexOf(truth['Q-SUBJ']);
  if (subjIdx < 0) throw fail('ABLATION', `${sid}: subject label ${truth['Q-SUBJ']} outside domain`);
  for (let cm = 0; cm < N_CONFIG_MASKS; cm += 1) {
    const { atoms, idAxis } = configOf(cm);
    const proj = project(events, atoms, idAxis, within);
    for (let w = 0; w < WINDOWS.length; w += 1) {
      const out = correlate(proj, { atoms, idAxis, slotWindow: WINDOWS[w] });
      if (out.malformed) throw fail('CORRELATOR', `${sid}/ablation cm=${cm}/${WINDOWS[w]}: MALFORMED ${out.malformed} on a projected synthetic trace`);
      if (out.contradiction) throw fail('CORRELATOR', `${sid}/ablation cm=${cm}/${WINDOWS[w]}: ${out.contradiction} on a consistent synthetic trace`);
      const slot = w * N_CONFIG_MASKS + cm;
      let s = 0; let ds = 0;
      for (let qi = 0; qi < QN; qi += 1) {
        const q = CORRELATOR_QUESTIONS[qi];
        const v = out.questions[q];
        const base = (slot * QN + qi) * NF;
        let code;
        if (v.status === VERDICT.DEFINITE) {
          if (v.label !== truth[q]) {
            // counted (never accepted): analyzeAblation fails closed (exit 2) if any configuration has wrong > 0
            acc.counts[base + F_WRONG] += 1;
            const wi = (slot * QN + qi) * 2;
            if (acc.wrongWitness[wi] === -1 || ordinal < acc.wrongWitness[wi]) { acc.wrongWitness[wi] = ordinal; acc.wrongWitness[wi + 1] = LABEL_DOMAIN[q].indexOf(v.label); }
          }
          acc.counts[base + F_DEF] += 1;
          if (v.assumption) acc.counts[base + F_ASM] += 1;
          code = 1 | ((v.assumption ? 1 : 0) << 2) | (LABEL_DOMAIN[q].indexOf(v.label) << 3);
          ds |= (1 + LABEL_DOMAIN[q].indexOf(v.label) + (v.assumption ? 8 : 0)) << (4 * qi);
        } else if (v.status === VERDICT.AMBIGUOUS || v.status === VERDICT.UNAVAILABLE) {
          const r = RID.get(v.reason);
          if (r === undefined) throw fail('CORRELATOR', `${sid}/ablation cm=${cm}/${q}: reason ${v.reason} outside the bounded enum`);
          acc.counts[base + (v.status === VERDICT.AMBIGUOUS ? F_AMB : F_UNAV)] += 1;
          acc.reasons[(slot * QN + qi) * NR + r] += 1;
          acc.nonDefBySubj[(slot * QN + qi) * NSUBJ + subjIdx] += 1;
          code = (v.status === VERDICT.AMBIGUOUS ? 2 : 3) | (r << 3);
        } else throw fail('CORRELATOR', `${sid}/ablation cm=${cm}/${q}: ${v.status}`);
        s |= code << (8 * qi);
      }
      sig[slot] = s; dsig[slot] = ds;
    }
  }
  for (let w = 0; w < WINDOWS.length; w += 1) {
    const o = w * N_CONFIG_MASKS;
    for (let b = 0; b < N_ELEMENTS; b += 1) {
      const bit = 1 << b; const ib = (w * N_ELEMENTS + b) * N_CONFIG_MASKS;
      for (let cm = 0; cm < N_CONFIG_MASKS; cm += 1) {
        if (cm & bit) continue;
        const wi = (w * N_ELEMENTS + b) * 2;
        if (sig[o + cm] !== sig[o + (cm | bit)]) {
          acc.influence[ib + cm] += 1;
          if (acc.witness[wi] === -1 || ordinal < acc.witness[wi] || (ordinal === acc.witness[wi] && cm < acc.witness[wi + 1])) {
            acc.witness[wi] = ordinal; acc.witness[wi + 1] = cm;
          }
        }
        if (dsig[o + cm] !== dsig[o + (cm | bit)]) {
          acc.influenceDefinite[ib + cm] += 1;
          if (acc.witnessDefinite[wi] === -1 || ordinal < acc.witnessDefinite[wi] || (ordinal === acc.witnessDefinite[wi] && cm < acc.witnessDefinite[wi + 1])) {
            acc.witnessDefinite[wi] = ordinal; acc.witnessDefinite[wi + 1] = cm;
          }
        }
      }
    }
  }
  acc.schedules += 1;
}

/** Merges accumulator `b` into `a` (sums; witness = lexicographic minimum of [ordinal, cm]). Order-independent. */
export function mergeAccumulators(a, b) {
  a.schedules += b.schedules;
  for (const k of ['counts', 'reasons', 'nonDefBySubj', 'influence', 'influenceDefinite']) { const x = a[k]; const y = b[k]; for (let i = 0; i < x.length; i += 1) x[i] += y[i]; }
  for (let i = 0; i < a.wrongWitness.length; i += 2) {
    const o2 = b.wrongWitness[i];
    if (o2 !== -1 && (a.wrongWitness[i] === -1 || o2 < a.wrongWitness[i])) { a.wrongWitness[i] = o2; a.wrongWitness[i + 1] = b.wrongWitness[i + 1]; }
  }
  for (const k of ['witness', 'witnessDefinite']) {
    const x = a[k]; const y = b[k];
    for (let i = 0; i < x.length; i += 2) {
      const o2 = y[i]; const c2 = y[i + 1];
      if (o2 === -1) continue;
      if (x[i] === -1 || o2 < x[i] || (o2 === x[i] && c2 < x[i + 1])) { x[i] = o2; x[i + 1] = c2; }
    }
  }
  return a;
}

const popcount = (m) => { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; };
const idxList = (m, n) => Array.from({ length: n }, (_, i) => i).filter((i) => m & (1 << i));

/** Deterministic order (spec §8.6): fewest elements, fewest V-* atoms, lexicographically smallest element-index array. */
export function compareConfigMasks(a, b) {
  const pa = popcount(a); const pb = popcount(b);
  if (pa !== pb) return pa - pb;
  const va = popcount(a & V_MASK); const vb = popcount(b & V_MASK);
  if (va !== vb) return va - vb;
  const ia = idxList(a, N_ELEMENTS); const ib = idxList(b, N_ELEMENTS);
  for (let i = 0; i < ia.length; i += 1) if (ia[i] !== ib[i]) return ia[i] - ib[i];
  return 0;
}

/**
 * Minimal / minimum extraction over a full 2^n satisfying table (no pruning, no monotonicity assumption).
 * Returns { minimal (irreducible: satisfying with no satisfying proper subset, sorted), minimum (minimal sets of the
 * smallest cardinality), minimumCardinality, unique (exactly one minimum), canonical (first non-INF minimum by the
 * tie-break, or null), canonicalIncludingInf, coMinimal (minimum sets other than canonical), irreducibleNotMinimum,
 * singleRemovalIrreducible (satisfying sets where removing any ONE element breaks the target), monotonicityViolations,
 * satisfyingCount, subsetsEvaluated }.
 */
export function extractMinimum(suff, nBits = N_ELEMENTS, compare = compareConfigMasks, infMask = INF_MASK) {
  const N = 1 << nBits;
  if (suff.length !== N) throw new Error(`satisfying table must have ${N} entries`);
  const minimal = []; const singleRemoval = []; let satisfyingCount = 0; let viol = 0;
  for (let m = 0; m < N; m += 1) {
    if (!suff[m]) {
      for (let sub = (m - 1) & m; ; sub = (sub - 1) & m) { if (sub !== m && suff[sub]) viol += 1; if (sub === 0) break; }
      continue;
    }
    satisfyingCount += 1;
    let isMin = true;
    for (let sub = (m - 1) & m; ; sub = (sub - 1) & m) { if (sub !== m && suff[sub]) { isMin = false; break; } if (sub === 0) break; }
    if (isMin) minimal.push(m);
    let single = true;
    for (let b = 0; b < nBits; b += 1) if ((m & (1 << b)) && suff[m & ~(1 << b)]) { single = false; break; }
    if (single) singleRemoval.push(m);
  }
  minimal.sort(compare); singleRemoval.sort(compare);
  const k = minimal.length ? Math.min(...minimal.map(popcount)) : null;
  const minimum = minimal.filter((m) => popcount(m) === k);
  const canonical = minimum.find((m) => !(m & infMask));
  const canonicalOrInf = minimum.length ? minimum[0] : null;
  const canon = canonical === undefined ? null : canonical;
  return {
    status: minimal.length ? 'SATISFYING_SETS_FOUND' : 'NO_SATISFYING_SET',
    minimal, minimum, minimumCardinality: k, unique: minimum.length === 1,
    canonical: canon, canonicalIncludingInf: canonOrNull(canonicalOrInf),
    coMinimal: minimum.filter((m) => m !== canon),
    irreducibleNotMinimum: minimal.filter((m) => popcount(m) !== k),
    singleRemovalIrreducible: singleRemoval,
    monotonicityViolations: viol, satisfyingCount, subsetsEvaluated: N,
  };
}
const canonOrNull = (x) => (x === undefined ? null : x);

const W_KEY = ['OPEN', 'ASSUME'];
/** Per (window, cm) outcome object (deterministic key order). */
function outcomeOf(acc, w, cm) {
  const slot = w * N_CONFIG_MASKS + cm; const o = {};
  CORRELATOR_QUESTIONS.forEach((q, qi) => {
    const base = (slot * QN + qi) * NF; const reasons = {}; const bySubj = {};
    REASONS.forEach((r, ri) => { const n = acc.reasons[(slot * QN + qi) * NR + ri]; if (n) reasons[r] = n; });
    SUBJ_DOMAIN.forEach((l, li) => { const n = acc.nonDefBySubj[(slot * QN + qi) * NSUBJ + li]; if (n) bySubj[l] = n; });
    o[q] = {
      definite: acc.counts[base + F_DEF], definiteAssuming: acc.counts[base + F_ASM], ambiguous: acc.counts[base + F_AMB],
      unavailable: acc.counts[base + F_UNAV], wrong: acc.counts[base + F_WRONG], reasons, nonDefiniteBySubjectTruth: bySubj,
    };
  });
  return o;
}
const defOf = (acc, w, cm, qi) => acc.counts[((w * N_CONFIG_MASKS + cm) * QN + qi) * NF + F_DEF];
const perWindowDefinite = (acc, cm) => Object.fromEntries(W_KEY.map((wk, w) => [wk, Object.fromEntries(CORRELATOR_QUESTIONS.map((q, qi) => [q, defOf(acc, w, cm, qi)]))]));
const NO_SOUND = QUESTION_IDS.filter((q) => !CORRELATOR_QUESTIONS.includes(q));

/** 13-question coverage of one configuration mask, per window. */
export function questionCoverage(acc, cm, relevant) {
  const r = {};
  W_KEY.forEach((wk, w) => {
    const answered = []; const fully = []; const unresolved = {};
    for (const q of QUESTION_IDS) {
      const qi = CORRELATOR_QUESTIONS.indexOf(q);
      if (qi < 0) { unresolved[q] = 'NO_SOUND_PROCEDURE'; continue; }
      const d = defOf(acc, w, cm, qi);
      if (d >= 1) answered.push(q); else unresolved[q] = 'SOUND_PROCEDURE_ZERO_DEFINITE';
      if (d === relevant) fully.push(q);
    }
    r[wk] = { answered, answeredCount: answered.length, fullyAnswered: fully, fullyAnsweredCount: fully.length, unresolved };
  });
  return r;
}

/**
 * Builds the summary `ablation` section from a merged accumulator. `relevant` = number of relevant schedules.
 * Objective (spec §8.6): cm SATISFIES iff, in BOTH windows, definite(Q) >= definite_full(Q) for Q-OWNER, Q-SUBJ,
 * Q-ATTR with zero wrong labels, where full = all 9 atoms + ID-ON (cm 1023).
 */
export function unsoundConfigurations(acc, idOfOrdinal = (o) => o) {
  const out = [];
  W_KEY.forEach((wk, w) => {
    for (let cm = 0; cm < N_CONFIG_MASKS; cm += 1) {
      const slot = w * N_CONFIG_MASKS + cm; const wrong = {}; const firstWitness = {};
      CORRELATOR_QUESTIONS.forEach((q, qi) => {
        const n = acc.counts[(slot * QN + qi) * NF + F_WRONG];
        if (!n) return;
        const wi = (slot * QN + qi) * 2;
        wrong[q] = n; firstWitness[q] = { schedule: idOfOrdinal(acc.wrongWitness[wi]), emitted: LABEL_DOMAIN[q][acc.wrongWitness[wi + 1]] };
      });
      if (Object.keys(wrong).length) out.push({ window: wk, mask: cm, elements: elementsOfMask(cm), wrong, firstWitness });
    }
  });
  return out;
}

const wrongOf = (acc, w, cm) => CORRELATOR_QUESTIONS.reduce((a, _, qi) => a + acc.counts[((w * N_CONFIG_MASKS + cm) * QN + qi) * NF + F_WRONG], 0);

export function analyzeAblation(acc, relevant, idOfOrdinal = (o) => o, { failOnWrong = true } = {}) {
  if (acc.schedules !== relevant) throw fail('ABLATION', `ablated ${acc.schedules} schedules, expected ${relevant}`);
  const unsound = unsoundConfigurations(acc, idOfOrdinal);
  if (failOnWrong && unsound.length) {
    const u = unsound[0]; const q = Object.keys(u.wrong)[0];
    throw fail('CORRELATOR-SOUNDNESS', `${unsound.length} of ${N_CONFIGURATIONS} ablation configurations emit a wrong definite label; first: ${u.window} [${u.elements.join(',')}] ${q} wrong=${u.wrong[q]} (e.g. ${u.firstWitness[q].schedule} emitted ${u.firstWitness[q].emitted})`);
  }
  const FULL = N_CONFIG_MASKS - 1;
  const target = perWindowDefinite(acc, FULL);
  if (wrongOf(acc, 0, FULL) || wrongOf(acc, 1, FULL)) throw fail('CORRELATOR-SOUNDNESS', 'the full (target) configuration emits a wrong label');
  const satisfies = (cm) => W_KEY.every((wk, w) => wrongOf(acc, w, cm) === 0 && CORRELATOR_QUESTIONS.every((q, qi) => defOf(acc, w, cm, qi) >= target[wk][q]));
  const suff = Array.from({ length: N_CONFIG_MASKS }, (_, cm) => satisfies(cm));
  const ex = extractMinimum(suff);
  const deficit = (cm) => Object.fromEntries(W_KEY.map((wk, w) => [wk, Object.fromEntries(CORRELATOR_QUESTIONS.map((q, qi) => [q, defOf(acc, w, cm, qi) - target[wk][q]]))]));
  const removal = (cm) => elementsOfMask(cm).map((e) => {
    const r = cm & ~(1 << ELEMENTS.indexOf(e));
    return { element: e, remainingMask: r, satisfies: suff[r], definite: perWindowDefinite(acc, r), deltaVsTarget: deficit(r) };
  });
  const setInfo = (cm) => ({ mask: cm, elements: elementsOfMask(cm) });

  // outcome table: distinct per-(window, cm) outcomes, in order of first appearance (window-major, cm ascending)
  const outcomes = []; const outIdx = new Map(); const outcomeIndex = {};
  W_KEY.forEach((wk, w) => {
    outcomeIndex[wk] = [];
    for (let cm = 0; cm < N_CONFIG_MASKS; cm += 1) {
      const o = outcomeOf(acc, w, cm); const key = JSON.stringify(o);
      if (!outIdx.has(key)) { outIdx.set(key, outcomes.length); outcomes.push(o); }
      outcomeIndex[wk].push(outIdx.get(key));
    }
  });

  // max definite over a family of configuration masks, and how many masks reach it
  const family = (pred) => {
    const ms = Array.from({ length: N_CONFIG_MASKS }, (_, cm) => cm).filter(pred);
    const maxDefinite = {}; const achievedBy = {}; const canonicalAchiever = {};
    W_KEY.forEach((wk, w) => {
      maxDefinite[wk] = {}; achievedBy[wk] = {}; canonicalAchiever[wk] = {};
      CORRELATOR_QUESTIONS.forEach((q, qi) => {
        const mx = Math.max(...ms.map((cm) => defOf(acc, w, cm, qi)));
        const ach = ms.filter((cm) => defOf(acc, w, cm, qi) === mx).sort(compareConfigMasks);
        maxDefinite[wk][q] = mx; achievedBy[wk][q] = ach.length; canonicalAchiever[wk][q] = elementsOfMask(ach[0]);
      });
    });
    return { configMasksEvaluated: ms.length, configurationsEvaluated: ms.length * WINDOWS.length, maxDefinite, achievedByCount: achievedBy, smallestAchiever: canonicalAchiever };
  };

  const OLD = maskOfElements(['P-FRM', 'P-XS', 'P-TC', 'V-PEND', 'V-EDGE', 'ID-ON']);
  // verdict influence of each element over all 512 (cm, cm | element) pairs, per window; `atCanonical` is the pair
  // through the canonical minimum (canonical \ {e} vs canonical, or canonical vs canonical U {e})
  const canonPair = ex.canonical === null ? null : (b) => ex.canonical & ~(1 << b);
  const influence = {};
  ELEMENTS.forEach((e, b) => {
    influence[e] = {};
    W_KEY.forEach((wk, w) => {
      const ib = (w * N_ELEMENTS + b) * N_CONFIG_MASKS; const wi = (w * N_ELEMENTS + b) * 2;
      const part = (arr, wit) => {
        let pairs = 0; let changes = 0; let aPairs = 0; let aChanged = 0; let aChanges = 0;
        const floor = canonPair === null ? 0 : canonPair(b);
        for (let cm = 0; cm < N_CONFIG_MASKS; cm += 1) {
          if (cm & (1 << b)) continue;
          const n = arr[ib + cm];
          if (n) { pairs += 1; changes += n; }
          if (canonPair !== null && (cm & floor) === floor) { aPairs += 1; if (n) { aChanged += 1; aChanges += n; } }
        }
        return {
          configPairsChanged: pairs, scheduleChanges: changes,
          atCanonical: canonPair === null ? null : arr[ib + canonPair(b)],
          // pairs whose smaller side already contains canonical \ {e}: does e matter once the minimum is present?
          aboveCanonical: canonPair === null ? null : { configPairs: aPairs, configPairsChanged: aChanged, scheduleChanges: aChanges },
          firstWitness: wit[wi] === -1 ? null : { schedule: idOfOrdinal(wit[wi]), elementsWithout: elementsOfMask(wit[wi + 1]) },
        };
      };
      influence[e][wk] = { configPairs: N_CONFIG_MASKS / 2, anyVerdict: part(acc.influence, acc.witness), definiteVerdict: part(acc.influenceDefinite, acc.witnessDefinite) };
    });
  });

  return {
    exhaustive: true,
    unsoundConfigurations: unsound,
    elements: ELEMENTS,
    windows: WINDOWS,
    configMasks: N_CONFIG_MASKS,
    configurationsEvaluated: N_CONFIGURATIONS,
    schedulesPerConfiguration: relevant,
    correlatorEvaluations: N_CONFIGURATIONS * relevant,
    objective: 'cm satisfies iff in BOTH windows definite(Q) >= definite(full) for Q-OWNER, Q-SUBJ and Q-ATTR with wrong = 0; full = 9 atoms + ID-ON; base H-CALL, H-T4 always present',
    target: { ...setInfo(FULL), definite: target },
    // satisfying table as a 256-hex-char bitmap: hex digit k holds masks 4k..4k+3, bit (cm & 3) set iff cm satisfies
    // (a bitmap, not an integer list: a 32-entry numeric array would trip the numeric-camera-sample output guard)
    satisfyingBitmapHex: Array.from({ length: N_CONFIG_MASKS / 4 }, (_, k) => [0, 1, 2, 3].reduce((v, j) => v | (suff[4 * k + j] ? 1 << j : 0), 0).toString(16)).join(''),
    lattice: {
      status: ex.status, satisfyingCount: ex.satisfyingCount, subsetsEvaluated: ex.subsetsEvaluated, monotonicityViolations: ex.monotonicityViolations,
      minimal: ex.minimal.map(setInfo), minimumCardinality: ex.minimumCardinality, minimum: ex.minimum.map(setInfo), unique: ex.unique,
      singleRemovalIrreducible: ex.singleRemovalIrreducible.map(setInfo),
    },
    canonical: ex.canonical === null ? null : {
      ...setInfo(ex.canonical), tieBreak: 'fewest elements, then fewest V-* atoms, then lexicographically smallest element-index array; P-CC0 sets excluded',
      definite: perWindowDefinite(acc, ex.canonical), necessity: removal(ex.canonical),
    },
    canonicalIncludingInf: ex.canonicalIncludingInf === null ? null : setInfo(ex.canonicalIncludingInf),
    coMinimal: ex.coMinimal.map(setInfo),
    // single-window objectives (same rule, one window only): shows which alternatives the two-window target excludes
    windowOnly: Object.fromEntries(W_KEY.map((wk, w) => {
      const sw = (cm) => wrongOf(acc, w, cm) === 0 && CORRELATOR_QUESTIONS.every((q, qi) => defOf(acc, w, cm, qi) >= target[wk][q]);
      const e1 = extractMinimum(Array.from({ length: N_CONFIG_MASKS }, (_, cm) => sw(cm)));
      return [wk, {
        satisfyingCount: e1.satisfyingCount, monotonicityViolations: e1.monotonicityViolations, minimumCardinality: e1.minimumCardinality,
        minimum: e1.minimum.map(setInfo), unique: e1.unique, canonical: e1.canonical === null ? null : setInfo(e1.canonical),
        coMinimal: e1.coMinimal.map(setInfo), irreducibleNotMinimum: e1.irreducibleNotMinimum.map(setInfo),
      }];
    })),
    oldBundle: { ...setInfo(OLD), satisfies: suff[OLD], definite: perWindowDefinite(acc, OLD), singleRemoval: removal(OLD) },
    allConfigurations: family(() => true),
    publicOnly: family((cm) => !(cm & V_MASK)),
    idOff: family((cm) => !(cm & ID_BIT)),
    influence,
    questionCoverage: {
      definition: 'answered = the sound correlator emits >= 1 definite label for the question over the relevant schedules; fully answered = definite == relevant; the other 10 questions have no sound procedure (spec section 6.3 C1) and are procedure-limited, not atom-limited',
      noSoundProcedure: NO_SOUND,
      canonical: ex.canonical === null ? null : questionCoverage(acc, ex.canonical, relevant),
      full: questionCoverage(acc, FULL, relevant),
    },
    outcomes,
    outcomeIndex,
  };
}

/**
 * Starts the exhaustive ablation on `nWorkers` worker threads (default: availableParallelism - 1, clamped to 1..8).
 * Returns { promise, terminate }. The promise resolves to { acc, relevantByCell } (merged) or rejects with the first
 * worker's exit-2 error. The result does not depend on nWorkers (sums and deterministic minima only).
 */
export function startAblation({ loadOpts = {}, records, nWorkers } = {}) {
  const n = nWorkers ?? Math.max(1, Math.min(8, availableParallelism() - 1));
  const opts = {}; if (loadOpts.paths) opts.paths = loadOpts.paths; if (loadOpts.expected) opts.expected = loadOpts.expected;
  const workers = [];
  const parts = [];
  for (let k = 0; k < n; k += 1) {
    const w = new Worker(new URL('./ablation-worker.mjs', import.meta.url), { workerData: { k, n, loadOpts: opts, records } });
    workers.push(w);
    parts.push(new Promise((res, rej) => {
      let done = false;
      w.once('message', (m) => { done = true; if (m.error) rej(fail(m.error.code === 'ERROR' ? 'ABLATION' : m.error.code.replace(/^.*?:\s*/, ''), m.error.message.replace(/^[A-Z0-9-]+: /, ''))); else res(m); });
      w.once('error', (e) => { done = true; rej(fail('ABLATION', `worker ${k}: ${e.message}`)); });
      w.once('exit', (c) => { if (!done) rej(fail('ABLATION', `worker ${k} exited with code ${c} before reporting`)); });
    }));
  }
  const terminate = () => { for (const w of workers) w.terminate(); };
  const promise = Promise.all(parts).then((ms) => {
    const acc = newAccumulator(); const relevantByCell = {};
    for (const m of ms) {
      mergeAccumulators(acc, m.acc);
      for (const [c, v] of Object.entries(m.relevantByCell)) relevantByCell[c] = (relevantByCell[c] || 0) + v;
    }
    return { acc, relevantByCell };
  }, (e) => { terminate(); throw e; });
  promise.catch(() => {}); // the caller awaits it; avoid an unhandled rejection if the caller failed first
  return { promise, terminate };
}

/** Decodes `satisfyingBitmapHex` back to the list of satisfying configuration masks (ascending). */
export function decodeSatisfying(hex) {
  const out = [];
  for (let k = 0; k < hex.length; k += 1) { const v = parseInt(hex[k], 16); for (let j = 0; j < 4; j += 1) if (v & (1 << j)) out.push(4 * k + j); }
  return out;
}
