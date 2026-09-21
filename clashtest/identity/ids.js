// clashtest/identity/ids.js
//
// Pure durable-identity functions (spec §4.4, §4.5). This module imports NOTHING: it has no way to
// reach a Model, a loadEpoch or a modelId, and it never invents a stronger identity than
// (modelKey, dbId).

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/** @param {unknown} v */
export const isValidModelKey = isNonEmptyString;

/** dbId is model-local: a non-negative safe integer (spec §4.4). @param {unknown} v */
export function isValidDbId(v) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** UTF-16 code-unit order — the spec's "code-unit comparison". `<`/`>` on strings is exactly that. */
export function compareModelKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @param {string} modelKey
 * @param {number} dbId
 * @returns {Readonly<{modelKey: string, dbId: number}>}
 */
export function makeElementRef(modelKey, dbId) {
  if (!isValidModelKey(modelKey)) throw new TypeError('ElementRef.modelKey must be a non-empty string');
  if (!isValidDbId(dbId)) throw new TypeError('ElementRef.dbId must be a non-negative safe integer');
  return Object.freeze({ modelKey, dbId: dbId + 0 }); // + 0 turns -0 into 0
}

/** Copies exactly the two identity fields; every other property of `value` is dropped. */
export function elementRefFrom(value) {
  if (typeof value !== 'object' || value === null) throw new TypeError('ElementRef source must be an object');
  return makeElementRef(value.modelKey, value.dbId);
}

/** Element order (spec §4.4). Hot-path comparator: callers pass already-valid refs. */
export function compareElementRefs(a, b) {
  return compareModelKeys(a.modelKey, b.modelKey) || (a.dbId < b.dbId ? -1 : a.dbId > b.dbId ? 1 : 0);
}

/**
 * Collision-free, ORDER-PRESERVING Map/Set key for an ElementRef (reconciliation N12): for valid refs,
 * elementRefKey(a) < elementRefKey(b)  <=>  compareElementRefs(a, b) < 0, and keys are equal iff refs are.
 * Encoding: the modelKey with every U+0000 doubled to U+0000 U+0001, then the terminator U+0000 U+0000, then the
 * dbId as exactly 16 zero-padded digits (Number.MAX_SAFE_INTEGER has 16). Any code unit of a modelKey other
 * than U+0000 sorts above the terminator's second unit, and the doubled escape sorts above the terminator, so a
 * modelKey that is a prefix of another sorts first exactly as in compareModelKeys. Validating (unlike
 * compareElementRefs): it is called once per element, never in a comparator hot loop.
 */
export function elementRefKey(ref) {
  if (typeof ref !== 'object' || ref === null || !isValidModelKey(ref.modelKey) || !isValidDbId(ref.dbId)) {
    throw new TypeError('elementRefKey needs a valid ElementRef {modelKey, dbId}');
  }
  return `${ref.modelKey.replace(/\u0000/g, '\u0000\u0001')}\u0000\u0000${String(ref.dbId).padStart(16, '0')}`;
}

// ---- pair semantics (spec §4.5) -------------------------------------------------------------------

/** The four modes of spec §5.1, and the ONLY code home of the list (P2's validator imports it). */
export const CLASH_MODES = Object.freeze(['volume-overlap', 'surface-intersection', 'containment', 'clearance']);

const SEMANTICS_BY_MODE = new Map([
  ['volume-overlap', 'unordered'],
  ['surface-intersection', 'unordered'],
  ['clearance', 'unordered'],
  ['containment', 'ordered'],
]);

/** Symmetry class is derived, never chosen (spec §4.5). */
export function pairSemanticsOf(mode) {
  const semantics = SEMANTICS_BY_MODE.get(mode);
  if (semantics === undefined) throw new TypeError(`Unknown clash mode: ${String(mode)}`);
  return semantics;
}

/** A PairId is comparable only within one pair-semantics class (spec §4.4, §15.4). */
export function sameSemanticsClass(modeA, modeB) {
  return pairSemanticsOf(modeA) === pairSemanticsOf(modeB);
}

// ---- PairId (spec §4.4) ---------------------------------------------------------------------------

/**
 * @param {string} mode
 * @param {{modelKey: string, dbId: number}} x  for `containment`: the CONTAINED element (library source)
 * @param {{modelKey: string, dbId: number}} y  for `containment`: the CONTAINER (library target)
 * @returns {Readonly<{first: object, second: object}>}
 */
export function makePairId(mode, x, y) {
  const semantics = pairSemanticsOf(mode);
  const a = elementRefFrom(x);
  const b = elementRefFrom(y);
  const order = compareElementRefs(a, b);
  if (order === 0) throw new RangeError('A PairId needs two distinct elements');
  const inOrder = semantics === 'ordered' || order < 0;
  return Object.freeze({ first: inOrder ? a : b, second: inOrder ? b : a });
}

/** Canonical result order of spec §11.3. */
export function comparePairIds(p, q) {
  return compareElementRefs(p.first, q.first) || compareElementRefs(p.second, q.second);
}

// ---- ResultId (spec §4.4) -------------------------------------------------------------------------

/** Format of every durable digest (spec §5.4): "sha256:" + 64 lowercase hex. */
export const SEMANTIC_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function isSemanticDigest(value) {
  return typeof value === 'string' && SEMANTIC_DIGEST_PATTERN.test(value);
}

/**
 * ResultId = (testId, semanticDigest, PairId), canonical string form
 * JSON.stringify([testId, semanticDigest, first.modelKey, first.dbId, second.modelKey, second.dbId]).
 * Arity is deliberately 3: revision, runId, epoch, unit, broad-phase and Model cannot enter the identity.
 * `pairId` is expected to come from makePairId (the mode-dependent ordering is not re-derivable here).
 */
export function makeResultId(testId, semanticDigest, pairId) {
  if (!isNonEmptyString(testId)) throw new TypeError('testId must be a non-empty string');
  if (!isSemanticDigest(semanticDigest)) throw new TypeError('semanticDigest must be "sha256:" + 64 lowercase hex');
  if (typeof pairId !== 'object' || pairId === null) throw new TypeError('pairId must be an object');
  const first = elementRefFrom(pairId.first);
  const second = elementRefFrom(pairId.second);
  if (compareElementRefs(first, second) === 0) throw new RangeError('A PairId needs two distinct elements');
  return JSON.stringify([testId, semanticDigest, first.modelKey, first.dbId, second.modelKey, second.dbId]);
}

/** Inverse of makeResultId; null for anything that is not byte-identical canonical output. */
export function parseResultId(text) {
  if (typeof text !== 'string') return null;
  let parts;
  try { parts = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(parts) || parts.length !== 6) return null;
  const [testId, semanticDigest, k1, d1, k2, d2] = parts;
  try {
    const pairId = Object.freeze({ first: makeElementRef(k1, d1), second: makeElementRef(k2, d2) });
    return makeResultId(testId, semanticDigest, pairId) === text ? { testId, semanticDigest, pairId } : null;
  } catch {
    return null;
  }
}
