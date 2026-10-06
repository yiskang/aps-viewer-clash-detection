// Verdict model: every fixture -> expected verdict, decision-table precedence, capability gate, pre-motion and
// pending-clear gap handling, edgeInit, zero-sample timeout, superseded C8, > 64 samples, and adversarial checks
// that no ambiguous trace is ever SUPPORTED/REJECTED. [SYN] research-local tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from './contract-loader.mjs';
import { parseJsonl, reseal } from './envelope.mjs';
import { generateFixtures, scenarioFromFiles, removeData } from './fixtures-gen.mjs';
import {
  evaluateScenario, auditResult, auditRaw, auditInputs, targetVerdict, worst, VERDICTS, projectTarget, preMotion, gaps, validateTargetPlan, targetWindow,
  targetPlanDigest, planConformance, derivePlanBounds, tokenReappearance,
} from './verdict.mjs';
import { TARGET_PLANS } from './fixtures-gen.mjs';
import { runNegativeControlMatrix } from './controls.mjs';

const contract = loadContract();
const { files, scenarios } = generateFixtures(contract);
const load = (id) => scenarioFromFiles(files, id, { parseJsonl });
const evalId = (id) => evaluateScenario(load(id), { contract });
const clone = (v) => JSON.parse(JSON.stringify(v));
const POS = new Set(['SUPPORTED', 'REJECTED']);

test('verdict classification: every fixture yields its expected run verdict, codes and reasons; the audit is clean', () => {
  const entries = scenarios.map((s) => ({ id: s.id, expected: s.expected, observed: evalId(s.id) }));
  const m = runNegativeControlMatrix(entries);
  assert.deepEqual(m.findings, []);
  for (const e of entries) assert.deepEqual(auditResult(e.observed, load(e.id)), [], e.id);
  for (const s of scenarios) if (s.ambiguous) assert.ok(!POS.has(evalId(s.id).runVerdict), `${s.id} ambiguous but positive`);
  const all = new Set(entries.map((e) => e.observed.runVerdict));
  for (const v of VERDICTS) assert.ok(all.has(v), `no fixture exercises ${v}`);
  // the prompt §19 list is covered
  const items = new Set(scenarios.flatMap((s) => s.promptItems));
  for (const it of ['valid complete trace', 'wrong Viewer version', 'wrong Viewer digest', 'missing VB-1', 'missing VB-3', 'missing request ID', 'pre-motion ambiguity', 'pending-clear/active-edge gap', 'control failure', 'truncated trace', 'overflow trace', 'META/data/END mismatch', 'stream digest mismatch', 'inconclusive C8 case']) assert.ok(items.has(it), it);
});

test('verdict: total precedence BLOCKED > INVALID > INCONCLUSIVE > REJECTED > SUPPORTED', () => {
  assert.deepEqual(VERDICTS, contract.verdictTable.precedence);
  assert.equal(worst('SUPPORTED', 'REJECTED'), 'REJECTED');
  assert.equal(worst('REJECTED', 'INCONCLUSIVE', 'SUPPORTED'), 'INCONCLUSIVE');
  assert.equal(worst('INCONCLUSIVE', 'INVALID'), 'INVALID');
  assert.equal(worst('INVALID', 'BLOCKED', 'SUPPORTED'), 'BLOCKED');
  // run level: a blocked attempt is BLOCKED even with a perfect trace; a consumed attempt with an integrity failure is INVALID
  const sc = load('valid-complete');
  assert.equal(evaluateScenario({ ...sc, attemptConsumed: false, stop: { id: 'SC-A10', class: 'a' } }, { contract }).runVerdict, 'BLOCKED');
  assert.equal(evaluateScenario({ ...sc, stop: { id: 'SC-B05', class: 'b' } }, { contract }).runVerdict, 'INVALID');
  assert.equal(evaluateScenario({ ...sc, ncRerunOk: false }, { contract }).runVerdict, 'INVALID');
  assert.equal(evaluateScenario({ ...sc, ledgerOk: false }, { contract }).runVerdict, 'INVALID');
  assert.equal(evaluateScenario({ ...sc, stop: { id: 'SC-A01', class: 'a' } }, { contract }).runVerdict, 'INVALID', 'class-a stop after consumption is inconsistent -> fail closed');
  const c3 = evaluateScenario({ ...sc, stop: { id: 'SC-C03', class: 'c' } }, { contract });
  assert.equal(c3.verdictWithheld, true);
});

