// clashtest/definition/validate.js
import { captureData } from '../util/capture.js';
import { ENGINE_LIMIT_DEFAULTS } from '../options.js';
import { CLASH_MODES } from '../identity/ids.js';
import { InvalidTestDefinitionError, UnsupportedSchemaVersionError } from '../errors.js';

export const DEFINITION_KEYS = Object.freeze([
  'schemaVersion', 'testId', 'revision', 'name', 'description', 'selectionA', 'selectionB', 'mode', 'clearance',
]);
export const REFERENCE_KEYS = Object.freeze(['testId', 'revision']);

export const ISSUE_CODES = Object.freeze([
  // structural (mapped from P0's CAPTURE_CODES, see CAPTURE_TO_ISSUE)
  'not-plain-object', 'unreadable', 'symbol-key', 'accessor-property', 'sparse-array', 'array-extra-key',
  'cyclic', 'too-deep', 'too-many-nodes', 'array-too-long', 'unsupported-schema-version',
  // schema (applied to the detached copy)
  'not-an-object', 'unknown-property', 'missing-required', 'not-a-string', 'not-an-array',
  'string-too-short', 'string-too-long', 'not-an-integer', 'out-of-range', 'not-a-finite-number', 'not-positive',
  'too-many-entries', 'too-many-elements', 'invalid-enum', 'invalid-schema-version',
  'clearance-required', 'clearance-forbidden',
]);

/** P0 `CAPTURE_CODES` -> P2 `ISSUE_CODES` (reconciliation row N4). `array-too-long` is refined by path below. */
const CAPTURE_TO_ISSUE = Object.freeze({
  accessor: 'accessor-property', 'symbol-key': 'symbol-key', 'sparse-array': 'sparse-array',
  'array-extra-key': 'array-extra-key', 'not-plain': 'not-plain-object', cyclic: 'cyclic',
  unreadable: 'unreadable', depth: 'too-deep', 'too-many-nodes': 'too-many-nodes',
  'string-too-long': 'string-too-long', 'array-too-long': 'array-too-long', gated: 'unsupported-schema-version',
  // P0 added this after the plan was written; it needs `openFieldBudget`, which no P2 caller passes, so it is unreachable
  // here. Mapped explicitly (fail closed) rather than left to the `?? 'unreadable'` fallback.
  'unknown-field-bytes': 'unreadable',
});

// Spec 5.1 / V3-V5 field bounds. These are schema constants, not option defaults.
const SCHEMA = Object.freeze({ testId: 256, name: 256, description: 4096, modelKey: 1024 });
const DEFINITION_SCHEMA_VERSION = 1;
const REFERENCE_MAX_NODES = 16;                  // 3 legitimate nodes + headroom so unknown keys are *named*
const ENTRIES_PATH = /^\/selection[AB]\/entries$/;
const DBIDS_PATH = /^\/selection[AB]\/entries\/\d+\/dbIds$/;
const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.hasOwn(o, k);

/** Engine limits P2 reads, filled from P0's defaults (nothing is restated here). */
function limitsOf(limits) {
  return { ...ENGINE_LIMIT_DEFAULTS, ...limits };
}

// An issue collector with a hard cap. `add` returns false once the cap is reached. Reaching the cap
// exactly also reports truncated (conservative, S-P2-4). Messages are schema-derived and NEVER embed a
// caller value; `valueFree` blanks them entirely (13.5 listing pages carry {path, code} only).
function createCollector(maxIssues, { valueFree = false } = {}) {
  const issues = [];
  let truncated = false;
  return {
    issues,
    get truncated() { return truncated; },
    get full() { return issues.length >= maxIssues; },
    add(path, code, message) {
      if (issues.length >= maxIssues) { truncated = true; return false; }
      issues.push({ path, code, message: valueFree ? '' : message });
      if (issues.length >= maxIssues) truncated = true;
      return issues.length < maxIssues;
    },
  };
}

/** Maps one P0 capture issue to a P2 issue. Root pointer '' becomes '/'. */
function mapCaptureIssue({ path, code }, valueFree) {
  let mapped = CAPTURE_TO_ISSUE[code] ?? 'unreadable';
  if (mapped === 'array-too-long') {
    if (ENTRIES_PATH.test(path)) mapped = 'too-many-entries';
    else if (DBIDS_PATH.test(path)) mapped = 'too-many-elements';
  }
  return { path: path === '' ? '/' : path, code: mapped, message: valueFree ? '' : `structural: ${code}` };
}

