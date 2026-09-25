// clashtest/derive/compare.js
import { ComparisonTooLargeError } from '../errors.js';
import { comparePairIds, pairSemanticsOf } from '../identity/ids.js';
import { canonicalJson } from '../util/canonical.js';
import { COMPARE_TOLERANCE_DEFAULTS } from '../options.js';   // P0 owns it (OPEN-4); no local definition here
import { buildStatusReaderSteps } from '../results/status.js';   // P5 (D4)
import { drive, assertCanonicalResultOrder } from './steps.js';
import { invalid } from './validate.js';
const near = (a, b, tol) => a === b || Math.abs(a - b) <= tol;              // a-b overflowing to Infinity is "not near", i.e. changed
const nearPoint = (p, q, tol) => (p === null || q === null ? p === q : p.every((v, i) => near(v, q[i], tol)));
const FLAGS = ['witnessUnavailable', 'duplicateEvidenceConflict', 'unreachableOwner', 'mixedOwnerProvenance'];

export function changedFieldsOf(a, b, _defA, _defB, tol) {
  if (a.mode !== b.mode) return ['mode'];
  if (a.mode === 'clearance' && a.evidence.clearance !== b.evidence.clearance) return ['clearance'];
  const f = [];
  if (a.mode === 'clearance') {
    if (!near(a.evidence.distance, b.evidence.distance, tol.distanceTolerance)) f.push('distance');
    const [p, q] = [a.evidence.closestPoints, b.evidence.closestPoints];
    if (!nearPoint(p.first, q.first, tol.pointTolerance) || !nearPoint(p.second, q.second, tol.pointTolerance)) f.push('closestPoints');
  } else if (a.mode === 'volume-overlap') {
    const [w, v] = [a.evidence.witness, b.evidence.witness];
    if (w === null || v === null) { if (w !== v) f.push('witnessKind'); }
    else { if (w.kind !== v.kind) f.push('witnessKind'); if (!nearPoint(w.point, v.point, tol.pointTolerance)) f.push('witnessPoint'); }
  }
  if (FLAGS.some((k) => !!a.flags?.[k] !== !!b.flags?.[k])) f.push('flags');
  return f;
}

const weaker = (x, y) => (x === 'deterministic' && y === 'deterministic' ? 'deterministic' : 'time-sensitive'); // unknown => weaker
const cls = (s) => (s.provenance.determinismClass === 'deterministic' ? 'deterministic' : 'time-sensitive');
const modelMap = (s) => new Map(s.provenance.models.map((m) => [m.modelKey, m]));

function comparabilityOf(base, next, conflictKeys) {
  const notes = []; const bm = modelMap(base); const nm = modelMap(next);
  let sameEnumeration = bm.size === nm.size; let sameVersions = bm.size === nm.size; let sameGen = base.provenance.registrySessionId === next.provenance.registrySessionId;
  for (const [k, m] of bm) {
    const n = nm.get(k); if (!n) { sameEnumeration = false; sameVersions = false; continue; }
    if (m.modelVersion !== n.modelVersion) sameVersions = false;
    if (canonicalJson(m.scopeDigests) !== canonicalJson(n.scopeDigests)) { sameEnumeration = false; notes.push(`scope-digest-mismatch:${k}`); }   // 15.2: independent of modelVersion
    if (m.placementGeneration !== n.placementGeneration) sameGen = false;
  }
  const bc = cls(base); const nc = cls(next); const dc = weaker(bc, nc);
  if (bc === 'time-sensitive') notes.push('time-sensitive:base');
  if (nc === 'time-sensitive') notes.push('time-sensitive:next');
  if (base.outcome.environmentSensitive) notes.push('environment-sensitive:base');
  if (next.outcome.environmentSensitive) notes.push('environment-sensitive:next');
  const lv = base.provenance.libraryVersion; const nv = next.provenance.libraryVersion;
  if (lv == null || nv == null) notes.push('library-version-unverified');
  const semB = base.testRef.semanticDigest; const semN = next.testRef.semanticDigest;
  return { sameDefinition: semB != null && semB === semN, sameModelVersions: sameVersions && conflictKeys.size === 0, sameEnumeration,
    sameLibraryVersion: lv == null || nv == null ? null : lv === nv, baseDeterminismClass: bc, nextDeterminismClass: nc, determinismClass: dc,
    placement: sameGen ? 'same-generation' : 'unverifiable', notes };
}

