// Offline validator for the future-live runbook (contract.runbook). Pure, deterministic; never executes anything.
// Returns { ok, findings, warnings } with sorted findings.

const PHASE_IDS = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];
const STEP_RE = /^(P[0-5])\.(\d{2})$/;
// Actions that touch a browser / Viewer / page / recorder / target sequence.
const LIVE_ACTION_RE = /browser|viewer|launch|context|page|fixtures|recorder|hooks|vb0|structural|quiescence|boundaryread|executetarget|runcontrol|teardown|pc3/i;
const BROWSER_LAUNCH_RE = /launch|browser|viewer|context|page|fixtures/i;
const SC_ID_RE = /^SC-([ABC])(\d{2})$/;

function stepOrderIndex(phases) {
  const order = new Map();
  let i = 0;
  for (const p of phases) for (const s of (Array.isArray(p.steps) ? p.steps : [])) if (s && typeof s.stepId === 'string' && !order.has(s.stepId)) order.set(s.stepId, i++);
  return order;
}

// Does a stop-condition `step` locator ("P0.07|P0.13", "P3|P4", "P2.02-P2.06", "any after P0.14", "after P0.14|P5.07") cover stepId?
function locatorCovers(locator, stepId, order) {
  if (typeof locator !== 'string') return false;
  for (const tokRaw of locator.split('|')) {
    const tok = tokRaw.trim();
    if (tok === stepId) return true;
    if (/^P[0-5]$/.test(tok) && stepId.startsWith(tok + '.')) return true;
    const range = /^(P[0-5]\.\d{2})-(P[0-5]\.\d{2})$/.exec(tok);
    if (range && order.has(range[1]) && order.has(range[2]) && order.has(stepId)) {
      if (order.get(range[1]) <= order.get(stepId) && order.get(stepId) <= order.get(range[2])) return true;
    }
    const after = /^(?:any )?after (P[0-5]\.\d{2})$/.exec(tok);
    if (after && order.has(after[1]) && order.has(stepId) && order.get(stepId) > order.get(after[1])) return true;
  }
  return false;
}

const FINALIZATION = ['rawFrozen', 'determinismChecked', 'derivedPublished', 'manifestWritten', 'runRootFrozen', 'commitRecordWritten'];
const RAW_PREFIXES = ['governance/', 'preflight/', 'env/', 'raw/'];
const CONTROL_TRACE_ORDER = ['TZ targetEnd', 'CT', 'TZ final', 'END'];

/**
 * Mechanical evidence-finalization checks: one creating step per path (no double write), raw files created before the
 * raw freeze, derived/terminal files published only after the determinism check, the manifest written after them and
 * before the run-root freeze, nothing created in the run root after it, and the commit record as the very last step.
 */
