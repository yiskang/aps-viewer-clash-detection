// clashpanel/core/draft.js
// The setup form as pure data, and its mapping to a Core ClashTestDefinition (spec 6.1, PD-8, OD-9). Nothing here reads a
// clock, an id source or a global: the controller mints ids and decides when to adopt the draft `prepareRun` returns.
import { isBasisChoice } from './measurementBasis.js';
const MAX_NAME = 256;                                   // Core schema bound for `name` (1-256), not an option default
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const SIDE_KEY = Object.freeze({ A: 'setA', B: 'setB' });
const CONTROL_LABEL = Object.freeze({ setA: 'Set A', setB: 'Set B' });

const emptySide = () => ({ modelKeys: [], elements: {} });
const uniqueSorted = (xs) => [...new Set(xs)].sort();
function normalizeIds(ids) {
  const out = new Set();
  for (const id of ids) {
    if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) out.add(id === 0 ? 0 : id);   // -0 -> 0, matching Core
  }
  return [...out].sort((a, b) => a - b);
}

// Own-property definition (never assignment): a model key such as "__proto__" must stay data, not become a prototype.
const putOwn = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });

function freezeSide(side) {
  if (Object.isFrozen(side)) return side;          // produced by an earlier freezeDraft: reuse, no O(n) recopy per keystroke
  const elements = {};
  for (const [k, ids] of Object.entries(side.elements)) putOwn(elements, k, Object.freeze([...ids]));
  return Object.freeze({ modelKeys: Object.freeze([...side.modelKeys]), elements: Object.freeze(elements) });
}
function freezeDraft(d) {
  return Object.freeze({
    ...d, setA: freezeSide(d.setA), setB: freezeSide(d.setB),
    lastRun: d.lastRun === null || Object.isFrozen(d.lastRun) ? d.lastRun : Object.freeze({ ...d.lastRun }),
  });
}

export function createDraft({ testId, testNumber = 1 } = {}) {
  if (typeof testId !== 'string' || testId.length === 0) throw new TypeError('createDraft: testId must be a non-empty string');
  return freezeDraft({
    testId, revision: 1, name: `Clash test ${testNumber}`, mode: 'hard', clearance: '', basisUnit: '', selfClash: false,
    setA: emptySide(), setB: emptySide(), lastRun: null, testCounter: testNumber,
  });
}

function normalizeElements(elements) {
  const out = {};
  for (const key of Object.keys(elements).sort()) {
    const ids = Array.isArray(elements[key]) ? normalizeIds(elements[key]) : [];
    if (ids.length > 0) putOwn(out, key, ids);
  }
  return out;
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Model keys on either side that take part in the test (Set A, plus Set B unless self-clash), sorted. */
export function participantKeysOf(draft) {
  const keys = selectionEntriesOf(draft.setA).map((e) => e.modelKey);
  if (!draft.selfClash) keys.push(...selectionEntriesOf(draft.setB).map((e) => e.modelKey));
  return [...new Set(keys)].sort();
}

/** Pure reducer. An invalid or no-op action returns the SAME draft object (identity), so callers can skip notifying. */
export function draftReduce(draft, action) {
  // The user's basis attestation is about THESE participating models: any change of the participant set drops it, so
  // an attestation made for A+B can never carry over to A+C (owner decision 2026-10-07).
  const set = (patch) => {
    const next = { ...draft, ...patch };
    if (next.basisUnit !== '' && !('basisUnit' in patch)
      && participantKeysOf(next).join('\u0000') !== participantKeysOf(draft).join('\u0000')) next.basisUnit = '';
    return freezeDraft(next);
  };
  switch (action?.type) {
    case 'name':
      return typeof action.value === 'string' && action.value !== draft.name ? set({ name: action.value }) : draft;
    case 'mode':
      return (action.value === 'hard' || action.value === 'soft') && action.value !== draft.mode ? set({ mode: action.value }) : draft;
    case 'clearance':
      return typeof action.value === 'string' && action.value !== draft.clearance ? set({ clearance: action.value }) : draft;
    case 'basisUnit':
      return isBasisChoice(action.value) && action.value !== draft.basisUnit ? set({ basisUnit: action.value }) : draft;
    case 'selfClash':
      return typeof action.value === 'boolean' && action.value !== draft.selfClash ? set({ selfClash: action.value }) : draft;
    case 'toggleModel': {
      const key = SIDE_KEY[action.side];
      if (key === undefined || typeof action.modelKey !== 'string' || action.modelKey.length === 0) return draft;
      const side = draft[key];
      const modelKeys = side.modelKeys.includes(action.modelKey)
        ? side.modelKeys.filter((k) => k !== action.modelKey) : uniqueSorted([...side.modelKeys, action.modelKey]);
      return set({ [key]: { ...side, modelKeys } });
    }
    case 'setElements': {
      const key = SIDE_KEY[action.side];
      if (key === undefined || action.elements === null || typeof action.elements !== 'object' || Array.isArray(action.elements)) return draft;
      const elements = normalizeElements(action.elements);
      return sameJson(elements, draft[key].elements) ? draft : set({ [key]: { ...draft[key], elements } });
    }
    case 'newTest':
      return typeof action.testId === 'string' && action.testId.length > 0
        ? createDraft({ testId: action.testId, testNumber: draft.testCounter + 1 }) : draft;
    default:
      return draft;
  }
}

/** One entry per model key: `{kind:'model'}` wins over `{kind:'elements'}` for the same model; sorted by modelKey. */
export function selectionEntriesOf(side) {
  const models = new Set(side.modelKeys);
  const keys = new Set(models);
  for (const [k, ids] of Object.entries(side.elements)) if (normalizeIds(ids).length > 0) keys.add(k);
  return [...keys].sort().map((modelKey) => (models.has(modelKey)
    ? { kind: 'model', modelKey }
    : { kind: 'elements', modelKey, dbIds: normalizeIds(side.elements[modelKey]) }));
}

function parseClearance(text) {
  const t = text.trim();
  if (t === '') return { code: 'clearance-required', text: 'Enter a clearance for Soft mode.' };
  const n = DECIMAL.test(t) ? Number(t) : NaN;
  if (!Number.isFinite(n)) return { code: 'clearance-invalid', text: 'Clearance must be a number.' };
  if (!(n > 0)) return { code: 'clearance-not-positive', text: 'Clearance must be greater than zero.' };
  return { value: n };
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const k of Object.keys(value)) deepFreeze(value[k]);
  }
  return value;
}