test('verdict: target rules T0–T6, first match wins; ambiguous statuses never reach T4/T5', () => {
  const t = { targetId: 'x', questionId: 'Q-SUBJ', primary: true, supportLabels: ['PENDING'], rejectLabels: ['COMPLETE'] };
  const ctx = { runVerdict: null, cg: 0, preMotionUnresolved: false, slotWindow: 'OPEN', edgeInit: 'LOW', rg: true, forbiddenLabels: contract.verdictTable.forbiddenLabels, renameReason: (r) => r };
  const D = (label, extra = {}) => ({ status: 'DEFINITE', label, ...extra });
  assert.equal(targetVerdict(t, D('PENDING'), ctx).verdict, 'SUPPORTED');
  assert.equal(targetVerdict(t, D('COMPLETE'), ctx).verdict, 'REJECTED');
  assert.equal(targetVerdict(t, D('ACTIVE_PLUS'), ctx).reason, 'LABEL_NOT_PREREGISTERED');
  for (const status of ['AMBIGUOUS', 'UNAVAILABLE', 'UNDIAGNOSABLE']) {
    for (const label of ['PENDING', 'COMPLETE', undefined]) {
      const r = targetVerdict(t, { status, label, reason: 'R' }, ctx);
      assert.equal(r.verdict, 'INCONCLUSIVE', `${status}/${label}`);
    }
  }
  assert.equal(targetVerdict(t, null, ctx).verdict, 'INCONCLUSIVE');
  assert.equal(targetVerdict(t, D('PENDING'), { ...ctx, runVerdict: 'INVALID' }).verdict, 'INVALID');
  assert.equal(targetVerdict(t, D('PENDING'), { ...ctx, runVerdict: 'BLOCKED' }).verdict, 'BLOCKED');
  assert.equal(targetVerdict(t, D('PENDING'), { ...ctx, cg: 1 }).reason, 'CLASS_NONTRANSITIVE');
  assert.equal(targetVerdict(t, D('COMPLETE', { assumption: 'NO_UNOBSERVED_WRITER' }), ctx).reason, 'ASSUMPTION_NOT_AUTHORIZED');
  assert.equal(targetVerdict(t, D('COMPLETE', { assumption: 'NO_UNOBSERVED_WRITER' }), { ...ctx, slotWindow: 'ASSUME_NO_UNOBSERVED_WRITER' }).verdict, 'REJECTED');
  assert.equal(targetVerdict(t, D('PENDING'), { ...ctx, edgeInit: 'UNKNOWN' }).reason, 'EDGE_INIT_UNKNOWN');
  assert.equal(targetVerdict(t, D('PENDING'), { ...ctx, rg: false }).reason, 'VB3_NOT_REPRESENTATIVE');
  const owner = { ...t, questionId: 'Q-OWNER', supportLabels: ['RESTORE'], rejectLabels: ['INIT'] };
  assert.equal(targetVerdict(owner, D('RESTORE'), { ...ctx, preMotionUnresolved: true }).reason, 'PRE_MOTION_UNRESOLVED');
  assert.equal(targetVerdict(t, D('PENDING'), { ...ctx, preMotionUnresolved: true }).verdict, 'SUPPORTED', 'a DEFINITE PENDING read survives pre-motion (Part 1 §9.5)');
  // the forbidden labels and the empty attribution are never evidence
  assert.equal(targetVerdict({ ...t, supportLabels: ['ACTIVE0'] }, D('ACTIVE0'), ctx).verdict, 'INCONCLUSIVE');
  const attr = { ...t, questionId: 'Q-ATTR', supportLabels: ['1'], rejectLabels: [] };
  assert.equal(targetVerdict(attr, D('-'), ctx).verdict, 'INCONCLUSIVE');
});

test('verdict: target-plan validation (Part 2 §14.2) — unsound questions, overlaps, forbidden and unreachable labels', () => {
  const ok = validateTargetPlan(load('valid-complete').targetPlan, { contract, slotWindow: 'OPEN' });
  assert.equal(ok.ok, true); assert.equal(ok.targets[0].oneSided, true);
  const P = (targets) => validateTargetPlan({ targets }, { contract, slotWindow: 'OPEN' });
  const base = { targetId: 'a', questionId: 'Q-SUBJ', primary: true, supportLabels: ['PENDING'], rejectLabels: [] };
  assert.ok(P([{ ...base, questionId: 'Q-STALE' }]).findings.some((f) => f.startsWith('UNSOUND-QUESTION')));
  assert.ok(P([{ ...base, rejectLabels: ['PENDING'] }]).findings.some((f) => f.startsWith('LABEL-OVERLAP')));
  assert.ok(P([{ ...base, supportLabels: ['ACTIVE0'] }]).findings.some((f) => f.startsWith('LABEL-OUT-OF-DOMAIN')));
  assert.ok(P([{ ...base, questionId: 'Q-ATTR', supportLabels: ['-'] }]).findings.some((f) => f.startsWith('LABEL-OUT-OF-DOMAIN')));
  assert.ok(P([{ ...base, questionId: 'Q-ATTR', supportLabels: ['1,2'] }]).findings.some((f) => f.startsWith('UNREACHABLE')), 'Q-ATTR unreachable under OPEN');
  assert.ok(P([{ ...base, primary: false }]).findings.includes('NO-PRIMARY-TARGET'));
  const sc = load('valid-complete');
  assert.equal(evaluateScenario({ ...sc, targetPlan: { targets: [{ ...base, questionId: 'Q-STALE' }] } }, { contract }).runVerdict, 'INVALID');
});