/**
 * The structural half of the single pass: P0's captureData, then the issue mapping. A non-object root is
 * rejected before any reflection. Returns captureData's shape with P2 issues.
 */
function captureStructural(root, opts, { valueFree = false } = {}) {
  if (root === null || typeof root !== 'object') {
    return { ok: false, issues: [{ path: '/', code: 'not-an-object', message: valueFree ? '' : 'expected an object' }], issuesTruncated: false };
  }
  const result = captureData(root, opts);
  if (result.ok) return result;
  const out = {
    ok: false,
    issues: result.issues.map((i) => mapCaptureIssue(i, valueFree)),
    issuesTruncated: result.issuesTruncated || result.issues.length >= opts.maxIssues,
  };
  if (result.gate) out.gate = result.gate;
  return out;
}

/**
 * captureData options for a definition (P0 Gates item 1). The node ceiling is
 * 16 + 2 x (2 + 4 x maxEntriesPerSelection + maxExplicitElementsPerSelection): per selection one object,
 * one `entries` array, up to four nodes per entry and one node per explicit dbId, plus the scalar fields.
 * `rootGate` fires before anything else is read when `schemaVersion` is an integer > 1 (5.3: a newer
 * schema "is never partially interpreted").
 */
function definitionCaptureOpts(l, maxIssues) {
  return {
    maxNodes: 16 + 2 * (2 + 4 * l.maxEntriesPerSelection + l.maxExplicitElementsPerSelection),
    maxIssues,
    maxStringLength: SCHEMA.description,           // the largest V3 string cap
    maxArrayLength: Math.max(l.maxEntriesPerSelection, l.maxExplicitElementsPerSelection),
    arrayLimitFor: (p) => (ENTRIES_PATH.test(p) ? l.maxEntriesPerSelection
      : DBIDS_PATH.test(p) ? l.maxExplicitElementsPerSelection : undefined),
    rootGate: {
      key: 'schemaVersion',
      check: (v) => !(typeof v === 'number' && Number.isInteger(v) && v > DEFINITION_SCHEMA_VERSION),
    },
  };
}

/**
 * R21-I3. Deterministic, fail-closed overload discrimination for startRun(defOrRef).
 * The argument is captured once (P0 `captureData`, which copies every own key by Reflect.ownKeys,
 * enumerable or not); an object is a REFERENCE iff the copy's key set is exactly {testId} or
 * {testId, revision}. Any other captured object is a DEFINITION and goes through V1-V6. 'invalid' means
 * "not capturable as a plain-data object" (non-object, array, symbol key, accessor, cycle, unreadable,
 * over the node ceiling). Nothing is guessed.
 */
export function classifyStartRunArgument(arg, { limits } = {}) {
  const l = limitsOf(limits);
  const captured = captureStructural(arg, definitionCaptureOpts(l, 8));
  if (!captured.ok) return { kind: 'invalid', issues: captured.issues };
  if (Array.isArray(captured.value)) {
    return { kind: 'invalid', issues: [{ path: '/', code: 'not-an-object', message: 'expected an object' }] };
  }
  const keys = Object.keys(captured.value);
  const isReference = keys.length >= 1 && keys.length <= 2
    && keys.includes('testId')
    && keys.every((k) => REFERENCE_KEYS.includes(k));
  return { kind: isReference ? 'reference' : 'definition', issues: [] };
}