function checkFinalization(rb, phases, order, f) {
  if (JSON.stringify(rb.finalizationOrder) !== JSON.stringify(FINALIZATION)) f(`FINALIZATION_ORDER_DECLARATION: expected ${JSON.stringify(FINALIZATION)}`);
  const steps = phases.flatMap((p) => (p && Array.isArray(p.steps) ? p.steps : [])).filter((s) => s && typeof s.stepId === 'string');
  const at = {};
  for (const s of steps) if (s.finalization !== undefined) {
    if (!FINALIZATION.includes(s.finalization)) f(`FINALIZATION_UNKNOWN: ${s.stepId} ${s.finalization}`);
    else if (at[s.finalization]) f(`FINALIZATION_DUPLICATE: ${s.finalization}`);
    else at[s.finalization] = s.stepId;
  }
  for (const k of FINALIZATION) if (!at[k]) f(`FINALIZATION_MISSING: ${k}`);
  for (let i = 1; i < FINALIZATION.length; i += 1) {
    const a = at[FINALIZATION[i - 1]]; const b = at[FINALIZATION[i]];
    if (a && b && !(order.get(a) < order.get(b))) f(`FINALIZATION_OUT_OF_ORDER: ${FINALIZATION[i - 1]} (${a}) must precede ${FINALIZATION[i]} (${b})`);
  }
  const last = steps[steps.length - 1];
  if (at.commitRecordWritten && last && last.stepId !== at.commitRecordWritten) f(`COMMIT_RECORD_NOT_LAST: ${at.commitRecordWritten}`);
  // SC-C03 closeout branch (Part 2 §13.7, Appendix (iii) scC03Branch / branchWrites): P5.07 continues at the publish step with nothing
  // published and scratch read-only; the publish step's alternate write set is exactly the closeout; no other step may write it.
  const CLOSEOUT = 'SC-C03-CLOSEOUT.json';
  const detStep = steps.find((s) => s.stepId === at.determinismChecked);
  const pubStep = steps.find((s) => s.stepId === at.derivedPublished);
  if (detStep) {
    if (typeof detStep.onFail !== 'string' || !detStep.onFail.split('|').includes('SC-C03')) f(`SC_C03_BRANCH_MISSING: ${detStep.stepId} onFail must reference SC-C03`);
    const b = detStep.scC03Branch;
    if (b === undefined || b === null) f(`SC_C03_BRANCH_MISSING: ${detStep.stepId} has no scC03Branch`);
    else if (typeof b !== 'object' || Array.isArray(b)) f(`SC_C03_BRANCH_INVALID: ${detStep.stepId} scC03Branch is not an object`);
    else {
      if (pubStep && b.continuesAt !== pubStep.stepId) f(`SC_C03_BRANCH_INVALID: ${detStep.stepId} continuesAt ${JSON.stringify(b.continuesAt)} must be the derivedPublished step ${pubStep.stepId}`);
      if (!Array.isArray(b.publishes) || b.publishes.length !== 0) f(`SC_C03_BRANCH_INVALID: ${detStep.stepId} publishes must be an empty array`);
      if (b.scratchAfterCompare !== 'READ_ONLY_UNCHANGED') f(`SC_C03_BRANCH_INVALID: ${detStep.stepId} scratchAfterCompare must be READ_ONLY_UNCHANGED`);
      for (const k of Object.keys(b)) if (!['continuesAt', 'publishes', 'scratchAfterCompare'].includes(k)) f(`SC_C03_BRANCH_INVALID: ${detStep.stepId} unexpected scC03Branch key ${k}`);
    }
  }
  for (const s of steps) if (s.scC03Branch !== undefined && (!detStep || s.stepId !== detStep.stepId)) f(`SC_C03_BRANCH_INVALID: scC03Branch on ${s.stepId}, only the determinismChecked step may declare it`);
  if (pubStep) {
    if (JSON.stringify(pubStep.branchWrites) !== JSON.stringify({ 'SC-C03': [CLOSEOUT] })) f(`SC_C03_BRANCH_INVALID: ${pubStep.stepId} branchWrites must be exactly {"SC-C03":["${CLOSEOUT}"]}`);
    if (detStep && !(Array.isArray(pubStep.preconditions) && pubStep.preconditions.includes(detStep.stepId))) f(`SC_C03_BRANCH_INVALID: ${pubStep.stepId} preconditions must include the determinismChecked step ${detStep.stepId}`);
  }
  // Writes: normal writes and branch writes are alternate sets of one step, but a path is still created by exactly one step and one set.
  const writer = new Map();
  for (const s of steps) {
    if (s.writes === undefined && s.branchWrites === undefined) continue;
    const sets = [];
    if (s.writes !== undefined) {
      if (!Array.isArray(s.writes) || !s.writes.every((w) => typeof w === 'string' && w.length)) f(`STEP_WRITES_INVALID: ${s.stepId}`);
      else sets.push(['writes', s.writes]);
    }
    if (s.branchWrites !== undefined) {
      const bw = s.branchWrites;
      if (!bw || typeof bw !== 'object' || Array.isArray(bw) || !Object.values(bw).every((a) => Array.isArray(a) && a.every((w) => typeof w === 'string' && w.length))) f(`STEP_WRITES_INVALID: ${s.stepId} branchWrites`);
      else for (const k of Object.keys(bw).sort()) sets.push([`branchWrites.${k}`, bw[k]]);
    }
    const idx = order.get(s.stepId);
    for (const [setName, ws] of sets) {
      for (const w of ws) {
        if (writer.has(w)) f(`PATH_WRITTEN_TWICE: ${w} by ${writer.get(w)} and ${s.stepId}`); else writer.set(w, `${s.stepId}${setName === 'writes' ? '' : ` (${setName})`}`);
        const before = (k) => at[k] !== undefined && idx < order.get(at[k]);
        if (RAW_PREFIXES.some((p) => w.startsWith(p)) && !before('rawFrozen')) f(`RAW_WRITE_AFTER_RAW_FREEZE: ${s.stepId} ${w}`);
        if ((w.startsWith('derived/') || w === 'TERMINAL-VERDICT.json') && s.finalization !== 'derivedPublished') f(`DERIVED_WRITE_OUTSIDE_PUBLISH_STEP: ${s.stepId} ${w}`);
        if (w === CLOSEOUT && s.finalization !== 'derivedPublished') f(`SC_C03_CLOSEOUT_WRITE_OUTSIDE_PUBLISH_STEP: ${s.stepId} ${w}`);
        if (w === CLOSEOUT && s.finalization === 'derivedPublished' && setName === 'writes') f(`SC_C03_BRANCH_INVALID: ${s.stepId} lists ${w} in normal writes; it belongs only in branchWrites.SC-C03`);
        if (setName !== 'writes' && (w.startsWith('derived/') || w === 'TERMINAL-VERDICT.json')) f(`SC_C03_BRANCH_INVALID: ${s.stepId} ${setName} lists ${w}; the closeout branch publishes no derived file`);
        if (w === 'MANIFEST.json' && s.finalization !== 'manifestWritten') f(`MANIFEST_WRITE_OUTSIDE_MANIFEST_STEP: ${s.stepId}`);
        if (w.startsWith('attempts:') && w.endsWith('.commit.json') && s.finalization !== 'commitRecordWritten') f(`COMMIT_RECORD_WRITE_OUTSIDE_COMMIT_STEP: ${s.stepId}`);
        if (!w.startsWith('attempts:') && !before('runRootFrozen')) f(`RUN_ROOT_WRITE_AFTER_FREEZE: ${s.stepId} ${w}`);
      }
    }
  }
  for (const s of steps) if (s.control && s.control !== 'PC-3' && JSON.stringify(s.controlTraceOrder) !== JSON.stringify(CONTROL_TRACE_ORDER)) f(`CONTROL_TRACE_ORDER: ${s.stepId} must terminalize as ${CONTROL_TRACE_ORDER.join(' -> ')}`);
}