test('capability gate: VB-0, structural VB rows and the PC-3 behavioural row control which V-* atoms reach the correlator', () => {
  const vb1 = evalId('missing-vb1');
  assert.ok(!vb1.correlation.atoms.includes('V-PEND')); assert.ok(vb1.correlation.atoms.includes('V-EDGE'));
  assert.deepEqual(vb1.correlation.vbUnavailable, ['VB-1']);
  const vb3 = evalId('missing-vb3');
  assert.ok(!vb3.correlation.atoms.includes('V-EDGE')); assert.equal(vb3.controls['PC-3'], 'FAILED'); assert.equal(vb3.controls.RG, false);
  // END.pc claims VB-3 = 1 but the PC-3 pattern is not confirmed -> the guard still disables V-EDGE (fail closed)
  const sc = load('valid-complete');
  const T = clone(sc.traces.T); const d = T.slice(1, -1);
  const fall = d.findLastIndex((r) => r.k === 'TE' && r.ev === 0);
  const noFall = removeData(T, fall); // the PC-3 fall in the control window; CT still records PASSED, END.pc = 1
  const res = evaluateScenario({ ...sc, traces: { ...sc.traces, T: noFall } }, { contract });
  assert.equal(res.integrity.T.ok, true);
  assert.equal(res.controls['PC-3'], 'FAILED'); assert.ok(!res.correlation.atoms.includes('V-EDGE'));
  assert.equal(res.runVerdict, 'INCONCLUSIVE');
  for (const id of ['wrong-viewer-version', 'wrong-viewer-digest', 'wrong-viewer-version-claims-vb0', 'wrong-viewer-digest-claims-vb0', 'request-tagging-off']) assert.equal(evalId(id).runVerdict, 'INVALID', id);
});

test('pre-motion: PRE_MOTION predicate (Part 1 §9.2) and fail-closed handling', () => {
  const pm = evalId('pre-motion-ambiguity');
  assert.equal(pm.annotations.preMotionUnresolved, true);
  const subj = pm.targets.find((t) => t.questionId === 'Q-SUBJ'); const own = pm.targets.find((t) => t.questionId === 'Q-OWNER');
  assert.notEqual(subj.status, 'DEFINITE'); assert.ok(subj.allReasons.includes('PRE_MOTION_UNRESOLVED'));
  assert.equal(own.verdict, 'INCONCLUSIVE'); assert.ok(own.allReasons.includes('PRE_MOTION_UNRESOLVED'));
  assert.equal(pm.runVerdict, 'INCONCLUSIVE');
  for (const id of ['valid-complete', 'pending-clear-active-edge-gap', 't4-more-than-64-samples-then-settled']) assert.equal(evalId(id).annotations.preMotionUnresolved, false, id);
  // unit: a restore OK inside (E, D] or a visible step breaks the predicate; no rise -> false
  const recs = (xs) => xs.map((r, i) => ({ q: i + 1, ...r }));
  const W = recs([{ k: 'FS', cl: 0 }, { k: 'TE', ev: 1 }, { k: 'FS', cl: 0 }, { k: 'T4', tp: 'sample', s: 'S', cl: 0 }, { k: 'T4', tp: 'decision', fr: 1, ss: 4 }]);
  assert.equal(preMotion(W).preMotion, true);
  assert.equal(preMotion(W.map((r) => (r.q === 3 ? { ...r, cl: 1 } : r))).preMotion, false);
  assert.equal(preMotion([...W.slice(0, 2), { q: 3, k: 'RS', pp: 'post', rs: 'OK', cl: 0 }, ...W.slice(3)]).preMotion, false);
  assert.equal(preMotion(W.filter((r) => r.k !== 'TE')).preMotion, false);
  assert.equal(preMotion([{ q: 1, k: 'TE', ev: 1 }, { q: 2, k: 'T4', tp: 'sample', cl: 0 }, { q: 3, k: 'T4', tp: 'decision', fr: 1, ss: 2 }]).preMotion, false, 'no baseline before E');
});

test('pending-clear gap: GAP classes (Part 1 §10.2), never an inferred token, never positive evidence', () => {
  const g = evalId('pending-clear-active-edge-gap');
  assert.ok(g.annotations.gapClasses.includes('CONSUME_EDGE_BOUND')); assert.equal(g.annotations.gapIntersectsSubjectWindow, true);
  for (const x of g.annotations.gaps) assert.equal(x.inferredToken, null);
  assert.equal(g.runVerdict, 'INCONCLUSIVE');
  assert.equal(g.targets.find((t) => t.questionId === 'Q-SUBJ').questionReason, 'UNOBSERVED_SLOT_WINDOW');
  const c = evalId('gap-clear-without-edge');
  assert.ok(c.annotations.gapClasses.includes('CLEAR_WITHOUT_EDGE'));
  assert.equal(c.targets.find((t) => t.questionId === 'Q-SUBJ').questionReason, 'IDENTITY_AMBIGUOUS');
  const u = evalId('ambiguous-ownership-foreign-write');
  assert.equal(u.targets.find((t) => t.questionId === 'Q-SUBJ').questionReason, 'IDENTITY_AMBIGUOUS');
  // unit: edge after an empty slot; ASSUME annotates an assumed token but OPEN never does
  const W = [{ q: 1, k: 'PS', sp: 0 }, { q: 2, k: 'TE', ev: 1 }, { q: 3, k: 'PS', sp: 1, sb: 4 }, { q: 4, k: 'TE', ev: 1 }];
  assert.deepEqual(gaps(W, { slotWindow: 'OPEN' }).map((x) => x.gapClass), ['EDGE_AFTER_EMPTY', 'CONSUME_EDGE_BOUND']);
  assert.equal(gaps(W, { slotWindow: 'OPEN' })[1].assumedToken, undefined);
  assert.equal(gaps(W, { slotWindow: 'ASSUME_NO_UNOBSERVED_WRITER' })[1].assumedToken, 4);
});

