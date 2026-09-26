// clashpanel/core/runReport.js
//
// Panel-owned wording (spec §7.3, §7.5, §13; SPEC §20). Pure functions over SEALED data only.
// Rules: (1) never the bare phrase "No clashes" — the only sentences that start with it are the two
// §7.5 claim statements, emitted only when Core's `assessNoClashClaim` said `allowed` AND the completed live
// freshness of the SAME (claim, freshness) pair is `current` (review H1); (2) the gap
// list is RECOMPUTED here from `outcome` + `ledger` because Core's claim result does not say which
// conjunct failed (it mirrors clashtest/results/claim.js:51-63 conjunct for conjunct); (3) every
// string is plain text — untrusted text (error messages, model names, reasons) passes through
// unchanged and the UI inserts it with textContent (AC-P13); (4) `provenance.models[].elementCount`
// is never read (G-EC, AC-P12); (5) Core errors are discriminated by `error.name` (§13 rule 4).

export const STATEMENTS = Object.freeze({
  CLAIM: 'No clashes found in the evaluated scope.',
  QUALIFIED_CLAIM: 'No clashes found, excluding the hierarchy-internal pairs recorded in ledger.hierarchyInternal.',
  NON_CLAIM: '0 clashes reported — this is not a clearance.',
  CLAIM_PENDING: '0 clashes reported — checking whether this is a clearance…',
  STALE: 'Results describe a previous model/placement state.',
  NO_CONFIRMATION: 'The clash engine did not confirm a clearance for this run.',
  ENGINE_FAILED: 'The clash engine failed. Details are available to copy.',
  NO_RESULT_SET: 'The clash engine failed and produced no result set. Details are available to copy.',
  MODEL_CHANGED: 'The model changed during the run — results are partial and stale',
  HELD_IN_MEMORY: 'Results are held in memory only.',
  SETUP_CHANGED: 'The test setup changed since this run — run it again to see results for the new setup.',
  DIAGNOSTICS_TRUNCATED: 'Diagnostic detail was truncated',
});

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtInt = (n) => (Number.isFinite(n) ? Math.trunc(n).toLocaleString('en-US') : String(n));
const list = (v) => (Array.isArray(v) ? v : []);

// ---- axes -------------------------------------------------------------------------------------------

/** The three always-visible badges (spec §7.3). `freshness` is the live {state,reasons} from
 *  engine.getFreshness, or null while the check is pending (then the at-seal value is shown). */
export function describeAxes(outcome, freshness) {
  const coverage = outcome?.coverage === 'full' ? 'full' : 'partial';
  const integrity = outcome?.integrity === 'clean' ? 'clean' : 'caveated';
  const live = freshness && typeof freshness.state === 'string' ? freshness.state : null;
  const value = live ?? (typeof outcome?.freshness === 'string' ? outcome.freshness : 'unverifiable');
  return Object.freeze({
    coverage: Object.freeze({ value: coverage, label: `Coverage: ${coverage}` }),
    integrity: Object.freeze({ value: integrity, label: `Integrity: ${integrity}` }),
    freshness: Object.freeze({
      value,
      label: live === null ? `Freshness: ${value} (at seal) — checking freshness…` : `Freshness: ${value}`,
      pending: live === null,
    }),
  });
}

// ---- no-clash gap explanation (mirror of clashtest/results/claim.js conjuncts) -------------------------

const FRESHNESS_STATES = ['current', 'stale', 'unverifiable'];
function freshnessState(f) {
  if (typeof f === 'string') return FRESHNESS_STATES.includes(f) ? f : null;
  if (f === null || typeof f !== 'object') return null;
  return FRESHNESS_STATES.includes(f.state) && Array.isArray(f.reasons) ? f.state : null;
}

const NOT_COMPLETED_TEXT = {
  cancelled: 'The run was stopped before it finished.',
  failed: 'The run failed before it finished.',
  invalidated: 'The model changed during the run.',
};

/**
 * Every failed conjunct of the §8.3 claim predicate EXCEPT `noResults` (results are positives, not a
 * gap), in claim.js order. `freshness` defaults to the at-seal `outcome.freshness`; pass the live
 * engine.getFreshness value when known. The digest-version conjunct cannot be evaluated here (the
 * known DIGEST_VERSION is not exported from the barrel), so it is read from Core's own claim result
 * when supplied (`qualifiers` carries `{kind:'digest-version'}` exactly when that conjunct failed).
 */
