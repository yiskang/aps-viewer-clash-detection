// clashpanel/core/testDrafts.js
// Spec §26.2 (a) / §26.4 and independent Work review M1: pure helpers over draft.js drafts for the Clash Tests
// manager. No clock, no id source, no global. `isLoadableDraft` is THE load-intent input invariant: a frozen draft in
// the EXACT canonical draft.js form whose testId is exactly the supplied testId. It is TOTAL (Work plan review M1):
// any exception from a hostile accessor or proxy trap is caught and the draft is refused — never thrown to the editor.
import { createDraft, draftReduce } from './draft.js';
import { isBasisChoice } from './measurementBasis.js';

const MAX_NAME = 256;   // Core schema bound for `name` (same value as draft.js MAX_NAME; §26.4 truncation)

// The canonical field sets (draft.js createDraft/freezeDraft/prepareRun). Sorted, compared as sets.
const DRAFT_KEYS = Object.freeze(['basisUnit', 'clearance', 'lastRun', 'mode', 'name', 'revision', 'selfClash', 'setA', 'setB', 'testCounter', 'testId']);
const SIDE_KEYS = Object.freeze(['elements', 'modelKeys']);
const LAST_RUN_KEYS = Object.freeze(['definitionKey', 'revision']);

const isDataProp = (obj, key) => {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  return d !== undefined && Object.prototype.hasOwnProperty.call(d, 'value') && d.enumerable === true;
};
/** A frozen object with Object.prototype whose own keys are exactly `keys` (strings only), each a plain data property. */
function isExactRecord(v, keys) {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype || !Object.isFrozen(v)) return false;
  const own = Reflect.ownKeys(v);
  return own.length === keys.length && keys.every((k) => isDataProp(v, k));
}
/** A frozen plain array of data-property elements and nothing else. */
function isExactArray(v) {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || !Object.isFrozen(v)) return false;
  if (Reflect.ownKeys(v).length !== v.length + 1) return false;                         // indices + `length` only
  for (let i = 0; i < v.length; i += 1) if (!isDataProp(v, String(i))) return false;
  return true;
}
const strictlyAscending = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] < x);   // sorted AND unique (draft.js canonical form)

/** A side exactly as draft.js freezes it: frozen side, frozen sorted-unique modelKeys, frozen non-empty sorted-unique id lists. */
function isSide(side) {
  if (!isExactRecord(side, SIDE_KEYS)) return false;
  const { modelKeys, elements } = side;
  if (!isExactArray(modelKeys) || !modelKeys.every((k) => typeof k === 'string' && k.length > 0) || !strictlyAscending(modelKeys)) return false;
  if (elements === null || typeof elements !== 'object' || Array.isArray(elements) || Object.getPrototypeOf(elements) !== Object.prototype || !Object.isFrozen(elements)) return false;
  const keys = Reflect.ownKeys(elements);
  // Any string key draft.js's setElements can produce (normalizeElements keeps every key with ≥ 1 valid id) …
  if (!keys.every((key) => typeof key === 'string' && isDataProp(elements, key))) return false;
  // … in exactly the own-key order normalizeElements yields (keys defined in sorted order), and ids as normalizeIds
  // yields them: safe integers ≥ 0, never -0 (draft.js maps -0 to 0), sorted and unique.
  if (keys.join('\u0000') !== canonicalKeyOrder(keys).join('\u0000')) return false;
  return keys.every((key) => {
    const ids = elements[key];
    return isExactArray(ids) && ids.length > 0 && ids.every((id) => Number.isSafeInteger(id) && id >= 0 && !Object.is(id, -0)) && strictlyAscending(ids);
  });
}

/** The own-key order of an object whose keys were defined in sorted order (integer-like keys enumerate first). */
function canonicalKeyOrder(keys) {
  const probe = {};
  for (const key of [...keys].sort()) Object.defineProperty(probe, key, { value: 0, enumerable: true });
  return Reflect.ownKeys(probe);
}

function isLoadableDraftUnsafe(draft, testId) {
  if (typeof testId !== 'string' || testId.length === 0) return false;
  if (!isExactRecord(draft, DRAFT_KEYS) || draft.testId !== testId) return false;
  const revision = draft.revision;
  if (!Number.isSafeInteger(revision) || revision < 1) return false;
  if (typeof draft.name !== 'string' || (draft.mode !== 'hard' && draft.mode !== 'soft')) return false;
  if (typeof draft.clearance !== 'string' || typeof draft.selfClash !== 'boolean' || !isBasisChoice(draft.basisUnit)) return false;
  if (!Number.isSafeInteger(draft.testCounter) || draft.testCounter < 1) return false;
  if (!isSide(draft.setA) || !isSide(draft.setB)) return false;
  const lastRun = draft.lastRun;
  if (lastRun === null) return true;
  // prepareRun (draft.js:195-196) writes lastRun.revision and draft.revision together; no reducer changes either.
  return isExactRecord(lastRun, LAST_RUN_KEYS) && typeof lastRun.definitionKey === 'string' && lastRun.definitionKey.length > 0
    && lastRun.revision === revision;
}

/**
 * Every value is read through ordinary property access exactly as the editor will later read it, so a throwing `get`
 * trap is exercised here. On a frozen target a proxy cannot report a different value for a non-writable,
 * non-configurable data property (Proxy invariants), so an accepted draft reads the same values afterwards.
 */
export function isLoadableDraft(draft, testId) {
  try {
    return isLoadableDraftUnsafe(draft, testId) === true;
  } catch {
    return false;
  }
}

/**
 * §26.4 Duplicate: a NEW draft (new testId, revision 1, lastRun null) with a copy of the setup — mode, clearance
 * text, self-clash, Set A, Set B and the basis attestation (applied LAST: the reducer drops an attestation whenever
 * the participant set changes, so it must be set after the sets). Built only through draft.js's public reducer.
 */
export function duplicateDraft(source, { testId, name }) {
  let d = createDraft({ testId, testNumber: source.testCounter });
  d = draftReduce(d, { type: 'name', value: name });
  d = draftReduce(d, { type: 'mode', value: source.mode });
  d = draftReduce(d, { type: 'clearance', value: source.clearance });
  d = draftReduce(d, { type: 'selfClash', value: source.selfClash });
  for (const [side, key] of [['A', 'setA'], ['B', 'setB']]) {
    for (const modelKey of source[key].modelKeys) d = draftReduce(d, { type: 'toggleModel', side, modelKey });
    d = draftReduce(d, { type: 'setElements', side, elements: source[key].elements });
  }
  if (source.basisUnit !== '') d = draftReduce(d, { type: 'basisUnit', value: source.basisUnit });
  return d;
}

/** `<name> copy`, else `<name> copy 2`, `copy 3`, … — the first not in `existingNames`; ≤ 256 characters. */
export function duplicateName(name, existingNames) {
  const taken = new Set(existingNames);
  const fit = (suffix) => `${name.length + suffix.length > MAX_NAME ? name.slice(0, MAX_NAME - suffix.length) : name}${suffix}`;
  let candidate = fit(' copy');
  for (let n = 2; taken.has(candidate); n += 1) candidate = fit(` copy ${n}`);
  return candidate;
}