test('edgeInit UNKNOWN drops V-EDGE (Part 1 §8.4): every edge-dependent target INCONCLUSIVE, never positive', () => {
  for (const id of ['edge-init-already-high-at-listener-registration', 'edge-init-rise-before-target-start', 'edge-init-listeners-late']) {
    const r = evalId(id);
    assert.equal(r.runVerdict, 'INCONCLUSIVE', id); assert.ok(!r.correlation.atoms.includes('V-EDGE'));
    for (const t of r.targets) { assert.equal(t.verdict, 'INCONCLUSIVE'); assert.ok(t.allReasons.includes('EDGE_INIT_UNKNOWN')); }
  }
  assert.equal(evalId('edge-init-claims-low-inconsistent').runVerdict, 'INVALID');
});

test('zero-sample timeout, superseded C8 and > 64 samples', () => {
  const z = evalId('zero-sample-timeout');
  assert.equal(z.runVerdict, 'INCONCLUSIVE');
  for (const t of z.targets) assert.equal(t.reason, 'NO_DECIDING_SAMPLE');
  const p = evalId('c8-superseded-p-settle');
  assert.equal(p.runVerdict, 'SUPPORTED'); assert.deepEqual(p.c8.map((c) => c.measureRole), ['subject', 'superseded']);
  const nc14 = evalId('inconclusive-c8-numeric-not-retained');
  assert.equal(nc14.runVerdict, 'SUPPORTED');
  assert.deepEqual(nc14.c8.map((c) => [c.status, c.reason]), [['AMBIGUOUS', 'NUMERIC_NOT_RETAINED']]);
  const l = evalId('t4-more-than-64-samples-then-settled');
  assert.equal(l.correlation.malformed, null); assert.equal(l.correlation.contradiction, null);
  const T = load('t4-more-than-64-samples-then-settled').traces.T;
  const pr = projectTarget(targetWindow(T.slice(1, -1)), { edgeInit: 'LOW' });
  const smpS = pr.events.filter((e) => e.k === 'SMP' && e.s === 'S');
  assert.equal(smpS.length, 64); assert.equal(smpS[63].n, 64); assert.equal(smpS[63].fr, 1); assert.equal(smpS[63].d, 'settled');
  assert.ok(T.some((r) => r.k === 'T4' && r.tp === 'sample' && r.n === 71), 'raw index kept in the trace');
});

test('projection: unrepresentable inputs fail closed (FIT_THREW, CAPACITY), never MALFORMED', () => {
  assert.equal(evalId('rq-threw-unrepresentable').correlation.unrepresentable, 'FIT_THREW');
  const base = [{ q: 1, k: 'FS', f: 0, tm: 0, cl: 0, dg: '0'.repeat(16) }, { q: 2, k: 'PS', hq: 1, sp: 0 }];
  const many = [...base];
  for (let i = 0; i < 8192; i += 1) many.push({ q: 3 + i, k: 'TE', f: 0, tm: 0, ev: i % 2 === 0 ? 1 : 0 });
  assert.equal(projectTarget(many, { edgeInit: 'LOW' }).unrepresentable, 'CAPACITY');
  assert.ok(projectTarget(many, { edgeInit: 'UNKNOWN' }).events, 'AE removal under UNKNOWN keeps it representable');
});

test('adversarial: no single-record mutation of the valid trace can turn an ambiguity into SUPPORTED/REJECTED', () => {
  const sc = load('valid-complete');
  const T = sc.traces.T; const data = T.slice(1, -1);
  const D = data.find((r) => r.k === 'T4' && r.tp === 'decision' && r.fr === 1);
  let positives = 0;
  const check = (recs, what) => {
    const s2 = { ...sc, traces: { ...sc.traces, T: recs } };
    const r = evaluateScenario(s2, { contract });
    assert.deepEqual(auditResult(r, s2), [], what);
    if (POS.has(r.runVerdict)) positives += 1;
    return r;
  };
  // (a) delete any one data record, renumbered and resealed (a perfectly consistent but altered trace)
  for (let i = 1; i < data.length - 1; i += 1) check(removeData(T, i), `delete ${i}`);
  // (b) any visible slot read before D turned into a foreign object: never positive
  data.forEach((r, i) => {
    if (r.k !== 'PS' || r.q > D.ss + 1 || r.sp !== 1) return;
    const m = clone(T); m[i + 1].sb = 'U'; reseal(m);
    const res = check(m, `U at ${r.q}`);
    assert.ok(!POS.has(res.runVerdict), `foreign read at ${r.q} produced ${res.runVerdict}`);
  });
  // (c) the deciding read showing an empty slot: never PENDING
  const m = clone(T); const ps = m.findIndex((r) => r.k === 'PS' && r.hq === D.ss);
  Object.assign(m[ps], { sp: 0, sx: 'clear' }); delete m[ps].sb; reseal(m);
  assert.ok(!POS.has(check(m, 'empty at D').runVerdict));
  // (d) any boundary field implying UNKNOWN, a class-gate failure or a missing PC-3 never yields a positive verdict
  for (const over of [{ lb: 0, ei: 'UNKNOWN' }, { qe: 3, ei: 'UNKNOWN' }, { ba: 'UNREADABLE', ei: 'UNKNOWN' }, { bp: 'PRESENT', ei: 'UNKNOWN' }]) {
    const x = clone(T); Object.assign(x[0], over); reseal(x);
    assert.equal(check(x, JSON.stringify(over)).runVerdict, 'INCONCLUSIVE');
  }
  const cg = clone(T); cg[cg.length - 1].cg = 1;
  assert.equal(check(cg, 'cg').runVerdict, 'INCONCLUSIVE');
  // (e) dropping any one control trace, or any proper prefix of the target, is never positive
  for (const pc of ['PC-1', 'PC-2', 'PC-4', 'PC-5']) assert.equal(evaluateScenario({ ...sc, traces: { ...sc.traces, [pc]: null } }, { contract }).runVerdict, 'INVALID');
  for (let n = 1; n < T.length; n += 1) assert.equal(evaluateScenario({ ...sc, traces: { ...sc.traces, T: T.slice(0, n) } }, { contract }).runVerdict, 'INVALID', `prefix ${n}`);
  assert.ok(positives < data.length, 'the mutation sweep is not vacuous');
});