export function explainNoClashGaps(resultSet, { freshness, claim = null } = {}) {
  const outcome = resultSet?.outcome ?? {};
  const ledger = resultSet?.ledger ?? {};
  const provenance = resultSet?.provenance ?? {};
  const gaps = [];
  const add = (code, text) => gaps.push(Object.freeze({ code, text }));
  if (outcome.status !== 'completed') add('not-completed', NOT_COMPLETED_TEXT[outcome.status] ?? 'The run did not complete.');
  if (outcome.coverage !== 'full') add('partial-coverage', 'Coverage is partial — some parts of the scope were not evaluated.');
  if (outcome.integrity !== 'clean') add('caveated', 'Integrity is caveated — some evaluated parts carry caveats.');
  const fs = freshnessState(freshness === undefined ? outcome.freshness : freshness);
  if (fs !== 'current') {
    add('stale', fs === 'stale' ? STATEMENTS.STALE : 'Freshness could not be verified against the current models.');
  }
  if (claim !== null && list(claim.qualifiers).some((q) => q?.kind === 'digest-version')) {
    add('unknown-digest-version', 'The result set uses a digest version this engine does not know, so it cannot support a clearance.');
  }
  if (!(Number.isSafeInteger(ledger.pairSpaceTotal) && ledger.pairSpaceTotal > 0)) {
    add('zero-pair-space', 'There was nothing to compare — the evaluated pair space is empty.');
  }
  if (ledger.emptyOperand === true) add('empty-operand', 'Set A or Set B resolved to no elements.');
  const unresolved = list(ledger.unresolvedSelections).length;
  if (unresolved > 0) add('unresolved-selection', `${plural(unresolved, 'selection entry', 'selection entries')} could not be resolved.`);
  const unreachable = list(ledger.unreachablePopulation).length;
  if (unreachable > 0) add('unreachable-population', `Some elements could not be reached through the model's element tree (${plural(unreachable, 'record', 'records')}).`);
  const hierarchy = list(ledger.hierarchyInternal);
  if (hierarchy.length > 0 && (provenance.hierarchyInternalAcceptance ?? null) === null) {
    add('hierarchy-internal', 'Some pairs lie inside one element hierarchy (a parent and its own child) and were not evaluated.');
  }
  return gaps;
}

// ---- empty-result statements (spec §7.5) -----------------------------------------------------------------