/** The closed ClashTestReference schema: R1 shape, R2 testId, R3 revision. Capture, then validate the copy. */
export function validateReference(ref, { limits } = {}) {
  const l = limitsOf(limits);
  const cap = captureStructural(ref, {
    maxNodes: REFERENCE_MAX_NODES, maxIssues: l.maxValidationIssues, maxStringLength: SCHEMA.testId,
  });
  if (!cap.ok) return { issues: cap.issues, issuesTruncated: cap.issuesTruncated, captured: null };
  const c = createCollector(l.maxValidationIssues);
  const copy = cap.value;
  if (!isRecord(copy)) {
    c.add('/', 'not-an-object', 'expected an object');
    return { issues: c.issues, issuesTruncated: c.truncated, captured: null };
  }
  for (const k of Object.keys(copy)) {
    if (!REFERENCE_KEYS.includes(k)) c.add(`/${esc(k)}`, 'unknown-property', 'not a reference field');
  }
  if (!has(copy, 'testId')) c.add('/testId', 'missing-required', 'testId is required');
  else if (typeof copy.testId !== 'string') c.add('/testId', 'not-a-string', 'testId must be a string');
  else if (copy.testId.length < 1) c.add('/testId', 'string-too-short', 'testId must be 1-256 code units');
  else if (copy.testId.length > SCHEMA.testId) c.add('/testId', 'string-too-long', 'testId must be 1-256 code units');
  if (has(copy, 'revision')) {
    const r = copy.revision;
    if (typeof r !== 'number' || !Number.isInteger(r)) c.add('/revision', 'not-an-integer', 'revision must be an integer');
    else if (r < 1 || r > Number.MAX_SAFE_INTEGER) c.add('/revision', 'out-of-range', 'revision must be 1..2^53-1');
  }
  const captured = c.issues.length === 0 ? { testId: copy.testId, revision: has(copy, 'revision') ? copy.revision : null } : null;
  return { issues: c.issues, issuesTruncated: c.truncated, captured };
}

const ENTRY_KEYS_MODEL = Object.freeze(['kind', 'modelKey']);
const ENTRY_KEYS_ELEMENTS = Object.freeze(['kind', 'modelKey', 'dbIds']);

/** Schema check for one string field of the copy. Returns nothing; issues go to the collector. */
function checkString(obj, key, path, c, min, max, required) {
  if (!has(obj, key)) { if (required) c.add(path, 'missing-required', 'required'); return; }
  const v = obj[key];
  if (typeof v !== 'string') c.add(path, 'not-a-string', 'must be a string');
  else if (v.length < min) c.add(path, 'string-too-short', 'below the minimum length');
  else if (v.length > max) c.add(path, 'string-too-long', 'above the maximum length');
}

function checkDbIds(dbIds, path, c, budget) {
  if (!Array.isArray(dbIds)) { c.add(path, 'not-an-array', 'must be an array'); return; }
  if (dbIds.length < 1) { c.add(path, 'out-of-range', 'dbIds must be non-empty'); return; }
  budget.remaining -= dbIds.length;
  if (budget.remaining < 0) { c.add(path, 'too-many-elements', 'over maxExplicitElementsPerSelection'); return; }
  for (let i = 0; i < dbIds.length && !c.full; i += 1) {
    const v = dbIds[i];
    if (typeof v !== 'number' || !Number.isInteger(v)) c.add(`${path}/${i}`, 'not-an-integer', 'must be an integer');
    else if (v < 0 || v > Number.MAX_SAFE_INTEGER) c.add(`${path}/${i}`, 'out-of-range', 'must be a non-negative safe integer');
    else if (v === 0) dbIds[i] = 0;                       // -0 normalized in the copy (5.4 needs it before digesting)
  }
}

function checkSelection(sel, path, c, l) {
  if (!isRecord(sel)) { c.add(path, 'not-an-object', 'expected an object'); return; }
  for (const k of Object.keys(sel)) {
    if (k !== 'entries') c.add(`${path}/${esc(k)}`, 'unknown-property', 'not a selection field');
  }
  const entriesPath = `${path}/entries`;
  if (!has(sel, 'entries')) { c.add(entriesPath, 'missing-required', 'required'); return; }
  const entries = sel.entries;
  if (!Array.isArray(entries)) { c.add(entriesPath, 'not-an-array', 'must be an array'); return; }
  if (entries.length < 1) { c.add(entriesPath, 'out-of-range', 'entries must be non-empty'); return; }
  const budget = { remaining: l.maxExplicitElementsPerSelection };
  for (let i = 0; i < entries.length && !c.full; i += 1) {
    const ep = `${entriesPath}/${i}`;
    const entry = entries[i];
    if (!isRecord(entry)) { c.add(ep, 'not-an-object', 'expected an object'); continue; }
    if (!has(entry, 'kind')) { c.add(`${ep}/kind`, 'missing-required', 'required'); continue; }
    if (entry.kind !== 'model' && entry.kind !== 'elements') { c.add(`${ep}/kind`, 'invalid-enum', 'kind must be model or elements'); continue; }
    const allowed = entry.kind === 'model' ? ENTRY_KEYS_MODEL : ENTRY_KEYS_ELEMENTS;
    for (const k of Object.keys(entry)) {
      if (!allowed.includes(k)) c.add(`${ep}/${esc(k)}`, 'unknown-property', 'not an entry field for this kind');
    }
    checkString(entry, 'modelKey', `${ep}/modelKey`, c, 1, SCHEMA.modelKey, true);
    if (entry.kind === 'elements') {
      if (!has(entry, 'dbIds')) c.add(`${ep}/dbIds`, 'missing-required', 'required');
      else checkDbIds(entry.dbIds, `${ep}/dbIds`, c, budget);
    }
  }
}

