// Control-matrix evaluator (Part 2 §11): positive controls PC-1..PC-5 from their (already integrity-validated)
// traces, the VB-3 representativeness gate RG (§11.4), and the negative-control matrix runner that checks every
// NC fixture's observed outcome against the expected table (§11.3). [SYN] offline research prototype only.
//
// Fail-closed conventions (NOTES.md): a control is PASSED only if its trace is present and intact, its boundary is
// LOW, its own CT records PASSED, AND the evaluator independently re-derives the §11.2 pattern. A recorded PASSED
// that the pattern does not confirm is FAILED. An absent trace is NOT_RUN. PC-3's re-derived outcome (not END.pc
// alone) decides whether the C6 guard may keep V-EDGE for the TARGET trace. For a control trace (END.pc VB-3 = 0 by
// contract), the guard input used for that control's own correlator expectation is the control's own re-derived
// fit -> rise -> visible step -> fall -> adjacent TC pattern (Part 2 §11.2 "C6 guard input", §12.7); it never feeds a
// target verdict. PC-4's NV reproduction needs the frozen C8 frustum oracle, which is LIVE-only (Part 2 §11.2 "PC-4
// scope"): this prototype checks PC-4's structural pattern only and never claims the oracle ran.
import { correlateTraceWindow, targetWindow } from './verdict.mjs';
import { windowIndices } from './trace-schema.mjs';

const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** What each control's failure invalidates (Part 2 §11.2 last column; Appendix (vii) failureEffect). */
export const CONTROL_EFFECTS = Object.freeze({
  'PC-1': { required: true, onFail: 'SC-B02 -> run INVALID', invalidates: 'live functional claim for V-PEND, V-EDGE, P-TC, ID-ON on this build/environment; no target verdict may be derived' },
  'PC-2': { required: true, onFail: 'SC-B02 -> run INVALID', invalidates: 'R2 binding, R3/R4 inference and OPEN fail-closed behaviour on live input' },
  'PC-3': { required: false, onFail: 'SC-C01: C6 guard disables V-EDGE; edge-dependent targets INCONCLUSIVE (run not INVALID)', invalidates: 'in-capture use of V-EDGE (never historical evidence)' },
  'PC-4': { required: true, onFail: 'SC-B02 -> run INVALID', invalidates: 'binding of the C8 measurement to the T4 deciding sample (R8)' },
  'PC-5': { required: true, onFail: 'SC-B02 -> run INVALID', invalidates: 'reachability of the OPEN-mode SUPPORTED path (RESTORE)' },
});

const result = (outcome, reasons) => ({ outcome, reasons: [...new Set(reasons)].sort() });

function common(records, id) {
  const meta = records[0]; const data = records.slice(1, -1);
  const R = [];
  if (meta.ei !== 'LOW') R.push('EDGE_INIT_NOT_LOW');
  const ct = data.find((r) => r.k === 'CT');
  if (!ct || ct.ci !== id) R.push('CT_MISSING');
  else if (ct.cr !== 'PASSED') R.push(`CT_RECORDED_${ct.cr}`);
  else if (!(ct.fu <= ct.fb)) R.push('FRAME_BUDGET_EXCEEDED');
  return { meta, data, win: targetWindow(data), ct, R };
}

const rqPairs = (win) => {
  const out = [];
  win.forEach((r, i) => { if (r.k === 'RQ' && r.pp === 'post') { const pre = win.find((x) => x.k === 'RQ' && x.pp === 'pre' && x.r === r.r); out.push({ pre, post: r, adjacent: pre && r.q === pre.q + 1, i }); } });
  return out;
};
const boundFit = (p, k) => p && p.adjacent && p.pre.sp === 0 && p.pre.sx === 'none' && p.post.co === 'returned' && p.post.sp === 1
  && p.post.sx === 'appear' && p.post.nw === 1 && p.post.sb === k && p.post.r === k;