/**
 * `verifiedBasis` (default false = fail closed: a caller that supplies no basis information gets the basis requirement): false means the
 * measurement basis was NOT verified, so a Soft test also needs the user's basis attestation (`draft.basisUnit`).
 * The clearance number is never converted: it is the raw Core value in every case (see measurementBasis.js).
 */
export function buildDefinition(draft, { verifiedBasis = false } = {}) {
  const problems = [];
  const name = draft.name.trim();
  if (name.length === 0) problems.push({ control: 'name', code: 'name-required', text: 'Enter a name for this test.' });
  else if (name.length > MAX_NAME) problems.push({ control: 'name', code: 'name-too-long', text: `Test name must be ${MAX_NAME} characters or fewer.` });
  const soft = draft.mode === 'soft';
  let clearance;
  if (soft) {
    const parsed = parseClearance(draft.clearance);
    if (parsed.value === undefined) problems.push({ control: 'clearance', code: parsed.code, text: parsed.text });
    else clearance = parsed.value;
    if (!verifiedBasis && draft.basisUnit === '') {
      problems.push({ control: 'basis', code: 'basis-required', text: 'Choose the units/basis for this Soft test.' });
    }
  }
  const entriesA = selectionEntriesOf(draft.setA);
  const entriesB = draft.selfClash ? entriesA : selectionEntriesOf(draft.setB);
  if (entriesA.length === 0) problems.push({ control: 'setA', code: 'selection-empty', text: `${CONTROL_LABEL.setA} is empty — choose a model or use the current selection.` });
  if (!draft.selfClash && entriesB.length === 0) problems.push({ control: 'setB', code: 'selection-empty', text: `${CONTROL_LABEL.setB} is empty — choose a model or use the current selection.` });
  if (problems.length > 0) return { definition: null, problems };
  const copy = (entries) => ({ entries: entries.map((e) => ({ ...e, ...(e.dbIds ? { dbIds: [...e.dbIds] } : {}) })) });
  const definition = {
    schemaVersion: 1, testId: draft.testId, revision: draft.revision, name,
    selectionA: copy(entriesA), selectionB: copy(entriesB), mode: soft ? 'clearance' : 'volume-overlap',
    ...(soft ? { clearance } : {}),
  };
  return { definition: deepFreeze(definition), problems: [] };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}
function canonicalSelection(selection) {
  if (!Array.isArray(selection?.entries)) return canonical(selection);
  const entries = selection.entries.map((e) => (Array.isArray(e.dbIds) ? { ...e, dbIds: normalizeIds(e.dbIds) } : { ...e }));
  entries.sort((a, b) => (a.modelKey < b.modelKey ? -1 : a.modelKey > b.modelKey ? 1 : (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)));
  return canonical({ ...selection, entries });
}

/** Canonical compare key over ALL definition fields including `name`, excluding `revision` (spec 6.1). */
export function definitionKey(definition) {
  const { revision, selectionA, selectionB, ...rest } = definition;
  void revision;
  return JSON.stringify(canonical({ ...rest, selectionA: canonicalSelection(selectionA), selectionB: canonicalSelection(selectionB) }));
}

/**
 * Spec 6.1 "Draft identity lifecycle": the revision is bumped ONLY when the normalized definition (name included)
 * differs from the previous RUN's; it is monotone and never reused (edit-and-revert bumps again but yields the same
 * definitionKey). Pure: the caller adopts the returned draft after startRun returned a handle.
 */
export function prepareRun(draft, basisOptions) {
  const first = buildDefinition(draft, basisOptions);
  if (first.definition === null) return { draft, definition: null, problems: first.problems };
  const key = definitionKey(first.definition);
  const bump = draft.lastRun !== null && draft.lastRun.definitionKey !== key;
  const revision = bump ? draft.revision + 1 : draft.revision;
  const next = freezeDraft({ ...draft, revision, lastRun: { definitionKey: key, revision } });
  return { draft: next, definition: bump ? buildDefinition(next, basisOptions).definition : first.definition, problems: [] };
}