export function validateRunbook(contract) {
  const findings = [];
  const warnings = [];
  const f = (m) => findings.push(m);
  const rb = contract && contract.runbook;
  const sc = contract && contract.stopConditions;
  if (!rb || typeof rb !== 'object') return { ok: false, findings: ['RUNBOOK_MISSING'], warnings };
  if (rb.executed !== false) f('RUNBOOK_EXECUTED_NOT_FALSE: runbook.executed must be exactly false');
  if (rb.authorized !== false) f('RUNBOOK_AUTHORIZED_NOT_FALSE: runbook.authorized must be exactly false');
  if (rb.requiresFutureOwnerAuthorization === false) f('RUNBOOK_MARKER_FALSE: requiresFutureOwnerAuthorization must not be false');
  const phases = Array.isArray(rb.phases) ? rb.phases : [];
  if (phases.length === 0) f('PHASES_MISSING');

  // Phases 0-5 present, once each, in order.
  const ids = phases.map((p) => p && p.phaseId);
  if (JSON.stringify(ids) !== JSON.stringify(PHASE_IDS)) f(`PHASES_NOT_P0_TO_P5_IN_ORDER: found ${JSON.stringify(ids)}`);

  // StopConditions registry.
  const scById = new Map();
  if (!sc || !Array.isArray(sc.stopConditions)) f('STOP_CONDITIONS_MISSING');
  else {
    for (const c of sc.stopConditions) {
      if (!c || typeof c.id !== 'string') { f('STOP_CONDITION_WITHOUT_ID'); continue; }
      if (scById.has(c.id)) f(`STOP_CONDITION_DUPLICATE: ${c.id}`);
      scById.set(c.id, c);
      const m = SC_ID_RE.exec(c.id);
      if (!m) f(`STOP_CONDITION_ID_FORMAT: ${c.id}`);
      else if (m[1].toLowerCase() !== c.class) f(`STOP_CONDITION_CLASS_MISMATCH: ${c.id} has class ${c.class}`);
      if (c.class === 'a' && !/^a[12](\|a[12])?$/.test(String(c.subclass))) f(`STOP_CONDITION_SUBCLASS: ${c.id} subclass ${c.subclass}`);
    }
    const cl = sc.classes || {};
    if (!cl.a || cl.a.attemptConsumed !== false || cl.a.runVerdict !== 'BLOCKED') f('STOP_CLASS_A_DEFINITION');
    if (!cl.b || cl.b.attemptConsumed !== true || cl.b.runVerdict !== 'INVALID' || cl.b.retry !== false) f('STOP_CLASS_B_DEFINITION');
    if (!cl.c) f('STOP_CLASS_C_DEFINITION');
  }

  // Steps: numbering, ordering, preconditions.
  const order = stepOrderIndex(phases);
  const seen = new Set();
  const referencedClasses = new Set();
  let consumeSteps = 0;
  let spent = false; // P0 steps at/after the record-spending step run with a spent record
  phases.forEach((p, pi) => {
    if (!p || typeof p !== 'object') { f(`PHASE_INVALID: index ${pi}`); return; }
    const pid = p.phaseId;
    const steps = Array.isArray(p.steps) ? p.steps : [];
    if (steps.length === 0) f(`PHASE_WITHOUT_STEPS: ${pid}`);
    const expectConsumes = pid !== 'P0';
    if (p.consumesAttempt !== expectConsumes) f(`PHASE_CONSUMES_ATTEMPT: ${pid} must be ${expectConsumes}`);
    if (pid === 'P5' && p.offlineOnly !== true) f('PHASE_P5_NOT_OFFLINE_ONLY');
    if (pid !== 'P5' && p.offlineOnly === true) f(`PHASE_OFFLINE_ONLY_UNEXPECTED: ${pid}`);
    steps.forEach((s, si) => {
      if (!s || typeof s !== 'object') { f(`STEP_INVALID: ${pid} index ${si}`); return; }
      const id = s.stepId;
      const m = typeof id === 'string' ? STEP_RE.exec(id) : null;
      if (!m) { f(`STEP_ID_FORMAT: ${String(id)}`); return; }
      if (m[1] !== pid) f(`STEP_ID_PHASE_MISMATCH: ${id} in ${pid}`);
      if (Number(m[2]) !== si + 1) f(`STEP_NUMBERING_NOT_CONSECUTIVE: ${id} at position ${si + 1}`);
      if (seen.has(id)) f(`STEP_DUPLICATE: ${id}`);
      seen.add(id);
      if (typeof s.action !== 'string' || s.action.length === 0) f(`STEP_ACTION_MISSING: ${id}`);
      if (s.executed === true) f(`STEP_EXECUTED: ${id} is marked executed`);
      if (s.authorized === true) f(`STEP_AUTHORIZED: ${id} is marked authorized`);
      if (s.retry === true) f(`STEP_RETRY: ${id} allows retry`);
      // Per-step owner-authorization marker (Part 2 §16, Appendix (iii); explicit boolean on every step).
      if (typeof s.requiresFutureOwnerAuthorization !== 'boolean') f(`STEP_MARKER_MISSING: ${id} requiresFutureOwnerAuthorization must be an explicit boolean`);

      // Preconditions satisfiable in order.
      if (!Array.isArray(s.preconditions)) f(`STEP_PRECONDITIONS_NOT_ARRAY: ${id}`);
      else for (const pre of s.preconditions) {
        if (!order.has(pre)) f(`PRECONDITION_UNKNOWN: ${id} requires ${pre}`);
        else if (order.get(pre) >= order.get(id)) f(`PRECONDITION_NOT_EARLIER: ${id} requires ${pre}`);
      }
      if (order.get(id) === 0 && Array.isArray(s.preconditions) && s.preconditions.length) f(`FIRST_STEP_HAS_PRECONDITIONS: ${id}`);
      if (order.get(id) > 0 && Array.isArray(s.preconditions) && s.preconditions.length === 0 && id !== 'P3.05') f(`STEP_UNCONDITIONAL_NOT_ALLOWED: ${id} has no precondition`);

      // Consumption boundary.
      if (s.effect === 'attemptConsumed') { consumeSteps++; if (id !== 'P0.14') f(`ATTEMPT_CONSUMED_STEP_UNEXPECTED: ${id}`); }

      // Stop-condition references and class consistency.
      if (s.onFail !== null && s.onFail !== undefined) {
        if (typeof s.onFail !== 'string') f(`STEP_ONFAIL_TYPE: ${id}`);
        else for (const ref of s.onFail.split('|')) {
          const c = scById.get(ref);
          if (!c) { f(`STOP_CONDITION_UNKNOWN: ${id} references ${ref}`); continue; }
          referencedClasses.add(c.class);
          if (!locatorCovers(c.step, id, order)) f(`STOP_CONDITION_STEP_MISMATCH: ${id} references ${ref} whose step locator is "${c.step}"`);
          if (pid === 'P0' && c.class === 'b') f(`CLASS_B_BEFORE_CONSUMPTION: ${id} references ${ref}`);
          if (pid !== 'P0' && c.class === 'a') f(`CLASS_A_AFTER_CONSUMPTION: ${id} references ${ref}`);
          if (pid === 'P0' && id !== 'P0.14' && s.effect !== 'attemptConsumed' && c.class === 'c') f(`CLASS_C_IN_PREFLIGHT: ${id} references ${ref}`);
        }
      }

      // Live-step marker: required true for every step that launches/drives a browser or Viewer, spends the record,
      // consumes the attempt, or runs inside the consumed attempt before offline analysis (P1-P4).
      if (s.effect === 'recordSpent') spent = true;
      const live = (pid !== 'P0' && pid !== 'P5') || (pid === 'P0' && BROWSER_LAUNCH_RE.test(s.action || '') ) || (pid === 'P0' && /vb0|structural|refresh/i.test(s.action || ''))
        || (pid === 'P0' && spent) || s.effect === 'attemptConsumed' || s.effect === 'recordSpent';
      if (pid === 'P5' && LIVE_ACTION_RE.test(s.action || '') && !/^(validate|check|rerun|evaluate|project|compute|write)/.test(s.action || '')) f(`OFFLINE_PHASE_LIVE_STEP: ${id} action ${s.action}`);
      if (pid === 'P5' && BROWSER_LAUNCH_RE.test(s.action || '')) f(`OFFLINE_PHASE_BROWSER_STEP: ${id} action ${s.action}`);
      if (live && s.requiresFutureOwnerAuthorization !== true) f(`LIVE_STEP_WITHOUT_AUTHORIZATION_MARKER: ${id} action ${s.action}`);
      if (live && s.requiresFutureOwnerAuthorization === false) f(`STEP_MARKER_FALSE: ${id}`);
      if (LIVE_ACTION_RE.test(s.action || '') && (s.executed === true)) f(`LIVE_STEP_EXECUTED: ${id}`);
    });
  });
  if (consumeSteps !== 1) f(`ATTEMPT_CONSUMED_STEP_COUNT: expected exactly 1, found ${consumeSteps}`);
  const p0 = phases.find((p) => p && p.phaseId === 'P0');
  if (p0 && Array.isArray(p0.steps) && p0.steps.length && p0.steps[p0.steps.length - 1].effect !== 'attemptConsumed') f('ATTEMPT_CONSUMED_NOT_LAST_OF_P0');
  if (p0 && Array.isArray(p0.steps) && !p0.steps.some((s) => s.effect === 'recordSpent')) f('RECORD_SPENT_STEP_MISSING');
  for (const k of ['a', 'b', 'c']) if (!referencedClasses.has(k)) f(`STOP_CLASS_UNREFERENCED: class ${k} is referenced by no step`);

  // Evidence finalization order (Part 2 §13.3, §16; Appendix (iii) finalizationOrder / writesRule).
  checkFinalization(rb, phases, order, f);

  // Control steps agree with the control matrix.
  const cm = contract && contract.controlMatrix;
  if (cm && Array.isArray(cm.positiveControls)) {
    const required = cm.positiveControls.filter((c) => c.required).map((c) => c.id).sort();
    const p2 = phases.find((p) => p && p.phaseId === 'P2');
    const p2c = ((p2 && p2.steps) || []).filter((s) => s.control).map((s) => s.control).sort();
    if (JSON.stringify(required) !== JSON.stringify(p2c)) f(`P2_CONTROLS_MISMATCH: matrix requires ${JSON.stringify(required)}, P2 runs ${JSON.stringify(p2c)}`);
    const degrading = cm.positiveControls.filter((c) => !c.required).map((c) => c.id).sort();
    const p4 = phases.find((p) => p && p.phaseId === 'P4');
    const p4c = ((p4 && p4.steps) || []).filter((s) => s.control).map((s) => s.control).sort();
    if (JSON.stringify(degrading) !== JSON.stringify(p4c)) f(`P4_CONTROLS_MISMATCH: matrix degrading ${JSON.stringify(degrading)}, P4 runs ${JSON.stringify(p4c)}`);
  } else f('CONTROL_MATRIX_MISSING');

  findings.sort(); warnings.sort();
  return { ok: findings.length === 0, findings, warnings };
}