export const compareRunner = {
  optionKeys: ['signal', 'distanceTolerance', 'pointTolerance'],
  prepare(_args, opts) {
    const tol = { ...COMPARE_TOLERANCE_DEFAULTS };
    for (const k of ['distanceTolerance', 'pointTolerance']) if (opts[k] !== undefined) {
      if (!Number.isFinite(opts[k]) || opts[k] < 0) throw invalid('bad-tolerance', `options.${k}`);
      tol[k] = opts[k];
    }
    return { tol };
  },
  async run({ tol }, [base, next], { gate, limits }) {
    const bm = modelMap(base); const nm = modelMap(next);
    const conflictKeys = new Set([...bm].filter(([k, m]) => nm.has(k) && nm.get(k).modelVersion !== m.modelVersion).map(([k]) => k));
    const comparability = comparabilityOf(base, next, conflictKeys);
    await drive(assertCanonicalResultOrder(base.results, base.runId), gate);
    await drive(assertCanonicalResultOrder(next.results, next.runId), gate);
    const semB = base.definition ? pairSemanticsOf(base.definition.mode) : null; const semN = next.definition ? pairSemanticsOf(next.definition.mode) : null;
    const gated = semB !== null && semN !== null && semB !== semN;
    const out = { comparability, incomparable: gated ? { reason: 'pair-semantics-changed', base: semB, next: semN } : null,
      unchanged: [], changed: [], added: [], addedUnverifiedBase: [], resolved: [], removedUnverifiedNext: [], identityConflicts: [] };
    if (base.definition && next.definition && base.definition.mode === 'containment' && next.definition.mode === 'containment'
      && canonicalJson(base.definition.selectionA) === canonicalJson(next.definition.selectionB) && canonicalJson(base.definition.selectionB) === canonicalJson(next.definition.selectionA)
      && canonicalJson(base.definition.selectionA) !== canonicalJson(base.definition.selectionB)) comparability.notes.push('containment-orientation-reversed');
    const [baseReader, nextReader] = gated ? [null, null] : [await drive(buildStatusReaderSteps(base), gate), await drive(buildStatusReaderSteps(next), gate)]; // indexes built ONCE per side
    const ts = comparability.determinismClass === 'time-sensitive';
    let entries = 0;
    const push = (list, entry) => { entries += 1; if (entries > limits.maxComparisonEntries) throw new ComparisonTooLargeError({ limit: limits.maxComparisonEntries, observed: entries }); list.push(entry); };
    const conflict = (pair) => conflictKeys.has(pair.first.modelKey) || conflictKeys.has(pair.second.modelKey);
    const A = base.results; const B = next.results; let i = 0; let j = 0;
    while (i < A.length || j < B.length) {
      const a = A[i]; const b = B[j];
      const c = a === undefined ? 1 : b === undefined ? -1 : comparePairIds(a.pair, b.pair);
      const pair = (c <= 0 ? a : b).pair;
      if (conflict(pair)) push(out.identityConflicts, { pairId: pair });
      else if (!gated) {
        if (c === 0) {
          const fields = changedFieldsOf(a, b, base.definition, next.definition, tol);
          if (fields.length === 0) push(out.unchanged, { pairId: pair, baseResultId: a.resultId, nextResultId: b.resultId });
          else push(out.changed, { pairId: pair, baseResultId: a.resultId, nextResultId: b.resultId, changedFields: fields });
        } else if (c < 0) {
          const clean = nextReader.pairStatus(pair).verdict === 'covered-clean';
          push(clean ? out.resolved : out.removedUnverifiedNext, { pairId: pair, baseResultId: a.resultId, ...(clean && ts ? { timeSensitive: true } : {}) });
        } else {
          const clean = baseReader.pairStatus(pair).verdict === 'covered-clean';
          push(clean ? out.added : out.addedUnverifiedBase, { pairId: pair, nextResultId: b.resultId, ...(clean && ts ? { timeSensitive: true } : {}) });
        }
      }
      if (c <= 0) i += 1; if (c >= 0) j += 1;
      const p = gate.tick(); if (p !== undefined) await p;
    }
    return out;
  },
};