const edges = (win) => win.filter((r) => r.k === 'TE');
const hasU = (win) => win.some((r) => own(r, 'sb') && r.sb === 'U');
const camBefore = (win, q) => { let c = null; for (const r of win) { if (r.q >= q) break; if (own(r, 'cl')) c = r.cl; } return c; };

/** PC-1 transition pattern for fit k between [fromQ, toQ): rise, a visible step, fall, TC adjacent. */
function transitionAfter(win, post, toQ, budget) {
  const es = edges(win).filter((e) => e.q > post.q && e.q < toQ);
  if (es.length !== 2 || es[0].ev !== 1 || es[1].ev !== 0) return 'EDGE_PATTERN';
  const [rise, fall] = es;
  if (!(rise.f - post.f <= budget)) return 'RISE_NOT_WITHIN_B1';
  const c0 = camBefore(win, rise.q);
  if (!win.some((r) => r.k === 'FS' && r.q > rise.q && r.q < fall.q && r.cl !== c0)) return 'NO_VISIBLE_STEP';
  const tc = win.find((r) => r.k === 'TC' && r.q === fall.q + 1);
  if (!tc) return 'TC_NOT_ADJACENT_TO_FALL';
  if (win.filter((r) => r.k === 'TC' && r.q > post.q && r.q < toQ).length !== 1) return 'TC_COUNT';
  return { rise, fall, tc };
}

export function evaluatePC1(records) {
  const { win, ct, R } = common(records, 'PC-1');
  const pairs = rqPairs(win);
  if (pairs.length !== 1 || !boundFit(pairs[0], 1)) R.push('FIT_BINDING_PATTERN');
  else {
    const tr = transitionAfter(win, pairs[0].post, Infinity, ct ? ct.fb : -1);
    if (typeof tr === 'string') R.push(tr);
  }
  if (hasU(win)) R.push('UNBOUND_SLOT_READ');
  if (win.some((r) => r.k === 'T4' || r.k === 'RS' || r.k === 'C8')) R.push('UNEXPECTED_KIND');
  return result(R.length ? 'FAILED' : 'PASSED', R);
}

export function evaluatePC2(records, { contract }) {
  const { meta, data, win, ct, R } = common(records, 'PC-2');
  const pairs = rqPairs(win);
  if (pairs.length !== 2 || !boundFit(pairs[0], 1) || !boundFit(pairs[1], 2)) R.push('FIT_BINDING_PATTERN');
  else {
    const t1 = transitionAfter(win, pairs[0].post, pairs[1].pre.q, ct ? ct.fb : -1);
    const t2 = transitionAfter(win, pairs[1].post, Infinity, ct ? ct.fb : -1);
    if (typeof t1 === 'string') R.push(`FIRST_${t1}`);
    if (typeof t2 === 'string') R.push(`SECOND_${t2}`);
    if (typeof t1 !== 'string' && !win.some((r) => r.k === 'FS' && r.q > t1.tc.q && r.q < pairs[1].pre.q)) R.push('NO_QUIESCENCE_BETWEEN_FITS');
    const st = win.filter((r) => r.k === 'T4' && r.tp === 'start');
    if (st.length !== 1 || st[0].s !== 'S' || st[0].r !== 2 || (typeof t2 !== 'string' && st[0].q < t2.tc.q)) R.push('SETTLE_PATTERN');
  }
  if (hasU(win)) R.push('UNBOUND_SLOT_READ');
  if (!R.length) {
    // the control's own edges were verified by the pattern above, so its behavioural VB-3 row is taken from it
    const assume = correlateTraceWindow(data, { meta, effectivePcVb3: 1, slotWindow: 'ASSUME_NO_UNOBSERVED_WRITER', contract });
    const open = correlateTraceWindow(data, { meta, effectivePcVb3: 1, slotWindow: 'OPEN', contract });
    const q = (res, id) => res.questions[id];
    const isDef = (x, label) => x.status === 'DEFINITE' && x.label === label && x.assumption === 'NO_UNOBSERVED_WRITER';
    if (assume.contradiction || assume.malformed || !isDef(q(assume, 'Q-ATTR'), '1,2') || !isDef(q(assume, 'Q-OWNER'), 'OWN') || !isDef(q(assume, 'Q-SUBJ'), 'COMPLETE')) R.push('ASSUME_CORRELATION');
    for (const id of ['Q-ATTR', 'Q-OWNER', 'Q-SUBJ']) {
      const x = q(open, id);
      if (open.contradiction || open.malformed || x.status !== 'AMBIGUOUS' || x.reason !== 'UNOBSERVED_SLOT_WINDOW') R.push(`OPEN_NOT_FAIL_CLOSED:${id}`);
    }
  }
  return result(R.length ? 'FAILED' : 'PASSED', R);
}