function selectionText(selection, modelName) {
  const parts = list(selection?.entries).map((e) => (e?.kind === 'model'
    ? `whole model ${modelName(e.modelKey)}`
    : `${plural(list(e?.dbIds).length, 'element', 'elements')} of ${modelName(e?.modelKey)}`));
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

/** Scope summary shown under the claim (from the SEALED definition only). */
export function scopeSummary(resultSet, modelName = (k) => String(k)) {
  const d = resultSet?.definition ?? null;
  if (d === null) return [];
  return [`Set A: ${selectionText(d.selectionA, modelName)}`, `Set B: ${selectionText(d.selectionB, modelName)}`];
}

/**
 * The empty-results statement. `claim` = engine.assessNoClashClaim result (null while pending);
 * `freshness` = live engine.getFreshness result (null while pending). Returns null when there are
 * results (those are positives, spec §7.5 row 4) or no set at all.
 *
 * CLAIM GATE (review H1). Engine.getFreshness and engine.assessNoClashClaim each recompute live freshness, so
 * the two results can disagree (claim.allowed at t1, stale at t2). This function is the single, pure decision
 * over ONE pair — the caller (T17's controller snapshot) passes both halves committed together, never one half
 * from an earlier read:
 *   claim === null || freshness === null          ⇒ pending (STATEMENTS.CLAIM_PENDING)
 *   claim.allowed === true ∧ state === 'current'  ⇒ claim / qualified-claim   (the ONLY clearance wording)
 *   completed stale | unverifiable                ⇒ 'stale' non-claim (even if claim.allowed was true)
 *   anything else (disallowed, malformed read)    ⇒ non-claim
 * `freshness` is interpreted ONCE (`liveState`), so the gate and the gap list can never see different values.
 */
export function emptyStatement({ resultSet, claim = null, freshness = null, modelName = (k) => String(k) }) {
  if (!resultSet || list(resultSet.results).length > 0) return null;
  const make = (kind, text, lines) => Object.freeze({ kind, text, lines: Object.freeze(lines) });
  const liveState = freshnessState(freshness);
  if (claim !== null && claim.allowed === true && liveState === 'current') {
    return claim.unqualified === true
      ? make('claim', STATEMENTS.CLAIM, scopeSummary(resultSet, modelName))
      : make('qualified-claim', STATEMENTS.QUALIFIED_CLAIM, list(resultSet.ledger?.hierarchyInternal).map(
        (h) => `${modelName(h.modelKey)}: ${plural(h.rootCount, 'root', 'roots')}, ${plural(h.ownerCount, 'owner', 'owners')}`));
  }
  const gaps = explainNoClashGaps(resultSet, { freshness: freshness ?? undefined, claim });   // pending ⇒ explain from the at-seal value
  if (claim === null || freshness === null) return make('non-claim', STATEMENTS.CLAIM_PENDING, gaps.map((g) => g.text));
  if (liveState === 'stale' || liveState === 'unverifiable') {
    return make('stale', STATEMENTS.NON_CLAIM, [STATEMENTS.STALE,
      ...list(freshness.reasons).filter((r) => typeof r === 'string').map((r) => `Reason: ${r}`),
      ...gaps.filter((g) => g.code !== 'stale').map((g) => g.text)]);
  }
  const lines = gaps.map((g) => g.text);
  return make('non-claim', STATEMENTS.NON_CLAIM, lines.length > 0 ? lines : [STATEMENTS.NO_CONFIRMATION]);
}

// ---- sealed failures (spec §13) -----------------------------------------------------------------------

const UNEXPECTED = new Set(['internal-error', 'world-disposed']);
const PLANNING_TEXT = {
  'model-not-bound': 'A model in the test is not loaded or not registered.',
  'element-unresolvable': 'An element in the selection no longer exists.',
  'owner-mapping-mismatch': "The model's element ownership could not be mapped consistently.",
  'hierarchy-overlap': 'Set A and Set B contain a parent and its own child.',
  'plan-too-large': 'The test is too large to plan — narrow the selections.',
  'test-unavailable': 'The test definition was unavailable.',
  'definition-invalid': 'The test definition was rejected.',
  'schema-unsupported': 'The test uses a definition version this engine does not support.',
  'migration-failed': 'The test definition could not be migrated.',
  cancelled: 'The run was stopped while it was being planned.',
};
const ENUMERATION_LIKELY_CAUSES = Object.freeze([
  "Couldn't read the model's element tree.",
  'Likely causes (not confirmed by the engine): the model is still loading; the whole model is larger than the collision engine accepts in one pass; an element exceeds the extraction bounds.',
  'Action: wait for the model to finish loading, or narrow the scope.',
]);
const UNIT_CAUSE_TEXT = {
  'extraction-limit': 'an element exceeded the extraction bounds',
  'capacity-exceeded': 'collision capacity was exceeded',
  'unit-cap': 'the run reached its unit limit',
  'object-tree-unavailable': "the model's element tree was unavailable",
  'target-too-large': 'the target was too large',
  'model-evicted': 'a model was unloaded',
  'stale-placement': 'the model placement kept changing',
  'scope-drift': 'the model changed',
  'scope-unverifiable': 'the model state could not be verified',
  'input-changed': 'the model moved',
  'result-cap': 'the result limit was reached',
  'internal-error': 'an internal error occurred',
  'world-disposed': 'the collision world was disposed',
  cancelled: 'the run was stopped',
  'run-failed': 'the run failed',
};
const NOT_EVALUATED = new Set(['failed', 'skipped', 'discarded', 'not-run']);

function causesOf(resultSet) {
  const ledger = resultSet?.ledger ?? {};
  const planning = [...new Set(list(ledger.planningGaps).map((g) => g?.cause).filter((c) => typeof c === 'string'))];
  const units = list(ledger.units).filter((u) => NOT_EVALUATED.has(u?.outcome));
  const reasons = list(resultSet?.outcome?.reasons);
  const unitCauses = new Set(units.map((u) => u.cause).filter((c) => typeof c === 'string'));
  for (const r of reasons) if (typeof r === 'string' && r.startsWith('unit:')) unitCauses.add(r.slice(5));
  for (const r of reasons) if (typeof r === 'string' && r.startsWith('planning:') && !planning.includes(r.slice(9))) planning.push(r.slice(9));
  return { planning, units, unitCauses };
}

/** "N parts could not be evaluated (cause)" lines, one per distinct cause, in cause order. */
export function unitGapLines(resultSet) {
  const byCause = new Map();
  for (const u of causesOf(resultSet).units) {
    const c = typeof u.cause === 'string' ? u.cause : 'unknown';
    byCause.set(c, (byCause.get(c) ?? 0) + 1);
  }
  return [...byCause.keys()].sort().map((c) => `${plural(byCause.get(c), 'part', 'parts')} could not be evaluated (${UNIT_CAUSE_TEXT[c] ?? c}).`);
}

function resultCapHeadline(resultSet) {
  const cap = resultSet?.provenance?.runOptions?.maxResultsPerRun;
  return `Too many clashes — stopped at the result limit (${Number.isFinite(cap) ? fmtInt(cap) : 'the run\'s result limit'}).`;
}

function failedDetails(resultSet) {
  const { planning, unitCauses } = causesOf(resultSet);
  if (planning.some((c) => UNEXPECTED.has(c)) || [...unitCauses].some((c) => UNEXPECTED.has(c))) {
    return { headline: STATEMENTS.ENGINE_FAILED, details: [] };
  }
  if (unitCauses.has('result-cap')) {
    const soft = resultSet?.definition?.mode === 'clearance';
    return {
      headline: resultCapHeadline(resultSet),
      details: [
        'Retained results come from whole parts evaluated before the limit.',
        soft
          ? 'Action: narrow the selection, or reduce the clearance — a larger clearance broadens matching and can reproduce or worsen the failure.'
          : 'Action: narrow the selection.',
      ],
    };
  }
  if (planning.includes('enumeration-failed')) {
    const others = planning.filter((c) => c !== 'enumeration-failed').map((c) => PLANNING_TEXT[c] ?? c);
    return { headline: ENUMERATION_LIKELY_CAUSES[0], details: [...ENUMERATION_LIKELY_CAUSES.slice(1), ...others] };
  }
  if (planning.length > 0) {
    // Duplicate rows (e.g. two owner-mapping-mismatch gaps, frozen-Core residual M2) collapse to one line.
    return { headline: 'The test could not be planned.', details: planning.map((c) => PLANNING_TEXT[c] ?? c) };
  }
  return { headline: 'The run failed.', details: [] };
}

/** Headline for a finished run (spec §7.3). `resultSet` refines `failed` by cause (§13); pass
 *  `resultSet: null` when Core's fallback seal failed. */
export function runHeadline({ status, total, coverage, resultSet }) {
  const n = Number.isFinite(total) ? total : 0;
  switch (status) {
    case 'completed':
      return `Completed — ${plural(n, 'clash', 'clashes')}${coverage === 'partial' ? ' (partial coverage)' : ''}`;
    case 'cancelled':
      return n > 0 ? `Stopped — partial results (${fmtInt(n)})` : 'Stopped before any results';
    case 'invalidated':
      return STATEMENTS.MODEL_CHANGED;
    case 'failed':
      if (resultSet === null) return STATEMENTS.NO_RESULT_SET;
      return resultSet ? failedDetails(resultSet).headline : 'The run failed.';
    default:
      return 'The run ended.';
  }
}

/** §13 table for a sealed set: headline by status/cause, detail lines (planning causes, unit-level
 *  gaps, truncated diagnostics) and a note about retained results. */
export function mapSealedFailure(resultSet) {
  if (!resultSet) return Object.freeze({ headline: STATEMENTS.NO_RESULT_SET, details: Object.freeze([]), retainedNote: null });
  const status = resultSet.outcome?.status;
  const total = list(resultSet.results).length;
  let headline;
  let details = [];
  if (status === 'failed') ({ headline, details } = failedDetails(resultSet));
  else headline = runHeadline({ status, total, coverage: resultSet.outcome?.coverage, resultSet });
  if (status === 'cancelled' && total === 0) {
    const planningCancel = causesOf(resultSet).planning.includes('cancelled');
    if (planningCancel) details = [PLANNING_TEXT.cancelled];
  }
  const unitLines = unitGapLines(resultSet);
  const allDetails = [...details, ...unitLines];
  if (resultSet.diagnostics?.truncated === true) allDetails.push(STATEMENTS.DIAGNOSTICS_TRUNCATED);
  const partialish = status !== 'completed' || resultSet.outcome?.coverage !== 'full';
  const retainedNote = total > 0 && partialish
    ? `${plural(total, 'clash', 'clashes')} found ${status === 'completed' ? '' : 'before the run ended '}are valid; parts that were not evaluated are unknown.`
    : null;
  return Object.freeze({ headline, details: Object.freeze(allDetails), retainedNote });
}

// ---- admission errors (startRun threw; spec §7.1, §13) -------------------------------------------------

/** `heldRunId` = the runId of the set the Panel currently holds (null if none). The Release-and-retry
 *  action is offered ONLY when a ResultCapacityError names that set among its blockers. */
export function mapAdmissionError(error, { heldRunId = null } = {}) {
  const name = typeof error?.name === 'string' ? error.name : '';
  const out = (text, action = null) => Object.freeze({ text, action });
  switch (name) {
    case 'InvalidTestDefinitionError':
      return out('The test setup is invalid — fix the highlighted fields and run again.');
    case 'UnsupportedSchemaVersionError':
      return out('The test uses a definition version this clash engine does not support.');
    case 'StoreNotConfiguredError':
      return out('This run needs a store that the clash engine does not have configured.');
    case 'InvalidOptionsError':
      return out('The clash engine rejected the run options.');
    case 'ResultCapacityError': {
      const blockers = [...list(error.active), ...list(error.retained), ...list(error.held).map((h) => h?.runId)];
      return heldRunId !== null && blockers.includes(heldRunId)
        ? out('The clash engine is at capacity. Clear previous results and try again.', 'release-and-retry')
        : out('The clash engine is at capacity: its result slots are held by other runs. Try again after they are released.');
    }
    case 'RunQueueFullError':
      return out('The clash engine is at capacity: too many runs are waiting. Try again when they finish.');
    case 'EngineDisposedError':
      return out('The clash engine has been shut down. Reload the page to run tests again.');
    default: {
      const msg = typeof error?.message === 'string' && error.message !== '' ? `: ${error.message}` : '.';
      return out(`The run could not be started${msg}`);
    }
  }
}

// ---- banners -----------------------------------------------------------------------------------------

/** Banner = {id, kind:'info'|'warning'|'error', text, details?}. `terminal` = runMachine terminal;
 *  `persistence` = the displayed set's current persistence `{state}` (null if unknown). */
export function bannersFor({ terminal, resultSet, freshness = null, setupChanged = false, persistence = null }) {
  const banners = [];
  const push = (id, kind, text, details) => banners.push(Object.freeze({ id, kind, text, ...(details && details.length ? { details: Object.freeze(details) } : {}) }));
  if (terminal && terminal.resultSetPresent === false) push('no-result-set', 'error', STATEMENTS.NO_RESULT_SET);
  if (resultSet) {
    const status = resultSet.outcome?.status;
    const report = mapSealedFailure(resultSet);
    if (status === 'failed') push('failed', 'error', report.headline, report.details);
    if (status === 'invalidated') push('invalidated', 'warning', STATEMENTS.MODEL_CHANGED, report.details);
    if (status === 'cancelled') push('cancelled', 'info', report.headline, report.details);
    if (status === 'completed' && resultSet.outcome?.coverage !== 'full') {
      push('partial', 'warning', 'Coverage is partial — results cover only the parts that were evaluated.',
        [...unitGapLines(resultSet), ...(report.retainedNote ? [report.retainedNote] : [])]);
    }
    const live = freshnessState(freshness);
    const effective = live ?? freshnessState(resultSet.outcome?.freshness);
    if (effective === 'stale' || effective === 'unverifiable') {
      const reasons = live !== null ? list(freshness.reasons).filter((r) => typeof r === 'string') : [];
      push('stale', 'warning', STATEMENTS.STALE, [...reasons.map((r) => `Reason: ${r}`), 'Run the test again to refresh.']);
    }
  }
  if (setupChanged === true) push('setup-changed', 'info', STATEMENTS.SETUP_CHANGED);
  if (persistence && (persistence.state === 'failed' || persistence.state === 'skipped') && resultSet) {
    push('held-unsaved', 'info', STATEMENTS.HELD_IN_MEMORY);
  }
  return banners;
}

// ---- diagnostics export (spec §8.4, §13) -------------------------------------------------------------

/** Plain JSON of `outcome`, `ledger.planningGaps` and `diagnostics` (its `truncated` flag preserved). */
export function diagnosticsExport(resultSet) {
  if (!resultSet) return JSON.stringify({ resultSet: null }, null, 2);
  return JSON.stringify({
    runId: resultSet.runId ?? null,
    outcome: resultSet.outcome ?? null,
    planningGaps: resultSet.ledger?.planningGaps ?? [],
    diagnostics: resultSet.diagnostics ?? null,
  }, null, 2);
}
