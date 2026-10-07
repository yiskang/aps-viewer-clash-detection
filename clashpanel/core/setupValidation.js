// clashpanel/core/setupValidation.js
// Region 1 validation (spec 6.2): Panel problems -> engine.validateTest issues (authoritative, mapped by RFC 6901 path)
// -> advisory pre-checks (registered, bound, loaded) -> Soft availability. Registration is READ-ONLY (PD-18): only
// `registry.bindingFor` is called. Nothing here checks a numeric engine limit (spec 5.2).
import { buildDefinition, participantKeysOf, selectionEntriesOf } from './draft.js';

const LABEL = Object.freeze({
  name: 'Test name', mode: 'Mode', clearance: 'Clearance', basis: 'Measurement basis', setA: 'Set A', setB: 'Set B', general: 'Test definition',
});
const HEAD_TO_CONTROL = Object.freeze({
  name: 'name', mode: 'mode', clearance: 'clearance', basis: 'basis', selectionA: 'setA', selectionB: 'setB',
});

/** '/clearance' -> clearance, '/selectionA/...' -> setA, '/selectionB/...' -> setB, '/name' -> name, '/mode' -> mode, else general. */
export function controlForIssuePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return { control: 'general' };
  const head = path.split('/')[1];
  return { control: Object.hasOwn(HEAD_TO_CONTROL, head) ? HEAD_TO_CONTROL[head] : 'general' };
}

export const participatingModelKeys = participantKeysOf;

const asText = (v) => (typeof v === 'string' ? v : '');

function coreFindings(issues, selfClash) {
  const out = [];
  const seen = new Set();
  for (const raw of issues) {
    const path = typeof raw?.path === 'string' ? raw.path : '';
    let { control } = controlForIssuePath(path);
    if (selfClash && control === 'setB') control = 'setA';        // Set B is hidden and identical in a self-clash
    const code = typeof raw?.code === 'string' && raw.code.length > 0 ? raw.code : 'unknown';
    const message = asText(raw?.message);
    const text = message.length > 0 ? `${LABEL[control]}: ${message}` : `${LABEL[control]} is not valid.`;
    const id = `${control}\u0000${code}\u0000${text}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ control, code, text });
  }
  return out;
}

function nameOf(catalog, key) {
  try {
    const name = catalog.displayNameFor(key);
    return typeof name === 'string' && name.length > 0 ? name : key;
  } catch { return key; }
}

function modelFindings({ draft, engine, catalog }) {
  let list;
  try { list = catalog.list(); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  const sideA = new Set(selectionEntriesOf(draft.setA).map((e) => e.modelKey));
  const out = [];
  for (const key of participatingModelKeys(draft)) {
    const entry = list.find((e) => e && e.modelKey === key);
    let binding = null;
    try { binding = engine.registry.bindingFor(key); } catch { binding = null; }
    const control = sideA.has(key) ? 'setA' : 'setB';
    if (!entry || binding === null || binding === undefined) {
      out.push({ control, code: 'model-not-registered', text: `Model ${nameOf(catalog, key)} is not registered.` });
    } else if (binding.model !== entry.model) {
      // stale in either direction: the catalog and the registry disagree on WHICH Model object this key names
      // (a reload the host has not re-registered yet, or a registry ahead of the catalog). Never repaired here (PD-18).
      out.push({ control, code: 'binding-stale', text: `Model ${nameOf(catalog, key)} was reloaded and is not registered yet.` });
    } else if (entry.loaded !== true) {
      out.push({ control, code: 'model-loading', text: `Model ${nameOf(catalog, key)} is still loading.` });
    }
  }
  return out;
}

/**
 * An unverified basis does NOT block Soft any more (owner decision 2026-10-07): the user supplies the basis, and a
 * missing one is the `basis-required` problem from buildDefinition. Only an evaluation still in flight blocks (fail closed).
 */
function softFinding(draft, softAvailability) {
  if (draft.mode !== 'soft' || participatingModelKeys(draft).length === 0) return [];
  if (softAvailability && softAvailability.pending === true) {
    return [{ control: 'mode', code: 'soft-checking', text: 'Checking whether Soft (clearance) is available…' }];
  }
  return [];
}

export function validateSetup({ draft, engine, catalog, softAvailability }) {
  const built = buildDefinition(draft, { verifiedBasis: softAvailability?.available === true && softAvailability?.pending !== true });
  const findings = built.problems.map(({ control, code, text }) => ({ control, code, text }));
  let issuesTruncated = false;
  if (built.definition !== null) {
    let result = null;
    try { result = engine.validateTest(built.definition); } catch { result = null; }
    if (result === null || typeof result !== 'object' || !Array.isArray(result.issues)) {
      findings.push({ control: 'general', code: 'validation-unavailable', text: 'The clash engine could not validate this test.' });
    } else {
      issuesTruncated = Boolean(result.issuesTruncated);
      findings.push(...coreFindings(result.issues, draft.selfClash));
    }
  }
  findings.push(...modelFindings({ draft, engine, catalog }), ...softFinding(draft, softAvailability));
  const ready = findings.length === 0;
  return { state: ready ? 'ready' : 'blocked', findings, issuesTruncated, definition: ready ? built.definition : null };
}