test('adversarial: hostile scenario input never throws and is never positive', () => {
  const sc = load('valid-complete');
  for (const bad of [{}, { attemptConsumed: true }, { ...sc, traces: null }, { ...sc, traces: { T: 'x' } }, { ...sc, targetPlan: null }, { ...sc, binding: null }, { ...sc, traces: { ...sc.traces, T: { parseError: 'JSONL-PARSE' } } }]) {
    const r = evaluateScenario(bad, { contract });
    assert.ok(!POS.has(r.runVerdict), JSON.stringify(Object.keys(bad)));
  }
});

test('regression (Codex review): orphan RS post, contaminated PC-3 window and a single-fit PC-4 are never positive', () => {
  // 1. valid-owner-restore without its RS pre
  const r1 = load('valid-owner-restore');
  const T1 = r1.traces.T; const rsPre = T1.slice(1, -1).findIndex((r) => r.k === 'RS' && r.pp === 'pre');
  const s1 = { ...r1, traces: { ...r1.traces, T: removeData(T1, rsPre) } };
  const o1 = evaluateScenario(s1, { contract });
  assert.ok(o1.integrity.T.errors.includes('RS-PAIR')); assert.equal(o1.runVerdict, 'INVALID');
  // 2. an extra RQ pair in the PC-3 control window (after the genuine rise/fall, before CT)
  const r2 = load('valid-complete'); const T2 = clone(r2.traces.T); const d2 = T2.slice(1, -1);
  const ct = d2.findIndex((r) => r.k === 'CT'); const at = d2[ct];
  const tok = Math.max(...d2.filter((r) => r.k === 'RQ').map((r) => r.r)) + 1;
  const lastRead = [...d2.slice(0, ct)].reverse().find((r) => r.k === 'PS');
  const ins = [{ f: at.f, k: 'RQ', pp: 'pre', r: tok, sp: 0, sx: 'none', tm: at.tm }, { f: at.f, k: 'RQ', pp: 'post', r: tok, co: 'returned', sp: 1, sb: tok, sx: 'appear', nw: 1, cl: lastRead ? 0 : 0, dg: d2.find((r) => r.k === 'FS' && r.f === at.f).dg, tm: at.tm }];
  ins[1].cl = d2.find((r) => r.k === 'FS' && r.f === at.f).cl;
  d2.splice(ct, 0, ...ins);
  d2.forEach((r, i) => { r.q = i + 1; });
  const end = T2[T2.length - 1]; end.zt = d2.find((r) => r.k === 'TZ' && r.zp === 'targetEnd').q;
  const T2b = reseal([T2[0], ...d2, end]);
  const s2 = { ...r2, traces: { ...r2.traces, T: T2b } };
  const o2 = evaluateScenario(s2, { contract });
  assert.equal(o2.integrity.T.ok, true, JSON.stringify(o2.integrity.T.errors));
  assert.equal(o2.controls['PC-3'], 'FAILED'); assert.equal(o2.controls.RG, false);
  assert.ok(!POS.has(o2.runVerdict)); assert.ok(auditRaw(s2).includes('RAW_PC3_WINDOW_NOT_EXACT'));
  // 3. PC-4 whose P settle reuses the first fit (the second fit removed)
  const pc4 = r2.traces['PC-4']; const d4 = pc4.slice(1, -1);
  const pres = d4.map((r, i) => [r, i]).filter(([r]) => r.k === 'RQ');
  const p4a = clone(pc4); const dd = p4a.slice(1, -1);
  const pStart = dd.find((r) => r.k === 'T4' && r.tp === 'start' && r.s === 'P'); pStart.r = 1;
  const p4b = removeData(removeData(reseal(p4a), pres[3][1]), pres[2][1]);
  const s3 = { ...r2, traces: { ...r2.traces, 'PC-4': p4b } };
  const o3 = evaluateScenario(s3, { contract });
  assert.notEqual(o3.controls['PC-4'], 'PASSED'); assert.equal(o3.runVerdict, 'INVALID');
  assert.ok(auditRaw(s3).includes('RAW_PC4_FITS_NOT_DISTINCT'));
});