/** An adjacent, returned fit that wrote a new slot object bound to its own token. */
const freshBoundFit = (p) => p && p.adjacent && p.post.co === 'returned' && p.post.sp === 1 && p.post.nw === 1 && p.post.sb === p.post.r;

export function evaluatePC4(records) {
  const { data, win, R } = common(records, 'PC-4');
  const pairs = rqPairs(win);
  const st = win.filter((r) => r.k === 'T4' && r.tp === 'start');
  const c8 = win.filter((r) => r.k === 'C8');
  const term = (start) => win.find((r) => r.k === 'T4' && r.tp === 'decision' && r.te === 1 && r.q > start.q);
  // fit1 -> S settle (r = fit1) -> subject C8 -> fit2 -> P settle (r = fit2) -> superseded C8 (Part 2 §11.2 PC-4)
  if (pairs.length !== 2 || !freshBoundFit(pairs[0]) || !freshBoundFit(pairs[1]) || pairs[0].post.r === pairs[1].post.r) R.push('FIT_PATTERN');
  else if (st.length !== 2 || st[0].s !== 'S' || st[1].s !== 'P') R.push('SETTLE_PATTERN');
  else if (c8.length !== 2 || c8[0].mr !== 'subject' || c8[1].mr !== 'superseded') R.push('C8_PATTERN');
  else {
    const [f1, f2] = pairs.map((p) => p.post); const [sS, sP] = st; const tS = term(sS); const tP = term(sP);
    const ordered = sS.r === f1.r && sP.r === f2.r && f1.q < sS.q && tS && tS.q < c8[0].q && c8[0].q < pairs[1].pre.q
      && f2.q < sP.q && tP && tP.q < c8[1].q;
    if (!ordered) R.push('ORDER_PATTERN');
  }
  // Part (A), structural: integrity already enforced I5 for both C8 records; the exact order is checked above.
  // Part (B), numeric: LIVE-only (frozen C8 frustum oracle in the bound Phase-5 evaluator; no offline artifact has it).
  // A retained bound NV cannot be evaluated offline -> FAILED (fail-closed); none retained -> (B) is vacuous.
  const boundNv = c8.filter((c) => data.some((r) => r.k === 'NV' && r.q === c.ss + 1));
  if (boundNv.length) R.push('NV_REPRODUCTION_LIVE_ONLY');
  return { ...result(R.length ? 'FAILED' : 'PASSED', R), scope: 'STRUCTURAL_ONLY', nvReproduction: boundNv.length ? 'NOT_EVALUATED_OFFLINE' : 'NOT_RETAINED' };
}