/** V1-V6 over the detached copy. Order: unknown keys (caller's key order), then the fields in DEFINITION_KEYS order. */
function checkDefinition(d, c, l) {
  if (!isRecord(d)) { c.add('/', 'not-an-object', 'expected an object'); return; }
  for (const k of Object.keys(d)) {
    if (!DEFINITION_KEYS.includes(k)) c.add(`/${esc(k)}`, 'unknown-property', 'not a definition field');
  }
  // V2 -- an integer > 1 never reaches here: P0's rootGate stopped capture with `unsupported-schema-version`
  if (!has(d, 'schemaVersion')) c.add('/schemaVersion', 'missing-required', 'required');
  else if (d.schemaVersion !== DEFINITION_SCHEMA_VERSION) c.add('/schemaVersion', 'invalid-schema-version', 'schemaVersion must be 1');
  // V3
  checkString(d, 'testId', '/testId', c, 1, SCHEMA.testId, true);
  if (!has(d, 'revision')) c.add('/revision', 'missing-required', 'required');
  else if (typeof d.revision !== 'number' || !Number.isInteger(d.revision)) c.add('/revision', 'not-an-integer', 'must be an integer');
  else if (d.revision < 1 || d.revision > Number.MAX_SAFE_INTEGER) c.add('/revision', 'out-of-range', 'outside the permitted range');
  checkString(d, 'name', '/name', c, 1, SCHEMA.name, true);
  if (has(d, 'description')) checkString(d, 'description', '/description', c, 0, SCHEMA.description, false);
  // V4 + V5
  for (const side of ['selectionA', 'selectionB']) {
    if (!has(d, side)) c.add(`/${side}`, 'missing-required', 'required');
    else checkSelection(d[side], `/${side}`, c, l);
  }
  // V6 -- the mode list is P1's (`CLASH_MODES`); a caller-supplied `pairSemantics` is an unknown key (4.5)
  let mode;
  if (!has(d, 'mode')) c.add('/mode', 'missing-required', 'required');
  else if (!CLASH_MODES.includes(d.mode)) c.add('/mode', 'invalid-enum', 'mode must be one of the four library modes');
  else mode = d.mode;
  if (mode === 'clearance' && !has(d, 'clearance')) {
    c.add('/clearance', 'clearance-required', 'clearance mode requires a clearance');
  } else if (mode !== undefined && mode !== 'clearance' && has(d, 'clearance')) {
    c.add('/clearance', 'clearance-forbidden', 'clearance is forbidden outside clearance mode');
  } else if (has(d, 'clearance')) {
    if (typeof d.clearance !== 'number') c.add('/clearance', 'not-a-finite-number', 'clearance must be a finite number');
    else if (!(d.clearance > 0)) c.add('/clearance', 'not-positive', 'clearance must be greater than zero');
  }
}

/**
 * The ONE synchronous capture-and-validate pass (5.3), realised as P0's `captureData` (structure) followed
 * by V1-V6 on the copy (schema). `captured` is that detached copy, non-null iff `issues` is empty. `gate`
 * is present iff capture stopped at the schemaVersion gate (it carries the offending value for
 * `toDefinitionError`).
 */
export function captureAndValidate(def, { limits } = {}) {
  const l = limitsOf(limits);
  const cap = captureStructural(def, definitionCaptureOpts(l, l.maxValidationIssues));
  if (!cap.ok) {
    const out = { issues: cap.issues, issuesTruncated: cap.issuesTruncated, captured: null };
    if (cap.gate) out.gate = cap.gate;
    return out;
  }
  const c = createCollector(l.maxValidationIssues);
  checkDefinition(cap.value, c, l);
  return { issues: c.issues, issuesTruncated: c.truncated, captured: c.issues.length === 0 ? cap.value : null };
}