test('H-1: the evaluated target plan must be the bound plan — a post-hoc label swap is INVALID, never SUPPORTED', () => {
  const sc = load('valid-rejected-init');
  assert.equal(evaluateScenario(sc, { contract }).runVerdict, 'REJECTED');
  assert.equal(targetPlanDigest(sc.targetPlan), sc.binding.targetPlanSha256);
  assert.equal(targetPlanDigest(sc.targetPlan), sc.traces.T[0].tq);
  // swap support/reject labels without touching META.tq or the binding (the reviewed probe adv2.mjs)
  const swapped = clone(sc.targetPlan); const t = swapped.targets[0]; [t.supportLabels, t.rejectLabels] = [t.rejectLabels, t.supportLabels];
  const r = evaluateScenario({ ...sc, targetPlan: swapped }, { contract });
  assert.equal(r.runVerdict, 'INVALID'); assert.ok(r.runReasons.includes('TARGET_PLAN_DIGEST_MISMATCH'));
  for (const x of r.targets) assert.ok(!POS.has(x.verdict));
  assert.ok(auditInputs({ ...sc, targetPlan: swapped }).includes('INPUT_TARGET_PLAN_NOT_BOUND'));
  // also re-pointing the binding at the swapped plan does not help: every META.tq still names the bound plan
  const r2 = evaluateScenario({ ...sc, targetPlan: swapped, binding: { ...sc.binding, targetPlanSha256: targetPlanDigest(swapped) } }, { contract });
  assert.equal(r2.runVerdict, 'INVALID'); assert.ok(r2.runReasons.includes('TARGET_PLAN_DIGEST_MISMATCH'));
  // the committed fixture for the same case
  const f = evalId('target-plan-digest-mismatch');
  assert.equal(f.runVerdict, 'INVALID'); assert.ok(f.runReasons.includes('TARGET_PLAN_DIGEST_MISMATCH'));
});

test('M-1: the external Phase-5 gates fail closed unless exactly true', () => {
  const sc = load('valid-complete');
  assert.equal(evaluateScenario(sc, { contract }).runVerdict, 'SUPPORTED');
  const without = (k) => { const x = { ...sc }; delete x[k]; return x; };
  const cases = [[without('ncRerunOk'), 'NEGATIVE_CONTROL_RERUN_UNKNOWN'], [without('ledgerOk'), 'HASH_LEDGER_UNKNOWN'], [{ ...sc, ncRerunOk: 'FAILED' }, 'NEGATIVE_CONTROL_RERUN_UNKNOWN'], [{ ...sc, ledgerOk: 0 }, 'HASH_LEDGER_UNKNOWN'], [{ ...sc, ncRerunOk: 'true' }, 'NEGATIVE_CONTROL_RERUN_UNKNOWN'], [{ ...sc, ledgerOk: 1 }, 'HASH_LEDGER_UNKNOWN'], [{ ...sc, ncRerunOk: false }, 'NEGATIVE_CONTROL_RERUN_MISMATCH']];
  for (const [x, reason] of cases) {
    const r = evaluateScenario(x, { contract });
    assert.equal(r.runVerdict, 'INVALID', reason); assert.ok(r.runReasons.includes(reason), `${reason}: ${r.runReasons}`);
  }
  // the independent audit catches a forged positive built from the same inputs
  const forged = evaluateScenario(sc, { contract });
  assert.ok(auditResult(forged, without('ncRerunOk')).includes('INPUT_NC_RERUN_NOT_TRUE'));
  assert.ok(auditResult(forged, { ...sc, ledgerOk: 0 }).includes('INPUT_LEDGER_NOT_TRUE'));
  for (const id of ['gate-nc-rerun-absent', 'gate-ledger-mistyped']) assert.equal(evalId(id).runVerdict, 'INVALID', id);
  assert.ok(evaluateScenario({ ...sc, ledgerOk: false }, { contract }).runReasons.includes('HASH_LEDGER_INCONSISTENT'));
});

test('re-review: an unknown trace role cannot bypass the every-META.tq rule; a generic SC-C04 stop applies T0c to every target', () => {
  const sc = load('valid-complete');
  const extra = clone(sc.traces['PC-1']); extra[0].tq = '0'.repeat(64); reseal(extra);
  const r = evaluateScenario({ ...sc, traces: { ...sc.traces, EXTRA: extra } }, { contract });
  assert.equal(r.runVerdict, 'INVALID'); assert.ok(r.runReasons.includes('UNKNOWN_TRACE_ROLE:EXTRA')); assert.ok(r.runReasons.includes('TARGET_PLAN_DIGEST_MISMATCH'));
  const r2 = evaluateScenario({ ...sc, traces: { ...sc.traces, EXTRA: clone(sc.traces['PC-1']) } }, { contract });
  assert.equal(r2.runVerdict, 'INVALID'); assert.ok(r2.runReasons.includes('UNKNOWN_TRACE_ROLE:EXTRA'));
  const c4 = evaluateScenario({ ...sc, stop: { id: 'SC-C04', class: 'c' } }, { contract });
  assert.equal(c4.runVerdict, 'INCONCLUSIVE'); assert.equal(c4.verdictWithheld, true); assert.equal(c4.withheldBy, 'SC-C04');
  for (const t of c4.targets) { assert.equal(t.verdict, 'INCONCLUSIVE'); assert.ok(t.allReasons.includes('SOURCE_FACT_CONTRADICTION:SC-C04')); }
  assert.deepEqual(auditResult(c4, { ...sc, stop: { id: 'SC-C04', class: 'c' } }), []);
});