export function evaluatePC5(records, { contract }) {
  const { meta, data, win, ct, R } = common(records, 'PC-5');
  const pairs = rqPairs(win);
  if (pairs.length !== 1 || !boundFit(pairs[0], 1)) R.push('FIT_BINDING_PATTERN');
  const rsPosts = win.filter((r) => r.k === 'RS' && r.pp === 'post');
  if (rsPosts.length !== 1) R.push('RESTORE_COUNT');
  const rsPost = rsPosts[0];
  const tc = win.find((r) => r.k === 'TC');
  if (!rsPost || rsPost.rs !== 'OK' || rsPost.sp !== 0 || !tc || rsPost.q < tc.q) R.push('RESTORE_PATTERN');
  // the fit's own edge pattern (rise, visible step, fall, adjacent TC) before the restore: this is the control-trace
  // VB-3 guard input (Part 2 §12.7); without it the correlator expectation below is not computed
  const rsPre = win.find((r) => r.k === 'RS' && r.pp === 'pre');
  if (pairs.length === 1 && boundFit(pairs[0], 1)) {
    const tr = transitionAfter(win, pairs[0].post, rsPre ? rsPre.q : Infinity, ct ? ct.fb : -1);
    if (typeof tr === 'string') R.push(`FIT_${tr}`);
  }
  const st = win.filter((r) => r.k === 'T4' && r.tp === 'start');
  const dec = win.find((r) => r.k === 'T4' && r.tp === 'decision' && r.fr === 1);
  if (st.length !== 1 || st[0].s !== 'S' || st[0].r !== 1 || !rsPost || st[0].q < rsPost.q || !dec) R.push('SETTLE_PATTERN');
  else if (win.some((r) => r.k === 'TE' && r.q > rsPost.q && r.q < dec.ss)) R.push('EDGE_BETWEEN_RESTORE_AND_DECISION');
  if (!R.length) {
    const open = correlateTraceWindow(data, { meta, effectivePcVb3: 1, slotWindow: 'OPEN', contract });
    const x = open.questions['Q-OWNER'];
    if (open.contradiction || open.malformed || x.status !== 'DEFINITE' || x.label !== 'RESTORE' || own(x, 'assumption')) R.push('RESTORE_NOT_DEFINITE');
  }
  return result(R.length ? 'FAILED' : 'PASSED', R);
}

/** PC-3 from the target trace's control window (Part 2 §11.2, P1 I6). */
export function evaluatePC3(records, { contract }) {
  const data = records.slice(1, -1);
  const w = windowIndices(data);
  const R = [];
  if (w.targetEnd < 0 || w.final < 0) return result('FAILED', ['NO_CONTROL_WINDOW']);
  const cw = data.slice(w.targetEnd + 1, w.final);
  const ct = cw.find((r) => r.k === 'CT' && r.ci === 'PC-3');
  if (!ct) return result('NOT_RUN', ['CT_MISSING']);
  if (ct.cr !== 'PASSED') R.push(`CT_RECORDED_${ct.cr}`);
  if (!(ct.fu <= ct.fb && ct.fb <= contract.envelope.caps.controlWindowFrames)) R.push('FRAME_BUDGET');
  // exactly one harness-owned fit, then exactly one rise and one fall after it, at most one TC, nothing else but FS/PS
  const pres = cw.filter((r) => r.k === 'RQ' && r.pp === 'pre');
  const posts = cw.filter((r) => r.k === 'RQ' && r.pp === 'post');
  const pre = pres[0]; const post = posts[0];
  if (pres.length !== 1 || posts.length !== 1 || post.q !== pre.q + 1 || post.co !== 'returned' || post.nw !== 1 || post.sp !== 1 || post.sb !== post.r) R.push('FIT_PATTERN');
  else {
    const es = cw.filter((r) => r.k === 'TE');
    if (es.length !== 2 || es[0].ev !== 1 || es[1].ev !== 0 || es[0].q < post.q) R.push('EDGE_PATTERN');
    if (es[1] && ct.q < es[1].q) R.push('CT_BEFORE_FALL');
  }
  if (cw.filter((r) => r.k === 'TC').length > 1) R.push('TC_COUNT');
  if (cw.some((r) => !['RQ', 'TE', 'TC', 'FS', 'PS', 'CT'].includes(r.k))) R.push('UNEXPECTED_KIND');
  if (cw.some((r) => own(r, 'sb') && r.sb === 'U')) R.push('UNBOUND_SLOT_READ');
  if (cw[cw.length - 1] !== ct) R.push('CT_NOT_LAST_IN_CONTROL_WINDOW');
  if (R.some((x) => x.startsWith('CT_RECORDED_NOT_RUN'))) return result('NOT_RUN', R);
  return result(R.length ? 'FAILED' : 'PASSED', R);
}