/** Pure; never throws for a data error (5.3, R16 Q1). */
export function validateTest(def, opts) {
  const { issues, issuesTruncated } = captureAndValidate(def, opts);
  return { issues, issuesTruncated };
}

/** 5.3: UnsupportedSchemaVersionError iff `unsupported-schema-version` is the ONLY issue. Object-argument errors (P0 N1). */
export function toDefinitionError({ issues, issuesTruncated, gate }) {
  if (issues.length === 1 && issues[0].code === 'unsupported-schema-version') {
    return new UnsupportedSchemaVersionError({
      type: 'ClashTestDefinition', schemaVersion: gate ? gate.value : null, supported: DEFINITION_SCHEMA_VERSION,
    });
  }
  return new InvalidTestDefinitionError({ issues, issuesTruncated });
}

/** 13.5: `ClashTestStore.list` limits. The in-memory store imports this; the page validator bounds its capture with it. */
export const LIST_LIMIT = Object.freeze({ default: 100, max: 1000 });
const SUMMARY_KEYS = Object.freeze(['testId', 'latestRevision', 'archived', 'name']);
const MAX_LISTING_ISSUES = 20;
const MAX_CURSOR_LENGTH = 1024;

/**
 * Reader side of the 13.5 listing contract: a foreign store's page is untrusted data. Capture, then validate the copy.
 * Default result `{issues, issuesTruncated}`. With `{ returnCopy: true }` the result also carries `captured`: the
 * detached, VALIDATED copy (null when there are issues) -- the only value a caller may trust and return, because
 * the store's own object can keep changing after this call.
 */
export function validateTestSummaryPage(page, { returnCopy = false } = {}) {
  const opts = {
    maxNodes: 8 + 5 * LIST_LIMIT.max, maxIssues: MAX_LISTING_ISSUES, maxStringLength: MAX_CURSOR_LENGTH,
    arrayLimitFor: (p) => (p === '/summaries' ? LIST_LIMIT.max : undefined),
  };
  const cap = captureStructural(page, opts, { valueFree: true });
  const done = (issues, issuesTruncated) => {
    const out = { issues, issuesTruncated };
    if (returnCopy) out.captured = issues.length === 0 ? cap.value : null;
    return out;
  };
  if (!cap.ok) return done(cap.issues, cap.issuesTruncated);
  const c = createCollector(MAX_LISTING_ISSUES, { valueFree: true });
  const p = cap.value;
  if (!isRecord(p)) { c.add('/', 'not-an-object', ''); return done(c.issues, c.truncated); }
  for (const k of Object.keys(p)) {
    if (k !== 'summaries' && k !== 'next') c.add(`/${esc(k)}`, 'unknown-property', '');
  }
  if (has(p, 'next')) {
    if (typeof p.next !== 'string') c.add('/next', 'not-a-string', '');
    else if (p.next.length > MAX_CURSOR_LENGTH) c.add('/next', 'string-too-long', '');
  }
  if (!has(p, 'summaries')) c.add('/summaries', 'missing-required', '');
  else if (!Array.isArray(p.summaries)) c.add('/summaries', 'not-an-array', '');
  else {
    for (let i = 0; i < p.summaries.length && !c.full; i += 1) {
      const row = p.summaries[i];
      const rp = `/summaries/${i}`;
      if (!isRecord(row)) { c.add(rp, 'not-an-object', ''); continue; }
      for (const k of Object.keys(row)) {
        if (!SUMMARY_KEYS.includes(k)) c.add(`${rp}/${esc(k)}`, 'unknown-property', '');
      }
      checkString(row, 'testId', `${rp}/testId`, c, 1, SCHEMA.testId, true);
      if (!has(row, 'latestRevision')) c.add(`${rp}/latestRevision`, 'missing-required', '');
      else if (typeof row.latestRevision !== 'number' || !Number.isInteger(row.latestRevision)) c.add(`${rp}/latestRevision`, 'not-an-integer', '');
      else if (row.latestRevision < 1 || row.latestRevision > Number.MAX_SAFE_INTEGER) c.add(`${rp}/latestRevision`, 'out-of-range', '');
      checkString(row, 'name', `${rp}/name`, c, 1, SCHEMA.name, true);
      if (!has(row, 'archived')) c.add(`${rp}/archived`, 'missing-required', '');
      else if (typeof row.archived !== 'boolean') c.add(`${rp}/archived`, 'invalid-enum', '');
    }
  }
  return done(c.issues, c.truncated);
}