test('M-2: ambiguity is assessed per primary target; PENDING is positive only when the correlator returns it DEFINITE', () => {
  const v = evalId('valid-complete');
  assert.equal(v.runVerdict, 'SUPPORTED');
  const prim = v.targets.filter((t) => t.primary); const non = v.targets.filter((t) => !t.primary);
  assert.ok(prim.every((t) => t.status === 'DEFINITE' && t.label === 'PENDING'));
  assert.ok(non.some((t) => t.status !== 'DEFINITE'), 'a non-primary ambiguous question does not change the run verdict (§14.4)');
  for (const t of non) assert.ok(!POS.has(t.verdict));
  // every positive fixture: every primary target is DEFINITE with a pre-registered label and no shadowed reason
  for (const sc0 of scenarios) {
    const r = evalId(sc0.id); if (!POS.has(r.runVerdict)) continue;
    for (const t of r.targets.filter((x) => x.primary)) {
      assert.equal(t.status, 'DEFINITE', sc0.id); assert.deepEqual(t.allReasons, [t.reason], sc0.id);
      assert.ok(['PREREGISTERED_SUPPORT', 'PREREGISTERED_REJECT'].includes(t.reason), sc0.id);
    }
  }
  // the spec states the same rule
  assert.match(contract.verdictTable.ambiguityScope, /PRIMARY target question/);
});

test('M-3: a token that reappears after leaving the slot is a source-fact contradiction (SC-C04): never positive, withheld', () => {
  const r = evalId('token-reappears-after-clear');
  assert.equal(r.runVerdict, 'INCONCLUSIVE'); assert.equal(r.verdictWithheld, true); assert.equal(r.withheldBy, 'SC-C04');
  const subj = r.targets.find((t) => t.questionId === 'Q-SUBJ');
  assert.equal(subj.status, 'DEFINITE', 'the committed correlator alone would report PENDING (the reviewed probe A17)');
  assert.equal(subj.verdict, 'INCONCLUSIVE'); assert.equal(subj.reason, 'SOURCE_FACT_CONTRADICTION:TOKEN_REAPPEARED');
  assert.ok(subj.allReasons.includes('IDENTITY_AMBIGUOUS:CLEAR_WITHOUT_EDGE'), 'T1c also applies to the cleared subject token');
  for (const t of r.targets) assert.ok(!POS.has(t.verdict));
  const sc = load('token-reappears-after-clear');
  assert.ok(auditRaw(sc).includes('RAW_TOKEN_REAPPEARED'));
  // unit: present -> left -> present is a reappearance; present -> replaced and never back is not
  const R = (xs) => xs.map((x, i) => ({ q: i + 1, k: 'PS', ...x }));
  assert.deepEqual(tokenReappearance(R([{ sp: 1, sb: 2 }, { sp: 0 }, { sp: 1, sb: 2 }])), { seq: 3, token: 2 });
  assert.deepEqual(tokenReappearance(R([{ sp: 1, sb: 2 }, { sp: 1, sb: 3 }, { sp: 1, sb: 2 }])), { seq: 3, token: 2 });
  assert.equal(tokenReappearance(R([{ sp: 1, sb: 2 }, { sp: 1, sb: 2 }, { sp: 0 }, { sp: 1, sb: 3 }])), null);
  assert.equal(tokenReappearance(R([{ sp: 1, sb: 'U' }, { sp: 0 }, { sp: 1, sb: 'U' }])), null, '"U" is not a token');
  // T1c unit: CLEAR_WITHOUT_EDGE withdraws a DEFINITE token-dependent label
  const t = { targetId: 'x', questionId: 'Q-SUBJ', primary: true, supportLabels: ['PENDING'], rejectLabels: [] };
  const ctx = { runVerdict: null, cg: 0, preMotionUnresolved: false, slotWindow: 'OPEN', edgeInit: 'LOW', rg: true, forbiddenLabels: contract.verdictTable.forbiddenLabels, renameReason: (x) => x, clearedTokens: [4], subjectToken: 4 };
  assert.equal(targetVerdict(t, { status: 'DEFINITE', label: 'PENDING' }, ctx).reason, 'IDENTITY_AMBIGUOUS:CLEAR_WITHOUT_EDGE');
  assert.equal(targetVerdict(t, { status: 'DEFINITE', label: 'PENDING' }, { ...ctx, subjectToken: 5 }).verdict, 'SUPPORTED', 'another cleared token does not affect Q-SUBJ');
  const owner = { ...t, questionId: 'Q-OWNER', supportLabels: ['OWN'] };
  assert.equal(targetVerdict(owner, { status: 'DEFINITE', label: 'OWN' }, { ...ctx, slotWindow: 'ASSUME_NO_UNOBSERVED_WRITER' }).verdict, 'INCONCLUSIVE');
  assert.equal(targetVerdict({ ...owner, supportLabels: ['RESTORE'] }, { status: 'DEFINITE', label: 'RESTORE' }, ctx).verdict, 'SUPPORTED', 'token-free RESTORE continues (P1 §10.4)');
});