/** RG in-capture witness: a target-window rise...fall pair following an RQ post with slotNew = 1. */
export function inCaptureEdgeWitness(data) {
  const win = targetWindow(data);
  const posts = win.filter((r) => r.k === 'RQ' && r.pp === 'post' && r.nw === 1);
  return posts.some((p) => {
    const rise = win.find((r) => r.k === 'TE' && r.ev === 1 && r.q > p.q);
    return !!rise && win.some((r) => r.k === 'TE' && r.ev === 0 && r.q > rise.q);
  });
}

/**
 * Evaluates every control. args: { traces: {PC-1, PC-2, PC-4, PC-5, T} (intact records or null), present: {role: bool},
 * contract }. An absent trace is NOT_RUN; a present but non-intact trace is FAILED.
 */
export function evaluateControls({ traces, present, contract }) {
  const out = {};
  const run = (id, fn) => {
    if (!present[id]) return result('NOT_RUN', ['TRACE_ABSENT']);
    if (!traces[id]) return result('FAILED', ['INTEGRITY']);
    try { return fn(traces[id], { contract }); } catch { return result('FAILED', ['EVALUATOR_EXCEPTION']); }
  };
  out['PC-1'] = run('PC-1', evaluatePC1);
  out['PC-2'] = run('PC-2', evaluatePC2);
  out['PC-4'] = run('PC-4', evaluatePC4);
  if (!out['PC-4'].scope) out['PC-4'] = { ...out['PC-4'], scope: 'STRUCTURAL_ONLY', nvReproduction: 'NOT_EVALUATED_OFFLINE' }; // offline never runs the oracle
  out['PC-5'] = run('PC-5', evaluatePC5);
  out['PC-3'] = !present.T ? result('NOT_RUN', ['TRACE_ABSENT']) : !traces.T ? result('FAILED', ['INTEGRITY']) : (() => { try { return evaluatePC3(traces.T, { contract }); } catch { return result('FAILED', ['EVALUATOR_EXCEPTION']); } })();
  const witness = traces.T ? inCaptureEdgeWitness(traces.T.slice(1, -1)) : false;
  out.rgParts = { pc1: out['PC-1'].outcome === 'PASSED', pc3: out['PC-3'].outcome === 'PASSED', inCaptureWitness: witness };
  out.RG = out.rgParts.pc1 && out.rgParts.pc3 && witness;
  return out;
}

/**
 * Negative-control matrix runner: compares each evaluated NC fixture against its expected outcome.
 * entries: [{ id, ncRefs: [...], expected: {runVerdict, integrityCodes?}, observed: evaluateScenario result }].
 * Returns { ok, findings } — a mismatch invalidates the analysis pipeline at its bound digest (SC-A05 / Phase-5 INVALID).
 */
export function runNegativeControlMatrix(entries) {
  const F = [];
  for (const e of entries) {
    if (e.observed.runVerdict !== e.expected.runVerdict) F.push(`${e.id}: runVerdict ${e.observed.runVerdict} != ${e.expected.runVerdict}`);
    const errs = Object.values(e.observed.integrity || {}).flatMap((i) => i.errors || []);
    for (const code of e.expected.integrityCodes || []) if (!errs.includes(code)) F.push(`${e.id}: integrity code ${code} missing`);
    for (const r of e.expected.reasonsInclude || []) {
      const all = [...(e.observed.runReasons || []), ...(e.observed.targets || []).flatMap((t) => t.allReasons || [])];
      if (!all.some((x) => x === r || x.endsWith(`:${r}`) || x.startsWith(`${r}:`))) F.push(`${e.id}: reason ${r} missing`);
    }
  }
  return { ok: F.length === 0, findings: F.sort() };
}