test('M-8: strict target-plan schema, derived (not declared) bounds, and Phase-5 trace-to-plan conformance', () => {
  for (const [k, p] of Object.entries(TARGET_PLANS)) assert.equal(validateTargetPlan(p, { contract, slotWindow: 'OPEN' }).ok, true, k);
  const a = clone(TARGET_PLANS.a);
  const bad = (mut, re) => { const p = clone(a); mut(p); const r = validateTargetPlan(p, { contract, slotWindow: 'OPEN' }); assert.equal(r.ok, false); assert.ok(r.findings.some((f) => re.test(f)), `${re}: ${r.findings}`); };
  bad((p) => { p.steps = 'synthetic: free text'; }, /PLAN-STEPS:STEPS-SHAPE/);
  bad((p) => { p.declaredDurationFrames = 10; }, /TARGET-PLAN-SHAPE/);
  bad((p) => { p.steps[0].note = 'x'; }, /STEP-FIELDS/);
  bad((p) => { p.steps.splice(4, 1); }, /C8-SUBJECT-COUNT/);
  bad((p) => { p.steps.push({ op: 'fit' }, { op: 'settle', role: 'S' }); }, /COUNT:S/);
  bad((p) => { p.steps.splice(2, 1); }, /SETTLE-WITHOUT-FIT/);
  bad((p) => { p.steps.unshift({ op: 'fit' }, { op: 'settle', role: 'P' }, { op: 'c8', role: 'superseded' }); }, /P-BEFORE-S/);
  bad((p) => { p.steps = [...Array(9)].flatMap(() => [{ op: 'fit' }]).concat([{ op: 'settle', role: 'S' }, { op: 'c8', role: 'subject' }]); }, /COUNT:fit/);
  bad((p) => { p.targets[0].comment = 'x'; }, /TARGET-SHAPE/);
  // derived bounds: the P6 shape (4 settles) fits only up to 178 Hz with zero budgets, less with budgets
  assert.equal(derivePlanBounds(TARGET_PLANS.e, contract, { b1: 0, bPost: 0 }).maxRefreshHz, 178);
  assert.ok(derivePlanBounds(TARGET_PLANS.e, contract, { b1: 60, bPost: 120 }).maxRefreshHz < 178);
  const a0 = derivePlanBounds(TARGET_PLANS.a, contract, { b1: 60, bPost: 120 });
  assert.equal(a0.ok, true); assert.ok(a0.worstCase.frames <= contract.envelope.caps.targetWindowFrames);
  assert.ok(a0.worstCase.projectedEvents <= contract.envelope.caps.projectedEventsMax); assert.ok(a0.worstCase.rawRecords <= contract.envelope.caps.dataEvents);
  const tooLong = derivePlanBounds(TARGET_PLANS.e, contract, { b1: 3000, bPost: 0 });
  assert.equal(tooLong.ok, false); assert.equal(tooLong.maxRefreshHz, 0); assert.ok(tooLong.findings.includes('SC-A07:DURATION'));
  // conformance: removing the subject C8 (the reviewed probe adv3.mjs) is INVALID, not SUPPORTED
  const sc = load('valid-complete'); const T = sc.traces.T;
  assert.equal(planConformance(sc.targetPlan, targetWindow(T.slice(1, -1))).ok, true);
  const noC8 = removeData(T, T.slice(1, -1).findIndex((r) => r.k === 'C8'));
  const r = evaluateScenario({ ...sc, traces: { ...sc.traces, T: noC8 } }, { contract });
  assert.equal(r.integrity.T.ok, true); assert.equal(r.runVerdict, 'INVALID'); assert.ok(r.runReasons.includes('TARGET_PLAN_NONCONFORMANT'));
  assert.equal(evalId('target-plan-nonconformant-missing-c8').runVerdict, 'INVALID');
  // a plan that does not match the executed sequence (an extra restore step) is INVALID
  const extra = clone(sc.targetPlan); extra.steps.splice(2, 0, { op: 'restore' });
  assert.equal(planConformance(extra, targetWindow(T.slice(1, -1))).ok, false);
  // a zero-sample timeout legitimately omits the subject C8 (NC-16): conformant
  const z = load('zero-sample-timeout');
  assert.equal(planConformance(z.targetPlan, targetWindow(z.traces.T.slice(1, -1))).ok, true);
  // a nested call is an open-world call, not a plan step (rq-interleaved stays conformant)
  const n = load('rq-interleaved');
  assert.equal(planConformance(n.targetPlan, targetWindow(n.traces.T.slice(1, -1))).ok, true);
});

test('L-1, L-9: control traces must be linked to the target run; a supplied frozen META template is enforced', () => {
  const sc = load('valid-complete');
  const relabel = (recs, run) => { const x = clone(recs); x[0].run = run; x[x.length - 1].run = run; for (const d of x.slice(1, -1)) if ('rn' in d) d.rn = run; return reseal(x); };
  const r = evaluateScenario({ ...sc, traces: { ...sc.traces, 'PC-1': relabel(sc.traces['PC-1'], 'other-run') } }, { contract });
  assert.equal(r.integrity['PC-1'].ok, true); assert.equal(r.runVerdict, 'INVALID'); assert.ok(r.runReasons.includes('CONTROL_RUN_NOT_LINKED:PC-1'));
  assert.ok(auditInputs({ ...sc, traces: { ...sc.traces, 'PC-1': relabel(sc.traces['PC-1'], 'other-run') } }).includes('INPUT_CONTROL_NOT_LINKED:PC-1'));
  const strip = (m) => { const o = { ...m }; for (const k of ['ei', 'ba', 'bp', 'lb', 'qe']) delete o[k]; return o; };
  const tpl = strip(sc.traces.T[0]);
  assert.equal(evaluateScenario({ ...sc, metaTemplates: { T: tpl } }, { contract }).runVerdict, 'SUPPORTED');
  const off = evaluateScenario({ ...sc, metaTemplates: { T: { ...tpl, br: 'synthetic 1' } } }, { contract });
  assert.equal(off.runVerdict, 'INVALID'); assert.ok(off.integrity.T.errors.includes('BINDING-MISMATCH:metaTemplate'));
});
